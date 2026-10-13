"""make_hd_maps.py - high resolution overlays for the zone maps, from the
"WoW Classic High-res Terrain Maps of Azeroth" pack (highresterrainmaps.zip).

Every output picture covers exactly the same world rectangle as the normal map with the same name
(maps/<name>.png), so the game draws it 1:1 over the old one. Written to maps_hd/<name>.jpg plus
maps_hd/index.json (the list the game reads).

    py make_hd_maps.py "C:\\Downloads\\highresterrainmaps.zip"
    py make_hd_maps.py "C:\\Downloads\\WoW Classic High-res Terrain Maps of Azeroth"     (an unpacked folder)

How the pictures line up with the world (measured once by matching the steep terrain of the collision
grid against the pictures): the continent pictures are the minimap tiles, 256 pixels per map tile
(16 pixels per 33.33 yard chunk); pixel x = 16 * (17066.67 - world y) / 33.33 + BX,
pixel y = 16 * (17066.67 - world x) / 33.33 + BY. The zone pictures are crops of the continent ones
with the surroundings darkened; ZONE_AT holds where each crop sits in its continent picture.
"""
import json, os, sys, zipfile, tempfile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ORIGIN, CHUNK, PX = 17066.66656, 33.333333125, 16.0
CAL = {0: ("eastern_kingdoms", -5525.0, -4775.0), 1: ("kalimdor", -5611.0, -2222.0)}
PREFIX = "wow_classic_high_resolution_world_terrain_map_"
SEA = (7, 29, 41)
MAX_SIDE = 4096
# top-left corner of each zone picture inside its continent picture (pixels)
ZONE_AT = {
    "ashenvale": (1915, 3862), "azshara": (4313, 3428), "darkshore": (2076, 1938), "desolace": (912, 5704),
    "durotar": (4243, 4778), "dustwallow_marsh": (3674, 6962), "felwood": (2612, 2593), "feralas": (539, 7009),
    "hyjal": (3006, 2989), "moonglade": (3537, 2054), "mulgore": (2229, 6089), "silithus": (1256, 8790),
    "stonetalon_mountains": (1365, 4436), "tanaris": (3321, 8731), "teldrassil": (932, 216), "the_barrens": (2953, 5012),
    "thousand_needles": (2849, 7811), "ungoro_crater": (2588, 8811), "winterspring": (3538, 1811),
    "arathi_highlands": (3252, 3546), "badlands": (3585, 6233), "burning_steppes": (2854, 6896), "deadwind_pass": (3370, 8206),
    "dun_morogh": (1987, 5385), "duskwood": (2310, 8150), "eastern_plaguelands": (3752, 1524), "elwynn_forest": (1919, 7232),
    "hillsbrad_foothills": (2266, 2864), "loch_modan": (3743, 5564), "redridge_mountains": (3428, 7534), "searing_gorge": (2957, 6426),
    "silverpine_forest": (1540, 2664), "stranglethorn_vale": (2127, 8794), "swamp_of_sorrows": (3727, 7985),
    "the_blasted_lands": (3770, 8494), "the_hinterlands": (3422, 2717), "tirisfal_glades": (1731, 1837),
    "western_plaguelands": (3011, 1825), "westfall": (1554, 7954), "wetlands": (2819, 4541),
}
ALIAS = {"blasted_lands": "the_blasted_lands", "un'goro_crater": "ungoro_crater"}


def log(t): print(t, flush=True)


VIGNETTE = True          # darken the land outside the zone a little (like the zone pictures of the pack)
EXTRA = {"Durotar": ["Orgrimmar"], "Mulgore": ["Thunder Bluff"], "Teldrassil": ["Darnassus"], "Elwynn Forest": ["Stormwind City"],
         "Feralas": ["Dire Maul"], "Silithus": ["Gates of Ahn'Qiraj"], "Dun Morogh": ["Ironforge"], "Tirisfal Glades": ["Undercity"]}


def load_zone_rasters():
    try:
        import numpy as np
    except Exception:
        return None
    meta = json.load(open(os.path.join(ROOT, "gamedata", "zonemap.json")))
    out = {}
    for name, info in meta["maps"].items():
        a = np.asarray(Image.open(os.path.join(ROOT, "gamedata", "zonemap_%s.png" % name)))
        if a.ndim == 3: a = a[..., 0]
        out[info["map"]] = (a, {z[2]: z[0] for z in info["zones"]})
    return out


def shade_outside(pic, m, zr):
    import numpy as np
    from PIL import ImageFilter
    if m.get("cont") or m["map"] not in zr: return pic
    a, ids = zr[m["map"]]
    want = [ids[n] for n in [m["name"]] + EXTRA.get(m["name"], []) if n in ids]
    if not want or m.get("area", 0) > 1000: return pic                       # cities: as they are
    W, H = pic.size
    ys = m["yl"] - (np.arange(W) + 0.5) / W * (m["yl"] - m["yr"]); xs = m["xt"] - (np.arange(H) + 0.5) / H * (m["xt"] - m["xb"])
    col = np.clip(((ORIGIN - ys) / CHUNK).astype(int), 0, a.shape[1] - 1); row = np.clip(((ORIGIN - xs) / CHUNK).astype(int), 0, a.shape[0] - 1)
    inside = np.isin(a[row[:, None], col[None, :]], want)
    mask = Image.fromarray((inside * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(radius=max(4, W / 120)))
    dark = Image.eval(pic, lambda v: int(v * 0.55))
    return Image.composite(pic, dark, mask)


def find_dir(src):
    if os.path.isdir(src):
        for d, _, files in os.walk(src):
            if any(f.startswith(PREFIX) for f in files): return d
        return None
    tmp = tempfile.mkdtemp(prefix="hdmaps_")
    with zipfile.ZipFile(src) as z:
        for n in z.namelist():
            if os.path.basename(n).startswith(PREFIX) and "__MACOSX" not in n: z.extract(n, tmp)
    return find_dir(tmp)


def main():
    if len(sys.argv) < 2: log(__doc__); return
    src = find_dir(sys.argv[1])
    if not src: log("No high-res terrain maps found in " + sys.argv[1]); return
    t = open(os.path.join(ROOT, "gamedata", "mobmap_data.js"), encoding="utf-8").read()
    data = json.loads(t[t.index("=") + 1:].strip().rstrip(";"))
    out = os.path.join(ROOT, "maps_hd"); os.makedirs(out, exist_ok=True)
    zr = load_zone_rasters() if VIGNETTE else None
    cont_img = {}
    done = []
    for m in data["maps"]:
        if m["map"] not in CAL: continue
        cname, bx, by = CAL[m["map"]]
        if cname not in cont_img:
            log("loading " + cname + " ...")
            cont_img[cname] = Image.open(os.path.join(src, PREFIX + cname + ".png")).convert("RGB")
        C = cont_img[cname]
        x0 = PX * (ORIGIN - m["yl"]) / CHUNK + bx; x1 = PX * (ORIGIN - m["yr"]) / CHUNK + bx
        y0 = PX * (ORIGIN - m["xt"]) / CHUNK + by; y1 = PX * (ORIGIN - m["xb"]) / CHUNK + by
        key = m["name"].lower().replace(" ", "_"); key = ALIAS.get(key, key)
        zfile = os.path.join(src, PREFIX + key + ".png")
        orig = os.path.join(ROOT, m["file"])
        ow, oh = Image.open(orig).size if os.path.isfile(orig) else (1002, 668)
        w, h = x1 - x0, y1 - y0
        scale = min(1.0, MAX_SIDE / max(w, h))
        tw, th = max(ow, int(round(w * scale))), max(oh, int(round(h * scale)))
        if w * h > 40e6:      # a whole continent: shrink the source first
            k = scale; Cs = C.resize((int(C.width * k), int(C.height * k)), Image.LANCZOS)
            canvas = Image.new("RGB", (int(w * k) + 2, int(h * k) + 2), SEA)
            canvas.paste(Cs, (int(round(-x0 * k)), int(round(-y0 * k))))
            pic = canvas.crop((0, 0, tw, th)) if canvas.size[0] >= tw and canvas.size[1] >= th else canvas.resize((tw, th))
            name = os.path.splitext(os.path.basename(m["file"]))[0] + ".jpg"
            pic.save(os.path.join(out, name), "JPEG", quality=86, optimize=True)
            done.append(name); log("%-22s %5dx%-5d (continent)" % (m["name"], tw, th)); continue
        # the continent picture, with the darkened zone picture on top of it where there is one
        ix0, iy0, ix1, iy1 = int(x0) - 1, int(y0) - 1, int(x1) + 2, int(y1) + 2
        canvas = Image.new("RGB", (ix1 - ix0, iy1 - iy0), SEA)
        cx0, cy0, cx1, cy1 = max(0, ix0), max(0, iy0), min(C.width, ix1), min(C.height, iy1)
        if cx1 > cx0 and cy1 > cy0: canvas.paste(C.crop((cx0, cy0, cx1, cy1)), (cx0 - ix0, cy0 - iy0))
        pic = canvas.transform((tw, th), Image.EXTENT, (x0 - ix0, y0 - iy0, x1 - ix0, y1 - iy0), Image.BICUBIC)
        if VIGNETTE and zr is not None: pic = shade_outside(pic, m, zr)
        name = os.path.splitext(os.path.basename(m["file"]))[0] + ".jpg"
        pic.save(os.path.join(out, name), "JPEG", quality=86, optimize=True)
        done.append(name); log("%-22s %5dx%-5d (%.1fx the normal map)" % (m["name"], tw, th, tw / ow))
    json.dump({"files": done, "note": "made by script/make_hd_maps.py - same world area as maps/<name>.png"}, open(os.path.join(out, "index.json"), "w"), indent=1)
    log("Wrote %d pictures to %s" % (len(done), out))


if __name__ == "__main__":
    main()
