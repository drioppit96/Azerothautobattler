# -*- coding: utf-8 -*-
"""
Makes a SMALL zip of your game data so it can be checked:  C:\\wow excel\\sample_for_check.zip
Big lists are cut to their first entries (plus a few well known mobs/spells/items kept on purpose).
Run:  py make_sample.py
"""
import json
import os
import zipfile

OUT = r"C:\wow excel"
GD = os.path.join(OUT, "gamedata")
KEEP = ["Fireball", "Heroic Strike", "Corruption", "Rejuvenation", "Frostbolt", "Immolate", "Sinister Strike",
        "Stormwind City Guard", "Orgrimmar Grunt", "Mangy Wolf", "Young Wolf", "Forest Spider", "Defias Bandit",
        "Cloth", "Linen Cloth", "Worn Shortsword", "of the Monkey", "Dungar Longdrink", "Goldshire", "Boar"]
LIMIT = 25


def hit(v):
    try:
        t = json.dumps(v)
    except Exception:
        return False
    if len(t) > 4000:
        return False
    return any(k in t for k in KEEP)


def trim(o, depth=0):
    if isinstance(o, dict):
        out = {}
        for i, (k, v) in enumerate(o.items()):
            if len(o) <= LIMIT * 2 or i < LIMIT or hit(v):
                out[k] = trim(v, depth + 1) if depth < 4 else v
        if len(out) < len(o):
            out["_trimmed"] = "%d of %d entries" % (len(out), len(o))
        return out
    if isinstance(o, list):
        if len(o) > LIMIT * 2:
            keep = o[:LIMIT] + [x for x in o[LIMIT:] if hit(x)][:15]
            return [trim(x, depth + 1) if depth < 4 else x for x in keep] + ["... %d items in total" % len(o)]
        return [trim(x, depth + 1) if depth < 4 else x for x in o]
    return o


def main():
    path = os.path.join(OUT, "sample_for_check.zip")
    z = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
    n = 0
    for f in sorted(os.listdir(GD)):
        p = os.path.join(GD, f)
        if f.endswith(".json"):
            try:
                data = json.load(open(p))
            except Exception as exc:
                print("skip %s (%s)" % (f, exc))
                continue
            z.writestr(f, json.dumps(trim(data), separators=(",", ":")))
            n += 1
        elif f.endswith(".js") or f == "navgrid_meta.json":
            z.write(p, f)
    z.close()
    print("Wrote %s (%d KB, %d json files)" % (path, os.path.getsize(path) // 1024, n))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
    input("\nPress Enter to close this window...")
