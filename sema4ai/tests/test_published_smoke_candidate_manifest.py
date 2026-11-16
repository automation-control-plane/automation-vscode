"""Candidate manifests must remain private to the qualification source view."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def test_candidate_manifest_resolves_without_changing_production_pins(tmp_path):
    repository = Path(__file__).resolve().parents[2]
    production_manifest = repository / "sema4ai/published-tools.json"
    candidate_manifest = (
        repository / "docs/evidence/dogfood-setup-20261115/candidate-tools.json"
    )
    original_hash = hashlib.sha256(production_manifest.read_bytes()).hexdigest()

    spec = importlib.util.spec_from_file_location(
        "published_smoke", Path(__file__).with_name("published_smoke.py")
    )
    assert spec is not None and spec.loader is not None
    smoke = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(smoke)
    extension = smoke.stage_candidate_extension(candidate_manifest, tmp_path)

    # Match the smoke's fresh worker process; already-imported source modules
    # in this pytest process must not select the production manifest instead.
    resolved = subprocess.check_output(
        [sys.executable, "-c", "import json; import sema4ai_code; "
         "sema4ai_code.import_robocorp_ls_core(); "
         "from sema4ai_code.published_tools import published_tool; "
         "print(json.dumps([published_tool('rcc'), published_tool('action-server')]))"],
        env={**os.environ, "PYTHONPATH": str(extension / "src")},
        text=True,
        timeout=20,
    )
    rcc, runtime = json.loads(resolved)
    assert (rcc["version"], rcc["sha256"]) == (
        "v18.19.11",
        "4d68609044d3a39a1728d571d54c77a6174215adb40eb9acd69ce5ad34a6db1f",
    )
    assert (runtime["version"], runtime["sha256"]) == (
        "1.1.1",
        "8c27fbed198aef16c98cdc7a45230fbc4708b06dff1c3523aeddfcdf7840efd0",
    )
    assert not (extension / "bin").exists()
    assert hashlib.sha256(production_manifest.read_bytes()).hexdigest() == original_hash
