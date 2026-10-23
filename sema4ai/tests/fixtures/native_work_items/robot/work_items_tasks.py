from robocorp.tasks import task
from actions import work_items
from pathlib import Path
from tempfile import TemporaryDirectory


@task
def consume():
    for item in work_items.inputs:
        value = item.payload["value"]
        work_items.outputs.create(payload={"observed": value})
        item.done()


@task
def copy_attachment():
    """Copy one synthetic input attachment to an output linked by the SDK."""
    for item in work_items.inputs:
        value = item.payload["value"]  # Desktop breakpoint: before output creation.
        with TemporaryDirectory(prefix="automation-attachment-proof-") as scratch:
            source = item.get_file("attachment-proof.txt", Path(scratch) / "proof.txt")
            content = source.read_bytes()
        if content != b"Automation Work Items attachment proof\nvalue=7\n":
            raise ValueError("Expected the supplied synthetic attachment-proof.txt bytes")
        work_items.outputs.create(payload={"observed": value}, files={"copied-proof.txt": content})
        item.done()
        return  # Exactly one item; never drain a shared queue.
    raise RuntimeError("Expected a Work Item")
