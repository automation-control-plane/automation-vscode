"""Owned bootstrap dependency closure and real HTTP compatibility calls."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread


def test_bootstrap_uses_owned_http_and_no_vendor_common():
    root = Path(__file__).parents[2]
    import yaml
    for descriptor in (root / "bin/create_env").glob("conda*.yaml"):
        pip = next(value["pip"] for value in yaml.safe_load(descriptor.read_text())["dependencies"] if isinstance(value, dict) and "pip" in value)
        assert "actions-http-helper==1.0.3" in pip, descriptor
        assert not any(value.startswith(("sema4ai-http-helper", "sema4ai-common")) for value in pip), descriptor
    assert "sema4ai_http" not in (root / "src/sema4ai_code/data/data_server_connection.py").read_text()
    assert "sema4ai.common" not in (root / "src/sema4ai_code/_lint.py").read_text()


def test_owned_http_module_origin_and_real_local_login_query_upload(tmp_path, monkeypatch):
    import importlib.metadata
    import actions_http
    from sema4ai_code.data.data_server_connection import _HttpConnectionHelper

    assert importlib.metadata.version("actions-http-helper") == "1.0.3"
    assert Path(actions_http.__file__).parent.name == "actions_http"
    # No operator profile is read or changed in this synthetic loopback test.
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(actions_http._NetworkConfig, "_get_network_settings_path", staticmethod(lambda: tmp_path / "absent.yaml"))
    actions_http._get_connection_manager.cache_clear()
    received = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append((self.path, body, self.headers.get("Cookie")))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            if self.path == "/api/login": self.send_header("Set-Cookie", "session=synthetic; HttpOnly")
            self.end_headers()
            self.wfile.write(json.dumps({"type": "table", "column_names": ["value"], "data": [[7]]}).encode())
        def do_PUT(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            received.append((self.path, body, self.headers.get("Cookie")))
            self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        helper = _HttpConnectionHelper(f"http://127.0.0.1:{server.server_port}", "synthetic", "synthetic")
        assert helper.run_sql("SELECT 7", "test") == (["value"], [[7]])
        attachment = tmp_path / "input.txt"; attachment.write_text("synthetic attachment")
        helper.upload_file(attachment, "test")
        assert [r[0] for r in received] == ["/api/login", "/api/sql/query", "/api/files/test"]
        assert all(r[2] == "session=synthetic" for r in received[1:])
        assert b"synthetic attachment" in received[2][1]
    finally:
        server.shutdown(); server.server_close(); thread.join(); actions_http._get_connection_manager.cache_clear()
