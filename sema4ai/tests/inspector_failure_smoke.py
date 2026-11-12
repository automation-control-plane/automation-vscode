"""Real installed Inspector/Playwright failure and cleanup; no downloads or GUI."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import threading


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--extension-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    extension = Path(args.extension_root).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    sys.path[:0] = [str(extension / "src"), str(extension / "src/sema4ai_code/vendored")]
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(output / "empty-browser-cache")
    os.environ.pop("AUTOMATION_BROWSER_EXECUTABLE", None)
    from sema4ai_code.inspector.inspector_api import _WebBaseCommand, _WebInspectorThread
    from sema4ai_code.playwright.robocorp_browser import _context

    events, driver_pids, results = [], [], []
    original = _context.sync_playwright

    class ObservedManager:
        def start(self):
            playwright = original().start()
            driver_pids.append(playwright._impl_obj._connection._transport._proc.pid)
            return playwright

    _context.sync_playwright = ObservedManager

    def forbidden_download(*args, **kwargs):
        raise AssertionError("This negative smoke does not authorize browser downloads")
    _context.install_browser = forbidden_download

    class Endpoint:
        def notify(self, method, params):
            events.append({"method": method, "params": params})

    class Attempt(_WebBaseCommand):
        def __call__(self, worker):
            # Select the inherited launcher's no-install option in this test
            # worker only. Production settings/defaults remain unchanged.
            _context._browser_config().install = False
            worker.web_inspector.page(True)

    for attempt in (1, 2):
        stopped = threading.Event()
        worker = _WebInspectorThread(Endpoint(), {}, stopped.set)
        command = Attempt()
        worker.start()
        worker.queue.put(command)
        try:
            assert command.handled_event.wait(15), "Inspector did not finish"
            error = command.future.exception(timeout=1)
            assert error is not None and "Executable doesn't exist" in str(error), str(error)
            assert str(output / "empty-browser-cache") in str(error)
            assert stopped.wait(2)
            worker.join(5)
            assert not worker.is_alive(), "Failed worker stayed alive"
            assert len(driver_pids) == attempt, "Unexpected automatic retry"
            pid = driver_pids[-1]
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                pass
            else:
                raise AssertionError(f"Owned Playwright driver {pid} survived worker cleanup")
            assert events[-1] == {"method": "$/webInspectorState", "params": {"state": "closed", "error": str(error)}}
            assert not any(event["method"] == "$/webReigniteThread" for event in events)
            results.append({"explicit_attempt": attempt, "driver_pid": pid, "driver_exited": True, "error": str(error)})
        finally:
            worker.shutdown()
            worker.join(5)
    report = {"extension": str(extension), "extension_version": json.loads((extension / "package.json").read_text())["version"],
        "python": sys.executable, "python_version": sys.version, "playwright": importlib.metadata.version("playwright"),
        "scope": "Real installed Python Inspector worker and Playwright driver; intentionally absent browser, downloads disabled. No native VS Code or Chromium GUI acceptance.",
        "results": results, "notifications": events}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
