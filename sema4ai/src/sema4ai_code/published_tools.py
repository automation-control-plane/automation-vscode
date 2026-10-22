"""Pinned release artifacts shared with the TypeScript bootstrap."""

import hashlib
import json
import platform
import sys
from pathlib import Path

from sema4ai_code import get_extension_relative_path


def published_tool(name: str, sys_platform: str | None = None) -> dict:
    manifest = json.loads(
        Path(get_extension_relative_path("published-tools.json")).read_text("utf-8")
    )
    tool = manifest[name]
    target = sys_platform or sys.platform
    machine = platform.machine().lower()
    if target == "darwin-arm64":
        target, machine = "darwin", "arm64"
    arch = "x64" if machine in ("amd64", "x86_64") else machine
    key = f"{target}-{arch}"
    if key not in tool["assets"]:
        raise RuntimeError(f"No published {name} artifact for {key}.")
    asset = tool["assets"][key]
    return {
        **tool,
        **asset,
        "url": f"https://github.com/{tool['repository']}/releases/download/{tool['tag']}/{asset['name']}",
    }


def verify_digest(path: Path, expected: str) -> bool:
    return hashlib.sha256(path.read_bytes()).hexdigest() == expected
