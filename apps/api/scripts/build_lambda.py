"""Build the Lambda deployment folder (CDK zips it): app code + pinned dependencies + contract.

    uv run python scripts/build_lambda.py [DEST]        # default: apps/api/build/lambda

* Dependencies come from ``uv.lock`` (``uv export``), installed as binary wheels for the Lambda
  runtime (Linux x86_64, Python 3.12), never for this machine.
* boto3/botocore/s3transfer are left out: the Lambda Python runtime already provides them.
* ``photoprep_common`` (a path dependency) and ``photoprep_api`` are copied from source.
* The OpenAPI contract is copied next to the code (``photoprep_api/spec``): the app loads its
  routes and validation from it at start-up.
* The result is verified (required files and packages, no foreign-platform binaries, no caches
  or tests, well under the size limit). A failed check stops the build.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

PYTHON_VERSION = "3.12"
PLATFORM = "x86_64-manylinux2014"
RUNTIME_PROVIDED = ("boto3", "botocore", "s3transfer")
LOCAL_PACKAGES = ("photoprep-common",)
# Lambda allows 250 MB unzipped (262,144,000 bytes); keep a safety margin.
MAX_UNZIPPED_BYTES = 200 * 1024 * 1024

REQUIRED_FILES = (
    "photoprep_api/lambda_handler.py",
    "photoprep_api/ops/dispatch.py",
    "photoprep_api/ops/sweeper.py",
    "photoprep_api/ops/worker_control.py",
    "photoprep_api/spec/openapi.yaml",
    "photoprep_common/store.py",
)
REQUIRED_PACKAGES = ("connexion", "mangum", "flask", "starlette", "yaml")

_EXTENSION = re.compile(r"\.(so|pyd|dylib)$")
_THIS_PLATFORM = re.compile(rf"cpython-{PYTHON_VERSION.replace('.', '')}-x86_64-linux-gnu\.so$")
_ABI3 = re.compile(r"\.abi3\.so$")


class PackageError(Exception):
    pass


def export_command(project: Path, output: Path | None = None) -> list[str]:
    command = [
        "uv",
        "export",
        "--project",
        str(project),
        "--frozen",
        "--no-dev",
        "--no-hashes",
        "--no-emit-project",
    ]
    for name in (*LOCAL_PACKAGES, *RUNTIME_PROVIDED):
        command += ["--no-emit-package", name]
    if output is not None:
        command += ["-o", str(output)]
    return command


def install_command(requirements: Path, target: Path) -> list[str]:
    return [
        "uv",
        "pip",
        "install",
        "--target",
        str(target),
        "-r",
        str(requirements),
        "--python-platform",
        PLATFORM,
        "--python-version",
        PYTHON_VERSION,
        "--only-binary",
        ":all:",
        "--no-deps",
    ]


def verify_package(root: Path) -> list[str]:
    problems: list[str] = []
    for rel in REQUIRED_FILES:
        if not (root / rel).is_file():
            problems.append(f"missing file: {rel}")
    for package in REQUIRED_PACKAGES:
        if not (root / package / "__init__.py").is_file():
            problems.append(f"missing dependency: {package}")
    total = 0
    for path in root.rglob("*"):
        if path.is_file():
            total += path.stat().st_size
            if _EXTENSION.search(path.name) and not (
                _THIS_PLATFORM.search(path.name) or _ABI3.search(path.name)
            ):
                problems.append(
                    f"binary not for Lambda (Linux x86_64, Python {PYTHON_VERSION}): {path.name}"
                )
        elif path.name == "__pycache__":
            problems.append(f"cache folder shipped: {path.relative_to(root)}")
        elif path.name == "tests" and path.is_dir():
            problems.append(f"tests folder shipped: {path.relative_to(root)}")
    if total > MAX_UNZIPPED_BYTES:
        used, limit = total // 1_048_576, MAX_UNZIPPED_BYTES // 1_048_576
        problems.append(f"size {used} MB is over the {limit} MB budget")
    return problems


def _prune(root: Path) -> None:
    for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and path.name in ("__pycache__", "tests", "test"):
            shutil.rmtree(path, ignore_errors=True)
    for path in root.rglob("*.pyc"):
        path.unlink(missing_ok=True)


def build(
    dest: Path,
    run: Callable = subprocess.run,
    repo: Path | None = None,
) -> Path:
    repo = repo or Path(__file__).resolve().parents[3]
    api = repo / "apps" / "api"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as tmp:
        requirements = Path(tmp) / "requirements.txt"
        run(export_command(api, requirements), check=True)
        run(install_command(requirements, dest), check=True)
    shutil.copytree(api / "src" / "photoprep_api", dest / "photoprep_api", dirs_exist_ok=True)
    shutil.copytree(
        repo / "packages" / "photoprep-common" / "src" / "photoprep_common",
        dest / "photoprep_common",
        dirs_exist_ok=True,
    )
    spec = dest / "photoprep_api" / "spec"
    spec.mkdir(parents=True, exist_ok=True)
    shutil.copy2(repo / "packages" / "api-spec" / "openapi.yaml", spec / "openapi.yaml")
    _prune(dest)
    problems = verify_package(dest)
    if problems:
        raise PackageError("\n".join(problems))
    return dest


def main() -> int:  # pragma: no cover - command line entry
    default = Path(__file__).resolve().parents[1] / "build" / "lambda"
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    try:
        build(dest)
    except PackageError as err:
        print(f"Package check failed:\n{err}", file=sys.stderr)
        return 1
    size = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file()) / 1_048_576
    print(f"OK: {dest} ({size:.0f} MB unzipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
