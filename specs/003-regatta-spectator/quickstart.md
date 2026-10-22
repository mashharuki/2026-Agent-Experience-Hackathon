# ローカルで予想・観戦する

2026-10-22。固定キャッシュの実Deciderと4艇レースをローカルで検証する段階。AWSとBedrockは未接続。

## 起動

リポジトリルートで実行する。JavaScriptは`pnpm install --frozen-lockfile`、既存workerの環境は`cd apps/worker`で`uv sync --frozen`を済ませる。
モデルは旧検証で作成済みの固定revisionキャッシュを再利用する。ない場合は自動ダウンロードせず起動失敗として知らせる。

```sh
apps/worker/.venv/bin/python apps/regatta-worker/local_server.py --device mps
```

Apple SiliconのローカルGPU用。CPUを比較する場合は`--device cpu`。キャッシュ検証と12件のウォームアップが終わってからreadyになる。
この速度はAWS Fargate CPUの性能証拠ではない。

別ターミナルで実行する。

```sh
pnpm --filter regatta-web dev
```

[観戦画面](http://127.0.0.1:5174/)で接続を確認し「Strands Decider 実モデル」を選ぶ。
4艇から予想を1艇選び出走。順位表の艇を選ぶと追従対象だけが変わる。予想は変更されない。
追従・艇上・俯瞰、画質、一時停止・再開・途中終了を使える。3分のシミュレーション時間が上限。
「ルールのプレビュー」はモデルを呼ばない画面検証用。画面とログに出所を明示する。

## 制限と記録

推論は全体同時1・各艇8秒以上・1レース96回、観測から適用まで3実秒。連続した失敗は中断し、勝者を捏造しない。
モデルの中断はクライアントのAbortだけでは保証できない。サーバー枠は実処理が終わるまで保持する。
プロセス全体はウォームアップも含め512推論まで。ベンチマークとレースを同時実行しない（busyで拒否される）。
記録は端末に書き出せ、再生でモデルを呼ばない。新レースは新しいseedと開始配置。seed・予想は戦術観測へ入れない。

## 検証

```sh
pnpm --filter sailing-sim test
pnpm --filter regatta-web test
apps/worker/.venv/bin/python -m pytest -q apps/regatta-worker/tests -c apps/regatta-worker/pyproject.toml
apps/worker/.venv/bin/ruff check apps/regatta-worker
apps/worker/.venv/bin/python apps/regatta-worker/benchmark.py --output docs/reviews/fleet-latency.json
```

ベンチマークは12件ウォームアップ＋100件まで。合成観測の遅延と有効出力の検証であり、ヨット戦術の正解率ではない。
ローカルトークンは`.local/regatta/token`（gitignore、0600）。Viteの開発用proxyがサーバー側だけで付加する。
起動は127.0.0.1限定、外部通信とAWSクライアント作成をモデル処理中に拒否。公開にこの認証を流用しない。
使い終わったら両ターミナルでCtrl+C。AWSの起動・課金はないが、ローカルのGPU/RAMを使用する。
