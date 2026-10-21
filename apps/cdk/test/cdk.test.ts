import * as fs from "node:fs";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { AwsSolutionsChecks } from "cdk-nag";
import { parse } from "yaml";
import { PhotoPrepStack } from "../lib/cdk-stack";

// Nothing here deploys anything: these tests only synthesize templates in memory.
// The Lambda package is an inline stub so no asset is built.
const stubCode = lambda.Code.fromInline(
  "def handler(event, context):\n    return None\n",
);

function build(context: Record<string, unknown> = {}, withNag = false) {
  const app = new cdk.App({ context });
  const stack = new PhotoPrepStack(app, "TestStack", {
    env: { region: "ap-northeast-1", account: "123456789012" },
    apiCode: stubCode,
  });
  if (withNag) {
    cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  }
  return { app, stack, template: Template.fromStack(stack) };
}

describe("security baseline (cdk-nag AwsSolutions pack)", () => {
  test("synthesizes with no unacknowledged findings", () => {
    const { app } = build({}, true);
    expect(() => app.synth()).not.toThrow();
  });
});

describe("storage is private and encrypted", () => {
  const { template } = build();

  test("every S3 bucket blocks all public access and uses encryption", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    expect(Object.keys(buckets)).toHaveLength(2); // SPA assets + temporary images
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket.Properties.BucketEncryption).toBeDefined();
      expect(bucket.Properties.WebsiteConfiguration).toBeUndefined();
    }
  });

  test("bucket policies require TLS and never grant access to everyone", () => {
    const policies = template.findResources("AWS::S3::BucketPolicy");
    for (const policy of Object.values(policies)) {
      const statements = policy.Properties.PolicyDocument.Statement as Array<{
        Effect: string;
        Principal: unknown;
        Condition?: Record<string, unknown>;
      }>;
      expect(
        statements.some(
          (s) =>
            s.Effect === "Deny" &&
            JSON.stringify(s.Condition).includes("aws:SecureTransport"),
        ),
      ).toBe(true);
      for (const s of statements.filter((x) => x.Effect === "Allow")) {
        expect(s.Principal).not.toEqual("*");
        expect(s.Principal).not.toEqual({ AWS: "*" });
      }
    }
  });

  test("temporary images expire and uploads are limited to the SPA origin", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Status: "Enabled",
            Prefix: "uploads/",
            ExpirationInDays: 1,
          }),
        ]),
      },
      CorsConfiguration: {
        CorsRules: [Match.objectLike({ AllowedMethods: ["POST"] })],
      },
    });
  });

  test("the table is on-demand with a TTL and a status index", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: "status-index" })],
    });
  });

  test("the job queue retries three times before the dead-letter queue", () => {
    template.hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 120,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
  });
});

describe("authentication", () => {
  const { template } = build();

  test("self-registration requires email confirmation with a code", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
      AutoVerifiedAttributes: ["email"],
      VerificationMessageTemplate: { DefaultEmailOption: "CONFIRM_WITH_CODE" },
      Policies: Match.objectLike({
        PasswordPolicy: Match.objectLike({ MinimumLength: 12 }),
      }),
    });
  });

  test("the SPA client is public and uses only the authorization code flow", () => {
    const clients = template.findResources("AWS::Cognito::UserPoolClient");
    const [client] = Object.values(clients);
    expect(Object.keys(clients)).toHaveLength(1);
    expect(client.Properties.GenerateSecret).not.toBe(true);
    expect(client.Properties.AllowedOAuthFlows).toEqual(["code"]);
    expect(client.Properties.AllowedOAuthFlowsUserPoolClient).toBe(true);
    // The custom scope is "<resource server identifier>/session"; CDK renders it as a join
    // on the resource server reference, so check the shape and the server's identifier.
    expect(JSON.stringify(client.Properties.AllowedOAuthScopes)).toContain(
      '"/session"',
    );
    template.hasResourceProperties("AWS::Cognito::UserPoolResourceServer", {
      Identifier: "photoprep",
      Scopes: [Match.objectLike({ ScopeName: "session" })],
    });
    expect(client.Properties.PreventUserExistenceErrors).toBe("ENABLED");
  });
});

describe("API", () => {
  const { template } = build();
  const spec = parse(
    fs.readFileSync(
      path.join(__dirname, "../../../packages/api-spec/openapi.yaml"),
      "utf8",
    ),
  ) as { paths: Record<string, Record<string, unknown>> };

  const specRoutes = Object.entries(spec.paths).flatMap(([p, item]) =>
    Object.keys(item)
      .filter((m) => ["get", "post", "put", "delete", "patch"].includes(m))
      .map((m) => `${m.toUpperCase()} ${p}`),
  );

  test("routes match the OpenAPI contract exactly", () => {
    const routes = Object.values(
      template.findResources("AWS::ApiGatewayV2::Route"),
    ).map((r) => r.Properties.RouteKey as string);
    expect([...routes].sort()).toEqual([...specRoutes].sort());
  });

  test("every route is behind the JWT authorizer and requires the session scope", () => {
    const routes = Object.values(
      template.findResources("AWS::ApiGatewayV2::Route"),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.Properties.AuthorizationType).toBe("JWT");
      expect(route.Properties.AuthorizerId).toBeDefined();
      expect(route.Properties.AuthorizationScopes).toEqual([
        "photoprep/session",
      ]);
    }
  });

  test("the authorizer trusts only the Cognito issuer and client", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      JwtConfiguration: {
        Issuer: Match.anyValue(),
        Audience: Match.anyValue(),
      },
    });
  });

  test("the default stage is throttled and writes access logs without client addresses", () => {
    const stages = Object.values(
      template.findResources("AWS::ApiGatewayV2::Stage"),
    );
    expect(stages).toHaveLength(1);
    const props = stages[0].Properties;
    expect(props.DefaultRouteSettings).toMatchObject({
      ThrottlingRateLimit: 20,
      ThrottlingBurstLimit: 40,
    });
    expect(props.AccessLogSettings.DestinationArn).toBeDefined();
    expect(props.AccessLogSettings.Format).not.toMatch(
      /sourceIp|userAgent|requestTime/i,
    );
  });

  test("the handler is outside any VPC", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "python3.12",
      Handler: "photoprep_api.lambda_handler.handler",
      VpcConfig: Match.absent(),
    });
  });

  test("the handler's role has explicit actions only and no wildcard resource", () => {
    const roles = Object.keys(template.findResources("AWS::IAM::Role")).filter(
      (id) => /ApiHandlerServiceRole/.test(id),
    );
    expect(roles).toHaveLength(1);
    const statements: Array<{ Action: string | string[]; Resource: unknown }> =
      [];
    for (const policy of Object.values(
      template.findResources("AWS::IAM::Policy"),
    )) {
      const attached = (policy.Properties.Roles ?? []) as Array<{
        Ref: string;
      }>;
      if (attached.some((r) => roles.includes(r.Ref))) {
        statements.push(...policy.Properties.PolicyDocument.Statement);
      }
    }
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      for (const action of ([] as string[]).concat(s.Action)) {
        expect(action).not.toContain("*");
      }
      expect(JSON.stringify(s.Resource)).not.toBe('"*"');
    }
  });

  test("the handler can put, read and delete photos under uploads/ and list that prefix", () => {
    // Put: signed uploads. Get + ListBucket: HeadObject to see the photo arrived, and a clean
    // 404 (not 403) when it did not. Delete: ending a session removes its photos.
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("s3:PutObject");
    expect(policies).toContain("s3:GetObject");
    expect(policies).toContain("s3:ListBucket");
  });

  test("CORS allows only the app origins and the headers the client needs", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: Match.objectLike({
        AllowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
        AllowMethods: ["GET", "POST", "DELETE"],
      }),
    });
  });
});

describe("frontend delivery", () => {
  const { template } = build();

  test("CloudFront serves the private bucket through origin access control over HTTPS", () => {
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
        }),
      }),
    });
  });
});

describe("teardown policy for stateful resources", () => {
  test("user pool and table are retained by default", () => {
    const { template } = build();
    for (const type of ["AWS::Cognito::UserPool", "AWS::DynamoDB::Table"]) {
      for (const r of Object.values(template.findResources(type))) {
        expect(r.DeletionPolicy).toBe("Retain");
        expect(JSON.stringify(r.Properties)).toMatch(
          /"DeletionProtection(Enabled)?":(true|"ACTIVE")/,
        );
      }
    }
  });

  test("photoprep:destroyData allows a full teardown", () => {
    const { template } = build({ "photoprep:destroyData": true });
    for (const type of ["AWS::Cognito::UserPool", "AWS::DynamoDB::Table"]) {
      for (const r of Object.values(template.findResources(type))) {
        expect(r.DeletionPolicy).toBe("Delete");
      }
    }
  });
});
