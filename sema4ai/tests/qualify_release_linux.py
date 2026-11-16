"""Qualify a release VSIX and its promoted Linux tools in isolated runner roots."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request

from qualify_linux_vsix import CODE_SHA256


CODE_URL = (
    "https://vscode.download.prss.microsoft.com/dbazure/download/stable/"
    "69047191fc427f2f92828279aae1d90d8eeda7ab/"
    "code-stable-x64-1794340754.tar.gz"
)
PROMOTED_MANIFEST = Path("docs/evidence/dogfood-setup-20261115/candidate-tools.json")
TOOLS = {
    "rcc": {
        "version": "v18.19.11",
        "repository": "joshyorko/rcc",
        "tag": "v18.19.11",
        "source": "953eda18d3d1f4a286c17709f282315a2ed16a16",
        "asset": "rcc-linux64",
        "sha256": "4d68609044d3a39a1728d571d54c77a6174215adb40eb9acd69ce5ad34a6db1f",
    },
    "action-server": {
        "version": "1.1.1",
        "repository": "joshyorko/actions",
        "tag": "actions-runtime-1.1.1",
        "source": "9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2",
        "asset": "actions-runtime-1.1.1-linux64",
        "sha256": "8c27fbed198aef16c98cdc7a45230fbc4708b06dff1c3523aeddfcdf7840efd0",
    },
}
PROXY_CA_KEYS = {
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
}
MAX_PRIVATE_LOG_TAIL_BYTES = 16 * 1024
MAX_PUBLIC_REPORT_BYTES = 2 * 1024 * 1024


def sha256(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def manifest_sha256(path):
    return sha256(path)


def validate_promoted_manifests(production, promoted):
    if not isinstance(production, dict) or not isinstance(promoted, dict):
        raise RuntimeError("Production/promoted tool manifest has an invalid shape")
    for tool, expected in TOOLS.items():
        live = production.get(tool)
        approved = promoted.get(tool)
        if not isinstance(live, dict) or not isinstance(approved, dict):
            raise RuntimeError(f"Missing promoted {tool} manifest entry")
        for field in ("version", "repository", "tag", "source"):
            if live.get(field) != approved.get(field) or live.get(field) != expected[field]:
                raise RuntimeError(f"Production {tool} {field} does not match the promoted release")
        live_asset = live.get("assets", {}).get("linux-x64")
        approved_asset = approved.get("assets", {}).get("linux-x64")
        if not isinstance(live_asset, dict) or not isinstance(approved_asset, dict):
            raise RuntimeError(f"Missing promoted Linux asset for {tool}")
        for field, value in (("name", expected["asset"]), ("sha256", expected["sha256"])):
            if live_asset.get(field) != approved_asset.get(field) or live_asset.get(field) != value:
                raise RuntimeError(f"Production {tool} Linux {field} does not match the promoted release")
    return production


def private_environment(root):
    environment = {
        key: value for key, value in os.environ.items()
        if key in {"PATH", "LANG", "LC_ALL"} | PROXY_CA_KEYS
    }
    for key, folder in (
        ("HOME", "home"),
        ("XDG_CACHE_HOME", "cache"),
        ("TMPDIR", "tmp"),
        ("ACTIONS_HOME", "actions-home"),
        ("ROBOTS_HOME", "robots-home"),
        ("ROBOCORP_HOME", "actions-home"),
        ("UV_CACHE_DIR", "uv-cache"),
    ):
        destination = root / folder
        destination.mkdir(parents=True, exist_ok=True)
        environment[key] = str(destination)
    environment["RCC_HOLOTREE_MODE"] = "private"
    environment["ACTIONS_SKIP_UPDATE_CHECK"] = "1"
    environment["PYTHONNOUSERSITE"] = "1"
    return environment


def download_verified(url, expected_sha256, destination, *, executable=False):
    if not url.startswith("https://"):
        raise RuntimeError("Release downloads must use HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "automation-vscode-linux-release-qualification"})
    checksum = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=180) as response, destination.open("xb") as output:
        while chunk := response.read(1024 * 1024):
            checksum.update(chunk)
            output.write(chunk)
    if checksum.hexdigest() != expected_sha256:
        destination.unlink(missing_ok=True)
        raise RuntimeError(f"Release asset digest mismatch: {destination.name}")
    if executable:
        destination.chmod(0o700)
    return destination


def run_private(command, name, cwd, environment, log):
    with log.open("wb") as output:
        result = subprocess.run(
            [str(value) for value in command], cwd=cwd, env=environment,
            stdout=output, stderr=subprocess.STDOUT, timeout=7200,
        )
    if result.returncode:
        raise RuntimeError(f"{name} failed; private diagnostics were retained")


def freeze_vsix(source, public, version):
    if source.name != f"automation-vscode-{version}-linux-x64.vsix" or not source.is_file():
        raise RuntimeError("Input VSIX name or file does not match the checked extension version")
    frozen = public / source.name
    checksum = hashlib.sha256()
    size = 0
    created = False
    try:
        with source.open("rb") as input_file, frozen.open("xb") as output_file:
            created = True
            while chunk := input_file.read(1024 * 1024):
                checksum.update(chunk)
                size += len(chunk)
                output_file.write(chunk)
    except Exception:
        if created:
            frozen.unlink(missing_ok=True)
        raise
    return frozen, {"filename": frozen.name, "sha256": checksum.hexdigest(), "size": size}


def bounded_error_class(private_log, error):
    if private_log is not None and private_log.is_file():
        with private_log.open("rb") as stream:
            stream.seek(max(0, private_log.stat().st_size - MAX_PRIVATE_LOG_TAIL_BYTES))
            tail = stream.read(MAX_PRIVATE_LOG_TAIL_BYTES).decode("utf-8", errors="replace")
        matches = re.findall(r"(?m)^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)|TimeoutExpired)(?::|$)", tail)
        if matches:
            return matches[-1].rsplit(".", 1)[-1]
    return type(error).__name__


def read_bounded_report(source):
    if not source.is_file() or source.stat().st_size > MAX_PUBLIC_REPORT_BYTES:
        return None
    try:
        report = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError):
        return None
    if not isinstance(report, dict):
        return None
    return report


def partial_qualification(source):
    report = read_bounded_report(source)
    if report is None:
        return None
    safe = {
        key: report[key]
        for key in ("platform", "passed", "scope", "source", "version", "payloads_verified")
        if key in report
    }
    checks = report.get("checks")
    if isinstance(checks, list):
        safe["checks"] = [value[:300] for value in checks[:100] if isinstance(value, str)]
    for key in ("artifact", "code"):
        item = report.get(key)
        if isinstance(item, dict):
            allowed = ("filename", "sha256", "size") if key == "artifact" else ("version", "commit", "sha256")
            safe[key] = {field: item[field] for field in allowed if field in item}
    return safe


def completed_smoke_checks(report):
    executions = report.get("real_executions") if isinstance(report, dict) else None
    checks = [
        entry["check"][:300]
        for entry in executions[:200]
        if isinstance(entry, dict) and isinstance(entry.get("check"), str)
    ] if isinstance(executions, list) else []
    return {"completed_check_count": len(checks), "completed_checks": checks}


def bounded_report(report):
    # Every nested value is assembled by the explicit sanitizers above/below.
    # Do not re-project those values and accidentally discard provenance hashes.
    fields = (
        "platform", "passed", "scope", "source_sha", "extension_version",
        "production_manifest_sha256", "promoted_manifest_sha256", "checks",
        "stage", "error_class", "partial_qualification_omitted",
        "completed_check_count", "partial_smoke_progress", "artifact",
        "code_archive", "tools", "published_smoke", "partial_installed_vsix",
    )
    safe = {key: report[key] for key in fields if key in report}
    encoded = json.dumps(safe, indent=2).encode("utf-8") + b"\n"
    if len(encoded) > MAX_PUBLIC_REPORT_BYTES:
        raise RuntimeError("Sanitized qualification report exceeded its public size limit")
    return encoded


def write_public_report(public, report):
    (public / "qualification.json").write_bytes(bounded_report(report))


def write_bounded_json(path, value):
    encoded = json.dumps(value, indent=2).encode("utf-8") + b"\n"
    if len(encoded) > MAX_PUBLIC_REPORT_BYTES:
        return False
    path.write_bytes(encoded)
    return True


def sanitized_smoke_report(report):
    executions = report.get("real_executions")
    if not isinstance(executions, list):
        raise RuntimeError("Published smoke report is missing execution receipts")
    runtime_execution = next(
        (
            entry
            for entry in executions
            if isinstance(entry, dict)
            and entry.get("check") == "Published Runtime wrapper HTTP Action execution"
        ),
        None,
    )
    if runtime_execution is None:
        raise RuntimeError("Published Runtime HTTP receipt is missing")
    runtime = {
        key: runtime_execution.get(key)
        for key in (
            "runtime_version", "shutdown_status", "runtime_exit_code",
            "forced_termination", "bundled_rcc", "result",
        )
    }
    if (
        runtime["shutdown_status"] != 200
        or runtime["runtime_exit_code"] != 1
        or runtime["forced_termination"] is not False
    ):
        raise RuntimeError("Published Runtime shutdown did not match the pinned release contract")
    return {
        "source_sha": report.get("source_sha"),
        "working_tree_dirty": report.get("working_tree_dirty"),
        "installed_manifest_sha256": report.get("candidate_manifest_sha256"),
        "qualification_source_sha256": report.get("qualification_source_sha256"),
        "checks": [entry.get("check") for entry in executions if isinstance(entry, dict)],
        "runtime_shutdown": runtime,
    }


def write_public_checksums(public):
    sums = "".join(
        f"{sha256(path)}  {path.name}\n"
        for path in sorted(public.iterdir())
        if path.is_file() and path.name != "SHA256SUMS.txt"
    )
    (public / "SHA256SUMS.txt").write_text(sums, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--vsix", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "linux":
        raise RuntimeError("Linux release qualification requires a hosted Linux runner")
    root = args.state.resolve()
    root.mkdir(parents=True, exist_ok=False)
    public = root / "public"
    private = root / "private"
    public.mkdir()
    private.mkdir()
    repository = Path(__file__).resolve().parents[2]
    extension = repository / "sema4ai"
    report = {
        "platform": "linux-x64",
        "passed": False,
        "scope": "Installed VSIX payload plus published RCC/Runtime Action, Robot, DAP, package-build, and HTTP smoke; no Linux GUI or cold language-server startup claim.",
        "source_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip(),
        "checks": [],
        "stage": "validate-input-vsix",
    }
    driver_state = private / "installed-vsix"
    smoke_work = private / "published-smoke"
    tools_root = private / "verified-tools"
    active_private_log = None
    try:
        environment = private_environment(private)
        tools_root.mkdir()
        version = json.loads((extension / "package.json").read_text(encoding="utf-8"))["version"]
        frozen_vsix, artifact = freeze_vsix(args.vsix.resolve(), public, version)
        report["extension_version"] = version
        report["artifact"] = artifact
        report["checks"].append("Exact input VSIX frozen under public output before qualification")
        report["stage"] = "verify-promoted-manifest"
        write_public_report(public, report)

        production_path = extension / "published-tools.json"
        promoted_path = repository / PROMOTED_MANIFEST
        production = json.loads(production_path.read_text(encoding="utf-8"))
        promoted = json.loads(promoted_path.read_text(encoding="utf-8"))
        validate_promoted_manifests(production, promoted)
        report["checks"].append("Production tool pins match the promoted release identities and Linux assets")
        report["production_manifest_sha256"] = manifest_sha256(production_path)
        report["promoted_manifest_sha256"] = manifest_sha256(promoted_path)
        report["tools"] = {}
        report["completed_check_count"] = len(report["checks"])
        report["stage"] = "download-code"
        write_public_report(public, report)

        code_archive = download_verified(
            CODE_URL, CODE_SHA256, private / "code-stable-x64-1794340754.tar.gz"
        )
        report["code_archive"] = {
            "version": "1.146.0",
            "commit": "69047191fc427f2f92828279aae1d90d8eeda7ab",
            "url": CODE_URL,
            "sha256": sha256(code_archive),
        }
        report["checks"].append("Official Code 1.146.0 archive bytes match the pinned digest")

        report["stage"] = "download-promoted-tools"
        binaries = {}
        for tool, expected in TOOLS.items():
            entry = production[tool]
            asset = entry["assets"]["linux-x64"]
            url = f"https://github.com/{entry['repository']}/releases/download/{entry['tag']}/{asset['name']}"
            path = download_verified(url, asset["sha256"], tools_root / asset["name"], executable=True)
            binaries[tool] = path
            report["tools"][tool] = {
                "version": entry["version"],
                "tag": entry["tag"],
                "source": entry["source"],
                "asset": asset["name"],
                "sha256": sha256(path),
            }
        report["checks"].append("Promoted RCC and Runtime Linux assets match their release SHA256 values")
        report["completed_check_count"] = len(report["checks"])
        write_public_report(public, report)

        driver = extension / "tests/qualify_linux_vsix.py"
        report["stage"] = "install-and-verify-vsix"
        active_private_log = private / "installed-vsix-driver.private.log"
        run_private(
            [sys.executable, driver, "--state", driver_state, "--vsix", frozen_vsix, "--code-archive", code_archive],
            "Installed Linux VSIX qualification", repository, environment,
            active_private_log,
        )
        driver_report_path = driver_state / "public/qualification.json"
        driver_report = json.loads(driver_report_path.read_text(encoding="utf-8"))
        if (
            driver_report.get("passed") is not True
            or driver_report.get("version") != version
            or driver_report.get("artifact", {}).get("sha256") != artifact["sha256"]
        ):
            raise RuntimeError("Installed Linux VSIX driver did not verify the exact release artifact")
        driver_receipt = partial_qualification(driver_report_path)
        if driver_receipt is None or not write_bounded_json(
            public / "installed-vsix-qualification.json", driver_receipt
        ):
            raise RuntimeError("Installed VSIX qualification receipt exceeded the public size limit")
        ownership_receipt = driver_state / "public/filesystem-ownership.json"
        if ownership_receipt.is_file() and ownership_receipt.stat().st_size <= MAX_PUBLIC_REPORT_BYTES:
            shutil.copyfile(ownership_receipt, public / "filesystem-ownership.json")
        installed = driver_state / "extensions" / f"automation-control-plane.automation-vscode-{version}"
        if not installed.is_dir():
            raise RuntimeError("Code CLI did not install the exact release VSIX")
        report["checks"].append("Exact Linux VSIX installed through official Code CLI; payload matches source")
        report["completed_check_count"] = len(report["checks"])
        write_public_report(public, report)

        smoke_work.mkdir()
        report["stage"] = "published-rcc-runtime-smoke"
        active_private_log = private / "published-smoke.private.log"
        run_private(
            [
                sys.executable, extension / "tests/published_smoke.py",
                "--rcc", binaries["rcc"], "--runtime", binaries["action-server"],
                "--extension-root", installed, "--work-root", smoke_work,
            ],
            "Published RCC/Runtime backend smoke", repository, environment,
            active_private_log,
        )
        smoke_reports = list(smoke_work.glob("automation-published-smoke-*/report.json"))
        if len(smoke_reports) != 1:
            raise RuntimeError("Published backend smoke report missing or ambiguous")
        smoke = json.loads(smoke_reports[0].read_text(encoding="utf-8"))
        summary = sanitized_smoke_report(smoke)
        if not summary["checks"] or summary["source_sha"] != report["source_sha"]:
            raise RuntimeError("Published smoke source or execution receipts do not match the release checkout")
        report["published_smoke"] = summary
        report["checks"].append("Published RCC/Runtime action, robot, debug, packaging, and HTTP smoke completed")

        report["checks"].append("Published smoke confirmed Runtime HTTP shutdown status 200, exit 1, and no forced termination")
        report["completed_check_count"] = len(report["checks"])
        report["stage"] = "completed"
        report["passed"] = True
        write_public_report(public, report)
        write_public_checksums(public)
        return 0
    except Exception as error:
        report["error_class"] = bounded_error_class(active_private_log, error)
        report["completed_check_count"] = len(report.get("checks", []))
        partial_driver_path = driver_state / "public/qualification.json"
        partial_driver = partial_qualification(partial_driver_path)
        if partial_driver is not None:
            report["partial_installed_vsix"] = partial_driver
        elif partial_driver_path.is_file() and partial_driver_path.stat().st_size > MAX_PUBLIC_REPORT_BYTES:
            report["partial_qualification_omitted"] = "over_size_limit"
        smoke_reports = list(smoke_work.glob("automation-published-smoke-*/report.json")) if smoke_work.is_dir() else []
        if len(smoke_reports) == 1:
            try:
                partial_smoke = read_bounded_report(smoke_reports[0])
                report["partial_smoke_progress"] = completed_smoke_checks(partial_smoke)
            except (OSError, ValueError, UnicodeError):
                report["partial_smoke_progress"] = {"completed_check_count": 0, "completed_checks": []}
        write_public_report(public, report)
        write_public_checksums(public)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
