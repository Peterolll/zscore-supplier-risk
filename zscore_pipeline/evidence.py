"""Deterministic selection and provenance, shared by native files and OCR."""
from __future__ import annotations
import re


def is_prior(column: str) -> bool:
    return bool(re.search(r'年初|期初|上期|上年|previous|prior|opening', column, re.I))


def select_column(headers: list[str]) -> int | None:
    current = [i for i,h in enumerate(headers) if i > 0 and not is_prior(h) and re.search(
        r'本期|期末|年末|本年|本季|current|this (?:year|period)|ending|金额|金額|amount', h, re.I)]
    if len(current) == 1:
        return current[0]
    if len(current) > 1:
        dated=[(i,tuple(map(int,m.groups()))) for i in current if (m:=re.search(r'(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})',headers[i]))]
        years=[(i,int(m.group())) for i in current if (m:=re.search(r'20\d{2}',headers[i]))]
        ranked=dated if len(dated)==len(current) else years if len(years)==len(current) else []
        if ranked:
            latest=max(value for _,value in ranked)
            matches=[i for i,value in ranked if value==latest]
            return matches[0] if len(matches)==1 else None
        return None
    dates=[(i,tuple(map(int,m.groups()))) for i,h in enumerate(headers) if i>0 and (m:=re.search(r'(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})',h))]
    if len(dates)>=2:
        latest=max(d for _,d in dates)
        matches=[i for i,d in dates if d==latest]
        return matches[0] if len(matches)==1 else None
    years = [(i, int(m.group())) for i,h in enumerate(headers) if i > 0 and (m := re.search(r'20\d{2}', h))]
    if years:
        latest = max(y for _,y in years)
        matches = [i for i,y in years if y == latest]
        return matches[0] if len(matches) == 1 else None
    return None


def source_of(item) -> dict:
    return {'formula':item.formula,'source_file': item.source_file, 'page': item.page, 'bbox': item.bbox,
            'coordinate_space': item.coordinate_space, 'rotation': item.rotation,
            'sheet': item.sheet, 'cell': item.cell, 'raw_label': item.label,
            'raw_value': item.raw_value, 'column': item.column, 'period': item.period,
            'unit': item.unit, 'unit_scale': item.unit_scale}
