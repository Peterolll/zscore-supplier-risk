// lib/validation.ts — AI 补全结果的"位数/量级二次校验层"
//
// 作用：在模型自身交叉核验（value 与 evidence 一致性）之外，再叠加一层
// 基于会计恒等式与量级常识的启发式复校。目标是兜底"弱视觉模型（如 GLM-4V-Flash）
// 在 value 与 evidence 同时丢失末位"这类模型自身交叉核验无法捕获的错误。
//
// 设计原则：
//   - 仅对"确定的会计真值/常识"做告警，避免对正常中小供应商误报（REL_TOL = 5% 宽松容差）
//   - 只给 AI 建议打 warning 并降级 confidence，绝不擅自改写数值（采纳权在用户）
//   - 不依赖换更强模型即可兜住相当一部分"双丢末位"情形
//
// 已知局限：若模型把某字段与它的可信锚点按相同比例同时改错（如 both 漏末位且无法从
// 其它字段推断），本层仍可能漏检 —— 治本解仍是在 /settings 配置更强视觉模型。

import type { AiFieldSuggestion } from "./ai-client";

/** 跨字段复校相对容差（5%）：真实财报恒等式应基本精确，5% 足够宽松以避免误报 */
const REL_TOL = 0.05;

/**
 * 宽松量级下限（元）。仅对"本应为正且通常量级较大"的余额表科目/营收设下限，
 * 用于兜底"漏末位/单位错误"导致的极端偏小。可正可负的科目（留存收益/EBIT/利润/利息）
 * 不设下限，避免对亏损或小规模值误报。
 */
const MIN_PLAUSIBLE: Record<string, number> = {
  current_assets: 1e5,
  current_liabilities: 1e5,
  total_assets: 1e5,
  total_liabilities: 1e5,
  revenue: 1e5,
};

/** 余额表总额字段（本应为正） */
const MUST_BE_POSITIVE = new Set([
  "current_assets",
  "current_liabilities",
  "total_assets",
  "total_liabilities",
]);

function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

/**
 * 对 AI 建议做跨字段量级二次校验。
 *
 * @param suggestions AI 返回的字段建议（会被原地追加 warning / 降级 confidence）
 * @param existing    库中已确认字段值（可信锚点；仅取 value != null 的参与复校）
 * @returns 同一数组（已标注）
 */
export function applySanityChecks(
  suggestions: AiFieldSuggestion[],
  existing: Record<string, number | null>
): AiFieldSuggestion[] {
  // 合并视图：existing 为可信锚点；AI 建议优先覆盖同名键（覆盖的字段用 AI 值参与复校）
  const merged: Record<string, number> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (v != null && Number.isFinite(v)) merged[k] = v;
  }
  for (const s of suggestions) {
    if (s.value != null && Number.isFinite(s.value)) merged[s.field_key] = s.value;
  }

  const sugMap = new Map(suggestions.map((s) => [s.field_key, s]));
  const addWarn = (s: AiFieldSuggestion, msg: string) => {
    s.warning = s.warning ? `${s.warning}；${msg}` : msg;
    s.confidence = Math.min(s.confidence, 0.25);
  };

  // ── ① 资产负债表恒等式：资产 = 负债 + 权益（三者齐全时一次性校验）──
  const ta = merged["total_assets"];
  const tl = merged["total_liabilities"];
  const eq = merged["equity_total"];
  if (ta != null && tl != null && eq != null) {
    const diff = Math.abs(ta - (tl + eq));
    const tol = Math.max(Math.abs(ta), Math.abs(tl), Math.abs(eq), 1) * REL_TOL;
    if (diff > tol) {
      const msg = `资产负债表不平衡：资产(${fmt(ta)}) ≠ 负债(${fmt(tl)}) + 权益(${fmt(eq)})，差额 ${fmt(
        diff
      )}，可能数字位数或符号有误`;
      for (const k of ["total_assets", "total_liabilities", "equity_total"]) {
        const s = sugMap.get(k);
        if (s) addWarn(s, msg);
      }
    }
  }

  // ── ①-b 总量与分量"完全相同（到分一致）"→ 疑似模型未识别非流动/其他科目 ──
  // 真实企业几乎不可能让 资产总计 与 流动资产 恰好相等（到分），这类"折叠"几乎必是
  // 模型读错区块或漏读非流动科目后拼出的自洽假表，必须告警（与 ① 恒等式互补：
  // ① 抓"内部不自洽"，本项抓"内部自洽但整体读错区块"）。
  const EXACT_EQ = 1; // 差额 < 1 元视为完全相同
  if (ta != null && merged["current_assets"] != null && Math.abs(ta - merged["current_assets"]!) < EXACT_EQ) {
    const msg = `资产总计(${fmt(ta)}) 与流动资产(${fmt(merged["current_assets"]!)}) 完全相同，疑似模型未识别非流动科目或读取了错误区块，请核对原文`;
    if (sugMap.get("total_assets")) addWarn(sugMap.get("total_assets")!, msg);
    if (sugMap.get("current_assets")) addWarn(sugMap.get("current_assets")!, msg);
  }
  if (tl != null && merged["current_liabilities"] != null && Math.abs(tl - merged["current_liabilities"]!) < EXACT_EQ) {
    const msg = `负债合计(${fmt(tl)}) 与流动负债(${fmt(merged["current_liabilities"]!)}) 完全相同，疑似模型未识别非流动科目，请核对原文`;
    if (sugMap.get("total_liabilities")) addWarn(sugMap.get("total_liabilities")!, msg);
    if (sugMap.get("current_liabilities")) addWarn(sugMap.get("current_liabilities")!, msg);
  }
  if (eq != null && merged["retained_earnings"] != null && Math.abs(eq - merged["retained_earnings"]!) < EXACT_EQ) {
    const msg = `权益总计(${fmt(eq)}) 与留存收益(${fmt(merged["retained_earnings"]!)}) 完全相同，疑似其他权益科目未被识别，请核对原文`;
    if (sugMap.get("equity_total")) addWarn(sugMap.get("equity_total")!, msg);
    if (sugMap.get("retained_earnings")) addWarn(sugMap.get("retained_earnings")!, msg);
  }

  // ── ② 逐字段：分量≤总量 / 利润≤营收 / 量级下限 / 总额非负 ──
  for (const s of suggestions) {
    const v = s.value;
    if (v == null || !Number.isFinite(v)) continue;

    // 量级下限兜底（仅正字段；负数由下方"总额非负"检查覆盖，避免重复告警）
    const floor = MIN_PLAUSIBLE[s.field_key];
    if (floor !== undefined && v > 0 && v < floor) {
      addWarn(
        s,
        `金额 ${fmt(v)} 过小（低于合理下限 ${fmt(floor)} 元），疑似漏末位或单位错误`
      );
    }

    // 分量 > 总量 → 总量可能漏末位
    if (
      s.field_key === "current_assets" &&
      merged["total_assets"] != null &&
      v > merged["total_assets"] * (1 + REL_TOL)
    ) {
      addWarn(
        s,
        `流动资产(${fmt(v)}) 超过资产总计(${fmt(merged["total_assets"]!)})，资产总计可能漏末位`
      );
    }
    if (
      s.field_key === "current_liabilities" &&
      merged["total_liabilities"] != null &&
      v > merged["total_liabilities"] * (1 + REL_TOL)
    ) {
      addWarn(
        s,
        `流动负债(${fmt(v)}) 超过负债合计(${fmt(merged["total_liabilities"]!)})，负债合计可能漏末位`
      );
    }
    // 总量 < 分量 → 总量可能漏末位
    if (
      s.field_key === "total_assets" &&
      merged["current_assets"] != null &&
      v < merged["current_assets"] * (1 - REL_TOL)
    ) {
      addWarn(
        s,
        `资产总计(${fmt(v)}) 小于流动资产(${fmt(merged["current_assets"]!)})，资产总计可能漏末位`
      );
    }
    if (
      s.field_key === "total_liabilities" &&
      merged["current_liabilities"] != null &&
      v < merged["current_liabilities"] * (1 - REL_TOL)
    ) {
      addWarn(
        s,
        `负债合计(${fmt(v)}) 小于流动负债(${fmt(merged["current_liabilities"]!)})，负债合计可能漏末位`
      );
    }
    if (
      s.field_key === "equity_total" &&
      merged["retained_earnings"] != null &&
      v > 0 &&
      merged["retained_earnings"]! > 0 &&
      v < merged["retained_earnings"]! * (1 - REL_TOL)
    ) {
      addWarn(
        s,
        `所有者权益(${fmt(v)}) 小于留存收益(${fmt(merged["retained_earnings"]!)})，所有者权益可能漏末位`
      );
    }

    // 利润 ≤ 营收（发生额逻辑）：正利润超过营收 → 营收可能漏末位
    if (
      (s.field_key === "profit_before_tax" || s.field_key === "ebit") &&
      v > 0 &&
      merged["revenue"] != null &&
      v > merged["revenue"]! * (1 + REL_TOL)
    ) {
      addWarn(
        s,
        `${s.field_label}（${fmt(v)}）超过营业收入（${fmt(merged["revenue"]!)}），营收可能漏末位或利润异常`
      );
    }
    if (
      s.field_key === "revenue" &&
      merged["profit_before_tax"] != null &&
      merged["profit_before_tax"]! > 0 &&
      v < merged["profit_before_tax"]! * (1 - REL_TOL)
    ) {
      addWarn(
        s,
        `营业收入（${fmt(v)}）小于利润总额（${fmt(merged["profit_before_tax"]!)}），营收可能漏末位`
      );
    }

    // 余额表总额非负
    if (MUST_BE_POSITIVE.has(s.field_key) && v <= 0) {
      addWarn(s, `余额表总额应为正数，当前为 ${fmt(v)}，可能符号或位数有误`);
    }
  }

  return suggestions;
}

/**
 * 实时量级比对：将 AI 建议值与 Python 流水线（pdfplumber）提取的可信值逐字段比对。
 *
 * **这是治本弱视觉模型"自洽但全错"最可靠的兜底**。流水线的提取基于结构化文本解析，
 * 在端到端实测中远强于 GLM-4V-Flash 等弱视觉模型（例：资产总计 AI=126.6M，流水线=5.92B，
 * 偏差≈47 倍，且 AI 拼出的表内部自洽，仅靠会计恒等式/分量关系无法捕获）。
 * 当两者对同一字段差异达到数量级（≥ MAGNITUDE_RATIO 倍）或符号相反时，给出高信号告警。
 *
 * 设计要点：
 *   - 此检查为**中立"差异"告警**，不预设哪边更正确——交由用户核对原文裁决（采纳权在用户）。
 *   - 仅给 suggestion 打 warning + 降级 confidence，**绝不擅自改写数值**。
 *   - 流水线未提取该字段（pipelineFields 缺键）或数值过小（< MIN_COMPARE）时跳过，避免噪声。
 *
 * @param suggestions    AI 返回的字段建议（会被原地追加 warning / 降级 confidence）
 * @param pipelineFields 流水线提取值（可信锚点；仅取 value != null 的参与比对）
 * @returns 同一数组（已标注）
 */
const MAGNITUDE_RATIO = 3; // 一方达另一方 3 倍及以上 → 视为量级不符
const MIN_COMPARE = 100; // 绝对值低于此不做量级比对（数值过小，噪声大）

export function compareAgainstPipeline(
  suggestions: AiFieldSuggestion[],
  pipelineFields: Record<string, number | null>
): AiFieldSuggestion[] {
  for (const s of suggestions) {
    const ai = s.value;
    if (ai == null || !Number.isFinite(ai)) continue;
    const pipe = pipelineFields[s.field_key];
    if (pipe == null || !Number.isFinite(pipe)) continue; // 流水线未提取该字段 → 无可比锚点
    if (Math.abs(ai) < MIN_COMPARE || Math.abs(pipe) < MIN_COMPARE) continue;

    const setWarn = (msg: string) => {
      s.warning = s.warning ? `${s.warning}；${msg}` : msg;
      s.confidence = Math.min(s.confidence, 0.2);
    };

    // ① 符号相反（且均非零）→ 疑似正负号读错
    if (ai * pipe < 0) {
      setWarn(
        `${s.field_label}：AI 提取(${fmt(ai)}) 与流水线读取(${fmt(pipe)}) 符号相反，疑似正负号读错，请核对原文`
      );
      continue;
    }

    // ② 量级差异：一方为另一方 MAGNITUDE_RATIO 倍及以上
    const ratio =
      Math.max(Math.abs(ai), Math.abs(pipe)) /
      Math.max(Math.min(Math.abs(ai), Math.abs(pipe)), 1);
    if (ratio >= MAGNITUDE_RATIO) {
      setWarn(
        `${s.field_label}：AI 提取(${fmt(ai)}) 与流水线读取(${fmt(pipe)}) 差异约 ${ratio.toFixed(
          0
        )} 倍，量级不符，疑似模型读错，请核对原文确认正确值`
      );
    }
  }
  return suggestions;
}
