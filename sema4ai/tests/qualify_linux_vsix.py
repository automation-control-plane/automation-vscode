"""Install an exact Linux VSIX and exercise its backend; not native GUI proof."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import zipfile

CODE_SHA256 = "cbdb7bde3d358c7297cf1d9d6adc16dfb1d0179501fb2c152df48593e39e3600"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--vsix", type=Path, required=True)
    parser.add_argument("--code-archive", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "linux":
        raise RuntimeError("Actual Linux is required")
    root = args.state.resolve()
    root.mkdir(parents=True, exist_ok=False)
    repository = Path(__file__).resolve().parents[2]
    extension = repository / "sema4ai"
    public = root / "public"
    public.mkdir()
    report = {"platform": "linux-x64", "passed": False, "checks": [],
              "scope": "Actual isolated Code CLI installation and installed Python/JS contracts; no GUI, debugger, or cold RCC bootstrap claim",
              "source": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip(),
              "artifact": {"filename": args.vsix.name, "sha256": digest(args.vsix)}}
    env = {key: value for key, value in os.environ.items() if key in ("PATH", "LANG", "LC_ALL")}
    for key, folder in (("HOME", "home"), ("XDG_CACHE_HOME", "cache"), ("TMPDIR", "tmp")):
        destination = root / folder
        destination.mkdir()
        env[key] = str(destination)

    def run(command, name, environment=env):
        with (root / (name + ".private.log")).open("wb") as log:
            subprocess.run(command, cwd=repository, env=environment, stdout=log,
                           stderr=subprocess.STDOUT, check=True, timeout=180)
        report["checks"].append(name)

    try:
        assert digest(args.code_archive) == CODE_SHA256, "Official Code archive hash mismatch"
        code_root = root / "code"
        code_root.mkdir()
        with tarfile.open(args.code_archive) as archive:
            archive.extractall(code_root, filter="data")
        executables = list(code_root.glob("*/code"))
        assert len(executables) == 1, "Official Code executable layout is ambiguous"
        code = executables[0]
        cli_entries = list(code.parent.glob("resources/app/out/cli.js")) + list(code.parent.glob("*/resources/app/out/cli.js"))
        assert len(cli_entries) == 1, "Official Code CLI layout is ambiguous"
        extensions = root / "extensions"
        run([str(code), str(cli_entries[0]), f"--user-data-dir={root / 'profile'}",
             f"--extensions-dir={extensions}", "--install-extension", str(args.vsix.resolve())],
            "actual-code-cli-install", {**env, "ELECTRON_RUN_AS_NODE": "1"})
        installed = list(extensions.glob("automation-control-plane.automation-vscode-*"))
        assert len(installed) == 1
        installed = installed[0]
        compared = 0
        with zipfile.ZipFile(args.vsix) as archive:
            target = archive.read("extension.vsixmanifest").decode("utf-8")
            assert 'TargetPlatform="linux-x64"' in target
            for name in archive.namelist():
                if not name.startswith("extension/") or name.endswith("/"):
                    continue
                relative = name.removeprefix("extension/")
                expected = archive.read(name)
                actual = (installed / relative).read_bytes()
                if relative == "package.json":
                    actual_manifest = json.loads(actual)
                    actual_manifest.pop("__metadata", None)
                    assert actual_manifest == json.loads(expected), relative
                else:
                    assert actual == expected, relative
                source = extension / ("README.md" if relative.lower() == "readme.md" else relative)
                assert source.read_bytes() == expected, "Source/VSIX mismatch: " + relative
                compared += 1
        report["payloads_verified"] = compared
        report["version"] = json.loads((installed / "package.json").read_text())["version"]
        runtime_env = {**env, "PYTHONPATH": os.pathsep.join([
            str(installed / "src"), str(installed / "src/sema4ai_code/vendored")])}
        run([sys.executable, "-m", "pytest", "--noconftest", str(extension / "tests/test_package_pythonpath.py"), "-q"],
            "installed-python-discovery-metadata-input-contracts", runtime_env)
        wrapper = root / "installed-js.cjs"
        wrapper.write_text("const Module=require('node:module'),path=require('node:path');\n"
                           "const load=Module._load;Module._load=function(name,...args){\n"
                           "if(name.startsWith('../vscode-client/out/')) name=path.join(process.argv[2],name.slice(3));\n"
                           "return load.call(this,name,...args);};require(process.argv[3]);\n")
        run(["node", str(wrapper), str(installed), str(extension / "tests/python_integration.test.js")],
            "installed-js-optional-integration-unit-contracts")
        report["passed"] = True
    finally:
        (public / "qualification.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
