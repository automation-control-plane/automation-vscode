"""Real package interpreters/owned SDK, Action and Robot File/SQLite run/debug.

Uses task-owned prepared RCC caches/homes without deleting or migrating them.
"""
import argparse
import base64
import hashlib
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
    parser.add_argument("--workload", choices=("consume", "copy_attachment"), default="consume")
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
              "extension": str(extension), "workload": args.workload,
              "scope": "Real CLI/DAP; desktop editor acceptance is separate", "checks": [], "negative_checks": []}
    attachment = (Path(__file__).parent / "fixtures/native_work_items/attachment-proof.txt").read_bytes()
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
            sdk_version = subprocess.check_output([python, "-c", "from importlib.metadata import version; print(version('actions-work-items'))"], env=env, text=True, timeout=30).strip()
            assert sdk_version == "0.4.4", sdk_version
            expected = Path(env["ACTIONS_HOME"] if kind == "action" else env["ROBOTS_HOME"])
            assert Path(python).is_relative_to(expected), python
            queue_name = "input"
            def bridge(op, mode, **params):
                command = [python, str(extension / "src/sema4ai_code/work_items_native.py")]
                value = subprocess.run(command, env=env, input=json.dumps({"manifest": str(manifest), "op": op, "mode": mode, "queue": queue_name, **params}), text=True, capture_output=True, timeout=30)
                assert value.returncode == 0, value.stdout + value.stderr
                value = json.loads(value.stdout); assert value["success"], value
                return value["result"]
            source = target / ("work_items_actions.py" if kind == "action" else "work_items_tasks.py")
            for mode in ("file", "sqlite"):
                for debug in (False, True):
                    queue_name = ("attachment-debug" if debug else "attachment-run") if args.workload == "copy_attachment" else "input"
                    key = bridge("create", mode, payload={"value": 7}, name="smoke")["id"]
                    if args.workload == "copy_attachment":
                        bridge("attach", mode, id=key, name="attachment-proof.txt",
                               files={"attachment-proof.txt": base64.b64encode(attachment).decode()})
                    run = bridge("prepare", mode, id=key)
                    launch_env = {**env, **run["env"]}
                    if kind == "action":
                        program, module = extension / "src/sema4ai_code/robo/launch_actions.py", None
                        argv = ["run", str(source), "-a", args.workload, "--json-input", run["parameters"]]
                    else:
                        program, module, argv = None, "robocorp.tasks", ["run", str(source), "-t", args.workload]
                    if debug:
                        lines = source.read_text().splitlines()
                        start = next(i for i, text in enumerate(lines) if text.startswith("def " + args.workload + "("))
                        line = next(i for i, text in enumerate(lines, 1) if i > start and "value = item.payload" in text)
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
                        receipt = next(value for value in state["receipts"] if value["id"] == run["id"])
                        output_path = Path(receipt["output"])
                        output_id = str(output_path.relative_to(target)) + "#0"
                        assert receipt["input"] == key
                        proof.update(input_id=key, output_id=output_id, receipt_id=run["id"],
                                     lineage="Local execution receipt links input to output file; FileAdapter has no durable parent_id")
                    else:
                        item = next(value for value in state["items"] if value["id"] == key)
                        output = next(value for value in state["items"] if value.get("parent_id") == key)
                        assert item["state"] == "COMPLETED", item
                        assert output["payload"] == {"observed": 7}, output
                        proof.update(input_id=key, input_state=item["state"], output_id=output["id"], parent_id=output["parent_id"], payload=output["payload"])
                        output_id = output["id"]
                    if args.workload == "copy_attachment":
                        content = base64.b64decode(bridge("download", mode, id=output_id, name="copied-proof.txt")["content"])
                        assert content == attachment, "Output attachment bytes differ"
                        original = base64.b64decode(bridge("download", mode, id=key, name="attachment-proof.txt")["content"])
                        assert original == attachment, "Input attachment was changed"
                        replay = bridge("replay", mode, id=output_id, name="attachment-replay")["id"]
                        assert replay not in (key, output_id)
                        assert base64.b64decode(bridge("download", mode, id=replay, name="copied-proof.txt")["content"]) == attachment
                        state = bridge("list", mode)
                        assert any(row["source"] == output_id and row["copy"] == replay for row in state["replays"])
                        proof.update(attachment_name="copied-proof.txt", attachment_bytes=len(content),
                                     attachment_sha256=hashlib.sha256(content).hexdigest(), replay_id=replay,
                                     replay_source=output_id, original_attachment_unchanged=True)
                    report["checks"].append({"kind": kind, "mode": mode, "debug": debug, "queue": queue_name, "python": python, "sdk": sdk_version, **proof})
                    print(f"PASS {kind} {mode} {'debug' if debug else 'run'} {args.workload}", flush=True)
                if args.workload == "copy_attachment":
                    for failure in ("missing", "wrong-bytes"):
                        queue_name = "attachment-" + failure
                        key = bridge("create", mode, payload={"value": 7}, name=failure)["id"]
                        if failure == "wrong-bytes":
                            bridge("attach", mode, id=key, name="attachment-proof.txt",
                                   files={"attachment-proof.txt": base64.b64encode(b"not the fixture\n").decode()})
                        run = bridge("prepare", mode, id=key)
                        command = ([python, str(program)] if program else [python, "-m", module]) + argv
                        # Action parameters must belong to this execution snapshot.
                        if kind == "action":
                            command[-1] = run["parameters"]
                        executed = subprocess.run(command, cwd=target, env={**env, **run["env"]}, text=True, capture_output=True, timeout=90)
                        log_text = executed.stdout + executed.stderr
                        (root / f"{kind}-{mode}-{failure}.log").write_text(log_text)
                        expected_error = "No file with name: attachment-proof.txt" if failure == "missing" else "Expected the supplied synthetic attachment-proof.txt bytes"
                        assert executed.returncode != 0 and expected_error in log_text, log_text[-3000:]
                        state = bridge("list", mode)
                        if mode == "file":
                            output_path = Path(run["env"]["RC_WORKITEM_OUTPUT_PATH"])
                            assert not output_path.exists() or json.loads(output_path.read_text()) == []
                            input_state = "LOCAL_FIXTURE"
                        else:
                            assert not any(item.get("parent_id") == key for item in state["items"])
                            input_state = next(item["state"] for item in state["items"] if item["id"] == key)
                            assert input_state != "COMPLETED", input_state
                        report["negative_checks"].append({"kind": kind, "mode": mode, "case": failure,
                            "command": command, "exit": executed.returncode, "input_id": key,
                            "input_state": input_state, "output_created": False, "expected_error": expected_error})
                        print(f"PASS {kind} {mode} rejects {failure} attachment (exit {executed.returncode})", flush=True)
    finally:
        (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
