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
