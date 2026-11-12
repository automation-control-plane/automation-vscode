"""Inspect only a short-lived test-owned window, never operator applications."""
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid


def main():
    if sys.platform != "win32":
        raise RuntimeError("Native Windows required")
    import win32api
    import comtypes.client
    from sema4ai_code.inspector.windows.robocorp_windows import desktop

    title = "Owned Automation QA " + uuid.uuid4().hex
    # No shell, arbitrary app selection, or global desktop mutation.
    script = "import tkinter as t; r=t.Tk(); r.title(" + repr(title) + "); r.after(60000,r.destroy); r.mainloop()"
    child = subprocess.Popen([sys.executable, "-c", script], env=dict(os.environ),
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        window = desktop().find_window("name:" + title, timeout=15)
        if window is None or child.poll() is not None:
            raise RuntimeError("Test-owned Win32 window could not be inspected")
        if win32api.GetSystemMetrics(0) <= 0:
            raise RuntimeError("Native Windows desktop is unavailable")
        print(json.dumps({"native_win32": True, "comtypes_import": True,
                          "installed_windows_inspector_found_owned_window": True,
                          "scope": "One owned Tk/Win32 window; no Java or broad inspector acceptance"}))
    finally:
        if child.poll() is None:
            child.terminate()
        child.wait(timeout=15)


if __name__ == "__main__":
    main()
