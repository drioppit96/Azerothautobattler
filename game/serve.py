# -*- coding: utf-8 -*-
"""The game's web server (start_game.bat): like "py -m http.server", but it tells the browser not to keep old copies
of the files - after an update a normal reload always gets the new game."""
import http.server
import socketserver
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
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
