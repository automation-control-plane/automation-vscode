"""Verify installed launch arguments with a real Playwright driver and a recorder.

Linux only. No Chromium browser, GUI, browser download or system change. The
operator browser override is a task-owned argv recorder, not a substitute browser.
This proves generated flags and failure/cleanup, not successful sandbox execution.
"""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extension-root', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = Path(args.extension_root).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    sys.path[:0] = [str(root / 'src'), str(root / 'src/sema4ai_code/vendored')]
    from sema4ai_code.inspector.web._web_inspector import WebInspector
    from sema4ai_code.playwright.robocorp_browser import _context
    from sema4ai_code.playwright.robocorp_browser._caches import clear_all_callback
    from playwright.sync_api import Error

    recorder = output / 'record-launch'
    recorded = output / 'launch-arguments.jsonl'
    recorder.write_text('#!' + sys.executable + '\nimport json,sys\nfrom pathlib import Path\n'
                        + 'with Path(' + repr(str(recorded)) + ').open("a") as stream:\n'
                        + ' stream.write(json.dumps(sys.argv[1:])+"\\n")\n', encoding='utf-8')
    recorder.chmod(0o700)
    os.environ['AUTOMATION_BROWSER_EXECUTABLE'] = str(recorder)
    class Endpoint:
        events = []
        def notify(self, method, params):
            self.events.append({'method': method, 'params': params})
    def reject_install(*args, **kwargs):
        raise AssertionError('A launch failure must not download a browser')
    _context.install_browser = reject_install
    endpoint = Endpoint()
    inspector = WebInspector(endpoint=endpoint)
    driver = None
    try:
        driver = _context.playwright()._impl_obj._connection._transport._proc
        inspector.page(True)
        raise AssertionError('The recorder must not act as a browser')
    except Error as error:
        engine_error = str(error)
    finally:
        clear_all_callback()
    attempts = [json.loads(line) for line in recorded.read_text().splitlines()]
    assert len(attempts) == 1, attempts
    assert '--no-sandbox' not in attempts[0]
    assert not any(arg.startswith('--disable-') and 'sandbox' in arg for arg in attempts[0])
    assert driver is not None and driver.returncode is not None, 'Driver was not stopped'
    assert endpoint.events[-1]['params']['error'] == engine_error
    report = {'scope': __doc__, 'extension_root': str(root),
              'playwright': importlib.metadata.version('playwright'),
              'launch_attempts': len(attempts), 'arguments': attempts[0],
              'chromium_sandbox_requested': _context.browser_type_launch_args().get('chromium_sandbox'),
              'driver_pid': driver.pid, 'driver_exit_code': driver.returncode,
              'events': endpoint.events}
    clear_all_callback()
    assert report['chromium_sandbox_requested'] is True
    (output / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({key: value for key, value in report.items() if key not in ('events', 'arguments')}, indent=2))


if __name__ == '__main__':
    main()
