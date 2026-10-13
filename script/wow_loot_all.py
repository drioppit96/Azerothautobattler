# -*- coding: utf-8 -*-
"""
Loot of EVERY creature (normal mobs, elites, bosses) for the auto-battler.

Writes  C:\\wow excel\\wow_loot_all.xlsx
        C:\\wow excel\\gamedata\\loot.json

loot.json layout (compact on purpose, ~ a few MB):
  items      {itemId: [name, quality, sellPrice, class, subclass, stackable]}
  tables     {kind: {lootId: [[itemId, chance%, min, max, questItem(0/1)], ...]}}
               kind = creature | skinning | pickpocket | item | fishing | disenchant
               chance% is the REAL chance after groups and reference tables were resolved
  creatures  {entry: [name, minLevel, maxLevel, rank, type, family,
                      lootId, skinLootId, pickpocketLootId, goldMin, goldMax,
                      expectedValueCopper, spawnCount]}
  quest_items {itemId: [questId, ...]}      items needed by quests (drop only with the quest)
  fishing_areas {areaId: [name, lootId]}

Expected value = average gold + sum(chance * average count * vendor sell price)
over non-quest items (what a kill is worth if you sell everything).

Run:  py wow_loot_all.py
Needs wow_common.py, wow_util.py, wow_dungeons.py (same folder).
"""
import os
from collections import defaultdict

from wow_util import *   # noqa
from wow_dungeons import LootBook

OUTPUT = os.path.join(OUT_FOLDER, "wow_loot_all.xlsx")
ONLY_SPAWNED = True       # skip creature templates that never spawn in the world
QUALITY_NAMES = {0: "Poor", 1: "Common", 2: "Uncommon", 3: "Rare", 4: "Epic", 5: "Legendary"}
RANKS = {0: "Normal", 1: "Elite", 2: "Rare Elite", 3: "Boss", 4: "Rare"}
TYPES = {1: "Beast", 2: "Dragonkin", 3: "Demon", 4: "Elemental", 5: "Giant", 6: "Undead",
         7: "Humanoid", 8: "Critter", 9: "Mechanical", 10: "Not specified", 11: "Totem"}


def spawn_counts(cur):
    cnt = defaultdict(int)
    if table_exists(cur, "creature"):
        c = columns(cur, "creature")
        cur.execute("SELECT `%s` i, COUNT(*) n FROM creature GROUP BY `%s`" % (c["id"], c["id"]))
        for r in cur.fetchall():
            cnt[r["i"]] += r["n"]
    if table_exists(cur, "creature_spawn_entry"):
        c = columns(cur, "creature_spawn_entry")
        cur.execute("SELECT `%s` i, COUNT(*) n FROM creature_spawn_entry GROUP BY `%s`" % (c["entry"], c["entry"]))
        for r in cur.fetchall():
            cnt[r["i"]] += r["n"]
    return cnt


def load_loot(cur, table, ids):
    """loot id -> [[item, pct, min, max, quest]]  (resolved), via LootBook"""
    ids = sorted(set(i for i in ids if i))
    if not ids or not table_exists(cur, table):
        return {}
    book = LootBook(cur, table)
    book.preload(ids)
    out = {}
    for lid in ids:
        res = book.expand(lid)
        rows = []
        for item, (pct, mn, mx, quest) in res.items():
            if item <= 0:
                continue
            rows.append([item, round(pct, 3), int(mn or 1), int(mx or 1), 1 if quest else 0])
        rows.sort(key=lambda x: -x[1])
        if rows:
            out[lid] = rows
    return out


def table_value(rows, items):
    v = 0.0
    for item, pct, mn, mx, quest in rows:
        if quest:
            continue
        it = items.get(item)
        if not it:
            continue
        v += pct / 100.0 * (mn + mx) / 2.0 * (it[2] or 0)
    return v


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    tc = columns(cur, "creature_template")
    cur.execute("SELECT * FROM creature_template")
    templ = cur.fetchall()
    log("Creature templates: %d" % len(templ))
    spawns = spawn_counts(cur)

    crea = {}
    for r in templ:
        e = g(r, tc, "entry")
        sp = spawns.get(e, 0)
        if ONLY_SPAWNED and not sp:
            continue
        crea[e] = {
            "name": g(r, tc, "name", ""), "min": g(r, tc, "minlevel"), "max": g(r, tc, "maxlevel"),
            "rank": g(r, tc, "rank"), "type": g(r, tc, "creaturetype"), "family": g(r, tc, "family"),
            "loot": g(r, tc, "lootid"), "skin": g(r, tc, "skinninglootid"),
            "pick": g(r, tc, "pickpocketlootid"),
            "gmin": g(r, tc, "minlootgold"), "gmax": g(r, tc, "maxlootgold"), "spawns": sp}
    log("Creatures with spawns: %d" % len(crea))

    kinds = {}
    log("Resolving creature loot ...")
    kinds["creature"] = load_loot(cur, "creature_loot_template", [c["loot"] for c in crea.values()])
    log("  %d loot tables" % len(kinds["creature"]))
    log("Resolving skinning / pickpocket loot ...")
    kinds["skinning"] = load_loot(cur, "skinning_loot_template", [c["skin"] for c in crea.values()])
    kinds["pickpocket"] = load_loot(cur, "pickpocketing_loot_template", [c["pick"] for c in crea.values()])

    # containers (clams, lockboxes, bags) and disenchanting
    ic = columns(cur, "item_template")
    cur.execute("SELECT * FROM item_template")
    item_rows = cur.fetchall()
    cont_ids, dis_ids = [], []
    for r in item_rows:
        e = g(r, ic, "entry")
        if g(r, ic, "flags") & 4:                 # "openable"
            cont_ids.append(e)
        d = g(r, ic, "disenchantid")
        if d:
            dis_ids.append(d)
    kinds["item"] = load_loot(cur, "item_loot_template", cont_ids)
    kinds["disenchant"] = load_loot(cur, "disenchant_loot_template", dis_ids)

    # fishing per area
    fish_areas = {}
    areas = area_names()
    if table_exists(cur, "fishing_loot_template"):
        fc = columns(cur, "fishing_loot_template")
        cur.execute("SELECT DISTINCT `%s` e FROM fishing_loot_template" % fc["entry"])
        ids = [r["e"] for r in cur.fetchall()]
        kinds["fishing"] = load_loot(cur, "fishing_loot_template", ids)
        for i in ids:
            fish_areas[i] = [areas.get(i, (0, 0, ""))[2], i]
    else:
        kinds["fishing"] = {}

    # item info
    need = set()
    for t in kinds.values():
        for rows in t.values():
            for x in rows:
                need.add(x[0])
    items = {}
    sell = {}
    for r in item_rows:
        e = g(r, ic, "entry")
        if e in need:
            items[e] = [g(r, ic, "name", ""), g(r, ic, "quality"), g(r, ic, "sellprice"),
                        g(r, ic, "class"), g(r, ic, "subclass"), g(r, ic, "stackable") or 1]
    log("Distinct dropped items: %d" % len(items))

    # quest items -> quests
    quest_items = defaultdict(list)
    if table_exists(cur, "quest_template"):
        qc = columns(cur, "quest_template")
        cols = [qc[k] for k in ("reqitemid1", "reqitemid2", "reqitemid3", "reqitemid4") if k in qc]
        if cols:
            cur.execute("SELECT `%s` q, %s FROM quest_template" % (qc["entry"], ", ".join("`%s`" % c for c in cols)))
            for r in cur.fetchall():
                for c in cols:
                    if r[c] and r[c] in need:
                        quest_items[r[c]].append(r["q"])

    # expected value per creature
    ev = {}
    for e, c in crea.items():
        v = (c["gmin"] + c["gmax"]) / 2.0
        if c["loot"] in kinds["creature"]:
            v += table_value(kinds["creature"][c["loot"]], items)
        ev[e] = int(round(v))

    # ------------------------------------------------------------- JSON
    creatures = {}
    for e, c in crea.items():
        if not (c["loot"] or c["skin"] or c["pick"] or c["gmax"]):
            continue
        creatures[e] = [c["name"], c["min"], c["max"], c["rank"], c["type"], c["family"],
                        c["loot"], c["skin"], c["pick"], c["gmin"], c["gmax"], ev[e], c["spawns"]]
    log("Creatures that drop something: %d" % len(creatures))
    save_json("loot", {"items": items,
                       "tables": {k: {str(i): rows for i, rows in v.items()} for k, v in kinds.items()},
                       "creatures": creatures,
                       "quest_items": {str(k): v for k, v in quest_items.items()},
                       "fishing_areas": {str(k): v for k, v in fish_areas.items()}})

    # ------------------------------------------------------------- Excel
    book = BigBook(OUTPUT)
    ws = book.sheet("Creatures", ["Entry", "Name", "Min Lvl", "Max Lvl", "Rank", "Type", "Loot Id",
                                  "Skinning Id", "Pickpocket Id", "Gold", "Expected value", "Drops", "Spawns"],
                    [8, 32, 7, 7, 11, 12, 9, 10, 11, 12, 14, 7, 8])
    for e in sorted(creatures):
        c = crea[e]
        g_ = (c["gmin"] + c["gmax"]) // 2
        ws.append([e, c["name"], c["min"], c["max"], RANKS.get(c["rank"], c["rank"]),
                   TYPES.get(c["type"], c["type"]), c["loot"] or "", c["skin"] or "", c["pick"] or "",
                   money(g_), money(ev[e]), len(kinds["creature"].get(c["loot"], [])), c["spawns"]])

    users = defaultdict(lambda: defaultdict(list))
    for e, c in crea.items():
        for kind, key in (("creature", "loot"), ("skinning", "skin"), ("pickpocket", "pick")):
            if c[key]:
                users[kind][c[key]].append(c["name"])
    titles = {"creature": "Creature Drops", "skinning": "Skinning Drops", "pickpocket": "Pickpocket Drops",
              "item": "Container Items", "fishing": "Fishing", "disenchant": "Disenchant"}
    for kind in ("creature", "skinning", "pickpocket", "item", "fishing", "disenchant"):
        tbl = kinds.get(kind) or {}
        if not tbl:
            continue
        ws = book.sheet(titles[kind], ["Loot Id", "Used by (count)", "Example users", "Item Id", "Item",
                                       "Quality", "Chance %", "Min", "Max", "Quest item", "Sell price"],
                        [9, 9, 40, 9, 36, 10, 9, 5, 5, 9, 11])
        for lid in sorted(tbl):
            us = users[kind].get(lid, [])
            if kind == "fishing":
                ex = fish_areas.get(lid, ["", ""])[0]
            else:
                ex = ", ".join(sorted(set(us))[:3])
            for item, pct, mn, mx, q in tbl[lid]:
                it = items.get(item, ["?", 0, 0, 0, 0, 1])
                ws.append([lid, len(us), ex, item, it[0], QUALITY_NAMES.get(it[1], it[1]),
                           pct, mn, mx, "yes" if q else "", money(it[2])])
    book.save()
    conn.close()
    log("Done.")


if __name__ == "__main__":
    run(main)
