"""Real published SDK tests; run with an owned package interpreter, not mocks."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from sema4ai_code.work_items_native import handle, strict_json


class NativeWorkItemsSDK(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="native-work-items-")
        self.root = Path(self.scratch.name)
        self.manifest = self.root / "package.yaml"
        self.manifest.write_text("name: synthetic\n")

    def tearDown(self):
        self.scratch.cleanup()

    def call(self, op, mode="file", **params):
        return handle({"manifest": str(self.manifest), "mode": mode, "op": op, **params})

    def test_file_editor_snapshot_attachment_and_conflict(self):
        key = self.call("create", payload={"value": 7}, name="invoice")["id"]
        item = self.call("list")["items"][0]
        self.call("save", id=key, revision=item["revision"], payload={"value": 8})
        with self.assertRaisesRegex(ValueError, "changed"):
            self.call("save", id=key, revision=item["revision"], payload={"value": 9})
        self.call("attach", id=key, name="invoice.txt", files={"invoice.txt": base64.b64encode(b"invoice").decode()})
        with self.assertRaises(FileExistsError):
            self.call("attach", id=key, name="invoice.txt", files={"invoice.txt": ""})
        prepared = self.call("prepare", id=key)
        data = json.loads(Path(prepared["env"]["RC_WORKITEM_INPUT_PATH"]).read_text())
        self.assertEqual(data[0]["payload"], {"value": 8})
        self.assertEqual((Path(prepared["env"]["RC_WORKITEM_INPUT_PATH"]).parent / data[0]["files"]["invoice.txt"]).read_bytes(), b"invoice")
        self.assertEqual(base64.b64decode(self.call("download", id=key, name="invoice.txt")["content"]), b"invoice")
        copied = self.call("replay", id=key, name="replay")["id"]
        self.assertNotEqual(copied, key)
        self.assertEqual(len(self.call("list")["items"]), 2)

    def test_edited_replay_preserves_source_attachments_and_lineage(self):
        for manifest in ("package.yaml", "robot.yaml"):
            self.manifest = self.root / manifest
            self.manifest.write_text("name: synthetic\n")
            for mode in ("file", "sqlite"):
                with self.subTest(manifest=manifest, mode=mode):
                    source = self.call("create", mode, payload={"value": 7}, name="original")["id"]
                    self.call("attach", mode, id=source, name="proof.txt", files={"proof.txt": base64.b64encode(b"unchanged bytes").decode()})
                    original = next(item for item in self.call("list", mode)["items"] if item["id"] == source)
                    copy = self.call("replay", mode, id=source, payload={"value": 8}, source_payload={"value": 7}, revision=original.get("revision"), name="edited-copy")["id"]
                    self.assertNotEqual(copy, source)
                    result = self.call("list", mode)
                    self.assertEqual(next(item for item in result["items"] if item["id"] == source)["payload"], {"value": 7})
                    self.assertEqual(next(item for item in result["items"] if item["id"] == copy)["payload"], {"value": 8})
                    self.assertEqual(base64.b64decode(self.call("download", mode, id=copy, name="proof.txt")["content"]), b"unchanged bytes")
                    self.assertTrue(any(entry["source"] == source and entry["copy"] == copy for entry in result["replays"]))
                    count = len(result["items"])
                    with self.assertRaisesRegex(ValueError, "source payload changed"):
                        self.call("replay", mode, id=source, payload={"value": 9}, source_payload={"value": 99})
                    self.assertEqual(len(self.call("list", mode)["items"]), count)

    def test_sqlite_public_lifecycle_survives_process_restart(self):
        key = self.call("create", "sqlite", payload={"value": 7})["id"]
        prepared = self.call("prepare", "sqlite", id=key)
        worker = '''from actions.work_items import create_adapter, State
a=create_adapter()
key=a.reserve_input()
value=a.load_payload(key)['value']
out=a.create_output(key, {'observed':value})
a.add_file(out,'result.txt','result.txt',b'7')
a.release_input(key,State.DONE)
'''
        import os
        result = subprocess.run([sys.executable, "-c", worker], env={**os.environ, **prepared["env"]}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        items = self.call("list", "sqlite")["items"]
        original = next(item for item in items if item["id"] == key)
        output = next(item for item in items if item.get("parent_id") == key)
        self.assertEqual(original["state"], "COMPLETED")
        self.assertEqual(output["payload"], {"observed": 7})
        self.assertEqual(output["files"], ["result.txt"])
        copied = self.call("replay", "sqlite", id=output["id"])["id"]
        self.assertNotEqual(copied, output["id"])
        self.assertEqual(next(item for item in self.call("list", "sqlite")["items"] if item["id"] == copied)["state"], "PENDING")

    def test_sqlite_fifo_scope_and_no_unsafe_edit(self):
        first = self.call("create", "sqlite", payload={"value": 1})["id"]
        second = self.call("create", "sqlite", payload={"value": 2})["id"]
        with self.assertRaisesRegex(ValueError, "oldest waiting"):
            self.call("prepare", "sqlite", id=second)
        with self.assertRaisesRegex(ValueError, "different queue"):
            self.call("prepare", "sqlite", queue="unrelated", id=first)
        with self.assertRaisesRegex(ValueError, "conditional"):
            self.call("save", "sqlite", id=first, payload={"value": 10})

    def test_invalid_payload_paths_and_other_package(self):
        for value in ([], "raw", None, {"bad": float("nan")}):
            with self.assertRaises(ValueError):
                self.call("create", payload=value)
        with self.assertRaises(ValueError):
            self.call("create", name="../outside", payload={})
        key = self.call("create", payload={})["id"]
        for name in ("../secret", "/secret", "..", "a/b"):
            with self.assertRaises(ValueError):
                self.call("attach", id=key, name=name, files={name: ""})
        with self.assertRaises(ValueError):
            self.call("save", id="../other/work-items.json#0", revision="", payload={})
        other = self.root / "other" / "robot.yaml"
        other.parent.mkdir(); other.write_text("tasks: {}")
        self.assertEqual(handle({"manifest": str(other), "mode": "file", "op": "list"})["items"], [])

    def test_robot_requires_same_owned_sdk_and_receipts(self):
        self.manifest = self.root / "robot.yaml"
        self.manifest.write_text("tasks: {}")
        key = self.call("create", payload={"value": 7})["id"]
        run = self.call("prepare", id=key)
        self.call("receipt", id=run["id"], state="STARTED", session="synthetic-session")
        self.call("receipt", id=run["id"], state="STOPPED", session="synthetic-session")
        self.assertEqual(self.call("list")["receipts"][0]["state"], "STOPPED")

    def test_typed_payload_contract_and_actual_exit_receipt(self):
        self.call("contract", payload={"value": "integer"})
        for value in ({}, {"value": "7"}, {"value": True}):
            with self.assertRaisesRegex(ValueError, "must be integer"):
                self.call("create", payload=value)
        key = self.call("create", payload={"value": 7})["id"]
        run = self.call("prepare", id=key)
        self.call("receipt", id=run["id"], state="EXITED", session="synthetic", exit_code=1)
        self.call("receipt", id=run["id"], state="STOPPED", session="synthetic")
        receipt = self.call("list")["receipts"][0]
        self.assertEqual((receipt["state"], receipt["exit_code"]), ("EXITED", 1))
        with self.assertRaisesRegex(ValueError, "changed"):
            self.call("contract", payload={"value": "string"}, revision="stale")

    def test_sqlite_failure_replay_and_orphan_recovery_use_sdk(self):
        import os
        from unittest.mock import patch
        key = self.call("create", "sqlite", payload={"value": 7})["id"]
        prepared = self.call("prepare", "sqlite", id=key)
        script = '''from actions.work_items import create_adapter, State
a=create_adapter(); item=a.reserve_input()
a.release_input(item,State.FAILED,code='SYNTHETIC',message='Synthetic failure')
'''
        result = subprocess.run([sys.executable, "-c", script], env={**os.environ, **prepared["env"]}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        failed = next(item for item in self.call("list", "sqlite")["items"] if item["id"] == key)
        self.assertEqual((failed["state"], failed["error_code"]), ("FAILED", "SYNTHETIC"))
        replay = self.call("replay", "sqlite", id=key)["id"]
        run = self.call("prepare", "sqlite", id=replay)
        # The worker really reserves and exits; only this isolated test shortens
        # the SDK timeout. Production recovery retains its normal timeout.
        crashed = subprocess.run([sys.executable, "-c", "from actions.work_items import create_adapter; create_adapter().reserve_input()"], env={**os.environ, **run["env"]}, capture_output=True, text=True)
        self.assertEqual(crashed.returncode, 0, crashed.stderr)
        self.assertEqual(self.call("recover", "sqlite")["recovered"], [])
        with patch.dict(os.environ, {"RC_WORKITEM_ORPHAN_TIMEOUT_MINUTES": "0"}):
            self.assertIn(replay, self.call("recover", "sqlite")["recovered"])
        item = next(item for item in self.call("list", "sqlite")["items"] if item["id"] == replay)
        self.assertEqual(item["state"], "PENDING")

    def test_duplicate_json_fields_are_rejected_and_own_names_preserved(self):
        for text in ('{"value":1,"value":2}', '{"value":1,"\\u0076alue":2}', '{"nested":{"x":1,"x":2}}', '{"value":NaN}'):
            with self.assertRaises(ValueError):
                strict_json(text)
        data = strict_json('{"__proto__":{"polluted":true},"constructor":"business data"}')
        key = self.call("create", payload=data)["id"]
        item = next(item for item in self.call("list")["items"] if item["id"] == key)
        self.assertEqual(item["payload"], data)


if __name__ == "__main__":
    unittest.main(verbosity=2)
