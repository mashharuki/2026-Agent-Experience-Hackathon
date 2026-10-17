# Operations: start, stop, spend limits and tear-down

Status: **written for the infrastructure as designed; nothing has been deployed yet, so no command
below has been run against AWS.** Values in `<angle brackets>` come from the stack outputs.

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

```sh
cd apps/cdk
pnpm exec cdk diff  -c photoprep:alertEmail=<your-email>
pnpm exec cdk deploy -c photoprep:alertEmail=<your-email> -c photoprep:workerImageTag=<immutable-tag>
```

- `photoprep:alertEmail` is required for alarms and the budget; without it the stack warns and creates no budget.
- Confirm the e-mail subscription that AWS sends (alarms and the budget stay silent until you do).
- Stateful resources (user pool, table) are **retained** by default. For a full tear-down pass
  `-c photoprep:destroyData=true` when deploying, before deleting the stack.

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
