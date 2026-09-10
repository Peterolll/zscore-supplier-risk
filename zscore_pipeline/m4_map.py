"""
m4_map.py — 指标树三级抓取链 + EBIT 推导

v2 架构（2026-08-19）：
  L1 小计直抓    direct 别名命中「合计/总计」小计行 → 单值 conf=1.0
                 校验：小计值必须 >= 该字段任一子指标分量，否则疑抓错列 → 降级 L2
  L2 子指标求和  FIELD_TREE.components 逐组件取代表值求和 conf=0.85（覆盖率<50% 时 0.7）
                 evidence 列出各分量与覆盖率
  L3 恒等式反推  TL=TA−EQ / EQ=TA−TL / TA=TL+EQ / CL=TL−非流动负债 / CA=TA−非流动资产
                 conf=0.7，method=derived，标注「推算待确认」
  兜底 null      → warnings + Web 端人工补录

前置 sanitize（OCR 防误抓）：
  纯整数值 ∈ [1,999] 且同报表存在 >=10 万量级值 → 判为「序号/行次」列误抓，剔除。

流量字段（revenue / profit_before_tax / interest_expense）仍走 pick（最晚页 + table 优先）。
EBIT 决策树：
  EBIT = 利润总额(PBT) + 利息费用（有利息 → conf 1.0；无利息 → EBIT=PBT conf 0.9）
"""
from __future__ import annotations
from .m2_extract import LineItem
from .synonym import normalize, FIELD_TREE, match_field, match_component
from .models import ExtractionResult, FieldValue, ExtractMethod, Gaap, SupplierProfile

_BS_FIELDS = ["current_assets", "current_liabilities", "equity_total",
              "retained_earnings", "total_assets", "total_liabilities"]
_FLOW_FIELDS = ["revenue", "profit_before_tax", "interest_expense"]
_LIAB_FIELDS = {"current_liabilities", "total_liabilities"}
_SUBTOTAL_KW = ["合计", "總計", "总计", "total", "subtotal", "合計"]


def parse_number(s: str, scale: float = 1.0) -> float | None:
    s = s.strip()
    # 半角 () 或全角 （） 均视为负数
    neg = (s.startswith("(") and s.endswith(")")) or \
          (s.startswith("（") and s.endswith("）"))
    s = s.replace("(", "").replace(")", "").replace("（", "").replace("）", "")
    s = s.replace(",", "").replace("%", "")
    if neg:
        s = s.replace("—", "").replace("-", "")
    else:
        s = s.replace("—", "")
    try:
        v = float(s)
    except ValueError:
        return None
    v *= scale
    return -v if neg else v


def resolve(line_items: list[LineItem], consolidated_pages: set[int],
            gaap: Gaap, scale: float, profile_name: str,
            method: ExtractMethod) -> ExtractionResult:
    warnings: list[str] = []

    # ---- 0) 双通道候选收集：direct（小计） + component（子指标） ----
    cand_direct: dict[str, list] = {}
    cand_comp: dict[tuple[str, str], list] = {}
    for it in line_items:
        v = parse_number(it.raw_value, scale)
        if v is None:
            continue
        f = match_field(it.label)
        if f:
            cand_direct.setdefault(f, []).append((v, it.page, it.label, it.method, it.source))
        for ff, cc in match_component(it.label):
            cand_comp.setdefault((ff, cc), []).append((v, it.page, it.label, it.method, it.source))

    # ---- 1) sanitize：序号/行次列防误抓 ----
    all_vals = [x[0] for lst in list(cand_direct.values()) + list(cand_comp.values()) for x in lst]
    has_big = any(abs(v) >= 100_000 for v in all_vals)

    def is_rownum(v: float) -> bool:
        return has_big and float(v) == int(v) and 1 <= v <= 999

    dropped = 0
    for d in (cand_direct, cand_comp):
        for k in list(d.keys()):
            kept = [x for x in d[k] if not is_rownum(x[0])]
            dropped += len(d[k]) - len(kept)
            if kept:
                d[k] = kept
            else:
                del d[k]
    if dropped:
        warnings.append(f"序号防误抓：剔除 {dropped} 个疑似行号候选（纯整数 1-999）")

    # ---- 候选预处理：table 优先（双列报表本期列）→ 合并口径 → 去重 → 按页排序 ----
    def _prep(lst: list) -> list:
        table_lst = [x for x in lst if x[4] == "table"]
        if table_lst:
            lst = table_lst
        if consolidated_pages:
            c = [x for x in lst if x[1] in consolidated_pages]
            if c:
                lst = c
        seen: set = set()
        dedup = []
        for x in lst:
            key = (x[2], round(x[0], 2))
            if key in seen:
                continue
            seen.add(key)
            dedup.append(x)
        dedup.sort(key=lambda x: x[1])
        return dedup

    def pick(field: str):
        """流量字段：单值选择（最晚页候选）。"""
        lst = _prep(cand_direct.get(field, []))
        return lst[-1] if lst else None

    def comp_value(field: str, comp: str) -> float | None:
        """某字段某子指标的代表值（最晚页候选）。"""
        lst = _prep(cand_comp.get((field, comp), []))
        return lst[-1][0] if lst else None

    # ---- 2) 存量字段 L1 + L2 ----
    def resolve_bs(field: str) -> tuple[FieldValue, str] | tuple[None, None]:
        comp_def = (FIELD_TREE.get(field) or {}).get("components") or {}
        comp_vals: dict[str, tuple[float, str]] = {}
        for (ff, cc) in cand_comp:
            if ff != field:
                continue
            prepped = _prep(cand_comp[(ff, cc)])
            if prepped:
                rep = prepped[-1]
                comp_vals[cc] = (rep[0], rep[2])

        # TA/TL 的「流动部分」组件回退：引用已解析的 CA/CL（先解析 CA/CL，后 TA/TL）
        if field == "total_assets" and "流动资产" not in comp_vals \
                and "current_assets" in fields and fields["current_assets"].value is not None:
            comp_vals["流动资产"] = (fields["current_assets"].value, "流动资产合计(引用CA)")
        if field == "total_liabilities" and "流动负债" not in comp_vals \
                and "current_liabilities" in fields and fields["current_liabilities"].value is not None:
            comp_vals["流动负债"] = (fields["current_liabilities"].value, "流动负债合计(引用CL)")

        max_comp = max((v for v, _ in comp_vals.values()), default=None)

        # L1：direct 直抓（v2 字典中 SYNONYMS 仅含字段本体行，明细已移入组件树，
        #     故 direct 命中即目标行，取最晚页候选；不再要求「合计」关键词）
        lst = _prep(cand_direct.get(field, []))
        if lst:
            s = lst[-1]
            if max_comp is not None and s[0] < max_comp:
                warnings.append(
                    f"{field} 直抓值({s[0]:,.2f}) < 明细分量({max_comp:,.2f})，疑抓错列，改用明细求和")
            else:
                val = s[0]
                if field in _LIAB_FIELDS and val < 0:
                    val = -val
                    warnings.append(f"{field} 原始为负（信贷列示），取绝对值为负债")
                return FieldValue(value=val, method=s[3], source_page=s[1],
                                  evidence=s[2], confidence=1.0), "L1"

        # L2：子指标求和
        if comp_vals:
            total = sum(v for v, _ in comp_vals.values())
            cov = len(comp_vals) / max(len(comp_def), 1)
            ev = " + ".join(f"{lab}({v:,.2f})" for v, lab in comp_vals.values())
            if len(ev) > 220:
                ev = ev[:220] + "…"
            note = f"（明细求和 {len(comp_vals)}/{len(comp_def)} 项，覆盖率 {cov:.0%}）"
            # 小企业报表常只列少数非零负债科目（如 5/12≈42% 属常态），25% 以上即可信
            conf = 0.85 if cov >= 0.25 else 0.7
            if cov < 0.5:
                warnings.append(f"{field} 明细覆盖率 {cov:.0%}，求和可能低估，请人工核对")
            return FieldValue(value=total, method=ExtractMethod.DERIVED, source_page=None,
                              evidence=ev + note, confidence=conf), "L2"
        return None, None

    fields: dict[str, FieldValue] = {}
    level_log: dict[str, str] = {}
    for fld in _BS_FIELDS:
        fv, level = resolve_bs(fld)
        if fv:
            fields[fld] = fv
            level_log[fld] = level

    # ---- 3) L3 恒等式反推（在 L1/L2 之后统一执行）----
    def val(f: str) -> float | None:
        return fields[f].value if f in fields else None

    def derive(field: str, value: float, evidence: str, conf: float = 0.7):
        fields[field] = FieldValue(value=value, method=ExtractMethod.DERIVED,
                                   source_page=None, evidence=evidence + "（恒等式推算，待确认）",
                                   confidence=conf)
        level_log[field] = "L3"
        warnings.append(f"{field} 未直接抓到，已按会计恒等式推算（conf={conf}），请核对")

    ta, tl, eq = val("total_assets"), val("total_liabilities"), val("equity_total")
    if ta is None and tl is not None and eq is not None:
        derive("total_assets", tl + eq, f"TL({tl:,.2f}) + EQ({eq:,.2f})")
    if tl is None and ta is not None and eq is not None:
        derive("total_liabilities", ta - eq, f"TA({ta:,.2f}) − EQ({eq:,.2f})")
    if eq is None and ta is not None and tl is not None:
        derive("equity_total", ta - tl, f"TA({ta:,.2f}) − TL({tl:,.2f})")

    tl = val("total_liabilities")  # 可能刚被推出，刷新
    if val("current_liabilities") is None and tl is not None and tl > 0:
        ncl = comp_value("total_liabilities", "非流动负债")
        if ncl is not None:
            derive("current_liabilities", tl - ncl,
                   f"TL({tl:,.2f}) − 非流动负债合计({ncl:,.2f})")
        else:
            derive("current_liabilities", tl,
                   f"TL({tl:,.2f})（无非流动负债明细，假设非流动负债=0）", conf=0.6)

    ta = val("total_assets")
    if val("current_assets") is None and ta is not None:
        nca = comp_value("total_assets", "非流动资产")
        if nca is not None:
            derive("current_assets", ta - nca,
                   f"TA({ta:,.2f}) − 非流动资产合计({nca:,.2f})")

    # ---- 4) 流量字段 ----
    for fld in _FLOW_FIELDS:
        r = pick(fld)
        if r:
            fields[fld] = FieldValue(value=r[0], method=r[3], source_page=r[1],
                                     evidence=r[2], confidence=1.0)

    # ---- 5) EBIT 推导 ----
    pbt = fields.get("profit_before_tax")
    int_exp = fields.get("interest_expense")
    if pbt and pbt.value is not None:
        ebit_val = pbt.value
        if int_exp and int_exp.value is not None:
            ebit_val = pbt.value + int_exp.value
            evidence = f"{pbt.evidence}(PBT) + {int_exp.evidence}(利息)"
            ebit_conf = 1.0
        else:
            evidence = f"{pbt.evidence}(PBT, 无利息费用→EBIT=PBT)"
            warnings.append("未检测到利息费用，按 EBIT=PBT 处理（疑似无有息负债），该 EBIT 为假设值")
            ebit_conf = 0.9
        fields["ebit"] = FieldValue(value=ebit_val, method=ExtractMethod.PDFPLUMBER,
                                    source_page=pbt.source_page, evidence=evidence,
                                    confidence=ebit_conf)

    if level_log:
        warnings.append("抓取分级：" + ", ".join(f"{k}={v}" for k, v in sorted(level_log.items())))

    # ---- 6) 字典自审闭环：收集未识别科目（供 Web 端待审面板） ----
    from .synonym import suggest_field_for_gap
    gaps: list[dict] = []
    seen_labels: set = set()
    for it in line_items:
        if it.label in seen_labels:
            continue
        v = parse_number(it.raw_value, scale)
        if v is None or is_rownum(v):
            continue
        if match_field(it.label) or match_component(it.label):
            continue
        n_lab = normalize(it.label)
        # 排除二级明细（其中:原材料）、附注引用、比率类
        if n_lab.startswith("其中"):
            continue
        seen_labels.add(it.label)
        sug_f, sug_k = suggest_field_for_gap(it.label)
        gaps.append({
            "label": it.label, "value": v, "page": it.page,
            "suggested_field": sug_f, "suggested_kind": sug_k,
        })
        if len(gaps) >= 30:
            break

    return ExtractionResult(
        profile_name=profile_name, method=method,
        fields=fields, unit_scale=scale, warnings=warnings,
        dict_gaps=gaps)
