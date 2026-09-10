"""
ocr_glm.py — GLM-4V-Flash 免费版 OCR 适配器（扫描件通道）

用户决议：OCR 调用使用 GLM-4V-Flash 免费版（智谱 BigModel）。
- 扫描件 PDF → 逐页渲染 PNG → base64 → GLM-4V-Flash 视觉理解 → 结构化文本。
- API key 从环境变量 GLM_API_KEY 读取；缺失时明确报错，不静默降级。
"""
from __future__ import annotations
import base64
import json
import shutil
import tempfile
import urllib.request
from pathlib import Path
from .config import GLM_OCR


class OCRUnavailable(RuntimeError):
    """GLM-4V-Flash OCR 不可用：缺 GLM_API_KEY，或扫描件渲染/解析后无可用科目。

    由 cli 捕获并标记为 PENDING（扫描件需设置 GLM_API_KEY 后重跑），
    避免下游 calc 因空字段崩溃为 TypeError。
    """


def _render_pages(pdf_path: str | Path, dpi: int = 300, out_dir: Path | None = None) -> list[Path]:
    """用 pdf2image 将扫描件逐页渲染为 PNG（依赖 poppler）。

    DPI=300：2026-08-27 实测发现 DPI=150 时 GLM-4V-Flash 会漏读页面下半部分
    （如资产负债表的权益类整块：盈余公积/未分配利润/所有者权益合计全丢），
    提到 300 后完整读出。代价是图片更大、OCR 稍慢，但准确率优先。

    修复 Bug：原实现往 uploads/.ocr_*/ 写 PNG 永不清理 → 磁盘泄漏。
    现改为写入调用方传入的临时目录（由 ocr_pdf_via_glm 用 tempfile 管理），
    OCR 完成后整个目录自动销毁。
    """
    from pdf2image import convert_from_path
    images = convert_from_path(str(pdf_path), dpi=dpi)
    if out_dir is None:
        out_dir = Path(tempfile.mkdtemp(prefix="zscore_ocr_"))
    else:
        out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, img in enumerate(images):
        p = out_dir / f"page_{i+1:03d}.png"
        img.save(p, "PNG")
        paths.append(p)
    return paths


def _call_glm(image_path: str | Path, prompt: str) -> str:
    if not GLM_OCR["enabled"]:
        raise OCRUnavailable(
            "GLM-4V-Flash OCR 未启用：缺少环境变量 GLM_API_KEY。"
            "请设置 export GLM_API_KEY=你的智谱免费版key 后重跑扫描件基准。"
        )
    b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
    payload = {
        "model": GLM_OCR["model"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }
        ],
    }
    req = urllib.request.Request(
        GLM_OCR["base_url"],
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {GLM_OCR['api_key']}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"]


def ocr_pdf_via_glm(pdf_path: str | Path) -> str:
    """扫描件 → GLM-4V-Flash OCR → 合并文本。

    修复 Bug：渲染图写入临时目录，OCR 完成后自动清理，不再泄漏到 uploads/。
    """
    with tempfile.TemporaryDirectory(prefix="zscore_ocr_") as tmpdir:
        pages = _render_pages(pdf_path, out_dir=Path(tmpdir))
        chunks = []
        for p in pages:
            try:
                chunks.append(_call_glm(p, GLM_OCR["ocr_prompt"]))
            except Exception as e:  # noqa: BLE001
                chunks.append(f"[OCR_ERROR {p.name}: {e}]")
        return "\n".join(chunks)
