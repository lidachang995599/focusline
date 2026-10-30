"""Render docs/PRIVACY.md as a standalone HTML page for GitHub Pages."""

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "PRIVACY.md"
TARGET = ROOT / "docs" / "privacy.html"


def inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def convert(markdown: str) -> str:
    lines = markdown.splitlines()
    out: list[str] = []
    paragraph: list[str] = []
    bullets: list[str] = []
    table: list[list[str]] = []

    def flush_paragraph() -> None:
        if paragraph:
            out.append(f"<p>{inline(' '.join(paragraph))}</p>")
            paragraph.clear()

    def flush_bullets() -> None:
        if bullets:
            out.append("<ul>" + "".join(f"<li>{inline(item)}</li>" for item in bullets) + "</ul>")
            bullets.clear()

    def flush_table() -> None:
        if not table:
            return
        head, *body = table
        out.append("<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>")
        for row in body:
            out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>")
        out.append("</tbody></table>")
        table.clear()

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            flush_paragraph()
            flush_bullets()
            flush_table()
            continue
        if line.startswith("# "):
            flush_paragraph(); flush_bullets(); flush_table()
            out.append(f"<h1>{inline(line[2:])}</h1>")
        elif line.startswith("## "):
            flush_paragraph(); flush_bullets(); flush_table()
            out.append(f"<h2>{inline(line[3:])}</h2>")
        elif line.startswith("- "):
            flush_paragraph(); flush_table()
            bullets.append(line[2:])
        elif line.lstrip().startswith("|"):
            flush_paragraph(); flush_bullets()
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                continue
            table.append(cells)
        else:
            flush_bullets(); flush_table()
            paragraph.append(line.strip())

    flush_paragraph(); flush_bullets(); flush_table()
    return "\n".join(out)


STYLE = """
:root { color-scheme: light dark; }
body { max-width: 760px; margin: 48px auto; padding: 0 22px;
  font: 16px/1.7 -apple-system, "Segoe UI", "PingFang SC", sans-serif; color: #1f2937; background: #fff; }
h1 { font-size: 30px; margin-bottom: 6px; }
h2 { font-size: 19px; margin-top: 34px; }
p, li { color: #374151; }
code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; font-size: 0.92em; }
table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 14px; }
th, td { border: 1px solid #e5e7eb; padding: 7px 9px; text-align: left; vertical-align: top; }
th { background: #f9fafb; }
a { color: #0369a1; }
footer { margin-top: 44px; font-size: 13px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 14px; }
@media (prefers-color-scheme: dark) {
  body { background: #0b1020; color: #e5e7eb; }
  p, li { color: #cbd5e1; }
  th { background: #111827; }
  th, td { border-color: #1e293b; }
  code { background: #111827; }
  footer { color: #94a3b8; border-color: #1e293b; }
}
"""

body = convert(SOURCE.read_text(encoding="utf-8"))
page = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FocusLine — Privacy Policy</title>
    <style>{STYLE}</style>
  </head>
  <body>
{body}
    <footer>
      FocusLine is open source under the MIT licence:
      <a href="https://github.com/lidachang995599/focusline">github.com/lidachang995599/focusline</a>
    </footer>
  </body>
</html>
"""
TARGET.write_text(page, encoding="utf-8")
print("wrote", TARGET)
