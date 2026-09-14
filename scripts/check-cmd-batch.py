#!/usr/bin/env python3
"""校验 .cmd / .bat 批处理脚本的编码与常见陷阱（不需要 Windows）。

背景
----
本项目要给 Windows 用户交付批处理脚本（`start-zscore.cmd` / `scripts/setup-windows.cmd`），
但开发机是 macOS，没法本地跑一遍，也**没有**现成的批处理语法解析器可用。
这个脚本覆盖那些「肉眼看不出来、但一跑就错」的静态问题：

  1. **UTF-8 BOM**：带 BOM 时 cmd 会把第一条命令读成 `∩╗┐@echo off` 并报
     「不是内部或外部命令」。**.cmd 必须存成 UTF-8 without BOM**
     （注意与 .ps1 恰好相反：.ps1 必须**有** BOM）
  2. **行尾不能是纯 LF**：必须 CRLF。纯 LF 时 `goto` / `call` 会报
     「系统找不到指定的批处理标签」——这是最容易在 macOS 上写出来的坑
  3. **码页**：含中文却没写 `chcp 65001`（且必须在第一条中文之前）→ 乱码
  4. **标签**：`goto :label` / `call :label` 引用的标签必须真实存在；标签不得重复
  5. **百分号**：`for` 块外写了 `%%X`，或 `for` 块内写了 `%X` —— 批处理最常见的错
  6. **续行符**：`^` 后面跟了空白字符，续行会失效
  7. **echo 特殊字符**：`echo` 行里出现未转义、未加引号的 `&` `|` `<` `>`

用法：
    python3 scripts/check-cmd-batch.py                 # 校验仓库内所有 .cmd/.bat
    python3 scripts/check-cmd-batch.py a.cmd b.cmd

退出码：0 = 全部通过，1 = 存在问题。
"""
from __future__ import annotations

import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOM = b"\xef\xbb\xbf"

DEFAULT_TARGETS = ["start-zscore.cmd", "scripts/setup-windows.cmd"]

# ── 正则 ──────────────────────────────────────────────────────────
RE_LABEL_DEF = re.compile(r"^\s*:([A-Za-z_][\w]*)\s*$")
RE_GOTO = re.compile(r"\bgoto\s+:?([A-Za-z_][\w]*)", re.I)
RE_CALL_LABEL = re.compile(r"\bcall\s+:([A-Za-z_][\w]*)", re.I)
RE_ECHO = re.compile(r"^\s*@?echo(\.|,|;|:|\(|\s)?(.*)$", re.I)

# 内置伪标签，不需要自己定义
BUILTIN_LABELS = {"eof"}


def has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def strip_quoted(s: str) -> str:
    """把双引号包裹的内容换成占位符，避免引号内的特殊字符被误判。"""
    return re.sub(r'"[^"]*"', '""', s)


def check_echo(line: str, lineno: int, path: str) -> list[str]:
    """echo 行里未转义的 & | < > 会被当成命令分隔/重定向，导致输出错乱。"""
    m = RE_ECHO.match(line)
    if not m:
        return []
    body = m.group(2)
    # 先吃掉 ^ 转义，再吃掉引号内容
    body = re.sub(r"\^[&|<>!^]", "", body)
    body = strip_quoted(body)
    bad = [c for c in "&|<>" if c in body]
    if bad:
        return [
            f"[echo] {path}:{lineno} echo 行里有未转义的 {' '.join(bad)}，"
            "需要写成 ^& ^| ^< ^> 或用双引号包起来"
        ]
    return []


def check(path: str) -> list[str]:
    full = path if os.path.isfile(path) else os.path.join(REPO_ROOT, path)
    if not os.path.isfile(full):
        return [f"[缺失] {path} 不存在"]

    data = open(full, "rb").read()
    problems: list[str] = []

    # ── 1) BOM 必须不存在 ──
    if data.startswith(BOM):
        problems.append(
            f"[编码] {path} 带了 UTF-8 BOM —— cmd 会把首行的 @echo off 读成乱码并报错。"
            "请另存为「UTF-8 无 BOM」"
        )
        data = data[len(BOM):]  # 后续检查按无 BOM 处理

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as e:
        return [f"[编码] {path} 不是合法 UTF-8：{e}"]

    # ── 2) 行尾必须是 CRLF ──
    bare_lf = [i for i, m in enumerate(re.finditer(rb"(?<!\r)\n", data), 1) if m]
    if b"\r\n" not in data:
        problems.append(
            f"[行尾] {path} 完全没有 CRLF 行尾 —— 纯 LF 会让 goto / call 找不到标签。"
            "请转成 Windows(CRLF) 行尾"
        )
    elif bare_lf:
        problems.append(
            f"[行尾] {path} 有 {len(bare_lf)} 行是纯 LF（第 "
            f"{', '.join(str(n) for n in bare_lf[:5])} 行等）—— 必须统一 CRLF"
        )

    lines = text.replace("\r\n", "\n").split("\n")

    # ── 3) 含中文时必须有 chcp 65001，且在第一处中文之前 ──
    if has_cjk(text):
        chcp_at = text.find("chcp 65001")
        first_cjk = next(
            (i for i, ch in enumerate(text) if "\u4e00" <= ch <= "\u9fff"), -1
        )
        if chcp_at < 0:
            problems.append(
                f"[码页] {path} 含中文但没有 `chcp 65001` —— 中文会变乱码"
            )
        elif chcp_at > first_cjk:
            problems.append(
                f"[码页] {path} 的 `chcp 65001` 出现在第一处中文之后，"
                "前面的中文仍会乱码，请把它挪到脚本最前面"
            )

    # ── 4~7) 逐行检查 ──
    labels: dict[str, int] = {}
    for i, line in enumerate(lines, 1):
        m = RE_LABEL_DEF.match(line)
        if m:
            name = m.group(1).lower()
            if name in labels:
                problems.append(
                    f"[标签] {path}:{i} 标签 :{m.group(1)} 重复定义"
                    f"（首次出现在第 {labels[name]} 行）"
                )
            else:
                labels[name] = i

    goto_targets: list[tuple[str, int, str]] = []
    for i, line in enumerate(lines, 1):
        stripped = line.rstrip()
        # 6) 续行符后有空白
        if stripped != line and stripped.endswith("^"):
            problems.append(
                f"[续行符] {path}:{i} 脱字符 ^ 后面有空白字符，续行会失效"
            )
        if stripped.startswith("rem ") or stripped.startswith("::"):
            continue
        # 7) echo 特殊字符
        problems.extend(check_echo(line, i, path))
        # 4) 收集 goto / call 目标
        for kind, rx in (("goto", RE_GOTO), ("call", RE_CALL_LABEL)):
            for m in rx.finditer(line):
                target = m.group(1).lower()
                if target not in BUILTIN_LABELS:
                    goto_targets.append((kind, i, target))

    for kind, lineno, target in goto_targets:
        if target not in labels:
            problems.append(
                f"[标签] {path}:{lineno} `{kind} :{target}` 指向的标签不存在"
            )

    # ── 5) 百分号：for 块内 / 块外 ──
    # 说明：批处理里 `for ... do (` 是多行块，`for ... do 命令` 是单行。
    # 循环变量（%%A）永远出现在 `for` 那一行上，所以判定「是否在 for 里」时，
    # 必须把**当前行本身是 for 头**也算进去，否则单行 for 会被误判。
    for_stack: list[int] = []
    for i, line in enumerate(lines, 1):
        stripped = line.rstrip()
        if stripped.startswith("rem ") or stripped.startswith("::"):
            continue
        code = strip_quoted(stripped)
        is_for_header = bool(re.match(r"^\s*(@)?for\b", code, re.I))
        in_for = bool(for_stack) or is_for_header

        if not in_for:
            for m in re.finditer(r"%%([A-Za-z])", code):
                problems.append(
                    f"[百分号] {path}:{i} 非 for 块里出现 `%%{m.group(1)}`，"
                    "这里应该用单百分号"
                )
        else:
            # (?<!%) 是必须的：否则 %%L 的第二个 % 会被误当成「少写了一个 %」
            for m in re.finditer(r"(?<!%)%(?!%)[A-Za-z](?![A-Za-z0-9_]*%)", code):
                problems.append(
                    f"[百分号] {path}:{i} for 块里出现 `{m.group(0)}`，"
                    "循环变量必须写成双百分号（如 %%A）"
                )

        # 维护多行 for 块的深度：头行以 `(` 结尾则入栈，独占一行的 `)` 出栈
        if is_for_header and code.rstrip().endswith("("):
            for_stack.append(i)
        elif stripped == ")" and for_stack:
            for_stack.pop()

    return problems


def main(argv: list[str]) -> int:
    targets = argv[1:] or DEFAULT_TARGETS
    all_problems: list[str] = []
    for t in targets:
        all_problems.extend(check(t))

    for p in all_problems:
        print("  " + p)

    print(f"\n检查 {len(targets)} 个批处理文件：问题 {len(all_problems)} 条")
    return 1 if all_problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
