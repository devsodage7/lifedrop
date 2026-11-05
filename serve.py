"""
LifeDrop+ — local dev server (no dependencies).

    python serve.py          -> http://localhost:5174
    python serve.py 8000     -> custom port

For testing on this laptop / a phone on the same WiFi.
For real use, deploy the folder with `wrangler deploy`.
"""

import sys
import os
import http.server
import socketserver

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5174
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"\n  LifeDrop+ running:  http://localhost:{PORT}")
        print(f"  Folder:             {ROOT}")
        print("  Phone (same WiFi):  http://<this-pc-ip>:%d\n" % PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  stopped.")
