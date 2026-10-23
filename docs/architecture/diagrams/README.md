# アーキテクチャ図

## Snipe AI Regatta（2026-10-23にデプロイした構成）

`snipe-regatta.drawio` は2ページ構成で、文字は英語。既存のAWS公式SVGを埋め込み、ノードと矢印を編集できる。

- ページ1 `snipe-regatta-system.png`：`SnipeRegattaStack` のAWS構成（CloudFront＋S3、Cognito、HTTP API、VPC Link＋Cloud Map、Fargate上のDecider、Lambda＋Bedrock＋DynamoDB、ECR）
- ページ2 `snipe-regatta-decision.png`：1回の戦術判断（観測→コードによる候補の絞り込み→Decider→期限・状態の検査→操舵）と、破棄・記録・振り返り

正本はコード（[`apps/cdk/lib/regatta-stack.ts`](../../../apps/cdk/lib/regatta-stack.ts)、[`apps/regatta-web/src/fleet-runtime.ts`](../../../apps/regatta-web/src/fleet-runtime.ts)）。構成を変えたら、スクリプトの文言も合わせて直す。
2026-10-21時点の設計案（人間スキッパー対AI、SQS経由）の図は、この版で置き換えた（Gitの履歴に残る）。

```sh
python3 docs/architecture/diagrams/generate-regatta.py
cd docs/architecture/diagrams
drawio --export --format png --page-index 1 --scale 1.3 --border 20 --theme light --output snipe-regatta-system.png snipe-regatta.drawio
drawio --export --format png --page-index 2 --scale 1.3 --border 20 --theme light --output snipe-regatta-decision.png snipe-regatta.drawio
```

生成スクリプトは標準ライブラリだけを使用する。GUIで編集した内容は生成スクリプトへ自動反映されない。

旧写真支援アプリの図（`photo-prep*.drawio`、`system-overview*.png`、`decision-flow*.png`、`generate.py`）は
2026-10-23に削除した。Gitの履歴（コミット5cc9448まで）に残っている。

## AWS公式アイコン

出典：[AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)。
使用版：2026-07-31、取得日：2026-10-17。
[公式配布ZIP](https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip)
から使用サービスの64px SVGを抽出した。`aws-icons/` はAWS提供の図版であり、
このリポジトリ独自のコードライセンスを適用するものではない。
AWSの図版利用条件に従い、アーキテクチャ説明のために使用する。
