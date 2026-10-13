# -*- coding: utf-8 -*-
"""
Quest spreadsheet:  C:\\wow excel\\wow_quests.xlsx
Sheets: Quests, Quest Rewards (with icons), Quest Items (with icons)

Needs wow_common.py in the same folder, the SPP Database window open, and the
DBC files from extract_dbc_multi.py.   Run:  py wow_quests.py
"""
import os
from collections import Counter, defaultdict

from wow_common import *   # noqa

OUTPUT = os.path.join(OUT_FOLDER, "wow_quests.xlsx")

QUEST_TYPES = {0: "Normal", 1: "Group", 21: "Life", 41: "PvP", 62: "Raid",
               81: "Dungeon", 82: "World Event", 83: "Legendary", 84: "Escort",
               85: "Heroic"}
QUEST_SORTS = {-1: "Epic", -22: "Seasonal", -24: "Herbalism", -25: "Battlegrounds",
               -41: "Day of the Dead", -61: "Warlock", -81: "Warrior",
               -82: "Shaman", -101: "Fishing", -121: "Blacksmithing",
               -141: "Paladin", -161: "Mage", -162: "Rogue", -181: "Alchemy",
               -182: "Leatherworking", -201: "Engineering", -221: "Treasure Map",
               -241: "Tournament", -261: "Druid", -262: "Hunter", -263: "Priest",
               -264: "Tailoring", -304: "Cooking", -324: "First Aid",
               -344: "Legendary", -365: "Ahn'Qiraj War", -366: "Lunar Festival",
               -367: "Reputation", -368: "Invasion", -369: "Midsummer",
               -370: "Brewfest"}


def rows_of(cur, sql):
    cur.execute(sql)
    return cur.fetchall()


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    qc = columns(cur, "quest_template")
    quests = rows_of(cur, "SELECT * FROM quest_template")
    log("Quests: %d" % len(quests))

    def Q(r, name, d=0):
        return g(r, qc, name, d)

    # ---- who starts / ends quests
    starters = defaultdict(list)    # quest -> [("c"/"g", entry)]
    enders = defaultdict(list)
    for tbl, store, kind in (("creature_questrelation", starters, "c"),
                             ("gameobject_questrelation", starters, "g"),
                             ("creature_involvedrelation", enders, "c"),
                             ("gameobject_involvedrelation", enders, "g")):
        if table_exists(cur, tbl):
            for r in rows_of(cur, "SELECT id, quest FROM `%s`" % tbl):
                store[r["quest"]].append((kind, r["id"]))

    # ---- quest items / objectives
    items_needed = set()
    for r in quests:
        for k in ("reqitemid%d", "reqsourceid%d", "rewchoiceitemid%d", "rewitemid%d"):
            for n in range(1, 7):
                v = Q(r, k % n)
                if v:
                    items_needed.add(v)
        if Q(r, "srcitemid"):
            items_needed.add(Q(r, "srcitemid"))
    # also every item of the "Quest" item class
    ic = columns(cur, "item_template")
    for r in rows_of(cur, "SELECT `%s` e FROM item_template WHERE `%s` = 12"
                     % (ic["entry"], ic["class"])):
        items_needed.add(r["e"])
    items = load_items_by_ids(cur, items_needed)
    log("Items referenced / quest-class items: %d" % len(items))

    # ---- where do required items drop?
    req_items = set()
    for r in quests:
        for n in range(1, 5):
            if Q(r, "reqitemid%d" % n):
                req_items.add(Q(r, "reqitemid%d" % n))
    drop_creatures = defaultdict(list)   # item -> [creature entry]
    drop_gos = defaultdict(list)
    ct = columns(cur, "creature_template")
    if req_items and ct.get("lootid"):
        cl = loot_entries(cur, "creature_loot_template", list(req_items))
        lootids = {e for lst in cl.values() for e, _, _ in lst}
        lootmap = defaultdict(list)
        for part in chunks(list(lootids)):
            cur.execute("SELECT `%s` e, `%s` l FROM creature_template WHERE `%s` IN (%s)"
                        % (ct["entry"], ct["lootid"], ct["lootid"], ph(len(part))), part)
            for r in cur.fetchall():
                lootmap[r["l"]].append(r["e"])
        for it, lst in cl.items():
            seen = []
            for e, via_ref, chance in sorted(lst, key=lambda t: (t[1], -t[2])):
                for ce in lootmap.get(e, []):
                    if ce not in seen:
                        seen.append(ce)
            drop_creatures[it] = seen[:4]
        gt = columns(cur, "gameobject_template")
        gl = loot_entries(cur, "gameobject_loot_template", list(req_items))
        glootids = {e for lst in gl.values() for e, _, _ in lst}
        glmap = defaultdict(list)
        for part in chunks(list(glootids)):
            cur.execute("SELECT `%s` e, `%s` l FROM gameobject_template "
                        "WHERE `%s` IN (3, 25) AND `%s` IN (%s)"
                        % (gt["entry"], gt["data1"], gt["type"], gt["data1"], ph(len(part))), part)
            for r in cur.fetchall():
                glmap[r["l"]].append(r["e"])
        for it, lst in gl.items():
            seen = []
            for e, via_ref, chance in lst:
                for ge in glmap.get(e, []):
                    if ge not in seen:
                        seen.append(ge)
            drop_gos[it] = seen[:3]

    # ---- creatures / objects we must know
    c_ids, g_ids = set(), set()
    for lst in list(starters.values()) + list(enders.values()):
        for kind, e in lst:
            (c_ids if kind == "c" else g_ids).add(e)
    for r in quests:
        for n in range(1, 5):
            v = Q(r, "reqcreatureorgoid%d" % n)
            if v > 0:
                c_ids.add(v)
            elif v < 0:
                g_ids.add(-v)
    for lst in drop_creatures.values():
        c_ids.update(lst)
    for lst in drop_gos.values():
        g_ids.update(lst)

    cnames, cfaction = {}, {}
    for part in chunks(list(c_ids)):
        cur.execute("SELECT `%s` e, `%s` n, `%s` f FROM creature_template WHERE `%s` IN (%s)"
                    % (ct["entry"], ct["name"], ct["faction"], ct["entry"], ph(len(part))), part)
        for r in cur.fetchall():
            cnames[r["e"]], cfaction[r["e"]] = r["n"], r["f"]
    gt = columns(cur, "gameobject_template")
    gnames, gfaction = {}, {}
    for part in chunks(list(g_ids)):
        cur.execute("SELECT `%s` e, `%s` n, `%s` f FROM gameobject_template WHERE `%s` IN (%s)"
                    % (gt["entry"], gt["name"], gt["faction"], gt["entry"], ph(len(part))), part)
        for r in cur.fetchall():
            gnames[r["e"]], gfaction[r["e"]] = r["n"], r["f"]

    log("Reading spawn positions ...")
    c_spawn = creature_spawns(cur, c_ids)
    g_spawn = go_spawns(cur, g_ids)

    # ---- zone lookup
    resolver = AreaResolver()
    samples = []
    for r in quests:
        z = Q(r, "zoneorsort")
        if z > 0:
            for kind, e in starters.get(Q(r, "entry"), []):
                if kind == "c" and c_spawn.get(e):
                    mp, x, y = c_spawn[e][0]
                    samples.append((mp, x, y, z))
                    break
        if len(samples) >= 300:
            break
    resolver.calibrate(samples)

    place_cache = {}

    def places(kind, entry, sample=25):
        key = (kind, entry)
        if key not in place_cache:
            sp = (c_spawn if kind == "c" else g_spawn).get(entry, [])
            place_cache[key] = place_counter(resolver, sp, sample)
        return place_cache[key]

    def name_of(kind, entry):
        return (cnames if kind == "c" else gnames).get(entry, "#%d" % entry)

    def npc_cell(lst):
        out = []
        for kind, e in lst[:4]:
            out.append("%s (%s %d)" % (name_of(kind, e), "NPC" if kind == "c" else "Object", e))
        if len(lst) > 4:
            out.append("+%d more" % (len(lst) - 4))
        return "; ".join(out)

    def combined_places(lst):
        cnt = Counter()
        for kind, e in lst[:6]:
            cnt.update(places(kind, e))
        return cnt

    groups = load_faction_groups()
    fnames = load_faction_names()

    def item_label(i, n=1):
        it = items.get(i)
        nm = it["name"] if it else "item"
        return "%s (%d)%s" % (nm, i, (" x%d" % n) if n and n > 1 else "")

    # ---- build rows
    quest_rows = []
    reward_rows = []
    item_use = defaultdict(lambda: {"roles": set(), "quests": []})
    for r in quests:
        qid = Q(r, "entry")
        title = Q(r, "title", "")
        start, end = starters.get(qid, []), enders.get(qid, [])
        gcnt, ecnt = combined_places(start), combined_places(end)
        gz, gs = main_place(gcnt)
        ez, es = main_place(ecnt)

        races = int(Q(r, "requiredraces"))
        side = side_from_races(races)
        if not side:
            for kind, e in start[:3]:
                f = cfaction.get(e) if kind == "c" else gfaction.get(e)
                s = side_from_template(f, groups) if f is not None else ""
                if s:
                    side = s
                    break
        race_txt = ", ".join(mask_names(races, RACES)) if (races & 255) not in (0, 255) else ""
        classes = int(Q(r, "requiredclasses"))
        class_txt = ", ".join(mask_names(classes, CLASSES)) if (classes & 1535) not in (0, 1535) else ""

        zs = int(Q(r, "zoneorsort"))
        if zs > 0:
            qzone, qcat = resolver.zone_name(zs) or "Zone %d" % zs, ""
        elif zs < 0:
            qzone, qcat = "", QUEST_SORTS.get(zs, "Category %d" % zs)
        else:
            qzone, qcat = "", ""

        # objectives
        obj = []
        for n in range(1, 5):
            v = Q(r, "reqcreatureorgoid%d" % n)
            cnt = Q(r, "reqcreatureorgocount%d" % n)
            if v:
                kind, e = ("c", v) if v > 0 else ("g", -v)
                loc = place_text(places(kind, e), 2)
                obj.append("%s: %s%s%s" % ("Kill/Talk" if kind == "c" else "Use object",
                                            name_of(kind, e), (" x%d" % cnt) if cnt > 1 else "",
                                            (" [%s]" % loc) if loc else ""))
        quest_item_ids = []
        for n in range(1, 5):
            i, cnt = Q(r, "reqitemid%d" % n), Q(r, "reqitemcount%d" % n)
            if i:
                quest_item_ids.append(i)
                where = []
                for ce in drop_creatures.get(i, []):
                    loc = place_text(places("c", ce), 1)
                    where.append("%s%s" % (cnames.get(ce, "#%d" % ce), (" [%s]" % loc) if loc else ""))
                for ge in drop_gos.get(i, []):
                    loc = place_text(places("g", ge), 1)
                    where.append("%s%s" % (gnames.get(ge, "#%d" % ge), (" [%s]" % loc) if loc else ""))
                obj.append("Collect: %s%s" % (item_label(i, cnt),
                                              (" - from " + "; ".join(where)) if where else ""))
                item_use[i]["roles"].add("Required")
                item_use[i]["quests"].append((qid, title))
        for n in range(1, 5):
            i, cnt = Q(r, "reqsourceid%d" % n), Q(r, "reqsourcecount%d" % n)
            if i:
                quest_item_ids.append(i)
                obj.append("Item provided/used: %s" % item_label(i, cnt))
                item_use[i]["roles"].add("Provided/used")
                item_use[i]["quests"].append((qid, title))
        sid = Q(r, "srcitemid")
        if sid:
            quest_item_ids.append(sid)
            item_use[sid]["roles"].add("Given at start")
            item_use[sid]["quests"].append((qid, title))
        for n in range(1, 5):
            if Q(r, "reqspellcast%d" % n):
                obj.append("Cast spell id %d" % Q(r, "reqspellcast%d" % n))

        choice, fixed = [], []
        for n in range(1, 7):
            i = Q(r, "rewchoiceitemid%d" % n)
            if i:
                choice.append(item_label(i, Q(r, "rewchoiceitemcount%d" % n)))
                reward_rows.append((qid, title, side, Q(r, "questlevel"), "Choice", i,
                                    Q(r, "rewchoiceitemcount%d" % n) or 1))
        for n in range(1, 5):
            i = Q(r, "rewitemid%d" % n)
            if i:
                fixed.append(item_label(i, Q(r, "rewitemcount%d" % n)))
                reward_rows.append((qid, title, side, Q(r, "questlevel"), "Guaranteed", i,
                                    Q(r, "rewitemcount%d" % n) or 1))
        rep = []
        for n in range(1, 6):
            f, v = Q(r, "rewrepfaction%d" % n), Q(r, "rewrepvalue%d" % n)
            if f and v:
                rep.append("%s %+d" % (fnames.get(f, "faction %d" % f), v))

        money_rw = Q(r, "reworreqmoney")
        quest_rows.append([
            qid, title, Q(r, "questlevel"), Q(r, "minlevel"), side or "Both",
            race_txt, class_txt, qzone, qcat,
            npc_cell(start), gz, gs, npc_cell(end), ez, es,
            clean_text(Q(r, "details", "")), clean_text(Q(r, "objectives", "")),
            " | ".join(obj), ", ".join(str(i) for i in quest_item_ids),
            "; ".join(choice), "; ".join(fixed),
            money(money_rw) if money_rw > 0 else "",
            money(-money_rw) if money_rw < 0 else "",
            money(Q(r, "rewmoneymaxlevel")), "; ".join(rep),
            QUEST_TYPES.get(Q(r, "type"), str(Q(r, "type")) if Q(r, "type") else ""),
            Q(r, "prevquestid") or "", Q(r, "nextquestinchain") or "",
            ("%s %d" % (Q(r, "requiredskill"), Q(r, "requiredskillvalue"))) if Q(r, "requiredskill") else "",
            (Q(r, "limittime") // 60) if Q(r, "limittime") else "",
            Q(r, "suggestedplayers") or "",
            clean_text(Q(r, "requestitemstext", "")), clean_text(Q(r, "offerrewardtext", "")),
            "https://www.wowhead.com/classic/quest=%d" % qid,
        ])
        if len(quest_rows) % 500 == 0:
            log("  quests processed: %d / %d" % (len(quest_rows), len(quests)))

    resolver.report()
    resolver.save_cache()

    # ---- sources for quest items
    quest_item_ids_all = set(item_use) | {i for i, it in items.items() if it["cls"] == 12}
    sub_items = {i: items[i] for i in quest_item_ids_all if i in items}
    log("Looking up where %d quest items come from ..." % len(sub_items))
    sources = build_sources(cur, sub_items)
    by_item = defaultdict(list)
    for it, typ, name, detail in sources:
        by_item[it].append((typ, name, detail))
    conn.close()

    # ---- write workbook
    from openpyxl import Workbook
    wb = Workbook()
    icons = Icons()
    cols = ["ID", "Title", "Quest Level", "Min Level", "Faction", "Required Races",
            "Required Classes", "Quest Zone", "Quest Category", "Given By (NPC/Object)",
            "Giver Zone", "Giver Subzone", "Turn-in (NPC/Object)", "Turn-in Zone",
            "Turn-in Subzone", "Description", "Objectives (text)",
            "Objectives (kill / collect, with zone)", "Quest Item IDs",
            "Reward - Choose One", "Reward - Guaranteed Items", "Reward Money",
            "Cost (money)", "Reward Money at Max Level", "Reputation Rewards",
            "Type", "Previous Quest", "Next Quest in Chain", "Required Skill",
            "Time Limit (min)", "Suggested Players", "In-progress Text",
            "Completion Text", "Wowhead Link"]
    widths = [8, 32, 8, 8, 10, 18, 18, 22, 16, 36, 22, 24, 36, 22, 24, 60, 50, 70, 16,
              44, 44, 12, 10, 12, 30, 10, 10, 10, 14, 8, 8, 40, 40, 34]
    ws = new_sheet(wb, "Quests", cols, widths, first=True)
    for n, row in enumerate(sorted(quest_rows, key=lambda x: (x[10] or "~", x[2], x[1])), start=2):
        ws.append(row)
        style_row(ws, n, len(cols), link_col=len(cols), link=row[-1])
    finish_sheet(ws, len(cols), freeze="C2")

    # rewards sheet
    rew_sorted = sorted(reward_rows, key=lambda r: (r[3], r[1], r[4]))
    log("Writing reward sheet ...")
    ws2_items = []
    for qid, title, side, lvl, kind, i, cnt in rew_sorted:
        it = items.get(i)
        if it:
            d = dict(it)
            d["_q"] = (qid, title, side, lvl, kind, cnt)
            ws2_items.append(d)
    write_item_sheet(
        wb, "Quest Rewards", ws2_items, icons,
        before=["Quest ID", "Quest", "Faction", "Quest Level", "Reward Type", "Count"],
        before_widths=[9, 32, 10, 8, 12, 7],
        before_fn=lambda d: [d["_q"][0], d["_q"][1], d["_q"][2] or "Both", d["_q"][3],
                             d["_q"][4], d["_q"][5]])

    # quest items sheet
    qi_list = sorted(sub_items.values(), key=lambda x: x["name"])
    log("Writing quest item sheet ...")

    def qi_before(it):
        use = item_use.get(it["id"])
        roles = ", ".join(sorted(use["roles"])) if use else "not used by any quest"
        qs = use["quests"] if use else []
        ql = "; ".join("%s (%d)" % (t, q) for q, t in qs[:4])
        if len(qs) > 4:
            ql += " (+%d more)" % (len(qs) - 4)
        return [roles, ql]

    def qi_extra(it):
        srcs = by_item.get(it["id"], [])
        detail = "; ".join("%s: %s (%s)" % (t, nme, d) for t, nme, d in srcs[:5])
        if len(srcs) > 5:
            detail += " (+%d more)" % (len(srcs) - 5)
        return [source_summary(srcs) or "unknown", detail]

    write_item_sheet(wb, "Quest Items", qi_list, icons,
                     before=["Used As", "Used In Quests"], before_widths=[22, 50],
                     before_fn=qi_before,
                     extra_headers=["Sources (summary)", "Sources (detail)"],
                     extra_widths=[30, 80], extra_fn=qi_extra)

    wb.save(OUTPUT)
    if icons.missing:
        log("Icons missing for %d rows." % icons.missing)
    log("Done! Saved %s" % OUTPUT)


if __name__ == "__main__":
    run(main)
