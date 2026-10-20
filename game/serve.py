# -*- coding: utf-8 -*-
"""The game's web server (start_game.bat): like "py -m http.server", but it tells the browser not to keep old copies
of the game's files - after an update a normal reload always gets the new game. Pictures are kept for a day."""
import http.server
import json
import os
import socketserver
import sys


IMAGES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")


def marks_text(data):
    """the marked routes, one route per line (easy to read and compare)"""
    out = []
    for k in sorted(data, key=lambda x: int(x) if str(x).lstrip("-").isdigit() else 0):
        m = data[k]
        head = {x: m[x] for x in m if x != "routes"}
        routes = m.get("routes") or []
        rl = ",\n".join("   " + json.dumps(r, separators=(",", ":")) for r in routes)
        out.append(" %s: %s, \"routes\": [\n%s\n  ]}" % (json.dumps(str(k)), json.dumps(head)[:-1], rl))
    return "{\n" + ",\n".join(out) + "\n}\n"


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.split("?")[0].lower().endswith(IMAGES):
            # pictures (portraits, icons, frames) are kept by the browser: a window that is drawn again does not have to
            # load them again (no flickering); they hardly ever change with an update
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):      # quiet: no line for every file
        pass

    def do_POST(self):
        """the route marker (game/routemarker.js) saves the dungeon routes marked by hand: gamedata/route_marks.json"""
        if self.path.split("?")[0] != "/save_route_marks":
            self.send_error(404); return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 20000000:
                raise ValueError("size")
            data = json.loads(self.rfile.read(n).decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("not an object")
            root = getattr(self, "directory", None) or os.getcwd()
            path = os.path.join(root, "gamedata", "route_marks.json")
            with open(path + ".tmp", "w", encoding="utf-8") as fh:
                fh.write(marks_text(data))
            os.replace(path + ".tmp", path)
            print("Saved the marked dungeon routes: %s" % path)
            body = b'{"ok":true}'
            self.send_response(200)
        except Exception as exc:
            body = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
            self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print("Game running at http://localhost:%d/game/  (close this window to stop it)" % port)
    Server(("", port), NoCache).serve_forever()


if __name__ == "__main__":
    main()
