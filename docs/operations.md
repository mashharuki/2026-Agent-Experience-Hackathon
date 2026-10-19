# Operations: start, stop, spend limits and tear-down

> 2026-10-19レビュー修正：回答API・ジョブ種別・回収監視の差分はローカル検証済み、AWS未反映。[検証記録](reviews/2026-10-19-remediation-validation.md)を参照。以下の旧検証手順と今回の切替手順を区別する。

Status: the infrastructure was deployed once on 2026-10-17 for verification and the commands below for deploying,
starting and stopping the worker and publishing the SPA were run against AWS. **The tear-down steps were written
from the design and have only been partly exercised** (run each `cdk` command on its own; a second one started
while the first is still running can recreate the stack). Values in `<angle brackets>` come from the stack outputs.

## What keeps the cost down

| Control | What it does | Acts on spend? |
|---|---|---|
| Worker starts at 0 tasks | A stopped worker costs nothing (about $0.30 per hour while running) | **Yes** |
| Nightly stop (03:00 JST) + reconcile every 5 min | Closes the door, waits for running jobs, scales to 0 | **Yes** |
| App quotas (10 sessions/person/day, 100/day overall, 3 analyses/session) | Refuses work beyond the limits | **Yes** |
| Lambda timeouts, API throttling (20 req/s, burst 40) | Bound the cost of mistakes and abuse | **Yes** |
| AWS Budgets ($30 per month, before credits, at 50 / 80 / 100 % of actual spend) | **Sends an e-mail only** | **No: a notification is not a limit** |

The approved ceiling is **$30 before discounts** (`docs/architecture/cost-estimate.md`). The budget covers
the whole AWS account, so spend from anything else in the account counts too.

## Deploy (do this only after the owner agrees)

Order matters: the stack needs the Lambda package, and the frontend needs the stack's outputs.

```sh
pnpm build:lambda                      # code + pinned Linux x86_64 dependencies + the OpenAPI file
cd apps/cdk
pnpm exec cdk diff   -c photoprep:alertEmail=<your-email>
pnpm exec cdk deploy -c photoprep:alertEmail=<your-email> -c photoprep:workerImageTag=<immutable-tag>
cd ../frontend
pnpm run publish:plan                  # prints what would be uploaded; changes nothing
pnpm run publish:apply                 # builds against the deployed API, uploads, invalidates
```

- A deploy **stops a running worker**: the template pins the service to 0 tasks. When you deploy while the worker
  is running (and want it to keep running), add `-c photoprep:workerDesiredCount=1`.
- Calling `start` on a worker that is already running leaves the door as it is (the worker opens it only once, at boot);
  it only cancels a pending drain.
- To develop the frontend against the deployed stack, opt in with `-c photoprep:devOrigin=http://localhost:5173`; the
  default stack trusts no local origin.
- `cdk synth/deploy` refuses to run without the package from `pnpm build:lambda`: the Lambdas could not
  start without it (an earlier version shipped only the source files).
- `publish:apply` builds the SPA with the deployed API and Cognito addresses and with the mock **off**,
  refuses a build that does not contain the API address, and only writes to the bucket and distribution
  named in the stack outputs.
- The worker image does not exist yet on the first deploy: leave `workerImageTag` unset (the service runs
  0 tasks), push the image (next section), then deploy again with the tag.
- `photoprep:alertEmail` is required for alarms and the budget; without it the stack warns and creates no budget.
- Confirm the e-mail subscription that AWS sends (alarms and the budget stay silent until you do).
- Stateful resources (user pool, table) are **retained** by default. For a full tear-down pass
  `-c photoprep:destroyData=true` when deploying, before deleting the stack.
- Create the invited user in Cognito yourself (the console or `aws cognito-idp admin-create-user`); never
  share the password.

## Build and push the worker image (about 5 GB with the model weights)

```sh
docker build --platform linux/amd64 -f apps/worker/Dockerfile -t photoprep-worker .
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin <WorkerRepositoryUri host>
docker tag photoprep-worker <WorkerRepositoryUri>:<immutable-tag>
docker push <WorkerRepositoryUri>:<immutable-tag>
```

The repository is immutable: use a new tag for every push and redeploy with `-c photoprep:workerImageTag=<tag>`.
The image has **not** been built yet; the first build checks the pinned model revisions.

## Start the worker (before a demo)

Starting is manual on purpose. The function name is the `WorkerControlFunction` output.

```sh
aws lambda invoke --function-name <WorkerControlFunction> --payload '{"action":"start"}' \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

The door stays **closed** (`warming_up`, with an estimate of five minutes that has not been measured)
until the worker has loaded the model and then opens it itself. Check `GET /service-status` or the
app's first screen.

## Stop the worker

```sh
aws lambda invoke --function-name <WorkerControlFunction> --payload '{"action":"stop"}' \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

- Idle: the door closes and the service scales to 0 immediately.
- Jobs waiting or running: the door closes (new work is refused, reported as `maintenance`) and the worker
  keeps going until the queue is empty; the five-minute `reconcile` then scales to 0.
- If something is stuck: `aws ecs update-service --cluster <WorkerClusterName> --service <WorkerServiceName> --desired-count 0`.
  A task that is stopped gets 120 s to finish its current job.

## Checks that something is wrong

- An alarm e-mail for the dead-letter queue means a job failed three times; look at the worker logs
  (CloudWatch group of the worker, kept 7 days). Logs contain ids and option names only, never photos or text.
- `reconcile` closes the door by itself if the flag says "open" while the service is at 0.

## Tear down

1. Stop the worker. 2. Export what you want to keep (`apps/worker/tools/export_decisions.py`).
3. Deploy once with `-c photoprep:destroyData=true`, then `cdk destroy`. 4. Delete the ECR images and any
leftover log groups. 5. Check Billing for resources that remain (public IPv4 addresses, ECR storage).

## レビュー修正版の切替と障害対応（2026-10-19）

1. 新規受付を閉じてdrainする。旧workerを残したまま回答ジョブを配送しない。
2. APIのLambdaパッケージ、workerイメージを再ビルドし、新ルート・状態・ジョブ種別とCDKの監視・回収権限を揃える。
3. フロントを公開し、PWAの更新を確認。既存のv1同意セッションは終了・新しい同意で再開始する。
4. 招待ユーザーで回答→判断、待機中終了、所有権拒否、終了後の写真・観察メモ削除、回収通知を確認してから受付を開く。検証後はワーカーを停止する。

回収処理は `attempted/deleted/failed/retried` を返す。S3個別エラーの一時失敗は最大2回追加再試行し、権限エラーは繰り返さない。`SweeperDeletionFailures` とSweeper Lambda Errorsを既存SNSへ通知する。failed_count>0ならIAM・バケットポリシー・暗号化設定を確認し、修正後に回収を再実行する。ログに画像キーや観察文章を貼らない。

確認用Observationは10分で利用不可となり、回答完了・終了・定期回収で削除する。DynamoDB TTLやS3 Lifecycleは即時物理削除を保証しない。目標時間の超過・回収障害を成功扱いせず、通知から調査する。

旧版でIDEMだけが残る場合、jobIdの実在・SESSIONの状態・配送履歴を読み取りで調べる。存在しないジョブを再実行したり利用枠を推測で返却せず、対象セッションを終了して再開始を案内する。新しい原子的な受付では同じ不整合を作らない。

巻き戻す場合も受付停止・drainを先に行い、新しい回答ジョブを旧workerへ渡さない。新状態のセッションは終了させる。
