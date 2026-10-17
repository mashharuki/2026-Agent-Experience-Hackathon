import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import { acknowledge } from "../nag";
import type { Data } from "./data";
import { grantUploadAccess } from "./s3-access";
import type { Worker } from "./worker";

export interface OperationsProps {
  readonly data: Data;
  readonly worker: Worker;
  /** Lambda package for the operations handlers (the API package; replaced in T038). */
  readonly code: lambda.Code;
  /** Where alarms and budget notices go. Without it no budget is created (and the stack warns). */
  readonly alertEmail?: string;
  /** Total spend limit in USD, before credits. Approved by the owner on 2026-10-17. */
  readonly budgetUsd: number;
}

/**
 * Everything that keeps the deployment cheap and tidy:
 * - worker-control Lambda: start / stop / reconcile the worker and the "accepting" flag;
 *   a nightly stop and a 5-minute reconcile (a drain waits for in-flight jobs);
 *   starting is deliberately manual because a running worker costs money;
 * - re-dispatch Lambda (every minute): resend jobs saved but never queued;
 * - sweeper Lambda (every 15 minutes): delete leftover temporary images;
 * - alarms on the dead-letter queue and on the operations Lambdas;
 * - an AWS Budgets notification. A budget only NOTIFIES: it does not stop spending. The
 *   limits that act are the nightly stop, the app's quotas and the Lambda timeouts.
 */
export class Operations extends Construct {
  readonly alertTopic: sns.Topic;
  readonly workerControl: lambda.Function;

  constructor(scope: Construct, id: string, props: OperationsProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const { data, worker } = props;

    const makeFunction = (
      name: string,
      handler: string,
      timeout: number,
      env: Record<string, string>,
    ) =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.PYTHON_3_12,
        architecture: lambda.Architecture.X86_64,
        handler,
        code: props.code,
        memorySize: 256,
        timeout: cdk.Duration.seconds(timeout),
        environment: env,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });

    // --- worker control -----------------------------------------------------------------
    this.workerControl = makeFunction(
      "WorkerControl",
      "photoprep_api.ops.worker_control.handler",
      30,
      {
        CLUSTER_NAME: worker.cluster.clusterName,
        SERVICE_NAME: worker.service.serviceName,
        QUEUE_URL: data.queue.queueUrl,
        TABLE_NAME: data.table.tableName,
      },
    );
    this.workerControl.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:UpdateService", "ecs:DescribeServices"],
        resources: [worker.service.serviceArn],
      }),
    );
    data.table.grantReadWriteData(this.workerControl);
    this.workerControl.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sqs:GetQueueAttributes"],
        resources: [data.queue.queueArn],
      }),
    );

    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": stack.account } },
      }),
    });
    this.workerControl.grantInvoke(schedulerRole);

    const schedule = (
      name: string,
      expression: string,
      action: string,
      timezone?: string,
    ) =>
      new scheduler.CfnSchedule(this, name, {
        flexibleTimeWindow: { mode: "OFF" },
        scheduleExpression: expression,
        scheduleExpressionTimezone: timezone,
        state: "ENABLED",
        target: {
          arn: this.workerControl.functionArn,
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({ action }),
          retryPolicy: { maximumRetryAttempts: 2 },
        },
      });
    // Stop every night (03:00 JST) in case someone forgot; finish a pending stop every 5 minutes.
    schedule("NightlyStop", "cron(0 3 * * ? *)", "stop", "Asia/Tokyo");
    schedule("Reconcile", "rate(5 minutes)", "reconcile");

    // --- re-dispatch and sweeper --------------------------------------------------------
    const redispatch = makeFunction(
      "Redispatch",
      "photoprep_api.ops.dispatch.handler",
      30,
      {
        TABLE_NAME: data.table.tableName,
        QUEUE_URL: data.queue.queueUrl,
        IMAGE_BUCKET: data.imageBucket.bucketName,
      },
    );
    data.table.grantReadWriteData(redispatch);
    data.queue.grantSendMessages(redispatch);
    new events.Rule(this, "RedispatchEvery1Minute", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(redispatch, { retryAttempts: 0 })],
    });

    const sweeper = makeFunction(
      "Sweeper",
      "photoprep_api.ops.sweeper.handler",
      60,
      {
        IMAGE_BUCKET: data.imageBucket.bucketName,
      },
    );
    // Lists the uploads/ prefix (LastModified comes with the listing) and deletes old objects.
    grantUploadAccess(sweeper, data.imageBucket, { delete: true });
    new events.Rule(this, "SweepEvery15Minutes", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(sweeper, { retryAttempts: 0 })],
    });

    // --- alarms and notifications -------------------------------------------------------
    this.alertTopic = new sns.Topic(this, "Alerts", { enforceSSL: true });
    const notify = new cloudwatchActions.SnsAction(this.alertTopic);
    if (props.alertEmail) {
      this.alertTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alertEmail),
      );
    }

    new cloudwatch.Alarm(this, "DeadLetterQueueNotEmpty", {
      alarmDescription:
        "A job failed three times and landed in the dead-letter queue",
      metric: data.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(notify);
    for (const [name, fn] of [
      ["WorkerControl", this.workerControl],
      ["Redispatch", redispatch],
    ] as const) {
      new cloudwatch.Alarm(this, `${name}Errors`, {
        alarmDescription: `${name} Lambda is failing`,
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(notify);
    }

    // --- budget (notification only) -----------------------------------------------------
    if (props.alertEmail) {
      const subscriber = [
        { subscriptionType: "EMAIL", address: props.alertEmail },
      ];
      new budgets.CfnBudget(this, "Budget", {
        budget: {
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: props.budgetUsd, unit: "USD" },
          // Before credits: the limit is on spend, not on what credits happen to cover.
          // Account-wide: every service in this AWS account counts, not just this project.
          costTypes: { includeCredit: false },
        },
        notificationsWithSubscribers: [50, 80, 100].map((threshold) => ({
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            thresholdType: "PERCENTAGE",
            threshold,
          },
          subscribers: subscriber,
        })),
      });
    } else {
      cdk.Annotations.of(this).addWarning(
        "No budget notification was created: set the context value photoprep:alertEmail (an e-mail address for alarms and AWS Budgets) before deploying.",
      );
    }

    acknowledge(this, [
      {
        id: "AwsSolutions::AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
        reason:
          "AWSLambdaBasicExecutionRole only grants CloudWatch Logs write access to each function's own log group.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::<DataTableFDBAD0F2.Arn>/index/*]",
        reason:
          "Generated by grantReadWriteData: includes the table's own secondary index (status-index) only.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::<DataImageBucket04D7B968.Arn>/uploads/*]",
        reason:
          "The sweeper deletes only under the uploads/ prefix of the temporary image bucket.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::<OperationsWorkerControl612EB08A.Arn>:*]",
        reason:
          "Generated by grantInvoke for the scheduler role: allows invoking this one function (and its versions).",
      },
      {
        id: "AwsSolutions::AwsSolutions-L1",
        reason:
          "Python 3.12 is pinned to match the API and the locked dependencies; upgrading the runtime is a separate, tested change.",
      },
    ]);
  }
}
