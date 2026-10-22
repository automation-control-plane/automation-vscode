"""Exercise a real debugpy adapter and stop in an authored workload."""

import json
from pathlib import Path
from queue import Queue, Empty
import subprocess
import threading
import time


def debug_workload(
    *,
    python: str,
    cwd: Path,
    env: dict[str, str],
    source: Path,
    line: int,
    args: list[str],
    program: Path | None = None,
    module: str | None = None,
    log: Path,
) -> dict:
    messages = Queue()
    pending = []
    stderr = log.open("w")
    process = subprocess.Popen(
        [python, "-m", "debugpy.adapter"],
        cwd=cwd,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=stderr,
    )

    def read_messages():
        try:
            while True:
                headers = {}
                while True:
                    raw = process.stdout.readline()
                    if not raw:
                        messages.put({"event": "adapterClosed"})
                        return
                    if raw in (b"\r\n", b"\n"):
                        break
                    key, value = raw.decode().split(":", 1)
                    headers[key.lower()] = value.strip()
                messages.put(
                    json.loads(process.stdout.read(int(headers["content-length"])))
                )
        except BaseException as error:
            messages.put({"event": "readerError", "message": str(error)})

    threading.Thread(target=read_messages, daemon=True).start()
    sequence = 0

    def send(command, arguments):
        nonlocal sequence
        sequence += 1
        payload = json.dumps(
            {
                "seq": sequence,
                "type": "request",
                "command": command,
                "arguments": arguments,
            }
        ).encode()
        process.stdin.write(
            f"Content-Length: {len(payload)}\r\n\r\n".encode() + payload
        )
        process.stdin.flush()
        return sequence

    def receive(predicate):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            for index, message in enumerate(pending):
                if predicate(message):
                    return pending.pop(index)
            try:
                message = messages.get(
                    timeout=min(1, max(0.01, deadline - time.monotonic()))
                )
            except Empty:
                continue
            if message.get("event") in ("adapterClosed", "readerError"):
                raise RuntimeError(
                    f"Debug adapter ended before acceptance: {message}; see {log}"
                )
            pending.append(message)
        raise TimeoutError(
            f"Debug adapter timed out; pending events: {[m.get('event') for m in pending]}; see {log}"
        )

    def response(number):
        message = receive(
            lambda item: item.get("type") == "response"
            and item.get("request_seq") == number
        )
        assert message.get("success"), message
        return message.get("body", {})

    try:
        response(
            send(
                "initialize",
                {
                    "adapterID": "python",
                    "clientID": "automation-vscode-smoke",
                    "pathFormat": "path",
                    "linesStartAt1": True,
                    "columnsStartAt1": True,
                    "supportsRunInTerminalRequest": False,
                },
            )
        )
        configuration = {
            "request": "launch",
            "name": "Published smoke",
            "type": "debugpy",
            "python": [python],
            "cwd": str(cwd),
            "env": env,
            "args": args,
            "console": "internalConsole",
            "justMyCode": False,
        }
        configuration["program" if program else "module"] = (
            str(program) if program else module
        )
        launch = send("launch", configuration)
        receive(lambda item: item.get("event") == "initialized")
        breakpoints = response(
            send(
                "setBreakpoints",
                {"source": {"path": str(source)}, "breakpoints": [{"line": line}]},
            )
        )
        assert breakpoints["breakpoints"], breakpoints
        response(send("configurationDone", {}))
        response(launch)
        stopped = receive(lambda item: item.get("event") == "stopped")
        assert stopped["body"]["reason"] == "breakpoint", stopped
        thread = stopped["body"]["threadId"]
        frames = response(send("stackTrace", {"threadId": thread}))["stackFrames"]
        assert Path(frames[0]["source"]["path"]).resolve() == source.resolve(), frames[
            0
        ]
        assert frames[0]["line"] == line, frames[0]
        # Clear the verified breakpoint before resuming because logging AST
        # instrumentation can create more than one executable location on a line.
        response(
            send("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": []})
        )
        response(send("continue", {"threadId": thread}))
        exited = receive(lambda item: item.get("event") in ("exited", "stopped"))
        assert exited.get("event") == "exited", exited
        assert exited["body"]["exitCode"] == 0, exited
        receive(lambda item: item.get("event") == "terminated")
        return {
            "adapter": "debugpy",
            "source": str(source),
            "line": line,
            "stopped": "breakpoint",
            "breakpoint_cleared_before_resume": True,
            "exit": 0,
        }
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
        stderr.close()
