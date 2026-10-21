"""Generate the two-page editable regatta design using existing AWS SVG icons."""

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
        ROOT,
        "mxCell",
        id=key,
        value=value,
        style=FONT + style,
        vertex="1",
        parent=parent,
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


def text(key, value, x, y, width, height, size=17, parent="1"):
    cell(
        key,
        value,
        x,
        y,
        width,
        height,
        f"text;html=0;whiteSpace=wrap;align=left;verticalAlign=middle;"
        f"fontSize={size};strokeColor=none;fillColor=none;",
        parent,
    )


def panel(key, title, x, y, width, height, fill="#F2F7FB"):
    cell(
        key,
        "",
        x,
        y,
        width,
        height,
        f"rounded=1;fillColor={fill};strokeColor=#A9BECF;strokeWidth=2;",
    )
    text(key + "-title", title, x + 18, y + 8, width - 36, 36, 20)


def service(key, title, body, icon, x, y, width=230, height=160):
    cell(
        key,
        "",
        x,
        y,
        width,
        height,
        "rounded=1;fillColor=#FFFFFF;strokeColor=#779AB4;strokeWidth=2;",
    )
    if icon:
        svg = base64.b64encode(
            (HERE / "aws-icons" / f"{icon}.svg").read_bytes()
        ).decode()
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
        text(key + "-label", title, 68, 10, width - 80, 50, 19, key)
    else:
        text(key + "-label", title, 16, 10, width - 32, 50, 20, key)
    text(key + "-body", body, 16, 70, width - 32, height - 80, 16, key)


def edge(key, source, target, label="", anchors="", dashed=False, points=()):
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
        + "edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#426782;strokeWidth=2;"
        f"endArrow=block;labelBackgroundColor=#FFFFFF;fontSize=15;dashed={int(dashed)};"
        + anchors,
    )
    geometry = ET.SubElement(
        node, "mxGeometry", relative="1", attrib={"as": "geometry"}
    )
    if points:
        array = ET.SubElement(geometry, "Array", attrib={"as": "points"})
        for x, y in points:
            ET.SubElement(array, "mxPoint", x=str(x), y=str(y))


page("01 AWS architecture", 1700, 1110)
text("title", "Snipe AI Regatta  |  人間スキッパー vs AI", 40, 20, 1600, 50, 30)
text(
    "subtitle",
    "設計案・未実装 / 2026-10-21 / 操船と描画はブラウザー、戦術判断はAWS",
    42,
    78,
    1550,
    34,
    20,
)
panel(
    "aws",
    "AWS Tokyo（CloudFrontはグローバル） / 新スタックは未作成",
    350,
    135,
    1310,
    810,
)
panel(
    "runtime",
    "レース中の判断経路：8秒以上間隔 / 処理中1件 / 最大24回",
    370,
    425,
    1270,
    260,
)
service(
    "browser",
    "プレイヤーのPC\nReact + Three.js",
    "舵・メイン操作\n物理30Hz / 描画補間\nネットワーク待ちで停止しない",
    None,
    35,
    460,
    280,
    195,
)
service("cdn", "Amazon\nCloudFront", "HTTPS / SPA配信\nOAC", "cloudfront", 390, 220)
service("site", "Amazon S3", "静的アセット専用\n非公開・暗号化", "s3", 690, 220)
service(
    "auth",
    "Amazon\nCognito",
    "Code + PKCE\naccess token / scope",
    "cognito",
    1250,
    220,
    270,
)
service("api", "API Gateway", "HTTP API / JWT\n受付と結果取得", "apigateway", 390, 490)
service(
    "lambda", "AWS Lambda", "所有権・quota・lease\n原子的なjob受付", "lambda", 690, 490
)
service(
    "queue", "Amazon SQS", "job IDのみ / DLQ\n期限後は推論しない", "sqs", 990, 490, 210
)
service(
    "worker",
    "ECS Fargate",
    "Decider 2B / CPU\n起動時のみ1、普段0\n候補選択 → ツール",
    "fargate",
    1250,
    490,
    270,
)
service(
    "ddb",
    "Amazon\nDynamoDB",
    "race・job・判断・航跡\n所有者付き / 24時間",
    "dynamodb",
    690,
    755,
    280,
)
service(
    "ecr", "Amazon ECR", "固定revisionのモデル\nDockerイメージ", "ecr", 1010, 755, 220
)
service(
    "bedrock",
    "Amazon\nBedrock",
    "Nova Lite / 事後解説\nレース後1回のみ",
    "bedrock",
    1280,
    755,
    270,
)
edge(
    "web",
    "browser",
    "cdn",
    "SPA",
    "exitX=0.5;exitY=0;entryX=0;entryY=0.5;",
    points=[(170, 300)],
)
edge("origin", "cdn", "site", "OAC")
edge(
    "oauth",
    "browser",
    "auth",
    "Code + PKCE",
    "exitX=0.8;exitY=0;entryX=0.5;entryY=0;",
    True,
    [(260, 200), (1385, 200)],
)
edge("request", "browser", "api", "JWT API")
edge("route", "api", "lambda", "JWT")
edge("send", "lambda", "queue", "enqueue")
edge("pull", "queue", "worker", "取得")
edge("state", "lambda", "ddb", "受付・記録", "exitX=0.3;exitY=1;entryX=0.3;entryY=0;")
edge(
    "save",
    "worker",
    "ddb",
    "判断保存",
    "exitX=0;exitY=0.85;entryX=0.8;entryY=0;",
    points=[(1235, 710), (915, 710)],
)
edge("image", "ecr", "worker", "", "exitX=0.5;exitY=0;entryX=0.8;entryY=1;", True)
edge(
    "explain",
    "worker",
    "bedrock",
    "終了後のみ",
    "exitX=0.65;exitY=1;entryX=0.65;entryY=0;",
)
text(
    "return",
    "結果はDynamoDB → Lambda → SPA。3秒超・古いepoch・終了後の返答は適用しない。",
    400,
    918,
    1210,
    28,
    17,
)
panel("ops", "運用・信頼境界", 35, 975, 1625, 100, "#FFF6E6")
text(
    "ops-body",
    "CloudWatch / Budgets / Scheduler：起動・停止・監視・上限。CPU遅延と残予算の検証前には再デプロイしない。\n競技状態はブラウザーが正本。改ざん防止されたランキングや、実艇の完全再現は初版の対象外。",
    55,
    1018,
    1580,
    50,
    17,
)

page("02 Decision and control", 1650, 970)
text("title", "風を観測し、戦術を選び、同じ艇性能で実行する", 40, 20, 1550, 50, 30)
text(
    "subtitle",
    "設計案 / 未検証の戦術精度・推論遅延を達成済みと扱わない",
    42,
    80,
    1500,
    35,
    20,
)
service(
    "obs",
    "観測snapshot",
    "現在の艇と相手\n可視の風・ブロー\n未来の風・seedなし",
    None,
    40,
    190,
    250,
    200,
)
service(
    "eligible",
    "コードで候補制限",
    "レグ・旋回・場外\n実行不能な候補を除外\n最善の戦術は先に決めない",
    None,
    355,
    190,
    270,
    200,
)
service(
    "decider",
    "Strands Decider 2B",
    "維持 / タック / ブロー\nアプローチ / ジャイブ\n候補が複数なら実モデル",
    None,
    690,
    190,
    280,
    200,
)
service(
    "guard",
    "期限と状態の検査",
    "race / epoch / seq\n観測から実時間3秒\n遅い返答は破棄",
    None,
    1035,
    190,
    250,
    200,
)
service(
    "control",
    "通常の操船へ接続",
    "目標針路 → ラダー\n共通の舵角・回頭制限\n物理tickで航路が変わる",
    None,
    1350,
    190,
    260,
    200,
)
edge("e1", "obs", "eligible")
edge("e2", "eligible", "decider")
edge("e3", "decider", "guard")
edge("e4", "guard", "control")
panel(
    "fallback",
    "モデルを呼ばない／使えない場合も出所を分ける",
    40,
    465,
    760,
    170,
    "#FFF6E6",
)
text(
    "fallback-body",
    "候補1つ：source=policy、モデル値null\n期限切れ・不正応答：source=fallback、以前の戦術を維持\n2回連続の期限超過：クラウド対戦は中断扱い",
    60,
    515,
    715,
    100,
    19,
)
panel("history", "再生に必要な記録", 850, 465, 760, 170)
text(
    "history-body",
    "物理・風・ポーラの版、両艇の操作、判断の出所\n観測 / 受信 / 適用tick、破棄・上書き理由\nseedだけに頼らず、再生時はモデル呼び出し0回",
    870,
    515,
    715,
    100,
    19,
)
panel(
    "debrief",
    "結果と振り返り：人間が次に試したいことを見つける",
    40,
    705,
    1570,
    180,
    "#F4F0FA",
)
text(
    "debrief-body",
    "両艇の航跡＋当時の風＋判断マーカー → Bedrockが記録ID付きの事後解説を生成（最大1回）\n『AIがこう考えた』『この手なら必ず勝てた』と内部思考や因果関係を捏造しない。\n生成が失敗しても結果・航跡は表示する。",
    60,
    760,
    1515,
    100,
    20,
)

ET.indent(DOC)
ET.ElementTree(DOC).write(
    HERE / "snipe-regatta.drawio", encoding="utf-8", xml_declaration=True
)
