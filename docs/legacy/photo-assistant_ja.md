# 旧版：撮る前のひと手間（写真支援アプリ）

> 最初の企画のREADMEを、証拠とあわせて保存したもの。現在の企画は[Snipe AI Regatta](../../README_ja.md)。AWS環境は2026-10-21に削除済み。

<p align="center"><img src="../../docs/brand/logo-lockup.svg" alt="撮る前のひと手間" width="520"></p>

[English → README.md](photo-assistant.md)

[AWS Agent Experience Hackathon: Strands Decider](https://builder.aws.com/build/hackathons/4f50957c-1d08-37ab-b11c-97516b9adeb4/agent-experience-hackathon-strands-decider) への応募プロジェクトです。

**Tags: `#strands-decider-2b` `#tool-selection`** · License: [MIT](../../LICENSE)（OSI承認） · [第三者ライセンス](../../docs/THIRD_PARTY_NOTICES.md)

## 概要

証明写真やプロフィール写真を撮る前に、眉か前髪の**どちらか一つ**を整えて試し、もう一度撮影して、前後を見比べて
**本人が選ぶ**アプリです。見た目の採点はしません。提案は一度に一つだけで、いつでも終えられます。

だれが何を決めるかが、このアプリの要点です。

- **Strands Decider 2B** が、*次にどの支援を使うか*を選びます（身支度の一手、撮影条件のコツ、本人への確認、
  終了の提案）。
- **Amazon Bedrock（Nova Lite）** が、写真を観察し、必要なときだけ説明文を書きます。
- **通常のコード（ガード）** が、モデルが何を言っても必ず守るべきことを守ります。本人の明示的な禁止、
  変更は最大2回まで、本人が終えると言ったら終える、の三つです。

この判断の構造は、再利用できるパターンとして取り出してあります（[判断パターン](#判断パターンtool-selection)）。

## 機能

- **四つの画面**：相談する（見る範囲・任意の希望・同意）→ 試し撮り → 一つ試す → 比べて選ぶ。
- **提案は一度に一つ**。1回の相談で、変更は最大**2回**、解析は最大**3回**です。どの画面からでも、いつでも終えられます。
- **禁止事項は撮影前の選択肢で確定**します。選択した値をコードのガードへ渡します（例：「眉には触れたくない」）。自由な希望文だけでは構造化された禁止として確定しません。
- **確認質問に回答できます**。有効な観察が対象を覆う場合は写真を再送せずに判断へ進みます。回答後の判断も最大3解析の枠に含みます。
- **見えないものは断定しません**。逆光・暗さ・顔が枠から外れている・前の写真と比べられない場合は、撮影のコツを一つ示すか、
  撮り直しを案内します。自信ありげな断定はしません。
- **画像の扱いを設計に組み込みました**。写真は同意したあとにだけクラウドへ送られ、処理が終わるとすぐ削除されます
  （終了時にも削除を要求し、失敗時は定期回収）。確認用の観察メモは最大10分だけ利用し、回答完了・終了・期限回収で削除します。比較用の写真は、この端末のブラウザのメモリにだけ残ります。ログには、写真も本人の言葉も入れず、
  IDと選択肢の名前だけを残します。
- **日本語と英語**の画面・助言に対応し、いつでも切り替えられます（助言文も選んだ言語で返ります）。
- **PWA**：ホーム画面に追加できます。サービスワーカーがキャッシュするのは画面を構成する静的ファイルだけで、
  API・S3・Cognito・サインインの戻り・写真には触れません。
- **メール確認付きの新規登録・ログイン**：Amazon Cognito（Authorization Code + PKCE）。
- **費用の制御**：ワーカーは起動したときだけ動き、0台に戻ります。利用枠（一人あたり・全体の1日あたり）もアプリで制限します。
  受付していないときは失敗にせず、停止中・準備中を「受付」画面で知らせます。

## アーキテクチャ

![システム全体図](../../docs/architecture/diagrams/system-overview.png)

> 英語版は [`system-overview.en.png`](../../docs/architecture/diagrams/system-overview.en.png) です。編集できる元ファイルは
> [`photo-prep.drawio`](../../docs/architecture/diagrams/photo-prep.drawio)（日本語）と
> [`photo-prep.en.drawio`](../../docs/architecture/diagrams/photo-prep.en.drawio)（英語）で、どちらも2ページ・AWS公式アイコン入りです。

| 構成要素 | 役割 |
| --- | --- |
| **SPA**（S3 + CloudFront、OAC） | 非公開バケットからReactアプリを配信。ブラウザで撮影します。 |
| **Amazon Cognito** | メール確認付きセルフ登録・ログイン。Authorization Code + PKCE、公開クライアント。 |
| **API Gateway HTTP API + Lambda** | JWT検証のあと、コードで所有権を確認。OpenAPIから構成したPython（Connexion + Mangum）。受付は202で返し、結果はあとで取得します。 |
| **S3（画像）** | 一時画像用の非公開バケット。ブラウザが署名付きPOSTで直接送るので、写真はAPIを通りません。 |
| **DynamoDB** | セッション・ジョブ・結果・利用枠・受付状態。画像は入れません。 |
| **SQS（+ DLQ）** | ワーカーへジョブIDだけを渡します。 |
| **ECS on Fargate ワーカー** | Python（4 vCPU / 16 GB、同時処理1件）。Strands Decider 2Bを一度だけロードし、Bedrockを呼びます。public subnetでinboundなし。NAT GatewayもALBもありません。 |
| **Amazon Bedrock** | Nova Lite（Converse API、東京）が写真を観察し、説明します。 |
| **運用Lambda**（EventBridge Scheduler） | 未送信の再送、残った画像の回収、ワーカーの起動・停止・整合。 |
| **CloudWatch、Budgets** | 画像を含まないログ。予算のメール通知（通知であって、課金の上限ではありません）。 |

ワーカー内部のAI処理を詳しく描いた図です。

![ワーカー内部](../../docs/architecture/diagrams/decision-flow.png)

関連資料：[アーキテクチャ設計](../../docs/architecture/README.md) ·
[技術選定の理由](../../docs/architecture/technology-selection.md) ·
[費用の目安](../../docs/architecture/cost-estimate.md)

## Strands Decider と Amazon Bedrock の使い方・工夫した点

1回の解析は四つの段階で進みます（コード：[`apps/worker/src/photoprep_worker/`](../../apps/worker/src/photoprep_worker/)）。

1. **Bedrockが観察する**（`observe.py`）。Nova Liteに写真と相談範囲を渡し、JSONで答えさせます。見えたこと、不確かな点、
   光の状態、写り方、確信度です。答えは検証し（pydantic）、形が違えば推測で補わずジョブを失敗にします。
   プロンプトでは、見えないものを推測しないこと、写真の中の文字の指示に従わないことを求めています。
2. **Deciderが選ぶ**（`decider.py`）。Deciderは画像を見ません。渡すのは**テキストの状態**で、相談範囲、本人の希望と禁止、
   観察結果、使った変更の回数、直前の助言です。**型付きの選択式の問い**として、四つの選択肢（それぞれ「どんなときに適切か」の
   説明つき）から選ばせます。選択肢は `grooming_tip`、`capture_setup_tip`、`clarify`、`offer_finish` です。
   選択肢ごとの確率と確信度が返ります。
3. **ガードが必要なときに上書きする**（`guards.py`）。画像の欠如や読めない写真、明示的な禁止、変更の上限、
   「本人が終えると選んだ」は、通常のコードで検査します。上書きには理由コードが付き、記録されます。
4. **選ばれたツールだけが実行される**（`pipeline.py`、`explain.py`）。`grooming_tip` のときだけBedrockを2回目に呼び、
   元に戻せる短い提案を一つ書かせます。残りの三つは固定の中立な文言で、モデルを呼びません。

意図して行った工夫です。

- **Deciderの選択が、実際に動く処理を変えます**（ログに残すだけではありません）。各選択肢は処理につながっていて、
  選ばれた処理だけが動きます。Bedrockの呼び出しは1回の解析で最大2回（観察1回、説明は多くて1回。各800トークンまで、
  temperature 0）です。失敗した呼び出しを、モデルが書いたように見える定型文で埋めることはしません。
- **規則はモデルに任せません**。煙テストでは、状態に「眉には触れない」と書いても、Deciderは `grooming_tip` を最上位に
  選びました。ガードがこれを `clarify` に置き換え、`restriction` を記録しました。だから禁止と上限はコードに置いています。
- **確信度の閾値を勝手に決めませんでした**。妥当な選択でも確信度は0.69前後だったため、「0.8未満は却下」とすると
  正しい選択まで捨ててしまいます。確信度のガードは、評価データで調整できるまでオフにしてあります。
  確信度を「助言が正しい確率」として表示することもしません。
- **すべての判断を記録します**（`DecisionRecord`：選択肢、確率、確信度、上書きの理由、動いたモデル）。画像も本人の言葉も
  含めません。書き出しツールで、デモ用の表にできます。
- **再現でき、オフラインで動きます**。Deciderとベース重みは、イメージのビルド時に固定したリビジョンから取得します
  （Hub側が動いていればビルドが失敗します）。実行時にはダウンロードしません。
- **利用者に見せる範囲は小さく、正直に**：提案は一つ、点数なし、比較は本人が判断します。

### 判断パターン（`#tool-selection`）

「型付きの問い → Deciderの選択 → ガード → 選ばれたツールだけを実行」を、単独のパッケージにしています。説明と使い方は
[docs/decision-pattern.md](../../docs/decision-pattern.md)、コードは
[`apps/worker/src/photoprep_worker/decision_pattern/`](../../apps/worker/src/photoprep_worker/decision_pattern/) です
（このディレクトリを他のアプリへコピーして使えます。他の部分に依存しないことをテストで確認しています）。動かせる例：

```sh
cd apps/worker && PYTHONPATH=src uv run python -m photoprep_worker.decision_pattern.example
```

## 技術スタック

各選択の状態を含む全体の表は [docs/tech-stack.md](../../docs/tech-stack.md) にあります。

| 領域 | 技術 |
| --- | --- |
| フロントエンド | React 19、TypeScript、Vite 8、Material UI、TanStack Query、自作のi18n（日英）、PWA（マニフェスト + サービスワーカー） |
| API契約 | OpenAPI 3.0.3のYAMLを正本とする（[`packages/api-spec`](../../packages/api-spec/openapi.yaml)）。OrvalでTypeScriptのクライアントを生成 |
| API | Python 3.12、Connexion 3 + Flask、AWS LambdaのMangum、boto3 |
| ワーカー | Python 3.12、PyTorch（CPU）、Strands Decider 2B、pydantic、Pillow。Dockerイメージを Amazon ECR に置く |
| AI | Strands Decider 2B（`StrandsAgents/strands-decider-2B-qwen3.5-v1-2610`）、Amazon Bedrock Nova Lite（`amazon.nova-lite-v1:0`） |
| AWS | CloudFront、S3、Cognito、API Gateway（HTTP API）、Lambda、DynamoDB、SQS、ECS on Fargate、ECR、EventBridge Scheduler、CloudWatch、Budgets（東京 `ap-northeast-1`） |
| IaC | AWS CDK v2（TypeScript）+ cdk-nag |
| 開発ツール | pnpm workspaces、uv、Biome、Oxlint、Knip、jscpd、GitHub Spec Kit |
| テスト | pytest + moto（API・ワーカー）、Vitest + Testing Library（フロント）、Jest + CDK assertions（インフラ） |

## 動かし方

### ローカルで動かす（AWSは不要）

フロントエンドには**モックAPI**が入っています（画面に、モックであることを示すバナーが出ます）。写真はブラウザから出ず、
助言は固定の再生データで、実際の解析ではありません。

```sh
pnpm install
pnpm --filter frontend dev
```

表示されたアドレスを開いてください。バナーから、状況（通常・逆光・あいまい・失敗）と受付の状態を切り替えられます。
テストの実行（どれもAWSにはつながりません）：

```sh
pnpm --filter frontend test
(cd apps/api && uv sync && uv run pytest)
(cd apps/worker && uv sync && uv run pytest)
pnpm --filter cdk test
```

### AWSへデプロイする

用意するもの：Node.jsとpnpm 10.32.1、[uv](https://docs.astral.sh/uv/)、Docker、デプロイ権限のあるアカウントにサインインした
AWS CLI、東京でのAmazon Bedrock（Nova Lite）の利用、`ap-northeast-1` での初回のみの `cdk bootstrap`。
**認証情報や個人の顔写真は、決してコミットしないでください。**

費用：Fargateのワーカーは、動いている間（待機中も）課金されます（約$0.30/時）。ほかはこの規模では少額です。
[費用の目安](../../docs/architecture/cost-estimate.md)を見てください。予算はメールを送るだけで、支出を止めません。

`cdk` コマンドは**一つずつ**実行してください。同時に動かすと `cdk.out` が衝突します。

```sh
pnpm install
pnpm build:lambda                       # APIの配布物（コード + Linux用の依存 + OpenAPIファイル）
```

最初のデプロイ（ワーカーのサービスは0台で始まるので、計算の課金はまだありません）：

```sh
cd apps/cdk && pnpm exec cdk deploy -c photoprep:alertEmail=you@example.com
```

ワーカーのイメージをビルドしてpushします（モデルの重みを含めて約5〜6 GB。リポジトリは書き換え不可なので、毎回新しいタグにします）：

```sh
docker build --platform linux/amd64 -f apps/worker/Dockerfile -t photoprep-worker:v1 .
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin <アカウントID>.dkr.ecr.ap-northeast-1.amazonaws.com
docker tag photoprep-worker:v1 <WorkerRepositoryUri>:v1
docker push <WorkerRepositoryUri>:v1
```

イメージのタグを指定して再デプロイし（デプロイは動いているワーカーを止めます。動かし続けるなら
`-c photoprep:workerDesiredCount=1` を足します）、フロントエンドを公開します。利用者は新規登録画面で登録し、メールを確認します：

```sh
cd apps/cdk && pnpm exec cdk deploy -c photoprep:alertEmail=you@example.com -c photoprep:workerImageTag=v1
pnpm --filter frontend run publish:plan     # アップロードする内容を表示するだけ
pnpm --filter frontend run publish:apply
```

スタックの出力にある `SpaUrl` を開き、「新規登録」からメールアドレスとパスワード（12文字以上・英大文字／小文字／数字／記号）を登録し、メールの確認コードを入力してください。既存の利用者は「ログイン」から進めます。

### ワーカーの起動と停止

**ワーカーを起動するまで、サービスは受付を閉じています**（画面に理由が出ます）。起動には数分かかります（イメージ取得とモデル読込み）。
モデルの準備ができると、受付は自動で開きます。

```sh
aws lambda invoke --function-name <WorkerControlFunction> --region ap-northeast-1 --payload '{"action":"start"}' --cli-binary-format raw-in-base64-out /dev/stdout
aws lambda invoke --function-name <WorkerControlFunction> --region ap-northeast-1 --payload '{"action":"stop"}'  --cli-binary-format raw-in-base64-out /dev/stdout
```

毎晩3時（日本時間）の停止と、5分ごとの整合処理でも、ワーカーは0台に戻ります。詳細は
[docs/operations.md](../../docs/operations.md)（英語）にあります。

### すべて削除する

1. ワーカーを停止します（上のコマンド）。
2. 残したいものを書き出します（例：`apps/worker/tools/export_decisions.py`）。
3. ユーザープールとテーブルは、**既定では残る**設定です。`destroyData=true` で一度デプロイしてから削除します
   （Cognitoのユーザーと保存データが完全に消えます）：

```sh
cd apps/cdk && pnpm exec cdk deploy -c photoprep:alertEmail=you@example.com -c photoprep:workerImageTag=v1 -c photoprep:destroyData=true
cd apps/cdk && pnpm exec cdk destroy -c photoprep:destroyData=true
```

4. 何も残っていないこと、その間に別の `cdk` コマンドが動いていないこと（スタックが作り直されることがあります）を確認します：

```sh
aws cloudformation describe-stacks --stack-name PhotoPrepStack --region ap-northeast-1
```

5. 残りを片付けます。ECRのイメージ、ロググループ、CDKを今後使わないならブートストラップのスタック。そのあと請求画面で、
   残っている課金（ECRの保管、public IPv4アドレスなど）を確認します。

## 状態

日付つきの記録です（ローカル修正検証：2026-10-19、AWS実測：2026-10-17）。詳細は [`specs/001-pre-photo-grooming-assist/`](../../specs/001-pre-photo-grooming-assist/)
（仕様・計画・調査・タスク）にあります。

| 項目 | 状態 |
| --- | --- |
| コード | API・ワーカー・フロント・インフラを、テスト先行で実装。ローカル検証：API 378件、ワーカー177件、フロント136件、CDK 51件、モックのブラウザE2E 3件。任意実行の3件はスキップ。[検証記録](../../docs/reviews/2026-10-19-remediation-validation.md)を参照。今回差分はAWSへ未反映 |
| AWSへのデプロイ | **検証のために一度実施**（東京）。ログイン、受付、写真のアップロード、実際の解析（Nova Lite + Fargate上のDecider）、助言の表示まで、日本語と英語で通りました。比較して終えるところは、AWS上ではまだ通していません。検証後に環境を削除するため、公開URLはありません |
| AWSでの実測 | 1回の解析は、受付から結果取得まで約9秒（1回だけ、起動直後のワーカー）。ワーカーは起動から124秒で準備完了。**未測定**：Fargateでの Decider のピークメモリと遅延、成功経路以外の画像削除、助言の品質（どちらの言語も） |
| AWSで初めて見つかった不具合 | 4件、すべてテストを足して修正済み：サインイン直後のトークンの競合、Lambdaのimportエラー、ワーカーが受付開始を呼んでいなかったこと、S3のアップロード用フォームが全体共通のエンドポイント向けだったこと |
| デモ動画・記事 | 下書きのみ（[記事](https://github.com/mashharuki/2026-Agent-Experience-Hackathon/blob/5c070a9/docs/article/draft.md)、[台本](../../docs/demo-script.md)）。`[MEASURE]`/`[TODO]` が残っており、公開していません |
| 未実施 | 今回差分のAWS確認、実写真が要る「禁止・不確かな観察・上限」の検証の一部。KnipとモックのPlaywrightは成功。新しいCIのGitHub上での実行は未確認 |

## リポジトリの構成

```text
apps/frontend/             Reactアプリ（画面、i18n、PWA、モックAPI、公開スクリプト）
apps/api/                  Lambda用のPython API（Connexion）と運用Lambda
apps/worker/               Python製のAIワーカー、Dockerfile、再利用できる decision_pattern パッケージ
apps/cdk/                  CDKのスタックとConstruct（テストつき）
packages/api-spec/         openapi.yaml（契約の正本）
packages/photoprep-common/ APIとワーカーで共有する状態規則、DynamoDBのStore、ログの許可リスト
docs/                      設計と図、技術スタック、運用、記事・デモの下書き
docs/brand/               ロゴと背景画像（SVG）
specs/                     この機能のSpec Kit成果物（仕様・計画・調査・タスク）
```

リポジトリを公開する前に：`sh scripts/check-publishable.sh`

## 開発の進め方

GitHub Spec Kit（Specify CLI 1.0.3）と、[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) の憲章に沿って進めます。
`specify` → `clarify` → `plan` → `tasks` → `implement` の順で、テストを先に書きます。OpenAPIのYAMLを先に変更し、
クライアントを再生成します（`pnpm --filter frontend api:generate`）。生成物は手で編集しません。計画の前に
[docs/tech-stack.md](../../docs/tech-stack.md) を読み、採用済みの選択・推奨・未検証の仮定を区別してください。

## ブランド素材

ロゴと背景画像は [`docs/brand/`](../../docs/brand/) にあるSVGファイルで、コードと同じ[MITライセンス](../../LICENSE)です。
マークは、ビューファインダー（これから撮る写真）、眉一本（整える一つのこと）、黄色い小さな点（ひと手間）を表しています。

| ファイル | 用途 |
|---|---|
| [`logo-mark.svg`](../../docs/brand/logo-mark.svg) | アイコンのみ |
| [`logo-lockup.svg`](../../docs/brand/logo-lockup.svg) | アイコンと名前の横組み（ライト／ダーク対応） |
| [`background-landscape.svg`](../../docs/brand/background-landscape.svg)・[ダーク](../../docs/brand/background-landscape-dark.svg) | 1920×1080。スライドや動画向け |
| [`background-portrait.svg`](../../docs/brand/background-portrait.svg)・[ダーク](../../docs/brand/background-portrait-dark.svg) | 1080×1920。スマホ画面向け |
| [`title-card.png`](../../docs/brand/title-card.png)・[`end-card.png`](../../docs/brand/end-card.png)（SVGと`-dark`版もあり） | 1920×1080。動画のタイトル・終了カード。`python3 docs/brand/make-cards.py` で再生成 |

<p>
  <img src="../../docs/brand/logo-mark.svg" alt="ロゴマーク" width="120">
  <img src="../../docs/brand/background-landscape.svg" alt="横長の背景" width="360">
  <img src="../../docs/brand/background-portrait.svg" alt="縦長の背景" width="120">
</p>

横組みロゴの文字は端末のフォント（Noto Sans JP、ヒラギノ、游ゴシック）に依存します。最終的な成果物に使うときは、
文字をアウトライン化してください。アプリ自身のfaviconとPWAアイコンはまだ差し替えていません。

## ライセンス

[MIT](../../LICENSE)。AWSのアーキテクチャアイコンはAWSの図版で、構成の説明のために使っています
（[表記](../../docs/architecture/diagrams/README.md)）。その他の第三者の表記は [docs/THIRD_PARTY_NOTICES.md](../../docs/THIRD_PARTY_NOTICES.md) にあります。
