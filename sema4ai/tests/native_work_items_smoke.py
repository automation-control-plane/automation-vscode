"""Real package interpreters/owned SDK, Action and Robot File/SQLite run/debug.

Uses task-owned prepared RCC caches/homes without deleting or migrating them.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rcc", required=True)
    parser.add_argument("--prepared-root", required=True)
    parser.add_argument("--extension-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    extension = Path(args.extension_root).resolve()
    sys.path.insert(0, str(extension / "src"))
    sys.path.insert(0, str(extension / "src/sema4ai_code/vendored"))
    from sema4ai_code.rcc import Rcc
    from sema4ai_ls_core.config import Config
    from dap_smoke import debug_workload
    prepared, root = Path(args.prepared_root), Path(args.output)
    root.mkdir(parents=True, exist_ok=False)
    os.environ.update(HOME=str(prepared / "os-home"), ACTIONS_HOME=str(prepared / "actions-home"),
                      ROBOTS_HOME=str(prepared / "robots-home"), ROBOCORP_HOME=str(prepared / "actions-home"), RCC_HOLOTREE_MODE="private")
    class Provider:
        def __init__(self):
            self.config = Config()
            self.config.update({"sema4ai.rcc.location": args.rcc})
    provider = Provider(); rcc = Rcc(provider)
    report = {"source_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
              "extension": str(extension), "scope": "Real CLI/DAP; desktop editor acceptance is separate", "checks": []}
    try:
        for kind, filename in (("action", "package.yaml"), ("robot", "robot.yaml")):
            target = root / kind
            shutil.copytree(Path(__file__).parent / "fixtures/native_work_items" / kind, target)
            manifest = target / filename
            config = manifest if kind == "action" else target / "conda.yaml"
            result = rcc.get_robot_yaml_env_info(None if kind == "action" else manifest, config, config.read_text(), None, timeout=600)
            assert result.success, result.message
            env = {**os.environ, **result.result.env}
            python = env["PYTHON_EXE"]
            expected = Path(env["ACTIONS_HOME"] if kind == "action" else env["ROBOTS_HOME"])
            assert Path(python).is_relative_to(expected), python
            def bridge(op, mode, **params):
                command = [python, str(extension / "src/sema4ai_code/work_items_native.py")]
                value = subprocess.run(command, env=env, input=json.dumps({"manifest": str(manifest), "op": op, "mode": mode, **params}), text=True, capture_output=True, timeout=30)
                assert value.returncode == 0, value.stdout + value.stderr
                value = json.loads(value.stdout); assert value["success"], value
                return value["result"]
            source = target / ("work_items_actions.py" if kind == "action" else "work_items_tasks.py")
            for mode in ("file", "sqlite"):
                for debug in (False, True):
                    key = bridge("create", mode, payload={"value": 7}, name="smoke")["id"]
                    run = bridge("prepare", mode, id=key)
                    launch_env = {**env, **run["env"]}
                    if kind == "action":
                        program, module = extension / "src/sema4ai_code/robo/launch_actions.py", None
                        argv = ["run", str(source), "-a", "consume", "--json-input", run["parameters"]]
                    else:
                        program, module, argv = None, "robocorp.tasks", ["run", str(source), "-t", "consume"]
                    if debug:
                        line = next(i for i, text in enumerate(source.read_text().splitlines(), 1) if "value = item.payload" in text)
                        proof = debug_workload(python=python, cwd=target, env=launch_env, source=source, line=line,
                                               args=argv, program=program, module=module, log=root / f"{kind}-{mode}-debug.log")
                    else:
                        command = [python, str(program)] if program else [python, "-m", module]
                        executed = subprocess.run(command + argv, cwd=target, env=launch_env, text=True, capture_output=True, timeout=90)
                        (root / f"{kind}-{mode}-run.log").write_text(executed.stdout + executed.stderr)
                        assert executed.returncode == 0, executed.stdout[-2000:] + executed.stderr[-1000:]
                        proof = {"command": command + argv, "exit": executed.returncode}
                    state = bridge("list", mode)
                    if mode == "file":
                        output = json.loads(Path(run["env"]["RC_WORKITEM_OUTPUT_PATH"]).read_text())
                        assert output[0]["payload"] == {"observed": 7}, output
                        proof["output"] = output
                    else:
                        item = next(value for value in state["items"] if value["id"] == key)
                        output = next(value for value in state["items"] if value.get("parent_id") == key)
                        assert item["state"] == "COMPLETED", item
                        assert output["payload"] == {"observed": 7}, output
                        proof.update(input_id=key, input_state=item["state"], output_id=output["id"], parent_id=output["parent_id"], payload=output["payload"])
                    report["checks"].append({"kind": kind, "mode": mode, "debug": debug, "python": python, "sdk": "0.4.4", **proof})
                    print(f"PASS {kind} {mode} {'debug' if debug else 'run'}", flush=True)
    finally:
        (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
