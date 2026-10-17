import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { acknowledge } from "../nag";

export interface DataProps {
  /** Origins allowed to POST images straight to S3 (the SPA origin). */
  readonly allowedOrigins: string[];
  /** RETAIN for the metadata table, DESTROY for full teardown. */
  readonly removalPolicy: cdk.RemovalPolicy;
}

/** Name of the sparse index used to find jobs by status (re-dispatch, orphan sweep). */
export const STATUS_INDEX = "status-index";
/** Prefix for temporary uploaded images inside the image bucket. */
export const UPLOAD_PREFIX = "uploads/";

/**
 * State: one DynamoDB table (sessions, jobs, quota, consent, decision records; never
 * images), a private temporary image bucket, and the job queue with its DLQ.
 */
export class Data extends Construct {
  readonly table: dynamodb.Table;
  readonly imageBucket: s3.Bucket;
  readonly queue: sqs.Queue;
  readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: DataProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, "Table", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      deletionProtection: props.removalPolicy === cdk.RemovalPolicy.RETAIN,
      removalPolicy: props.removalPolicy,
    });
    // Sparse index: only items carrying statusKey (jobs awaiting dispatch / running).
    this.table.addGlobalSecondaryIndex({
      indexName: STATUS_INDEX,
      partitionKey: { name: "statusKey", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "statusSince", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.imageBucket = new s3.Bucket(this, "ImageBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Images are temporary by design: the bucket never holds durable data.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          id: "expire-temporary-images",
          prefix: UPLOAD_PREFIX,
          // Backstop only: S3 lifecycle is asynchronous. The sweeper and the worker
          // delete images on completion, failure, cancel and after the signed URL expires.
          expiration: cdk.Duration.days(1),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      cors: [
        {
          allowedOrigins: props.allowedOrigins,
          allowedMethods: [s3.HttpMethods.POST],
          allowedHeaders: ["*"],
          maxAge: 300,
        },
      ],
    });

    this.deadLetterQueue = new sqs.Queue(this, "JobDeadLetterQueue", {
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    this.queue = new sqs.Queue(this, "JobQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      retentionPeriod: cdk.Duration.hours(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });

    acknowledge(this.table, [
      {
        id: "AwsSolutions::AwsSolutions-DDB3",
        reason:
          "Point-in-time recovery is deliberately off: items are short-lived (24 h TTL) and PITR would keep deleted session metadata for up to 35 days, contradicting the retention promised to users.",
      },
    ]);
    acknowledge(this.imageBucket, [
      {
        id: "AwsSolutions::AwsSolutions-S1",
        reason:
          "Server access logs are not enabled: the bucket holds only short-lived images and a log bucket would add cost and retain object metadata for longer than the images themselves.",
      },
    ]);
  }
}
