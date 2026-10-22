"""Start the unchanged published wrapper and invoke an authored Action over HTTP."""

import json
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
import uuid


def serve_action(
    *, executable: str, package: Path, env: dict[str, str], log: Path
) -> dict:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    datadir = (
        Path(env["ACTIONS_HOME"])
        / "action-server"
        / f"http-smoke-{uuid.uuid4().hex[:12]}"
    )
    assert not datadir.exists(), "Use a fresh task-owned server state directory"
    command = [
        executable,
        "start",
        "--address=127.0.0.1",
        f"--port={port}",
        "--min-processes=1",
        "--max-processes=2",
        f"--datadir={datadir}",
    ]
    output = log.open("w")
    process = subprocess.Popen(
        command,
        cwd=package,
        env={**env, "RC_ADD_SHUTDOWN_API": "1"},
        stdout=output,
        stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(
                    f"Published Runtime exited {process.returncode}; see {log}"
                )
            try:
                with urllib.request.urlopen(
                    base + "/openapi.json", timeout=1
                ) as response:
                    openapi = json.load(response)
                paths = [path for path in openapi["paths"] if "welcome" in path]
                if paths:
                    break
            except OSError:
                pass
            time.sleep(0.2)
        else:
            raise TimeoutError(f"Action did not become available; see {log}")
        request = urllib.request.Request(
            base + paths[0],
            data=b'{"name":"HTTP Dakota"}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        assert result == "Hello HTTP Dakota", result
        with urllib.request.urlopen(base + "/config", timeout=5) as response:
            config = json.load(response)
        assert config["version"] == "1.0.4", config
        bundled = (
            Path(env["HOME"])
            / ".actions/bin/action-server/internal/1.0.4/_internal/actions/server/bin/rcc-18.19.3"
        )
        bundled_version = subprocess.check_output(
            [str(bundled), "--version"], env=env, text=True
        ).strip()
        return {
            "command": command,
            "result": result,
            "datadir": str(datadir),
            "runtime_version": config["version"],
            "bundled_rcc_version": bundled_version,
        }
    finally:
        try:
            urllib.request.urlopen(
                urllib.request.Request(
                    base + "/api/shutdown", data=b"{}", method="POST"
                ),
                timeout=5,
            ).close()
        except OSError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)
        output.close()
