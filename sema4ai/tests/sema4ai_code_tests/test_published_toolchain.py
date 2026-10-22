import os
from pathlib import Path

import pytest

from sema4ai_code.runtime_paths import runtime_homes


def test_default_homes_are_separate():
    assert runtime_homes(environ={"HOME": "/operator"}, platform="linux") == {
        "actions": Path("/operator/.actions"),
        "robots": Path("/operator/.robots"),
    }


def test_explicit_homes_take_precedence_over_legacy_settings():
    homes = runtime_homes(
        "/legacy", {"ACTIONS_HOME": "/a", "ROBOTS_HOME": "/r", "HOME": "/operator"}
    )
    assert homes == {"actions": Path("/a"), "robots": Path("/r")}


def test_legacy_root_is_partitioned():
    assert runtime_homes("/legacy", {"HOME": "/operator"}) == {
        "actions": Path("/legacy/actions"),
        "robots": Path("/legacy/robots"),
    }


def test_colliding_home_aliases_fail_before_creating_data(tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(real, target_is_directory=True)
    with pytest.raises(ValueError, match="different directories"):
        runtime_homes(environ={"ACTIONS_HOME": str(real), "ROBOTS_HOME": str(alias)})
    assert list(real.iterdir()) == []


class Provider:
    def __init__(self, settings):
        from sema4ai_ls_core.config import Config

        self.config = Config()
        self.config.update(settings)


def test_rcc_process_routes_homes_and_supported_flags(monkeypatch, tmp_path):
    import subprocess
    from sema4ai_code.rcc import Rcc

    executable = tmp_path / "configured rcc"
    executable.touch()
    provider = Provider({"sema4ai.rcc.location": str(executable)})
    monkeypatch.setenv("ACTIONS_HOME", str(tmp_path / "a"))
    monkeypatch.setenv("ROBOTS_HOME", str(tmp_path / "r"))
    captured = []

    def execute(args, **kwargs):
        captured.append((args, kwargs["env"]))
        return b"v18.19.7"

    monkeypatch.setattr(subprocess, "check_output", execute)
    rcc = Rcc(provider)
    for kind in ("actions", "robots"):
        assert rcc._run_rcc(["version"], kind=kind).success
        args, env = captured[-1]
        assert args[0] == str(executable)
        assert "--robocorp" in args and "--sema4ai" not in args
        assert env["ROBOCORP_HOME"] == env[f"{kind.upper()}_HOME"]
        assert env["RCC_HOLOTREE_MODE"] == "private"
        assert rcc.get_robocorp_code_datadir(kind).parent == Path(env["ROBOCORP_HOME"])
    assert captured[0][1]["ROBOCORP_HOME"] != captured[1][1]["ROBOCORP_HOME"]


def test_missing_explicit_rcc_never_downloads(monkeypatch, tmp_path):
    from sema4ai_code.rcc import Rcc

    provider = Provider({"sema4ai.rcc.location": str(tmp_path / "missing")})
    with pytest.raises(RuntimeError, match="Configured RCC executable"):
        Rcc(provider).get_rcc_location()
    assert not list(tmp_path.iterdir())


@pytest.fixture
def pinned_download(monkeypatch):
    import hashlib
    import sema4ai_code.published_tools as published
    import sema4ai_ls_core.http as http

    content = b"verified release bytes"
    monkeypatch.setattr(
        published,
        "published_tool",
        lambda *a: {
            "version": "v18.19.7",
            "sha256": hashlib.sha256(content).hexdigest(),
            "url": "https://github.com/joshyorko/rcc/releases/download/v18.19.7/rcc-linux64",
        },
    )
    calls = []

    def download(url, target, **kwargs):
        calls.append(url)
        target.write_bytes(content)

    monkeypatch.setattr(http, "download_with_resume", download)
    return content, calls


def test_verified_download_admitted_once_and_existing_data_preserved(
    tmp_path, pinned_download
):
    from sema4ai_code.tools import download_tool, Tool

    content, calls = pinned_download
    target = tmp_path / "rcc"
    download_tool(Tool.RCC, str(target), "v18.19.7")
    download_tool(Tool.RCC, str(target), "v18.19.7")
    assert target.read_bytes() == content
    assert len(calls) == 1
    target.write_bytes(b"operator binary")
    with pytest.raises(RuntimeError, match="preserved"):
        download_tool(Tool.RCC, str(target), "v18.19.7", force=True)
    assert target.read_bytes() == b"operator binary"
    assert len(calls) == 1


def test_bad_digest_is_never_admitted(monkeypatch, tmp_path, pinned_download):
    import sema4ai_ls_core.http as http
    from sema4ai_code.tools import download_tool, Tool

    monkeypatch.setattr(
        http,
        "download_with_resume",
        lambda url, target, **kw: target.write_bytes(b"corrupt"),
    )
    with pytest.raises(RuntimeError, match="SHA-256"):
        download_tool(Tool.RCC, str(tmp_path / "rcc"), "v18.19.7")
    assert list(tmp_path.iterdir()) == []


def test_unsupported_architecture_has_no_vendor_fallback(monkeypatch):
    import platform
    from sema4ai_code.published_tools import published_tool

    monkeypatch.setattr(platform, "machine", lambda: "aarch64")
    with pytest.raises(RuntimeError, match="No published rcc artifact"):
        published_tool("rcc", "linux")


def test_package_creation_preserves_existing_data(tmp_path):
    from sema4ai_code.action_server import ActionServer
    from sema4ai_code.protocols import ActionResult

    provider = Provider({})

    class Endpoint:
        pass

    endpoint = Endpoint()
    server = ActionServer(provider, endpoint)
    server.get_version = lambda: ActionResult.make_success("1.0.4")
    target = tmp_path / "package.yaml"
    target.write_text("operator data")
    result = server.create_action_package(str(tmp_path), "minimal", "New")
    assert not result.success
    assert target.read_text() == "operator data"
