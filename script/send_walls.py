"""send_walls.py - uploads the dungeon floors with walls drawn on them (pure red lines) to GitHub, so Claude can read them.
Double-click send_walls.bat (same folder)."""
import os, subprocess, sys
from PIL import Image
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
WALLS = os.path.join(ROOT, "dungeon_walls")


def red_count(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    return int(((a[..., 0] >= 220) & (a[..., 1] <= 40) & (a[..., 2] <= 40)).sum())


def git(*args, check=True):
    print("> git " + " ".join(args))
    r = subprocess.run(["git"] + list(args), cwd=ROOT)
    if check and r.returncode:
        print("FAILED - send a screenshot of this window to Claude.")
        sys.exit(1)
    return r.returncode


def main():
    if not os.path.isdir(WALLS):
        print("There is no dungeon_walls folder yet - double-click make_wall_kit.bat first.")
        return
    drawn = []
    for d in sorted(os.listdir(WALLS)):
        fd = os.path.join(WALLS, d)
        if not os.path.isdir(fd):
            continue
        for f in sorted(os.listdir(fd)):
            if f.lower().endswith(".png") and red_count(os.path.join(fd, f)) > 30:
                drawn.append(os.path.join("dungeon_walls", d, f))
    if not drawn:
        print("No floor has red lines on it yet.")
        return
    print("Floors with walls drawn:")
    for p in drawn:
        print("   " + p)
    if subprocess.run(["git", "config", "user.name"], cwd=ROOT, capture_output=True).returncode:
        git("config", "user.name", "auto-battler")
        git("config", "user.email", "auto-battler@localhost")
    for p in drawn:
        git("add", "--", p)
    ck = os.path.join("dungeon_walls", "CHECKLIST.txt")
    if os.path.exists(os.path.join(ROOT, ck)):
        git("add", "--", ck)
    if git("diff", "--cached", "--quiet", check=False) == 0:
        print("Nothing new since the last time - all of these are on GitHub already.")
        return
    git("commit", "-q", "-m", "Dungeon walls: %d floors" % len(drawn))
    git("pull", "--rebase", "--autostash", "-q", "origin", "main")
    git("push", "-q", "origin", "HEAD:main")
    print("\nSent. Tell Claude the walls are on GitHub.")


if __name__ == "__main__":
    main()
