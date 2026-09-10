"""
models.py — 数据模型（pydantic v2）

可追溯性：每个提取字段都带 method / source_page / evidence，便于复核 HTML 展示。
"""
from __future__ import annotations
from enum import Enum
from pydantic import BaseModel, Field


class IndustryClass(str, Enum):
    MANUFACTURING = "manufacturing"   # → Z′ (5 因子)
    SERVICE = "service"               # → Z″ (4 因子)
    # P0-1：行业由人工在 Profile 标注，系统仅作"建议"，不静默猜测。


class PeriodType(str, Enum):
    ANNUAL = "annual"
    SEMI = "semi"
    Q1 = "q1"
    Q2 = "q2"
    Q3 = "q3"
    Q4 = "q4"


class Gaap(str, Enum):
    CAS = "cas"            # 大陆企业会计准则
    IFRS = "ifrs"         # 国际财务报告准则
    TW_GAAP = "tw_gaap"   # 台湾
    HK_GAAP = "hk_gaap"   # 香港
    OTHER = "other"


class ExtractMethod(str, Enum):
    PDFPLUMBER = "pdfplumber"   # 电子文本直提
    GLM_OCR = "glm_ocr"        # GLM-4V-Flash 免费版 OCR
    MANUAL = "manual"          # 人工录入/修正覆盖（BS 数字补录入口）
    PPTX = "pptx"             # PPTX 表格/文本框直提（python-pptx）
    DERIVED = "derived"        # 三级兜底推导：子指标求和(L2) / 会计恒等式反推(L3)


class FieldValue(BaseModel):
    """单个财务字段的提取结果（带溯源）。"""
    value: float | None = None
    method: ExtractMethod = ExtractMethod.PDFPLUMBER
    source_page: int | None = None
    evidence: str = ""          # 命中的原始科目名
    confidence: float = 1.0     # 1.0 词典命中 / <1.0 规则推断或 LLM 兜底


class SupplierProfile(BaseModel):
    """供应商档案 —— 行业/报告期/准则/上市由人工标注（P0-1 决议）。"""
    name: str
    industry_class: IndustryClass
    period_type: PeriodType
    gaap: Gaap
    currency: str = "CNY"
    source_file: str = ""
    note: str = ""
    listed: bool = False          # 是否上市公司：True → 原始 Altman Z（市值 X4）；False → Z'/Z''（账面 X4）
    equity_value: float | None = None  # 股权价值（上市公司=股票市值；非上市可留空，回退账面权益近似）


class ExtractionResult(BaseModel):
    profile_name: str
    method: ExtractMethod
    raw_text_len: int = 0
    fields: dict[str, FieldValue] = Field(default_factory=dict)
    unit_scale: float = 1.0     # 报表计量单位换算（千元/万元 → 元）
    warnings: list[str] = Field(default_factory=list)
    # 字典自审闭环：未识别科目（match_field/match_component 均未命中的带数字行）
    dict_gaps: list[dict] = Field(default_factory=list)


class ZScoreResult(BaseModel):
    profile_name: str
    model: str                  # "Z" (上市原始) / "Z'" (非上市制造) / "Z''" (非上市非制造)
    X1: float | None = None
    X2: float | None = None
    X3: float | None = None
    X4: float | None = None
    X5: float | None = None
    z_score: float | None = None
    risk_zone: str = ""         # safe / grey / distress
    annualized: bool = False
    annualize_factor: float = 1.0
    gates_passed: list[str] = Field(default_factory=list)
    gates_failed: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
