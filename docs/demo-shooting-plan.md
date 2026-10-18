# デモ動画 撮影台本（カット割り・操作・ナレーション）

[demo-script.md](demo-script.md) の場面構成を、撮影の順序と操作に落とした実行版。
規約上の条件（3分未満・AWS上の実動作・Decider の判断を映す）は demo-script.md を正とする。
**状態：台本のみ。未撮影。** 目標尺は 2:40、上限は 3:00 未満。

## 主役と一本の筋

主役は「撮影前の身だしなみ」ではなく **自制するエージェント**。
筋はこの一文：**モデルは助言し、約束は通常コードが守る。**
見せ場は場面5（禁止を伝えたのに、モデルが眉を提案しようとして、ガードが止める）。

## 撮影前の準備（順番どおり）

1. ワーカーを起動し、受付開始まで待つ（初期案の実測で約124秒）。**撮影直前に起動し、撮り終えたら停止する。**
2. フロントが実APIを指していること。黄色の「モック動作中」バナーが出ていないこと。
3. セッションAとBを同じ写真で用意する。Bは相談で「眉には触れたくない」を伝える。
4. 決定記録を書き出せることを確認する：`apps/worker` で
   `uv run python -m tools.export_decisions --table <TABLE>`
5. 画面は **スマホ幅**で録画。字幕オン。トークン、アカウントID、他人の顔、他社ロゴが映らないこと。
6. BGM は使わない（権利の問題を避ける）。

## 撮る順番（台本の順ではなく、失敗しにくい順）

| 順 | 撮るもの | 理由 |
| --- | --- | --- |
| 1 | 場面2〜4（セッションAの通し） | 最も長く、一番失敗しやすい。ワーカーが温まっているうちに |
| 2 | 場面5（セッションB） | 見せ場。**決定記録を見てから**ナレーションを確定する（下記の分岐） |
| 3 | 決定記録の画面（A・Bとも） | 別撮りにして、編集で差し込む |
| 4 | 場面1、6、7 | ワーカー不要。最後に撮る |

撮影後すぐにワーカーを停止する。

## カット割り

ナレーションは英語（字幕も英語）。語数は 1 分あたり約 130 語で、合計 330 語以内を目安にする。

### 場面1　0:00–0:15　冒頭

- **画面**：スマホ幅のホーム画面。
- **操作**：何もせず表示。
- **ナレーション**：
  "Before an ID-style photo, there's one small thing I'd like to tidy. Not ten — one. This agent suggests a single step, and I decide."

### 場面2　0:15–0:40　相談と同意

- **画面**：相談画面。
- **操作**：「眉」を選ぶ。クラウド解析の同意の説明を映し、チェックを入れる。最初の一枚を撮る。
- **ナレーション**：
  "I pick brows. Before anything is captured, the app tells me the photo is analysed in the cloud and deleted afterwards. Bedrock describes what it sees. The Decider never gets the image — only text facts."
- **注意**：同意の文言が読める長さで止める。解析待ちはカットし、画面隅に「待機時間は短縮」と出す。

### 場面3　0:40–1:10　Deciderの判断（セッションA）

- **画面**：提案の表示と、書き出した決定記録を並べる。
- **操作**：記録の `decider_choice`、`selected`、確率の部分をハイライトする。
- **ナレーション**：
  "Strands Decider 2B answers one typed question: which support comes next? There are four options. It chose grooming tip, with these probabilities. Only that tool ran."
- **注意**：確率の数字は画面のものをそのまま映す。ナレーションで数値を読み上げない。

### 場面4　1:10–1:40　試して比べる

- **画面**：「やってみる」→ 整える → 再撮影 → 前後比較。
- **操作**：実際に眉を整える様子は、手元の短いカットで十分。比較画面で「前が好き」を選ぶ。
- **ナレーション**：
  "I tidy up, retake, and compare. Whatever I choose — even 'before' — counts as a good outcome. The agent doesn't push another change."
- **注意**：「前が好き」を選ぶのが重要。選択を尊重する設計を一度で見せられる。

### 場面5　1:40–2:15　見せ場：ガードが約束を守る（セッションB）

- **画面**：セッションBの結果と決定記録。
- **操作**：`decider_choice` と `selected` が違うこと、`guard_override` の理由（restriction）を指で示す。
- **ナレーション（記録の通りだった場合）**：
  "Same photo, but this time I said: don't touch my brows. The model still leaned toward a brow tip. The guard overruled it and recorded why. The model advises; ordinary code keeps the promise."
- **分岐**：モデルが最初から眉以外を選んだ場合は「still leaned toward」を使わず、
  "Even with that restriction, the guard stands behind the model, so the promise doesn't depend on the model's mood." のように **実際の記録に合わせて言い換える。**
  ナレーションを先に決めて記録を合わせない。

### 場面6　2:15–2:35　再利用パターン

- **画面**：`decision_pattern/` フォルダと [decision-pattern.md](decision-pattern.md)。
- **ナレーション**：
  "The pattern is a small standalone package: a typed question, the wiring, and a note on how to use it. Copy it into your own agent."

### 場面7　2:35–2:50　AWS構成

- **画面**：アーキテクチャ図1枚。
- **ナレーション**：
  "CloudFront, Cognito, API Gateway, Lambda, SQS, Fargate, Bedrock, DynamoDB. Photos never stay in the browser or the logs."
- **注意**：AWS 公式アイコンの図はそのまま使える。他社ロゴは映さない。

## 言わないこと

- Fargate と Bedrock の速度、メモリ、精度、費用の数字（AWS上で計測するまで）。
- 「本番品質」、旅券写真の基準を満たすという趣旨の発言。
- 開発Macの数値は「on my laptop CPU」と明示した場合だけ可（約4.5秒／判断）。

## 撮影後の確認

- [ ] 3:00 未満（目標 2:40）
- [ ] モックバナーが映っていない
- [ ] A・Bとも、AWS上の決定記録が映っている
- [ ] 個人情報、トークン、アカウントID、他社ロゴが映っていない
- [ ] 待機時間をカットした箇所に表示がある
- [ ] ワーカーを停止した
