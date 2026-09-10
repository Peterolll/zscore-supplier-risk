// lib/exportXlsx.ts — 服务端专用：将一次 run 的分析结果导出为 .xlsx（exceljs）
// 单 Sheet，顶部为与 zscore_pipeline/output.py 生成的 summary.xlsx 完全一致的「Z-Score 汇总」宽表，
// 下方同 Sheet 续接「报告信息」「财务字段溯源」区块。
import ExcelJS from "exceljs";
import type { RunDetail, ZModel } from "./types";
import { buildFactorBreakdown } from "./zscore";
import {
  ZONE_LABELS,
  INDUSTRY_LABELS,
  PERIOD_LABELS,
  GAAP_LABELS,
  DICT_FIELD_META,
  Z_FORMULA,
} from "./constants";

const ZONE_FILL: Record<string, string> = {
  safe: "C6EFCE", // 绿
  grey: "FFEB9C", // 黄
  distress: "FFC7CE", // 红
};
const BOLD = { bold: true } as const;
const SECTION_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "D9E2F3" } };

function num(v: number | null | undefined): number | null {
  if (v == null) return null;
  return Number(v.toFixed(4));
}

export async function buildRunXlsx(detail: RunDetail): Promise<Buffer> {
  const { run, supplier, factors, fields, override } = detail;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Z-Score Analyzer";
  wb.created = new Date();
  const ws = wb.addWorksheet("Z-Score 结果");
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const fv = (k: string) => factors.find((x) => x.key === k)?.value ?? null;
  const zoneLabel = ZONE_LABELS[run.risk_zone] ?? run.risk_zone;

  // ---------- 区块1：核心宽表（对齐 output.py 的 summary.xlsx）----------
  const coreHeaders = [
    "供应商", "模型", "X1", "X2", "X3", "X4", "X5",
    "Z-Score", "风险区", "年化因子", "闸门通过", "闸门失败",
  ];
  ws.addRow(coreHeaders);
  const hrow = ws.getRow(1);
  hrow.font = BOLD;
  hrow.alignment = { vertical: "middle" };

  ws.addRow([
    supplier.name,
    run.model,
    num(fv("X1")), num(fv("X2")), num(fv("X3")), num(fv("X4")), num(fv("X5")),
    num(run.z_score),
    zoneLabel,
    run.annualized ? run.annualize_factor : 1,
    run.gates_passed || "",
    run.gates_failed || "",
  ]);
  const dataRow = ws.getRow(2);
  const fill = ZONE_FILL[run.risk_zone];
  if (fill) dataRow.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

  // 列宽（A=22；B/C 放宽以容纳公式与代入数值；K/L 宽表闸门列）
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 26;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 16;
  for (const c of ["D", "E", "F", "G", "H", "I", "J"]) ws.getColumn(c).width = 12;
  ws.getColumn(11).width = 30;
  ws.getColumn(12).width = 24;

  // ---------- 区块2：报告信息 ----------
  let r = 4;
  const sect2 = ws.getCell(r, 1);
  sect2.value = "报告信息";
  sect2.font = BOLD;
  sect2.fill = SECTION_FILL;
  ws.getCell(r, 2).fill = SECTION_FILL;
  r++;
  const info: Array<[string, string | number]> = [
    ["公司类型", supplier.listed === 1 ? "上市公司" : "非上市公司"],
    ["股权价值", supplier.equity_value != null ? supplier.equity_value : "—"],
    ["行业分类", INDUSTRY_LABELS[supplier.industry] ?? supplier.industry],
    ["报告期", `${PERIOD_LABELS[supplier.period] ?? supplier.period}（${supplier.period}）`],
    ["会计准则", GAAP_LABELS[supplier.gaap] ?? supplier.gaap],
    ["币种", supplier.currency],
    ["提取方式", run.method],
    ["评级来源", override?.risk_overridden ? "人工覆盖" : "模型计算"],
    ["人工备注", override?.note || "—"],
    ["分析时间", run.created_at],
    ["原始文件", supplier.source_file || "—"],
  ];
  for (const [k, v] of info) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 1).font = BOLD;
    ws.getCell(r, 2).value = v;
    r++;
  }

  // ---------- 区块3：财务字段溯源 ----------
  r += 1;
  const sect3 = ws.getCell(r, 1);
  sect3.value = "财务字段溯源";
  sect3.font = BOLD;
  sect3.fill = SECTION_FILL;
  ws.getCell(r, 2).fill = SECTION_FILL;
  r++;
  const trHeaders = ["字段", "中文名", "数值", "证据", "页码", "提取方式", "置信度"];
  trHeaders.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = BOLD;
  });
  r++;
  const sorted = [...fields].sort((a, b) => (a.field_key ?? "").localeCompare(b.field_key ?? ""));
  for (const f of sorted) {
    ws.getCell(r, 1).value = f.field_key ?? "";
    ws.getCell(r, 2).value = DICT_FIELD_META[f.field_key as keyof typeof DICT_FIELD_META]?.label ?? "";
    ws.getCell(r, 3).value = num(f.value);
    ws.getCell(r, 4).value = f.evidence || "—";
    ws.getCell(r, 5).value = f.source_page ?? "—";
    ws.getCell(r, 6).value = f.method || "—";
    ws.getCell(r, 7).value = f.confidence == null ? "—" : f.confidence.toFixed(2);
    r++;
  }

  // ---------- 区块4：Altman 因子计算明细（公式 + 代入数值 + 对 Z 贡献）----------
  r += 1;
  const sect4 = ws.getCell(r, 1);
  sect4.value = "Altman 因子计算明细";
  sect4.font = BOLD;
  sect4.fill = SECTION_FILL;
  ws.getCell(r, 2).fill = SECTION_FILL;
  r++;
  // Z 方程提示行
  const eqCell = ws.getCell(r, 1);
  eqCell.value = `Z 方程（${run.model}）：${Z_FORMULA[run.model as ZModel] ?? ""}`;
  eqCell.font = { italic: true, size: 10 };
  ws.getCell(r, 2).fill = SECTION_FILL;
  ws.getCell(r, 4).fill = SECTION_FILL;
  r++;
  const fxHeaders = ["因子", "公式", "代入数值", "数值", "系数", "计入 Z", "对 Z 贡献"];
  fxHeaders.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = BOLD;
  });
  r++;
  {
    const xv: Record<string, number | null> = {};
    for (const k of ["X1", "X2", "X3", "X4", "X5"]) xv[k] = fv(k);
    const breakdowns = buildFactorBreakdown(
      xv,
      fields,
      run.model as ZModel,
      run.annualize_factor || 1
    );
    for (const b of breakdowns) {
      const quotient =
        b.numVal != null && b.denVal != null && b.denVal !== 0
          ? b.numVal / b.denVal
          : null;
      const contribution = b.value != null ? b.coef * b.value : null;
      const set = (col: number, val: ExcelJS.Cell["value"], wrap = false) => {
        const c = ws.getCell(r, col);
        c.value = val;
        if (wrap) c.alignment = { wrapText: true, vertical: "top" };
      };
      set(1, `${b.key} ${b.label}`);
      set(2, `${b.key} = ${b.formula}\n${b.meaning}`, true);
      set(3, b.substituted, true);
      set(4, num(quotient ?? b.value));
      set(5, b.coef);
      set(6, b.active ? "计入" : "不计");
      set(7, num(contribution));
      ws.getRow(r).height = 42;
      r++;
    }
  }

  // 区块1/2 之间的网格线（仅宽表与溯源表头下方轻描）
  for (const row of [1, 2]) {
    ws.getRow(row).eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: "BFBFBF" } },
      };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
