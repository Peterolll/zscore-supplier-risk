// lib/constants.ts — 可视化与共用的纯常量（无副作用，前后端可用）
import type { ZModel, RiskZone } from "./types";

export const Z_THRESHOLDS: Record<ZModel, { safe: number; grey: number }> = {
  Z: { safe: 2.675, grey: 1.81 },       // 上市原始 Altman Z
  "Z'": { safe: 2.9, grey: 1.23 },       // 非上市制造业
  "Z''": { safe: 2.9, grey: 1.1 },        // 非上市非制造业
};

// Altman 系数（严格对齐 Python 端 config.py）。
// - Z  (上市原始, 1968): 5 因子, X4 = 股权市值 / 总负债
// - Z' (非上市制造业, 1983): 5 因子, X4 = 股东权益账面值 / 总负债
// - Z''(非上市非制造业, 1995): 4 因子(无 X5), X4 = 股东权益账面值 / 总负债
export const Z_COEFFICIENTS: Record<ZModel, Record<string, number>> = {
  Z: { X1: 1.2, X2: 1.4, X3: 3.3, X4: 0.6, X5: 1.0 },
  "Z'": { X1: 0.717, X2: 0.847, X3: 3.107, X4: 0.42, X5: 0.998 },
  "Z''": { X1: 6.56, X2: 3.26, X3: 6.72, X4: 1.05 },
};

export const FACTOR_LABELS: Record<string, string> = {
  X1: "X1 营运资本 / 总资产",
  X2: "X2 留存收益 / 总资产",
  X3: "X3 息税前利润 / 总资产",
  X4: "X4 权益 / 总负债",
  X5: "X5 营收 / 总资产",
};

// 每个 Altman 子指标的展示元数据：含义（解释该比率反映什么）+ 公式（符号化）。
// X4 公式因模型口径不同：上市 Z 用「股权市值」，非上市 Z'/Z'' 用「股东权益账面值」。
// 与 m6_calc.py 的 X 定义严格一致；系数见 Z_COEFFICIENTS。
export const FACTOR_META: Record<
  string,
  { label: string; meaning: string; formula: string; formulaListed?: string }
> = {
  X1: {
    label: "营运资本 / 总资产",
    meaning:
      "流动性比率：营运资本占总资产比重，反映短期偿债能力。数值越高，短期财务压力越小。",
    formula: "(流动资产 − 流动负债) ÷ 总资产",
  },
  X2: {
    label: "留存收益 / 总资产",
    meaning:
      "累积盈利能力：企业留存的累计利润占总资产比重。经营年限越久、持续盈利越稳则越高。",
    formula: "留存收益 ÷ 总资产",
  },
  X3: {
    label: "息税前利润 / 总资产",
    meaning:
      "资产报酬率(ROA 口径)：总资产创造息税前利润的能力，衡量经营获现效率。流量字段按报告期年化。",
    formula: "EBIT(息税前利润) ÷ 总资产",
  },
  X4: {
    label: "股权价值 / 总负债",
    meaning:
      "资本结构稳健性：股权对总负债的保障倍数（还债安全垫）。数值越高，长期偿债越安全。",
    formula: "股东权益账面值 ÷ 总负债",
    formulaListed: "股权市值 ÷ 总负债",
  },
  X5: {
    label: "销售收入 / 总资产",
    meaning:
      "资产周转率：单位总资产创造的营业收入，衡量资产运营效率。流量字段按报告期年化。",
    formula: "营业收入 ÷ 总资产",
  },
};

// 完整 Z 方程（系数严格对齐 config.py）。
export const Z_FORMULA: Record<ZModel, string> = {
  Z: "Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5",
  "Z'": "Z = 0.717·X1 + 0.847·X2 + 3.107·X3 + 0.420·X4 + 0.998·X5",
  "Z''": "Z = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4",
};

export const ZONE_COLORS: Record<RiskZone, string> = {
  safe: "#16a34a",
  grey: "#d97706",
  distress: "#dc2626",
  unknown: "#6b7280",
};

export const ZONE_LABELS: Record<RiskZone, string> = {
  safe: "安全区",
  grey: "灰色区(警惕)",
  distress: "困境区",
  unknown: "数据不足(不可计算)",
};

export const INDUSTRY_LABELS: Record<string, string> = {
  manufacturing: "制造业",
  service: "非制造业(服务/贸易)",
};

export const LISTED_LABELS: Record<string, string> = {
  listed: "上市公司",
  unlisted: "非上市公司",
};

export const PERIOD_LABELS: Record<string, string> = {
  annual: "年度",
  semi: "半年度",
  q1: "一季度",
  q2: "二季度",
  q3: "三季度",
  q4: "四季度",
};

export const GAAP_LABELS: Record<string, string> = {
  cas: "中国企业准则(CAS)",
  ifrs: "国际准则(IFRS)",
  tw_gaap: "台湾准则",
  hk_gaap: "香港准则",
  other: "其他",
};

// 数据字典内部字段的中文说明（用于 /dictionary 页面展示）
// kind: "extracted" 直接提取字段（报表有对应单行）；"derived" 计算派生字段（由代码规则计算，非直接抄报表）
export const DICT_FIELD_META: Record<
  string,
  { label: string; desc: string; kind?: "extracted" | "derived"; formula?: string }
> = {
  current_assets: { label: "流动资产", desc: "Current Assets", kind: "extracted" },
  current_liabilities: { label: "流动负债", desc: "Current Liabilities", kind: "extracted" },
  total_assets: { label: "总资产", desc: "Total Assets", kind: "extracted" },
  total_liabilities: { label: "总负债", desc: "Total Liabilities", kind: "extracted" },
  equity_total: { label: "股东权益", desc: "Total Equity（账面值，非上市 X4 分子）", kind: "extracted" },
  equity_value: {
    label: "股权价值",
    desc: "Equity Market Value（上市 X4 分子：股价×股本 或 评估值/最近融资估值）",
    kind: "extracted",
  },
  retained_earnings: {
    label: "留存收益",
    desc: "Retained Earnings",
    kind: "derived",
    formula:
      "CAS(大陆): 盈余公积 + 未分配利润（两行拆分求和，m4_map L2）；IFRS/台湾有单行「保留盈餘」则直接提取",
  },
  re_retained_surplus: { label: "盈余公积", desc: "简中 CAS 拆分①（派生留存收益的来源之一）" },
  re_undistributed: { label: "未分配利润", desc: "简中 CAS 拆分②（派生留存收益的来源之一）" },
  profit_before_tax: { label: "税前利润", desc: "PBT，用于 EBIT 推导", kind: "extracted" },
  interest_expense: { label: "利息费用", desc: "用于 EBIT 推导", kind: "extracted" },
  revenue: { label: "营业收入", desc: "流量，需年化", kind: "extracted" },
};

// 派生计算字段：由代码规则从其他字段算出，本身不在数据字典(可编辑别名)中。
// 仅在 /dictionary 页面以只读形式展示其公式来源，提醒用户这些是"算出来的"。
export const DERIVED_ONLY_FIELDS: { field: string; label: string; formula: string }[] = [
  {
    field: "ebit",
    label: "息税前利润 EBIT",
    formula: "利润总额(PBT) + 利息费用；无利息费用时 EBIT = PBT（疑似无有息负债）",
  },
];
