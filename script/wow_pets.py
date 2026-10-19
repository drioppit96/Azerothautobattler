# -*- coding: utf-8 -*-
"""
Hunter pets and warlock demons for the game (game/pets.js), from the cMaNGOS classic database dump and the DBCs.

Writes gamedata/pets.json:
  stats     {creatureEntry: {level: [hp, mana, armor, str, agi, sta, int, spi]}}     pet_levelstats ("1" = every hunter pet)
  fam       {familyId: {n, sk, hp, ar, dm, diet, ic, ab}}  the hunter pet families: name, skill line, health / armor /
            damage modifiers (pet_familystats), the food types it eats, icon, the abilities it can learn
  train     {abilityName: [[spellId, level, trainingPoints], ...]}   every rank a hunter pet can learn (Beast Training);
            the training points are the SkillLineAbility costs (a higher rank costs the difference)
  generic   the abilities every family can learn (Growl, Cower, Great Stamina, Natural Armor, the resistances)
  beasts    {creatureEntry: [familyId, attackTimeMs]}   the tameable beasts
  demons    {creatureEntry: {n, fam, sk, dm, atk, start, ab: {abilityName: [[spellId, level], ...]}, ic, sum}}
  names     {creatureEntry: [[first parts], [second parts]]}     demon names (pet_name_generation)
  petauras  {talentSpell: {petEntry or 0: auraSpell}}     spell_pet_auras (Master Demonologist, Soul Link ...)
gamedata/items.json:  "ft" (FoodType: 1 meat, 2 fish, 3 cheese, 4 bread, 5 fungus, 6 fruit, 7 raw meat, 8 raw fish)
gamedata/spells.json: the pet spells the game did not have yet (source "pet"), built like wow_spells_json.py does

Run:  py wow_pets.py <ClassicDB Full_DB .sql or .sql.gz>
Needs the DBCs SkillLineAbility, SpellCastTimes, SpellRange, SpellDuration, SpellRadius, SpellIcon (extract_dbc_multi.py)
in C:\\wow excel\\dbc (or the folder in the environment variable WOW_DBC_DIR).
"""
import json
import os
import sys

import classicdb_sql as S

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# CreatureFamily.dbc (not extracted): id -> name, pet skill line, icon
FAMILIES = {
    1: ("Wolf", 208, "ability_hunter_pet_wolf"), 2: ("Cat", 209, "ability_hunter_pet_cat"),
    3: ("Spider", 203, "ability_hunter_pet_spider"), 4: ("Bear", 210, "ability_hunter_pet_bear"),
    5: ("Boar", 211, "ability_hunter_pet_boar"), 6: ("Crocolisk", 212, "ability_hunter_pet_crocolisk"),
    7: ("Carrion Bird", 213, "ability_hunter_pet_vulture"), 8: ("Crab", 214, "ability_hunter_pet_crab"),
    9: ("Gorilla", 215, "ability_hunter_pet_gorilla"), 11: ("Raptor", 217, "ability_hunter_pet_raptor"),
    12: ("Tallstrider", 218, "ability_hunter_pet_tallstrider"), 20: ("Scorpid", 236, "ability_hunter_pet_scorpid"),
    21: ("Turtle", 251, "ability_hunter_pet_turtle"), 24: ("Bat", 653, "ability_hunter_pet_bat"),
    25: ("Hyena", 654, "ability_hunter_pet_hyena"), 26: ("Owl", 655, "ability_hunter_pet_owl"),
    27: ("Wind Serpent", 656, "ability_hunter_pet_windserpent"),
}
# the food each family eats in 1.12 (CreatureFamily.dbc petFoodMask; item FoodType ids, raw meat / fish included)
MEAT, FISH, CHEESE, BREAD, FUNGUS, FRUIT, RAW_MEAT, RAW_FISH = 1, 2, 3, 4, 5, 6, 7, 8
DIETS = {
    1: [MEAT, RAW_MEAT], 2: [MEAT, FISH, RAW_MEAT, RAW_FISH], 3: [MEAT, RAW_MEAT],
    4: [MEAT, FISH, CHEESE, BREAD, FUNGUS, FRUIT, RAW_MEAT, RAW_FISH], 5: [MEAT, FISH, CHEESE, BREAD, FUNGUS, FRUIT, RAW_MEAT, RAW_FISH],
    6: [MEAT, FISH, RAW_MEAT, RAW_FISH], 7: [MEAT, FISH, RAW_MEAT, RAW_FISH], 8: [FISH, BREAD, FUNGUS, FRUIT, RAW_FISH],
    9: [FUNGUS, FRUIT], 11: [MEAT, RAW_MEAT], 12: [CHEESE, FUNGUS, FRUIT], 20: [MEAT, RAW_MEAT],
    21: [FISH, FUNGUS, FRUIT, RAW_FISH], 24: [FUNGUS, FRUIT], 25: [MEAT, FRUIT, RAW_MEAT], 26: [MEAT, RAW_MEAT],
    27: [FISH, CHEESE, BREAD, RAW_FISH],
}
GENERIC_SKILL = 270          # Pet - Generic
GENERIC_KEEP = {"Growl", "Cower", "Great Stamina", "Natural Armor", "Fire Resistance", "Frost Resistance",
                "Shadow Resistance", "Nature Resistance", "Arcane Resistance"}
DEMONS = {416: ("Imp", 23, 188, "spell_shadow_summonimp", "Summon Imp"),
          1860: ("Voidwalker", 16, 204, "spell_shadow_summonvoidwalker", "Summon Voidwalker"),
          1863: ("Succubus", 17, 205, "spell_shadow_summonsuccubus", "Summon Succubus"),
          417: ("Felhunter", 15, 189, "spell_shadow_summonfelhunter", "Summon Felhunter")}
# spells the pet code uses that no ability list reaches: Demonic Sacrifice buffs, Soul Link, Spirit Bond, Intimidation
EXTRA_SPELLS = [18789, 18790, 18791, 18792, 25228, 19579, 24529, 24394, 19580, 1539, 19574, 19577, 19028, 18788, 18708]


def dicts(tbl):
    cols, rows = tbl
    return [dict(zip(cols, r)) for r in rows]


def main():
    dump = sys.argv[1]
    want = ["creature_template", "pet_levelstats", "pet_familystats", "pet_name_generation", "petcreateinfo_spell",
            "spell_pet_auras", "item_template", "spell_template", "spell_chain", "spell_bonus_data", "spell_proc_event"]
    print("reading the dump ...")
    T = S.tables(dump, want)
    import wow_common
    from wow_common import load_dbc
    sla = load_dbc("SkillLineAbility")
    if not sla:
        sys.exit("SkillLineAbility.dbc is needed (extract_dbc_multi.py)")

    st = {r["Id"]: r for r in dicts(T["spell_template"])}

    def sname(i):
        r = st.get(i)
        return (r["SpellName"] or "") if r else ""

    # -------------------------------------------------- abilities by skill line (with training point costs)
    by_skill = {}
    for r in sla.rows:
        skill, spell = r[1], r[2]
        tp = r[14] if len(r) > 14 else 0
        n = sname(spell)
        if not n or "DND" in n or n.endswith("Effect") or n == "Cobra Reflexes":
            continue
        by_skill.setdefault(skill, {}).setdefault(n, set()).add((spell, st[spell]["SpellLevel"], tp))
    train, fams = {}, {}
    for fid, (fname, sk, ic) in FAMILIES.items():
        ab = sorted(by_skill.get(sk, {}))
        for n in ab:
            train[n] = sorted(set(train.get(n, [])) | by_skill[sk][n], key=lambda x: (x[1], x[0]))
        fams[str(fid)] = {"n": fname, "sk": sk, "ic": ic, "diet": DIETS[fid], "ab": ab}
    generic = sorted(n for n in by_skill.get(GENERIC_SKILL, {}) if n in GENERIC_KEEP)
    for n in generic:
        train[n] = sorted(by_skill[GENERIC_SKILL][n], key=lambda x: (x[1], x[0]))
    train = {n: [list(x) for x in v] for n, v in train.items()}
    # family modifiers (the table's columns are named health / damage / armor but hold health, armor, damage:
    # cats +10% damage, boars +9% armor, turtles +13% armor and -10% damage, as in the game)
    for r in T["pet_familystats"][1]:
        f = fams.get(str(r[0]))
        if f:
            f["hp"], f["ar"], f["dm"] = r[1], r[2], r[3]
    for f in fams.values():
        f.setdefault("hp", 1); f.setdefault("ar", 1); f.setdefault("dm", 1)

    # -------------------------------------------------- creatures: tameable beasts, demons
    beasts, demons = {}, {}
    start = {r["entry"]: [r["Spell%d" % k] for k in range(1, 5) if r["Spell%d" % k]] for r in dicts(T["petcreateinfo_spell"])}
    for r in dicts(T["creature_template"]):
        e = r["Entry"]
        if r["CreatureTypeFlags"] & 1 and r["Family"] in FAMILIES:
            beasts[str(e)] = [r["Family"], r["MeleeBaseAttackTime"] or 2000]
        if e in DEMONS:
            n, fam, sk, ic, summon = DEMONS[e]
            ab = {k: sorted([[s, l] for s, l, _ in v], key=lambda x: (x[1], x[0])) for k, v in by_skill.get(sk, {}).items()}
            demons[str(e)] = {"n": n, "fam": fam, "sk": sk, "ic": ic, "sum": summon, "dm": r["DamageMultiplier"] or 1,
                              "atk": r["MeleeBaseAttackTime"] or 2000, "start": start.get(e, []), "ab": ab}
    names = {}
    for r in dicts(T["pet_name_generation"]):
        names.setdefault(str(r["entry"]), [[], []])[r["half"]].append(r["word"])
    petauras = {}
    for r in dicts(T["spell_pet_auras"]):
        petauras.setdefault(str(r["spell"]), {})[str(r["pet"])] = r["aura"]
    stats = {}
    for r in dicts(T["pet_levelstats"]):
        stats.setdefault(str(r["creature_entry"]), {})[str(r["level"])] = [r["hp"], r["mana"], r["armor"], r["str"], r["agi"], r["sta"], r["inte"], r["spi"]]

    out = {"stats": stats, "fam": fams, "train": train, "generic": generic, "beasts": beasts, "demons": demons,
           "names": names, "petauras": petauras}
    with open(os.path.join(ROOT, "gamedata", "pets.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("pets.json: %d families, %d trainable abilities, %d tameable beasts, %d demons" % (len(fams), len(train), len(beasts), len(demons)))

    # -------------------------------------------------- items: food types
    ft = {str(r["entry"]): r["FoodType"] for r in dicts(T["item_template"]) if r.get("FoodType")}
    for name in ("items", "items_equip"):
        ip = os.path.join(ROOT, "gamedata", name + ".json")
        if not os.path.exists(ip):
            continue
        J = json.load(open(ip, encoding="utf-8")); n = 0
        for k, it in J["items"].items():
            if k in ft:
                it["ft"] = ft[k]; n += 1
        with open(ip, "w", encoding="utf-8") as fh:
            json.dump(J, fh, separators=(",", ":"))
        print("%s.json: %d items with a food type" % (name, n))

    # -------------------------------------------------- spells.json: the pet spells it does not have yet
    sp_path = os.path.join(ROOT, "gamedata", "spells.json")
    SP = json.load(open(sp_path, encoding="utf-8"))
    need = set(EXTRA_SPELLS)
    for v in train.values():
        need |= {x[0] for x in v}
    for d in demons.values():
        for v in d["ab"].values():
            need |= {x[0] for x in v}
    for v in petauras.values():
        need |= set(v.values())
    from wow_spelldata import SpellData
    import wow_spells_json as WS
    cur = S.DumpCursor(T)
    sd = SpellData(cur)
    b = WS.Builder(cur, sd)
    if not b.radii.r:            # no SpellRadius.dbc: the radii the spells already in spells.json show, by index
        for sid, spj in SP["spells"].items():
            r = st.get(int(sid))
            if not r:
                continue
            for i, ef in enumerate(spj.get("ef", []), start=1):
                if ef.get("ra") and r.get("EffectRadiusIndex%d" % i):
                    b.radii.r[r["EffectRadiusIndex%d" % i]] = ef["ra"]
    added = 0
    todo = [i for i in sorted(need) if str(i) not in SP["spells"] and i in st]
    while todo:
        i = todo.pop()
        if str(i) in SP["spells"]:
            continue
        _, spj = b.build(st[i])
        spj["src"] = ["pet"]
        for ef in spj.get("ef", []):
            s = spj.get("s", {})
            if ef["t"] in WS.DAMAGE_EFFECTS | WS.HEAL_EFFECTS and "cd_direct" in s:
                ef["coef"] = s["cd_direct"]
            elif ef.get("au") in WS.DOT_AURAS | WS.HOT_AURAS and "cd_dot" in s:
                ef["coef"] = s["cd_dot"]
            tr = ef.get("tr")
            if tr and str(tr) not in SP["spells"] and tr in st:
                todo.append(tr)
        SP["spells"][str(i)] = spj
        added += 1
    for i in need:              # the pet spells already there: mark where they belong
        spj = SP["spells"].get(str(i))
        if spj and "pet" not in spj.get("src", []):
            spj["src"] = sorted(set(spj.get("src", [])) | {"pet"})
    with open(sp_path, "w", encoding="utf-8") as fh:
        json.dump(SP, fh, separators=(",", ":"))
    print("spells.json: %d pet spells added" % added)


if __name__ == "__main__":
    main()
