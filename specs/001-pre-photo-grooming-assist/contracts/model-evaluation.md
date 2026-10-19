# 契約：オフラインの判断評価

状態：2026-10-19設計。CLI・型・データは未実装。[実装計画](../model-evaluation-plan.md)に従う。
外部HTTP API・DynamoDBの契約は変更しない。以下は開発用CLI／ファイルの新契約である。

## EvaluationCase v1

| 項目 | 制約 |
| --- | --- |
| `schema_version` | `1` |
| `case_id` / `group_id` | 一意な合成ケースID／原例の群。groupはsplitを跨がない |
| `split` | `dev`／`holdout` |
| `category` | `normal`／`restriction`／`visibility`／`ambiguity`／`limit` |
| `provenance` | `synthetic`のみ |
| `inputs` | DecisionInputs。Observationは既存型。解析受付後の`analyses_used`は1〜3、`changes_used`は0〜2、phaseはbefore／after |
| `expected.allowed_raw_choices` | 空でない四択ID集合。モデルの選択を採点 |
| `expected.allowed_final_choices` | 空でない四択ID集合。ガード後を採点 |
| `expected.forbidden_final_choices` | 上記と重ならない四択ID集合 |
| `expected.support_possible` | 身支度の一手を出す根拠・許可・残枠があるか |
| `expected.rationale` | 合成例のラベル付け理由。モデル入力へ渡さない |
| `label_status` | `resolved`／`unresolved`。未解決は実験開始前に拒否 |

unknownフィールド、重複ID、空集合、選択肢の誤記、split漏れ、矛盾した期待値を拒否。
終了済みや未認証等の受付前ケースは別のライフサイクルテストに置く。
モデルバックエンドに渡すのは`inputs`から描画した状態文と問いのみ。`expected`・category・rationaleを渡さない。

## RunManifest v1

`run_id`、作成時刻、Git HEAD＋dirty状態／変更コードのhash、caseファイルSHA-256、問い・renderer・ガードの版とhash、実モデル・ベースrevision、SDK／torch／Python／OS、CPUスレッド数、device、seed、prefix-cache、反復・順番、実行上限、予定件数、ロード時間、完了状態を持つ。

ローカルパス、ホスト名、認証情報は公開用manifestへ出さない。版が一致しない結果の比較を拒否し、意図した差（renderer v1／v2）を比較設定で宣言する。

## TrialResult v1

case_id、backend、state_version、repeat_index、`status=ok|invalid_output|model_error|timeout|not_run`、raw_choice、final_choice、probabilities、confidence、guard_override、実行ハンドラーID、選択時間、error_classを持つ。

- `rules`／`fake`は確率とconfidenceをnullとし、架空のモデルスコアを作らない。
- エラーでは生成できない値はnull。成功行へ補完しない。
- 状態文、画像、モデル自由文、実利用者IDは書き出さない。
- ハンドラーIDは評価用の実行証跡で、Bedrockや実画面が動いた証拠ではない。
- 同じrun／backend／case／repeatの重複を拒否。部分runに未実行行を残す。

## CLI（実装後の仕様）

`python -m tools.evaluate_decisions`のサブコマンドを次のようにする。

| コマンド | 動作 |
| --- | --- |
| `validate --cases-dir PATH` | 同ディレクトリのdev／holdoutとmanifestのデータ・分割・固定hashを検査。モデル読込み／通信0 |
| `run --backend rules --split dev --cases-dir PATH --out DIR` | ルールで評価。正解ラベルへアクセスしない |
| `run --backend fake ...` | ハーネスの動作確認。結果を実モデルと明確に区別 |
| `run --backend decider --state-version v1 --split dev --cases-dir PATH --model-cache PATH --repeats 3 --max-calls 30 --max-seconds 1800 --out DIR` | 明示指定したローカル重みのみで実行。v2も同様 |
| `compare --runs DIR_A DIR_B ... --out DIR` | 前提条件の差を検査して集計。入力本文を再出力しない |

実装時に`--paired-versions v1,v2`も設け、同じロード済みengineで交互に実行できるようにする。単独／pairedのモードを混在指定したら拒否。call上限は両版合計へ適用。
引数なしはusageを表示して終了し、モデルをロードしない。出力DIRは新規のみで、既存runを上書きしない。holdoutはmanifestの固定hashが一致する場合だけ実行する。

終了コード：0＝要求した検査／run／集計が完了、2＝引数・データ・版不整合、3＝ローカル重み不足／ロード失敗、4＝実行途中のモデルエラー・上限中断・不正応答、5＝結果の品質ゲート不合格。
0でも品質が良いという意味ではなく、品質判定は別の集計に明記する。中断時はmanifestを`partial`にして非0終了。試行エラーを無限再試行しない。

ルール／fakeが共有`run_decision`の`Choice`へ接続する際は、内部の決定論的なone-hotと定数を使える。ただしこれはモデル推論の確率ではない。結果出力はnullへ変換し、confidenceや確率の校正集計から除外する。実モデルの不正応答をこの方法で補完してはならない。

## 出力

新規runごとに`manifest.json`、`trials.jsonl`、`summary.json`、`failures.md`をignoredな`report/model-evaluation/<run_id>/`へ作る。summaryに予定・成功・失敗・未実行、群別分母、実行方式を併記する。
公開用文書へは必要な集計・合成ケースIDだけを移し、全ログを自動でコミットしない。
