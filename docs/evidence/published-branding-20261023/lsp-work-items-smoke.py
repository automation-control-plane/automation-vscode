"""Launch the packaged language server and resolve real Action/Robot interpreters."""

import argparse
import json
import os
from pathlib import Path
from queue import Queue
import subprocess
import threading


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--extension-root", required=True)
    parser.add_argument("--environment-json", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--rcc", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    extension, workspace, output = (
        Path(args.extension_root),
        Path(args.workspace),
        Path(args.output),
    )
    output.mkdir(parents=True, exist_ok=False)
    child_env = {**os.environ, **json.loads(Path(args.environment_json).read_text())}
    child_env.update(
        {
            "PYTHONPATH": str(extension / "src"),
            "ACTIONS_HOME": str(workspace.parent / "actions-home"),
            "ROBOTS_HOME": str(workspace.parent / "robots-home"),
            "ROBOCORP_HOME": str(workspace.parent / "actions-home"),
            "RCC_HOLOTREE_MODE": "private",
        }
    )
    log = (output / "stderr.log").open("w")
    command = [
        child_env["PYTHON_EXE"],
        "-u",
        str(extension / "src/sema4ai_code/__main__.py"),
    ]
    process = subprocess.Popen(
        command,
        env=child_env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=log,
    )
    messages = Queue()

    def read():
        while True:
            headers = {}
            while True:
                line = process.stdout.readline()
                if not line:
                    messages.put({"error": "Language server closed stdout"})
                    return
                if line in (b"\r\n", b"\n"):
                    break
                key, value = line.decode().split(":", 1)
                headers[key.lower()] = value.strip()
            messages.put(
                json.loads(process.stdout.read(int(headers["content-length"])))
            )

    threading.Thread(target=read, daemon=True).start()
    sequence = 0

    def send(method, params, request=True):
        nonlocal sequence
        sequence += 1
        payload = {"jsonrpc": "2.0", "method": method, "params": params}
        if request:
            payload["id"] = sequence
        encoded = json.dumps(payload).encode()
        process.stdin.write(
            f"Content-Length: {len(encoded)}\r\n\r\n".encode() + encoded
        )
        process.stdin.flush()
        if not request:
            return
        while True:
            message = messages.get(timeout=600)
            if message.get("id") == sequence:
                assert "error" not in message, message
                return message["result"]
            assert message.get("error") is None, message

    try:
        initialized = send(
            "initialize",
            {
                "processId": os.getpid(),
                "rootUri": workspace.as_uri(),
                "capabilities": {},
                "workspaceFolders": [
                    {"uri": workspace.as_uri(), "name": "Published smoke"}
                ],
            },
        )
        assert "capabilities" in initialized
        send("initialized", {}, False)
        send(
            "workspace/didChangeConfiguration",
            {
                "settings": {
                    "sema4ai.rcc.location": args.rcc,
                    "sema4ai.actionServer.location": args.runtime,
                }
            },
            False,
        )
        listed = send(
            "workspace/executeCommand",
            {"command": "sema4ai.localListRobots.internal", "arguments": []},
        )
        assert listed["success"], listed
        assert len(listed["result"]) >= 2, listed
        report = {
            "command": command,
            "scope": "Packaged Python language-server stdio; not VS Code Extension Host activation",
            "packages": [entry["name"] for entry in listed["result"]],
            "interpreters": {},
        }
        for kind, relative in [
            ("actions", "action-package/package.yaml"),
            ("robots", "robot-package/robot.yaml"),
        ]:
            resolved = send(
                "workspace/executeCommand",
                {
                    "command": "sema4ai.resolveInterpreter",
                    "arguments": [{"target_robot": str(workspace / relative)}],
                },
            )
            assert resolved["success"], resolved
            info = resolved["result"]
            environment = info["environ"]
            expected = workspace.parent / (kind + "-home")
            assert Path(environment["ROBOCORP_HOME"]) == expected, (
                kind,
                environment.get("ROBOCORP_HOME"),
            )
            assert Path(info["pythonExe"]).is_relative_to(expected), info["pythonExe"]
            if kind == "actions":
                import uuid
                input_path = workspace / "action-package/devdata/work-items-in" / ("qa-" + uuid.uuid4().hex) / "work-items.json"
                input_path.parent.mkdir(parents=True)
                input_path.write_text('[{"payload":{"value":7},"files":{}}]')
                def work_items(increment):
                    result = send("workspace/executeCommand", {"command": "sema4ai.listWorkItems.internal", "arguments": [{"robot": str(workspace / relative), "increment_output": increment, "output_prefix": "gui-check-"}]})
                    assert result["success"], result
                    return result["result"]
                items = work_items(True)
                assert items["robot_yaml"] == str(workspace / relative), items
                assert any(item["json_path"] == str(input_path) for item in items["input_work_items"]), items
                checked = send("workspace/executeCommand", {"command": "sema4ai.verifyLibraryVersion.internal", "arguments": [{"conda_prefix": environment["CONDA_PREFIX"], "libs_and_version": [["actions-work-items", "0.4.4"]]}]})
                assert checked["success"], checked
                output_path = Path(items["new_output_workitem_path"])
                assert not output_path.exists()
                output_path.parent.mkdir(parents=True, exist_ok=True)
                controls = {"RC_WORKITEM_ADAPTER": "FileAdapter", "RC_WORKITEM_INPUT_PATH": str(input_path), "RC_WORKITEM_OUTPUT_PATH": str(output_path)}
                command = [info["pythonExe"], str(extension / "src/sema4ai_code/robo/launch_actions.py"), "run", "smoke_actions.py", "-a", "consume"]
                run = subprocess.run(command, cwd=workspace / "action-package", env={**os.environ, **environment, **controls}, text=True, capture_output=True, timeout=60)
                (output / "consume.log").write_text(run.stdout + run.stderr)
                assert run.returncode == 0, (run.returncode, run.stderr[-2000:])
                observed = json.loads(output_path.read_text())
                assert observed[0]["payload"] == {"observed": 7}, observed
                refreshed = work_items(False)
                assert any(item["json_path"] == str(output_path) for item in refreshed["output_work_items"]), refreshed
                report["action_work_items"] = {"scope": "Actual installed LSP command and FileAdapter action execution; not GUI selection", "input_value": 7, "observed": 7, "library": checked["result"], "input": str(input_path), "output": str(output_path), "command": command}
            report["interpreters"][kind] = {
                "python": info["pythonExe"],
                "ROBOCORP_HOME": environment["ROBOCORP_HOME"],
                "RCC_VERSION": environment.get("RCC_VERSION"),
            }
        assert (
            report["interpreters"]["actions"]["python"]
            != report["interpreters"]["robots"]["python"]
        )
        send("shutdown", None)
        send("exit", None, False)
        process.wait(timeout=10)
        assert process.returncode == 0, process.returncode
        (output / "result.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        log.close()


if __name__ == "__main__":
    main()
