# 契約：Decider の型付きの問いと動作への接続

ハッカソンの提出物（再利用可能な判断パターン）の核になる契約。判断パターンの候補タグは
`#tool-selection`。**呼び出し形式と応答形式は 2026-10-17 の実機確認（T008、開発Mac・CPU、
`strands-decider 0.1.0`）で確認済み**（[research.md](../research.md) R-001）。接続ガードの閾値などは仮のままで、
Fargate での性能・品質は未検証。

## 呼び出し（確認済み）

```python
from strands_decider.infer import load_engine
from strands_decider.schema import ChoiceQuestion

engine = load_engine("StrandsAgents/strands-decider-2B-qwen3.5-v1-2610", device="cpu")
res = engine.ask(state_text, {"next_support": ChoiceQuestion(instructions=..., criteria={...})})
ans = res.answers["next_support"]   # ans.choice / ans.probabilities / ans.confidence
```

- `criteria` は**選択肢名→説明**の辞書。選択肢の説明を渡せる（最低2、最大255）。
- 応答: `choice`（最上位）、`probabilities`（選択肢→確率、合計1）、`confidence`。`usage` は入力約200・出力1トークン。
- モデルのロードはプロセス起動時に1回行い、再利用する（初回ロード約81秒、ピーク RSS 約5.7 GB。この環境）。
- リビジョンは固定する。実行時にHugging Faceから取得しない（ビルド時に同梱）。

## 問い（型付き・`choice`）

> 本人の依頼と今確認できている状態から、次に使う支援はどれか？

選択肢（識別子は変更しない）:

| 選択肢 | 意味 | 接続先の処理 |
|---|---|---|
| `grooming_tip` | 身支度の一手を示す | Bedrock で説明文を生成 → 助言として返す |
| `capture_setup_tip` | 撮影条件の調整を一つ案内 | 固定の案内語彙から選ぶ（Bedrock呼び出し不要を既定とする） |
| `clarify` | 本人への追加確認 | 確認の問いを返す |
| `offer_finish` | 終了を提案 | 終了の提案を返す |

## 入力（Decider へ渡すテキストの状態）

本人の発言（希望）、相談範囲、観察結果と不確かな点、道具、直前の助言、本人の反応、
残りの試行回数。**画像は渡さない。顔画像を復元できる情報は含めない。**

## 出力の扱い

- 最上位の選択肢、選択肢ごとの確率、confidence を受け取る。
- confidenceガードは現実装では`grooming_tip`だけが対象で、既定閾値0により無効。**暫定値0.8には根拠がない**。合成例の妥当な選択（逆光→`capture_setup_tip` 0.685、根拠が弱い→`clarify` 0.688）は一律閾値への注意材料だが、この2例が現行ガードで退避されるわけではない。対象行動ごとに評価し、confidenceを「美容助言の正解確率」として表示しない。
- **Decider は状態テキスト内の禁止を守らないことがある**: 「眉には触れたくない」と明記した状態で `grooming_tip`
  が最上位（確率 0.565、confidence 0.419）になった。禁止は必ず通常コードで検査する（下の接続ガード 2）。
- Decider の失敗や不正な出力を成功した判断として記録しない（DecisionRecord に `FAILED` として残す）。

## 接続（通常コードのガード）

Decider の結果は**そのまま実行しない**。次をコードで再検査し、結果を上書きしたら理由を DecisionRecord に残す。

1. 画像が届いていない → 助言せず再撮影を案内（モデルの判断に依存しない）
2. 明示的な禁止（`no_touch_brow` 等）に反する → `grooming_tip` を拒否
3. `changesUsed = 2` または本人が終了を選択 → `offer_finish` に固定
4. `TRYING` 中 → 新しい助言を作らない
5. 前後の光が大きく異なる → 効果を断定せず `capture_setup_tip` / 撮り直し

## 検証の観点

- Decider が選んだ支援が変わると、実際に呼ばれる処理（`invoked`）も変わること（FR-015/024）。
- 固定値で Decider の判断を装っていないこと（憲章I）。
- 曖昧な依頼の例と、`clarify` を選ぶ例を、開発用の例として含める。評価用データとは分ける。

## 状態文の追加計画（2026-10-19、未実装）

[評価計画](../model-evaluation-plan.md)では、現行v1を基準に、解析残枠・確認回答済み・比較可否・許可範囲を加えたv2を比較する。初回は四択の説明とガードを変えない。本番既定の変更は固定評価後の採用判断による。
CLI・データ・実験結果の契約は[model-evaluation.md](model-evaluation.md)。追加のモデル応答検査は、無効な確率・confidenceを補完せず失敗にし、ハンドラーが実行されないことを確認する。
