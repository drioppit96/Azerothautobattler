# -*- coding: utf-8 -*-
"""
Class progression spreadsheet:  C:\\wow excel\\wow_classes.xlsx
  Class Stats          - base health / mana per class and level, and the gain per level
  Race-Class Stats     - Str / Agi / Sta / Int / Spi per race, class and level, plus gain
  Spells by Level      - what each class trainer teaches, with level, cost, icon, details
  Starting Spells      - spells every new character starts with

Needs wow_common.py + wow_spelldata.py in the same folder, the SPP Database
window open, and the DBC files from extract_dbc_multi.py.
Run:  py wow_classes.py
"""
import os
from collections import defaultdict

from wow_spelldata import *   # noqa

OUTPUT = os.path.join(OUT_FOLDER, "wow_classes.xlsx")

CLASS_NAMES = {1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest",
               7: "Shaman", 8: "Mage", 9: "Warlock", 11: "Druid"}
RACE_NAMES = {1: "Human", 2: "Orc", 3: "Dwarf", 4: "Night Elf", 5: "Undead",
              6: "Tauren", 7: "Gnome", 8: "Troll"}
STAT_KEYS = [("str", "Strength"), ("agi", "Agility"), ("sta", "Stamina"),
             ("inte", "Intellect"), ("spi", "Spirit")]


def pick(cols, *names):
    for n in names:
        if n in cols:
            return cols[n]
    return None


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    from openpyxl import Workbook
    wb = Workbook()
    first = True

    # ------------------------------------------------ class base HP / mana
    if table_exists(cur, "player_classlevelstats"):
        cc = columns(cur, "player_classlevelstats")
        k_cls, k_lvl = pick(cc, "class"), pick(cc, "level")
        k_hp, k_mana = pick(cc, "basehp", "base_hp", "hp"), pick(cc, "basemana", "base_mana", "mana")
        cur.execute("SELECT * FROM player_classlevelstats")
        data = defaultdict(dict)
        for r in cur.fetchall():
            data[r[k_cls]][r[k_lvl]] = (r.get(k_hp, 0) or 0, r.get(k_mana, 0) or 0)
        rows = []
        for c in sorted(data):
            prev = None
            for lvl in sorted(data[c]):
                hp, mana = data[c][lvl]
                rows.append([CLASS_NAMES.get(c, c), lvl, hp, mana,
                             (hp - prev[0]) if prev else "", (mana - prev[1]) if prev else ""])
                prev = (hp, mana)
        ws = new_sheet(wb, "Class Stats", ["Class", "Level", "Base Health", "Base Mana",
                                           "Health Gain", "Mana Gain"],
                       [14, 8, 12, 12, 12, 12], first=first)
        first = False
        for row in rows:
            ws.append(row)
        finish_sheet(ws, 6)
        log("Class stats rows: %d" % len(rows))

    # ------------------------------------------------ race/class stats
    if table_exists(cur, "player_levelstats"):
        lc = columns(cur, "player_levelstats")
        k_race, k_cls, k_lvl = pick(lc, "race"), pick(lc, "class"), pick(lc, "level")
        cand = {"str": ("str", "strength"), "agi": ("agi", "agility"), "sta": ("sta", "stamina"),
                "inte": ("inte", "int", "intellect"), "spi": ("spi", "spirit")}
        keys = [(pick(lc, *cand[k]), n) for k, n in STAT_KEYS]
        cur.execute("SELECT * FROM player_levelstats")
        by = defaultdict(dict)
        for r in cur.fetchall():
            by[(r[k_race], r[k_cls])][r[k_lvl]] = [r.get(k, 0) if k else 0 for k, _ in keys]
        cols = ["Race", "Class", "Level"] + [n for _, n in keys] + ["%s Gain" % n for _, n in keys]
        ws = new_sheet(wb, "Race-Class Stats", cols, [12, 12, 7] + [11] * 10, first=first)
        first = False
        cnt = 0
        for (race, cls) in sorted(by, key=lambda t: (CLASS_NAMES.get(t[1], str(t[1])), t[0])):
            prev = None
            for lvl in sorted(by[(race, cls)]):
                st = by[(race, cls)][lvl]
                gain = [a - b for a, b in zip(st, prev)] if prev else [""] * len(st)
                ws.append([RACE_NAMES.get(race, race), CLASS_NAMES.get(cls, cls), lvl] + st + gain)
                prev = st
                cnt += 1
        finish_sheet(ws, len(cols))
        log("Race-class stat rows: %d" % cnt)

    # ------------------------------------------------ class trainer spells
    sd = SpellData(cur)
    ct = columns(cur, "creature_template")
    trainer_cls = defaultdict(lambda: {"entries": set(), "tpls": set()})
    if ct.get("trainertype") and ct.get("trainerclass"):
        cur.execute("SELECT `%s` e, `%s` c, %s t FROM creature_template WHERE `%s` = 0 AND `%s` > 0"
                    % (ct["entry"], ct["trainerclass"],
                       ("`%s`" % ct["trainertemplateid"]) if ct.get("trainertemplateid") else "0",
                       ct["trainertype"], ct["trainerclass"]))
        for r in cur.fetchall():
            trainer_cls[r["c"]]["entries"].add(r["e"])
            if r["t"]:
                trainer_cls[r["c"]]["tpls"].add(r["t"])
    taught = defaultdict(dict)    # class -> spell -> (req level, cost, trainer spell)
    for tbl, key in (("npc_trainer", "entries"), ("npc_trainer_template", "tpls")):
        if not table_exists(cur, tbl):
            continue
        tc = columns(cur, tbl)
        for cls, info in trainer_cls.items():
            for part in chunks(sorted(info[key])):
                cur.execute("SELECT * FROM `%s` WHERE `%s` IN (%s)" % (tbl, tc["entry"], ph(len(part))), part)
                for r in cur.fetchall():
                    sp = g(r, tc, "spell")
                    cost = g(r, tc, "spellcost")
                    lvl = g(r, tc, "reqlevel")
                    old = taught[cls].get(sp)
                    if old is None or lvl < old[0]:
                        taught[cls][sp] = (lvl, cost)
    all_ids = {s for d in taught.values() for s in d}
    # resolve "learn spell" wrappers to the real spell
    resolved = {}
    for r in sd.fetch(cur, all_ids):
        sid = g(r, sd.sc, "id")
        real = sid
        for e in (1, 2, 3):
            if g(r, sd.sc, "effect%d" % e) == 36 and g(r, sd.sc, "effecttriggerspell%d" % e):
                real = g(r, sd.sc, "effecttriggerspell%d" % e)
                break
        resolved[sid] = real
    real_rows = {g(r, sd.sc, "id"): r for r in sd.fetch(cur, set(resolved.values()) | all_ids)}

    icons = Icons()
    cols = ["Icon", "Class", "Level Required", "Spell ID", "Spell", "Rank", "Training Cost",
            "School", "Cost", "Cast Time (s)", "Cooldown (s)", "Range (yd)", "Duration (s)",
            "Damage / Healing", "Effects", "Description", "Wowhead Link"]
    widths = [8, 12, 10, 8, 30, 10, 12, 10, 22, 10, 10, 9, 10, 36, 56, 70, 34]
    ws = new_sheet(wb, "Spells by Level", cols, widths, first=first)
    first = False
    n = 1
    for cls in sorted(taught, key=lambda c: CLASS_NAMES.get(c, str(c))):
        entries = []
        for sp, (lvl, cost) in taught[cls].items():
            real = resolved.get(sp, sp)
            r = real_rows.get(real) or real_rows.get(sp)
            if r is None:
                continue
            d = sd.row(r)
            entries.append((lvl or (d["level"] or 0), cost, d))
        entries.sort(key=lambda t: (t[0], t[2]["name"], t[2]["rank"]))
        for lvl, cost, d in entries:
            n += 1
            link = "https://www.wowhead.com/classic/spell=%d" % d["id"]
            ws.append(["", CLASS_NAMES.get(cls, cls), lvl, d["id"], d["name"], d["rank"],
                       money(cost) or "free", d["school"], d["cost"], d["cast"], d["cooldown"],
                       d["range"], d["duration"], d["damage"], d["effects"], d["desc"], link])
            style_row(ws, n, len(cols), link_col=len(cols), link=link,
                      icon_path=icons.for_spell(d["icon_id"]), tall=True)
    finish_sheet(ws, len(cols), freeze="F2")
    log("Trainer spell rows: %d" % (n - 1))

    # ------------------------------------------------ starting spells
    if table_exists(cur, "playercreateinfo_spell"):
        pc = columns(cur, "playercreateinfo_spell")
        cur.execute("SELECT * FROM playercreateinfo_spell")
        start = defaultdict(set)
        for r in cur.fetchall():
            start[(g(r, pc, "class"), g(r, pc, "spell"))].add(g(r, pc, "race"))
        srows = {g(r, sd.sc, "id"): r for r in sd.fetch(cur, {k[1] for k in start})}
        cols2 = ["Icon", "Class", "Spell ID", "Spell", "Rank", "Races", "Cost", "Cast Time (s)",
                 "Range (yd)", "Damage / Healing", "Description"]
        ws2 = new_sheet(wb, "Starting Spells", cols2,
                        [8, 12, 8, 30, 10, 36, 20, 10, 9, 30, 70])
        m = 1
        for (cls, sp) in sorted(start, key=lambda k: (CLASS_NAMES.get(k[0], str(k[0])), k[1])):
            r = srows.get(sp)
            if r is None:
                continue
            d = sd.row(r)
            m += 1
            races = sorted(start[(cls, sp)])
            race_txt = "All races" if len(races) >= 8 else ", ".join(RACE_NAMES.get(x, str(x)) for x in races)
            ws2.append(["", CLASS_NAMES.get(cls, cls), d["id"], d["name"], d["rank"], race_txt,
                        d["cost"], d["cast"], d["range"], d["damage"], d["desc"]])
            style_row(ws2, m, len(cols2), icon_path=icons.for_spell(d["icon_id"]), tall=True)
        finish_sheet(ws2, len(cols2), freeze="E2")
    conn.close()

    wb.save(OUTPUT)
    if icons.missing:
        log("Icons missing for %d rows." % icons.missing)
    log("Done! Saved %s" % OUTPUT)


if __name__ == "__main__":
    run(main)
