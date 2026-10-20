# -*- coding: utf-8 -*-
"""
Puts the whole game into the Android app (android_app/): the same folders as "C:\\wow excel" (game, gamedata, maps,
maps_dungeon, maps_hd, icons, the portraits, the UI pictures the game uses), made smaller for a phone:
  - the zone maps are stored as JPEG (under their .png names - the web view reads the picture, not the name)
  - the creature portraits are 96 x 96 JPEG
  - files.json lists the maps and portraits (an app has no folder listing)
The APK itself is built by GitHub Actions (.github/workflows/android.yml): it runs this script, then Gradle.

Run:   py make_android.py [--root "C:\\wow excel"] [--out android_app/app/src/main/assets/www]
"""
import io
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
UI_DIRS = ["CharacterFrame", "TargetingFrame", "composed", "PetPaperDollFrame"]
SKIP_GAME = {"serve.py", "start_game.bat", "__pycache__"}
SKIP_DATA = {"talent_trees.html"}


def log(m):
    print(str(m).encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def copy_tree(src, dst, skip=()):
    os.makedirs(dst, exist_ok=True)
    n = 0
    for name in os.listdir(src):
        if name in skip:
            continue
        s, d = os.path.join(src, name), os.path.join(dst, name)
        if os.path.isdir(s):
            n += copy_tree(s, d, skip)
        else:
            shutil.copy2(s, d); n += 1
    return n


def as_jpeg(src, dst, size=None, q=85):
    from PIL import Image
    im = Image.open(src).convert("RGB")
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=q, optimize=True)
    data = buf.getvalue()
    if not size and os.path.getsize(src) <= len(data):      # already small: keep the original
        shutil.copy2(src, dst); return
    with open(dst, "wb") as f:
        f.write(data)


def main():
    args = sys.argv[1:]
    root = args[args.index("--root") + 1] if "--root" in args else ROOT
    out = args[args.index("--out") + 1] if "--out" in args else os.path.join(root, "android_app", "app", "src", "main", "assets", "www")
    root, out = os.path.abspath(root), os.path.abspath(out)
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    log("game files: %d" % copy_tree(os.path.join(root, "game"), os.path.join(out, "game"), SKIP_GAME))
    log("game data: %d" % copy_tree(os.path.join(root, "gamedata"), os.path.join(out, "gamedata"), SKIP_DATA))
    for d in ("maps_dungeon", "maps_hd", "icons"):
        if os.path.isdir(os.path.join(root, d)):
            log("%s: %d" % (d, copy_tree(os.path.join(root, d), os.path.join(out, d))))
    for d in UI_DIRS:
        if os.path.isdir(os.path.join(root, "ui", d)):
            copy_tree(os.path.join(root, "ui", d), os.path.join(out, "ui", d))
    # zone maps: JPEG under the same names
    maps = sorted(f for f in os.listdir(os.path.join(root, "maps")) if f.lower().endswith(".png"))
    os.makedirs(os.path.join(out, "maps"), exist_ok=True)
    for f in maps:
        as_jpeg(os.path.join(root, "maps", f), os.path.join(out, "maps", f), q=88)
    log("maps: %d" % len(maps))
    # portraits: small
    src = os.path.join(root, "portraits", "by_name"); dst = os.path.join(out, "portraits", "by_name"); os.makedirs(dst, exist_ok=True)
    por = sorted(f for f in os.listdir(src) if f.lower().endswith(".png"))
    for i, f in enumerate(por):
        as_jpeg(os.path.join(src, f), os.path.join(dst, f), size=96, q=82)
        if i % 2000 == 0:
            log("  portraits %d / %d" % (i, len(por)))
    log("portraits: %d" % len(por))
    hd = sorted(f for f in os.listdir(os.path.join(root, "maps_hd")) if f.lower().endswith((".jpg", ".png", ".webp"))) if os.path.isdir(os.path.join(root, "maps_hd")) else []
    with open(os.path.join(out, "files.json"), "w", encoding="utf-8") as f:
        json.dump({"maps": maps, "portraits": por, "maps_hd": hd}, f)
    total = sum(os.path.getsize(os.path.join(a, b)) for a, _, fs in os.walk(out) for b in fs)
    log("written: %s (%.0f MB)" % (out, total / 1e6))


if __name__ == "__main__":
    main()
