"""Cloud-only clean RCC bootstrap of an already installed private VSIX.

All homes/cache are new and task-owned. Never remove or migrate operator data.
The RCC stderr log is private diagnostics; distribute only the sanitized receipt.
This command/installed-Python proof is distinct from native VS Code GUI QA.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

RCC_SHA256 = "f8e0394be7f47ee84d6f4cd734822b87b492a4d6102f977f6a18f29453703d48"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--installed", type=Path, required=True)
    parser.add_argument("--rcc", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert hashlib.sha256(args.rcc.read_bytes()).hexdigest() == RCC_SHA256
    args.output.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix="fresh-owned-", dir=args.output))
    env = dict(os.environ)
    for key in ("PYTHONPATH", "PYTHONHOME", "CONDA_PREFIX", "VIRTUAL_ENV", "MAMBA_ROOT_PREFIX", "CONDA_PKGS_DIRS"):
        env.pop(key, None)
    for key, name in (("HOME", "home"), ("ACTIONS_HOME", "actions"), ("ROBOTS_HOME", "robots"), ("XDG_CACHE_HOME", "cache")):
        target = scratch / name; assert not target.exists(); target.mkdir(); env[key] = str(target)
    env["ROBOCORP_HOME"] = env["ACTIONS_HOME"]
    env["RCC_HOLOTREE_MODE"] = "private"
    descriptor = args.installed / "bin/create_env/conda_vscode_linux_amd64.yaml"
    content = descriptor.read_text()
    assert "actions-http-helper==1.0.3" in content
    assert "sema4ai-http-helper" not in content and "sema4ai-common" not in content
    version = subprocess.check_output([str(args.rcc), "version"], env=env, text=True, timeout=20).strip()
    assert "18.19.7" in version
    command = [str(args.rcc), "holotree", "variables", "--space", "automation-owned-bootstrap", "--json", str(descriptor), "--robocorp", "--bundled", "--controller", "AutomationCode"]
    receipt = {"classification": "Fresh installed descriptor / real RCC and Python; not native GUI activation", "rcc_version": version,
               "rcc_sha256": RCC_SHA256, "descriptor_sha256": hashlib.sha256(descriptor.read_bytes()).hexdigest(),
               "command": command, "homes_created_empty": True, "actions_home": env["ACTIONS_HOME"], "robots_home": env["ROBOTS_HOME"]}
    (args.output / "bootstrap-start.json").write_text(json.dumps(receipt, indent=2))
    with (args.output / "bootstrap.stderr.private.log").open("w") as stderr:
        result = subprocess.run(command, env=env, text=True, stdout=subprocess.PIPE, stderr=stderr, timeout=900)
    receipt["rcc_exit_code"] = result.returncode
    (args.output / "bootstrap-result.json").write_text(json.dumps(receipt, indent=2))
    assert result.returncode == 0, "RCC bootstrap failed; inspect the retained private stderr log, never substitute warm caches"
    variables = {entry["key"]: entry["value"] for entry in json.loads(result.stdout)}
    python = variables["PYTHON_EXE"]
    child_env = {**env, **variables, "PYTHONPATH": os.pathsep.join([str(args.installed / "src"), str(args.installed / "src/sema4ai_code/vendored")])}
    script = r'''
import importlib.metadata as metadata, importlib.util, json, pathlib, sys, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import actions_http
from sema4ai_code.data.data_server_connection import _HttpConnectionHelper
import sema4ai_code._lint
inventory={d.metadata['Name'].lower().replace('_','-'): d.version for d in metadata.distributions()}
assert inventory['actions-http-helper']=='1.0.3'
assert 'sema4ai-http-helper' not in inventory and 'sema4ai-common' not in inventory
assert importlib.util.find_spec('sema4ai_http') is None
try: vendor_common=importlib.util.find_spec('sema4ai.common')
except ModuleNotFoundError: vendor_common=None
assert vendor_common is None
requests=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  value=json.loads(self.rfile.read(int(self.headers['Content-Length'])));requests.append(value)
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
  self.wfile.write(b'{"type":"table","column_names":["value"],"data":[[7]]}')
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
 helper=_HttpConnectionHelper(f'http://127.0.0.1:{server.server_port}','','')
 assert helper.run_sql('SELECT 7','synthetic')==(['value'],[[7]])
 assert requests==[{'query':'SELECT 7','context':{'db':'synthetic'}}]
finally:server.shutdown();server.server_close();thread.join()
print(json.dumps({'python':sys.version,'executable':sys.executable,'actions_http_origin':actions_http.__file__,
 'helper_distribution':metadata.version('actions-http-helper'),'distribution_inventory':inventory,
 'vendor_helper_absent':True,'vendor_common_absent':True,'installed_lint_import':sema4ai_code._lint.__file__,
 'installed_data_query_loopback':True}))
'''
    proof = subprocess.run([python, "-c", script], env=child_env, text=True, capture_output=True, timeout=30)
    (args.output / "python.stderr.private.log").write_text(proof.stderr)
    assert proof.returncode == 0, "Fresh interpreter proof failed; inspect retained private Python stderr"
    receipt.update(json.loads(proof.stdout))
    assert Path(receipt["actions_http_origin"]).is_relative_to(scratch)
    assert not any((scratch / "robots").iterdir()), "Action bootstrap wrote into Robot home"
    receipt["robots_home_untouched"] = True
    (args.output / "bootstrap-result.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__": main()
