"""Probe actual published Runtime Work Items/auth; synthetic, task-owned storage."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--prepared-root", required=True)
    parser.add_argument("--extension-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    runtime = Path(args.runtime)
    assert hashlib.sha256(runtime.read_bytes()).hexdigest() == "d3c450a2b10b226613588cc40cc6ec18873b23c7427958b0752711e4531a1de4"
    root = Path(args.output); root.mkdir(parents=True, exist_ok=False)
    prepared = Path(args.prepared_root)
    env = {**os.environ, "HOME": str(prepared / "os-home"), "ACTIONS_HOME": str(prepared / "actions-home"),
           "ROBOTS_HOME": str(prepared / "robots-home"), "ROBOCORP_HOME": str(prepared / "actions-home"), "RCC_HOLOTREE_MODE": "private"}
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    token = secrets.token_hex(32)
    log = (root / "runtime.log").open("w")
    command = [str(runtime), "start", "--address=127.0.0.1", f"--port={port}", "--min-processes=1", "--max-processes=1", "--full-openapi-spec", "--datadir=" + str(root / "state"), "--api-key=" + token]
    child = subprocess.Popen(command, cwd=prepared / "workspace/action-package", env=env, stdout=log, stderr=log)
    base = f"http://127.0.0.1:{port}"
    report = {"runtime": "1.0.4", "runtime_sha256": hashlib.sha256(runtime.read_bytes()).hexdigest(), "pid": child.pid,
              "source_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(), "checks": []}
    def request(route, auth=False, data=None):
        req = urllib.request.Request(base + route, headers={"Authorization": "Bearer " + token} if auth else {}, data=data)
        if data is not None: req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            content = error.read()
            try:
                value = json.loads(content)
            except ValueError:
                value = {"body_format": "non-JSON", "bytes": len(content)}
            return error.code, value
    try:
        deadline = time.monotonic() + 300
        while True:
            assert child.poll() is None, "Runtime exited before readiness"
            try:
                status, config = request("/config")
                if status == 200: break
            except (OSError, TimeoutError): pass
            if time.monotonic() > deadline: raise TimeoutError("Runtime startup")
            time.sleep(.2)
        assert config["version"] == "1.0.4" and config["auth_enabled"] is True
        denied, _ = request("/api/work-items")
        assert denied in (401, 403)
        report["checks"].append({"check": "Actual Runtime requires bearer authentication", "unauthenticated_status": denied})
        status, result = request("/api/work-items?queue_name=native-qa", True)
        report["checks"].append({"check": "Published Work Items capability", "status": status, "response": result})
        if status == 200:
            node = '''const {WorkItemsRuntimeClient}=require(process.env.CLIENT);
(async()=>{const c=new WorkItemsRuntimeClient(process.env.ENDPOINT,process.env.TEST_TOKEN);await c.connect();
const seeded=await c.seed('native-qa',{value:7});await c.attach(seeded.id,'invoice.txt',Buffer.from('synthetic invoice'));
const bytes=await c.download(seeded.id,'invoice.txt');if(!Buffer.isBuffer(bytes)||bytes.toString()!=='synthetic invoice')throw Error('attachment mismatch');
const jsonBytes=Buffer.from('{"value":7}');await c.attach(seeded.id,'payload.json',jsonBytes);
const downloadedJSON=await c.download(seeded.id,'payload.json');if(!Buffer.isBuffer(downloadedJSON)||!downloadedJSON.equals(jsonBytes))throw Error('JSON attachment byte mismatch');
const listed=await c.list('native-qa');if(!listed.items.some(item=>item.id===seeded.id))throw Error('missing item');
console.log(JSON.stringify({id:seeded.id,state:seeded.state,payload:seeded.payload,attachment_bytes:bytes.length,json_attachment_bytes:downloadedJSON.length,listed:listed.total}));})().catch(e=>{console.error(e.message);process.exitCode=1});'''
            result = subprocess.run(["node", "-e", node], env={**env, "CLIENT": str(Path(args.extension_root).resolve() / "vscode-client/out/workItemsRuntimeClient.js"), "ENDPOINT": base, "TEST_TOKEN": token}, capture_output=True, text=True, timeout=60)
            assert result.returncode == 0, result.stderr
            report["checks"].append({"check": "Actual compiled client connect/enqueue/list/upload/download", **json.loads(result.stdout)})
            invalid, _ = request("/api/work-items", True, b'{"payload":[] }')
            assert invalid == 422
            report["checks"].append({"check": "Invalid payload rejected by actual Runtime", "status": invalid})
        else:
            assert status == 503, (status, result)
            report["blocker"] = "Published Runtime Work Items capability unavailable; no local fallback"
        status, spec = request("/openapi.json", True)
        assert status == 200
        report["work_item_routes"] = {key: list(value) for key, value in spec["paths"].items() if key.startswith("/api/work-items")}
        report["durable_lifecycle"] = "NOT COMPLETE: no verified canonical Run/Attempt/lease/retry/review client contract"
    finally:
        try: report["shutdown_status"] = request("/api/shutdown/", True, b"")[0]
        except OSError: pass
        try: child.wait(timeout=20)
        except subprocess.TimeoutExpired:
            child.terminate(); child.wait(timeout=20); report["owned_process_termination"] = True
        report["runtime_exit"] = child.returncode
        log.close()
        (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
