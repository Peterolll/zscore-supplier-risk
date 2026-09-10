// lib/engine.ts — 调用 Python 计算引擎（zscore_pipeline/serve.py）子进程，解析其 JSON 输出。

import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { EngineResult, Industry, Period, Gaap } from "./types";

/**
 * Python 解释器路径。
 * 优先级：
 *   1. 环境变量 ZSCORE_PYTHON（推荐：指向已安装 pdfplumber / pypdf 等依赖的 venv）
 *   2. 项目内 venv：仓库根/.venv 或 zscore-web/.venv
 *   3. PATH 上的系统解释器（兜底，可能缺依赖 → 会报 SPAWN_ERROR）
 *
 * 注：不再内置任何机器相关的绝对路径，便于分发到他人环境。
 *
 * ⚠️ venv 的目录布局是**跨平台不同**的：
 *      - macOS / Linux：<venv>/bin/python3
 *      - Windows      ：<venv>\Scripts\python.exe
 *    早期版本只按 POSIX 布局探测，导致 Windows 用户即使装好了 venv 也探测不到，
 *    退回系统解释器（Windows 上通常没有 python3 这个命令）→ 上传财报时报
 *    「引擎启动失败 / SPAWN_ERROR」。这是 Windows 支持缺失的根因之一。
 */

/** 按当前平台列出 venv 内解释器的候选路径（base = venv 所在目录，通常是仓库根） */
function venvPythonCandidates(base: string): string[] {
  return process.platform === "win32"
    ? [
        path.join(base, ".venv", "Scripts", "python.exe"),
        path.join(base, ".venv", "Scripts", "python"),
      ]
    : [
        path.join(base, ".venv", "bin", "python3"),
        path.join(base, ".venv", "bin", "python"),
      ];
}

/** 列出 PATH 上**所有**存在的解释器候选（按 PATH 顺序，已去重） */
function pythonsOnPath(): string[] {
  // Windows 上 `python` 常是 Microsoft Store 的占位存根（能被执行但不会真跑 Python），
  // 所以把 py 启动器一并纳入候选，由后续依赖探测来筛选。
  const names = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  const found: string[] = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        try {
          if (fs.existsSync(candidate) && !found.includes(candidate)) found.push(candidate);
        } catch {
          /* 无权限的目录直接跳过 */
        }
      }
    }
  }
  return found;
}

/** 引擎运行所需的全部第三方包（与 requirements.txt 对应） */
const FULL_DEPS = "pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl";
/** 最低可用集合：只跑单份 PDF 也够用（多份合并才需要 pypdf） */
const MIN_DEPS = "pdfplumber, pypdfium2";

/** 依赖探测：该解释器能否成功 import 指定包 */
function probeImports(exe: string, imports: string): boolean {
  try {
    execFileSync(exe, ["-c", `import ${imports}`], {
      stdio: "ignore",
      timeout: 8000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** 探测成功的解释器在整个进程生命周期内复用 */
let pythonCache: string | null = null;

/**
 * 解析 Python 解释器路径。
 *
 * 每次分析时都调用（而非模块加载时算一次），这样「先启动服务、后装依赖」的
 * 用户不需要重启服务就能生效。
 *
 * 关键改进：不再「取 PATH 上第一个存在的 python 就用」，而是逐个探测
 * `import pdfplumber, pypdfium2`，选中**确实装了依赖**的那一个。
 * 否则在常见环境下（多个 Python 共存、Windows 的 Store 存根、conda 未激活）
 * 会选中残缺解释器，用户看到的是莫名其妙的报错。
 */
export function resolvePython(): string {
  if (process.env.ZSCORE_PYTHON) return process.env.ZSCORE_PYTHON;
  if (pythonCache) return pythonCache;

  const candidates = [
    ...venvPythonCandidates(path.resolve(process.cwd(), "..")),
    ...venvPythonCandidates(process.cwd()),
    ...pythonsOnPath(),
  ];

  // 第 1 轮：优先选依赖齐全（含 pypdf / pptx / openpyxl）的解释器
  for (const c of candidates) {
    if (probeImports(c, FULL_DEPS)) {
      pythonCache = c;
      return c;
    }
  }

  // 第 2 轮：退而求其次，能跑单份 PDF 即可
  for (const c of candidates) {
    if (probeImports(c, MIN_DEPS)) {
      pythonCache = c;
      return c;
    }
  }

  // 一个都不完整：退回第一个「真实存在」的候选，让报错信息指向真实解释器，便于排查
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* 忽略 */
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}

/**
 * 项目根目录（zscore_pipeline 的父目录）。
 * 优先级：
 *   1. 环境变量 ZSCORE_WORKSPACE
 *   2. process.cwd() 上溯：Next.js dev server 启动于 zscore-web/ → 上溯一级即项目根
 *   3. 兜底：硬编码路径（仅用于开发环境，生产应设置环境变量）
 */
export function resolveWorkspace(): string {
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

    // 每次分析都重新解析解释器路径（用户可能先启动服务、后装依赖）
    const python = resolvePython();
    const proc = spawn(python, args, { cwd: WORKSPACE });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (e) =>
      resolve({
        ok: false,
        error: "SPAWN_ERROR",
        message:
          `无法启动 Python 解释器「${python}」：${e.message}\n` +
          "请先在项目根目录创建虚拟环境并安装依赖：\n" +
          "  macOS / Linux：python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt\n" +
          "  Windows      ：python -m venv .venv && .\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt",
      })
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
