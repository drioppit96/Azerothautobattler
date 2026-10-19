# -*- coding: utf-8 -*-
"""The game's web server (start_game.bat): like "py -m http.server", but it tells the browser not to keep old copies
of the game's files - after an update a normal reload always gets the new game. Pictures are kept for a day."""
import http.server
import socketserver
import sys


IMAGES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")


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


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print("Game running at http://localhost:%d/game/  (close this window to stop it)" % port)
    Server(("", port), NoCache).serve_forever()


if __name__ == "__main__":
    main()
