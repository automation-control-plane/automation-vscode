"""Qualify the opt-in Runtime HTTP shutdown path in a fresh private Linux home."""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_shutdown(shutdown_status: int, exit_code: int, forced: bool, log: str) -> str:
    if shutdown_status != 200:
        raise RuntimeError("Runtime shutdown endpoint did not return HTTP 200")
    if forced:
        raise RuntimeError("Runtime required forced termination after shutdown")
    if exit_code != 1:
        raise RuntimeError(f"Runtime shutdown exit status changed: {exit_code}")
    expected = (
        "Stopping action server...",
        "Exiting action server...",
        "Error executing action-server: exit status 1",
    )
    positions = [log.find(marker) for marker in expected]
    if any(position < 0 for position in positions) or positions != sorted(positions):
        raise RuntimeError("Runtime shutdown log did not match the source-defined interrupt order")
    return "Runtime 1.1.1 HTTP shutdown interrupts the CLI main thread and returns its source-defined status 1"


def validate_embedded_rcc(
    runtime_receipt: dict,
    runtime_pin: dict,
    runtime_sha256: str,
    observed: list[dict],
) -> dict:
    qualified_runtime = runtime_receipt["artifacts"]["actions_runtime"]
    if (
        qualified_runtime["version"] != runtime_pin["version"]
        or qualified_runtime["source_commit"] != runtime_pin["source"]
        or qualified_runtime["downloaded_file_sha256"] != runtime_sha256
    ):
        raise RuntimeError("Embedded RCC receipt is not bound to this Runtime artifact")

    embedded = runtime_receipt["runtime_bundled_rcc"]
    if not any(
        item["version"] == embedded["version"]
        and item["sha256"] == embedded["sha256"]
        for item in observed
    ):
        raise RuntimeError("Runtime embedded RCC did not match its bound qualification receipt")
    return embedded


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rcc", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--candidate-tools", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "linux":
        raise RuntimeError("Runtime shutdown smoke requires Linux")

    state = args.state.resolve()
    state.mkdir(parents=True, exist_ok=False, mode=0o700)
    home, actions_home, robots_home, tmp = (
        state / name for name in ("home", "actions", "robots", "tmp")
    )
    for directory in (home, actions_home, robots_home, tmp):
        directory.mkdir(mode=0o700)

    # Keep network trust/proxy policy, but do not inherit user credentials,
    # execution profiles or live tooling homes. Never serialize these values.
    policy_keys = ("PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
                   "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "HTTP_PROXY", "HTTPS_PROXY",
                   "NO_PROXY", "http_proxy", "https_proxy", "no_proxy")
    allowed = {key: os.environ[key] for key in policy_keys if key in os.environ}
    os.environ.clear()
    os.environ.update(allowed)
    os.environ.update(
        HOME=str(home),
        ACTIONS_HOME=str(actions_home),
        ROBOTS_HOME=str(robots_home),
        ROBOCORP_HOME=str(actions_home),
        RCC_HOLOTREE_MODE="private",
        ACTIONS_SKIP_UPDATE_CHECK="1",
        TMPDIR=str(tmp),
    )

    candidate = json.loads(args.candidate_tools.read_text(encoding="utf-8"))
    rcc_pin = candidate["rcc"]
    runtime_pin = candidate["action-server"]
    if digest(args.rcc) != rcc_pin["assets"]["linux-x64"]["sha256"]:
        raise RuntimeError("RCC does not match the candidate manifest")
    if digest(args.runtime) != runtime_pin["assets"]["linux-x64"]["sha256"]:
        raise RuntimeError("Runtime does not match the candidate manifest")
    rcc_version = subprocess.check_output(
        [str(args.rcc), "--version"], text=True, env=os.environ
    ).strip()
    runtime_version = subprocess.check_output(
        [str(args.runtime), "version"], text=True, env=os.environ
    ).strip()
    if rcc_version != rcc_pin["version"] or runtime_version != runtime_pin["version"]:
        raise RuntimeError("Candidate artifact version output does not match its manifest")

    repository = Path(__file__).resolve().parents[2]
    extension = repository / "sema4ai"
    sys.path.insert(0, str(extension / "tests"))
    sys.path.insert(0, str(extension / "src"))
    import sema4ai_code

    sema4ai_code.import_robocorp_ls_core()
    import yaml
    from sema4ai_code.rcc import Rcc
    from sema4ai_ls_core.config import Config
    from runtime_smoke import serve_action

    class Provider:
        def __init__(self):
            self.config = Config()
            self.config.update(
                {
                    "sema4ai.rcc.location": str(args.rcc),
                    "sema4ai.actionServer.location": str(args.runtime),
                }
            )

    class Endpoint:
        pass

    provider = Provider()
    rcc = Rcc(provider)
    package = state / "workspace" / "action-package"
    package.mkdir(parents=True)
    package_yaml = package / "package.yaml"
    package_yaml.write_text(
        yaml.safe_dump(
            {
                "spec-version": "v2",
                "name": "Runtime shutdown smoke",
                "version": "0.0.1",
                "description": "Synthetic local shutdown qualification",
                "dependencies": {
                    "conda-forge": ["python=3.12.12", "uv=0.8.17"],
                    "pypi": ["actions-core=1.1.0"],
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (package / "smoke_actions.py").write_text(
        "from actions import action\n\n"
        "@action\n"
        "def welcome(name: str) -> str:\n"
        '    """Return a greeting for the shutdown smoke.\n\n'
        "    Args:\n"
        "        name: The greeting recipient.\n\n"
        "    Returns:\n"
        "        The greeting text.\n"
        '    """\n'
        "    return f'Hello {name}'\n",
        encoding="utf-8",
    )

    environment = rcc.get_robot_yaml_env_info(
        None, package_yaml, package_yaml.read_text(encoding="utf-8"), None, timeout=600
    )
    if not environment.success:
        raise RuntimeError("RCC could not resolve the synthetic Action Package environment")
    action_env = {**os.environ, **environment.result.env}
    python = action_env["PYTHON_EXE"]
    sdk_versions = json.loads(
        subprocess.check_output(
            [
                python,
                "-c",
                "import importlib.metadata as m, json; print(json.dumps({'actions-core': m.version('actions-core')}))",
            ],
            cwd=package,
            env=action_env,
            text=True,
        )
    )
    if sdk_versions != {"actions-core": "1.1.0"}:
        raise RuntimeError("Resolved Actions Core version did not match the synthetic package pin")

    runtime_result = serve_action(
        executable=str(args.runtime),
        package=package,
        env=action_env,
        log=state / "runtime-http.log",
        expected_version=runtime_pin["version"],
    )
    log = (state / "runtime-http.log").read_text(encoding="utf-8", errors="replace")
    classification = validate_shutdown(
        runtime_result["shutdown_status"],
        runtime_result["runtime_exit_code"],
        runtime_result["forced_termination"],
        log,
    )

    embedded_rcc = runtime_result["bundled_rcc"]
    runtime_receipt = json.loads(
        (repository / "docs/evidence/dogfood-setup-20261115/qualification.json").read_text(
            encoding="utf-8"
        )
    )
    expected_embedded_rcc = validate_embedded_rcc(
        runtime_receipt, runtime_pin, digest(args.runtime), embedded_rcc
    )
    report = {
        "result": "pass",
        "platform": "linux-x64",
        "runtime_source_commit": runtime_pin["source"],
        "rcc_candidate": {"version": rcc_version, "sha256": digest(args.rcc)},
        "runtime_candidate": {"version": runtime_version, "sha256": digest(args.runtime)},
        "actions_core": sdk_versions["actions-core"],
        "action_result": runtime_result["result"],
        "shutdown_http_status": runtime_result["shutdown_status"],
        "forced_termination": runtime_result["forced_termination"],
        "runtime_exit_code": runtime_result["runtime_exit_code"],
        "exit_classification": classification,
        "shutdown_log_markers": [
            "Stopping action server...",
            "Exiting action server...",
            "Error executing action-server: exit status 1",
        ],
        "runtime_embedded_rcc": embedded_rcc,
        "qualified_embedded_rcc": expected_embedded_rcc,
        "embedded_rcc_matches_runtime_receipt": True,
    }
    (state / "qualification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
