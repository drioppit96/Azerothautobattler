# -*- coding: utf-8 -*-
"""
Collision grid for local walking: where a character CAN and CANNOT walk on the two continents.
Built from the real terrain files (ADT) in the client:
   * steep slopes / cliffs / mountains   -> blocked
   * holes in the terrain (cave mouths)   -> blocked
   * deep water                           -> "swim" (blocked for land bots unless you allow swimming)
   * lava / slime                         -> blocked
   * big world objects (houses, towers, ruins...) -> NOT blocked by default (bounding boxes block doors and
     bridges); run with  buildings  to block them anyway
and then CORRECTED with ground truth from the server data: every walking path of the playerbot
navigation graph, every creature spawn, graveyard, flight master and travel node is forced walkable
(this repairs doors, bridges, ramps, stairs outside buildings and slopes that were judged too steep).

Writes  C:\\wow excel\\gamedata\\navgrid_Azeroth.bin.gz     (Eastern Kingdoms)
        C:\\wow excel\\gamedata\\navgrid_Kalimdor.bin.gz
        C:\\wow excel\\gamedata\\navgrid_meta.json          (transform, calibration, validation report)
        C:\\wow excel\\gamedata\\navgrid.js                 (loader + A* path finder for the game)
        C:\\wow excel\\navgrid_preview_<map>.png             (colour preview: look at it!)

Cell codes (uint8):  0 no data / outside the world   1 walkable   2 swim (deep water)
                     3 too steep   4 lava / slime     5 hole      6 building
File layout:  16 byte header  'NVG1', uint16 width, uint16 height, float32 cellSize, float32 origin(=17066.66656)
              then width*height bytes (row-major), gzip-compressed.
Cell (col, row) of a world position (x, y):   col = floor((17066.66656 - y) / cell)
                                              row = floor((17066.66656 - x) / cell)       (north is up, east is right)
Default cell size = 533.3333 / 128 = 4.1667 yards (a continent is 8192 x 8192 cells).

Run:   py wow_navgrid.py            (both continents; first time ~10-25 min; mountains, water, lava - no buildings)
       py wow_navgrid.py buildings  (also block houses and towers)
       py wow_navgrid.py 0          (only Eastern Kingdoms)   /   py wow_navgrid.py 1  (Kalimdor)
Needs: wow_common.py, wow_util.py, extract_maps.py (same folder), numpy, mpyq, pillow,
       DBC Map.dbc (extract_dbc_multi.py) and the tables ai_playerbot_travelnode* in the database.
Please run it, open the preview PNGs and read the validation lines at the end - they say how good
the grid is (the layout of the terrain files is detected automatically by comparing heights with
creature spawn heights).
"""
import gzip
import heapq
import itertools
import json
import math
import os
import struct
import sys
import time
from collections import defaultdict

from wow_util import *   # noqa

TILE = 533.33333
SIZE = 17066.66656
CELLS = 128                       # cells per tile side  -> cell = 4.1667 yd
CELL = TILE / CELLS
SLOPE_DEG = 55.0                  # steeper than this is blocked
SWIM_DEPTH = 1.6                  # water deeper than this (yards) = swim
BLOCK_BUILDINGS = "buildings" in sys.argv
BIG_WMO = 300.0                   # world objects larger than this (city walls, dungeons) are not blocked
OUT_DIR = os.path.join(OUT_FOLDER, "gamedata")
MAP_DIRS = {0: "Azeroth", 1: "Kalimdor"}
CODE_COLORS = {0: (0, 0, 0), 1: (120, 170, 90), 2: (40, 90, 200), 3: (130, 110, 90),
               4: (220, 60, 20), 5: (200, 0, 200), 6: (250, 230, 60)}


def need_numpy():
    try:
        import numpy as np
        return np
    except ImportError:
        raise RuntimeError("numpy is missing:  py -m pip install numpy")


# ============================================================ ADT parsing
class Chunk(object):
    __slots__ = ("ix", "iy", "flags", "holes", "base", "outer", "inner", "liq")


def _sub(data, pos, ofs, magic):
    """data offset of a MCNK sub chunk payload (offsets are relative to the MCNK start)"""
    for p in (pos + ofs, pos + 8 + ofs):
        if p + 8 <= len(data) and data[p:p + 4] == magic:
            return p + 8, struct.unpack_from("<I", data, p + 4)[0]
    return None, 0


def parse_tile(data):
    """-> dict(chunks=[Chunk], modf=[(u0, v0, u1, v1, ymin, ymax)])"""
    np = need_numpy()
    out = {"chunks": [], "modf": []}
    pos, n = 0, len(data)
    while pos + 8 <= n:
        cid = data[pos:pos + 4]
        size = struct.unpack_from("<I", data, pos + 4)[0]
        if cid == b"KNCM" and pos + 8 + 128 <= n:
            h = struct.unpack_from("<16I", data, pos + 8)
            c = Chunk()
            c.flags, c.ix, c.iy = h[0], h[1], h[2]
            c.holes = h[15] & 0xFFFF
            ofs_vt = h[5]
            ofs_liq, size_liq = struct.unpack_from("<II", data, pos + 8 + 96)
            c.base = struct.unpack_from("<3f", data, pos + 8 + 104)
            p, sz = _sub(data, pos, ofs_vt, b"TVCM")
            c.outer = c.inner = None
            c.liq = None
            if p is not None and sz >= 145 * 4:
                v = np.frombuffer(data, dtype="<f4", count=145, offset=p).astype(np.float64)
                rows = v.reshape(-1)[:145]
                outer = np.zeros((9, 9))
                inner = np.zeros((8, 8))
                for r in range(9):
                    outer[r, :] = rows[r * 17:r * 17 + 9]
                    if r < 8:
                        inner[r, :] = rows[r * 17 + 9:r * 17 + 17]
                c.outer, c.inner = outer, inner
            if c.outer is not None:
                if (c.flags & 0x3C) and size_liq >= 8 + 8 + 648 + 64:
                    q, qs = _sub(data, pos, ofs_liq, b"QLCM")
                    if q is not None and qs >= 8 + 648 + 64:
                        hmin, hmax = struct.unpack_from("<2f", data, q)
                        vb = np.frombuffer(data, dtype=np.uint8, count=648, offset=q + 8).reshape(81, 8)
                        hh = vb[:, 4:8].copy().view("<f4").reshape(9, 9).astype(np.float64)
                        fl = np.frombuffer(data, dtype=np.uint8, count=64, offset=q + 8 + 648).reshape(8, 8)
                        kind = 2 if (c.flags & 0x30) else 1
                        c.liq = (kind, fl.copy(), hh)
                out["chunks"].append(c)
        elif cid == b"FDOM":
            for k in range(size // 64):
                o = pos + 8 + k * 64
                if o + 64 > n:
                    break
                lo = struct.unpack_from("<3f", data, o + 32)
                hi = struct.unpack_from("<3f", data, o + 44)
                u0, u1 = sorted((lo[0], hi[0]))
                v0, v1 = sorted((lo[2], hi[2]))
                y0, y1 = sorted((lo[1], hi[1]))
                out["modf"].append((u0, v0, u1, v1, y0, y1))
        pos += 8 + size
    return out


# ===================================================== layout candidates
class Cand(object):
    """how chunk indexes and the 9x9 vertex arrays map onto the tile grid"""
    FIELDS = ("swap_chunk", "flip_ci", "flip_cj", "swap_vertex", "flip_di", "flip_dj", "slot")

    def __init__(self, swap_chunk, flip_ci, flip_cj, swap_vertex, flip_di, flip_dj, slot):
        self.swap_chunk, self.flip_ci, self.flip_cj = swap_chunk, flip_ci, flip_cj
        self.swap_vertex, self.flip_di, self.flip_dj, self.slot = swap_vertex, flip_di, flip_dj, slot

    def as_dict(self):
        return {k: getattr(self, k) for k in self.FIELDS}

    def __repr__(self):
        return "Cand(%s)" % ", ".join("%s=%s" % (k, getattr(self, k)) for k in self.FIELDS)


def all_candidates(slots):
    out = []
    for sc, fci, fcj, sv, fdi, fdj in itertools.product((False, True), repeat=6):
        for slot in slots:
            out.append(Cand(sc, fci, fcj, sv, fdi, fdj, slot))
    return out


def xform(a, cand):
    if cand.swap_vertex:
        a = a.T
    if cand.flip_di:
        a = a[:, ::-1]
    if cand.flip_dj:
        a = a[::-1, :]
    return a


def place(chunk, cand):
    ci, cj = (chunk.iy, chunk.ix) if cand.swap_chunk else (chunk.ix, chunk.iy)
    if cand.flip_ci:
        ci = 15 - ci
    if cand.flip_cj:
        cj = 15 - cj
    return ci, cj


def guess_slots(parsed_tiles):
    """which of the 3 header floats is the height: the one that is small in every chunk"""
    np = need_numpy()
    slots = []
    allb = [c.base for p in parsed_tiles for c in p["chunks"]]
    if not allb:
        return [0, 1, 2]
    arr = np.array(allb)
    for s in range(3):
        if np.median(np.abs(arr[:, s])) < 3500:
            slots.append(s)
    return slots or [0, 1, 2]


def build_heights(parsed, cand):
    """-> H9 (129x129 vertex heights), HC (128x128 cell centre heights)"""
    np = need_numpy()
    H9 = np.zeros((CELLS + 1, CELLS + 1))
    HC = np.zeros((CELLS, CELLS))
    for c in parsed["chunks"]:
        base = c.base[cand.slot]
        ci, cj = place(c, cand)
        o = xform(c.outer, cand) + base
        i_ = xform(c.inner, cand) + base
        H9[cj * 8:cj * 8 + 9, ci * 8:ci * 8 + 9] = o
        HC[cj * 8:cj * 8 + 8, ci * 8:ci * 8 + 8] = i_
    return H9, HC


def sample_height(H9, u_in, v_in):
    """bilinear height at tile-local u, v in yards (u = columns, v = rows)"""
    fi = min(max(u_in / CELL, 0.0), CELLS - 1e-6)
    fj = min(max(v_in / CELL, 0.0), CELLS - 1e-6)
    i, j = int(fi), int(fj)
    a, b = fi - i, fj - j
    return (H9[j, i] * (1 - a) * (1 - b) + H9[j, i + 1] * a * (1 - b) +
            H9[j + 1, i] * (1 - a) * b + H9[j + 1, i + 1] * a * b)


def classify_tile(parsed, cand, slope_tan):
    """-> uint8 array 128x128 with codes 0..6 (except 6) for one tile"""
    np = need_numpy()
    H9, HC = build_heights(parsed, cand)
    h00, h01, h10, h11 = H9[:-1, :-1], H9[:-1, 1:], H9[1:, :-1], H9[1:, 1:]
    S = CELL
    c = HC
    sl = np.zeros((CELLS, CELLS))
    for gx, gy in (((h01 - h00) / S, 2 * (c - (h00 + h01) / 2) / S),
                   ((h11 - h10) / S, 2 * (c - (h10 + h11) / 2) / S),
                   (2 * (c - (h00 + h10) / 2) / S, (h10 - h00) / S),
                   (2 * (c - (h01 + h11) / 2) / S, (h11 - h01) / S)):
        sl = np.maximum(sl, np.sqrt(gx * gx + gy * gy))
    code = np.where(sl <= slope_tan, 1, 3).astype(np.uint8)
    hm = (h00 + h01 + h10 + h11) / 4.0
    holes = np.zeros((CELLS, CELLS), dtype=bool)
    lq_kind = np.zeros((CELLS, CELLS), dtype=np.uint8)
    lq_h = np.zeros((CELLS, CELLS))
    for ch in parsed["chunks"]:
        ci, cj = place(ch, cand)
        if ch.holes:
            m = np.zeros((4, 4), dtype=bool)
            for k in range(16):
                if ch.holes & (1 << k):
                    m[k // 4, k % 4] = True
            m8 = np.kron(m, np.ones((2, 2), dtype=bool))
            holes[cj * 8:cj * 8 + 8, ci * 8:ci * 8 + 8] |= xform(m8, cand)
        if ch.liq:
            kind, fl, hh = ch.liq
            has = (fl & 0x0F) != 0x0F
            lvl = (hh[:-1, :-1] + hh[:-1, 1:] + hh[1:, :-1] + hh[1:, 1:]) / 4.0
            sl_ = (slice(cj * 8, cj * 8 + 8), slice(ci * 8, ci * 8 + 8))
            hx = xform(has, cand)
            lq_kind[sl_] = np.where(hx, kind, lq_kind[sl_])
            lq_h[sl_] = np.where(hx, xform(lvl, cand), lq_h[sl_])
    depth = lq_h - hm
    code = np.where((lq_kind == 1) & (depth > SWIM_DEPTH), 2, code).astype(np.uint8)
    code = np.where((lq_kind == 2) & (depth > -0.5), 4, code).astype(np.uint8)
    code = np.where(holes, 5, code).astype(np.uint8)
    return code


# =============================================================== reading
class TileSource(object):
    def __init__(self, archives, mapdir):
        self.archives, self.mapdir = archives, mapdir
        self.cache = {}

    def get(self, tx, ty, keep=False):
        key = (tx, ty)
        if key in self.cache:
            return self.cache[key]
        import extract_maps
        data = extract_maps.read_from(self.archives, "World\\Maps\\%s\\%s_%d_%d.adt" % (self.mapdir, self.mapdir, tx, ty))
        parsed = parse_tile(data) if data else None
        if keep:
            self.cache[key] = parsed
        return parsed


def world_to_uv(x, y):
    return SIZE - y, SIZE - x


def load_spawns(cur, map_id):
    c = columns(cur, "creature")
    cur.execute("SELECT `%s` m, `%s` x, `%s` y, `%s` z FROM creature WHERE `%s` = %%s"
                % (c["map"], c["position_x"], c["position_y"], c["position_z"], c["map"]), (map_id,))
    return [(float(r["x"]), float(r["y"]), float(r["z"])) for r in cur.fetchall()]


def calibrate(source, spawns, report):
    """choose the layout whose terrain heights match the heights of the creature spawns"""
    np = need_numpy()
    by_tile = defaultdict(list)
    for x, y, z in spawns:
        if not (-300 < z < 1500):
            continue
        u, v = world_to_uv(x, y)
        tx, ty = int(u // TILE), int(v // TILE)
        if 0 <= tx < 64 and 0 <= ty < 64:
            by_tile[(tx, ty)].append((u - tx * TILE, v - ty * TILE, z))
    order = sorted(by_tile, key=lambda k: -len(by_tile[k]))
    tiles = []
    for k in order:
        p = source.get(k[0], k[1], keep=True)
        if p and p["chunks"]:
            tiles.append((k, p))
        if len(tiles) >= 14:
            break
    if not tiles:
        report["error"] = "no terrain tile with creature spawns could be read"
        return None
    slots = guess_slots([p for _, p in tiles])
    cands = all_candidates(slots)
    log("  calibrating on %d tiles (%d spawns), %d candidate layouts ..." %
        (len(tiles), sum(len(by_tile[k]) for k, _ in tiles), len(cands)))
    scores = []
    for cand in cands:
        errs = []
        for k, p in tiles:
            H9, _ = build_heights(p, cand)
            for ui, vi, z in by_tile[k][:80]:
                errs.append(abs(sample_height(H9, ui, vi) - z))
        e = np.array(errs)
        scores.append((float(np.median(e)), float((e < 6).mean()), cand))
    scores.sort(key=lambda t: (t[0], -t[1]))
    best = scores[0]
    report["calibration"] = {"best": best[2].as_dict(), "median_error_yd": round(best[0], 2),
                             "within_6yd": round(best[1], 3),
                             "runner_up_median": round(scores[1][0], 2),
                             "tiles": len(tiles)}
    log("  best layout: %s" % best[2])
    log("  median height error %.2f yd, %.0f%% of spawns within 6 yd (next best layout: %.2f yd)"
        % (best[0], best[1] * 100, scores[1][0]))
    if best[0] > 8:
        log("  WARNING: heights do not match well - the grid may be wrong. Send me this log.")
    return best[2]


# ===================================================== grid building
def rasterize_boxes(grid, boxes):
    np = need_numpy()
    n = 0
    for u0, v0, u1, v1, y0, y1 in boxes:
        w, h = u1 - u0, v1 - v0
        if max(w, h) > BIG_WMO or max(w, h) < CELL or (y1 - y0) < 3.0:
            continue
        c0 = int((u0 + CELL * 0.5) / CELL)
        c1 = int((u1 - CELL * 0.5) / CELL)
        r0 = int((v0 + CELL * 0.5) / CELL)
        r1 = int((v1 - CELL * 0.5) / CELL)
        if c1 < c0 or r1 < r0:
            continue
        sub = grid[r0:r1 + 1, c0:c1 + 1]
        sub[(sub == 1)] = 6
        n += 1
    return n


def build_continent(map_id, archives, spawns, report):
    np = need_numpy()
    mapdir = MAP_DIRS[map_id]
    source = TileSource(archives, mapdir)
    cand = calibrate(source, spawns, report)
    if cand is None:
        return None
    slope_tan = math.tan(math.radians(SLOPE_DEG))
    W = 64 * CELLS
    grid = np.zeros((W, W), dtype=np.uint8)
    boxes = []
    found = 0
    t0 = time.time()
    for ty in range(64):
        for tx in range(64):
            p = source.get(tx, ty, keep=(tx, ty) in source.cache)
            if not p or not p["chunks"]:
                continue
            found += 1
            code = classify_tile(p, cand, slope_tan)
            grid[ty * CELLS:(ty + 1) * CELLS, tx * CELLS:(tx + 1) * CELLS] = code
            boxes.extend(p["modf"])
        if ty % 8 == 7:
            log("  %s: row %d / 64, %d tiles, %.0f s" % (mapdir, ty + 1, found, time.time() - t0))
    source.cache.clear()
    seen = set()
    uniq = []
    for b in boxes:
        k = tuple(round(x, 1) for x in b)
        if k not in seen:
            seen.add(k)
            uniq.append(b)
    nb = rasterize_boxes(grid, uniq) if BLOCK_BUILDINGS else 0
    report["tiles"] = found
    report["buildings_blocked"] = nb
    log("  tiles: %d, building boxes applied: %d of %d%s" % (found, nb, len(uniq), "" if BLOCK_BUILDINGS else " (buildings are not blocked)"))
    return grid


def to_cell(x, y):
    u, v = world_to_uv(x, y)
    return int(u // CELL), int(v // CELL)


def _pick(cols, *names):
    for n in names:
        if n in cols:
            return cols[n]
    return None


def apply_overlays(cur, map_id, grid, report):
    """force-walkable ground truth: bot paths, spawns, graveyards, travel nodes, flight masters"""
    np = need_numpy()
    from PIL import Image, ImageDraw
    H, W = grid.shape
    strong = Image.new("L", (W, H), 0)      # may repair steep cells, holes and buildings
    weak = Image.new("L", (W, H), 0)        # may repair holes and buildings only
    ds, dw = ImageDraw.Draw(strong), ImageDraw.Draw(weak)
    stats = {}
    # 1. navigation graph paths (walk links) - made on the real navigation meshes
    n = 0
    if table_exists(cur, "ai_playerbot_travelnode_path"):
        pc = columns(cur, "ai_playerbot_travelnode_path")
        a_ = _pick(pc, "node_id", "from_node_id")
        b_ = _pick(pc, "to_node_id")
        n_ = _pick(pc, "nr", "point_id", "idx")
        m_ = _pick(pc, "map_id", "map")
        order = "`%s`, `%s`%s" % (a_, b_, (", `%s`" % n_) if n_ else "")
        cur.execute("SELECT `%s` a, `%s` b, `%s` x, `%s` y FROM ai_playerbot_travelnode_path WHERE `%s` = %%s ORDER BY %s"
                    % (a_, b_, pc["x"], pc["y"], m_, order), (map_id,))
        prev = None
        for r in cur.fetchall():
            c, rw = to_cell(float(r["x"]), float(r["y"]))
            key = (r["a"], r["b"])
            if prev and prev[0] == key:
                ds.line((prev[1], prev[2], c, rw), fill=255, width=3)
                n += 1
            else:
                ds.ellipse((c - 1, rw - 1, c + 1, rw + 1), fill=255)
            prev = (key, c, rw)
    stats["path_segments"] = n
    npts = 0
    if table_exists(cur, "ai_playerbot_travelnode"):
        nc = columns(cur, "ai_playerbot_travelnode")
        cur.execute("SELECT `%s` x, `%s` y FROM ai_playerbot_travelnode WHERE `%s` = %%s"
                    % (nc["x"], nc["y"], _pick(nc, "map_id", "map")), (map_id,))
        for r in cur.fetchall():
            c, rw = to_cell(float(r["x"]), float(r["y"]))
            ds.ellipse((c - 3, rw - 3, c + 3, rw + 3), fill=255)
            npts += 1
    if table_exists(cur, "world_safe_locs"):
        sc = columns(cur, "world_safe_locs")
        mc_, xc_, yc_ = _pick(sc, "map", "mapid", "map_id"), _pick(sc, "x", "loc_x", "locx"), _pick(sc, "y", "loc_y", "locy")
        if mc_ and xc_ and yc_:
            cur.execute("SELECT `%s` x, `%s` y FROM world_safe_locs WHERE `%s` = %%s" % (xc_, yc_, mc_), (map_id,))
            for r in cur.fetchall():
                c, rw = to_cell(float(r["x"]), float(r["y"]))
                ds.ellipse((c - 3, rw - 3, c + 3, rw + 3), fill=255)
                npts += 1
    sp = load_spawns(cur, map_id)
    for x, y, z in sp:
        c, rw = to_cell(x, y)
        dw.ellipse((c - 1, rw - 1, c + 1, rw + 1), fill=255)
    stats["anchor_points"] = npts + len(sp)
    ms = np.asarray(strong) > 0
    mw = np.asarray(weak) > 0
    fix_strong = ms & ((grid == 3) | (grid == 5) | (grid == 6))
    fix_weak = mw & ((grid == 5) | (grid == 6))
    stats["cells_repaired"] = int(fix_strong.sum() + fix_weak.sum())
    grid[fix_strong] = 1
    grid[fix_weak] = 1
    report["overlay"] = stats
    log("  overlay: %s" % stats)


def spawn_report(grid, spawns, report):
    np = need_numpy()
    cnt = defaultdict(int)
    for x, y, z in spawns:
        c, r = to_cell(x, y)
        cnt[int(grid[r, c]) if 0 <= r < grid.shape[0] and 0 <= c < grid.shape[1] else 0] += 1
    tot = max(1, len(spawns))
    names = {0: "no data", 1: "walkable", 2: "swim", 3: "steep", 4: "lava", 5: "hole", 6: "building"}
    rep = {names[k]: round(100.0 * v / tot, 1) for k, v in sorted(cnt.items())}
    report["spawns_on_cells_percent"] = rep
    log("  creature spawns on cells (after overlay): %s" % rep)


# =========================================================== A* (python)
def astar(grid, c0, r0, c1, r1, allow_swim=False, max_nodes=150000):
    """8 neighbour A* on the code grid. returns list of (col, row) or None"""
    H, W = grid.shape
    cost_of = {1: 1.0, 2: 4.0 if allow_swim else None}
    flat = grid.ravel()
    DIAG = 1.41421356
    start, goal = r0 * W + c0, r1 * W + c1
    if cost_of.get(int(flat[start])) is None or cost_of.get(int(flat[goal])) is None:
        return None
    g_ = {start: 0.0}
    prev = {}
    heap = [(0.0, start)]
    done = set()
    exp = 0
    while heap:
        f, u = heapq.heappop(heap)
        if u in done:
            continue
        done.add(u)
        if u == goal:
            path = [u]
            while u in prev:
                u = prev[u]
                path.append(u)
            return [(p % W, p // W) for p in reversed(path)]
        exp += 1
        if exp > max_nodes:
            return None
        ur, uc = divmod(u, W)
        for dr in (-1, 0, 1):
            rr = ur + dr
            if rr < 0 or rr >= H:
                continue
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                cc = uc + dc
                if cc < 0 or cc >= W:
                    continue
                v = rr * W + cc
                cv = cost_of.get(int(flat[v]))
                if cv is None or v in done:
                    continue
                if dr and dc:      # no corner cutting
                    if cost_of.get(int(flat[ur * W + cc])) is None or cost_of.get(int(flat[rr * W + uc])) is None:
                        continue
                    step = DIAG * cv
                else:
                    step = cv
                ng = g_[u] + step
                if v not in g_ or ng < g_[v]:
                    g_[v] = ng
                    prev[v] = u
                    dx, dy = abs(cc - c1), abs(rr - r1)
                    h = (dx + dy) + (DIAG - 2) * min(dx, dy)
                    heapq.heappush(heap, (ng + h, v))
    return None


def validate_links(cur, map_id, grid, report, samples=80):
    """route real navigation-graph links over the grid: do we reach the other node?"""
    import random
    if not table_exists(cur, "ai_playerbot_travelnode_link"):
        return
    nc = columns(cur, "ai_playerbot_travelnode")
    cur.execute("SELECT * FROM ai_playerbot_travelnode WHERE `%s` = %%s" % nc["map_id"], (map_id,))
    nodes = {g(r, nc, "id"): (float(g(r, nc, "x")), float(g(r, nc, "y"))) for r in cur.fetchall()}
    lc = columns(cur, "ai_playerbot_travelnode_link")
    cur.execute("SELECT * FROM ai_playerbot_travelnode_link WHERE `%s` = 1 AND `%s` BETWEEN 40 AND 600"
                % (lc["type"], lc["distance"]))
    links = [(g(r, lc, "node_id"), g(r, lc, "to_node_id"), float(g(r, lc, "distance")))
             for r in cur.fetchall() if g(r, lc, "node_id") in nodes and g(r, lc, "to_node_id") in nodes]
    if not links:
        cur.execute("SELECT * FROM ai_playerbot_travelnode_link WHERE `%s` BETWEEN 40 AND 600" % lc["distance"])
        links = [(g(r, lc, "node_id"), g(r, lc, "to_node_id"), float(g(r, lc, "distance")))
                 for r in cur.fetchall() if g(r, lc, "node_id") in nodes and g(r, lc, "to_node_id") in nodes]
    random.seed(7)
    random.shuffle(links)
    ok = 0
    ratios = []
    t0 = time.time()
    for a, b, dist in links[:samples]:
        ca, ra = to_cell(*nodes[a])
        cb, rb = to_cell(*nodes[b])
        path = astar(grid, ca, ra, cb, rb)
        if path:
            ok += 1
            length = sum(math.hypot(p[0] - q[0], p[1] - q[1]) for p, q in zip(path, path[1:])) * CELL
            ratios.append(length / max(dist, 1.0))
    tot = min(samples, len(links))
    res = {"links_tested": tot, "reached": ok,
           "avg_length_ratio": round(sum(ratios) / len(ratios), 2) if ratios else None}
    report["link_validation"] = res
    log("  A* over %d real walking links: %d reached (path length / link length = %s) in %.0f s"
        % (tot, ok, res["avg_length_ratio"], time.time() - t0))


# ============================================================ output
def save_grid(name, grid):
    try:
        os.makedirs(OUT_DIR)
    except OSError:
        pass
    path = os.path.join(OUT_DIR, "navgrid_%s.bin.gz" % name)
    head = b"NVG1" + struct.pack("<HHff", grid.shape[1], grid.shape[0], CELL, SIZE)
    with gzip.open(path, "wb", 6) as f:
        f.write(head)
        f.write(grid.tobytes())
    log("  wrote %s (%d KB)" % (path, os.path.getsize(path) // 1024))


def save_preview(name, grid):
    np = need_numpy()
    from PIL import Image
    small = grid[::4, ::4]
    rgb = np.zeros(small.shape + (3,), dtype=np.uint8)
    for code, col in CODE_COLORS.items():
        rgb[small == code] = col
    path = os.path.join(OUT_FOLDER, "navgrid_preview_%s.png" % name)
    Image.fromarray(rgb).save(path)
    log("  wrote %s" % path)


def main():
    np = need_numpy()
    want = [int(a) for a in sys.argv[1:] if a.isdigit()] or [0, 1]
    try:
        import extract_maps
        import mpyq  # noqa: F401
    except ImportError as exc:
        raise RuntimeError("missing module: %s" % exc)
    d = load_dbc("Map")
    if d:
        for r in d.rows:
            if r[0] in MAP_DIRS and d.s(r[1]):
                MAP_DIRS[r[0]] = d.s(r[1])
    archives = extract_maps.open_archives()
    if not archives:
        raise RuntimeError("could not open the client archives in %s" % CLIENT_DATA)
    conn = connect()
    cur = conn.cursor()
    meta = {"cell": CELL, "origin": SIZE, "tile": TILE, "slope_deg": SLOPE_DEG, "swim_depth": SWIM_DEPTH,
            "codes": {"0": "no data", "1": "walkable", "2": "swim", "3": "steep", "4": "lava/slime",
                      "5": "hole", "6": "building"}, "maps": {}}
    for map_id in want:
        name = MAP_DIRS[map_id]
        log("== %s (map %d) ==" % (name, map_id))
        report = {}
        spawns = load_spawns(cur, map_id)
        log("  creature spawns on this map: %d" % len(spawns))
        grid = build_continent(map_id, archives, spawns, report)
        if grid is None:
            meta["maps"][name] = report
            continue
        spawn_report(grid, spawns, report)
        report["before_overlay_walkable_percent"] = round(100.0 * float((grid == 1).sum()) / max(1, (grid > 0).sum()), 1)
        apply_overlays(cur, map_id, grid, report)
        spawn_report(grid, spawns, report)
        validate_links(cur, map_id, grid, report)
        save_grid(name, grid)
        save_preview(name, grid)
        meta["maps"][name] = report
        meta["maps"][name]["map_id"] = map_id
    save_json("navgrid_meta", meta, indent=1)
    save_text("navgrid.js", NAVGRID_JS)
    conn.close()
    log("Done. Look at navgrid_preview_*.png and the numbers above.")


NAVGRID_JS = r"""// navgrid.js - collision grid + A* path finder (works in the browser, serve the files over http)
// const grid = await NavGrid.load('gamedata/navgrid_Azeroth.bin.gz');
// const path = grid.findPath(x0, y0, x1, y1, {swim:false});   // world coordinates in, [[x,y],...] out
class NavGrid {
  constructor(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.w = dv.getUint16(4, true); this.h = dv.getUint16(6, true);
    this.cell = dv.getFloat32(8, true); this.origin = dv.getFloat32(12, true);
    this.data = buf.subarray(16);
  }
  static async load(url) {
    const res = await fetch(url);
    const ds = new DecompressionStream('gzip');
    const buf = new Uint8Array(await new Response(res.body.pipeThrough(ds)).arrayBuffer());
    return new NavGrid(buf);
  }
  toCell(x, y) { return [Math.floor((this.origin - y) / this.cell), Math.floor((this.origin - x) / this.cell)]; }
  toWorld(c, r) { return [this.origin - (r + 0.5) * this.cell, this.origin - (c + 0.5) * this.cell]; }   // [x, y]
  code(c, r) { return (c < 0 || r < 0 || c >= this.w || r >= this.h) ? 0 : this.data[r * this.w + c]; }
  walkable(c, r, swim) { const k = this.code(c, r); return k === 1 || (swim && k === 2); }
  // nearest walkable cell around (c, r) within 'max' cells
  nearestWalkable(c, r, swim, max) {
    max = max || 40;
    if (this.walkable(c, r, swim)) return [c, r];
    for (let d = 1; d <= max; d++) {
      for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
        if (this.walkable(c + dc, r + dr, swim)) return [c + dc, r + dr];
      }
    }
    return null;
  }
  lineClear(c0, r0, c1, r1, swim) {
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1);
    for (let k = 0; k <= n; k++) {
      const c = Math.round(c0 + (c1 - c0) * k / n), r = Math.round(r0 + (r1 - r0) * k / n);
      if (!this.walkable(c, r, swim)) return false;
    }
    return true;
  }
  findPath(x0, y0, x1, y1, opt) {
    opt = opt || {}; const swim = !!opt.swim, maxNodes = opt.maxNodes || 200000;
    let [c0, r0] = this.toCell(x0, y0), [c1, r1] = this.toCell(x1, y1);
    const s = this.nearestWalkable(c0, r0, swim), e = this.nearestWalkable(c1, r1, swim);
    if (!s || !e) return null;
    [c0, r0] = s; [c1, r1] = e;
    const W = this.w, D = 1.41421356, start = r0 * W + c0, goal = r1 * W + c1;
    const gs = new Map([[start, 0]]), prev = new Map(), done = new Set();
    const heap = [[0, start]];
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let exp = 0, found = false;
    while (heap.length) {
      const [, u] = pop();
      if (done.has(u)) continue; done.add(u);
      if (u === goal) { found = true; break; }
      if (++exp > maxNodes) return null;
      const ur = Math.floor(u / W), uc = u % W;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = ur + dr, cc = uc + dc, k = this.code(cc, rr);
        if (!(k === 1 || (swim && k === 2))) continue;
        if (dr && dc && (!this.walkable(uc + dc, ur, swim) || !this.walkable(uc, ur + dr, swim))) continue;
        const v = rr * W + cc; if (done.has(v)) continue;
        const ng = gs.get(u) + (dr && dc ? D : 1) * (k === 2 ? 4 : 1);
        if (!gs.has(v) || ng < gs.get(v)) {
          gs.set(v, ng); prev.set(v, u);
          const ddx = Math.abs(cc - c1), ddy = Math.abs(rr - r1);
          push([ng + ddx + ddy + (D - 2) * Math.min(ddx, ddy), v]);
        }
      }
    }
    if (!found) return null;
    let cells = [], cur = goal;
    while (cur !== undefined) { cells.push([cur % W, Math.floor(cur / W)]); cur = prev.get(cur); }
    cells.reverse();
    // string pulling: keep only the corners that are needed
    const out = [cells[0]]; let a = 0;
    for (let b = 2; b < cells.length; b++) {
      if (!this.lineClear(cells[a][0], cells[a][1], cells[b][0], cells[b][1], swim)) { out.push(cells[b - 1]); a = b - 1; }
    }
    if (cells.length > 1) out.push(cells[cells.length - 1]);
    return out.map(p => this.toWorld(p[0], p[1]));
  }
}
if (typeof module !== 'undefined') module.exports = { NavGrid };
"""

if __name__ == "__main__":
    run(main)
