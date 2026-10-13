# -*- coding: utf-8 -*-
"""
Zone maps for clicking on the continent maps: which zone every spot of Kalimdor and the Eastern Kingdoms
belongs to (from the terrain area ids the other scripts already read, adt_area_cache.pkl).

Writes  C:\\wow excel\\gamedata\\zonemap_Kalimdor.png, zonemap_Azeroth.png   (1024 x 1024, pixel value = zone index)
        C:\\wow excel\\gamedata\\zonemap.json                                (index -> zone id / name)
One pixel = one terrain chunk (33.3 yards). Spots never read from the terrain are filled from the nearest
known spot, and from creature spawns.

Run:  py make_zonemap.py            (needs dbc\\AreaTable.dbc, adt_area_cache.pkl, gamedata\\spawns.json, Pillow)
"""
import json
import math
import os
import pickle
import struct
import sys

ROOT = r"C:\wow excel"
TILE = 533.33333
ORIGIN = 17066.66656
CHUNK = TILE / 16
N = 1024
MAPS = {0: "Azeroth", 1: "Kalimdor"}


def log(m):
    print(str(m).encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def read_dbc(path):
    data = open(path, "rb").read()
    n, f, rs, ss = struct.unpack_from("<4I", data, 4)
    rows = [struct.unpack_from("<%dI" % f, data, 20 + i * rs) for i in range(n)]
    strings = data[20 + n * rs:]

    def s(o):
        if o >= len(strings):
            return ""
        e = strings.find(b"\0", o)
        return strings[o:e].decode("utf-8", "replace")
    return rows, s


def fill_land(root, mname, grid):
    """spread the known zones over all land (land = the collision grid has ground there), nearest first"""
    import numpy as np
    g = np.array(grid, dtype=np.int32)
    land = None
    path = os.path.join(root, "gamedata", "navgrid_%s.bin.gz" % mname)
    if os.path.isfile(path):
        import gzip
        raw = gzip.open(path, "rb").read()
        w, h = struct.unpack_from("<HH", raw, 4)
        nav = np.frombuffer(raw, dtype=np.uint8, offset=16).reshape(h, w)
        k = w // N
        codes = nav[:N * k, :N * k].reshape(N, k, N, k)
        land = ((codes == 1) | (codes == 3) | (codes == 4) | (codes == 5) | (codes == 6)).any(axis=(1, 3))
        log("  land from the collision grid: %d chunks" % int(land.sum()))
    else:
        log("  no collision grid - filling only 6 chunks around known spots")
    for it in range(400 if land is not None else 6):
        empty = g == 0
        if land is not None:
            empty &= land
        if not empty.any():
            break
        grown = g.copy()
        for sh in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src = np.roll(g, sh, axis=(0, 1))
            take = empty & (grown == 0) & (src != 0)
            grown[take] = src[take]
        if (grown == g).all():
            break
        g = grown
    return g.tolist()


def main():
    args = sys.argv[1:]
    root = ROOT
    if "--root" in args:
        root = args[args.index("--root") + 1]
    dbc_dir = os.path.join(root, "dbc")
    rows, s = read_dbc(os.path.join(dbc_dir, "AreaTable.dbc"))
    name_col = None
    for r in rows:
        for i in range(3, len(r)):
            if s(r[i]) == "Elwynn Forest":
                name_col = i
                break
        if name_col:
            break
    areas = {r[0]: (r[1], r[2], s(r[name_col])) for r in rows}
    log("areas: %d" % len(areas))

    def zone_of(a):
        seen = 0
        while a in areas and areas[a][1] and areas[a][1] in areas and seen < 5:
            a = areas[a][1]; seen += 1
        return a if a in areas else 0

    tiles = pickle.load(open(os.path.join(root, "adt_area_cache.pkl"), "rb"))
    spawns = json.load(open(os.path.join(root, "gamedata", "spawns.json"), encoding="utf-8"))
    places = spawns["places"]
    zone_by_name = {}
    for aid, (mp, parent, name) in areas.items():
        if parent == 0:
            zone_by_name.setdefault((mp, name), aid)

    from PIL import Image
    out = {"chunk": CHUNK, "origin": ORIGIN, "size": N, "maps": {}}
    for mp, mname in MAPS.items():
        # spawn samples with their server-side zone, to pick the axis layout of the cache
        samples = []
        for lst in spawns["spawns"].values():
            for sp in lst:
                if sp[0] == mp:
                    z = zone_by_name.get((mp, places[sp[5]] if sp[5] < len(places) else ""))
                    if z:
                        samples.append((sp[1], sp[2], z))
        samples = samples[::max(1, len(samples) // 3000)]

        def area_at(x, y, hyp):
            a = 32.0 - y / TILE; b = 32.0 - x / TILE
            f1, f2 = (b, a) if hyp[0] else (a, b)
            tx, ty = int(math.floor(f1)), int(math.floor(f2))
            cx, cy = int((f1 - tx) * 16), int((f2 - ty) * 16)
            if hyp[1]:
                cx, cy = cy, cx
            t = tiles.get((mp, tx, ty))
            return t.get((cx, cy), 0) if t else 0
        best, bh = (False, False), -1
        for hyp in ((False, False), (True, True), (False, True), (True, False)):
            hits = sum(1 for x, y, z in samples if zone_of(area_at(x, y, hyp)) == z)
            if hits > bh:
                best, bh = hyp, hits
        log("%s: layout %s matches %d / %d spawn zones" % (mname, best, bh, len(samples)))
        # raster: col along -y, row along -x (same as the collision grid)
        grid = [[0] * N for _ in range(N)]
        zones = {}
        for (m2, tx, ty), t in tiles.items():
            if m2 != mp or not t:
                continue
            for (cx, cy), a in t.items():
                z = zone_of(a)
                if not z:
                    continue
                if best[1]:
                    cx, cy = cy, cx
                # tile index pair (tx, ty) with f1 -> tx: f1 = a (cols) unless swapped
                if best[0]:
                    col, row = ty * 16 + cy, tx * 16 + cx
                else:
                    col, row = tx * 16 + cx, ty * 16 + cy
                if 0 <= col < N and 0 <= row < N:
                    grid[row][col] = z
                    zones[z] = zones.get(z, 0) + 1
        # spawns where the terrain was never read
        for x, y, z in samples:
            col, row = int((ORIGIN - y) / CHUNK), int((ORIGIN - x) / CHUNK)
            if 0 <= col < N and 0 <= row < N and not grid[row][col]:
                grid[row][col] = z
        grid = fill_land(root, mname, grid)
        ids = sorted(set(v for r in grid for v in r if v))
        index = {z: i + 1 for i, z in enumerate(ids)}
        img = Image.new("L", (N, N), 0)
        img.putdata([index.get(v, 0) for r in grid for v in r])
        path = os.path.join(root, "gamedata", "zonemap_%s.png" % mname)
        img.save(path)
        out["maps"][mname] = {"map": mp, "zones": [[i + 1, z, areas[z][2]] for i, z in enumerate(ids)]}
        log("  wrote %s (%d zones)" % (path, len(ids)))
    with open(os.path.join(root, "gamedata", "zonemap.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    log("Done.")


if __name__ == "__main__":
    main()
