// lib/engine.ts — 调用 Python 计算引擎（zscore_pipeline/serve.py）子进程，解析其 JSON 输出。

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { EngineResult, Industry, Period, Gaap } from "./types";

/**
 * Python 解释器路径。
 * 优先级：
 *   1. 环境变量 ZSCORE_PYTHON（推荐：指向已安装 pdfplumber / pypdf 等依赖的 venv）
 *   2. 项目内 venv：仓库根/.venv 或 zscore-web/.venv
 *   3. 系统 python3（兜底，可能缺依赖 → 会报 SPAWN_ERROR）
 *
 * 注：不再内置任何机器相关的绝对路径，便于分发到他人环境。
 */
function resolvePython(): string {
  if (process.env.ZSCORE_PYTHON) return process.env.ZSCORE_PYTHON;
  const candidates = [
    path.resolve(process.cwd(), "..", ".venv", "bin", "python3"),
    path.resolve(process.cwd(), ".venv", "bin", "python3"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "python3";
}
const PYTHON = resolvePython();

/**
 * 项目根目录（zscore_pipeline 的父目录）。
 * 优先级：
 *   1. 环境变量 ZSCORE_WORKSPACE
 *   2. process.cwd() 上溯：Next.js dev server 启动于 zscore-web/ → 上溯一级即项目根
 *   3. 兜底：硬编码路径（仅用于开发环境，生产应设置环境变量）
 */
function resolveWorkspace(): string {
  if (process.env.ZSCORE_WORKSPACE) return process.env.ZSCORE_WORKSPACE;
  // Next.js 启动目录通常是 zscore-web/，上溯一级是项目根
  const fromCwd = path.resolve(process.cwd(), "..");
  if (fs.existsSync(path.join(fromCwd, "zscore_pipeline", "serve.py"))) {
    return fromCwd;
  }
  // 从本文件位置上溯：lib/ → zscore-web/ → 项目根
  // 注意：Turbopack 下 __dirname 可能不可靠，作兜底
  try {
    const fromDirname = path.resolve(__dirname, "..", "..");
    if (fs.existsSync(path.join(fromDirname, "zscore_pipeline", "serve.py"))) {
      return fromDirname;
    }
  } catch {
    /* ignore */
  }
  // 兜底：当前工作目录。分发部署时请显式设置 ZSCORE_WORKSPACE 指向仓库根目录。
  return process.cwd();
}
const WORKSPACE = resolveWorkspace();

export interface EngineParams {
  pdfPaths: string[];
  name: string;
  industry: Industry;
  period: Period;
  gaap: Gaap;
  currency?: string;
  note?: string;
  listed?: boolean;
  equityValue?: number | null;
}

export function runEngine(params: EngineParams): Promise<EngineResult> {
  return new Promise((resolve) => {
    const args = [
      "-m",
      "zscore_pipeline.serve",
      ...params.pdfPaths,
      "--name",
      params.name,
      "--industry",
      params.industry,
      "--period",
      params.period,
      "--gaap",
      params.gaap,
      "--currency",
      params.currency || "CNY",
    ];
    if (params.note) args.push("--note", params.note);
    if (params.listed) {
      args.push("--listed");
      if (params.equityValue != null) args.push("--equity-value", String(params.equityValue));
    }

    const proc = spawn(PYTHON, args, { cwd: WORKSPACE });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (e) =>
      resolve({ ok: false, error: "SPAWN_ERROR", message: e.message })
    );
    proc.on("close", (code) => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({ ok: false, error: "NO_OUTPUT", message: stderr || `exit ${code}` });
        return;
      }
      try {
        resolve(JSON.parse(trimmed) as EngineResult);
      } catch {
        resolve({ ok: false, error: "BAD_JSON", message: trimmed.slice(0, 800) });
      }
    });
  });
}
