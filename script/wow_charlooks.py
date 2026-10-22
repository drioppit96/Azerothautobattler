# -*- coding: utf-8 -*-
"""
Character looks: what the game needs to draw a player's portrait with the appearance chosen in character
creation (skin colour, face, hair style, hair colour, facial hair / tusks / horns ...), like the real game.

The real portrait is the 3D head of the character model. Here every piece of the model (body, each hair style,
each beard ...) is drawn ONCE from the portrait camera into a "where on the texture is this pixel" picture;
the game then paints the portrait for any combination of choices in a moment, in the browser or the app.

Output (into the game folder, uploaded with the rest):   C:\\wow excel\\charlooks\\
    looks.json                         the choices per race / gender (from CharSections, CharHairGeosets,
                                       CharacterFacialHairStyles) and the model pieces
    parts\\<race>_<sex>\\<piece>.png    the pieces as seen from the portrait camera
    tex\\<name>.png                     the skin, face, hair, beard and scalp textures used
    report.txt                         what was found

Needs: py -m pip install numpy pillow mpyq        (and wow_m2.py, wow_common.py, extract_maps.py next to it)
Run:   py wow_charlooks.py           then upload with upload_to_github.bat
"""
import hashlib
import json
import math
import os
import random
import re
import struct
import sys
import traceback

try:
    import numpy as np
    from wow_common import *   # noqa
    import wow_m2
    from wow_m2 import Image
except Exception:
    traceback.print_exc()
    print("\nStartup failed. Most likely fix:  py -m pip install numpy pillow mpyq")
    try:
        input("\nPress Enter to close ...")
    except Exception:
        pass
    sys.exit(1)

OUT = os.path.join(OUT_FOLDER, "charlooks")
SIZE = 192                     # the portrait pieces are drawn this big (the game shows them smaller)
RACES = {1: "Human", 2: "Orc", 3: "Dwarf", 4: "NightElf", 5: "Scourge", 6: "Tauren", 7: "Gnome", 8: "Troll"}
SEXES = {0: "Male", 1: "Female"}
DBCS = ["CharSections", "CharHairGeosets", "CharacterFacialHairStyles", "ChrRaces"]
REPORT = []


def rep(msg):
    REPORT.append(msg)
    log(msg)


# ------------------------------------------------------------------ the tables
class Table(object):
    """a DBC read straight from the archives"""
    def __init__(self, data):
        magic, rc, fc, rs, ss = struct.unpack("<4sIIII", data[:20])
        if magic != b"WDBC":
            raise ValueError("not a DBC")
        self.fc = fc
        self.strings = data[20 + rc * rs:20 + rc * rs + ss]
        self.rows = [struct.unpack_from("<%dI" % fc, data, 20 + i * rs) for i in range(rc)]

    def s(self, off):
        st = self.strings
        if off <= 0 or off >= len(st) or st[off - 1] != 0:
            return ""
        return st[off:st.find(b"\0", off)].decode("utf-8", "ignore")

    def string_cols(self):
        """columns that hold texture names in most rows"""
        out = []
        for i in range(self.fc):
            n = sum(1 for r in self.rows if r[i] > 64 and self.s(r[i]).lower().endswith(".blp"))
            distinct = len(set(r[i] for r in self.rows))
            # small numbers (race, sex, flags ...) can point at the first string by chance: a texture column has
            # many different values
            if n >= max(1, len(self.rows) // 20) and distinct >= min(20, max(2, len(self.rows) // 2)):
                out.append(i)
        return out


def char_sections(t):
    """CharSections 1.12: ID, Race, Sex, Section, Texture x3, Flags, Variation, Color (found by the string columns,
       so a slightly different layout still works). Section: 0 skin, 1 face, 2 facial hair, 3 hair, 4 underwear."""
    sc = t.string_cols()
    rep("CharSections: %d rows, %d fields, texture columns %s" % (len(t.rows), t.fc, sc))
    if len(sc) < 2 or sc[0] < 3:
        rep("  (texture columns not clear - using the 1.12 layout: 4, 5, 6)")
        sc = [4, 5, 6]
    first, last = sc[0], sc[-1]
    # the numbers before the textures: ID, race, sex, section; after: flags, variation, colour
    pre = list(range(first))
    post = list(range(last + 1, t.fc))
    out = []
    for r in t.rows:
        rec = {"tex": [t.s(r[i]) for i in range(first, last + 1)]}
        if first >= 6:
            # the 1.12 layout: ID, race, sex, section, variation, colour, textures x3, flags
            rec["race"], rec["sex"], rec["sec"], rec["var"], rec["col"] = r[1], r[2], r[3], r[4], r[5]
            rec["flags"] = r[post[0]] if post else 1
        else:
            # textures earlier: ID, race, sex, section, textures, flags, variation, colour
            rec["race"], rec["sex"], rec["sec"] = r[pre[-3]], r[pre[-2]], r[pre[-1]]
            rec["flags"] = r[post[0]] if len(post) >= 3 else 1
            rec["var"] = r[post[-2]] if len(post) >= 2 else 0
            rec["col"] = r[post[-1]] if post else 0
        out.append(rec)
    # sanity: playable races and sexes
    ok = sum(1 for x in out if x["race"] in RACES and x["sex"] in SEXES and 0 <= x["sec"] <= 4)
    rep("  rows that look right (race 1-8, sex 0-1, section 0-4): %d of %d" % (ok, len(out)))
    return out


# ------------------------------------------------------------------ the pieces as seen from the portrait camera
# framing per race/gender: (how much of the body height the view shows, head centre shift up in body heights)
FRAME = {}


def portrait_camera(model, key=""):
    """the model's portrait camera direction, aimed at the head (in the pose of the model file the camera of the
       model misses the head a little) and close enough that the head fills the picture"""
    cam = dict(model.camera) if model.camera else None
    if cam is None:
        cam = {"fov": 0.785, "near": 0.2, "far": 30.0, "pos": (1.0, -0.6, 1.8), "target": (0.0, 0.0, 1.8)}
    P = model.pos
    vs = [model.indices[s["vstart"]:s["vstart"] + s["vcount"]] for s in model.submeshes if s["id"] == 0]
    B = P[np.unique(np.concatenate(vs))] if vs else P
    top, bot = B[:, 2].max(), B[:, 2].min(); H = top - bot
    head = B[B[:, 2] > top - 0.14 * H]
    fr, dz = FRAME.get(key, (0.135, -0.005))
    tgt = head.mean(axis=0) + np.array([0.0, 0.0, dz * H])
    d = np.array(cam["pos"], dtype=np.float64) - np.array(cam["target"], dtype=np.float64)
    d /= max(np.linalg.norm(d), 1e-9)
    dist = fr * H / math.tan(cam["fov"] / 2.0)
    cam["target"] = tuple(tgt); cam["pos"] = tuple(tgt + d * dist); cam["near"] = min(cam.get("near", 0.2), dist * 0.3)
    cam["basis"] = wow_m2.look_at(cam["pos"], cam["target"])
    return cam


def uv_render(model, cam, tris, size):
    """for every pixel the nearest triangle of this piece: texture u, v, light, depth (NaN where empty)"""
    eye, r, u, f = cam["basis"]
    rel = model.pos - eye
    x, y, z = rel @ r, rel @ u, rel @ f
    ok = z > cam["near"]
    t = math.tan(cam["fov"] / 2.0)
    zz = np.where(ok, z, 1.0)
    sx = (x / (zz * t) * 0.5 + 0.5) * size
    sy = (0.5 - y / (zz * t) * 0.5) * size
    inv_w = 1.0 / zz
    light = -(f * 0.8) + u * 0.4 + r * -0.3
    light /= np.linalg.norm(light)
    shade = 0.45 + 0.65 * np.clip(model.nrm @ light, 0.0, 1.0)
    uvs = model.uv
    D = np.full((size, size), np.inf)
    U = np.zeros((size, size)); V = np.zeros((size, size)); S = np.zeros((size, size))
    for a, b, c in tris:
        if not (ok[a] and ok[b] and ok[c]):
            continue
        x0, y0, x1, y1, x2, y2 = sx[a], sy[a], sx[b], sy[b], sx[c], sy[c]
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if abs(area) < 1e-9:
            continue
        minx = max(int(math.floor(min(x0, x1, x2))), 0); maxx = min(int(math.ceil(max(x0, x1, x2))), size - 1)
        miny = max(int(math.floor(min(y0, y1, y2))), 0); maxy = min(int(math.ceil(max(y0, y1, y2))), size - 1)
        if minx > maxx or miny > maxy:
            continue
        PX, PY = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
        w0 = ((x1 - PX) * (y2 - PY) - (x2 - PX) * (y1 - PY)) / area
        w1 = ((x2 - PX) * (y0 - PY) - (x0 - PX) * (y2 - PY)) / area
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue
        iw = w0 * inv_w[a] + w1 * inv_w[b] + w2 * inv_w[c]
        zd = 1.0 / np.where(iw > 0, iw, 1e-9)
        sub = D[miny:maxy + 1, minx:maxx + 1]
        test = inside & (zd < sub)
        if not test.any():
            continue
        p0, p1, p2 = w0 * inv_w[a] / iw, w1 * inv_w[b] / iw, w2 * inv_w[c] / iw
        uu = p0 * uvs[a, 0] + p1 * uvs[b, 0] + p2 * uvs[c, 0]
        vv = p0 * uvs[a, 1] + p1 * uvs[b, 1] + p2 * uvs[c, 1]
        ss = p0 * shade[a] + p1 * shade[b] + p2 * shade[c]
        sub[test] = zd[test]
        U[miny:maxy + 1, minx:maxx + 1][test] = uu[test]
        V[miny:maxy + 1, minx:maxx + 1][test] = vv[test]
        S[miny:maxy + 1, minx:maxx + 1][test] = ss[test]
    return U, V, S, D


def model_pieces(model, cam):
    """the drawn pieces: (geoset id, texture type, blend) -> (U, V, S, D)"""
    pieces = {}
    for tu in model.texunits:
        sm = model.submeshes[tu["sub"]]
        rf = model.renderflags[tu["render"]] if tu["render"] < len(model.renderflags) else (0, 0)
        lk = model.texlookup[tu["tex"]] if tu["tex"] < len(model.texlookup) else 0
        ttype = model.textures[lk][0] if lk < len(model.textures) else 0
        if ttype == 2:          # the cape: not on a bare portrait
            continue
        key = (sm["id"], ttype, rf[1])
        U, V, S, D = uv_render(model, cam, model.triangles_for(tu), SIZE)
        if key in pieces:              # one geoset in several submeshes: keep the nearest of both
            U0, V0, S0, D0 = pieces[key]
            m = D < D0
            U0[m], V0[m], S0[m], D0[m] = U[m], V[m], S[m], D[m]
        else:
            pieces[key] = (U, V, S, D)
    return {k: v for k, v in pieces.items() if np.isfinite(v[3]).any()}


def save_piece(path, U, V, S, D, dmin, dmax):
    """RGBA, two halves side by side - left: R u, G v, B depth, A 255 where drawn; right: R light"""
    m = np.isfinite(D)
    img = np.zeros((SIZE, SIZE * 2, 4), dtype=np.uint8)
    uu = np.clip(np.floor((U % 1.0) * 256), 0, 255)
    vv = np.clip(np.floor((V % 1.0) * 256), 0, 255)
    dd = np.clip(1 + (np.where(m, D, dmax) - dmin) / max(1e-6, dmax - dmin) * 254, 1, 255)
    img[..., :SIZE, 0][m] = uu[m]; img[..., :SIZE, 1][m] = vv[m]; img[..., :SIZE, 2][m] = dd[m]; img[..., :SIZE, 3][m] = 255
    img[..., SIZE:, 0][m] = np.clip(S[m] / 1.2 * 255, 0, 255); img[..., SIZE:, 3][m] = 255
    Image.fromarray(img, "RGBA").save(path, optimize=True)


# ------------------------------------------------------------------ textures
class Textures(object):
    def __init__(self, read):
        self.read = read
        self.saved = {}
        self.cache = {}
        self.opaque = False
        os.makedirs(os.path.join(OUT, "tex"), exist_ok=True)

    def get(self, path):
        """RGBA float array of a client texture (or None)"""
        if not path:
            return None
        k = path.lower()
        if k not in self.cache:
            data = self.read(path.replace("/", "\\"))
            arr = None
            if data:
                try:
                    arr = wow_m2.load_blp(data)
                except Exception:
                    arr = None
            if len(self.cache) > 300:
                self.cache.clear()
            self.cache[k] = arr
        return self.cache[k]

    def name(self, path):
        """saves the texture as a PNG once; returns its file name (or '' when missing)"""
        if not path:
            return ""
        k = path.lower()
        if k in self.saved:
            return self.saved[k]
        arr = self.get(path)
        if arr is None:
            self.saved[k] = ""
            return ""
        stem = re.sub(r"[^a-z0-9_]+", "_", k.rsplit("\\", 1)[-1].rsplit(".", 1)[0])
        px = (np.clip(arr, 0, 1) * 255).astype(np.uint8)
        if px[..., 3].min() >= 250 or self.opaque:          # no see-through parts (the skins): a JPEG, much smaller
            fn = stem + "_" + hashlib.md5(k.encode()).hexdigest()[:6] + ".jpg"
            Image.fromarray(px[..., :3], "RGB").save(os.path.join(OUT, "tex", fn), quality=88)
        else:
            fn = stem + "_" + hashlib.md5(k.encode()).hexdigest()[:6] + ".png"
            Image.fromarray(px, "RGBA").save(os.path.join(OUT, "tex", fn), optimize=True)
        self.saved[k] = fn
        return fn


# ------------------------------------------------------------------ main
def main():
    import extract_maps
    log("Opening game archives ...")
    archives = extract_maps.open_archives()
    read = lambda name: extract_maps.read_from(archives, name)
    os.makedirs(os.path.join(OUT, "parts"), exist_ok=True)

    tabs = {}
    for n in DBCS:
        data = read("DBFilesClient\\%s.dbc" % n)
        if not data:
            rep("NOT FOUND: %s.dbc" % n)
            continue
        tabs[n] = Table(data)
        rep("%s.dbc: %d rows, %d fields" % (n, len(tabs[n].rows), tabs[n].fc))
    if "CharSections" not in tabs:
        raise RuntimeError("CharSections.dbc is missing - cannot continue")
    secs = char_sections(tabs["CharSections"])
    hairgeo = [list(r) for r in tabs["CharHairGeosets"].rows] if "CharHairGeosets" in tabs else []
    facial = [list(r) for r in tabs["CharacterFacialHairStyles"].rows] if "CharacterFacialHairStyles" in tabs else []
    rep("CharHairGeosets rows (first 3): %s" % hairgeo[:3])
    rep("CharacterFacialHairStyles rows (first 3): %s" % facial[:3])

    tex = Textures(read)
    looks = {"size": SIZE, "regions": {"faceUpper": [0, 160, 128, 32], "faceLower": [0, 192, 128, 64]},
             "hairGeosetsRaw": hairgeo, "facialRaw": facial, "races": {}}
    for race, rname in RACES.items():
        for sex, sname in SEXES.items():
            key = "%d_%d" % (race, sex)
            path = "Character\\%s\\%s\\%s%s.mdx" % (rname, sname, rname, sname)
            data = read(path) or read(path[:-4] + ".m2")
            if not data:
                rep("%s: model not found (%s)" % (key, path))
                continue
            try:
                model = wow_m2.M2(data)
                cam = portrait_camera(model, key)
                pieces = model_pieces(model, cam)
            except Exception as exc:
                rep("%s: could not draw the model: %s" % (key, exc))
                continue
            ds = [p[3][np.isfinite(p[3])] for p in pieces.values()]
            dmin = min(float(d.min()) for d in ds); dmax = max(float(d.max()) for d in ds)
            pdir = os.path.join(OUT, "parts", key); os.makedirs(pdir, exist_ok=True)
            plist = []
            for (gid, ttype, blend), (U, V, S, D) in sorted(pieces.items()):
                fn = "%d_%d_%d.png" % (gid, ttype, blend)
                save_piece(os.path.join(pdir, fn), U, V, S, D, dmin, dmax)
                plist.append({"geo": gid, "slot": ttype, "blend": blend, "file": fn, "px": int(np.isfinite(D).sum())})
            # the choices (playable ones: flags & 1; when no row has the flag, all)
            mine = [x for x in secs if x["race"] == race and x["sex"] == sex]
            # all of them, with their flags: which ones the original character creation offered is decided in the game
            play = mine
            fl = {}
            for x in mine:
                fl.setdefault((x["sec"], x.get("flags", 0)), 0); fl[(x["sec"], x.get("flags", 0))] += 1
            rep("  %s rows by (section, flags): %s" % (key, sorted(fl.items())))
            R = {"model": path, "pieces": plist, "skins": [], "faces": [], "facial": [], "hair": [],
                 "modelTextures": [[t, fl, n] for t, fl, n in model.textures]}
            for x in sorted(play, key=lambda q: (q["sec"], q.get("var", 0), q.get("col", 0))):
                t = []
                for i, p in enumerate(x["tex"]):
                    tex.opaque = x["sec"] == 0 and i == 0          # the skin base: never see-through (a JPEG)
                    t.append(tex.name(p))
                tex.opaque = False
                src = (x["tex"][0] or "").lower().rsplit("\\", 1)[-1]
                if x["sec"] == 0:
                    R["skins"].append({"col": x["col"], "base": t[0], "extra": t[1] if len(t) > 1 else "", "fl": x.get("flags", 0), "src": src})
                elif x["sec"] == 1:
                    R["faces"].append({"var": x["var"], "col": x["col"], "lower": t[0], "upper": t[1] if len(t) > 1 else "", "fl": x.get("flags", 0), "src": src})
                elif x["sec"] == 2:
                    R["facial"].append({"var": x["var"], "col": x["col"], "lower": t[0], "upper": t[1] if len(t) > 1 else "", "fl": x.get("flags", 0), "src": src})
                elif x["sec"] == 3:
                    R["hair"].append({"var": x["var"], "col": x["col"], "tex": t[0], "scalpLower": t[1] if len(t) > 1 else "", "scalpUpper": t[2] if len(t) > 2 else "", "fl": x.get("flags", 0), "src": src})
            R["hairGeosets"] = [r for r in hairgeo if len(r) >= 5 and r[1] == race and r[2] == sex]
            # CharacterFacialHairStyles 1.12: race, sex, variation, (3 unused), geosets x3 - kept as [race, sex, variation, g1, g2, g3]
            R["facialStyles"] = [[r[0], r[1], r[2]] + list(r[-3:]) for r in facial if len(r) >= 6 and r[0] == race and r[1] == sex]
            looks["races"][key] = R
            rep("%s %s %s: %d pieces, skins %d, faces %d, facial hair %d, hair %d" % (key, rname, sname, len(plist), len(R["skins"]),
                len(R["faces"]), len(R["facial"]), len(R["hair"])))
    with open(os.path.join(OUT, "looks.json"), "w", encoding="utf-8") as f:
        json.dump(looks, f, separators=(",", ":"))
    total = sum(os.path.getsize(os.path.join(a, b)) for a, _, fs in os.walk(OUT) for b in fs)
    rep("Written: %s (%.1f MB)" % (OUT, total / 1e6))
    with open(os.path.join(OUT, "report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(REPORT))
    log("Done. Upload with upload_to_github.bat (or tell Claude it is there).")


if __name__ == "__main__":
    run(main)
