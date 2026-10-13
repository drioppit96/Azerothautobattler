"""make_dungeon_maps.py - dungeon and raid maps for the game.

    py make_dungeon_maps.py <WorldMap texture folder> <UiMapAssignment.csv> <ClassicDB .sql.gz>

- <WorldMap texture folder>: Interface/WorldMap of a WoW Classic client as PNG tiles (12 tiles of 256x256 per
  floor: <Name><floor>_<1..12>.PNG), e.g. the "classic" branch of github.com/Gethe/wow-ui-textures.
- <UiMapAssignment.csv>: the UiMapAssignment table of the same client (where each floor lies in the world),
  e.g. from github.com/Questie/Questie (ExternalScripts/DBC - WoW.tools).
- <ClassicDB .sql.gz>: the cMaNGOS classic database dump (instance_template, areatrigger_teleport, instance_encounters).

Writes maps_dungeon/<Name><floor>.jpg (1002x668, the same size as the zone maps) and gamedata/dungeons.json.
"""
import csv, json, os, re, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# map id: (name, kind, texture folder, {floor: uiMapID}, short name)
DUNGEONS = {
    389: ("Ragefire Chasm", "dungeon", "Ragefire", {1: 213}, "RFC"),
    36: ("The Deadmines", "dungeon", "TheDeadmines", {1: 291, 2: 292}, "DM"),
    43: ("Wailing Caverns", "dungeon", "WailingCaverns", {1: 279}, "WC"),
    33: ("Shadowfang Keep", "dungeon", "ShadowfangKeep", {1: 310, 2: 311, 3: 312, 4: 313, 5: 314, 6: 315, 7: 316}, "SFK"),
    48: ("Blackfathom Deeps", "dungeon", "BlackFathomDeeps", {1: 221, 2: 222, 3: 223}, "BFD"),
    34: ("The Stockade", "dungeon", "TheStockade", {1: 225}, "Stocks"),
    90: ("Gnomeregan", "dungeon", "Gnomeregan", {1: 226, 2: 227, 3: 228, 4: 229}, "Gnomer"),
    47: ("Razorfen Kraul", "dungeon", "RazorfenKraul", {1: 301}, "RFK"),
    189: ("Scarlet Monastery", "dungeon", "ScarletMonastery", {1: 302, 2: 303, 3: 304, 4: 305}, "SM"),
    129: ("Razorfen Downs", "dungeon", "RazorfenDowns", {1: 300}, "RFD"),
    70: ("Uldaman", "dungeon", "Uldaman", {1: 230, 2: 231}, "Ulda"),
    209: ("Zul'Farrak", "dungeon", "ZulFarrak", {0: 219}, "ZF"),
    349: ("Maraudon", "dungeon", "Maraudon", {1: 280, 2: 281}, "Mara"),
    109: ("The Temple of Atal'Hakkar", "dungeon", "TheTempleOfAtalHakkar", {1: 220}, "ST"),
    230: ("Blackrock Depths", "dungeon", "BlackrockDepths", {1: 242, 2: 243}, "BRD"),
    229: ("Blackrock Spire", "dungeon", "BlackrockSpire", {1: 250, 2: 251, 3: 252, 4: 253, 5: 254, 6: 255}, "BRS"),
    429: ("Dire Maul", "dungeon", "DireMaul", {1: 235, 2: 236, 3: 237, 4: 238, 5: 239, 6: 240}, "DiM"),
    289: ("Scholomance", "dungeon", "Scholomance", {1: 306, 2: 307, 3: 308, 4: 309}, "Scholo"),
    329: ("Stratholme", "dungeon", "Stratholme", {1: 317, 2: 318}, "Strat"),
    409: ("Molten Core", "raid", "MoltenCore", {1: 232}, "MC"),
    249: ("Onyxia's Lair", "raid", "OnyxiasLair", {1: 248}, "Ony"),
    469: ("Blackwing Lair", "raid", "BlackwingLair", {1: 287, 2: 288, 3: 289, 4: 290}, "BWL"),
    309: ("Zul'Gurub", "raid", "ZulGurub", {0: 233}, "ZG"),
    509: ("Ruins of Ahn'Qiraj", "raid", "RuinsofAhnQiraj", {0: 247}, "AQ20"),
    531: ("Temple of Ahn'Qiraj", "raid", "AhnQiraj", {1: 319, 2: 320, 3: 321}, "AQ40"),
    533: ("Naxxramas", "raid", "Naxxramas", {1: 162, 2: 163, 3: 164, 4: 165, 5: 166, 6: 167}, "Naxx"),
}
# entrances the database has no ghost entrance for (map, x, y)
ENTRANCE_FIX = {533: (0, 3125.0, -3748.0)}
FLOOR_NAMES = {
    189: {1: "Graveyard", 2: "Library", 3: "Armory", 4: "Cathedral"},
    429: {1: "Gordok Commons", 2: "Capital Gardens", 3: "Court of the Highborne", 4: "Prison of Immol'thar", 5: "Warpwood Quarter", 6: "The Shrine of Eldretharr"},
}


def log(t): print(t, flush=True)


def stitch(folder, name, floor):
    pre = os.path.join(folder, name, name + (str(floor) + "_" if floor else ""))
    im = Image.new("RGB", (1024, 768))
    for i in range(12):
        f = pre + str(i + 1) + ".PNG"
        if not os.path.isfile(f):
            f2 = pre + str(i + 1) + ".png"
            if not os.path.isfile(f2): return None
            f = f2
        im.paste(Image.open(f).convert("RGB"), ((i % 4) * 256, (i // 4) * 256))
    return im.crop((0, 0, 1002, 668))


def floor_mask(path):
    """the drawn rooms and corridors of a floor picture (everything enclosed by the outlines)"""
    import numpy as np, cv2
    im = cv2.imread(path); lab = cv2.cvtColor(cv2.GaussianBlur(im, (0, 0), 1.2), cv2.COLOR_BGR2LAB).astype(float)
    bg = cv2.medianBlur(cv2.cvtColor(im, cv2.COLOR_BGR2LAB), 101).astype(float)
    d = np.sqrt(((lab - bg) ** 2)[..., 1:].sum(-1) + ((lab - bg)[..., 0] ** 2) * 0.3)
    edge = cv2.morphologyEx((d > 14).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    h, w = edge.shape; ff = edge.copy(); m = np.zeros((h + 2, w + 2), np.uint8)
    for seed in [(w // 2, 5), (5, h // 2), (w - 6, h // 2), (w // 2, h - 6), (30, 30), (w - 30, h - 30)]:
        if ff[seed[1], seed[0]] == 0: cv2.floodFill(ff, m, seed, 2)
    return cv2.dilate((ff != 2).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0


def floor_walk_masks(data):
    """where one can walk on each floor picture (the drawn rooms), 4x4 pixels per cell, packed in bits (base64)"""
    import numpy as np, base64
    for d in data:
        for f in d["floors"]:
            m = floor_mask(os.path.join(ROOT, f["file"]))
            h, w = m.shape; H, W = h // 4, w // 4
            cells = m[:H * 4, :W * 4].reshape(H, 4, W, 4).mean(axis=(1, 3)) > 0.3
            f["walk"] = {"w": int(W), "h": int(H), "bits": base64.b64encode(np.packbits(cells.astype(np.uint8).ravel()).tobytes()).decode()}


def floor_bands(data):
    """floors drawn on top of each other: the height band of each floor, from the creatures and objects that stand
    on its drawn rooms (the game picks the floor by height)"""
    import numpy as np
    sp = json.load(open(os.path.join(ROOT, "gamedata", "spawns.json")))["spawns"]
    ob = json.load(open(os.path.join(ROOT, "gamedata", "objects.json")))["objects"]
    pts = {}
    for src in (sp, ob):
        for l in src.values():
            for s in l: pts.setdefault(s[0], []).append((s[1], s[2], s[3]))
    for d in data:
        fl = [f for f in d["floors"] if f["z0"] <= -9999 and f["z1"] >= 999999]
        if len(d["floors"]) < 2 or len(fl) < 2: continue
        masks = {f["n"]: floor_mask(os.path.join(ROOT, f["file"])) for f in fl}
        zs = {f["n"]: [] for f in fl}
        for x, y, z in pts.get(d["map"], []):
            hit = []
            for f in fl:
                if not (f["xb"] <= x <= f["xt"] and f["yr"] <= y <= f["yl"]): continue
                px = int((f["yl"] - y) / (f["yl"] - f["yr"]) * 1001); py = int((f["xt"] - x) / (f["xt"] - f["xb"]) * 667)
                if masks[f["n"]][py, px]: hit.append(f["n"])
            if len(hit) == 1: zs[hit[0]].append(z)
        for f in fl:
            z = np.array(zs[f["n"]])
            if len(z) >= 6: f["z0"], f["z1"] = round(float(np.percentile(z, 4)) - 4, 1), round(float(np.percentile(z, 96)) + 4, 1)
            f["zc"] = round(float(np.median(z)), 1) if len(z) else None
        log("  %s height bands: %s" % (d["name"], ", ".join("%d:%s..%s" % (f["n"], f["z0"], f["z1"]) for f in fl)))


def main():
    if len(sys.argv) < 4: log(__doc__); return
    tex, ui_csv, sql = sys.argv[1], sys.argv[2], sys.argv[3]
    regions = {}
    with open(ui_csv, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            u = int(r["UiMapID"]); v = [float(r["Region_%d" % i]) for i in range(6)]
            u0, v0, u1, v1 = float(r["UiMin_0"]), float(r["UiMin_1"]), float(r["UiMax_0"]), float(r["UiMax_1"])
            if u1 <= u0 or v1 <= v0: continue
            xmin, ymin, zmin, xmax, ymax, zmax = v
            if xmax - xmin < 1 or ymax - ymin < 1: continue
            sy = (ymax - ymin) / (u1 - u0); sx = (xmax - xmin) / (v1 - v0)
            b = {"yl": ymax + u0 * sy, "yr": ymax - (1 - u0) * sy, "xt": xmax + v0 * sx, "xb": xmax - (1 - v0) * sx, "z0": zmin, "z1": zmax, "mapId": int(r["MapID"])}
            g = regions.get(u)
            if not g: regions[u] = b
            else: g["z0"] = min(g["z0"], zmin); g["z1"] = max(g["z1"], zmax)
    import classicdb_sql as C
    T = C.tables(sql, ["instance_template", "areatrigger_teleport", "instance_encounters", "creature", "creature_template"])
    inst = {r[0]: r for r in T["instance_template"][1]}
    enters = {}
    for r in T["areatrigger_teleport"][1]:
        if r[6] in DUNGEONS: enters.setdefault(r[6], []).append({"name": re.sub(r"\s*-\s*(Entering|Entrance)$", "", r[1]).replace("Monestary", "Monastery"), "x": r[7], "y": r[8], "z": r[9], "lvl": r[2]})
    tcols = T["creature_template"][0]; ti = {c: i for i, c in enumerate(tcols)}
    names = {r[ti["Entry"]]: r[ti["Name"]] for r in T["creature_template"][1]}
    ccols = T["creature"][0]; ci = {c: i for i, c in enumerate(ccols)}
    where = {}
    for r in T["creature"][1]:
        m = r[ci["map"]]
        if m in DUNGEONS: where.setdefault(r[ci["id"]], (m, r[ci["position_x"]], r[ci["position_y"]], r[ci["position_z"]]))
    bosses = {}
    for r in T["instance_encounters"][1]:
        e = r[2]
        if r[1] == 0 and e in where: m, x, y, z = where[e]; bosses.setdefault(m, []).append({"e": e, "n": names.get(e, str(e)), "x": round(x, 1), "y": round(y, 1), "z": round(z, 1)})
    out_dir = os.path.join(ROOT, "maps_dungeon"); os.makedirs(out_dir, exist_ok=True)
    data = []
    for mid, (name, kind, folder, floors, short) in DUNGEONS.items():
        it = inst.get(mid)
        ent = ENTRANCE_FIX.get(mid) or ((it[6], it[7], it[8]) if it and (it[7] or it[8]) else None)
        d = {"map": mid, "name": name, "short": short, "kind": kind, "lmin": it[2] if it else 60, "lmax": (it[3] or 60) if it else 60,
             "players": it[4] if it else 5, "entrance": {"map": ent[0], "x": ent[1], "y": ent[2]} if ent else None,
             "enter": enters.get(mid, []), "bosses": bosses.get(mid, []), "floors": []}
        if d["kind"] == "dungeon" and d["players"] > 5: d["players"] = 5
        for fl, ui in sorted(floors.items()):
            b = regions.get(ui)
            if not b: log("no region for %s floor %d (uiMap %d)" % (name, fl, ui)); continue
            im = stitch(tex, folder, fl)
            if im is None: log("no picture for %s floor %d" % (name, fl)); continue
            fn = folder + str(fl) + ".jpg"; im.save(os.path.join(out_dir, fn), "JPEG", quality=90, optimize=True)
            d["floors"].append({"n": fl, "name": FLOOR_NAMES.get(mid, {}).get(fl, ""), "file": "maps_dungeon/" + fn,
                                "xt": round(b["xt"], 2), "xb": round(b["xb"], 2), "yl": round(b["yl"], 2), "yr": round(b["yr"], 2), "z0": b["z0"], "z1": b["z1"]})
        data.append(d); log("%-26s %d floors, %d bosses, entrance %s" % (name, len(d["floors"]), len(d["bosses"]), ent))
    try:
        floor_walk_masks(data)
    except ImportError:
        log("numpy / opencv missing - no walk masks (paths inside dungeons only follow where creatures stand)")
    try:
        floor_bands(data)
    except ImportError:
        log("numpy / opencv missing - floors of stacked dungeons are not told apart by height")
    # name, levels, rank and type of every creature in the dungeons (the zone maps' creature list has only the outdoor ones)
    inside = set(e for e, w in where.items())
    for r in T["creature"][1]:
        if r[ci["map"]] in DUNGEONS: inside.add(r[ci["id"]])
    mobs = [[r[ti["Entry"]], r[ti["Name"]], r[ti["MinLevel"]], r[ti["MaxLevel"]], r[ti["Rank"]], r[ti["CreatureType"]]] for r in T["creature_template"][1] if r[ti["Entry"]] in inside]
    json.dump({"dungeons": data, "mobs": mobs}, open(os.path.join(ROOT, "gamedata", "dungeons.json"), "w"), indent=0)
    log("wrote gamedata/dungeons.json and %d pictures" % sum(len(d["floors"]) for d in data))


if __name__ == "__main__":
    main()
