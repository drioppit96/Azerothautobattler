# -*- coding: utf-8 -*-
"""
Builds the WEB VERSION of the game: one folder you can upload to any static web host
(Netlify Drop, GitHub Pages, itch.io ...) and open on a phone or PC. It is also what the
Android app (make_android.py) packs inside the APK.

Writes  C:\\wow excel\\web\\          the site (index.html, game\\, gamedata\\, maps\\, portraits\\, icons\\, files.json)
        C:\\wow excel\\web.zip        the same as one zip (for uploading)

Only what the included maps need is copied and the JSON is trimmed to it, so the site stays small:
creatures, loot, quests, items, spells, icons and portraits of those maps. Maps and portraits are
re-saved as JPEG when Pillow is installed (it is, if wow_navgrid.py ran).

Run:   py make_web.py                     (Durotar, Orgrimmar, The Barrens, Kalimdor)
       py make_web.py "Mulgore" "Thunder Bluff"   (extra zone maps from the maps folder)
       py make_web.py --root "D:\\other folder"
Then:  drag the  web  folder onto https://app.netlify.com/drop  (free) - you get an https link.
       On Android open the link in Chrome, menu > "Install app" / "Add to Home screen".
"""
import io
import json
import os
import re
import shutil
import sys
import time
import zipfile

ROOT = r"C:\wow excel"
MAPS = ["Durotar", "Orgrimmar", "The Barrens", "Kalimdor"]
DROP_JSON = {"mob_spells", "items_equip", "skinning", "gathering"}


def log(m):
    print(str(m).encode("ascii", "replace").decode("ascii"))
    sys.stdout.flush()


def load_json(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def dump(p, data):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)


def inside(m, x, y):
    return m["xb"] <= x <= m["xt"] and m["yr"] <= y <= m["yl"]


def main():
    args = sys.argv[1:]
    root = ROOT
    if "--root" in args:
        i = args.index("--root"); root = args[i + 1]; del args[i:i + 2]
    names = MAPS + [a for a in args if a not in MAPS and not a.startswith("--")]
    gd = os.path.join(root, "gamedata")
    web = os.path.join(root, "web")
    if os.path.isdir(web):
        shutil.rmtree(web)
    for d in ("game", "gamedata", "maps", "portraits/by_name", "icons"):
        os.makedirs(os.path.join(web, d))
    try:
        from PIL import Image
    except Exception:
        Image = None
        log("Pillow not found - images are copied as they are (bigger).")

    # ------------------------------------------------------------ maps
    t = open(os.path.join(gd, "mobmap_data.js"), encoding="utf-8").read()
    data = json.loads(t[t.index("=") + 1:].strip().rstrip(";"))
    maps = [m for m in data["maps"] if m["name"] in names and os.path.isfile(os.path.join(root, m["file"]))]
    missing = [n for n in names if n not in [m["name"] for m in maps]]
    if missing:
        log("Maps not found in the maps folder (skipped): " + ", ".join(missing))
    if not maps:
        log("No maps - nothing to build."); return
    map_ids = sorted(set(m["map"] for m in maps))
    zones = [m for m in maps if not m.get("cont")]
    log("Maps: %s  (continent ids %s)" % (", ".join(m["name"] for m in maps), map_ids))
    map_files = []
    for m in maps:
        src = os.path.join(root, m["file"])
        base = os.path.splitext(os.path.basename(src))[0]
        if Image:
            im = Image.open(src).convert("RGB")
            dst = base + ".jpg"; im.save(os.path.join(web, "maps", dst), "JPEG", quality=88, optimize=True)
        else:
            dst = os.path.basename(src); shutil.copy(src, os.path.join(web, "maps", dst))
        m["file"] = "maps/" + dst
        map_files.append(dst)

    # ------------------------------------------------------------ creatures
    spawns = load_json(os.path.join(gd, "spawns.json"))
    keep_sp = {}
    for e, lst in spawns["spawns"].items():
        l2 = [s for s in lst if s[0] in map_ids]
        if l2:
            keep_sp[e] = l2
    spawns["spawns"] = keep_sp
    ents = set(keep_sp)
    log("Creatures on these maps: %d" % len(ents))
    data["maps"] = maps
    data["mobs"] = [r for r in data["mobs"] if str(r[0]) in ents]
    data["objects"] = []
    data["graveyards"] = [g for g in data["graveyards"] if g[2] in map_ids]

    host = load_json(os.path.join(gd, "hostility.json"))
    host["creatures"] = {e: v for e, v in host["creatures"].items() if e in ents}

    loot = load_json(os.path.join(gd, "loot.json"))
    loot["creatures"] = {e: v for e, v in loot["creatures"].items() if e in ents}
    lids = set(str(v[6]) for v in loot["creatures"].values() if v[6])
    loot["tables"] = {"creature": {k: v for k, v in loot["tables"]["creature"].items() if k in lids}}
    item_ids = set()
    for rows in loot["tables"]["creature"].values():
        for r in rows:
            item_ids.add(r[0])
    loot["items"] = {k: v for k, v in loot["items"].items() if int(k) in item_ids}
    loot["quest_items"] = {k: v for k, v in loot.get("quest_items", {}).items() if int(k) in item_ids}
    loot.pop("fishing_areas", None)

    # ------------------------------------------------------------ quests
    quests = load_json(os.path.join(gd, "quests.json"))
    def on_map(lst):
        return any(k == "npc" and str(e) in ents for k, e in lst)
    quests = [q for q in quests if on_map(q["giver"]) or on_map(q["turnin"])]
    for q in quests:
        for a, n in q["reward_items"] + q["choice_items"]:
            item_ids.add(a)
        if q.get("start_item"):
            item_ids.add(q["start_item"])
        for o in q["objectives"]:
            if o["type"] == "Collect":
                item_ids.add(o["id"])
    log("Quests: %d" % len(quests))

    # ------------------------------------------------------------ vendors
    vend_items = {}
    p = os.path.join(gd, "vendor_items.json")
    if os.path.isfile(p):
        vend_items = {e: v for e, v in load_json(p).items() if e in ents}
        for v in vend_items.values():
            for it, mc in v:
                item_ids.add(it)
    vendors = [v for v in load_json(os.path.join(gd, "vendors.json")) if str(v["entry"]) in ents] if os.path.isfile(os.path.join(gd, "vendors.json")) else []
    for v in vendors:
        for it in v["items"]:
            item_ids.add(it["item"])
    for x in (37, 6125, 139, 40, 117, 159, 25, 2504, 4496, 118):
        item_ids.add(x)

    # game objects (quest objects, chests, herbs) of these maps
    p = os.path.join(gd, "objects.json")
    if os.path.isfile(p):
        objs = load_json(p)
        objs["objects"] = {e: [x for x in v if x[0] in map_ids] for e, v in objs["objects"].items()}
        objs["objects"] = {e: v for e, v in objs["objects"].items() if v}
        dump(os.path.join(web, "gamedata", "objects.json"), objs)
        p = os.path.join(gd, "go_data.json")
        if os.path.isfile(p):
            go = load_json(p)
            go["objects"] = {e: v for e, v in go["objects"].items() if e in objs["objects"]}
            lids = set(str(v[2]) for v in go["objects"].values() if v[2])
            go["loot"] = {k: v for k, v in go["loot"].items() if k in lids}
            for rows in go["loot"].values():
                for r in rows:
                    item_ids.add(r[0])
            dump(os.path.join(web, "gamedata", "go_data.json"), go)
        else:
            log("go_data.json not found - run  py build_gamedata.py goquest  so quests with objects work")
    # ------------------------------------------------------------ items + spells
    items = load_json(os.path.join(gd, "items.json"))
    it_all = items["items"]
    keep_items = {k: v for k, v in it_all.items() if int(k) in item_ids}
    rp_used = set(str(v["rp"]) for v in keep_items.values() if v.get("rp"))
    items["random_tmpl"] = {k: v for k, v in items["random_tmpl"].items() if k in rp_used}
    props_used = set(str(p_[0]) for v in items["random_tmpl"].values() for p_ in v)
    items["random_props"] = {k: v for k, v in items["random_props"].items() if k in props_used}
    items["items"] = keep_items
    log("Items: %d of %d" % (len(keep_items), len(it_all)))

    spells = load_json(os.path.join(gd, "spells.json"))
    sp_ids = set()
    for v in keep_items.values():
        for f in v.get("fx", []):
            sp_ids.add(str(f["id"]))
    for v in items["random_props"].values():
        for fx in v.get("fx", []):
            if fx[2]:
                sp_ids.add(str(fx[2]))
    keep_sp2 = {}
    for k, s in spells["spells"].items():
        if k in sp_ids or "class" in (s.get("src") or []) or s.get("cls"):
            keep_sp2[k] = s
    log("Spells: %d of %d" % (len(keep_sp2), len(spells["spells"])))
    spells["spells"] = keep_sp2
    spells.pop("mob_use", None)

    # ------------------------------------------------------------ navgraph (only these continents)
    ng = load_json(os.path.join(gd, "navgraph.json"))
    keep_nodes = [n for n in ng["nodes"] if n[2] in map_ids]
    nid = set(n[0] for n in keep_nodes)
    links, paths, remap = [], [], {}
    for L in ng["links"]:
        if L[0] in nid and L[1] in nid:
            L = list(L)
            if L[7] is not None and L[7] >= 0:
                if L[7] not in remap:
                    remap[L[7]] = len(paths); paths.append(ng["paths"][L[7]])
                L[7] = remap[L[7]]
            links.append(L)
    ng["nodes"], ng["links"], ng["paths"] = keep_nodes, links, paths
    log("Road network: %d nodes, %d links" % (len(keep_nodes), len(links)))

    # ------------------------------------------------------------ write gamedata
    out = os.path.join(web, "gamedata")
    dump(os.path.join(out, "spawns.json"), spawns)
    dump(os.path.join(out, "hostility.json"), host)
    dump(os.path.join(out, "loot.json"), loot)
    dump(os.path.join(out, "quests.json"), quests)
    dump(os.path.join(out, "items.json"), items)
    dump(os.path.join(out, "spells.json"), spells)
    dump(os.path.join(out, "navgraph.json"), ng)
    dump(os.path.join(out, "vendors.json"), vendors)
    if vend_items:
        dump(os.path.join(out, "vendor_items.json"), vend_items)
    p = os.path.join(gd, "creature_stats.json")
    if os.path.isfile(p):
        dump(os.path.join(out, "creature_stats.json"), {e: v for e, v in load_json(p).items() if e in ents})
    else:
        log("creature_stats.json not found - run  py build_gamedata.py cstats  for real creature health/damage")
    with open(os.path.join(out, "mobmap_data.js"), "w", encoding="utf-8") as f:
        f.write("const DATA=" + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";")
    done = {"spawns.json", "hostility.json", "loot.json", "quests.json", "items.json", "spells.json", "navgraph.json",
            "vendors.json", "vendor_items.json", "creature_stats.json", "mobmap_data.js", "objects.json", "go_data.json"}
    for f in os.listdir(gd):   # zone shapes for the continent maps
        if f.startswith("zonemap_") and f.endswith(".png"):
            shutil.copy(os.path.join(gd, f), os.path.join(out, f))
    for mid in map_ids:   # collision grids of the included continents
        gname = {0: "Azeroth", 1: "Kalimdor"}.get(mid)
        gp = os.path.join(gd, "navgrid_%s.bin.gz" % gname) if gname else ""
        if gp and os.path.isfile(gp):
            shutil.copy(gp, os.path.join(out, os.path.basename(gp)))
            log("Collision grid: %s" % os.path.basename(gp))
    for f in os.listdir(gd):
        base = os.path.splitext(f)[0]
        if f in done or base in DROP_JSON or not (f.endswith(".json") or f.endswith(".js")):
            continue
        shutil.copy(os.path.join(gd, f), os.path.join(out, f))

    # ------------------------------------------------------------ portraits + icons
    pdir = os.path.join(root, "portraits", "by_name")
    portraits = []
    zone_ents = set()
    for e, lst in keep_sp.items():
        if any(inside(z, s[1], s[2]) for s in lst for z in zones if z["map"] == s[0]):
            zone_ents.add(e)
    if os.path.isdir(pdir):
        for f in os.listdir(pdir):
            mm = re.match(r"^(\d+)_", f)
            if not mm or mm.group(1) not in zone_ents:
                continue
            src = os.path.join(pdir, f)
            if Image:
                dst = os.path.splitext(f)[0] + ".jpg"
                im = Image.open(src).convert("RGB"); im.thumbnail((160, 160))
                im.save(os.path.join(web, "portraits", "by_name", dst), "JPEG", quality=85)
            else:
                dst = f; shutil.copy(src, os.path.join(web, "portraits", "by_name", dst))
            portraits.append(dst)
    log("Portraits: %d" % len(portraits))
    idir = os.path.join(root, "icons")
    icons = set()
    for v in keep_items.values():
        if v.get("ic"):
            icons.add(v["ic"].lower())
    for s in keep_sp2.values():
        if s.get("ic"):
            icons.add(s["ic"].lower())
    n_ic = 0
    if os.path.isdir(idir):
        have = {f.lower(): f for f in os.listdir(idir)}
        for ic in icons:
            f = have.get(ic + ".jpg") or have.get(ic + ".png")
            if f:
                shutil.copy(os.path.join(idir, f), os.path.join(web, "icons", ic + os.path.splitext(f)[1].lower()))
                n_ic += 1
    log("Icons: %d" % n_ic)

    # ------------------------------------------------------------ game files + PWA
    gsrc = os.path.join(root, "game")
    for f in os.listdir(gsrc):
        if f.endswith((".html", ".js", ".css", ".webmanifest", ".png")):
            shutil.copy(os.path.join(gsrc, f), os.path.join(web, "game", f))
    make_icons(Image, os.path.join(web, "game"))
    with open(os.path.join(web, "game", "manifest.webmanifest"), "w", encoding="utf-8") as f:
        json.dump({"name": "Azeroth Auto Battler", "short_name": "Auto Battler", "start_url": "./", "scope": "./",
                   "display": "fullscreen", "orientation": "any", "background_color": "#12100d", "theme_color": "#1a160f",
                   "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
                             {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]}, f, indent=1)
    build = time.strftime("%Y%m%d%H%M%S")
    core = ["./", "index.html", "game.css", "manifest.webmanifest"] + \
           [f for f in os.listdir(os.path.join(web, "game")) if f.endswith(".js")] + \
           ["../files.json"] + ["../gamedata/" + f for f in sorted(os.listdir(out))] + ["../maps/" + f for f in map_files]
    with open(os.path.join(web, "game", "sw.js"), "w", encoding="utf-8") as f:
        f.write(SW.replace("__BUILD__", build).replace("__CORE__", json.dumps(core)))
    with open(os.path.join(web, "files.json"), "w", encoding="utf-8") as f:
        json.dump({"build": build, "maps": map_files, "portraits": sorted(portraits)}, f)
    with open(os.path.join(web, "index.html"), "w", encoding="utf-8") as f:
        f.write('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=game/">'
                '<title>Azeroth Auto Battler</title><a href="game/">Start the game</a>')
    with open(os.path.join(web, "README.txt"), "w", encoding="utf-8") as f:
        f.write(README)

    # ------------------------------------------------------------ zip + sizes
    zp = os.path.join(root, "web.zip")
    if os.path.exists(zp):
        os.remove(zp)
    total = 0
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dn, fn in os.walk(web):
            for f in fn:
                full = os.path.join(dp, f); total += os.path.getsize(full)
                z.write(full, os.path.relpath(full, web))
    for d in ("game", "gamedata", "maps", "portraits", "icons"):
        s = sum(os.path.getsize(os.path.join(dp, f)) for dp, dn, fn in os.walk(os.path.join(web, d)) for f in fn)
        log("  %-10s %6.1f MB" % (d, s / 1048576.0))
    log("Web folder: %s (%.1f MB)   zip: %s (%.1f MB)" % (web, total / 1048576.0, zp, os.path.getsize(zp) / 1048576.0))
    log("Upload the  web  folder (or web.zip) to a static host, e.g. drag it onto https://app.netlify.com/drop")


def make_icons(Image, folder):
    """app icons: a gold shield with crossed lines on dark brown (drawn, no game art)"""
    if not Image:
        return
    from PIL import ImageDraw
    for size in (192, 512):
        im = Image.new("RGB", (size, size), (26, 22, 15))
        d = ImageDraw.Draw(im)
        s = size / 192.0
        d.ellipse([16 * s, 16 * s, 176 * s, 176 * s], outline=(232, 196, 106), width=int(8 * s))
        d.polygon([(96 * s, 40 * s), (146 * s, 60 * s), (140 * s, 120 * s), (96 * s, 156 * s), (52 * s, 120 * s), (46 * s, 60 * s)],
                  fill=(184, 145, 58), outline=(255, 233, 168))
        d.line([(66 * s, 66 * s), (126 * s, 132 * s)], fill=(60, 30, 10), width=int(10 * s))
        d.line([(126 * s, 66 * s), (66 * s, 132 * s)], fill=(60, 30, 10), width=int(10 * s))
        im.save(os.path.join(folder, "icon-%d.png" % size))


SW = r"""// service worker: keeps the game playable offline after the first visit
const CACHE = 'aab-__BUILD__';
const CORE = __CORE__;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r && r.ok && new URL(e.request.url).origin === location.origin) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return r;
  })));
});
"""

README = """Azeroth Auto Battler - web version
==================================
This folder is a complete static web site. Saves are kept in the browser (Export/Import to move them).

Put it online (free, no account needed for the first option):
  1. Netlify Drop: open https://app.netlify.com/drop in Chrome and drag this whole "web" folder onto the page.
     You get an https://....netlify.app link. (Create a free account to keep the site permanently.)
  2. GitHub Pages: create a repository, upload the contents of this folder, Settings > Pages > deploy from branch.

Play on Android without an APK:
  open the link in Chrome on the phone > menu (three dots) > "Install app" / "Add to Home screen".
  After the first full load it also works offline.

Test it on this PC:  open a command prompt in this folder and run   py -m http.server 8080
then open http://localhost:8080/game/

This is a personal fan project built from your own game files - keep the link private.
"""

if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
    if os.name == "nt" and "--nopause" not in sys.argv:
        input("Press Enter to close")
