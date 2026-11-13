"""Extension-owned storage, separate from execution homes and vendor Studio data."""

import os
import sys
from pathlib import Path
from typing import Mapping


def extension_storage(
    environ: Mapping[str, str] | None = None, *, platform: str | None = None
) -> Path:
    """Resolve without creating directories or reading legacy/private cache data.

    AUTOMATION_EXTENSION_STORAGE is an exact directory. The historical
    ROBOCORP_CODE_USER_HOME remains a base directory, now with an owned suffix.
    """
    env = os.environ if environ is None else environ
    if env.get("AUTOMATION_EXTENSION_STORAGE"):
        return Path(env["AUTOMATION_EXTENSION_STORAGE"])
    if env.get("ROBOCORP_CODE_USER_HOME"):
        return Path(env["ROBOCORP_CODE_USER_HOME"]) / ".automation-vscode"
    if (platform or sys.platform) == "win32":
        if not env.get("LOCALAPPDATA"):
            raise RuntimeError("LOCALAPPDATA is required to resolve extension storage.")
        return Path(env["LOCALAPPDATA"]) / "automation-vscode"
    state_home = env.get("XDG_STATE_HOME")
    base = Path(state_home) if state_home else Path(env.get("HOME") or Path.home()) / ".local" / "state"
    return base / "automation-vscode"


def storage_directory(name: str) -> Path:
    directory = extension_storage() / name
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    return directory


def runtime_metadata_directory(home: Path) -> Path:
    """Disposable interpreter metadata belongs to the selected execution home."""
    return home / ".automation-vscode"
