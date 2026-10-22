import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { RegattaStack } from "../lib/regatta-stack";

function template(
  overrides: Partial<ConstructorParameters<typeof RegattaStack>[2]> = {},
) {
  const app = new cdk.App();
  const stack = new RegattaStack(app, "Test", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    repositoryName: "decider-repo",
    imageTag: "decider-v1",
    workerCpu: 16384,
    desiredCount: 0,
    maxLeadMs: 15000,
    ...overrides,
  });
  return Template.fromStack(stack);
}

describe("RegattaStack", () => {
  const t = template();

  test("every route requires the Cognito JWT and the regatta scope", () => {
    const routes = t.findResources("AWS::ApiGatewayV2::Route");
    const keys = Object.values(routes)
      .map((r) => r.Properties.RouteKey)
      .sort();
    expect(keys).toEqual(["GET /health", "POST /debrief", "POST /decide"]);
    for (const route of Object.values(routes)) {
      expect(route.Properties.AuthorizationType).toBe("JWT");
      expect(route.Properties.AuthorizationScopes).toEqual(["regatta/race"]);
    }
  });

  test("only API Gateway sets the user id forwarded to the Decider", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
      ConnectionType: "VPC_LINK",
      RequestParameters: {
        "overwrite:header.x-regatta-user": "$context.authorizer.claims.sub",
      },
    });
  });

  test("the paid worker is stopped by default and never doubled", () => {
    t.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 0,
      DeploymentConfiguration: Match.objectLike({
        MaximumPercent: 100,
        MinimumHealthyPercent: 0,
      }),
    });
    expect(
      template({ desiredCount: 1 }).findResources("AWS::ECS::Service"),
    ).toBeDefined();
  });

  test("no NAT gateway or load balancer is created", () => {
    t.resourceCountIs("AWS::EC2::NatGateway", 0);
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
  });

  test("the task accepts traffic only from the VPC link security group", () => {
    const ingress = t.findResources("AWS::EC2::SecurityGroupIngress");
    const rules = Object.values(ingress).map((r) => r.Properties);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      FromPort: 8080,
      ToPort: 8080,
      IpProtocol: "tcp",
    });
    expect(rules[0].SourceSecurityGroupId).toBeDefined();
    expect(rules[0].CidrIp).toBeUndefined();
  });

  test("the debrief may invoke only Nova Lite and update its quota table", () => {
    const policies = Object.values(t.findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap(
      (p) => p.Properties.PolicyDocument.Statement,
    );
    const bedrock = statements.filter((s) =>
      JSON.stringify(s.Action).includes("bedrock"),
    );
    expect(bedrock).toHaveLength(1);
    expect(bedrock[0].Action).toBe("bedrock:InvokeModel");
    expect(JSON.stringify(bedrock[0].Resource)).toContain(
      "foundation-model/amazon.nova-lite-v1:0",
    );
    const dynamo = statements.filter((s) =>
      JSON.stringify(s.Action).includes("dynamodb"),
    );
    expect(dynamo.map((s) => s.Action)).toEqual(["dynamodb:UpdateItem"]);
  });

  test("the Decider receives the configured deadline and thread count", () => {
    t.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "16384",
      Memory: "32768",
      ContainerDefinitions: [
        Match.objectLike({
          Command: [
            "python",
            "cloud_server.py",
            "--port",
            "8080",
            "--threads",
            "16",
          ],
          Environment: Match.arrayWith([
            { Name: "REGATTA_MAX_LEAD_MS", Value: "15000" },
          ]),
        }),
      ],
    });
  });

  test("rejects a mutable or missing image tag and an unsafe deadline", () => {
    expect(() => template({ imageTag: "" })).toThrow("immutable image tag");
    expect(() => template({ maxLeadMs: 60000 })).toThrow("maxLeadMs");
  });
});
