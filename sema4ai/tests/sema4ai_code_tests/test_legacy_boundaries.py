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
    ["c", "workspace"], ["robocorp", "workspace"], ["f", "metric"],
    ["configure", "credentials"],
    ["--config", "local.yaml", "cloud", "workspace"],
    ["--config=local.yaml", "configuration", "--account", "local", "credentials"],
    ["conf", "--debug", "credentials"],
    ["--tag", "feedback", "conf", "-a", "cloud", "credentials"],
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


@pytest.mark.parametrize("name", ["cloud", "credentials", "feedback"])
def test_local_profile_and_space_names_are_values(monkeypatch, tmp_path, name):
    import subprocess
    class Provider:
        config = Config()
    provider = Provider()
    provider.config.update({"sema4ai.rcc.location": str(tmp_path / "rcc")})
    (tmp_path / "rcc").touch()
    monkeypatch.setenv("ACTIONS_HOME", str(tmp_path / "actions"))
    monkeypatch.setenv("ROBOTS_HOME", str(tmp_path / "robots"))
    calls = []
    def execute(args, **kwargs):
        calls.append((args, kwargs["env"]))
        return b"[]"
    monkeypatch.setattr(subprocess, "check_output", execute)
    rcc = Rcc(provider)
    assert rcc.profile_switch(name).success
    assert calls[-1][0][1:5] == ["config", "switch", "-p", name]
    assert rcc.holotree_variables(tmp_path / "conda.yaml", name, no_build=True).success
    assert calls[-1][0][1:5] == ["holotree", "variables", "--space", name]
    # Both are local operations, regardless of profile/space spelling.
    assert all(env["ROBOCORP_HOME"] == str(tmp_path / "actions") for _, env in calls)


@pytest.mark.parametrize("args", [
    ["--config", "cloud", "config", "switch", "-p", "feedback"],
    ["--config=credentials", "conf", "--account", "cloud", "switch", "-p", "feedback"],
    ["--tag", "cloud", "--debug=false", "holotree", "variables", "--space=feedback", "credentials"],
    ["config", "import", "-f", "cloud"],
])
def test_command_prefix_classification_ignores_local_values(args):
    from sema4ai_code.rcc import _rcc_command_path
    assert _rcc_command_path(args) in (("configuration", "switch"), ("configuration", "import"), ("holotree",))


@pytest.mark.parametrize("args", [
    ["--unknown", "value", "cloud", "workspace"], ["--config"],
    ["conf", "--unknown", "credentials"],
])
def test_ambiguous_command_prefix_is_not_executed(monkeypatch, args):
    class Provider:
        config = Config()
    provider = Provider()
    rcc = Rcc(provider)
    monkeypatch.setattr(rcc, "get_rcc_location", lambda: pytest.fail("Ambiguous command executed"))
    result = rcc._run_rcc(args)
    assert not result.success
    assert "command" in result.message.lower()


def test_explicit_legacy_opt_in_reaches_existing_dispatcher(server, monkeypatch):
    from sema4ai_code.robocorp_language_server import command_dispatcher
    server.config.update({"sema4ai.legacyVendorIntegrations.enabled": True})
    monkeypatch.setattr(command_dispatcher, "dispatch", lambda *a: "explicit-legacy")
    assert server.m_workspace__execute_command("sema4ai.cloudLogin.internal") == "explicit-legacy"
