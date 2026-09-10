#!/usr/bin/env python3
"""校验 Markdown 文档里的链接与锚点。

检查两类问题：
  1. 相对文件链接指向的文件是否存在
  2. [文字](#锚点) 形式的页内锚点，是否真的能在同一文件里找到对应标题
     （中文标题的 GitHub 锚点极易写错，这是主要目的）

用法：
    python3 scripts/check-docs-links.py                # 校验默认文档集
    python3 scripts/check-docs-links.py a.md b.md      # 校验指定文件

退出码：0 = 全部通过，1 = 存在断链或失效锚点。
"""

from __future__ import annotations

import os
import re
import sys
import unicodedata

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULT_TARGETS = [
    "README.md",
    "README.en.md",
    "docs/README.md",
    "docs/新手安装指南.md",
    "zscore-web/README.md",
    "zscore-web/README.en.md",
]

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")

# 行内代码、围栏代码块里的内容不应被当作链接或标题
FENCE_RE = re.compile(r"^\s*(```|~~~)")


def strip_code(text: str) -> str:
    """移除围栏代码块与行内代码，避免把代码里的 # / [] 误判成链接。"""
    out_lines = []
    in_fence = False
    for line in text.splitlines():
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        out_lines.append(re.sub(r"`[^`]*`", "", line))
    return "\n".join(out_lines)


def slugify(heading: str) -> str:
    """复刻 GitHub (github-slugger) 的锚点生成规则。

    步骤：转小写 → 去掉标点/特殊符号（保留字母、数字、空格、连字符、下划线、CJK）
          → 空格替换为连字符。注意多个连续空格会变成多个连字符。
    """
    s = heading.strip().lower()
    kept = []
    for ch in s:
        if ch in (" ", "-", "_"):
            kept.append(ch)
            continue
        cat = unicodedata.category(ch)
        # 保留：字母(L*)、数字(N*)、装饰符号(M*，如重音)、CJK 属于 Lo
        if cat[0] in ("L", "N", "M"):
            kept.append(ch)
    return "".join(kept).replace(" ", "-")


def collect_headings(text: str) -> set[str]:
    slugs: set[str] = set()
    for line in strip_code(text).splitlines():
        m = HEADING_RE.match(line)
        if m:
            slugs.add(slugify(m.group(2)))
    return slugs


def check(path: str) -> tuple[int, int, list[str]]:
    """返回 (检查的链接数, 锚点数, 问题列表)。"""
    full = os.path.join(REPO_ROOT, path)
    if not os.path.exists(full):
        return 0, 0, [f"[缺失文件] {path} 不存在"]

    with open(full, encoding="utf-8") as fh:
        raw = fh.read()

    body = strip_code(raw)
    base = os.path.dirname(full)
    self_anchors = collect_headings(raw)
    problems: list[str] = []
    n_links = 0
    n_anchors = 0

    for m in LINK_RE.finditer(body):
        link = m.group(1).strip()
        if link.startswith(("http://", "https://", "mailto:")):
            continue

        target, _, anchor = link.partition("#")

        # 页内锚点：[文字](#xxx)
        if not target:
            if not anchor:
                continue
            n_anchors += 1
            if anchor not in self_anchors:
                problems.append(f"[失效锚点] {path} -> #{anchor}")
            continue

        n_links += 1
        dest = os.path.normpath(os.path.join(base, target))
        if not os.path.exists(dest):
            problems.append(f"[断链] {path} -> {target}")
            continue

        # 跨文件锚点：[文字](other.md#xxx)
        if anchor and dest.endswith(".md"):
            with open(dest, encoding="utf-8") as fh:
                other_slugs = collect_headings(fh.read())
            if anchor not in other_slugs:
                rel = os.path.relpath(dest, REPO_ROOT)
                problems.append(f"[跨文件失效锚点] {path} -> {target}#{anchor}")

    return n_links, n_anchors, problems


def main(argv: list[str]) -> int:
    targets = argv[1:] or DEFAULT_TARGETS
    total_links = total_anchors = 0
    all_problems: list[str] = []

    for t in targets:
        links, anchors, problems = check(t)
        total_links += links
        total_anchors += anchors
        all_problems.extend(problems)

    for p in all_problems:
        print("  " + p)

    print(
        f"\n检查 {len(targets)} 个文件："
        f"{total_links} 条文件链接 + {total_anchors} 条页内锚点，"
        f"问题 {len(all_problems)} 条"
    )
    return 1 if all_problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
