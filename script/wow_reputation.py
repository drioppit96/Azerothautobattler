# -*- coding: utf-8 -*-
"""
Reputation for the game (game/reputation.js), from the cMaNGOS classic database dump and Faction.dbc.

Writes gamedata/reputation.json:
  f      {factionId: {n, d, p, i, b}}   every faction with a reputation bar (and the headers they sit under):
         name, description, parent (header), reputation index, b = [[raceMask, classMask, base, flags], ...] the
         starting standing by race / class (Faction.dbc ReputationRaceMask / ClassMask / Base / Flags; flags: 1 visible,
         2 at war, 4 hidden, 8 invisible, 16 peace forced)
  kill   {creatureEntry: [faction1, value1, maxRank1, teamAward1, faction2, value2, maxRank2, teamAward2, teamDependent]}
         creature_onkill_reputation: the reputation a kill gives (or takes) while the standing is at most maxRank
         (0 Hated .. 7 Exalted); team dependent: faction 1 for the Alliance, faction 2 for the Horde
  spill  {factionId: [[otherFaction, rate, maxRank], ...]}   reputation_spillover_template
gamedata/items.json:  "rf" / "rr" (RequiredReputationFaction / Rank: needed to buy and to use the item)
gamedata/quests.json: "type" (1 group, 41 PvP, 62 raid, 81 dungeon), "sugg" (suggested players),
                      "minrep" / "maxrep" [faction, value] (the quest is offered from / below that reputation),
                      "repobj" [faction, value] (an objective: reach that reputation)

Run:  py wow_reputation.py <ClassicDB Full_DB .sql or .sql.gz>
Needs Faction.dbc in C:\\wow excel\\dbc (or the folder in the environment variable WOW_DBC_DIR).
"""
import json
import os
import sys

import classicdb_sql as S

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
GD = os.path.join(ROOT, "gamedata")


def s32(v):
    return v - (1 << 32) if v >= (1 << 31) else v


def load_json(name):
    with open(os.path.join(GD, name), encoding="utf-8") as f:
        return json.load(f)


def save_json(name, data):
    with open(os.path.join(GD, name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("  wrote gamedata/%s" % name)


def factions():
    from wow_common import load_dbc
    d = load_dbc("Faction")
    if not d:
        sys.exit("Faction.dbc is needed (extract_dbc_multi.py)")
    name_i = d.find_field(72, "Stormwind") or 19
    desc_i = name_i + 9
    out = {}
    for r in d.rows:
        fid, idx = r[0], s32(r[1])
        name = d.s(r[name_i]).strip()
        if idx < 0 or not name or d.s(r[name_i]).startswith(" "):
            continue            # no reputation bar; the profession specialisations ("  Leatherworking - ...")
        b = []
        for k in range(4):
            if r[2 + k] or r[6 + k]:
                b.append([r[2 + k], r[6 + k], s32(r[10 + k]), r[14 + k]])
        o = {"n": name, "i": idx, "b": b}
        if r[18]:
            o["p"] = r[18]
        desc = d.s(r[desc_i]).strip() if desc_i < len(r) else ""
        if desc:
            o["d"] = desc
        out[fid] = o
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    t = S.tables(sys.argv[1], ["creature_onkill_reputation", "reputation_spillover_template", "item_template",
                               "quest_template"])
    fac = factions()
    print("factions with a reputation bar: %d" % len(fac))

    kill = {}
    c, rows = t["creature_onkill_reputation"]
    ix = {k: i for i, k in enumerate(c)}
    for r in rows:
        v = [r[ix["RewOnKillRepFaction1"]], r[ix["RewOnKillRepValue1"]], r[ix["MaxStanding1"]], 1 if r[ix["IsTeamAward1"]] else 0,
             r[ix["RewOnKillRepFaction2"]], r[ix["RewOnKillRepValue2"]], r[ix["MaxStanding2"]], 1 if r[ix["IsTeamAward2"]] else 0,
             1 if r[ix["TeamDependent"]] else 0]
        if (v[0] and v[1]) or (v[4] and v[5]):
            kill[r[ix["creature_id"]]] = v
    print("creatures that give reputation: %d" % len(kill))

    spill = {}
    c, rows = t["reputation_spillover_template"]
    ix = {k: i for i, k in enumerate(c)}
    for r in rows:
        lst = []
        for k in range(1, 5):
            f = r[ix["faction%d" % k]]
            if f:
                lst.append([f, float(r[ix["rate_%d" % k]]), r[ix["rank_%d" % k]]])
        if lst:
            spill[r[ix["faction"]]] = lst

    save_json("reputation.json", {"f": fac, "kill": kill, "spill": spill})

    # ---- items: the reputation needed to buy / use them
    c, rows = t["item_template"]
    ix = {k: i for i, k in enumerate(c)}
    need = {r[ix["entry"]]: (r[ix["RequiredReputationFaction"]], r[ix["RequiredReputationRank"]]) for r in rows}
    for fn in ("items.json", "items_equip.json"):
        if not os.path.exists(os.path.join(GD, fn)):
            continue
        J = load_json(fn)
        n = 0
        for k, it in J["items"].items():
            it.pop("rf", None); it.pop("rr", None)
            f, rk = need.get(int(k), (0, 0))
            if f:
                it["rf"] = f; it["rr"] = rk; n += 1
        print("%s: %d items need reputation" % (fn, n))
        save_json(fn, J)

    # ---- quests: group quests, reputation requirements
    quests = load_json("quests.json")
    by = {q["id"]: q for q in quests}
    c, rows = t["quest_template"]
    ix = {k: i for i, k in enumerate(c)}
    ng = 0
    for r in rows:
        q = by.get(r[ix["entry"]])
        if not q:
            continue
        for k in ("type", "sugg", "minrep", "maxrep", "repobj"):
            q.pop(k, None)
        if r[ix["Type"]]:
            q["type"] = r[ix["Type"]]
        if r[ix["Type"]] == 1:
            ng += 1
        if r[ix["SuggestedPlayers"]]:
            q["sugg"] = r[ix["SuggestedPlayers"]]
        if r[ix["RequiredMinRepFaction"]]:
            q["minrep"] = [r[ix["RequiredMinRepFaction"]], r[ix["RequiredMinRepValue"]]]
        if r[ix["RequiredMaxRepFaction"]]:
            q["maxrep"] = [r[ix["RequiredMaxRepFaction"]], r[ix["RequiredMaxRepValue"]]]
        if r[ix["RepObjectiveFaction"]]:
            q["repobj"] = [r[ix["RepObjectiveFaction"]], r[ix["RepObjectiveValue"]]]
    print("group quests: %d" % ng)
    with open(os.path.join(GD, "quests.json"), "w", encoding="utf-8", newline="\r\n") as f:
        json.dump(quests, f, ensure_ascii=False, indent=0)
    print("  wrote gamedata/quests.json")


if __name__ == "__main__":
    main()
