"""Passive Railway readiness probe. No Instagram access, logins or background jobs."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        content = json.dumps({
            "status": "ready",
            "instagram_connection": "disabled",
            "follows": "disabled",
            "unfollows": "disabled",
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        self.send_error(405, "No write API in passive diagnostic service")

    def log_message(self, fmt, *args):
        # Do not print any request parameters or headers.
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid Railway port")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
