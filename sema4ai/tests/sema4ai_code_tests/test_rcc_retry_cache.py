"""Retry behavior for transient RCC setup and hash failures."""

import json
from contextlib import contextmanager
from pathlib import Path

import pytest

from sema4ai_code.protocols import ActionResult
from sema4ai_code.rcc import Rcc, _cache_hash


class _ConfigProvider:
    config = None


class _SpaceInfo:
    def __init__(self, path: Path):
        self.space_name = "test-space"
        self.state_path = path / "state"
        self.requested_pid_path = path / "requested-pid"
        self.env_json_path = path / "env.json"
        self.damaged_path = path / "damaged"
        path.mkdir(parents=True)
        self.state_path.write_text("created", "utf-8")

    @contextmanager
    def acquire_lock(self):
        yield

    def update_last_usage(self):
        pass

    def conda_prefix_identity_yaml_still_matches_cached_space(self, rcc):
        return True


class _HolotreeManager:
    def __init__(self, space_info):
        self.space_info = space_info

    def compute_valid_space_info(self, conda_yaml_path, conda_yaml_contents):
        return self.space_info


def _rcc(tmp_path, monkeypatch):
    rcc = Rcc(_ConfigProvider())
    monkeypatch.setattr(rcc, "get_robocorp_code_datadir", lambda kind: tmp_path / kind)
    monkeypatch.setattr(rcc, "get_robocorp_home_from_settings", lambda: str(tmp_path))
    return rcc


def _success_result():
    return ActionResult(
        True,
        None,
        json.dumps(
            [
                {"key": "CONDA_PREFIX", "value": "/tmp/conda"},
                {"key": "PYTHON_EXE", "value": "/tmp/conda/python"},
            ]
        ),
    )


@pytest.mark.parametrize(
    "first_result",
    [
        ActionResult(False, "cancelled", None),
        ActionResult(False, "temporary RCC transport failure", None),
        ActionResult(True, None, ""),
        ActionResult(True, None, "not-json"),
        ActionResult(True, None, "[]"),
    ],
    ids=[
        "cancelled",
        "transient-process-failure",
        "empty-output",
        "malformed-json",
        "missing-env",
    ],
)
def test_env_setup_failure_can_retry_and_success_is_reused(
    tmp_path, monkeypatch, first_result
):
    rcc = _rcc(tmp_path, monkeypatch)
    path = tmp_path / "conda.yaml"
    path.write_text("dependencies: []", "utf-8")
    space_info = _SpaceInfo(tmp_path / "space")
    manager = _HolotreeManager(space_info)
    results = [first_result, _success_result()]
    calls = []

    def run_rcc(*args, **kwargs):
        calls.append(args[0])
        return results.pop(0)

    monkeypatch.setattr(rcc, "_run_rcc", run_rcc)

    failed = rcc.get_robot_yaml_env_info(
        None, path, "dependencies: []", None, holotree_manager=manager
    )
    assert not failed.success
    assert space_info.state_path.read_text("utf-8") == "created"
    assert not space_info.env_json_path.exists()

    recovered = rcc.get_robot_yaml_env_info(
        None, path, "dependencies: []", None, holotree_manager=manager
    )
    assert recovered.success
    assert recovered.result is not None
    assert recovered.result.env["PYTHON_EXE"] == "/tmp/conda/python"

    reused = rcc.get_robot_yaml_env_info(
        None, path, "dependencies: []", None, holotree_manager=manager
    )
    assert reused.success
    assert len(calls) == 2


def test_env_setup_failures_do_not_cross_home_boundaries(tmp_path, monkeypatch):
    rcc = _rcc(tmp_path, monkeypatch)
    path = tmp_path / "conda.yaml"
    path.write_text("dependencies: []", "utf-8")
    results = [ActionResult(False, "cancelled", None), _success_result()]
    monkeypatch.setattr(rcc, "_run_rcc", lambda *args, **kwargs: results.pop(0))

    monkeypatch.setattr(
        rcc, "get_robocorp_code_datadir", lambda kind: tmp_path / "home-a" / kind
    )
    home_a = _HolotreeManager(_SpaceInfo(tmp_path / "home-a-space"))
    result_a = rcc.get_robot_yaml_env_info(
        None, path, "same", None, holotree_manager=home_a
    )
    assert not result_a.success

    monkeypatch.setattr(
        rcc, "get_robocorp_code_datadir", lambda kind: tmp_path / "home-b" / kind
    )
    home_b = _HolotreeManager(_SpaceInfo(tmp_path / "home-b-space"))
    result_b = rcc.get_robot_yaml_env_info(
        None, path, "same", None, holotree_manager=home_b
    )
    assert result_b.success


def test_holotree_hash_failure_is_retried(tmp_path, monkeypatch):
    rcc = _rcc(tmp_path, monkeypatch)
    _cache_hash.clear()
    calls = []

    def run_rcc(*args, **kwargs):
        calls.append(args[0])
        if len(calls) == 1:
            return ActionResult(False, "cancelled", None)
        return ActionResult(True, None, json.dumps({"hash": "hash-1"}))

    monkeypatch.setattr(rcc, "_run_rcc", run_rcc)

    failed = rcc.holotree_hash("dependencies: []", str(tmp_path / "conda.yaml"))
    assert not failed.success
    recovered = rcc.holotree_hash("dependencies: []", str(tmp_path / "conda.yaml"))
    assert recovered.success
    assert recovered.result == "hash-1"
    assert len(calls) == 2
