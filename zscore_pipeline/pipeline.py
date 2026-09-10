"""
pipeline.py — M1~M6 编排

M1 摄入分类：读取 SupplierProfile（行业/报告期/准则人工标注，P0-1 决议）。
M2 双通道提取：pdfplumber 电子文本 / GLM-4V-Flash OCR 扫描件。
M3 报表定位：合并口径优先 + 单位换算 + 年化因子。
M4 三级映射 + EBIT 推导。
M5 验证闸门。
M6 Z 计算（流量年化）。
"""
from __future__ import annotations

from pathlib import Path

from .m2_extract import extract_pdf
from .m2_extract_pptx import extract_pptx, detect_pptx_consolidated_slides, detect_pptx_unit_scale
from .m3_locate import detect_consolidated_pages, period_factor, detect_unit_scale
from .m4_map import resolve
from .m5_validate import run_gates
from .m6_calc import calc
from .models import SupplierProfile, IndustryClass, ExtractMethod
from .override import get_override, is_replace_mode, apply_overrides


def _is_pptx(path: str) -> bool:
    return path.lower().endswith((".pptx", ".ppt"))


def process(profile: SupplierProfile, file_path: str) -> dict:
    # —— 人工录入/修正 BS 数字 覆盖入口 ——
    # 若 profile 在 overrides.json 且 mode="replace"，则跳过自动提取（尤其 OCR），
    # 直接以人工数字构建，避免 QSP 等扫描件因 OCRUnavailable 被 cli 中止。
    ov = get_override(profile.name)
    if ov and is_replace_mode(ov):
        items, method, text_len = [], ExtractMethod.MANUAL, 0
        consolidated: set[int] = set()
        scale = 1.0
    elif _is_pptx(file_path):
        # PPTX 提取通道
        items, method, text_len = extract_pptx(file_path)
        consolidated = detect_pptx_consolidated_slides(file_path)
        scale = detect_pptx_unit_scale(file_path)
    else:
        # PDF 提取通道（默认）
        items, method, text_len = extract_pdf(file_path)
        consolidated = detect_consolidated_pages(file_path)
        scale = detect_unit_scale(file_path)

    # M4 映射 + EBIT
    ext = resolve(items, consolidated, profile.gaap, scale, profile.name, method)
    ext.raw_text_len = text_len

    # 应用人工覆盖（patch 模式在提取后覆盖；replace 模式在空提取后填充）
    if ov:
        ext = apply_overrides(ext, ov)

    # M5 闸门（模型感知）
    if profile.listed:
        model = "Z"
    else:
        is_mfg = profile.industry_class == IndustryClass.MANUFACTURING
        model = "Z'" if is_mfg else "Z''"
    passed, failed, notes = run_gates(ext, model)
    # M6 计算
    factor = period_factor(profile.period_type)
    zres = calc(profile, ext, factor)
    zres.gates_passed = passed
    zres.gates_failed = failed
    zres.notes = (zres.notes or []) + notes
    return {"profile": profile, "extraction": ext, "zscore": zres, "method": method}
