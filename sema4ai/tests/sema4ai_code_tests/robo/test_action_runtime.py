"""Subprocess fixtures exercise resolver imports without the developer SDKs."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from sema4ai_code.robo import action_runtime


def sdk(root, name, *, owned=False, broken=False):
    package = root.joinpath(*name.split("."))
    package.mkdir(parents=True)
    if "." in name:
        package.parent.joinpath("__init__.py").write_text("")
    package.joinpath("__init__.py").write_text(
        "import missing_owned_dependency\n" if broken else
        "__version__ = '1.0.3'\nversion_info = [1, 0, 3]\n"
    )
    package.joinpath("cli.py").write_text(
        "def main(*args, **kwargs):\n    print('CLI:' + __package__)\n"
    )
    if owned:
        metadata = root / "actions_core-1.0.3.dist-info"
        metadata.mkdir()
        metadata.joinpath("METADATA").write_text("Name: actions-core\nVersion: 1.0.3\n")
        metadata.joinpath("RECORD").write_text("actions/__init__.py,,\nactions/cli.py,,\n")


def execute(root, script="action_runtime.py", args=("--library-version",), stdin=None):
    env = {**os.environ, "PYTHONPATH": str(root)}
    return subprocess.run(
        [sys.executable, "-S", str(Path(action_runtime.__file__).with_name(script)), *args],
        cwd=root, env=env, text=True, input=stdin, capture_output=True, timeout=10,
    )


@pytest.mark.parametrize("script,args", [
    ("action_runtime.py", ("--library-version",)),
    ("action_runtime.py", ("list",)),
    ("launch_actions.py", ("run",)),
])
def test_action_operations_reject_vendor_only_environment(tmp_path, script, args):
    for name in ("sema4ai.actions", "robocorp.actions"):
        sdk(tmp_path, name)
    result = execute(tmp_path, script, args)
    assert result.returncode != 0
    assert "actions-core==1.1.0" in result.stderr
    assert "package.yaml" in result.stderr
    assert "CLI:" not in result.stdout


def test_lint_exposes_owned_dependency_diagnostic(tmp_path):
    sdk(tmp_path, "sema4ai.actions")
    result = execute(tmp_path, "lint_in_target_env.py", (), "from actions import action\n")
    assert result.returncode == 0, result.stderr
    diagnostics = json.loads(result.stdout)
    assert diagnostics[0]["severity"] == 1
    assert "actions-core==1.1.0" in diagnostics[0]["message"]


def test_owned_sdk_is_used_when_vendor_sdks_also_exist(tmp_path):
    for name in ("sema4ai.actions", "robocorp.actions"):
        sdk(tmp_path, name)
    sdk(tmp_path, "actions", owned=True)
    result = execute(tmp_path)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "1.0.3"
    result = execute(tmp_path, args=("list",))
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "CLI:actions"


def test_broken_owned_sdk_never_falls_back(tmp_path):
    sdk(tmp_path, "actions", owned=True, broken=True)
    sdk(tmp_path, "sema4ai.actions")
    result = execute(tmp_path)
    assert result.returncode != 0
    assert "missing_owned_dependency" in result.stderr
    assert "actions-core" in result.stderr
    assert not result.stdout


def test_unowned_actions_module_is_not_executed(tmp_path):
    sdk(tmp_path, "actions", owned=True)
    # Valid metadata elsewhere must not bless a workspace shadow module.
    shadow = tmp_path / "shadow"
    shadow.mkdir()
    marker = tmp_path / "executed"
    (shadow / "actions.py").write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
    result = subprocess.run(
        [sys.executable, "-S", action_runtime.__file__, "--library-version"],
        env={**os.environ, "PYTHONPATH": os.pathsep.join((str(shadow), str(tmp_path)))},
        text=True, capture_output=True, timeout=10,
    )
    assert result.returncode != 0
    assert not marker.exists()
    assert "shadow" in result.stderr.lower()


def test_metadata_error_preserves_actionable_dependency_cause(monkeypatch):
    from sema4ai_code.robo import collect_actions
    from sema4ai_ls_core.protocols import ActionResult
    message = "Install actions-core==1.0.3 in package.yaml."
    monkeypatch.setattr(collect_actions, "_execute_within_user_env", lambda *a, **k: ActionResult.make_failure(message))
    result = collect_actions._get_actions_version(None, Path(__file__).as_uri(), None)
    assert not result.success
    assert message in result.message
