"""Exercise the real web inspector on a synthetic loopback HTTP page."""

import argparse
import hashlib
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--extension-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    extension = Path(args.extension_root)
    sys.path.insert(0, str(extension / "src"))
    sys.path.insert(0, str(extension / "src/sema4ai_code/vendored"))
    from sema4ai_code.inspector.web._web_inspector import WebInspector
    from sema4ai_code.playwright import robocorp_browser

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    (output / "index.html").write_text(
        '<!doctype html><html><title>Published port web inspector smoke</title><body><h1>Synthetic inspector target</h1><p>This page is a local test target, not the VS Code extension UI.</p><button id="smoke-target">Inspect this button</button></body></html>'
    )
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(output))
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/index.html"
    inspector = WebInspector()
    try:
        page = inspector.open(url)
        assert page is not None
        page.screenshot(path=str(output / "web-inspector-original.png"))
        assert inspector.inject_picker("published smoke")
        assert inspector.is_picker_injected()
        found = []
        assert inspector.pick_async(found.append)
        page.click("#smoke-target")
        deadline = time.monotonic() + 10
        while not found and time.monotonic() < deadline:
            inspector.loop()
            page.wait_for_timeout(50)
        assert found, "Inspector did not return a picked locator"
        locator = found[0]
        inspector.stop_pick_async()
        assert locator["type"] == "browser"
        page.locator("#smoke-target").evaluate(
            "element => {element.style.outline='4px solid #d12c2c'; element.style.outlineOffset='6px';}"
        )
        page.screenshot(path=str(output / "web-inspector-boxed.png"))
        report = {
            "scope": "Real web inspector browser, picker injection and locator callback on a synthetic HTTP page; not Extension Host UI acceptance.",
            "url": url,
            "browser_version": page.context.browser.version,
            "locator": {k: v for k, v in locator.items() if k != "screenshot"},
            "screenshots": {
                name: hashlib.sha256((output / name).read_bytes()).hexdigest()
                for name in ("web-inspector-original.png", "web-inspector-boxed.png")
            },
        }
        (output / "result.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
    finally:
        inspector.close_browser()
        robocorp_browser.browser().close()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
