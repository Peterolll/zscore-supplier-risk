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

候选选择：合并口径 → 主表 → 表格通道 → 最早页。
保留真实小额金额；行号列由表头定位排除，不按金额大小过滤。

EBIT 决策树：
  原文明示优先；否则 PBT+利息，或净利润+所得税+利息。无利息时不以财务费用替代。
"""
from __future__ import annotations
import math
import re
import hashlib
import json
from .evidence import source_of
from .audit import event
from .m2_extract import LineItem
from .synonym import normalize, FIELD_TREE, match_field, match_component
from .models import ExtractionResult, FieldValue, ExtractMethod, Gaap, SupplierProfile

_BS_FIELDS = ["current_assets", "current_liabilities", "equity_total",
              "retained_earnings", "total_assets", "total_liabilities"]
_FLOW_FIELDS = ["revenue", "profit_before_tax", "interest_expense", "net_profit", "income_tax", "noncurrent_assets", "noncurrent_liabilities", "surplus_reserve", "undistributed_profit", "finance_expenses", "ebit"]
_AUX = {"净利润":"net_profit","四净利润":"net_profit","所得税费用":"income_tax","减所得税费用":"income_tax","非流动资产合计":"noncurrent_assets","非流动负债合计":"noncurrent_liabilities","财务费用":"finance_expenses","財務費用":"finance_expenses","息税前利润":"ebit","息稅前利潤":"ebit","ebit":"ebit","息税前利润（ebit）":"ebit","息税前利润(ebit)":"ebit","盈余公积":"surplus_reserve","未分配利润":"undistributed_profit"}
_LIAB_FIELDS = {"current_liabilities", "total_liabilities"}
_SUBTOTAL_KW = ["合计", "總計", "总计", "total", "subtotal", "合計"]


def canonical_field(label: str) -> str | None:
    aux=normalize(label)
    return _AUX.get(aux) or ('net_profit' if re.match(r'^(?:四)?净利润',aux) else 'income_tax' if re.match(r'^(?:减)?所得税费用',aux) else None) or match_field(label)


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
    if not math.isfinite(v):
        return None
    v *= scale
    if not math.isfinite(v):
        return None
    return -v if neg else v


def resolve(line_items: list[LineItem], consolidated_pages: set[int],
            gaap: Gaap, scale: float, profile_name: str,
            method: ExtractMethod) -> ExtractionResult:
    warnings: list[str] = []
    years=[int(y) for item in line_items for y in re.findall(r'(?<!\d)(20\d{2})(?!\d)',item.period or '')]
    target_year=max(years) if years else None
    def dates(item):
        return [tuple(map(int,m)) for m in re.findall(r'(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})',(item.period or '')+' '+(item.column or ''))]
    observed_dates=[d for item in line_items for d in dates(item)]
    target_date=max(observed_dates) if observed_dates else None

    # ---- 0) 双通道候选收集：direct（小计） + component（子指标） ----
    candidates: list[dict] = []
    cand_direct: dict[str, list] = {}
    cand_comp: dict[tuple[str, str], list] = {}
    for it in line_items:
        if target_date and dates(it) and max(dates(it))!=target_date:
            event('mapping.period_excluded',label=it.label,period=it.period,target_date=target_date)
            continue
        years_in_period=[int(y) for y in re.findall(r'(?<!\d)(20\d{2})(?!\d)',it.period or '')]
        if target_year and years_in_period and max(years_in_period)!=target_year:
            event('mapping.period_excluded',label=it.label,period=it.period,target_year=target_year)
            continue
        v = parse_number(it.raw_value, it.unit_scale if it.unit_scale is not None else scale)
        if it.unit_unknown:
            warnings.append(f"第 {it.page + 1} 页单位未确认，{it.label} 待人工补录")
            continue
        if v is None:
            continue
        f = canonical_field(it.label)
        evidence = source_of(it)
        evidence['id'] = hashlib.sha256(json.dumps(evidence,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:24]
        candidates.append({**evidence,'field_key':f,'value':v})
        if f:
            cand_direct.setdefault(f, []).append((v, it.page, it.label, it.method, it.source, it.statement, evidence))
        for ff, cc in match_component(it.label):
            cand_comp.setdefault((ff, cc), []).append((v, it.page, it.label, it.method, it.source, it.statement, evidence))

    # Scope and statement identity take precedence over extraction channel.
    def _prep(lst: list) -> list:
        if consolidated_pages:
            c = [x for x in lst if x[1] in consolidated_pages]
            lst = c
        statements = [x for x in lst if x[5]]
        if statements:
            lst = statements
        table_lst = [x for x in lst if x[4] == "table"]
        if table_lst:
            lst = table_lst
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
        """流量字段：单值选择（最早主表候选）。"""
        lst = _prep(cand_direct.get(field, []))
        return lst[0] if lst else None

    def comp_value(field: str, comp: str) -> float | None:
        """某字段某子指标的代表值（最早主表候选）。"""
        lst = _prep(cand_comp.get((field, comp), []))
        return lst[0][0] if lst else None

    # ---- 2) 存量字段 L1 + L2 ----
    def resolve_bs(field: str) -> tuple[FieldValue, str] | tuple[None, None]:
        comp_def = (FIELD_TREE.get(field) or {}).get("components") or {}
        comp_vals: dict[str, tuple[float, str]] = {}
        for (ff, cc) in cand_comp:
            if ff != field:
                continue
            prepped = _prep(cand_comp[(ff, cc)])
            if prepped:
                rep = prepped[0]
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
        #     故 direct 命中即目标行，取最早主表候选；不再要求「合计」关键词）
        lst = _prep(cand_direct.get(field, []))
        if lst:
            s = lst[0]
            if max_comp is not None and s[0] < max_comp:
                warnings.append(
                    f"{field} 直抓值({s[0]:,.2f}) < 明细分量({max_comp:,.2f})，疑抓错列，改用明细求和")
            else:
                val = s[0]
                return FieldValue(value=val, method=s[3], source_page=s[1],
                                  evidence=s[2], provenance=[s[6]], dependencies=["excel_formula"] if s[6].get("formula") else [], confidence=0.85 if s[3] == ExtractMethod.GLM_OCR or not s[6].get("bbox") or s[6].get("formula") else 1.0), "L1"

        # L2：子指标求和
        if comp_vals:
            # Incomplete retained-earnings components must not silently become a full value.
            if field == 'retained_earnings' and len(comp_vals) < len(comp_def):
                warnings.append('留存收益组件不完整；空白盈余公积不是已确认的0')
                return None, None
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
                              evidence=ev + note, confidence=conf,
                              provenance=[c for c in candidates if any(ff==field for ff,cc in match_component(c['raw_label']))],
                              dependencies=list(comp_vals)), "L2"
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
                                   confidence=conf,
                                   dependencies=['total_liabilities','equity_total'] if field=='total_assets' else ['total_assets','equity_total'] if field=='total_liabilities' else ['total_assets','total_liabilities'] if field=='equity_total' else ['total_liabilities','noncurrent_liabilities'] if field=='current_liabilities' else ['total_assets','noncurrent_assets'],
                                   provenance=[c for c in candidates if c['field_key'] in ['total_assets','total_liabilities','equity_total','noncurrent_assets','noncurrent_liabilities']])
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
                                     evidence=r[2], provenance=[r[6]], dependencies=["excel_formula"] if r[6].get("formula") else [], confidence=0.85 if r[3] == ExtractMethod.GLM_OCR or not r[6].get("bbox") or r[6].get("formula") else 1.0)

    # ---- 5) EBIT: reported value first, then complete, evidenced accounting inputs. ----
    if 'ebit' not in fields:
        routes=[['profit_before_tax','interest_expense'],['net_profit','income_tax','interest_expense']]
        for parts in routes:
            if all(k in fields and fields[k].value is not None for k in parts):
                refs=[fields[k] for k in parts]
                fields['ebit']=FieldValue(value=sum(f.value for f in refs),method=ExtractMethod.DERIVED,
                    source_page=refs[0].source_page,evidence=' + '.join(f.evidence for f in refs),
                    confidence=min(f.confidence for f in refs),dependencies=parts,
                    provenance=[p for f in refs for p in f.provenance])
                break
        if 'ebit' not in fields:
            warnings.append('EBIT缺少完整推导依据：需要税前利润+利息费用，或净利润+所得税费用+利息费用；财务费用不能直接替代利息费用')

    if level_log:
        warnings.append("抓取分级：" + ", ".join(f"{k}={v}" for k, v in sorted(level_log.items())))

    # ---- 6) 字典自审闭环：收集未识别科目（供 Web 端待审面板） ----
    from .synonym import suggest_field_for_gap
    gaps: list[dict] = []
    seen_labels: set = set()
    for it in line_items:
        if it.label in seen_labels:
            continue
        v = parse_number(it.raw_value, it.unit_scale if it.unit_scale is not None else scale)
        if v is None or it.unit_unknown:
            continue
        if canonical_field(it.label) or match_component(it.label):
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

    event("mapping.completed",fields={k:v.model_dump() for k,v in fields.items()},candidates=len(candidates),warnings=warnings)
    return ExtractionResult(
        profile_name=profile_name, method=method,
        fields=fields, unit_scale=scale, warnings=warnings,
        dict_gaps=gaps, candidates=candidates)
