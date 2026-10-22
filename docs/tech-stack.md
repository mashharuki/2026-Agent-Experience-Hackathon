# 技術スタック一覧

> **現行企画はSnipe AI Regatta（ローカル練習を実装・評価中）**。新設計の採用・再利用候補は [002/plan.mdのTechnical Context](../specs/002-snipe-ai-regatta/plan.md#technical-context)を正本とする。旧AWS環境は2026-10-21に削除済み。新API・実モデル対戦は未接続であり、旧モデル評価をゲームの品質の証拠にしない。

## 新ゲームの実装状況（2026-10-22）

| 領域 | 導入済みの構成 | 状態 |
| --- | --- | --- |
| ローカル画面 | React 19 / Vite 8 / MUI / TypeScript、`apps/regatta-web/` | 操船・日英表示・固定ルール艇・記録再生 |
| 海面と艇 | Three.js 0.180.0、命令型描画 | 独自の水面・空shader、曲面の帆・索具、ヒール・引き波、追従／艇上／俯瞰、DPRによる軽量設定 |
| 帆走と風 | 純粋TypeScript、`packages/sailing-sim/`、30Hz | `sailing-v2` / `wind-v2`。20秒周期の変化する海面を追加 |
| 検証 | Vitest / TypeScript / Biome / Oxlint | 操船・現在の風と候補・停止・同じ版での再生を検証 |

以下の一覧は、特記のない限り旧写真支援アプリの実装スナップショット。

更新日：2026-10-21。Spec Kitによる計画・タスク分解・実装時の参照資料。
選定理由は[技術選定書](architecture/technology-selection.md)、サービス間の責務とデータフローは
[アーキテクチャ設計書](architecture/README.md)、費用は[試算](architecture/cost-estimate.md)を参照する。

## 状態の読み方

- **採用**：ユーザー指定または承認済みの構成。導入済みという意味ではない。
- **推奨**：計画の出発点とする案。互換性や実装方法の検証を経て確定する。
- **条件付き**：採用方針はあるが、記載した条件を満たしてから利用する。
- **既存**：現在の雛形に存在するもの。移行後も使い続ける決定とは区別する。

## フロントエンド・開発ツール

| 領域 | 技術・バージョン方針 | 選定状態 | 配置・用途・後続処理の注意 |
| --- | --- | --- | --- |
| UI基盤 | React 19、TypeScript | 採用・実装済み（ローカル検証） | `apps/frontend/`。カメラ中心のSPA。SSRは前提にしない |
| ビルド | Vite 8 | 採用・導入済み | SPAの開発・静的ビルド。Next.js/Turbopackへ置き換えない |
| 開発ツール群 | VoidZero | 採用 | Vite、Vitest、Oxc等。UIフレームワークとして扱わない |
| 統合ツール | Vite+ | 推奨・未導入 | 既存Vite/Oxlintからの移行を検証。Biomeと二重整形せず、Turboとの実行責務を整理 |
| パッケージ管理 | pnpm 10.32.1、workspace | 採用・導入済み | `apps/*`、`packages/*`。Pythonの依存はuvで別管理 |
| モノレポ実行 | Turborepo 2.x | 未採用 | 未使用の依存を削除。pnpm scriptsで実行する |
| UI部品 | Material UI、Emotion | 採用・導入済み（四画面で使用。ダーク／ライトは端末設定に追従、ライトは目視未確認） | フォーム、ボタン、進行表示、共通テーマ |
| 演出 | MUI＋独自CSS | 採用・実装済み | **React Bits は採用しない**（2026-10-17、ユーザー承認。現行MIT＋Commons Clauseは部品の再配布を制限し、公式Rulesが求めるOSI承認の公開リポジトリと衝突し得るため）。撮影・操作を妨げず、`prefers-reduced-motion` を尊重する |
| 多言語（日本語・英語） | 自作の最小i18n（辞書2つ＋切替。依存なし） | 採用・導入済み（FR-028、2026-10-17） | `apps/frontend/src/i18n/`。キーの一致と英語への日本語混入をテストで保証。言語を増やす段階でライブラリを再検討。助言文の言語はセッションの `language` に従う（APIとワーカー）。英語の助言の質は未評価 |
| PWA | 手書きのマニフェストとサービスワーカー（Workboxなし） | 採用・実AWSへ公開、配信ヘッダーを確認（2026-10-21） | 静的ファイルだけをキャッシュし、API・S3・Cognito・サインイン戻り・写真は対象外。更新は利用者が承認。ビルドごとにビルドIDを刻印。実機でのホーム画面追加・更新は未確認 |
| サーバー状態管理 | TanStack Query | 採用・導入済み（ジョブのポーリングに使用） | 2→3→5秒・最大60秒。通信期限・取消・遅延応答の抑制あり。解析POSTは自動再試行しない（`customFetch` と QueryClient の既定）。写真はクエリのキャッシュに入れない |
| 撮影 | ブラウザCamera API | 採用・実装済み | 写真は端末メモリで保持。同意後のみ解析用S3に送信 |
| 共通コード | TypeScript | 採用・空パッケージあり | `packages/shared/` はUI共通処理。API境界型を手書きで重複管理しない |

React Bitsは採用しない。演出はMUI＋独自CSSで作る。ライセンスの経緯は[research R-005](../specs/001-pre-photo-grooming-assist/research.md)を参照。
Vite+への移行が済むまでは、既存のpnpm scriptsとBiome設定を使う。

## API契約・バックエンド・AI

| 領域 | 技術・バージョン方針 | 選定状態 | 配置・用途・後続処理の注意 |
| --- | --- | --- | --- |
| API契約の正本 | OpenAPI YAML | 採用・作成済み（8操作。`pnpm --filter api-spec check` で検査） | `packages/api-spec/openapi.yaml`。Pythonから生成する仕様を正本にしない |
| OpenAPIの版 | 3.0.3 | 推奨 | Connexion案との互換性を優先。旧3.1案を引き継がず、3.1専用構文を混在させない |
| サーバー検証 | Connexion 3＋Flask | 採用・実API Gateway／Lambdaで全8操作を通し検証（2026-10-21） | `apps/api/`。YAMLからルーティング・入出力検証を構成。業務関数は手書き |
| API実装言語 | Python 3.12、boto3 | 採用・実装済み・AWS通し検証（2026-10-21） | 認可、署名付きPOST、ジョブ受付・結果取得 |
| Lambdaアダプター | Mangum | 推奨・実Lambdaで動作確認（2026-10-17） | Connexion全体を包む。HTTP API v2イベントとJWT claimsの引渡しを実環境で確認 |
| フロント向け生成 | Orval | 推奨・導入済み・生成確認済み（`pnpm --filter frontend api:generate`） | YAMLからTS型・HTTPクライアント・TanStack Query hooksを生成。生成物を直接編集しない |
| APIドキュメント | Swagger UI | 推奨・未導入 | 同じYAMLから表示。ドキュメント公開設定とAPI認証を区別する |
| Python依存管理 | uv、lockfile | 採用・API/workerで導入済み | APIとワーカーの依存を分離し、再現可能にする |
| 共有Python | `packages/photoprep-common` | 採用・導入済み | APIとワーカーで共通の Store（DynamoDB）・状態規則・ログの許可リスト。依存は boto3 のみ |
| AIワーカー | Python 3.12、PyTorch CPU | 採用・実装済み・Fargateで実行（`apps/worker`。ローカル回帰に加え、2026-10-21に実AWSで画像解析・確認回答・終了を確認） | SQSを取得するプロセス。Flaskサーバーは不要。`pillow` で画像検証、`pydantic` でモデル出力を検証 |
| 判断モデル | Strands Decider 2B | 採用・開発MacとFargateで実行確認済み（今回差分はローカル検証） | `StrandsAgents/strands-decider-2B-qwen3.5-v1-2610`（revision `216d1ccb…` を固定）とベース重み `Qwen/Qwen3.5-2B-Base`（`b1485b2f…`）。実行可能性はコードで判定し、許可候補だけを問い合わせる。候補一つならDeciderを呼ばない |
| 画像観察・説明 | Bedrock Converse、Amazon Nova Lite | 条件付き・実Bedrockで1回の解析を確認（品質は未評価） | 初期ID `amazon.nova-lite-v1:0`。東京での品質とイベントクレジット対象製品を確認 |
| コンテナ | Docker、Amazon ECR | ビルド・ECR登録・Fargateで起動を確認（約6 GB、2026-10-17） | ワーカーのモデル・依存を同梱。APIへのPyTorch/重みの混入を避ける。CPU版torchをLinuxで選ぶ設定はロックで確認済み |

自動化の流れは **YAML → Connexionの検証・ルーティング／Orvalのクライアント生成**。
Connexionはミドルウェアのソースや業務処理を生成するものではない。
FastAPIは比較した代替案であり、現在の推奨構成へ同時に追加しない。

## AWS基盤・認証・運用

| 領域 | 技術 | 選定状態 | 用途・制約 |
| --- | --- | --- | --- |
| リージョン | 東京 `ap-northeast-1` | 採用 | CloudFrontはグローバル。初版でクロスリージョン推論を有効にしない |
| Web配信 | Amazon S3、CloudFront OAC | 採用・デプロイ済み（東京、2026-10-21） | 非公開S3からSPAを配信 |
| 認証 | Amazon Cognito User Pool | 採用・デプロイ済み（東京、2026-10-21） | Authorization Code＋PKCE、公開クライアント、メール確認コード付きセルフ登録（2026-10-21追加） |
| API実行 | API Gateway HTTP API、AWS Lambda | 採用・デプロイ済み（東京、2026-10-21） | JWT authorizer＋アプリの所有権検証。VPC外Lambda。軽量ZIP配布を推奨 |
| 状態保存 | DynamoDB On-Demand | 採用・デプロイ済み（東京、2026-10-21） | セッション、所有者、ジョブ、利用枠。画像は格納しない |
| 一時画像 | 専用の非公開S3 | 採用・デプロイ済み（東京、2026-10-21） | 署名付きPOST、サイズ・期限制限、処理後削除と回収処理 |
| 非同期処理 | SQS Standard、DLQ | 採用・デプロイ済み（東京、2026-10-21） | job IDのみ送信。重複配送を前提にリース・冪等性を実装 |
| ワーカー実行 | ECS on Fargate、Linux/x86_64 | 採用・デプロイ済み・性能は一部実測（受付開始まで124秒、ピークRSS未計測） | 初期案4 vCPU/16 GB、同時処理1。デモ前起動・終了後停止 |
| ネットワーク | VPC、public subnet、IGW | 採用・デプロイ済み（東京、2026-10-21） | ワーカーはpublic IP、inboundなし。NAT Gateway・ALBを作らない |
| IaC | AWS CDK v2、TypeScript、cdk-nag 3 | 採用・最新版をAWSへデプロイ、API通し検証済み（2026-10-21） | `apps/cdk`。aws-cdk-lib 2.273.0＋CLI 2.1145.0＋cdk-nag 3.0.2 の組で synth・jest 通過。cdk-nag 3 は `Validations.of().acknowledge()` を使う。新ルート・画像回収監視を含む。通知到達・故障注入は別途確認 |
| 監視・費用・停止 | CloudWatch、AWS Budgets、EventBridge Scheduler | 採用・デプロイ済み（東京、2026-10-21） | メタデータ監視、通知、画像回収、ワーカー停止。通知だけを課金制限にしない |

イベントクレジットは適用確認前に費用から差し引かない。BedrockとFargate等の対象製品、
有効期限、残高を確認し、割引前の使用量制限も維持する。

## 品質管理

| 対象 | 技術 | 状態・検証内容 |
| --- | --- | --- |
| 現行JS/TSチェック | Biome、Oxlint | 導入済み。Vite+移行時にルール・整形の重複を整理 |
| 未使用コード・依存 | Knip | 導入済み。`pnpm knip`、設定は `knip.json` |
| 重複コード | jscpd | 導入済み。`pnpm jscpd` で `apps/`・`packages/` を検査。`.jscpd.json` の閾値5%、レポートは `report/` |
| フロント単体テスト | Vitest、Testing Library（jsdom） | 導入済み（PKCE、独立タイムアウト、取消、確認回答、モックと契約の一致、画面の通し） | モックAPIの応答は OpenAPI の schema で検証し、仕様とずれたら失敗する。E2EはPlaywrightで別実行 |
| Python | pytest、Ruff | 導入済み。認可、利用枠、トランザクション、重複配送、判断結果の接続 |
| IaC | Jest、CDK assertions、cdk-nag | 導入済み（セキュリティ設定・契約とのルート一致・回収監視・cdk-nag）。2026-10-21に最新版をデプロイし、API経路と停止・回収を確認 |
| E2E | Playwright | 導入済み。合成画像とモックによる比較・確認回答・待機中終了。実AWSのE2Eとは区別 |
| API契約 | YAML lint、Connexion読込み、Orval再生成差分、契約テスト | 一部整備（YAML検証・Connexion読込み・operationId重複・認証必須・3.1構文の検査は `check_spec.py`。Orval再生成差分・未追跡ファイルの検査をCIに定義（新しいCIのリモート実行は未確認）。契約テストはAPI/フロントで実装済み）。仕様と実装・生成クライアントの不一致を検出 |

## Spec Kitでの適用ルール

1. 各工程の開始時に本書、[憲章](../.specify/memory/constitution.md)、
   [MVP案](mvp.md)、[アーキテクチャ](architecture/README.md)を読む。
   本書は技術選定の一覧であり、憲章や公式ハッカソン要件を緩和しない。
2. **specify / clarify**：利用体験・制約を定める。採用技術を理由に未合意の機能を追加しない。
3. **plan**：Technical Contextに本書へのリンクと、その機能が使う技術を記載する。
   推奨・条件付き項目はresearchと検証項目へ落とし、未検証を採用済み・稼働済みに読み替えない。
4. **tasks**：必要な依存導入、YAML定義、コード生成、契約テスト、認証・認可、
   クレジット・ライセンス・性能の確認を具体的なタスクにする。不要な技術まで一括導入しない。
5. **implement / analyze**：YAMLを先に変更し、生成物を再生成する。手書き業務処理と生成物を分離し、
   憲章、機能仕様、plan、本書との整合を確認する。
6. 技術の確定・変更・導入後は、本書の状態欄と関連設計書を同じ変更で更新する。
   選定変更の理由と検証結果をplan/researchに残し、既存のユーザー指定を黙って置換しない。

版が未指定のライブラリは実装時に互換性を確認してlockfileへ固定する。
本書はSpec Kitの正式な `plan.md` の代替ではなく、各機能計画への共通入力として使う。

## レビュー修正の検証範囲（2026-10-19）

確認質問の回答API、短命な観察の再利用、原子的な受付、待機中の終了、画像回収の部分失敗検出を追加した。詳細と実行結果は [検証記録](reviews/2026-10-19-remediation-validation.md)。今回差分はローカル・モック検証までで、AWSでの検証済みという意味ではない。Vite+、Swagger UI、追加言語は今回導入していない。

## 追加実装・モデル実験（2026-10-20実装・ローカル実験済み）

[評価ハーネス](../specs/001-pre-photo-grooming-assist/model-evaluation-plan.md)は既存Python／pytest／Pydantic／JSONLとCPU Deciderを使い、新規依存なし。初回275判断ではv2の改善がなく不採用とした。[初回結果](reviews/2026-10-20-local-model-evaluation.md)は保持する。その後の[実行可能性分離](../specs/001-pre-photo-grooming-assist/eligibility-plan.md)では、既定v4がコードで候補を制限し、複数候補のみ実モデルへ渡す。終了だけならDeciderを省き、source=policy・スコアnullで記録する。confidence閾値0は維持。旧データと分けた合成40件で検証し、通常CIはfakeと全データ版の検査のみ。実写真・今回差分のAWS性能・人間のラベル検証は未実施。

## 比較・任意保存（実装済み・ローカル検証）

[比較・任意保存](../specs/001-pre-photo-grooming-assist/photo-completion-plan.md)は既存React／MUIと端末内のBlob URLを使う。任意ガイド、並置／A・B切替、明示した前／後／変更なし画像の保存要求を実装した。新規API・S3保存・写真の自動キャッシュは追加していない。[検証記録](reviews/2026-10-19-photo-completion-validation.md)に合成映像での撮影・JPEG・ダウンロード内容の確認を記載。終了時はメモリを解放し、本人が保存したファイルは端末に残る。iOS／Android実機での保存操作は未確認。

## 最新のAWS検証（2026-10-21）

[検証記録](reviews/2026-10-21-aws-validation.md)に、実API・Cognito PKCE・Nova Lite／Decider v4の動作を記録した。合成画像による一手→前後比較→選択保存と、合成Observationによる確認回答・上限を区別する。処理が速く終了した場合の冪等再送不具合をAPIで修正し、382テストとAWS再実行で確認した。外部契約の型・生成クライアント・依存スタックに変更はない。検証終了後はワーカー0台、受付停止。人間による品質評価・実機保存・通知到達は別途確認する。

## セルフ登録（2026-10-21）

ユーザー依頼により、Cognitoのメール確認コード付きセルフ登録を公開した。ログイン前に日英の登録導線を表示し、Hosted UIから既存PKCEコールバックへ戻る。既存プールを維持し、業務OpenAPI・生成クライアント・利用制限は変更していない。[検証記録](reviews/2026-10-21-signup-validation.md)参照。実際のメール受信・コード入力後の本人操作は未検証。
