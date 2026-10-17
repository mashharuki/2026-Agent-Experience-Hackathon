# アーキテクチャ図

`photo-prep.drawio` をdraw.io Desktop / diagrams.netで開いて編集する。
ページ1は全体構成、ページ2はAI処理とデータ保護。ノード・矢印・テキストを編集できる。
公式SVGアイコンをファイル内に埋め込んでおり、表示時の外部通信は不要。

## 出力

```sh
python3 docs/architecture/diagrams/generate.py
drawio --export --format png --page-index 1 --scale 1.5 --border 20 --theme light --output docs/architecture/diagrams/system-overview.png docs/architecture/diagrams/photo-prep.drawio
drawio --export --format png --page-index 2 --scale 1.5 --border 20 --theme light --output docs/architecture/diagrams/decision-flow.png docs/architecture/diagrams/photo-prep.drawio
```

draw.io Desktop 31.1.8で書き出し確認。生成スクリプトは標準ライブラリだけを使用する。
GUIで編集した内容は生成スクリプトへ自動反映されないため、編集後はスクリプトを更新するか、
再生成せずdraw.ioファイルを正本として書き出す。

## AWS公式アイコン

出典：[AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)。
使用版：2026-07-31、取得日：2026-10-17。
[公式配布ZIP](https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip)
から使用サービスの64px SVGを抽出した。`aws-icons/` はAWS提供の図版であり、
このリポジトリ独自のコードライセンスを適用するものではない。
AWSの図版利用条件に従い、アーキテクチャ説明のために使用する。
