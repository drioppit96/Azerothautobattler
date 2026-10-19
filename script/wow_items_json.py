# -*- coding: utf-8 -*-
"""
ALL items as game data: one JSON with stats, slots, requirements, weapon damage,
item spells, set membership and random-property tables.

Writes  C:\\wow excel\\gamedata\\items.json     (all items, compact)
        C:\\wow excel\\gamedata\\items_equip.json (only equippable gear + weapons, lighter)

items.json
  meta          {stat names, slot names, damage schools, quality names, ...}
  items         {id: {...}}      only non-empty fields are present:
      n name  q quality  c class  s subclass  t inventory type  sl equipment slot ids
      il item level  rl required level  d display id  ic icon name
      st [[statType, value], ...]  ar armor  bl block  res {holy, fire, nature, frost, shadow, arcane}
      dm [[min, max, school], ...]  dl delay ms  dps  am ammo type
      du durability  bo bonding  sp sell price  bp buy price  sk stack  mc max count (1 = unique)
      cs container slots  bf bag family
      rq {skill, skillRank, spell, faction, factionRank, honor, classes[], races[], side}
      fx [{id, trigger, charges, ppm, cd, cat, catcd}]  (item spells: use / equip / chance on hit)
      set item set id  rp random property template id  lk lock id  fl flags  qs starts quest id
      ds description
  random_props  {id: {n: "of the Eagle", fx: [[enchantType, amount, spellId], ...], st: [[statType, amount]],
                      eq: [[auraType, misc, value], ...]}}   st = plain stats (agility, stamina ...), eq = every aura of the enchant spell
  random_tmpl   {templateId: [[propId, chance], ...]}
  proficiency   which class can wear / wield what (hand written from the 1.12 rules - check it)

Run:  py wow_items_json.py
Needs wow_common.py, wow_util.py (same folder); ItemDisplayInfo.dbc for icon names;
ItemRandomProperties.dbc and SpellItemEnchantment.dbc are optional (extract_dbc_multi.py).
"""
import os
from collections import defaultdict

from wow_util import *   # noqa

SLOT_NAMES = {0: "head", 1: "neck", 2: "shoulders", 3: "shirt", 4: "chest", 5: "waist", 6: "legs",
              7: "feet", 8: "wrists", 9: "hands", 10: "finger1", 11: "finger2", 12: "trinket1",
              13: "trinket2", 14: "back", 15: "mainhand", 16: "offhand", 17: "ranged", 18: "tabard"}
# inventory type -> equipment slot ids the item can go into
INV_SLOTS = {1: [0], 2: [1], 3: [2], 4: [3], 5: [4], 6: [5], 7: [6], 8: [7], 9: [8], 10: [9],
             11: [10, 11], 12: [12, 13], 13: [15, 16], 14: [16], 15: [17], 16: [14], 17: [15],
             19: [18], 20: [4], 21: [15], 22: [16], 23: [16], 25: [17], 26: [17], 28: [17]}
SCHOOLS = {0: "Physical", 1: "Holy", 2: "Fire", 3: "Nature", 4: "Frost", 5: "Shadow", 6: "Arcane"}
RES_KEYS = [("holy_res", "holy"), ("fire_res", "fire"), ("nature_res", "nature"),
            ("frost_res", "frost"), ("shadow_res", "shadow"), ("arcane_res", "arcane")]
ENCH_TYPES = {1: "combat spell (proc)", 2: "weapon damage", 3: "equip spell", 4: "resistance",
              5: "stat", 6: "totem"}
CLASS_IDS = {1: 1, 2: 2, 4: 3, 8: 4, 16: 5, 64: 7, 128: 8, 256: 9, 1024: 11}  # mask bit -> class id

# class id -> allowed armor subclasses (2 leather, 3 mail, 4 plate, 1 cloth, 6 shield) and weapon subclasses
# (hand written from the 1.12 rules; "plate_at" / "mail_at" = level you learn it)
PROFICIENCY = {
    "1": {"name": "Warrior", "armor": [0, 1, 2, 3, 4, 6], "mail_at": 1, "plate_at": 40,
          "weapons": [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18]},
    "2": {"name": "Paladin", "armor": [0, 1, 2, 3, 4, 6, 7], "mail_at": 1, "plate_at": 40,
          "weapons": [0, 1, 4, 5, 6, 7, 8]},
    "3": {"name": "Hunter", "armor": [0, 1, 2, 3], "mail_at": 40, "plate_at": None,
          "weapons": [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18]},
    "4": {"name": "Rogue", "armor": [0, 1, 2], "mail_at": None, "plate_at": None,
          "weapons": [2, 3, 4, 7, 13, 15, 16, 18]},
    "5": {"name": "Priest", "armor": [0, 1], "mail_at": None, "plate_at": None,
          "weapons": [4, 10, 15, 19]},
    "7": {"name": "Shaman", "armor": [0, 1, 2, 3, 6, 9], "mail_at": 40, "plate_at": None,
          "weapons": [0, 1, 4, 5, 10, 13, 15]},
    "8": {"name": "Mage", "armor": [0, 1], "mail_at": None, "plate_at": None,
          "weapons": [7, 10, 15, 19]},
    "9": {"name": "Warlock", "armor": [0, 1], "mail_at": None, "plate_at": None,
          "weapons": [7, 10, 15, 19]},
    "11": {"name": "Druid", "armor": [0, 1, 2, 8], "mail_at": None, "plate_at": None,
           "weapons": [4, 5, 10, 13, 15]},
    "note": "armor subclass: 0 misc,1 cloth,2 leather,3 mail,4 plate,6 shield,7 libram,8 idol,9 totem; "
            "weapon subclass: 0 axe,1 2h axe,2 bow,3 gun,4 mace,5 2h mace,6 polearm,7 sword,8 2h sword,"
            "10 staff,13 fist,15 dagger,16 thrown,18 crossbow,19 wand. Mail needs level mail_at, plate needs "
            "level plate_at (null = never). Check against your own knowledge before relying on it.",
}


def class_list(mask):
    if mask in (0, -1) or (mask & 1535) == 1535:
        return []
    return [CLASS_IDS[b] for b in sorted(CLASS_IDS) if mask & b]


def race_list(mask):
    if mask in (0, -1) or (mask & 255) == 255:
        return []
    return [i + 1 for i in range(8) if mask & (1 << i)]


def string_cols(d, min_len=3):
    """indexes of columns that look like text in most rows"""
    cols = []
    n = max(1, len(d.rows))
    for i in range(1, d.fc):
        good = 0
        for r in d.rows[:400]:
            s = d.s(r[i])
            if len(s) >= min_len and any(ch.isalpha() for ch in s):
                good += 1
        if good >= 0.6 * min(len(d.rows), 400):
            cols.append(i)
    return cols


def load_enchants():
    """SpellItemEnchantment: id -> (name, [(type, amount, arg)])
    1.12 layout: id, type[3], amountMin[3], amountMax[3], spell[3], name ...
    (type 1 = chance to cast on hit, 3 = equip spell, 5 = stat; arg = spell id)"""
    d = load_dbc("SpellItemEnchantment")
    if not d:
        return {}
    sc = string_cols(d)
    if not sc:
        return {}
    nidx = sc[0]
    start = 1 if (nidx - 1) % 3 == 0 else 2
    groups = (nidx - start) // 3
    out = {}
    for r in d.rows:
        eff = []
        for k in range(3):
            t = r[start + k]
            arg = r[start + (groups - 1) * 3 + k] if groups >= 3 else 0
            amt = r[start + 3 + k] if groups >= 3 else 0
            if not t and not arg:
                continue
            amt = amt - 2 ** 32 if amt > 2 ** 31 else amt
            eff.append((t, amt, arg))
        out[r[0]] = (d.s(r[nidx]), eff)
    return out


STAT_IDX = {0: 4, 1: 3, 2: 7, 3: 5, 4: 6}      # spell stat index -> item stat type


def resolve_enchant_spells(cur, props):
    """equip-spell enchants point to a spell: read its aura effects (stat, spell power, ...)"""
    ids = set()
    for p in props.values():
        for t, amt, arg in p["fx"]:
            if t in (1, 3) and arg:
                ids.add(arg)
    if not ids:
        return
    c = columns(cur, "spell_template")
    info = {}
    for part in chunks(sorted(ids)):
        cur.execute("SELECT * FROM spell_template WHERE `%s` IN (%s)" % (c["id"], ph(len(part))), part)
        for r in cur.fetchall():
            effs = []
            for e in (1, 2, 3):
                if g(r, c, "effect%d" % e):
                    base = g(r, c, "effectbasepoints%d" % e)
                    val = base + (1 if g(r, c, "effectdiesides%d" % e) == 1 else 0)
                    effs.append([g(r, c, "effectapplyauraname%d" % e), g(r, c, "effectmiscvalue%d" % e), val])
            info[g(r, c, "id")] = effs
    for p in props.values():
        eq = []
        for t, amt, arg in p["fx"]:
            for au, mi, val in info.get(arg, []):
                eq.append([au, mi, val])
                if au == 29 and mi in STAT_IDX:
                    p["st"].append([STAT_IDX[mi], val])
                elif au == 29 and mi == -1:
                    for st_ in (4, 3, 7, 5, 6):
                        p["st"].append([st_, val])
        if eq:
            p["eq"] = eq


def load_random_props(ench):
    d = load_dbc("ItemRandomProperties")
    if not d:
        return {}
    sc = string_cols(d, 3)
    # the internal name is column 1, the display name ("of the Eagle") is the next text column
    didx = None
    for c in sc:
        if c <= 1:
            continue
        txt = [d.s(r[c]) for r in d.rows[:400]]
        if sum(1 for t in txt if t.startswith("of ")) >= 0.4 * max(1, len(txt)):
            didx = c
            break
    if didx is None:
        far = [c for c in sc if c > 1]
        didx = far[-1] if far else None
    out = {}
    for r in d.rows:
        name = d.s(r[didx]) if didx else d.s(r[1])
        fx, st = [], []
        upto = didx if didx else d.fc
        for k in range(2, upto):
            eid = r[k]
            if eid and eid in ench:
                for t, amt, arg in ench[eid][1]:
                    fx.append([t, amt, arg])
                    if t == 5:
                        st.append([arg, amt])
        out[r[0]] = {"n": name, "fx": fx, "st": st}
    return out


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    ic = columns(cur, "item_template")
    cur.execute("SELECT * FROM item_template")
    rows = cur.fetchall()
    log("Items: %d" % len(rows))
    icons = item_icons()
    items = {}
    for r in rows:
        e = g(r, ic, "entry")
        it = {"n": g(r, ic, "name", ""), "q": g(r, ic, "quality"), "c": g(r, ic, "class"),
              "s": g(r, ic, "subclass")}
        inv = g(r, ic, "inventorytype")
        if inv:
            it["t"] = inv
            if inv in INV_SLOTS:
                it["sl"] = INV_SLOTS[inv]
        for key, field in (("il", "itemlevel"), ("rl", "requiredlevel"), ("d", "displayid"),
                           ("ar", "armor"), ("bl", "block"), ("dl", "delay"), ("am", "ammo_type"),
                           ("du", "maxdurability"), ("bo", "bonding"), ("sp", "sellprice"),
                           ("bp", "buyprice"), ("cs", "containerslots"), ("bf", "bagfamily"),
                           ("set", "itemset"), ("rp", "randomproperty"), ("lk", "lockid"),
                           ("fl", "flags"), ("qs", "startquest"), ("de", "disenchantid"), ("ft", "foodtype")):
            v = g(r, ic, field)
            if v:
                it[key] = v
        if g(r, ic, "stackable") > 1:
            it["sk"] = g(r, ic, "stackable")
        if g(r, ic, "maxcount") > 0:
            it["mc"] = g(r, ic, "maxcount")
        if it.get("d") in icons:
            it["ic"] = icons[it["d"]]
        stats = []
        for n in range(1, 11):
            v = g(r, ic, "stat_value%d" % n)
            if v:
                stats.append([g(r, ic, "stat_type%d" % n), v])
        if stats:
            it["st"] = stats
        res = {nm: g(r, ic, k) for k, nm in RES_KEYS if g(r, ic, k)}
        if res:
            it["res"] = res
        dm = []
        for n in range(1, 6):
            lo, hi = g(r, ic, "dmg_min%d" % n), g(r, ic, "dmg_max%d" % n)
            if hi:
                dm.append([lo, hi, g(r, ic, "dmg_type%d" % n)])
        if dm:
            it["dm"] = dm
            dl = g(r, ic, "delay")
            if dl:
                it["dps"] = round(sum((a + b) / 2.0 for a, b, _ in dm) / (dl / 1000.0), 2)
        rq = {}
        for key, field in (("skill", "requiredskill"), ("skillRank", "requiredskillrank"),
                           ("spell", "requiredspell"), ("faction", "requiredreputationfaction"),
                           ("factionRank", "requiredreputationrank"), ("honor", "requiredhonorrank")):
            v = g(r, ic, field)
            if v:
                rq[key] = v
        cl = class_list(g(r, ic, "allowableclass", -1))
        if cl:
            rq["classes"] = cl
        rc = race_list(g(r, ic, "allowablerace", -1))
        if rc:
            rq["races"] = rc
            if all(x in (1, 3, 4, 7) for x in rc):
                rq["side"] = "Alliance"
            elif all(x in (2, 5, 6, 8) for x in rc):
                rq["side"] = "Horde"
        if rq:
            it["rq"] = rq
        fx = []
        for n in range(1, 6):
            sid = g(r, ic, "spellid_%d" % n)
            if sid:
                fx.append({"id": sid, "trigger": g(r, ic, "spelltrigger_%d" % n),
                           "charges": g(r, ic, "spellcharges_%d" % n),
                           "ppm": g(r, ic, "spellppmrate_%d" % n),
                           "cd": g(r, ic, "spellcooldown_%d" % n), "cat": g(r, ic, "spellcategory_%d" % n),
                           "catcd": g(r, ic, "spellcategorycooldown_%d" % n)})
        if fx:
            it["fx"] = [{k: v for k, v in f.items() if v not in (0, -1)} for f in fx]
        ds = g(r, ic, "description", "")
        if ds:
            it["ds"] = ds
        items[e] = it

    ench = load_enchants()
    log("Enchantment rows: %d" % len(ench))
    props = load_random_props(ench) if ench else {}
    resolve_enchant_spells(cur, props)
    log("Random property rows: %d" % len(props))
    tmpl = defaultdict(list)
    if table_exists(cur, "item_enchantment_template"):
        c = columns(cur, "item_enchantment_template")
        cur.execute("SELECT * FROM item_enchantment_template")
        for r in cur.fetchall():
            tmpl[g(r, c, "entry")].append([g(r, c, "ench"), float(g(r, c, "chance"))])

    meta = {"stats": {str(k): v for k, v in STAT.items()}, "slots": {str(k): v for k, v in SLOT_NAMES.items()},
            "schools": {str(k): v for k, v in SCHOOLS.items()}, "quality": {str(k): v for k, v in QUALITY.items()},
            "inventory": {str(k): v for k, v in INV_TYPE.items()},
            "class": {str(k): v for k, v in ITEM_CLASS.items()},
            "bonding": {str(k): v for k, v in BONDING.items()},
            "trigger": {"0": "use", "1": "equip", "2": "chance on hit", "4": "soulstone", "5": "use (no delay)",
                        "6": "learn"},
            "enchant_types": {str(k): v for k, v in ENCH_TYPES.items()},
            "inv_to_slots": {str(k): v for k, v in INV_SLOTS.items()}}
    save_json("items", {"meta": meta, "items": {str(k): v for k, v in items.items()},
                        "random_props": {str(k): v for k, v in props.items()},
                        "random_tmpl": {str(k): v for k, v in tmpl.items()},
                        "proficiency": PROFICIENCY})
    gear = {str(k): v for k, v in items.items() if v.get("sl") or v.get("t") in (18, 27, 24)}
    save_json("items_equip", {"meta": meta, "items": gear, "random_props": {str(k): v for k, v in props.items()},
                              "random_tmpl": {str(k): v for k, v in tmpl.items()}, "proficiency": PROFICIENCY})
    log("Equippable items: %d" % len(gear))
    conn.close()
    log("Done.")


if __name__ == "__main__":
    run(main)
