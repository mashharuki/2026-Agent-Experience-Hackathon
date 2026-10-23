"""Build the Snipe AI Regatta cover (1920x1080 SVG); standard library only.

Usage: python3 make-cover.py  -> cover.svg (render with rsvg-convert)
Colors follow apps/regatta-web/DESIGN.md and the four boats in sailing-sim's FLEET.
"""

import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
W, H, HORIZON = 1920, 1080, 560
NAVY, SEA_DEEP, SEA, SKY, SAIL, BUOY = "#102f43", "#06465e", "#167a8c", "#bfdce9", "#f8fcfa", "#ef8354"
FONT = "font-family=\"'Avenir Next','Helvetica Neue',system-ui,sans-serif\""
BOATS = [
    # name, hull color, x, y, scale, heel (deg), facing (1 = sails to the right)
    ("Jade", "#4ca991", 1720, 600, 0.42, -4, -1),
    ("Coral", "#d9a548", 1210, 640, 0.55, 5, 1),
    ("Zephyr", "#4fa8ce", 1560, 700, 0.75, -6, -1),
    ("Aurora", "#ef8354", 1330, 820, 1.0, 7, 1),
]


def boat(name, color, x, y, scale, heel, facing):
    """A Snipe-like dinghy: low hull, tall main, small jib, two crew, a reflection."""
    s = scale
    hull = (
        f"M{-150 * s},{0} C{-120 * s},{26 * s} {110 * s},{30 * s} {170 * s},{-4 * s} "
        f"L{150 * s},{-14 * s} L{-140 * s},{-12 * s} Z"
    )
    mast_x = 10 * s * facing
    main = (
        f"M{mast_x},{-20 * s} L{mast_x},{-330 * s} "
        f"Q{mast_x + facing * 70 * s},{-170 * s} {mast_x + facing * 150 * s},{-26 * s} Z"
    )
    jib = (
        f"M{mast_x - facing * 8 * s},{-40 * s} L{mast_x - facing * 8 * s},{-250 * s} "
        f"L{mast_x - facing * 120 * s},{-22 * s} Z"
    )
    crew = "".join(
        f'<circle cx="{cx * s * facing}" cy="{-30 * s}" r="{11 * s}" fill="{c}"/>'
        f'<rect x="{(cx - 9) * s * facing - (18 * s if facing < 0 else 0)}" y="{-24 * s}" '
        f'width="{18 * s}" height="{20 * s}" rx="{6 * s}" fill="{c}"/>'
        for cx, c in ((60, "#f2c094"), (95, "#e8b483"))
    )
    reflection = (
        f'<g transform="scale(1,-0.22)" opacity="0.1">'
        f'<path d="{main}" fill="{SAIL}"/><path d="{hull}" fill="{color}"/></g>'
    )
    return (
        f'<g transform="translate({x},{y})">'
        f'<ellipse cx="0" cy="{6 * s}" rx="{190 * s}" ry="{16 * s}" fill="#ffffff" opacity="0.18"/>'
        f"{reflection}"
        f'<g transform="rotate({heel})">'
        f'<path d="{main}" fill="{SAIL}" stroke="#d7e3e6" stroke-width="{2 * s}"/>'
        f'<line x1="{mast_x}" y1="{-12 * s}" x2="{mast_x}" y2="{-336 * s}" stroke="#45606e" stroke-width="{4 * s}"/>'
        f'<path d="{jib}" fill="{SAIL}" opacity="0.95" stroke="#d7e3e6" stroke-width="{2 * s}"/>'
        f"{crew}"
        f'<path d="{hull}" fill="{color}"/>'
        f'<path d="M{-140 * s},{-12 * s} L{150 * s},{-14 * s}" stroke="#ffffff" stroke-width="{3 * s}" opacity="0.7"/>'
        f"</g></g>"
    )


def wake(points, color, width):
    """A tacking track: straight legs joined by short turns."""
    d = "M" + " L".join(f"{x},{y}" for x, y in points)
    return (
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" '
        f'stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 14" opacity="0.75"/>'
    )


def waves():
    rows = []
    for i in range(18):
        y = HORIZON + 12 + (i**1.6) * 4.2
        amp, length = 1.5 + i * 0.35, 90 + i * 14
        d = f"M0,{y:.1f} " + " ".join(
            f"Q{x + length / 4:.0f},{y - amp:.1f} {x + length / 2:.0f},{y:.1f} "
            f"T{x + length:.0f},{y:.1f}"
            for x in range(0, W, int(length))
        )
        rows.append(
            f'<path d="{d}" fill="none" stroke="#bfe6ee" stroke-width="{1 + i * 0.12:.2f}" '
            f'opacity="{0.10 + i * 0.012:.3f}"/>'
        )
    return "".join(rows)


def chip(x, y, text, color):
    width = 18 + len(text) * 15
    return (
        f'<g transform="translate({x},{y})">'
        f'<rect width="{width}" height="40" rx="20" fill="#102f43" opacity="0.82"/>'
        f'<circle cx="20" cy="20" r="7" fill="{color}"/>'
        f'<text x="34" y="27" {FONT} font-size="20" font-weight="600" fill="#f8fcfa">{text}</text>'
        f"</g>"
    )


def build():
    glints = "".join(
        f'<rect x="{1500 + 220 * math.sin(i * 1.7):.0f}" y="{HORIZON + 6 + i * 9}" '
        f'width="{60 - i * 2}" height="2" rx="1" fill="#fff6dc" opacity="{0.55 - i * 0.03:.2f}"/>'
        for i in range(14)
    )
    tracks = (
        wake([(1290, 1080), (1180, 980), (1340, 905), (1330, 840)], "#ffd3bf", 5)
        + wake([(1700, 1000), (1540, 900), (1650, 790), (1560, 715)], "#c7e8f5", 4)
        + wake([(1060, 860), (1230, 760), (1150, 700), (1210, 652)], "#f6e2b5", 3)
        + wake([(1880, 740), (1760, 670), (1820, 630), (1720, 608)], "#c4eadf", 2.5)
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-labelledby="cover-title">
  <title id="cover-title">Snipe AI Regatta: four AI sailboats race toward a mark. Read the wind. Pick the winner.</title>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fc0d6"/>
      <stop offset="0.7" stop-color="{SKY}"/>
      <stop offset="1" stop-color="#eef6f7"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a8fa0"/>
      <stop offset="0.35" stop-color="{SEA}"/>
      <stop offset="1" stop-color="{SEA_DEEP}"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff6dc" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#fff6dc" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{NAVY}" stop-opacity="0.78"/>
      <stop offset="0.55" stop-color="{NAVY}" stop-opacity="0.35"/>
      <stop offset="0.8" stop-color="{NAVY}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="{W}" height="{HORIZON}" fill="url(#sky)"/>
  <circle cx="1560" cy="{HORIZON - 70}" r="260" fill="url(#sun)"/>
  <path d="M0,{HORIZON} L0,{HORIZON - 26} C180,{HORIZON - 40} 300,{HORIZON - 18} 470,{HORIZON - 30} C620,{HORIZON - 44} 760,{HORIZON - 16} 900,{HORIZON - 12} L900,{HORIZON} Z" fill="#7aa5b4" opacity="0.55"/>
  <rect y="{HORIZON}" width="{W}" height="{H - HORIZON}" fill="url(#sea)"/>
  {waves()}
  {glints}
  <g transform="translate(1440,{HORIZON + 8})">
    <path d="M-14,0 L14,0 L8,-34 L-8,-34 Z" fill="{BUOY}"/>
    <rect x="-9" y="-40" width="18" height="8" rx="2" fill="#ffffff"/>
    <ellipse cx="0" cy="3" rx="26" ry="5" fill="#ffffff" opacity="0.3"/>
  </g>
  {tracks}
  {"".join(boat(*b) for b in BOATS)}
  {chip(1395, 450, "Zephyr · tack_now", "#4fa8ce")}
  {chip(1450, 862, "Aurora · hold_course", "#ef8354")}
  <rect width="{W}" height="{H}" fill="url(#shade)"/>
  <g transform="translate(1760,120)" opacity="0.9">
    <circle r="54" fill="#ffffff" opacity="0.2" stroke="#ffffff" stroke-width="2"/>
    <path d="M0,-38 L13,10 L0,2 L-13,10 Z" fill="#ffffff" transform="rotate(200)"/>
    <text y="84" text-anchor="middle" {FONT} font-size="20" font-weight="700" fill="{NAVY}" letter-spacing="4">WIND</text>
  </g>
  <g {FONT} fill="#f8fcfa">
    <text x="120" y="250" font-size="30" font-weight="700" letter-spacing="8" fill="#ffd3bf">AI SAILING SPECTATOR GAME</text>
    <text x="114" y="390" font-size="132" font-weight="800" letter-spacing="-2">Snipe AI</text>
    <text x="114" y="530" font-size="132" font-weight="800" letter-spacing="-2">Regatta</text>
    <text x="120" y="625" font-size="54" font-weight="700">Read the wind. Pick the winner.</text>
    <text x="120" y="690" font-size="36" font-weight="500" opacity="0.92">Four boats. Four approaches. One changing sea.</text>
    <text x="120" y="790" font-size="26" font-weight="500" opacity="0.88">4 AI boats · tactics chosen by Strands Decider 2B</text>
    <text x="120" y="832" font-size="26" font-weight="500" opacity="0.88">post-race debrief by Amazon Bedrock · runs on AWS</text>
  </g>
  <g transform="translate(120,920)">
    {"".join(f'<circle cx="{i * 34}" cy="0" r="12" fill="{c}" stroke="#f8fcfa" stroke-width="3"/>' for i, c in enumerate(("#ef8354", "#4fa8ce", "#d9a548", "#4ca991")))}
    <text x="136" y="9" {FONT} font-size="24" font-weight="600" fill="#f8fcfa">Aurora · Zephyr · Coral · Jade</text>
  </g>
</svg>
"""


if __name__ == "__main__":
    (HERE / "cover.svg").write_text(build(), encoding="utf-8")
    print(HERE / "cover.svg")
