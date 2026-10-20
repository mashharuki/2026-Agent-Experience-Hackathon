# Quickstart：検証シナリオ

## 実行可能性分離のローカル確認

`apps/worker/`で`uv run pytest tests/test_eligibility.py`を実行する。最終解析・両対象禁止ではDecider呼出し0とスコアnull、根拠なしでは一手なし、候補外のモデル応答は処理失敗、比較不能の終了はDONEになることを確認する。

現行v4は従来の問い・選択肢の表現を保ち、コードで実行候補を絞る。v3の新文面は通常支援に退行があり不採用。`evaluation/policy-cases/`は回帰用、別の固定`evaluation/eligibility-matrix/`はv4の確認用。両方とも合成データ・人間レビュー未実施。`uv run python -m tools.evaluate_decisions validate --cases-dir evaluation/eligibility-matrix`は重み取得なしで検査できる。

現在のAPI/worker/frontend/CDKは実装済み。レビュー修正後の実行結果は [検証記録](../../docs/reviews/2026-10-19-remediation-validation.md)。以下のAWSシナリオはローカル・モックの成功と分けて記録する。

**今回の順序（2026-10-19ユーザー指定）**：[比較・任意保存](photo-completion-plan.md)のT141〜T145、[追加実装・ローカルモデル実験](model-evaluation-plan.md)のT125〜T140の順で進め、両方の結果確認後にAWSのシナリオへ移る。追加UIはローカル実装・検証済み（[結果](../../docs/reviews/2026-10-19-photo-completion-validation.md)）。モデル評価CLIは実装済み。2026-10-20の[実験記録](../../docs/reviews/2026-10-20-local-model-evaluation.md)に実行範囲と採否を記す。

### ローカル回帰

リポジトリルートで `pnpm --filter api-spec check`、`pnpm --filter frontend test`、`pnpm --filter frontend build`、`pnpm --filter frontend test:e2e`、`pnpm --filter cdk test`、`pnpm check:quality` を実行する。API/workerの各ディレクトリでは `uv sync --frozen` 後に `uv run pytest` と `uv run ruff check .`。ブラウザは事前に `pnpm --filter frontend exec playwright install chromium` で準備する。すべて合成画像・fakeモデルで実行できる。

確認質問は「まず見てほしい」→clarify→対象を選択して回答→次の支援、禁止事項は相談画面の選択UIで確定する。通信中の終了・同じ要求の再送・部分削除失敗も回帰対象。

## 前提

- Node.js と `pnpm@10.32.1`、Python 3.12 と uv、Docker（ワーカーのイメージ用）
- AWS東京リージョンのアカウント、Bedrock の Nova Lite のモデルアクセス、Cognito の招待済みテスト利用者
- 顔写真は**同意のある本人のもののみ**。リポジトリにコミットしない。開発用の例と評価用データは別ディレクトリに分ける
- 認証情報・トークンは環境変数や秘密管理で渡す。ドキュメントやログに値を書かない（プレースホルダのみ）

## 実行する検証（概要）

実AWSでは同意のある写真と招待済みアカウントを使い、ローカル結果から推測せず実行記録を残す。

| # | シナリオ | 期待する結果 | 仕様の根拠 |
|---|---|---|---|
| 1 | 眉を選び、最初の一枚を撮り、助言を受けて、整えて再撮影し、前後を比べて「後が好き」で終える | 助言は一つ、実施中は新しい助言なし、選択が記録される | US1, FR-003〜007 |
| 2 | 「眉の形は変えたくない、毛流れだけ」と入力する | 形を変える提案が出ない | US2, FR-008 |
| 3 | 「眉には触れたくない」と明示する | 眉の操作が提案されない | US2, SC-002 |
| 4 | 道具なし・時間なしで進める | 買い足しを前提とする提案が出ない | FR-009 |
| 5 | 逆光で撮る | 断定せず、撮影条件の調整か確認を選ぶ | US3, FR-011 |
| 6 | 画像を送らずに解析を要求する | 助言せず、再撮影を案内する | FR-011 |
| 7 | 変更なしで同条件の再撮影をする | 新しい外見の指摘が出ない | FR-012 |
| 8 | 前後で光を大きく変える | 効果を断定せず、撮り直しを案内する | FR-012 |
| 9 | 2回試した後に進める／各画面で終了する | 新たな提案が出ず、終了する | US4, FR-007 |
| 10 | 「前が好き」を選ぶ | 選択が尊重され、次の変更を強制されない | SC-006 |
| 11 | 同意せずに撮影へ進もうとする／同意を取り消す | 撮影の送信も解析も行われない | US5, FR-018 |
| 12 | 未認証、別ユーザーの sessionId／jobId、サイズ超過、終了後、期限切れで要求する | すべて拒否される | FR-019, SC-007 |
| 13 | 処理後・失敗後・取消し後に画像の残存を確認する | サーバー側に画像が残らない（最長24時間以内） | FR-020, R-009 |
| 14 | 曖昧な依頼（「まず見てほしい」で根拠が弱い）を入れる | `clarify` が選ばれ、実際に確認が表示される。判断記録と一致 | US6, FR-015/016 |
| 15 | 同じジョブIDを再送する／ワーカーが途中で落ちる | 二重処理や課金の重複がなく、結果不明を成功として扱わない | アーキテクチャ「再配送」 |
| 16 | ワーカー停止中に「相談する」画面を開く／セッション途中で受付が終了する | 撮影・同意へ進まず理由が表示される。途中終了では実行中の解析は完了し、新規解析は拒否されて終了が案内される | FR-027 |

## 計測（成功基準）

[research.md](research.md) の T-006 に従い、撮影操作から助言表示までを**処理時間・ポーリング遅延・
ワーカーの起動状態に分けて**記録する。中央値10秒以内（SC-005）が未達なら、結果をユーザーに報告して
目標の見直しを合意する。**実測前の数値を保証として表示しない。**

## 成果物の確認

- Decider の選択が変わると、呼ばれる処理も変わることを判断記録で示す（FR-024）。
- デモ・記事は、実測・仮説・モックを区別する。仮画像や再生データを使う場合は明示する。
- 応募直前に、公式Rules全文（ライセンス、提出物、期限）を再確認する（T-007）。
## 追加：ローカルの判断評価（2026-10-19計画）

以下のCLI・データは実装済み。通常CIはfake・ケース検証のみ。実モデルは取得済み重みと明示した上限を使って別途実行する。
設計は[評価計画](model-evaluation-plan.md)、引数・出力は[CLI契約](contracts/model-evaluation.md)を正本とする。

前提：Python 3.12、workerの`uv sync --frozen`が完了、合成ケースと固定manifest、実モデル実験では指定revisionのhead／LoRA／tokenizer／ベース重みを含むローカルキャッシュが必要。キャッシュ不足時は取得せず終了する。依存準備のネットワーク利用と、実験中の通信0を区別する。

実装後、`apps/worker/`で次の順に検証する。

```bash
# モデル・AWSを呼ばず、dev／holdoutの型と分割を確認
uv run --frozen --offline python -m tools.evaluate_decisions validate --cases-dir evaluation/cases

# ルールの結果と集計を確認。新規の出力先を指定
uv run --frozen --offline python -m tools.evaluate_decisions run --backend rules --split dev --cases-dir evaluation/cases --out ../../report/model-evaluation/rules-dev

# ローカル実モデルの開発比較。cacheは実在する検証済みの場所へ置き換える
uv run --frozen --offline python -m tools.evaluate_decisions run --backend decider --paired-versions v1,v2 --split dev --cases-dir evaluation/cases --model-cache /absolute/path/to/model-cache --repeats 3 --max-calls 60 --max-seconds 1800 --out ../../report/model-evaluation/paired-dev
```

期待結果：`manifest.json`、`trials.jsonl`、`summary.json`、`failures.md`が新規runへ作られる。エラー・中断は非0終了し、未実行を残す。ルール／fakeの結果にモデル由来のconfidenceを作らない。予測へ正解ラベルを渡さない。

スモーク後にdevで候補を固定し、holdoutは30件×3反復×2版、最大180回で実行する。devと同じコマンドの`--split`を`holdout`、`--max-calls`を180、新しい`--out`へ変える。結果は同一データ・モデル・ガード条件で比較する。

追加回帰はworkerのpytest／Ruffと、影響した既存フローで行う。通常CIにはfakeとデータ検査のみを組み込み、実モデルを自動実行しない。固定評価の結果が採用条件を満たした場合だけ本番既定をv2へ変える。

**AWSへ進む前の条件：** 計画G1〜G4の実装・実モデル結果・採否・残課題を報告する。それ以前にBedrock比較、ECS起動、デプロイ、ECR登録、AWSデータの取得を行わない。これらは後続T124の検証とする。
