"""make_dungeon_walls.py - walls, walkable floor and the ways between floors of every dungeon and raid map.

From the dungeon map pictures (maps_dungeon/<Name><floor>.jpg) and where the creatures, objects, bosses and the
entrance are:
  1. the walkable floor of a picture: a watershed grown from the creature spots, stopped by the dark outline band
     that the map painters drew around every room and corridor (spots on the open parchment around the map - places
     the picture does not show - are left out);
  2. the walls: the outline of that floor, as lines (picture pixels, 1002 x 668);
  3. the ways between floors (stairs, ramps, lifts): where creatures / objects of two floors stand close together
     in the world (height included) - or, if nothing stands there, the closest pair of spots of the two floors;
  4. drawn walls win: a floor with pure red lines in dungeon_walls/<nn> <name>/floor <n>.png (drawn by hand) uses
     those lines instead (the rooms they enclose that hold creatures are the floor).

Writes gamedata/dungeon_walls.json:
  {"<map>": {"name", "floors": {"<n>": {"w", "h", "cell", "bits" (walkable, base64, cell x cell pixels),
                                         "walls": [[x0, y0, x1, y1, ...], ...], "drawn": bool}},
             "links": [{"a": {"f", "x", "y"}, "b": {"f", "x", "y"}, "d": yards, "z": height difference}]}}

    py make_dungeon_walls.py          (numpy, opencv-python, pillow)
"""
import base64, json, math, os, re
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CELL = 2                     # walkable mask: 2 x 2 picture pixels per cell
FAR = 45                     # pixels from the nearest creature spot: surely not floor


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


def to_px(f, x, y, W=1002, H=668):
    return (f["yl"] - y) / (f["yl"] - f["yr"]) * W, (f["xt"] - x) / (f["xt"] - f["xb"]) * H


def to_world(f, u, v, W=1002, H=668):
    return f["xt"] - v / H * (f["xt"] - f["xb"]), f["yl"] - u / W * (f["yl"] - f["yr"])


def spots_of(d, spawns, objects):
    pts = []
    for lst in spawns.values():
        for p in lst:
            if p[0] == d["map"]:
                pts.append((p[1], p[2], p[3]))
    for lst in objects.values():
        for p in lst:
            if p[0] == d["map"]:
                pts.append((p[1], p[2], p[3]))
    for b in d.get("bosses", []):
        pts.append((b["x"], b["y"], b.get("z")))
    for e in d.get("enter", []):
        pts.append((e["x"], e["y"], e.get("z")))
    return pts


def outside_mask(img, seeds=None):
    """the open parchment around the drawn rooms (flood from the picture's border over everything that is not an
    outline); faint outlines (Scarlet Monastery) need a lower threshold and a wider closing - tried until (almost)
    no creature spot is left outside"""
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.2), cv2.COLOR_RGB2LAB).astype(np.float32)
    bg = cv2.medianBlur(cv2.cvtColor(img, cv2.COLOR_RGB2LAB), 101).astype(np.float32)
    dd = np.sqrt(((lab - bg) ** 2)[..., 1:].sum(-1) + ((lab - bg)[..., 0] ** 2) * 0.3)
    h, w = dd.shape
    tries = []
    for thr, k in ((14, 7), (11, 9), (9, 11), (7, 13), (6, 17)):
        edge = cv2.morphologyEx((dd > thr).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
        ff = edge.copy()
        m = np.zeros((h + 2, w + 2), np.uint8)
        for seed in [(w // 2, 5), (5, h // 2), (w - 6, h // 2), (w // 2, h - 6), (30, 30), (w - 30, h - 30), (30, h - 30), (w - 30, 30)]:
            if ff[seed[1], seed[0]] == 0:
                cv2.floodFill(ff, m, seed, 2)
        out = ff == 2
        if out.mean() < 0.3:          # the flood did not get going (the border itself is all outline) - not usable
            continue
        if not seeds:
            return out
        frac = sum(1 for u, v in seeds if out[v, u]) / len(seeds)
        tries.append((frac, out))
        if frac < 0.05:
            break
    if not tries:
        return np.zeros((h, w), bool)
    # the strictest outline that keeps (nearly) as many spots inside as the loosest - creatures that stand where the
    # picture shows nothing stay outside whatever is tried
    lo = min(t[0] for t in tries)
    for frac, out in tries:
        if frac <= lo + 0.05:
            return out
    return tries[-1][1]


def segment(img, seeds, inside):
    """the walkable floor: inside the drawn outline, lighter than the outline band and not the darker rock / pillars;
    rooms are kept when a creature stands in them or when they are big enough to be a room of their own"""
    H, W = img.shape[:2]
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.0), cv2.COLOR_RGB2LAB)
    L = lab[..., 0].astype(np.float32)
    ins = inside & ~cv2.dilate((~inside).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    A = lab[..., 1].astype(np.float32); B = lab[..., 2].astype(np.float32)
    if seeds:
        Lref = float(np.median([L[v, u] for u, v in seeds])); Aref = float(np.median([A[v, u] for u, v in seeds])); Bref = float(np.median([B[v, u] for u, v in seeds]))
    else:
        Lref = float(np.percentile(L[ins], 70)) if ins.any() else 150.0; Aref = float(np.median(A[ins])) if ins.any() else 135.0; Bref = float(np.median(B[ins])) if ins.any() else 160.0
    med = cv2.medianBlur(lab[..., 0], 31).astype(np.float32)
    dark = (L < med - 16) | (L < Lref - 45)
    # dark red rock and bright orange lava (coloured floors - pink, red, blue rooms - stay)
    warm = ((A > Aref + 11) & (L < Lref - 12)) | ((A > Aref + 15) & (B > Bref + 20)) | ((A > Aref + 5) & (B > Bref + 17) & (L > Lref + 10))
    fl = ins & ~dark & ~warm
    fl = cv2.morphologyEx(fl.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labs, stats, _ = cv2.connectedComponentsWithStats(fl, connectivity=4)
    keep = np.zeros(n, bool)
    for u, v in seeds:
        for dv in (-2, 0, 2):
            for du in (-2, 0, 2):
                yy, xx = min(H - 1, max(0, v + dv)), min(W - 1, max(0, u + du))
                keep[labs[yy, xx]] = True
    keep[0] = False
    big = stats[:, cv2.CC_STAT_AREA] >= 1500
    w_, h_ = stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT]
    top, left = stats[:, cv2.CC_STAT_TOP], stats[:, cv2.CC_STAT_LEFT]
    # the name banner of the map (a wide, low strip at the top or the bottom) - never floor, whatever stands "in" it
    banner = (h_ < 110) & (w_ > 2.2 * h_) & ((top < 90) | (top + h_ > H - 90))
    keep |= big
    keep &= ~banner
    keep[0] = False
    fl = keep[labs].astype(np.uint8)
    fl = cv2.morphologyEx(fl, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # the walls run along the middle of the outline band (as drawn by hand), not its inner edge
    grow = cv2.dilate(fl, np.ones((3, 3), np.uint8)) > 0
    res = (fl > 0) | (grow & ins & ~warm)
    res[:14, :] = res[-14:, :] = False             # the torn frame of the picture is never floor
    res[:, :14] = res[:, -14:] = False
    return res


def segment_ws(img, seeds):
    """fallback for pictures whose outline cannot be told from the parchment: a watershed grown from the creature
    spots, stopped by the dark outline band"""
    H, W = img.shape[:2]
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.0), cv2.COLOR_RGB2LAB)
    L = lab[..., 0].astype(np.float32)
    seedm = np.zeros((H, W), np.uint8)
    for u, v in seeds:
        seedm[v, u] = 1
    dist = cv2.distanceTransform((1 - seedm).astype(np.uint8), cv2.DIST_L2, 5)
    mk = np.zeros((H, W), np.int32)
    mk[dist > FAR] = 1
    mk[:14, :] = 1
    mk[-14:, :] = 1
    mk[:, :14] = 1
    mk[:, -14:] = 1
    med = cv2.medianBlur(lab[..., 0], 31).astype(np.float32)
    mk[(L < med - 18) & (dist > 4)] = 1
    mk[cv2.dilate(seedm, np.ones((3, 3), np.uint8)) > 0] = 2
    grad = cv2.morphologyEx(cv2.GaussianBlur(img, (0, 0), 1.5), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    m = mk.copy()
    cv2.watershed(np.ascontiguousarray(grad), m)
    fl = (m == 2).astype(np.uint8)
    fl = cv2.morphologyEx(fl, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fl = cv2.morphologyEx(fl, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return fl > 0


def drawn_floor(path, seeds):
    """a hand drawn floor: pure red lines; the rooms they enclose that hold creature spots"""
    if not os.path.exists(path):
        return None
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    red = (a[..., 0] >= 220) & (a[..., 1] <= 40) & (a[..., 2] <= 40)
    if red.sum() < 30:
        return None
    bar = cv2.dilate(red.astype(np.uint8), np.ones((5, 5), np.uint8))
    n, lab = cv2.connectedComponents((1 - bar).astype(np.uint8), connectivity=4)
    outside = lab[2, 2]
    ids = {lab[v, u] for u, v in seeds if lab[v, u] not in (0, outside)}
    if not ids:
        return None
    return cv2.dilate(np.isin(lab, list(ids)).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0


def walls_of(mask):
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cnts:
        if cv2.contourArea(c) < 12:
            continue
        a = cv2.approxPolyDP(c, 1.2, True).reshape(-1, 2)
        if len(a) < 3:
            continue
        pts = a.tolist() + [a[0].tolist()]
        out.append([int(v) for p in pts for v in p])
    return out


def safe(n):
    return re.sub(r'[\\/:*?"<>|]', "", n).strip()


def kit_paths(dg):
    """dungeon_walls/<nn> <name>/floor <n>.png, numbered like make_wall_kit.py"""
    out = {}
    for k, d in enumerate(sorted(dg, key=lambda d: (d["kind"] != "dungeon", d["lmin"], d["name"])), 1):
        for f in d["floors"]:
            label = "floor %d" % f["n"] + (" - " + safe(f["name"]) if f["name"] else "")
            out[(d["map"], f["n"])] = os.path.join(ROOT, "dungeon_walls", "%02d %s" % (k, safe(d["name"])), label + ".png")
    return out


def links_of(d, floors_pts):
    """ways between floors: spots of two floors close together (height included); else their closest pair"""
    links = []
    fl = list(floors_pts.keys())
    for i in range(len(fl)):
        for j in range(i + 1, len(fl)):
            A, B = floors_pts[fl[i]], floors_pts[fl[j]]
            if not A or not B:
                continue
            a = np.array([p[:3] for p in A], float)
            b = np.array([p[:3] for p in B], float)
            dxy = np.hypot(a[:, None, 0] - b[None, :, 0], a[:, None, 1] - b[None, :, 1])
            dz = np.abs(a[:, None, 2] - b[None, :, 2])
            cost = dxy + dz * 1.5
            close = np.argwhere((dxy <= 22) & (dz <= np.maximum(4, dxy * 0.7)))
            pairs = []
            if len(close):
                # one way per place: the best pair of each cluster (pairs 40+ yards apart are separate ways)
                order = sorted(close.tolist(), key=lambda t: cost[t[0], t[1]])
                for ia, ib in order:
                    if all(math.hypot(a[ia, 0] - a[p[0], 0], a[ia, 1] - a[p[0], 1]) > 40 for p in pairs):
                        pairs.append((ia, ib))
            else:
                k = np.unravel_index(np.argmin(cost), cost.shape)
                if cost[k] < 120:
                    pairs.append((int(k[0]), int(k[1])))
            for ia, ib in pairs[:2]:
                pa, pb = A[ia], B[ib]
                links.append({"a": {"f": fl[i], "x": round(pa[3], 1), "y": round(pa[4], 1), "wx": round(pa[0], 1), "wy": round(pa[1], 1), "wz": round(pa[2], 1)},
                              "b": {"f": fl[j], "x": round(pb[3], 1), "y": round(pb[4], 1), "wx": round(pb[0], 1), "wy": round(pb[1], 1), "wz": round(pb[2], 1)},
                              "d": round(float(dxy[ia, ib]), 1), "z": round(float(pb[2] - pa[2]), 1), "close": bool(len(close))})
    return links


def assign_floors(d, pts, inside):
    """which floor picture each spot belongs to: the floors whose drawn rooms cover it (in the picture), and of those
    the one whose height fits best - the heights of the floors are learnt from the spots themselves (3 rounds)"""
    fl = [f for f in d["floors"] if f["n"] in inside]
    zc = {f["n"]: f.get("zc") for f in fl}
    cand = []
    for x, y, z in pts:
        if z is None:
            cand.append([])
            continue
        c = []
        for f in fl:
            if x > f["xt"] or x < f["xb"] or y > f["yl"] or y < f["yr"]:
                continue
            u, v = to_px(f, x, y)
            if 0 <= u < 1002 and 0 <= v < 668 and inside[f["n"]][int(v), int(u)]:
                c.append(f)
        cand.append(c)
    res = [None] * len(pts)
    for _ in range(3):
        for i, (x, y, z) in enumerate(pts):
            c = cand[i]
            if not c:
                res[i] = None
                continue
            if len(c) == 1:
                res[i] = c[0]
                continue
            def score(f):
                banded = f["z0"] > -9999 or f["z1"] < 999999
                s = 0.0
                if banded:
                    s += 0 if f["z0"] - 2 <= z <= f["z1"] + 2 else min(abs(z - f["z0"]), abs(z - f["z1"])) + 5
                if zc.get(f["n"]) is not None:
                    s += abs(z - zc[f["n"]]) * 0.6
                else:
                    s += 8
                return s
            res[i] = min(c, key=score)
        # the heights of the floors from what stands on them now
        for f in fl:
            zs = [pts[i][2] for i in range(len(pts)) if res[i] is f]
            if zs:
                zc[f["n"]] = float(np.median(zs))
    return res, zc


EDITS = os.path.join(ROOT, "gamedata", "wall_edits")


def comps(free):
    """4-connected components of a bool picture; -> labels, count, labels touching the picture border (outside)"""
    n, lab = cv2.connectedComponents(free.astype(np.uint8), connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return lab, n, border


def read_edits(mp, fn):
    """the corrections drawn on the test window (gamedata/wall_edits/<map>_<floor>.png, picture pixels):
    blue = walls, white = no wall here (opened), small blue circles = the way in"""
    path = os.path.join(EDITS, "%s_%s.png" % (mp, fn))
    if not os.path.exists(path):
        return None
    e = np.asarray(Image.open(path).convert("RGB"))
    blue = e[..., 2] > 127
    white = e[..., 0] > 127
    # entrance circles: small round rooms closed by blue
    lab, n, border = comps(~cv2.dilate(blue.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool))
    ents = []
    for k in range(1, n):
        if k in border:
            continue
        ys, xs = np.nonzero(lab == k)
        area = len(xs)
        if not 20 <= area <= 700:
            continue
        w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        if max(w, h) > 2.2 * min(w, h) or area < 0.45 * math.pi * (max(w, h) / 2) ** 2:
            continue
        ring = cv2.dilate((lab == k).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        # a ring drawn on its own (not a room of the drawing): the blue line around it goes nowhere else
        nb, bl = cv2.connectedComponents(blue.astype(np.uint8), connectivity=8)
        ids = set(np.unique(bl[ring & blue])) - {0}
        if not ids:
            continue
        line = np.isin(bl, list(ids))
        ly, lx = np.nonzero(line)
        if lx.max() - lx.min() > w + 24 or ly.max() - ly.min() > h + 24:
            continue
        ents.append((float(xs.mean()), float(ys.mean()), ring))
    for x, y, ring in ents:
        blue &= ~ring
    try:
        modes = json.load(open(os.path.join(EDITS, "modes.json"), encoding="utf-8"))
    except (OSError, ValueError):
        modes = {}
    return {"blue": blue, "white": white, "ents": [(x, y) for x, y, _ in ents], "ent_rings": [r for _, _, r in ents],
            "mode": modes.get("%s_%s" % (mp, fn))}


def apply_edits(mask, ed, seeds):
    """corrections on the calculated floor. When the blue lines enclose most of the floor they are the whole drawing
    (the rooms they close that hold creatures are the floor); otherwise they add walls, the white opens walls, and a room
    closed mostly by blue that was not floor before becomes floor"""
    H, W = mask.shape
    bd = cv2.dilate(ed["blue"].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    white = cv2.dilate(ed["white"].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    lab, n, border = comps(~bd)
    enclosed = (lab > 0) & ~np.isin(lab, list(border))
    inside_frac = (mask & enclosed).sum() / max(1, mask.sum())
    seed_frac = sum(1 for u, v in seeds if enclosed[v, u]) / max(1, len(seeds))
    pts = [(u, v) for u, v in seeds] + [(int(x), int(y)) for x, y in ed["ents"]]
    if ed.get("mode") == "drawn" or (ed.get("mode") is None and (inside_frac >= 0.6 or (seed_frac >= 0.6 and ed["white"].sum() < 300))):
        # gaps in the drawn lines let the floor run out to the parchment: thicker lines close them (the thinnest that
        # keeps the most floor), then the floor is grown back to the drawn line
        best = None
        for k in (3, 5, 7, 9, 11, 15):
            bk = cv2.dilate(ed["blue"].astype(np.uint8), np.ones((k, k), np.uint8)) > 0
            lk, nk, brk = comps(~bk)
            keep = {lk[v, u] for u, v in pts if 0 <= v < H and 0 <= u < W} - {0} - brk
            area = np.isin(lk, list(keep)).sum() if keep else 0
            if best is None or area > best[0] * 1.15:
                best = (area, k, np.isin(lk, list(keep)) if keep else np.zeros((H, W), bool))
        new = best[2]
        if best[1] > 3:
            new = cv2.dilate(new.astype(np.uint8), np.ones((best[1] - 2, best[1] - 2), np.uint8)) > 0
        mode = "drawn"
    else:
        new = mask | white
        ring = (cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) & ~mask
        lab2, n2, border2 = comps(~(bd | ring) | white)
        for k in range(1, n2):
            if k in border2:
                continue
            c = lab2 == k
            area = c.sum()
            if area > 0.15 * W * H or mask[c].mean() >= 0.6:
                continue
            edge = (cv2.dilate(c.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) & ~c
            if bd[edge].mean() >= 0.25:
                new |= c
        new = cv2.morphologyEx(new.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
        mode = "edited"
    for r in ed["ent_rings"]:
        new |= r & ~bd
    new &= ~bd
    return new, mode


def prune(mask, keep_pts, spot_pts, bosses):
    """only what can be walked to: the parts holding the way in or a way to another floor; without those (or for big
    parts) the ones with a boss or at least 5 creature spots"""
    lab, n, _ = comps(mask)
    H, W = mask.shape
    cnt = np.zeros(n, int)
    for u, v in spot_pts:
        if 0 <= v < H and 0 <= u < W:
            cnt[lab[v, u]] += 1
    keep = set()
    for u, v in keep_pts:
        if 0 <= v < H and 0 <= u < W and lab[v, u]:
            keep.add(lab[v, u])
        else:      # just off the floor: the nearest part within a few pixels
            y0, y1, x0, x1 = max(0, v - 6), min(H, v + 7), max(0, u - 6), min(W, u + 7)
            win = lab[y0:y1, x0:x1]
            if win.any():
                keep.add(int(np.bincount(win[win > 0]).argmax()))
    for u, v in bosses:
        if 0 <= v < H and 0 <= u < W and lab[v, u]:
            keep.add(lab[v, u])
    for k in range(1, n):
        if cnt[k] >= 5:
            keep.add(k)
    return np.isin(lab, list(keep)) & (lab > 0)


def main():
    dg = json.load(open(os.path.join(ROOT, "gamedata", "dungeons.json"), encoding="utf-8"))["dungeons"]
    spawns = json.load(open(os.path.join(ROOT, "gamedata", "spawns.json"), encoding="utf-8"))["spawns"]
    ob = json.load(open(os.path.join(ROOT, "gamedata", "objects.json"), encoding="utf-8"))
    objects = ob.get("objects", ob)
    kit = kit_paths(dg)
    out = {}
    for d in dg:
        pts = spots_of(d, spawns, objects)
        res = {"name": d["name"], "floors": {}, "links": []}
        floors_pts, masks = {}, {}
        imgs, inside, outs = {}, {}, {}
        for f in d["floors"]:
            path = os.path.join(ROOT, f["file"].replace("/", os.sep))
            if not os.path.exists(path):
                continue
            imgs[f["n"]] = np.asarray(Image.open(path).convert("RGB"))
            cand = []
            for x, y, z in pts:
                if z is None or x > f["xt"] or x < f["xb"] or y > f["yl"] or y < f["yr"]:
                    continue
                u, v = to_px(f, x, y)
                if 8 <= u < 994 and 8 <= v < 660 and (f["z0"] <= -9999 or f["z0"] - 3 <= z <= f["z1"] + 3):
                    cand.append((int(u), int(v)))
            outs[f["n"]] = outside_mask(imgs[f["n"]], cand)
            inside[f["n"]] = cv2.dilate((~outs[f["n"]]).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        owner, zc = assign_floors(d, pts, inside)
        for f in d["floors"]:
            if f["n"] not in imgs:
                continue
            img = imgs[f["n"]]
            H, W = img.shape[:2]
            seeds, fp = [], []
            for (x, y, z), o in zip(pts, owner):
                if o is not f:
                    continue
                u, v = to_px(f, x, y, W, H)
                if 8 <= u < W - 8 and 8 <= v < H - 8:
                    seeds.append((int(u), int(v)))
                    fp.append((x, y, z, u, v))
            drawn = drawn_floor(kit.get((d["map"], f["n"]), ""), seeds)
            mask = drawn
            if mask is None:
                mask = segment(img, seeds, ~cv2.dilate(outs[f["n"]].astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool))
                if mask.mean() > 0.42 and seeds:      # the outline was not found (the floor ran over the parchment)
                    mask = segment_ws(img, seeds)
            ed = read_edits(d["map"], f["n"])
            mode = "drawn" if drawn is not None else "auto"
            ents = []
            if ed is not None:
                mask, mode = apply_edits(mask, ed, seeds)
                ents = ed["ents"]
            masks[f["n"]] = (mask, mode, ents, seeds, fp)
        # the ways in: drawn circles, else the entrance of the dungeon data on its floor
        for e in d.get("enter", []):
            ef = floor_at(d, e["x"], e["y"], e.get("z"))
            if ef is not None and ef["n"] in masks and not masks[ef["n"]][2]:
                u, v = to_px(ef, e["x"], e["y"])
                masks[ef["n"]][2].append((u, v))
        for n_, (mask, mode, ents, seeds, fp) in masks.items():
            floors_pts[n_] = [p for p in fp if mask[int(p[4]), int(p[3])]] or fp
        if len(floors_pts) > 1:
            res["links"] = links_of(d, floors_pts)
        for f in d["floors"]:
            if f["n"] not in masks:
                continue
            mask, mode, ents, seeds, fp = masks[f["n"]]
            keep_pts = [(int(u), int(v)) for u, v in ents]
            for L in res["links"]:
                for side in ("a", "b"):
                    if L[side]["f"] == f["n"]:
                        keep_pts.append((int(L[side]["x"]), int(L[side]["y"])))
            bosses = [tuple(int(t) for t in to_px(f, b["x"], b["y"])) for b in d.get("bosses", []) if floor_at(d, b["x"], b["y"], b.get("z")) is f]
            mask = prune(mask, keep_pts, seeds, bosses)
            H, W = mask.shape
            h2, w2 = H // CELL, W // CELL
            cells = mask[:h2 * CELL, :w2 * CELL].reshape(h2, CELL, w2, CELL).mean(axis=(1, 3)) >= 0.5
            res["floors"][str(f["n"])] = {"w": int(w2), "h": int(h2), "cell": CELL, "drawn": mode != "auto", "mode": mode,
                                          "bits": base64.b64encode(np.packbits(cells.astype(np.uint8).ravel()).tobytes()).decode(),
                                          "walls": walls_of(mask), "spots": len(seeds), "pct": round(float(mask.mean()) * 100, 2),
                                          "entrances": [[round(u, 1), round(v, 1)] for u, v in ents],
                                          "zc": round(zc[f["n"]], 1) if zc.get(f["n"]) is not None else None}
        out[str(d["map"])] = res
        print("%-28s floors %d  links %d  %s" % (d["name"], len(res["floors"]), len(res["links"]),
                                                ", ".join("%s:%s%%%s" % (k, v["pct"], {"auto": "", "drawn": "*", "edited": "+"}[v["mode"]]) for k, v in res["floors"].items())))
    with open(os.path.join(ROOT, "gamedata", "dungeon_walls.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("gamedata/dungeon_walls.json written")


if __name__ == "__main__":
    main()
