"""Start the unchanged published wrapper and invoke an authored Action over HTTP."""

import json
import hashlib
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
import uuid


def serve_action(
    *, executable: str, package: Path, env: dict[str, str], log: Path,
    expected_version: str,
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
    evidence = None
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
        assert config["version"] == expected_version, config
        bundled_directory = (
            Path(env["HOME"])
            / ".actions/bin/action-server/internal"
            / expected_version
            / "_internal/actions/server/bin"
        )
        bundled_rcc = []
        for bundled in sorted(bundled_directory.glob("rcc-*")):
            bundled_rcc.append({
                "name": bundled.name,
                "sha256": hashlib.sha256(bundled.read_bytes()).hexdigest(),
                "version": subprocess.check_output(
                    [str(bundled), "--version"],
                    env={**env, "ACTIONS_SKIP_UPDATE_CHECK": "1"},
                    text=True,
                ).strip(),
            })
        evidence = {
            "command": command,
            "result": result,
            "datadir": str(datadir),
            "runtime_version": config["version"],
            "bundled_rcc": bundled_rcc,
        }
        return evidence
    finally:
        shutdown_status = None
        forced = False
        try:
            response = urllib.request.urlopen(
                urllib.request.Request(
                    base + "/api/shutdown/", data=b"{}", method="POST"
                ),
                timeout=5,
            )
            shutdown_status = response.status
            response.close()
        except OSError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            forced = True
            process.terminate()
            process.wait(timeout=10)
        output.close()
        if evidence is not None:
            evidence.update(
                shutdown_status=shutdown_status,
                runtime_exit_code=process.returncode,
                forced_termination=forced,
            )
            assert shutdown_status == 200 and not forced, evidence
