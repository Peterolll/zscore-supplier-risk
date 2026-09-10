// lib/messages/types.ts — 核心 i18n 文案类型契约
// 「核心翻译」范围内：nav / 页面标题 / 主要按钮 / Z 风险区 / 闸门标签 / 关键状态提示 / 通用错误
// 技术报告、详情页正文段落、加载提示等仍保留中文（避免过度翻译）。

export type Lang = "zh" | "en";

export interface Messages {
  // 顶部
  brand: {
    shortTitle: string;       // "供应商 Z-Score"
    fullTitle: string;        // "供应商 Z-Score 风险分析"
    tagline: string;          // 上传财报 PDF，自动计算 Altman Z-Score 并可视化供应商信用风险
    footer: string;           // footer 注脚
  };
  // 导航
  nav: {
    upload: string;           // "上传分析"
    suppliers: string;        // "供应商库"
    dictionary: string;       // "数据字典"
    manual: string;           // "用户手册"
    workflow: string;         // "计算工作流"
  };
  // 首页
  homepage: {
    uploadTitle: string;      // "上传财报并分析"
    recentTitle: string;      // "最近分析"
    settings: string;         // "⚙ 设置"
    viewAll: string;          // "查看全部 →"
    emptyTitle: string;       // "还没有分析记录"
    emptyHint: string;        // 从左侧上传一份财报 PDF 或 PPTX 开始分析
    methodLabel: string;      // 列表行尾部"方法/时间"
  };
  // 上传表单
  upload: {
    fileLabel: string;        // "财报文件（PDF / PPTX）*"
    fileHint: string;         // 多文件提示
    remove: string;           // "移除"
    nameLabel: string;        // "供应商名称"
    namePlaceholder: string;  // "留空则取文件名"
    companyType: string;      // "公司类型 *"
    companyTypeHint: string;  // 上市/非上市说明
    equityValueLabel: string; // "股权价值（市值）*"
    equityValuePlaceholder: string; // "股价 × 股本..."
    equityValueHint: string;  // "原始 Z 的 X4 分子..."
    industry: string;         // "行业类型 *"
    period: string;           // "报告期 *"
    gaap: string;             // "会计准则 *"
    currency: string;         // "币种"
    submitting: string;       // "解析与计算中…"
    submit: string;           // "上传并分析"
    note: string;             // 底部提示段落
    errNoFile: string;        // 没选文件
    errOcrUnavailable: string;// 扫描件 OCR 不可用
    errGeneric: string;       // "分析失败"
  };
  // 供应商库列表
  suppliersPage: {
    title: (n: number) => string; // "供应商库（{n}）"
    emptyTitle: string;     // "供应商库为空"
    emptyHint: string;      // "请先在首页上传财报进行分析"
  };
  // 供应商库表格
  suppliersTable: {
    selected: (n: number) => string; // "已选 {n} 项（至少选 2 项可对比）"
    batchDelete: (n: number) => string; // "批量删除{n>0?'('+n+')':''}"
    compareSelected: string;          // "对比所选"
    columns: {
      supplier: string;       // "供应商"
      industryGaap: string;  // "行业/准则"
      model: string;         // "模型"
      zScore: string;        // "Z-Score"
      risk: string;          // "风险"
      method: string;        // "方式"
      action: string;        // "操作"
    };
    delete: string;          // "删除"
  };
  // 删除确认对话框
  confirm: {
    batchTitle: string;      // "批量删除供应商"
    oneTitle: string;        // "删除供应商"
    batchMsg: (n: number) => string; // "确认删除选中的 {n} 个供应商？..."
    oneMsg: (name: string) => string; // "确认删除供应商「{name}」？..."
    busy: string;            // "删除中…"
    confirm: string;         // "确认删除"
  };
  // 风险区标签（与 ZONE_LABELS 平行）
  zones: {
    safe: string;            // "安全区"
    grey: string;            // "灰色区(警惕)"
    distress: string;        // "困境区"
    unknown: string;         // "数据不足(不可计算)"
  };
  // 行业/期间/会计准则/上市标签
  enums: {
    listed: string;          // "上市公司"
    unlisted: string;        // "非上市公司"
    manufacturing: string;   // "制造业"
    service: string;         // "非制造业(服务/贸易)"
    annual: string;          // "年度"
    semi: string;            // "半年度"
    q1: string;              // "一季度"
    q2: string;              // "二季度"
    q3: string;              // "三季度"
    q4: string;              // "四季度"
    cas: string;             // "中国企业准则(CAS)"
    ifrs: string;            // "国际准则(IFRS)"
    twGaap: string;          // "台湾准则"
    hkGaap: string;          // "香港准则"
    other: string;           // "其他"
  };
  // 字段确认状态（fieldStatus 输出）
  fieldStatus: {
    notExtracted: string;    // "未提取"
    manual: string;          // "人工补录"
    ocrPending: string;      // "OCR待核"
    derived: string;         // "推算待确认"
    pending: string;         // "待确认"
    confirmed: string;       // "已确认"
    aiSuggestion: string;    // "AI 建议"
  };
  // 闸门标签（按 Python m5_validate 输出的 key 翻译）
  gates: Record<string, string>;
  // 详情页核心字符串
  detail: {
    manualOverride: string;  // "人工覆盖"
    annualizedSuffix: (n: number) => string; // " · 流量年化×{n}"
    companyTypeLabel: string; // "公司类型："
    companyTypeHint: string;  // 切换公司类型提示
    industryLabel: string;    // "行业类型："
    equityLabel: string;      // "股权价值（市值）："
    equityPlaceholder: string;// "股价 × 股本"
    equityHint: string;       // "原始 Z 的 X4 分子..."
    factorSectionTitle: string; // "Altman 子指标计算明细（X1–X5）"
    factorSectionHint: string;  // 子指标说明
    fieldsSectionTitle: string; // "财务字段修正"
    fieldsSectionHint: string;  // 字段修正说明
    acceptBtn: string;        // "✓ 采纳"
    dismissBtn: string;       // "✗ 忽略"
    acceptDismissHint: (v: number) => string; // "采纳=替换为{v} · 忽略=保留原值"
    placeholderEmpty: string; // "未提取，可手填或点 🤖"
    finalRisk: string;        // "最终风险评级"
    followCalc: (zone: string) => string; // "跟随计算（{zone}）"
    noteLabel: string;        // "人工备注"
    notePlaceholder: string;  // "记录人工修正理由..."
    saving: string;           // "保存中…"
    save: string;             // "保存修改"
    exportExcel: string;      // "导出 Excel"
    saveFailPrefix: string;   // "保存失败："
    savePartial: (n: number) => string; // "已保存 {n} 项修正并重新计算 Z ✅"
    saveOk: string;           // "已保存 ✅"
    needsConfirmBanner: (n: number) => string; // "{n} 项数字待人工确认"
    needsConfirmHint: string; // 含人工补录...提示
    aiBtn: string;            // "🤖 AI 分析补全"
    aiBtnBusy: string;        // "🤖 AI 分析中…"
    aiResultFmt: (mode: string, models: string, n: number, sec: string, fallback: string) => string;
    aiEmpty: string;          // "AI 分析完成，但未找到可补全的字段。"
    aiFailPrefix: string;     // "AI 分析失败："
    configApiKey: string;     // "配置 API Key"
    gatesPassedLabel: string; // "闸门通过："
    gatesFailedLabel: string; // "闸门失败："
    gatesNone: string;        // "无"
    notesLabel: string;       // "备注："
  };
  // 因子计算卡片
  factorCard: {
    inZ: string;             // "计入 Z ✓"
    notInModel: string;      // "本模型不计"
    needsConfirm: string;    // "待确认"
    formulaLabel: string;    // "公式："
    subLabel: string;        // "代入："
    resultLabel: string;     // "结果："
    coefLabel: string;       // "系数"
    contribution: (v: string) => string; // "贡献 Z +{v}"
    annualized: string;      // "（已年化）"
    notCounted: string;      // "（不计入）"
    storedValue: (v: string) => string; // "（存储值 {v}）"
  };
  // 语言切换器
  langSwitcher: {
    label: string;           // "语言"
    zh: string;              // "中文"
    en: string;              // "English"
  };
}