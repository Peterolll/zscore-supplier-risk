#!/usr/bin/env python3
"""校验 .ps1 脚本的语法与编码（不需要安装 PowerShell）。

背景
----
本项目要给 Windows 用户交付 `.ps1` 脚本，但开发机是 macOS，没法本地跑一遍。
这个脚本用 tree-sitter 的 PowerShell 文法做静态解析，补上验证盲区：

  1. **语法解析**：是否存在 ERROR / MISSING 节点（等价于「有语法错」）
  2. **UTF-8 BOM**：中文 Windows 的 PowerShell 5.1 会按系统 ANSI 码页（GBK）
     解码无 BOM 的脚本 → 中文全变乱码。**带中文的 .ps1 必须存成 UTF-8 with BOM**
  3. **续行符**：反引号 `` ` `` 后面若跟了空白字符，续行会失效（极难肉眼发现）

用法：
    python3 scripts/check-ps1-syntax.py                 # 校验仓库内所有 .ps1
    python3 scripts/check-ps1-syntax.py a.ps1 b.ps1

退出码：0 = 全部通过，1 = 存在问题。
"""
from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOM = b"\xef\xbb\xbf"

# 需要检查的默认目标（除仓库自带脚本外，也把根目录的一键启动脚本纳入）
DEFAULT_TARGETS = ["start-zscore.ps1", "scripts/setup-windows.ps1"]


def has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def check_syntax(data: bytes) -> list[str]:
    """用 tree-sitter 解析，返回问题列表。"""
    try:
        import tree_sitter_powershell as tsp
        from tree_sitter import Language, Parser
    except ImportError:
        return ["[跳过] 未安装 tree-sitter / tree-sitter-powershell，"
                "无法做语法解析（pip install tree-sitter tree-sitter-powershell）"]

    language = Language(tsp.language())
    parser = Parser(language)
    # 解析前剥掉 BOM，避免被当成意外字符
    tree = parser.parse(data[len(BOM):] if data.startswith(BOM) else data)

    problems: list[str] = []
    if not tree.root_node.has_error:
        return problems

    # 定位到具体的 ERROR / MISSING 节点，给出可读的行号
    stack = [tree.root_node]
    reported = 0
    while stack and reported < 8:
        node = stack.pop()
        if node.type == "ERROR" or node.is_missing:
            line = node.start_point[0] + 1
            col = node.start_point[1] + 1
            kind = "缺失节点" if node.is_missing else "语法错误"
            snippet = node.text.decode("utf-8", "replace")[:60].replace("\n", "\\n")
            problems.append(f"[{kind}] 第 {line} 行 第 {col} 列：{snippet!r}")
            reported += 1
        stack.extend(node.children)
    if not problems:
        problems.append("[语法错误] 解析失败，但未能定位到具体节点")
    return problems


def resolve(path: str) -> str | None:
    """按「绝对路径 → 仓库相对 → 当前目录相对」的顺序找文件。"""
    for candidate in (path, os.path.join(REPO_ROOT, path), os.path.abspath(path)):
        if os.path.isfile(candidate):
            return candidate
    return None


def check(path: str) -> list[str]:
    full = resolve(path)
    if full is None:
        return [f"[缺失] {path} 不存在"]

    data = open(full, "rb").read()
    problems: list[str] = []

    # 1) 编码与 BOM
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as e:
        return [f"[编码] {path} 不是合法 UTF-8：{e}"]

    if has_cjk(text) and not data.startswith(BOM):
        problems.append(
            f"[编码] {path} 含中文但没有 UTF-8 BOM —— "
            "中文 Windows 的 PowerShell 5.1 会按 GBK 解码导致乱码"
        )

    # 2) 续行符后不能有空白
    for i, line in enumerate(text.split("\n"), 1):
        stripped = line.rstrip()
        if stripped != line and stripped.endswith("`"):
            problems.append(f"[续行符] {path}:{i} 反引号后面有空白字符，续行会失效")

    # 3) 语法解析
    problems.extend(f"{path}: {p}" if not p.startswith("[跳过]") else p
                    for p in check_syntax(data))

    return problems


def main(argv: list[str]) -> int:
    targets = argv[1:] or DEFAULT_TARGETS
    all_problems: list[str] = []
    for t in targets:
        all_problems.extend(check(t))

    for p in all_problems:
        print("  " + p)

    syntax_skipped = any("跳过" in p for p in all_problems)
    real = [p for p in all_problems if "跳过" not in p]
    print(
        f"\n检查 {len(targets)} 个 .ps1 文件："
        f"语法与编码问题 {len(real)} 条"
        + ("（语法解析已跳过）" if syntax_skipped else "")
    )
    return 1 if real else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
