# 比較・任意保存の実装結果

2026-10-19。対象はFR-030／031、T141〜T145。作業ツリーでのローカル検証記録であり、AWSへのデプロイやモデル品質の評価結果ではない。

## 変わった体験

- 初回の撮影プレビューと助言画面から、変更せずに写真を保存できる。
- 撮り直し時は、基準写真を半透明で重ねて位置を合わせられる。ガイドは任意で、撮影画素には含まれない。
- 比較は並置と一枚ずつの切替に対応。共通の枠に画像全体を表示し、前後のラベルを維持する。
- 「前の写真を保存」「後の写真を保存」で書き出す画像を明示する。表示中の写真や好みの回答から保存対象を決めない。「差が分からない」でも任意に保存できる。
- 保存はフィードバック送信の待機・失敗から独立し、終了を塞がない。ブラウザへの要求開始を「保存完了」と表示しない。
- 終了・画面破棄で撮影データの参照を解放。撮影処理やカメラ許可が後から完了しても、画像を復活させずストリームを停止する。
- 日英の案内を更新し、自分で保存したファイルは終了後も端末に残ると説明する。

## 実装の境界

既存React／MUI／Blob URLを使用し、依存パッケージは追加していない。OpenAPI、生成クライアント、AWSの写真保持、モデル入力・ガードを変更していない。保存・ガイド・比較切替によるAPI呼び出しの追加はない。

`PhotoDownloads`と`downloadPhoto`は現在の写真を参照して明示的なファイル書き出しだけを行う。ファイル名にID・希望文を含めない。ライブ映像とガイドは同じ左右反転・contain表示、比較と保存は非反転。撮影の既存JPEG縮小処理は維持し、元のセンサー解像度を保証しない。

初回解析の`offer_finish`は既存どおり終了する。終了後の画像復元は行わず、無変更で保存する操作は解析前のプレビューか、終了前の助言画面で行う。もう一手へ進む際は現在の後の写真を基準へ昇格し、古い基準だけを解放する。

## 検証結果

| 検査 | 結果 |
| --- | --- |
| フロント全Vitest | 21ファイル・144テスト成功 |
| TypeScript／Vite build | 成功。500 kB超のチャンクに関する警告あり |
| Playwright Chromium | スマホ相当390×844、5シナリオ成功 |
| OpenAPI／Connexion | 既存8操作の検証成功。Starletteの非推奨警告あり |
| Biome | 終了コード0。既存PWAファイルの警告2件 |
| Oxlint | 終了コード0。既存AuthProviderテストとi18nの警告2件 |
| Knip | 成功。既存CDK entryの冗長設定ヒント1件 |
| jscpd | 成功。全体の重複行4.09%、閾値5%以内 |
| `git diff --check` | 成功 |

追加した試験は保存対象・要求失敗後の再操作、好み／表示／保存の独立、通信待機・失敗中の操作、撮影中終了・再開始・破棄、カメラ許可の遅延完了、URL解放、追加API通信なしを扱う。既存の日本語・英語フローも回帰対象。

実ブラウザでは青い合成映像を基準、赤い合成映像を撮り直しに使用。ガイドを表示して撮影したJPEGの画素を確認し、ガイドが混入しないことを検証した。前後のダウンロードファイルを読み、各元Blobとバイト列が一致することも確認した。実カメラ・個人の顔写真・Bedrockは使用していない。

画面確認資料（合成画像、ローカル出力）：[並置](../../apps/frontend/test-results/photo-completion-side.png)、[一枚表示](../../apps/frontend/test-results/photo-completion-single.png)。390px幅の表示で欠けや横方向のはみ出しがないことを目視確認した。

## 実行方法と環境上の補足

インストール済みのNode.js v24.20.0、Vitest 5.0.5、Vite 8.3.4を使用。pnpmランチャーは指定10.32.1の取得時にレジストリへ接続できず署名検証で停止したため、依存やロックファイルを変更せず、既存`node_modules/.bin`を直接実行した。pnpm自体の署名検証は迂回していない。

```bash
# apps/frontend/
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -b && ./node_modules/.bin/vite build
./node_modules/.bin/oxlint
./node_modules/.bin/playwright test --config=test-results/local.config.ts

# apps/api/
.venv/bin/python scripts/check_spec.py ../../packages/api-spec/openapi.yaml

# リポジトリルート
node_modules/.bin/biome check .
node_modules/.bin/knip
node_modules/.bin/jscpd --config .jscpd.json apps packages
git diff --check
```

Playwrightの一時設定は元の`playwright.config.ts`を読み、Vite起動だけをインストール済みバイナリへ置き換えた。`testDir`は既存`e2e/`、出力先は`/private/tmp/photoprep-photo-completion-e2e`。ローカルサーバーのbindはsandbox内でEPERMとなったため、同じ合成画像テストを承認された実行環境で実行した。通常環境での正規コマンドは引き続き`pnpm --filter frontend test:e2e`。

## 次工程へ残す確認

- T125〜T140：評価ハーネス・固定ケースの実装とローカル実Decider比較。今回のテスト成功からモデル品質や改善効果は推定しない。
- T124：上記の結果確認後、新API・認可・終了・削除等のAWS検証。今回はAWS操作なし。
- iOS Safari／Android Chromeでの撮影、向き変更、ダウンロード先・保存操作。Chromium自動試験からOSの写真アプリへの保存完了は保証しない。
- 実際の利用者が位置を揃えられるか、納得して一枚を選べるかの確認。今回は操作の実装・回帰検証までで、需要やCFP採択の証明ではない。
