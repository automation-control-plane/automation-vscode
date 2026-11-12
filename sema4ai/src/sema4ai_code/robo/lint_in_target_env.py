import json
import sys
from typing import Any


def main() -> None:
    contents_to_lint: bytes = sys.stdin.buffer.read()
    import importlib

    try:
        try:
            from .action_runtime import ActionSDKError, load_actions
        except ImportError:
            from action_runtime import ActionSDKError, load_actions
        try:
            actions, _ = load_actions()
        except ActionSDKError as error:
            print(json.dumps([{
                "range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1}},
                "severity": 1, "source": "Automation", "message": str(error),
            }]))
            return
        prefix = actions.__name__
        _lint_action = importlib.import_module(prefix + "._lint_action")
        requires_pm = True
        pm = None
        try:
            EPManagedParameters = importlib.import_module(
                prefix + "._customization._extension_points"
            ).EPManagedParameters
            PluginManager = importlib.import_module(
                prefix + "._customization._plugin_manager"
            ).PluginManager
            ManagedParameters = importlib.import_module(
                prefix + "._managed_parameters"
            ).ManagedParameters
            pm = PluginManager()
            pm.set_instance(EPManagedParameters, ManagedParameters({}))
        except ImportError:
            requires_pm = False
    except ImportError:
        return

    if requires_pm:
        try:
            errors = list(_lint_action.iter_lint_errors(contents_to_lint, pm=pm))
        except BaseException:
            return
    else:
        try:
            errors = list(_lint_action.iter_lint_errors(contents_to_lint))
        except BaseException:
            return

    lst = []
    for error in errors:
        lsp_err = error.to_lsp_diagnostic()
        lsp_err["range"]["start"]["line"] -= 1
        lsp_err["range"]["end"]["line"] -= 1
        lst.append(lsp_err)

    print(json.dumps(lst))


if __name__ == "__main__":
    main()
