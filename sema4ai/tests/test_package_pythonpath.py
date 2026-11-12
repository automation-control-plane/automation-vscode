"""Runtime path regression tests; no RCC builds or editor integrations required."""
import os
import sys
from types import SimpleNamespace

import pytest

from sema4ai_code.robo import pythonpath
from sema4ai_code.robo.collect_actions import (
    collect_actions_full_and_slow, extract_info, get_metadata,
)
from sema4ai_ls_core.ep_resolve_interpreter import DefaultInterpreterInfo
from sema4ai_ls_core.jsonrpc.monitor import Monitor


@pytest.mark.parametrize("platform,separator", [("win32", ";"), ("linux", ":")])
def test_environment_order_keys_and_immutability(monkeypatch, platform, separator):
    monkeypatch.setattr(pythonpath.sys, "platform", platform)
    monkeypatch.setenv("PYTHONPATH", "parent")
    shared = {"PythonPath": "interpreter", "OTHER": "kept"}
    original = shared.copy()
    result = pythonpath.package_environment(shared, ["first", "second"])
    assert shared == original
    assert result["OTHER"] == "kept"
    if platform == "win32":
        assert result["PYTHONPATH"] == separator.join(["first", "second", "interpreter"])
        assert "PythonPath" not in result
    else:
        assert result["PYTHONPATH"] == "first:second:parent"
        assert result["PythonPath"] == "interpreter"
    assert pythonpath.package_environment({"PYTHONPATH": "a" + separator + "b"}, ["first"])["PYTHONPATH"] == "first" + separator + "a" + separator + "b"
    assert pythonpath.package_environment({}, ["first"])["PYTHONPATH"] == "first" + separator + "parent"
    assert pythonpath.package_environment({"PYTHONPATH": ""}, ["first"])["PYTHONPATH"] == "first"
    assert pythonpath.package_environment({"PYTHONPATH": "existing"}, [])["PYTHONPATH"] == "existing"


@pytest.mark.parametrize("layout", ["flat", "src"])
def test_real_listing_metadata_and_input_defaults(tmp_path, layout):
    source = tmp_path / "src" if layout == "src" else tmp_path
    source.mkdir(exist_ok=True)
    support = tmp_path / "support"
    support.mkdir()
    inherited = tmp_path / "inherited"
    inherited.mkdir()
    (support / "fixture_support.py").write_text("VALUE = 'package'\n")
    (inherited / "fixture_inherited.py").write_text("VALUE = 'inherited'\n")
    (source / "example_actions.py").write_text(
        "from actions import action\nfrom fixture_support import VALUE\n"
        "from fixture_inherited import VALUE as INHERITED\n"
        "@action\ndef example(name: str = 'world') -> str:\n"
        "    '''Return a greeting.\n\n    Args:\n        name: Who to greet.\n    '''\n"
        "    return VALUE + INHERITED + name\n"
    )
    (tmp_path / "package.yaml").write_text("pythonpath:\n  - " + ("src" if layout == "src" else ".") + "\n  - support\n")
    # Use the resolver's already-established absolute path contract.
    entries = [str(source), str(support)]
    shared = {**os.environ, "PYTHONPATH": str(inherited)}
    original = shared.copy()
    info = DefaultInterpreterInfo(str(tmp_path), sys.executable, shared, entries)
    pm = SimpleNamespace(get_implementations=lambda _: [SimpleNamespace(get_interpreter_info_for_doc_uri=lambda _: info)])
    uri = tmp_path.as_uri()
    monitor = Monitor()
    result = collect_actions_full_and_slow(pm, uri, str(tmp_path), monitor)
    assert result.success, result.message
    assert [item["name"] for item in result.result] == ["example"]
    extracted = extract_info(result.result, str(tmp_path))
    assert extracted["example"]["default_values"] == {"name": ""}
    metadata = get_metadata(pm, uri, monitor)
    assert metadata.success, metadata.message
    assert metadata.result["actions"][0]["name"] == "example"
    assert shared == original


def test_lint_uses_package_environment(tmp_path, monkeypatch):
    from concurrent.futures import Future
    from sema4ai_code.robo.lint_action import collect_lint_errors
    from sema4ai_ls_core import basic

    shared = {"PYTHONPATH": "inherited"}
    info = DefaultInterpreterInfo("fixture", sys.executable, shared, [str(tmp_path)])
    pm = SimpleNamespace(get_implementations=lambda _: [SimpleNamespace(get_interpreter_info_for_doc_uri=lambda _: info)])
    calls = []
    def launch(*args, **kwargs):
        calls.append(kwargs)
        future = Future()
        future.set_result(SimpleNamespace(returncode=0, stdout="[]", stderr=""))
        return future
    monkeypatch.setattr(basic, "launch_and_return_future", launch)
    assert collect_lint_errors(pm, SimpleNamespace(uri=tmp_path.as_uri(), source="")) == []
    assert calls[0]["environ"]["PYTHONPATH"] == str(tmp_path) + os.pathsep + "inherited"
    assert shared == {"PYTHONPATH": "inherited"}


def test_action_launch_preserves_package_paths(tmp_path):
    from sema4ai_code.compute_launch import compute_robot_launch_from_robocorp_code_launch
    package = tmp_path / "package.yaml"
    package.write_text("name: fixture\n")
    shared = {"PYTHONPATH": "inherited"}
    result = compute_robot_launch_from_robocorp_code_launch(
        "fixture", "launch", None, None, [str(tmp_path / "src")], shared,
        sys.executable, str(package), "example", (tmp_path / "example_actions.py").as_uri(), "{}",
    )
    assert result["success"], result
    assert result["result"]["env"]["PYTHONPATH"] == str(tmp_path / "src") + os.pathsep + "inherited"
    assert shared == {"PYTHONPATH": "inherited"}
