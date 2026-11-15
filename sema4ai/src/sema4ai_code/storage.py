"""Extension-owned storage, separate from execution homes and vendor Studio data."""

import hashlib
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
        root = Path(env["AUTOMATION_EXTENSION_STORAGE"])
    elif env.get("ROBOCORP_CODE_USER_HOME"):
        root = Path(env["ROBOCORP_CODE_USER_HOME"]) / ".automation-vscode"
    elif (platform or sys.platform) == "win32":
        if not env.get("LOCALAPPDATA"):
            raise RuntimeError("LOCALAPPDATA is required to resolve extension storage.")
        root = Path(env["LOCALAPPDATA"]) / "automation-vscode"
    else:
        state_home = env.get("XDG_STATE_HOME")
        base = Path(state_home) if state_home else Path(env.get("HOME") or Path.home()) / ".local" / "state"
        root = base / "automation-vscode"
    return root.resolve()


def oauth2_storage_directories(runtime_home: Path) -> tuple[Path, Path]:
    """Return persistent OAuth paths, retaining only an established legacy store."""
    runtime_home = runtime_home.resolve()
    legacy = runtime_home / ".sema4ai_code" / "oauth2"
    legacy_cwd = legacy / "cwd"
    legacy_datadir = legacy / "datadir"
    legacy_reference = legacy_cwd / ".vscode_reference_id"
    if (
        legacy_cwd.is_dir()
        and not legacy_cwd.is_symlink()
        and legacy_reference.is_file()
        and not legacy_reference.is_symlink()
        and legacy_datadir.is_dir()
        and not legacy_datadir.is_symlink()
    ):
        return legacy_cwd, legacy_datadir

    target = os.path.normcase(str(runtime_home)).encode("utf-8")
    identity = hashlib.sha256(target).hexdigest()
    root = storage_directory("oauth2") / identity
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    cwd = root / "cwd"
    datadir = root / "datadir"
    cwd.mkdir(mode=0o700, exist_ok=True)
    datadir.mkdir(mode=0o700, exist_ok=True)
    return cwd, datadir


def storage_directory(name: str) -> Path:
    directory = extension_storage() / name
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    return directory


def runtime_metadata_directory(home: Path) -> Path:
    """Disposable interpreter metadata belongs to the selected execution home."""
    return home / ".automation-vscode"
