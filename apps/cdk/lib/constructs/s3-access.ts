import * as iam from "aws-cdk-lib/aws-iam";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { UPLOAD_PREFIX } from "./data";

export interface UploadAccess {
  readonly get?: boolean;
  readonly put?: boolean;
  readonly delete?: boolean;
}

/**
 * Explicit, prefix-scoped access to the temporary images. CDK's `grantRead`/`grantPut`/
 * `grantDelete` add wildcard actions (`s3:GetBucket*`, `s3:List*`, `s3:Abort*`) that reach
 * beyond what any of our code needs, so the exact actions are written out instead.
 *
 * `s3:ListBucket` (limited to the uploads/ prefix) is needed for a reason that is easy to
 * miss: without it S3 answers 403 instead of 404 for a missing key, and "the photo never
 * arrived" would look like a permission error.
 */
export function grantUploadAccess(
  principal: iam.IGrantable,
  bucket: s3.IBucket,
  access: UploadAccess,
): void {
  const actions = [
    access.get ? "s3:GetObject" : undefined,
    access.put ? "s3:PutObject" : undefined,
    access.delete ? "s3:DeleteObject" : undefined,
  ].filter((a): a is string => a !== undefined);
  if (actions.length > 0) {
    principal.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions,
        resources: [bucket.arnForObjects(`${UPLOAD_PREFIX}*`)],
      }),
    );
  }
  principal.grantPrincipal.addToPrincipalPolicy(
    new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      resources: [bucket.bucketArn],
      conditions: { StringLike: { "s3:prefix": [`${UPLOAD_PREFIX}*`] } },
    }),
  );
}
