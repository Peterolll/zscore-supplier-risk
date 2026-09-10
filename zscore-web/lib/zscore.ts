// lib/zscore.ts — 纯函数：由已存储的 X1–X5 因子重算 Z 与风险区。
// 前后端共用（无 Node 专属 import，客户端组件可安全引入）。
// 系数严格对齐 Python 端 config.py（Z_ORIGINAL_COEF / Z_PRIME_COEF / Z_DOUBLE_PRIME_COEF）。
import type { ZModel, RiskZone, Industry, FieldRow } from "./types";
import { Z_COEFFICIENTS, Z_THRESHOLDS, FACTOR_META } from "./constants";
import type { Messages } from "./messages/types";
import { zh as zhMessages } from "./messages/zh";

export type XValues = {
  X1?: number | null;
  X2?: number | null;
  X3?: number | null;
  X4?: number | null;
  X5?: number | null;
};

/**
 * 模型选择规则（与 Python m6_calc.py 一致）：
 *  - listed=true  → "Z"（上市原始 Altman，5 因子，X4=股权市值/总负债）
 *  - listed=false → 制造业 "Z'" / 非制造业 "Z''"（非上市，X4=账面权益/总负债）
 */
export function modelForProfile(listed: boolean, industry: string): ZModel {
  if (listed) return "Z";
  return industry === "manufacturing" ? "Z'" : "Z''";
}

/** @deprecated 改用 modelForProfile；保留兼容旧调用点 */
export function modelForIndustry(industry: string): ZModel {
  return modelForProfile(false, industry);
}

/** 该模型实际计入 Z 的因子键（Z″ 不含 X5） */
export function activeFactors(model: ZModel): string[] {
  return Object.keys(Z_COEFFICIENTS[model]);
}

/**
 * 由 X 因子重算 Z。
 *
 * 修复（2026-09-10）：原实现「缺失因子按 0 计入」，当全部计入因子都缺失时
 * 会得到 z=0，再经 zoneOf 判定为 "distress" —— 把「完全没有数据」静默误报成
 * 「高风险」，是信贷场景最危险的失效模式。
 * 现与 Python m6_calc 对齐：计入因子全缺失时返回 null，由 zoneOf 判定为
 * "unknown"（前端展示"数据不足(不可计算)"）。
 */
export function computeZ(x: XValues, model: ZModel): number | null {
  const coef = Z_COEFFICIENTS[model];
  const keys = Object.keys(coef);
  let z = 0;
  let counted = 0;
  for (const k of keys) {
    const v = (x as Record<string, number | null | undefined>)[k];
    if (typeof v === "number") {
      z += coef[k] * v;
      counted += 1;
    }
  }
  return counted === 0 ? null : z;
}

/** 由 Z 值判定风险区（对齐 config.py _zone）；Z 不可计算（null）时为 "unknown" */
export function zoneOf(z: number | null, model: ZModel): RiskZone {
  if (z == null) return "unknown";
  const t = Z_THRESHOLDS[model];
  if (z > t.safe) return "safe";
  if (z > t.grey) return "grey";
  return "distress";
}

/**
 * 判断一个财务字段是否「需要人工确认」。
 * 派生规则（无需额外 DB 列）：
 *  - method === "manual"        → 人工补录（人填的数字，需复核）
 *  - method === "glm_ocr"       → OCR 提取（图片识别，可靠性低）
 *  - confidence < 1.0           → 回退/推导/近似（如缺失小计回退、EBIT=PBT 假设）
 *  其余（电子文本词典命中，confidence=1.0）→ 已确认
 */
export function fieldNeedsConfirm(f: {
  method?: string | null;
  confidence?: number | null;
} | null | undefined): boolean {
  if (!f) return false;
  if (f.method === "manual" || f.method === "glm_ocr" || f.method === "derived") return true;
  if ((f.confidence ?? 1) < 1.0) return true;
  return false;
}

/**
 * 字段确认状态展示信息：{ label, tone }，tone 用于角标配色。
 *
 * 为避免破坏 lib 与 server component 的导入边界（此文件被多个 RSC import），
 * 默认走中文 messages；要 i18n 时调用方传入 tMessages 即可。
 */
export function fieldStatus(
  f: { method?: string | null; confidence?: number | null } | null | undefined,
  tMessages?: Messages
): { label: string; tone: "ok" | "warn" } {
  const msgs = tMessages ?? zhMessages;
  const fs = msgs.fieldStatus;
  if (!f) return { label: fs.notExtracted, tone: "warn" };
  if (f.method === "manual") return { label: fs.manual, tone: "warn" };
  if (f.method === "glm_ocr") return { label: fs.ocrPending, tone: "warn" };
  if (f.method === "derived") return { label: fs.derived, tone: "warn" };
  if ((f.confidence ?? 1) < 1.0) return { label: fs.pending, tone: "warn" };
  return { label: fs.confirmed, tone: "ok" };
}

/** 一次性：给定行业 + X 因子，返回 Z 与风险区 */
export function recompute(
  industry: Industry | string,
  x: XValues,
  listed: boolean = false
): { model: ZModel; z: number | null; zone: RiskZone } {
  const model = modelForProfile(listed, industry);
  const z = computeZ(x, model);
  return { model, z, zone: zoneOf(z, model) };
}

// ---------------- Altman 子指标计算明细（展示用）----------------

export interface FactorBreakdown {
  key: string;
  label: string;
  meaning: string;
  formula: string;
  /** 是否计入当前模型的 Z（Z″ 不含 X5） */
  active: boolean;
  /** 该模型下 X 的系数 */
  coef: number;
  /** 最终 X 值（来自已存储因子，权威值） */
  value: number | null;
  /** 代入实际数值后的表达式，如 "(169,667,494 − 37,478,444) ÷ 173,802,193" */
  substituted: string;
  /** 分子文字说明（如"营运资本 = 流动资产 − 流动负债"） */
  numLabel: string;
  /** 分母文字说明（如"总资产"） */
  denLabel: string;
  /** 分子数值（用于现场复算 quotient） */
  numVal: number | null;
  /** 分母数值 */
  denVal: number | null;
  /** 流量年化提示（仅 X3/X5 且年化因子≠1 时出现） */
  annualizedNote?: string;
  /** 该因子依赖的底层字段中是否存在「需人工确认」者（人工补录/OCR/回退推导） */
  needsConfirmation?: boolean;
}

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * 由 financial_field（底层财务数字）还原每个 X 的代入数值与演算要素，
 * 与 m6_calc.py 的 X 定义一致。供结果页卡片与导出 Excel 共用，确保网页展示与引擎口径统一。
 *
 * X4 分子口径随模型变化：
 *  - "Z" (上市)：股权价值(equity_value)；缺失回退 equity_total 并标注
 *  - "Z'"/"Z''" (非上市)：股东权益账面值(equity_total)
 */
export function buildFactorBreakdown(
  xValues: XValues,
  fields: FieldRow[],
  model: ZModel,
  annualizeFactor: number
): FactorBreakdown[] {
  const fv = (k: string): number | null => {
    const f = fields.find((x) => x.field_key === k);
    return f && f.value != null ? f.value : null;
  };
  const ca = fv("current_assets");
  const cl = fv("current_liabilities");
  const ta = fv("total_assets");
  const re = fv("retained_earnings");
  const ebit = fv("ebit");
  const eqBook = fv("equity_total");           // 账面权益
  const eqMarket = fv("equity_value");         // 股权市值（上市）
  const tl = fv("total_liabilities");
  const rev = fv("revenue");
  const coefMap = Z_COEFFICIENTS[model];
  const ann = annualizeFactor && annualizeFactor !== 1;
  const listed = model === "Z";

  // 上市 Z 的 X4 分子优先股权市值，缺失回退账面权益
  const eqForX4 = listed
    ? (eqMarket != null ? eqMarket : eqBook)
    : eqBook;
  const eqSourceLabel = listed
    ? (eqMarket != null ? "股权市值" : "账面权益(市值缺失回退)")
    : "股东权益账面值";

  const build = (key: string): FactorBreakdown => {
    const m = FACTOR_META[key];
    const active = key in coefMap;
    const coef = coefMap[key] ?? 0;
    const value =
      (xValues as Record<string, number | null | undefined>)[key] ?? null;
    // 该因子依赖的底层字段：任一是「人工补录/OCR/回退推导」即标记为需确认
    const srcFields: string[] =
      key === "X1" ? ["current_assets", "current_liabilities"]
      : key === "X2" ? ["retained_earnings"]
      : key === "X3" ? ["ebit"]
      : key === "X4" ? (listed ? ["equity_total", "equity_value"] : ["equity_total"])
      : ["revenue"];
    const needsConfirmation = srcFields.some((sf) => {
      const f = fields.find((x) => x.field_key === sf);
      return fieldNeedsConfirm(f);
    });
    let numLabel = "";
    let denLabel = "总资产";
    let numVal: number | null = null;
    let denVal: number | null = ta;
    let substituted = "";
    let annualizedNote: string | undefined;
    let formula = m.formula;

    if (key === "X1") {
      numLabel = "营运资本 = 流动资产 − 流动负债";
      numVal = ca != null && cl != null ? ca - cl : null;
      denVal = ta;
      substituted = `(${fmtMoney(ca)} − ${fmtMoney(cl)}) ÷ ${fmtMoney(ta)}`;
    } else if (key === "X2") {
      numLabel = "留存收益";
      numVal = re;
      denVal = ta;
      substituted = `${fmtMoney(re)} ÷ ${fmtMoney(ta)}`;
    } else if (key === "X3") {
      numLabel = ann ? `EBIT（已年化 ×${annualizeFactor}）` : "EBIT";
      numVal = ebit != null ? ebit * (annualizeFactor || 1) : null;
      denVal = ta;
      substituted = ann
        ? `${fmtMoney(ebit)} × ${annualizeFactor} ÷ ${fmtMoney(ta)}`
        : `${fmtMoney(ebit)} ÷ ${fmtMoney(ta)}`;
      if (ann)
        annualizedNote = `流量字段按报告期年化：EBIT × ${annualizeFactor}（仅 EBIT/营收 年化，存量字段不年化）`;
    } else if (key === "X4") {
      numLabel = eqSourceLabel;
      numVal = eqForX4;
      denVal = tl;
      formula = listed ? (m.formulaListed ?? m.formula) : m.formula;
      substituted = `${fmtMoney(eqForX4)} ÷ ${fmtMoney(tl)}`;
      if (listed && eqMarket == null)
        annualizedNote = "上市原始 Z 的 X4 应使用股权市值，当前缺失，已用账面权益近似";
    } else {
      // X5
      numLabel = ann ? `营业收入（已年化 ×${annualizeFactor}）` : "营业收入";
      numVal = rev != null ? rev * (annualizeFactor || 1) : null;
      denVal = ta;
      substituted = ann
        ? `${fmtMoney(rev)} × ${annualizeFactor} ÷ ${fmtMoney(ta)}`
        : `${fmtMoney(rev)} ÷ ${fmtMoney(ta)}`;
      if (ann)
        annualizedNote = `流量字段按报告期年化：营业收入 × ${annualizeFactor}`;
    }

    return {
      key,
      label: m.label,
      meaning: m.meaning,
      formula,
      active,
      coef,
      value,
      substituted,
      numLabel,
      denLabel,
      numVal,
      denVal,
      annualizedNote,
      needsConfirmation,
    };
  };

  return ["X1", "X2", "X3", "X4", "X5"].map(build);
}
