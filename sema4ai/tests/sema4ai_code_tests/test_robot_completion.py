"""Actual child status plus focused DAP lifecycle regressions; not VS Code UI."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import weakref

import pytest


@pytest.mark.parametrize("code", [0, 7])
def test_existing_terminal_wrapper_records_actual_child_and_hides_control(tmp_path, monkeypatch, code):
    from sema4ai_ls_core.run_and_save_pid import main

    result = tmp_path / "exit.json"
    proof = tmp_path / "child.json"
    monkeypatch.setenv("AUTOMATION_DAP_EXIT_FILE", str(result))
    command = [sys.executable, "-c", "import os,json,sys;from pathlib import Path;Path(sys.argv[1]).write_text(json.dumps({'control_leaked':'AUTOMATION_DAP_EXIT_FILE' in os.environ}));sys.exit(int(sys.argv[2]))", str(proof), str(code)]
    actual = main(str(tmp_path / "pid"), command)
    receipt = json.loads(result.read_text())
    assert actual == receipt["exit_code"] == code
    assert receipt["pid"] == int((tmp_path / "pid").read_text())
    assert json.loads(proof.read_text())["control_leaked"] is False


def test_completion_never_overwrites_existing_data_or_changes_task_status(tmp_path, monkeypatch):
    from sema4ai_ls_core.run_and_save_pid import main

    target = tmp_path / "existing.json"
    target.write_text("existing operator data")
    monkeypatch.setenv("AUTOMATION_DAP_EXIT_FILE", str(target))
    assert main(str(tmp_path / "pid"), [sys.executable, "-c", "pass"]) == 0
    assert target.read_text() == "existing operator data"


@pytest.mark.parametrize("code", [0, 7])
def test_dap_waits_for_owned_receipt_then_exited_before_terminated(tmp_path, code):
    from sema4ai_code_debug_adapter.launch_process import LaunchProcess

    class Comm:
        def __init__(self): self.events = []
        def write_to_client_message(self, value): self.events.append(value.to_dict())

    comm = Comm()
    process = LaunchProcess.__new__(LaunchProcess)
    process._sent_terminated = threading.Event()
    process._on_exit_callbacks = []
    process._weak_debug_adapter_comm = weakref.ref(comm)
    process._popen = None
    process._track_process_pid = os.getpid()
    process._exit_receipt = tmp_path / "exit.json"
    writer = threading.Timer(0.05, lambda: process._exit_receipt.write_text(json.dumps({"pid": os.getpid(), "exit_code": code})))
    writer.start()
    process.notify_exit(); writer.join(); process.notify_exit()
    assert [entry["event"] for entry in comm.events] == ["exited", "terminated"]
    assert comm.events[0]["body"]["exitCode"] == code


def test_wrong_receipt_pid_never_manufactures_success(tmp_path):
    from sema4ai_code_debug_adapter.launch_process import LaunchProcess

    process = LaunchProcess.__new__(LaunchProcess)
    process._popen = None
    process._track_process_pid = os.getpid()
    process._exit_receipt = tmp_path / "exit.json"
    process._exit_receipt.write_text(json.dumps({"pid": os.getpid() + 1, "exit_code": 0}))
    assert process._actual_exit_code() is None


def test_direct_popen_completion_is_actual_exit(tmp_path):
    from sema4ai_code_debug_adapter.launch_process import LaunchProcess

    process = LaunchProcess.__new__(LaunchProcess)
    process._popen = subprocess.Popen([sys.executable, "-c", "import sys;sys.exit(5)"])
    process._exit_receipt = None
    assert process._actual_exit_code() == 5
