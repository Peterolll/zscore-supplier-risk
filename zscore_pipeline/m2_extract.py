"""
m2_extract.py — 双通道提取

通道1（电子文本）：pdfplumber 直提表格 + 文本行。
通道2（扫描件）：GLM-4V-Flash OCR（见 ocr_glm）。
输出：LineItem 候选列表（label, raw_value, page, method），供 M4 映射。
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

from .models import ExtractMethod
from .ocr_glm import ocr_pdf_via_glm
from .config import GLM_OCR


@dataclass
class LineItem:
    label: str
    raw_value: str
    page: int
    method: ExtractMethod
    unit_scale: float | None = field(default=None, kw_only=True)
    statement: bool = field(default=False, kw_only=True)
    consolidated: bool = field(default=False, kw_only=True)
    unit_unknown: bool = field(default=False, kw_only=True)
    formula: str | None = field(default=None, kw_only=True)
    source_file: str | None = field(default=None, kw_only=True)
    bbox: list[float] | None = field(default=None, kw_only=True)
    coordinate_space: str = field(default="original_normalized", kw_only=True)
    rotation: int = field(default=0, kw_only=True)
    sheet: str | None = field(default=None, kw_only=True)
    cell: str | None = field(default=None, kw_only=True)
    column: str | None = field(default=None, kw_only=True)
    period: str | None = field(default=None, kw_only=True)
    unit: str | None = field(default=None, kw_only=True)
    source: str = "table"   # "table" 优先于 "text"（双列报表本期列）


def _is_numeric(s: str) -> bool:
    return bool(re.search(r"[\d,]", s)) and not s.strip().isalpha()


def table_items(rows, page_no: int, method: ExtractMethod) -> list[LineItem]:
    items = []
    value_col = 1  # A headerless two-column table has one unambiguous value column.
    has_header = False
    selected_header = "金额"
    for row in rows:
        cells = [str(c).strip() if c is not None else "" for c in (row or [])]
        current = [i for i, c in enumerate(cells) if i > 0 and re.search(
            r"本期|期末|年末|本年|本季|本季度|本报告期|本報告期|current|this (?:year|period)|ending", c, re.I)
            and not re.search(r"上期|上年|previous|prior|opening", c, re.I)]
        if current:
            value_col = current[0]
            selected_header = cells[value_col]
            has_header = True
            continue
        years = [(i, int(m.group())) for i, c in enumerate(cells) if (m := re.search(r"\b20\d{2}\b", c))]
        if len(years) >= 2 and (not cells[0] or re.search(r"科目|项目|項目|account|item|year|date", cells[0], re.I)):
            value_col = max(years, key=lambda x: x[1])[0]
            selected_header = cells[value_col]
            has_header = True
            continue
        if any(re.search(r"上期|期初|上年|previous|prior|opening|附注|行次|note", c, re.I) for c in cells):
            # Ambiguous header: do not guess an amount column.
            if any(re.search(r"科目|项目|項目|account|item", c, re.I) for c in cells):
                value_col = None
                continue
        if not has_header and len(cells) > 2:
            # Multiple unlabelled numeric columns (including notes/row numbers) are ambiguous.
            items.append(LineItem(cells[0], "", page_no, method, "table"))
            continue
        if value_col is None or len(cells) <= value_col or not cells[0]:
            continue
        value = cells[value_col]
        if value and _is_numeric(value):
            items.append(LineItem(cells[0], value, page_no, method, "table", column=selected_header,period=selected_header))
        else:
            # Preserve a missing current-period cell so text fallback cannot select prior data.
            items.append(LineItem(cells[0], "", page_no, method, "table"))
    return items


def _extract_tables(page, page_no: int, method: ExtractMethod) -> list[LineItem]:
    try:
        tables = page.extract_tables()
    except Exception:
        tables = []
    return [item for table in tables for item in table_items(table, page_no, method)]


# 整行扫描：标签(以 CJK 或 拉丁字母 起头) + 后接首个数值。
# 适配双列报表：右列科目出现在行中段（如 "1470 其他流動資產 ... 流動負債合計 1,610,225 ..."），
# 因此不能锚定行首；账户编码(纯数字)非 CJK/字母起头，自动跳过。
# 2026-08-05 修正：原正则要求标签以 CJK 起头，导致纯英文报表(如 QSP 的英文 IFRS 利润表/
# 权益变动表)的科目整行被丢弃，进而整篇被误判为"无财务关键词"而强制走 OCR。
# 2026-08-19 修正：label 字符集缺失引号字符（ASCII " 和中文左右双引号 \u201c\u201d），
# 导致含「以"-"号填列」的利润表科目行（如「四、利润总额（亏损总额以"-"号填列）」）
# 被截断为「号填列）」，利润总额等关键字段无法被正确匹配。
_LABEL_VAL_RE = re.compile(
    r"(?P<label>(?:[\u4e00-\u9fff]|[A-Za-z])"
    r"[\u4e00-\u9fffA-Za-z0-9（）()\"'’“”‘’、，,\-\.\s]*?)"
    r"\s*[:：]?\s*\$?\s*"
    r"(?P<val>\([\d,\.]+\)|[\$\(\)\-]?[\d,]+(?:\.\d+)?)"
)


def _extract_text_lines(text: str, page_no: int, method: ExtractMethod) -> list[LineItem]:
    items: list[LineItem] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        for m in _LABEL_VAL_RE.finditer(line):
            label = m.group("label").strip().rstrip("：:；;,.，、$% ")
            val = m.group("val").strip()
            if not label or not re.search(r"\d", val):
                continue
            items.append(LineItem(label, val, page_no, method, "text"))
    return items


# 比较期/期初标签（非本期，跳过）
_COMPARATIVE_KW = ["上期", "上期末", "上期间初", "last period", "last year",
                  "previous", "期初", "beginning", "at last", "opening"]
_HEADER_KW = ["科目名", "数值", "本期数", "上期数", "this period"]


def _clean_label(label: str) -> str:
    label = re.sub(r"<[^>]*>", "", label)        # 去 <English> 注解
    label = label.strip().lstrip("-").strip()
    label = label.rstrip("：:；;,.，、$% ")
    label = re.sub(r"\s+", " ", label)
    return label


def _parse_ocr_text(ocr_text: str) -> list[LineItem]:
    """解析 GLM-4V-Flash OCR 输出 → LineItem 列表。

    适配：竖线表格 `| 科目 | 数值 |`、TAB 表格 `科目<TAB>本期<TAB>上期`、多空格分隔。
    跳过封面/附注页散文、表头行、比较期(上期/期初)行。数值取本期（3 列时取中间列），
    负值保留（负债在 GLM 输出中常以负数列示，符号在 m4_map 处理）。
    """
    if re.search(r"\[PAGE \d+\]", ocr_text):
        parts = re.split(r"\[PAGE (\d+)\]", ocr_text)
        combined = []
        for n in range(1, len(parts), 2):
            parsed = _parse_ocr_text(parts[n + 1])
            for item in parsed:
                item.page = int(parts[n])
            combined.extend(parsed)
        return combined
    rows: list[list[str]] = []
    for raw in ocr_text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if "|" in line:
            cells = [c.strip() for c in line.split("|")]
            if cells and not cells[0]:
                cells.pop(0)
            if cells and not cells[-1]:
                cells.pop()
        else:
            # Empty TAB cells are real columns, including a missing current value.
            cells = [c.strip() for c in re.split(r"\t|<TAB>| {2,}", line)]
        if len(cells) < 2 or not cells[0] or set(cells[0]) <= set("-—:"):
            continue
        cells[0] = _clean_label(cells[0])
        if any(k in cells[0].lower() for k in _COMPARATIVE_KW):
            continue
        rows.append(cells)
    items = table_items(rows, 0, ExtractMethod.GLM_OCR)
    for item in items:
        item.source = "text"
    attach_page_metadata(items, ocr_text, ocr=True)
    return items


# ── OCR 关键字段校验重试（见 config.GLM_OCR["verify_attempts"]）──
# GLM-4V-Flash 对同一份扫描 PDF 的输出极不稳定：连跑 3 次，「三、利润总额」行
# 仅 1 次被读出（漏读率 ≈2/3），格式还在 markdown 表格 / TAB 分隔之间随机切换。
# 一旦漏读，profit_before_tax 缺失 → m4_map 的 EBIT 推导链断裂 → X3 缺席 → Z 值失真。
# 因此这里做「覆盖校验 + 定向补抓」：缺失关键字段时重跑 OCR，只把能补齐的行并入。
_DEFAULT_VERIFY_FIELDS = ("revenue", "profit_before_tax", "interest_expense")


def _covered_fields(items: list[LineItem]) -> set[str]:
    """这批 LineItem 已经覆盖到哪些规范字段。"""
    from .synonym import match_field
    from .m4_map import parse_number
    out: set[str] = set()
    for it in items:
        f = match_field(it.label)
        scale = it.unit_scale if it.unit_scale is not None else 1.0
        if f and not it.unit_unknown and parse_number(it.raw_value, scale) is not None:
            out.add(f)
    return out


def _merge_missing(dst: list[LineItem], src: list[LineItem], missing: set[str]) -> None:
    """把 src 中能补上 missing 字段的行并入 dst（每个缺失字段只补一次，避免重复候选）。

    只补「缺失字段」是刻意的：已抓到的字段若被新一次的 OCR 结果覆盖，
    反而会把 m4_map 的「最晚页候选」选择逻辑搅乱（GLM 两次输出页序不一致）。
    """
    from .synonym import match_field
    still = set(missing)
    for it in src:
        f = match_field(it.label)
        if f and f in still and f in _covered_fields([it]):
            dst.append(it)
            still.discard(f)


def _ocr_with_verification(pdf_path: str) -> tuple[list[LineItem], str, int, list[str]]:
    """带关键字段校验的 OCR。返回 (items, ocr_text, 实际调用次数, 仍缺失字段)。

    verify_attempts=1 时退化为旧行为（单次 OCR，零额外开销）。
    """
    max_attempts = max(1, int(GLM_OCR.get("verify_attempts", 1) or 1))
    verify_fields = set(GLM_OCR.get("verify_fields") or _DEFAULT_VERIFY_FIELDS)

    best: list[LineItem] = []
    best_text = ""
    attempts = 0

    for attempt in range(1, max_attempts + 1):
        attempts = attempt
        text = ocr_pdf_via_glm(pdf_path)
        parsed = _parse_ocr_text(text)
        if not best:
            best, best_text = parsed, text

        missing = verify_fields - _covered_fields(best)
        if not missing:
            break
        # parsed 与 best 同一对象（首次循环）时不能自并，否则字段翻倍
        if parsed is not best:
            _merge_missing(best, parsed, missing)
            if not (verify_fields - _covered_fields(best)):
                break

    still_missing = sorted(verify_fields - _covered_fields(best))
    return best, best_text, attempts, still_missing


def extract_pdf(pdf_path: str | Path, force_ocr: bool = False) -> tuple[list[LineItem], ExtractMethod, int]:
    """返回 (LineItem列表, 实际使用的method, 文本长度)。"""
    pdf_path = str(pdf_path)
    items: list[LineItem] = []
    text_len = 0

    # 先试电子文本，判断是否足够
    electronic_enough = False
    if not force_ocr:
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                txt = page.extract_text() or ""
                text_len += len(txt)
                page_items = _extract_tables(page, i, ExtractMethod.PDFPLUMBER)
                from .synonym import match_field, normalize
                blocked = {match_field(it.label) or normalize(it.label) for it in page_items}
                page_items += [it for it in _extract_text_lines(txt, i, ExtractMethod.PDFPLUMBER)
                               if (match_field(it.label) or normalize(it.label)) not in blocked]
                attach_page_metadata(page_items, txt)
                for item in page_items:
                    item.source_file = str(Path(pdf_path).resolve())
                    if not item.raw_value:continue
                    hits=page.search(re.escape(item.raw_value)) or []
                    labels=page.search(re.escape(item.label)) or []
                    aligned=[h for h in hits if any(abs(h['top']-lab['top'])<8 for lab in labels)]
                    if len(aligned)==1:
                        h=aligned[0];item.bbox=[h['x0']/page.width,h['top']/page.height,h['x1']/page.width,h['bottom']/page.height]
                items += page_items
        finalize_units(items)
        # 启发式：含「资产负债表小计/总计」标记且文本量足 → 视为电子文本。
        # 2026-08-05 修正：原 KW 用泛化词("assets"/"负债")会误命中 note 散文
        # (如 QSP 英文 notes 的 "All other assets are classified as non-current")，
        # 导致「文本页 + 扫描 BS 页」的混合 PDF 被误判为纯电子、跳过 OCR、
        # 最终资产负债表字段全缺。改为仅匹配真实报表才出现的「小计/总计」标记。
        # 同时覆盖简体/繁体/英文 IFRS。
        joined = " ".join(it.label for it in items)
        KW = [
            # 中文/繁中 资产负债表小计·总计标记
            "资产总计", "资产合计", "负债合计", "负债总计", "所有者权益合计", "权益总计",
            "資產總計", "負債總計", "權益總額", "保留盈餘", "保留盈余",
            "流動資產合計", "流動負債合計", "流动资产合计", "流动负债合计",
            "合計", "總計", "总计",
            # 英文 IFRS 小计标记（避免裸 "total" 命中 TOTAL COMPREHENSIVE INCOME）
            "total assets", "total liabilities", "total equity",
            "total current assets", "total current liabilities", "total revenue",
        ]
        if text_len > 300 and any(k in joined.lower() for k in KW):
            electronic_enough = True

    if not electronic_enough:
        # 走 GLM-4V-Flash OCR（扫描件通道）
        if not GLM_OCR["enabled"]:
            from .ocr_glm import OCRUnavailable
            raise OCRUnavailable(
                f"扫描件需 GLM-4V-Flash OCR，但 GLM_API_KEY 未设置：{pdf_path}"
            )
        from .vision import extract_pdf_vision
        return extract_pdf_vision(pdf_path)

    return items, ExtractMethod.PDFPLUMBER, text_len


def explicit_unit_scale(text: str) -> float | None:
    """Only unit declarations, not arbitrary financial prose, determine scale."""
    patterns = [(1e9, r"(?:in |in\s+)(?:billions)|单位[：: ]*十亿|單位[：: ]*十億"),
                (1e6, r"(?:in |in\s+)(?:millions)|百万[元圓]|百萬[元圓]"),
                (1e4, r"(?<!百)万元|(?<!百)萬元"),
                (1e3, r"千元|仟元|(?:in |in\s+)(?:thousands)|[\$€£]\s*['’]?000"),
                (1.0, r"(?:单位|單位)[：: ]*(?:人民币|人民幣|新台币|新臺幣|港币|港幣)?[元圓]|in (?:dollars|yuan)|金额[（(]元[）)]|金額[（(]元[）)]") ]
    found = {scale for scale, pattern in patterns if re.search(pattern, text, re.I)}
    return next(iter(found)) if len(found) == 1 else None


def detect_unit_scale(text: str) -> float:
    return explicit_unit_scale(text) or 1.0


def attach_page_metadata(items: list[LineItem], text: str, *, ocr: bool = False) -> None:
    scale = explicit_unit_scale(text)
    heading = " ".join(text.splitlines()[:8])
    statement = not bool(re.search(r"附注|附註|notes to", heading, re.I)) and bool(re.search(r"资产负债表|資產負債表|利润表|利潤表|損益表|balance sheet|statement.*(?:financial position|income|profit)", heading, re.I))
    for item in items:
        item.unit_scale = scale
        item.unit_unknown = ocr and scale is None
        item.unit = "元" if scale == 1 else "千元" if scale == 1000 else "万元" if scale == 10000 else "百万元" if scale == 1000000 else None
        item.statement = statement
        item.consolidated = statement and bool(re.search(r"合并|合併|consolidated", heading, re.I))


def finalize_units(items: list[LineItem]) -> None:
    """Never apply one page's unit to another page without its own declaration."""
    for item in items:
        if item.unit_scale is None:
            item.unit_unknown = True
