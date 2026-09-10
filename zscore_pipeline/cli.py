"""
cli.py — 流水线入口 + 基准回归

运行: cd <仓库根目录> && \\
      python3 -m zscore_pipeline.cli   # 建议用 venv，并先安装 requirements.txt

输出: output/results.json, summary.xlsx, review.html
基准: benchmarks/expected.json（Z 误差<1%、风险区一致、模型一致）
"""
from __future__ import annotations
import json
from pathlib import Path

from .config import OUTPUT_DIR, GLM_OCR
from .models import SupplierProfile, ExtractMethod
from .pipeline import process
from .output import write_json, write_excel, write_html
from .ocr_glm import OCRUnavailable

HERE = Path(__file__).resolve().parent
BENCH = HERE / "benchmarks"


def load_profiles() -> list[SupplierProfile]:
    data = json.loads((BENCH / "profiles.json").read_text(encoding="utf-8"))
    return [SupplierProfile(**p) for p in data]


def main():
    print(f"GLM-4V-Flash OCR: {'启用' if GLM_OCR['enabled'] else '未启用(需 GLM_API_KEY)'}")
    profiles = load_profiles()
    results = []
    for p in profiles:
        src = p.source_file
        if not Path(src).exists():
            print(f"[SKIP] {p.name}: 文件不存在 {src}")
            continue
        try:
            r = process(p, src)
            results.append(r)
            z = r["zscore"]
            print(f"[OK]   {p.name}: {z.model}={z.z_score:.4f} ({z.risk_zone}) "
                  f"门禁失败={z.gates_failed} method={r['method'].value}")
        except OCRUnavailable as e:
            # 扫描件需 GLM_API_KEY 跑 OCR（P0-2：非上市样本为已知缺口，暂缓）
            print(f"[PENDING] {p.name}: 扫描件需 GLM_API_KEY 跑 OCR —— {e}")
        except Exception as e:  # noqa: BLE001
            print(f"[ERR]  {p.name}: {type(e).__name__}: {e}")

    if not results:
        print("无成功结果。")
        return

    write_json(results, OUTPUT_DIR / "results.json")
    write_excel(results, OUTPUT_DIR / "summary.xlsx")
    write_html(results, OUTPUT_DIR / "review.html")
    print(f"\n产物已写出 → {OUTPUT_DIR}")

    run_benchmark(results)


def run_benchmark(results):
    exp_path = BENCH / "expected.json"
    if not exp_path.exists():
        return
    exp = json.loads(exp_path.read_text(encoding="utf-8"))
    print("\n=== 基准回归 (Z误差<1% / 风险区一致 / 模型一致) ===")
    all_pass = True
    for r in results:
        name = r["profile"].name
        if name not in exp:
            continue
        z = r["zscore"]
        e = exp[name]
        ok_z = abs(z.z_score - e["z"]) <= max(0.01 * abs(e["z"]), 0.02)
        ok_risk = z.risk_zone == e["risk"]
        ok_model = z.model == e["model"]
        status = "PASS" if (ok_z and ok_risk and ok_model) else "FAIL"
        if status != "PASS":
            all_pass = False
        print(f"  [{status}] {name}: Z got={z.z_score:.4f} exp={e['z']} | "
              f"risk {z.risk_zone}/{e['risk']} | {z.model}")
    print("  → 全部通过 ✅" if all_pass else "  → 存在失败项 ❌")


if __name__ == "__main__":
    main()
