"""Actual RCC through custom DAP, with a simulated VS Code runInTerminal peer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from queue import Queue
import shutil
import subprocess
import sys
import threading


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rcc", required=True)
    parser.add_argument("--prepared-root", required=True)
    parser.add_argument("--extension-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    assert hashlib.sha256(Path(args.rcc).read_bytes()).hexdigest() == "f8e0394be7f47ee84d6f4cd734822b87b492a4d6102f977f6a18f29453703d48"
    extension, prepared, root = Path(args.extension_root).resolve(), Path(args.prepared_root), Path(args.output)
    root.mkdir(parents=True, exist_ok=False)
    package = root / "robot"
    shutil.copytree(Path(__file__).parent / "fixtures/native_work_items/robot", package)
    (package / "robot.yaml").write_text("tasks:\n  Consume:\n    shell: python -m robocorp.tasks run work_items_tasks.py -t consume\n  Fail:\n    shell: python -m robocorp.tasks run work_items_tasks.py -t expected_failure\nenvironmentConfigs:\n  - conda.yaml\nartifactsDir: output\nPATH:\n  - .\nPYTHONPATH:\n  - .\n")
    with (package / "work_items_tasks.py").open("a") as stream:
        stream.write("\n@task\ndef expected_failure():\n    raise RuntimeError('Synthetic expected failure')\n")
    core = extension.parent / "sema4ai-python-ls-core/src"
    if not core.exists(): core = extension / "src/sema4ai_code/vendored"
    env = {**os.environ, "HOME": str(prepared / "os-home"), "ACTIONS_HOME": str(prepared / "actions-home"),
           "ROBOTS_HOME": str(prepared / "robots-home"), "ROBOCORP_HOME": str(prepared / "robots-home"), "RCC_HOLOTREE_MODE": "private",
           "AUTOMATION_RCC_LOCATION": args.rcc, "PYTHONPATH": os.pathsep.join([str(extension / "src"), str(core)]),
           "RC_WORKITEM_ADAPTER": "FileAdapter", "RC_WORKITEM_INPUT_PATH": str(root / "input.json"), "RC_WORKITEM_OUTPUT_PATH": str(root / "output.json")}
    (root / "input.json").write_text('[{"payload":{"value":7},"files":{}}]')
    report = {"source_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(), "extension": str(extension),
              "scope": "Actual custom adapter, terminal wrapper and verified RCC; simulated Code reverse-terminal peer, not GUI", "checks": []}
    for task in ("Consume", "Fail"):
        log = (root / (task + "-adapter.log")).open("w")
        process = subprocess.Popen([sys.executable, "-u", str(extension / "src/sema4ai_code_debug_adapter/__main__.py")], env=env,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log)
        incoming, events, terminals, sequence = Queue(), [], [], 0
        def read():
            while True:
                headers = {}
                while True:
                    line = process.stdout.readline()
                    if not line: incoming.put({"eof": True}); return
                    if line in (b"\r\n", b"\n"): break
                    key, value = line.decode().split(":", 1); headers[key.lower()] = value.strip()
                incoming.put(json.loads(process.stdout.read(int(headers["content-length"]))))
        threading.Thread(target=read, daemon=True).start()
        def write(value):
            nonlocal sequence
            sequence += 1; value["seq"] = sequence
            raw = json.dumps(value).encode(); process.stdin.write(f"Content-Length: {len(raw)}\r\n\r\n".encode() + raw); process.stdin.flush()
            return sequence
        def message():
            value = incoming.get(timeout=600)
            assert not value.get("eof"), "Adapter closed before termination"
            if value.get("type") == "event": events.append(value)
            if value.get("type") == "request" and value.get("command") == "runInTerminal":
                arguments = value["arguments"]
                output = (root / (task + "-terminal.log")).open("w")
                child = subprocess.Popen(arguments["args"], cwd=arguments["cwd"], env={**env, **arguments.get("env", {})}, stdin=subprocess.DEVNULL, stdout=output, stderr=output)
                terminals.append((child, output))
                write({"type": "response", "request_seq": value["seq"], "command": "runInTerminal", "success": True, "body": {"processId": child.pid, "shellProcessId": child.pid}})
            return value
        def request(command, arguments):
            seq = write({"type": "request", "command": command, "arguments": arguments})
            while True:
                value = message()
                if value.get("type") == "response" and value.get("request_seq") == seq:
                    assert value["success"], value
                    return value
        try:
            request("initialize", {"adapterID": "sema4ai", "supportsRunInTerminalRequest": True})
            request("launch", {"robot": str(package / "robot.yaml"), "task": task, "noDebug": True, "terminal": "integrated", "env": env})
            request("configurationDone", {})
            while not any(event.get("event") == "terminated" for event in events): message()
            exits = [event for event in events if event.get("event") == "exited"]
            assert len(exits) == 1, [event.get("event") for event in events]
            assert len(terminals) == 1
            actual = terminals[0][0].wait(timeout=10)
            assert exits[0]["body"]["exitCode"] == actual
            assert (actual == 0) == (task == "Consume")
            order = [event["event"] for event in events if event.get("event") in {"exited", "terminated"}]
            assert order == ["exited", "terminated"], order
            if task == "Consume": assert json.loads((root / "output.json").read_text())[0]["payload"] == {"observed": 7}
            report["checks"].append({"task": task, "actual_terminal_exit": actual, "dap_exit_code": exits[0]["body"]["exitCode"], "events": order, "terminal_wrapper_pid": terminals[0][0].pid})
            print("PASS", task, actual, flush=True)
        finally:
            process.stdin.close()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.terminate(); process.wait(timeout=5)
            for child, output in terminals:
                if child.poll() is None: child.terminate(); child.wait(timeout=10)
                output.close()
            log.close()
            (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
