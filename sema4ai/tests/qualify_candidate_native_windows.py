"""Qualify candidate RCC and Actions Runtime releases on native Windows."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import urllib.request


CANDIDATES = {
    "rcc": {
        "repository": "joshyorko/rcc",
        "version": "v18.19.11",
        "tag": "v18.19.11",
        "source": "953eda18d3d1f4a286c17709f282315a2ed16a16",
        "asset": "rcc-windows64.exe",
        "sha256": "58f43a3b3c54032740f224cb4a8bbf68c47c865cf2652084fb139b8ecc01cfd0",
    },
    "action-server": {
        "repository": "joshyorko/actions",
        "version": "1.1.1",
        "tag": "actions-runtime-1.1.1",
        "source": "9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2",
        "asset": "actions-runtime-1.1.1-windows64.exe",
        "sha256": "0388d7f2e4080ba5c3a800bb556f8f01a65aa4834f3698eceb240888288fd8d2",
    },
}
ARCHIVE_PATHS = (
    "LICENSE",
    "COPYRIGHT",
    "ThirdPartyNotices.txt",
    "sema4ai",
    "sema4ai-python-ls-core/src/sema4ai_ls_core",
)


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest_file(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def github_json(url):
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "automation-vscode-owned-windows-qualification",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read())


def resolve_tag_commit(repository, tag):
    url = f"https://api.github.com/repos/{repository}/git/ref/tags/{tag}"
    for _ in range(6):
        reference = github_json(url)
        target = reference.get("object")
        if not isinstance(target, dict) or not isinstance(target.get("sha"), str):
            raise RuntimeError(f"GitHub did not return a valid source reference for {repository}@{tag}")
        if target.get("type") == "commit":
            return target["sha"]
        if target.get("type") != "tag":
            break
        url = f"https://api.github.com/repos/{repository}/git/tags/{target['sha']}"
    raise RuntimeError(f"GitHub source tag did not resolve to a commit: {repository}@{tag}")


def verified_release(tool):
    expected = CANDIDATES[tool]
    repository = expected["repository"]
    release = github_json(
        f"https://api.github.com/repos/{repository}/releases/tags/{expected['tag']}"
    )
    if (
        release.get("tag_name") != expected["tag"]
        or release.get("draft") is not False
        or release.get("prerelease") is not False
    ):
        raise RuntimeError(f"Candidate release is not the expected published release: {repository}@{expected['tag']}")

    commit = resolve_tag_commit(repository, expected["tag"])
    if commit != expected["source"]:
        raise RuntimeError(f"Candidate source commit changed for {repository}@{expected['tag']}")

    assets = [asset for asset in release.get("assets", []) if asset.get("name") == expected["asset"]]
    if len(assets) != 1:
        raise RuntimeError(f"Expected one Windows release asset for {repository}@{expected['tag']}")
    asset = assets[0]
    if asset.get("digest") != f"sha256:{expected['sha256']}":
        raise RuntimeError(f"GitHub release asset digest changed for {repository}@{expected['tag']}")
    url = asset.get("browser_download_url")
    if not isinstance(url, str) or not url.startswith(
        f"https://github.com/{repository}/releases/download/{expected['tag']}/"
    ):
        raise RuntimeError(f"GitHub returned an unexpected asset URL for {repository}@{expected['tag']}")
    return {**expected, "asset_url": url, "asset_size": asset.get("size")}


def download_verified_asset(asset, destination):
    request = urllib.request.Request(
        asset["asset_url"],
        headers={"User-Agent": "automation-vscode-owned-windows-qualification"},
    )
    checksum = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=180) as response, destination.open("xb") as output:
        while chunk := response.read(1024 * 1024):
            checksum.update(chunk)
            output.write(chunk)
    if checksum.hexdigest() != asset["sha256"]:
        destination.unlink(missing_ok=True)
        raise RuntimeError(f"Downloaded candidate asset digest mismatch: {asset['asset']}")
    if asset["asset_size"] is not None and destination.stat().st_size != asset["asset_size"]:
        destination.unlink(missing_ok=True)
        raise RuntimeError(f"Downloaded candidate asset size mismatch: {asset['asset']}")


def candidate_manifest(assets):
    manifest = {}
    for tool, asset in assets.items():
        manifest[tool] = {
            "version": asset["version"],
            "repository": asset["repository"],
            "tag": asset["tag"],
            "source": asset["source"],
            "assets": {
                "win32-x64": {
                    "name": asset["asset"],
                    "sha256": asset["sha256"],
                }
            },
        }
    return manifest


def tracked_source_head(repository):
    dirty = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        cwd=repository,
        text=True,
    ).strip()
    if dirty:
        raise RuntimeError("Candidate qualification requires a clean tracked source tree")
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repository, text=True
    ).strip()


def extract_tracked_extension(repository, destination):
    archive = subprocess.run(
        ["git", "archive", "--format=tar", "HEAD", *ARCHIVE_PATHS],
        cwd=repository,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ).stdout
    destination.mkdir(parents=True, exist_ok=False)
    root = destination.resolve()
    extracted = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            target = (destination / Path(*path.parts)).resolve()
            if not path.parts or path.is_absolute() or ".." in path.parts or not target.is_relative_to(root):
                raise ValueError("Tracked candidate archive member escapes its stage")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as input_file, target.open("xb") as output_file:
                    shutil.copyfileobj(input_file, output_file)
                extracted += 1
            else:
                raise ValueError("Tracked candidate archive contains an unsupported file type")
    extension = destination / "sema4ai"
    support_files = [
        destination / "LICENSE",
        destination / "COPYRIGHT",
        destination / "ThirdPartyNotices.txt",
        destination / "sema4ai-python-ls-core/src/sema4ai_ls_core/__init__.py",
    ]
    if extracted < 1 or not (extension / "package.json").is_file() or any(not path.is_file() for path in support_files):
        raise RuntimeError("Tracked candidate package inputs are incomplete")
    return extension


def tree_digest(root, exclude):
    checksum = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.relative_to(root).as_posix() == exclude:
            continue
        checksum.update(path.relative_to(root).as_posix().encode("utf-8"))
        checksum.update(b"\0")
        checksum.update(path.read_bytes())
    return checksum.hexdigest()


def verify_staged_source(source_root, provenance):
    expected = provenance.get("source_tree_sha256_excluding_manifest")
    actual = tree_digest(source_root, "sema4ai/published-tools.json")
    if not isinstance(expected, str) or actual != expected:
        raise RuntimeError("Staged candidate source changed outside published-tools.json")
    return actual


def prepare_candidate(repository, stage_root):
    original_extension = repository / "sema4ai"
    original_manifest = original_extension / "published-tools.json"
    source_head = tracked_source_head(repository)
    original_manifest_hash = digest_file(original_manifest)
    stage_root.mkdir(parents=True, exist_ok=False)
    source_root = stage_root / "source"
    extension = extract_tracked_extension(repository, source_root)
    original_source_digest = tree_digest(source_root, "sema4ai/published-tools.json")

    asset_dir = stage_root / "verified-assets"
    asset_dir.mkdir()
    assets = {tool: verified_release(tool) for tool in CANDIDATES}
    for asset in assets.values():
        download_verified_asset(asset, asset_dir / asset["asset"])

    manifest = candidate_manifest(assets)
    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    candidate_manifest_hash = digest_bytes(manifest_bytes)
    staged_manifest = extension / "published-tools.json"
    staged_manifest.write_bytes(manifest_bytes)
    if tree_digest(source_root, "sema4ai/published-tools.json") != original_source_digest:
        raise RuntimeError("Candidate staging changed source files outside the candidate manifest")

    provenance = {
        "mode": "candidate-windows-only",
        "source_head": source_head,
        "source_tree_sha256_excluding_manifest": original_source_digest,
        "production_manifest_sha256": original_manifest_hash,
        "candidate_manifest_sha256": candidate_manifest_hash,
        "candidate_manifest_changes_only": ["published-tools.json"],
        "tools": {
            tool: {
                "repository": asset["repository"],
                "tag": asset["tag"],
                "version": asset["version"],
                "source_commit": asset["source"],
                "windows_asset": asset["asset"],
                "sha256": asset["sha256"],
                "size": asset["asset_size"],
            }
            for tool, asset in assets.items()
        },
    }
    provenance_path = stage_root / "candidate-provenance.json"
    provenance_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    return extension, provenance_path


def write_preflight_failure(state, error, *, state_owned=False):
    if state.exists() and not state_owned:
        raise RuntimeError("Refusing to adopt an existing qualification state path")
    state.mkdir(parents=True, exist_ok=True)
    public = state / "public"
    public.mkdir(exist_ok=True)
    report = {
        "platform": "win32-x64",
        "mode": "candidate-windows-only",
        "passed": False,
        "stage": "candidate-release-preflight",
        "blocker": str(error)[:1000],
    }
    receipt = public / "qualification.json"
    with receipt.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(report, indent=2) + "\n")
    write_public_checksums(public)


def write_public_checksums(public):
    checksums = "".join(
        f"{digest_file(path)}  {path.name}\n"
        for path in sorted(public.iterdir())
        if path.is_file() and path.name != "SHA256SUMS.txt"
    )
    (public / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8")


def candidate_driver_failure(private_log):
    safe_errors = {
        "Candidate provenance has an invalid shape",
        "Candidate manifest has an invalid shape",
        "Candidate provenance or staged manifest does not match the checked source",
        "Candidate manifest pin has an invalid shape",
        "Candidate manifest pin does not match its verified release provenance",
        "Staged candidate source changed outside published-tools.json",
    }
    for line in reversed(private_log.read_text(encoding="utf-8", errors="replace").splitlines()):
        prefix = "RuntimeError: "
        if line.startswith(prefix) and line[len(prefix) :] in safe_errors:
            return line[len(prefix) :]
    return "Native driver rejected candidate source or provenance before qualification"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "win32":
        raise RuntimeError("Candidate qualification requires native Windows")

    state = args.state.resolve()
    if state.exists():
        raise RuntimeError("Candidate qualification state path already exists")
    repository = Path(__file__).resolve().parents[2]
    stage_root = state.parent / (state.name + "-candidate")
    try:
        extension, provenance = prepare_candidate(repository, stage_root)
    except Exception as error:
        if not state.exists():
            write_preflight_failure(state, error)
        raise
    driver = repository / "sema4ai/tests/qualify_native_windows.py"
    private_log = stage_root / "candidate-driver.private.log"
    with private_log.open("wb") as log:
        result = subprocess.run(
            [
                sys.executable,
                str(driver),
                "--state",
                str(state),
                "--extension-source",
                str(extension),
                "--candidate-provenance",
                str(provenance),
            ],
            cwd=repository,
            stdout=log,
            stderr=subprocess.STDOUT,
            timeout=7200,
        )
    if result.returncode:
        receipt = state / "public/qualification.json"
        if not receipt.exists():
            write_preflight_failure(
                state,
                RuntimeError(candidate_driver_failure(private_log)),
                state_owned=True,
            )
        public = state / "public"
        for source, name in (
            (extension / "published-tools.json", "candidate-manifest.json"),
            (provenance, "candidate-provenance.json"),
        ):
            target = public / name
            if source.is_file() and not target.exists():
                shutil.copyfile(source, target)
        write_public_checksums(public)
        raise RuntimeError("Native Windows candidate qualification failed; private receipts were retained")


if __name__ == "__main__":
    main()
