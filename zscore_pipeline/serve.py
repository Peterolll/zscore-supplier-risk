"""
serve.py — 计算引擎 JSON 入口（供 Next.js 子进程调用）

调用：
  python -m zscore_pipeline.serve <file> [<file2> ...] \
      --name "供应商名" --industry manufacturing|service \
      --period annual|semi|q1|q2|q3|q4 --gaap cas|ifrs|tw_gaap|hk_gaap|other \
      [--currency TWD] [--note "..."] [--listed] [--equity-value N]

支持文件格式：PDF (.pdf)、PPTX (.pptx/.ppt)。
多文件：当传入多个 PDF 时，自动用 pypdf 合并为单份 PDF 后提取（适用于
「合并资产负债表 / 合并利润表 / 合并现金流量表」分表场景）。
若多文件中含 PPTX，则暂不支持合并，仅处理首个文件并给出提示。

输出：单行 JSON 到 stdout。成功 {"ok":true, "profile", "method", "extraction", "zscore"}；
失败 {"ok":false, "error": CODE, "message": "..."}。仅 stdout 输出 JSON，便于 Next 解析。
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import os

from .models import SupplierProfile, IndustryClass, PeriodType, Gaap
from .pipeline import process
from .ocr_glm import OCRUnavailable


def _merge_pdfs(paths: list[str]) -> str:
    """用 pypdf 将多张 PDF 合并为临时单文件，返回合并后路径。"""
    from pypdf import PdfWriter

    writer = PdfWriter()
    for p in paths:
        writer.append(p)
    fd, out = tempfile.mkstemp(suffix=".pdf", prefix="zscore_merged_")
    os.close(fd)
    with open(out, "wb") as f:
        writer.write(f)
    return out


def _resolve_input(files: list[str]) -> tuple[str, list[str]]:
    """将输入文件列表解析为 (用于提取的单一路径, 提示信息列表)。

    - 单文件：原样返回。
    - 多 PDF：合并为单 PDF。
    - 多文件且含非 PDF（如 PPTX）：仅取首个文件，附加提示。
    """
    notes: list[str] = []
    if len(files) == 1:
        return files[0], notes
    pdfs = [f for f in files if f.lower().endswith(".pdf")]
    others = [f for f in files if not f.lower().endswith(".pdf")]
    if pdfs and not others:
        merged = _merge_pdfs(pdfs)
        notes.append(f"已合并 {len(pdfs)} 张 PDF 为单份后提取")
        return merged, notes
    # 含非 PDF 的多文件：暂只处理首个
    first = files[0]
    notes.append(
        "检测到多文件且含非 PDF 格式，暂不支持合并；仅处理首个文件"
        f"（{os.path.basename(first)}），其余文件已忽略"
    )
    return first, notes


def _build_profile(args: argparse.Namespace, source_file: str,
                   extra_notes: list[str]) -> SupplierProfile:
    note = args.note
    if extra_notes:
        note = (note + "；" if note else "") + "；".join(extra_notes)
    return SupplierProfile(
        name=args.name,
        industry_class=IndustryClass(args.industry),
        period_type=PeriodType(args.period),
        gaap=Gaap(args.gaap),
        currency=args.currency,
        source_file=source_file,
        note=note,
        listed=args.listed,
        equity_value=args.equity_value,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Z-Score 计算引擎 JSON 入口")
    ap.add_argument("file", nargs="+", help="财报文件路径（PDF / PPTX），可传多个 PDF 自动合并")
    ap.add_argument("--name", required=True)
    ap.add_argument("--industry", required=True, choices=["manufacturing", "service"])
    ap.add_argument("--period", required=True,
                    choices=["annual", "semi", "q1", "q2", "q3", "q4"])
    ap.add_argument("--gaap", required=True,
                    choices=["cas", "ifrs", "tw_gaap", "hk_gaap", "other"])
    ap.add_argument("--currency", default="CNY")
    ap.add_argument("--note", default="")
    ap.add_argument("--listed", action="store_true",
                    help="上市公司 → 原始 Altman Z（X4 用股权市值/总负债）")
    ap.add_argument("--equity-value", type=float, default=None,
                    help="股权价值（上市=股票市值；缺失则回退账面权益近似）")
    args = ap.parse_args()

    try:
        input_path, notes = _resolve_input(args.file)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": "MERGE_ERROR",
                          "message": f"多文件合并失败：{e}"}, ensure_ascii=False))
        return 5

    profile = _build_profile(args, input_path, notes)
    try:
        r = process(profile, input_path)
    except OCRUnavailable as e:
        print(json.dumps({"ok": False, "error": "OCR_UNAVAILABLE",
                          "message": str(e)}, ensure_ascii=False))
        return 2
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": "FILE_NOT_FOUND",
                          "message": str(e)}, ensure_ascii=False))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": "ENGINE_ERROR",
                          "message": repr(e)}, ensure_ascii=False))
        return 4

    out = {
        "ok": True,
        "profile": r["profile"].model_dump(),
        "method": r["method"].value,
        "extraction": r["extraction"].model_dump(),
        "zscore": r["zscore"].model_dump(),
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
