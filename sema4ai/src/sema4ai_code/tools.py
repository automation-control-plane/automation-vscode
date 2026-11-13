import os
import sys
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Set

from sema4ai_ls_core.core_log import get_logger
from sema4ai_ls_core.protocols import IEndPoint, LaunchActionResult

log = get_logger(__name__)


class Tool(Enum):
    RCC = "rcc"
    ACTION_SERVER = "action-server"
    AGENT_CLI = "agent-cli"


@dataclass
class ToolInfo:
    mutex_name: str
    executable_name: str
    version_command: tuple[str, ...]


_tool_info_map = {
    Tool.RCC: ToolInfo(
        mutex_name="robocorp_get_rcc",
        executable_name="rcc",
        version_command=("--version",),
    ),
    Tool.ACTION_SERVER: ToolInfo(
        mutex_name="automation-get-action-server",
        executable_name="action-server",
        version_command=("version",),
    ),
    Tool.AGENT_CLI: ToolInfo(
        mutex_name="automation-get-agent-cli",
        executable_name="agent-cli",
        version_command=("--version",),
    ),
}


def get_tool_info(tool: Tool) -> ToolInfo:
    return _tool_info_map[tool]


def get_tool_version(tool: Tool, location: str) -> LaunchActionResult:
    tool_info = get_tool_info(tool)
    version_command = tool_info.version_command

    from sema4ai_ls_core.process import launch

    return launch((location,) + version_command)


def verify_tool_downloaded_ok(
    tool: Tool, location: str, force: bool, make_run_check: bool, version: str
) -> bool:
    """
    Args:
        version: If `make_run_check` is True, the version is matched against the
            downloaded version (and if it doesn't match `False` will be returned).

    Returns:
        True if everything is ok and False otherwise.
    """
    if location in _checked_downloaded_tools and not force:
        if os.path.isfile(location):
            return True  # Already checked: just do simpler check.

    import time

    if not os.path.isfile(location):
        log.info(f"Tool {location} does not exist.")
        return False

    if not os.access(location, os.X_OK):
        log.info(f"Tool {location} is not executable.")
        return False

    # Actually execute it to make sure it works (in windows right after downloading
    # it may not be ready, so, retry a few times).
    if not make_run_check:
        _checked_downloaded_tools.add(location)
        return True
    else:
        times = 5
        timeout = 1
        for _ in range(times):
            version_result = get_tool_version(tool, location)
            if version_result.success:
                if (
                    version_result.result
                    and version_result.result.strip() == version.strip()
                ):
                    _checked_downloaded_tools.add(location)
                    return True
                else:
                    log.info(
                        f"The currently downloaded version of {location} ({version_result.result!r}) "
                        f"does not match the required version for the vscode extension: {version}"
                    )
                    return False
            time.sleep(timeout / times)
        log.info(
            f"Tool {location} failed to execute. Details: {version_result.message}"
        )

        return False


# Entries should be the location of the tools
_checked_downloaded_tools: set[str] = set()


def download_tool(
    tool: Tool,
    location: str,
    tool_version: str,
    force: bool = False,
    sys_platform: str | None = None,
    endpoint: IEndPoint | None = None,
) -> None:
    """
    Downloads the given Sema4.ai tool to the specified location. Note that it doesn't overwrite it if it
    already exists (unless force == True).

    Args:
        tool: The type of the tool to download. Available tools are specified with Tool enum.
        location: The location to store the tool executable in the filesystem.
        tool_version: version of the tool to download.
        force: Whether we should overwrite an existing installation. Defaults to False.
        sys_platform: The target platform of downloaded artifact. Defaults to None.
    """

    if tool in (Tool.RCC, Tool.ACTION_SERVER):
        import tempfile
        from pathlib import Path
        from sema4ai_code.published_tools import published_tool, verify_digest
        from sema4ai_ls_core.http import download_with_resume
        from sema4ai_ls_core.system_mutex import timed_acquire_mutex

        artifact = published_tool(tool.value, sys_platform)
        if tool_version != artifact["version"]:
            raise ValueError(f"Unsupported {tool.value} version: {tool_version}")
        destination = Path(location)
        with timed_acquire_mutex(f"automation-download-{tool.value}", timeout=300):
            if destination.exists():
                if verify_digest(destination, artifact["sha256"]):
                    return
                raise RuntimeError(
                    f"Existing executable at {destination} does not match the pinned release. It has been preserved; configure an executable or choose an unused download path."
                )
            destination.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(
                prefix=destination.name + ".", dir=destination.parent
            )
            os.close(fd)
            staged = Path(temporary)
            try:
                from sema4ai_ls_core.constants import NULL
                from sema4ai_ls_core.progress_report import progress_context

                context = (
                    progress_context(
                        endpoint,
                        f"Download {tool.value}",
                        dir_cache=None,
                        cancellable=True,
                    )
                    if endpoint
                    else NULL
                )
                with context as reporter:
                    download_with_resume(
                        artifact["url"],
                        staged,
                        make_executable=True,
                        progress_reporter=reporter,
                    )
                if not verify_digest(staged, artifact["sha256"]):
                    raise RuntimeError(
                        f"SHA-256 verification failed for {artifact['url']}"
                    )
                # Hard-link admission fails if a different writer created the target.
                os.link(staged, destination)
            finally:
                staged.unlink(missing_ok=True)
        return

    raise RuntimeError(
        "Automatic vendor Agent CLI acquisition is outside the published local toolchain. Configure a trusted executable explicitly for that integration."
    )


def get_default_tool_location(tool: Tool) -> str:
    """
    Returns the default path for the given Tool to be located in.

    Args:
        tool: type of the tool.
        version: version of the tool we want to get the location for.
    """
    from sema4ai_code import get_extension_relative_path

    tool_info = get_tool_info(tool)
    executable_name = tool_info.executable_name

    if tool in (Tool.RCC, Tool.ACTION_SERVER):
        from sema4ai_code.published_tools import published_tool

        return get_extension_relative_path("bin", published_tool(tool.value)["name"])

    executable_extension = ".exe" if sys.platform == "win32" else ""

    return get_extension_relative_path(
        "bin", f"{executable_name}{executable_extension}"
    )


def is_valid_semver_version(version: str) -> bool:
    import re

    SEMVER_REGEX = re.compile(
        r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)$"
    )

    return SEMVER_REGEX.match(version) is not None
