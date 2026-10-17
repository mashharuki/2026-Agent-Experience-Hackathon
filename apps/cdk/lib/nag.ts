import { Validations } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

export interface Acknowledgment {
  /** cdk-nag finding id, e.g. "AwsSolutions-S1" or "AwsSolutions-IAM5[Action::s3:*]". */
  readonly id: string;
  /** Why the finding is accepted. Required: no silent suppressions. */
  readonly reason: string;
}

/**
 * Acknowledge cdk-nag findings on a construct (cdk-nag 3 uses CDK's native API; each
 * finding is acknowledged individually, prefix matching is not supported).
 */
export function acknowledge(scope: IConstruct, items: Acknowledgment[]): void {
  for (const item of items) {
    Validations.of(scope).acknowledge(item);
  }
}
