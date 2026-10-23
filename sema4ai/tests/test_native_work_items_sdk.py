"""Real published SDK tests; run with an owned package interpreter, not mocks."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from sema4ai_code.work_items_native import handle


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
        with self.assertRaisesRegex(ValueError, "FIFO"):
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
