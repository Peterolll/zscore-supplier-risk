"""
m6_calc.py — Z-Score 计算（含流量年化）

仅对流量字段(EBIT, 营收)按 annualize_factor 年化；存量字段不年化。
- 非上市：行业决定 Z' / Z''（X4 用股东权益账面值 / 总负债）。
- 上市：统一原始 Altman Z（X4 用股权市值 / 总负债），与行业无关，恒为 5 因子。
"""
from __future__ import annotations

from .config import (
    Z_PRIME_COEF, Z_DOUBLE_PRIME_COEF, Z_ORIGINAL_COEF,
    Z_PRIME_THRESHOLD, Z_DOUBLE_THRESHOLD, Z_ORIGINAL_THRESHOLD,
)
from .models import SupplierProfile, ExtractionResult, ZScoreResult, IndustryClass


def _zone(z: float, thr: dict) -> str:
    if z > thr["safe"]:
        return "safe"
    if z > thr["grey"]:
        return "grey"
    return "distress"


def calc(profile: SupplierProfile, ext: ExtractionResult, factor: float) -> ZScoreResult:
    f = ext.fields

    def v(k):
        fv = f.get(k)
        return fv.value if fv else None

    CA, CL = v("current_assets"), v("current_liabilities")
    TA, TL = v("total_assets"), v("total_liabilities")
    RE, EQ = v("retained_earnings"), v("equity_total")
    REV, EBIT = v("revenue"), v("ebit")

    # 流量年化（仅 EBIT / 营收）
    # 修复 Bug：原 (EBIT or 0) 将缺失(None)当 0 → X3/X5=0 而非 None，Z 被静默扭曲。
    # 现改为：缺失保持 None，safe_div 返回 None → 计入阶段跳过并在 notes 标注缺失。
    ebit_ann = EBIT * factor if EBIT is not None else None
    rev_ann = REV * factor if REV is not None else None
    annualized = factor != 1.0

    is_mfg = profile.industry_class == IndustryClass.MANUFACTURING
    listed = bool(profile.listed)

    if listed:
        # 上市公司 → 原始 Altman Z（5 因子，X4 用股权市值 / 总负债）
        coef = Z_ORIGINAL_COEF
        model = "Z"
        # 股权价值：优先 profile.equity_value；缺失时回退账面权益并标注
        eq_val = profile.equity_value
        eq_source = "市值(上市)"
        if eq_val is None:
            eq_val = EQ
            eq_source = "账面权益(市值缺失回退)"
    else:
        # 非上市 → Z' / Z''
        coef = Z_PRIME_COEF if is_mfg else Z_DOUBLE_PRIME_COEF
        model = "Z'" if is_mfg else "Z''"
        eq_val = EQ
        eq_source = "账面权益(非上市)"

    # 防御：除零 / 空值
    def safe_div(a, b):
        if a is None or b is None:
            return None
        if b == 0:
            return None
        return a / b

    # 修复：原 (CA or 0) - (CL or 0) 会把缺失的单项当 0 → X1 被算成 -CL/TA 或 CA/TA 的
    # 伪值（表面有数、实际少了一半营运资本）。缺任一项即视为不可计算，保持 None。
    wc = (CA - CL) if (CA is not None and CL is not None) else None
    X1 = safe_div(wc, TA)
    X2 = safe_div(RE, TA)
    X3 = safe_div(ebit_ann, TA)
    X4 = safe_div(eq_val, TL)
    X5 = safe_div(rev_ann, TA)

    # 计入项：原始 Z 与非上市制造业 Z' 均 5 因子；非上市非制造业 Z'' 为 4 因子
    required = ["X1", "X2", "X3", "X4"]
    if model in ("Z", "Z'"):
        required.append("X5")
    term_notes = []
    xs = {"X1": X1, "X2": X2, "X3": X3, "X4": X4}
    if model in ("Z", "Z'"):
        xs["X5"] = X5

    available = [n for n in required if xs.get(n) is not None]
    for name in required:
        if xs.get(name) is None:
            term_notes.append(f"{name} 缺失（对应字段未提取）→ 未计入 Z")

    # 关键修复：所有计入因子都缺失时，Z 不可计算。
    # 原实现会返回 z=0.0 并被 _zone 判为 "distress" —— 把"完全没数据"
    # 静默误报成"高风险"，是信贷场景最危险的失效模式。
    # 现改为：z_score=None、risk_zone="unknown"，前端显示"数据不足(不可计算)"。
    if not available:
        return ZScoreResult(
            profile_name=profile.name, model=model,
            X1=X1, X2=X2, X3=X3, X4=X4, X5=X5,
            z_score=None, risk_zone="unknown",
            annualized=annualized, annualize_factor=factor,
            notes=([f"流量年化因子={factor}（仅 EBIT/营收）"] if annualized else [])
                  + [f"X4 分子口径：{eq_source}"]
                  + ["Z 不可计算：全部计入因子均缺失，请补充财报字段或改用 AI 补全"]
                  + term_notes,
        )

    z = 0.0
    for name in required:
        val = xs.get(name)
        if val is None:
            continue
        z += coef[name] * val

    if model == "Z":
        thr = Z_ORIGINAL_THRESHOLD
    elif model == "Z'":
        thr = Z_PRIME_THRESHOLD
    else:
        thr = Z_DOUBLE_THRESHOLD

    notes_extra = []
    if listed and profile.equity_value is None:
        notes_extra.append(f"X4 分子为股东权益账面值近似（{eq_source}）；上市原始 Z 应使用股权市值，请补录")

    return ZScoreResult(
        profile_name=profile.name, model=model,
        X1=X1, X2=X2, X3=X3, X4=X4, X5=X5,
        z_score=z, risk_zone=_zone(z, thr),
        annualized=annualized, annualize_factor=factor,
        notes=([f"流量年化因子={factor}（仅 EBIT/营收）"] if annualized else [])
              + [f"X4 分子口径：{eq_source}"] + notes_extra + term_notes,
    )
