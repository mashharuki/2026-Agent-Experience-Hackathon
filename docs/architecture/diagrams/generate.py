"""Build the editable two-page draw.io architecture; Python standard library only."""
from pathlib import Path
import base64
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
doc = ET.Element("mxfile", host="app.diagrams.net", version="31.1.8", type="device")
FONT = "fontFamily=Helvetica;fontColor=#172B4D;"
root = None


def page(name, width=1820, height=1180):
    global root
    diagram = ET.SubElement(doc, "diagram", name=name, id=name.split()[0])
    model = ET.SubElement(diagram, "mxGraphModel", dx="1820", dy="1180", grid="1",
                          gridSize="10", page="1", pageScale="1", pageWidth=str(width),
                          pageHeight=str(height), background="#FFFFFF", math="0", shadow="0")
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", id="0")
    ET.SubElement(root, "mxCell", id="1", parent="0")


def cell(key, value, x, y, w, h, style, parent="1"):
    c = ET.SubElement(root, "mxCell", id=key, value=value, style=FONT + style,
                      vertex="1", parent=parent)
    ET.SubElement(c, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h),
                  attrib={"as": "geometry"})
    return key


def text(key, value, x, y, w, h, size=15, color="#172B4D", bold=False, parent="1"):
    return cell(key, value, x, y, w, h,
                f"text;html=0;strokeColor=none;fillColor=none;whiteSpace=wrap;"
                f"align=left;verticalAlign=middle;fontSize={size};fontColor={color};"
                f"fontStyle={1 if bold else 0};spacing=0;", parent)


def box(key, title, x, y, w, h, color="#D7E2EF", fill="#F8FAFC", dashed=False):
    cell(key, "", x, y, w, h,
         f"rounded=1;arcSize=8;strokeWidth=1.5;strokeColor={color};fillColor={fill};"
         f"dashed={int(dashed)};")
    text(key+"-title", title, x+18, y+10, w-36, 28, 16, bold=True)


def service(key, title, body, icon, x, y, w=230, h=140, accent="#D7E2EF"):
    cell(key, "", x, y, w, h,
         f"rounded=1;arcSize=10;fillColor=#FFFFFF;strokeColor={accent};strokeWidth=2;")
    if icon:
        data = base64.b64encode((HERE / "aws-icons" / (icon+".svg")).read_bytes()).decode()
        cell(key+"-icon", "", 16, 16, 44, 44,
             "shape=image;imageAspect=0;aspect=fixed;image=data:image/svg+xml,"+data+";", key)
        text(key+"-label", title, 72, 14, w-86, 48, 17, bold=True, parent=key)
    else:
        text(key+"-label", title, 18, 14, w-36, 46, 19, bold=True, parent=key)
    text(key+"-body", body, 18, 72, w-36, h-82, 14, "#42566F", parent=key)
    return key


def edge(key, source, target, label="", color="#536B88", dashed=False,
         anchors="exitX=1;exitY=0.5;entryX=0;entryY=0.5;", points=()):
    c = ET.SubElement(root, "mxCell", id=key, value=label, source=source, target=target,
                      edge="1", parent="1", style=FONT+
                      f"edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;"
                      f"strokeColor={color};strokeWidth=2;endArrow=block;endFill=1;"
                      f"dashed={int(dashed)};fontSize=13;labelBackgroundColor=#FFFFFF;"+anchors)
    g = ET.SubElement(c, "mxGeometry", relative="1", attrib={"as":"geometry"})
    if points:
        a = ET.SubElement(g, "Array", attrib={"as":"points"})
        for x,y in points:
            ET.SubElement(a, "mxPoint", x=str(x), y=str(y))


page("01 Overview")
text("title", "撮る前のひと手間  |  システムアーキテクチャ", 40, 22, 1500, 46, 30, bold=True)
text("subtitle", "設計ベースライン v1.1  •  2026-10-17  •  AWS Tokyo + global CDN  •  API言語はPythonを推奨・未デプロイ", 42, 76, 1600, 28, 16, "#60728A")
box("aws", "AWS Cloud  /  Region: ap-northeast-1（CloudFrontを除く）", 320, 125, 1460, 905)
box("delivery", "配信・認証", 350, 177, 1395, 220, fill="#F3F0FB")
service("cdn", "Amazon\nCloudFront", "HTTPS / SPA配信\nOACでS3へアクセス", "cloudfront", 390, 230)
service("static", "Amazon S3", "静的アセット専用\n非公開バケット", "s3", 690, 230)
service("auth", "Amazon\nCognito", "Code + PKCE / 招待制\n利用者のログイン", "cognito", 1090, 230, 260)
text("edge-note", "画像は配信対象外\nログイン後にAPIを利用\nJWT: issuer / audience / scope", 1400, 250, 300, 95, 15)
service("browser", "スマートフォン\nReact + Vite", "撮影・一手を試す・前後比較\n画像は端末メモリに保持", None, 40, 520, 240, 160, "#4B83C3")
service("api", "Amazon\nAPI Gateway", "HTTP API / JWT検証\n202受付 + 結果ポーリング", "apigateway", 390, 520)
service("lambda", "AWS Lambda", "Python API（推奨案）\n所有権・利用枠・ジョブ受付", "lambda", 690, 520)
service("queue", "Amazon SQS", "job IDのみ / DLQあり\nワーカーがlong poll", "sqs", 990, 520, 210)
box("vpc", "専用VPC / public subnet", 1230, 435, 270, 305, "#779C46", "#F5F9EE")
service("worker", "AWS Fargate\nECS worker", "Python / Decider 2B\n4 vCPU・16 GB / 1タスク", "fargate", 1250, 520, 230, 145, "#ED9B44")
text("vpc-note", "Public IP・HTTPS outbound\ninboundなし / NAT・ALBなし", 1250, 676, 232, 50, 13, "#45652A")
service("bedrock", "Amazon\nBedrock", "Nova Lite / Converse\n画像観察・説明生成", "bedrock", 1530, 520, 220)
service("photos", "Amazon S3", "解析用の一時画像\n同意後送信 → 処理後削除", "s3", 690, 815)
service("ddb", "Amazon\nDynamoDB", "所有者・ジョブ・結果・利用枠\n画像なし / On-Demand", "dynamodb", 990, 815, 250)
service("ecr", "Amazon ECR", "固定済みコンテナイメージ\nモデルと依存を同梱", "ecr", 1320, 815, 280)
edge("web", "browser", "cdn", "① HTTPS", anchors="exitX=0.5;exitY=0;entryX=0;entryY=0.5;", points=[(160,300)])
edge("origin", "cdn", "static", "OAC")
edge("login", "browser", "auth", "② Code + PKCE", "#8C63B5", True,
     "exitX=0.85;exitY=0;entryX=0.5;entryY=0;", [(244,165),(1220,165)])
edge("jwt", "auth", "api", "JWT検証設定", "#8C63B5", True,
     "exitX=0.5;exitY=1;entryX=0.5;entryY=0;", [(1220,415),(505,415)])
edge("call", "browser", "api", "③ Bearer token")
edge("route", "api", "lambda", "認証済み要求")
edge("enqueue", "lambda", "queue", "④ enqueue")
edge("pull", "queue", "worker", "⑤ 取得")
edge("llm", "worker", "bedrock", "⑥ 推論", "#9460C4")
edge("upload", "browser", "photos", "署名付きPOST（画像本体はAPIを通さない）", "#2C8A79", False,
     "exitX=0.5;exitY=1;entryX=0;entryY=0.5;", [(160,885)])
edge("presign", "lambda", "photos", "署名・検証・削除", "#2C8A79", True,
     "exitX=0.35;exitY=1;entryX=0.35;entryY=0;")
edge("api-state", "lambda", "ddb", "状態・利用枠", anchors="exitX=0.8;exitY=1;entryX=0.2;entryY=0;", points=[(874,765),(1040,765)])
edge("result", "worker", "ddb", "⑦ 結果保存", anchors="exitX=0.3;exitY=1;entryX=0.8;entryY=0;", points=[(1319,780),(1190,780)])
edge("image-read", "photos", "worker", "画像取得 / 処理後削除", "#2C8A79", True,
     "exitX=1;exitY=0.8;entryX=0;entryY=0.8;", [(950,927),(950,710),(1220,710),(1220,636)])
edge("deploy", "ecr", "worker", "image pull", "#9B7B51", True,
     "exitX=0.7;exitY=0;entryX=0.85;entryY=1;", [(1516,780),(1445,780)])
text("return", "⑧ 結果はDynamoDB → Lambda → HTTP API → SPAへ返す（往復線は省略）", 390, 975, 1200, 30, 15, "#526880")
box("ops", "運用と費用制御（共通）", 40, 1050, 1740, 100, fill="#FFF8EC", color="#E9C489")
text("ops-text", "CloudWatch：画像を含まないログ・7日保持   |   Budgets：費用通知   |   Scheduler → 運用Lambda：未送信再送・画像回収・デモ終了時の停止", 60, 1090, 1690, 40, 16)
text("legend", "実線：主な処理・データの流れ     破線：設定・補助アクセス     Fargateはデモ時1 / 停止時0。稼働中は待機も課金。", 42, 1160, 1700, 30, 14, "#60728A")

page("02 Decision flow", 1700, 1160)
text("title", "画像を観察し、次の一手を選び、本人が決める", 40, 22, 1600, 48, 30, bold=True)
text("subtitle", "AIワーカー内部の責務 / 顔画像の扱い / 失敗時の動作  •  AWS公式アイコン使用", 42, 80, 1500, 25, 16, "#60728A")
box("runtime", "ECS on Fargate  /  1モデルをロードして再利用・同時処理1件", 40, 140, 1600, 560, "#ED9B44", "#FFFAF4")
service("job", "SQS → リース取得", "所有者・期限・取消しを確認\nDynamoDBで重複実行を抑止", "sqs", 75, 220, 270, 150)
service("observe", "Bedrock\n画像観察", "S3の画像 + 本人の希望\n根拠・不確かさ・候補をJSON化", "bedrock", 410, 220, 290, 150)
service("decide", "Strands Decider 2B", "テキストの状態 → choice\n選択肢 + confidenceを返す", None, 770, 220, 330, 150, "#E28B27")
service("explain", "Bedrock\n必要時だけ説明", "選ばれた支援だけを具体化\n1解析あたり計2回まで", "bedrock", 1250, 220, 320, 150)
edge("observe-edge", "job", "observe", "画像検証")
edge("decide-edge", "observe", "decide", "構造化された観察")
edge("explain-edge", "decide", "explain", "コードで再検査")
box("tools", "Deciderが選ぶ支援ツール", 770, 425, 330, 225, "#E6B36E", "#FFFFFF")
text("options", "grooming_tip     身支度の一手\ncapture_setup_tip  撮影条件\nclarify             本人への確認\noffer_finish       終了を提案", 790, 475, 295, 145, 17)
edge("choice", "decide", "tools", "実際に選択を反映", anchors="exitX=0.5;exitY=1;entryX=0.5;entryY=0;")
box("guard", "通常コードが守るもの", 75, 425, 625, 225, "#B9CCD9", "#FFFFFF")
text("guard-text", "本人の禁止・終了 > モデルの判断\n\n最大2変更 / 解析3回 / 利用枠を原子的に予約\n画像欠如・不正入力は推論前に拒否\n低confidence → clarify、モデル失敗 → エラーを明示", 95, 474, 585, 155, 17)
service("save", "結果保存・画像削除", "DynamoDBへ結果・usage記録\nS3画像を削除してSQSをack", "dynamodb", 1250, 475, 320, 160)
edge("save-edge", "explain", "save", "構造化出力を検証", anchors="exitX=0.5;exitY=1;entryX=0.5;entryY=0;")
box("privacy", "画像のライフサイクル", 40, 745, 780, 270, "#8CC6B8", "#F2FBF7")
text("privacy-text", "端末で撮影・同意 → 一時S3 → Bedrock → 削除\n\n前後比較用の画像はブラウザメモリに保持\n解析用画像：最大1時間利用可能、処理後に明示削除\n15分周期で取り残し回収 / 1日Lifecycleは補助\n期限切れは利用拒否。厳密な時刻での物理削除は保証しない。", 62, 795, 735, 195, 17)
box("failure", "待ち時間・失敗・停止を隠さない", 850, 745, 790, 270, "#B0BED2", "#F5F8FD")
text("failure-text", "202 → job ID → 所有者だけが結果を取得\n\nSQS重複：リースで抑止 / 外部推論の結果不明はUNKNOWN\n自動で有料推論を繰り返さない / 受信3回でDLQ\nデモ終了：受付停止 → 処理完了待ち → desired count = 0\n停止中は503。再開にはコンテナ・モデルの準備が必要。", 872, 795, 745, 195, 17)
text("footer", "検証目標（未計測）：warm p95 ≤ 15秒 / 4 vCPU・16 GBでピークRSS ≤ 12 GB / 本人の禁止・終了を必ず尊重", 42, 1060, 1580, 50, 17, "#526880")

ET.indent(doc, space="  ")
out = HERE / "photo-prep.drawio"
ET.ElementTree(doc).write(out, encoding="utf-8", xml_declaration=True)
print(out)
