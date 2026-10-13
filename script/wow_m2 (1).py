# -*- coding: utf-8 -*-
"""
Vanilla (1.12) model reader + small software renderer for creature portraits.
Python 3.8 + numpy + pillow.
"""
import io
import math
import struct

import numpy as np
from PIL import Image


class M2(object):
    def __init__(self, data):
        self.d = data
        if data[:4] != b"MD20":
            raise ValueError("not a model file")
        w = struct.unpack_from("<90I", data, 0)
        self.w = w
        self.name = self._cstr(w[3], w[2])
        self.nverts, self.ofs_verts = w[17], w[18]
        self.nviews, self.ofs_views = w[19], w[20]
        self.ntex, self.ofs_tex = w[23], w[24]
        self.ntransp, self.ofs_transp = w[25], w[26]
        self.nrend, self.ofs_rend = w[33], w[34]
        self.ntexlook, self.ofs_texlook = w[37], w[38]
        self.ncam, self.ofs_cam = w[73], w[74]
        self.ncamlook, self.ofs_camlook = w[75], w[76]
        self.bbox = struct.unpack_from("<6f", data, 45 * 4)
        self._read_vertices()
        self._read_textures()
        self._read_view(0)
        self._read_camera()

    def _cstr(self, ofs, n):
        return self.d[ofs:ofs + max(0, n - 1)].decode("latin-1", "ignore")

    def _read_vertices(self):
        n = self.nverts
        raw = np.frombuffer(self.d, dtype=np.dtype([
            ("pos", "<f4", 3), ("bw", "u1", 4), ("bi", "u1", 4), ("nrm", "<f4", 3),
            ("uv", "<f4", 2), ("uv2", "<f4", 2)]), count=n, offset=self.ofs_verts)
        self.pos = raw["pos"].astype(np.float64)
        self.nrm = raw["nrm"].astype(np.float64)
        self.uv = raw["uv"].astype(np.float64)

    def _read_textures(self):
        self.textures = []      # (type, flags, filename)
        for i in range(self.ntex):
            t, fl, ln, ofs = struct.unpack_from("<4I", self.d, self.ofs_tex + i * 16)
            self.textures.append((t, fl, self._cstr(ofs, ln) if ln else ""))
        self.texlookup = list(struct.unpack_from("<%dH" % self.ntexlook, self.d, self.ofs_texlook))
        self.renderflags = [struct.unpack_from("<2H", self.d, self.ofs_rend + i * 4)
                            for i in range(self.nrend)]

    def _read_view(self, idx):
        d = self.d
        (ni, oi, nt, ot, np_, op, ns, os_, ntu, otu, lod) = struct.unpack_from(
            "<11I", d, self.ofs_views + idx * 44)
        self.indices = np.frombuffer(d, dtype="<u2", count=ni, offset=oi)
        self.tris = np.frombuffer(d, dtype="<u2", count=nt, offset=ot)
        self.submeshes = []
        for i in range(ns):
            v = struct.unpack_from("<10H3f", d, os_ + i * 32)
            self.submeshes.append({"id": v[0], "vstart": v[2], "vcount": v[3],
                                   "istart": v[4], "icount": v[5]})
        self.texunits = []
        for i in range(ntu):
            v = struct.unpack_from("<12H", d, otu + i * 24)
            self.texunits.append({"flags": v[0], "shading": v[1], "sub": v[2],
                                  "color": v[4], "render": v[5], "mode": v[7],
                                  "tex": v[8], "transp": v[10]})

    def _read_camera(self):
        self.camera = None
        d = self.d
        if not self.ncam:
            return
        lookup = struct.unpack_from("<%dh" % self.ncamlook, d, self.ofs_camlook) if self.ncamlook else []
        idx = lookup[0] if lookup and lookup[0] >= 0 else 0
        base = self.ofs_cam + idx * 0x7c
        ctype, fov, far, near = struct.unpack_from("<I3f", d, base)
        pos = struct.unpack_from("<3f", d, base + 44)
        tgt = struct.unpack_from("<3f", d, base + 84)
        self.camera = {"type": ctype, "fov": fov, "far": far, "near": near, "pos": pos, "target": tgt}

    def triangles_for(self, tu):
        """vertex-index triples (K,3) for one texture unit"""
        sm = self.submeshes[tu["sub"]]
        t = self.tris[sm["istart"]:sm["istart"] + sm["icount"]]
        t = t[:len(t) // 3 * 3].reshape(-1, 3)
        return self.indices[t].astype(np.int64)


def load_blp(data):
    im = Image.open(io.BytesIO(data))
    im.load()
    return np.asarray(im.convert("RGBA"), dtype=np.float64) / 255.0


def look_at(eye, target, up=(0, 0, 1)):
    eye, target, up = (np.array(x, dtype=np.float64) for x in (eye, target, up))
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, up)
    if np.linalg.norm(r) < 1e-6:
        r = np.array([0.0, 1.0, 0.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return eye, r, u, f


class Canvas(object):
    def __init__(self, size):
        self.size = size
        self.color = np.zeros((size, size, 4))
        self.depth = np.full((size, size), np.inf)


def draw_batch(canvas, cam, verts, normals, uvs, tris, tex, blend, light_dir, two_sided=True):
    """verts (N,3) in model space; tris (K,3). tex: HxWx4 float or None."""
    size = canvas.size
    eye, r, u, f = cam["basis"]
    fovy = cam["fov"]
    near = cam["near"]
    rel = verts - eye
    x, y, z = rel @ r, rel @ u, rel @ f
    ok = z > near
    t = math.tan(fovy / 2.0)
    zz = np.where(ok, z, 1.0)
    sx = (x / (zz * t) * 0.5 + 0.5) * size
    sy = (0.5 - y / (zz * t) * 0.5) * size
    inv_w = 1.0 / zz
    # lighting per vertex: headlight + fixed key light
    nl = normals @ light_dir
    lam = np.clip(nl, 0.0, 1.0)
    shade = 0.45 + 0.65 * lam
    H, W = (tex.shape[0], tex.shape[1]) if tex is not None else (1, 1)
    for a, b, c in tris:
        if not (ok[a] and ok[b] and ok[c]):
            continue
        x0, y0, x1, y1, x2, y2 = sx[a], sy[a], sx[b], sy[b], sx[c], sy[c]
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if abs(area) < 1e-9:
            continue
        minx = max(int(math.floor(min(x0, x1, x2))), 0)
        maxx = min(int(math.ceil(max(x0, x1, x2))), size - 1)
        miny = max(int(math.floor(min(y0, y1, y2))), 0)
        maxy = min(int(math.ceil(max(y0, y1, y2))), size - 1)
        if minx > maxx or miny > maxy:
            continue
        px = np.arange(minx, maxx + 1) + 0.5
        py = np.arange(miny, maxy + 1) + 0.5
        PX, PY = np.meshgrid(px, py)
        w0 = ((x1 - PX) * (y2 - PY) - (x2 - PX) * (y1 - PY)) / area
        w1 = ((x2 - PX) * (y0 - PY) - (x0 - PX) * (y2 - PY)) / area
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue
        # perspective-correct
        iw = w0 * inv_w[a] + w1 * inv_w[b] + w2 * inv_w[c]
        zdepth = 1.0 / np.where(iw > 0, iw, 1e-9)
        sub_depth = canvas.depth[miny:maxy + 1, minx:maxx + 1]
        test = inside & (zdepth < sub_depth)
        if not test.any():
            continue
        pw0, pw1, pw2 = w0 * inv_w[a] / iw, w1 * inv_w[b] / iw, w2 * inv_w[c] / iw
        if tex is not None:
            u_ = pw0 * uvs[a, 0] + pw1 * uvs[b, 0] + pw2 * uvs[c, 0]
            v_ = pw0 * uvs[a, 1] + pw1 * uvs[b, 1] + pw2 * uvs[c, 1]
            tx = np.clip(((u_ % 1.0) * W).astype(np.int64), 0, W - 1)
            ty = np.clip(((v_ % 1.0) * H).astype(np.int64), 0, H - 1)
            col = tex[ty, tx]
        else:
            col = np.ones(PX.shape + (4,))
        sh = pw0 * shade[a] + pw1 * shade[b] + pw2 * shade[c]
        rgb = np.clip(col[..., :3] * sh[..., None], 0, 1)
        alpha = col[..., 3]
        if blend == 0:
            alpha = np.ones_like(alpha)
        elif blend == 1:
            test = test & (alpha >= 0.5)
            alpha = np.ones_like(alpha)
        if blend in (3, 4):
            continue
        reg = canvas.color[miny:maxy + 1, minx:maxx + 1]
        if blend == 2:
            m = test & (alpha > 0.02)
            a_ = alpha[m][:, None]
            reg[m, :3] = reg[m, :3] * (1 - a_) + rgb[m] * a_
            reg[m, 3] = np.maximum(reg[m, 3], alpha[m])
            # keep depth for translucent only where nearly opaque
            hard = m & (alpha > 0.9)
            sub_depth[hard] = zdepth[hard]
        else:
            reg[test, :3] = rgb[test]
            reg[test, 3] = 1.0
            sub_depth[test] = zdepth[test]


def _auto_frame(model, cam):
    """In bind pose the model camera often misses the head of upright
    creatures. If so, re-aim at the head (top of the body)."""
    P = model.pos
    lo = np.percentile(P, 2, axis=0)
    hi = np.percentile(P, 98, axis=0)
    h = hi[2] - lo[2]
    wx = hi[0] - lo[0]
    if h <= 0:
        return cam
    tgt = np.array(cam["target"], dtype=np.float64)
    pos = np.array(cam["pos"], dtype=np.float64)
    frac = (tgt[2] - lo[2]) / h
    up = P[:, 2] > hi[2] - 0.40 * h
    xs = P[up, 0]
    fw = up.copy()
    fw[up] = xs >= np.percentile(xs, 65)
    hx, hy, hz = np.median(P[fw, 0]), np.median(P[fw, 1]), np.median(P[fw, 2])
    head = np.array([hx, hy, hz])
    fwd = tgt - pos
    fwd /= np.linalg.norm(fwd)
    rel = head - pos
    zc = rel @ fwd
    off = np.linalg.norm(rel - zc * fwd) / max(zc, 1e-6)
    miss = zc <= 0 or off > math.tan(cam["fov"] / 2.0) * 1.0
    if h >= 0.7 * wx and miss:
        nt = head
        d = pos - tgt
        dh = np.array([d[0], d[1], 0.0])
        dh /= max(np.linalg.norm(dh), 1e-6)
        dirv = dh * 0.98 + np.array([0, 0, 0.10])
        dirv /= np.linalg.norm(dirv)
        dist = (0.30 * h) / math.tan(cam["fov"] / 2.0)
        cam = dict(cam)
        cam["target"] = tuple(nt)
        cam["pos"] = tuple(nt + dirv * dist)
    return cam


def render_model(model, slot_textures, out=128, ss=3, bg=(24, 24, 28), geoset_ok=None,
                 camera_override=None):
    """slot_textures: dict {texture type or filename: HxWx4 array}.
    returns PIL image (out x out, RGB)"""
    size = out * ss
    canvas = Canvas(size)
    cam = dict(model.camera) if model.camera else None
    if camera_override:
        cam = dict(camera_override)
    if cam is None:
        bb = model.bbox
        cx, cy, cz = (bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2
        rad = max(bb[3] - bb[0], bb[5] - bb[2]) * 0.8
        cam = {"fov": 0.95, "near": 0.2, "far": 100.0, "pos": (cx + rad * 1.5, cy + rad * 0.5, cz),
               "target": (cx + (bb[3] - bb[0]) * 0.2, cy, cz)}
    cam = _auto_frame(model, cam)
    cam["basis"] = look_at(cam["pos"], cam["target"])
    eye, r, u, f = cam["basis"]
    light = -(f * 0.8) + u * 0.4 + r * -0.3
    light /= np.linalg.norm(light)
    # draw order: opaque / alphakey first, then alpha blended
    units = []
    for tu in model.texunits:
        rf = model.renderflags[tu["render"]] if tu["render"] < len(model.renderflags) else (0, 0)
        units.append((rf[1], tu))
    units.sort(key=lambda t: (t[0] == 2, t[0]))
    for blend, tu in units:
        if geoset_ok is not None and not geoset_ok(model.submeshes[tu["sub"]], tu):
            continue
        lk = model.texlookup[tu["tex"]] if tu["tex"] < len(model.texlookup) else 0
        ttype, tflags, tname = model.textures[lk]
        tex = slot_textures.get(tname.lower() if ttype == 0 else ttype)
        if tex is None and ttype == 0 and tname:
            tex = slot_textures.get(tname.lower())
        if tex is None:
            continue
        tris = model.triangles_for(tu)
        draw_batch(canvas, cam, model.pos, model.nrm, model.uv, tris, tex, blend, light)
    col = canvas.color
    a = col[..., 3:4]
    bgc = np.array(bg, dtype=np.float64) / 255.0
    rgb = col[..., :3] * a + bgc * (1 - a)
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB")
    return img.resize((out, out), Image.LANCZOS)
