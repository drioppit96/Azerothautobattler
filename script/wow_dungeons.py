# -*- coding: utf-8 -*-
"""
Dungeon & raid spreadsheet:  C:\\wow excel\\wow_dungeons.xlsx
  Dungeons       - every instance: level range, players, entrance location (zone,
                   subzone, map coordinates), mob counts
  Dungeon Mobs   - every creature inside each dungeon: level, rank, health, mana,
                   armor, damage, resistances, spawn count
  Dungeon Items  - every item that drops in each dungeon (with icon), best drop
                   chance and which mobs / chests drop it
  Boss Loot      - loot table of every boss (and chest), one row per item, with icons
  All Drops      - every mob / chest x item row, no icons (complete reference)

Needs wow_common.py in the same folder, the SPP Database window open, and the DBC
files from extract_dbc_multi.py (re-run it: it now also extracts AreaTrigger.dbc).
Run:  py wow_dungeons.py

Drop chances are computed from the loot tables; for shared/reference tables and
loot groups they are close approximations, not exact.
"""
import os
import struct
from collections import Counter, defaultdict

from wow_common import *   # noqa

OUTPUT = os.path.join(OUT_FOLDER, "wow_dungeons.xlsx")
MIN_QUALITY = 2          # items below this quality (0 grey, 1 white, 2 green) are left out
                         # of the "Dungeon Items" and "Boss Loot" sheets (All Drops has all)
BG_MAPS = (30, 489, 529)
RANK = {0: "Normal", 1: "Elite", 2: "Rare Elite", 3: "World Boss", 4: "Rare"}
CTYPE = {0: "", 1: "Beast", 2: "Dragonkin", 3: "Demon", 4: "Elemental",
         5: "Giant", 6: "Undead", 7: "Humanoid", 8: "Critter", 9: "Mechanical",
         10: "Not specified", 11: "Totem"}
ROLE_ORDER = {"Boss": 0, "Chest": 1, "Rare": 2, "Elite": 3, "Normal": 4}


def flt(u):
    return struct.unpack("<f", struct.pack("<I", u))[0]


# ------------------------------------------------------------- loot maths
class LootBook(object):
    def __init__(self, cur, table, ref_table="reference_loot_template"):
        self.cur, self.table, self.ref_table = cur, table, ref_table
        self.cache = {}
        self.ref_cache = {}
        self.ready = table_exists(cur, table)
        if self.ready:
            self.c = columns(cur, table)
        self.has_ref = table_exists(cur, ref_table)
        if self.has_ref:
            self.rc = columns(cur, ref_table)

    def _fetch(self, table, c, ids, store):
        need = [i for i in ids if i not in store]
        for i in need:
            store[i] = []
        for part in chunks(need):
            self.cur.execute("SELECT * FROM `%s` WHERE `%s` IN (%s)" % (table, c["entry"], ph(len(part))), part)
            for r in self.cur.fetchall():
                ch = float(g(r, c, "chanceorquestchance", 0) or g(r, c, "chance", 0) or 0)
                store[g(r, c, "entry")].append(
                    (g(r, c, "item"), ch, g(r, c, "groupid"), g(r, c, "mincountorref"), g(r, c, "maxcount") or 1))

    @staticmethod
    def _fractions(rows):
        """rows of one loot entry -> [(item_or_ref, p, min, max, quest, is_ref)]"""
        out = []

        def add(item, p, mref, mx, quest):
            if p <= 0:
                return
            if mref >= 0:
                out.append((item, p, mref, mx, quest, False))
            else:
                out.append((-mref, p, 1, mx, False, True))

        groups = defaultdict(list)
        for item, ch, grp, mref, mx in rows:
            if grp:
                groups[grp].append((item, ch, mref, mx))
            else:
                add(item, min(abs(ch), 100.0) / 100.0, mref, mx, ch < 0)
        for grp, lst in groups.items():
            explicit = sum(abs(ch) for _, ch, _, _ in lst if ch)
            zeros = [x for x in lst if not x[1]]
            share = max(0.0, 100.0 - explicit) / 100.0 / len(zeros) if zeros else 0
            for item, ch, mref, mx in lst:
                p = (min(abs(ch), 100.0) / 100.0) if ch else share
                add(item, p, mref, mx, ch < 0)
        return out

    def expand(self, loot_id, depth=0):
        """loot id -> {item: (chance %, min, max, is_quest_item)}"""
        if loot_id in self.cache and depth == 0:
            return self.cache[loot_id]
        if not self.ready:
            return {}
        self._fetch(self.table, self.c, [loot_id], self._store())
        rows = self._store()[loot_id]
        res = self._collect(self._fractions(rows), depth)
        if depth == 0:
            self.cache[loot_id] = res
        return res

    def _store(self):
        if not hasattr(self, "_s"):
            self._s = {}
        return self._s

    def _collect(self, entries, depth):
        res = {}
        for item, p, mn, mx, quest, is_ref in entries:
            if is_ref:
                if not self.has_ref or depth > 3:
                    continue
                self._fetch(self.ref_table, self.rc, [item], self.ref_cache)
                inner = self._collect(self._fractions(self.ref_cache[item]), depth + 1)
                rolls = max(1, mx)
                for it, (ip, imn, imx, iq) in inner.items():
                    q = p * ip / 100.0
                    tot = 1 - (1 - q) ** rolls
                    self._merge(res, it, tot * 100, imn, imx, iq)
            else:
                self._merge(res, item, p * 100, mn, mx, quest)
        return res

    @staticmethod
    def _merge(res, item, pct, mn, mx, quest):
        old = res.get(item)
        if old is None:
            res[item] = (pct, mn, mx, quest)
        else:
            tot = 100.0 * (1 - (1 - old[0] / 100.0) * (1 - pct / 100.0))
            res[item] = (tot, min(old[1], mn), max(old[2], mx), old[3] or quest)

    def preload(self, ids):
        self._fetch(self.table, self.c, list(ids), self._store())
        refs = set()
        for i in ids:
            for item, ch, grp, mref, mx in self._store()[i]:
                if mref < 0:
                    refs.add(-mref)
        if self.has_ref and refs:
            self._fetch(self.ref_table, self.rc, list(refs), self.ref_cache)
            for _ in range(3):
                more = set()
                for rid in list(refs):
                    for item, ch, grp, mref, mx in self.ref_cache.get(rid, []):
                        if mref < 0 and -mref not in self.ref_cache:
                            more.add(-mref)
                if not more:
                    break
                self._fetch(self.ref_table, self.rc, list(more), self.ref_cache)
                refs |= more


# ---------------------------------------------------------- map coordinates
class MapCoords(object):
    """(zone id, map, x, y) -> 'xx.x, yy.y' like the in-game world map"""

    def __init__(self):
        self.rows = {}
        d = load_dbc("WorldMapArea")
        if not d:
            return
        for r in d.rows:
            for di in (3,):
                if di + 4 < d.fc:
                    self.rows.setdefault((r[1], r[2]), []).append(
                        (flt(r[di + 1]), flt(r[di + 2]), flt(r[di + 3]), flt(r[di + 4])))

    def text(self, zone_id, mp, x, y):
        for left, right, top, bottom in self.rows.get((mp, zone_id), []):
            for a, b, c, d in ((left, right, top, bottom), (right, left, bottom, top)):
                try:
                    px = (a - y) / (a - b)
                    py = (c - x) / (c - d)
                except ZeroDivisionError:
                    continue
                if -0.02 <= px <= 1.02 and -0.02 <= py <= 1.02:
                    return "%.1f, %.1f" % (px * 100, py * 100)
        return ""


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()

    # ---- which maps are dungeons / raids
    it = columns(cur, "instance_template")
    cur.execute("SELECT * FROM instance_template")
    inst = {}
    for r in cur.fetchall():
        mp = g(r, it, "map")
        if mp in BG_MAPS:
            continue
        inst[mp] = {"parent": g(r, it, "parent"), "lmin": g(r, it, "levelmin"),
                    "lmax": g(r, it, "levelmax"), "players": g(r, it, "maxplayers"),
                    "reset": g(r, it, "reset_delay")}
    names, mtype = {}, {}
    md = load_dbc("Map")
    if md:
        idx = md.find_field(0, "Eastern Kingdoms")
        idx = idx if idx is not None else 4
        for r in md.rows:
            names[r[0]] = md.s(r[idx]) or md.s(r[1])
            mtype[r[0]] = r[2]
    for mp in list(inst):
        if mtype.get(mp) in (3, 4):
            del inst[mp]
    log("Instances found: %d" % len(inst))

    resolver = AreaResolver()
    coords = MapCoords()

    # ---- entrances via the area triggers
    trig = {}
    atd = load_dbc("AreaTrigger")
    if atd:
        trig = {r[0]: (r[1], flt(r[2]), flt(r[3])) for r in atd.rows}
    entr = {}
    tc = columns(cur, "areatrigger_teleport")
    cur.execute("SELECT * FROM areatrigger_teleport")
    for r in cur.fetchall():
        tm = g(r, tc, "target_map")
        if tm in inst:
            t = trig.get(g(r, tc, "id"))
            if t and t[0] != tm and tm not in entr:
                entr[tm] = {"map": t[0], "x": t[1], "y": t[2], "name": g(r, tc, "name", ""),
                            "reqlvl": g(r, tc, "required_level")}
            elif tm not in entr and not t:
                entr.setdefault(("noxy", tm), {"name": g(r, tc, "name", ""), "reqlvl": g(r, tc, "required_level")})

    # ---- creatures and chests inside the instances
    maps = sorted(inst)
    has_se = table_exists(cur, "creature_spawn_entry")
    spawn = defaultdict(int)       # (map, entry) -> count
    for part in chunks(maps, 50):
        cur.execute("SELECT id i, map m FROM creature WHERE id <> 0 AND map IN (%s)" % ph(len(part)), part)
        for r in cur.fetchall():
            spawn[(r["m"], r["i"])] += 1
        if has_se:
            cur.execute("SELECT s.entry i, c.map m FROM creature_spawn_entry s JOIN creature c "
                        "ON c.guid = s.guid WHERE c.map IN (%s)" % ph(len(part)), part)
            for r in cur.fetchall():
                spawn[(r["m"], r["i"])] += 1
    chest_spawn = defaultdict(int)
    gt = columns(cur, "gameobject_template")
    for part in chunks(maps, 50):
        cur.execute("SELECT id i, map m FROM gameobject WHERE map IN (%s)" % ph(len(part)), part)
        for r in cur.fetchall():
            chest_spawn[(r["m"], r["i"])] += 1
    log("Instance creatures: %d kinds, chests/objects: %d kinds" % (len(spawn), len(chest_spawn)))

    ct = columns(cur, "creature_template")
    entries = sorted({e for _, e in spawn})
    tmpl = {}
    for part in chunks(entries):
        cur.execute("SELECT * FROM creature_template WHERE `%s` IN (%s)" % (ct["entry"], ph(len(part))), part)
        for r in cur.fetchall():
            tmpl[g(r, ct, "entry")] = r
    gids = sorted({e for _, e in chest_spawn})
    gtmpl = {}
    for part in chunks(gids):
        cur.execute("SELECT * FROM gameobject_template WHERE `%s` IN (%s) AND `%s` = 3"
                    % (gt["entry"], ph(len(part)), gt["type"]), part)
        for r in cur.fetchall():
            if g(r, gt, "data1"):
                gtmpl[g(r, gt, "entry")] = r

    # bosses
    boss = set()
    for tbl in ("instance_encounters", "instance_dungeon_encounters"):
        if table_exists(cur, tbl):
            ec = columns(cur, tbl)
            if ec.get("creditentry"):
                cur.execute("SELECT * FROM `%s`" % tbl)
                for r in cur.fetchall():
                    if g(r, ec, "credittype", 0) == 0 and g(r, ec, "creditentry"):
                        boss.add(g(r, ec, "creditentry"))
    log("Boss entries known: %d" % len(boss))

    def role(e):
        r = tmpl[e]
        rank = g(r, ct, "rank")
        if e in boss or rank == 3:
            return "Boss"
        if rank in (2, 4):
            return "Rare"
        return "Elite" if rank == 1 else "Normal"

    # ---- loot
    log("Reading loot tables ...")
    cbook = LootBook(cur, "creature_loot_template")
    gbook = LootBook(cur, "gameobject_loot_template")
    cbook.preload({g(tmpl[e], ct, "lootid") for e in tmpl if g(tmpl[e], ct, "lootid")})
    gbook.preload({g(r, gt, "data1") for r in gtmpl.values()})

    sources = []   # dict per (map, source)
    for (mp, e), n in spawn.items():
        if e not in tmpl:
            continue
        r = tmpl[e]
        lid = g(r, ct, "lootid")
        loot = cbook.expand(lid) if lid else {}
        sources.append({"map": mp, "kind": "mob", "id": e, "name": g(r, ct, "name", ""), "role": role(e),
                        "n": n, "lo": g(r, ct, "minlevel"), "hi": g(r, ct, "maxlevel"), "loot": loot})
    for (mp, e), n in chest_spawn.items():
        if e not in gtmpl:
            continue
        r = gtmpl[e]
        loot = gbook.expand(g(r, gt, "data1"))
        sources.append({"map": mp, "kind": "chest", "id": e, "name": g(r, gt, "name", ""),
                        "role": "Chest", "n": n, "lo": "", "hi": "", "loot": loot})
    item_ids = {i for s in sources for i in s["loot"]}
    items = load_items_by_ids(cur, item_ids)
    conn.close()
    log("Distinct dropped items: %d" % len(items))

    # ---- location per dungeon
    def dungeon_place(mp):
        info = entr.get(mp)
        if info and "x" in info:
            z, s = resolver.locate(info["map"], info["x"], info["y"])
            area = resolver.area_at(info["map"], info["x"], info["y"])
            zid = resolver.zone_id(area) if area else 0
            mc = coords.text(zid, info["map"], info["x"], info["y"]) if zid else ""
            return (MAP_NAMES.get(info["map"], names.get(info["map"], "Map %d" % info["map"])),
                    z, s, mc, "%.0f, %.0f" % (info["x"], info["y"]), info["name"], info["reqlvl"])
        parent = inst[mp]["parent"]
        extra = entr.get(("noxy", mp), {})
        return (MAP_NAMES.get(parent, "") if parent else "", "", "", "", "",
                extra.get("name", ""), extra.get("reqlvl", ""))
    resolver.report()
    resolver.save_cache()

    per_map = defaultdict(list)
    for s in sources:
        per_map[s["map"]].append(s)

    from openpyxl import Workbook
    wb = Workbook()
    icons = Icons()

    # ======== sheet 1: dungeons
    cols = ["Map ID", "Dungeon / Raid", "Type", "Min Level", "Max Level", "Players", "Reset (days)",
            "Mob Level Range", "Entrance Continent", "Entrance Zone", "Entrance Subzone",
            "Entrance Map Coords (x, y)", "Entrance World Position", "Entrance Trigger",
            "Entry Level Req.", "Creature Kinds", "Total Spawns", "Bosses", "Chests / Objects",
            "Distinct Items (all)", "Wowhead Link"]
    widths = [8, 30, 9, 8, 8, 8, 9, 12, 18, 22, 24, 18, 18, 26, 9, 9, 9, 40, 9, 10, 34]
    ws = new_sheet(wb, "Dungeons", cols, widths, first=True)
    rows_out = []
    for mp in maps:
        srcs = per_map.get(mp, [])
        mobs = [s for s in srcs if s["kind"] == "mob"]
        lv = [x for s in mobs for x in (s["lo"], s["hi"]) if x and x > 0]
        bosses = sorted({s["name"] for s in mobs if s["role"] == "Boss"})
        di = inst[mp]
        cont, z, sz, mc, pos, tname, rl = dungeon_place(mp)
        itemset = {i for s in srcs for i in s["loot"]}
        zone_id = resolver.inst_zone.get(mp)
        link = ("https://www.wowhead.com/classic/zone=%d" % zone_id) if zone_id else ""
        rows_out.append([mp, names.get(mp) or "Map %d" % mp,
                         "Raid" if (mtype.get(mp) == 2 or di["players"] > 5) else "Dungeon",
                         di["lmin"] or "", di["lmax"] or "", di["players"] or "",
                         (di["reset"] // 86400) if di["reset"] else "",
                         ("%d-%d" % (min(lv), max(lv))) if lv else "", cont, z, sz, mc, pos, tname,
                         rl or "", len(mobs), sum(s["n"] for s in mobs),
                         ", ".join(bosses[:12]) + (" (+%d)" % (len(bosses) - 12) if len(bosses) > 12 else ""),
                         sum(1 for s in srcs if s["kind"] == "chest"), len(itemset), link])
    rows_out.sort(key=lambda r: (r[3] or 0, r[1]))
    for n, row in enumerate(rows_out, start=2):
        ws.append(row)
        style_row(ws, n, len(cols), link_col=len(cols) if row[-1] else None, link=row[-1])
    finish_sheet(ws, len(cols), freeze="C2")
    dname = {mp: names.get(mp) or "Map %d" % mp for mp in maps}

    # ======== sheet 2: mobs
    mcols = ["Dungeon", "ID", "Name", "Title / Subname", "Role", "Level", "Class", "Type",
             "Health", "Mana", "Armor", "Melee Damage", "Attack Speed (s)", "Fire Res",
             "Nature Res", "Frost Res", "Shadow Res", "Arcane Res", "Holy Res", "Loot Gold",
             "Spawns", "Drops (items)", "Wowhead Link"]
    mw = [26, 8, 30, 22, 8, 9, 11, 12, 14, 12, 8, 14, 9, 7, 7, 7, 7, 7, 7, 12, 8, 9, 34]
    mws = new_sheet(wb, "Dungeon Mobs", mcols, mw)
    mob_rows = []
    for s in sources:
        if s["kind"] != "mob":
            continue
        r = tmpl[s["id"]]

        def G(n, d=0):
            return g(r, ct, n, d)
        lo, hi = G("minlevel"), G("maxlevel")
        lvl = "%d" % lo if lo == hi else "%d-%d" % (lo, hi)
        if G("rank") == 3:
            lvl = "??"
        hp = "%d" % G("minlevelhealth") if G("minlevelhealth") == G("maxlevelhealth") else \
            "%d-%d" % (G("minlevelhealth"), G("maxlevelhealth"))
        mana = "" if not G("maxlevelmana") else (
            "%d" % G("minlevelmana") if G("minlevelmana") == G("maxlevelmana")
            else "%d-%d" % (G("minlevelmana"), G("maxlevelmana")))
        spd = G("meleebaseattacktime")
        gold = ("%s - %s" % (money(G("minlootgold")) or "0c", money(G("maxlootgold")))) if G("maxlootgold") else ""
        mob_rows.append([dname[s["map"]], s["id"], s["name"], G("subname", "") or "", s["role"], lvl,
                         RANK.get(G("rank"), ""), CTYPE.get(G("creaturetype"), ""), hp, mana,
                         G("armor") or "",
                         ("%d - %d" % (G("minmeleedmg"), G("maxmeleedmg"))) if G("maxmeleedmg") else "",
                         round(spd / 1000.0, 2) if spd else "",
                         G("resistancefire") or "", G("resistancenature") or "", G("resistancefrost") or "",
                         G("resistanceshadow") or "", G("resistancearcane") or "", G("resistanceholy") or "",
                         gold, s["n"], len(s["loot"]), "https://www.wowhead.com/classic/npc=%d" % s["id"]])
    mob_rows.sort(key=lambda r: (r[0], ROLE_ORDER.get(r[4], 9), r[2]))
    for n, row in enumerate(mob_rows, start=2):
        mws.append(row)
        style_row(mws, n, len(mcols), link_col=len(mcols), link=row[-1])
    finish_sheet(mws, len(mcols), freeze="D2")

    # ======== sheet 3: items per dungeon (with icons)
    def keep(i, quest):
        it = items.get(i)
        return bool(it) and (it["quality"] >= MIN_QUALITY or quest)

    agg = {}       # (map, item) -> {best, quest, sources: {name: (chance, role)}}
    for s in sources:
        for i, (p, mn, mx, quest) in s["loot"].items():
            if i not in items:
                continue
            a = agg.setdefault((s["map"], i), {"best": 0, "quest": False, "src": {}})
            a["best"] = max(a["best"], p)
            a["quest"] = a["quest"] or quest
            a["src"][s["name"]] = (max(p, a["src"].get(s["name"], (0, ""))[0]), s["role"])
    di_list = []
    for (mp, i), a in agg.items():
        if keep(i, a["quest"]):
            d = dict(items[i])
            d["_mp"], d["_a"] = mp, a
            di_list.append(d)
    di_list.sort(key=lambda d: (dname[d["_mp"]], -d["quality"], d["name"]))
    log("Writing Dungeon Items (%d rows) ..." % len(di_list))

    def di_before(d):
        return [dname[d["_mp"]], "%.1f%%" % d["_a"]["best"]]

    def di_extra(d):
        src = sorted(d["_a"]["src"].items(), key=lambda kv: (ROLE_ORDER.get(kv[1][1], 9), -kv[1][0]))
        txt = "; ".join("%s (%s, %.1f%%)" % (n, rl, p) for n, (p, rl) in src[:6])
        if len(src) > 6:
            txt += " (+%d more)" % (len(src) - 6)
        return [len(src), txt, "yes" if d["_a"]["quest"] else ""]
    write_item_sheet(wb, "Dungeon Items", di_list, icons,
                     before=["Dungeon", "Best Drop Chance"], before_widths=[26, 10],
                     before_fn=di_before,
                     extra_headers=["Dropped By (count)", "Dropped By", "Quest Item"],
                     extra_widths=[9, 90, 8], extra_fn=di_extra)

    # ======== sheet 4: boss / chest loot, one row per drop (with icons)
    bl = []
    for s in sources:
        if s["role"] not in ("Boss", "Chest", "Rare"):
            continue
        for i, (p, mn, mx, quest) in s["loot"].items():
            if keep(i, quest):
                d = dict(items[i])
                d["_s"], d["_p"], d["_mn"], d["_mx"], d["_q"] = s, p, mn, mx, quest
                bl.append(d)
    bl.sort(key=lambda d: (dname[d["_s"]["map"]], ROLE_ORDER.get(d["_s"]["role"], 9),
                           d["_s"]["name"], -d["_p"], d["name"]))
    log("Writing Boss Loot (%d rows) ..." % len(bl))
    write_item_sheet(
        wb, "Boss Loot", bl, icons,
        before=["Dungeon", "Source", "Source Type", "Drop Chance", "Count"],
        before_widths=[26, 30, 9, 10, 8],
        before_fn=lambda d: [dname[d["_s"]["map"]], d["_s"]["name"], d["_s"]["role"],
                             "%.1f%%" % d["_p"],
                             d["_mn"] if d["_mn"] == d["_mx"] else "%d-%d" % (d["_mn"], d["_mx"])])

    # ======== sheet 5: everything, no icons
    ad = []
    for s in sources:
        for i, (p, mn, mx, quest) in s["loot"].items():
            it_ = items.get(i)
            if not it_:
                continue
            ad.append([dname[s["map"]], s["role"], s["name"], s["id"],
                       s["lo"] if s["lo"] == s["hi"] else ("%s-%s" % (s["lo"], s["hi"]) if s["lo"] else ""),
                       i, it_["name"], QUALITY.get(it_["quality"], ""), it_["ilvl"], it_["reqlvl"],
                       it_["type"], it_["slot"], round(p, 2), mn if mn == mx else "%d-%d" % (mn, mx),
                       "yes" if quest else "", "https://www.wowhead.com/classic/item=%d" % i])
    ad.sort(key=lambda r: (r[0], ROLE_ORDER.get(r[1], 9), r[2], -r[12]))
    add_plain_sheet(wb, "All Drops",
                    ["Dungeon", "Source Type", "Source", "Source ID", "Source Level", "Item ID", "Item",
                     "Quality", "Item Level", "Req Level", "Type", "Slot", "Drop Chance %", "Count",
                     "Quest Item", "Wowhead Link"],
                    [26, 10, 30, 9, 9, 8, 36, 10, 8, 8, 24, 14, 10, 8, 8, 34], ad, link_col=16)

    wb.save(OUTPUT)
    if icons.missing:
        log("Icons missing for %d rows." % icons.missing)
    log("Done! Saved %s  (%d dungeons, %d mobs, %d drop rows)" % (OUTPUT, len(maps), len(mob_rows), len(ad)))


if __name__ == "__main__":
    run(main)
