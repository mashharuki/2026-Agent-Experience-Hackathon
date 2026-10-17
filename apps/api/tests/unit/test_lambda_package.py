"""The Lambda deployment package: what goes in, what stays out, and that it can actually start.

The first version of the stack shipped only the source files, which would have failed on AWS
(no dependencies, and no OpenAPI file at the path the app looks for). These tests describe
a package that works.
"""

import os
import subprocess
from pathlib import Path

import build_lambda as bl
import pytest

REPO = Path(__file__).resolve().parents[4]


def touch(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def good_tree(root: Path) -> Path:
    for rel in bl.REQUIRED_FILES:
        touch(root / rel)
    for package in bl.REQUIRED_PACKAGES:
        touch(root / package / "__init__.py")
    touch(root / "pydantic_core" / "_x.cpython-312-x86_64-linux-gnu.so")
    return root


class TestPlan:
    def test_runtime_provided_and_local_packages_are_not_bundled(self):
        command = bl.export_command(Path("/proj"))
        for name in ("boto3", "botocore", "s3transfer", "photoprep-common"):
            i = command.index(name)
            assert command[i - 1] == "--no-emit-package"
        assert "--no-dev" in command and "--frozen" in command

    def test_wheels_are_for_the_lambda_runtime_not_this_machine(self):
        command = bl.install_command(Path("req.txt"), Path("/out"))
        assert command[command.index("--python-platform") + 1] == "x86_64-manylinux2014"
        assert command[command.index("--python-version") + 1] == "3.12"
        assert "--only-binary" in command and ":all:" in command  # never build from source here
        assert "--no-deps" in command  # the exported list is already complete and pinned


class TestVerify:
    def test_a_good_package_has_no_problems(self, tmp_path):
        assert bl.verify_package(good_tree(tmp_path)) == []

    @pytest.mark.parametrize("missing", list(bl.REQUIRED_FILES))
    def test_each_required_file_is_checked(self, tmp_path, missing):
        root = good_tree(tmp_path)
        (root / missing).unlink()
        assert any(missing in p for p in bl.verify_package(root))

    @pytest.mark.parametrize("missing", list(bl.REQUIRED_PACKAGES))
    def test_each_required_dependency_is_checked(self, tmp_path, missing):
        root = good_tree(tmp_path)
        (root / missing / "__init__.py").unlink()
        assert any(missing in p for p in bl.verify_package(root))

    @pytest.mark.parametrize(
        "name",
        [
            "_x.cpython-312-darwin.so",
            "_x.cpython-312-aarch64-linux-gnu.so",
            "_x.cpython-311-x86_64-linux-gnu.so",  # wrong Python version
            "_x.cp312-win_amd64.pyd",
        ],
    )
    def test_binaries_for_other_platforms_are_refused(self, tmp_path, name):
        root = good_tree(tmp_path)
        touch(root / "somepkg" / name)
        assert any(name in p for p in bl.verify_package(root))

    def test_the_package_must_stay_well_under_the_lambda_size_limit(self, tmp_path):
        root = good_tree(tmp_path)
        big = root / "big.bin"
        with big.open("wb") as handle:
            handle.truncate(bl.MAX_UNZIPPED_BYTES + 1)
        assert any("size" in p.lower() for p in bl.verify_package(root))

    def test_tests_and_caches_are_not_shipped(self, tmp_path):
        root = good_tree(tmp_path)
        touch(root / "somepkg" / "__pycache__" / "m.cpython-312.pyc")
        touch(root / "somepkg" / "tests" / "test_m.py")
        problems = " ".join(bl.verify_package(root))
        assert "__pycache__" in problems and "tests" in problems


class TestAssemble:
    def fake_run(self, calls):
        def run(command, **kwargs):
            calls.append(command)
            if command[:2] == ["uv", "export"]:
                Path(command[command.index("-o") + 1]).write_text("connexion==3.3.0\n")
            if command[:3] == ["uv", "pip", "install"]:
                target = Path(command[command.index("--target") + 1])
                for package in bl.REQUIRED_PACKAGES:
                    touch(target / package / "__init__.py")
                    touch(target / package / "__pycache__" / "x.pyc")
                touch(target / "pydantic_core" / "_x.cpython-312-x86_64-linux-gnu.so")
                touch(target / "connexion" / "tests" / "t.py")
            return subprocess.CompletedProcess(command, 0)

        return run

    def test_build_installs_copies_the_app_the_shared_package_and_the_spec(self, tmp_path):
        calls: list = []
        dest = tmp_path / "lambda"
        bl.build(dest, run=self.fake_run(calls), repo=REPO)
        assert (dest / "photoprep_api" / "lambda_handler.py").is_file()
        assert (dest / "photoprep_common" / "store.py").is_file()
        # The API loads its contract from here; without it the Lambda cannot start.
        assert (dest / "photoprep_api" / "spec" / "openapi.yaml").read_text() == (
            REPO / "packages/api-spec/openapi.yaml"
        ).read_text()
        assert bl.verify_package(dest) == []

    def test_build_removes_caches_and_test_folders(self, tmp_path):
        dest = tmp_path / "lambda"
        bl.build(dest, run=self.fake_run([]), repo=REPO)
        assert not list(dest.rglob("__pycache__"))
        assert not [p for p in dest.rglob("tests") if p.is_dir()]

    def test_build_starts_from_an_empty_folder(self, tmp_path):
        dest = tmp_path / "lambda"
        touch(dest / "stale_module.py")
        bl.build(dest, run=self.fake_run([]), repo=REPO)
        assert not (dest / "stale_module.py").exists()

    def test_build_refuses_to_continue_if_verification_fails(self, tmp_path):
        def run(command, **kwargs):  # installs nothing
            if command[:2] == ["uv", "export"]:
                Path(command[command.index("-o") + 1]).write_text("")
            return subprocess.CompletedProcess(command, 0)

        with pytest.raises(bl.PackageError):
            bl.build(tmp_path / "lambda", run=run, repo=REPO)


class TestAppFindsItsContract:
    def test_a_bundled_spec_next_to_the_code_is_used(self, tmp_path, monkeypatch):
        from photoprep_api import app as app_module

        (tmp_path / "spec").mkdir()
        (tmp_path / "spec" / "openapi.yaml").write_text("openapi: 3.0.3")
        monkeypatch.setattr(app_module, "_BUNDLED_SPEC_DIR", tmp_path / "spec")
        monkeypatch.delenv("PHOTOPREP_SPEC_DIR", raising=False)
        assert app_module.resolve_spec_dir() == tmp_path / "spec"

    def test_an_explicit_environment_setting_wins(self, tmp_path, monkeypatch):
        from photoprep_api import app as app_module

        monkeypatch.setenv("PHOTOPREP_SPEC_DIR", str(tmp_path))
        assert app_module.resolve_spec_dir() == tmp_path

    def test_in_the_repository_the_contract_is_found_without_any_setting(self, monkeypatch):
        from photoprep_api import app as app_module

        monkeypatch.delenv("PHOTOPREP_SPEC_DIR", raising=False)
        monkeypatch.setattr(app_module, "_BUNDLED_SPEC_DIR", Path("/nonexistent"))
        assert (app_module.resolve_spec_dir() / "openapi.yaml").is_file()


@pytest.mark.package
@pytest.mark.skipif(os.environ.get("RUN_PACKAGE_BUILD") != "1", reason="set RUN_PACKAGE_BUILD=1")
def test_the_real_package_builds_and_verifies(tmp_path):
    dest = tmp_path / "lambda"
    bl.build(dest)
    assert bl.verify_package(dest) == []
