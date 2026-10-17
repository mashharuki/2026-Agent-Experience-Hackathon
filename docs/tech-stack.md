# 技術スタック一覧

更新日：2026-10-17。Spec Kitによる計画・タスク分解・実装時の参照資料。
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
| UI基盤 | React 19、TypeScript | 採用・雛形あり | `apps/frontend/`。カメラ中心のSPA。SSRは前提にしない |
| ビルド | Vite 8 | 採用・導入済み | SPAの開発・静的ビルド。Next.js/Turbopackへ置き換えない |
| 開発ツール群 | VoidZero | 採用 | Vite、Vitest、Oxc等。UIフレームワークとして扱わない |
| 統合ツール | Vite+ | 推奨・未導入 | 既存Vite/Oxlintからの移行を検証。Biomeと二重整形せず、Turboとの実行責務を整理 |
| パッケージ管理 | pnpm 10.32.1、workspace | 採用・導入済み | `apps/*`、`packages/*`。Pythonの依存はuvで別管理 |
| モノレポ実行 | Turborepo 2.x | 既存 | `turbo` は導入済み、タスク定義は未整備。Vite Taskとの二重管理を避ける |
| UI部品 | Material UI、Emotion | 採用・導入済み（四画面で使用。ダーク／ライトは端末設定に追従、ライトは目視未確認） | フォーム、ボタン、進行表示、共通テーマ |
| 演出 | MUI＋独自CSS | 採用・未導入 | **React Bits は採用しない**（2026-10-17、ユーザー承認。現行MIT＋Commons Clauseは部品の再配布を制限し、公式Rulesが求めるOSI承認の公開リポジトリと衝突し得るため）。撮影・操作を妨げず、`prefers-reduced-motion` を尊重する |
| サーバー状態管理 | TanStack Query | 採用・導入済み（ジョブのポーリングに使用） | 2→3→5秒・最大60秒。解析POSTは自動再試行しない（`customFetch` と QueryClient の既定）。写真はクエリのキャッシュに入れない |
| 撮影 | ブラウザCamera API | 採用・未実装 | 写真は端末メモリで保持。同意後のみ解析用S3に送信 |
| 共通コード | TypeScript | 採用・空パッケージあり | `packages/shared/` はUI共通処理。API境界型を手書きで重複管理しない |

React Bitsは採用しない。演出はMUI＋独自CSSで作る。ライセンスの経緯は[research R-005](../specs/001-pre-photo-grooming-assist/research.md)を参照。
Vite+への移行が済むまでは、既存のpnpm scriptsとBiome設定を使う。

## API契約・バックエンド・AI

| 領域 | 技術・バージョン方針 | 選定状態 | 配置・用途・後続処理の注意 |
| --- | --- | --- | --- |
| API契約の正本 | OpenAPI YAML | 採用・作成済み（7操作。`pnpm --filter api-spec check` で検査） | `packages/api-spec/openapi.yaml`。Pythonから生成する仕様を正本にしない |
| OpenAPIの版 | 3.0.3 | 推奨 | Connexion案との互換性を優先。旧3.1案を引き継がず、3.1専用構文を混在させない |
| サーバー検証 | Connexion 3＋Flask | 推奨・apps/apiに導入済み・ローカル検証済み（実API Gateway／Lambdaは未確認） | `apps/api/`。YAMLからルーティング・入出力検証を構成。業務関数は手書き |
| API実装言語 | Python 3.12、boto3 | 推奨・未実装 | 旧TypeScript API案を見直した案。認可、署名付きPOST、ジョブ受付・結果取得 |
| Lambdaアダプター | Mangum | 推奨・未検証 | Connexion全体を包む。HTTP API v2イベントとJWT claimsの引渡しを検証 |
| フロント向け生成 | Orval | 推奨・導入済み・生成確認済み（`pnpm --filter frontend api:generate`） | YAMLからTS型・HTTPクライアント・TanStack Query hooksを生成。生成物を直接編集しない |
| APIドキュメント | Swagger UI | 推奨・未導入 | 同じYAMLから表示。ドキュメント公開設定とAPI認証を区別する |
| Python依存管理 | uv、lockfile | 推奨・apps/apiで導入済み（apps/workerは未作成） | APIとワーカーの依存を分離し、再現可能にする |
| 共有Python | `packages/photoprep-common` | 採用・導入済み | APIとワーカーで共通の Store（DynamoDB）・状態規則・ログの許可リスト。依存は boto3 のみ |
| AIワーカー | Python 3.12、PyTorch CPU | 採用・実装済み（`apps/worker`。モックのBedrockで96件のテスト通過。AWS上では未実行） | SQSを取得するプロセス。Flaskサーバーは不要。`pillow` で画像検証、`pydantic` でモデル出力を検証 |
| 判断モデル | Strands Decider 2B | 採用・開発Mac(CPU)で実機確認済み・Fargateは未測定 | `StrandsAgents/strands-decider-2B-qwen3.5-v1-2610`（revision `216d1ccb…` を固定）とベース重み `Qwen/Qwen3.5-2B-Base`（`b1485b2f…`）をビルド時に取得。禁止はDeciderが守らないため通常コードのガードで強制 |
| 画像観察・説明 | Bedrock Converse、Amazon Nova Lite | 条件付き・未検証 | 初期ID `amazon.nova-lite-v1:0`。東京での品質とイベントクレジット対象製品を確認 |
| コンテナ | Docker、Amazon ECR | Dockerfile作成済み・未ビルド・未検証 | ワーカーのモデル・依存を同梱。APIへのPyTorch/重みの混入を避ける。CPU版torchをLinuxで選ぶ設定はロックで確認済み |

自動化の流れは **YAML → Connexionの検証・ルーティング／Orvalのクライアント生成**。
Connexionはミドルウェアのソースや業務処理を生成するものではない。
FastAPIは比較した代替案であり、現在の推奨構成へ同時に追加しない。

## AWS基盤・認証・運用

| 領域 | 技術 | 選定状態 | 用途・制約 |
| --- | --- | --- | --- |
| リージョン | 東京 `ap-northeast-1` | 採用 | CloudFrontはグローバル。初版でクロスリージョン推論を有効にしない |
| Web配信 | Amazon S3、CloudFront OAC | 採用・未構築 | 非公開S3からSPAを配信 |
| 認証 | Amazon Cognito User Pool | 採用・未構築 | Authorization Code＋PKCE、公開クライアント、初版は招待制 |
| API実行 | API Gateway HTTP API、AWS Lambda | 採用・未構築 | JWT authorizer＋アプリの所有権検証。VPC外Lambda。軽量ZIP配布を推奨 |
| 状態保存 | DynamoDB On-Demand | 採用・未構築 | セッション、所有者、ジョブ、利用枠。画像は格納しない |
| 一時画像 | 専用の非公開S3 | 採用・未構築 | 署名付きPOST、サイズ・期限制限、処理後削除と回収処理 |
| 非同期処理 | SQS Standard、DLQ | 採用・未構築 | job IDのみ送信。重複配送を前提にリース・冪等性を実装 |
| ワーカー実行 | ECS on Fargate、Linux/x86_64 | 採用・性能未検証 | 初期案4 vCPU/16 GB、同時処理1。デモ前起動・終了後停止 |
| ネットワーク | VPC、public subnet、IGW | 採用・未構築 | ワーカーはpublic IP、inboundなし。NAT Gateway・ALBを作らない |
| IaC | AWS CDK v2、TypeScript、cdk-nag 3 | 採用・Identity／Data／Frontend／Api の Construct を定義済み（デプロイ未実施） | `apps/cdk`。aws-cdk-lib 2.273.0＋CLI 2.1145.0＋cdk-nag 3.0.2 の組で synth・jest 通過。cdk-nag 3 は `Validations.of().acknowledge()` を使う。Worker／Operations は US1 で追加 |
| 監視・費用・停止 | CloudWatch、AWS Budgets、EventBridge Scheduler | 採用・未構築 | メタデータ監視、通知、画像回収、ワーカー停止。通知だけを課金制限にしない |

イベントクレジットは適用確認前に費用から差し引かない。BedrockとFargate等の対象製品、
有効期限、残高を確認し、割引前の使用量制限も維持する。

## 品質管理

| 対象 | 技術 | 状態・検証内容 |
| --- | --- | --- |
| 現行JS/TSチェック | Biome、Oxlint | 導入済み。Vite+移行時にルール・整形の重複を整理 |
| 未使用コード・依存 | Knip | 導入済み。`pnpm knip`、設定は `knip.json` |
| 重複コード | jscpd | 導入済み。`pnpm jscpd` で `apps/`・`packages/` を検査。`.jscpd.json` の閾値5%、レポートは `report/` |
| フロント単体テスト | Vitest、Testing Library（jsdom） | 導入済み・22件（PKCE、ポーリング、モックと契約の一致、画面の通し） | モックAPIの応答は OpenAPI の schema で検証し、仕様とずれたら失敗する。E2E（Playwright）は未導入 |
| Python | pytest、Ruff | 推奨・未導入。認可、利用枠、重複配送、判断結果の接続 |
| IaC | Jest、CDK assertions、cdk-nag | 導入済み・17件のテスト（セキュリティ設定・契約とのルート一致・cdk-nag）。デプロイ後の実環境での検証はまだ |
| E2E | Playwright | 推奨・未導入。撮影から結果・終了までの体験 |
| API契約 | YAML lint、Connexion読込み、Orval再生成差分、契約テスト | 一部整備（YAML検証・Connexion読込み・operationId重複・認証必須・3.1構文の検査は `check_spec.py`。Orval再生成差分の検査はコミット後に有効。契約テストは未実装）。仕様と実装・生成クライアントの不一致を検出 |

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
