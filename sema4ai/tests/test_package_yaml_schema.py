import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft7Validator


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "resources" / "action-package.schema.json").read_text("utf-8"))


class _NoCondaIndex:
    def sqlite_queries(self):
        return None


class _NoNewPyPiVersions:
    def get_versions_newer_than(self, *_args):
        return []


def _analyzer_issues(contents: str, path: Path):
    from sema4ai_code.vendored_deps.package_deps.analyzer import PackageYamlAnalyzer

    analyzer = PackageYamlAnalyzer(
        contents,
        str(path),
        _NoCondaIndex(),
        _NoNewPyPiVersions(),
    )
    return list(analyzer.iter_package_yaml_issues())


def _package(dependencies: str) -> str:
    return (
        "name: Synthetic Action\n"
        "version: 0.0.1\n"
        "dependencies:\n"
        + "\n".join("  " + line for line in dependencies.splitlines())
        + "\n"
        "dev-dependencies:\n"
        "  conda-forge: []\n"
        "  pypi: []\n"
    )


def test_package_yaml_pypi_lists_of_requirement_strings_match_schema_and_analyzer(tmp_path):
    contents = _package(
        "conda-forge:\n"
        "  - python=3.12.12\n"
        "pypi:\n"
        "  - robocorp-browser=2.3.5\n"
        "  - python-dotenv=1.2.1"
    )
    parsed = yaml.safe_load(contents)
    Draft7Validator(SCHEMA).validate(parsed)

    issues = _analyzer_issues(contents, tmp_path / "package.yaml")
    assert not any("expected the entries of pypi" in issue["message"] for issue in issues)
    assert not any("expected the entries of pypi to be strings" in issue["message"] for issue in issues)


@pytest.mark.parametrize(
    ("pypi_value", "expected_message"),
    [
        ("robocorp-browser=2.3.5", "expected the entries of pypi to be a list"),
        ([{"name": "python-dotenv", "version": "1.2.1"}], "expected the entries of pypi to be strings"),
        (["python-dotenv=1.2.1", 3], "expected the entries of pypi to be strings"),
    ],
)
def test_package_yaml_rejects_invalid_pypi_dependency_shapes(tmp_path, pypi_value, expected_message):
    package = {
        "name": "Synthetic Action",
        "version": "0.0.1",
        "dependencies": {"conda-forge": ["python=3.12.12"], "pypi": pypi_value},
        "dev-dependencies": {"conda-forge": [], "pypi": []},
    }
    schema_errors = list(Draft7Validator(SCHEMA).iter_errors(package))
    assert schema_errors

    contents = yaml.safe_dump(package, sort_keys=False)
    issues = _analyzer_issues(contents, tmp_path / "package.yaml")
    assert any(expected_message in issue["message"] for issue in issues)
