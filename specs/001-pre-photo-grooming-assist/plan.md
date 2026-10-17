# Implementation Plan: 撮る前のひと手間（撮影前の身支度アシスタント）

**Branch**: `001-pre-photo-grooming-assist` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-pre-photo-grooming-assist/spec.md`

## Summary

利用者が撮影前に眉・前髪を一つだけ整えて試し、前後の写真を比べて自分で選ぶスマホ向けWebアプリ。
React/ViteのSPAが端末で撮影し、同意後にだけ画像を一時S3へ送る。PythonのAPI（Lambda）が
ジョブを受け付け、FargateのPythonワーカーが次の順で処理する。

1. Bedrock（Nova Lite）が画像を観察し、構造化した観察結果にする。
2. Strands Decider 2B が **画像ではなく観察結果・希望・履歴（テキスト）** から次の支援
   （`grooming_tip` / `capture_setup_tip` / `clarify` / `offer_finish`）を選ぶ。
3. 通常コードが禁止・上限・終了を再検査し、選ばれた支援だけを実行する。
4. 説明が必要な場合のみ Bedrock を追加で呼ぶ。

設計の土台は[アーキテクチャ](../../docs/architecture/README.md)（承認済み）。本計画は、それを
機能仕様に結び付け、**未検証の事項を採用済みとして扱わず検証タスクに落とす**ことを目的とする。
今回の計画作業ではコードの追加、依存関係の導入、AWSへのデプロイを行っていない。

## Technical Context

技術の状態は [docs/tech-stack.md](../../docs/tech-stack.md) の区分（採用／推奨／条件付き／既存）に従う。
下の「状態」列は同書の区分と、本計画で行った確認（[research.md](research.md)）の結果を併記する。

**Language/Version**: フロント TypeScript／React 19／Vite 8（採用・導入済み）。API・ワーカー Python 3.12（推奨・未実装）。IaC TypeScript／AWS CDK v2（採用・雛形あり）

**Primary Dependencies**:
- フロント：Material UI＋Emotion（採用・未導入）、TanStack Query（採用・未導入）、Orval 生成クライアント（推奨・未導入）、React Bits（**条件付き**・ライセンス適合が未確定。R-005）
- API：Connexion 3＋Flask＋Mangum＋boto3（推奨・**結合未検証**。R-003）
- ワーカー：PyTorch CPU、Strands Decider 2B（採用・**未検証**）、Bedrock Converse／Amazon Nova Lite（条件付き）

**Storage**: DynamoDB On-Demand（セッション・ジョブ・利用枠。画像なし）。一時画像は専用の非公開S3。比較用写真は端末メモリのみ

**Testing**: Vitest／Playwright（フロント、推奨・未導入）、pytest／Ruff（Python、推奨・未導入）、Jest＋CDK assertions＋cdk-nag（IaC、雛形のみ）、OpenAPI契約テスト（未整備）。モデルの判断品質は決定的な通常コードのテストと分けて評価する

**Target Platform**: スマホのWebブラウザ（Camera API）。AWS東京 `ap-northeast-1`（CloudFrontはグローバル）。ワーカーは Fargate Linux/x86_64

**Project Type**: Webアプリケーション（SPA＋サーバーレスAPI＋非同期AIワーカー）

**Performance Goals**: 撮影操作から助言表示まで**中央値10秒以内**（SC-005、確認済みの目標・未実測）。アーキテクチャ側の設計目標は「warm状態で観察→判断→説明のp95 15秒」。ポーリング間隔（2→3→5秒）が体感時間に加わる点を R-006 で扱う

**Constraints**: 助言は一度に一つ、変更は最大二回。解析は一セッション3回まで、1解析のBedrock呼び出しは最大2回（各最大800出力トークン）。画像は2 MiB以下、サーバー側は処理後すぐ削除（最長24時間）。ワーカー同時処理1。招待制、10セッション／人・日、全体100セッション／日（初期値）

**Scale/Scope**: 招待ユーザー10人以内、合計1,000セッション以内の小規模（[費用試算](../../docs/architecture/cost-estimate.md)の前提）。四画面（FR-026）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[憲章 v1.0.0](../../.specify/memory/constitution.md) の三原則への適合を、根拠と未確認事項に分けて記録する。

| 原則 | 判定 | 根拠 | 未確認事項（担当工程） |
|---|---|---|---|
| I. ハッカソン準拠 | **条件付き適合** | Bedrock（Nova Lite）を生成処理に使用。Decider が支援の種類を選び、選択結果が実際の呼び出し処理を変える設計（FR-015/016/024）。判断パターンのタグ候補は `#tool-selection` | ① **OSIライセンス要件の食い違い**：憲章は「OSI承認ライセンスを含める」とするが、公式Rulesの取得結果にはライセンス要件の記載がなかった（R-007）。応募直前に原文を再確認する。② React Bits の MIT＋Commons Clause はOSI承認ではない可能性が高く、公開リポジトリへ取り込まない方針（R-005）。③ Decider の `choice` 型の問いを「ツール選択」へ接続できるかの実測（R-001） |
| II. 低コスト・サーバーレス | **条件付き適合** | API・認証・保存・配信はサーバーレス。唯一の常時課金は Fargate（4 vCPU/16 GB、約$0.296/時）で、デモ前起動・終了後停止、利用枠、停止スケジュールを設ける。代替案（Lambda同梱、EC2/GPU）と不採用理由は[アーキテクチャ](../../docs/architecture/README.md)に記録済み | 予算上限が未定。クレジットの対象製品・期限・残高が未確認。Cognito等の項目別積算が未実施（R-008） |
| III. Cognito認証と基本的なセキュリティ | **適合（設計）** | Cognito（PKCE）、JWT検証＋`sub`の所有権確認、最小権限IAM、非公開・暗号化S3、同意前は送信しない、顔画像をログに出さない、入力・頻度・再試行の上限（FR-018〜023） | 設計のみで未実装。未認証・他ユーザー・終了後の拒否は実装後に検証（SC-007）。Bedrockのモデル呼び出しログで画像を保存しない設定の確認 |

**ゲート判定**: 違反なし。ただし上の「条件付き」2件は未確認事項の解消をタスクに含める。Phase 1 後の再評価は末尾「Post-Design Re-check」。

## Project Structure

### Documentation (this feature)

```text
specs/001-pre-photo-grooming-assist/
├── plan.md              # このファイル
├── research.md          # Phase 0: 未検証事項の調査と決定
├── data-model.md        # Phase 1: エンティティ・状態遷移
├── quickstart.md        # Phase 1: 検証シナリオ
├── contracts/
│   ├── README.md            # 契約の方針と正本の置き場所
│   ├── openapi.draft.yaml   # OpenAPI 3.0.3 草案（正本は packages/api-spec/openapi.yaml）
│   └── decider-decision.md  # 型付きの問い・選択肢・接続の契約（提出物の判断パターン）
├── checklists/
│   └── requirements.md
└── tasks.md             # $speckit-tasks で作成（本コマンドでは作らない）
```

### Source Code (repository root)

```text
apps/
├── frontend/        # 既存：React/Vite。四画面、Camera API、TanStack Query
├── cdk/             # 既存：雛形。Identity/Frontend/Api/Data/Worker/Operations の Construct を追加
├── api/             # 新設：Python Lambda API（Connexion＋Mangum）と運用ジョブ
└── worker/          # 新設：Python・Bedrock呼び出し・Decider・Dockerfile
packages/
├── api-spec/        # 既存（空）：openapi.yaml を契約の正本にする
└── shared/          # 既存（空）：UI共通処理のみ（API境界型は生成物を使う）
docs/                # 設計・技術スタック
```

**Structure Decision**: Webアプリ（フロント＋API）にAIワーカーを加えた4アプリ構成。既存の
`apps/*` と `packages/*` を使い、Python側（`apps/api`、`apps/worker`）は uv で依存を分離する。
APIとワーカーの依存・権限を混ぜず、PyTorch／Decider重みをAPIに入れない。OpenAPI YAMLを正本とし、
クライアントは Orval で生成して直接編集しない。

## Phase 0/1 の成果物と状態

| 成果物 | 状態 |
|---|---|
| [research.md](research.md) | 作成済み。公式資料で確認できた事項と、実測が必要な事項を区別 |
| [data-model.md](data-model.md) | 作成済み |
| [contracts/](contracts/) | 草案。API草案はOpenAPI 3.0.3、実際の `packages/api-spec/openapi.yaml` は tasks で作成 |
| [quickstart.md](quickstart.md) | 作成済み（検証シナリオ。実行できる環境は未構築） |

## Spec への戻し（Gap）

計画の過程で、仕様に明記がないため追記を提案する点が見つかった。仕様は変更していない。

1. **停止中の状態**：ワーカーはデモ前起動・終了後停止の構成で、停止中は503と再開案内を返す
   （アーキテクチャ）。仕様には「サービスが受付中でない」場合の利用者向け振る舞いがない。
   Edge Cases と FR に「受付中でない時間帯は撮影前に伝える」ことを追加する提案（clarify 候補）。
2. **待ち時間の定義**：SC-005 は「撮影操作から助言表示まで」。ポーリング遅延を含める前提で
   R-006 の実測計画を置く。
3. **「助言を出す」前提**：Decider が `choice` 型の問いで返すのは確率と confidence で、
   助言文は含まない。説明生成の Bedrock 追加呼び出しが必要になる前提をユーザー体験の待ち時間に含める。

## Post-Design Re-check

2026-10-17 再評価。**ゲート違反なし。条件付きの項目は残る。**

- **原則I**：判断パターンを [contracts/decider-decision.md](contracts/decider-decision.md) に型付きの問い・選択肢・接続として記し、`invoked` の記録で「選択が動作を変える」ことを示す設計にした。ただし Decider の応答形式は未確認（T-001）、OSIライセンス要件は公式Rulesの取得結果と憲章が食い違う（T-007）。React Bits は取り込まない暫定方針（T-005）。
- **原則II**：Phase 1 で新しい常時課金を追加していない。予算上限は未定（T-008）。
- **原則III**：data-model で画像・自由記述をログ／判断記録に含めない構造にした。同意と所有権は Session/Consent/Job の検証条件に落とした。実装後の拒否試験が必要（SC-007、T-009、T-010）。

未確認事項の担当工程は [research.md](research.md) の検証タスク T-001〜T-010（`$speckit-tasks` で具体化）。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 憲章への違反なし（記入不要） | — | — |

常時課金のFargate、2つの言語（TypeScript／Python）、4アプリ構成は、憲章の例外ではなく
第II原則の「常時稼働を採用する場合の記録」で扱う。理由・代替・費用・停止方法は
[アーキテクチャ](../../docs/architecture/README.md)と[費用試算](../../docs/architecture/cost-estimate.md)に記録済み。
