# -*- coding: utf-8 -*-
"""
Races, classes, start positions and base stats for the auto-battler.

Writes  C:\\wow excel\\wow_races.xlsx
        C:\\wow excel\\gamedata\\races.json

races.json
  races      [{id, name, mask, template, side}]
  classes    [{id, name, mask, power}]            power 0 mana, 1 rage, 3 energy
  start      {"race_class": {map, zone, zoneName, x, y, z, o}}   where a new character appears
  stats      {race: {class: [[str, agi, sta, int, spi] for level 1..60]}}
  classstats {class: [[baseHealth, baseMana] for level 1..60]}
  spells     {"race_class": [spellId, ...]}       spells known at creation (incl. racials, proficiencies)
  spell_names {spellId: name}
  items      {"race_class": [[itemId, count], ...]}    starting equipment / items
  actions    {"race_class": [[button, action, type], ...]}   default action bar
  racials    [{race, spell, name, skill, level}]  race-limited spells found in SkillLineAbility
  ratings    {table: {class: [value per level 1..60]}}  gtChanceToMeleeCrit etc. (see notes)
  notes      how to use the rating tables

Run:  py wow_races.py
Needs wow_common.py, wow_util.py, wow_spelldata.py (same folder) and the DBCs
ChrRaces, ChrClasses, AreaTable, gt* (extract_dbc_multi.py). Missing DBCs are skipped.
"""
import os
from collections import defaultdict

from wow_util import *   # noqa
from wow_spelldata import SpellData

OUTPUT = os.path.join(OUT_FOLDER, "wow_races.xlsx")
MAX_LEVEL = 60

RACES = [(1, "Human", 1), (2, "Orc", 2), (3, "Dwarf", 3), (4, "Night Elf", 4),
         (5, "Undead", 5), (6, "Tauren", 6), (7, "Gnome", 115), (8, "Troll", 116)]
ALLIANCE = (1, 3, 4, 7)
CLASSES_ = [(1, "Warrior", 1), (2, "Paladin", 0), (3, "Hunter", 0), (4, "Rogue", 3), (5, "Priest", 0),
            (7, "Shaman", 0), (8, "Mage", 0), (9, "Warlock", 0), (11, "Druid", 0)]
GT_TABLES = ["gtChanceToMeleeCrit", "gtChanceToMeleeCritBase", "gtChanceToSpellCrit",
             "gtChanceToSpellCritBase", "gtOCTRegenHP", "gtOCTRegenMP", "gtRegenHPPerSpt",
             "gtRegenMPPerSpt"]
NOTES = ("gt* tables are the client's rating tables, one float per class and level (row index = "
         "(class-1)*100 + level-1; tables with 11 rows are per class only). "
         "gtChanceToMeleeCrit / SpellCrit: 1 / value = agility (intellect for spells) needed for 1% crit. "
         "*CritBase: base crit % per class. gtRegenHPPerSpt / MPPerSpt: regen per tick per spirit point; "
         "gtOCTRegenHP / MP: out-of-combat regen per class and level.")


def read_gt(name):
    d = load_dbc(name)
    if not d or not d.rows:
        return None
    vals = [flt(r[-1] if d.fc == 1 else r[1]) for r in d.rows]
    return vals


def per_class(vals):
    n = len(vals)
    out = {}
    if n <= 20:                            # base tables: one value per class
        for i, v in enumerate(vals):
            out[i + 1] = [round(v, 6)]
        return out
    per = n // 11 if n % 11 == 0 else 100
    for c in range(1, 12):
        seg = vals[(c - 1) * per:(c - 1) * per + min(per, MAX_LEVEL)]
        if seg:
            out[c] = [round(v, 6) for v in seg]
    return out


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    areas = area_names()

    # races (template ids from ChrRaces when present)
    races = []
    names, facs = {}, {}
    d = load_dbc("ChrRaces")
    if d:
        idx = d.find_field(1, "Human")
        if idx is not None:
            for r in d.rows:
                names[r[0]] = d.s(r[idx])
                facs[r[0]] = r[2]
    for rid, nm, fac in RACES:
        races.append({"id": rid, "name": names.get(rid) or nm, "mask": 1 << (rid - 1),
                      "template": facs.get(rid) or fac, "side": "Alliance" if rid in ALLIANCE else "Horde"})
    classes = []
    cn = {}
    d = load_dbc("ChrClasses")
    if d:
        idx = d.find_field(1, "Warrior")
        if idx is not None:
            for r in d.rows:
                cn[r[0]] = d.s(r[idx])
    for cid, nm, pw in CLASSES_:
        classes.append({"id": cid, "name": cn.get(cid) or nm, "mask": 1 << (cid - 1), "power": pw})
    rname = {r["id"]: r["name"] for r in races}
    cname = {c["id"]: c["name"] for c in classes}

    # start positions
    start = {}
    pc = columns(cur, "playercreateinfo")
    cur.execute("SELECT * FROM playercreateinfo")
    for r in cur.fetchall():
        key = "%d_%d" % (g(r, pc, "race"), g(r, pc, "class"))
        zone = g(r, pc, "zone")
        start[key] = {"map": g(r, pc, "map"), "zone": zone, "zoneName": areas.get(zone, (0, 0, ""))[2],
                      "x": round(float(g(r, pc, "position_x")), 3), "y": round(float(g(r, pc, "position_y")), 3),
                      "z": round(float(g(r, pc, "position_z")), 3), "o": round(float(g(r, pc, "orientation")), 4)}
    log("Start positions: %d" % len(start))

    # stats
    stats = defaultdict(lambda: defaultdict(dict))
    if table_exists(cur, "player_levelstats"):
        sc = columns(cur, "player_levelstats")
        cur.execute("SELECT * FROM player_levelstats")
        for r in cur.fetchall():
            lv = g(r, sc, "level")
            if 1 <= lv <= MAX_LEVEL:
                stats[g(r, sc, "race")][g(r, sc, "class")][lv] = [
                    g(r, sc, "str"), g(r, sc, "agi"), g(r, sc, "sta"), g(r, sc, "inte"), g(r, sc, "spi")]
    stats_out = {}
    for rc, cd in stats.items():
        stats_out[str(rc)] = {}
        for cc, lv in cd.items():
            stats_out[str(rc)][str(cc)] = [lv.get(i) for i in range(1, max(lv) + 1)]
    cls = defaultdict(dict)
    if table_exists(cur, "player_classlevelstats"):
        cc_ = columns(cur, "player_classlevelstats")
        cur.execute("SELECT * FROM player_classlevelstats")
        for r in cur.fetchall():
            lv = g(r, cc_, "level")
            if 1 <= lv <= MAX_LEVEL:
                cls[g(r, cc_, "class")][lv] = [g(r, cc_, "basehp"), g(r, cc_, "basemana")]
    cls_out = {str(c): [v.get(i) for i in range(1, max(v) + 1)] for c, v in cls.items()}
    log("Level stat rows: race/class combos %d, class tables %d" % (sum(len(v) for v in stats_out.values()), len(cls_out)))

    # starting spells / items / actions
    spells = defaultdict(list)
    items = defaultdict(list)
    actions = defaultdict(list)
    if table_exists(cur, "playercreateinfo_spell"):
        c = columns(cur, "playercreateinfo_spell")
        cur.execute("SELECT * FROM playercreateinfo_spell")
        for r in cur.fetchall():
            spells["%d_%d" % (g(r, c, "race"), g(r, c, "class"))].append(g(r, c, "spell"))
    if table_exists(cur, "playercreateinfo_item"):
        c = columns(cur, "playercreateinfo_item")
        cur.execute("SELECT * FROM playercreateinfo_item")
        for r in cur.fetchall():
            items["%d_%d" % (g(r, c, "race"), g(r, c, "class"))].append([g(r, c, "itemid"), g(r, c, "amount") or 1])
    if table_exists(cur, "playercreateinfo_action"):
        c = columns(cur, "playercreateinfo_action")
        cur.execute("SELECT * FROM playercreateinfo_action")
        for r in cur.fetchall():
            actions["%d_%d" % (g(r, c, "race"), g(r, c, "class"))].append(
                [g(r, c, "button"), g(r, c, "action"), g(r, c, "type")])
    sids = set()
    for v in spells.values():
        sids.update(v)
    sd = SpellData(cur)
    spell_nm = {}
    rows = sd.fetch(cur, sids) if sids else []
    for r in rows:
        spell_nm[g(r, sd.sc, "id")] = (g(r, sd.sc, "spellname", "") or "") + (
            " (%s)" % g(r, sd.sc, "rank1", "") if g(r, sd.sc, "rank1", "") else "")

    # racial / race limited spells from the skill line abilities
    racials = []
    race_by_mask = {r["mask"]: r["id"] for r in races}
    cand = {}
    for sid, lst in sd.sla.items():
        for skill, cmask, rmask, minrank in lst:
            if rmask in race_by_mask:
                cand[sid] = (race_by_mask[rmask], skill, minrank)
    for r in sd.fetch(cur, list(cand)) if cand else []:
        sid = g(r, sd.sc, "id")
        rid, skill, minrank = cand[sid]
        racials.append({"race": rid, "spell": sid, "name": g(r, sd.sc, "spellname", ""),
                        "skill": sd.skill_names.get(skill, str(skill)), "level": g(r, sd.sc, "spelllevel")})

    # rating tables
    ratings = {}
    for t in GT_TABLES:
        v = read_gt(t)
        if v:
            ratings[t] = {str(c): vals for c, vals in per_class(v).items()}
    log("Rating tables: %s" % ", ".join(sorted(ratings)) if ratings else "Rating tables: none (extract gt* DBCs)")

    save_json("races", {"races": races, "classes": classes, "start": start, "stats": stats_out,
                        "classstats": cls_out, "spells": dict(spells), "spell_names": spell_nm,
                        "items": dict(items), "actions": dict(actions), "racials": racials,
                        "ratings": ratings, "notes": NOTES})

    # ---------------------------------------------------------------- Excel
    book = BigBook(OUTPUT)
    ws = book.sheet("Races", ["Id", "Race", "Side", "Faction template"], [5, 14, 10, 14])
    for r in races:
        ws.append([r["id"], r["name"], r["side"], r["template"]])
    ws = book.sheet("Start Positions", ["Race", "Class", "Map", "Zone", "X", "Y", "Z", "Orientation"],
                    [12, 12, 6, 24, 11, 11, 9, 11])
    for key in sorted(start, key=lambda k: tuple(map(int, k.split("_")))):
        rid, cid = map(int, key.split("_"))
        s = start[key]
        ws.append([rname.get(rid, rid), cname.get(cid, cid), s["map"], s["zoneName"] or s["zone"],
                   s["x"], s["y"], s["z"], s["o"]])
    ws = book.sheet("Level Stats", ["Race", "Class", "Level", "Strength", "Agility", "Stamina", "Intellect", "Spirit"],
                    [12, 12, 6, 9, 9, 9, 9, 9])
    for rc in sorted(stats_out, key=int):
        for cc in sorted(stats_out[rc], key=int):
            for lv, v in enumerate(stats_out[rc][cc], start=1):
                if v:
                    ws.append([rname.get(int(rc), rc), cname.get(int(cc), cc), lv] + v)
    ws = book.sheet("Class Level Stats", ["Class", "Level", "Base health", "Base mana"], [12, 6, 12, 12])
    for cc in sorted(cls_out, key=int):
        for lv, v in enumerate(cls_out[cc], start=1):
            if v:
                ws.append([cname.get(int(cc), cc), lv] + v)
    ws = book.sheet("Start Spells", ["Race", "Class", "Spell id", "Spell"], [12, 12, 9, 36])
    for key in sorted(spells, key=lambda k: tuple(map(int, k.split("_")))):
        rid, cid = map(int, key.split("_"))
        for sid in spells[key]:
            ws.append([rname.get(rid, rid), cname.get(cid, cid), sid, spell_nm.get(sid, "")])
    if items:
        iname = {}
        ids = sorted(set(i for v in items.values() for i, _ in v))
        for part in chunks(ids):
            cur.execute("SELECT entry, name FROM item_template WHERE entry IN (%s)" % ph(len(part)), part)
            iname.update({r["entry"]: r["name"] for r in cur.fetchall()})
        ws = book.sheet("Start Items", ["Race", "Class", "Item id", "Item", "Count"], [12, 12, 9, 36, 7])
        for key in sorted(items, key=lambda k: tuple(map(int, k.split("_")))):
            rid, cid = map(int, key.split("_"))
            for iid, n in items[key]:
                ws.append([rname.get(rid, rid), cname.get(cid, cid), iid, iname.get(iid, ""), n])
    ws = book.sheet("Race Spells", ["Race", "Spell id", "Spell", "Skill line", "Level"], [12, 9, 32, 22, 6])
    for x in sorted(racials, key=lambda x: (x["race"], x["level"], x["name"])):
        ws.append([rname.get(x["race"], x["race"]), x["spell"], x["name"], x["skill"], x["level"]])
    if ratings:
        ws = book.sheet("Rating Tables", ["Table", "Class", "Level", "Value"], [26, 12, 6, 12])
        for t in sorted(ratings):
            for cc in sorted(ratings[t], key=int):
                for lv, v in enumerate(ratings[t][cc], start=1):
                    ws.append([t, cname.get(int(cc), cc), lv, v])
    book.save()
    conn.close()
    log("Done.")


if __name__ == "__main__":
    run(main)
