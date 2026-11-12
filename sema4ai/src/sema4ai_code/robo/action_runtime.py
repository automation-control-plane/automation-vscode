"""Resolve only the owned Actions Core SDK in the target interpreter.

Robot task execution has its own launcher; it does not use this Action resolver.
"""

import importlib
import importlib.util
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path
import sys


class ActionSDKError(RuntimeError):
    """An Action Package cannot load its declared owned SDK."""


_INSTALL_HELP = (
    "Add actions-core==1.1.0 to the Python dependencies in package.yaml and rebuild "
    "the selected Action Package environment. Legacy vendor Action SDKs are not substitutes."
)


def load_actions():
    try:
        dist = distribution("actions-core")
    except PackageNotFoundError as error:
        raise ActionSDKError("Actions Core is missing. " + _INSTALL_HELP) from error

    # Metadata alone must not bless an unrelated actions.py on PYTHONPATH.
    # Check before import, so a shadow workload is not executed during discovery.
    files = {str(file): file for file in (dist.files or ())}
    for name, relative in (("actions", "actions/__init__.py"), ("actions.cli", "actions/cli.py")):
        recorded = files.get(relative)
        spec = importlib.util.find_spec(name)
        if recorded is None or spec is None or spec.origin is None or (
            Path(spec.origin).resolve() != Path(dist.locate_file(recorded)).resolve()
        ):
            raise ActionSDKError(
                f"Cannot resolve {name} from actions-core; a missing installation or "
                "shadow module is on the interpreter path. Check PYTHONPATH and the "
                "selected interpreter. " + _INSTALL_HELP
            )
        try:
            importlib.import_module(name)
        except ImportError as error:
            raise ActionSDKError(f"Cannot load actions-core: {error}. " + _INSTALL_HELP) from error
    return sys.modules["actions"], sys.modules["actions.cli"]


if __name__ == "__main__":
    actions, cli = load_actions()
    if sys.argv[1:] == ["--library-version"]:
        print(actions.__version__)
    else:
        cli.main(sys.argv[1:], exit=True)
