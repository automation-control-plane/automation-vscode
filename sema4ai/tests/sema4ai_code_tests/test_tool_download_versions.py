"""Tool downloads must use the manifest's version while retaining digest gates."""

import hashlib

import pytest


def candidate_tools(content=b"verified candidate executable"):
    checksum = hashlib.sha256(content).hexdigest()
    return {
        "rcc": {
            "version": "v18.19.11",
            "repository": "joshyorko/rcc",
            "tag": "v18.19.11",
            "assets": {
                "linux-x64": {"sha256": checksum, "name": "rcc-linux64"},
                "win32-x64": {
                    "sha256": checksum,
                    "name": "rcc-windows64.exe",
                },
            },
        },
        "action-server": {
            "version": "1.1.1",
            "repository": "joshyorko/actions",
            "tag": "actions-runtime-1.1.1",
            "assets": {
                "linux-x64": {
                    "sha256": checksum,
                    "name": "actions-runtime-1.1.1-linux64",
                },
                "win32-x64": {
                    "sha256": checksum,
                    "name": "actions-runtime-1.1.1-windows64.exe",
                },
            },
        },
    }


def install_fake_manifest(monkeypatch, manifest):
    import sema4ai_code.published_tools as published

    def tool(name, sys_platform=None):
        selected = manifest[name]
        platform = "win32" if sys_platform == "win32" else "linux"
        asset = selected["assets"][f"{platform}-x64"]
        return {
            **selected,
            **asset,
            "url": (
                f"https://github.com/{selected['repository']}/releases/download/"
                f"{selected['tag']}/{asset['name']}"
            ),
        }

    monkeypatch.setattr(
        published,
        "published_tool",
        tool,
    )


def test_rcc_default_uses_candidate_manifest_through_rcc_lookup(
    monkeypatch, tmp_path
):
    from sema4ai_code import rcc as rcc_module
    import sema4ai_ls_core.http as http
    from sema4ai_code.rcc import Rcc

    content = b"verified candidate RCC"
    manifest = candidate_tools(content)
    install_fake_manifest(monkeypatch, manifest)
    monkeypatch.delenv("AUTOMATION_RCC_LOCATION", raising=False)
    location = tmp_path / "fresh" / "rcc"
    monkeypatch.setattr(rcc_module, "get_default_rcc_location", lambda: str(location))
    calls = []

    def download(url, target, **kwargs):
        calls.append(url)
        target.write_bytes(content)

    monkeypatch.setattr(http, "download_with_resume", download)
    rcc = Rcc(type("Provider", (), {"config": None})())

    version_error = None
    try:
        resolved = rcc.get_rcc_location()
    except ValueError as error:
        version_error = error
    if version_error is not None:
        assert calls == []
        assert not location.exists()
        assert not location.parent.exists()
    assert version_error is None, str(version_error)
    assert resolved == str(location)
    assert location.read_bytes() == content
    assert len(calls) == 1
    assert rcc.get_rcc_location() == str(location)
    assert len(calls) == 1


def test_action_server_default_uses_candidate_manifest_and_verifies_asset(
    monkeypatch, tmp_path
):
    import sema4ai_ls_core.http as http
    from sema4ai_code.action_server import download_action_server

    content = b"verified candidate Actions Runtime"
    manifest = candidate_tools(content)
    install_fake_manifest(monkeypatch, manifest)
    location = tmp_path / "runtime"
    calls = []

    def download(url, target, **kwargs):
        calls.append(url)
        target.write_bytes(content)

    monkeypatch.setattr(http, "download_with_resume", download)
    download_action_server(str(location), sys_platform="linux")
    assert location.read_bytes() == content
    assert len(calls) == 1


def test_explicit_action_server_version_mismatch_fails_before_writes(
    monkeypatch, tmp_path
):
    import sema4ai_ls_core.http as http
    from sema4ai_code.action_server import download_action_server

    install_fake_manifest(monkeypatch, candidate_tools())
    monkeypatch.setattr(
        http,
        "download_with_resume",
        lambda *args, **kwargs: pytest.fail(
            "mismatched explicit version must not download"
        ),
    )
    location = tmp_path / "runtime"

    with pytest.raises(ValueError, match="Unsupported action-server version: 1.1.0"):
        download_action_server(
            str(location), action_server_version="1.1.0", sys_platform="linux"
        )

    assert list(tmp_path.iterdir()) == []


def test_default_versions_still_match_the_current_production_manifest(monkeypatch):
    import sema4ai_code.published_tools as published
    import sema4ai_code.tools as tools
    from sema4ai_code import rcc
    from sema4ai_code.action_server import download_action_server

    expected = []
    calls = []
    monkeypatch.setattr(
        tools,
        "download_tool",
        lambda tool, location, version, **kwargs: calls.append((tool, version)),
    )

    for platform in ("linux", "win32"):
        expected.extend(
            [
                published.published_tool("rcc", platform)["version"],
                published.published_tool("action-server", platform)["version"],
            ]
        )
        rcc.download_rcc(f"synthetic-rcc-{platform}", sys_platform=platform)
        download_action_server(f"synthetic-runtime-{platform}", sys_platform=platform)

    assert [version for _tool, version in calls] == expected


def test_windows_candidate_manifest_selects_windows_asset_versions(
    monkeypatch, tmp_path
):
    import sema4ai_ls_core.http as http
    from sema4ai_code import rcc
    from sema4ai_code.action_server import download_action_server

    content = b"verified Windows candidate artifacts"
    install_fake_manifest(monkeypatch, candidate_tools(content))
    urls = []

    def download(url, target, **kwargs):
        urls.append(url)
        target.write_bytes(content)

    monkeypatch.setattr(http, "download_with_resume", download)
    rcc_path = tmp_path / "rcc.exe"
    runtime_path = tmp_path / "runtime.exe"
    rcc.download_rcc(str(rcc_path), sys_platform="win32")
    download_action_server(str(runtime_path), sys_platform="win32")

    assert rcc_path.read_bytes() == content
    assert runtime_path.read_bytes() == content
    assert urls == [
        (
            "https://github.com/joshyorko/rcc/releases/download/"
            "v18.19.11/rcc-windows64.exe"
        ),
        (
            "https://github.com/joshyorko/actions/releases/download/"
            "actions-runtime-1.1.1/actions-runtime-1.1.1-windows64.exe"
        ),
    ]


def test_candidate_rcc_rejects_and_preserves_mismatched_existing_file(
    monkeypatch, tmp_path
):
    import sema4ai_ls_core.http as http
    from sema4ai_code.tools import Tool, download_tool

    content = b"verified candidate RCC"
    install_fake_manifest(monkeypatch, candidate_tools(content))
    calls = []
    monkeypatch.setattr(
        http,
        "download_with_resume",
        lambda *args, **kwargs: calls.append(args),
    )
    location = tmp_path / "operator-rcc"
    location.write_bytes(b"operator-owned binary")

    with pytest.raises(RuntimeError, match="does not match the pinned release"):
        download_tool(Tool.RCC, str(location), "v18.19.11", force=True)

    assert location.read_bytes() == b"operator-owned binary"
    assert calls == []
