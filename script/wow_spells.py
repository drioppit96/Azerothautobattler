# -*- coding: utf-8 -*-
"""
Spell spreadsheet:  C:\\wow excel\\wow_spells.xlsx
  Player Spells  - every spell that belongs to a class / weapon / profession /
                   racial skill line, WITH icons
  All Spells     - every spell in the database (NPC and internal ones too);
                   icons only if ICONS_FOR_ALL_SPELLS = True (makes a huge file)

Needs wow_common.py + wow_spelldata.py in the same folder, the SPP Database
window open, and the DBC files from extract_dbc_multi.py (re-run it, it now
also extracts the spell cast time / range / duration tables).
Run:  py wow_spells.py
"""
import os

from wow_spelldata import *   # noqa

OUTPUT = os.path.join(OUT_FOLDER, "wow_spells.xlsx")
ICONS_FOR_ALL_SPELLS = False


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    sd = SpellData(cur)
    log("Skill lines known: %d, spell->skill links: %d" % (len(sd.skill_names), len(sd.sla)))

    rows = sd.fetch(cur)
    log("Spells in database: %d" % len(rows))

    # item names for reagents
    ids = set()
    for r in rows:
        for n in range(1, 9):
            v = g(r, sd.sc, "reagent%d" % n)
            if v > 0:
                ids.add(v)
    item_names = {}
    ic = columns(cur, "item_template")
    for part in chunks(sorted(ids)):
        cur.execute("SELECT `%s` e, `%s` n FROM item_template WHERE `%s` IN (%s)"
                    % (ic["entry"], ic["name"], ic["entry"], ph(len(part))), part)
        for x in cur.fetchall():
            item_names[x["e"]] = x["n"]
    conn.close()

    log("Computing spell values ...")
    player, other = [], []
    for n, r in enumerate(rows, 1):
        d = sd.row(r)
        d["reagents"] = sd.reagents_text(r, item_names)
        d["icon_name"] = ""
        if d["name"]:
            (player if d["id"] in sd.sla else other).append(d)
        if n % 5000 == 0:
            log("  %d / %d" % (n, len(rows)))
    log("Player spells: %d, other spells: %d" % (len(player), len(other)))

    from openpyxl import Workbook
    wb = Workbook()
    icons = Icons()

    def write(title, items, with_icons, first=False):
        cols = ["Icon"] + [c[0] for c in SPELL_COLS] + ["Reagents", "Icon Name", "Wowhead Link"]
        widths = [8] + [c[1] for c in SPELL_COLS] + [36, 26, 34]
        ws = new_sheet(wb, title, cols, widths, first=first)
        link_col = len(cols)
        for n, d in enumerate(items, start=2):
            link = "https://www.wowhead.com/classic/spell=%d" % d["id"]
            iname = icons.spell_names.get(d["icon_id"], "")
            ws.append([""] + [d[c[2]] for c in SPELL_COLS] + [d["reagents"], iname, link])
            style_row(ws, n, len(cols), link_col=link_col, link=link,
                      icon_path=icons.for_spell(d["icon_id"]) if with_icons else None,
                      tall=with_icons)
            if (n - 1) % 500 == 0:
                log("  %s: %d / %d" % (title, n - 1, len(items)))
        finish_sheet(ws, len(cols), freeze="C2")

    player.sort(key=lambda d: (d["class"] or "~", d["skill"], d["level"] or 0, d["name"], d["id"]))
    other.sort(key=lambda d: (d["name"], d["id"]))
    write("Player Spells", player, True, first=True)
    write("All Spells", player + other, ICONS_FOR_ALL_SPELLS)
    wb.save(OUTPUT)
    if icons.missing:
        log("Icons missing for %d spells." % icons.missing)
    log("Done! Saved %s" % OUTPUT)


if __name__ == "__main__":
    run(main)
