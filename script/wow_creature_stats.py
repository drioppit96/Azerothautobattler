# -*- coding: utf-8 -*-
"""
Creature combat stats for the game.

Writes  C:\\wow excel\\gamedata\\creature_stats.json
  {entry: [attackTimeMs, [health per level], [minDmg per level], [maxDmg per level], [armor per level]]}
"per level" lists start at the creature's minimum level (index = level - minLevel).

Works with both cMaNGOS layouts:
  * old   creature_template has MinLevelHealth / MaxLevelHealth / MinMeleeDmg / MaxMeleeDmg / Armor
  * new   creature_template has HealthMultiplier / DamageMultiplier ... and the numbers come from
          creature_template_classlevelstats (BaseHealthExp0, BaseDamageExp0, BaseArmor) by class and level

Also writes  C:\\wow excel\\gamedata\\vendor_items.json
  {entry: [[itemId, maxCount], ...]}   what every vendor sells (npc_vendor + npc_vendor_template)

Run:  py wow_creature_stats.py      (or  py build_gamedata.py cstats)
"""
from wow_util import *   # noqa
from wow_loot_all import spawn_counts


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    tc = columns(cur, "creature_template")
    log("creature_template columns: %d" % len(tc))
    cur.execute("SELECT * FROM creature_template")
    rows = cur.fetchall()
    spawned = set(spawn_counts(cur).keys())

    cls = {}
    new_layout = table_exists(cur, "creature_template_classlevelstats")
    if new_layout:
        cc = columns(cur, "creature_template_classlevelstats")
        cur.execute("SELECT * FROM creature_template_classlevelstats")
        for r in cur.fetchall():
            cls[(g(r, cc, "class"), g(r, cc, "level"))] = r
        log("classlevelstats rows: %d (columns: %s)" % (len(cls), ", ".join(sorted(cc))))
    else:
        cc = {}
        log("No classlevelstats table - using the old per-template values")

    out = {}
    for r in rows:
        e = g(r, tc, "entry")
        if e not in spawned:
            continue
        lo = max(1, int(g(r, tc, "minlevel") or 1))
        hi = max(lo, int(g(r, tc, "maxlevel") or lo))
        atk = int(g(r, tc, "meleebaseattacktime") or g(r, tc, "baseattacktime") or 2000)
        hp, dmin, dmax, arm = [], [], [], []
        if new_layout and "healthmultiplier" in tc:
            hm = float(g(r, tc, "healthmultiplier") or 1)
            dm = float(g(r, tc, "damagemultiplier") or 1)
            am = float(g(r, tc, "armormultiplier") or 1)
            var = float(g(r, tc, "damagevariance") or 1)
            uc = g(r, tc, "unitclass") or 1
            for lv in range(lo, hi + 1):
                s = cls.get((uc, lv)) or cls.get((1, lv))
                if not s:
                    hp.append(0); dmin.append(0); dmax.append(0); arm.append(0); continue
                h = float(g(s, cc, "basehealthexp0") or g(s, cc, "basehealth") or 0) * hm
                d = float(g(s, cc, "basedamageexp0") or g(s, cc, "basedamage") or 0) * dm
                hp.append(int(round(h)))
                dmin.append(round(d * max(0.0, 1 - 0.25 * var), 1))
                dmax.append(round(d * (1 + 0.25 * var), 1))
                arm.append(int(round(float(g(s, cc, "basearmor") or 0) * am)))
        else:
            hmin = g(r, tc, "minlevelhealth") or g(r, tc, "minhealth")
            hmax = g(r, tc, "maxlevelhealth") or g(r, tc, "maxhealth") or hmin
            d0 = float(g(r, tc, "mindmg") or g(r, tc, "minmeleedmg") or 0)
            d1 = float(g(r, tc, "maxdmg") or g(r, tc, "maxmeleedmg") or d0)
            mult = float(g(r, tc, "dmgmultiplier") or g(r, tc, "damagemultiplier") or 1)
            a0 = g(r, tc, "armor")
            for lv in range(lo, hi + 1):
                k = (lv - lo) / float(hi - lo) if hi > lo else 0.0
                hp.append(int(round(hmin + (hmax - hmin) * k)))
                dmin.append(round(d0 * mult, 1)); dmax.append(round(d1 * mult, 1)); arm.append(int(a0 or 0))
        out[e] = [atk, hp, dmin, dmax, arm]
    log("Creatures with stats: %d" % len(out))
    save_json("creature_stats", out)
    log("Wrote creature_stats.json")
    vendors(cur, rows, tc)


def vendors(cur, templ_rows, tc):
    """every vendor's item list, from npc_vendor (by creature entry) and npc_vendor_template (by template id)"""
    direct, by_tmpl = {}, {}
    for table, store in (("npc_vendor", direct), ("npc_vendor_template", by_tmpl)):
        if not table_exists(cur, table):
            log("  table %s: missing" % table)
            continue
        vc = columns(cur, table)
        cur.execute("SELECT * FROM `%s`" % table)
        n = 0
        for r in cur.fetchall():
            store.setdefault(g(r, vc, "entry"), []).append([g(r, vc, "item"), g(r, vc, "maxcount") or 0])
            n += 1
        log("  table %s: %d rows, %d lists" % (table, n, len(store)))
    tkey = "vendortemplateid" if "vendortemplateid" in tc else None
    out = {}
    for r in templ_rows:
        e = g(r, tc, "entry")
        lst = list(direct.get(e, []))
        if tkey and g(r, tc, tkey):
            lst += by_tmpl.get(g(r, tc, tkey), [])
        if lst:
            seen, uniq = set(), []
            for it, mc in lst:
                if it not in seen:
                    seen.add(it); uniq.append([it, mc])
            out[e] = uniq
    log("Vendors with items: %d" % len(out))
    save_json("vendor_items", out)


if __name__ == "__main__":
    main()
