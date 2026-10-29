"""
m5_validate.py — 五道验证闸门

G1 复式平衡: |TA - (TL+EQ)| <= 1%·TA
G2 逻辑一致: CA<=TA, CL<=TL, EQ<=TA, RE<=TA
G3 数值合理: TA>0, TL>=0, 关键字段非空, 无非预期负值
G4 EBIT 交叉: |EBIT - (PBT+利息)| <= 1%（构造保证，作一致性复核）
G5 完整性: 8 字段齐全
"""
from __future__ import annotations

REQUIRED = ["current_assets", "current_liabilities", "total_assets",
            "total_liabilities", "equity_total", "retained_earnings",
            "revenue", "ebit"]


def run_gates(ext: "object", model: str | None = None) -> tuple[list[str], list[str], list[str]]:
    f = ext.fields
    passed, failed, notes = [], [], []

    def v(k):
        fv = f.get(k)
        return fv.value if fv else None

    TA, TL, EQ = v("total_assets"), v("total_liabilities"), v("equity_total")
    CA, CL, RE = v("current_assets"), v("current_liabilities"), v("retained_earnings")
    REV, EBIT = v("revenue"), v("ebit")
    PBT = v("profit_before_tax")
    INT = v("interest_expense")

    # G1 复式平衡
    def independent(keys):
        return all(k in f and not f[k].dependencies and f[k].method.value != 'derived' for k in keys)

    if not independent(['total_assets','total_liabilities','equity_total']):
        notes.append('G1_未独立验证：资产/负债/权益含推算或缺失值，不能用恒等式自证')
    elif None not in (TA, TL, EQ) and TA != 0:
        diff = abs(TA - (TL + EQ))
        if diff <= 0.01 * abs(TA):
            passed.append("G1_复式平衡")
        else:
            failed.append("G1_复式平衡")
            notes.append(f"TA={TA:,.0f} vs TL+EQ={TL+EQ:,.0f} (差 {diff:,.0f})")
    else:
        failed.append("G1_复式平衡")
        notes.append("TA/TL/EQ 缺失，无法校验")

    # G2 逻辑一致
    if None not in (CA, TA) and CA <= TA:
        passed.append("G2_CA<=TA")
    else:
        failed.append("G2_CA<=TA")
    if None not in (CL, TL) and CL <= TL:
        passed.append("G2_CL<=TL")
    else:
        failed.append("G2_CL<=TL")
    if None not in (EQ, TA) and EQ <= TA:
        passed.append("G2_EQ<=TA")
    else:
        failed.append("G2_EQ<=TA")
    if None not in (RE, TA) and RE <= TA:
        passed.append("G2_RE<=TA")
    else:
        failed.append("G2_RE<=TA")

    # G3 数值合理
    if TA is not None and TA > 0:
        passed.append("G3_TA>0")
    else:
        failed.append("G3_TA>0")
    if TL is not None and TL >= 0:
        passed.append("G3_TL>=0")
    else:
        failed.append("G3_TL>=0")

    # G4 EBIT 交叉
    if not independent(['ebit','profit_before_tax','interest_expense']):
        notes.append('G4_未独立验证：EBIT推导关系不作为独立交叉证据')
    elif None not in (EBIT, PBT, INT):
        expect = PBT + (INT if INT is not None else 0)
        if abs(EBIT - expect) <= 0.01 * max(abs(EBIT), 1):
            passed.append("G4_EBIT交叉")
        else:
            failed.append("G4_EBIT交叉")
            notes.append(f"EBIT={EBIT:,.0f} vs PBT+利息={expect:,.0f}")

    for key,parts in [('G6_净利润勾稽',['profit_before_tax','income_tax','net_profit']),
                      ('G7_资产分项勾稽',['current_assets','noncurrent_assets','total_assets']),
                      ('G8_负债分项勾稽',['current_liabilities','noncurrent_liabilities','total_liabilities'])]:
        if not independent(parts) or any(v(k) is None for k in parts):
            notes.append(key+'：缺少独立原始值，未验证')
            continue
        a,b,c=[v(k) for k in parts]
        expected=a-b if key.startswith('G6') else a+b
        (passed if abs(expected-c)<=max(.01,abs(c)*.001) else failed).append(key)
    # G5 完整性（模型感知：Z'' 为 4 因子，不依赖 revenue；Z / Z' 均需 revenue）
    required = [k for k in REQUIRED if not (model == "Z''" and k == "revenue")]
    missing = [k for k in required if v(k) is None]
    if not missing:
        passed.append("G5_完整性")
    else:
        failed.append("G5_完整性")
        notes.append(f"缺失字段: {missing}")

    from .audit import event
    event('validation.completed',passed=passed,failed=failed,notes=notes)
    return passed, failed, notes
