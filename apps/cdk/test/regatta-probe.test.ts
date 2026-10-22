import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { RegattaProbeStack } from "../lib/regatta-probe-stack";

test("latency gate has no running service, public API, inbound rule or NAT", () => {
  const app = new cdk.App();
  const stack = new RegattaProbeStack(app, "Probe", {
    env: { region: "ap-northeast-1", account: "123456789012" },
  });
  cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::ECS::Service", 0);
  template.resourceCountIs("AWS::EC2::NatGateway", 0);
  template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
  template.resourceCountIs("AWS::ApiGatewayV2::Api", 0);
  template.resourceCountIs("AWS::ECS::TaskDefinition", 1);
  template.hasResourceProperties("AWS::ECS::TaskDefinition", {
    Cpu: "4096", Memory: "16384",
    RuntimePlatform: { CpuArchitecture: "X86_64", OperatingSystemFamily: "LINUX" },
  });
  for (const group of Object.values(template.findResources("AWS::EC2::SecurityGroup"))) {
    expect(group.Properties.SecurityGroupIngress ?? []).toHaveLength(0);
  }
  expect(() => app.synth()).not.toThrow();
});
