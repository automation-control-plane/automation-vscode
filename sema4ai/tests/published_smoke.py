"""Real Linux published-tool smoke. Run with the extension's Poetry interpreter.

No existing directory is reused. The outer process starts a worker with a private
OS home so the published Go wrapper and micromamba can create their own caches.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rcc", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--worker-root")
    parser.add_argument("--work-root")
    parser.add_argument("--extension-root")
    args = parser.parse_args()
    if not args.worker_root:
        root = Path(
            tempfile.mkdtemp(prefix="automation-published-smoke-", dir=args.work_root)
        )
        task_home = root / "os-home"
        task_home.mkdir(mode=0o700)
        temporary = root / "tmp"
        temporary.mkdir()
        child_environment = os.environ.copy()
        child_environment.update(
            {
                "HOME": str(task_home),
                "ACTIONS_HOME": str(root / "actions-home"),
                "ROBOTS_HOME": str(root / "robots-home"),
                "ROBOCORP_HOME": str(root / "actions-home"),
                "RCC_HOLOTREE_MODE": "private",
                "ACTIONS_SKIP_UPDATE_CHECK": "1",
                "UV_CACHE_DIR": str(root / "uv-cache"),
                "TMPDIR": str(temporary),
            }
        )
        print(f"SMOKE_ROOT={root}", flush=True)
        worker_args = [
            sys.executable,
            __file__,
            "--rcc",
            args.rcc,
            "--runtime",
            args.runtime,
            "--worker-root",
            str(root),
        ]
        if args.extension_root:
            worker_args.extend(["--extension-root", args.extension_root])
        result = subprocess.run(worker_args, env=child_environment)
        return result.returncode
    return worker(args)


def worker(args):
    if args.extension_root:
        sys.path.insert(0, str(Path(args.extension_root) / "src"))
        sys.path.insert(0, str(Path(args.extension_root) / "src/sema4ai_code/vendored"))
    import yaml
    from sema4ai_code.action_server import ActionServer
    from sema4ai_code.published_tools import published_tool
    from sema4ai_code.rcc import Rcc
    from sema4ai_ls_core.config import Config

    if args.extension_root:
        import sema4ai_code
        import sema4ai_ls_core

        assert Path(sema4ai_code.__file__).is_relative_to(Path(args.extension_root))
        assert Path(sema4ai_ls_core.__file__).is_relative_to(Path(args.extension_root))
    root = Path(args.worker_root)
    extension = (
        Path(args.extension_root)
        if args.extension_root
        else Path(__file__).resolve().parents[1]
    )
    report = {
        "root": str(root),
        "source_sha": subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parents[1],
            text=True,
        ).strip(),
        "real_executions": [],
        "commands": [],
    }

    def command(argv, *, cwd=None, env=None, input=None):
        argv = [str(arg) for arg in argv]
        result = subprocess.run(
            argv,
            cwd=cwd or root,
            env=env or os.environ.copy(),
            input=input,
            text=True,
            capture_output=True,
            timeout=600,
        )
        index = len(report["commands"])
        (root / f"command-{index}.log").write_text(result.stdout + result.stderr)
        report["commands"].append(
            {
                "argv": argv,
                "cwd": str(cwd or root),
                "exit": result.returncode,
                "log": f"command-{index}.log",
            }
        )
        (root / "report.json").write_text(json.dumps(report, indent=2))
        if result.returncode:
            raise RuntimeError(
                f"Command failed: {argv}\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}"
            )
        return result.stdout

    def passed(name, **evidence):
        report["real_executions"].append({"check": name, **evidence})
        (root / "report.json").write_text(json.dumps(report, indent=2))
        print(f"PASS {name}", flush=True)

    for tool, executable, version_args in (
        ("rcc", args.rcc, ["--version"]),
        ("action-server", args.runtime, ["version"]),
    ):
        artifact = published_tool(tool)
        digest = hashlib.sha256(Path(executable).read_bytes()).hexdigest()
        assert digest == artifact["sha256"], tool
        version = command([executable, *version_args]).strip()
        assert version == artifact["version"], (tool, version)
        passed(f"{tool} published wrapper identity", version=version, sha256=digest)

    class Provider:
        def __init__(self):
            self.config = Config()
            self.config.update(
                {
                    "sema4ai.rcc.location": args.rcc,
                    "sema4ai.actionServer.location": args.runtime,
                }
            )

    class Endpoint:
        pass

    provider, endpoint = Provider(), Endpoint()
    rcc = Rcc(provider)
    server = ActionServer(provider, endpoint)
    workspace = root / "workspace"
    workspace.mkdir()
    action_dir = workspace / "action-package"
    templates = server.get_action_templates()
    assert templates.success, templates.message
    created = server.create_action_package(
        str(action_dir), "minimal", "Published compatibility smoke"
    )
    assert created.success, created.message
    package_yaml = action_dir / "package.yaml"
    package = yaml.safe_load(package_yaml.read_text())
    assert "actions-core=1.0.3" in package["dependencies"]["pypi"]
    # These are authored dependencies in the synthetic project, not extension dependencies.
    package["dependencies"]["pypi"].extend(
        ["actions-work-items=0.4.4", "debugpy=1.8.22"]
    )
    package_yaml.write_text(yaml.safe_dump(package, sort_keys=False))
    action_source = action_dir / "smoke_actions.py"
    action_source.write_text('''from actions import action, work_items

@action
def welcome(name: str) -> str:
    """Return a greeting.

    Args:
        name: The recipient.

    Returns:
        The greeting.
    """
    greeting = f"Hello {name}"
    return greeting

@action
def consume() -> str:
    """Consume a local work item and produce a result.

    Returns:
        The observed value.
    """
    for item in work_items.inputs:
        value = item.payload["value"]
        work_items.outputs.create(payload={"observed": value})
        item.done()
        return str(value)
    raise RuntimeError("Expected a local input Work Item")
''')
    passed(
        "Action Package creation through extension backend",
        templates=len(templates.result),
        package=str(package_yaml),
    )
    action_environment = rcc.get_robot_yaml_env_info(
        None, package_yaml, package_yaml.read_text(), None, timeout=600
    )
    assert action_environment.success, action_environment.message
    action_env = {**os.environ, **action_environment.result.env}
    action_python = action_env["PYTHON_EXE"]
    target_cli = extension / "src/sema4ai_code/robo/action_runtime.py"
    collected = json.loads(
        command(
            [
                action_python,
                target_cli,
                "list",
                "--skip-lint",
                "--glob",
                "smoke_actions.py",
            ],
            cwd=action_dir,
            env=action_env,
        )
    )
    assert {"welcome", "consume"}.issubset({item["name"] for item in collected})
    lint = command(
        [action_python, extension / "src/sema4ai_code/robo/lint_in_target_env.py"],
        cwd=action_dir,
        env=action_env,
        input=action_source.read_text(),
    )
    assert json.loads(lint) == [], lint
    input_path = action_dir / "input.json"
    input_path.write_text('{"name":"Dakota"}')
    action_result = root / "action-result.json"
    launch = extension / "src/sema4ai_code/robo/launch_actions.py"
    command(
        [
            action_python,
            launch,
            "run",
            action_source,
            "-a",
            "welcome",
            "--json-input",
            input_path,
            "--json-output",
            action_result,
        ],
        cwd=action_dir,
        env=action_env,
    )
    assert json.loads(action_result.read_text())["result"] == "Hello Dakota"
    passed(
        "Action discovery, lint and execution",
        python=action_python,
        result="Hello Dakota",
    )

    input_work_item, output_work_item = (
        root / "input-work-item.json",
        root / "output-work-item.json",
    )
    input_work_item.write_text('[{"payload":{"value":7},"files":{}}]')
    legacy_controls = {
        "RPA_WORKITEMS_ADAPTER": "RPA.Robocorp.WorkItems.FileAdapter",
        "RPA_INPUT_WORKITEM_PATH": str(input_work_item),
        "RPA_OUTPUT_WORKITEM_PATH": str(output_work_item),
    }
    controls = json.loads(
        command(
            [
                "node",
                "-e",
                "const fs=require('fs'); const {publishedWorkItemEnvironment}=require(process.argv[1]); process.stdout.write(JSON.stringify(publishedWorkItemEnvironment(JSON.parse(fs.readFileSync(0,'utf8')))));",
                extension / "vscode-client/out/runtimePaths.js",
            ],
            input=json.dumps(legacy_controls),
        )
    )
    command(
        [action_python, launch, "run", action_source, "-a", "consume"],
        cwd=action_dir,
        env={**action_env, **controls},
    )
    work_items_result = json.loads(output_work_item.read_text())
    assert work_items_result[0]["payload"] == {"observed": 7}, work_items_result
    passed(
        "Published Work Items FileAdapter input/output",
        version="0.4.4",
        output=work_items_result,
    )

    robot_templates = rcc.get_template_names()
    assert robot_templates.success and robot_templates.result, robot_templates.message
    robot_template = next(
        (
            template["name"]
            for template in robot_templates.result
            if "python" in template["name"].lower()
        ),
        robot_templates.result[0]["name"],
    )
    robot_dir = workspace / "robot-package"
    result = rcc.create_robot(robot_template, str(robot_dir))
    assert result.success, result.message
    robot_yaml = robot_dir / "robot.yaml"
    conda_yaml = robot_dir / "conda.yaml"
    robot_yaml.write_text(
        "tasks:\n  Smoke task:\n    shell: python -m robocorp.tasks run smoke_tasks.py\nenvironmentConfigs:\n  - conda.yaml\nartifactsDir: output\nPATH:\n  - .\nPYTHONPATH:\n  - .\n"
    )
    conda_yaml.write_text(
        yaml.safe_dump(
            {
                "channels": ["conda-forge"],
                "dependencies": [
                    "python=3.12.12",
                    "uv=0.8.17",
                    {"pip": ["robocorp-tasks==4.1.1", "debugpy==1.8.22"]},
                ],
            }
        )
    )
    robot_source = robot_dir / "smoke_tasks.py"
    robot_source.write_text("""from robocorp.tasks import task
from pathlib import Path
import os

@task
def smoke():
    message = "Robot Task passed"
    Path("robot-result.txt").write_text(message)
    assert os.environ["ROBOCORP_HOME"] == os.environ["ROBOTS_HOME"]
    print(message)
""")
    robot_environment = rcc.get_robot_yaml_env_info(
        robot_yaml, conda_yaml, conda_yaml.read_text(), None, timeout=600
    )
    assert robot_environment.success, robot_environment.message
    robot_env = {**os.environ, **robot_environment.result.env}
    command(
        [
            args.rcc,
            "run",
            "--robot",
            robot_yaml,
            "--task",
            "Smoke task",
            "--bundled",
            "--robocorp",
            "--controller",
            "AutomationVSCodeSmoke",
        ],
        cwd=robot_dir,
        env=robot_env,
    )
    assert (robot_dir / "robot-result.txt").read_text() == "Robot Task passed"
    assert Path(action_env["CONDA_PREFIX"]).is_relative_to(
        Path(action_env["ACTIONS_HOME"])
    )
    assert Path(robot_env["CONDA_PREFIX"]).is_relative_to(
        Path(robot_env["ROBOTS_HOME"])
    )
    assert action_env["CONDA_PREFIX"] != robot_env["CONDA_PREFIX"]
    passed(
        "Robot creation and RCC execution",
        template=robot_template,
        python=robot_env["PYTHON_EXE"],
    )
    passed(
        "Action/Robot Holotree isolation",
        actions=action_env["CONDA_PREFIX"],
        robots=robot_env["CONDA_PREFIX"],
    )
    from dap_smoke import debug_workload

    action_line = next(
        index
        for index, text in enumerate(action_source.read_text().splitlines(), 1)
        if "greeting =" in text
    )
    action_debug = debug_workload(
        python=action_python,
        cwd=action_dir,
        env=action_env,
        source=action_source,
        line=action_line,
        program=launch,
        args=[
            "run",
            str(action_source),
            "-a",
            "welcome",
            "--json-input",
            str(input_path),
        ],
        log=root / "action-debug-adapter.log",
    )
    passed("Action breakpoint and continue", **action_debug)
    robot_line = next(
        index
        for index, text in enumerate(robot_source.read_text().splitlines(), 1)
        if "message =" in text
    )
    robot_debug = debug_workload(
        python=robot_env["PYTHON_EXE"],
        cwd=robot_dir,
        env=robot_env,
        source=robot_source,
        line=robot_line,
        module="robocorp.tasks",
        args=["run", str(robot_source)],
        log=root / "robot-debug-adapter.log",
    )
    passed("Robot breakpoint and continue", **robot_debug)
    from runtime_smoke import serve_action

    runtime_result = serve_action(
        executable=args.runtime,
        package=action_dir,
        env=action_env,
        log=root / "runtime-http.log",
    )
    passed("Published Runtime wrapper HTTP Action execution", **runtime_result)
    built = server.package_build(str(action_dir), str(root / "dist"))
    assert built.success, built.message
    assert Path(built.result["package_path"]).is_file(), built.result
    metadata = server.package_metadata(str(action_dir), str(root / "metadata.json"))
    assert metadata.success, metadata.message
    assert json.loads((root / "metadata.json").read_text())
    passed(
        "Published Runtime local package build and metadata",
        package_path=built.result["package_path"],
    )
    report["action_python"] = action_python
    report["robot_python"] = robot_env["PYTHON_EXE"]
    report["workspace"] = str(workspace)
    (root / "action-environment.json").write_text(json.dumps(action_env))
    (root / "robot-environment.json").write_text(json.dumps(robot_env))
    (root / "report.json").write_text(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
