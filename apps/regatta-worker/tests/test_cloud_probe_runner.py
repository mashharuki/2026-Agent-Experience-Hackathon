import argparse
import json

import pytest

import run_cloud_probe


def setup(monkeypatch, tmp_path, stopped=True, initially_missing=False):
    class Ecs:
        stopped_by_runner = False
        reads = 0

        def run_task(self, **kwargs):
            assert kwargs["count"] == 1
            assert (
                kwargs["networkConfiguration"]["awsvpcConfiguration"]["assignPublicIp"] == "ENABLED"
            )
            return {"tasks": [{"taskArn": "task/probe"}]}

        def describe_tasks(self, **_kwargs):
            self.reads += 1
            if initially_missing and self.reads == 1:
                return {"tasks": [], "failures": [{"reason": "MISSING"}]}
            return {
                "tasks": [
                    {
                        "lastStatus": "STOPPED" if stopped else "RUNNING",
                        "cpu": "4096",
                        "memory": "16384",
                        "containers": [{"exitCode": 0}],
                    }
                ]
            }

        def stop_task(self, **_kwargs):
            self.stopped_by_runner = True

    class Logs:
        def get_log_events(self, **_kwargs):
            return {"events": [{"message": json.dumps({"report": {"count": 100}})}]}

    ecs = Ecs()
    logs = Logs()

    class Session:
        def client(self, name, **_kwargs):
            return ecs if name == "ecs" else logs

    monkeypatch.setattr(run_cloud_probe.boto3, "Session", lambda **_kwargs: Session())
    outputs = tmp_path / "outputs.json"
    outputs.write_text(
        json.dumps(
            {
                "RegattaProbeStack": {
                    "ClusterOutput": "cluster",
                    "TaskDefinitionOutput": "definition",
                    "SubnetOutput": "subnet",
                    "SecurityGroupOutput": "sg",
                    "LogGroupOutput": "logs",
                }
            }
        )
    )
    args = argparse.Namespace(
        outputs=outputs,
        profile="test",
        state=tmp_path / "state.json",
        report=tmp_path / "report.json",
        threads=4,
        count=100,
    )
    return args, ecs


def test_records_evidence_only_after_task_stops(monkeypatch, tmp_path):
    args, ecs = setup(monkeypatch, tmp_path)
    run_cloud_probe.run(args)
    assert json.loads(args.report.read_text())["ecsStopped"] is True
    assert not ecs.stopped_by_runner
    assert args.state.with_suffix(".evidence.json").is_file()


def test_timeout_requests_cleanup_and_does_not_invent_report(monkeypatch, tmp_path):
    args, ecs = setup(monkeypatch, tmp_path, stopped=False)
    times = iter([0, 1801])
    monkeypatch.setattr(run_cloud_probe.time, "monotonic", lambda: next(times))
    with pytest.raises(TimeoutError):
        run_cloud_probe.run(args)
    assert ecs.stopped_by_runner
    assert not args.report.exists()


def test_waits_for_ecs_eventual_consistency(monkeypatch, tmp_path):
    args, ecs = setup(monkeypatch, tmp_path, initially_missing=True)
    monkeypatch.setattr(run_cloud_probe.time, "sleep", lambda _seconds: None)
    run_cloud_probe.run(args)
    assert ecs.reads == 2
    assert json.loads(args.report.read_text())["ecsStopped"] is True
