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
} from "./types";
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
  _db = db;
  return _db;
}

export interface AnalysisInput {
  profile: {
    name: string;
    industry_class: string;
    period_type: string;
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
    fields: Record<string, {
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
  const z = input.zscore;
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
      f.value,
      f.evidence,
      f.source_page,
      f.method,
      f.confidence
    );
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
              r.method, r.created_at AS runAt
       FROM supplier s
       LEFT JOIN zscore_run r ON r.supplier_id = s.id
       WHERE r.created_at = (SELECT MAX(created_at) FROM zscore_run WHERE supplier_id = s.id)
       ORDER BY r.created_at DESC`
    )
    .all() as unknown as JoinedSupplierRow[];
  return rows.map((r) => ({
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
  }));
}

interface JoinedSupplierRow extends SupplierRow {
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
        "SELECT field_key, value, evidence, source_page, method, confidence FROM financial_field WHERE run_id = ?"
      )
      .all(runId)
  );
  const override = toPlain<{
    run_id: string;
    risk_override: string | null;
    risk_overridden: number;
    note: string;
    edited_at: string;
  }>(db.prepare("SELECT * FROM result_override WHERE run_id = ?").get(runId));
  return { run, supplier, factors, fields, override: override ?? null };
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

function loadFactorMap(db: DatabaseSync, runId: string): Record<string, number | null> {
  const rows = db
    .prepare("SELECT key, value FROM factor WHERE run_id = ?")
    .all(runId) as { key: string; value: number | null }[];
  const m: Record<string, number | null> = {};
  for (const r of rows) m[r.key] = r.value;
  return m;
}

/**
 * 从 financial_field 表读取某个字段的值（用于重算 X4 分子）。
 */
function loadFieldValue(db: DatabaseSync, runId: string, fieldKey: string): number | null {
  const r = db
    .prepare("SELECT value FROM financial_field WHERE run_id = ? AND field_key = ?")
    .get(runId, fieldKey) as { value: number | null } | undefined;
  return r ? r.value : null;
}

/**
 * 重算 X4 分子：上市优先 equity_value（市值），缺失回退 equity_total（账面）；
 * 非上市用 equity_total（账面）。与 Python m6_calc.py 口径一致。
 */
function resolveX4Numerator(
  db: DatabaseSync,
  runId: string,
  listed: boolean,
  equityValueOverride: number | null | undefined
): { num: number | null; source: string } {
  if (listed) {
    if (equityValueOverride != null) {
      return { num: equityValueOverride, source: "市值(上市)" };
    }
    const ev = loadFieldValue(db, runId, "equity_value");
    if (ev != null) return { num: ev, source: "市值(上市)" };
    const eq = loadFieldValue(db, runId, "equity_total");
    return { num: eq, source: "账面权益(市值缺失回退)" };
  }
  const eq = loadFieldValue(db, runId, "equity_total");
  return { num: eq, source: "账面权益(非上市)" };
}

/**
 * 由底层财务字段（financial_field）完整重算 X1–X5 与 Z，并写回 factor / zscore_run。
 * 口径严格对齐 Python m6_calc.py：
 *   X1 = (流动资产−流动负债) / 总资产
 *   X2 = 留存收益 / 总资产
 *   X3 = EBIT(已年化) / 总资产
 *   X4 = 权益分子 / 总负债（上市=股权市值，缺失回退账面权益；非上市=账面权益）
 *   X5 = 营业收入(已年化) / 总资产
 * - 流量字段(Ebit/营收)按 run.annualize_factor 年化；存量字段不年化。
 * - 尊重 result_override 的人工风险覆盖：已覆盖则保留覆盖值。
 * - 缺失因子按 0 计入（与引擎 safe_div + term 跳过行为一致）。
 */
function recomputeAllFromFields(
  db: DatabaseSync,
  runId: string,
  industry: Industry,
  listed: boolean,
  equityValueOverride: number | null | undefined
): { model: ZModel; z: number | null; zone: RiskZone } {
  const model = modelForProfile(listed, industry);
  const run = toPlain<RunRow>(
    db.prepare("SELECT * FROM zscore_run WHERE id = ?").get(runId)
  )!;
  const factor = run.annualize_factor || 1.0;

  const fv = (k: string): number | null => loadFieldValue(db, runId, k);
  const CA = fv("current_assets");
  const CL = fv("current_liabilities");
  const TA = fv("total_assets");
  const TL = fv("total_liabilities");
  const RE = fv("retained_earnings");
  const EQ = fv("equity_total");
  const REV = fv("revenue");
  const EBIT = fv("ebit");

  // 修复（2026-09-10，对齐 Python m6_calc）：缺失的流量字段按 0 参与年化与除法，
  // 会让 X3/X5 得到 0（而非 null）→ Z 被静默压低。缺则保持 null，由 computeZ 跳过。
  const ebit_ann = EBIT != null ? EBIT * factor : null;
  const rev_ann = REV != null ? REV * factor : null;

  const eqNum =
    listed
      ? (equityValueOverride != null
          ? equityValueOverride
          : (fv("equity_value") != null ? fv("equity_value") : EQ))
      : EQ;

  const safeDiv = (a: number | null, b: number | null): number | null => {
    if (a == null || b == null || b === 0) return null;
    return a / b;
  };

  const xs: Record<string, number | null> = {
    X1: safeDiv((CA ?? 0) - (CL ?? 0), TA),
    X2: safeDiv(RE, TA),
    X3: safeDiv(ebit_ann, TA),
    X4: safeDiv(eqNum, TL),
    X5: safeDiv(rev_ann, TA),
  };

  // 写回 factor 表（5 项全部 upsert）
  for (const [k, v] of Object.entries(xs)) {
    const existing = db
      .prepare("SELECT id FROM factor WHERE run_id = ? AND key = ?")
      .get(runId, k) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE factor SET value = ? WHERE run_id = ? AND key = ?").run(v, runId, k);
    } else {
      db.prepare("INSERT INTO factor (id, run_id, key, value) VALUES (?, ?, ?, ?)").run(
        randomUUID(),
        runId,
        k,
        v
      );
    }
  }

  const z = computeZ(xs, model);
  const computedZone = zoneOf(z, model);
  const ov = db
    .prepare("SELECT risk_override, risk_overridden FROM result_override WHERE run_id = ?")
    .get(runId) as { risk_override: string | null; risk_overridden: number } | undefined;
  const zone: RiskZone =
    ov && ov.risk_overridden ? (ov.risk_override as RiskZone) : computedZone;

  db.prepare(
    "UPDATE zscore_run SET model = ?, z_score = ?, risk_zone = ? WHERE id = ?"
  ).run(model, z, zone, runId);

  return { model, z, zone };
}

/**
 * 由 listed + 行业 + X 因子重算 Z 与风险区（与 Python 端 m6_calc 对齐）。
 * - 始终用对应口径重算 X4 并写回 factor 表：
 *   上市 → equity_value(市值) / total_liabilities（缺失回退 equity_total 并标注）
 *   非上市 → equity_total(账面) / total_liabilities
 * - 缺失因子按 0 计入（与引擎 safe_div + term 跳过行为一致）。
 *
 * @deprecated 改用 recomputeAllFromFields（由财务字段完整重算，含 X1–X5）。
 *   保留用于仅需切换上市/非上市口径、字段不变的轻量重算。
 */
function recompute(
  db: DatabaseSync,
  runId: string,
  industry: string,
  x: Record<string, number | null | undefined>,
  listed: boolean,
  equityValueOverride: number | null | undefined
): { model: ZModel; z: number | null; zone: RiskZone } {
  const model = modelForProfile(listed, industry);
  // 始终用当前口径重算 X4，保证切换上市/非上市时 factor 表 X4 与模型一致
  const tl = loadFieldValue(db, runId, "total_liabilities");
  const { num, source } = resolveX4Numerator(db, runId, listed, equityValueOverride);
  let newX4: number | null = null;
  if (num != null && tl != null && tl !== 0) {
    newX4 = num / tl;
  }
  x.X4 = newX4;
  // 写回 factor 表
  const existing = db
    .prepare("SELECT id FROM factor WHERE run_id = ? AND key = ?")
    .get(runId, "X4") as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE factor SET value = ? WHERE run_id = ? AND key = ?").run(
      newX4,
      runId,
      "X4"
    );
  } else {
    db.prepare(
      "INSERT INTO factor (id, run_id, key, value) VALUES (?, ?, ?, ?)"
    ).run(randomUUID(), runId, "X4", newX4);
  }
  void source;
  const z = computeZ(x as any, model);
  return { model, z, zone: zoneOf(z, model) };
}

/**
 * 写回供应商行业分类 + 上市标识：更新 supplier.industry/listed，并对该供应商所有 run
 * 由底层财务字段按新模型重算 Z / 风险区；若某 run 已有人工风险覆盖，则保留覆盖值。
 * 不在内部开启事务，便于被 saveResultOverride 的既有事务复用（避免嵌套事务）。
 */
function applyIndustryToRuns(
  db: DatabaseSync,
  supplierId: string,
  industry: Industry,
  listed: boolean,
  equityValueOverride: number | null | undefined
): void {
  db.prepare("UPDATE supplier SET industry = ?, listed = ? WHERE id = ?").run(
    industry,
    listed ? 1 : 0,
    supplierId
  );
  const runs = toPlainList<RunRow>(
    db.prepare("SELECT * FROM zscore_run WHERE supplier_id = ?").all(supplierId)
  );
  for (const r of runs) {
    recomputeAllFromFields(db, r.id, industry, listed, equityValueOverride);
  }
}

/** 公开入口：独立事务包装 applyIndustryToRuns。 */
export function updateSupplierIndustry(
  supplierId: string,
  industry: Industry,
  listed: boolean = false,
  equityValueOverride: number | null | undefined = undefined
): void {
  const db = getDb();
  db.exec("BEGIN TRANSACTION");
  try {
    applyIndustryToRuns(db, supplierId, industry, listed, equityValueOverride);
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export interface SaveOverrideInput {
  x?: Record<string, number | null>; // 修改的 X1–X5（兼容旧路径；未提供的键保持原值）
  fields?: Record<string, number | null>; // 人工补录/修正底层财务字段（如 total_assets）；标记 method=manual 并完整重算 X1–X5 与 Z
  riskOverride?: RiskZone | null; // 人工覆盖风险区；null/undefined = 跟随计算
  note?: string;
  industry?: Industry; // 若提供且与当前不同，写回供应商行业并重算所有 run
  listed?: boolean; // 若提供，写回供应商上市标识并重算所有 run
  equityValue?: number | null; // 写回供应商股权价值（上市 X4 分子）
}

/**
 * 保存一次人工修正（写穿式）：
 *  - industry/listed 变化 → applyIndustryToRuns（先重算所有 run，含本 run 的新模型）
 *  - equityValue 写回 supplier.equity_value
 *  - 更新本 run 的 factor 行（被修改的 X 值）
 *  - 用新模型 + 有效 X 重算 Z；risk_override 存在则覆盖风险区
 *  - 写 result_override（风险覆盖值 / 覆盖标志 / 备注），用于界面「人工覆盖」标记
 */
export function saveResultOverride(runId: string, input: SaveOverrideInput): void {
  const db = getDb();
  db.exec("BEGIN TRANSACTION");
  try {
    const run = db.prepare("SELECT * FROM zscore_run WHERE id = ?").get(runId) as RunRow | undefined;
    if (!run) throw new Error("RUN_NOT_FOUND");
    const supplier = db
      .prepare("SELECT * FROM supplier WHERE id = ?")
      .get(run.supplier_id) as SupplierRow | undefined;
    if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

    const newIndustry = input.industry ?? (supplier.industry as Industry);
    const newListed = input.listed ?? (supplier.listed === 1);

    // 先写 equityValue（若有），让后续 recompute / applyIndustryToRuns 能用市值重算 X4
    if (input.equityValue !== undefined) {
      db.prepare("UPDATE supplier SET equity_value = ? WHERE id = ?").run(
        input.equityValue,
        supplier.id
      );
      supplier.equity_value = input.equityValue;
    }
    const equityValForRecompute =
      input.equityValue !== undefined ? input.equityValue : supplier.equity_value;

    if (
      (input.industry && input.industry !== supplier.industry) ||
      (input.listed !== undefined && input.listed !== (supplier.listed === 1))
    ) {
      applyIndustryToRuns(db, supplier.id, newIndustry, newListed, equityValForRecompute);
      Object.assign(
        supplier,
        db.prepare("SELECT * FROM supplier WHERE id = ?").get(supplier.id)
      );
    }

    const model = modelForProfile(newListed, newIndustry);

    if (input.fields && Object.keys(input.fields).length) {
      // 人工补录底层财务字段：写回 financial_field（标记 method=manual），再完整重算 X1–X5 与 Z
      const upd = db.prepare(
        "UPDATE financial_field SET value = ?, method = ?, confidence = ?, evidence = ? WHERE run_id = ? AND field_key = ?"
      );
      const ins = db.prepare(
        "INSERT INTO financial_field (id, run_id, field_key, value, evidence, source_page, method, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const [k, v] of Object.entries(input.fields)) {
        const ex = db
          .prepare("SELECT id FROM financial_field WHERE run_id = ? AND field_key = ?")
          .get(runId, k) as { id: string } | undefined;
        if (ex) {
          upd.run(v, "manual", 1.0, "人工补录", runId, k);
        } else {
          ins.run(randomUUID(), runId, k, v, "人工补录", null, "manual", 1.0);
        }
      }
      recomputeAllFromFields(db, runId, newIndustry, newListed, equityValForRecompute);
    } else if (input.x && Object.keys(input.x).length) {
      // 兼容旧路径：直接改 X1–X5 因子
      const x = loadFactorMap(db, runId);
      const upd = db.prepare("UPDATE factor SET value = ? WHERE run_id = ? AND key = ?");
      const ins = db.prepare(
        "INSERT INTO factor (id, run_id, key, value) VALUES (?, ?, ?, ?)"
      );
      for (const [k, v] of Object.entries(input.x)) {
        if (x[k] === undefined) ins.run(randomUUID(), runId, k, v);
        else upd.run(v, runId, k);
        x[k] = v;
      }
      const { z } = recompute(db, runId, newIndustry, x, newListed, equityValForRecompute);
      db.prepare(
        "UPDATE zscore_run SET z_score = ?, model = ?, risk_zone = ? WHERE id = ?"
      ).run(z, model, zoneOf(z, model), runId);
    }
    // 否则字段未变：若 industry/listed 变化，applyIndustryToRuns 已重算所有 run；否则保持原值。

    // 风险覆盖（叠加在计算结果之上）
    // 修复：z_score 为 null（数据不足不可计算）时不能回退成 0，
    // 否则 zoneOf(0) 会再次误判为 "distress"。
    const currentZ = db.prepare("SELECT z_score FROM zscore_run WHERE id = ?").get(runId) as
      | { z_score: number | null }
      | undefined;
    const zForZone = currentZ?.z_score ?? null;
    const computedZone = zoneOf(zForZone, model);
    const overridden = input.riskOverride != null && input.riskOverride !== undefined;
    const zone: RiskZone = overridden ? (input.riskOverride as RiskZone) : computedZone;
    db.prepare("UPDATE zscore_run SET risk_zone = ? WHERE id = ?").run(zone, runId);

    db.prepare(
      `INSERT INTO result_override (run_id, risk_override, risk_overridden, note, edited_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(run_id) DO UPDATE SET
         risk_override = excluded.risk_override,
         risk_overridden = excluded.risk_overridden,
         note = excluded.note,
         edited_at = datetime('now')`
    ).run(runId, overridden ? (input.riskOverride as string) : null, overridden ? 1 : 0, input.note ?? "");

    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
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
