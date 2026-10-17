"""Download the Decider checkpoint and its base weights at image build time.

The model loader otherwise fetches ``Qwen/Qwen3.5-2B-Base`` from the Hub on first use. The
worker must not download anything at run time (offline, reproducible, no cold-start
download), so both repositories are fetched here and the resolved commit is checked
against the revision this release was tested with. If the Hub's ``main`` has moved, the
build fails instead of silently shipping untested weights; update the pins deliberately
after re-running the tests (including ``RUN_REAL_DECIDER=1``).
"""

import pathlib
import sys

from huggingface_hub import snapshot_download

PINNED = {
    "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610": "216d1ccb46a9e9b036eb9187b248db98480f77d4",
    "Qwen/Qwen3.5-2B-Base": "b1485b2fa6dfa1287294f269f5fb618e03d52d7c",
}


def main() -> int:
    failed = False
    for repo, expected in PINNED.items():
        # "main" (not the sha) so the cache also gets refs/main, which the loader resolves.
        path = pathlib.Path(snapshot_download(repo_id=repo, revision="main"))
        resolved = path.name
        status = "ok" if resolved == expected else f"MISMATCH (got {resolved})"
        print(f"{repo}: {expected} {status}")
        failed |= resolved != expected
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
