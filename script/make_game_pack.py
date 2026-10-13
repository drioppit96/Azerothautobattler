# -*- coding: utf-8 -*-
"""
Collects everything the game needs for the first stage into ONE zip:
    C:\\wow excel\\game_pack.zip

Contains: all gamedata\\*.json and *.js, the Durotar / Orgrimmar / Barrens / Kalimdor maps,
the DBC files that give the map coordinates, the Kalimdor collision grid (if you made it),
portraits of the creatures of Durotar, Orgrimmar and The Barrens, and all item/spell icons.

Run:   py make_game_pack.py
       py make_game_pack.py nogrid      (leave the collision grid out)
       py make_game_pack.py noicons     (leave the icons out)
It prints the size of every group, so you can see what makes the zip big.
If the zip is over ~100 MB, run again with  noicons  and send the icons separately.
"""
import json
import os
import re
import sys
import traceback
import zipfile

ROOT = r"C:\wow excel"
MAPS = ("Durotar", "Orgrimmar", "The Barrens", "Kalimdor")
DBCS = ("WorldMapArea", "AreaTable", "Map", "ChrRaces", "ChrClasses")
PORTRAIT_ZONES = ("Durotar", "Orgrimmar", "The Barrens")


def main():
    nogrid = "nogrid" in sys.argv
    noicons = "noicons" in sys.argv
    out = os.path.join(ROOT, "game_pack.zip")
    if os.path.exists(out):
        os.remove(out)
    z = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
    sizes = {}

    def add(path, arc, group):
        if not os.path.isfile(path):
            return False
        ext = os.path.splitext(path)[1].lower()
        z.write(path, arc.replace("\\", "/"), zipfile.ZIP_STORED if ext in (".png", ".jpg", ".gz") else zipfile.ZIP_DEFLATED)
        sizes[group] = sizes.get(group, 0) + os.path.getsize(path)
        return True

    gd = os.path.join(ROOT, "gamedata")
    for f in sorted(os.listdir(gd)):
        p = os.path.join(gd, f)
        if os.path.isfile(p) and (f.endswith(".json") or f.endswith(".js")):
            add(p, "gamedata/" + f, "gamedata json/js")
        elif f.endswith(".bin.gz") and not nogrid and "Kalimdor" in f:
            add(p, "gamedata/" + f, "collision grid")
    md = os.path.join(ROOT, "maps")
    if os.path.isdir(md):
        for f in sorted(os.listdir(md)):
            base = os.path.splitext(f)[0]
            if f.lower().endswith(".png") and any(base == m or base.startswith(m + " (") for m in MAPS):
                add(os.path.join(md, f), "maps/" + f, "maps")
    for n in DBCS:
        add(os.path.join(ROOT, "dbc", n + ".dbc"), "dbc/%s.dbc" % n, "dbc")

    # portraits of the creatures that live in the starting zones
    pdir = os.path.join(ROOT, "portraits", "by_name")
    try:
        sp = json.load(open(os.path.join(gd, "spawns.json")))
        places = sp["places"]
        wanted = set()
        for entry, lst in sp["spawns"].items():
            for s in lst:
                if s[0] == 1 and 0 <= s[5] < len(places) and places[s[5]] in PORTRAIT_ZONES:
                    wanted.add(int(entry))
                    break
        if os.path.isdir(pdir):
            for f in sorted(os.listdir(pdir)):
                m = re.match(r"^(\d+)_", f)
                if m and int(m.group(1)) in wanted:
                    add(os.path.join(pdir, f), "portraits/by_name/" + f, "portraits")
        print("creatures wanted for portraits: %d" % len(wanted))
    except Exception:
        traceback.print_exc()
    if not noicons:
        idir = os.path.join(ROOT, "icons")
        if os.path.isdir(idir):
            for f in sorted(os.listdir(idir)):
                add(os.path.join(idir, f), "icons/" + f, "icons")
    z.close()
    for k, v in sizes.items():
        print("%-18s %8.1f MB" % (k, v / 1048576.0))
    print("\nWrote %s  (%.1f MB)" % (out, os.path.getsize(out) / 1048576.0))
    if os.path.getsize(out) > 100 * 1048576:
        print("It is big. Run again with:  py make_game_pack.py noicons")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
    input("\nPress Enter to close this window...")
