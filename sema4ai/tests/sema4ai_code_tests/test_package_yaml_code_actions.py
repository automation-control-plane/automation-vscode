from types import SimpleNamespace

import pytest


class FakePyPiCloud:
    def __init__(self, versions=None):
        self.versions = versions or {}
        self.fail = False
        self.calls = []

    def get_versions_newer_than(self, package_name, version):
        self.calls.append((package_name, str(version)))
        if self.fail:
            raise OSError("PyPI unavailable")
        return self.versions.get(package_name, [])


def setup_server(source, tmp_path, pypi_cloud):
    from sema4ai_code.robocorp_language_server import RobocorpLanguageServer
    from sema4ai_ls_core import uris
    from sema4ai_ls_core.workspace import Document

    package_path = tmp_path / "package.yaml"
    package_uri = uris.from_fs_path(str(package_path))
    document = Document(package_uri, source, version="7")
    server = object.__new__(RobocorpLanguageServer)
    server._workspace = SimpleNamespace(
        get_document=lambda uri, accept_from_file: document
        if uri == package_uri and not accept_from_file
        else None
    )
    server._pypi_cloud = pypi_cloud
    server._RobocorpLanguageServer__conda_cloud = object()
    return server, package_uri, document


def outdated_diagnostic(source, path, pypi_cloud):
    from sema4ai_code.vendored_deps.package_deps.analyzer import PackageYamlAnalyzer

    analyzer = PackageYamlAnalyzer(source, str(path), None, pypi_cloud)
    analyzer._load_yaml_info()
    return list(analyzer.iter_pip_issues())


def apply_text_edit(source, edit):
    start = edit["range"]["start"]
    end = edit["range"]["end"]
    lines = source.splitlines(keepends=True)
    line = lines[start["line"]]
    lines[start["line"]] = line[: start["character"]] + edit["newText"] + line[end["character"] :]
    return "".join(lines)


def test_package_yaml_latest_pypi_quickfix_updates_only_selected_pin(tmp_path):
    source = (
        "# keep this comment\n"
        "dependencies:\n"
        "  pypi:\n"
        "    - robocorp-browser=2.3.5  # preserve this comment\n"
        "    - python-dotenv=1.2.1\n"
        "  conda-forge:\n"
        "    - python=3.11\n"
    )
    pypi = FakePyPiCloud({
        "robocorp-browser": ["2.3.6", "2.4.0"],
        "python-dotenv": ["1.3.0"],
    })
    server, uri, document = setup_server(source, tmp_path, pypi)
    diagnostics = outdated_diagnostic(source, document.path, pypi)
    assert len(diagnostics) == 2
    pypi.calls.clear()

    actions = server.m_text_document__code_action(
        textDocument={"uri": uri}, range=diagnostics[0]["range"], context={"diagnostics": diagnostics}
    )

    assert len(actions) == 1
    action = actions[0]
    assert action["title"] == "Update robocorp-browser to latest PyPI version 2.4.0"
    assert action["kind"] == "quickfix"
    change = action["edit"]["documentChanges"][0]
    assert change["textDocument"] == {"uri": uri, "version": 7}
    updated = apply_text_edit(source, change["edits"][0])
    assert updated == source.replace("robocorp-browser=2.3.5", "robocorp-browser=2.4.0")
    assert [name for name, _ in pypi.calls] == ["robocorp-browser"]
    pypi.calls.clear()
    selected_actions = server.m_text_document__code_action(
        textDocument={"uri": uri}, range=diagnostics[1]["range"], context={"diagnostics": diagnostics}
    )
    assert len(selected_actions) == 1
    assert selected_actions[0]["title"] == "Update python-dotenv to latest PyPI version 1.3.0"
    assert [name for name, _ in pypi.calls] == ["python-dotenv"]


def test_unrelated_or_unselected_diagnostics_do_not_query_pypi(tmp_path):
    source = "dependencies:\n  pypi:\n    - robocorp-browser=2.3.5\n"
    pypi = FakePyPiCloud({"robocorp-browser": ["2.4.0"]})
    server, uri, _ = setup_server(source, tmp_path, pypi)
    cursor = {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 0}}

    assert server.m_text_document__code_action(
        textDocument={"uri": uri}, range=cursor,
        context={"diagnostics": [{"source": "yaml-schema", "code": "type-error"}]},
    ) == []
    assert pypi.calls == []


def test_package_yaml_quickfix_fails_closed_for_unavailable_or_stale_pypi_data(tmp_path):
    source = "dependencies:\n  pypi:\n    - robocorp-browser=2.3.5\n"
    pypi = FakePyPiCloud({"robocorp-browser": ["2.4.0"]})
    server, uri, document = setup_server(source, tmp_path, pypi)
    diagnostics = outdated_diagnostic(source, document.path, pypi)
    pypi.fail = True

    actions = server.m_text_document__code_action(
        textDocument={"uri": uri}, range=diagnostics[0]["range"], context={"diagnostics": diagnostics}
    )
    assert actions == []

    pypi.fail = False
    pypi.versions = {}
    assert server.m_text_document__code_action(
        textDocument={"uri": uri}, range=diagnostics[0]["range"], context={"diagnostics": diagnostics}
    ) == []

    pypi.versions = {"robocorp-browser": ["2.4.0"]}
    stale_server, stale_uri, _ = setup_server(
        source.replace("2.3.5", "2.4.0"), tmp_path, pypi
    )
    assert stale_server.m_text_document__code_action(
        textDocument={"uri": stale_uri}, range=diagnostics[0]["range"], context={"diagnostics": diagnostics}
    ) == []

    forged = dict(diagnostics[0])
    forged["range"] = {
        "start": dict(diagnostics[0]["range"]["start"]),
        "end": dict(diagnostics[0]["range"]["end"]),
    }
    forged["range"]["end"]["character"] += 1
    assert server.m_text_document__code_action(
        textDocument={"uri": uri}, range=forged["range"], context={"diagnostics": [forged]}
    ) == []


@pytest.mark.parametrize(
    "requirement,updated",
    [
        ('"robocorp-browser=2.3.5"', '"robocorp-browser=2.4.0"'),
        ("'robocorp-browser=2.3.5'", "'robocorp-browser=2.4.0'"),
    ],
)
def test_package_yaml_quickfix_preserves_quotes_operator_and_crlf(
    tmp_path, requirement, updated
):
    source = f"dependencies:\r\n  pypi:\r\n    - {requirement}  # keep\r\n"
    pypi = FakePyPiCloud({"robocorp-browser": ["2.4.0"]})
    server, uri, document = setup_server(source, tmp_path, pypi)
    diagnostics = outdated_diagnostic(source, document.path, pypi)
    actions = server.m_text_document__code_action(
        textDocument={"uri": uri}, range=diagnostics[0]["range"], context={"diagnostics": diagnostics}
    )

    assert len(actions) == 1
    edit = actions[0]["edit"]["documentChanges"][0]["edits"][0]
    assert apply_text_edit(source, edit) == source.replace(requirement, updated)


@pytest.mark.parametrize(
    "requirement",
    [
        "robocorp-browser[extra]=2.3.5",
        "robocorp-browser>=2.3.5",
        "robocorp-browser @ https://example.invalid/package.whl",
    ],
)
def test_package_yaml_quickfix_does_not_rewrite_non_simple_requirements(
    tmp_path, requirement
):
    source = f"dependencies:\n  pypi:\n    - {requirement}\n"
    pypi = FakePyPiCloud({"robocorp-browser": ["2.4.0"]})
    server, uri, document = setup_server(source, tmp_path, pypi)
    diagnostics = outdated_diagnostic(source, document.path, pypi)
    request_range = diagnostics[0]["range"] if diagnostics else {
        "start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 0}
    }

    assert server.m_text_document__code_action(
        textDocument={"uri": uri}, range=request_range, context={"diagnostics": diagnostics}
    ) == []
