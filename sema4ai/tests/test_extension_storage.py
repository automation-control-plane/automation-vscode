"""Isolated extension storage behavior; no RCC builds or real vendor records."""

import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
from types import SimpleNamespace
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


@pytest.mark.parametrize(
    ("override", "value", "expected"),
    [
        ("AUTOMATION_EXTENSION_STORAGE", "relative-owned", "relative-owned"),
        ("ROBOCORP_CODE_USER_HOME", "legacy-base", "legacy-base/.automation-vscode"),
    ],
)
def test_editor_bound_relative_storage_is_shared_across_editor_and_workload_cwds(
    tmp_path, override, value, expected
):
    editor = tmp_path / "editor"
    workload = tmp_path / "workload"
    editor.mkdir()
    workload.mkdir()
    env = {
        key: value
        for key, value in os.environ.items()
        if key in ("PATH", "PYTHONPATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL")
    }
    env["PYTHONPATH"] = os.pathsep.join(
        [str(Path(__file__).parents[1] / "src"), env.get("PYTHONPATH", "")]
    )
    env[override] = value
    node = shutil.which("node")
    assert node, "Node.js is required for the editor-side storage boundary test"
    module = Path(__file__).parents[1] / "vscode-client/out/extensionStorage"
    code = """
const fs = require('fs'), path = require('path');
const storage = require(process.argv[1]);
storage.initializeExtensionStorage('unused');
storage.createActionInputDirectory().then(directory => {
  const input = path.join(directory, 'input.json');
  fs.writeFileSync(input, '{\"typed\":true}');
  console.log(JSON.stringify({root: storage.getExtensionStorage(), input}));
});
"""
    editor_result = subprocess.run(
        [str(node), "-e", code, str(module)],
        cwd=editor,
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    paths = json.loads(editor_result.stdout)
    bound_root = Path(paths["root"])
    input_file = Path(paths["input"])
    assert bound_root.is_absolute()
    assert input_file.is_absolute()
    assert bound_root == (editor / expected).resolve()
    assert json.loads(input_file.read_text()) == {"typed": True}

    workload_env = {**env, "AUTOMATION_EXTENSION_STORAGE": str(bound_root)}
    workload_code = """
import json
from pathlib import Path
from sema4ai_code.storage import extension_storage, storage_directory
root = extension_storage()
cache = storage_directory('cache')
print(json.dumps({'root': str(root), 'cache': str(cache)}))
"""
    workload_result = subprocess.run(
        [sys.executable, "-B", "-c", workload_code],
        cwd=workload,
        env=workload_env,
        text=True,
        capture_output=True,
        check=True,
    )
    result = json.loads(workload_result.stdout)
    assert Path(result["root"]) == bound_root
    assert Path(result["cache"]) == bound_root / "cache"
    assert input_file.is_file()


@pytest.mark.parametrize(
    ("key", "value", "suffix"),
    [
        ("AUTOMATION_EXTENSION_STORAGE", "relative-owned", "relative-owned"),
        ("ROBOCORP_CODE_USER_HOME", "legacy-base", "legacy-base/.automation-vscode"),
    ],
)
def test_standalone_python_resolves_relative_storage_to_absolute(monkeypatch, tmp_path, key, value, suffix):
    monkeypatch.chdir(tmp_path)
    assert extension_storage({key: value}) == (tmp_path / suffix).resolve()


def test_oauth_storage_preserves_exact_legacy_state_and_keeps_new_state_outside_cleanup(
    monkeypatch, tmp_path
):
    from sema4ai_code._language_server_oauth2 import _OAuth2
    from sema4ai_code.rcc import Rcc
    from sema4ai_ls_core.config import Config

    class Provider:
        config = Config()

    provider = Provider()
    flow = _OAuth2.__new__(_OAuth2)
    flow._rcc = Rcc(provider)
    flow._get_redirect_uri = lambda requires_https: (12345, "http")

    legacy_home = tmp_path / "legacy-actions"
    monkeypatch.setenv("ACTIONS_HOME", str(legacy_home))
    monkeypatch.setenv("ROBOTS_HOME", str(tmp_path / "robots"))
    monkeypatch.setenv("AUTOMATION_EXTENSION_STORAGE", str(tmp_path / "extension-storage"))
    legacy = legacy_home / ".sema4ai_code" / "oauth2"
    legacy_cwd = legacy / "cwd"
    legacy_datadir = legacy / "datadir"
    legacy_cwd.mkdir(parents=True)
    legacy_datadir.mkdir()
    reference = legacy_cwd / ".vscode_reference_id"
    reference.write_text("existing-synthetic-reference")
    private_record = legacy_datadir / "private-synthetic-record"
    private_record.write_text("synthetic-only")
    legacy_data = flow._collect_info({}, tmp_path / "oauth2.yaml")
    assert legacy_data.cwd == legacy_cwd
    assert legacy_data.datadir == legacy_datadir
    assert flow._get_reference_id(
        legacy_data.cwd, SimpleNamespace(create_reference_id=lambda: "must-not-replace")
    ) == "existing-synthetic-reference"
    assert private_record.read_text() == "synthetic-only"

    new_home = tmp_path / "new-actions"
    monkeypatch.setenv("ACTIONS_HOME", str(new_home))
    new_data = flow._collect_info({}, tmp_path / "oauth2.yaml")
    assert new_data.cwd.is_absolute() and new_data.datadir.is_absolute()
    assert new_data.cwd != legacy_cwd and new_data.datadir != legacy_datadir
    reference_id = flow._get_reference_id(
        new_data.cwd, SimpleNamespace(create_reference_id=lambda: "new-synthetic-reference")
    )
    assert reference_id == "new-synthetic-reference"
    assert (new_data.cwd / ".vscode_reference_id").read_text() == reference_id
    (new_data.datadir / "synthetic-persistent-record").write_text("recoverable")
    shutil.rmtree(runtime_metadata_directory(new_home), ignore_errors=True)
    assert (new_data.datadir / "synthetic-persistent-record").read_text() == "recoverable"
    assert not (new_home / ".sema4ai_code").exists()

    other_home = tmp_path / "other-actions"
    monkeypatch.setenv("ACTIONS_HOME", str(other_home))
    other_data = flow._collect_info({}, tmp_path / "oauth2.yaml")
    assert other_data.cwd != new_data.cwd
    assert other_data.datadir != new_data.datadir
    assert not (other_data.cwd / ".vscode_reference_id").exists()


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
