#!/usr/bin/env python3
"""Generate the SMC logo SVGs.

Circular lettering is emitted as one rotated <text> element per character rather
than a <textPath>. librsvg — which renders the PNG used by the print/PDF
letterhead — silently drops <textPath>, so the wording vanished from the mark.
Per-character placement renders identically everywhere.

Usage:  python3 build_logo.py [output_dir]
"""

import math
import sys
from pathlib import Path

BRAND = "#868a4a"
# Multi-word family names must be quoted or the whole CSS declaration is invalid
# and the renderer silently falls back to a non-condensed default.
FONT = "'Liberation Sans Narrow', 'Arial Narrow', 'Helvetica Neue Condensed', Arial, sans-serif"

CX = CY = 500.0
R_OUTER, W_OUTER = 440.0, 14.0
R_INNER, W_INNER = 330.0, 11.0
R_TEXT = 386.0
R_STAR = 386.0

TOP_TEXT = "SHEIKH MAHBOOB & CO."
TOP_START, TOP_END = 193.0, 352.0
TOP_SIZE = 74.0

BOTTOM_TEXT = "LAHORE"
BOTTOM_START, BOTTOM_END = 125.0, 55.0
BOTTOM_SIZE = 74.0

STAR_ANGLES = (160.0, 20.0)
STAR_OUTER, STAR_INNER = 30.0, 12.5

ESCAPE = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}


def esc(char: str) -> str:
    return ESCAPE.get(char, char)


def arc_chars(text: str, start: float, end: float, size: float, flip: bool) -> list[str]:
    """One <text> per character, rotated so the baseline follows the circle.

    flip=False -> letters face outward (top of the badge).
    flip=True  -> letters face inward (bottom of the badge, read left to right).
    """
    out = []
    step = 0.0 if len(text) == 1 else (end - start) / (len(text) - 1)

    for index, char in enumerate(text):
        if char == " ":
            continue
        angle = start + index * step
        radians = math.radians(angle)
        x = CX + R_TEXT * math.cos(radians)
        y = CY + R_TEXT * math.sin(radians)
        rotation = angle - 90.0 if flip else angle + 90.0
        out.append(
            f'  <text class="smc-text" font-size="{size:g}" x="{x:.2f}" y="{y:.2f}" '
            f'text-anchor="middle" dominant-baseline="central" '
            f'transform="rotate({rotation:.2f} {x:.2f} {y:.2f})">{esc(char)}</text>'
        )
    return out


def star(angle: float) -> str:
    cx = CX + R_STAR * math.cos(math.radians(angle))
    cy = CY + R_STAR * math.sin(math.radians(angle))
    points = []
    for i in range(10):
        radius = STAR_OUTER if i % 2 == 0 else STAR_INNER
        theta = math.radians(-90.0 + i * 36.0)
        points.append(f"{cx + radius * math.cos(theta):.2f},{cy + radius * math.sin(theta):.2f}")
    return f'  <polygon class="smc-fill" points="{" ".join(points)}"/>'


STYLE = f"""  <defs>
    <style>
      .smc-ring {{ fill: none; stroke: {BRAND}; }}
      .smc-fill {{ fill: {BRAND}; }}
      .smc-text {{ fill: {BRAND}; font-family: {FONT}; font-weight: 700; }}
    </style>
  </defs>"""


def full_logo() -> str:
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" '
        'height="1000" role="img" aria-label="Sheikh Mahboob &amp; Co. Lahore">',
        "  <title>Sheikh Mahboob &amp; Co. — Lahore</title>",
        STYLE,
        f'  <circle class="smc-ring" cx="{CX:g}" cy="{CY:g}" r="{R_OUTER:g}" stroke-width="{W_OUTER:g}"/>',
        f'  <circle class="smc-ring" cx="{CX:g}" cy="{CY:g}" r="{R_INNER:g}" stroke-width="{W_INNER:g}"/>',
    ]
    parts += arc_chars(TOP_TEXT, TOP_START, TOP_END, TOP_SIZE, flip=False)
    parts += arc_chars(BOTTOM_TEXT, BOTTOM_START, BOTTOM_END, BOTTOM_SIZE, flip=True)
    parts += [star(a) for a in STAR_ANGLES]
    # textLength pins the monogram width so it never spills past the inner ring,
    # whatever font the renderer actually resolves.
    parts.append(
        f'  <text class="smc-text" x="{CX:g}" y="{CY:g}" font-size="300" text-anchor="middle" '
        f'dominant-baseline="central" textLength="470" lengthAdjust="spacingAndGlyphs">SMC</text>'
    )
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def compact_mark() -> str:
    """Small-size variant: rings, stars and monogram only.

    The circular wording is unreadable below roughly 96px, so it is dropped for
    favicon and navbar use.
    """
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" '
        'height="1000" role="img" aria-label="SMC">\n'
        "  <title>SMC</title>\n"
        f"{STYLE}\n"
        f'  <circle class="smc-ring" cx="500" cy="500" r="455" stroke-width="46"/>\n'
        f'  <circle class="smc-ring" cx="500" cy="500" r="370" stroke-width="26"/>\n'
        f'  <text class="smc-text" x="500" y="500" font-size="400" text-anchor="middle" '
        f'dominant-baseline="central" textLength="560" lengthAdjust="spacingAndGlyphs">SMC</text>\n'
        "</svg>\n"
    )


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "smc-logo.svg").write_text(full_logo(), encoding="utf-8")
    (out_dir / "smc-mark.svg").write_text(compact_mark(), encoding="utf-8")
    print(f"wrote {out_dir / 'smc-logo.svg'}")
    print(f"wrote {out_dir / 'smc-mark.svg'}")


if __name__ == "__main__":
    main()
