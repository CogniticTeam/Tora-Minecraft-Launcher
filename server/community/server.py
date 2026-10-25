"""Read-only community foundation; no AI, account, launcher or game services."""
import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

STARTED = time.monotonic()
SERVICE = "tora-community"


class CommunityHandler(BaseHTTPRequestHandler):
    server_version = "ToraCommunity/0.1"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def respond(self, status, body, head=False):
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not head:
            self.wfile.write(payload)

    def read(self, head=False):
        path = urlsplit(self.path).path
        if path not in ("/health", "/v1/community"):
            self.respond(404, {"error": "not_found"}, head)
            return
        expected = "Bearer " + self.server.gateway_token
        if not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
            self.respond(401, {"error": "unauthorized"}, head)
            return
        body = {"service": SERVICE, "version": "0.1.0", "backend": "dedicated-server"}
        if path == "/health":
            body.update(status="ok", uptime_seconds=int(time.monotonic() - STARTED))
        else:
            body.update(status="coming_soon", features={"posts": False, "comments": False, "likes": False})
        self.respond(200, body, head)

    def do_GET(self):
        self.read()

    def do_HEAD(self):
        self.read(True)

    def do_POST(self):
        self.respond(405, {"error": "read_only"})

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST

    def log_message(self, fmt, *args):
        # Do not log URLs, headers, credentials or user content.
        pass


def create_server(port=8765, token=None):
    token = token or os.environ.get("COMMUNITY_GATEWAY_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("COMMUNITY_GATEWAY_TOKEN must be configured")
    server = ThreadingHTTPServer(("127.0.0.1", port), CommunityHandler)
    server.gateway_token = token
    return server


if __name__ == "__main__":
    create_server(int(os.environ.get("PORT", "8765"))).serve_forever()
