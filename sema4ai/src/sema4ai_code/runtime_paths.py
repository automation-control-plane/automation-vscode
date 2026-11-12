"""Home selection for the published local toolchain. No directories are migrated."""

import os
from pathlib import Path
from typing import Literal, Mapping

RuntimeKind = Literal["actions", "robots"]


def vendor_studio_home(legacy_home: str | None = None) -> Path:
    """Keep the separately installed Studio's existing discovery directory."""
    import sys

    override = legacy_home or os.environ.get("SEMA4AI_HOME")
    if override:
        return Path(override)
    if sys.platform == "win32":
        return Path(os.environ["LOCALAPPDATA"]) / "sema4ai"
    return Path.home() / ".sema4ai"


def runtime_homes(
    legacy_home: str | None = None,
    environ: Mapping[str, str] | None = None,
    *,
    platform: str | None = None,
) -> dict[RuntimeKind, Path]:
    import sys

    env = os.environ if environ is None else environ
    platform = platform or sys.platform
    legacy = legacy_home or env.get("SEMA4AI_HOME") or env.get("ROBOCORP_HOME")
    base = (
        Path(env["LOCALAPPDATA"])
        if platform == "win32"
        else Path(env.get("HOME", str(Path.home())))
    )
    homes: dict[RuntimeKind, Path] = {}
    for kind in ("actions", "robots"):
        override = env.get(f"{kind.upper()}_HOME")
        homes[kind] = (
            Path(override)
            if override
            else (
                Path(legacy) / kind
                if legacy
                else base / (kind if platform == "win32" else f".{kind}")
            )
        )
    if os.path.normcase(os.path.realpath(homes["actions"])) == os.path.normcase(
        os.path.realpath(homes["robots"])
    ):
        raise ValueError(
            "ACTIONS_HOME and ROBOTS_HOME must select different directories."
        )
    return homes


def runtime_environment(
    kind: RuntimeKind, legacy_home: str | None = None
) -> dict[str, str]:
    homes = runtime_homes(legacy_home)
    return {
        "ACTIONS_HOME": str(homes["actions"]),
        "ROBOTS_HOME": str(homes["robots"]),
        "ROBOCORP_HOME": str(homes[kind]),
        # Never attach to an existing system shared Holotree or its locks.
        "RCC_HOLOTREE_MODE": "private",
    }
