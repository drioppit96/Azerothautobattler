# -*- coding: utf-8 -*-
"""
Extracts the world map and every zone map from the 1.12 client as named PNG files.
Output folder:  C:\\wow excel\\maps

Needs: wow_common.py in the same folder, mpyq + pillow installed, and the DBC files
from extract_dbc_multi.py (it uses WorldMapArea.dbc and AreaTable.dbc).
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


def build_map(archives, folder, Image):
    """stitch the 12 tiles of one map; returns an RGB image or None"""
    canvas = Image.new("RGBA", (COLS * TILE, ROWS * TILE), (0, 0, 0, 255))
    got = 0
    for n in range(1, COLS * ROWS + 1):
        data = read_from(archives, "Interface\\WorldMap\\%s\\%s%d.blp" % (folder, folder, n))
        if not data:
            continue
        try:
            tile = Image.open(io.BytesIO(data)).convert("RGBA")
        except Exception as exc:
            if not getattr(build_map, "warned", False):
                log("  could not decode a .blp tile (%s). Try: py -m pip install --upgrade pillow"
                    % str(exc)[:80])
                build_map.warned = True
            continue
        x, y = ((n - 1) % COLS) * TILE, ((n - 1) // COLS) * TILE
        canvas.paste(tile, (x, y))
        got += 1
    if got == 0:
        return None, 0
    return canvas.crop((0, 0, FINAL_W, FINAL_H)).convert("RGB"), got


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
        entries.append((folder, title))
    for extra in ("World",):
        if extra not in [e[0] for e in entries]:
            entries.append((extra, "World Map (cosmic)"))
    log("Maps listed in the client: %d" % len(entries))

    archives = open_archives()
    log("Archives opened: %s" % ", ".join(n for n, _ in archives))
    used = Counter()
    saved = 0
    for folder, title in sorted(entries, key=lambda e: e[1]):
        img, got = build_map(archives, folder, Image)
        if img is None:
            log("  skipped %-28s (no tiles found)" % title)
            continue
        name = safe(title)
        used[name] += 1
        if used[name] > 1:
            name = "%s (%s)" % (name, safe(folder))
        path = os.path.join(MAPS_DIR, name + ".png")
        img.save(path)
        saved += 1
        log("  saved %-30s %d/12 tiles" % (name + ".png", got))
    log("Done! %d maps saved in %s" % (saved, MAPS_DIR))


if __name__ == "__main__":
    run(main)
