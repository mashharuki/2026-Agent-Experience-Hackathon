"""Generate the editable two-page diagram of the deployed Snipe AI Regatta (draw.io).

Page 1: the AWS architecture of SnipeRegattaStack as deployed on 2026-10-23.
Page 2: one tactical decision, from the browser snapshot to the steering.
Standard library only; official AWS icons are embedded from aws-icons/.
"""

import base64
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOC = ET.Element("mxfile", host="app.diagrams.net", type="device")
FONT = "fontFamily=Helvetica;fontColor=#163047;"
ROOT = None


def page(name, width, height):
    global ROOT
    diagram = ET.SubElement(DOC, "diagram", name=name, id=name.split()[0])
    model = ET.SubElement(
        diagram,
        "mxGraphModel",
        grid="1",
        page="1",
        pageScale="1",
        pageWidth=str(width),
        pageHeight=str(height),
        background="#FFFFFF",
    )
    ROOT = ET.SubElement(model, "root")
    ET.SubElement(ROOT, "mxCell", id="0")
    ET.SubElement(ROOT, "mxCell", id="1", parent="0")


def cell(key, value, x, y, width, height, style, parent="1"):
    node = ET.SubElement(
        ROOT, "mxCell", id=key, value=value, style=FONT + style, vertex="1", parent=parent
    )
    ET.SubElement(
        node,
        "mxGeometry",
        x=str(x),
        y=str(y),
        width=str(width),
        height=str(height),
        attrib={"as": "geometry"},
    )


def text(key, value, x, y, width, height, size=17, parent="1", bold=False, color=None, valign="middle"):
    style = (
        f"text;html=0;whiteSpace=wrap;align=left;verticalAlign={valign};"
        f"fontSize={size};strokeColor=none;fillColor=none;fontStyle={int(bold)};"
    )
    if color:
        style += f"fontColor={color};"
    cell(key, value, x, y, width, height, style, parent)


def panel(key, title, x, y, width, height, fill="#F2F7FB", stroke="#A9BECF", dashed=False):
    cell(
        key,
        "",
        x,
        y,
        width,
        height,
        f"rounded=1;arcSize=6;fillColor={fill};strokeColor={stroke};strokeWidth=2;dashed={int(dashed)};",
    )
    text(key + "-title", title, x + 18, y + 8, width - 36, 34, 18, bold=True)


def service(key, title, body, icon, x, y, width=250, height=170, accent="#779AB4"):
    cell(
        key,
        "",
        x,
        y,
        width,
        height,
        f"rounded=1;arcSize=8;fillColor=#FFFFFF;strokeColor={accent};strokeWidth=2;",
    )
    if icon:
        svg = base64.b64encode((HERE / "aws-icons" / f"{icon}.svg").read_bytes()).decode()
        cell(
            key + "-icon",
            "",
            14,
            14,
            44,
            44,
            "shape=image;imageAspect=0;image=data:image/svg+xml," + svg + ";",
            key,
        )
        text(key + "-label", title, 68, 10, width - 80, 52, 18, key, bold=True)
    else:
        text(key + "-label", title, 16, 10, width - 32, 52, 19, key, bold=True)
    text(key + "-body", body, 16, 68, width - 32, height - 78, 15, key, color="#3A5670", valign="top")


def edge(key, source, target, label="", anchors="", dashed=False, points=(), color="#426782"):
    node = ET.SubElement(
        ROOT,
        "mxCell",
        id=key,
        value=label,
        source=source,
        target=target,
        edge="1",
        parent="1",
        style=FONT
        + f"edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor={color};strokeWidth=2;"
        f"endArrow=block;labelBackgroundColor=#FFFFFF;fontSize=14;dashed={int(dashed)};"
        + anchors,
    )
    geometry = ET.SubElement(node, "mxGeometry", relative="1", attrib={"as": "geometry"})
    if points:
        array = ET.SubElement(geometry, "Array", attrib={"as": "points"})
        for x, y in points:
            ET.SubElement(array, "mxPoint", x=str(x), y=str(y))


RIGHT = "exitX=1;exitY=0.5;entryX=0;entryY=0.5;"
DOWN = "exitX=0.5;exitY=1;entryX=0.5;entryY=0;"

# --- Page 1: AWS architecture ---------------------------------------------------------
page("01 AWS architecture", 1720, 1150)
text("title", "Snipe AI Regatta  |  AWS architecture (SnipeRegattaStack)", 40, 18, 1600, 48, 30, bold=True)
text(
    "subtitle",
    "Deployed and verified 2026-10-23 · Tokyo ap-northeast-1 (CloudFront is global) · "
    "simulation and rendering run in the browser; only tactical choices and the debrief go to AWS",
    42,
    70,
    1640,
    30,
    16,
    color="#4F6B82",
)
service(
    "browser",
    "Browser (desktop)\nReact + Three.js",
    "30 Hz sailing simulation and rendering.\nNever waits for the model.\nApplies a reply only if it is fresh.",
    None,
    40,
    470,
    250,
    190,
    "#4B83C3",
)
panel("aws", "AWS Cloud  /  ap-northeast-1", 330, 120, 1350, 870)
service("cdn", "Amazon\nCloudFront", "HTTPS, serves the SPA.\nOrigin access control.", "cloudfront", 380, 180)
service("site", "Amazon S3", "Private bucket with the\nstatic build and config.json.", "s3", 700, 180)
service(
    "auth",
    "Amazon\nCognito",
    "Email-verified sign-up.\nCode + PKCE, public client.\nScope regatta/race.",
    "cognito",
    1380,
    180,
    260,
)
service(
    "api",
    "Amazon\nAPI Gateway",
    "HTTP API, JWT + scope on\nevery route; sets\nx-regatta-user from sub.\nThrottle 5 req/s.",
    "apigateway",
    380,
    470,
    250,
    190,
)
panel("vpc", "VPC  /  public subnets  ·  no NAT gateway, no load balancer", 680, 410, 960, 300, "#F5F9EE", "#779C46")
service(
    "map",
    "AWS Cloud Map",
    "Routes /health and /decide\nto decider.regatta.internal\n(SRV, port 8080).",
    None,
    720,
    470,
    250,
    190,
    "#779C46",
)
service(
    "decider",
    "ECS on Fargate\nDecider service",
    "Strands Decider 2B, pinned revision.\n16 vCPU / 32 GiB, one request at a time.\n6 s budget on its own clock; per-user\nand per-process limits. 0 tasks by default.",
    "fargate",
    1040,
    470,
    560,
    190,
    "#E28B27",
)
service(
    "lambda",
    "AWS Lambda\nDebrief",
    "Strict race summary in.\n[D#] references checked\nagainst the decision log.",
    "lambda",
    380,
    780,
    250,
)
service(
    "bedrock",
    "Amazon\nBedrock",
    "Nova Lite, Converse API.\nOne call, 800 tokens max,\nno automatic retry.",
    "bedrock",
    700,
    780,
    250,
)
service(
    "ddb",
    "Amazon\nDynamoDB",
    "Daily debrief quota per user\nand overall, reserved\natomically. No race data.",
    "dynamodb",
    1020,
    780,
    250,
)
service("ecr", "Amazon ECR", "Pinned Decider image\n(model weights inside).", "ecr", 1340, 780, 260)
edge("e-https", "browser", "cdn", "HTTPS", "exitX=0.5;exitY=0;entryX=0;entryY=0.5;", points=[(165, 265)])
edge("e-oac", "cdn", "site", "OAC", RIGHT)
edge(
    "e-login",
    "browser",
    "auth",
    "sign-in (Code + PKCE)",
    "exitX=0.25;exitY=0;entryX=0.5;entryY=0;",
    True,
    [(102, 110), (1510, 110)],
    "#8C63B5",
)
edge("e-jwt", "browser", "api", "Bearer JWT", RIGHT)
edge(
    "e-issuer",
    "auth",
    "api",
    "JWT issuer / audience",
    "exitX=0.5;exitY=1;entryX=0.5;entryY=0;",
    True,
    [(1510, 395), (505, 395)],
    "#8C63B5",
)
edge("e-link", "api", "map", "VPC link", RIGHT)
edge("e-srv", "map", "decider", "SRV :8080", RIGHT)
edge("e-debrief", "api", "lambda", "/debrief", DOWN)
edge("e-converse", "lambda", "bedrock", "Converse", RIGHT)
edge("e-quota", "lambda", "ddb", "quota", "exitX=0.5;exitY=1;entryX=0.5;entryY=1;", points=[(505, 970), (1145, 970)])
edge("e-pull", "ecr", "decider", "image pull", "exitX=0.5;exitY=0;entryX=0.85;entryY=1;", True, color="#9B7B51")
panel("ops", "Operations and cost", 40, 1010, 1640, 110, "#FFF8EC", "#E9C489")
text(
    "ops-text",
    "The Decider task is started on demand (aws ecs update-service --desired-count 1) and costs about $0.99/hour "
    "while it runs, idle included; it is stopped again after use.  ·  Logs keep ids, enums and timings for one week, "
    "never observations or tokens.  ·  Future wind, the random seed and the spectator's prediction never leave the browser.",
    60,
    1050,
    1600,
    60,
    15,
)

# --- Page 2: one decision -----------------------------------------------------------------
page("02 One decision", 1720, 760)
text("title", "One decision: snapshot → options → choice → checks → steering", 40, 18, 1640, 48, 30, bold=True)
text(
    "subtitle",
    "Every 8 simulated seconds per boat · one request in flight · at most 96 per race · the race keeps moving while the model thinks",
    42,
    70,
    1640,
    30,
    16,
    color="#4F6B82",
)
steps = [
    (
        "snap",
        "1  Snapshot (browser)",
        "This boat, the other three, the current wind at the boat, gusts visible now, the mark, the current plan and the boat's profile.\nNo future wind, no seed, no prediction.",
        "#4B83C3",
    ),
    (
        "narrow",
        "2  Code narrows",
        "Only legal options for the leg: tack upwind, jibe or head to finish downwind, approach the mark within 45 m, gusts that are ahead.\nHold course is always offered, so the model always has a real choice.",
        "#779AB4",
    ),
    (
        "choose",
        "3  Strands Decider 2B",
        "Typed choice question choose_sailing_tactic (fleet-v4).\nReturns one option, the probability of every option and a confidence.",
        "#E28B27",
    ),
    (
        "check",
        "4  Freshness checks",
        "Same race, epoch, sequence and boat; within 6 s on AWS (3 s locally); the boat is still on the same leg.\nOtherwise: expired or rejected.",
        "#779AB4",
    ),
    (
        "steer",
        "5  Steering (browser)",
        "The chosen tactic becomes a target; the steering code shared by all four boats follows it.\nDifferent choices split the tracks.",
        "#4B83C3",
    ),
]
for index, (key, title, body, accent) in enumerate(steps):
    service(key, title, body, "fargate" if key == "choose" else None, 40 + index * 334, 140, 300, 250, accent)
    if index:
        edge(f"e-{index}", steps[index - 1][0], key, "", RIGHT)
panel("discard", "Never applied", 40, 430, 530, 270, "#FDF3F2", "#D9A39C")
text(
    "discard-text",
    "Replies that arrive late, belong to a paused, ended or restarted race, or no longer fit the boat's leg are logged and change nothing.\n\nTwo failures in a row end the race as \"no result\"; rules never stand in for the model silently.\n\nThe rule-based preview never calls the model and is labelled as rules.",
    62,
    480,
    490,
    210,
    15,
    valign="top",
)
panel("replay", "Recorded and replayable", 595, 430, 530, 270)
text(
    "replay-text",
    "Each decision records the boat, option, source (decider, preview, fallback), observed and applied ticks, status and latency.\n\nA saved race stores the physics and wind versions and the applied decisions; replaying it reproduces the race without calling any model.",
    617,
    480,
    490,
    210,
    15,
    valign="top",
)
panel("debrief", "After the finish: Bedrock debrief", 1150, 430, 530, 270, "#F2FBF7", "#8CC6B8")
text(
    "debrief-text",
    "One request with a strict summary: finish times, outcome, prediction and the decision log as enums and ticks. No free text.\n\nNova Lite cites decisions as [D1], [D2]…; references to decisions that do not exist are removed. Daily quota, 800 tokens, no retry. Preview-only races are not sent.",
    1172,
    480,
    490,
    210,
    15,
    valign="top",
)

ET.indent(DOC)
ET.ElementTree(DOC).write(HERE / "snipe-regatta.drawio", encoding="utf-8", xml_declaration=True)
print(HERE / "snipe-regatta.drawio")
