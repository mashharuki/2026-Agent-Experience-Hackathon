# アーキテクチャ図

## Snipe AI Regatta の初期設計図

`snipe-regatta.drawio` は2ページ（AWS構成／戦術判断と操船）。既存のAWS公式SVGを埋め込み、ノードと矢印を編集できる。
`snipe-regatta-system.png` と `snipe-regatta-decision.png` はプレビュー。

**注意：** これは2026-10-21時点の設計案（人間スキッパー対AI、SQS経由の非同期判断）の図で、デプロイした構成とは異なる。
実際にAWSへデプロイした構成（API Gateway → VPC Link → Fargate上のDecider、Lambda＋Bedrockの振り返り）は
[README](../../../README.md#architecture-on-aws) のMermaid図と [`apps/cdk/lib/regatta-stack.ts`](../../../apps/cdk/lib/regatta-stack.ts) を正とする。

```sh
python3 docs/architecture/diagrams/generate-regatta.py
drawio --export --format png --page-index 1 --scale 1.3 --border 20 --theme light --output docs/architecture/diagrams/snipe-regatta-system.png docs/architecture/diagrams/snipe-regatta.drawio
drawio --export --format png --page-index 2 --scale 1.3 --border 20 --theme light --output docs/architecture/diagrams/snipe-regatta-decision.png docs/architecture/diagrams/snipe-regatta.drawio
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
