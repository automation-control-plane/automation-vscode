import hashlib
import io
import json
import os
import stat
from pathlib import Path
import subprocess

import pytest
import yaml

import qualify_linux_vsix
import qualify_release_linux as qualification


def promoted_manifest():
    return {
        tool: {
            "version": details["version"],
            "repository": details["repository"],
            "tag": details["tag"],
            "source": details["source"],
            "assets": {"linux-x64": {"name": details["asset"], "sha256": details["sha256"]}},
        }
        for tool, details in qualification.TOOLS.items()
    }


def test_production_manifest_must_match_promoted_release_and_linux_assets():
    promoted = promoted_manifest()
    assert qualification.validate_promoted_manifests(promoted, promoted) == promoted

    old_production = json.loads(json.dumps(promoted))
    old_production["rcc"]["version"] = "v18.19.8"
    with pytest.raises(RuntimeError, match="Production rcc version"):
        qualification.validate_promoted_manifests(old_production, promoted)

    missing_asset = json.loads(json.dumps(promoted))
    missing_asset["action-server"]["assets"]["linux-x64"]["sha256"] = "0" * 64
    with pytest.raises(RuntimeError, match="Production action-server Linux sha256"):
        qualification.validate_promoted_manifests(missing_asset, promoted)


def test_downloaded_archive_and_tool_bytes_must_match_expected_digest(monkeypatch, tmp_path):
    payload = b"official archive fixture"
    digest = hashlib.sha256(payload).hexdigest()
    monkeypatch.setattr(
        qualification.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: io.BytesIO(payload),
    )
    target = tmp_path / "release-asset.bin"
    qualification.download_verified("https://example.invalid/release-asset.bin", digest, target)
    assert target.read_bytes() == payload
    if os.name == "posix":
        assert stat.S_IMODE(target.stat().st_mode) & 0o111 == 0

    executable = tmp_path / "verified-tool"
    qualification.download_verified("https://example.invalid/tool", digest, executable, executable=True)
    if os.name == "posix":
        assert stat.S_IMODE(executable.stat().st_mode) == 0o700

    bad = tmp_path / "bad.bin"
    with pytest.raises(RuntimeError, match="digest mismatch"):
        qualification.download_verified("https://example.invalid/release-asset.bin", "0" * 64, bad)
    assert not bad.exists()

    with pytest.raises(RuntimeError, match="HTTPS"):
        qualification.download_verified("http://example.invalid/release-asset.bin", digest, tmp_path / "insecure.bin")


def test_smoke_summary_omits_private_command_paths_and_environment_values():
    summary = qualification.sanitized_smoke_report({
        "source_sha": "release-head",
        "working_tree_dirty": False,
        "candidate_manifest_sha256": "manifest-digest",
        "qualification_source_sha256": {"source.py": "source-digest"},
        "real_executions": [{
            "check": "Published Runtime wrapper HTTP Action execution",
            "runtime_version": "1.1.1",
            "shutdown_status": 200,
            "runtime_exit_code": 1,
            "forced_termination": False,
            "bundled_rcc": [{"version": "v18.19.8", "sha256": "runtime-bundle-hash"}],
            "result": "Hello HTTP Dakota",
            "package": "/tmp/private/action",
        }],
        "commands": [{"argv": ["/tmp/private/python"], "cwd": "/tmp/private"}],
        "action_python": "/tmp/private/python",
    })

    assert summary["checks"] == ["Published Runtime wrapper HTTP Action execution"]
    assert summary["runtime_shutdown"]["runtime_exit_code"] == 1
    assert summary["runtime_shutdown"]["bundled_rcc"][0]["version"] == "v18.19.8"
    assert "/tmp/private" not in json.dumps(summary)


def test_smoke_summary_rejects_unexpected_clean_runtime_exit():
    report = {
        "real_executions": [{
            "check": "Published Runtime wrapper HTTP Action execution",
            "runtime_version": "1.1.1",
            "shutdown_status": 200,
            "runtime_exit_code": 0,
            "forced_termination": False,
        }],
    }
    with pytest.raises(RuntimeError, match="pinned release contract"):
        qualification.sanitized_smoke_report(report)


def test_official_code_archive_cli_must_report_expected_version_and_commit():
    identity = qualify_linux_vsix.validate_code_identity(
        "1.146.0\n69047191fc427f2f92828279aae1d90d8eeda7ab\nx64\n"
    )
    assert identity["version"] == "1.146.0"
    assert identity["commit"] == "69047191fc427f2f92828279aae1d90d8eeda7ab"
    with pytest.raises(RuntimeError, match="version/build identity mismatch"):
        qualify_linux_vsix.validate_code_identity("1.145.2\nwrong-commit\nx64\n")


@pytest.mark.skipif(os.name != "posix", reason="Linux release shell contract")
def test_release_caches_are_resolved_in_a_runtime_step(tmp_path):
    workflow = yaml.load(
        (Path(__file__).parents[2] / ".github/workflows/qualify-owned-windows.yml").read_text(),
        Loader=yaml.BaseLoader,
    )
    job = workflow["jobs"]["linux-release-vsix"]
    assert "runner.temp" not in json.dumps(job.get("env", {}))
    step = next(s for s in job["steps"] if s.get("name") == "Use task-owned release caches")
    runner_temp = tmp_path / "runner temp"
    runner_temp.mkdir()
    output = tmp_path / "github env"
    subprocess.run(
        ["/bin/bash", "-euo", "pipefail"], input=step["run"], text=True, check=True,
        env={"RUNNER_TEMP": str(runner_temp), "GITHUB_ENV": str(output)},
    )
    values = dict(line.split("=", 1) for line in output.read_text().splitlines())
    assert values == {
        "POETRY_CACHE_DIR": str(runner_temp / "poetry-cache"),
        "POETRY_VIRTUALENVS_PATH": str(runner_temp / "poetry-venvs"),
        "PIP_CACHE_DIR": str(runner_temp / "pip-cache"),
        "npm_config_cache": str(runner_temp / "npm-cache"),
    }
