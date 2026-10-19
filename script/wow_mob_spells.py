# -*- coding: utf-8 -*-
"""
What spells the creatures use, with every detail of the server's events (game/mobspells.js reads them):

  spells.json   "mob_use": {entry: [[spellId, source, p1, p2, p3, p4, chance, target, flags], ...]}
     source "list"     creature_spell_list: p1-p4 = first cast min/max, repeat min/max (ms), target = CastTarget
            "template" creature_template_spells (no timers)
            "ai:N"     EventAI event type N (action "cast"): p1-p4 the event's parameters as the server has them
                       (0 combat timer: first min/max, repeat min/max; 2 own health %: max, min, repeat min/max;
                        9 range: min, max, repeat min/max; 12 target health %; 13 target casting; 14 a friend missing
                        p1 health within p2 yards, repeat p3/p4; 27 missing buff ...), target = the action's target,
                       flags = event_flags (1: repeatable)
  creature_stats.json   a 6th field per creature: [mana at min level, mana at max level]

Run:  py wow_mob_spells.py <ClassicDB Full_DB .sql or .sql.gz>      (wow_spells_json.py writes the same from the database)
"""
import json, os, sys
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def mob_uses(rows_template, rows_list, rows_tspells, rows_ai):
    """the four tables as lists of dicts (lower-case keys) -> {entry: [[...], ...]}"""
    uses = defaultdict(list)
    lists = {}
    for r in rows_list:
        lists.setdefault(r["id"], []).append([r["spellid"], "list", r.get("initialmin") or 0, r.get("initialmax") or 0, r.get("repeatmin") or 0,
                                             r.get("repeatmax") or 0, r.get("probability") or 0, r.get("casttarget") or 0, 1])
    for r in rows_template:
        sl = r.get("spelllist")
        for u in lists.get(sl, []) if sl else []:
            uses[r["entry"]].append(list(u))
    for r in rows_tspells:
        for k in range(1, 11):
            v = r.get("spell%d" % k)
            if v:
                uses[r["entry"]].append([v, "template", 0, 0, 0, 0, 0, 0, 0])
    for r in rows_ai:
        for k in (1, 2, 3):
            if r.get("action%d_type" % k) == 11 and r.get("action%d_param1" % k):
                uses[r["creature_id"]].append([r["action%d_param1" % k], "ai:%d" % r["event_type"]] +
                                              [r.get("event_param%d" % i) or 0 for i in range(1, 5)] +
                                              [r.get("event_chance") or 0, r.get("action%d_param2" % k) or 0, r.get("event_flags") or 0])
    return uses


def lower(tbl):
    cols, rows = tbl
    lc = [c.lower() for c in cols]
    return [dict(zip(lc, r)) for r in rows]


def main():
    import classicdb_sql as S
    dump = sys.argv[1]
    t = S.tables(dump, ["creature_template", "creature_spell_list", "creature_template_spells", "creature_ai_scripts"])
    tmpl = lower(t["creature_template"])
    uses = mob_uses(tmpl, lower(t["creature_spell_list"]), lower(t["creature_template_spells"]), lower(t["creature_ai_scripts"]))
    sp_path = os.path.join(ROOT, "gamedata", "spells.json")
    SP = json.load(open(sp_path, encoding="utf-8"))
    have = SP["spells"]
    SP["mob_use"] = {str(e): lst for e, lst in uses.items() if any(str(u[0]) in have for u in lst)}
    missing = len({u[0] for l in uses.values() for u in l if str(u[0]) not in have})
    with open(sp_path, "w", encoding="utf-8") as fh:
        json.dump(SP, fh, separators=(",", ":"))
    print("spells.json mob_use: %d creatures (%d spells not in spells.json are left out)" % (len(SP["mob_use"]), missing))
    # mana
    cs_path = os.path.join(ROOT, "gamedata", "creature_stats.json")
    CS = json.load(open(cs_path, encoding="utf-8"))
    mana = {str(r["entry"]): [r.get("minlevelmana") or 0, r.get("maxlevelmana") or r.get("minlevelmana") or 0] for r in tmpl}
    n = 0
    for e, v in CS.items():
        mm = mana.get(e)
        if mm and (mm[0] or mm[1]):
            v[5:] = [mm]; n += 1
    with open(cs_path, "w", encoding="utf-8") as fh:
        json.dump(CS, fh, separators=(",", ":"))
    print("creature_stats.json: mana for %d creatures" % n)


if __name__ == "__main__":
    main()
