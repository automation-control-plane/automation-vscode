"""Process-local package import paths, independent of editor analysis settings."""

import os
import sys
from collections.abc import Mapping, Sequence


def package_environment(
    environ: Mapping[str, str], additional: Sequence[str]
) -> dict[str, str]:
    # Match subprocess inheritance, with the interpreter environment taking priority.
    windows = sys.platform == "win32"
    result = {
        (key.upper() if windows else key): value
        for source in (os.environ, environ)
        for key, value in source.items()
    }
    if additional:
        inherited = result.get("PYTHONPATH", "")
        entries = list(additional)
        if inherited:
            entries.append(inherited)
        result["PYTHONPATH"] = (";" if windows else os.pathsep).join(entries)
    return result
