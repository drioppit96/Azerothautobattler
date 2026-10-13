# -*- coding: utf-8 -*-
"""
Step 1 for mob portraits.  The portrait you see in the game is NOT a stored
picture - the game draws the creature's 3D model live. To rebuild that, I need to
look at a few real model files from your client first.

This script collects a handful of sample creatures (their 3D model + textures +
the database rows that link them) into  C:\\wow excel\\samples.zip
-> upload that zip file to me.

Needs wow_common.py + extract_maps.py in the same folder, the SPP Database window
open, mpyq installed.      Run:  py probe_models.py
"""
import os
import re
import zipfile

from wow_common import *   # noqa
from extract_maps import open_archives, read_from

SAMPLES = os.path.join(OUT_FOLDER, "samples")
NAMES = ["Small Crag Boar", "Young Wolf", "Forest Spider", "Defias Pillager", "Murloc Tidehunter",
         "Kobold Vermin", "Hogger", "Stormwind Guard"]
DBCS = ["CreatureDisplayInfo", "CreatureModelData", "CreatureDisplayInfoExtra"]


def describe(d, row):
    out = []
    for i, v in enumerate(row):
        s = d.s(v) if v else ""
        out.append("  f%02d = %d%s" % (i, v, ("   '%s'" % s) if s else ""))
    return "\n".join(out)


def main():
    try:
        os.makedirs(SAMPLES)
    except OSError:
        pass
    archives = open_archives()
    log("Archives opened: %s" % ", ".join(n for n, _ in archives))

    # 1) the three DBC tables that link creatures to models
    try:
        os.makedirs(DBC_DIR)
    except OSError:
        pass
    for n in DBCS:
        data = read_from(archives, "DBFilesClient\\%s.dbc" % n)
        if data and data[:4] == b"WDBC":
            with open(os.path.join(DBC_DIR, n + ".dbc"), "wb") as f:
                f.write(data)
            log("  extracted %s.dbc (%d bytes)" % (n, len(data)))
        else:
            log("  NOT FOUND: %s.dbc" % n)
    cdi = load_dbc("CreatureDisplayInfo")
    cmd = load_dbc("CreatureModelData")
    cdx = load_dbc("CreatureDisplayInfoExtra")
    if not cdi or not cmd:
        return
    cdi_rows = {r[0]: r for r in cdi.rows}
    cmd_rows = {r[0]: r for r in cmd.rows}
    cdx_rows = {r[0]: r for r in cdx.rows} if cdx else {}

    # 2) display ids of the sample creatures
    conn = connect()
    cur = conn.cursor()
    report = []
    files = []
    for name in NAMES:
        cur.execute("SELECT Entry e, Name n, DisplayId1 d FROM creature_template WHERE Name = %s LIMIT 1", (name,))
        r = cur.fetchone()
        if not r:
            log("  (no creature named %s)" % name)
            continue
        disp = r["d"]
        row = cdi_rows.get(disp)
        report.append("=== %s  entry=%d  display=%d ===" % (name, r["e"], disp))
        if not row:
            report.append("  no CreatureDisplayInfo row")
            continue
        report.append("CreatureDisplayInfo row:\n" + describe(cdi, row))
        model_row = cmd_rows.get(row[1])
        if model_row:
            report.append("CreatureModelData row:\n" + describe(cmd, model_row))
        extra = cdx_rows.get(row[3]) if row[3] else None
        if extra:
            report.append("CreatureDisplayInfoExtra row:\n" + describe(cdx, extra))
        sub = os.path.join(SAMPLES, re.sub(r"[^A-Za-z0-9]+", "_", name))
        try:
            os.makedirs(sub)
        except OSError:
            pass
        # model path = first string field of the model-data row that ends in .mdx/.m2
        mpath = ""
        if model_row:
            for v in model_row:
                s = cmd.s(v) if v else ""
                if s.lower().endswith((".mdx", ".m2")):
                    mpath = s
                    break
        wanted = []
        if mpath:
            wanted.append(mpath)
            report.append("model file: %s" % mpath)
            folder = mpath.rsplit("\\", 1)[0] if "\\" in mpath else ""
            for i in range(6, 9):
                s = cdi.s(row[i]) if row[i] else ""
                if s:
                    wanted.append(folder + "\\" + s + ".blp")
        if extra:
            for v in extra:
                s = cdx.s(v) if v else ""
                if s:
                    wanted.append("Textures\\BakedNpcTextures\\" + s)
        got_model = None
        for path in wanted:
            data = read_from(archives, path)
            if not data and path.lower().endswith(".mdx"):
                data = read_from(archives, path[:-4] + ".m2")
            if data:
                fn = os.path.join(sub, path.replace("\\", "__"))
                with open(fn, "wb") as f:
                    f.write(data)
                files.append(fn)
                report.append("  saved %s (%d bytes)" % (path, len(data)))
                if path.lower().endswith(".mdx"):
                    got_model = data
            else:
                report.append("  MISSING in archives: %s" % path)
        # every .blp named inside the model file
        if got_model:
            for m in set(re.findall(rb"[A-Za-z0-9_\\\- ]+\.blp", got_model)):
                path = m.decode("ascii", "ignore")
                data = read_from(archives, path)
                if data:
                    fn = os.path.join(sub, "tex__" + path.replace("\\", "__"))
                    if not os.path.exists(fn):
                        with open(fn, "wb") as f:
                            f.write(data)
                        files.append(fn)
                        report.append("  texture inside model: %s (%d bytes)" % (path, len(data)))
        report.append("")
    conn.close()

    rp = os.path.join(SAMPLES, "report.txt")
    with open(rp, "w") as f:
        f.write("\n".join(report))
    zp = os.path.join(OUT_FOLDER, "samples.zip")
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(rp, "report.txt")
        for fn in files:
            z.write(fn, os.path.relpath(fn, SAMPLES))
        for n in DBCS:
            p = os.path.join(DBC_DIR, n + ".dbc")
            if os.path.exists(p):
                z.write(p, "dbc/" + n + ".dbc")
    log("\nSaved %s  (%d model/texture files)" % (zp, len(files)))
    log("Please upload that zip file here.")


if __name__ == "__main__":
    run(main)
