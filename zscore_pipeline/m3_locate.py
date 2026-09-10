"""
m3_locate.py — 报表定位

职责：
- 合并/母公司报表区分：检测"合并资产负债表/合并利润表"所在页码，优先合并口径。
- 报告期年化因子：由 SupplierProfile.period_type 驱动（P0-1 人工标注）。
- 单位检测：识别 元/千元/万元 → 换算因子。
"""
from __future__ import annotations
from pathlib import Path

import pdfplumber

from .config import ANNUALIZE_FACTOR
from .models import PeriodType


def detect_consolidated_pages(pdf_path: str | Path) -> set[int]:
    """返回"合并报表"相关页码集合（优先口径）。"""
    cons: set[int] = set()
    in_cons = False
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i, page in enumerate(pdf.pages):
            txt = page.extract_text() or ""
            if any(k in txt for k in ["母公司资产负债表", "母公司利润表", "母公司现金流量表"]):
                in_cons = False
            if any(k in txt for k in ["合并资产负债表", "合并利润表", "合并现金流量表"]):
                in_cons = True
            if in_cons:
                cons.add(i)
    return cons


def period_factor(period_type: PeriodType) -> float:
    return ANNUALIZE_FACTOR.get(period_type.value, 1)


def detect_unit_scale(pdf_path: str | Path) -> float:
    from .m2_extract import detect_unit_scale
    text = ""
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages[:10]:  # 单位通常在前 10 页
            text += page.extract_text() or ""
    return detect_unit_scale(text)
