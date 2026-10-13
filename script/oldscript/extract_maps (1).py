# -*- coding: utf-8 -*-
"""
Extracts the world map and every zone map from the 1.12 client as named PNG files.
Output folder:  C:\\wow excel\\maps          (EXPLORED maps: every area revealed)
                C:\\wow excel\\maps\\unexplored   (the plain base maps, without the revealed areas)

Needs: wow_common.py in the same folder, mpyq + pillow installed, and the DBC files
from extract_dbc_multi.py (WorldMapArea, WorldMapOverlay, AreaTable) - re-run it first.
Run:  py extract_maps.py
"""
import io
import os
import re
from collections import Counter

from wow_common import *   # noqa

MAPS_DIR = os.path.join(OUT_FOLDER, "maps")
COLS, ROWS, TILE = 4, 3, 256          # a map is 12 tiles (4 x 3) of 256 px
FINAL_W, FINAL_H = 1002, 668          # the visible part of the 1024 x 768 canvas
CONTINENTS = {"Azeroth": "Eastern Kingdoms", "Kalimdor": "Kalimdor"}


def safe(name):
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "unnamed"


def open_archives():
    from mpyq import MPQArchive
    files = {f.lower(): f for f in os.listdir(CLIENT_DATA) if f.lower().endswith(".mpq")}
    order = sorted([f for f in files if f.startswith("patch")], reverse=True)
    skip = ("sound.mpq", "speech.mpq", "speech-enus.mpq", "fonts.mpq")
    order += [f for f in sorted(files) if f not in order and f not in skip]
    out = []
    for f in order:
        try:
            out.append((files[f], MPQArchive(os.path.join(CLIENT_DATA, files[f]), listfile=False)))
        except Exception as exc:
            log("  could not open %s: %s" % (files[f], str(exc)[:80]))
    return out


def read_from(archives, filename):
    for _, arc in archives:
        try:
            data = arc.read_file(filename)
        except Exception:
            data = None
        if data:
            return data
    return None


def load_tile(archives, name, Image):
    data = read_from(archives, name)
    if not data:
        return None
    try:
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception as exc:
        if not getattr(load_tile, "warned", False):
            log("  could not decode a .blp file (%s). Try: py -m pip install --upgrade pillow"
                % str(exc)[:80])
            load_tile.warned = True
        return None


def build_map(archives, folder, overlays, Image):
    """stitch the 12 base tiles, then lay every overlay (revealed area) on top.
    returns (base image, explored image, tiles found, overlays found)"""
    canvas = Image.new("RGBA", (COLS * TILE, ROWS * TILE), (0, 0, 0, 255))
    got = 0
    for n in range(1, COLS * ROWS + 1):
        tile = load_tile(archives, "Interface\\WorldMap\\%s\\%s%d.blp" % (folder, folder, n), Image)
        if tile is None:
            continue
        canvas.paste(tile, (((n - 1) % COLS) * TILE, ((n - 1) // COLS) * TILE))
        got += 1
    if got == 0:
        return None, None, 0, 0
    base = canvas.crop((0, 0, FINAL_W, FINAL_H)).convert("RGB")
    explored = canvas.copy()
    ov_found = 0
    for tex, w, h, ox, oy in overlays:
        cols, rows = (w + TILE - 1) // TILE, (h + TILE - 1) // TILE
        any_tile = False
        for n in range(1, cols * rows + 1):
            tile = load_tile(archives, "Interface\\WorldMap\\%s\\%s%d.blp" % (folder, tex, n), Image)
            if tile is None:
                continue
            x, y = ox + ((n - 1) % cols) * TILE, oy + ((n - 1) // cols) * TILE
            explored.paste(tile, (x, y), tile)
            any_tile = True
        ov_found += 1 if any_tile else 0
    return base, explored.crop((0, 0, FINAL_W, FINAL_H)).convert("RGB"), got, ov_found


def main():
    from PIL import Image
    try:
        os.makedirs(MAPS_DIR)
    except OSError:
        pass
    wma = load_dbc("WorldMapArea")
    if not wma:
        return
    # which field holds the folder name?
    votes = Counter()
    for r in wma.rows:
        for i in range(1, wma.fc):
            t = wma.s(r[i])
            if t and re.match(r"^[A-Za-z0-9_' ]+$", t):
                votes[i] += 1
    dir_idx = votes.most_common(1)[0][0] if votes else 3
    areas = {}
    at = load_dbc("AreaTable")
    if at:
        idx = at.find_field(12, "Elwynn Forest")
        areas = {r[0]: at.s(r[idx if idx is not None else 11]) for r in at.rows}

    # overlays (the coloured "explored" pieces)
    overlays = {}
    wmo = load_dbc("WorldMapOverlay")
    if wmo:
        tex_idx = None
        for i in range(2, min(wmo.fc, 12)):
            vals = [wmo.s(r[i]) for r in wmo.rows[:50]]
            if sum(1 for v in vals if v and re.match(r"^[A-Za-z0-9_' ]+$", v)) >= min(3, len(vals)):
                tex_idx = i
                break
        if tex_idx is not None and tex_idx + 4 < wmo.fc:
            for r in wmo.rows:
                t = wmo.s(r[tex_idx])
                if t and r[tex_idx + 1] and r[tex_idx + 2]:
                    overlays.setdefault(r[1], []).append(
                        (t, r[tex_idx + 1], r[tex_idx + 2], r[tex_idx + 3], r[tex_idx + 4]))
            log("Overlay pieces listed: %d" % sum(len(v) for v in overlays.values()))
    else:
        log("WorldMapOverlay.dbc missing - maps will NOT show explored areas. "
            "Run extract_dbc_multi.py again.")
    entries = []
    for r in wma.rows:
        folder = wma.s(r[dir_idx])
        if not folder:
            continue
        area_id = r[2]
        if area_id and areas.get(area_id):
            title = areas[area_id]
        else:
            title = CONTINENTS.get(folder, folder)
        entries.append((folder, title, overlays.get(r[0], [])))
    for extra in ("World",):
        if extra not in [e[0] for e in entries]:
            entries.append((extra, "World Map (cosmic)", []))
    log("Maps listed in the client: %d" % len(entries))

    archives = open_archives()
    log("Archives opened: %s" % ", ".join(n for n, _ in archives))
    used = Counter()
    saved = 0
    try:
        os.makedirs(os.path.join(MAPS_DIR, "unexplored"))
    except OSError:
        pass
    for folder, title, ovl in sorted(entries, key=lambda e: e[1]):
        base, img, got, nov = build_map(archives, folder, ovl, Image)
        if img is None:
            log("  skipped %-28s (no tiles found)" % title)
            continue
        name = safe(title)
        used[name] += 1
        if used[name] > 1:
            name = "%s (%s)" % (name, safe(folder))
        path = os.path.join(MAPS_DIR, name + ".png")
        img.save(path)
        base.save(os.path.join(MAPS_DIR, "unexplored", name + ".png"))
        saved += 1
        log("  saved %-30s %d/12 tiles, %d/%d overlays" % (name + ".png", got, nov, len(ovl)))
    log("Done! %d maps saved in %s" % (saved, MAPS_DIR))


if __name__ == "__main__":
    run(main)
