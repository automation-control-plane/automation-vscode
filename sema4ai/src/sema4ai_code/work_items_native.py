"""Package-scoped UI bridge to published Work Items APIs. Never accesses SQL.

Executed using the selected package's interpreter. stdin/stdout are a bounded
JSON protocol; diagnostics go to stderr. Queue lifecycle remains SDK-owned.
"""

import base64
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import re
import sys
from uuid import uuid4

MAX_BYTES = 2 * 1024 * 1024


def component(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", value):
        raise ValueError("Use 1–80 letters, digits, underscores, dots or dashes.")
    return value


def payload(value):
    if not isinstance(value, dict):
        raise ValueError("Payload must be a JSON object; Action parameters are configured separately.")
    if len(json.dumps(value, allow_nan=False).encode()) > MAX_BYTES:
        raise ValueError("Payload exceeds the 2 MiB local editor limit.")
    return value


def child(root, value):
    path = (root / value).resolve()
    if path == root or root not in path.parents:
        raise ValueError("Work Item path escapes this package.")
    return path


def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def handle(request):
    manifest = Path(request["manifest"]).resolve(strict=True)
    if manifest.name not in {"package.yaml", "robot.yaml"}:
        raise ValueError("Select an Action package.yaml or Robot robot.yaml.")
    root = manifest.parent
    storage = child(root, "devdata/automation-work-items")
    storage.mkdir(parents=True, exist_ok=True)
    # The new native modes require the owned SDK for both package kinds. Legacy
    # Robot compatibility remains available through the existing resources tree.
    if version("actions-work-items") != "0.4.4":
        raise ValueError("Native Work Items requires owned actions-work-items==0.4.4 in this package.")
    from actions.work_items import FileAdapter, SQLiteAdapter

    mode, op = request["mode"], request["op"]
    if mode not in {"file", "sqlite"}:
        raise ValueError("This bridge supports FileAdapter and SDK SQLite only.")
    queue = component(request.get("queue", "input"))
    adapter = None
    if mode == "sqlite":
        adapter = SQLiteAdapter(db_path=str(storage / "queue.db"), queue_name=queue,
                                output_queue_name=queue + ".outputs", files_dir=str(storage / "files"))

    def file_item(key):
        relative, index = key.rsplit("#", 1)
        path = child(root, relative)
        # Restrict edits to the extension's documented local fixture areas.
        if not any(path.is_relative_to(child(root, folder)) for folder in
                   ("devdata/work-items-in", "devdata/work-items-out")):
            raise ValueError("Not a local Work Item fixture.")
        data = json.loads(path.read_text())
        if not isinstance(data, list) or not 0 <= int(index) < len(data):
            raise ValueError("Work Item no longer exists.")
        return path, int(index), data

    def owned_item(key):
        item = adapter.get_item(key)
        if item["queue_name"] not in {queue, queue + ".outputs"}:
            raise ValueError("Work Item belongs to a different queue.")
        return item

    def files_from_request():
        files = {}
        for name, encoded in request.get("files", {}).items():
            component(name)
            content = base64.b64decode(encoded, validate=True)
            if len(content) > MAX_BYTES:
                raise ValueError("Attachment exceeds the 2 MiB local editor limit.")
            files[name] = content
        return files

    if op == "list":
        receipts = []
        for path in sorted((storage / "executions").glob("*/receipt.json"))[-100:]:
            receipts.append(json.loads(path.read_text()))
        if adapter:
            items = adapter.list_items(queue_name=queue) + adapter.list_items(queue_name=queue + ".outputs")
            return {"items": items, "receipts": receipts, "stats": adapter.get_queue_stats(queue), "authority": "actions-work-items SQLiteAdapter"}
        items = []
        for role, folder in (("input", "work-items-in"), ("output", "work-items-out")):
            parent = child(root, "devdata/" + folder)
            if not parent.exists():
                continue
            for path in sorted(parent.glob("*/work-items.json")):
                path = child(root, str(path.relative_to(root)))
                try:
                    data = json.loads(path.read_text())
                    if not isinstance(data, list):
                        raise ValueError("Expected an array of Work Items.")
                    for index, value in enumerate(data):
                        items.append({"id": str(path.relative_to(root)) + "#" + str(index),
                                      "name": path.parent.name, "payload": value.get("payload"),
                                      "files": list(value.get("files", {})), "state": "LOCAL_FIXTURE",
                                      "role": role, "revision": digest(path)})
                except (ValueError, TypeError, AttributeError) as error:
                    items.append({"id": str(path.relative_to(root)) + "#0", "name": path.parent.name,
                                  "state": "INVALID", "error_message": str(error), "role": role})
        return {"items": items, "receipts": receipts, "authority": "Local test fixtures; execution receipts are not Runtime Runs"}
    if op in {"create", "replay"}:
        value, files = payload(request.get("payload", {})), files_from_request()
        parent_id = None
        if op == "replay":
            parent_id = request["id"]
            if adapter:
                source = owned_item(parent_id)
                value = source["payload"]
                files = {name: adapter.get_file(parent_id, name) for name in source["files"]}
            else:
                path, index, data = file_item(parent_id)
                reader = FileAdapter(input_path=str(path), output_path=str(storage / (uuid4().hex + ".json")))
                value = data[index].get("payload")
                files = {name: reader.get_file(str(index), name) for name in data[index].get("files", {})}
        if adapter:
            new_id = adapter.seed_input(payload=value, files=files, queue_name=queue)
        else:
            directory = child(root, "devdata/work-items-in/" + component(request.get("name", "item")) + "-" + uuid4().hex[:12])
            directory.mkdir(parents=True, exist_ok=False)
            path = directory / "work-items.json"
            write_new(path, [{"payload": value, "files": {}}])
            writer = FileAdapter(input_path=str(path), output_path=str(storage / (uuid4().hex + ".json")))
            for name, content in files.items():
                writer.add_file("0", name, name, content)
            new_id = str(path.relative_to(root)) + "#0"
        if parent_id:
            write_new(storage / "replays" / (uuid4().hex + ".json"), {"source": parent_id, "copy": new_id, "mode": mode})
        return {"id": new_id}
    if op == "save":
        value = payload(request["payload"])
        if adapter:
            # SDK has no compare-and-swap edit contract. Do not race a consumer.
            raise ValueError("Published SQLite has no conditional payload edit. Replay as a new item instead.")
        path, index, data = file_item(request["id"])
        if not path.is_relative_to(child(root, "devdata/work-items-in")):
            raise ValueError("Outputs are read-only. Replay creates a new input.")
        if digest(path) != request.get("revision"):
            raise ValueError("Fixture changed since loading; refresh before saving.")
        FileAdapter(input_path=str(path), output_path=str(storage / (uuid4().hex + ".json"))).save_payload(str(index), value)
        return {"revision": digest(path)}
    if op in {"attach", "download"}:
        key, name = request["id"], component(request["name"])
        if adapter:
            item = owned_item(key)
            if op == "attach" and (item["state"] != "PENDING" or item["queue_name"] != queue):
                raise ValueError("Only pending SQLite items accept attachments.")
            store, local_id = adapter, key
        else:
            path, index, data = file_item(key)
            if op == "attach" and not path.is_relative_to(child(root, "devdata/work-items-in")):
                raise ValueError("Outputs are read-only.")
            store, local_id = FileAdapter(input_path=str(path), output_path=str(storage / (uuid4().hex + ".json"))), str(index)
        if op == "download":
            content = store.get_file(local_id, name)
            if len(content) > MAX_BYTES:
                raise ValueError("Attachment exceeds the 2 MiB editor limit.")
            return {"content": base64.b64encode(content).decode()}
        if name in store.list_files(local_id):
            raise FileExistsError("Attachment already exists; existing data was preserved.")
        content = files_from_request()[name]
        store.add_file(local_id, name, name, content)
        return {}
    if op == "prepare":
        key = request["id"]
        run_id = uuid4().hex
        directory = storage / "executions" / run_id
        directory.mkdir(parents=True, exist_ok=False)
        if adapter:
            item = owned_item(key)
            pending = [v for v in adapter.list_items(queue_name=queue) if v["state"] == "PENDING"]
            if len(pending) >= 100 or not pending or pending[-1]["id"] != key:
                raise ValueError("SDK SQLite reserves FIFO. Choose the oldest pending input; queues of 100+ items require a worker.")
            env = {"RC_WORKITEM_ADAPTER": "SQLiteAdapter", "RC_WORKITEM_DB_PATH": str(storage / "queue.db"),
                   "RC_WORKITEM_FILES_DIR": str(storage / "files"), "RC_WORKITEM_QUEUE_NAME": queue,
                   "RC_WORKITEM_OUTPUT_QUEUE_NAME": queue + ".outputs"}
        else:
            path, index, data = file_item(key)
            # A selected record gets an immutable, private execution fixture.
            # Copy through public APIs so relative attachments remain valid.
            reader = FileAdapter(input_path=str(path), output_path=str(directory / "unused.json"))
            input_path = directory / "input.json"
            write_new(input_path, [{"payload": data[index].get("payload"), "files": {}}])
            writer = FileAdapter(input_path=str(input_path), output_path=str(directory / "output.json"))
            for name in data[index].get("files", {}):
                writer.add_file("0", name, name, reader.get_file(str(index), name))
            env = {"RC_WORKITEM_ADAPTER": "FileAdapter", "RC_WORKITEM_INPUT_PATH": str(input_path),
                   "RC_WORKITEM_OUTPUT_PATH": str(child(root, "devdata/work-items-out/native-" + run_id + "/work-items.json"))}
        receipt = {"id": run_id, "mode": mode, "input": key, "queue": queue, "state": "PREPARED",
                   "output": env.get("RC_WORKITEM_OUTPUT_PATH"), "authority": "VS Code local execution receipt; not Runtime Run/Attempt"}
        write_new(directory / "receipt.json", receipt)
        write_new(directory / "action-parameters.json", payload(request.get("parameters", {})))
        return {"id": run_id, "env": env, "parameters": str(directory / "action-parameters.json")}
    if op == "receipt":
        path = child(storage, "executions/" + component(request["id"]) + "/receipt.json")
        value = json.loads(path.read_text())
        state = request["state"]
        if state not in {"STARTED", "STOPPED", "CANCELLED", "LAUNCH_REJECTED"}:
            raise ValueError("Invalid execution receipt event.")
        value.update(state=state, session=request.get("session"), exit_code=request.get("exit_code"))
        path.write_text(json.dumps(value, indent=2))
        return value
    raise ValueError("Unsupported local Work Items operation.")


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES * 4 + 1)
        if len(raw) > MAX_BYTES * 4:
            raise ValueError("Request exceeds local editor limit.")
        result = handle(json.loads(raw))
        print(json.dumps({"success": True, "result": result}, allow_nan=False))
    except Exception as error:
        print(json.dumps({"success": False, "message": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
