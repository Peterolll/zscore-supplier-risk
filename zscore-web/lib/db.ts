// lib/db.ts — 基于 Node 内置 node:sqlite 的持久化层（SQLite 文件，本机运行）
// 表：supplier / zscore_run / factor / financial_field
// 设计：同一供应商名复用同一 supplier 行，多次上传累积为历史 run（支持多期对比）。

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  SupplierSummary,
  Industry,
  Period,
  Gaap,
  RiskZone,
  ZModel,
  SupplierRow,
  RunRow,
  FactorRow,
  FieldRow,
  RunDetail,
  SourceEvidence,
  Candidate,
} from "./types";
import { audit } from "./audit";
import { computeZ, zoneOf, modelForProfile } from "./zscore";

/**
 * node:sqlite 的 all()/get() 返回 null-prototype 对象（Object.create(null)）。
 * React Server Components 只允许把「普通对象」传给客户端组件，
 * 否则报 "Only plain objects... can be passed to Client Components"。
 * 这里在数据层统一归一化，杜绝该问题外溢到每个页面。
 */
function toPlain<T>(row: unknown): T | null {
  if (row == null) return null;
  return { ...(row as object) } as T;
}

function toPlainList<T>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as object) }) as T);
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "zscore.db");

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // 开启 WAL 模式：提升并发读写性能，避免读写互斥
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL"); // WAL 下 NORMAL 足够安全且更快
  db.exec("PRAGMA busy_timeout=5000");   // 锁等待 5s
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplier (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT NOT NULL,
      period TEXT NOT NULL,
      gaap TEXT NOT NULL,
      currency TEXT DEFAULT 'CNY',
      source_file TEXT,
      listed INTEGER DEFAULT 0,
      equity_value REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS zscore_run (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      z_score REAL,
      model TEXT,
      risk_zone TEXT,
      annualized INTEGER DEFAULT 0,
      annualize_factor REAL DEFAULT 1.0,
      method TEXT,
      gates_passed TEXT DEFAULT '',
      gates_failed TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS factor (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      key TEXT,
      value REAL,
      FOREIGN KEY (run_id) REFERENCES zscore_run(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS financial_field (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      field_key TEXT,
      value REAL,
      evidence TEXT DEFAULT '',
      source_page INTEGER,
      method TEXT DEFAULT '',
      confidence REAL DEFAULT 1.0,
      FOREIGN KEY (run_id) REFERENCES zscore_run(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS result_override (
      run_id TEXT PRIMARY KEY,
      risk_override TEXT,
      risk_overridden INTEGER DEFAULT 0,
      note TEXT DEFAULT '',
      edited_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dict_gap (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      value REAL,
      page INTEGER,
      sample TEXT DEFAULT '',
      suggested_field TEXT,
      suggested_kind TEXT,
      status TEXT DEFAULT 'pending',
      resolution TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_run_supplier ON zscore_run(supplier_id);
  `);
  // 迁移：旧库 supplier 表可能缺 listed / equity_value 列，按需补列
  const cols = db.prepare("PRAGMA table_info(supplier)").all() as { name: string }[];
  const colNames = cols.map((c) => c.name);
  if (!colNames.includes("listed")) {
    db.exec("ALTER TABLE supplier ADD COLUMN listed INTEGER DEFAULT 0");
  }
  if (!colNames.includes("equity_value")) {
    db.exec("ALTER TABLE supplier ADD COLUMN equity_value REAL");
  }
  const runCols = new Set((db.prepare("PRAGMA table_info(zscore_run)").all() as { name: string }[]).map(c => c.name));
  if (!runCols.has("profile_snapshot")) db.exec("ALTER TABLE zscore_run ADD COLUMN profile_snapshot TEXT");
  if (!runCols.has("ebit_derived")) {
    db.exec("ALTER TABLE zscore_run ADD COLUMN ebit_derived INTEGER DEFAULT 0");
    db.exec("UPDATE zscore_run SET ebit_derived = 1 WHERE NOT EXISTS (SELECT 1 FROM financial_field WHERE run_id=zscore_run.id AND field_key='ebit') OR id IN (SELECT run_id FROM financial_field WHERE field_key = 'ebit' AND (method = 'derived' OR evidence LIKE '%PBT%'))");
  }
  db.exec(`UPDATE zscore_run SET z_score=NULL,
    risk_zone=COALESCE((SELECT risk_override FROM result_override WHERE run_id=zscore_run.id AND risk_overridden=1),'unknown')
    WHERE z_score IS NOT NULL AND (
      (SELECT COUNT(DISTINCT key) FROM factor WHERE run_id=zscore_run.id AND key IN ('X1','X2','X3','X4') AND value IS NOT NULL) < 4
      OR (model IN ('Z','Z''') AND NOT EXISTS (SELECT 1 FROM factor WHERE run_id=zscore_run.id AND key='X5' AND value IS NOT NULL)))`);
  for (const column of ["trace_id", "extraction_json"]) {
    if (!runCols.has(column)) db.exec(`ALTER TABLE zscore_run ADD COLUMN ${column} TEXT`);
  }
  const fieldCols = new Set((db.prepare("PRAGMA table_info(financial_field)").all() as {name:string}[]).map(c=>c.name));
  for (const column of ["provenance_json","dependencies_json"]) {
    if (!fieldCols.has(column)) db.exec(`ALTER TABLE financial_field ADD COLUMN ${column} TEXT DEFAULT '[]'`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS run_trace (
    trace_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,kind TEXT,created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(run_id) REFERENCES zscore_run(id) ON DELETE CASCADE)`);
  db.exec(`CREATE TABLE IF NOT EXISTS review_suggestion (
    id TEXT PRIMARY KEY,run_id TEXT NOT NULL,field_key TEXT NOT NULL,old_value REAL,new_value REAL,payload TEXT NOT NULL,trace_id TEXT,
    created_at TEXT DEFAULT (datetime('now')), accepted_at TEXT,
    FOREIGN KEY(run_id) REFERENCES zscore_run(id) ON DELETE CASCADE)`);
  const suggestionColumns=new Set((db.prepare("PRAGMA table_info(review_suggestion)").all() as {name:string}[]).map(c=>c.name));
  if(!suggestionColumns.has("dismissed_at"))db.exec("ALTER TABLE review_suggestion ADD COLUMN dismissed_at TEXT");

  _db = db;
  return _db;
}

export interface AnalysisInput {
  profile: {
    name: string;
    industry_class: string;
    period_type: string;
    flow_basis?: "ytd" | "quarter";
    gaap: string;
    currency: string;
    source_file?: string;
    listed?: boolean;
    equity_value?: number | null;
  };
  method: string;
  zscore: {
    model: string;
    z_score: number | null;
    risk_zone: string;
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
  };
  extraction: {
    trace_id?: string;
    candidates?: Candidate[];
    warnings?: string[];
    fields: Record<string, {
      provenance?: SourceEvidence[];
      dependencies?: string[];
      value: number | null;
      evidence: string;
      source_page: number | null;
      method: string;
      confidence: number;
    }>;
  };
}

export function saveAnalysis(input: AnalysisInput): { supplierId: string; runId: string } {
  const db = getDb();
  db.exec("BEGIN TRANSACTION");
  try {
    return saveAnalysisTx(db, input);
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* 事务可能已被 SQLite 自动回滚，忽略 */
    }
    throw e;
  }
}

function saveAnalysisTx(
  db: DatabaseSync,
  input: AnalysisInput
): { supplierId: string; runId: string } {
  // 复用同名供应商，否则新建
  const existing = db
    .prepare("SELECT id FROM supplier WHERE name = ?")
    .get(input.profile.name) as { id: string } | undefined;
  let supplierId: string;
  const listedFlag = input.profile.listed ? 1 : 0;
  const equityVal = input.profile.equity_value ?? null;
  if (existing) {
    supplierId = existing.id;
    db.prepare(
      "UPDATE supplier SET industry=?, period=?, gaap=?, currency=?, source_file=?, listed=?, equity_value=? WHERE id=?"
    ).run(
      input.profile.industry_class,
      input.profile.period_type,
      input.profile.gaap,
      input.profile.currency,
      input.profile.source_file ?? null,
      listedFlag,
      equityVal,
      supplierId
    );
  } else {
    supplierId = randomUUID();
    db.prepare(
      "INSERT INTO supplier (id, name, industry, period, gaap, currency, source_file, listed, equity_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      supplierId,
      input.profile.name,
      input.profile.industry_class,
      input.profile.period_type,
      input.profile.gaap,
      input.profile.currency,
      input.profile.source_file ?? null,
      listedFlag,
      equityVal
    );
  }

  const runId = randomUUID();
  const requiresConfirmation = input.method !== "manual";
  const z = { ...input.zscore };
  if (requiresConfirmation) {
    for (const key of ["X1","X2","X3","X4","X5"] as const) if(z[key] !== undefined) z[key]=null;
    z.gates_passed=[]; z.gates_failed=["G5_因子完整性"]; z.notes=["提取结果待用户确认，确认前不写入财务数值或计算风险评级"];
  }
  z.z_score = computeZ(z, z.model as ZModel);
  z.risk_zone = zoneOf(z.z_score, z.model as ZModel);
  db.prepare(
    `INSERT INTO zscore_run
      (id, supplier_id, z_score, model, risk_zone, annualized, annualize_factor, method, gates_passed, gates_failed, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    supplierId,
    z.z_score,
    z.model,
    z.risk_zone,
    z.annualized ? 1 : 0,
    z.annualize_factor,
    input.method,
    z.gates_passed.join(","),
    z.gates_failed.join(","),
    z.notes.join(",")
  );

  const snapshot = {
    name: input.profile.name, industry: input.profile.industry_class,
    period: input.profile.period_type, gaap: input.profile.gaap,
    currency: input.profile.currency, source_file: input.profile.source_file ?? null,
    listed: listedFlag, equity_value: equityVal, flow_basis: input.profile.flow_basis ?? "ytd",
  };
  const ebit = input.extraction.fields.ebit;
  const derived = !ebit || ebit.method === "derived" || /PBT/.test(ebit.evidence);
  db.prepare("UPDATE zscore_run SET profile_snapshot = ?, ebit_derived = ? WHERE id = ?")
    .run(JSON.stringify(snapshot), derived ? 1 : 0, runId);

  db.prepare("UPDATE zscore_run SET trace_id=?,extraction_json=? WHERE id=?")
    .run(input.extraction.trace_id ?? null,JSON.stringify(input.extraction),runId);
  if(input.extraction.trace_id) db.prepare("INSERT INTO run_trace (trace_id,run_id,kind) VALUES (?,?,?)")
    .run(input.extraction.trace_id,runId,'upload');
  const factorStmt = db.prepare("INSERT INTO factor (id, run_id, key, value) VALUES (?, ?, ?, ?)");
  const factorMap: Record<string, number | null | undefined> = {
    X1: z.X1,
    X2: z.X2,
    X3: z.X3,
    X4: z.X4,
    X5: z.X5,
  };
  for (const k of ["X1", "X2", "X3", "X4", "X5"]) {
    const v = factorMap[k];
    // Z'' 模型无 X5，undefined 表示该因子不适用，不落库
    if (v !== undefined) factorStmt.run(randomUUID(), runId, k, v);
  }

  const fieldStmt = db.prepare(
    "INSERT INTO financial_field (id, run_id, field_key, value, evidence, source_page, method, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const [key, f] of Object.entries(input.extraction.fields)) {
    fieldStmt.run(
      randomUUID(),
      runId,
      key,
      requiresConfirmation ? null : f.value,
      requiresConfirmation ? "待确认提取结果" : f.evidence,
      requiresConfirmation ? null : f.source_page,
      f.method,
      requiresConfirmation ? 0 : f.confidence
    );
    db.prepare("UPDATE financial_field SET provenance_json=?,dependencies_json=? WHERE run_id=? AND field_key=?")
      .run(JSON.stringify(requiresConfirmation ? [] : f.provenance ?? []),JSON.stringify(requiresConfirmation ? [] : f.dependencies ?? []),runId,key);
  }

  if(requiresConfirmation) {
    const statement=db.prepare("INSERT INTO review_suggestion (id,run_id,field_key,old_value,new_value,payload,trace_id) VALUES (?,?,?,?,?,?,?)");
    for(const [field_key,f] of Object.entries(input.extraction.fields)) if(f.value !== null) {
      const id=randomUUID();
      const payload={...f,id,field_key,old_value:null,provenance:f.provenance ?? [],dependencies:f.dependencies ?? []};
      statement.run(id,runId,field_key,null,f.value,JSON.stringify(payload),input.extraction.trace_id ?? runId);
    }
  }
  db.exec("COMMIT");
  return { supplierId, runId };
}

export type { SupplierSummary };

export function listSuppliers(): SupplierSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.*, r.id AS runId, r.z_score AS zScore, r.model, r.risk_zone AS riskZone,
              r.method, r.created_at AS runAt, r.profile_snapshot
       FROM supplier s
       LEFT JOIN zscore_run r ON r.supplier_id = s.id
       WHERE r.id = (SELECT id FROM zscore_run WHERE supplier_id = s.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
       ORDER BY r.created_at DESC`
    )
    .all() as unknown as JoinedSupplierRow[];
  return rows.map((row) => {
    const r = { ...row, ...(row.profile_snapshot ? JSON.parse(row.profile_snapshot) : {period:"unknown",gaap:"unknown",currency:"未知",source_file:null,equity_value:null}) };
    return ({
    id: r.id,
    name: r.name,
    industry: r.industry as Industry,
    period: r.period as Period,
    gaap: r.gaap as Gaap,
    currency: r.currency,
    source_file: r.source_file,
    listed: r.listed === 1,
    equity_value: r.equity_value,
    created_at: r.created_at,
    runId: r.runId,
    zScore: r.zScore,
    model: r.model as ZModel,
    riskZone: r.riskZone as RiskZone,
    method: r.method,
    runAt: r.runAt,
  });
  });
}

interface JoinedSupplierRow extends SupplierRow {
  profile_snapshot: string | null;
  runId: string;
  zScore: number | null;
  model: string;
  riskZone: string;
  method: string;
  runAt: string;
}

export function getRunDetail(runId: string): RunDetail | null {
  const db = getDb();
  const run = toPlain<RunRow>(
    db.prepare("SELECT * FROM zscore_run WHERE id = ?").get(runId)
  );
  if (!run) return null;
  const supplier = toPlain<SupplierRow>(
    db.prepare("SELECT * FROM supplier WHERE id = ?").get(run.supplier_id)
  );
  if (!supplier) return null;
  const factors = toPlainList<FactorRow>(
    db.prepare("SELECT key, value FROM factor WHERE run_id = ? ORDER BY key").all(runId)
  );
  const fields = toPlainList<FieldRow>(
    db
      .prepare(
        "SELECT field_key, value, evidence, source_page, method, confidence, provenance_json, dependencies_json FROM financial_field WHERE run_id = ?"
      )
      .all(runId)
  );
  for (const field of fields) {
    const raw = field as FieldRow & {provenance_json?:string;dependencies_json?:string};
    field.provenance=JSON.parse(raw.provenance_json || '[]');
    field.dependencies=JSON.parse(raw.dependencies_json || '[]');
    delete raw.provenance_json; delete raw.dependencies_json;
  }
  const override = toPlain<{
    run_id: string;
    risk_override: string | null;
    risk_overridden: number;
    note: string;
    edited_at: string;
  }>(db.prepare("SELECT * FROM result_override WHERE run_id = ?").get(runId));
  // Legacy runs cannot recover their report metadata from the mutable supplier row.
  const reportSupplier: SupplierRow = run.profile_snapshot
    ? { ...supplier, ...JSON.parse(run.profile_snapshot) }
    : { ...supplier, name: supplier.name, industry: run.model === "Z''" ? "service" : "manufacturing",
        period: "unknown", gaap: "unknown", currency: "未知 / Unknown",
        source_file: null, equity_value: null, listed: run.model === "Z" ? 1 : 0, metadata_unknown: true };
  const pendingSuggestions=(db.prepare("SELECT payload FROM review_suggestion WHERE run_id=? AND accepted_at IS NULL AND dismissed_at IS NULL ORDER BY rowid").all(runId) as {payload:string}[])
    .map(r=>JSON.parse(r.payload)).filter(s=>s.old_value === (fields.find(f=>f.field_key===s.field_key)?.value ?? null));
  return { run, supplier: reportSupplier, factors, fields, pendingSuggestions, override: override ?? null };
}

export function getSupplierWithRuns(
  supplierId: string
): { supplier: SupplierRow; runs: RunRow[] } | null {
  const db = getDb();
  const supplier = toPlain<SupplierRow>(
    db.prepare("SELECT * FROM supplier WHERE id = ?").get(supplierId)
  );
  if (!supplier) return null;
  const runs = toPlainList<RunRow>(
    db
      .prepare("SELECT * FROM zscore_run WHERE supplier_id = ? ORDER BY created_at DESC")
      .all(supplierId)
  );
  return { supplier, runs };
}

export function getComparison(runIds: string[]): RunDetail[] {
  const out: RunDetail[] = [];
  for (const rid of runIds) {
    const d = getRunDetail(rid);
    if (d) out.push(d);
  }
  return out;
}

// ---- 结果覆盖 / 重算（网页端人工修正入口）----

export interface SaveOverrideInput {
  acceptedSuggestions?: Record<string,string>;
  fields?: Record<string, number | null>;
  riskOverride?: RiskZone | null;
  note?: string;
  industry?: Industry;
  listed?: boolean;
  equityValue?: number | null;
}

export function saveResultOverride(runId: string, input: SaveOverrideInput): void {
  const db = getDb();
  db.exec("BEGIN TRANSACTION");
  try {
    const detail = getRunDetail(runId);
    if (!detail) throw new Error("RUN_NOT_FOUND");
    const { run } = detail;
    const risk = input.riskOverride === undefined ? detail.override?.risk_override ?? null : input.riskOverride;
    const writeOverride = () => db.prepare(
      `INSERT INTO result_override (run_id,risk_override,risk_overridden,note,edited_at) VALUES (?,?,?,?,datetime('now'))
       ON CONFLICT(run_id) DO UPDATE SET risk_override=excluded.risk_override,risk_overridden=excluded.risk_overridden,note=excluded.note,edited_at=excluded.edited_at`
    ).run(runId, risk, Number(risk !== null), input.note ?? detail.override?.note ?? "");
    const hasCalculationChange = Object.keys(input.fields ?? {}).length > 0 ||
      (input.industry !== undefined && input.industry !== detail.supplier.industry) ||
      (input.listed !== undefined && input.listed !== (detail.supplier.listed === 1)) ||
      (input.equityValue !== undefined && input.equityValue !== detail.supplier.equity_value);
    if (!hasCalculationChange) {
      db.prepare("UPDATE zscore_run SET risk_zone=? WHERE id=?")
        .run(risk ?? zoneOf(run.z_score, run.model), runId);
      writeOverride();
      db.exec("COMMIT");
      return;
    }
    const profile = { ...detail.supplier };
    profile.industry = input.industry ?? profile.industry;
    profile.listed = input.listed === undefined ? profile.listed : Number(input.listed);
    if (input.equityValue !== undefined) profile.equity_value = input.equityValue;
    const patch = { ...input.fields };
    if (Object.hasOwn(patch, "equity_value")) profile.equity_value = patch.equity_value;
    const writeField = (key: string, value: number | null, method: string, evidence: string) => {
      const found = db.prepare("SELECT id FROM financial_field WHERE run_id=? AND field_key=?").get(runId, key);
      if (found) db.prepare("UPDATE financial_field SET value=?, method=?, evidence=?, confidence=?, source_page=NULL WHERE run_id=? AND field_key=?")
        .run(value, method, evidence, method === "manual" ? 1 : 0.9, runId, key);
      else db.prepare("INSERT INTO financial_field (id,run_id,field_key,value,method,evidence,confidence) VALUES (?,?,?,?,?,?,?)")
        .run(randomUUID(), runId, key, value, method, evidence, method === "manual" ? 1 : 0.9);
    };
    for (const [key, value] of Object.entries(patch)) {
      const suggestionId=input.acceptedSuggestions?.[key];
      const record=suggestionId ? db.prepare("SELECT * FROM review_suggestion WHERE id=? AND run_id=? AND field_key=? AND accepted_at IS NULL AND dismissed_at IS NULL").get(suggestionId,runId,key) as {old_value:number|null;new_value:number|null;payload:string;trace_id:string} | undefined : undefined;
      const old=detail.fields.find(f=>f.field_key===key)?.value ?? null;
      if (suggestionId && (!record || record.old_value!==old || record.new_value!==value)) throw new Error("STALE_SUGGESTION");
      writeField(key,value,record ? JSON.parse(record.payload).method || 'ai_analyze' : 'manual',record ? JSON.parse(record.payload).evidence : '人工补录');
      const suggested=record ? JSON.parse(record.payload) as {provenance:SourceEvidence[];dependencies:string[];confidence:number} : null;
      db.prepare("UPDATE financial_field SET provenance_json=?,dependencies_json=?,confidence=?,source_page=? WHERE run_id=? AND field_key=?")
        .run(JSON.stringify(suggested?.provenance ?? []),JSON.stringify(suggested?.dependencies ?? []),suggested?.confidence ?? 1,suggested?.provenance?.[0]?.page ?? null,runId,key);
      if(record) {
        db.prepare("UPDATE review_suggestion SET accepted_at=datetime('now') WHERE id=?").run(suggestionId!);
        audit(record.trace_id,'review.accept_requested',{run_id:runId,field:key,old_value:old,new_value:value,suggestion_id:suggestionId});
      } else if (run.trace_id) audit(run.trace_id,'field.edit_requested',{run_id:runId,field:key,old_value:old,new_value:value});
    }
    if (input.equityValue !== undefined) writeField("equity_value", input.equityValue, "manual", "人工补录市值");
    const fields = Object.fromEntries((db.prepare("SELECT field_key,value FROM financial_field WHERE run_id=?").all(runId) as {field_key:string;value:number|null}[]).map(f => [f.field_key,f.value]));
    const v = (k: string): number | null => Number.isFinite(fields[k]) ? fields[k] : null;
    const retained=detail.fields.find(f=>f.field_key==='retained_earnings');
    if (!Object.hasOwn(patch,'retained_earnings') &&
        (Object.hasOwn(patch,'surplus_reserve') || Object.hasOwn(patch,'undistributed_profit')) &&
        (!retained || retained.method==='derived' || retained.dependencies?.length)) {
      const surplus=v('surplus_reserve'),profit=v('undistributed_profit');
      fields.retained_earnings=surplus===null || profit===null ? null : surplus+profit;
      writeField('retained_earnings',fields.retained_earnings,'derived','盈余公积+未分配利润（组件不全则待确认）');
      const roots=db.prepare("SELECT provenance_json FROM financial_field WHERE run_id=? AND field_key IN ('surplus_reserve','undistributed_profit')").all(runId) as {provenance_json:string}[];
      db.prepare("UPDATE financial_field SET provenance_json=?,dependencies_json=? WHERE run_id=? AND field_key='retained_earnings'")
        .run(JSON.stringify(roots.flatMap(f=>JSON.parse(f.provenance_json || '[]'))),JSON.stringify(['surplus_reserve','undistributed_profit']),runId);
    }
    let derived = run.ebit_derived === 1;
    if (Object.hasOwn(patch, "ebit")) {
      const row=db.prepare("SELECT dependencies_json FROM financial_field WHERE run_id=? AND field_key='ebit'").get(runId) as {dependencies_json:string};
      derived=JSON.parse(row.dependencies_json || '[]').some((k:string)=>['profit_before_tax','net_profit','interest_expense'].includes(k));
    }
    if (derived && !Object.hasOwn(patch,"ebit") && ["profit_before_tax","interest_expense","net_profit","income_tax"].some(k=>Object.hasOwn(patch,k))) {
      const parts=v("profit_before_tax")!==null ? ["profit_before_tax","interest_expense"] : ["net_profit","income_tax","interest_expense"];
      const complete=parts.every(k=>v(k)!==null);
      fields.ebit=complete ? parts.reduce((sum,k)=>sum+v(k)!,0) : null;
      writeField("ebit",fields.ebit,"derived",complete ? parts.join(" + ") : "EBIT推导数据不完整，财务费用不替代利息费用");
      const origins=db.prepare("SELECT field_key,provenance_json FROM financial_field WHERE run_id=?").all(runId) as {field_key:string;provenance_json:string}[];
      db.prepare("UPDATE financial_field SET provenance_json=?,dependencies_json=? WHERE run_id=? AND field_key='ebit'")
        .run(JSON.stringify(origins.filter(f=>parts.includes(f.field_key)).flatMap(f=>JSON.parse(f.provenance_json || '[]'))),JSON.stringify(parts),runId);
    }

    const divide = (a: number | null, b: number | null) => a === null || b === null || b <= 0 ? null : a / b;
    const ca=v("current_assets"), cl=v("current_liabilities"), ta=v("total_assets"), tl=v("total_liabilities");
    const ebit=v("ebit"), revenue=v("revenue");
    const x = {
      X1: divide(ca === null || cl === null ? null : ca-cl, ta),
      X2: divide(v("retained_earnings"), ta),
      X3: divide(ebit === null ? null : ebit*run.annualize_factor, ta),
      X4: divide(profile.listed ? profile.equity_value ?? v("equity_total") : v("equity_total"), tl),
      X5: divide(revenue === null ? null : revenue*run.annualize_factor, ta),
    };
    for (const [key,value] of Object.entries(x)) {
      db.prepare("DELETE FROM factor WHERE run_id=? AND key=?").run(runId,key);
      db.prepare("INSERT INTO factor (id,run_id,key,value) VALUES (?,?,?,?)").run(randomUUID(),runId,key,value);
    }
    const model = modelForProfile(profile.listed === 1, profile.industry);
    const z = computeZ(x, model);
    const passed: string[] = [], failed: string[] = [];
    const check = (key: string, ok: boolean) => (ok ? passed : failed).push(key);
    const eq=v("equity_total"), re=v("retained_earnings"), pbt=v("profit_before_tax"), interest=v("interest_expense");
    const independent=(keys:string[])=>keys.every(k=>{
      const row=db.prepare("SELECT method,dependencies_json FROM financial_field WHERE run_id=? AND field_key=?").get(runId,k) as {method:string;dependencies_json:string}|undefined;
      return row && row.method!=='derived' && JSON.parse(row.dependencies_json || '[]').length===0;
    });
    if(independent(['total_assets','total_liabilities','equity_total'])) check("G1_复式平衡", ta !== null && ta !== 0 && tl !== null && eq !== null && Math.abs(ta-tl-eq)<=.01*Math.abs(ta));
    for (const [key,a,b] of [["G2_CA<=TA",ca,ta],["G2_CL<=TL",cl,tl],["G2_EQ<=TA",eq,ta],["G2_RE<=TA",re,ta]] as const)
      check(key,a !== null && b !== null && a<=b);
    check("G3_TA>0",ta !== null && ta>0);
    check("G3_TL>=0",tl !== null && tl>=0);
    if (ebit !== null && pbt !== null && interest !== null && independent(["ebit","profit_before_tax","interest_expense"])) check("G4_EBIT交叉",Math.abs(ebit-pbt-(interest??0))<=.01*Math.max(Math.abs(ebit),1));
    const required=["current_assets","current_liabilities","total_assets","total_liabilities","equity_total","retained_earnings","ebit",...(model === "Z''" ? [] : ["revenue"])];
    check("G5_完整性",required.every(k=>v(k)!==null));
    for (const [name,keys,subtract] of [
      ['G6_净利润勾稽',['profit_before_tax','income_tax','net_profit'],true],
      ['G7_资产分项勾稽',['current_assets','noncurrent_assets','total_assets'],false],
      ['G8_负债分项勾稽',['current_liabilities','noncurrent_liabilities','total_liabilities'],false],
    ] as const) {
      const [a,b,c]=keys.map(v);
      if(independent([...keys]) && a!==null && b!==null && c!==null)
        check(name,Math.abs(a+(subtract ? -b : b)-c)<=Math.max(.01,Math.abs(c)*.001));
    }
    const notes = [!independent(['total_assets','total_liabilities','equity_total']) ? 'G1_未独立验证：含推算或缺失值' : '',
      derived ? 'G4_未独立验证：EBIT为派生值' : '', z === null ? "必需因子不完整，Z不可计算" : "已按当前批次字段重新计算",
      profile.metadata_unknown ? "历史报告元数据未知，须重新上传财报确认" : "",
      profile.listed && profile.equity_value === null ? "市值缺失，X4使用账面权益近似" : ""].filter(Boolean);
    db.prepare("UPDATE zscore_run SET profile_snapshot=?,ebit_derived=?,model=?,z_score=?,risk_zone=?,gates_passed=?,gates_failed=?,notes=? WHERE id=?")
      .run(JSON.stringify(profile),Number(derived),model,z,risk ?? zoneOf(z,model),passed.join(","),failed.join(","),notes.join(","),runId);
    writeOverride();
    if(run.trace_id) audit(run.trace_id,'recompute.completed',{run_id:runId,z_score:z,passed,failed});
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * 删除供应商及其全部历史（级联清理）：
 * - result_override：该表无外键级联，需先手动按 run 删除，避免残留孤儿行
 * - zscore_run：含 ON DELETE CASCADE，删除后自动清理 factor / financial_field
 * - supplier：删除主体
 * 使用事务保证一致性。ids 为空直接返回 0。
 */
export function deleteSuppliers(ids: string[]): number {
  const clean = ids.filter(Boolean);
  if (clean.length === 0) return 0;
  const db = getDb();
  const placeholders = clean.map(() => "?").join(",");
  db.exec("BEGIN TRANSACTION");
  try {
    db.prepare(`DELETE FROM run_trace WHERE run_id IN (SELECT id FROM zscore_run WHERE supplier_id IN (${placeholders}))`).run(...clean);
    db.prepare(`DELETE FROM review_suggestion WHERE run_id IN (SELECT id FROM zscore_run WHERE supplier_id IN (${placeholders}))`).run(...clean);
    db.prepare(
      `DELETE FROM result_override WHERE run_id IN (SELECT id FROM zscore_run WHERE supplier_id IN (${placeholders}))`
    ).run(...clean);
    db.prepare(`DELETE FROM zscore_run WHERE supplier_id IN (${placeholders})`).run(...clean);
    const res = db.prepare(`DELETE FROM supplier WHERE id IN (${placeholders})`).run(...clean);
    db.exec("COMMIT");
    return Number(res.changes ?? 0);
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** 删除单个供应商（便捷封装）。 */
export function deleteSupplier(id: string): boolean {
  return deleteSuppliers([id]) > 0;
}

// ---- 字典自审闭环：未识别科目缺口 ----

export interface DictGapRow {
  id: string;
  label: string;
  value: number | null;
  page: number | null;
  sample: string;
  suggested_field: string | null;
  suggested_kind: string | null;
  status: string;
  resolution: string;
  created_at: string;
}

export function saveDictGaps(runId: string, sample: string, gaps: Array<{
  label: string; value: number; page: number | null;
  suggested_field: string | null; suggested_kind: string | null;
}>) {
  const db = getDb();
  for (const g of gaps) {
    db.prepare(
      `INSERT INTO dict_gap (id, label, value, page, sample, suggested_field, suggested_kind, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(randomUUID(), g.label, g.value, g.page ?? null, sample,
          g.suggested_field, g.suggested_kind);
  }
}

export function listDictGaps(status?: string): DictGapRow[] {
  const db = getDb();
  if (status) {
    return toPlainList(db.prepare(
      `SELECT * FROM dict_gap WHERE status = ? ORDER BY created_at DESC LIMIT 200`
    ).all(status)) as DictGapRow[];
  }
  return toPlainList(db.prepare(
    `SELECT * FROM dict_gap ORDER BY created_at DESC LIMIT 200`
  ).all()) as DictGapRow[];
}

export function resolveDictGap(id: string, status: string, resolution: string): boolean {
  const db = getDb();
  const r = db.prepare(
    `UPDATE dict_gap SET status = ?, resolution = ? WHERE id = ?`
  ).run(status, resolution, id);
  return Number(r.changes ?? 0) > 0;
}
