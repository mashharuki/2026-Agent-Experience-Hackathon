# システムアーキテクチャ・技術スタック

2026-10-17 / 設計ベースライン v1.1 / 実装・AWSへのデプロイは未実施

## 採用する構成

**React/ViteのSPA、Cognito認証、LambdaのAPI、FargateのAIワーカー**を採用する。
AWS CDKで構成を管理し、主要リソースは東京 `ap-northeast-1` に置く。
CloudFrontはグローバル配信。画像は東京のS3とBedrockで処理し、
初版ではクロスリージョン推論を有効にしない。

![システム全体図](diagrams/system-overview.png)

- [編集用draw.ioファイル（2ページ）](diagrams/photo-prep.drawio)
- [AI処理とデータ保護の詳細図](diagrams/decision-flow.png)
- [費用の目安](cost-estimate.md)
- [フロントエンド・Python API・OpenAPIの選定](technology-selection.md)
- [Spec Kit向け技術スタック一覧](../tech-stack.md)
- [公式アイコンと図の再出力](diagrams/README.md)

これはサービスと責務を決める設計書であり、実機での性能保証ではない。
モデル品質、起動時間、予算上限は下記の検証を通して確定する。
機能仕様書が未作成のため、Spec Kitの正式な `plan.md` はまだ作成していない。

## 技術スタック

| 領域 | 採用 | 現在の状態・理由 |
| --- | --- | --- |
| パッケージ管理 | pnpm 10.32.1、workspace | 導入済み。`apps/*`、`packages/*` |
| モノレポ実行 | Turborepo 2.x | `turbo ^2.11.9` 導入済み。`turbo.json` とタスク定義は今後追加 |
| フロントエンド | React 19、Vite 8、TypeScript | `apps/frontend` に雛形あり。SSR不要のカメラ中心SPA |
| 開発ツール | VoidZero製ツール。Vite+統合を提案 | Vite/Oxlint導入済み。pnpmを維持し、既存Biome/Turboとの役割重複を移行時に整理 |
| UI | Material UI＋Emotion、React Bits、ブラウザCamera API | MUIは操作部品、React Bitsは演出。React Bitsは公開条件との整合確認後に取り込む |
| サーバー状態 | TanStack Query | ジョブのポーリングとキャッシュ。APIフックはOrvalで生成する方針 |
| Web配信 | S3非公開バケット＋CloudFront OAC | 静的配信。公開S3 website endpointを使わない |
| 認証 | Cognito User Pool、OAuth Authorization Code＋PKCE | 公開クライアント・client secretなし。初版は招待制、セルフ登録無効 |
| API | API Gateway HTTP API＋Lambda。Python 3.12、Connexion 3＋Flask、boto3を推奨 | 旧TypeScript案を見直し。Mangumによる接続を検証して確定。LambdaはVPC外 |
| API契約 | OpenAPI YAMLを正本、OrvalでTSクライアント生成 | Connexion案では3.0.3を提案。旧3.1案から変更する理由は選定書を参照 |
| 共有コード | TypeScript | `packages/shared` はUI共通処理。API境界型はYAMLから生成し、PythonへTSコードを直接共有しない |
| 状態保存 | DynamoDB On-Demand | 所有者、セッション、ジョブ、利用枠、ワーカーの稼働状態。画像は保存しない |
| 一時画像 | S3専用非公開バケット | ブラウザから署名付きPOST。処理後削除、期限切れ回収あり |
| 非同期処理 | SQS Standard＋DLQ | APIは202を返し、UIは結果をポーリング。重複配送を前提にする |
| AIワーカー | ECS on Fargate、Linux/x86_64、Python 3.12、uv | 新規 `apps/worker`。初期値4 vCPU/16 GB、1タスク、同時処理1件 |
| 画像観察・説明 | Bedrock Converse、Amazon Nova Lite | 初期モデル `amazon.nova-lite-v1:0`。イベントクレジットの対象確認と画像品質評価が条件 |
| 判断 | Strands Decider 2B、PyTorch CPU | `StrandsAgents/strands-decider-2B-qwen3.5-v1-2610`。ワーカー内でロードして再利用 |
| コンテナ | Docker、Amazon ECR | モデル・ベース重み・Python依存をビルド時に固定・同梱。実行時ダウンロードなし |
| IaC | AWS CDK v2、TypeScript、cdk-nag | `apps/cdk` に雛形あり。リソースはまだ未定義 |
| 品質確認 | Biome、Vitest、pytest、Jest/CDK assertions、Playwright | Biome/Jest導入済み。他は実装時に追加。既存oxlintとの重複ルールを整理 |
| 運用 | CloudWatch、AWS Budgets、EventBridge Scheduler | メタデータの監視、費用通知、画像回収とデモ終了時の停止 |

**TurbopackではなくTurborepoが導入されている。** ビルドはViteが担当する。
Next.jsやTurbopackへの移行は行わない。YAMLを正本にする要望に合わせ、APIは
Connexionでルーティング・検証を構成する案へ更新する。詳細は[技術選定](technology-selection.md)。
Strands Agents SDKの自律ループは初版の必須要件にしない。
Deciderによるツール選択とBedrock生成を、上限のある明示的な処理として接続する。

既存CDKはCLI/libともに `2.149.0`、TypeScriptはCDK側5.5・フロント側6.0と異なる。
これらを「検証済みの互換セット」とは扱わない。実装着手時にCDK CLI/lib、Node.js、
TypeScript、cdk-nagの互換性を確認して固定し、lockfileを生成する。
今回の設計作業では依存関係の更新・インストールは行っていない。

## 処理の流れ

1. CloudFrontからSPAを配信。カメラ画像と前後比較用画像はブラウザのメモリで扱う。
2. Cognitoでログイン。API Gatewayはissuer/audience/期限/署名と必要scopeを検証し、
   Lambdaはトークンの `sub` で所有権を確認する。IDトークンをAPI認証に流用しない。
3. 同意後にアップロード枠を作成。サーバーが決めたキー、JPEG/PNG、最大2 MiB、
   有効期限60秒の署名付きPOSTで画像を一時S3へ送る。EXIFはクライアントで除去する。
   制約はサーバーとワーカーでも検証し、クライアントだけを信用しない。
4. `POST /sessions/{id}/analyses` は画像の存在・サイズ・所有権・利用枠を確認。
   DynamoDBへジョブを条件付き登録し、SQSへジョブIDのみを送信して202を返す。
5. ワーカーがSQSをlong poll。DynamoDBのリースを条件付き取得し、権限・終了状態を再確認。
   画像を取得・検証後、Bedrockで観察と候補を構造化する。
6. **Deciderは画像ではなく、観察結果・不確かさ・本人の希望・道具・履歴を受け取る。**
   `grooming_tip` / `capture_setup_tip` / `clarify` / `offer_finish` の支援ツールを選ぶ。
   コードが禁止範囲と終了状態を再検査し、選ばれたツールだけを実行する。
   説明生成が必要な場合のみBedrockを追加で1回呼ぶ。
7. 結果・判断の根拠となるメタデータをDynamoDBに保存し、画像を削除してSQSをackする。
   UIは `GET /jobs/{id}` を2→3→5秒間隔、最大60秒のポーリングで確認する。
   時間切れは自動再課金せず「確認待ち」を表示する。
8. 本人が一手を試して再撮影し、前後を比較。終了・「前が好き」を尊重する。
   セッション終了・取消しはワーカーにも伝播し、開始前のジョブを破棄する。
   実行中の外部推論は止められると約束せず、終了後の結果をUIへ適用しない。

### APIの最小境界

`POST /sessions`、`POST /sessions/{id}/uploads`、
`POST /sessions/{id}/analyses`、`GET /jobs/{id}`、
`POST /sessions/{id}/feedback`、`DELETE /sessions/{id}` を設ける。
`DELETE` は新規解析の拒否と画像削除を開始する。署名URLの失効を即時保証しない。
全リクエストで所有権確認。`Idempotency-Key` は利用者＋セッションに紐付ける。
仕様書作成時に、本文・エラー形式と再試行条件をOpenAPIへ落とし込む。

## Deciderの配置をFargateにする理由

[公式推論資料](https://github.com/strands-labs/strands-decider/blob/main/docs/inference.md)では、
CPUはfp32で動き、ベース重みは別途約4.5 GBある。GPUやMacの公表速度を
Fargate CPUの性能保証には使わない。Lambdaはメモリ最大10,240 MB、コンテナ最大10 GBのため、
読み込み時のピークと依存込みサイズを未計測のまま収容可能と判断しない。
[Lambda制限](https://docs.aws.amazon.com/lambda/latest/dg/limits.html)

| 選択肢 | 判断 |
| --- | --- |
| **Fargate CPUワーカー** | 採用。メモリに余裕を持たせ、デモ中のモデル再ロードを避ける。サーバー管理不要だが稼働中の待機時間も課金 |
| LambdaコンテナにDeciderを同梱 | 初版では不採用。容量・ピークメモリ・cold startを検証できれば将来移行を検討 |
| EC2/GPUや常時推論エンドポイント | 初版では不採用。運用負担と待機費用を増やすため、CPUの性能不足が実証された場合のみ再検討 |
| 開発用Macで推論 | ローカル検証用。AWS上で完結する提出デモの実行経路には含めない |

Fargateはデモ前に1へ起動し、モデルロード・疎通後に受付を有効化する。
デモ後は受付を閉じ、処理中ジョブを完了させてdesired countを0にする。
EventBridge Schedulerから運用Lambdaを呼び、終了時刻にも停止処理を行う。
**自動で即座にscale-to-zeroから復帰する常時公開サービスではない。** 停止中はAPIが503と
再開案内を返し、新しい有料処理を受け付けない。再起動時の準備時間をUIに隠さない。

## ネットワーク・セキュリティ

- Fargateだけを専用VPCのpublic subnetに置く。public IPv4＋Internet Gatewayで
  AWSのHTTPSエンドポイントへ接続し、security groupは**inboundルールなし**。
  ポートを公開せず、SQSを取りに行く。公式Deciderの無認証HTTPサーバーを外部公開しない。
- NAT GatewayとALBを作らない。S3/DynamoDBのgateway endpointを利用する。
  HTTPS egressと必要なDNSを許可する。この構成は「private subnet」や「外向き通信先を
  ドメイン単位で厳密制限したネットワーク」とは呼ばない。
- API、ワーカー、デプロイのIAM roleを分離。ワーカーは対象キュー、画像prefix、
  テーブル、特定Bedrockモデルのみアクセスできる。ブラウザにAWSキーを渡さない。
- 静的S3と画像S3を分離。画像バケットはBlock Public Access、SSE-S3、TLS必須、
  versioning無効、CloudFront経由の配信なし。CORSは許可するSPA originだけに限定。
- 成功・失敗・取消し時に画像を削除。取り残しを15分周期の運用Lambdaで回収し、
  1日Lifecycleも補助に設定する。期限を超えた画像は処理を拒否する。
  S3 LifecycleとDynamoDB TTLは非同期のため、正確な時刻での削除手段にしない。
- 画像は最大1時間を利用可能期間とする。署名URL期限＋猶予後にも回収し、取消し後の
  遅延アップロードに対応。削除失敗を監視し、即時・厳密な物理削除を保証しない。
- セッションと結果は24時間でアプリ上無効化し、TTLで後処理。
  本人の希望・観察内容はログへ複製しない。通常ログはrequest ID、所要時間、
  token数、選択肢、confidence、エラー分類のみ。ログ保持は7日を初期値とする。
- Bedrockモデル呼び出しログに画像や本文を保存しない設定を確認する。
  招待制・個人利用枠・全体利用枠・ワーカー同時実行1で濫用と費用を抑える。

根拠：[Fargateの外向き通信](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html)、
[HTTP API JWT検証](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)、
[S3の期限切れ処理](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)。

## 失敗・重複・費用上限の設計

- DynamoDBとSQSの書き込みは原子的ではない。ジョブを `PENDING_DISPATCH` として保存し、
  送信後、まだ `PENDING_DISPATCH` の場合だけ条件付きで `QUEUED` に更新する。
  先に動いたワーカーの状態を上書きしない。1分周期の運用Lambdaが未送信を再送する。
  送信成功後の応答消失も想定し、ワーカー側の条件付きリースで二重処理を防ぐ。
- SQS messageには画像・本文を入れず、job IDだけを入れる。visibility timeout 120秒、
  ハートビートで延長、受信3回でDLQ。古いジョブと終了済みセッションを実行しない。
- モデル呼び出し開始を記録し、呼び出し後にプロセスが落ちた場合は自動再実行しない。
  `UNKNOWN` として扱い、利用者の明示的な再試行へ進める。外部呼び出しのexactly-onceは保証しない。
  停止中も稼働する運用Lambdaが期限切れリースを回収し、処理中のまま残るジョブを終端状態にする。
- Deciderの失敗や不正な出力を成功した判断として記録しない。
  低confidenceは `clarify` へ退避。暫定閾値0.8を評価用データで調整し、
  confidenceを美容助言の正解確率として表示しない。
- 1セッション最大2変更、解析3回、1解析Bedrock最大2回、各最大800出力tokensを初期制限にする。
  認証利用者10セッション/日、全体100セッション/日を初期枠とし、DynamoDBで原子的に予約する。
  API GatewayのスロットリングとBudgets通知だけに課金制限を任せない。

## 実装前に通す検証

以下の数値は設計上の目標であり、計測結果ではない。

| 検証 | 合格条件・対応 |
| --- | --- |
| Decider実行 | Linux/x86_64、4 vCPU/16 GBで起動し、ピークRSS 12 GB以内。超過なら24 GB案と費用を再比較 |
| 応答速度 | warm状態で観察→判断→説明のp95 15秒以内。起動・重みロード時間は別に測る |
| 画像観察 | 同意済み写真の逆光・変化なしケースで、根拠のない毛流れの断定をしない。不合格なら本人指定中心へ縮小またはモデル再比較 |
| 基本的な保護 | 未認証・別ユーザー・サイズ超過・終了後・期限切れの操作を拒否。画像削除と課金枠を検証 |
| 再配送 | 同じjob IDを再送しても完了済み処理と課金枠を重複させない。結果不明の推論を無条件に再実行しない |
| 提出 | Deciderの判断→呼び出すツールの変化を実演し、再利用できる問い・選択肢・接続コード・説明を公開 |

AWSアカウントのモデル利用権限・サービスクォータ・既存リソースは未確認。
予算上限は費用表を見て決める。構成選定と性能・予算の検証結果を区別して進める。

## 配置と次の設計作業

```text
apps/frontend/       # 既存: React/Vite
apps/cdk/            # 既存: CDK雛形。AppStack内を責務ごとのConstructに分割
apps/api/            # 新設予定: Python Lambda APIと運用ジョブ（推奨案）
apps/worker/         # 新設予定: Python・Decider・Bedrock・Dockerfile
packages/api-spec/   # 既存の空パッケージ: openapi.yamlを契約の正本にする予定
packages/shared/     # 既存の空パッケージ: TypeScriptのUI共通処理
docs/architecture/   # この設計・試算・draw.io図
```

CDKは初版1スタックにIdentity/Frontend/Api/Data/Worker/OperationsのConstructを置く。
過剰なスタック分割を避け、データと認証リソースは削除保護方針を明示する。
`cdk-nag`、CDK assertions、`cdk synth`、`cdk diff`で公開設定とIAMを検証してからデプロイする。
現存するCDKテストは雛形で、セキュリティや構成が検証済みという意味ではない。

次はこのベースラインをもとに機能仕様を作成し、Spec Kitのplanへ取り込む。
比較用画像のUX、API契約、保存期限、エラー時の画面を先に確定し、上記の小さな技術検証へ進む。
