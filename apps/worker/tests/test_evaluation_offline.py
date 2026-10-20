import json
import socket
from pathlib import Path

import boto3
import pytest
from evaluation.model_cache import (
    BASE_REPO,
    CHECKPOINT_REPO,
    REPOSITORIES,
    CacheError,
    verify_cache,
)
from evaluation.offline import offline_only
from evaluation.runner import evaluate

CASES = Path(__file__).parents[1] / "evaluation/cases"


def test_socket_and_aws_client_creation_are_denied():
    with offline_only():
        with socket.socket() as sock, pytest.raises(PermissionError):
            sock.connect(("127.0.0.1", 9))
        with pytest.raises(PermissionError):
            socket.getaddrinfo("example.com", 443)
        with pytest.raises(PermissionError):
            boto3.client("s3")
        with pytest.raises(PermissionError):
            boto3.Session().client("bedrock-runtime")


def test_fake_finishes_inside_network_and_aws_denial(tmp_path):
    with offline_only():
        assert evaluate(CASES, tmp_path / "run") == 0
    manifest = json.loads((tmp_path / "run/manifest.json").read_text())
    assert manifest["load_seconds"] == 0.0 and manifest["model_identity"] is None


def test_missing_cache_does_not_download_or_substitute_a_fake(tmp_path):
    with offline_only(), pytest.raises(CacheError):
        verify_cache(tmp_path / "missing")
    out = tmp_path / "run"
    assert evaluate(CASES, out, backend="decider", cache=tmp_path / "missing") == 3
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["status"] == "partial" and manifest["error_class"] == "cache_error"
    assert all(
        json.loads(line)["status"] == "not_run"
        for line in (out / "trials.jsonl").read_text().splitlines()
    )


def test_supervisor_stops_a_stuck_child_and_marks_unexecuted_trials(tmp_path):
    out = tmp_path / "timeout"
    assert evaluate(CASES, out, max_seconds=2, test_delay=10) == 4
    manifest = json.loads((out / "manifest.json").read_text())
    rows = [json.loads(line) for line in (out / "trials.jsonl").read_text().splitlines()]
    assert manifest["status"] == "partial" and manifest["stop_reason"] == "timeout"
    assert manifest["elapsed_seconds"] < 5
    assert len(rows) == 10 and all(r["status"] in {"timeout", "not_run"} for r in rows)


def local_cache(tmp_path):
    import hashlib

    paths = {
        repo: tmp_path / ("models--" + repo.replace("/", "--")) / "snapshots" / rev
        for repo, rev in REPOSITORIES.items()
    }
    for path in paths.values():
        path.mkdir(parents=True)
    checkpoint, base = paths[CHECKPOINT_REPO], paths[BASE_REPO]
    (checkpoint / "lora").mkdir()
    payloads = {
        "head.safetensors": b"head",
        "lora/adapter_model.safetensors": b"adapter",
        "tokenizer.json": b"{}",
        "tokenizer_config.json": b"{}",
        "strands_decider_config.json": json.dumps(
            dict(base_model=BASE_REPO, use_lora=True)
        ).encode(),
        "lora/adapter_config.json": json.dumps(dict(base_model_name_or_path=BASE_REPO)).encode(),
    }
    for name, data in payloads.items():
        (checkpoint / name).write_bytes(data)
    (checkpoint / "MANIFEST.sha256").write_text(
        "\n".join(f"{hashlib.sha256(data).hexdigest()}  {name}" for name, data in payloads.items())
    )
    (base / "config.json").write_text("{}")
    (base / "model.safetensors.index.json").write_text(
        json.dumps(dict(weight_map={"x": "model.safetensors"}))
    )
    # Simulate Hub -> LFS blob -> shared store, where the final key is not the LFS hash.
    shared = tmp_path / ("a" * 64)
    shared.write_bytes(b"base-weights")
    blobs = base.parents[1] / "blobs"
    blobs.mkdir()
    lfs = blobs / hashlib.sha256(shared.read_bytes()).hexdigest()
    lfs.symlink_to(shared)
    (base / "model.safetensors").symlink_to(lfs)
    refs = base.parents[1] / "refs"
    refs.mkdir()
    (refs / "main").write_text(REPOSITORIES[BASE_REPO])
    return checkpoint, base


def test_verifies_pinned_cache_even_with_two_level_blob_links(tmp_path):
    local_cache(tmp_path)
    _, identity = verify_cache(tmp_path)
    assert identity["revisions"] == REPOSITORIES
    assert "base/model.safetensors" in identity["file_sha256"]


@pytest.mark.parametrize("problem", ["revision", "missing_adapter", "bad_digest"])
def test_rejects_wrong_revision_or_incomplete_tampered_adapter(tmp_path, problem):
    checkpoint, base = local_cache(tmp_path)
    if problem == "revision":
        (base.parents[1] / "refs/main").write_text("wrong-revision")
    elif problem == "missing_adapter":
        (checkpoint / "lora/adapter_model.safetensors").unlink()
    else:
        (checkpoint / "head.safetensors").write_bytes(b"changed")
    with pytest.raises(CacheError):
        verify_cache(tmp_path)
