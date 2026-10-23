"""Package-scoped UI bridge to published Work Items APIs. Never accesses SQL.

Executed using the selected package's interpreter. stdin/stdout are a bounded
JSON protocol; diagnostics go to stderr. Queue lifecycle remains SDK-owned.
"""

import base64
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import re
import sys
from uuid import uuid4

MAX_BYTES = 2 * 1024 * 1024


def strict_json(text):
    def pairs(entries):
        result = {}
        for name, value in entries:
            if name in result:
                raise ValueError(f"Duplicate field name: {name}")
            result[name] = value
        return result

    def constant(value):
        raise ValueError(f"Non-finite JSON value: {value}")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)


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
    contract_path = storage / "payload-contract.json"
    contract = strict_json(contract_path.read_text()) if contract_path.exists() else {}

    def checked_payload(value):
        value = payload(value)
        checks = {"string": lambda x: isinstance(x, str), "integer": lambda x: type(x) is int,
                  "number": lambda x: type(x) in (int, float), "boolean": lambda x: type(x) is bool,
                  "object": lambda x: isinstance(x, dict), "array": lambda x: isinstance(x, list),
                  "null": lambda x: x is None}
        for name, kind in contract.items():
            if name not in value or not checks[kind](value[name]):
                raise ValueError(f"Payload field {name!r} is required and must be {kind}.")
        return value

    if op == "contract":
        value = request["payload"]
        if not isinstance(value, dict) or len(value) > 100 or any(
            not isinstance(name, str) or not name or len(name) > 100 or
            not isinstance(kind, str) or kind not in {"string", "integer", "number", "boolean", "object", "array", "null"}
            for name, kind in value.items()
        ):
            raise ValueError("Contract maps required top-level fields to string/integer/number/boolean/object/array/null. This is not full JSON Schema.")
        if contract_path.exists() and request.get("revision") != digest(contract_path):
            raise ValueError("Payload contract changed. Refresh before editing.")
        contract_path.write_text(json.dumps(value, indent=2))
        return {}
    queue = component(request.get("queue", "input"))
    adapter = None
    if mode == "sqlite":
        adapter = SQLiteAdapter(db_path=str(storage / "queue.db"), queue_name=queue,
                                output_queue_name=queue + ".outputs", files_dir=str(storage / "files"))
    if op == "recover":
        if not adapter:
            raise ValueError("Orphan recovery is an SDK SQLite operation, not a file fixture operation.")
        return {"recovered": adapter.recover_orphaned_work_items()}

    def file_item(key):
        relative, index = key.rsplit("#", 1)
        path = child(root, relative)
        # Restrict edits to the extension's documented local fixture areas.
        if not any(path.is_relative_to(child(root, folder)) for folder in
                   ("devdata/work-items-in", "devdata/work-items-out")):
            raise ValueError("Not a local Work Item fixture.")
        data = strict_json(path.read_text())
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
        for path in sorted((storage / "executions").glob("*/receipt.json"), key=lambda path: path.stat().st_mtime)[-100:]:
            receipts.append(json.loads(path.read_text()))
        receipts.sort(key=lambda receipt: receipt.get("created_at", ""))
        replays = [json.loads(path.read_text()) for path in sorted((storage / "replays").glob("*.json"))[-100:]]
        if adapter:
            items = adapter.list_items(queue_name=queue) + adapter.list_items(queue_name=queue + ".outputs")
            return {"items": items, "receipts": receipts, "replays": replays, "contract": contract, "contract_revision": digest(contract_path) if contract_path.exists() else None,
                    "stats": adapter.get_queue_stats(queue), "authority": "Stored in this package’s local queue. Task code updates item status and linked outputs."}
        items = []
        for role, folder in (("input", "work-items-in"), ("output", "work-items-out")):
            parent = child(root, "devdata/" + folder)
            if not parent.exists():
                continue
            for path in sorted(parent.glob("*/work-items.json")):
                path = child(root, str(path.relative_to(root)))
                try:
                    data = strict_json(path.read_text())
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
        return {"items": items, "receipts": receipts, "replays": replays, "contract": contract, "contract_revision": digest(contract_path) if contract_path.exists() else None,
                "authority": "Local inputs and outputs for this package."}
    if op in {"create", "replay"}:
        value, files = checked_payload(request.get("payload", {})) if op == "create" else {}, files_from_request()
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
            checked_payload(value)
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
        value = checked_payload(request["payload"])
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
            checked_payload(item["payload"])
            pending = [v for v in adapter.list_items(queue_name=queue) if v["state"] == "PENDING"]
            if len(pending) >= 100 or not pending or pending[-1]["id"] != key:
                raise ValueError("This queue runs its oldest waiting input. Select that input, or use a separate test queue. This view supports fewer than 100 waiting inputs per queue.")
            env = {"RC_WORKITEM_ADAPTER": "SQLiteAdapter", "RC_WORKITEM_DB_PATH": str(storage / "queue.db"),
                   "RC_WORKITEM_FILES_DIR": str(storage / "files"), "RC_WORKITEM_QUEUE_NAME": queue,
                   "RC_WORKITEM_OUTPUT_QUEUE_NAME": queue + ".outputs"}
        else:
            path, index, data = file_item(key)
            checked_payload(data[index].get("payload"))
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
                   "input_binding": "Immutable selected fixture snapshot" if mode == "file" else "FIFO preview, not exclusive reservation; SDK parent_id is authoritative. Do not share this development queue with another consumer.",
                   "created_at": datetime.now(timezone.utc).isoformat(),
                   "output": env.get("RC_WORKITEM_OUTPUT_PATH"), "authority": "VS Code local execution receipt; not Runtime Run/Attempt"}
        write_new(directory / "receipt.json", receipt)
        write_new(directory / "action-parameters.json", payload(request.get("parameters", {})))
        return {"id": run_id, "env": env, "parameters": str(directory / "action-parameters.json")}
    if op == "receipt":
        path = child(storage, "executions/" + component(request["id"]) + "/receipt.json")
        value = json.loads(path.read_text())
        state = request["state"]
        if state not in {"STARTED", "EXITED", "STOPPED", "TERMINATED", "CANCELLED", "LAUNCH_REJECTED"}:
            raise ValueError("Invalid execution receipt event.")
        if not (value["state"] == "CANCELLED" and state == "EXITED") and (
            state not in {"STOPPED", "TERMINATED"} or value["state"] not in {"EXITED", "CANCELLED"}
        ):
            value["state"] = state
        value["updated_at"] = datetime.now(timezone.utc).isoformat()
        for name in ("session", "exit_code"):
            if request.get(name) is not None:
                value[name] = request[name]
        path.write_text(json.dumps(value, indent=2))
        return value
    raise ValueError("Unsupported local Work Items operation.")


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES * 4 + 1)
        if len(raw) > MAX_BYTES * 4:
            raise ValueError("Request exceeds local editor limit.")
        result = handle(strict_json(raw))
        print(json.dumps({"success": True, "result": result}, allow_nan=False))
    except Exception as error:
        print(json.dumps({"success": False, "message": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
