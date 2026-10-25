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


def test_vendor_metrics_are_not_sent_by_default(monkeypatch):
    from sema4ai_code.rcc import Rcc

    provider = Provider({})
    rcc = Rcc(provider)
    calls = []
    monkeypatch.setattr(rcc, "_run_rcc", lambda *args, **kwargs: calls.append(args))
    assert rcc.feedack_metric("synthetic").success
    assert calls == []


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
        assert args[args.index("--controller") + 1] == "AutomationCode"
        assert env["ROBOCORP_HOME"] == env[f"{kind.upper()}_HOME"]
        assert env["RCC_HOLOTREE_MODE"] == "private"
        assert rcc.get_robocorp_code_datadir(kind).parent == Path(env["ROBOCORP_HOME"])
    assert captured[0][1]["ROBOCORP_HOME"] != captured[1][1]["ROBOCORP_HOME"]
    # Explicit legacy Robot compatibility retains its own credential home.
    provider.config.update({"sema4ai.rcc.location": str(executable), "sema4ai.legacyVendorIntegrations.enabled": True})
    for args in (["cloud", "workspace"], ["config", "credentials", "--json"]):
        assert rcc._run_rcc(args).success
        assert captured[-1][1]["ROBOCORP_HOME"] == str(tmp_path / "r")
    assert rcc._run_rcc(["cloud", "workspace"], kind="actions").success
    assert captured[-1][1]["ROBOCORP_HOME"] == str(tmp_path / "a")


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


def test_oauth_callback_state_and_browser_cache_respect_actions_home(
    monkeypatch, tmp_path
):
    from sema4ai_code.vendored_deps.url_callback_server import (
        _get_action_server_user_sema4_path,
    )
    from sema4ai_code.playwright.robocorp_browser._engines import browsers_path

    monkeypatch.setenv("ACTIONS_HOME", str(tmp_path / "a"))
    monkeypatch.setenv("ROBOTS_HOME", str(tmp_path / "r"))
    monkeypatch.delenv("PLAYWRIGHT_BROWSERS_PATH", raising=False)
    _get_action_server_user_sema4_path.cache_clear()
    browsers_path.cache_clear()
    try:
        assert _get_action_server_user_sema4_path() == tmp_path / "a" / "action-server"
        assert browsers_path() == tmp_path / "a" / "playwright"
        monkeypatch.setenv(
            "PLAYWRIGHT_BROWSERS_PATH", str(tmp_path / "operator-browser-cache")
        )
        browsers_path.cache_clear()
        assert browsers_path() == tmp_path / "operator-browser-cache"
    finally:
        _get_action_server_user_sema4_path.cache_clear()
        browsers_path.cache_clear()


def test_action_run_output_never_deletes_or_reuses_existing_data(tmp_path):
    from sema4ai_code.robo.launch_actions import create_and_rotate_directories

    for index in range(1, 24):
        directory = tmp_path / f"run-{index}"
        directory.mkdir()
        (directory / "owner-data.txt").write_text(str(index))
    selected = Path(create_and_rotate_directories(str(tmp_path), "run", max_count=20))
    assert selected.name == "run-24"
    assert len(list(tmp_path.iterdir())) == 24
    assert (tmp_path / "run-1/owner-data.txt").read_text() == "1"


def test_operator_browser_executable_is_used_without_downloading(monkeypatch, tmp_path):
    from sema4ai_code.playwright.robocorp_browser import _context

    executable = tmp_path / "browser"
    executable.touch()
    calls = []

    class BrowserType:
        def launch(self, **kwargs):
            calls.append(kwargs)
            return "operator-browser"

    monkeypatch.setenv("AUTOMATION_BROWSER_EXECUTABLE", str(executable))
    monkeypatch.setattr(_context, "_browser_type", lambda: BrowserType())
    monkeypatch.setattr(
        _context, "browser_type_launch_args", lambda: {"headless": True}
    )
    launcher = _context._browser_launcher.__wrapped__()
    assert launcher() == "operator-browser"
    assert calls == [{"headless": True, "executable_path": str(executable)}]
    executable.unlink()
    with pytest.raises(RuntimeError, match="Configured browser executable"):
        launcher()


def test_package_build_creates_output_and_never_forces_zip_override(
    monkeypatch, tmp_path
):
    import json
    from types import SimpleNamespace
    from sema4ai_code.action_server import ActionServer

    class Endpoint:
        pass

    provider, endpoint = Provider({}), Endpoint()
    server = ActionServer(provider, endpoint)
    captured = []

    def run(args, **kwargs):
        captured.append(args)
        return SimpleNamespace(
            success=True, result=json.dumps({"package_path": "new.zip"})
        )

    monkeypatch.setattr(server, "_run_action_server_command", run)
    output = tmp_path / "new-output"
    assert server.package_build(str(tmp_path), str(output)).success
    assert output.is_dir()
    assert "--override" not in captured[0]
