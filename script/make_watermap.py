"""make_watermap.py - where the water is, read from the colours of the zone maps (maps/<zone>.png).

The painted maps show water (sea, shallow shore bands, lakes) as grey-blue areas with little colour, the land
as saturated yellow / green / brown. So:
  1. saturation of every pixel; a minimum filter (the sea has brown hatching lines between grey ones) and a blur;
  2. low saturation = water candidate, shrunk back by the width the minimum filter added;
  3. grey LAND (snow in Dun Morogh / Winterspring, sand in Silithus and Tanaris, ash in the Burning Steppes...)
     looks the same, but creatures live there: every candidate area with about as many creature spawns per
     square yard as the land of the zone is thrown away; water has almost none.
The zones are put together into one bit mask per continent (cell 8.33 yards, the same layout as the collision
grid, cell = 2 x 2 grid cells), only used for fishing - nobody sees it.

Writes gamedata/watermap_<Azeroth|Kalimdor>.bin.gz   ('WTR1', uint16 w, uint16 h, float32 cell, float32 origin,
       then w*h bits, row-major, gzip)  and  watermap_preview_<map>.png (in the scratch folder when given).

    py make_watermap.py            (needs numpy, scipy, pillow; reads maps/, gamedata/mobmap_data.js,
                                    gamedata/spawns.json, gamedata/zonemap*.png/json)
"""
import gzip, json, os, re, struct, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ORIGIN = 17066.66656
CELL = 533.33333 / 64            # 8.33 yards
N = 4096
CITIES = {1519, 1537, 1497, 1637, 1638, 1657}
SAT_T = 0.45                     # smoothed saturation below this = water candidate
BORDER = 14                      # the torn frame of the pictures
DENSE = 0.30                     # a candidate with this share of the zone's land spawn density is land (1.0 for A)
PREVIEW = sys.argv[1] if len(sys.argv) > 1 else None


def load_maps():
    s = open(os.path.join(ROOT, "gamedata", "mobmap_data.js"), encoding="utf-8").read()
    i = s.index('"maps":')
    j = s.index("]", i)
    return [m for m in json.loads(s[i + 7:j + 1]) if m["map"] in (0, 1) and not m.get("cont") and m["area"] not in CITIES]


WATER_FOLK = re.compile(r"murloc|naga|makrura|thresher|crocolisk|turtle|snapjaw|shark|clacker|crawler|crab|fish|"
                        r"water|tidal|tide|siren|myrmidon|sea |reef|lake|river|strider|wave|surf|deep|kelp|bay |"
                        r"coast|shore|razormaw|sludge|hydra|serpent|eel|frog|toad|zombie fish|mud", re.I)


def load_spawns():
    """creature spawns of LAND creatures (murlocs, naga, crocolisks ... live in and at the water)"""
    s = open(os.path.join(ROOT, "gamedata", "mobmap_data.js"), encoding="utf-8").read()
    i = s.index('"mobs":')
    names = {}
    dec = json.JSONDecoder()
    mobs, _ = dec.raw_decode(s[i + 7:])
    for r in mobs:
        names[str(r[0])] = r[1]
    d = json.load(open(os.path.join(ROOT, "gamedata", "spawns.json"), encoding="utf-8"))
    out = {0: [], 1: []}
    for e, lst in d["spawns"].items():
        if WATER_FOLK.search(names.get(e, "")):
            continue
        for p in lst:
            if p[0] in out:
                out[p[0]].append((p[1], p[2]))
    return {k: np.array(v) for k, v in out.items()}


def load_grid(cont):
    """the collision grid (codes per 4.17 yd cell) - for the steepness of candidate areas"""
    try:
        b = gzip.open(os.path.join(ROOT, "gamedata", "navgrid_%s.bin.gz" % cont)).read()
    except OSError:
        return None
    w, h, cell, orig = struct.unpack_from("<HHff", b, 4)
    return {"g": np.frombuffer(b, np.uint8, offset=16).reshape(h, w), "cell": cell, "origin": orig}


def judge(cand, cnt, steep, land_den, min_area, grow, dense=DENSE):
    """keep the candidate areas with few creature spawns (water) and not mostly steep (painted mountains)"""
    lab, n = ndimage.label(cand)
    if not n:
        return cand & False, 0, 0
    idx = np.arange(1, n + 1)
    area = ndimage.sum(np.ones_like(lab), lab, index=idx)
    grown = ndimage.grey_dilation(lab, size=(2 * grow + 1, 2 * grow + 1)) if grow else lab
    hits = ndimage.sum(cnt, grown, index=idx)
    den = hits / np.maximum(area, 1)
    keep = np.zeros(n + 1, bool)
    keep[1:] = (area >= min_area) & ~((hits >= 3) & (den > dense * land_den))
    if steep is not None:
        st = ndimage.mean(steep.astype(np.float32), lab, index=idx)
        keep[1:] &= st < 0.35
    return keep[lab], n, int(keep.sum())


def zone_mask(m, spawns, grid=None):
    """-> bool array (h, w) of water in the picture of one zone"""
    img = Image.open(os.path.join(ROOT, m["file"])).convert("RGB")
    a = np.asarray(img).astype(np.float32) / 255
    mx, mn = a.max(2), a.min(2)
    s = (mx - mn) / np.maximum(mx, 1e-6)
    h, w = s.shape
    frame = np.zeros((h, w), bool)
    frame[:BORDER, :] = frame[-BORDER:, :] = True
    frame[:, :BORDER] = frame[:, -BORDER:] = True
    # creature spawns per picture pixel
    sp = spawns[m["map"]]
    px = (m["yl"] - sp[:, 1]) / (m["yl"] - m["yr"]) * w
    py = (m["xt"] - sp[:, 0]) / (m["xt"] - m["xb"]) * h
    ok = (px >= 0) & (py >= 0) & (px < w) & (py < h)
    cnt = np.zeros((h, w), np.float32)
    np.add.at(cnt, (py[ok].astype(int), px[ok].astype(int)), 1)
    # steep cells of the collision grid under every pixel
    steep = None
    if grid is not None:
        X = m["xt"] - (np.arange(h) + 0.5) / h * (m["xt"] - m["xb"])
        Y = m["yl"] - (np.arange(w) + 0.5) / w * (m["yl"] - m["yr"])
        r = np.clip(((grid["origin"] - X) / grid["cell"]).astype(int), 0, grid["g"].shape[0] - 1)
        c = np.clip(((grid["origin"] - Y) / grid["cell"]).astype(int), 0, grid["g"].shape[1] - 1)
        steep = grid["g"][r[:, None], c[None, :]] == 3
    # A: many nearly grey pixels close together - lakes, rivers, the light bands along the shores
    fa = ndimage.uniform_filter((s < 0.28).astype(np.float32), 9) > 0.35
    fa &= ~frame
    fa = ndimage.binary_opening(fa, iterations=1)
    # B: low saturation after a minimum filter (the hatched open sea)
    S = Image.fromarray((s * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.BoxBlur(4))
    fb = (np.asarray(S) / 255.0 < SAT_T) & ~frame
    fb = ndimage.binary_opening(fb, iterations=1)
    land = ~ndimage.binary_dilation(fa | fb, iterations=4) & ~frame
    land_den = cnt[land].sum() / max(1, land.sum())
    ka, na, nka = judge(fa, cnt, steep, land_den, 4, 1, 1.0)     # A is strict already: lakes have creatures around
    # B areas: judged on their cores (thin joins between sea and grey land cut), then grown back
    core = ndimage.binary_erosion(fb, iterations=3)
    kb, nb, nkb = judge(core, cnt, steep, land_den, 6, 3)
    lab2, _ = ndimage.label(fb)
    ids = np.unique(lab2[kb])
    kb = np.isin(lab2, ids[ids > 0]) & ndimage.binary_dilation(kb, iterations=6)
    kb = ndimage.binary_erosion(kb, iterations=2)       # the minimum filter made it 2 pixels wider
    water = ka | kb
    # C: the open sea of the high resolution terrain maps (maps_hd, minimap pictures: water is dark blue there) -
    # seeds that then flood the grey candidate pixels without creatures near them (Darkshore, Desolace: grey land
    # and grey sea side by side)
    hd = os.path.join(ROOT, "maps_hd", os.path.basename(m["file"])[:-4] + ".jpg")
    if os.path.exists(hd):
        b = np.asarray(Image.open(hd).convert("RGB").resize((w, h), Image.BOX)).astype(np.float32)
        blue = (b[..., 2] > b[..., 0] + 25) & (b[..., 2] >= b[..., 1] - 25) & (b[..., 0] < 90)     # dark sea blue, not snow
        blue = ndimage.binary_opening(blue, iterations=2) & ~frame
        cand = (fa | fb | blue) & ~frame
        seeds, nc, nkc = judge(blue & cand, cnt, steep, land_den, 300, 2)
        near = ndimage.binary_dilation(cnt > 0, iterations=3)
        if steep is not None:
            near |= steep
        water |= ndimage.binary_dilation(seeds, iterations=40, mask=cand & ~near) | seeds     # at most ~40 pixels off the open sea
        na += nc
        nka += nkc
    return water, land_den, na + nb, nka + nkb


def main():
    fishing = json.load(open(os.path.join(ROOT, "gamedata", "loot.json"), encoding="utf-8"))["tables"].get("fishing", {})
    # zones nothing can be fished in (Badlands, Searing Gorge, Blasted Lands) have no water worth knowing
    maps = [m for m in load_maps() if str(m["area"]) in fishing]
    spawns = load_spawns()
    zm = json.load(open(os.path.join(ROOT, "gamedata", "zonemap.json"), encoding="utf-8"))
    for cont, mapid in (("Azeroth", 0), ("Kalimdor", 1)):
        info = zm["maps"][cont]
        zimg = np.asarray(Image.open(os.path.join(ROOT, "gamedata", "zonemap_%s.png" % cont)).convert("RGB"))[:, :, 0]
        zid = {i: z for i, z, _ in info["zones"]}
        ng = load_grid(cont)
        grid = np.zeros((N, N), bool)
        best = np.full((N, N), -1.0, np.float32)      # how far from the picture edge the chosen sample is
        rows = (ORIGIN - (np.arange(N) + 0.5) * CELL)  # world x of each row
        cols = (ORIGIN - (np.arange(N) + 0.5) * CELL)  # world y of each column
        for m in [x for x in maps if x["map"] == mapid]:
            water, den, n, k = zone_mask(m, spawns, ng)
            h, w = water.shape
            print("%-22s land spawns/px %.3f  areas %d kept %d  water %.1f%%" % (m["name"], den, n, k, 100.0 * water.mean()))
            r0 = int(max(0, (ORIGIN - m["xt"]) / CELL)); r1 = int(min(N, (ORIGIN - m["xb"]) / CELL) + 1)
            c0 = int(max(0, (ORIGIN - m["yl"]) / CELL)); c1 = int(min(N, (ORIGIN - m["yr"]) / CELL) + 1)
            X = rows[r0:r1][:, None]; Y = cols[c0:c1][None, :]
            px = ((m["yl"] - Y) / (m["yl"] - m["yr"]) * w).astype(int)
            py = ((m["xt"] - X) / (m["xt"] - m["xb"]) * h).astype(int)
            px = np.broadcast_to(px, (r1 - r0, c1 - c0)); py = np.broadcast_to(py, (r1 - r0, c1 - c0))
            inside = (px >= BORDER) & (py >= BORDER) & (px < w - BORDER) & (py < h - BORDER)
            edge = np.minimum(np.minimum(px, w - 1 - px), np.minimum(py, h - 1 - py)).astype(np.float32)
            # the zone that owns the place (zonemap chunks of 33.3 yd = 4 cells) is always preferred
            zr = np.clip((np.arange(r0, r1) // 4), 0, zimg.shape[0] - 1)[:, None]
            zc = np.clip((np.arange(c0, c1) // 4), 0, zimg.shape[1] - 1)[None, :]
            own = np.vectorize(lambda i: zid.get(int(i), -1))(zimg[zr, zc]) == m["area"]
            score = np.where(inside, edge + own * 10000, -1)
            sub = best[r0:r1, c0:c1]
            better = score > sub
            val = water[np.clip(py, 0, h - 1), np.clip(px, 0, w - 1)]
            grid[r0:r1, c0:c1] = np.where(better, val, grid[r0:r1, c0:c1])
            sub[better] = score[better]
        bits = np.packbits(grid, axis=1)
        out = os.path.join(ROOT, "gamedata", "watermap_%s.bin.gz" % cont)
        with gzip.open(out, "wb", 9) as f:
            f.write(b"WTR1" + struct.pack("<HHff", N, N, CELL, ORIGIN) + bits.tobytes())
        print("%s: %.2f%% water, %s (%d bytes)" % (cont, 100.0 * grid.mean(), out, os.path.getsize(out)))
        if PREVIEW:
            ys, xs = np.nonzero(best >= 0)
            crop = grid[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
            known = best[ys.min():ys.max() + 1, xs.min():xs.max() + 1] >= 0
            im = np.zeros(crop.shape + (3,), np.uint8)
            im[known] = (150, 130, 80)
            im[crop] = (40, 90, 220)
            Image.fromarray(im).save(os.path.join(PREVIEW, "watermap_preview_%s.png" % cont))


if __name__ == "__main__":
    main()
