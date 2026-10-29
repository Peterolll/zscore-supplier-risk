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
import re

from .config import ANNUALIZE_FACTOR
from .models import PeriodType


def detect_consolidated_pages(pdf_path: str | Path) -> set[int]:
    """返回"合并报表"相关页码集合（优先口径）。"""
    with pdfplumber.open(str(pdf_path)) as pdf:
        return consolidated_pages_from_texts([page.extract_text() or "" for page in pdf.pages])


def consolidated_pages_from_texts(texts: list[str]) -> set[int]:
    cons: set[int] = set()
    in_cons = False
    for i, txt in enumerate(texts):
        heading = " ".join(txt.splitlines()[:8])
        if re.search(r"母公司|parent company|附注|附註|notes to", heading, re.I):
            in_cons = False
        elif re.search(r"合并(?:资产负债表|利润表|现金流量表)|合併(?:資產負債表|損益表|利潤表|現金流量表)|consolidated.*(?:statement|balance sheet)", heading, re.I):
            in_cons = True
        if in_cons:
            cons.add(i)
    return cons


def period_factor(period_type: PeriodType, flow_basis: str = "ytd") -> float:
    if flow_basis == "quarter" and period_type.value.startswith("q"):
        return 4.0
    return ANNUALIZE_FACTOR.get(period_type.value, 1)


def detect_unit_scale(pdf_path: str | Path) -> float:
    from .m2_extract import detect_unit_scale
    text = ""
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:  # 单个字段优先使用所在页的单位，此值仅作摘要
            text += page.extract_text() or ""
    return detect_unit_scale(text)
