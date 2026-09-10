"""
override.py — 人工录入/修正 BS 数字 的覆盖入口

用途：
  QSP 等扫描件样本依赖 GLM OCR，而 OCR 质量/可用性不稳定。为让这些样本也能产出
  可信的 Z-Score，提供「人工录入/修正资产负债表数字」的覆盖机制：
    - benchmarks/overrides.json 按 profile 名称组织，列出需要覆盖的字段与数值；
    - 覆盖字段以 method=MANUAL、evidence="人工录入覆盖" 写入 ExtractionResult，
      在 review.html 中可清晰溯源（区别于自动提取）。

覆盖条目结构（benchmarks/overrides.json）：
{
  "<profile_name>": {
    "mode": "replace",            // replace: 跳过自动提取，仅用人工数字；patch: 先提取再覆盖指定字段
    "note": "人工录入 IFRS 扫描件原始 BS/IS 数字（QR 本位币，单位：里亚尔）",
    "fields": {
      "current_assets": 169667494,
      "total_assets": 173802193,
      ...
    }
  }
}

支持的字段键（即 m4_map 内部字段名）：
  current_assets, current_liabilities, total_assets, total_liabilities,
  equity_total, retained_earnings, revenue, profit_before_tax,
  interest_expense, ebit（可选直接覆盖）
数值单位：与报告本位币一致、且为「元」级（非千/万元），与系统内部口径一致。
"""
from __future__ import annotations

from pathlib import Path

from .models import ExtractionResult, FieldValue, ExtractMethod

HERE = Path(__file__).resolve().parent
OVERRIDE_PATH = HERE / "benchmarks" / "overrides.json"

# 模块级缓存，避免每次 process 重复读盘
_cache: dict | None = None


def load_overrides() -> dict:
    """读取 benchmarks/overrides.json；文件不存在时返回空 dict。"""
    global _cache
    if _cache is not None:
        return _cache
    if OVERRIDE_PATH.exists():
        import json
        try:
            _cache = json.loads(OVERRIDE_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            _cache = {}
    else:
        _cache = {}
    return _cache


def get_override(profile_name: str) -> dict | None:
    """返回指定 profile 的覆盖条目（无则返回 None）。"""
    return load_overrides().get(profile_name)


def is_replace_mode(ov: dict | None) -> bool:
    """replace 模式：完全跳过自动提取，仅使用人工数字。

    对 QSP 这类 OCR 不可用样本，必须 replace，否则会在 extract_pdf 阶段因
    OCRUnavailable 被 cli 中止，覆盖永远轮不到执行。
    """
    if not ov:
        return False
    return str(ov.get("mode", "patch")).lower() == "replace"


def apply_overrides(ext: ExtractionResult, ov: dict) -> ExtractionResult:
    """将覆盖字段写入 ext.fields（method=MANUAL），并视情况推导 ebit。

    推导规则：
      - 若覆盖 supply 了 profit_before_tax 与 interest_expense 但未直接给 ebit，
        则按 ebit = pbt + 利息费用 推导（与 m4_map 一致）。
      - 若覆盖直接给了 ebit，则保留人工 ebit。
    """
    fields = ov.get("fields", {})
    note = ov.get("note", "")
    overridden_keys = set()

    for key, val in fields.items():
        if val is None:
            # None 表示「不覆盖该字段」——保留自动提取结果（patch 模式有用）
            continue
        ext.fields[key] = FieldValue(
            value=float(val),
            method=ExtractMethod.MANUAL,
            source_page=None,
            evidence="人工录入覆盖",
            confidence=1.0,
        )
        overridden_keys.add(key)

    # 推导 ebit（当未直接覆盖 ebit，但给了 PBT + 利息）
    if "ebit" not in overridden_keys:
        pbt = ext.fields.get("profit_before_tax")
        int_exp = ext.fields.get("interest_expense")
        if pbt is not None and pbt.value is not None:
            ebit_val = pbt.value + (int_exp.value if int_exp is not None else 0.0)
            ext.fields["ebit"] = FieldValue(
                value=ebit_val,
                method=ExtractMethod.MANUAL,
                source_page=None,
                evidence="人工录入覆盖(PBT+利息费用)",
                confidence=1.0,
            )

    if note:
        tag = "[人工覆盖]" + (f" mode={ov.get('mode','patch')}" if ov.get("mode") else "")
        ext.warnings.insert(0, f"{tag} {note}")
    return ext
