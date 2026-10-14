# -*- coding: utf-8 -*-
"""
The loot tables of the creatures as the server rolls them (groups and reference tables kept), added to
gamedata/loot.json as "raw":

  raw.creature  {lootId: [[item, chance, group, minCountOrRef, maxCount], ...]}
  raw.reference {refId:  [[item, chance, group, minCountOrRef, maxCount], ...]}
  raw.disenchant {disenchantId: [...]}   (and "de" - the disenchant id - on the items in items.json)

How the game rolls them (game/combat.js lootDrops, like cMaNGOS):
  - group 0: every row on its own, chance % (a negative chance: a quest item, only with the quest)
  - group N: at most ONE item of the group: the rows with a chance first (one roll over their chances), else one of the
    rows with chance 0 (equal share) - a group of a boss's own items always gives one of them
  - minCountOrRef < 0: a reference - with that chance the table -minCountOrRef is rolled maxCount times

The flat "tables.creature" (chances after resolving everything) stays for the tooltips, quests and prices.

Run:  py wow_loot_groups.py <ClassicDB Full_DB .sql or .sql.gz>     (wow_loot_all.py adds them from the database itself)
"""
import json, os, sys

import classicdb_sql as S

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def raw_from_cursor(cur, used):
    """the same from the database (wow_loot_all.py): {"creature": {...}, "reference": {...}}"""
    from wow_util import columns, g, table_exists

    def load(table):
        if not table_exists(cur, table):
            return {}
        c = columns(cur, table)
        cur.execute("SELECT * FROM `%s`" % table)
        out = {}
        for r in cur.fetchall():
            ch = g(r, c, "chanceorquestchance", 0) or g(r, c, "chance", 0) or 0
            out.setdefault(g(r, c, "entry"), []).append([g(r, c, "item"), round(float(ch), 4), g(r, c, "groupid") or 0, g(r, c, "mincountorref"), g(r, c, "maxcount") or 1])
        return out
    out = pick(load("creature_loot_template"), load("reference_loot_template"), used)
    out["disenchant"] = {str(k): v for k, v in load("disenchant_loot_template").items()}
    return out


def pick(cr, rf, used):
    raw_c = {str(i): cr[i] for i in sorted(set(used)) if i in cr}
    need, raw_r = [], {}
    for rows in raw_c.values():
        need += [-r[3] for r in rows if r[3] < 0]
    while need:
        i = need.pop()
        if str(i) in raw_r or i not in rf:
            continue
        raw_r[str(i)] = rf[i]
        need += [-r[3] for r in rf[i] if r[3] < 0]
    return {"creature": raw_c, "reference": raw_r}


def main():
    dump = sys.argv[1]
    path = os.path.join(ROOT, "gamedata", "loot.json")
    L = json.load(open(path, encoding="utf-8"))
    t = S.tables(dump, ["creature_loot_template", "reference_loot_template", "disenchant_loot_template", "item_template"])

    def rows_of(tbl):
        cols, rows = tbl
        ix = {c.lower(): i for i, c in enumerate(cols)}
        out = {}
        for r in rows:
            ch = r[ix["chanceorquestchance"]] or 0
            out.setdefault(r[ix["entry"]], []).append([r[ix["item"]], round(float(ch), 4), r[ix["groupid"]] or 0, r[ix["mincountorref"]], r[ix["maxcount"]] or 1])
        return out

    cr = rows_of(t["creature_loot_template"])
    rf = rows_of(t["reference_loot_template"])
    used = sorted({v[6] for v in L["creatures"].values() if v[6]})
    L["raw"] = pick(cr, rf, used)          # with the reference tables reached from these (references can point to references)
    L["raw"]["disenchant"] = {str(k): v for k, v in rows_of(t["disenchant_loot_template"]).items()}
    # which disenchant table every item has ("de" in items.json and items_equip.json, as wow_items_json.py writes it)
    cols, rows = t["item_template"]; ix = {c.lower(): i for i, c in enumerate(cols)}
    de = {str(r[ix["entry"]]): r[ix["disenchantid"]] for r in rows if r[ix["disenchantid"]]}
    for name in ("items", "items_equip"):
        ip = os.path.join(ROOT, "gamedata", name + ".json")
        if not os.path.exists(ip):
            continue
        J = json.load(open(ip, encoding="utf-8")); n = 0
        for k, it in J["items"].items():
            if k in de:
                it["de"] = de[k]; n += 1
        with open(ip, "w", encoding="utf-8") as fh:
            json.dump(J, fh, separators=(",", ":"))
        print("%s.json: %d items can be disenchanted" % (name, n))
    raw_c, raw_r = L["raw"]["creature"], L["raw"]["reference"]
    # every item that can drop has its name and quality in loot.items
    have = set(L["items"])
    miss = {r[0] for rows in list(raw_c.values()) + list(raw_r.values()) for r in rows if r[3] >= 0 and str(r[0]) not in have}
    print("creature tables %d (%d rows), reference tables %d (%d rows), items not in loot.items: %d" % (
        len(raw_c), sum(len(x) for x in raw_c.values()), len(raw_r), sum(len(x) for x in raw_r.values()), len(miss)))
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(L, fh, separators=(",", ":"))
    print("gamedata/loot.json written")


if __name__ == "__main__":
    main()
