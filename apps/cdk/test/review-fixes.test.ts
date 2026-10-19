import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { PhotoPrepStack } from "../lib/cdk-stack";

// Templates are synthesized in memory only; nothing is deployed.
const stubCode = lambda.Code.fromInline(
  "def handler(event, context):\n    return None\n",
);

function build(context: Record<string, unknown> = {}) {
  const app = new cdk.App({ context });
  const stack = new PhotoPrepStack(app, "TestStack", {
    env: { region: "ap-northeast-1", account: "123456789012" },
    apiCode: stubCode,
  });
  return Template.fromStack(stack);
}

describe("cleanup failures are observable", () => {
  it("counts individual S3 failures and alarms on them", () => {
    const template = build();
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      MetricTransformations: [
        {
          MetricName: "SweeperDeletionFailures",
          MetricNamespace: "PhotoPrep",
          MetricValue: "$.failed_count",
        },
      ],
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "SweeperDeletionFailures",
      Namespace: "PhotoPrep",
      Threshold: 1,
      EvaluationPeriods: 1,
      AlarmActions: Match.anyValue(),
    });
  });

  it("gives the sweeper the table name to remove expired observation notes", () => {
    build().hasResourceProperties("AWS::Lambda::Function", {
      Handler: "photoprep_api.ops.sweeper.handler",
      Environment: {
        Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }),
      },
    });
  });
});

describe("no development origin in a production stack by default", () => {
  it("keeps localhost out of the whole template", () => {
    expect(JSON.stringify(build().toJSON())).not.toContain("localhost");
  });

  it("allows it only when asked for with a context value", () => {
    const text = JSON.stringify(
      build({ "photoprep:devOrigin": "http://localhost:5173" }).toJSON(),
    );
    expect(text).toContain("http://localhost:5173/auth/callback");
    expect(text).toContain('"http://localhost:5173"');
  });

  it("refuses anything that is not a local http origin", () => {
    expect(() =>
      build({ "photoprep:devOrigin": "https://evil.example" }),
    ).toThrow(/devOrigin/);
    expect(() =>
      build({ "photoprep:devOrigin": "http://localhost:5173/path" }),
    ).toThrow(/devOrigin/);
  });
});

describe("the worker count is not reset by a deploy unless it says so", () => {
  it("is 0 by default, so a first deploy starts nothing", () => {
    build().hasResourceProperties("AWS::ECS::Service", { DesiredCount: 0 });
  });

  it("can be kept at 1 when deploying while the worker is running", () => {
    build({ "photoprep:workerDesiredCount": 1 }).hasResourceProperties(
      "AWS::ECS::Service",
      { DesiredCount: 1 },
    );
  });

  it("also accepts the string form that `cdk -c` passes", () => {
    build({ "photoprep:workerDesiredCount": "1" }).hasResourceProperties(
      "AWS::ECS::Service",
      { DesiredCount: 1 },
    );
  });

  it("rejects a count the design does not allow (one task at a time)", () => {
    expect(() => build({ "photoprep:workerDesiredCount": 3 })).toThrow(
      /workerDesiredCount/,
    );
  });
});
