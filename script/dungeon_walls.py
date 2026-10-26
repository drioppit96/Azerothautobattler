"""dungeon_walls.py - exact walls for a dungeon floor from a picture of it where the walls are plain gray and lava is
orange (maps_dungeon/walls/<floor file name>.png, e.g. Ragefire1.png). The picture is fitted onto the game's own floor
picture (by the boss markers, then by the shape of the cave), and the walk mask of that floor in gamedata/dungeons.json
is replaced: walkable = not gray, not lava. Run: py script/dungeon_walls.py"""
import json, os, sys, base64
import numpy as np, cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))
from make_dungeon_maps import floor_mask  # noqa: E402

# the boss markers (purple dots) of each picture, in the order of the dungeon's bosses, then the entrance
# "dots": "auto" (try every order) or where each point's dot is (pixels, roughly - the nearest dot is taken);
# "spawn" points are creatures (the first spawn of the entry on this map); lava: orange is lava; ecc: also fit the
# cave's shape onto the game's floor picture (off when the game's picture leaves parts out)
MARKS = {"Ragefire1": {"dots": "auto", "points": [("enter", 0), ("boss", 11517), ("boss", 11520), ("boss", 11518), ("boss", 11519)]},
         # Wailing Caverns: the game's floor picture has no eastern caves (Lord Pythas, Skum), so only the dots fit it;
         # the glowing orange floors are not lava
         "WailingCaverns1": {"dots": [(340, 300), (120, 288), (639, 143), (695, 392), (467, 264), (426, 226)],          # (Kresh swims about, the Faerie Dragon has several spots: not used)
                             "points": [("enter", 0), ("boss", 3669), ("boss", 3670), ("boss", 3674), ("boss", 3673), ("boss", 5775)],
                             "lava": False, "ecc": False}}


def dots(img):
    from scipy import ndimage
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    lab, n = ndimage.label((b > 150) & (r < 140) & (g < 120))
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) > 8: out.append((xs.mean(), ys.mean()))
    return out


def walls_for(d, f, name):
    src = os.path.join(ROOT, "maps_dungeon", "walls", name + ".png")
    U = cv2.imread(src)[:, :, ::-1].astype(int)
    G = cv2.imread(os.path.join(ROOT, f["file"]))
    H, W = G.shape[:2]
    def w2g(x, y): return ((f["yl"] - y) / (f["yl"] - f["yr"]) * W, (f["xt"] - x) / (f["xt"] - f["xb"]) * H)
    world = []
    sp = json.load(open(os.path.join(ROOT, "gamedata", "spawns.json")))["spawns"]
    for kind, k in MARKS[name]["points"]:
        if kind == "enter": e = d["enter"][k]; world.append((e["x"], e["y"]))
        elif kind == "spawn": s = next(s for s in sp[str(k)] if s[0] == d["map"]); world.append((s[1], s[2]))
        else: b = next(b for b in d["bosses"] if b["e"] == k); world.append((b["x"], b["y"]))
    Q = np.array([w2g(x, y) for x, y in world], np.float32)
    dd = dots(U)
    cfg = MARKS[name]
    if cfg["dots"] != "auto":          # the given dots, each moved onto the nearest dot found
        dd = [min(dd, key=lambda q: (q[0] - x) ** 2 + (q[1] - y) ** 2) if dd and min((q[0] - x) ** 2 + (q[1] - y) ** 2 for q in dd) < 400 else (x, y) for x, y in cfg["dots"]]
    # each world point to its dot: the order that fits best
    import itertools
    best = None
    perms = [tuple(range(len(Q)))] if cfg["dots"] != "auto" else itertools.permutations(range(len(dd)), len(Q))
    for perm in perms:
        P = np.array([dd[i] for i in perm], np.float32); A, _ = cv2.estimateAffinePartial2D(P, Q)          # turn, size and place only (no shear)
        if A is None: continue
        err = np.abs(np.hstack([P, np.ones((len(P), 1))]) @ A.T - Q).sum()
        if best is None or err < best[0]: best = (err, A)
    A0 = best[1]
    P0 = np.array([dd[i] for i in range(len(Q))], np.float32) if cfg["dots"] != "auto" else None
    if P0 is not None:
        res = np.hypot(*(np.hstack([P0, np.ones((len(P0), 1))]) @ A0.T - Q).T)
        print(name, "fit: off by", np.round(res, 1), "game pixels (1 px = %.2f yards)" % ((f["yl"] - f["yr"]) / W))
    r, g, b = U[..., 0], U[..., 1], U[..., 2]
    gray = (abs(r - g) < 12) & (abs(g - b) < 12) & (r > 85) & (r < 150)
    white = (r > 200) & (g > 200) & (b > 200)
    lava = (r > 150) & (r - b > 90) & (g < 190) & (r - g > 40) if cfg.get("lava", True) else np.zeros_like(gray)
    sil = cv2.morphologyEx((~gray & ~white).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # the fine fit: the cave's shape onto the drawn rooms of the game picture
    sil_g = floor_mask(os.path.join(ROOT, f["file"])).astype(np.float32)
    s1 = cv2.GaussianBlur(sil.astype(np.float32), (0, 0), 6); s2 = cv2.GaussianBlur(sil_g, (0, 0), 6)
    if cfg.get("ecc", True):
        _, Ar = cv2.findTransformECC(s2, s1, cv2.invertAffineTransform(A0).astype(np.float32), cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
        A = cv2.invertAffineTransform(Ar)
    else:
        A = A0
    # the fit (picture pixels -> game floor pixels), for drawing routes on the picture (route planning)
    json.dump({"A": np.asarray(A).tolist(), "W": W, "H": H, "xt": f["xt"], "xb": f["xb"], "yl": f["yl"], "yr": f["yr"]}, open(os.path.join(ROOT, "maps_dungeon", "walls", name + ".fit.json"), "w"))
    walk = (~gray & ~lava).astype(np.uint8)
    label = (white | ((r + g + b) < 60)).astype(np.uint8)              # the names written on it: like what is around
    med = cv2.medianBlur((walk * 255).astype(np.uint8), 7)
    walk = np.where(label > 0, med > 127, walk > 0).astype(np.uint8)
    walk = cv2.morphologyEx(walk, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))          # the picture's frame lines
    m = cv2.warpAffine(walk.astype(np.float32), A, (W, H), borderValue=0) > 0.5
    # only the pieces where creatures stand (or the entrance)
    from scipy import ndimage
    lab, n = ndimage.label(m)
    keep = set()
    for lst in sp.values():
        for s in lst:
            if s[0] != d["map"]: continue
            px, py = w2g(s[1], s[2]); px, py = int(px), int(py)
            if 0 <= px < W and 0 <= py < H and lab[py, px]: keep.add(lab[py, px])
    for e in d["enter"]:
        px, py = w2g(e["x"], e["y"]); px, py = int(px), int(py)
        if 0 <= px < W and 0 <= py < H and lab[py, px]: keep.add(lab[py, px])
    m = np.isin(lab, list(keep))
    K = 2                                                   # 2 x 2 pixels per cell (about 1.5 yards): thin walls stay walls
    Hc, Wc = H // K, W // K
    cells = m[:Hc * K, :Wc * K].reshape(Hc, K, Wc, K).mean(axis=(1, 3)) > 0.6
    # specks of the rock texture that read as wall: small closed spots inside the floor are floor (walls are long)
    lab2, n2 = ndimage.label(~cells)
    sizes = ndimage.sum(np.ones_like(lab2), lab2, range(1, n2 + 1))
    for i, sz in enumerate(sizes, 1):
        if sz < 18: cells[lab2 == i] = True
    f["walk"] = {"w": int(Wc), "h": int(Hc), "bits": base64.b64encode(np.packbits(cells.astype(np.uint8).ravel()).tobytes()).decode(), "exact": 1}
    print(name, "walkable cells", int(cells.sum()), "of", Wc * Hc)


def main():
    path = os.path.join(ROOT, "gamedata", "dungeons.json")
    data = json.load(open(path, encoding="utf-8"))
    for d in data["dungeons"]:
        for f in d["floors"]:
            name = os.path.splitext(os.path.basename(f["file"]))[0]
            if name in MARKS and os.path.exists(os.path.join(ROOT, "maps_dungeon", "walls", name + ".png")): walls_for(d, f, name)
    with open(path, "w", encoding="utf-8", newline="\n") as fh: json.dump(data, fh, indent=0, ensure_ascii=False)


if __name__ == "__main__":
    main()
