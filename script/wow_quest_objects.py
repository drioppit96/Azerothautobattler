# -*- coding: utf-8 -*-
"""
Game objects for questing: what every spawned / quest-related game object is and what it drops
(Cactus Apples, Taillasher Eggs, Sacks of Supplies, quest chests ...).

Writes  C:\\wow excel\\gamedata\\go_data.json
  objects   {entry: [name, type, lootId]}         type: 3 chest, 10 goober (use), 2 quest giver, ...
  loot      {lootId: [[itemId, chance%, min, max, questItem(0/1)], ...]}   (groups / references resolved)

Run:  py wow_quest_objects.py       (or  py build_gamedata.py goquest)
"""
from wow_util import *   # noqa
from wow_loot_all import load_loot


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    if not table_exists(cur, "gameobject_template"):
        log("gameobject_template missing - nothing to do"); return
    spawned = set()
    if table_exists(cur, "gameobject"):
        gc = columns(cur, "gameobject")
        cur.execute("SELECT DISTINCT `%s` i FROM gameobject" % gc["id"])
        spawned.update(r["i"] for r in cur.fetchall())
    if table_exists(cur, "gameobject_spawn_entry"):
        sc = columns(cur, "gameobject_spawn_entry")
        cur.execute("SELECT DISTINCT `%s` i FROM gameobject_spawn_entry" % sc["entry"])
        spawned.update(r["i"] for r in cur.fetchall())
    quest_go = set()
    for t in ("gameobject_questrelation", "gameobject_involvedrelation", "quest_relations"):
        if table_exists(cur, t):
            qc = columns(cur, t)
            key = "id" if "id" in qc else "entry"
            if t == "quest_relations":
                if "actor" in qc:
                    cur.execute("SELECT `%s` i FROM quest_relations WHERE `%s` = 1" % (qc["entry"], qc["actor"]))
                else:
                    continue
            else:
                cur.execute("SELECT `%s` i FROM `%s`" % (qc[key], t))
            quest_go.update(r["i"] for r in cur.fetchall())
    log("Spawned game objects: %d, quest objects: %d" % (len(spawned), len(quest_go)))
    tc = columns(cur, "gameobject_template")
    cur.execute("SELECT * FROM gameobject_template")
    objs, loot_ids = {}, []
    for r in cur.fetchall():
        e = g(r, tc, "entry")
        if e not in spawned and e not in quest_go:
            continue
        typ = g(r, tc, "type")
        lid = g(r, tc, "data1") if typ in (3, 25) else 0     # chest / fishing hole: data1 = loot id
        objs[e] = [g(r, tc, "name", ""), typ, lid]
        if lid:
            loot_ids.append(lid)
    log("Objects kept: %d, with loot: %d" % (len(objs), len(set(loot_ids))))
    loot = load_loot(cur, "gameobject_loot_template", loot_ids)
    log("Loot tables resolved: %d" % len(loot))
    save_json("go_data", {"objects": {str(k): v for k, v in objs.items()},
                          "loot": {str(k): v for k, v in loot.items()}})


if __name__ == "__main__":
    main()
