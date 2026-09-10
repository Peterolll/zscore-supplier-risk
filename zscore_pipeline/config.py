"""
config.py — 全局配置与路径

P0 决议落地：
- 行业类型(industry_class)：由用户在 SupplierProfile 人工标注（M1 读取），系统不静默猜测。
- OCR 通道：扫描件使用 GLM-4V-Flash 免费版（智谱 BigModel），API key 从环境变量 GLM_API_KEY 读取。
- 非上市样本 / 币种阈值声明：按决议暂缓，架构预留扩展位。
"""
from __future__ import annotations
import os
from pathlib import Path

# ---- 工作区根目录 ----
WORKSPACE = Path(__file__).resolve().parent
ROOT = WORKSPACE.parent

# ---- 样本 PDF 位置（环境变量优先；默认用项目内 benchmarks 目录）----
_SAMPLE_DIR_ENV = os.environ.get("ZSCORE_SAMPLE_DIR", "")
_MINGZHI_DIR_ENV = os.environ.get("ZSCORE_MINGZHI_DIR", "")
SAMPLE_DIR = Path(_SAMPLE_DIR_ENV) if _SAMPLE_DIR_ENV else (ROOT / "zscore_pipeline" / "benchmarks")
MINGZHI_DIR = Path(_MINGZHI_DIR_ENV) if _MINGZHI_DIR_ENV else SAMPLE_DIR

SAMPLE_FILES = {
    "hanchi_114q4": SAMPLE_DIR / "114Q4_瀚荃_合併_完稿財報-電子書.pdf",
    "mingzhi_2026q1": MINGZHI_DIR / "鸣志电器2026年第一季度报告.pdf",
    "mingzhi_2025_annual": MINGZHI_DIR / "鸣志电器2025年年度报告.pdf",
}

# ---- GLM-4V-Flash 免费版 OCR 配置 ----
def _resolve_glm_key() -> str:
    """优先读环境变量 GLM_API_KEY；未设置时回退到本地密钥文件（免每次 export）。

    支持的本地文件：
      - zscore_pipeline/.glm_key      纯文本密钥（一行）
      - zscore_pipeline/.env          GLM_API_KEY=xxxx 形式
    注意：密钥文件含敏感信息，请勿提交到版本库。
    """
    key = (os.environ.get("GLM_API_KEY", "") or "").strip()
    if key:
        return key
    for c in (WORKSPACE / ".glm_key", WORKSPACE / ".env"):
        if c.exists():
            text = c.read_text(encoding="utf-8").strip()
            if c.name == ".env":
                for line in text.splitlines():
                    line = line.strip()
                    if line.startswith("GLM_API_KEY"):
                        _, _, val = line.partition("=")
                        return val.strip().strip('"').strip("'")
            else:
                return text
    return ""


GLM_API_KEY = _resolve_glm_key()
GLM_OCR = {
    "api_key": GLM_API_KEY,
    "base_url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "model": "glm-4v-flash",
    "enabled": bool(GLM_API_KEY),
    "ocr_prompt": (
        "这是一张企业财务报表页面。请 OCR 并结构化提取所有表格的科目与数值，"
        "保留原始数字（含逗号与负号，括号表示负数）。"
        "按行输出：每行 '科目名<TAB>数值'，不要解释，不要省略。"
    ),
    # ---- 关键字段校验重试（2026-09-03）----
    # 背景：GLM-4V-Flash 输出极不稳定。实测对同一份扫描 PDF 连跑 3 次，
    #   「三、利润总额」行仅 1 次被读出（漏读率 ≈ 2/3），且格式在
    #   markdown 表格 / TAB 分隔之间随机切换。单次 OCR 结果不足以采信。
    # 机制：OCR 后校验 verify_fields 是否齐备；缺失则重跑 OCR，
    #   并只把「本次能补上缺失字段」的行并入结果（不污染已抓到的字段）。
    # 取值：1 = 关闭重试（旧行为，最快）；2 = 最多 2 次（推荐）；3 = 最多 3 次（最慢）。
    # 代价：每次 OCR ≈ 30s，verify_attempts=2 时最坏情况耗时翻倍。
    "verify_attempts": 3,
    # 校验字段的取舍原则：只放"L1 词典可直接命中、且缺失会直接拖垮 Z 值"的字段。
    #   ✗ retained_earnings：CAS 下走 L2（盈余公积+未分配利润求和），match_field 永远不命中，
    #     纳入会导致每次都判定"缺失"而空转重试。
    #   ✗ interest_expense：不少小企业报表不单独披露"其中：利息费用"，
    #     缺失时 m4_map 有已验证的兜底（EBIT=PBT，conf 0.9），强制补齐是浪费。
    "verify_fields": [
        "revenue",
        "profit_before_tax",
        "current_assets",
        "current_liabilities",
        "total_assets",
        "total_liabilities",
        "equity_total",
    ],
}

# ---- 报告期 → 年化因子（流量字段 EBIT/营收 使用）----
# 仅流量字段年化；存量字段(CA/CL/TA/TL/EQ/RE)不年化。
ANNUALIZE_FACTOR = {
    "annual": 1,      # 年度报告 12 个月
    "semi": 2,        # 半年度 6 个月
    "q1": 4,          # 一季度 3 个月
    "q2": 4,          # 二季度（半年报等价）
    "q3": 4,
    "q4": 1,          # Q4 合併財報通常等价全年
}

# ---- Altman 系数（权威）----
# 非上市制造业 1983 (5 因子)：X4 = 股东权益账面值 / 总负债
Z_PRIME_COEF = {
    "X1": 0.717, "X2": 0.847, "X3": 3.107, "X4": 0.420, "X5": 0.998,
}
# 非上市非制造业 1995 (4 因子，剔除 X5 资产周转率)：X4 = 股东权益账面值 / 总负债
Z_DOUBLE_PRIME_COEF = {
    "X1": 6.56, "X2": 3.26, "X3": 6.72, "X4": 1.05,
}
# 上市公司原始 Altman Z-Score 1968 (5 因子)：X4 = 股权市值 / 总负债
Z_ORIGINAL_COEF = {
    "X1": 1.2, "X2": 1.4, "X3": 3.3, "X4": 0.6, "X5": 1.0,
}

# 阈值（Altman 美国样本，对中国民企仅供参考——P0-3 暂缓声明，计算仍用）
Z_PRIME_THRESHOLD = {"safe": 2.90, "grey": 1.23}      # >2.90 安全, 1.23~2.90 灰色, <1.23 困境
Z_DOUBLE_THRESHOLD = {"safe": 2.90, "grey": 1.10}      # >2.90 安全, 1.10~2.90 灰色, <1.10 困境
# 原始 Z 阈值：>2.675 安全, 1.81~2.675 灰色, <1.81 困境
Z_ORIGINAL_THRESHOLD = {"safe": 2.675, "grey": 1.81}

# ---- 输出目录 ----
OUTPUT_DIR = WORKSPACE / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
