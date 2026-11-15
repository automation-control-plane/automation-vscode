"""AST-only Action discovery should include nested source modules by decorator."""

from pathlib import Path
import sys

import pytest

from sema4ai_ls_core import uris
from sema4ai_code.robo.collect_actions_ast import iter_actions_and_datasources
from sema4ai_code.robocorp_language_server import RobocorpLanguageServer


def _write_action(path: Path, decorator: str, function: str, marker: Path | None = None):
    path.parent.mkdir(parents=True, exist_ok=True)
    side_effect = (
        f"Path({str(marker)!r}).write_text('executed')\n" if marker else ""
    )
    path.write_text(
        "from pathlib import Path\n"
        f"{side_effect}"
        f"@{decorator}\n"
        f"def {function}():\n"
        "    return None\n",
        encoding="utf-8",
    )


def test_collects_decorated_functions_in_flat_and_src_layouts_without_execution(
    tmp_path,
):
    marker = tmp_path / "module-imported"
    sources = {
        "server_actions/search_discovery.py": ("action", "search_discovery", marker),
        "server_actions/browser.py": ("action", "browser", None),
        "server_actions/apply.py": ("action", "apply", None),
        "actions.py": ("action(is_consequential=True)", "flat_action", None),
        "src/server_actions/search_discovery.py": ("action", "src_search", None),
    }
    for relative, (decorator, function, side_effect) in sources.items():
        _write_action(tmp_path / relative, decorator, function, side_effect)
    (tmp_path / "server_actions/syntax_error.py").write_text(
        "@action(\ndef broken(:\n", encoding="utf-8"
    )

    result = list(iter_actions_and_datasources(tmp_path))
    tree_result = RobocorpLanguageServer._local_list_actions_internal_impl(
        None, uris.from_fs_path(str(tmp_path)), False
    )
    assert tree_result["success"]
    found = {
        (
            Path(uris.to_fs_path(info["uri"]))
            .relative_to(tmp_path)
            .as_posix(),
            info["name"],
            info["kind"],
        )
        for info in result
    }

    assert found == {
        ("server_actions/search_discovery.py", "search_discovery", "action"),
        ("server_actions/browser.py", "browser", "action"),
        ("server_actions/apply.py", "apply", "action"),
        ("actions.py", "flat_action", "action"),
        ("src/server_actions/search_discovery.py", "src_search", "action"),
    }
    tree_found = {
        (
            Path(uris.to_fs_path(info["uri"]))
            .relative_to(tmp_path)
            .as_posix(),
            info["name"],
            info["kind"],
        )
        for info in tree_result["result"]
    }
    assert tree_found == found
    assert not marker.exists()


def test_prunes_virtualenv_generated_and_cache_directories(tmp_path):
    excluded = (
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".cache",
        ".tox",
        ".nox",
        "build",
        "dist",
        "generated",
        "site-packages",
        "dist-packages",
    )
    for name in excluded:
        _write_action(tmp_path / name / "nested" / "actions.py", "action", "ignored")

    custom_environment = tmp_path / "custom_environment"
    custom_environment.mkdir()
    (custom_environment / "pyvenv.cfg").write_text("home = /isolated\n", encoding="utf-8")
    _write_action(
        custom_environment / "lib" / "actions.py", "action", "ignored_venv"
    )

    assert list(iter_actions_and_datasources(tmp_path)) == []


@pytest.mark.skipif(sys.platform == "win32", reason="Directory symlink creation needs elevated Windows setup")
def test_skips_directory_symlinks_and_cycles(tmp_path):
    root = tmp_path / "package"
    root.mkdir()
    _write_action(root / "actions.py", "action", "local_action")
    external = tmp_path / "external"
    external.mkdir()
    _write_action(external / "linked_action.py", "action", "external_action")
    (root / "linked").symlink_to(external, target_is_directory=True)
    (root / "cycle").symlink_to(root, target_is_directory=True)

    result = list(iter_actions_and_datasources(root))

    assert [(info["name"], info["kind"]) for info in result] == [
        ("local_action", "action")
    ]
