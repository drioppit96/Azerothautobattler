# -*- coding: utf-8 -*-
"""
Creature portraits for EVERY creature in the database (bosses and NPCs too).

The game draws portraits live from the 3D models, so this script contains its
own small renderer (wow_m2.py) and renders every model from the client files.

Output (C:\\wow excel\\portraits):
    display\\<displayid>.png     128x128, one per distinct model/skin (cache)
    small\\<displayid>.png       64x64 versions used inside the Mobs spreadsheet
    by_name\\<entry>_<name>.png  one named file per creature
    failed.txt                  displays that could not be rendered

Needs: py -m pip install numpy pillow mpyq pymysql openpyxl
Run extract_dbc_multi.py first (adds the CreatureDisplayInfo tables).
Resumable: run it again and it skips what already exists.
Run:  py wow_portraits.py        then re-run  py wow_mobs.py  (adds the picture column)
"""
import os
import re
import sys
import time
import traceback

from wow_common import *   # noqa
import wow_m2

PORTRAIT_DIR = os.path.join(OUT_FOLDER, "portraits")
SIZE = 128


def safe(name):
    return re.sub(r'[\\/:*?"<>|]+', "", name or "").strip()[:60] or "unnamed"


class Renderer(object):
    def __init__(self, reader):
        self.read = reader
        self.models = {}
        self.blps = {}
        self.info = load_dbc("CreatureDisplayInfo")
        self.mdata = load_dbc("CreatureModelData")
        self.extra = load_dbc("CreatureDisplayInfoExtra")
        if not (self.info and self.mdata):
            raise RuntimeError("Missing CreatureDisplayInfo/CreatureModelData - "
                               "run extract_dbc_multi.py again")
        self.info_rows = {r[0]: r for r in self.info.rows}
        self.mdata_rows = {r[0]: r for r in self.mdata.rows}
        self.extra_rows = {r[0]: r for r in self.extra.rows} if self.extra else {}
        self.bake_idx = None
        if self.extra:
            best = {}
            for r in self.extra.rows[:2000]:
                for i in range(self.extra.fc):
                    if "bakednpc" in self.extra.s(r[i]).lower():
                        best[i] = best.get(i, 0) + 1
            if best:
                self.bake_idx = max(best, key=best.get)

    def blp(self, path):
        key = path.lower()
        if key in self.blps:
            return self.blps[key]
        data = self.read(path)
        tex = None
        if data:
            try:
                tex = wow_m2.load_blp(data)
            except Exception:
                tex = None
        if len(self.blps) > 400:
            self.blps.clear()
        self.blps[key] = tex
        return tex

    def model(self, path):
        key = path.lower()
        if key not in self.models:
            data = self.read(path)
            if not data and path.lower().endswith(".mdx"):
                data = self.read(path[:-4] + ".m2")
            self.models[key] = wow_m2.M2(data) if data else None
            if len(self.models) > 120:
                self.models.pop(next(iter(self.models)))
        return self.models[key]

    def render(self, display_id):
        r = self.info_rows.get(display_id)
        if not r:
            raise ValueError("display id %d not in CreatureDisplayInfo" % display_id)
        md = self.mdata_rows.get(r[1])
        if not md:
            raise ValueError("model data %d missing" % r[1])
        path = self.mdata.s(md[2]).replace("/", "\\")
        if not path:
            raise ValueError("no model path")
        model = self.model(path)
        if model is None:
            raise ValueError("model file not found: " + path)
        folder = path.rsplit("\\", 1)[0]
        slots = {}
        for i, t in enumerate((11, 12, 13)):
            nm = self.info.s(r[6 + i]) if 6 + i < self.info.fc else ""
            if nm:
                tex = self.blp(folder + "\\" + nm + ".blp")
                if tex is not None:
                    slots[t] = tex
        humanoid = False
        ex = self.extra_rows.get(r[3]) if r[3] else None
        if ex and self.bake_idx is not None:
            bake = self.extra.s(ex[self.bake_idx])
            if bake:
                tex = self.blp(bake.replace("/", "\\"))
                if tex is not None:
                    slots[1] = tex
                    humanoid = True
        for ttype, tflags, tname in model.textures:
            if ttype == 0 and tname and tname.lower() not in slots:
                tex = self.blp(tname)
                if tex is not None:
                    slots[tname.lower()] = tex
        geo = None
        if humanoid or "\\character\\" in path.lower():
            geo = lambda sm, tu: sm["id"] == 0 or sm["id"] % 100 == 1
        return wow_m2.render_model(model, slots, out=SIZE, ss=3, geoset_ok=geo)


def main():
    import extract_maps
    log("Opening game archives ...")
    archives = extract_maps.open_archives()
    reader = lambda name: extract_maps.read_from(archives, name)
    rnd = Renderer(reader)

    log("Reading creatures from the database ...")
    conn = connect()
    cur = conn.cursor()
    ct = columns(cur, "creature_template")
    cur.execute("SELECT * FROM creature_template")
    mobs = cur.fetchall()
    conn.close()

    for sub in ("display", "small", "by_name"):
        try:
            os.makedirs(os.path.join(PORTRAIT_DIR, sub))
        except OSError:
            pass

    todo = []
    for r in mobs:
        disp = 0
        for k in ("displayid1", "displayid2", "displayid3", "displayid4"):
            v = g(r, ct, k, 0)
            if v and v in rnd.info_rows:
                disp = v
                break
        todo.append((g(r, ct, "entry"), g(r, ct, "name", ""), disp))
    displays = sorted(set(d for _, _, d in todo if d))
    log("Creatures: %d   distinct displays to render: %d" % (len(todo), len(displays)))

    failed = []
    t0 = time.time()
    done = 0
    for n, d in enumerate(displays, 1):
        big = os.path.join(PORTRAIT_DIR, "display", "%d.png" % d)
        small = os.path.join(PORTRAIT_DIR, "small", "%d.png" % d)
        if os.path.exists(big) and os.path.exists(small):
            continue
        try:
            img = rnd.render(d)
            img.save(big)
            img.resize((64, 64), wow_m2.Image.LANCZOS).save(small)
            done += 1
        except Exception as exc:
            failed.append("%d: %s" % (d, str(exc)[:120]))
        if n % 50 == 0:
            el = time.time() - t0
            left = (len(displays) - n) * el / max(n, 1)
            log("  %d / %d displays   (%d failed)   about %d min left"
                % (n, len(displays), len(failed), left / 60))

    log("Writing one named file per creature ...")
    import shutil
    for entry, name, d in todo:
        src = os.path.join(PORTRAIT_DIR, "display", "%d.png" % d)
        if d and os.path.exists(src):
            dst = os.path.join(PORTRAIT_DIR, "by_name", "%d_%s.png" % (entry, safe(name)))
            if not os.path.exists(dst):
                shutil.copyfile(src, dst)
    with open(os.path.join(PORTRAIT_DIR, "failed.txt"), "w") as f:
        f.write("\n".join(failed))
    log("Done. Rendered %d new displays, %d failed (see failed.txt)." % (done, len(failed)))
    log("Portraits are in %s. Now run:  py wow_mobs.py" % PORTRAIT_DIR)


if __name__ == "__main__":
    run(main)
