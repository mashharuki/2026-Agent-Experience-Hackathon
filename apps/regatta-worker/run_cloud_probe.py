"""Run one ECS latency task, collect evidence, and stop it on timeout or interruption."""

import argparse
import json
import sys
import time
from pathlib import Path

import boto3
from botocore.config import Config


def run(args):
    outputs = json.loads(args.outputs.read_text())["RegattaProbeStack"]
    session = boto3.Session(profile_name=args.profile, region_name="ap-northeast-1")
    config = Config(retries={"total_max_attempts": 2}, connect_timeout=5, read_timeout=15)
    ecs = session.client("ecs", config=config)
    logs = session.client("logs", config=config)
    launched = ecs.run_task(
        cluster=outputs["ClusterOutput"],
        taskDefinition=outputs["TaskDefinitionOutput"],
        launchType="FARGATE",
        count=1,
        startedBy="regatta-bounded-probe",
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": [outputs["SubnetOutput"]],
                "securityGroups": [outputs["SecurityGroupOutput"]],
                "assignPublicIp": "ENABLED",
            }
        },
        overrides={
            "containerOverrides": [
                {
                    "name": "Probe",
                    "command": [
                        "python",
                        "cloud_probe.py",
                        "--threads",
                        str(args.threads),
                        "--count",
                        str(args.count),
                    ],
                }
            ]
        },
    )
    if launched.get("failures") or len(launched.get("tasks", [])) != 1:
        raise RuntimeError("ECS did not launch exactly one task")
    arn = launched["tasks"][0]["taskArn"]
    args.state.write_text(json.dumps({"taskArn": arn, "outputs": outputs}, indent=2))
    print("One bounded task launched; state saved locally.", flush=True)
    stopped = False
    try:
        deadline = time.monotonic() + 1800
        previous = None
        while time.monotonic() < deadline:
            response = ecs.describe_tasks(cluster=outputs["ClusterOutput"], tasks=[arn])
            # ECS is eventually consistent immediately after RunTask. A temporarily
            # missing task must not be mistaken for an inference or launch failure.
            if not response.get("tasks"):
                time.sleep(15)
                continue
            task = response["tasks"][0]
            if task["lastStatus"] != previous:
                previous = task["lastStatus"]
                print(f"ECS: {previous}", flush=True)
            if previous == "STOPPED":
                stopped = True
                break
            time.sleep(15)
        if not stopped:
            raise TimeoutError("Thirty-minute probe limit reached")
        container = task["containers"][0]
        stream = f"probe/Probe/{arn.rsplit('/', 1)[-1]}"
        # A bounded probe emits far less than CloudWatch's 1 MiB page.
        events = logs.get_log_events(
            logGroupName=outputs["LogGroupOutput"],
            logStreamName=stream,
            startFromHead=True,
        )["events"]
        reports = []
        for event in events:
            try:
                value = json.loads(event["message"])
            except json.JSONDecodeError:
                continue
            if "report" in value:
                reports.append(value["report"])
        private = {"task": task, "events": events}
        args.state.with_suffix(".evidence.json").write_text(json.dumps(private, default=str))
        if container.get("exitCode") != 0 or len(reports) != 1:
            raise RuntimeError("Probe failed; inspect the local evidence file")
        report = reports[0]
        report["ecsStopped"] = True
        report["taskCpu"] = task["cpu"]
        report["taskMemoryMiB"] = task["memory"]
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({k: v for k, v in report.items() if k != "results"}, indent=2))
    finally:
        if not stopped:
            ecs.stop_task(
                cluster=outputs["ClusterOutput"], task=arn, reason="Bounded probe cleanup"
            )
            print("Stop requested; confirm STOPPED using the saved local task state.", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--outputs", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--threads", type=int, choices=[4, 8, 16], default=4)
    parser.add_argument("--count", type=int, choices=range(1, 101), default=100)
    args = parser.parse_args()
    if args.state.exists():
        parser.error("state already exists; inspect its task before any new launch")
    try:
        run(args)
    except (RuntimeError, TimeoutError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
