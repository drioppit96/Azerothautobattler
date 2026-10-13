# -*- coding: utf-8 -*-
"""
World data for the auto-battler:
  * every creature spawn point (and object spawn point) with zone / subzone
  * graveyards (position, zone, faction)
  * experience needed per level (+ kill XP and gray level per level)
  * level ranges per zone and subzone (from the real mob spawns and the quests)

Writes   C:\\wow excel\\wow_world.xlsx
         C:\\wow excel\\gamedata\\spawns.json, objects.json, graveyards.json, xp.json, zone_levels.json

Needs wow_common.py, wow_gamedata.py (for the zone lookup) next to it, the DBC files from
extract_dbc_multi.py and the game files (zones are read from the client's map files, like wow_mobs.py).
Run:   py wow_world.py                 (everything)
       py wow_world.py graveyards xp   (only some:  spawns, graveyards, xp, zones)
"""
import json
import os
import sys
import traceback
from collections import Counter, defaultdict

from wow_common import *   # noqa
from wow_gamedata import make_resolver
from wow_mobs import map_name

OUTPUT = os.path.join(OUT_FOLDER, "wow_world.xlsx")
JSON_DIR = os.path.join(OUT_FOLDER, "gamedata")
FACTION_TEXT = {0: "Both", 67: "Horde", 469: "Alliance"}


def save_json(name, data):
    try:
        os.makedirs(JSON_DIR)
    except OSError:
        pass
    with open(os.path.join(JSON_DIR, name + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"), default=str)
    log("  wrote gamedata\\%s.json" % name)


class Ctx(object):
    pass


def find_col(cols, *cands, **kw):
    """first column (lower-case name) matching one of the candidates"""
    for c in cands:
        if c in cols:
            return cols[c]
    sub = kw.get("contains")
    if sub:
        for k, v in cols.items():
            if sub in k:
                return v
    return None


class Zones(object):
    """cached zone/subzone lookup with small integer ids (keeps the JSON files small)"""

    def __init__(self, resolver):
        self.r = resolver
        self.names = []
        self.index = {}
        self.cache = {}

    def idx(self, text):
        if text not in self.index:
            self.index[text] = len(self.names)
            self.names.append(text)
        return self.index[text]

    def locate(self, mp, x, y):
        key = (mp, int(x // 8), int(y // 8))            # lookups are the slow part
        z = self.cache.get(key)
        if z is None:
            zone, sub = self.r.locate(mp, x, y)
            z = (map_name(self.r, mp), zone, sub)
            self.cache[key] = z
        return z


# ============================================================== spawns
def sec_spawns(ctx):
    cur = ctx.cur
    cc = columns(cur, "creature")
    sel = ("guid, id, map, position_x x, position_y y, position_z z, orientation o, "
           "%s lo, %s hi, %s mv" % (
               ("`%s`" % cc["spawntimesecsmin"]) if "spawntimesecsmin" in cc else "0",
               ("`%s`" % cc["spawntimesecsmax"]) if "spawntimesecsmax" in cc else "0",
               ("`%s`" % cc["movementtype"]) if "movementtype" in cc else "0"))
    cur.execute("SELECT %s FROM creature WHERE id <> 0" % sel)
    rows = [(r["id"], r) for r in cur.fetchall()]
    if table_exists(cur, "creature_spawn_entry"):
        cur.execute("SELECT s.entry AS id, c.guid, c.map, c.position_x x, c.position_y y, c.position_z z, "
                    "c.orientation o, %s lo, %s hi, %s mv FROM creature_spawn_entry s JOIN creature c ON c.guid = s.guid"
                    % (("c.`%s`" % cc["spawntimesecsmin"]) if "spawntimesecsmin" in cc else "0",
                       ("c.`%s`" % cc["spawntimesecsmax"]) if "spawntimesecsmax" in cc else "0",
                       ("c.`%s`" % cc["movementtype"]) if "movementtype" in cc else "0"))
        rows += [(r["id"], r) for r in cur.fetchall()]
    log("  creature spawn points: %d" % len(rows))
    tc = columns(cur, "creature_template")
    cur.execute("SELECT * FROM creature_template")
    tpl = {g(r, tc, "entry"): r for r in cur.fetchall()}
    ctx.tpl, ctx.tc, ctx.spawn_rows = tpl, tc, rows
    z = ctx.zones
    out = defaultdict(list)
    sheet = []
    n = 0
    for entry, r in rows:
        mp, x, y = r["map"], float(r["x"]), float(r["y"])
        m_, zone, sub = z.locate(mp, x, y)
        out[entry].append([mp, round(x, 1), round(y, 1), round(float(r["z"]), 1), round(float(r["o"] or 0), 2),
                           z.idx(zone), z.idx(sub), r["lo"], r["hi"], r["mv"]])
        t = tpl.get(entry)
        lo_, hi_ = (g(t, tc, "minlevel"), g(t, tc, "maxlevel")) if t else (0, 0)
        sheet.append([entry, g(t, tc, "name", "") if t else "", lo_ if lo_ == hi_ else "%d-%d" % (lo_, hi_),
                      m_, zone, sub, round(x, 1), round(y, 1), round(float(r["z"]), 1),
                      r["lo"] or "", r["hi"] or "", {0: "Stationary", 1: "Random", 2: "Waypoints"}.get(r["mv"], r["mv"])])
        n += 1
        if n % 20000 == 0:
            log("    located %d / %d" % (n, len(rows)))
    save_json("spawns", {"fields": ["map", "x", "y", "z", "orientation", "zone", "subzone",
                                    "respawn_min_s", "respawn_max_s", "movement"],
                         "places": z.names, "spawns": out})
    sheet.sort(key=lambda s: (s[3], s[4], s[5], s[1]))
    write_sheet(ctx, "Creature Spawns", ["Mob ID", "Name", "Level", "Map", "Zone", "Subzone", "X", "Y", "Z",
                                         "Respawn Min (s)", "Respawn Max (s)", "Movement"],
                [8, 30, 8, 16, 22, 26, 9, 9, 8, 9, 9, 11], sheet)
    # game objects (nodes, chests, doors ...)
    gc = columns(cur, "gameobject")
    gcols = ("guid, id, map, position_x x, position_y y, position_z z, "
             "%s lo, %s hi" % (("`%s`" % gc["spawntimesecsmin"]) if "spawntimesecsmin" in gc else "0",
                               ("`%s`" % gc["spawntimesecsmax"]) if "spawntimesecsmax" in gc else "0"))
    cur.execute("SELECT %s FROM gameobject" % gcols)
    objs = cur.fetchall()
    if table_exists(cur, "gameobject_spawn_entry"):
        cur.execute("SELECT s.entry AS id, c.guid, c.map, c.position_x x, c.position_y y, c.position_z z, 0 lo, 0 hi "
                    "FROM gameobject_spawn_entry s JOIN gameobject c ON c.guid = s.guid")
        objs += cur.fetchall()
    gt = columns(cur, "gameobject_template")
    cur.execute("SELECT entry, name, type FROM gameobject_template")
    gtpl = {r["entry"]: r for r in cur.fetchall()}
    GOTYPE = {0: "Door", 1: "Button", 2: "Quest giver", 3: "Chest / node", 5: "Generic", 6: "Trap", 7: "Chair",
              8: "Spell focus", 9: "Text", 10: "Goober", 11: "Transport", 12: "Area damage", 13: "Camera",
              17: "Fishing node", 19: "Mailbox", 22: "Spell caster", 23: "Meeting stone", 24: "Flag stand",
              25: "Fishing hole", 26: "Flag drop"}
    o_out = defaultdict(list)
    o_sheet = []
    for r in objs:
        mp, x, y = r["map"], float(r["x"]), float(r["y"])
        m_, zone, sub = z.locate(mp, x, y)
        t = gtpl.get(r["id"], {})
        o_out[r["id"]].append([mp, round(x, 1), round(y, 1), round(float(r["z"]), 1), z.idx(zone), z.idx(sub)])
        if t.get("type") in (3, 25, 2, 8, 10, 19, 23):          # keep the sheet readable: no doors / traps / decor
            o_sheet.append([r["id"], t.get("name", ""), GOTYPE.get(t.get("type"), t.get("type")), m_, zone, sub,
                            round(x, 1), round(y, 1), round(float(r["z"]), 1)])
    save_json("objects", {"fields": ["map", "x", "y", "z", "zone", "subzone"], "places": z.names, "objects": o_out})
    o_sheet.sort(key=lambda s: (s[3], s[4], s[5], s[1]))
    write_sheet(ctx, "Object Spawns", ["Object ID", "Name", "Type", "Map", "Zone", "Subzone", "X", "Y", "Z"],
                [9, 30, 14, 16, 22, 26, 9, 9, 8], o_sheet)
    log("  object spawn points: %d" % len(objs))


def write_sheet(ctx, title, cols, widths, rows):
    add_plain_sheet(ctx.wb, title, cols, widths, rows)


# ============================================================== graveyards
def sec_graveyards(ctx):
    cur = ctx.cur
    if not table_exists(cur, "game_graveyard_zone") or not table_exists(cur, "world_safe_locs"):
        raise RuntimeError("game_graveyard_zone / world_safe_locs tables not found")
    gz = columns(cur, "game_graveyard_zone")
    ws = columns(cur, "world_safe_locs")
    idc = find_col(ws, "id", contains="id")
    mapc = find_col(ws, "map", "mapid", "map_id", contains="map")
    xc = find_col(ws, "loc_x", "x", "positionx", "position_x", contains="x")
    yc = find_col(ws, "loc_y", "y", "positiony", "position_y", contains="y")
    zc = find_col(ws, "loc_z", "z", "positionz", "position_z", contains="z")
    nc = find_col(ws, "name", "comment", contains="name")
    cur.execute("SELECT * FROM world_safe_locs")
    safe = {r[idc]: r for r in cur.fetchall()}
    cur.execute("SELECT * FROM game_graveyard_zone")
    links = cur.fetchall()
    zid = gz.get("ghost_loc") or gz.get("ghost_zone")
    fc_ = gz.get("faction")
    z = ctx.zones
    by_id = defaultdict(list)
    for l in links:
        by_id[l[gz["id"]]].append(l)
    rows, out = [], []
    for gid, s in sorted(safe.items()):
        x, y = float(s[xc]), float(s[yc])
        mp = s[mapc]
        m_, zone, sub = z.locate(mp, x, y)
        ls = by_id.get(gid, [])
        linked = []
        for l in ls:
            area = l[zid]
            nm = ctx.resolver.names(area) if area in getattr(ctx.resolver, "areas", {}) else ("", "")
            linked.append({"zone_id": area, "zone": nm[0] or nm[1],
                           "faction": FACTION_TEXT.get(l[fc_] if fc_ else 0, str(l[fc_] if fc_ else 0))})
        rows.append([gid, (s[nc] if nc else "") or "", m_, zone, sub, round(x, 1), round(y, 1), round(float(s[zc]), 1),
                     "; ".join("%s (%s)" % (l["zone"] or l["zone_id"], l["faction"]) for l in linked)])
        out.append({"id": gid, "name": (s[nc] if nc else "") or "", "map": mp, "x": round(x, 1), "y": round(y, 1),
                    "z": round(float(s[zc]), 1), "zone": zone, "subzone": sub, "serves": linked})
    write_sheet(ctx, "Graveyards", ["ID", "Name", "Map", "Zone", "Subzone", "X", "Y", "Z", "Serves Zone (faction)"],
                [6, 36, 16, 22, 24, 9, 9, 8, 60], rows)
    save_json("graveyards", out)
    log("  graveyards: %d" % len(rows))


# ============================================================== experience
def gray_level(lvl):
    if lvl <= 5:
        return 0
    if lvl <= 39:
        return lvl - lvl // 10 - 5
    if lvl <= 59:
        return lvl - lvl // 5 - 1
    return lvl - 9


def sec_xp(ctx):
    cur = ctx.cur
    need = {}
    if table_exists(cur, "player_xp_for_level"):
        c = columns(cur, "player_xp_for_level")
        lc = find_col(c, "lvl", "level", contains="lvl")
        xc = find_col(c, "xp_for_next_level", "xp", contains="xp")
        cur.execute("SELECT `%s` l, `%s` x FROM player_xp_for_level" % (lc, xc))
        need = {r["l"]: r["x"] for r in cur.fetchall()}
    else:
        raise RuntimeError("player_xp_for_level table not found")
    explore = {}
    if table_exists(cur, "exploration_basexp"):
        c = columns(cur, "exploration_basexp")
        cur.execute("SELECT * FROM exploration_basexp")
        for r in cur.fetchall():
            explore[g(r, c, "level")] = g(r, c, "basexp")
    rows, out, cum = [], [], 0
    for lvl in range(1, 61):
        nx = need.get(lvl, 0)
        # vanilla kill experience for a mob of the same level: level*5 + 45 (elites give double)
        kill = lvl * 5 + 45
        rows.append([lvl, nx, cum, kill, kill * 2, gray_level(lvl), explore.get(lvl, ""),
                     round(nx / float(kill), 1) if nx else ""])
        out.append({"level": lvl, "xp_to_next": nx, "xp_total_before": cum, "kill_xp_same_level": kill,
                    "gray_level": gray_level(lvl), "exploration_xp": explore.get(lvl, 0)})
        cum += nx
    write_sheet(ctx, "XP per Level", ["Level", "XP To Next Level", "Total XP Before This Level",
                                      "Kill XP (same-level mob)", "Kill XP (same-level elite)",
                                      "Gray Level (mobs below give 0 XP)", "Exploration XP (new area)",
                                      "Kills To Level (same-level mobs)"],
                [7, 14, 18, 14, 14, 18, 14, 16], rows)
    save_json("xp", {"levels": out, "formulas": {
        "kill_xp_same_level": "level*5+45",
        "mob_higher_than_player": "same-level xp * (1 + 0.05*diff), diff capped at 4",
        "mob_lower_than_player": "same-level xp * (1 - diff/ZD); 0 once the mob is at or below the gray level",
        "elite_multiplier": 2,
        "zero_difference": "player level below first value -> ZD: [[8,5],[10,6],[12,7],[16,8],[20,9],[30,11],[40,12],[45,13],[50,14],[55,15],[60,16],[999,17]]",
        "note": "standard mangos vanilla formulas; verify in game if exact values matter"}})
    log("  xp levels: %d (max level needs %s)" % (len(rows), need.get(59)))


# ============================================================== zone levels
def pct(vals, p):
    vals = sorted(vals)
    if not vals:
        return ""
    k = (len(vals) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(vals) - 1)
    return round(vals[lo] + (vals[hi] - vals[lo]) * (k - lo), 1)


def sec_zones(ctx):
    if not hasattr(ctx, "spawn_rows"):
        sec_spawns(ctx)
    cur = ctx.cur
    tpl, tc, z = ctx.tpl, ctx.tc, ctx.zones
    zone_lv = defaultdict(list)
    sub_lv = defaultdict(list)
    zone_all = Counter()
    for entry, r in ctx.spawn_rows:
        t = tpl.get(entry)
        if not t:
            continue
        mp, x, y = r["map"], float(r["x"]), float(r["y"])
        m_, zone, sub = z.locate(mp, x, y)
        zone_all[(m_, zone)] += 1
        if g(t, tc, "creaturetype") in (8, 11) or g(t, tc, "npcflags"):
            continue            # critters, totems, vendors, quest givers ...
        if g(t, tc, "rank") == 3:
            continue            # world bosses show as ??
        lv = (g(t, tc, "minlevel") + g(t, tc, "maxlevel")) / 2.0
        if lv < 1:
            continue
        zone_lv[(m_, zone)].append(lv)
        sub_lv[(m_, zone, sub)].append(lv)
    # quests per zone
    qc = columns(cur, "quest_template")
    cur.execute("SELECT ZoneOrSort zs, QuestLevel ql, MinLevel ml FROM quest_template")
    qlv = defaultdict(list)
    for q in cur.fetchall():
        if q["zs"] and q["zs"] > 0:
            nm = ctx.resolver.zone_name(q["zs"]) if q["zs"] in getattr(ctx.resolver, "areas", {}) else ""
            if nm:
                qlv[nm].append((q["ql"], q["ml"]))
    rows, out = [], []
    for key in sorted(zone_lv, key=lambda k: (k[0], pct(zone_lv[k], 50))):
        v = zone_lv[key]
        qs = qlv.get(key[1], [])
        rows.append([key[0], key[1], len(v), min(v), pct(v, 10), pct(v, 50), pct(v, 90), max(v),
                     len(qs), min([q[0] for q in qs]) if qs else "", max([q[0] for q in qs]) if qs else "",
                     min([q[1] for q in qs if q[1]] or [""]) if qs else ""])
        out.append({"map": key[0], "zone": key[1], "mobs": len(v), "min": min(v), "p10": pct(v, 10),
                    "median": pct(v, 50), "p90": pct(v, 90), "max": max(v),
                    "quests": len(qs), "quest_level": [min(q[0] for q in qs), max(q[0] for q in qs)] if qs else None})
    write_sheet(ctx, "Zone Levels", ["Map", "Zone", "Hostile Mob Spawns", "Min Level", "10th %", "Median", "90th %",
                                     "Max Level", "Quests", "Quest Level Min", "Quest Level Max", "Min Level To Take A Quest"],
                [16, 26, 11, 8, 8, 8, 8, 8, 8, 10, 10, 12], rows)
    srows, sout = [], []
    for key in sorted(sub_lv, key=lambda k: (k[0], k[1], pct(sub_lv[k], 50))):
        v = sub_lv[key]
        srows.append([key[0], key[1], key[2] or "(zone-wide)", len(v), min(v), pct(v, 10), pct(v, 50), pct(v, 90), max(v)])
        sout.append({"map": key[0], "zone": key[1], "subzone": key[2], "mobs": len(v), "min": min(v),
                     "median": pct(v, 50), "p90": pct(v, 90), "max": max(v)})
    write_sheet(ctx, "Subzone Levels", ["Map", "Zone", "Subzone", "Hostile Mob Spawns", "Min Level", "10th %",
                                        "Median", "90th %", "Max Level"],
                [16, 24, 28, 11, 8, 8, 8, 8, 8], srows)
    save_json("zone_levels", {"zones": out, "subzones": sout})
    log("  zones: %d, subzones: %d" % (len(rows), len(srows)))


SECTIONS = [("spawns", sec_spawns), ("graveyards", sec_graveyards), ("xp", sec_xp), ("zones", sec_zones)]


def main():
    from openpyxl import Workbook
    want = [a.lower() for a in sys.argv[1:]] or [n for n, f in SECTIONS]
    ctx = Ctx()
    ctx.wb = Workbook()
    ctx.wb.remove(ctx.wb.active)
    log("Connecting to database ...")
    conn = connect()
    ctx.cur = conn.cursor()
    log("Preparing zone lookup ...")
    ctx.resolver = make_resolver(ctx.cur)
    ctx.zones = Zones(ctx.resolver)
    failed = []
    done = set()
    for name, fn in SECTIONS:
        if name not in want or name in done:
            continue
        log("== %s ==" % name)
        try:
            fn(ctx)
            done.add(name)
        except Exception as exc:
            traceback.print_exc()
            failed.append("%s (%s)" % (name, str(exc)[:80]))
        if name == "spawns":
            done.add("spawns")
    try:
        ctx.resolver.save_cache()
    except Exception:
        pass
    conn.close()
    log("Saving Excel file (large sheets take a minute) ...")
    ctx.wb.save(OUTPUT)
    log("Done. %s" % OUTPUT)
    if failed:
        log("These sections failed: " + "; ".join(failed))


if __name__ == "__main__":
    run(main)
