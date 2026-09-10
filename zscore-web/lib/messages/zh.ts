// lib/messages/zh.ts — 中文（默认）核心文案
// 范围：nav / 页面标题 / 主要按钮 / Z 风险区 / 闸门标签 / 关键状态提示 / 通用错误
// 与 types.ts 严格保持 key 一一对应。
//
// 闸门 key 与 Python 端 m5_validate.py 输出完全一致（包含 <= / >= 等符号），
// UI 层按 key 查表翻译为可读文本；不可改 Python 输出来"凑"键名。

import type { Messages } from "./types";

export const zh: Messages = {
  brand: {
    shortTitle: "供应商 Z-Score",
    fullTitle: "供应商 Z-Score 风险分析",
    tagline: "上传财报 PDF，自动计算 Altman Z-Score 并可视化供应商信用风险",
    footer: "Altman Z-Score 自动计算 · 阈值基于美国样本，跨国比较仅供参考",
  },
  nav: {
    upload: "上传分析",
    suppliers: "供应商库",
    dictionary: "数据字典",
    manual: "用户手册",
    workflow: "计算工作流",
  },
  homepage: {
    uploadTitle: "上传财报并分析",
    recentTitle: "最近分析",
    settings: "⚙ 设置",
    viewAll: "查看全部 →",
    emptyTitle: "还没有分析记录",
    emptyHint: "从左侧上传一份财报 PDF 或 PPTX 开始分析",
    methodLabel: "方式",
  },
  upload: {
    fileLabel: "财报文件（PDF / PPTX）*",
    fileHint: "已选 {n} 个文件，将自动合并为单份报表后提取（建议均为 PDF；PPTX 请单独上传）。",
    remove: "移除",
    nameLabel: "供应商名称",
    namePlaceholder: "留空则取文件名",
    companyType: "公司类型 *",
    companyTypeHint:
      "上市公司 → 原始 Altman Z（5 因子，X4=股权市值÷总负债，阈值 2.675/1.81）；" +
      "非上市公司 → Z′(制造)/Z″(非制造)，X4=账面权益÷总负债。",
    equityValueLabel: "股权价值（市值）*",
    equityValuePlaceholder: "股价 × 股本（或最近融资估值），单位与币种一致",
    equityValueHint: "原始 Z 的 X4 分子；缺失时系统会回退账面权益近似并标注。",
    industry: "行业类型 *",
    period: "报告期 *",
    gaap: "会计准则 *",
    currency: "币种",
    submitting: "解析与计算中…",
    submit: "上传并分析",
    note:
      "提示：公司类型与行业均由人工确认，系统不自动猜测模型。支持 PDF 与 PPTX；多张分表（如合并资产负债表+利润表+现金流量表）可一次选多张 PDF 自动合并；电子文本直接解析，扫描件需 GLM_API_KEY。",
    errNoFile: "请先选择财报文件（PDF / PPTX；多张报表可一次选多张 PDF 自动合并）",
    errOcrUnavailable: "该财报为扫描件，需配置 GLM_API_KEY 启用 GLM-4V-Flash OCR 才能解析。",
    errGeneric: "分析失败",
  },
  suppliersPage: {
    title: (n: number) => `供应商库（${n}）`,
    emptyTitle: "供应商库为空",
    emptyHint: "请先在首页上传财报进行分析",
  },
  suppliersTable: {
    selected: (n: number) => `已选 ${n} 项（至少选 2 项可对比）`,
    batchDelete: (n: number) => (n > 0 ? `批量删除(${n})` : "批量删除"),
    compareSelected: "对比所选",
    columns: {
      supplier: "供应商",
      industryGaap: "行业/准则",
      model: "模型",
      zScore: "Z-Score",
      risk: "风险",
      method: "方式",
      action: "操作",
    },
    delete: "删除",
  },
  confirm: {
    batchTitle: "批量删除供应商",
    oneTitle: "删除供应商",
    batchMsg: (n: number) =>
      `确认删除选中的 ${n} 个供应商？其全部历史分析记录（含因子与财务字段）将一并清除，且不可恢复。`,
    oneMsg: (name: string) =>
      `确认删除供应商「${name}」？其全部历史分析记录将一并清除，且不可恢复。`,
    busy: "删除中…",
    confirm: "确认删除",
  },
  zones: {
    safe: "安全区",
    grey: "灰色区(警惕)",
    distress: "困境区",
    unknown: "数据不足(不可计算)",
  },
  enums: {
    listed: "上市公司",
    unlisted: "非上市公司",
    manufacturing: "制造业",
    service: "非制造业(服务/贸易)",
    annual: "年度",
    semi: "半年度",
    q1: "一季度",
    q2: "二季度",
    q3: "三季度",
    q4: "四季度",
    cas: "中国企业准则(CAS)",
    ifrs: "国际准则(IFRS)",
    twGaap: "台湾准则",
    hkGaap: "香港准则",
    other: "其他",
  },
  fieldStatus: {
    notExtracted: "未提取",
    manual: "人工补录",
    ocrPending: "OCR待核",
    derived: "推算待确认",
    pending: "待确认",
    confirmed: "已确认",
    aiSuggestion: "AI 建议",
  },
  gates: {
    G1_复式平衡: "G1 复式平衡",
    "G2_CA<=TA": "G2 流动资产 ≤ 总资产",
    "G2_CL<=TL": "G2 流动负债 ≤ 总负债",
    "G2_EQ<=TA": "G2 权益 ≤ 总资产",
    "G2_RE<=TA": "G2 留存收益 ≤ 总资产",
    "G3_TA>0": "G3 总资产 > 0",
    "G3_TL>=0": "G3 总负债 ≥ 0",
    G4_EBIT交叉: "G4 EBIT 交叉验证",
    G5_完整性: "G5 完整性",
  },
  detail: {
    manualOverride: "人工覆盖",
    annualizedSuffix: (n: number) => ` · 流量年化×${n}`,
    companyTypeLabel: "公司类型：",
    companyTypeHint: "上市 → 原始 Z（5 因子，X4=股权市值÷总负债）；非上市 → Z′(制造)/Z″(非制造)",
    industryLabel: "行业类型：",
    equityLabel: "股权价值（市值）：",
    equityPlaceholder: "股价 × 股本",
    equityHint: "原始 Z 的 X4 分子；缺失时用账面权益近似并标注",
    factorSectionTitle: "Altman 子指标计算明细（X1–X5）",
    factorSectionHint:
      "子指标由财报提取引擎算出（只读）；切换公司类型/行业会改变 Z 模型与计入项（非上市非制造业 Z″ 不含 X5）。" +
      "公式与系数严格对齐引擎（config.py）。",
    fieldsSectionTitle: "财务字段修正",
    fieldsSectionHint:
      "提取不全或数字有误时，在此手填/修正底层科目。改动项保存后将重新计算 Altman 子指标与 Z，" +
      "并在证据表标记为「人工补录」。单位与币种一致（元）。",
    acceptBtn: "✓ 采纳",
    dismissBtn: "✗ 忽略",
    acceptDismissHint: (v: number) => `采纳=替换为${v.toLocaleString("zh-CN")} · 忽略=保留原值`,
    placeholderEmpty: "未提取，可手填或点 🤖",
    finalRisk: "最终风险评级",
    followCalc: (zone: string) => `跟随计算（${zone}）`,
    noteLabel: "人工备注",
    notePlaceholder: "记录人工修正理由（如：行业判断、特殊事项）",
    saving: "保存中…",
    save: "保存修改",
    exportExcel: "导出 Excel",
    saveFailPrefix: "保存失败：",
    savePartial: (n: number) => `已保存 ${n} 项修正并重新计算 Z ✅`,
    saveOk: "已保存 ✅",
    needsConfirmBanner: (n: number) => `⚠ ${n} 项数字待人工确认`,
    needsConfirmHint:
      "含人工补录 / OCR 识别 / 回退推导值。可点击 🤖 AI 分析补全（或各字段旁的 🤖）由 AI 自动识别，" +
      "识别结果需你逐条「采纳」后才替换原值。",
    aiBtn: "🤖 AI 分析补全",
    aiBtnBusy: "🤖 AI 分析中…",
    aiResultFmt: (mode: string, models: string, n: number, sec: string, fallback: string) =>
      `AI 分析完成 [${mode}${fallback}] (模型：${models}) 共 ${n} 条建议（${sec}s），` +
      `请逐条核对后点击"采纳"替换原值，或"忽略"保留原数字。`,
    aiEmpty: "AI 分析完成，但未找到可补全的字段。",
    aiFailPrefix: "AI 分析失败：",
    configApiKey: "配置 API Key",
    gatesPassedLabel: "闸门通过：",
    gatesFailedLabel: "闸门失败：",
    gatesNone: "无",
    notesLabel: "备注：",
  },
  factorCard: {
    inZ: "计入 Z ✓",
    notInModel: "本模型不计",
    needsConfirm: "待确认",
    formulaLabel: "公式：",
    subLabel: "代入：",
    resultLabel: "结果：",
    coefLabel: "系数",
    contribution: (v: string) => `贡献 Z +${v}`,
    annualized: "（已年化）",
    notCounted: "（不计入）",
    storedValue: (v: string) => `（存储值 ${v}）`,
  },
  langSwitcher: {
    label: "语言",
    zh: "中文",
    en: "English",
  },
};