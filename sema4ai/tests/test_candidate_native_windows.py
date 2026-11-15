import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

from qualify_candidate_native_windows import (
    CANDIDATES,
    candidate_manifest,
    download_verified_asset,
    candidate_driver_failure,
    extract_tracked_extension,
    tracked_source_head,
    tree_digest,
    verified_release,
    verify_staged_source,
    write_preflight_failure,
)


def release_payload(tool):
    expected = CANDIDATES[tool]
    repository = expected["repository"]
    return {
        "tag_name": expected["tag"],
        "draft": False,
        "prerelease": False,
        "assets": [{
            "name": expected["asset"],
            "digest": "sha256:" + expected["sha256"],
            "size": 123,
            "browser_download_url": (
                f"https://github.com/{repository}/releases/download/"
                f"{expected['tag']}/{expected['asset']}"
            ),
        }],
    }


def test_candidate_release_requires_expected_tag_commit_and_github_asset_digest(monkeypatch):
    payload = release_payload("rcc")
    expected = CANDIDATES["rcc"]

    def get_json(url):
        if url.endswith("/releases/tags/" + expected["tag"]):
            return payload
        if url.endswith("/git/ref/tags/" + expected["tag"]):
            return {"object": {"sha": expected["source"], "type": "commit"}}
        raise AssertionError("Unexpected GitHub request: " + url)

    monkeypatch.setattr("qualify_candidate_native_windows.github_json", get_json)
    verified = verified_release("rcc")
    assert verified["asset"] == "rcc-windows64.exe"
    assert verified["sha256"] == expected["sha256"]

    payload["assets"][0]["digest"] = "sha256:" + "0" * 64
    with pytest.raises(RuntimeError, match="digest changed"):
        verified_release("rcc")


def test_candidate_release_fails_closed_when_tag_source_commit_changes(monkeypatch):
    def get_json(url):
        if "/releases/tags/" in url:
            return release_payload("action-server")
        return {"object": {"sha": "0" * 40, "type": "commit"}}

    monkeypatch.setattr("qualify_candidate_native_windows.github_json", get_json)
    with pytest.raises(RuntimeError, match="source commit changed"):
        verified_release("action-server")


def test_candidate_manifest_contains_only_explicit_windows_assets():
    assets = {tool: {**details, "asset_url": "https://github.com/example", "asset_size": 123}
              for tool, details in CANDIDATES.items()}

    manifest = candidate_manifest(assets)

    assert set(manifest) == {"rcc", "action-server"}
    for tool, details in CANDIDATES.items():
        assert manifest[tool]["version"] == details["version"]
        assert manifest[tool]["source"] == details["source"]
        assert set(manifest[tool]["assets"]) == {"win32-x64"}
        assert manifest[tool]["assets"]["win32-x64"]["sha256"] == details["sha256"]


def test_downloaded_candidate_asset_must_match_github_digest(monkeypatch, tmp_path):
    import qualify_candidate_native_windows as qualification

    payload = b"release fixture"
    details = {
        "asset_url": "https://github.com/joshyorko/rcc/releases/download/v18.19.11/rcc-windows64.exe",
        "asset": "rcc-windows64.exe",
        "sha256": hashlib.sha256(payload).hexdigest(),
        "asset_size": len(payload),
    }
    monkeypatch.setattr(qualification.urllib.request, "urlopen", lambda *_args, **_kwargs: __import__("io").BytesIO(payload))
    target = tmp_path / details["asset"]
    download_verified_asset(details, target)
    assert target.read_bytes() == payload

    details["sha256"] = "0" * 64
    bad_target = tmp_path / "bad.exe"
    with pytest.raises(RuntimeError, match="digest mismatch"):
        download_verified_asset(details, bad_target)
    assert not bad_target.exists()


def test_candidate_source_uses_only_committed_extension_files_and_preserves_original(tmp_path):
    repository = tmp_path / "repo"
    extension = repository / "sema4ai"
    extension.mkdir(parents=True)
    (extension / "package.json").write_text('{"version":"2.20.28"}\n')
    production_manifest = extension / "published-tools.json"
    production_manifest.write_text('{"rcc":{"version":"v18.19.8"}}\n')
    for name in ("LICENSE", "COPYRIGHT", "ThirdPartyNotices.txt"):
        (repository / name).write_text(name + " fixture\n")
    core = repository / "sema4ai-python-ls-core/src/sema4ai_ls_core"
    core.mkdir(parents=True)
    (core / "__init__.py").write_text("CORE_FIXTURE = True\n")
    subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
    subprocess.run([
        "git", "add", "sema4ai", "LICENSE", "COPYRIGHT", "ThirdPartyNotices.txt",
        "sema4ai-python-ls-core/src/sema4ai_ls_core",
    ], cwd=repository, check=True)
    subprocess.run([
        "git", "-c", "user.name=Qualification Test", "-c",
        "user.email=qualification@example.invalid", "commit", "-qm", "fixture",
    ], cwd=repository, check=True)

    staged_root = tmp_path / "candidate"
    staged = extract_tracked_extension(repository, staged_root)
    before = tree_digest(staged_root, "sema4ai/published-tools.json")
    (staged / "published-tools.json").write_text('{"rcc":{"version":"v18.19.11"}}\n')
    provenance = {"source_tree_sha256_excluding_manifest": before}

    assert (staged / "package.json").is_file()
    assert all((staged_root / name).is_file() for name in ("LICENSE", "COPYRIGHT", "ThirdPartyNotices.txt"))
    assert (staged_root / "sema4ai-python-ls-core/src/sema4ai_ls_core/__init__.py").is_file()
    assert tree_digest(staged_root, "sema4ai/published-tools.json") == before
    assert verify_staged_source(staged_root, provenance) == before
    assert json.loads(production_manifest.read_text())["rcc"]["version"] == "v18.19.8"
    assert tracked_source_head(repository) == subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repository, text=True
    ).strip()
    (extension / "package.json").write_text('{"version":"modified"}\n')
    with pytest.raises(RuntimeError, match="clean tracked source tree"):
        tracked_source_head(repository)

    (staged_root / "COPYRIGHT").write_text("unexpected candidate source change\n")
    with pytest.raises(RuntimeError, match="changed outside published-tools.json"):
        verify_staged_source(staged_root, provenance)


def test_candidate_preflight_failure_receipt_preserves_blocker_without_adopting_existing_state(tmp_path):
    state = tmp_path / "owned-state"
    state.mkdir()
    with pytest.raises(RuntimeError, match="Refusing to adopt"):
        write_preflight_failure(state, "unowned path")

    write_preflight_failure(
        state, "GitHub release asset digest mismatch", state_owned=True
    )
    receipt = json.loads((state / "public/qualification.json").read_text())
    assert receipt["passed"] is False
    assert receipt["blocker"] == "GitHub release asset digest mismatch"
    assert (state / "public/SHA256SUMS.txt").is_file()


def test_candidate_driver_failure_receipt_keeps_safe_reason_and_hides_paths(tmp_path):
    private_log = tmp_path / "candidate-driver.private.log"
    private_log.write_text(
        "RuntimeError: Candidate provenance or staged manifest does not match the checked source\n"
        "RuntimeError: failed at C:\\Users\\runner\\secret\\candidate\\manifest.json\n"
    )
    assert candidate_driver_failure(private_log) == (
        "Candidate provenance or staged manifest does not match the checked source"
    )


def test_candidate_windows_home_does_not_inherit_or_mutate_runner_profile(tmp_path):
    spec = importlib.util.spec_from_file_location(
        "native_driver_home", Path(__file__).with_name("qualify_native_windows.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    inherited = {"USERPROFILE": "unowned-profile", "APPDATA": "unowned-appdata",
                 "PATH": "prepared-tools", "SSL_CERT_FILE": "existing-ca-policy"}
    original = inherited.copy()
    result = module.candidate_home_environment(inherited, tmp_path)
    assert inherited == original
    assert result["USERPROFILE"] == str(tmp_path / "home")
    assert all(Path(result[key]).is_relative_to(tmp_path) for key in ("APPDATA", "LOCALAPPDATA", "TEMP", "TMP"))
    assert result["PATH"] == inherited["PATH"]
    assert result["SSL_CERT_FILE"] == inherited["SSL_CERT_FILE"]
