"""Verify the two pinned snapshots before importing/loading any model."""

import json
import os
from pathlib import Path

from .schemas import sha256

REPOSITORIES = {
    "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610": "216d1ccb46a9e9b036eb9187b248db98480f77d4",
    "Qwen/Qwen3.5-2B-Base": "b1485b2fa6dfa1287294f269f5fb618e03d52d7c",
}
CHECKPOINT_REPO, BASE_REPO = REPOSITORIES


class CacheError(ValueError):
    pass


def verify_cache(hub: Path) -> tuple[Path, dict]:
    try:
        snapshots = {
            repo: hub / ("models--" + repo.replace("/", "--")) / "snapshots" / rev
            for repo, rev in REPOSITORIES.items()
        }
        checkpoint, base = snapshots.values()
        base_ref = hub / ("models--" + BASE_REPO.replace("/", "--")) / "refs/main"
        if base_ref.read_text().strip() != REPOSITORIES[BASE_REPO]:
            raise CacheError("base_revision_mismatch")
        config = json.loads((checkpoint / "strands_decider_config.json").read_text())
        adapter = json.loads((checkpoint / "lora/adapter_config.json").read_text())
        if (
            config["base_model"] != BASE_REPO
            or not config["use_lora"]
            or adapter["base_model_name_or_path"] != BASE_REPO
        ):
            raise CacheError("adapter_config_mismatch")
        required = [
            "head.safetensors",
            "lora/adapter_model.safetensors",
            "lora/adapter_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "strands_decider_config.json",
        ]
        expected = {}
        for line in (checkpoint / "MANIFEST.sha256").read_text().splitlines():
            digest, name = line.split(maxsplit=1)
            expected[name.strip()] = digest
        hashes = {}
        for name in required:
            digest = sha256(checkpoint / name)
            if digest != expected[name]:
                raise CacheError("checkpoint_digest_mismatch")
            hashes[f"checkpoint/{name}"] = digest
        index = json.loads((base / "model.safetensors.index.json").read_text())
        names = sorted(set(index["weight_map"].values()))
        if not names or any(Path(n).name != n or not n.endswith(".safetensors") for n in names):
            raise CacheError("base_weight_index_invalid")
        for name in ["config.json", "model.safetensors.index.json", *names]:
            path = base / name
            digest = sha256(path)
            # Hub blobs can themselves point into a shared content-addressed store.
            # The snapshot's first link names the LFS SHA-256, not the final store key.
            if (
                path.is_symlink()
                and len(path.readlink().name) == 64
                and path.readlink().name != digest
            ):
                raise CacheError("base_digest_mismatch")
            hashes[f"base/{name}"] = digest
        return checkpoint, {"revisions": REPOSITORIES, "file_sha256": hashes}
    except (OSError, KeyError, json.JSONDecodeError, ValueError) as exc:
        raise CacheError("local_cache_invalid") from exc


def load_local(hub: Path, threads: int, seed: int):
    from .offline import configure_offline

    configure_offline()
    os.environ["HF_HUB_CACHE"] = str(hub)
    os.environ["HF_HOME"] = str(hub.parent)
    checkpoint, identity = verify_cache(hub)
    import random

    import numpy as np
    import torch
    from strands_decider.infer import load_engine

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    return load_engine(str(checkpoint), device="cpu", use_prefix_cache=False), identity
