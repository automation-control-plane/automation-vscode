import pytest


@pytest.mark.parametrize("manifest", ["package.yaml", "robot.yaml"])
@pytest.mark.parametrize("target", ["manifest", "directory", "nested_file"])
def test_work_items_use_nearest_owning_package_and_preserve_data(tmp_path, manifest, target):
    from sema4ai_code.robocorp_language_server import RobocorpLanguageServer

    # Exercise the real filesystem/command handler without launching unrelated services.
    server = RobocorpLanguageServer.__new__(RobocorpLanguageServer)
    server._prefix_to_last_run_number_and_time = {}
    package = tmp_path / "parent-robot" / "package"
    package.mkdir(parents=True)
    (package.parent / "robot.yaml").write_text("tasks: {}")
    yaml = package / manifest
    yaml.write_text("name: Synthetic")
    input_path = package / "devdata/work-items-in/input-1/work-items.json"
    input_path.parent.mkdir(parents=True)
    input_path.write_text('[{"payload":{"value":7},"files":{}}]')
    existing = []
    for i in range(1, 8):
        path = package / f"devdata/work-items-out/run-{i}/work-items.json"
        path.parent.mkdir(parents=True)
        path.write_text('[{"payload":{"observed":7},"files":{}}]')
        existing.append((path, path.read_bytes()))
    nested = package / "src/action.py"
    nested.parent.mkdir()
    nested.touch()
    selected = {"manifest": yaml, "directory": package, "nested_file": nested}[target]
    result = server._local_list_work_items_internal({"robot": str(selected), "increment_output": True})
    assert result["success"], result
    info = result["result"]
    assert info["robot_yaml"] == str(yaml)
    assert info["input_work_items"] == [{"name": "input-1", "json_path": str(input_path)}]
    assert len(info["output_work_items"]) == 7
    assert info["new_output_workitem_path"] == str(package / "devdata/work-items-out/run-8/work-items.json")
    for path, contents in existing:
        assert path.read_bytes() == contents
    # Another package starts with its own counter and never shares this package's output paths.
    other = tmp_path / "other"
    other.mkdir()
    (other / manifest).touch()
    result = server._local_list_work_items_internal({"robot": str(other), "increment_output": True})
    assert result["result"]["new_output_workitem_path"] == str(other / "devdata/work-items-out/run-1/work-items.json")


def test_missing_package_is_reported_without_inventing_manifest(tmp_path):
    from sema4ai_code.find_robot_yaml import find_package_yaml_path_from_path

    assert find_package_yaml_path_from_path(tmp_path, tmp_path.stat()) is None
