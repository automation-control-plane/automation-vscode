"""Exercise the owned adapter's resolved Python launch using real subprocesses."""
import json
import os
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

import pytest

from sema4ai_code_debug_adapter.launch_process import LaunchProcess
from sema4ai_ls_core.debug_adapter_core.dap.dap_schema import LaunchRequest, LaunchRequestArguments


class Communication:
    supports_run_in_terminal = False

    def __init__(self):
        self.messages = []
        self.terminated = threading.Event()

    def write_to_client_message(self, message):
        value = message.to_dict()
        self.messages.append(value)
        if value.get("event") == "terminated":
            self.terminated.set()


def prepare(tmp_path, **overrides):
    configuration = dict(automationResolvedPython=True, noDebug=True, python=sys.executable,
                         program=str(tmp_path / "entry.py"), args=[], pythonArgs=["-u"],
                         cwd=str(tmp_path), terminal="none", env={})
    configuration.update(overrides)
    response = SimpleNamespace(success=True, message="")
    comm = Communication()
    process = LaunchProcess(LaunchRequest(LaunchRequestArguments(**configuration)), response, comm, None)
    return process, response, comm


@pytest.mark.parametrize("module", [False, True])
def test_resolved_managed_command_preserves_arguments_environment_and_failure(tmp_path, module):
    script = tmp_path / "entry.py"
    script.write_text("import json, os, sys\nfrom support import VALUE\n"
                      "print(json.dumps({'arg':sys.argv[1], 'value':VALUE, 'env':os.environ['SELECTED']}), flush=True)\n"
                      "sys.exit(7)\n")
    support = tmp_path / "support"
    support.mkdir()
    (support / "support.py").write_text("VALUE = 'declared-pythonpath'\n")
    env = {"PYTHONPATH": str(support), "SELECTED": "managed home"}
    kwargs = dict(args=["typed input with spaces.json"], env=env)
    if module:
        kwargs.update(program=None, module="entry")
    process, response, comm = prepare(tmp_path, **kwargs)
    assert response.success, response.message
    assert process.valid
    assert not process.run_in_debug_mode
    process.launch()
    assert comm.terminated.wait(15)
    assert process._popen.wait(timeout=2) == 7
    for stream in (process._popen.stdout, process._popen.stderr):
        # Reader threads drain stdout/stderr independently of process notification.
        assert stream is not None
    assert any(message.get("event") == "exited" and message["body"]["exitCode"] == 7 for message in comm.messages)
    output = "".join(message["body"]["output"] for message in comm.messages if message.get("event") == "output")
    payload = json.loads(next(line for line in output.splitlines() if line.startswith('{')))
    assert payload == {"arg": "typed input with spaces.json", "value": "declared-pythonpath", "env": "managed home"}
    assert env == {"PYTHONPATH": str(support), "SELECTED": "managed home"}


def test_resolved_managed_run_uses_existing_cancellation_owner(tmp_path):
    (tmp_path / "entry.py").write_text("import time\ntime.sleep(120)\n")
    process, response, comm = prepare(tmp_path)
    assert response.success, response.message
    process.launch()
    try:
        process.disconnect(None)
        assert comm.terminated.wait(15)
        assert process._popen.poll() is not None
    finally:
        if process._popen.poll() is None:
            process._popen.kill()
            process._popen.wait()


def test_resolved_terminal_run_reuses_actual_exit_receipt(tmp_path):
    class TerminalCommunication(Communication):
        supports_run_in_terminal = True
        child = None

        def write_to_client_message(self, message):
            super().write_to_client_message(message)
            value = message.to_dict()
            if value.get("command") == "runInTerminal":
                args = value["arguments"]
                self.child = subprocess.Popen(args["args"], cwd=args["cwd"],
                                              env={**os.environ, **args["env"]},
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    (tmp_path / "entry.py").write_text("import sys\nsys.exit(9)\n")
    response = SimpleNamespace(success=True, message="")
    comm = TerminalCommunication()
    request = LaunchRequest(LaunchRequestArguments(
        automationResolvedPython=True, noDebug=True, python=sys.executable,
        program=str(tmp_path / "entry.py"), cwd=str(tmp_path), terminal="integrated"))
    process = LaunchProcess(request, response, comm, None)
    assert response.success, response.message
    process.launch()
    try:
        assert comm.child.wait(timeout=15) == 9
        assert comm.terminated.wait(15)
        assert process._popen is None
        assert process._exit_receipt is not None
        deadline = time.monotonic() + 2
        while process._exit_receipt.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert not process._exit_receipt.exists()
        assert any(message.get("event") == "exited" and message["body"]["exitCode"] == 9 for message in comm.messages)
    finally:
        if comm.child.poll() is None:
            comm.child.kill()
            comm.child.wait()


@pytest.mark.parametrize("layout", ["flat", "src"])
def test_real_typed_action_and_artifacts_use_the_resolved_package_launch(tmp_path, layout):
    from sema4ai_code.compute_launch import compute_robot_launch_from_robocorp_code_launch

    source = tmp_path / "src" if layout == "src" else tmp_path
    source.mkdir(exist_ok=True)
    support = tmp_path / "support"
    support.mkdir()
    (support / "fixture_support.py").write_text("VALUE = 'declared'\n")
    action_file = source / "example_actions.py"
    action_file.write_text(
        "import json, os\nfrom pathlib import Path\nfrom actions import action\n"
        "from fixture_support import VALUE\n"
        "@action\ndef typed(count: int, name: str) -> str:\n"
        "    '''Exercise typed inputs and output artifacts.'''\n"
        "    proof = {'count': count, 'name': name, 'path': VALUE}\n"
        "    Path(os.environ['ROBOT_ARTIFACTS'], 'proof.json').write_text(json.dumps(proof))\n"
        "    return f'{count + 1}:{name}:{VALUE}'\n"
    )
    package = tmp_path / "package.yaml"
    package.write_text("name: fixture\npythonpath:\n  - " + ("src" if layout == "src" else ".") + "\n  - support\n")
    inputs = tmp_path / "typed input.json"
    inputs.write_text(json.dumps({"count": 41, "name": "two words"}))
    owned_storage = tmp_path / "extension-storage"
    environment = {"AUTOMATION_EXTENSION_STORAGE": str(owned_storage)}
    launch = compute_robot_launch_from_robocorp_code_launch(
        "fixture", "launch", None, None, [str(source), str(support)], environment,
        sys.executable, str(package), "typed", action_file.as_uri(), str(inputs))
    assert launch["success"], launch
    configuration = {key: value for key, value in launch["result"].items()
                     if key in ("python", "program", "module", "cwd", "args", "env", "pythonArgs")}
    process, response, comm = prepare(tmp_path, **configuration)
    assert response.success, response.message
    process.launch()
    assert comm.terminated.wait(30)
    assert process._popen.wait(timeout=2) == 0, comm.messages
    assert any(message.get("event") == "exited" and message["body"]["exitCode"] == 0 for message in comm.messages)
    receipts = list(owned_storage.rglob("proof.json"))
    assert len(receipts) == 1
    assert json.loads(receipts[0].read_text()) == {"count": 41, "name": "two words", "path": "declared"}
    output = "".join(message["body"]["output"] for message in comm.messages if message.get("event") == "output")
    assert "42:two words:declared" in output


@pytest.mark.parametrize("overrides", [
    {"noDebug": False}, {"python": "missing"}, {"cwd": "missing"},
    {"program": None}, {"module": "also-a-module"}, {"args": [42]},
    {"pythonArgs": "-c"}, {"pythonArgs": ["-c", "print('unexpected')"]},
])
def test_resolved_launch_rejects_invalid_or_debug_configuration(tmp_path, overrides):
    (tmp_path / "entry.py").write_text("raise AssertionError('must not run')\n")
    process, response, _ = prepare(tmp_path, **overrides)
    assert not response.success
    assert response.message
    assert not process.valid
