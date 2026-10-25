import importlib.util
from pathlib import Path
import sys

import pytest


@pytest.fixture
def builder():
    path = Path(__file__).parents[2] / "bin/create_env/build_environment.py"
    spec = importlib.util.spec_from_file_location("environment_builder", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_modified_rcc_is_rejected_before_execution(builder, tmp_path, monkeypatch):
    rcc = tmp_path / "rcc"
    rcc.write_bytes(b"not the pinned executable")
    monkeypatch.setattr(builder.subprocess, "run", lambda *a, **k: pytest.fail("Unverified binary executed"))
    with pytest.raises(RuntimeError, match="SHA256"):
        builder.build_environment(rcc, tmp_path / "new-build", check_only=True)


def test_build_never_reuses_owner_directory(builder, tmp_path):
    existing = tmp_path / "existing"
    existing.mkdir()
    (existing / "owner.txt").write_text("retain")
    with pytest.raises(FileExistsError):
        builder.build_environment(Path(sys.executable), existing, check_only=True)
    assert (existing / "owner.txt").read_text() == "retain"


def test_supported_platforms_only(builder):
    assert builder.target("linux", "x86_64") == ("linux-x64", "linux_amd64")
    assert builder.target("win32", "AMD64") == ("win32-x64", "windows_amd64")
    assert builder.target("darwin", "arm64") == ("darwin-arm64", "darwin_arm64")
    with pytest.raises(RuntimeError, match="Unsupported"):
        builder.target("linux", "arm64")


def test_build_has_no_vendor_upload_or_shared_holotree_path():
    root = Path(__file__).parents[3]
    for path in (root / "sema4ai/bin/create_env/build_environment.py",):
        source = path.read_text()
        for forbidden in ("cdn.sema4.ai", "downloads.robocorp.com", "--sema4ai", '"--enable"', "configure-aws-credentials", "robocorp.tasks"):
            assert forbidden not in source


@pytest.mark.skip(reason="Retiring the existing vendor CI workflow requires owner approval after automatic review rejected a workflow change. No hosted run is authorized.")
def test_retired_vendor_workflow():
    root = Path(__file__).parents[3]
    assert not (root / ".github/workflows/build_environments.yaml").exists()


def test_default_development_locks_do_not_install_vendor_test_logger():
    root = Path(__file__).parents[3]
    for project in ("sema4ai", "sema4ai-python-ls-core"):
        for filename in ("pyproject.toml", "poetry.lock"):
            content = (root / project / filename).read_text()
            assert "robocorp-log-pytest" not in content
            if project == "sema4ai-python-ls-core":
                assert "robocorp-log" not in content


def test_published_core_transitive_dependency_is_not_silently_rewritten():
    import tomllib
    root = Path(__file__).parents[2]
    lock = tomllib.loads((root / "poetry.lock").read_text())
    core = next(package for package in lock["package"] if package["name"] == "actions-core")
    assert core["version"] == "1.0.3"
    # The published SDK owns this constraint; removing it needs a new upstream
    # publication/owner decision, not a falsified consumer lock or no-deps install.
    assert core["dependencies"]["robocorp-log"] == ">=2.4,<4"
    assert core["dependencies"]["robocorp-truststore"] == ">=0.8.0"
