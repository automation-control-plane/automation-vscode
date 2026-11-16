"""The installed smoke must not borrow Poetry's editable core dependency."""

import os
from pathlib import Path
import shutil
import subprocess
import sys


def test_installed_worker_selects_vendored_core_before_editable_dependency(tmp_path):
    repository = Path(__file__).parents[2]
    extension = tmp_path / "installed"
    package = extension / "src/sema4ai_code"
    shutil.copytree(
        repository / "sema4ai/src/sema4ai_code", package,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    shutil.copytree(
        repository / "sema4ai-python-ls-core/src/sema4ai_ls_core",
        package / "vendored/sema4ai_ls_core", dirs_exist_ok=True,
    )
    program = r'''
import importlib.util, pathlib, subprocess, sys, types
path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("installed_worker", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class OwnershipChecked(Exception): pass
def stop_at_provenance(command, *args, **kwargs):
    assert command == ["git", "rev-parse", "HEAD"]
    import sema4ai_code, sema4ai_ls_core
    expected = pathlib.Path(sys.argv[2])
    assert pathlib.Path(sema4ai_code.__file__).is_relative_to(expected)
    assert pathlib.Path(sema4ai_ls_core.__file__).is_relative_to(expected)
    raise OwnershipChecked()
subprocess.check_output = stop_at_provenance
try:
    module.worker(types.SimpleNamespace(extension_root=sys.argv[2], worker_root=sys.argv[3], rcc="not-executed", runtime="not-executed"))
except OwnershipChecked:
    print("installed ownership checks passed before tooling execution")
else:
    raise AssertionError("worker did not reach its source provenance boundary")
'''
    result = subprocess.run(
        [sys.executable, "-c", program, str(repository / "sema4ai/tests/published_smoke.py"),
         str(extension), str(tmp_path / "unused-worker")],
        env={**os.environ, "PYTHONPATH": str(repository / "sema4ai-python-ls-core/src")},
        capture_output=True, text=True, timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == "installed ownership checks passed before tooling execution"
