"""Probe the released Runtime's real SQL/auth API in fresh owned Linux state."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request


RUNTIME_SHA256 = "8c27fbed198aef16c98cdc7a45230fbc4708b06dff1c3523aeddfcdf7840efd0"
SOURCE = "9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2"


def owned_environment(root):
    admitted = {"PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
                "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "HTTP_PROXY", "HTTPS_PROXY",
                "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"}
    env = {key: value for key, value in os.environ.items() if key in admitted}
    for key, folder in {"HOME": "home", "ACTIONS_HOME": "actions", "ROBOTS_HOME": "robots",
                        "ROBOCORP_HOME": "actions", "XDG_CACHE_HOME": "cache",
                        "XDG_CONFIG_HOME": "config", "TMPDIR": "tmp"}.items():
        path = root / folder
        path.mkdir(exist_ok=True)
        env[key] = str(path)
    env.update(RCC_HOLOTREE_MODE="private", ACTIONS_SKIP_UPDATE_CHECK="1",
               RC_ADD_SHUTDOWN_API="1", PYTHONNOUSERSITE="1")
    return env


def assess_authorization(runtime, root, report):
    result = subprocess.run(
        [str(runtime), "authorize-local", "--schema"], env=owned_environment(root),
        cwd=root, capture_output=True, text=True, timeout=60, check=True,
    )
    schema = json.loads(result.stdout)
    permissions = schema["properties"]["queue_permissions"]["items"]["enum"]
    assert isinstance(permissions, list) and "work_items.read" in permissions
    (root / "authorization-schema.private.json").write_text(json.dumps(schema, indent=2) + "\n")
    report["checks"].append({
        "check": "published authorize-local grant schema", "exit_code": result.returncode,
        "queue_permissions": permissions, "retry_supported": "work_items.retry" in permissions,
        "schema_sha256": hashlib.sha256(result.stdout.encode()).hexdigest(),
    })
    report["full_lifecycle_qualified"] = False
    if "work_items.retry" not in permissions:
        report["blocker"] = (
            "Full lifecycle cannot be qualified through the released supported grant route: "
            "work_items.retry is absent; no fabricated grants, profiles or fixture-host fallback used"
        )
    (root / "canonical-assessment.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def probe(runtime, root):
    if hashlib.sha256(runtime.read_bytes()).hexdigest() != RUNTIME_SHA256:
        raise ValueError("Unexpected released Runtime bytes")
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError("A fresh absolute non-symlink state directory is required")
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    env = owned_environment(root)
    token = secrets.token_urlsafe(48)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    report = {"runtime_version": "1.1.1", "runtime_sha256": RUNTIME_SHA256,
              "runtime_source": SOURCE, "qualification_head": subprocess.check_output(
                  ["git", "rev-parse", "HEAD"], text=True).strip(),
              "worktree_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"])),
              "driver_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "scope": "Actual released binary, private SQLite/auth bootstrap; not fixture-host substitution",
              "checks": []}

    def request(path, authenticated=True, payload=None):
        headers = {"Authorization": "Bearer " + token} if authenticated else {}
        data = None if payload is None else json.dumps(payload).encode()
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(base + path, headers=headers, data=data)
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                value = json.loads(raw)
            except ValueError:
                value = {"non_json_bytes": len(raw)}
            return error.code, value

    command = [str(runtime), "start", "--address=127.0.0.1", f"--port={port}",
               "--actions-sync=false", "--min-processes=1", "--max-processes=1",
               f"--datadir={root / 'state'}", "--api-key=" + token]
    with (root / "runtime.private.log").open("wb") as log:
        child = subprocess.Popen(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 180
            while True:
                if child.poll() is not None:
                    raise RuntimeError("Runtime exited before readiness; inspect private log")
                try:
                    status, config = request("/config")
                    if status == 200:
                        break
                except (OSError, TimeoutError):
                    pass
                if time.monotonic() > deadline:
                    raise TimeoutError("Released Runtime readiness")
                time.sleep(.2)
            assert config["version"] == "1.1.1" and config["auth_enabled"] is True
            prefix = "/api/managed-work-items/v1"
            denied, _ = request(prefix + "/schema", False)
            assert denied == 401, denied
            report["checks"].append({"check": "canonical unauthenticated denial", "status": denied})
            status, schema = request(prefix + "/schema")
            report["checks"].append({"check": "released canonical schema", "status": status})
            if status != 200:
                report["blocker"] = "Released CLI canonical service unavailable; no local fallback used"
                return report
            pinned = json.loads((Path(__file__).parents[1] / "resources/work-items/managed-v1.json").read_text())
            report["schema_matches_extension"] = schema == pinned
            assert schema == pinned, "Released canonical schema differs from extension contract"
            databases = list((root / "state").glob("*.db"))
            assert len(databases) == 1
            with sqlite3.connect(f"file:{databases[0]}?mode=ro", uri=True) as db:
                rows = db.execute("SELECT result_json FROM foundry_request WHERE operation=?",
                                  ("runtime.bootstrap",)).fetchall()
            assert len(rows) == 1
            realm = json.loads(rows[0][0])
            workspace = realm["workspace_id"]
            status, value = request(prefix + "/capabilities?workspace_id=" + workspace)
            report["checks"].append({"check": "fresh SQL grants remain denied", "status": status,
                                     "error_code": value.get("error", {}).get("code")})
            assert status == 403 and value["error"]["code"] == "forbidden"
            report["blocker"] = "Worker/queue grants and immutable deployment/profile references must be explicitly provisioned before lifecycle operations"
            report["workspace_id"] = workspace
            return report
        finally:
            try:
                report["shutdown_status"] = request("/api/shutdown/", payload={})[0]
            except OSError:
                report["shutdown_status"] = None
            try:
                child.wait(timeout=20)
                report["forced_termination"] = False
            except subprocess.TimeoutExpired:
                child.terminate()
                child.wait(timeout=20)
                report["forced_termination"] = True
            report["runtime_exit_code"] = child.returncode
            (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--state", required=True, type=Path)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    print(json.dumps(assess_authorization(runtime, args.state, probe(runtime, args.state)), indent=2))
