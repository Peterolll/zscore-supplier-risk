// lib/types.ts — 前后端共享的纯类型（无 Node 专属 import，客户端可安全引入）

export type Industry = "manufacturing" | "service";
export type Period = "annual" | "semi" | "q1" | "q2" | "q3" | "q4";
export type Gaap = "cas" | "ifrs" | "tw_gaap" | "hk_gaap" | "other";
// unknown：关键因子全部缺失，Z 不可计算（避免把"无数据"静默判成"困境区"）
export type RiskZone = "safe" | "grey" | "distress" | "unknown";
export type ZModel = "Z" | "Z'" | "Z''";

export interface FieldValue {
  value: number | null;
  evidence: string;
  source_page: number | null;
  method: string;
  confidence: number;
}

export interface ZScore {
  model: ZModel;
  z_score: number | null;
  risk_zone: RiskZone;
  annualized: boolean;
  annualize_factor: number;
  gates_passed: string[];
  gates_failed: string[];
  notes: string[];
  X1?: number | null;
  X2?: number | null;
  X3?: number | null;
  X4?: number | null;
  X5?: number | null;
}

export interface EngineResult {
  ok: boolean;
  error?: string;
  message?: string;
  profile?: {
    name: string;
    industry_class: Industry;
    period_type: Period;
    gaap: Gaap;
    currency: string;
    source_file?: string;
    listed?: boolean;
    equity_value?: number | null;
  };
  method?: "pdfplumber" | "glm_ocr" | "pptx" | "manual" | "derived";
  extraction?: { fields: Record<string, FieldValue> };
  zscore?: ZScore;
}

export interface SupplierSummary {
  id: string;
  name: string;
  industry: Industry;
  period: Period;
  gaap: Gaap;
  currency: string;
  source_file: string | null;
  listed: boolean;
  equity_value: number | null;
  created_at: string;
  runId: string;
  zScore: number | null;
  model: ZModel;
  riskZone: RiskZone;
  method: string;
  runAt: string;
}

// ---- 持久层行类型（SQLite 表结构的 TS 映射，客户端组件亦可安全引用）----

export interface SupplierRow {
  id: string;
  name: string;
  industry: Industry;
  period: Period;
  gaap: Gaap;
  currency: string;
  source_file: string | null;
  listed: number; // SQLite 无布尔类型，0/1
  equity_value: number | null;
  created_at: string;
}

export interface RunRow {
  id: string;
  supplier_id: string;
  z_score: number | null;
  model: ZModel;
  risk_zone: RiskZone;
  annualized: number; // SQLite 无布尔类型，0/1
  annualize_factor: number;
  method: string;
  gates_passed: string; // 逗号分隔
  gates_failed: string;
  notes: string;
  created_at: string;
}

export interface FactorRow {
  key: string;
  value: number | null;
}

export interface FieldRow {
  field_key: string;
  value: number | null;
  evidence: string;
  source_page: number | null;
  method: string;
  confidence: number;
}

export interface RunDetail {
  run: RunRow;
  supplier: SupplierRow;
  factors: FactorRow[];
  fields: FieldRow[];
  override?: {
    run_id: string;
    risk_override: string | null;
    risk_overridden: number;
    note: string;
    edited_at: string;
  } | null;
}

export interface AnalyzeResponse {
  ok: boolean;
  error?: string;
  message?: string;
  supplierId?: string;
  runId?: string;
  result?: EngineResult;
}
