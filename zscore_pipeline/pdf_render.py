"""pdf_render.py — 纯 Python 的 PDF 渲染工具（pypdfium2，无需 poppler）。

背景
----
原实现依赖外部程序 poppler（`pdftoppm` / `pdfinfo`）：

- Node 侧 `zscore-web/lib/ai-client.ts` 直接 `execFileSync("pdftoppm", ...)`
- Python 侧 `ocr_glm.py` 用 `pdf2image`（内部也是调 poppler）

这在 Windows 上是个硬门槛：poppler 不是系统自带，需要用户手动下载解压、配 PATH，
对非技术用户几乎不可能完成。而 `pdfplumber` 本身就依赖 `pypdfium2`（纯 Python 轮子，
自带 PDFium 二进制，无外部依赖），所以本项目**天然已有可用的渲染器**。

本模块把它封装成统一入口，供 Python 与 Node 两侧共用，从而彻底去掉 poppler 依赖。

除渲染外，本模块还提供**文本提取**（替代 poppler 的 `pdftotext`），
供 Node 侧 AI 分析通路取全文用 —— 同样是为了彻底去掉 poppler。

CLI（stdout 只输出一行 JSON，便于 Node 侧解析；异常走 stderr + 非零退出码）
------------------------------------------------------------------------
    meta  <pdf>                                              → 页数与首页尺寸
    pages <pdf> <maxPages|all> <dpi> <outDir>                → 整页渲染，逐页写 PNG
    crop  <pdf> <x%> <y%> <w%> <h%> <dpi> <page> <outPng>    → 按百分比裁切渲染
    text  <pdf>                                              → 提取全文

坐标系约定
----------
- 对外暴露的页尺寸单位是 **PDF 点（pt, 72 DPI）**，与 `pdfinfo` 的 "Page size" 一致。
- `crop` 的百分比是**相对整页**的 0..1 比例，原点在左上。
- 渲染像素 = 点 × dpi / 72。
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

# pypdfium2 随 pdfplumber 一起安装（pdfplumber 的硬依赖），正常不会缺失
try:
    import pypdfium2 as pdfium
except ImportError as exc:  # pragma: no cover - 环境缺依赖时的兜底提示
    sys.stderr.write(
        "缺少 pypdfium2。请执行：pip install -r requirements.txt\n"
        f"（原始错误：{exc}）\n"
    )
    raise SystemExit(2)


def _round_half_up(x: float) -> int:
    """与 JavaScript 的 Math.round 对齐（四舍五入，不是 Python 的银行家舍入）。"""
    return int(math.floor(x + 0.5))


def _open(pdf_path: str | Path) -> "pdfium.PdfDocument":
    doc = pdfium.PdfDocument(str(pdf_path))
    if len(doc) == 0:
        raise ValueError(f"PDF 没有任何页面：{pdf_path}")
    return doc


def page_meta(pdf_path: str | Path) -> dict:
    """页数与首页尺寸（pt）。字段名与 Node 侧 PdfMeta 对齐。"""
    doc = _open(pdf_path)
    try:
        w_pt, h_pt = doc[0].get_size()
        page_count = len(doc)
    finally:
        doc.close()
    return {
        "pageCount": page_count,
        "pageW": _round_half_up(w_pt),
        "pageH": _round_half_up(h_pt),
    }


def render_pages(
    pdf_path: str | Path,
    max_pages: int | None = 5,
    dpi: int = 150,
    out_dir: str | Path | None = None,
) -> list[str]:
    """整页渲染为 PNG，返回文件路径列表。

    max_pages=None 或 <=0 表示渲染全部页（扫描件 OCR 需要整份文档）。
    """
    doc = _open(pdf_path)
    target = Path(out_dir) if out_dir else Path(".")
    target.mkdir(parents=True, exist_ok=True)

    scale = dpi / 72.0
    n = len(doc) if (max_pages is None or max_pages <= 0) else min(len(doc), max_pages)
    written: list[str] = []
    try:
        for i in range(n):
            img = doc[i].render(scale=scale).to_pil()
            p = target / f"page_{i + 1:03d}.png"
            img.save(p, "PNG")
            written.append(str(p))
    finally:
        doc.close()
    return written


def render_crop(
    pdf_path: str | Path,
    x_pct: float,
    y_pct: float,
    w_pct: float,
    h_pct: float,
    dpi: int = 400,
    page: int = 1,
    out_png: str | Path | None = None,
) -> dict:
    """按整页百分比裁切并渲染为 PNG。

    实现要点：pypdfium2 的 `crop` 参数是「从各边**裁掉**多少点」，而不是绝对坐标。
    因此需要先把「左上原点的 百分比矩形」换算成四边裁切量，再交给渲染器。

    这样做只在目标区域上渲染（不整页渲染后裁剪），显存与耗时都更省，
    对 400 DPI 的财报整页尤其明显。
    """
    if out_png is None:
        raise ValueError("必须提供 out_png 输出路径")

    doc = _open(pdf_path)
    try:
        idx = max(1, page) - 1
        if idx >= len(doc):
            raise ValueError(f"页码 {page} 超出范围（共 {len(doc)} 页）")
        pdf_page = doc[idx]
        page_w, page_h = pdf_page.get_size()

        # 百分比 → 四边裁切量（左, 下, 右, 上）
        x = min(max(x_pct, 0.0), 1.0)
        y = min(max(y_pct, 0.0), 1.0)
        w = min(max(w_pct, 0.0), 1.0 - x) if w_pct > 0 else 1.0 - x
        h = min(max(h_pct, 0.0), 1.0 - y) if h_pct > 0 else 1.0 - y

        cut_left = x * page_w
        cut_top = y * page_h
        cut_right = max(0.0, (1.0 - x - w) * page_w)
        cut_bottom = max(0.0, (1.0 - y - h) * page_h)

        scale = dpi / 72.0
        bitmap = pdf_page.render(
            scale=scale,
            crop=(cut_left, cut_bottom, cut_right, cut_top),
        )
        img = bitmap.to_pil()

        out = Path(out_png)
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, "PNG")
    finally:
        doc.close()

    return {
        "ok": True,
        "path": str(out),
        "width": img.size[0],
        "height": img.size[1],
        "pageW": _round_half_up(page_w),
        "pageH": _round_half_up(page_h),
    }


def extract_text(pdf_path: str | Path) -> str:
    """提取 PDF 全文（替代 poppler 的 `pdftotext -layout`）。

    用 pdfplumber（本项目主流水线用的同一个库）。页面之间用换页符 \\f 分隔，
    与 pdftotext 的行为保持一致，避免下游 prompt 出现非预期变化。

    pdfplumber 较重（导入约 1 秒），所以在此函数内部惰性导入 —— 渲染类命令
    （meta / pages / crop）因此不必付这份开销。
    """
    import pdfplumber  # 惰性导入：只有取文本时才需要

    chunks: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            try:
                text = page.extract_text(layout=True) or ""
            except Exception:  # noqa: BLE001 - 单页失败不应中断整份文档
                text = ""
            chunks.append(text)
    return "\f".join(chunks)


# ──────────────────────────── CLI ────────────────────────────

def _usage() -> str:
    return (
        "用法：\n"
        "  python -m zscore_pipeline.pdf_render meta  <pdf>\n"
        "  python -m zscore_pipeline.pdf_render pages <pdf> <maxPages|all> <dpi> <outDir>\n"
        "  python -m zscore_pipeline.pdf_render crop  <pdf> <x%> <y%> <w%> <h%> <dpi> <page> <outPng>\n"
        "  python -m zscore_pipeline.pdf_render text  <pdf>\n"
    )


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write(_usage())
        return 2

    cmd = argv[1]
    try:
        if cmd == "meta":
            if len(argv) != 3:
                sys.stderr.write(_usage())
                return 2
            result = page_meta(argv[2])

        elif cmd == "pages":
            if len(argv) != 6:
                sys.stderr.write(_usage())
                return 2
            raw_max = argv[3].strip().lower()
            max_pages = None if raw_max in ("all", "0", "-1") else int(raw_max)
            files = render_pages(
                argv[2],
                max_pages=max_pages,
                dpi=int(argv[4]),
                out_dir=argv[5],
            )
            result = {"files": files}

        elif cmd == "crop":
            if len(argv) != 10:
                sys.stderr.write(_usage())
                return 2
            result = render_crop(
                argv[2],
                x_pct=float(argv[3]),
                y_pct=float(argv[4]),
                w_pct=float(argv[5]),
                h_pct=float(argv[6]),
                dpi=int(argv[7]),
                page=int(argv[8]),
                out_png=argv[9],
            )

        elif cmd == "text":
            if len(argv) != 3:
                sys.stderr.write(_usage())
                return 2
            result = {"text": extract_text(argv[2])}

        else:
            sys.stderr.write(f"未知命令：{cmd}\n{_usage()}")
            return 2

    except Exception as exc:  # 统一把异常变成 stderr + 退出码，避免污染 stdout
        sys.stderr.write(f"pdf_render 失败（{cmd}）：{exc.__class__.__name__}: {exc}\n")
        return 1

    # stdout 只输出一行 JSON
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
