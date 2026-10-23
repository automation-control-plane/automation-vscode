from actions import action, work_items
from pathlib import Path
from tempfile import TemporaryDirectory


@action
def consume() -> str:
    """Consume a synthetic Work Item and create an output with real lineage.

    Returns:
        The observed value.
    """
    for item in work_items.inputs:
        value = item.payload["value"]
        work_items.outputs.create(payload={"observed": value})
        item.done()
        return str(value)
    raise RuntimeError("Expected a Work Item")


@action
def copy_attachment() -> str:
    """Copy one synthetic input attachment to an output linked by the SDK.

    Returns:
        The observed value, after the output attachment has been saved.
    """
    for item in work_items.inputs:
        value = item.payload["value"]  # Desktop breakpoint: before output creation.
        with TemporaryDirectory(prefix="automation-attachment-proof-") as scratch:
            source = item.get_file("attachment-proof.txt", Path(scratch) / "proof.txt")
            content = source.read_bytes()
        if content != b"Automation Work Items attachment proof\nvalue=7\n":
            raise ValueError("Expected the supplied synthetic attachment-proof.txt bytes")
        work_items.outputs.create(payload={"observed": value}, files={"copied-proof.txt": content})
        item.done()
        return str(value)  # Exactly one item; never drain a shared queue.
    raise RuntimeError("Expected a Work Item")
