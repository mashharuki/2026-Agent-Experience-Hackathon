"""Build the 1920x1080 video title and end cards from the brand SVGs (standard library only).

Usage: python3 make-cards.py   -> title-card[-dark].svg, end-card[-dark].svg
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
PALETTE = {
    "": {"ink": "#0d3b73", "accent": "#1259a8", "muted": "#3d6a9e"},
    "-dark": {"ink": "#eaf4ff", "accent": "#7fbcf5", "muted": "#9cc4ee"},
}
FONT = "font-family=\"'Noto Sans JP','Hiragino Sans','Yu Gothic',system-ui,sans-serif\""


def inner(path):
    """Contents of an SVG file without its outer <svg> element."""
    return re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", path.read_text(encoding="utf-8"), flags=re.S).strip()


def mark(x, y, size):
    s = size / 512
    return f'<g transform="translate({x} {y}) scale({s})">{inner(HERE / "logo-mark.svg")}</g>'


def card(name, suffix, body):
    c = PALETTE[suffix]
    bg = inner(HERE / f"background-landscape{suffix}.svg")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">\n{bg}\n'
           f'{body(c)}\n</svg>\n')
    (HERE / f"{name}{suffix}.svg").write_text(svg, encoding="utf-8")


def title(c):
    return f'''{mark(170, 330, 280)}
<text x="520" y="440" {FONT} font-size="112" font-weight="800" fill="{c['ink']}" letter-spacing="-2">A little prep</text>
<text x="520" y="572" {FONT} font-size="112" font-weight="800" fill="{c['ink']}" letter-spacing="-2">before the photo</text>
<text x="524" y="664" {FONT} font-size="46" font-weight="500" fill="{c['accent']}" letter-spacing="4">撮る前のひと手間</text>
<text x="524" y="770" {FONT} font-size="40" fill="{c['muted']}">One small change. You decide. Code keeps the promise.</text>
<text x="170" y="975" {FONT} font-size="30" fill="{c['muted']}">AWS Agent Experience Hackathon: Strands Decider   ·   #strands-decider-2b   #tool-selection</text>'''


def end(c):
    return f'''{mark(832, 200, 256)}
<text x="960" y="590" text-anchor="middle" {FONT} font-size="104" font-weight="800" fill="{c['ink']}" letter-spacing="-2">Do less. Let people choose.</text>
<text x="960" y="680" text-anchor="middle" {FONT} font-size="44" font-weight="500" fill="{c['accent']}">A little prep before the photo (撮る前のひと手間)</text>
<text x="960" y="790" text-anchor="middle" {FONT} font-size="36" fill="{c['muted']}">github.com/mashharuki/2026-Agent-Experience-Hackathon</text>
<text x="960" y="850" text-anchor="middle" {FONT} font-size="30" fill="{c['muted']}">MIT license</text>'''


for suffix in PALETTE:
    card("title-card", suffix, title)
    card("end-card", suffix, end)
