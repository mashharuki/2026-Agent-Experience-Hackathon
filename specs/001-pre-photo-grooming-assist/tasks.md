---

description: "Task list for 撮る前のひと手間（撮影前の身支度アシスタント）"
---

# Tasks: 撮る前のひと手間（撮影前の身支度アシスタント）

**Input**: Design documents from `/specs/001-pre-photo-grooming-assist/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)、[docs/tech-stack.md](../../docs/tech-stack.md)

**Tests**: 含める。仕様自体はテストを要求していないが、`AGENTS.md` と憲章が「禁止・終了・認可・画像削除・Deciderの判断の接続」の検証を求めるため、**決定的に確定できる動作のテスト**を各ストーリーに置く。モデルの判断品質の評価（`evaluation/`）は通常のテストと分けて集計する（T070）。

**Organization**: ユーザーストーリー別。ただし、公開前の最小リリースは **P1 の3ストーリー（US1・US2・US5）をすべて含む**（US5 の同意・認可・画像削除を欠いたまま顔画像を扱えないため）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 別ファイルで依存がなく並行して進められる
- **[Story]**: US1〜US6（[spec.md](spec.md) のユーザーストーリー）。Setup／Foundational／Polish には付けない
- 検証タスクは `（research T-00n）` で [research.md](research.md) の検証タスクIDを示す。**タスクID（T0nn）と research.md のID（T-00n）は別物**
- 実AWSの作成・デプロイ、課金の発生、同意済み顔写真の使用は**ユーザーの承認・提供が前提**（該当タスクに明記）

## Path Conventions

[plan.md](plan.md) の構成に従う: `apps/frontend/`、`apps/api/`、`apps/worker/`、`apps/cdk/`、`packages/api-spec/`、`evaluation/`。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: プロジェクト初期化。この時点で機能は作らない。必要な依存だけ導入する。

- [x] T001 [P] **完了 2026-10-17** `apps/api/` を uv で初期化（`pyproject.toml`、`uv.lock`、Python 3.12、pytest・Ruff 設定）。依存は API に必要なものだけとし、PyTorch・Decider を含めない
- [ ] T002 [P] `apps/worker/` を uv で初期化（`pyproject.toml`、`uv.lock`、Python 3.12、pytest・Ruff 設定）。PyTorch CPU・Decider はここにのみ置く
- [ ] T003 [P] （一部完了: TanStack Query と Orval のみ導入済み。MUI・Emotion・Vitest・Playwright は未導入）`apps/frontend/package.json` に Material UI＋Emotion、TanStack Query、Vitest、Playwright を追加し、`pnpm install` で lockfile を更新（React Bits は入れない: T010）
- [ ] T004 [P] （ほぼ完了: lint は JS ではなく Python の `openapi-spec-validator`＋Connexion 読込みで `check_spec.py` に実装し、依存の重い JS ツールを避けた。Orval は T019 で導入済み）`packages/api-spec/` に OpenAPI の lint ツールと Orval を導入（lint ツールの選定理由を `research.md` に追記）。`main: index.js` のヒントは本タスクで扱わない
- [ ] T005 [P] `evaluation/` の構成を作成（`evaluation/dev-examples/`、`evaluation/holdout/`、`evaluation/README.md`）。顔写真・個人データをコミットしないよう `.gitignore` に画像拡張子と `evaluation/holdout/` の実データを追加
- [ ] T006 [P] `apps/frontend/.env.example`、`apps/api/.env.example`、`apps/worker/.env.example` を**プレースホルダのみ**で作成（認証情報・トークンの値を書かない）
- [x] T007 **完了 2026-10-17: aws-cdk-lib 2.273.0、CDK CLI 2.1145.0、constructs 10.8.1、cdk-nag 3.0.2（aws-cdk-lib ^2.257 が必要）、TypeScript 5.5.4 の組で型検査・jest・synth が通った。** `apps/cdk/package.json` で CDK CLI/lib・Node.js・TypeScript・cdk-nag の互換性を確認して固定し、`pnpm --filter cdk test` と `pnpm --filter cdk cdk synth` が通ることを確認（結果を `docs/tech-stack.md` の備考へ）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: すべてのストーリーの前に終えるべき検証と土台。**検証ゲート（A）の結果で方式が変わり得る**ため、実装前に先に進める。

**⚠️ CRITICAL**: このフェーズが完了するまでユーザーストーリーの実装に入らない（A は結果が出たものから順に着手可）。

### A. 検証ゲート（research.md の T-001〜T-010 のうち実装前に判断できるもの）

- [x] T008 [P] Decider の `choice` 型の問いの実機確認と、4選択肢（`grooming_tip`/`capture_setup_tip`/`clarify`/`offer_finish`）の接続可否を `experiments/decider-spike/`（削除済み・履歴 `a1bcbf3`） で検証し、応答形式を `contracts/decider-decision.md` と `research.md` R-001 に反映（research T-001）
- [x] T009 [P] Connexion 3＋Mangum の結合を `experiments/connexion-mangum/`（削除済み・履歴 `bbd5c24`） の最小 API で検証（API Gateway v2 イベント、JWT claims の引渡し、異常本文の拒否、`validate_responses`、CORS、202、コールドスタート）。結果を `research.md` R-003 に記録。**不合格時は代替案へ黙って切り替えず、ユーザーに確認する**（research T-003）。**ローカルは完了 2026-10-17（23件成功）。実 API Gateway／Lambda での結合は T062 で確認**
- [x] T010 React Bits のライセンス適合を判断して `research.md` R-005 と `docs/tech-stack.md` の状態欄を更新。**決定 2026-10-17（ユーザー承認）: React Bits は採用せず、MUI＋独自CSS で演出する**（research T-005）
- [x] T011 [P] 公式 Rules の全文を再確認し（ライセンス要件、提出物、期限 2026-10-23 23:59 PDT）、憲章との不一致があれば `research.md` R-007 に記録。憲章の修正はユーザーの合意を得て、Sync Impact Report を更新して行う（research T-007）。**完了 2026-10-17: 不一致なし、憲章の修正は不要。AWS上での実動作のデモ必須、記事は公開済みであることを T062・T100・T101 で反映**
- [ ] T012 （一部完了）ユーザーと予算上限・使用量の制限・費用通知・超過時の停止手順を決め、Billing → Credits で対象製品・期限・残高を確認して `docs/architecture/cost-estimate.md` と `research.md` R-008 に記録。**この承認までは実 AWS リソースを作らない**（research T-008）。**2026-10-17: 上限 $30・ワーカー30時間以内は承認済み。クレジットは Community Builder の特典で $450 以上（申告）。ユーザーは上限 $30 を再確認済み。残り: 項目別の積算（最初のデプロイ前に必須）、停止手順は `docs/operations.md` に記載済み（未実行）、対象製品・有効期限の確認（ユーザー・任意。未確認でも上限の運用は変わらない）、停止手順の `docs/` への記載。クレジット確認と積算の完了で `[x]` にする**
- [ ] T013 [P] AWS アカウントの Bedrock モデル呼び出しログが画像・本文を保存しない設定であることを確認し、結果を `research.md` に記録（research T-010）。アカウントを変更する操作はユーザー承認のうえ実施
- [ ] T014 Fargate 4 vCPU/16 GB 相当の環境で Decider のピーク RSS とロード・推論時間を測定し `research.md` R-004 に記録（合格: ピーク RSS 12 GB 以内。不合格なら 24 GB 案と費用を再比較）。T008 に依存。ローカル Docker での予備測定と実 Fargate での測定を区別して記録（research T-004）。**（一部実測 2026-10-17: 起動コマンドから受付開始まで124秒（イメージ取得込み）。ピーク RSS は未計測のため未完了。transformers が `causal_conv1d` と `flash-linear-attention` の最適化カーネルなしで低速な参照実装に切り替わる警告が出ており、推論が遅い原因候補。）**
- [ ] T015 Nova Lite の画像観察品質評価を実施（`evaluation/` のハーネスを `evaluation/run_eval.py` に作成）。**同意のある本人の写真をユーザーから提供してもらう**。開発用の例（`dev-examples/`）で調整し、評価用（`holdout/`）は調整後にのみ使う。合格条件: 逆光・変更なしで根拠のない断定が 0 件。結果は `research.md` R-002（research T-002）

### B. API 契約

- [x] T016 `specs/001-pre-photo-grooming-assist/contracts/openapi.draft.yaml` を `packages/api-spec/openapi.yaml`（正本）へ移し、草案側は正本へのポインタに置き換える（OpenAPI 3.0.3 のまま。3.1 専用構文を入れない）
- [x] T017 `packages/api-spec/openapi.yaml` に**受付状態の API** `getServiceStatus`（`GET /service-status`）を追加: 認証あり、応答は `accepting`（真偽）、`reason`（`open`/`worker_stopped`/`warming_up`/`quota_exhausted`/`maintenance`）、`expectedReopenAt`（任意）。`503` の `Error.code` に受付停止の識別子を追加。草案・`data-model.md`・`quickstart.md` の記述と整合させる（FR-027）
- [x] T018 `packages/api-spec/package.json` に OpenAPI の lint と Connexion 読込み確認（`apps/api` で仕様を読み込むスクリプト）を追加し、`pnpm` から実行できるようにする
- [x] T019 `apps/frontend/orval.config.ts` で Orval を設定し `apps/frontend/src/api/generated/` へ TS 型・クライアント・TanStack Query hooks を生成。生成物は直接編集せず、再生成後の差分検査スクリプトを追加

### C. 認証・データ・API 骨格

- [x] T020 [P] `apps/cdk/lib/constructs/identity.ts`: Cognito User Pool（招待制・セルフ登録無効）、公開クライアント（secret なし）、Authorization Code＋PKCE、スコープ `photoprep/session`
- [x] T021 [P] `apps/cdk/lib/constructs/data.ts`: DynamoDB On-Demand（セッション・ジョブ・利用枠・同意・判断記録、TTL）、一時画像用の専用 S3（Block Public Access、SSE-S3、TLS 必須、CORS は SPA origin のみ、1 日 Lifecycle）、SQS Standard＋DLQ（visibility 120 秒、受信 3 回で DLQ）
- [x] T022 [P] `apps/cdk/lib/constructs/frontend.ts`: 非公開 S3＋CloudFront OAC（公開 S3 website endpoint を使わない）
- [x] T023 **完了 2026-10-17（デプロイなし）: Lambda の配布物は仮（ソースのみ）。実ビルドは T038。** `apps/cdk/lib/constructs/api.ts`: HTTP API＋JWT authorizer（issuer/audience/scope）＋Lambda（VPC 外・ZIP）。**全ルートに authorizer を付け、認証なしの有料経路を作らない**。スロットリングを設定。`apps/cdk/lib/cdk-stack.ts` で Identity/Frontend/Api/Data を組み合わせる
- [x] T024 **完了 2026-10-17: 17件。cdk-nag 3 は NagSuppressions を廃止し `Validations.of().acknowledge()` を使う（指摘ごとに個別の承認。`lib/nag.ts`）。** `apps/cdk/test/cdk.test.ts` を置き換え、CDK assertions＋cdk-nag で検証: S3 の公開なし、全ルートに authorizer、暗号化、Cognito がセルフ登録無効。既存の雛形テストを構成検証済みの証拠として扱わない
- [x] T025 [P] `apps/api/src/photoprep_api/auth.py`、`repo.py`、`errors.py`、`logs.py`（標準の `logging` と紛らわしいため改名）: JWT claims から `sub` を取得（任意の HTTP ヘッダーを認証済みユーザーとして信用しない）、所有権確認付きのリポジトリ、画像・自由記述を含まないエラー形式、顔画像・希望文・認証情報をログに出さない構造化ログ。**Connexion は検証エラーに入力値を含めログにも出すため、独自のエラーハンドラ（契約の `Error` 形式）とログの redact を必ず実装する**（research R-003 の落とし穴2・3。参照実装は履歴 `bbd5c24` の `experiments/connexion-mangum/app.py`（フォルダは削除済み。内容は `apps/api/` に取り込み済み））
- [x] T026 [P] `apps/api/tests/unit/test_auth_and_ownership.py`: 他ユーザーの `sub` では取得・更新できないこと、エラー応答・ログに入力値が出ないことを検証

**Checkpoint**: 検証ゲートの結果が `research.md` に反映され、契約と認証・データの土台がそろっている。T012（予算）が未承認なら、以降は**ローカル・モックで進め、実 AWS へは出さない**。

---

## Phase 3: User Story 1 - 一つだけ試して、続けるか終えるかを決める (Priority: P1) 🎯 MVP

**Goal**: 相談範囲の選択 → 最初の撮影 → 助言一つ → やってみる → 再撮影 → 前後比較 → 本人の選択 → 終了、を通しで実行できる。

**Independent Test**: 同意済みの写真（または**モック・再生データと明示した**入力）で quickstart のシナリオ 1 を通し、助言が一つだけ出ること、実施中に新しい助言が増えないこと、本人の選択が記録されることを確認する。

### Tests for User Story 1

> 先にテストを書き、失敗することを確認してから実装する。

- [x] T027 **完了 2026-10-17: テスト先行で実装。API 側の全テストは 171 件（インメモリと DynamoDB[moto] の両方で通しを実行）。T029（ワーカー）と T030（フロント E2E）は各実装の段階で行う。** [P] [US1] `apps/api/tests/unit/test_session_state.py`: [data-model.md](data-model.md) の状態遷移と不変条件（TRYING 中は助言なし、DONE 後は ADVICE_SHOWN に入らない）を検証
- [x] T028 [P] [US1] `apps/api/tests/contract/test_openapi_contract.py`: `packages/api-spec/openapi.yaml` と実装の応答（status・必須項目・エラー形式）を照合
- [x] T029 **完了 2026-10-17: ワーカー側 96 件（モックのBedrock／Decider）。実Deciderでのアダプタ確認は `RUN_REAL_DECIDER=1 uv run pytest -m real_model`（開発Mac・CPU）。** [P] [US1] `apps/worker/tests/test_pipeline.py`: Bedrock・Decider を**モックと明示した**フェイクに差し替え、観察 → 判断 → 説明 → 画像削除 → 結果保存の順序を検証（モデル品質の根拠にしない）
- [x] T030 [P] [US1] （2026-10-19：`apps/frontend/e2e/flow.spec.ts` に合成画像・モックのブラウザE2Eを実装、3件成功） `apps/frontend/e2e/flow.spec.ts`: Playwright で四画面の通し（再生 API を使用。モックである旨をテスト名に含める）

### Implementation for User Story 1 — API

- [x] T031 [P] [US1] `apps/api/src/photoprep_api/models.py`: Session・Job・Advice の型と DynamoDB 項目への変換
- [x] T032 [US1] `apps/api/src/photoprep_api/services/session.py`（解析・アップロードは `services/analysis.py`、状態遷移は `states.py`、永続化の窓口は `store.py`）: セッション作成、状態遷移、`changesUsed`/`analysesUsed` の条件付き更新（T031 に依存）
- [x] T033 [US1] `apps/api/src/photoprep_api/handlers/sessions.py`: `createSession`（`consentVersion` 必須の検証は US5 で強化）
- [x] T034 [US1] `apps/api/src/photoprep_api/handlers/uploads.py`: `createUpload`（サーバーが決めたキー、JPEG/PNG、2 MiB 以下、有効期限 60 秒の署名付き POST）
- [x] T035 [US1] `apps/api/src/photoprep_api/handlers/analyses.py`: `requestAnalysis`（`Idempotency-Key`、ジョブを `PENDING_DISPATCH` で条件付き登録 → SQS に job ID のみ送信 → `QUEUED` へ条件付き更新、202）
- [x] T036 [P] [US1] `apps/api/src/photoprep_api/handlers/jobs.py`: `getJob`（所有権確認）
- [x] T037 [P] [US1] `apps/api/src/photoprep_api/handlers/feedback.py`: `recordFeedback`（助言への反応と前後比較の選択）
- [x] T038 [US1] （**ZIP の作成を実装 2026-10-17**: `pnpm build:lambda`（`apps/api/scripts/build_lambda.py`）が uv.lock から Linux x86_64 の依存、アプリ、共有パッケージ、OpenAPI ファイルを同梱して検証する。実物は 31 MB。Lambda 上での起動は未確認。CDK はこの成果物が無いと synth を拒否する）`apps/api/src/photoprep_api/lambda_handler.py`: T009 の結果に従い Connexion アプリ全体を Mangum で包む（内側の Flask だけを公開して検証を迂回しない）。`content-length` を補うエントリポイント、`BEARERINFO_FUNC` によるセキュリティ関数（claims が無ければ401）を含める。参照実装は履歴 `bbd5c24` の `experiments/connexion-mangum/app.py`（フォルダは削除済み。内容は `apps/api/` に取り込み済み）
- [x] T039 [US1] `apps/api/src/photoprep_api/ops/dispatch.py`（パッケージ内に置く。CDK のハンドラ指定は `photoprep_api.ops.dispatch.handler`）: 1 分周期で `PENDING_DISPATCH` を再送する運用 Lambda

### Implementation for User Story 1 — Worker

- [x] T040 **（共有コードは `packages/photoprep-common`（Store・状態規則・ログの許可リスト）に切り出し、API とワーカーで同じ実装を使う）** [P] [US1] `apps/worker/src/photoprep_worker/schemas.py`: Observation・Advice・DecisionRecord のスキーマ（Pydantic 等）。不正な形式は成功として扱わない
- [x] T041 **（リースの確認と失効時のUNKNOWN化を実装。ハートビートはSQSの可視性延長と合わせて `main.py`）** [US1] `apps/worker/src/photoprep_worker/main.py`・`lease.py`: SQS long poll、DynamoDB の条件付きリース、ハートビート、古い・終了済みジョブの破棄
- [x] T042 [US1] `apps/worker/src/photoprep_worker/images.py`: S3 から画像取得・検証（サイズ・形式・期限）、処理後の削除
- [x] T043 [US1] `apps/worker/src/photoprep_worker/observe.py`: Bedrock Converse（`amazon.nova-lite-v1:0`、東京リージョン内、クロスリージョン推論なし）で観察。**構造化出力が使えない**ため、出力をスキーマ検証し、不正なら失敗として扱う
- [x] T044 **（モデルのロードは起動時1回。T008 で確認した `engine.ask` の形を使用）** [US1] `apps/worker/src/photoprep_worker/decider.py`: [contracts/decider-decision.md](contracts/decider-decision.md) の型付きの問いを Decider に渡し、選択肢の確率・confidence を受け取る。T008 の確認結果に従う
- [x] T045 **（基本ガードに加え、禁止・撮影条件による差し替えも実装済み。T067・T087 では拡張とテストの追加が残る）** [US1] `apps/worker/src/photoprep_worker/guards.py`: 基本ガード（画像欠如、変更回数の上限）。禁止・不確かさ・終了の追加ガードは US2/US3/US4 で拡張
- [x] T046 [US1] `apps/worker/src/photoprep_worker/explain.py`: `grooming_tip` の場合のみ Bedrock で短い説明文を生成（1 解析の Bedrock 呼び出しは最大 2 回、各最大 800 出力トークン）
- [x] T047 [US1] `apps/worker/src/photoprep_worker/pipeline.py`: 観察 → 判断 → ガード → 実行 → 結果と判断記録の保存 → 画像削除 → ack。呼び出し後に落ちた場合は自動再実行せず `UNKNOWN` にする
- [x] T048 **（Dockerfile・モデル取得スクリプト `scripts/prefetch_models.py`・`.dockerignore` を作成。Docker デーモンが起動しておらず、ビルドは未実施。ロックファイルは Linux で CPU 版 torch 2.14.1+cpu を選ぶことを確認）** [US1] `apps/worker/Dockerfile`: Python 3.12、PyTorch CPU、Decider のリビジョンとベース重み（`Qwen/Qwen3.5-2B-Base` 約 4.5 GB）を**ビルド時に固定・同梱**し、実行時ダウンロードをしない。HTTP サーバーを公開しない

### Implementation for User Story 1 — Infrastructure

- [x] T049 **完了 2026-10-17（デプロイなし）: CDK テスト39件、変更を壊す12件はすべて検出。S3 は CDK の `grantRead` 等のワイルドカードを避け、`uploads/*` に限定した明示アクションにした。** [US1] `apps/cdk/lib/constructs/worker.ts`: ECR、ECS on Fargate（Linux/x86_64、4 vCPU/16 GB、同時処理 1）、専用 VPC の public subnet、security group は**inbound なし**、NAT Gateway・ALB なし、S3/DynamoDB の gateway endpoint、用途別の最小権限 IAM（対象キュー・画像 prefix・テーブル・特定の Bedrock モデルのみ）
- [x] T050 **（予算は通知のみ。止める手段は夜間停止・アプリの利用枠。取り残し画像の回収 Lambda の実装 `ops/sweeper.py` も含む）** [US1] `apps/cdk/lib/constructs/operations.ts`: EventBridge Scheduler（デモ前の起動、終了時刻の停止）、T039 の再送 Lambda、取り残し画像の回収 Lambda（15 分周期）、CloudWatch のメタデータ監視、AWS Budgets 通知（$30 の 50%・80%・100%）
- [x] T051 **（`ops/worker_control.py`＋共有の `photoprep_common/service_status.py`。ワーカーは起動時にモデルのロード後に受付を開け、停止時に閉じる。受付状態の API（T076）と UI（T077）は US5 で未実装）** [US1] `apps/api/ops/worker_control.py`: ワーカーの desired count 変更と、受付中フラグ（DynamoDB）の更新。起動後、モデルロード・疎通を確認してから受付を有効化し、停止時は受付を閉じて処理中ジョブの完了後に 0 にする

### Implementation for User Story 1 — Frontend

- [x] T052 **完了 2026-10-17: フロントはモックAPI（`VITE_USE_MOCK_API=true` または API 未設定の既定）で四画面を通せる。モック動作中は常にバナーで明示。ユニット／画面テスト22件、開発サーバーをブラウザ（モバイル幅・ダーク）で通し確認。実カメラはブラウザ枠で許可できず未確認、ライト配色・Cognito 実ログインも未確認。** [P] [US1] `apps/frontend/src/theme.ts`、`App.tsx`: MUI のテーマとアプリ外枠（既存の雛形 CSS を整理）
- [x] T053 [P] [US1] `apps/frontend/src/auth/`: Cognito の Authorization Code＋PKCE（公開クライアント、トークンを永続保存しない）
- [x] T054 [US1] `apps/frontend/src/api/client.ts`: 認証付き HTTP 処理を生成クライアントへ注入。QueryClient で解析 POST の自動再試行を無効化し、再送時は同じ `Idempotency-Key` を使用。ログアウト時にキャッシュを破棄
- [x] T055 [P] [US1] `apps/frontend/src/features/camera/`: Camera API、撮影、EXIF 除去、**写真は端末メモリのみ**（query cache・永続ストレージに入れない）
- [x] T056 [US1] `apps/frontend/src/features/jobs/useJobPolling.ts`: 2→3→5 秒間隔、最大 60 秒。時間切れは自動再課金せず「確認待ち」を表示
- [x] T057 **（同意のチェックを含む最小版。同意画面の本実装は T075）** [US1] `apps/frontend/src/screens/Consult.tsx`: 相談範囲の選択（眉／前髪／まず見てほしい）と任意の希望（200 文字以内）
- [x] T058 [US1] `apps/frontend/src/screens/TrialCapture.tsx`: 位置合わせ、最初の撮影、観察可否の確認
- [x] T059 [US1] `apps/frontend/src/screens/TryOne.tsx`: 助言一つと「やってみる／別の提案／このままで終える」、実施中の待機と「整えたので確認」
- [x] T060 [US1] `apps/frontend/src/screens/Compare.tsx`: 前後の並置、「前が好き／後が好き／差が分からない」、「終える」を主操作に
- [x] T061 **（設計の修正: 2回目の変更は比較画面の「次の一手」から直接始める。「整えたので確認」の解析が次の提案も返すため、2回の変更が3回の解析に収まる）** [US1] `apps/frontend/src/features/session/`: 四画面をつなぐフロー制御（FR-026）
- [ ] T062 [US1] （準備済み: Lambda の配布物、`apps/frontend/scripts/publish.ts`、出力の追加。残りは実デプロイと通し確認）**（一部完了 2026-10-17: ap-northeast-1 へデプロイ済み。サインイン、受付状態、撮影、アップロード、解析、助言表示を実ブラウザで1回通した。「やってみる」から前後比較・終了までは未実施のため未完了。通しで見つけた不具合4件は下記）** 初回の実 AWS 通しを実施（**T012 の承認後のみ**）: ワーカー起動 → quickstart シナリオ 1 → 停止。デプロイは `cdk diff` を確認してユーザー承認を得てから行う

**Checkpoint**: US1 が単独で動き、シナリオ 1 を通せる。ただし公開前の条件は Phase 4・5 の完了を含む。

---

## Phase 4: User Story 2 - 本人の希望と制限を守る (Priority: P1)

**Goal**: 本人の希望・明示的な禁止・道具・時間を、モデルの判断に依存せず守る。

**Independent Test**: quickstart のシナリオ 2〜4 で、禁止された操作・買い足しを前提とする助言が一度も出ない。

- [ ] T063 [US2] **要ユーザー確認**: 「明示的な禁止」をどう取得するか決める。仕様の入力は任意の一文だが、禁止は通常コードで確定的に検査する必要がある。既定案は「画面の選択（例：眉には触れない／形は変えない）で禁止を取得し、一文は Decider への希望として渡す」。決定を `spec.md` の Clarifications と `data-model.md` に反映
- [ ] T064 [P] [US2] `apps/worker/tests/test_guards_restrictions.py`: 禁止（`no_touch_brow`、`keep_brow_shape`）に反する `grooming_tip` が拒否され、`guardOverride` の理由が記録されること、道具・時間が不足する場合に買い足しを前提とする提案が出ないことを検証
- [ ] T065 [P] [US2] `evaluation/dev-examples/`: quickstart シナリオ 2〜4 の開発用の例（実在の顔写真を含めない。ある場合は同意のある本人のもののみで未コミット）
- [ ] T066 [US2] `apps/frontend/src/screens/Consult.tsx`: T063 の決定に従う禁止の選択 UI
- [ ] T067 [US2] `apps/api/src/photoprep_api/handlers/sessions.py` と `apps/worker/.../guards.py`: 禁止を保存してガードで強制（Decider が選んでも上書きし、理由を DecisionRecord に残す）
- [ ] T068 [US2] `apps/worker/.../guards.py`・`decider.py`、`apps/frontend/src/screens/TryOne.tsx`: 道具・時間は助言に必要になった時点で `clarify` として尋ねる（最初にまとめて入力させない。FR-009）
- [ ] T069 [US2] `apps/worker/.../guards.py`: 道具・時間が不足する場合、買い足しを前提とする助言を除外するガード
- [x] T070 [US2] **モデルの判断品質**の評価をガードのテストと別集計にする。2026-10-20にT125〜T138で合成データによる実選択・ガード後を別集計し、[結果](../../docs/reviews/2026-10-20-local-model-evaluation.md)へ記録。実写真や助言文の品質を検証した意味ではない。

**Checkpoint**: US1＋US2 が動き、禁止と制約を破る助言が 0 件であることをテストで確認できる。

---

## Phase 5: User Story 5 - 画像の扱いを理解して同意し、本人だけが使える (Priority: P1)

**Goal**: 同意・認証・認可・画像削除・利用枠・受付状態の確認を満たす。**FR-027（受付状態）は専用のストーリーがないため、「入口で確認する」本ストーリーに含める。**

**Independent Test**: quickstart のシナリオ 11〜13・16。同意前に撮影・送信できず、未認証・他ユーザー・終了後・期限切れが拒否され、保持期間後に画像が残らず、停止中は撮影・同意へ進めない。

### Tests for User Story 5

- [x] T071 **完了 2026-10-17: US5 は API 286件・フロント35件、保護を壊す変更はすべて検出（API 16件、フロント6件。受付・同意・利用枠・終了・認可・ログ）。実AWSでは未確認。** [P] [US5] `apps/api/tests/security/test_authz.py`: 未認証、別ユーザーの `sessionId`/`jobId`、サイズ超過、終了後、期限切れの各要求がすべて拒否されること（SC-007）
- [x] T072 [P] [US5] `apps/api/tests/unit/test_consent.py`: 同意なし・取消し済みではアップロード枠の発行と解析要求が拒否されること
- [x] T073 [P] [US5] `apps/frontend/e2e/consent_and_status.spec.ts`: 同意前に撮影が始まらないこと、受付中でないと撮影・同意へ進めず理由が表示されること、受付がセッション途中で終了した場合に新規解析が拒否され終了が案内されること

### Implementation for User Story 5

- [x] T074 **（同意の版を検証し、セッションにも保存。取り消しは専用 API を設けず、セッションを終了すると写真が即時に削除される方式。アカウント単位の同意の取り消しは未実装）** [US5] `apps/api/src/photoprep_api/services/consent.py`: 同意の保存・取消し。`createSession` で `consentVersion` を必須にする
- [x] T075 [US5] `apps/frontend/src/screens/ConsentDialog.tsx`: 顔画像をクラウドで解析すること、**処理後に削除し失敗しても 24 時間以内に消える**こと、削除と終了の方法を平易に説明。同意しない選択で終われる。即時・厳密な物理削除は約束しない
- [x] T076 [US5] `apps/api/src/photoprep_api/handlers/status.py`: `getServiceStatus` の実装。T051 の受付中フラグを読む
- [x] T077 [US5] `apps/frontend/src/screens/Consult.tsx`・`features/session/`: 「相談する」画面を開いた時点で受付状態を確認し、受付中でなければ撮影・同意・送信へ進ませず、理由と再開の見込み（分かる場合）を表示。準備に時間がかかる場合は隠さない（FR-027）
- [x] T078 **（日次の枠は日本時間の0時で切り替え。全体の枠が尽きると受付状態が `quota_exhausted` になるが、進行中のセッションは止めない）** [US5] `apps/api/src/photoprep_api/services/quota.py`: 利用枠を DynamoDB の条件付き書き込みで原子的に予約（10 セッション／人・日、全体 100 セッション／日、1 セッション解析 3 回）。API Gateway のスロットリングや Budgets 通知だけに課金制限を任せない
- [x] T079 [US5] `apps/api/src/photoprep_api/handlers/sessions.py`（`endSession`）: 新規解析を拒否して画像削除を開始し、ワーカーへ取消しを伝える。実行中の外部推論は止められると約束せず、終了後の結果を UI へ適用しない
- [x] T080 **（API が終了時に写真を削除、ワーカーが全結果で削除、取り残しは15分周期の回収＋S3 の1日ライフサイクル。実測は T083）** [US5] `apps/worker/.../images.py`、`apps/api/ops/sweeper.py`: 成功・失敗・取消し時の画像削除と、取り残しの回収（署名 URL 期限＋猶予後）。S3 Lifecycle・DynamoDB TTL は補助とし、正確な時刻の手段にしない
- [x] T081 **（API Gateway の制限・Lambda のタイムアウト・Bedrock 2回/解析の上限は実装済み。リクエスト本文の上限は契約の maxLength と画像サイズで担保）** [US5] `apps/api/src/photoprep_api/`・`apps/cdk/lib/constructs/api.ts`: リクエストサイズ・頻度・再試行回数の上限、1 解析の Bedrock 呼び出し回数（最大 2）を強制
- [x] T082 [P] [US5] `apps/api/tests/unit/test_logging.py`: ログ・エラー・判断記録に顔画像、画像を復元できるデータ、希望文、認証情報が出ないこと
- [ ] T083 [US5] 画像削除（成功・失敗・取消し・取り残し）の実測（research T-009）。実 AWS で行うため T012 の承認後。結果を `research.md` R-009 に記録。**（一部実測 2026-10-17: 成功経路のみ。解析成功の十数分後に `uploads/` が0件。失敗・取消し・取り残しは未実測のため未完了）**

**Checkpoint**: P1 の3ストーリー（US1・US2・US5）が揃い、**公開前の最小リリースの条件**を満たす。

---

## Phase 6: User Story 3 - 見えないものは断定せず、条件を整える (Priority: P2)

**Goal**: 撮影条件が悪い場合に断定せず、調整・確認・撮り直しへ誘導する。

**Independent Test**: quickstart のシナリオ 5〜8。逆光・画像欠如・変更なしの再撮影・光の大きな差で、断定的な指摘が出ない。

- [ ] T084 [P] [US3] `apps/worker/tests/test_uncertainty.py`、`apps/api/tests/unit/test_no_image.py`: 画像欠如、逆光、変更なしの再撮影、前後の光の差、根拠のない「まず見てほしい」の各ケース（決定的に確定できるものはコードのテスト、モデルの判断は T090 で評価）
- [ ] T085 [US3] `apps/api/.../handlers/analyses.py`、`apps/worker/.../pipeline.py`、`apps/frontend/src/screens/TrialCapture.tsx`: 画像が届いていない場合は助言を生成せず `no_image` で終了し、再撮影を案内（モデルに判断させない）。現状の API は画像が無い・大きすぎる要求を `400 invalid_request` で拒否し、解析枠も消費しない（US1 で実装済み）。`no_image` の返し方はここで決める
- [ ] T086 [US3] `apps/worker/.../observe.py`、`compare.py`: 観察結果に `uncertain`・`lighting`・`framing` を含め、前後の比較可否（`comparable`）を判定
- [ ] T087 [US3] `apps/worker/.../guards.py`: 不確かな点が多い場合は `capture_setup_tip` か `clarify` へ、confidence が閾値未満なら `clarify` へ退避（**0.8 は根拠のない暫定値**。T008 の実機では妥当な選択も 0.685・0.688 だった。閾値は T090 の評価で決める。confidence を美容助言の正解確率として表示しない）
- [ ] T088 [US3] `apps/worker/.../guards.py`: 変更なしの再撮影では新しい外見の指摘を作らない
- [ ] T089 [US3] `apps/frontend/src/screens/Compare.tsx`、`TrialCapture.tsx`: 比較できない場合の撮り直し案内と、見えない場合の確認表示
- [ ] T090 [US3] 開発用／固定評価の分離と閾値の検討。Phase 12のケース・結果を使う。初回比較はconfidence閾値0を維持し、`grooming_tip`だけの閾値実験は必要性が確認された後に別計画で行う。未校正の0.8を自動適用しない。

---

## Phase 7: User Story 4 - 上限と終了を必ず守る (Priority: P2)

**Goal**: 最大二回の変更と、いつでもの終了を、助言の内容にかかわらず守る。

**Independent Test**: quickstart のシナリオ 9・10。二回後・終了後に新たな提案が出ない。

- [ ] T091 [P] [US4] `apps/api/tests/unit/test_limits.py`、`apps/worker/tests/test_finish_guard.py`: `changesUsed = 2` と終了選択後に `ADVICE_SHOWN` へ入らないこと、`offer_finish` に固定されることを検証
- [ ] T092 [US4] `apps/api/.../services/session.py`、`apps/worker/.../guards.py`: 変更回数の上限を条件付き更新で強制し、上限後・終了後は `offer_finish` に固定
- [ ] T093 [US4] `apps/frontend/src/features/session/`: 四画面すべてに「このままで終える」を置き、`endSession` を呼ぶ
- [ ] T094 [US4] `apps/api/.../services/session.py`、`apps/frontend/src/screens/TryOne.tsx`: `TRYING` の間は新しい助言を生成せず、顔を向け直しても指摘を重ねない
- [ ] T095 [US4] `apps/frontend/src/screens/Compare.tsx`: 「前が好き」「差が分からない」を選んだときに次の変更を強制せず、成功した利用として扱う

---

## Phase 8: User Story 6 - 判断の仕組みを公開成果として示す (Priority: P3)

**Goal**: Decider の判断が動作に反映されることを示し、提出物（再利用可能な判断パターン、記事、デモ動画、公開リポジトリ）を揃える。

**Independent Test**: quickstart のシナリオ 14。曖昧な依頼で `clarify` が選ばれ、判断記録と画面の動作が一致する。

- [x] T096 **完了 2026-10-17: 選ばれた選択肢が実際に実行された処理と一致することを4種類の選択でテスト（パイプラインと判断パターンの両方）。** [P] [US6] `apps/worker/tests/test_decision_record.py`: 判断記録の `selected` と実際に呼ばれた処理（`invoked`）が一致し、画像を含まないこと
- [x] T097 **（パターンはアプリの他の部分に依存しないことをテストで強制。保護を壊す13件の変更はすべてテストで検出）** [US6] `apps/worker/src/photoprep_worker/decision_pattern/`: 型付きの問い・選択肢・動作への接続を、アプリ固有の処理から切り離した再利用可能な形に抽出（FR-025）
- [x] T098 **（`apps/worker/tools/export_decisions.py`。利用者・セッションは一方向ハッシュで匿名化。実DynamoDBのスキャンは未実行）** [US6] `apps/worker/tools/export_decisions.py`: デモ用に判断記録を書き出すスクリプト（運用者のみ・画像なし）
- [x] T099 [US6] `docs/decision-pattern.md`: 型付きの問い、選択肢、接続コード、使い方を説明（実測・仮説・モックを区別）
- [x] T100 **（下書きのみ。英語。`[MEASURE]`/`[TODO]` を埋め、Builder Center での公開は本人が行う）** [US6] `docs/article/draft.md`: Builder Center 記事の下書き（エージェントの役割、Decider に任せた判断、実測・仮説・モックの区別）。**提出前に Builder Center で公開済みであること**が必須。公開はユーザーが行う
- [x] T101 **（台本のみ。AWS上で動いている場面が必須。撮影・公開は本人が行う）** [US6] `docs/demo-script.md`: 3 分未満のデモ台本。仮画像や再生データを使う場面を明示。動画の撮影・公開（YouTube 等）はユーザーが行う。**AWS上で実際に動作する場面を必ず含める**（再生データのみは不可の恐れ。R-007）
- [x] T102 **（`scripts/check-publishable.sh`、`THIRD_PARTY_NOTICES.md`、README のタグを整備。リポジトリの公開は本人の承認後。作業中に見つけた不具合: DynamoDB が float を受け付けず、ワーカーの保存が AWS で失敗するところだった。共有の Store で Decimal に変換して修正し、DynamoDB(moto) でのテストを追加）** [US6] リポジトリ公開前の確認: OSI 承認ライセンス（`LICENSE`）、第三者コード・モデルの権利表示、顔写真・認証情報・秘密鍵が含まれないことの走査、タグ（`#strands-decider-2b` と `#tool-selection`）の記載。公開の操作はユーザーの承認後

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T103 待ち時間（撮影操作 → 助言表示）を、処理時間・ポーリング遅延・ワーカーの起動状態に分けて測定し `research.md` R-006 に記録。中央値 10 秒以内が未達なら見直し案をユーザーに報告（research T-006、SC-005）。**（1回だけの観測 2026-10-17: 解析の受付から結果取得まで約9秒、うち撮影前のアップロード枠発行が3.4秒（Lambdaのコールド）。内訳の分解と複数回の計測は未実施のため未完了）**
- [ ] T104 実測した使用量で費用を再計算し `docs/architecture/cost-estimate.md` を更新。予算通知とは別に、利用枠と受付停止スイッチ、デモ終了時の停止が働くことを確認
- [x] T105 （2026-10-19：技術一覧・現行状態を更新。AWSの新差分は未確認） 技術の確定・導入状況を `docs/tech-stack.md` の状態欄と `docs/architecture/` に反映（React Bits の判断、Connexion＋Mangum の結果、Vite+ は未着手のまま）
- [x] T106 （2026-10-19：Knip・jscpd成功） 新しいワークスペースに合わせて `knip.json`・`.jscpd.json` を調整し `pnpm check:quality` を実行。既存の Knip 指摘の整理は別作業とし、本機能で悪化させない
- [ ] T107 [quickstart.md](quickstart.md) の全シナリオ（1〜16）を実行し、結果を記録（実行できなかったものは理由を明記）
- [ ] T108 セキュリティ確認: IAM の最小権限、S3 の公開有無、認証なしの有料経路がないこと、cdk-nag の指摘、`git diff --check`、秘密情報の走査
- [ ] T109 提出前確認: 公式 Rules を再確認（T011 の再実施）、提出期限 **2026-10-23 23:59 PDT（日本時間 2026-10-24 15:59）**、記事・動画・公開リポジトリ・タグの揃い、デモ後のワーカー停止とリソース整理

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: すぐ開始できる
- **Foundational (Phase 2)**: Setup 完了後。A（検証ゲート）は結果が出たものから順に着手でき、B・C と並行できる
- **User Stories (Phase 3+)**: Foundational 完了後。US1 が土台で、US2・US5 は US1 の API・ワーカーを拡張する
- **Polish (Phase 9)**: 公開したいストーリーの完了後

### 主な依存関係

- T014 は T008 に、T015 は T005 とユーザー提供の写真に依存。T038 は T009 に、T044 は T008 に依存
- T017 は T016 に、T019 は T016・T017 に、T035 は T017 の `Error.code` 追加に依存
- T062・T083 は T012 の承認が前提
- T066 は T063 の決定に依存
- T076 は T051（受付中フラグ）に、T077 は T017・T076 に依存
- T087・T090 の閾値は T015 の評価結果に依存

### Parallel Opportunities

- Setup のうち [P] は並行できる（T001〜T006）
- Foundational: T008・T009・T011・T013 は並行できる。T020・T021・T022・T025 は別ファイルで並行できる
- US1: テスト（T027〜T030）は並行できる。API のハンドラとワーカーの `schemas.py`・フロントの `theme`/`auth`/`camera` は別ファイルで並行できる
- Phase 3 後、US2 と US5 は、同じファイル（`guards.py`、`sessions.py`、`Consult.tsx`）を触るため**同時に進める場合は担当ファイルを分ける**

### Parallel Example: Foundational 検証ゲート

```bash
Task: "Decider の choice 型の問いの実機確認 in experiments/decider-spike/（削除済み・履歴 a1bcbf3）"      # T008
Task: "Connexion＋Mangum の結合検証 in experiments/connexion-mangum/（削除済み・履歴 bbd5c24）"            # T009
Task: "公式 Rules の全文再確認 → research.md R-007"                              # T011
Task: "Bedrock モデル呼び出しログの設定確認 → research.md"                       # T013
```

---

## Implementation Strategy

**期限の制約**: 提出期限は 2026-10-23 23:59 PDT で、本タスク作成日（2026-10-17）から約 6 日。本リストは全体で 109 タスクあり、**全部は終わらない可能性が高い**。下の優先順で進め、範囲を絞る判断はユーザーと行う。

### 最優先（提出の必須条件に直結）

1. T008（Decider の実機確認）と T012（予算の承認）、T011（公式 Rules）を最初に済ませる。結果次第で構成が変わる
2. US1 の縦の一本（T027〜T062）を最小で通す。モックや再生データを使う場合は明示する
3. US6 の提出物（T096〜T102）を後回しにしない: 記事・動画・公開リポジトリ・判断パターンは提出の必須条件

### 範囲を絞る候補（ユーザーと相談して決める）

- US3・US4 の一部を縮小し、シナリオ 5・9 のみに絞る
- Playwright（T030・T073）を手動確認に置き換える
- US2 の評価ハーネス（T070・T090）を最小限にする
- 公開デモは「デモ前に起動し、終了後に停止」する運用で、常時公開を目指さない

### MVP First

Phase 1 → Phase 2（A の検証を含む）→ Phase 3（US1）→ 通しで確認 → Phase 4・5（P1 を満たす）→ 公開前の確認。

### Incremental Delivery

US1 → US2 → US5 → US3 → US4 → US6 の順で、各ストーリーを単独でテストして次へ進む。

---

## Phase 10: 追加要望（2026-10-17）— 多言語対応（FR-028）と PWA（FR-029）

ユーザーの追加依頼。契約（OpenAPI）→ API → ワーカー → フロントの順で、テスト先行。

- [x] T110 [FR-028] OpenAPI の `CreateSessionRequest` に任意の `language`（`ja`｜`en`、既定 `ja`）を追加し、Orval で再生成。API はセッションに保存する（不正値は 400）。テスト先行 （2026-10-17: `language` を契約・API・保存に追加、Orval 再生成済み）
- [x] T111 [FR-028] ワーカー: `explain.py` の助言文（固定文・Nova 向けの指示）をセッションの言語で出す。観察（`observe.py`）と Decider の入力は内部用なので言語を変えない。テスト先行（英語で日本語が混ざらないこと） （2026-10-17: 助言文・撮影のコツ・質問・説明の指示を日英で出す。ワーカー150件通過。**英語の助言文の質は未評価**。観察と Decider の入力は日本語のまま）
- [x] T112 [FR-028] フロント: i18n の基盤（言語の判定・切替・記憶）と、全画面・エラー・同意文の日英の辞書。辞書の両言語で同じキーがそろっていることをテストで保証 （2026-10-17: 辞書は自作の最小実装（依存なし）。キーの一致・英語に日本語が混ざらないこと・プレースホルダ一致をテストで保証）
- [x] T113 [FR-028] フロント: 画面上の言語切替、`<html lang>` の更新、セッション作成時に `language` を送る。モック API も言語に従う （2026-10-17: 言語切替、`<html lang>` と `<title>` の更新、セッション作成時に送信。英語の通しをテスト）
- [x] T114 [FR-029] PWA: マニフェスト、アイコン、サービスワーカー（静的ファイルのみ。API・S3・Cognito・写真は対象外）、更新の仕組み、オフライン時の表示。テスト先行 （2026-10-17: マニフェスト、アイコン、サービスワーカー（静的ファイルのみ・API/S3/Cognito/サインイン戻り/写真は対象外）、更新バナー、オフライン表示。保護を外すとテストが落ちることを確認。実機でのホーム画面追加は未確認）
- [x] T115 [FR-029] 公開: `publish.ts` が `index.html` と `assets/` 以外（サービスワーカー、マニフェスト、アイコン）も正しいヘッダー（サービスワーカーは no-cache）で上げる。CloudFront の挙動を確認 （2026-10-17: `publish.ts` がサービスワーカー・マニフェスト・アイコンを正しいヘッダーで上げ、無効化も追加。ビルドIDの刻印がないビルドは拒否。**実 AWS へは未公開**）
- [x] T116 実 AWS で日英それぞれの助言文、ホーム画面への追加、オフライン表示を確認し、結果を記録（実機が必要な項目は未確認と明記） （2026-10-17: 実 AWS で英語の通しを確認（助言文は英語、1件のみ、品質は未評価）。日本語の助言文とスマホのホーム画面への追加は、利用者から「できた」との報告のみ。画面の文言と端末の種類は未確認。オフライン表示は未確認）

## Notes

- [P] = 別ファイルで依存がない
- 生成物（Orval）は直接編集しない。仕様を変えたら再生成して差分を確認する
- 顔写真・認証情報・秘密鍵をコミットしない。`.env.example` はプレースホルダのみ
- 検証が済んでいない性能・品質を、デモ・記事で実測として書かない
- 各タスクまたは論理的なまとまりごとにコミットする

## 初回の実 AWS 通しで見つけた不具合（2026-10-17、すべて修正・再デプロイ済み）

ローカルのテストでは見つからず、実 AWS の最初の実行で出たもの。原因と再発防止のテストを残した。

1. サインイン直後の受付確認が401: アクセストークンが API クライアントへ渡る前に、子の最初のリクエストが送られていた（`AuthProvider.test.tsx`）。
2. API の Lambda が起動時に落ちて全リクエストが500: リポジトリの階層を前提にしたパス計算を import 時に実行していた（`test_spec_dir.py`）。
3. 受付が「準備中」のまま開かない: ワーカーの `main()` が受付開始を呼んでいなかった。関数単体のテストはあったが配線のテストがなかった（`TestServe`）。
4. 写真を送れない: 署名付きフォームが全体共通の S3 エンドポイントを指し、S3 が307を返していた。ブラウザはクロスオリジンの POST でこれを辿れない（`test_s3_client.py`）。

未解決の観察: ワーカーのログに `/models/.../trees/....json` の「Permission denied」警告が残る。Dockerfile で読み取り権限を直したが警告は消えておらず、書き込みの失敗の可能性がある。重みの読込みと推論は成功している。

## PR レビューの指摘10件への対応（2026-10-17、すべてテスト先行で修正）

1. `start` を動いているワーカーに呼んでも受付を閉じない（`worker_control.py`）。
2. `POST /sessions` が `Idempotency-Key` を守る（同じキーは同じセッション、利用枠は1回分）。
3. 401 は `unauthenticated` として扱い、トークンを期限の1分前に更新する（メモリ内の更新トークン）。非 JSON のエラー本文でも `ApiError` になる。
4. 開発用オリジン（localhost）は既定で入れない（`-c photoprep:devOrigin=` で明示したときだけ）。
5. ワーカーが状態を進めたあとに失敗したら、状態を戻してジョブを `FAILED`（`storage_error`）にする。`lastJobId` により、リース切れでも回復できる。
6. `desiredCount` は既定0のまま、`-c photoprep:workerDesiredCount=1` で動かし続けられる。
7. 生成された説明文を、勧めてはいけない行為と本人の禁止（眉・前髪・眉の形）で検査する。違反は失敗として扱い、定型文で埋めない。
8. 画像削除の部分失敗（S3 の `Errors`）を検出してログに残す（セッションは終了する）。
9. サービスワーカーの元ファイルを Vite の root から探す。
10. 1セッションあたりの署名付きアップロードを6件までにする（超えると429）。

未確認: 実 AWS では再デプロイしていないため、1・5・6 の挙動は AWS 上では確かめていない。検査の語彙（7）は日本語と英語の主要な表現のみで、網羅ではない。

## Phase 11: レビュー修正（2026-10-19）

修正範囲と受け入れ条件は [remediation-plan.md](remediation-plan.md)。既存の未完了のAWS検証・提出タスクとは分ける。

- [x] T117 [R6] 初期化をrender外へ移し、StrictModeでシナリオと通信先の一致を検証する。
- [x] T118 [R3] Storeのトランザクション、解析・セッション受付の原子性、冪等性、競合・障害復旧を検証する。
- [x] T119 [R4] 独立した通信期限、エラー処理、終了・取消・遅延応答の抑制を実装する。
- [x] T120 [R1] 禁止事項の選択UIからAPI・ガードへ接続し、禁止選択・説明を拒否する。
- [x] T121 [R2] YAML・状態・回答API・workerの観察再利用・回答フォームを実装し、認可・上限・再送を検証する。
- [x] T122 [R5] S3部分失敗の集計、限定再試行、監視と回収手順を追加する。
- [x] T123 [R7] Knip、CI、ブラウザE2E、技術一覧・ガイド・検証文書を更新する。
- [ ] T124 [全体] AWS受け入れ検証：新API・認可・トランザクション・終了・削除・監視、撮影ガイド・比較・任意保存を確認する。2026-10-19のユーザー指定により、T145の端末内UI回帰とT140のローカル実モデル結果を確認してから着手する。OSへの保存の成否はローカルモックの成功と分ける。**2026-10-21：API全8操作・実モデル経路・確認回答・同時受付・終了・画像削除・比較選択の保存をAWSで確認。ワーカー停止、残存画像／観察文脈／テストユーザー0件、監視配置も確認。[検証記録](../../docs/reviews/2026-10-21-aws-validation.md)。実機UI／OS保存、通知到達、実AWSの故障注入は未確認のためタスク全体は未完了。**

## Phase 12: 追加実装・ローカルモデル実験（2026-10-19計画）

2026-10-20にT125〜T140を完了。実モデル275判断、v2不採用・既定v1／閾値0を維持。[model-evaluation-plan.md](model-evaluation-plan.md)のEV-001〜006／G1〜G4と、[実験記録](../../docs/reviews/2026-10-20-local-model-evaluation.md)を参照。AWSは未実施。人間のラベル確認・confidence校正は未実施で、T090の校正部分を完了したことにはしない。
**順序：A→B→C→D→E→結果確認後にT124。** コードとfakeの成功、実モデルの品質、AWSでの確認を別に扱う。

### A：評価の土台

- [x] T125 [EV-001/002] `apps/worker/evaluation/schemas.py`と`tests/test_evaluation_cases.py`：ケース・manifest・結果の型、ラベル非混入、重複／群跨ぎ／矛盾の拒否を実装。契約は`contracts/model-evaluation.md`。
- [x] T126 [EV-002] `apps/worker/evaluation/cases/{dev,holdout}.jsonl`とmanifest：合成10＋30件、5群、許容集合、支援可能性、作成・レビュー方法とhashを固定。ライフサイクル拒否試験と分離する。依存T125。
- [x] T127 [EV-001/004] `evaluation/runner.py`と`tools/evaluate_decisions.py`：validate／run／compare、fake、共通ガードと副作用なしハンドラー、部分結果、実行上限、時間監督を実装。通信とAWSクライアント生成を禁止した試験で完了。依存T125。
- [x] T128 [EV-001] `evaluation/backends.py`：ラベルを参照しない固定`rules-v1`を実装し、四択・曖昧な意味を解釈しない限界を記録。既存ガードと組み合わせる。依存T125。
- [x] T129 [EV-001/002/005] `evaluation/{metrics,reporting}.py`、`tests/test_evaluation_reporting.py`、`.github/workflows/ci.yml`：分母、失敗／未実行、群別・方式別・反復別集計、全終了fakeの不合格、入力本文の非出力、通常CIのfake限定を実装。依存T126〜T128。

### B：ローカル実モデルの基準値

- [x] T130 [EV-004] `evaluation/model_cache.py`／`backends.py`：既存の二つの固定revisionとhead／LoRA／tokenizer／ベース重みを検査し、オフラインで一度ロード。キャッシュ欠落・版違いは即時失敗、自動取得なし。依存T127。
- [x] T131 [EV-004] `tests/test_evaluation_offline.py`と実験記録：通信0・並列1・回数／壁時計上限・中断保存を検証後、実モデル5件のローカルスモークを実施。品質評価へ混ぜない。依存T129、T130。
- [x] T132 [EV-001/005] v1の状態文golden fixture、問い・ガードhashを保存し、dev10件×3反復の基準値を記録。ルールも集計する。依存T126、T128、T131。

### C：状態整合と防御的検査

- [x] T133 [EV-003] `decision_inputs.py`、`decider.py`：確定済み共通入力、v1再現とv2状態文、残枠・確認回答済み・比較可否を実装。四択の説明とガードは変えず、本番既定はv1。依存T132。
- [x] T134 [EV-003] `decision_pattern/decider.py`と対応テスト：不正な選択肢、キー欠落、NaN／Infinity、範囲・合計・最上位の不整合を拒否し、失敗時ハンドラー0件を保証。依存T125。既存呼出しとの互換性を確認。
- [x] T135 [EV-003/006] `pipeline.py`と`test_pipeline.py`／`test_clarifications.py`等：モデルとガードの入力源を統一し、現在受付分を含む回数・観察再利用・比較・終了後破棄の回帰を検証。依存T133、T134。

### D：モデル比較と採否

- [x] T136 [EV-001/002] dev10件×3反復×v1／v2を比較して必要なら状態文を調整。T132の実装前の基準値とは分け、現在の同一adapter／ガードで比較する。追加調整分は初回275回の基本計画と別に記録。holdoutを見ずに候補・実行設定・採否条件を固定。依存T135。
- [x] T137 [EV-001/002/004] 固定holdout30件×3反復×v1／v2をローカルで実行し、ルールも比較。同じモデル・ガード・閾値0。入力本文や実写真を出力せず、部分runは部分として記録。依存T136。
- [x] T138 [EV-005/006] `docs/reviews/`に実測レポート：群別の適合率・違反・不要な退避・失敗・実行条件と限界、v2採用／不採用をG3で判断。評価データを見て調整したら新しい評価セットを準備。依存T137。

### E：採否反映・AWS検証への引継ぎ

- [x] T139 [EV-006] 採用なら本番既定と`DecisionRecord.question_version`をv2へ更新し回帰、不採用ならv1維持を明記。confidence閾値は0。`docs/decision-pattern.md`／技術一覧／researchを実際の結果へ同期。依存T138。
- [x] T140 [EV-006] ローカル実装・実験の完了証拠、残課題、AWSで確認する差分を整理。G4で移行可否を判定し、ユーザーへ結果を報告。**T124のAWS操作はここでは実施しない。** 依存T139。

## Phase 13: 比較して選んだ一枚を持ち帰る（2026-10-19計画）

①＋③へのユーザーの支持を反映し、T141〜T145をローカル実装・検証済み（[結果](../../docs/reviews/2026-10-19-photo-completion-validation.md)）。[photo-completion-plan.md](photo-completion-plan.md)参照。番号は追加順であり、実装順は**T141〜T145→Phase 12→T124**。

- [x] T141 [FR-030/031] 四画面内の比較・保存・終了の流れを設計し、表示中の写真・保存ボタンの対象・好みのフィードバックを分離。保存済みファイルが端末に残る説明も日英で揃える。APIの変更なし。
- [x] T142 [FR-031] `features/camera/`と再撮影画面：基準写真を参考にする任意の位置合わせガイド、左右向きと縦横比、オフでも撮影できる経路を実装。撮影Blobにガイドを焼き込まない。依存T141。
- [x] T143 [FR-031] `screens/Compare.tsx`：並置／A・B切替、同じ表示枠、前後ラベル、選択の保持。表示切替で推論しない。依存T141。
- [x] T144 [FR-030] `features/session/photos.ts`と保存ヘルパー、`SessionFlow.tsx`：明示した前／後／変更なし画像の任意保存、失敗時の再操作、参照URL解放、保存せず終了を実装。撮影中の終了・再開始では遅延画像を破棄する。初回`offer_finish`の既存終了処理を保ち、無変更の保存は解析前プレビュー・終了前の助言画面に設ける。保存要求をOSへの保存完了として扱わない。依存T141。
- [x] T145 [FR-030/031] Vitest／Playwright：合成画像で保存ファイルと元Blobの一致、ガイドの向き・画素への非重畳、比較切替、無変更・保存せず終了、通信失敗時の保存、終了後の遅延撮影・応答と参照解放、追加通信0を確認。仕様・技術一覧・検証記録を同期。依存T142〜T144。

## Phase 14: 改善しなかった原因の診断（2026-10-20）

後続：[eligibility-plan.md](eligibility-plan.md)に基づき、以下を順に実装・検証する。

- [x] T147 実行可能性の契約・候補絞込み・コード決定の監査型を実装し、境界と不正応答をテストする。
- [x] T148 v3の問い／状態を追加し、workerへ接続。文面の退行を確認してv3を棄却し、従来の表現＋候補制御のv4を既定にする。根拠なし・確認済み・上限・比較不能時の終了を通しで検証する。
- [x] T149 旧データを保持し、別のpolicy-casesと未使用入力のeligibility-matrixを固定して実モデル比較。完了モデル判断160件・コード決定40件を分離集計し、途中呼出し最大1件の中断も記録。v4は固定30例で最終30/30・違反0・支援6/6。人間のレビューや一般精度を検証した意味ではない。
- [x] T150 仕様・再利用パターン・技術一覧・[検証記録](../../docs/reviews/2026-10-20-eligibility-validation.md)を更新し、Worker255・API378・Frontend145件の回帰とビルドを確認。AWS操作なし。

- [x] T146 [EV-005/006] 選択・スコア・SDK経路を監査し、dev10例×3条件の規則明記実験をオフラインで30判断・600秒以内に実施。[原因分析](../../docs/reviews/2026-10-20-decider-root-cause-analysis.md)と実測JSONに、入力不達の除外、文面の寄与と未解決例、退行、ラベル不整合、修正方針を記録。本番既定と既存評価データは維持。新設計の実装・新holdout・AWS検証は未実施。

## AWS検証で見つかった再送不具合（2026-10-21）

- [x] T151 完了後の解析／確認回答の同一キー再送が409になる順序不具合を修正。所有権・入力一致を確認して元の受付応答を返し、新規要求は終了後に拒否する。両Storeの回帰テストを追加し、API382件・Ruffと実AWSでの終了後再送を確認。AWSは補助確認を含む73チェックが成功。実機UIの残件はT124で管理する。

- [x] T152 [FR-033] Cognitoのメール確認コード付きセルフ登録と日英の新規登録導線を実装。既存PKCE・コールバックを共有し、認証エラー時にも再開できる。Frontend149・CDK51・型検査・Biome・Knipを確認し、既存プールを置き換えずAWSへ反映。登録画面への遷移とメール確認設定、ワーカー0台を確認。メール受信・コード入力後の本人操作は未検証（[記録](../../docs/reviews/2026-10-21-signup-validation.md)）。
