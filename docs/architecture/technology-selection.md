# 技術選定：フロントエンドとPython API

2026-10-17。AWSサービスの構成は承認済み。以下は追加要望と実装方式の推奨案を区別した記録。
依存関係の導入、API実装、AWSへのデプロイはまだ行っていない。
技術・状態の一覧とSpec Kitへの引継ぎは[技術スタック一覧](../tech-stack.md)を参照する。

## 決定事項と推奨案

| 項目 | 方針 | 状態 |
| --- | --- | --- |
| モデルの課金 | AWSクレジットが適用されるAWS課金経路を使う | 要件確定。イベントクレジットの対象製品は未確認 |
| 画像理解・説明 | BedrockのAmazon Nova Liteを維持 | クレジット適用確認と品質評価が条件 |
| フロント | React / TypeScript、VoidZero、TanStack Query、Material UI、React Bits | ユーザー指定。React Bitsの公開条件を確認する |
| VoidZeroの具体化 | Vite+を統合ツール候補にする。pnpmは維持 | 推奨案。既存Vite/OxlintもVoidZero製ツール |
| API契約 | `packages/api-spec/openapi.yaml` を正本にする | ユーザー決定。ファイルは機能仕様確定時に作成 |
| サーバー | Python 3.12＋Connexion 3のFlaskApp＋boto3 | 推奨案。YAMLからルート・検証を構成 |
| クライアント生成 | Orval → TypeScriptの型・TanStack Query hooks | 推奨案 |
| Lambda接続 | ConnexionのASGIアプリをMangumで包む | 推奨案。HTTP API v2イベントの結合検証が必要 |
| ワーカー | Python / uv / Docker / Fargate | 既存構成を維持。Webフレームワークは不要 |

## フロントエンドの役割

- **Material UI＋Emotion**：ボタン、入力、ダイアログ、進行表示とテーマを担当する。
  React 19は公式のpeer dependency範囲に含まれる。使うコンポーネントだけを導入する。
- **React Bits**：導入画面や完了時の演出。TypeScript＋CSS版を選び、Tailwindを追加必須にしない。
  撮影中の重い背景描画を避け、`prefers-reduced-motion` とキーボード操作を確認する。
- **TanStack Query**：ジョブ状態とAPI結果を管理する。写真Blob・カメラ状態はブラウザメモリに保持し、
  query cacheの永続化対象にしない。ログアウト時は利用者単位のキャッシュを破棄する。
  GETのポーリングは既存設計の2→3→5秒・最大60秒を維持。解析POSTはmutationにし、
  自動再試行を無効にする。明示的な再送でも同じIdempotency-Keyを使用する。
- **VoidZero**：会社・ツール群の名称であり、UIライブラリではない。
  Vite+はVite、Vitest、Oxlint、Oxfmt等を統合する。現在のVite/Oxlintから移行する場合は、
  Biomeとの同一ファイルの二重整形を解消し、TurboとVite Taskのどちらがタスクを実行するかを一つに決める。
  既存pnpm/workspaceは活かし、移行前後のbuild・型検査・生成物差分を比較する。

根拠：[Vite+](https://voidzero.dev/posts/announcing-vite-plus-1-0)、
[MUI](https://mui.com/material-ui/getting-started/installation/)、
[React Bits](https://reactbits.dev/get-started/introduction)、
[TanStack Queryの既定動作](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)。

### React Bitsと公開ライセンス

確認した現行ライセンスはMIT単独ではなく **MIT＋Commons Clause** で、部品自体の再配布等に制限がある。
アプリへの組込みは認められているが、ハッカソンのOSIライセンス要件との整合を確認してからソースを取り込む。
自作コードのライセンスを適用して第三者コードを再ライセンスしない。採用する版・部品の著作権表示と条件を残す。
提出条件に適合できない場合は、MUIと独自CSSの演出を代替案とする。
根拠：[React Bitsのライセンス](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md)、
[公式ハッカソン規約](https://builder.aws.com/build/hackathons/4f50957c-1d08-37ab-b11c-97516b9adeb4/agent-experience-hackathon-strands-decider?tab=rules)。

## FlaskとFastAPIの比較

PythonはDeciderワーカーと知識・業務ロジックを共有しやすく、今回の選択として妥当。
Flask単体では、OpenAPIからのルーティングや入出力検証を別途構成する必要がある。

| 選択肢 | 得意な開発方法 | 今回の判断 |
| --- | --- | --- |
| Flask単体 | 小さなHTTPハンドラを自由に書く | YAMLを正本にする仕組みが不足する |
| **Connexion 3＋Flask** | YAMLのoperationIdをPython関数に結び、入出力を検証する | **今回の推奨**。API契約から実装へ進められる |
| FastAPI＋Pydantic | Pythonの型とルートから検証・OpenAPIを作る | Python正本なら有力。YAML正本では追加の生成・差分管理が必要 |
| Connexion AsyncApp | Flaskに依存せずYAMLからASGI APIを構成する | Flask拡張が不要なら代替候補。初版で両方式を混在させない |

推薦理由は速度比較ではなく、**YAMLからAPIを定義したいという要件への適合**。
Flaskに習熟していることは前提にしない。まず「YAMLにエンドポイントを書く→Python関数を書く→
不正な入力を拒否できることを確認する」の一巡で習得する。
初版は同期のハンドラとboto3を基本にし、重い推論は既存のSQSワーカーへ渡す。

根拠：[Connexion](https://connexion.readthedocs.io/en/stable/)、
[FastAPIの入力モデル](https://fastapi.tiangolo.com/tutorial/body/)。

## YAMLからの自動化

```text
packages/api-spec/openapi.yaml（人が編集する唯一のAPI契約）
  ├─ Connexion → operationIdによるルーティング・入力/出力検証
  ├─ Orval     → TypeScript型・HTTPクライアント・TanStack Query hooks
  └─ Swagger UI / 契約テスト
Pythonの業務関数 → 所有権・利用枠・ジョブ状態・AWS SDK操作
```

ここでいうサーバー側の自動化は、**ConnexionがYAMLを読んで検証ミドルウェアを構成すること**。
ミドルウェアのPythonソースファイルや業務ロジックを生成するものではない。
クライアントは実際にコード生成する。生成物は編集せず、手書きの認証付きHTTP処理を別ファイルから注入する。

Connexionの確認した実装はOpenAPI 3.0用スキーマを使うため、初版は **OpenAPI 3.0.3** を提案する。
これは前の設計書にあった3.1からの変更。3.1専用のJSON Schema構文を混在させない。
入力検証に加え `validate_responses=True` を明示する。`strict_validation=True` は
未定義パラメータ向けであり、JSON本文の未知フィールドは `additionalProperties: false` 等で定義する。

CIではYAMLのlint、Connexionへの読込み、Orval再生成後の差分、契約テストを確認する。
operationId、HTTP status、必須項目、エラー形式、認証schemeを契約に含める。
型が合っていても認可は保証されないため、Cognitoのsubと保存データの所有者を業務処理で必ず照合する。

根拠：[Connexionの仕様読込み](https://github.com/spec-first/connexion/blob/main/connexion/spec.py)、
[検証設定](https://connexion.readthedocs.io/en/stable/validation.html)、
[OrvalのReact Query生成](https://orval.dev/docs/guides/react-query/)。

## DockerとLambdaの使い分け

- **AIワーカー**：Dockerが必要。Python、PyTorch、Decider重みを固定してFargateへ配布する。
  SQSを取得するプロセスなのでFlaskサーバーは起動しない。
- **API**：Lambdaを維持。まず軽量ZIP配布＋Mangumを提案し、Dockerは依存のLinux向けビルドや
  ローカル開発に必要な範囲で使う。APIまでFargate常駐にする必要はない。
- Connexion 3はFlaskAppでも外側がASGI。MangumにはConnexionアプリ全体を渡し、
  内側のFlaskアプリだけを公開してYAMLの検証を迂回しない。
- APIイメージやZIPへDecider/PyTorchを混ぜない。APIとワーカーの依存・権限を分離する。
  uvのlockfile、pytest、RuffをPython側の再現性・品質管理に使う案とする。

MangumはASGIとHTTP APIを接続できるが、この組合せの動作確認は未実施。
実装開始時にAPI Gateway v2イベント、JWT claimsの引渡し、異常本文、応答検証、
CORS、バイナリを含まない202応答を一つの小さなAPIで確認する。
ローカル起動ではテスト認証を明示し、任意のHTTPヘッダーを認証済みユーザー情報として信用しない。
API公開経路はJWT authorizerのあるGatewayに限定する。

根拠：[Connexion 3の実行方式](https://connexion.readthedocs.io/en/stable/v3.html)、
[Mangum](https://mangum.fastapiexpert.com/)。
