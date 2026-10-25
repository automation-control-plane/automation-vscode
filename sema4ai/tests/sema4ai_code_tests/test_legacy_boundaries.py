import json
from pathlib import Path

import pytest

from sema4ai_code.rcc import Rcc
from sema4ai_code.robocorp_language_server import RobocorpLanguageServer
from sema4ai_ls_core.config import Config


@pytest.fixture
def server(monkeypatch):
    instance = RobocorpLanguageServer.__new__(RobocorpLanguageServer)
    instance._config = Config()
    instance.config.update({})
    monkeypatch.setattr(instance, "_get_gallery_action_packages", lambda: pytest.fail("Gallery reached"))
    return instance


def test_gallery_rpc_denies_before_progress_or_network(server):
    for result in (
        server.m_list_gallery_action_packages(),
        server.m_import_gallery_action_package("synthetic", "/unused"),
        server._list_gallery_action_packages(None),
        server._import_gallery_action_package_threaded("synthetic", "/unused", None),
    ):
        assert result["success"] is False
        assert "disabled" in result["message"]


def test_generic_dispatcher_denies_every_legacy_command(server, monkeypatch):
    from sema4ai_code import get_extension_relative_path
    from sema4ai_code.robocorp_language_server import command_dispatcher
    monkeypatch.setattr(command_dispatcher, "dispatch", lambda *a: pytest.fail("Legacy dispatcher reached"))
    commands = json.loads(Path(get_extension_relative_path("legacy-integrations.json")).read_text())
    for command in commands:
        result = server.m_workspace__execute_command(command, [{"workspaceId": "synthetic"}])
        assert result["success"] is False, command


@pytest.mark.parametrize("args", [
    ["cloud", "workspace"], ["--debug", "cloud", "workspace"],
    ["config", "credentials"], ["conf", "credentials"], ["feedback", "metric"],
])
def test_raw_rcc_denies_vendor_calls_before_executable_lookup(monkeypatch, args):
    class Provider:
        config = Config()
    provider = Provider()
    rcc = Rcc(provider)
    monkeypatch.setattr(rcc, "get_rcc_location", lambda: pytest.fail("Executable lookup reached"))
    result = rcc._run_rcc(args)
    assert result.success is False
    assert "disabled" in result.message


def test_explicit_legacy_opt_in_reaches_existing_dispatcher(server, monkeypatch):
    from sema4ai_code.robocorp_language_server import command_dispatcher
    server.config.update({"sema4ai.legacyVendorIntegrations.enabled": True})
    monkeypatch.setattr(command_dispatcher, "dispatch", lambda *a: "explicit-legacy")
    assert server.m_workspace__execute_command("sema4ai.cloudLogin.internal") == "explicit-legacy"
