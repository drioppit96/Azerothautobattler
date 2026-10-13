# -*- coding: utf-8 -*-
"""
Mob / NPC spreadsheet:  C:\\wow excel\\wow_mobs.xlsx
Sheets: Mobs (stats + main zone), Spawns (zone > subzone per mob)

Needs wow_common.py in the same folder, the SPP Database window open, and the
DBC files from extract_dbc_multi.py.   Run:  py wow_mobs.py
"""
import os
from collections import Counter, defaultdict

from wow_common import *   # noqa

OUTPUT = os.path.join(OUT_FOLDER, "wow_mobs.xlsx")
PORTRAIT_SMALL = os.path.join(OUT_FOLDER, "portraits", "small")   # from wow_portraits.py
PORTRAIT_PX = 64

RANK = {0: "Normal", 1: "Elite", 2: "Rare Elite", 3: "World Boss", 4: "Rare"}
CTYPE = {0: "", 1: "Beast", 2: "Dragonkin", 3: "Demon", 4: "Elemental",
         5: "Giant", 6: "Undead", 7: "Humanoid", 8: "Critter", 9: "Mechanical",
         10: "Not specified", 11: "Totem"}
FAMILY = {1: "Wolf", 2: "Cat", 3: "Spider", 4: "Bear", 5: "Boar", 6: "Crocolisk",
          7: "Carrion Bird", 8: "Crab", 9: "Gorilla", 11: "Raptor",
          12: "Tallstrider", 15: "Felhunter", 16: "Voidwalker", 17: "Succubus",
          19: "Doomguard", 20: "Scorpid", 21: "Turtle", 23: "Imp", 24: "Bat",
          25: "Hyena", 26: "Owl", 27: "Wind Serpent"}
NPC_FLAGS = [(1, "Gossip"), (2, "Quest giver"), (4, "Vendor"), (8, "Flight master"),
             (16, "Trainer"), (32, "Spirit healer"), (64, "Spirit guide"), (128, "Innkeeper"),
             (256, "Banker"), (512, "Petitions"), (1024, "Tabard"), (2048, "Battlemaster"),
             (4096, "Auctioneer"), (8192, "Stable master"), (16384, "Repairs")]


def map_name(resolver, mp):
    if mp in MAP_NAMES:
        return MAP_NAMES[mp]
    d = resolver.map_dirs.get(mp)
    return d or "Map %d" % mp


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    ct = columns(cur, "creature_template")
    cur.execute("SELECT * FROM creature_template")
    mobs = cur.fetchall()
    log("Creature templates: %d" % len(mobs))

    log("Reading spawn positions ...")
    spawns = creature_spawns(cur, None)
    log("Creatures with spawns: %d (%d spawn points)"
        % (len(spawns), sum(len(v) for v in spawns.values())))

    # quest givers help to calibrate the zone lookup
    resolver = AreaResolver()
    samples = []
    if table_exists(cur, "creature_questrelation"):
        cur.execute("SELECT r.id i, q.ZoneOrSort z FROM creature_questrelation r "
                    "JOIN quest_template q ON q.entry = r.quest WHERE q.ZoneOrSort > 0")
        seen = set()
        for r in cur.fetchall():
            if r["i"] in seen or not spawns.get(r["i"]):
                continue
            seen.add(r["i"])
            mp, x, y = spawns[r["i"]][0]
            samples.append((mp, x, y, r["z"]))
            if len(samples) >= 300:
                break
    resolver.calibrate(samples)

    log("Working out zones for every spawn (the first run reads the map files) ...")
    place = {}
    n = 0
    for entry, sp in spawns.items():
        cnt = Counter()
        sub_samples = {}
        for mp, x, y in sp:
            z, s = resolver.locate(mp, x, y)
            key = (map_name(resolver, mp), z, s)
            cnt[key] += 1
            if key not in sub_samples:
                sub_samples[key] = (round(x, 1), round(y, 1))
        place[entry] = (cnt, sub_samples)
        n += 1
        if n % 2000 == 0:
            log("  mobs located: %d / %d" % (n, len(spawns)))
    resolver.report()
    resolver.save_cache()
    conn.close()

    from openpyxl import Workbook
    wb = Workbook()
    cols = ["Portrait", "ID", "Name", "Title / Subname", "Level", "Class", "Type", "Pet Family",
            "Health", "Mana", "Armor", "Melee Damage", "Attack Speed (s)",
            "Fire Res", "Nature Res", "Frost Res", "Shadow Res", "Arcane Res",
            "Holy Res", "Faction ID", "NPC Roles", "Loot Gold", "Spawns",
            "Continent / Map", "Main Zone", "Main Subzone", "All Locations",
            "Wowhead Link"]
    widths = [11, 8, 30, 24, 9, 12, 13, 12, 14, 12, 8, 14, 9, 7, 7, 7, 7, 7, 7, 9,
              24, 12, 8, 18, 22, 24, 60, 34]
    ws = new_sheet(wb, "Mobs", cols, widths, first=True)

    def G(r, name, d=0):
        return g(r, ct, name, d)

    spawn_rows = []
    rows = []
    portraits = {}
    for r in mobs:
        entry = G(r, "entry")
        lo, hi = G(r, "minlevel"), G(r, "maxlevel")
        level = "%d" % lo if lo == hi else "%d-%d" % (lo, hi)
        if G(r, "rank") == 3:
            level = "??"
        hp = ("%d" % G(r, "minlevelhealth") if G(r, "minlevelhealth") == G(r, "maxlevelhealth")
              else "%d-%d" % (G(r, "minlevelhealth"), G(r, "maxlevelhealth")))
        mana = ("" if not G(r, "maxlevelmana") else
                ("%d" % G(r, "minlevelmana") if G(r, "minlevelmana") == G(r, "maxlevelmana")
                 else "%d-%d" % (G(r, "minlevelmana"), G(r, "maxlevelmana"))))
        speed = G(r, "meleebaseattacktime")
        flags = ", ".join(mask_names(G(r, "npcflags"), NPC_FLAGS))
        gold = ""
        if G(r, "maxlootgold"):
            gold = "%s - %s" % (money(G(r, "minlootgold")) or "0c", money(G(r, "maxlootgold")))
        cnt, samples_ = place.get(entry, (Counter(), {}))
        total = sum(cnt.values())
        mp_name = zone = sub = ""
        if cnt:
            (mp_name, zone, sub), _ = cnt.most_common(1)[0]
        zone_cnt = Counter()
        for (m_, z_, s_), c_ in cnt.items():
            zone_cnt[(z_, s_)] += c_
            spawn_rows.append([entry, G(r, "name", ""), level, m_, z_, s_, c_,
                               "%s, %s" % samples_[(m_, z_, s_)],
                               "https://www.wowhead.com/classic/npc=%d" % entry])
        allloc = place_text(zone_cnt, 6)
        for k in ("displayid1", "displayid2", "displayid3", "displayid4"):
            p = os.path.join(PORTRAIT_SMALL, "%d.png" % G(r, k))
            if G(r, k) and os.path.exists(p):
                portraits[entry] = p
                break
        rows.append([
            "", entry, G(r, "name", ""), G(r, "subname", "") or "", level,
            RANK.get(G(r, "rank"), ""), CTYPE.get(G(r, "creaturetype"), ""),
            FAMILY.get(G(r, "family"), ""), hp, mana, G(r, "armor") or "",
            ("%d - %d" % (G(r, "minmeleedmg"), G(r, "maxmeleedmg"))) if G(r, "maxmeleedmg") else "",
            round(speed / 1000.0, 2) if speed else "",
            G(r, "resistancefire") or "", G(r, "resistancenature") or "",
            G(r, "resistancefrost") or "", G(r, "resistanceshadow") or "",
            G(r, "resistancearcane") or "", G(r, "resistanceholy") or "",
            G(r, "faction"), flags, gold, total, mp_name, zone, sub, allloc,
            "https://www.wowhead.com/classic/npc=%d" % entry])
    rows.sort(key=lambda x: (x[24] or "~", x[25], x[4] if isinstance(x[4], str) else "", x[2]))
    if not portraits:
        log("No portraits found - run wow_portraits.py first to get the picture column.")
    XLImage = None
    if portraits:
        from openpyxl.drawing.image import Image as XLImage
    for i, row in enumerate(rows, start=2):
        ws.append(row)
        style_row(ws, i, len(cols), link_col=len(cols), link=row[-1])
        p = portraits.get(row[1])
        if p:
            ws.row_dimensions[i].height = PORTRAIT_PX * 0.76
            try:
                im = XLImage(p)
                im.width = im.height = PORTRAIT_PX
                ws.add_image(im, "A%d" % i)
            except Exception:
                pass
    finish_sheet(ws, len(cols), freeze="D2")

    spawn_rows.sort(key=lambda x: (x[3], x[4], x[5], x[1]))
    add_plain_sheet(wb, "Spawns",
                    ["Mob ID", "Name", "Level", "Continent / Map", "Zone", "Subzone",
                     "Spawn Count", "Example Position (x, y)", "Wowhead Link"],
                    [8, 30, 9, 18, 24, 26, 10, 22, 34], spawn_rows, link_col=9)
    wb.save(OUTPUT)
    log("Done! Saved %s  (%d mobs, %d zone rows)" % (OUTPUT, len(rows), len(spawn_rows)))


if __name__ == "__main__":
    run(main)
