// lib/messages/en.ts — English translations of core UI strings
// Scope (per user's "核心翻译" choice): nav / page titles / main buttons /
// Z risk zones / gate labels / key status prompts / common errors.
// Technical reports and detail-page prose remain in Chinese.
//
// Gate keys match Python m5_validate.py output verbatim (including <=, >=,
// Chinese-character keys) — UI only translates, never mutates the data.

import type { Messages } from "./types";

export const en: Messages = {
  brand: {
    shortTitle: "Supplier Z-Score",
    fullTitle: "Supplier Z-Score Risk Analyzer",
    tagline:
      "Upload financial PDFs to auto-compute Altman Z-Score and visualize supplier credit risk",
    footer:
      "Altman Z-Score auto-computation · Thresholds based on US samples; cross-border comparison is for reference only",
  },
  nav: {
    upload: "Upload",
    suppliers: "Suppliers",
    dictionary: "Dictionary",
    manual: "Manual",
    workflow: "Workflow",
  },
  homepage: {
    uploadTitle: "Upload & Analyze Financial Statements",
    recentTitle: "Recent Analyses",
    settings: "⚙ Settings",
    viewAll: "View all →",
    emptyTitle: "No analysis records yet",
    emptyHint: "Upload a financial PDF or PPTX from the left to start",
    methodLabel: "Method",
  },
  upload: {
    fileLabel: "Financial File (PDF / PPTX) *",
    fileHint:
      "{n} files selected — they will be merged into a single statement (PDF recommended; PPTX please upload separately).",
    remove: "Remove",
    nameLabel: "Supplier Name",
    namePlaceholder: "Leave blank to use the filename",
    companyType: "Company Type *",
    companyTypeHint:
      "Listed → Original Altman Z (5 factors, X4=Market Cap/Total Liabilities, thresholds 2.675/1.81); " +
      "Unlisted → Z′ (manufacturing) / Z″ (non-manufacturing), X4=Book Equity/Total Liabilities.",
    equityValueLabel: "Market Capitalization *",
    equityValuePlaceholder:
      "Stock price × Shares (or latest funding valuation), in same currency unit",
    equityValueHint:
      "Numerator for X4 of the original Z; falls back to book equity (with note) if missing.",
    industry: "Industry Type *",
    period: "Reporting Period *",
    gaap: "Accounting Standard *",
    currency: "Currency",
    submitting: "Parsing & computing…",
    submit: "Upload & Analyze",
    note:
      "Note: Company type and industry are user-confirmed; the system never auto-guesses the model. " +
      "PDF and PPTX supported. Multiple statements (e.g. balance sheet + income statement + cash flow) " +
      "can be selected together and merged. Electronic text is parsed directly; scanned files require GLM_API_KEY.",
    errNoFile:
      "Please select financial files first (PDF/PPTX; multiple PDFs can be selected and merged automatically)",
    errOcrUnavailable:
      "This statement is a scanned image. Configure GLM_API_KEY to enable GLM-4V-Flash OCR.",
    errGeneric: "Analysis failed",
  },
  suppliersPage: {
    title: (n: number) => `Suppliers (${n})`,
    emptyTitle: "Supplier library is empty",
    emptyHint: "Upload a financial statement on the homepage to begin analysis",
  },
  suppliersTable: {
    selected: (n: number) => `${n} selected (select at least 2 to compare)`,
    batchDelete: (n: number) => (n > 0 ? `Batch Delete (${n})` : "Batch Delete"),
    compareSelected: "Compare Selected",
    columns: {
      supplier: "Supplier",
      industryGaap: "Industry / Standard",
      model: "Model",
      zScore: "Z-Score",
      risk: "Risk",
      method: "Method",
      action: "Action",
    },
    delete: "Delete",
  },
  confirm: {
    batchTitle: "Batch Delete Suppliers",
    oneTitle: "Delete Supplier",
    batchMsg: (n: number) =>
      `Confirm deletion of ${n} suppliers? All historical analysis records (factors and financial fields) will be cleared and cannot be recovered.`,
    oneMsg: (name: string) =>
      `Confirm deletion of supplier “${name}”? All historical analysis records will be cleared and cannot be recovered.`,
    busy: "Deleting…",
    confirm: "Confirm Delete",
  },
  zones: {
    safe: "Safe Zone",
    grey: "Grey Zone (Caution)",
    distress: "Distress Zone",
    unknown: "Insufficient Data (Not Computable)",
  },
  enums: {
    listed: "Listed",
    unlisted: "Unlisted",
    manufacturing: "Manufacturing",
    service: "Non-Manufacturing (Service / Trade)",
    annual: "Annual",
    semi: "Semi-Annual",
    q1: "Q1",
    q2: "Q2",
    q3: "Q3",
    q4: "Q4",
    cas: "PRC GAAP (CAS)",
    ifrs: "IFRS",
    twGaap: "Taiwan GAAP",
    hkGaap: "Hong Kong GAAP",
    other: "Other",
  },
  fieldStatus: {
    notExtracted: "Not Extracted",
    manual: "Manual Entry",
    ocrPending: "OCR Pending Review",
    derived: "Derived — Pending",
    pending: "Pending Confirmation",
    confirmed: "Confirmed",
    aiSuggestion: "AI Suggestion",
  },
  gates: {
    G1_复式平衡: "G1 Balance Sheet Equation",
    "G2_CA<=TA": "G2 Current Assets ≤ Total Assets",
    "G2_CL<=TL": "G2 Current Liabilities ≤ Total Liabilities",
    "G2_EQ<=TA": "G2 Equity ≤ Total Assets",
    "G2_RE<=TA": "G2 Retained Earnings ≤ Total Assets",
    "G3_TA>0": "G3 Total Assets > 0",
    "G3_TL>=0": "G3 Total Liabilities ≥ 0",
    G4_EBIT交叉: "G4 EBIT Cross-Check",
    G5_完整性: "G5 Completeness",
  },
  detail: {
    manualOverride: "Manual Override",
    annualizedSuffix: (n: number) => ` · Annualized ×${n}`,
    companyTypeLabel: "Company Type:",
    companyTypeHint:
      "Listed → Original Z (5 factors, X4=Market Cap/Total Liabilities); Unlisted → Z′ (manuf.) / Z″ (non-manuf.)",
    industryLabel: "Industry:",
    equityLabel: "Market Capitalization:",
    equityPlaceholder: "Stock price × Shares",
    equityHint:
      "Numerator for X4 of the original Z; falls back to book equity (with note) if missing",
    factorSectionTitle: "Altman Factor Breakdown (X1–X5)",
    factorSectionHint:
      "Factors are computed by the extraction engine (read-only). Switching company type/industry changes " +
      "the Z model (Z″ omits X5 for non-manufacturing unlisted). Formulas & coefficients strictly aligned with engine (config.py).",
    fieldsSectionTitle: "Financial Field Override",
    fieldsSectionHint:
      "If extraction is incomplete or numbers are wrong, manually fill or correct the underlying items here. " +
      "Saved changes will recompute Altman factors and Z, and mark the entry as “Manual Entry” in the evidence table. " +
      "Unit and currency are consistent (元 / Yuan).",
    acceptBtn: "✓ Accept",
    dismissBtn: "✗ Dismiss",
    acceptDismissHint: (v: number) =>
      `Accept = replace with ${v.toLocaleString("en-US")} · Dismiss = keep original`,
    placeholderEmpty: "Not extracted — manually fill or click 🤖",
    finalRisk: "Final Risk Rating",
    followCalc: (zone: string) => `Follow Computation (${zone})`,
    noteLabel: "Manual Note",
    notePlaceholder: "Record reason for manual override (e.g. industry judgment, special items)",
    saving: "Saving…",
    save: "Save Changes",
    exportExcel: "Export Excel",
    saveFailPrefix: "Save failed: ",
    savePartial: (n: number) => `Saved ${n} overrides and recomputed Z ✅`,
    saveOk: "Saved ✅",
    needsConfirmBanner: (n: number) => `⚠ ${n} value${n === 1 ? "" : "s"} need manual confirmation`,
    needsConfirmHint:
      "Includes manual entries / OCR readings / fallback derivations. Click 🤖 AI Analyze (or 🤖 per field) " +
      "to auto-recognize; results require you to click “Accept” for each suggestion before replacing the original.",
    aiBtn: "🤖 AI Analyze",
    aiBtnBusy: "🤖 AI Analyzing…",
    aiResultFmt: (mode: string, models: string, n: number, sec: string, fallback: string) =>
      `AI analysis complete [${mode}${fallback}] (models: ${models}) — ${n} suggestions (${sec}s). ` +
      `Please review and click “Accept” to replace, or “Dismiss” to keep the original.`,
    aiEmpty: "AI analysis complete, but no fields to fill.",
    aiFailPrefix: "AI analysis failed: ",
    configApiKey: "Configure API Key",
    gatesPassedLabel: "Gates Passed:",
    gatesFailedLabel: "Gates Failed:",
    gatesNone: "None",
    notesLabel: "Notes:",
  },
  factorCard: {
    inZ: "Included in Z ✓",
    notInModel: "Not in this model",
    needsConfirm: "Needs Confirmation",
    formulaLabel: "Formula:",
    subLabel: "Substituted:",
    resultLabel: "Result:",
    coefLabel: "Coefficient",
    contribution: (v: string) => `Contribution Z +${v}`,
    annualized: "(Annualized)",
    notCounted: "(not counted)",
    storedValue: (v: string) => `(stored value ${v})`,
  },
  langSwitcher: {
    label: "Language",
    zh: "中文",
    en: "English",
  },
};