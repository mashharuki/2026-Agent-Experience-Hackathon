# PhotoPrep AWS環境の削除記録

実施日：2026-10-21（JST）。新製品へ移るため、ユーザーが専用AWS環境の全削除を指示した。
過去の保持データ・登録ユーザー6リソースについては追加確認を受け、明示的な削除承認を得た。
ローカルのコード、未コミット変更、旧仕様、モデル・AWS検証記録は保持した。

## 範囲と実行

- 有効な17リージョンのCloudFormation履歴を調べ、PhotoPrepStackは東京だけで確認。
- 稼働中ワーカー1台の受付を停止し、desiredCount=0。処理待ち／処理中のSQSメッセージは0だった。
- 夜間停止・reconcile・再配送・回収の4定期実行を無効化してからDeleteStackを実行。
- 現行PhotoPrepStackの **DELETE_COMPLETE** を確認。ECS/Fargate、VPC、API、Lambda、SQS、S3、CloudFront、ECR、監視・通知・予算を削除。
- Retainされた現行分と過去3回分を合わせ、**DynamoDBテーブル4個・Cognitoユーザープール4個**を削除。旧セッション情報・登録ユーザーも削除された。
- Custom Resource Lambdaの残存ロググループ8個を削除。
- 過去・現行テンプレートで参照したLambda配布zipの5オブジェクト版を削除。共有バケットのため、他の稼働スタックから参照されていないことを削除直前にも確認した。
- ECSタスク定義7版を登録解除・削除要求。ACTIVEとINACTIVEは0、**DELETE_IN_PROGRESSは7**。AWSの非同期処理中であり、最終消失はまだ確認していない。タスク自体は稼働していない。

## 消失を確認したもの

東京でプロジェクトのテーブル・バケット・ECR repository・ログ・Lambda・HTTP API・ECS cluster・SQS・
Scheduler・EventBridge rule・alarm・VPC・IAM role・SNS topic・Budgetを再列挙し、該当リソース0を確認。
Cognitoの4poolと旧CloudFront distributionも存在しない。旧URL・旧アカウントは使えない。

削除対象を推測した名前だけで広げず、CloudFormation履歴の物理IDと専用prefixを使って照合した。
CloudFormationのDELETE_COMPLETE履歴はAWS側の履歴として残る。これは稼働リソースではない。

## 対象外として保持したもの

**共有CDKToolkit**、bootstrap bucket/repository/roles、他プロジェクトの配布資産、アカウント共通のサービス連携ロール等は保持した。
共有バケット全体を空にしたわけではなく、他プロジェクトや古い共有資産には保存費用が残り得る。
旧プロダクト専用の稼働費用を止めたことと、AWSアカウント全体の請求がゼロであることは異なる。
請求反映に遅延があるため、最終利用額はこの時点で確定していない。$30の総予算は新企画へリセットしない。

## 承認レビューへの対応

過去の保持table/poolの削除は、当初の指示の範囲が曖昧として自動承認レビューに拒否された。
ユーザーの「過去の残存データ・ユーザーもすべて削除する」を受けて実行した。
共有bootstrap内のzip削除も参照確認不足で一度拒否され、稼働中スタックのテンプレートを調べて
対象5キーが参照されていない証拠を得てから、再確認を含む限定削除を実行した。回避実行はしていない。

## 次の作業

[新設計](../../specs/002-snipe-ai-regatta/plan.md)を作成。新AWS環境の作成・有料モデル評価は今回実施していない。
ゲーム実装・操船・新モデル品質・新遅延は未検証。新環境のデプロイ前に、残予算・新scope・最小IAM・停止と削除を再確認する。

## 設計成果物の検査

新OpenAPI草案のスキーマ検証、新feature文書の相対リンク、draw.ioの2ページとedge参照、
生成スクリプトのRuff、`git diff --check`を確認。PNG2枚を書き出して目視確認した。
草案の自由形式部分と応答schemaは実装前に具体化する。新ゲームの動作テストはまだ行えない。
