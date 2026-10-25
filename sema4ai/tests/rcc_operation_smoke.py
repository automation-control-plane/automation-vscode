"""Real installed RCC local-value regression; no vendor command is executed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--installed", type=Path, required=True)
    parser.add_argument("--rcc", type=Path, required=True)
    parser.add_argument("--prepared-actions-home", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert hashlib.sha256(args.rcc.read_bytes()).hexdigest() == "f8e0394be7f47ee84d6f4cd734822b87b492a4d6102f977f6a18f29453703d48"
    args.output.mkdir(parents=True, exist_ok=False)
    sys.path[:0] = [str(args.installed / "src"), str(args.installed / "src/sema4ai_code/vendored")]
    from sema4ai_code.rcc import Rcc
    from sema4ai_ls_core.config import Config
    for key, subdir in (("HOME", "home"), ("ACTIONS_HOME", "actions"), ("ROBOTS_HOME", "robots")):
        path = args.output / subdir
        path.mkdir()
        os.environ[key] = str(path)
    os.environ["RCC_HOLOTREE_MODE"] = "private"
    class Provider:
        config = Config()
    provider = Provider()
    provider.config.update({"sema4ai.rcc.location": str(args.rcc)})
    rcc = Rcc(provider)
    checks = []
    for name in ("cloud", "credentials", "feedback"):
        profile = args.output / f"{name}.yaml"
        profile.write_text(f"name: {name}\ndescription: Synthetic operation guard regression\nsettings: {{}}\n")
        imported = rcc.profile_import(str(profile))
        assert imported.success, imported.message
        switched = rcc.profile_switch(name)
        assert switched.success, switched.message
        listed = rcc.profile_list()
        assert listed.success and listed.result["current"] == name, listed
        checks.append({"operation": "profile_switch", "name": name, "current": listed.result["current"], "success": True})
    # Reuse only an explicitly supplied, task-owned prepared cache. --no-build
    # prevents downloads; it creates a named local space, not a shared Holotree.
    os.environ["ACTIONS_HOME"] = str(args.prepared_actions_home)
    descriptor = args.installed / "bin/create_env/conda_vscode_linux_amd64.yaml"
    for name in ("cloud", "credentials", "feedback"):
        result = rcc.holotree_variables(descriptor, name, no_build=True)
        assert result.success, result.message
        values = {value["key"]: value["value"] for value in json.loads(result.result)}
        assert Path(values["PYTHON_EXE"]).resolve().is_relative_to(args.prepared_actions_home.resolve())
        checks.append({"operation": "holotree_variables", "space": name, "success": True, "python": values["PYTHON_EXE"]})
    def forbidden_lookup():
        raise AssertionError("Guard reached executable lookup")
    rcc.get_rcc_location = forbidden_lookup
    for command in (["cloud", "workspace"], ["c", "workspace"], ["robocorp", "workspace"], ["feedback", "metric"], ["f", "metric"], ["--config", "cloud", "configure", "credentials"]):
        result = rcc._run_rcc(command)
        assert not result.success and "disabled" in result.message
        checks.append({"operation": "blocked_before_executable_lookup", "args": command, "success": True})
    report = {"classification": "Actual installed Python/RCC local profile and space operations; vendor operations guarded before execution", "checks": checks}
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"checks": len(checks), "result": "PASS"}))


if __name__ == "__main__":
    main()
