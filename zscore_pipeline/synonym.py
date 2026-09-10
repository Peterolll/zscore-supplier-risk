"""
synonym.py — 三级映射的 L1 词典 + 标签匹配

覆盖：繁中 / 简中 / 英文 / 双语。CAS 特殊规则在此体现：
- 留存收益：繁中"保留盈餘"单字段；简中 CAS 拆为"盈余公积"+"未分配利润"两行 → 求和。
- 利息费用：简中 CAS 嵌套于"财务费用 — 其中：利息费用"子行，母行"财务费用"不可用。
"""
from __future__ import annotations
import json
from pathlib import Path

# 规范字段 → 别名（含繁/简/英）。匹配时做归一化（去空格、小写英文、去标点）。
#
# 重要：本字典已外部化为 zscore_pipeline/dict/synonyms.json（网页端可查看/编辑的唯一数据源）。
# 此处保留与历史硬编码完全一致的「内置默认」，仅在外部 JSON 缺失/损坏时回退，保证向后兼容。
_DEFAULT_SYNONYMS: dict[str, list[str]] = {
    "current_assets": ["流動資產合計", "流动资产合计", "current assets", "current_assets",
                       "現金及銀行結存", "现金及银行结存", "銀行結存", "银行结存", "現金及現金等價物", "现金及现金等价物"],
    "current_liabilities": ["流動負債合計", "流动负债合计", "current liabilities", "current_liab"],
    "total_assets": ["資產總計", "资产总计", "total assets", "total_asset"],
    "total_liabilities": ["負債總計", "负债总计", "负债合计", "負債合計", "total liabilities", "total_liabilit"],
    "equity_total": ["權益總額", "权益总额", "權益總計", "所有者权益合计", "所有者权益（或股东权益）合计", "所有者权益(或股东权益)合计", "total equity", "equity attributable"],
    # 留存收益（繁中单字段）
    "retained_earnings": ["保留盈餘", "保留盈余", "retained earnings", "retained profit",
                          "派發溢利/累積虧損", "派发溢利/累积亏损", "累積虧損", "累积亏损", "累計虧損", "累计亏损"],
    # 留存收益（简中 CAS 两行拆分）
    "re_retained_surplus": ["盈余公積", "盈余公积", "surplus reserve", "surplus reserve fund"],
    "re_undistributed": ["未分配利潤", "未分配利润", "undistributed profit", "retained profit distributable"],
    # 税前利润（用于 EBIT 推导）
    "profit_before_tax": ["稅前淨利", "税前净利", "利润总额", "profit before tax", "pretax profit", "profit before taxation",
                          "期間溢利/(虧損)", "期间溢利/(亏损)", "溢利/(虧損)", "溢利/(亏损)", "除稅前溢利", "除税前溢利"],
    # 利息费用：CAS 优先匹配"其中：利息费用"嵌套子行
    "interest_expense": ["其中：利息费用", "其中:利息费用", "利息費用", "利息费用", "interest expense", "interest paid"],
    # 营业收入（流量，需年化）
    "revenue": ["營業收入淨額", "營業總收入", "營業收入", "营业总收入", "营业收入", "revenue", "turnover", "sales revenue", "total revenue",
                "營業額", "营业额"],
}

_DEFAULT_EQUITY_INCL_MINORITY: list[str] = [
    "所有者权益合计", "權益總計", "equity attributable to owners of parent and non-controlling interests"
]

# v2 内置默认指标树（外部 dict/synonyms.json 的 FIELD_TREE 缺失时回退）。
# 结构：字段 → {components: {子指标名: [别名...]}}
_DEFAULT_FIELD_TREE: dict[str, dict] = {
    "current_assets": {"components": {
        "货币资金": ["货币资金", "貨幣資金", "库存现金", "银行存款"],
        "交易性金融资产": ["交易性金融资产", "短期投资"],
        "应收票据": ["应收票据"], "应收账款": ["应收账款"],
        "预付款项": ["预付款项", "预付账款"],
        "其他应收款": ["其他应收款"], "存货": ["存货"],
        "其他流动资产": ["其他流动资产"],
    }},
    "current_liabilities": {"components": {
        "短期借款": ["短期借款"], "应付票据": ["应付票据"], "应付账款": ["应付账款"],
        "预收及合同负债": ["预收账款", "预收款项", "合同负债"],
        "应付职工薪酬": ["应付职工薪酬"], "应交税费": ["应交税费", "应付税项"],
        "应付利息": ["应付利息"], "应付股利": ["应付股利", "应付利润"],
        "其他应付款": ["其他应付款", "应付费用", "应付关联公司款项"],
        "一年内到期的非流动负债": ["一年内到期的非流动负债"],
        "其他流动负债": ["其他流动负债"],
    }},
    "total_assets": {"components": {
        "流动资产": ["流动资产合计"], "非流动资产": ["非流动资产合计"],
    }},
    "total_liabilities": {"components": {
        "流动负债": ["流动负债合计"], "非流动负债": ["非流动负债合计", "长期负债合计"],
    }},
    "equity_total": {"components": {
        "实收资本": ["实收资本", "股本"], "资本公积": ["资本公积"],
        "盈余公积": ["盈余公积"], "未分配利润": ["未分配利润"],
    }},
    "retained_earnings": {"components": {
        "盈余公积": ["盈余公积"], "未分配利润": ["未分配利润"],
    }},
}

# 外部数据字典：网页端可查看/编辑的唯一数据源
_DICT_PATH = Path(__file__).resolve().parent / "dict" / "synonyms.json"


def _load_dict() -> tuple[dict, list, dict]:
    """优先加载外部 dict/synonyms.json（v2 含 FIELD_TREE）；缺失/损坏时回退到内置默认。"""
    if _DICT_PATH.exists():
        try:
            data = json.loads(_DICT_PATH.read_text(encoding="utf-8"))
            syn = data.get("SYNONYMS") or _DEFAULT_SYNONYMS
            eq = data.get("EQUITY_INCL_MINORITY") or _DEFAULT_EQUITY_INCL_MINORITY
            tree = data.get("FIELD_TREE") or _DEFAULT_FIELD_TREE
            return syn, eq, tree
        except Exception:
            pass
    return _DEFAULT_SYNONYMS, _DEFAULT_EQUITY_INCL_MINORITY, _DEFAULT_FIELD_TREE


SYNONYMS, EQUITY_INCL_MINORITY, FIELD_TREE = _load_dict()


def normalize(label: str) -> str:
    import re
    s = label.strip().lower()
    s = s.replace(" ", "").replace(" ", "")
    # 去掉冒号/点/顿号/逗号；保留全角括号（）交由 strip_paren 处理（用于利润表"（亏损…）"等描述）
    s = re.sub(r"[：:．.、,]", "", s)
    return s


def build_index() -> dict[str, str]:
    """归一化别名 → 规范字段名"""
    idx: dict[str, str] = {}
    for field, aliases in SYNONYMS.items():
        for a in aliases:
            idx[normalize(a)] = field
    return idx


_INDEX = build_index()


def match_field(label: str) -> str | None:
    """返回规范字段名。

    匹配策略（由严到松）：
    1. 利息费用优先（CAS 规则）：标签含"利息费用" → interest_expense
       （避免误命中"其中，租赁利息支出"/"利息收入"）
    2. 精确归一化匹配
    3. 受限包含匹配：别名出现在标签中间也允许，但
       前缀仅可为枚举符/标点（否决 非/减/其中/母公司/归属于 等改写语义的前缀），
       后缀仅可为括号/标点（如"三、利润总额（亏损…）"）
    4. 空格分隔的合并标签（双列 BS 布局）：pdfplumber 把左右两列科目名合并到同一行
       （如"长期股权投资 负债合计"），按空格分段后逐段尝试步骤 1-3
    """
    n = normalize(label)
    # 1) 利息费用优先
    if "利息费用" in n:
        return "interest_expense"
    # 2) 精确匹配
    if n in _INDEX:
        return _INDEX[n]
    # 3) 受限包含匹配
    result = _try_contained_match(n)
    if result:
        return result
    # 4) 空格分隔的合并标签（双列 BS 布局）
    parts = label.split()
    if len(parts) >= 2:
        for part in parts:
            pn = normalize(part)
            if "利息费用" in pn:
                return "interest_expense"
            if pn in _INDEX:
                return _INDEX[pn]
            r = _try_contained_match(pn)
            if r:
                return r
    return None


def _try_contained_match(n: str) -> str | None:
    """受限包含匹配：别名出现在标签中间，前缀仅枚举符/标点，后缀仅括号/标点。"""
    for alias_norm, field in _INDEX.items():
        if not alias_norm or len(alias_norm) < 2:
            continue
        idx = n.find(alias_norm)
        if idx < 0:
            continue
        prefix = n[:idx]
        suffix = n[idx + len(alias_norm):]
        if strip_enum(prefix) == "" and strip_paren(suffix) == "":
            return field
    return None


# ---- v2 指标树：子指标匹配（L2 求和用）----

def build_component_index() -> dict[str, list[tuple[str, str]]]:
    """归一化组件别名 → [(字段, 组件名), ...]。

    一个标签可属于多个字段的子指标：
    如「盈余公积」∈ equity_total.盈余公积 ∧ retained_earnings.盈余公积；
    「流动资产合计」∈ total_assets.流动资产（同时它自身是 current_assets 的 direct）。
    """
    idx: dict[str, list[tuple[str, str]]] = {}
    for field, spec in (FIELD_TREE or {}).items():
        for comp, aliases in (spec.get("components") or {}).items():
            for a in aliases:
                idx.setdefault(normalize(a), []).append((field, comp))
    return idx


_COMPONENT_INDEX = build_component_index()


def match_component(label: str) -> list[tuple[str, str]]:
    """返回标签命中的 [(字段, 组件名), ...]（可为空列表 = 未命中任何子指标）。

    匹配策略与 match_field 一致：精确 → 受限包含（前缀仅枚举符、后缀仅括号）。
    额外：空格分隔的合并标签（双列 BS 布局）按分段逐段匹配。
    """
    n = normalize(label)
    out: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def _collect(norm_label: str):
        if norm_label in _COMPONENT_INDEX:
            for t in _COMPONENT_INDEX[norm_label]:
                if t not in seen:
                    seen.add(t)
                    out.append(t)
        for alias_norm, targets in _COMPONENT_INDEX.items():
            if not alias_norm or len(alias_norm) < 2:
                continue
            idx = norm_label.find(alias_norm)
            if idx < 0:
                continue
            prefix = norm_label[:idx]
            suffix = norm_label[idx + len(alias_norm):]
            if strip_enum(prefix) == "" and strip_paren(suffix) == "":
                for t in targets:
                    if t not in seen:
                        seen.add(t)
                        out.append(t)

    _collect(n)
    # 空格分隔的合并标签（双列 BS 布局）
    if not out:
        parts = label.split()
        if len(parts) >= 2:
            for part in parts:
                _collect(normalize(part))
    return out


def suggest_field_for_gap(label: str) -> tuple[str | None, str | None]:
    """字典自审闭环用：为「未识别科目」建议归属 (字段, 类型)。

    返回 (field, kind)：
    - 含「合计/总计」→ 可能为某存量字段的小计新别名 → kind="direct"
    - 与现有组件别名近似（受限包含反向：别名包含在标签中）→ (field, "component")
    - 其余 → (None, None)
    """
    n = normalize(label)
    if any(k in n for k in ("合计", "合計", "总计", "總計")):
        # 找语义最近的 direct 字段：标签含字段 label 关键词
        for field, spec in (FIELD_TREE or {}).items():
            lab = spec.get("label", "")
            if lab and (normalize(lab) in n or n in normalize(lab)):
                return field, "direct"
        return None, "direct"
    for alias_norm, targets in _COMPONENT_INDEX.items():
        if len(alias_norm) >= 2 and (alias_norm in n or n in alias_norm):
            return targets[0][0], "component"
    return None, None


_ENUM = "一二三四五六七八九十、.．（）()①②③④⑤⑥⑦⑧⑨"

import re as _re


def strip_enum(s: str) -> str:
    """去掉开头的枚举符/标点，用于受限匹配前缀判定。"""
    changed = True
    while changed and s:
        changed = False
        for e in _ENUM:
            if s.startswith(e):
                s = s[len(e):]
                changed = True
                break
    return s


def strip_paren(s: str) -> str:
    """去掉括号及其内容 + 残余标点/货币符号，用于受限匹配后缀判定。

    支持嵌套括号（如 "營業收入淨額(附註六(二十一)及七)"）：
    迭代剥离最内层括号对，直到无括号残留。
    """
    # 迭代剥离最内层括号（兼容半角/全角、嵌套）
    prev = None
    while prev != s:
        prev = s
        s = _re.sub(r"\([^()]*\)", "", s)     # 半角嵌套
        s = _re.sub(r"（[^（）]*）", "", s)     # 全角嵌套
    s = _re.sub(r"[、。．.，,:\-－%$（）()\s$¥£€NTUSD]", "", s)
    return s
