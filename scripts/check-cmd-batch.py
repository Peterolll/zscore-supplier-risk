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
  3. **必须纯 ASCII（硬规则）**：cmd.exe 解析含非 ASCII 字节的批处理时会**字符错位**，
     把一行从中间切断、再把残片当命令执行，用户看到满屏
     「xxx 不是内部或外部命令」。`chcp 65001` **只能修显示、修不了解析**，
     所以中文提示没有安全的写法 —— 要么改成英文，要么改用 .ps1
  4. **标签**：`goto :label` / `call :label` 引用的标签必须真实存在；标签不得重复
  5. **百分号**：`for` 块外写了 `%%X`，或 `for` 块内写了 `%X` —— 批处理最常见的错
  6. **续行符**：`^` 后面跟了空白字符，续行会失效
  7. **echo 行的特殊字符**：未转义的 `&` `|` `<` `>`（命令分隔/重定向）、
     裸露的 `!`（被延迟展开吃掉）
  8. **括号只能是块分隔符**：除了 `if ... (` / `for ... do (` / `)` `) else (` 这几种
     形态，任何其它行出现 `(` 或 `)` 都报错（**`rem` 行也不例外**）——
     块内的一个多余括号会提前闭合那个块，后面的命令会被整体误读。
     **例外**：双引号内的括号会被剥离后再判断，因为 cmd 不会把引号里的
     `(` `)` 当块分隔符（例如 `node -e "process.exit(x?1:0)"` 是合法的）
  9. **`goto` 不得写在 `(...)` 块内部**：块会被整体预解析，块内跳转行为难预测。
     统一改成「标志位 + 块外平铺 goto」：块内只 echo，块外再判断、再跳

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

# 自动发现仓库内所有 .cmd / .bat，而不是维护一份手写清单 ——
# 手写清单必然出现「新增了脚本却忘了加进来」的漏网（本项目已有 3 个脚本）。
# 只跳过第三方依赖与构建产物目录。
SKIP_DIRS = {
    "node_modules", ".venv", "venv", ".next", ".git", "out", "build", "dist",
    "__pycache__", ".workbuddy", "uploads", "output",
}


def discover_targets() -> list[str]:
    """返回仓库内全部 .cmd / .bat 的相对路径（已排序）。"""
    found: list[str] = []
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if name.lower().endswith((".cmd", ".bat")):
                found.append(os.path.relpath(os.path.join(root, name), REPO_ROOT))
    return sorted(found)

# ── 正则 ──────────────────────────────────────────────────────────
RE_LABEL_DEF = re.compile(r"^\s*:([A-Za-z_][\w]*)\s*$")
RE_GOTO = re.compile(r"\bgoto\s+:?([A-Za-z_][\w]*)", re.I)
RE_CALL_LABEL = re.compile(r"\bcall\s+:([A-Za-z_][\w]*)", re.I)
RE_ECHO = re.compile(r"^\s*@?echo(\.|,|;|:|\(|\s)?(.*)$", re.I)

# 括号的合法形态：只作为 if / for 的块分隔符
RE_BLOCK_OPEN = re.compile(r"^(?:if|for|else)\b.*\($", re.I)
RE_BLOCK_CLOSE = re.compile(r"^\)$")
RE_CLOSE_ELSE = re.compile(r"^\)\s*else\s*\($")
# 单行 for 的合法形态：`for %%X in (<集合>) do <命令>`
# 这里的括号是 for 的「集合」语法，不是块分隔符，且整行在同一行内闭合。
RE_FOR_INLINE = re.compile(r"^\s*@?for\b.*\bin\s*\([^)]*\)\s*do\b", re.I)
# 多行 for 块的开启行（用于规则 9 的 for 深度计算）
RE_FOR_BLOCK_OPEN = re.compile(r"^\s*@?for\b.*\($", re.I)

# 内置伪标签，不需要自己定义
BUILTIN_LABELS = {"eof"}


def block_shape_ok(line: str) -> bool:
    """这一行是不是「括号只当块分隔符」的合法形态？"""
    s = line.strip()
    return bool(
        RE_BLOCK_OPEN.match(s)
        or RE_BLOCK_CLOSE.match(s)
        or RE_CLOSE_ELSE.match(s)
        or RE_FOR_INLINE.match(s)
    )


def strip_quoted(s: str) -> str:
    """把双引号包裹的内容换成占位符，避免引号内的特殊字符被误判。"""
    return re.sub(r'"[^"]*"', '""', s)


def check_echo(line: str, lineno: int, path: str) -> list[str]:
    """echo 行里三类「会被 cmd 吃掉/误读」的字符。"""
    m = RE_ECHO.match(line)
    if not m:
        return []
    body = m.group(2)
    # 剥掉 ^ 转义与引号内容，剩下的才是真正「裸露」的字符
    body = re.sub(r"\^.?", "", body)
    body = strip_quoted(body)
    # 再剥掉**有意的重定向**（`>file` / `2>nul` / `>>log` / `2>&1` / `<nul`）——
    # 那些 `>` `<` 是语法而不是误入文案的裸字符，例如
    #     echo x>write-test.tmp 2>nul
    # 是合法的「写个测试文件」，不该报错。剩下的 `& | < >` 才是真问题。
    body = re.sub(r"\d*>>?\s*(?:&?\d+|nul|[^\s|&<>]+)", "", body, flags=re.I)
    body = re.sub(r"\d*<\s*(?:&?\d+|nul|[^\s|&<>]+)", "", body, flags=re.I)

    problems: list[str] = []
    bad = [c for c in "&|<>" if c in body]
    if bad:
        problems.append(
            f"[echo] {path}:{lineno} echo 行里有未转义的 {' '.join(bad)}，"
            "会被当成命令分隔 / 重定向；需写成 ^& ^| ^< ^> 或放进双引号"
        )
    # 括号由独立的「括号只能是块分隔符」规则统一检查，这里不重复报
    # !VAR! 是合法的延迟展开，先把它们摘掉，剩下的裸 ! 才会被吃掉
    residue = re.sub(r"![A-Za-z_][A-Za-z0-9_]*!", "", body)
    if "!" in residue:
        problems.append(
            f"[echo] {path}:{lineno} echo 行里有裸露的 ! —— "
            "在 setlocal enabledelayedexpansion 下会被吃掉；请写成 ^! 或改写文案"
        )
    return problems


def check_goto_in_block(lines: list[str], path: str) -> list[str]:
    """规则 9：`goto` 不得出现在 `for` 块内部。

    **为什么只管 for 块**：`for ... do (` 的循环体是会被反复执行的单元，
    从循环体里 `goto` 出去（尤其是 `for /f ... in ('命令')` 那种带管道/子进程的），
    在旧 cmd 上会产生难预测的行为；而 `if ... (` 块内 `goto` 实测完全正常
    （本项目 setup-windows.cmd 有 8 处这样的写法，客户机上已成功跑通），
    所以不把 `if` 块纳入硬规则，避免为了规则而改动已验证可用的代码。

    正确的替代写法（标志位 + 块外平铺 goto）：
        set "FATAL="
        if not exist "x" set "FATAL=1"
        if defined FATAL (
            echo ...
        )
        if defined FATAL goto :fail
    """
    problems: list[str] = []
    for_depth = 0
    for i, line in enumerate(lines, 1):
        s = line.strip()
        if s.startswith("rem ") or s.startswith("::"):
            continue
        code = strip_quoted(s)

        if RE_BLOCK_CLOSE.match(s):
            for_depth = max(0, for_depth - 1)
        elif RE_FOR_BLOCK_OPEN.match(s):
            for_depth += 1

        if for_depth > 0 and re.match(r"^@?goto\b", code, re.I):
            problems.append(
                f"[块内goto] {path}:{i} `goto` 写在 for (...) 循环体内部 —— "
                "带管道的 for /f 尤其容易出事。请改成「标志位 + 块外平铺 goto」："
                "先 set 一个变量，块内只 echo，块外用 if defined 判断后再 goto"
            )
    return problems


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

    # ── 3) 必须纯 ASCII ──
    # 这是在客户机上实测踩出来的：中文批处理不是「乱码」那么轻，
    # 而是 cmd 会丢失字符同步、把一行从中间切断，残片被当成命令执行。
    # chcp 65001 只能让存活下来的文字显示正确，解析依旧是坏的。
    non_ascii = [(i, ch) for i, ch in enumerate(text) if ord(ch) > 127]
    if non_ascii:
        line_of = text[: non_ascii[0][0]].count("\n") + 1
        sample = "".join(ch for _, ch in non_ascii[:8])
        problems.append(
            f"[ASCII] {path} 含 {len(non_ascii)} 处非 ASCII 字符"
            f"（首个在第 {line_of} 行，例如 `{sample}`）—— "
            "cmd.exe 解析含非 ASCII 字节的批处理时会字符错位、把行从中间切断，"
            "残片被当成命令执行（用户看到满屏「不是内部或外部命令」）；"
            "chcp 65001 只能修显示、修不了解析。"
            "请把提示改成纯 ASCII 英文（中文说明写进 Markdown 指南），或改用 .ps1"
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
        # 括号只允许作为 if / for 的块分隔符出现 —— rem 行也不例外，
        # 因为块内的一个多余 ) 会把块提前闭合，后面的命令全被误读。
        #
        # 但**双引号内的括号不参与 cmd 的块解析**，所以必须先剥离引号内容再判断。
        # 否则 `node -e "process.exit(a?1:0)"` 这类完全合法的命令行会被误报
        # （引号里的 ( ) 只是 JS 语法，cmd 根本看不见它们）。
        paren_scan = strip_quoted(stripped)
        if ("(" in paren_scan or ")" in paren_scan) and not block_shape_ok(stripped):
            problems.append(
                f"[括号] {path}:{i} 出现了不是块分隔符的括号 —— "
                "一旦本行位于 if/for 的 (...) 块内，括号会提前闭合那个块，"
                "后面的命令会被误读。请改写文案，或写成 ^( ^)"
            )
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

    # ── 9) goto 不得写在 (...) 块内部 ──
    problems.extend(check_goto_in_block(lines, path))

    return problems


def main(argv: list[str]) -> int:
    targets = argv[1:] or discover_targets()
    all_problems: list[str] = []
    for t in targets:
        all_problems.extend(check(t))

    for p in all_problems:
        print("  " + p)

    print(f"\n检查 {len(targets)} 个批处理文件：问题 {len(all_problems)} 条")
    return 1 if all_problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
