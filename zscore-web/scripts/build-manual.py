#!/usr/bin/env python3
"""README.md（用户手册）→ public/manual.html 静态转换。

用法（zscore-web 目录下）：
    python3 scripts/build-manual.py

README 更新后重跑一次即可，输出为自包含 HTML（无外部依赖），
由 app/manual/page.tsx 以 iframe 嵌入系统导航。

配色与系统一致：浅色底 / 蓝主色，与 public/workflow.html 视觉协调。
"""
from __future__ import annotations

import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "README.md"
OUT = ROOT / "public" / "manual.html"

CSS = """
:root {
  --bg: #f7f8fb;
  --panel: #ffffff;
  --ink: #1f2330;
  --ink-soft: #5b6473;
  --line: #d8dde6;
  --line-soft: #e7ebf2;
  --accent: #2563eb;
  --accent-soft: #eff4ff;
  --code-bg: #f1f3f8;
  --code-ink: #26303e;
  --ok: #16a34a;
  --warn: #d97706;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.75 -apple-system, "PingFang SC", "Hiragino Sans GB",
        "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
}
.wrap { max-width: 860px; margin: 0 auto; padding: 40px 28px 64px; }

/* 标题 */
h1 {
  font-size: 26px; line-height: 1.4; margin: 0 0 6px;
  color: var(--ink); letter-spacing: .2px;
}
h2 {
  font-size: 19px; margin: 36px 0 12px; padding: 8px 12px;
  border-left: 4px solid var(--accent);
  background: linear-gradient(90deg, var(--accent-soft), transparent 85%);
  border-radius: 4px; color: var(--ink);
}
h3 { font-size: 16px; margin: 24px 0 8px; color: var(--ink); }
p { margin: 10px 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* 版本信息框（blockquote） */
blockquote {
  margin: 14px 0 20px; padding: 10px 16px;
  background: var(--accent-soft); border: 1px solid var(--line);
  border-radius: 8px; color: var(--ink-soft); font-size: 13px;
}
blockquote p { margin: 2px 0; }

/* 代码 */
code {
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  font-size: 13px; background: var(--code-bg);
  color: var(--code-ink); padding: 1px 6px; border-radius: 4px;
}
pre {
  background: #10151f; color: #dbe2ee;
  padding: 14px 16px; border-radius: 8px;
  overflow-x: auto; line-height: 1.55; margin: 12px 0;
}
pre code { background: none; color: inherit; padding: 0; font-size: 12.5px; }

/* 表格 */
table {
  border-collapse: collapse; width: 100%; margin: 14px 0;
  font-size: 13.5px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px;
}
th, td {
  padding: 8px 12px; text-align: left; vertical-align: top;
  border-bottom: 1px solid var(--line-soft);
}
th { background: #eef2f8; font-weight: 600; border-bottom: 1px solid var(--line); }
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: #f8fafc; }

/* 列表 */
ul, ol { margin: 8px 0; padding-left: 24px; }
li { margin: 4px 0; }
li > ul, li > ol { margin: 2px 0; }
hr { border: none; border-top: 1px solid var(--line); margin: 28px 0; }
"""


def md_to_html(text: str) -> str:
    body = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists"],
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>供应商 Z-Score · 用户手册</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
{body}
</div>
</body>
</html>
"""


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(md_to_html(text), encoding="utf-8")
    print(f"✓ 已生成 {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
