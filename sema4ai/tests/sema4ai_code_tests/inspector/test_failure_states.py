"""Failure transport regressions; no browser installation, network or native GUI."""
import threading

import pytest


class Endpoint:
    def __init__(self):
        self.events = []

    def notify(self, method, params):
        self.events.append((method, params))


def test_browser_creation_failure_is_preserved_without_reignite(monkeypatch):
    from sema4ai_code.inspector.web._web_inspector import WebInspector
    from sema4ai_code.playwright import robocorp_browser

    endpoint = Endpoint()
    attempts = []
    error = RuntimeError("Chromium 1169 missing; installation failed: ECONNREFUSED")

    def fail():
        attempts.append(1)
        raise error

    monkeypatch.setattr(robocorp_browser, "page", fail)
    monkeypatch.setattr(robocorp_browser, "browser", lambda: pytest.fail("Failure cleanup must not launch another browser"))
    inspector = WebInspector(endpoint=endpoint)
    with pytest.raises(RuntimeError) as caught:
        inspector.pick_async(lambda _: pytest.fail("Failed startup cannot pick a locator"))
    assert caught.value is error
    assert not inspector.picking
    assert inspector.page(False) is None
    assert endpoint.events[-1] == ("$/webInspectorState", {"state": "closed", "error": str(error)})
    assert not any(method == "$/webReigniteThread" for method, _ in endpoint.events)
    assert len(attempts) == 1
    # Another attempt occurs only because the caller explicitly requests it.
    with pytest.raises(RuntimeError):
        inspector.page(True)
    assert len(attempts) == 2


def test_failed_browser_worker_settles_request_and_can_be_retried_explicitly(monkeypatch):
    from sema4ai_code.inspector.inspector_api import _WebInspectorThread, _WebAsyncPickCommand
    from sema4ai_code.playwright import robocorp_browser
    from sema4ai_code.playwright.robocorp_browser._caches import session_cache

    endpoint = Endpoint()
    attempts = []
    cleaned = []

    @session_cache
    def driver():
        owner = threading.current_thread()
        yield object()
        cleaned.append((owner, threading.current_thread()))

    def fail():
        driver()
        attempts.append(threading.current_thread())
        raise RuntimeError("Browser executable missing")

    monkeypatch.setattr(robocorp_browser, "page", fail)
    monkeypatch.setattr(robocorp_browser, "browser", lambda: pytest.fail("Unexpected browser creation"))
    for expected in (1, 2):
        ended = threading.Event()
        worker = _WebInspectorThread(endpoint, {}, ended.set)
        command = _WebAsyncPickCommand(endpoint, "http://127.0.0.1/owned-test")
        worker.start()
        worker.queue.put(command)
        try:
            assert command.handled_event.wait(5)
            with pytest.raises(RuntimeError, match="Browser executable missing"):
                command.future.result(timeout=1)
            assert ended.wait(1)
            worker.join(2)
            assert not worker.is_alive()
            assert len(attempts) == expected
            assert len(cleaned) == expected
            assert cleaned[-1] == (worker, worker)
        finally:
            worker.shutdown()
            worker.join(2)


def test_image_escape_result_resets_state_without_emitting_a_snapshot(monkeypatch):
    from sema4ai_code.inspector.image._bridge import ImageBridge
    import subprocess

    class CancelledPicker:
        def communicate(self):
            return b'{"error":"Aborted by user"}', b""

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: CancelledPicker())
    endpoint = Endpoint()
    with pytest.raises(RuntimeError, match="Aborted by user"):
        ImageBridge(endpoint).pick()
    assert endpoint.events == [
        ("$/imageInspectorState", {"state": "initializing"}),
        ("$/imageInspectorState", {"state": "picking"}),
        ("$/imageInspectorState", {"state": "closed"}),
    ]


def test_real_playwright_missing_browser_retains_diagnostic_without_download(monkeypatch, tmp_path):
    """Real Playwright driver, deliberately empty task-owned cache; no GUI or network."""
    from playwright.sync_api import Error
    from sema4ai_code.inspector.web._web_inspector import WebInspector
    from sema4ai_code.playwright import robocorp_browser
    from sema4ai_code.playwright.robocorp_browser._caches import clear_all_callback
    from sema4ai_code.playwright.robocorp_browser import _context

    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path / "empty-browser-cache"))
    monkeypatch.delenv("AUTOMATION_BROWSER_EXECUTABLE", raising=False)
    monkeypatch.setattr(_context, "install_browser", lambda *args, **kwargs: pytest.fail("No browser download is authorized by this test"))
    endpoint = Endpoint()
    clear_all_callback()
    try:
        robocorp_browser.configure(headless=True, install=False, isolated=True)
        # The inherited _context has a separate launch configuration. Select
        # its existing no-install option too; do not change production defaults.
        _context._browser_config().install = False
        inspector = WebInspector(endpoint=endpoint)
        with pytest.raises(Error, match="Executable doesn't exist") as caught:
            inspector.page(True)
        assert str(tmp_path) in str(caught.value)
        assert endpoint.events[-1] == ("$/webInspectorState", {"state": "closed", "error": str(caught.value)})
        assert not inspector.picking
        assert not any(method == "$/webReigniteThread" for method, _ in endpoint.events)
    finally:
        clear_all_callback()


def test_browser_cache_cleanup_stays_on_its_own_worker():
    from sema4ai_code.playwright.robocorp_browser._caches import session_cache, clear_all_callback
    ready = [threading.Event(), threading.Event()]
    release = [threading.Event(), threading.Event()]
    closed = []
    failures = []

    @session_cache
    def resource(index):
        owner = threading.current_thread()
        yield object()
        closed.append((index, owner, threading.current_thread()))

    def run(index):
        try:
            resource(index)
            ready[index].set()
            assert release[index].wait(5)
            clear_all_callback()
        except BaseException as error:
            failures.append(error)

    workers = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for worker in workers:
        worker.start()
    try:
        assert all(event.wait(5) for event in ready)
        release[0].set(); workers[0].join(2)
        assert closed == [(0, workers[0], workers[0])]
        release[1].set(); workers[1].join(2)
        assert closed == [(0, workers[0], workers[0]), (1, workers[1], workers[1])]
        assert not failures
    finally:
        for event in release: event.set()
        for worker in workers: worker.join(2)


def test_old_worker_shutdown_is_idempotent():
    from sema4ai_code.inspector.inspector_api import _WebInspectorThread
    callbacks = []
    worker = _WebInspectorThread(Endpoint(), {}, lambda: callbacks.append("released"))
    worker.shutdown()
    worker.shutdown()
    assert callbacks == ["released"]


def test_configure_and_start_failures_cross_both_python_layers(monkeypatch):
    from io import BytesIO
    from types import SimpleNamespace
    from sema4ai_code.inspector.inspector_api import InspectorApi
    from sema4ai_code.inspector.inspector_language_server import InspectorLanguageServer
    from sema4ai_code.playwright import robocorp_browser

    api = InspectorApi(BytesIO(), BytesIO())
    requests = []
    def request(name, params):
        requests.append((name, params))
        method = api.m_browser_configure if name == "browserConfigure" else api.m_start_pick
        return {"jsonrpc": "2.0", "id": 1, "result": method(**params)}
    server = InspectorLanguageServer.__new__(InspectorLanguageServer)
    server._inspector_server_manager = SimpleNamespace(get_inspector_api_client=lambda: SimpleNamespace(send_sync_message=request))
    def fail(*args, **kwargs): raise RuntimeError("original engine failure")
    monkeypatch.setattr(robocorp_browser, "configure", fail)
    try:
        result = server.m_web_inspector_configure_browser()
        assert result == {"success": False, "message": "original engine failure", "result": None}
        assert requests[0][1]["wait"] is True
        monkeypatch.setattr(robocorp_browser, "configure", lambda **kwargs: None)
        assert server.m_web_inspector_configure_browser()["success"] is True
        monkeypatch.setattr(robocorp_browser, "page", fail)
        assert server.m_web_inspector_start_pick(url_if_new="http://127.0.0.1/owned")["message"] == "original engine failure"
    finally:
        api.m_kill_inspectors("browser")


@pytest.mark.parametrize("response", [None, {}, {"result": "invalid"}, {"error": {"message": "RPC failed"}}])
def test_web_rpc_invalid_or_error_response_fails_closed(response):
    from sema4ai_code.inspector.inspector_language_server import _web_command_result
    result = _web_command_result(response)
    assert result["success"] is False
    assert result["message"]
    if response and "error" in response:
        assert result["message"] == "RPC failed"


@pytest.mark.parametrize('engine', ['chromium', 'chrome', 'msedge', 'firefox', 'webkit'])
def test_inspector_launch_options_enable_chromium_sandbox(monkeypatch, engine):
    from sema4ai_code.playwright.robocorp_browser import _context
    from sema4ai_code.playwright.robocorp_browser._caches import clear_all_callback
    from types import SimpleNamespace
    clear_all_callback()
    monkeypatch.delenv('AUTOMATION_BROWSER_EXECUTABLE', raising=False)
    calls = []
    monkeypatch.setattr(_context, '_browser_type', lambda: SimpleNamespace(launch=lambda **kw: calls.append(kw)))
    try:
        _context._browser_config().browser_engine = engine
        _context._browser_launcher()(headless=True)
        assert calls[0].get('chromium_sandbox') is (True if engine in ('chromium', 'chrome', 'msedge') else None)
    finally:
        clear_all_callback()


def test_launch_failure_does_not_download_or_retry_sandbox_error(monkeypatch):
    from playwright.sync_api import Error
    from sema4ai_code.playwright.robocorp_browser import _context
    from sema4ai_code.playwright.robocorp_browser._caches import clear_all_callback
    clear_all_callback()
    attempts, installs = [], []
    error = Error('The SUID sandbox helper binary was found, but is not configured correctly')
    def launch(**kwargs):
        attempts.append(kwargs)
        raise error
    monkeypatch.setattr(_context, '_browser_launcher', lambda: launch)
    monkeypatch.setattr(_context, 'install_browser', lambda *args: installs.append(args))
    try:
        with pytest.raises(Error) as caught:
            _context.browser()
        assert caught.value is error
        assert installs == []
        assert len(attempts) == 1
    finally:
        clear_all_callback()


def test_missing_managed_browser_still_installs_once(monkeypatch):
    from playwright.sync_api import Error
    from sema4ai_code.playwright.robocorp_browser import _context
    from sema4ai_code.playwright.robocorp_browser._caches import clear_all_callback
    from types import SimpleNamespace
    clear_all_callback()
    monkeypatch.delenv('AUTOMATION_BROWSER_EXECUTABLE', raising=False)
    attempts, installs = [], []
    expected = SimpleNamespace(close=lambda: None)
    def launch(**kwargs):
        attempts.append(kwargs)
        if len(attempts) == 1:
            raise Error("Executable doesn't exist at /synthetic/playwright/chrome")
        return expected
    monkeypatch.setattr(_context, '_browser_launcher', lambda: launch)
    monkeypatch.setattr(_context, 'install_browser', lambda *args: installs.append(args))
    try:
        assert _context.browser() is expected
        assert len(installs) == 1
        assert len(attempts) == 2
    finally:
        clear_all_callback()


@pytest.mark.parametrize('override', ['environment', 'keyword'])
def test_missing_explicit_browser_does_not_install_a_substitute(monkeypatch, override):
    from playwright.sync_api import Error
    from sema4ai_code.playwright.robocorp_browser import _context
    from sema4ai_code.playwright.robocorp_browser._caches import clear_all_callback
    clear_all_callback()
    monkeypatch.delenv('AUTOMATION_BROWSER_EXECUTABLE', raising=False)
    if override == 'environment':
        monkeypatch.setenv('AUTOMATION_BROWSER_EXECUTABLE', '/synthetic/operator/browser')
    def launch(**kwargs):
        raise Error("Executable doesn't exist at /synthetic/operator/browser")
    monkeypatch.setattr(_context, '_browser_launcher', lambda: launch)
    monkeypatch.setattr(_context, 'install_browser', lambda *args: pytest.fail('Explicit paths must not trigger substitute installs'))
    try:
        with pytest.raises(Error, match="Executable doesn't exist"):
            _context.browser(**({'executable_path':'/synthetic/operator/browser'} if override == 'keyword' else {}))
    finally:
        clear_all_callback()
