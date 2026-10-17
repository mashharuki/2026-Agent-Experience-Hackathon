# Data Model: 撮る前のひと手間

[spec.md](spec.md) の Key Entities を保存形に落とした設計案。保存先は DynamoDB（On-Demand）で、
**顔画像・画像を復元できるデータは保存しない**（FR-020/023）。キー設計とインデックスは
tasks で具体化する。値は仮置きを含む。

## 保存するエンティティ

### User（Cognito 側が正本）

- `sub`：Cognitoの利用者ID。所有権確認の唯一のキー
- アプリ側が持つのは同意状態と利用枠のみ（下記 Consent, QuotaCounter）

### Consent

| 項目 | 内容 |
|---|---|
| `sub` | 所有者 |
| `consentVersion` | 同意文言の版 |
| `grantedAt` / `revokedAt` | 同意・取消しの日時 |

検証：同意の記録がない、または取消し済みの場合、アップロード枠の発行と解析要求を拒否する（FR-018）。

### Session

| 項目 | 内容 |
|---|---|
| `sessionId` | 識別子（推測困難な値） |
| `ownerSub` | 所有者 |
| `scope` | `brow` / `bangs` / `look_first`（相談範囲） |
| `wish` | 任意の一文の希望（最大200文字を仮置き）。ログには複製しない |
| `restrictions` | 明示的な禁止（コードが検査する）。例：`no_touch_brow`、`keep_brow_shape` |
| `tools` / `time` | 道具・時間（必要になった時点で取得）。未取得は null |
| `changesUsed` | 試した変更の数（0〜2） |
| `analysesUsed` | 解析の回数（0〜3） |
| `state` | 下の状態遷移 |
| `expiresAt` | 作成から24時間（TTLで後処理） |

検証：`changesUsed ≤ 2`、`analysesUsed ≤ 3` は条件付き書き込みで原子的に更新する（FR-007/022）。

### Job（解析の依頼）

| 項目 | 内容 |
|---|---|
| `jobId` / `sessionId` / `ownerSub` | 識別子と所有者 |
| `idempotencyKey` | 利用者＋セッションに紐付く再送防止キー |
| `phase` | `before` / `after`（整える前後のどちらの撮影か） |
| `status` | `PENDING_DISPATCH` → `QUEUED` → `RUNNING` → `SUCCEEDED` / `FAILED` / `UNKNOWN` / `CANCELLED` |
| `lease` | ワーカーのリース（条件付き取得）と期限 |
| `bedrockCalls` | 呼び出し回数（最大2）と開始記録 |
| `result` | 下の Advice（成功時） |
| `errorClass` | 失敗の分類（画像は含めない） |

### Observation（Job の結果の一部。画像は含まない）

- `visible`：確認できた事柄（例：眉の毛流れが乱れて見える）
- `uncertain`：確認できなかった・不確かな点（例：逆光で眉の下部が見えない）
- `lighting` / `framing`：撮影条件の評価（比較可否の判断に使用）
- `confidence`：モデルの確信度。**美容助言の正解確率として表示しない**

### Advice（Decider の選択と実行結果）

| 項目 | 内容 |
|---|---|
| `kind` | `grooming_tip` / `capture_setup_tip` / `clarify` / `offer_finish` |
| `basis` | 根拠（Observation または本人の依頼のどちらに基づくか） |
| `text` | 本人に見せる短い助言文（生成する場合のみ） |
| `userResponse` | `try` / `another` / `finish`（本人の反応） |

### Comparison

- `sessionId`、`pairIndex`（1回目／2回目）、`choice`：`prefer_before` / `prefer_after` / `unclear`
- **写真そのものは保存しない**（端末メモリのみ）。サーバーに残るのは選択のみ（FR-021）。

### DecisionRecord（デモ用の判断記録。画像なし）

| 項目 | 内容 |
|---|---|
| `jobId` / `sessionId` | 関連（所有者以外は参照不可） |
| `question` | Decider に渡した型付きの問いの版 |
| `choiceProbabilities` | 選択肢ごとの確率と confidence |
| `selected` | 選ばれた支援 |
| `guardOverride` | 通常コードが上書き・拒否したか、その理由（禁止・上限・終了） |
| `invoked` | 実際に呼ばれた処理（例：`bedrock.explain`、`none`） |

FR-016 を満たす。顔画像・画像を復元できるデータ・本人の自由記述を含めない。

### QuotaCounter

利用者単位の日次カウンタ（10セッション／人・日）と、全体のカウンタ（100セッション／日）。
条件付き書き込みで原子的に予約する（FR-022）。

## Session の状態遷移

```text
CONSENT_PENDING ──同意──▶ CONSULTING ──撮影──▶ ANALYZING ─┬─ grooming_tip ─▶ ADVICE_SHOWN ─ やってみる ─▶ TRYING
   │                          │                          │                      │  別の提案 ─▶ ANALYZING（解析枠内）
   │                          │                          ├─ capture_setup_tip ─▶ CAPTURE_ADJUST ─▶ ANALYZING
   │                          │                          ├─ clarify ───────────▶ CONSULTING
   │                          │                          └─ offer_finish ──────▶ DONE
   └────────────── 終える（どの状態からも）──────────────────────────────────────────────▶ DONE
TRYING ─整えたので確認─▶ ANALYZING（phase=after）─▶ COMPARING ─選択─▶ 終える ▶ DONE ／ もう一手 ▶ ADVICE_SHOWN（changesUsed < 2）
```

不変条件：
- `changesUsed = 2` または本人が終了を選んだ後は、`ADVICE_SHOWN` に入らない（FR-007）。
- `TRYING` の間は新しい助言を生成しない（FR-004）。
- 画像が届いていない `ANALYZING` は `FAILED` にせず、再撮影を案内して `CONSULTING` へ戻す（FR-011）。
- 終了・取消し後に返った結果は画面へ適用しない（アーキテクチャの終了伝播）。
