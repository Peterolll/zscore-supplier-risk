#!/usr/bin/env python3
"""回归验证：pdf_render.py（pypdfium2）与 poppler（pdftoppm/pdfinfo/pdftotext）输出等价。

这是「去 poppler 改造」的验收脚本。改动的风险点在于：
  - 页面尺寸单位（点 vs 输出像素）换算出错 → 裁切位置整体偏移
  - 渲染后端不同（PDFium vs Poppler）→ 图像内容不一致，影响视觉模型识别

判据（后者允许差异，因为两个引擎的抗锯齿算法本就不同）：
  1. 尺寸必须**完全一致**（页面点数、输出像素数）
  2. 二值化后字形位置差异 < 5%（证明文字落在同一位置）
  3. 1/8 降采样后结构差异 ≈ 0%（证明版面结构一致）
  4. 文本提取字符数同量级（证明取文逻辑没变）

用法：
    python3 scripts/verify_pdf_render.py <电子版.pdf> [扫描件.pdf]
需要 PATH 上有 poppler（pdftoppm / pdfinfo / pdftotext）作为对照基准。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

from zscore_pipeline import pdf_render  # noqa: E402

from PIL import Image, ImageChops  # noqa: E402

PASS, FAIL = "✅", "❌"
_failures: list[str] = []


def _check(label: str, ok: bool, detail: str) -> None:
    print(f"  {PASS if ok else FAIL} {label}：{detail}")
    if not ok:
        _failures.append(f"{label} — {detail}")


def _sh(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def compare_images(a_path: str, b_path: str) -> tuple[float, float, float]:
    """返回（二值化字形位置差异率, 1/8 降采样结构差异率, 平均像素差）。"""
    a = Image.open(a_path).convert("L")
    b = Image.open(b_path).convert("L")
    # 两个引擎的四舍五入方向可能不同，导致 ±1~2px 的尺寸差。
    # 这属于取整噪声而非内容差异，按左上角对齐到公共尺寸再比。
    if a.size != b.size:
        w = min(a.size[0], b.size[0])
        h = min(a.size[1], b.size[1])
        if abs(a.size[0] - b.size[0]) > 2 or abs(a.size[1] - b.size[1]) > 2:
            return -1.0, -1.0, -1.0
        a = a.crop((0, 0, w, h))
        b = b.crop((0, 0, w, h))

    # 二值化：只看「有没有墨」，忽略抗锯齿灰阶差异
    bin_a = a.point(lambda v: 255 if v < 160 else 0)
    bin_b = b.point(lambda v: 255 if v < 160 else 0)
    diff = ImageChops.difference(bin_a, bin_b)
    mismatch = sum(1 for p in diff.getdata() if p > 0)
    binarized = mismatch / float(a.size[0] * a.size[1]) * 100.0

    # 降采样：抹掉 1 像素级的抗锯齿差异，看版面结构
    small_a = a.resize((max(1, a.size[0] // 8), max(1, a.size[1] // 8)))
    small_b = b.resize((max(1, b.size[0] // 8), max(1, b.size[1] // 8)))
    sd = ImageChops.difference(small_a, small_b)
    struct = sum(sd.getdata()) / (len(sd.getdata()) * 255.0) * 100.0

    raw = ImageChops.difference(a, b)
    mean = sum(raw.getdata()) / len(raw.getdata())
    return binarized, struct, mean


def test_meta(pdf: str) -> None:
    print(f"\n[1] meta / pdfinfo —— {os.path.basename(pdf)}")
    ours = pdf_render.page_meta(pdf)

    info = _sh(["pdfinfo", pdf])
    if info.returncode != 0:
        _check("pdfinfo 可用", False, info.stderr.strip()[:80])
        return

    page_count = None
    page_size = None
    for line in info.stdout.splitlines():
        if line.startswith("Pages:"):
            page_count = int(line.split(":")[1].strip())
        elif line.startswith("Page size:"):
            # 形如 "595.276 x 841.89 pts (A4)"
            nums = line.split(":")[1].strip().split()
            page_size = (float(nums[0]), float(nums[2]))

    _check("页数一致", ours["pageCount"] == page_count,
           f"pypdfium2={ours['pageCount']} / poppler={page_count}")
    if page_size:
        dw = abs(ours["pageW"] - page_size[0])
        dh = abs(ours["pageH"] - page_size[1])
        _check("首页尺寸一致（±1pt）", dw <= 1 and dh <= 1,
               f"pypdfium2={ours['pageW']}x{ours['pageH']} / "
               f"poppler={page_size[0]:.1f}x{page_size[1]:.1f}")


def test_full_page(pdf: str, dpi: int = 200) -> None:
    print(f"\n[2] pages 整页渲染 @ {dpi} DPI")
    meta = pdf_render.page_meta(pdf)
    px_w = round(meta["pageW"] * dpi / 72)
    px_h = round(meta["pageH"] * dpi / 72)

    with tempfile.TemporaryDirectory() as tmp:
        ours_dir = os.path.join(tmp, "ours")
        theirs_dir = os.path.join(tmp, "theirs")
        os.makedirs(ours_dir)
        os.makedirs(theirs_dir)

        ours_files = pdf_render.render_pages(pdf, max_pages=1, dpi=dpi, out_dir=ours_dir)
        _sh(["pdftoppm", "-png", "-r", str(dpi), "-f", "1", "-l", "1", pdf,
             os.path.join(theirs_dir, "ref")])
        theirs = [f for f in os.listdir(theirs_dir) if f.endswith(".png")]

        if not ours_files or not theirs:
            _check("两侧均产出图像", False, f"ours={len(ours_files)} theirs={len(theirs)}")
            return

        a = Image.open(ours_files[0])
        b = Image.open(os.path.join(theirs_dir, theirs[0]))
        _check("输出尺寸完全一致", a.size == b.size, f"pypdfium2={a.size} poppler={b.size}")
        # 与按点数换算的期望尺寸比对（容忍 1px 取整差异）
        _check("尺寸与点数换算吻合", abs(a.size[0] - px_w) <= 1 and abs(a.size[1] - px_h) <= 1,
               f"实际={a.size} 期望≈({px_w}, {px_h})")

        binarized, struct, mean = compare_images(ours_files[0], os.path.join(theirs_dir, theirs[0]))
        print(f"     字形位置差异 {binarized:.2f}% · 结构差异 {struct:.2f}% · 平均灰度差 {mean:.2f}")
        _check("二值化字形位置一致（<5%）", 0 <= binarized < 5.0, f"{binarized:.2f}%")
        _check("降采样结构一致（<1%）", 0 <= struct < 1.0, f"{struct:.2f}%")


def test_crop(pdf: str, rect: tuple[float, float, float, float],
              dpi: int = 400, page: int = 1) -> None:
    x, y, w, h = rect
    print(f"\n[3] crop 局部裁切 {rect} @ {dpi} DPI（第 {page} 页）")
    meta = pdf_render.page_meta(pdf)

    with tempfile.TemporaryDirectory() as tmp:
        ours_png = os.path.join(tmp, "ours.png")
        theirs_png = os.path.join(tmp, "theirs.png")

        ours = pdf_render.render_crop(pdf, x, y, w, h, dpi=dpi, page=page, out_png=ours_png)

        # poppler 的 -x/-y/-W/-H 在带 -r 时是**输出像素**，需先把点数换成像素
        px_w = meta["pageW"] * dpi / 72.0
        px_h = meta["pageH"] * dpi / 72.0
        _sh(["pdftoppm", "-png", "-r", str(dpi),
             "-x", str(round(x * px_w)), "-y", str(round(y * px_h)),
             "-W", str(round(w * px_w)), "-H", str(round(h * px_h)),
             "-f", str(page), "-l", str(page), pdf, theirs_png[:-4]])

        cand = [f for f in os.listdir(tmp) if f.startswith("theirs") and f.endswith(".png")]
        if not cand:
            _check("poppler 裁切成功", False, "未产出文件")
            return

        b = Image.open(os.path.join(tmp, cand[0]))
        a = Image.open(ours_png)
        _check("裁切尺寸一致（±2px）",
               abs(a.size[0] - b.size[0]) <= 2 and abs(a.size[1] - b.size[1]) <= 2,
               f"pypdfium2={a.size} poppler={b.size}")

        binarized, struct, mean = compare_images(ours_png, os.path.join(tmp, cand[0]))
        print(f"     字形位置差异 {binarized:.2f}% · 结构差异 {struct:.2f}% · 平均灰度差 {mean:.2f}")
        _check("裁切区域内容一致（二值化 <8%）", 0 <= binarized < 8.0, f"{binarized:.2f}%")
        _check("裁切区域结构一致（<2%）", 0 <= struct < 2.0, f"{struct:.2f}%")
        _check("返回的宽高与实际一致",
               ours["width"] == a.size[0] and ours["height"] == a.size[1],
               f"return={ours['width']}x{ours['height']} file={a.size[0]}x{a.size[1]}")


def test_text(pdf: str) -> None:
    print(f"\n[4] text / pdftotext —— {os.path.basename(pdf)}")
    ours = pdf_render.extract_text(pdf)

    r = _sh(["pdftotext", "-layout", "-f", "1", "-l", "3", pdf, "-"])
    ref = r.stdout if r.returncode == 0 else ""

    ours_head = "\f".join(ours.split("\f")[:3])
    n_ours, n_ref = len(ours_head), len(ref)
    ratio = (n_ours / n_ref) if n_ref else 0.0
    _check("取文字符数同量级（前 3 页，0.7~1.3 倍）", 0.7 <= ratio <= 1.3,
           f"pypdfium2+pdfplumber={n_ours} / pdftotext={n_ref}（比 {ratio:.2f}）")

    # 关键科目名至少出现一次，避免「提了字但内容全错」
    for kw in ("资产", "负债"):
        if kw in ref:
            _check(f"包含关键字「{kw}」", kw in ours, "命中" if kw in ours else "缺失")


def test_poppler_optional() -> None:
    print("\n[5] 扫描件取文应返回空（而非报错）")
    pdf = sys.argv[2] if len(sys.argv) > 2 else None
    if not pdf:
        print("  ⏭  未提供扫描件样本，跳过")
        return
    r = _sh(["pdftotext", "-f", "1", "-l", "3", pdf, "-"])
    if len(r.stdout.strip()) > 200:
        print(f"  ⏭  {os.path.basename(pdf)} 其实是电子版（{len(r.stdout)} 字符），跳过")
        return
    txt = pdf_render.extract_text(pdf)
    _check("扫描件取文不报错且近乎为空", len(txt.strip()) < 200,
           f"取到 {len(txt.strip())} 字符（预期≈0，说明会走 OCR 通道）")
    meta = pdf_render.page_meta(pdf)
    print(f"     扫描件共 {meta['pageCount']} 页，尺寸 {meta['pageW']}x{meta['pageH']}pt")

    with tempfile.TemporaryDirectory() as tmp:
        files = pdf_render.render_pages(pdf, max_pages=None, dpi=150, out_dir=tmp)
        _check("扫描件全页渲染成功", len(files) == meta["pageCount"],
               f"渲染 {len(files)} 页 / 共 {meta['pageCount']} 页")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    pdf = sys.argv[1]
    if not os.path.exists(pdf):
        print(f"文件不存在：{pdf}")
        return 2

    missing = [t for t in ("pdftoppm", "pdfinfo", "pdftotext") if not shutil.which(t)]
    if missing:
        print(f"⚠️  PATH 上缺少对照基准工具：{', '.join(missing)}（需先装 poppler）")
        return 2

    print("=" * 68)
    print("PDF 渲染后端等价性验证：pypdfium2  vs  poppler")
    print("=" * 68)

    test_meta(pdf)
    test_full_page(pdf)
    # 用一个小区域模拟「财报单张表」的裁切场景
    test_crop(pdf, (0.10, 0.10, 0.80, 0.35), dpi=400, page=1)
    test_text(pdf)
    test_poppler_optional()

    print("\n" + "=" * 68)
    if _failures:
        print(f"结论：{len(_failures)} 项未通过")
        for f in _failures:
            print("  - " + f)
        return 1
    print("结论：全部通过 —— 去掉 poppler 后输出等价")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
