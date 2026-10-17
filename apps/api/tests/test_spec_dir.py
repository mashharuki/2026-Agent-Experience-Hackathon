"""The Lambda package is shallow (/var/task/...): importing must not assume the repo layout."""

import pathlib

from photoprep_api.app import repo_spec_dir, resolve_spec_dir


def test_repo_spec_dir_is_none_in_a_shallow_package_instead_of_failing():
    assert repo_spec_dir(pathlib.PurePosixPath("/var/task/photoprep_api/app.py")) is None


def test_repo_spec_dir_finds_the_repository_contract():
    path = pathlib.PurePosixPath("/repo/apps/api/src/photoprep_api/app.py")
    assert repo_spec_dir(path) == pathlib.PurePosixPath("/repo/packages/api-spec")


def test_spec_dir_resolves_from_the_repository():
    assert (resolve_spec_dir() / "openapi.yaml").is_file()
