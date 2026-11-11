"""Local server for the Kaizen website (tests and icon generation).

Usage (from the kaizen-web folder):  python tools/dev_server.py
- http://127.0.0.1:8767/            the site
- http://127.0.0.1:8767/tests/      automated tests
- http://127.0.0.1:8767/tools/icons.html   regenerates icons/ (PNG files posted back here)
"""

import http.server
import os
import pathlib
import socketserver

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        name = os.path.basename(self.path.split("?")[0])
        if not name.endswith(".png"):
            self.send_response(400)
            self.end_headers()
            return
        data = self.rfile.read(int(self.headers["Content-Length"]))
        (ROOT / "icons" / name).write_bytes(data)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")


if __name__ == "__main__":
    (ROOT / "icons").mkdir(exist_ok=True)
    with socketserver.TCPServer(("127.0.0.1", 8767), Handler) as httpd:
        print("http://127.0.0.1:8767/")
        httpd.serve_forever()
