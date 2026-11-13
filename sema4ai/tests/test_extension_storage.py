"""Isolated extension storage behavior; no RCC builds or real vendor records."""

import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
from types import SimpleNamespace

import pytest

from sema4ai_code.storage import extension_storage, runtime_metadata_directory


def test_explicit_legacy_and_platform_roots_are_resolved_without_creation(tmp_path):
    explicit = tmp_path / "explicit"
    legacy = tmp_path / "legacy"
    assert extension_storage({"AUTOMATION_EXTENSION_STORAGE": str(explicit), "ROBOCORP_CODE_USER_HOME": str(legacy)}) == explicit
    assert extension_storage({"ROBOCORP_CODE_USER_HOME": str(legacy)}) == legacy / ".automation-vscode"
    assert extension_storage({"HOME": str(tmp_path)}, platform="linux") == tmp_path / ".local" / "state" / "automation-vscode"
    assert extension_storage({"HOME": str(tmp_path), "XDG_STATE_HOME": str(tmp_path / "state")}, platform="linux") == tmp_path / "state" / "automation-vscode"
    assert extension_storage({"LOCALAPPDATA": str(tmp_path)}, platform="win32") == tmp_path / "automation-vscode"
    with pytest.raises(RuntimeError, match="LOCALAPPDATA"):
        extension_storage({}, platform="win32")
    assert not list(tmp_path.iterdir())


def _language_server_process(env, operation):
    # Constructor is the actual reported directory-creation boundary. It does
    # not bootstrap RCC or execute any user package.
    code = """
import io, json, sys
from sema4ai_code.robocorp_language_server import RobocorpLanguageServer
server = RobocorpLanguageServer(io.BytesIO(), io.BytesIO())
try:
    if sys.argv[1] == 'store':
        server._dir_cache.store('synthetic-storage-restart', {'value': 42})
    else:
        assert server._dir_cache.load('synthetic-storage-restart', dict) == {'value': 42}
    print(json.dumps({'cache': server._cache_dir}))
finally:
    server.m_shutdown()
    server.m_exit()
"""
    result = subprocess.run([sys.executable, "-c", code, operation], env=env, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return Path(json.loads(result.stdout)["cache"])


@pytest.mark.parametrize("override", ["default", "explicit", "legacy-base"])
def test_real_language_server_cache_restarts_preserve_legacy_and_vendor_data(tmp_path, override):
    home = tmp_path / "home"
    home.mkdir()
    legacy = home / ".sema4ai" / ".cache"
    legacy.mkdir(parents=True)
    private = legacy / "private-record.json"
    private.write_text('{"private":"synthetic-do-not-copy"}')
    vendor = home / ".sema4ai" / "sema4ai-studio"
    vendor.mkdir()
    marker = vendor / "external-api-server.pid"
    marker.write_text('{"synthetic":true}')
    before = {private: private.read_bytes(), marker: marker.read_bytes()}
    env = {key: value for key, value in os.environ.items() if key in ("PATH", "PYTHONPATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL")}
    env.update(HOME=str(home), USERPROFILE=str(home), LOCALAPPDATA=str(tmp_path / "local"), XDG_STATE_HOME=str(tmp_path / "state"))
    if override == "explicit":
        env["AUTOMATION_EXTENSION_STORAGE"] = str(tmp_path / "exact")
    elif override == "legacy-base":
        env["ROBOCORP_CODE_USER_HOME"] = str(tmp_path / "compat-base")
    expected = extension_storage(env) / "cache"
    assert _language_server_process(env, "store") == expected
    assert _language_server_process(env, "load") == expected
    assert {path: path.read_bytes() for path in before} == before
    assert set(legacy.iterdir()) == {private}
    assert not (expected / private.name).exists()
    assert list(home.iterdir()) == [home / ".sema4ai"]


def test_clean_language_server_startup_creates_no_vendor_home(tmp_path):
    env = {key: value for key, value in os.environ.items() if key in ("PATH", "PYTHONPATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL")}
    env.update(HOME=str(tmp_path), USERPROFILE=str(tmp_path), LOCALAPPDATA=str(tmp_path / "local"), XDG_STATE_HOME=str(tmp_path / "state"))
    _language_server_process(env, "store")
    assert not (tmp_path / ".sema4ai").exists()
    assert not (tmp_path / "local" / "sema4ai").exists()


def test_runtime_metadata_follows_selected_home_and_preserves_overrides(monkeypatch, tmp_path):
    from sema4ai_code.rcc import Rcc
    from sema4ai_ls_core.config import Config

    actions = tmp_path / "actions-override"
    robots = tmp_path / "robots-override"
    monkeypatch.setenv("ACTIONS_HOME", str(actions))
    monkeypatch.setenv("ROBOTS_HOME", str(robots))
    class Provider:
        config = Config()

    provider = Provider()
    rcc = Rcc(provider)
    assert rcc.get_robocorp_code_datadir("actions") == runtime_metadata_directory(actions)
    assert rcc.get_robocorp_code_datadir("robots") == runtime_metadata_directory(robots)
    assert not actions.exists() and not robots.exists()


@pytest.mark.parametrize("standalone", [False, True])
def test_action_artifacts_use_owned_storage_and_preserve_prior_runs(monkeypatch, tmp_path, standalone):
    from sema4ai_code.robo import action_runtime, launch_actions

    monkeypatch.setenv("AUTOMATION_EXTENSION_STORAGE", str(tmp_path / "owned"))
    monkeypatch.setenv("ROBOT_ARTIFACTS", "previous-synthetic-artifacts")
    monkeypatch.setenv("ROBOT_ROOT", "previous-synthetic-root")
    monkeypatch.delenv("SEMA4AI_VSCODE_X_ACTION_CONTEXT", raising=False)
    artifacts = []

    def run(args, **kwargs):
        destination = Path(os.environ["ROBOT_ARTIFACTS"])
        assert destination.parent == tmp_path / "owned" / "action-artifacts"
        (destination / "result.json").write_text('{"value":42}')
        artifacts.append(destination)
        return 0

    sdk = SimpleNamespace(__name__="actions", version_info=[1, 1, 0])
    loader = lambda: (sdk, SimpleNamespace(main=run))
    monkeypatch.setattr(action_runtime, "load_actions", loader)
    monkeypatch.setitem(sys.modules, "action_runtime", SimpleNamespace(load_actions=loader))
    monkeypatch.setattr(sys, "argv", [str(launch_actions.__file__), "run", "--action", "synthetic"])
    main = runpy.run_path(launch_actions.__file__)["main"] if standalone else launch_actions.main
    assert main() == 0
    assert main() == 0
    assert artifacts[0] != artifacts[1]
    assert [json.loads((directory / "result.json").read_text()) for directory in artifacts] == [{"value": 42}, {"value": 42}]
