"""make_wall_kit.py - the drawing kit for the dungeon walls: every floor of every dungeon and raid as a PNG to draw the
walls on (dungeon_walls/<nn> <name>/floor <n>.png) and a reference picture beside it with the creatures, the bosses
and the way in (dungeon_walls/<nn> <name>/reference/floor <n>.png).

    py make_wall_kit.py            (makes only the missing files - drawings already started are never overwritten)

Drawn walls are read back by read_walls.py (pure red lines = walls).
"""
import json, os, re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "dungeon_walls")


def floor_at(d, x, y, z):
    best, bs = None, -1e9
    for f in d["floors"]:
        if x > f["xt"] or x < f["xb"] or y > f["yl"] or y < f["yr"]:
            continue
        banded = f["z0"] > -9999 or f["z1"] < 999999
        if z is not None and banded:
            s = 100 if f["z0"] <= z <= f["z1"] else -min(abs(z - f["z0"]), abs(z - f["z1"]))
        else:
            s = 10
        if s > bs:
            bs, best = s, f
    return best


def safe(n):
    return re.sub(r'[\\/:*?"<>|]', "", n).strip()


def main():
    dg = json.load(open(os.path.join(ROOT, "gamedata", "dungeons.json"), encoding="utf-8"))["dungeons"]
    sp = json.load(open(os.path.join(ROOT, "gamedata", "spawns.json"), encoding="utf-8"))["spawns"]
    by_map = {}
    for lst in sp.values():
        for p in lst:
            by_map.setdefault(p[0], []).append((p[1], p[2], p[3]))
    try:
        font = ImageFont.truetype("arial.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    dg = sorted(dg, key=lambda d: (d["kind"] != "dungeon", d["lmin"], d["name"]))
    lines = []
    for k, d in enumerate(dg, 1):
        folder = os.path.join(OUT, "%02d %s" % (k, safe(d["name"])))
        os.makedirs(os.path.join(folder, "reference"), exist_ok=True)
        for f in d["floors"]:
            src = os.path.join(ROOT, f["file"].replace("/", os.sep))
            if not os.path.exists(src):
                continue
            label = "floor %d" % f["n"] + (" - " + safe(f["name"]) if f["name"] else "")
            img = Image.open(src).convert("RGB")
            W, H = img.size
            draw_path = os.path.join(folder, label + ".png")
            if not os.path.exists(draw_path):
                img.save(draw_path, optimize=True)
            # the reference: creatures (cyan), bosses (yellow), the way in (green)
            ref = img.copy()
            dr = ImageDraw.Draw(ref)

            def px(x, y):
                return ((f["yl"] - y) / (f["yl"] - f["yr"]) * W, (f["xt"] - x) / (f["xt"] - f["xb"]) * H)
            n = 0
            for x, y, z in by_map.get(d["map"], []):
                if floor_at(d, x, y, z) is not f:
                    continue
                u, v = px(x, y)
                dr.ellipse((u - 3, v - 3, u + 3, v + 3), fill=(0, 220, 255), outline=(0, 0, 0))
                n += 1
            for b in d.get("bosses", []):
                if floor_at(d, b["x"], b["y"], b.get("z")) is not f:
                    continue
                u, v = px(b["x"], b["y"])
                dr.ellipse((u - 7, v - 7, u + 7, v + 7), fill=(255, 215, 0), outline=(0, 0, 0), width=2)
                dr.text((u + 9, v - 8), b["n"], fill=(255, 235, 120), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
            for e in d.get("enter", []):
                if floor_at(d, e["x"], e["y"], e.get("z")) is not f:
                    continue
                u, v = px(e["x"], e["y"])
                dr.ellipse((u - 8, v - 8, u + 8, v + 8), outline=(40, 255, 80), width=3)
                dr.text((u + 10, v - 8), "Entrance", fill=(120, 255, 140), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
            dr.text((8, H - 20), "cyan = creatures   yellow = bosses   green = the way in   (draw on the picture one folder up, not on this one)",
                    fill=(230, 230, 230), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
            ref.save(os.path.join(folder, "reference", label + ".jpg"), quality=88)
            lines.append("[ ] %02d %s / %s   (%d creatures)" % (k, d["name"], label, n))
    ck = os.path.join(OUT, "CHECKLIST.txt")
    if not os.path.exists(ck):
        with open(ck, "w", encoding="utf-8") as fh:
            fh.write("Dungeon walls - put an x in the box when a floor is done: [x]\n\n" + "\n".join(lines) + "\n")
    with open(os.path.join(OUT, "HOW_TO_DRAW.txt"), "w", encoding="utf-8") as fh:
        fh.write(HOW_TO)
    print("%d floors in %s" % (len(lines), OUT))


HOW_TO = r"""HOW TO DRAW THE DUNGEON WALLS
==============================

Every dungeon has a folder. In it:
   floor 1.png, floor 2.png ...   <- draw on these
   reference\floor 1.jpg ...      <- the same map with the creatures (cyan), bosses (yellow) and the way in (green).
                                     Creatures stand on ground you can walk on - it helps to see where the paths are.

1. Open "floor N.png" with Paint (right click - Edit).
2. Pick PURE RED: Edit colors - Red 255, Green 0, Blue 0.
3. Draw the walls with the Line tool (or the Pencil), 2 or 3 pixels wide:
   - along both sides of every corridor and around every room, where the walkable floor ends;
   - also along cliffs, chasms, lava and deep water edges that a character must not walk over;
   - NO GAPS: a gap in a wall is a way through. Close the lines into each other.
   - Open doorways stay open (do not draw across them).
   - Things you can walk over (bridges, ramps) stay open too.
4. Save with Ctrl+S - keep the name and keep PNG (never save as JPG: it smears the red).
5. Put an x in CHECKLIST.txt: [x]

Only pure red counts as a wall, everything else in the picture is ignored, so you can draw on the map directly.
Half done floors are fine - send what you have.

SENDING THEM
   Double-click  script\send_walls.bat  - it uploads the floors that have red lines on them to GitHub.
   Then tell Claude, and the walls go into the game.
   (update_from_github.bat keeps your drawings - it saves this folder before updating and puts it back.)
"""


if __name__ == "__main__":
    main()
