# 費用の目安

2026-10-17確認。東京、Linux/x86_64、オンデマンド、USD・税別。
無料枠・クレジット・Spot割引を計算に入れない。AWSリソースはまだ作成していない。

## AWSクレジットの扱い

モデルはAWS課金となる **Amazon Bedrock経由のAmazon Nova Lite** を第一候補にする。
クレジットの対象サービスを確認できるまでは、現金負担ゼロとは扱わない。
イベント配布クレジットには個別の対象条件があるため、Activate向けの適用案内を流用しない。

Billing and Cost Management → Credits → 対象クレジットで、Applicable products、
有効期限、残高、状態を確認する。Bedrockの対象製品に加えて、ワーカーのFargate等も確認する。
適格な料金にはAWSが自動適用する。APIリクエストでクレジット払いを指定するものではない。
根拠：[AWSのクレジット適用説明](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-credits.html)、
[プロモーションクレジット条件](https://aws.amazon.com/awscredits/)。

管理する数字は「割引前の利用額」「実際の適用額」「適用後の請求額」を分ける。
税・対象外料金・期限切れ・残高不足は相殺されないため、以下の総利用額の制限を維持する。
Decider自体はFargate上で実行し、Bedrockのトークン料金ではなく計算資源の料金が発生する。

## 確認できた単価

| 項目 | 単価 | 根拠 |
| --- | ---: | --- |
| Fargate vCPU | $0.05056 / vCPU時 | [AWS Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json) |
| Fargateメモリ | $0.00553 / GB時 | 同上 |
| public IPv4 | $0.005 / IP時 | [VPC料金](https://aws.amazon.com/vpc/pricing/) |
| Nova Lite入力 | $0.000072 / 1,000 tokens | [AWS Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json) |
| Nova Lite出力 | $0.000288 / 1,000 tokens | 同上 |

取得したSKUと価格の抜粋を [pricing-snapshot.json](pricing-snapshot.json) に保存した。
モデル提供状況は [Nova Liteモデルカード](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html) を参照。
実行時のtoken数は画像を含む実測usageで置き換える。

## ワーカーの稼働時間による差

4 vCPU / 16 GB / 1 IPの場合：

`4 × 0.05056 + 16 × 0.00553 + 0.005 = $0.29572 / 時間`

| 稼働時間 | ワーカー＋IPv4のみ | 説明用の換算：1 USD＝150円と仮定 |
| --- | ---: | ---: |
| 20時間 | $5.91 | 約890円 |
| 50時間 | $14.79 | 約2,220円 |
| 168時間（1週間常時） | $49.68 | 約7,450円 |
| 730時間（月換算） | $215.88 | 約32,380円 |

換算レートは実勢相場ではなく比較用の仮定。起動・イメージ取得・待機時間も課金に含む。
停止後もECR、S3、ログ等の保存費用は残る。
メモリを24 GBに増やす場合は約$0.33996/時となる。

## 推論費用の例

1セッションで最大3解析、各解析に2モデル呼び出しを仮定する。
**2呼び出しを合計して**入力4,000・出力800 tokens/解析なら：

`3 × (4 × 0.000072 + 0.8 × 0.000288) = $0.0015552 / セッション`

1,000セッションで約$1.56。ただし画像の大きさ・プロンプト・実際の出力長で変わる。
この800は試算上の合計出力量であり、実装制限の「各呼び出し800」より小さい。
各呼び出しが上限まで出力すると費用は増える。別モデルへの変更時は再計算する。

## 全体予算を決める目安

試算用の小規模利用：招待ユーザー10人以内、合計1,000セッション以内、
画像2 MiB以下、静的配信10 GB以下、短期保存、ログ1 GB以下、ECRイメージ計10 GB程度。

- 20時間のワーカー利用：**計画用の予備枠として$15〜25**。
- 50時間のワーカー利用：**計画用の予備枠として$25〜40**。

上記の総額帯は正式見積もりではなく、ワーカー・推論の計算額へ余裕を加えた予算案。
Cognito、S3、CloudFront、HTTP API、Lambda、DynamoDB、SQS、ECR、ログ・アラーム、
Scheduler、データ転送等はまだ項目別に積算していない。実際の利用量と設定で再計算する。
有料運用前に [AWS Pricing Calculator](https://calculator.aws/) で補完し、上限を決める。
独自ドメイン費用、税、他プロジェクトの既存利用分は含まない。

費用を抑える優先順位は、**ワーカー停止 → モデル呼び出し制限 → 保存・ログ削減**。
予算通知は即時停止を保証しない。利用枠と受付停止スイッチをAPIに持たせ、
Schedulerでデモ終了時にもワーカーを停止する。公衆向けの無制限公開を初期設定にしない。
