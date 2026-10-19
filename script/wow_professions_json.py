# -*- coding: utf-8 -*-
"""
Builds gamedata/professions.json (and event_mobs.json) for the game from a cMaNGOS
classic database dump (Full_DB/ClassicDB_1_12_1_*.sql.gz from github.com/cmangos/classic-db).

    py wow_professions_json.py  path\\to\\ClassicDB_1_12_1_z2815.sql.gz

professions.json:
  skills   {skillId: {n, kind: gather|craft|secondary, ranks: [[spell, maxSkill, reqLevel, cost], ...]}}
  recipes  {spellId: {n, skill, learn, y, g, gr, re: [[item, n]], cr: [item, min, max] | null,
                      ench: name | null, cost, lvl, trainers: [npc...], item: recipeItem | 0, ic}}
  trainers {npcEntry: [skillId, ...]}
  nodes    {goEntry: [kind, skill]}           kind: herb | ore
event_mobs.json: creature entries that only appear during world events
(pets.json: wow_pets.py)
"""
import json, os, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classicdb_sql import tables, dicts

SKILLS = {171: ("Alchemy", "craft"), 164: ("Blacksmithing", "craft"), 333: ("Enchanting", "craft"),
          202: ("Engineering", "craft"), 165: ("Leatherworking", "craft"), 197: ("Tailoring", "craft"),
          182: ("Herbalism", "gather"), 186: ("Mining", "gather"), 393: ("Skinning", "gather"),
          185: ("Cooking", "secondary"), 129: ("First Aid", "secondary")}
RANK_MAX = [75, 150, 225, 300]
# recipe item subclass (item class 9) -> skill
RECIPE_SUB = {1: 165, 2: 197, 3: 202, 4: 164, 5: 185, 6: 171, 7: 129, 8: 333}
HERBS = {"Peacebloom": 1, "Silverleaf": 1, "Earthroot": 15, "Mageroyal": 50, "Briarthorn": 70, "Stranglekelp": 85,
         "Bruiseweed": 100, "Wild Steelbloom": 115, "Grave Moss": 120, "Kingsblood": 125, "Liferoot": 150, "Fadeleaf": 160,
         "Goldthorn": 170, "Khadgar's Whisker": 185, "Wintersbite": 195, "Firebloom": 205, "Purple Lotus": 210,
         "Arthas' Tears": 220, "Sungrass": 230, "Blindweed": 235, "Ghost Mushroom": 245, "Gromsblood": 250,
         "Golden Sansam": 260, "Dreamfoil": 270, "Mountain Silversage": 280, "Plaguebloom": 285, "Icecap": 290,
         "Black Lotus": 300}
ORES = {"Copper Vein": 1, "Tin Vein": 65, "Incendicite Mineral Vein": 65, "Silver Vein": 75, "Lesser Bloodstone Deposit": 75,
        "Iron Deposit": 125, "Indurium Mineral Vein": 150, "Gold Vein": 155, "Mithril Deposit": 175, "Truesilver Deposit": 230,
        "Dark Iron Deposit": 230, "Small Thorium Vein": 245, "Rich Thorium Vein": 275, "Ooze Covered Silver Vein": 75,
        "Ooze Covered Gold Vein": 155, "Ooze Covered Iron Deposit": 125, "Ooze Covered Mithril Deposit": 175,
        "Ooze Covered Truesilver Deposit": 230, "Ooze Covered Thorium Vein": 245, "Ooze Covered Rich Thorium Vein": 275,
        "Small Obsidian Chunk": 305, "Large Obsidian Chunk": 305}


# SpellCastTimes.dbc of 1.12 (index -> ms): the cast time of every crafting spell
CAST_MS = {0: 0, 1: 0, 2: 250, 3: 500, 4: 1000, 5: 2000, 6: 5000, 7: 10000, 8: 20000, 9: 30000, 14: 3000, 15: 4000, 16: 1500,
           19: 2500, 20: 2500, 21: 2600, 22: 3500, 23: 1800, 24: 2200, 28: 3200, 30: 4500, 31: 2300, 32: 7000, 33: 5125,
           34: 8000, 35: 12500, 37: 25000, 38: 45000, 39: 60000, 50: 1300, 90: 1700, 91: 2800, 110: 750, 130: 1600, 171: 6000}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "ClassicDB_1_12_1_z2815.sql.gz"
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "gamedata")
    print("Reading", path, "...")
    T = tables(path, ["spell_template", "npc_trainer", "npc_trainer_template", "creature_template", "item_template",
                      "gameobject_template", "game_event_creature", "creature"])
    sp = {r["Id"]: r for r in dicts(T["spell_template"])}
    ct = {r["Entry"]: r for r in dicts(T["creature_template"])}
    it = {r["entry"]: r for r in dicts(T["item_template"])}

    def eff(r, k, f):
        return r["%s%d" % (f, k)]

    def learned(s):
        """a trainer spell that teaches another spell -> that spell"""
        r = sp.get(s)
        if r:
            for k in (1, 2, 3):
                if eff(r, k, "Effect") == 36 and eff(r, k, "EffectTriggerSpell"):
                    return eff(r, k, "EffectTriggerSpell")
        return s

    def skill_step(s):
        r = sp.get(s)
        if not r: return None
        for k in (1, 2, 3):
            if eff(r, k, "Effect") == 118 and eff(r, k, "EffectMiscValue") in SKILLS:
                return eff(r, k, "EffectMiscValue"), eff(r, k, "EffectBasePoints") + 1
        return None

    # trainer lists (own rows + template rows)
    tt = defaultdict(list)
    for r in dicts(T["npc_trainer_template"]): tt[r["entry"]].append(r)
    rows = defaultdict(list)
    for r in dicts(T["npc_trainer"]): rows[r["entry"]].append(r)
    for e, c in ct.items():
        tid = c.get("TrainerTemplateId") or 0
        if tid and tid in tt: rows[e].extend(tt[tid])

    skills = {sid: {"n": n, "kind": k, "ranks": []} for sid, (n, k) in SKILLS.items()}
    rank_seen = set(); recipes = {}; trainers = defaultdict(set)
    for npc, lst in rows.items():
        for r in lst:
            s = learned(r["spell"]); st = skill_step(s)
            if st:
                sid, step = st; trainers[npc].add(sid)
                key = (sid, step)
                if key not in rank_seen and 1 <= step <= 4:
                    rank_seen.add(key)
                    skills[sid]["ranks"].append([s, RANK_MAX[step - 1], r["reqlevel"] or [1, 10, 20, 35][step - 1], r["spellcost"]])
                continue
            if r["reqskill"] in SKILLS:
                sid = r["reqskill"]; trainers[npc].add(sid)
                rec = recipes.setdefault(s, {"skill": sid, "learn": r["reqskillvalue"] or 1, "cost": r["spellcost"], "lvl": r["reqlevel"], "trainers": [], "item": 0})
                rec["trainers"].append(npc)
    for sid in skills: skills[sid]["ranks"].sort(key=lambda x: x[1])
    # recipes that come with the Apprentice rank (SkillLineAbility "learn on get skill" - not in the dump)
    FREE = {171: ["Minor Healing Potion", "Elixir of Lion's Strength", "Elixir of Minor Defense"],
            164: ["Rough Sharpening Stone", "Rough Weightstone", "Rough Copper Vest", "Copper Bracers", "Copper Chain Belt"],
            165: ["Light Armor Kit", "Handstitched Leather Boots", "Handstitched Leather Bracers", "Handstitched Leather Vest"],
            197: ["Bolt of Linen Cloth", "Linen Cloak", "Brown Linen Vest", "Simple Linen Pants"],
            202: ["Rough Blasting Powder", "Rough Dynamite", "Handful of Copper Bolts", "Arclight Spanner"],
            333: ["Runed Copper Rod", "Enchant Bracer - Minor Health"],
            185: ["Charred Wolf Meat", "Roasted Boar Meat", "Spice Bread"], 129: ["Linen Bandage"], 186: ["Smelt Copper"]}
    by_name = defaultdict(list)
    for i, r in sp.items():
        if any(eff(r, k, "Effect") in (24, 53) for k in (1, 2, 3)): by_name[r["SpellName"]].append(i)
    for sid, names in FREE.items():
        for n in names:
            ids = sorted(by_name.get(n, []))
            if ids and ids[0] not in recipes:
                recipes[ids[0]] = {"skill": sid, "learn": 1, "cost": 0, "lvl": 0, "trainers": [], "item": 0, "free": 1}
            elif ids: recipes[ids[0]]["free"] = 1; recipes[ids[0]]["learn"] = 1
    # recipes from recipe items
    for e, r in it.items():
        if r["class"] != 9 or r["subclass"] not in RECIPE_SUB: continue
        for k in range(1, 6):
            s = r.get("spellid_%d" % k) or 0
            if not s or s == 483: continue
            s = learned(s)
            if s in sp and s not in recipes:
                recipes[s] = {"skill": r["RequiredSkill"] or RECIPE_SUB[r["subclass"]], "learn": r["RequiredSkillRank"] or 1, "cost": 0, "lvl": 0, "trainers": [], "item": e}
            elif s in recipes and not recipes[s]["item"]:
                recipes[s]["item"] = e
    # spell details
    for s in list(recipes):
        r = sp.get(s)
        if not r: del recipes[s]; continue
        rec = recipes[s]; rec["n"] = r["SpellName"]
        rec["ct"] = CAST_MS.get(r.get("CastingTimeIndex"), 0)        # how long one craft takes (ms), as in the game
        rec["re"] = [[r["Reagent%d" % k], r["ReagentCount%d" % k]] for k in range(1, 9) if r["Reagent%d" % k]]
        rec["cr"] = None; rec["ench"] = None
        for k in (1, 2, 3):
            e = eff(r, k, "Effect")
            if e == 24 and eff(r, k, "EffectItemType"):
                base = eff(r, k, "EffectBasePoints") + 1; dice = eff(r, k, "EffectDieSides")
                rec["cr"] = [eff(r, k, "EffectItemType"), max(1, base), max(1, base + max(0, dice - 1))]
            if e in (53, 54):
                rec["ench"] = r["SpellName"]
                rec["slot"] = [r["EquippedItemClass"], r["EquippedItemSubClassMask"], r["EquippedItemInventoryTypeMask"]]
        if not rec["cr"] and not rec["ench"]: del recipes[s]; continue
        L = rec["learn"]
        rec["y"], rec["g"], rec["gr"] = L + 25, L + 40, L + 55      # trivial levels (SkillLineAbility is not in the dump)
        if rec["cr"] and rec["cr"][0] in it: rec["ic"] = rec["cr"][0]
    # profession trainers only (not class trainers)
    trainers = {str(k): sorted(v) for k, v in trainers.items()}
    # gathering nodes
    nodes = {}
    for r in dicts(T["gameobject_template"]):
        n = r["name"]
        if n in HERBS: nodes[str(r["entry"])] = ["herb", HERBS[n]]
        elif n in ORES: nodes[str(r["entry"])] = ["ore", ORES[n]]
    data = {"skills": {str(k): v for k, v in skills.items()}, "recipes": {str(k): v for k, v in recipes.items()},
            "trainers": trainers, "nodes": nodes}
    with open(os.path.join(out, "professions.json"), "w", encoding="utf-8") as f: json.dump(data, f, separators=(",", ":"))
    print("professions.json: %d recipes, %d profession trainers, %d node kinds" % (len(recipes), len(trainers), len(nodes)))
    for sid, v in skills.items(): print("  %-15s ranks %s" % (v["n"], [x[1] for x in v["ranks"]]))

    # creatures that only spawn during world events
    ev = set(r["guid"] for r in dicts(T["game_event_creature"]) if r["event"] > 0)
    per = defaultdict(lambda: [0, 0])
    for r in dicts(T["creature"]):
        p = per[r["id"]]; p[0] += 1
        if r["guid"] in ev: p[1] += 1
    evm = sorted(e for e, (n, k) in per.items() if n and n == k)
    with open(os.path.join(out, "event_mobs.json"), "w") as f: json.dump(evm, f)
    print("event_mobs.json: %d creature entries" % len(evm))

    # shapeshift / stance requirements of class spells (druid forms, warrior stances, rogue stealth)
    cls_sp = json.load(open(os.path.join(out, "spells.json"), encoding="utf-8"))["spells"]
    st = {}
    for i in cls_sp:
        r = sp.get(int(i))
        if r and (r["Stances"] or r["StancesNot"]): st[i] = [r["Stances"], r["StancesNot"]]
    with open(os.path.join(out, "spell_stances.json"), "w") as f: json.dump(st, f, separators=(",", ":"))
    print("spell_stances.json: %d spells" % len(st))

    # pets.json (hunter pets and warlock demons: stats, families, abilities, tameable beasts) is written by wow_pets.py

if __name__ == "__main__":
    main()
