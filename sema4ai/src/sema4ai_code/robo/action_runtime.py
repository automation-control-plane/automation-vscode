"""Select an installed Action API in the target interpreter, preferring Actions Core."""

import importlib
import sys


def load_actions():
    for name in ("actions", "sema4ai.actions", "robocorp.actions"):
        try:
            module = importlib.import_module(name)
            cli = importlib.import_module(f"{name}.cli")
            return module, cli
        except ModuleNotFoundError as error:
            if error.name != name and not name.startswith(f"{error.name}."):
                raise
    raise RuntimeError("Install actions-core==1.0.3 in the Action Package environment.")


if __name__ == "__main__":
    actions, cli = load_actions()
    if sys.argv[1:] == ["--library-version"]:
        print(actions.__version__)
    else:
        cli.main(sys.argv[1:], exit=True)
