"""Native Windows installed-VSIX acceptance. Never substitutes Linux or mocks.

Only public receipts go in public/. Private Code/RCC logs stay outside it.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

CODE_URL = "https://vscode.download.prss.microsoft.com/dbazure/download/stable/69047191fc427f2f92828279aae1d90d8eeda7ab/VSCode-win32-x64-1.146.0.zip"
CODE_SHA256 = "0d47f5bbff72499c6a4a92f6d72dd8cc5ba4606185f624465032626614119d61"
SYSTEM_KEYS = {
    "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "HOMEDRIVE", "HOMEPATH",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
}


def clean_environment(source, extra=None):
    result = {key: value for key, value in source.items() if key.upper() in SYSTEM_KEYS}
    result.update(PYTHONNOUSERSITE="1", PYTHONUTF8="1")
    if extra:
        task_keys = {"HOME", "ACTIONS_HOME", "ROBOTS_HOME", "RCC_HOLOTREE_MODE", "AUTOMATION_WINDOWS_QA"}
        if any(key.upper() not in SYSTEM_KEYS | task_keys for key in extra):
            raise ValueError("Unapproved QA environment variable")
        result.update(extra)
    return result


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def extract_archive(archive, destination):
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            target = (destination / entry.filename).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Archive member escapes qualification directory")
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Archive symlinks are not admitted")
        source.extractall(destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "win32":
        raise RuntimeError("Native Windows is required; packaging on Linux is not acceptance")
    root = args.state.resolve()
    root.mkdir(parents=True, exist_ok=False)
    public = root / "public"
    public.mkdir()
    repository = Path(__file__).resolve().parents[2]
    extension = repository / "sema4ai"
    report = {"platform": "win32-x64", "passed": False, "checks": [], "limitations": [
        "Native debug API/registered adapter acceptance; no fabricated Work Items button or managed-server acceptance.",
        "Windows managed UI/server, Java inspector, image/recording and external integrations require separate acceptance.",
        "No Mac or Marketplace publication. No system registry/firewall/service changes.",
    ]}
    env = clean_environment(os.environ, {
        "HOME": str(root / "home"), "ACTIONS_HOME": str(root / "actions"),
        "ROBOTS_HOME": str(root / "robots"), "RCC_HOLOTREE_MODE": "private",
        "AUTOMATION_WINDOWS_QA": str(root),
    })
    for name in ("home", "actions", "robots"):
        (root / name).mkdir()
    child = None

    def save():
        (public / "qualification.json").write_text(json.dumps(report, indent=2) + "\n")

    def run(command, name, cwd=extension, environment=None):
        with (root / (name + ".private.log")).open("wb") as log:
            result = subprocess.run(command, cwd=cwd, env=environment or env, stdout=log,
                                    stderr=subprocess.STDOUT, timeout=1500)
        if result.returncode:
            raise RuntimeError(f"{name} failed with exit {result.returncode}; private diagnostics retained")

    try:
        # Read-only prerequisite. Never enable long paths or request elevation.
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem") as key:
            if winreg.QueryValueEx(key, "LongPathsEnabled")[0] != 1:
                raise RuntimeError("Windows long paths are disabled; no registry change attempted")
        report["source"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, env=env, text=True).strip()
        version = json.loads((extension / "package.json").read_text())["version"]
        vsix = public / f"automation-vscode-{version}-win32-x64.vsix"
        npm = shutil.which("npm.cmd", path=env["Path"] if "Path" in env else env["PATH"])
        if not npm:
            raise RuntimeError("Prepared Node/npm toolchain unavailable")
        node = shutil.which("node.exe", path=env.get("Path", env.get("PATH")))
        npm_cli = Path(npm).parent / "node_modules/npm/bin/npm-cli.js"
        if not node or not npm_cli.is_file():
            raise RuntimeError("Prepared Node/npm entry point unavailable")
        run([node, str(npm_cli), "ci"], "npm-ci")
        run([node, str(npm_cli), "run", "vsce:package", "--", "--target", "win32-x64", "--out", str(vsix)], "package")
        report["artifact"] = {"filename": vsix.name, "sha256": digest(vsix), "size": vsix.stat().st_size}
        report["checks"].append("Windows x64 VSIX packaged on native Windows")
        save()
        archive = root / "code.zip"
        with urllib.request.urlopen(CODE_URL, timeout=90) as response, archive.open("wb") as target:
            shutil.copyfileobj(response, target)
        if digest(archive) != CODE_SHA256:
            raise RuntimeError("Official Code archive digest mismatch")
        code_root = root / "code"
        extract_archive(archive, code_root)
        code = code_root / "Code.exe"
        profile, extensions = root / "profile", root / "extensions"
        cli = [str(code), str(code_root / "resources/app/out/cli.js")]
        cli_env = {**env, "ELECTRON_RUN_AS_NODE": "1"}
        run([*cli, f"--user-data-dir={profile}", f"--extensions-dir={extensions}",
             "--install-extension", str(vsix)], "install-vsix", environment=cli_env)
        # Public debugger prerequisite, no publisher account or credential.
        run([*cli, f"--user-data-dir={profile}", f"--extensions-dir={extensions}",
             "--install-extension", "ms-python.python"], "install-python", environment=cli_env)
        installed = next(p for p in extensions.glob("automation-control-plane.automation-vscode-*") if p.is_dir())
        mismatches = []
        with zipfile.ZipFile(vsix) as zipped:
            members = [n for n in zipped.namelist() if n.startswith("extension/") and not n.endswith("/")]
            for name in members:
                relative = name.removeprefix("extension/")
                expected, actual = zipped.read(name), (installed / relative).read_bytes()
                if relative == "package.json":
                    metadata = json.loads(actual)
                    metadata.pop("__metadata", None)
                    same = metadata == json.loads(expected)
                else:
                    same = actual == expected
                source = extension / ("README.md" if relative.lower() == "readme.md" else relative)
                if not same or source.read_bytes() != expected:
                    mismatches.append(relative)
        if mismatches:
            raise RuntimeError("Installed/source VSIX payload mismatch: " + ", ".join(mismatches))
        report["payloads_verified"] = len(members)
        report["code"] = {"version": "1.146.0", "sha256": CODE_SHA256}
        workspace = root / "workspace"
        shutil.copytree(extension / "tests/fixtures/native_work_items", workspace)
        action = workspace / "action/package.yaml"
        action.write_text(action.read_text().replace("actions-core=1.0.3", "actions-core=1.1.0"))
        settings = profile / "User/settings.json"
        settings.parent.mkdir(parents=True, exist_ok=True)
        # No configured Python/RCC/Runtime: the installed bootstrap must run.
        settings.write_text(json.dumps({"extensions.autoUpdate": False,
            "extensions.autoCheckUpdates": False, "workbench.startupEditor": "none",
            "sema4ai.legacyVendorIntegrations.enabled": False,
            "sema4ai.actionServer.port": 18526}))
        controller = root / "controller"
        controller.mkdir()
        (controller / "package.json").write_text(json.dumps({"name": "windows-qualification",
            "publisher": "task-local", "version": "0.0.1", "engines": {"vscode": "^1.101.0"}}))
        test_path = extension / "tests/windows_installed_host.cjs"
        with (root / "extension-host.private.log").open("wb") as log:
            child = subprocess.Popen([str(code), f"--user-data-dir={profile}",
                f"--extensions-dir={extensions}", f"--extensionDevelopmentPath={controller}",
                f"--extensionTestsPath={test_path}", "--skip-welcome", "--skip-release-notes",
                str(workspace)], env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                status = child.wait(timeout=2400)
            except subprocess.TimeoutExpired:
                raise RuntimeError("Native Extension Host acceptance timed out; no replay attempted")
        host = public / "installed-host.json"
        if status != 0 or not host.exists() or not json.loads(host.read_text()).get("passed"):
            raise RuntimeError("Actual installed Extension Host did not pass; see sanitized host receipt")
        report["checks"].append("Actual installed Extension Host completed all required native gates")
        report["passed"] = True
    except Exception as error:
        report["blocker"] = str(error)
        raise
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            child.wait(timeout=30)
        save()
        (public / "SHA256SUMS.txt").write_text("".join(
            digest(p) + "  " + p.name + "\n" for p in sorted(public.iterdir()) if p.name != "SHA256SUMS.txt"))


if __name__ == "__main__":
    main()
