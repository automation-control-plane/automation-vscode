"""Build/validate a local extension environment with pinned owned RCC.

This does not publish artifacts or alter machine-wide Holotree configuration.
Archive export is unavailable: RCC 18.19.7 requires shared state for prebuild.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import urllib.request


def target(system=None, machine=None):
    system, machine = system or sys.platform, (machine or platform.machine()).lower()
    arch = "x64" if machine in ("amd64", "x86_64") else machine
    key = f"{system}-{arch}"
    labels = {"linux-x64": "linux_amd64", "win32-x64": "windows_amd64", "darwin-arm64": "darwin_arm64"}
    if key not in labels:
        raise RuntimeError(f"Unsupported extension build platform: {key}")
    return key, labels[key]


def build_environment(rcc: Path | None, work_root: Path, *, check_only=False):
    work_root = work_root.resolve()
    # Never reuse, overwrite or clean an existing directory, including on failure.
    work_root.mkdir(parents=True, exist_ok=False)
    key, label = target()
    extension = Path(__file__).resolve().parents[2]
    tool = json.loads((extension / "published-tools.json").read_text())["rcc"]
    asset = tool["assets"][key]
    if rcc is None:
        rcc = work_root / asset["name"]
        url = f"https://github.com/{tool['repository']}/releases/download/{tool['tag']}/{asset['name']}"
        with urllib.request.urlopen(url, timeout=60) as response, rcc.open("xb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    rcc = rcc.resolve()
    digest = hashlib.sha256(rcc.read_bytes()).hexdigest()
    if digest != asset["sha256"]:
        raise RuntimeError(f"RCC SHA256 mismatch: expected {asset['sha256']}, found {digest}. No executable was run.")
    if rcc.parent == work_root and os.name != "nt":
        rcc.chmod(0o700)
    env = os.environ.copy()
    for name in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "CONDA_PREFIX", "MAMBA_ROOT_PREFIX", "CONDA_PKGS_DIRS"):
        env.pop(name, None)
    for name, directory in (("HOME", "os-home"), ("ACTIONS_HOME", "actions"), ("ROBOTS_HOME", "robots"), ("XDG_CACHE_HOME", "cache")):
        env[name] = str(work_root / directory)
        (work_root / directory).mkdir()
    if os.name == "nt":
        env["USERPROFILE"] = env["HOME"]
    env.update(ROBOCORP_HOME=env["ACTIONS_HOME"], RCC_HOLOTREE_MODE="private")
    commands = []

    def run(args):
        command = [str(rcc), *args, "--robocorp", "--bundled", "--controller", "AutomationCode"]
        result = subprocess.run(command, cwd=work_root, env=env, text=True, capture_output=True, timeout=900)
        commands.append({"command": command, "exit": result.returncode})
        with (work_root / "rcc.private.log").open("a", encoding="utf-8") as stream:
            stream.write(result.stderr)
        if result.returncode:
            raise RuntimeError(f"RCC failed with exit {result.returncode}; see {work_root / 'rcc.private.log'}. No shared state was enabled.")
        return result.stdout

    identity = run(["version"]).strip()
    if identity != tool["version"]:
        raise RuntimeError(f"Unexpected RCC executable identity: {identity}")
    descriptor = Path(__file__).with_name(f"conda_vscode_{label}.yaml")
    blueprint = json.loads(run(["holotree", "blueprint", "--json", str(descriptor)]))
    report = {"rcc_version": identity, "rcc_sha256": digest, "platform": key,
              "descriptor": descriptor.name, "descriptor_sha256": hashlib.sha256(descriptor.read_bytes()).hexdigest(),
              "blueprint": blueprint["hash"], "mode": "private", "check_only": check_only, "commands": commands}
    if not check_only:
        variables = json.loads(run(["holotree", "variables", "--space", "automation-extension-build", "--json", str(descriptor)]))
        values = {entry["key"]: entry["value"] for entry in variables}
        python = Path(values["PYTHON_EXE"]).resolve()
        if not python.is_relative_to(Path(env["ACTIONS_HOME"]).resolve()):
            raise RuntimeError("Build interpreter is outside this isolated Actions home.")
        report["python"] = str(python)
    (work_root / "build-result.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rcc", type=Path, help="Explicit published RCC 18.19.7; otherwise download the pinned GitHub release artifact")
    parser.add_argument("--work-root", required=True, type=Path, help="New task-owned directory; existing paths are refused")
    parser.add_argument("--check-only", action="store_true", help="Verify executable identity and descriptor blueprint without building")
    args = parser.parse_args()
    print(json.dumps(build_environment(args.rcc, args.work_root, check_only=args.check_only), indent=2))


if __name__ == "__main__":
    main()
