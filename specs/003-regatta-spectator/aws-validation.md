# AWS移行と検証手順

2026-10-22。ユーザーがAWSへのデプロイと検証を依頼。ローカル実装をAWSで動作済みとは扱わない。

## 事前確認

- [予算記録](../../docs/reviews/2026-10-22-fleet-aws-budget.json): クレジット・返金前の累計額と旧Fargate稼働を確認。総$30・30worker時間を継続し、未計上分の取り置きを設ける。
- 東京のFargate On-Demand CPUクォータは64vCPU。最初の計測は4vCPU/16GiB、単発1タスクのみ。
- `RegattaProbeStack`はECR・ログ・単発タスク定義・受信なしのVPCだけを持つ。Web公開、Cognito、ゲームAPIは含まない。
- CDKの型チェック・synth・diff・cdk-nag・公開経路がないことのテストを通してから作成する。

## モデル入りイメージ

既存の固定モデル入りLinux/x86_64イメージを再利用する。別の環境では先に`apps/worker/Dockerfile`からベースをビルドする。依存は既存`uv.lock`、両モデルrevisionは`prefetch_models.py`で固定。稼働時はモデルのチェックサムを検証し、外部通信を禁止して推論する。

```sh
docker build --platform linux/amd64 -f apps/worker/Dockerfile -t photoprep-worker:base .
docker build --platform linux/amd64 --build-arg BASE_IMAGE=photoprep-worker:base \
  -f apps/regatta-worker/Dockerfile -t regatta-worker:fleet-v4-probe .
```

デプロイは`apps/cdk`で`--app 'pnpm exec ts-node bin/regatta-probe.ts'`を指定する。既定の写真支援アプリを再デプロイしない。ECRの`fleet-v4-probe`タグは不変。イメージを変更する際は新しいタグとタスク定義を使う。

## 計測と終了

12件ウォームアップ後、現在の`fleet-v4`と合成観測100件を実行。推論処理は900秒のalarmで終了する。ホストの監視スクリプトも30分でstopを要求し、同じstateファイルで二重起動を拒否する。中断や失敗では保存したtask ARNを使い`STOPPED`を確認する。

```sh
apps/worker/.venv/bin/python apps/regatta-worker/run_cloud_probe.py \
  --profile YOUR_PROFILE --outputs .local/regatta/probe-outputs.json \
  --state .local/regatta/probe-task.json \
  --report docs/reviews/fleet-aws-cpu-latency.json
```

生のAWS識別子とログは`.local/`だけに保存。公開記録はモデル版・CPU/メモリ・遅延・停止確認を含む。モデル単体の速度であり、公開APIのエンドツーエンド速度ではない。

## 公開前のゲート

1. モデル単体p95が3秒の期限に収まるだけでなく、認証API・配送・適用までの余裕を確保。必要ならCPU構成と費用を再比較。
2. 正本OpenAPI、生成クライアント、Cognitoアクセストークン検証、所有権、原子的利用枠、終了後と遅延結果の拒否を実装・テスト。
3. 配信と実Deciderを接続。認証拒否・他所有者拒否・上限・中断・4艇の実判断・完走・答え合わせを実AWSで確認。
4. Bedrockによる振り返りと応募成果物を確認。CPUの合格だけでハッカソン準拠済みと報告しない。

使用後は単発タスクの停止を確認。残るECRイメージとログにも保存費用があるため、製品用構成への移行時に整理する。

## 計測結果（2026-10-22〜23）

同じ`fleet-v4`の問い・合成観測100件、12件ウォームアップ後。モデル単体の時間で、API・配送は含まない。

| 構成 | p50 | p95 | 3秒超 | ピークRSS | 記録 |
| --- | --- | --- | --- | --- | --- |
| 4 vCPU / 16 GiB、4スレッド | 9.4秒 | 11.4秒 | 100/100 | 11.5 GiB | [cpu4](../../docs/reviews/2026-10-22-fleet-aws-cpu4-latency.json) |
| 16 vCPU / 32 GiB、16スレッド | 3.1秒 | 3.7秒 | 59/100（最大3.8秒） | 11.5 GiB | [cpu16](../../docs/reviews/2026-10-22-fleet-aws-cpu16-latency.json) |

GPUは東京のG系オンデマンド上限が0のため、締切までの選択肢から外した。
ユーザー合意（16 vCPUで測ってから期限を6〜12秒で決める）に基づき、AWS版の判断期限を**6秒**とした。
ローカルの3秒期限は変えていない。サーバーの受付上限は端末時計のずれを見込み9秒。期限後の返答は従来どおり適用しない。

## 公開構成 `SnipeRegattaStack`

- S3＋CloudFront（OAC）、Cognito（Code＋PKCE、scope `regatta/race`）。
- HTTP API：`GET /health`・`POST /decide`はVPC Link→Cloud Map→Fargate、`POST /debrief`はLambda。全ルートがJWTとscope必須。利用者IDはAPI Gatewayが`sub`から付与し、クライアントの同名ヘッダーは上書き。
- Deciderタスクは16 vCPU/32 GiB、既定0台。VPC Linkのセキュリティグループからのみ受信。ALB・NATなし。
- 振り返りはNova Lite 1回、出力800 tokens上限、利用者5回・全体20回/日をDynamoDBで原子的に予約、存在しない判断番号の参照は削除。
- イメージはProbeスタックのECRに`decider-v1`タグで追加（同じ固定モデル入りベース）。

## 運用手順

```sh
# デプロイ（ワーカー停止のまま）
cd apps/cdk && AWS_PROFILE=... pnpm exec cdk deploy --app 'pnpm exec ts-node bin/regatta.ts' \
  -o cdk.out-regatta -c regatta:repositoryName=<probe ECR repository> -c regatta:imageTag=decider-v1 \
  -c regatta:workerCpu=16384 -c regatta:desiredCount=0 -c regatta:maxLeadMs=9000 \
  --outputs-file ../../.local/regatta/stack-outputs.json
# SPAの公開（config.jsonの判断期限は既定6000ms）
AWS_PROFILE=... sh scripts/regatta-publish.sh .local/regatta/stack-outputs.json
# 撮影前に起動、終わったら必ず0へ
aws ecs update-service --cluster <ClusterName> --service <ServiceName> --desired-count 1
aws ecs update-service --cluster <ClusterName> --service <ServiceName> --desired-count 0
```

16 vCPU/32 GiBは東京で約$0.99/時（IPv4込み、2026-10-22の単価）。稼働中は待機時間も課金される。
