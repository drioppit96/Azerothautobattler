# -*- coding: utf-8 -*-
"""
Spells in a form the game can RUN (player spells, talents, racials, item spells, mob spells).

Writes  C:\\wow excel\\gamedata\\spells.json     all spells with structured numbers
        C:\\wow excel\\gamedata\\spellmath.js    helper functions (value at level, coefficients, costs, ticks)
        C:\\wow excel\\wow_spells_json.xlsx     readable overview (Spells + Effects sheets)

spells.json
  meta     lookup tables (effects, auras, schools, spell mods, target kinds, power types)
  spells   {id: {...}}
      n name  r rank text  rk rank number  first first rank spell id  ic icon name
      sc school (0 phys,1 holy,2 fire,3 nature,4 frost,5 shadow,6 arcane)  lv spell level  bl base level  ml max level
      cast cast time ms  cd cooldown ms  cat category  catcd category cooldown ms  gcd global cooldown ms
      rng [min,max] yards  dur duration ms (-1 = until cancelled)
      pw [powerType, flatCost, percentOfBaseMana, perSecond]   (rage cost divided by 10 when stored x10)
      ac damage class (0 none, 1 magic, 2 melee, 3 ranged)  mech mechanic  disp dispel type
      at [attributes, ex, ex2, ex3, ex4] raw flags   fl [readable flags]
      ef effects (up to 3):
         t effect type  au aura type  lo,hi value range at the spell's own level
         ppl value gained per caster level above bl (cap ml)  die/dice dice  amp period ms  tk number of ticks
         mi misc value  mm misc B  tr triggered spell  it item or family mask  ra radius yards  ch chain targets
         ta,tb implicit targets  k kind  cp value per combo point  mult chain multiplier  coef spell power coefficient
      s  summary: {kind, direct:[lo,hi], dot:{tick:[lo,hi], ticks, period}, heal:true/false, cd_direct, cd_dot,
                   weapon: {mode, bonus, pct}, aoe, channeled}
      fam [spellFamilyName, spellFamilyFlags]   pr proc {flags, chance, charges, ppm, ex, cd}
      cls class ids   src sources (class, talent, racial, item, mob, trigger)   re reagents [[item, count]]
      stack stack amount  focus  totems
  mob_use  {mobEntry: [[spellId, source, p1, p2, p3, p4, chance, target, flags]]}   (see wow_mob_spells.py)

Run:  py wow_spells_json.py
Needs wow_common.py, wow_util.py, wow_spelldata.py (same folder); DBCs Spell, SpellCastTimes,
SpellRange, SpellDuration, SpellRadius, SpellIcon, SkillLine, SkillLineAbility, Talent (extract_dbc_multi.py).
"""
import os
from collections import defaultdict

from wow_util import *   # noqa
from wow_spelldata import SpellData, SCHOOL, EFFECTS, AURAS, POWER

OUTPUT = os.path.join(OUT_FOLDER, "wow_spells_json.xlsx")
GCD_MS = 1500
CLASS_BITS = {1: 1, 2: 2, 4: 3, 8: 4, 16: 5, 64: 7, 128: 8, 256: 9, 1024: 11}

SPELL_MODS = {0: "damage", 1: "duration", 2: "threat", 3: "effect 1", 4: "charges", 5: "range",
              6: "radius", 7: "crit chance", 8: "all effects", 9: "no pushback", 10: "cast time",
              11: "cooldown", 12: "effect 2", 14: "cost", 15: "crit damage bonus",
              16: "resist miss chance", 17: "jump targets", 18: "proc chance", 19: "activation time",
              20: "effect past first", 21: "cast time (old)", 22: "dot", 23: "effect 3",
              24: "spell power bonus"}
TARGET_SELF = {1, 5, 7}                      # self / pet
TARGET_ENEMY = {6, 25, 2, 77}
TARGET_FRIEND = {21, 35, 45, 57, 20}
TARGET_AREA_ENEMY = {15, 16, 28, 18, 24, 53}
TARGET_AREA_FRIEND = {30, 31, 33, 37, 41, 42, 43, 44}
TARGET_AREA_CASTER = {22}                    # around the caster (hostile or friendly by effect)
DAMAGE_EFFECTS = {2, 7, 9}
HEAL_EFFECTS = {10, 67, 68}
WEAPON_EFFECTS = {17: "weapon_noschool", 31: "percent", 58: "weapon", 121: "normalized"}
DOT_AURAS = {3, 89}
HOT_AURAS = {8}
TRIGGER_AURAS = {23, 42, 43}
ATTR_FLAGS = [(0x2, 0, "ranged"), (0x4, 0, "next_swing"), (0x10, 0, "ability"), (0x20, 0, "tradeskill"),
              (0x40, 0, "passive"), (0x80, 0, "hidden"), (0x400, 0, "next_swing_nodamage"),
              (0x1000, 0, "outdoors"), (0x2000, 0, "indoors"), (0x20000, 0, "needs_stealth"),
              (0x10000000, 0, "not_in_combat"), (0x4, 1, "channeled"), (0x40, 1, "channeled"),
              (0x80, 1, "negative"), (0x400000, 1, "no_gcd_ex"), (0x20000000, 2, "cant_crit")]


def target_kind(a, b):
    ta = a or b
    if a in TARGET_AREA_ENEMY or b in TARGET_AREA_ENEMY:
        return "area_enemy"
    if a in TARGET_AREA_FRIEND or b in TARGET_AREA_FRIEND:
        return "area_friend"
    if a in TARGET_AREA_CASTER or b in TARGET_AREA_CASTER:
        return "area_caster"
    if ta in TARGET_ENEMY:
        return "enemy"
    if ta in TARGET_FRIEND:
        return "friend"
    if ta in TARGET_SELF or ta == 0:
        return "self"
    return "other"


class Radii(object):
    def __init__(self):
        self.r = {}
        d = load_dbc("SpellRadius")
        if d:
            for row in d.rows:
                self.r[row[0]] = round(flt(row[1]), 1)

    def get(self, idx):
        return self.r.get(idx, 0)


def sval(v):
    """unsigned 32 -> signed"""
    return v - 2 ** 32 if v >= 2 ** 31 else v


class Builder(object):
    def __init__(self, cur, sd):
        self.cur, self.sd = cur, sd
        self.c = sd.sc
        self.radii = Radii()
        self.icons = spell_icons()
        self.chain = {}
        self.bonus = {}
        self.procev = {}
        self._load_tables()
        self.cls_of = defaultdict(set)
        self.base_mana = {}

    def _load_tables(self):
        cur = self.cur
        if table_exists(cur, "spell_chain"):
            c = columns(cur, "spell_chain")
            cur.execute("SELECT * FROM spell_chain")
            for r in cur.fetchall():
                self.chain[g(r, c, "spell_id")] = (g(r, c, "first_spell"), g(r, c, "rank"))
        if table_exists(cur, "spell_bonus_data"):
            c = columns(cur, "spell_bonus_data")
            cur.execute("SELECT * FROM spell_bonus_data")
            for r in cur.fetchall():
                self.bonus[g(r, c, "entry")] = (float(g(r, c, "direct_bonus", -1)), float(g(r, c, "dot_bonus", -1)),
                                                float(g(r, c, "ap_bonus", -1)), float(g(r, c, "ap_dot_bonus", -1)))
        if table_exists(cur, "spell_proc_event"):
            c = columns(cur, "spell_proc_event")
            cur.execute("SELECT * FROM spell_proc_event")
            for r in cur.fetchall():
                self.procev[g(r, c, "entry")] = {
                    "flags": g(r, c, "procflags"), "ex": g(r, c, "procex"), "ppm": float(g(r, c, "ppmrate", 0)),
                    "chance": float(g(r, c, "customchance", 0)), "cd": g(r, c, "cooldown"),
                    "school": g(r, c, "schoolmask"), "fam": g(r, c, "spellfamilyname")}
        log("spell_chain %d, spell_bonus_data %d, spell_proc_event %d" % (len(self.chain), len(self.bonus), len(self.procev)))

    # ---------------------------------------------------------------- one spell
    def build(self, r):
        sd, c = self.sd, self.c
        sid = g(r, c, "id")
        school = g(r, c, "school", None)
        if school is None:
            m = g(r, c, "schoolmask", 1)
            school = (m & -m).bit_length() - 1 if m else 0
        lvl, bl, ml = g(r, c, "spelllevel"), g(r, c, "baselevel"), g(r, c, "maxlevel")
        cast = sd.cast_ms(r)
        dur = sd.duration_ms(r)
        if dur >= 2 ** 31:
            dur = -1
        pt = g(r, c, "powertype")
        mc = g(r, c, "manacost")
        rng = sd.range.get(g(r, c, "rangeindex"), (0, 0))
        at = [g(r, c, "attributes"), g(r, c, "attributesex"), g(r, c, "attributesex2"),
              g(r, c, "attributesex3"), g(r, c, "attributesex4")]
        flags = []
        for bit, idx, name in ATTR_FLAGS:
            if idx < len(at) and at[idx] & bit and name not in flags:
                flags.append(name)
        channeled = "channeled" in flags
        if "startrecoverytime" in c:
            gcd = g(r, c, "startrecoverytime")
            if not gcd and g(r, c, "startrecoverycategory", 0):
                gcd = GCD_MS
        else:
            gcd = 0 if ("passive" in flags or "next_swing" in flags) else GCD_MS
        ch = self.chain.get(sid)
        first, rk = (ch if ch else (sid, 1 if not g(r, c, "rank1", "") else None))
        sp = {"n": g(r, c, "spellname", "") or "", "r": g(r, c, "rank1", "") or "", "sc": school,
              "lv": lvl, "bl": bl}
        if ml:
            sp["ml"] = ml
        if rk:
            sp["rk"] = rk
        if first and first != sid:
            sp["first"] = first
        ic = self.icons.get(g(r, c, "spelliconid"))
        if ic:
            sp["ic"] = ic
        if cast:
            sp["cast"] = cast
        for key, val in (("cd", g(r, c, "recoverytime")), ("cat", g(r, c, "category")),
                         ("catcd", g(r, c, "categoryrecoverytime")), ("gcd", gcd),
                         ("mech", g(r, c, "mechanic")), ("disp", g(r, c, "dispel")),
                         ("ac", g(r, c, "dmgclass")), ("stack", g(r, c, "stackamount"))):
            if val:
                sp[key] = val
        if rng[1] > 0:
            sp["rng"] = [round(rng[0], 1), round(rng[1], 1)]
        if dur:
            sp["dur"] = dur
        ps = g(r, c, "manapersecond")
        pct = g(r, c, "manacostpercentage")
        if mc or pct or ps:
            sp["pw"] = [pt, mc, pct, ps]
        sp["at"] = at
        if flags:
            sp["fl"] = flags
        fam = g(r, c, "spellfamilyname")
        ff = g(r, c, "spellfamilyflags")
        if fam or ff:
            sp["fam"] = [fam, ff]
        pf = g(r, c, "procflags")
        pe = self.procev.get(sid)
        if pf or pe:
            pr = {"flags": pf, "chance": g(r, c, "procchance"), "charges": g(r, c, "procscharges") or g(r, c, "proccharges")}
            if pe:
                pr.update({k: v for k, v in pe.items() if v})
            sp["pr"] = {k: v for k, v in pr.items() if v}
        reag = []
        for n in range(1, 9):
            rid = g(r, c, "reagent%d" % n)
            if rid > 0:
                reag.append([rid, g(r, c, "reagentcount%d" % n) or 1])
        if reag:
            sp["re"] = reag

        effects = []
        for e in (1, 2, 3):
            et = g(r, c, "effect%d" % e)
            if not et:
                continue
            lo, hi = sd.effect_range(r, e)
            au = g(r, c, "effectapplyauraname%d" % e)
            amp = g(r, c, "effectamplitude%d" % e)
            ta, tb = g(r, c, "effectimplicittargeta%d" % e), g(r, c, "effectimplicittargetb%d" % e)
            ef = {"t": et, "lo": lo, "hi": hi}
            if au:
                ef["au"] = au
            for key, val in (("ppl", float(g(r, c, "effectrealpointsperlevel%d" % e, 0) or 0)),
                             ("die", g(r, c, "effectdiesides%d" % e)), ("dice", g(r, c, "effectbasedice%d" % e)),
                             ("amp", amp), ("mi", g(r, c, "effectmiscvalue%d" % e)),
                             ("mm", g(r, c, "effectmiscvalueb%d" % e)),
                             ("tr", g(r, c, "effecttriggerspell%d" % e)),
                             ("it", g(r, c, "effectitemtype%d" % e)),
                             ("ch", g(r, c, "effectchaintarget%d" % e)),
                             ("cp", float(g(r, c, "effectpointspercombopoint%d" % e, 0) or 0)),
                             ("mech", g(r, c, "effectmechanic%d" % e)),
                             ("mult", float(g(r, c, "effectmultiplevalue%d" % e, 0) or 0)),
                             ("ta", ta), ("tb", tb)):
                if val:
                    ef[key] = val
            ra = self.radii.get(g(r, c, "effectradiusindex%d" % e))
            if ra:
                ef["ra"] = ra
            if amp and dur > 0:
                ef["tk"] = max(1, dur // amp)
            ef["k"] = target_kind(ta, tb)
            effects.append(ef)
        if effects:
            sp["ef"] = effects
        sp["s"] = self.summary(sp, effects, dur, cast, channeled)
        return sid, sp

    # ------------------------------------------------------------- summary / coefficients
    def summary(self, sp, effects, dur, cast, channeled):
        s = {}
        direct = dot = None
        heal = False
        weapon = None
        aoe = False
        kinds = set()
        for ef in effects:
            t, au = ef["t"], ef.get("au", 0)
            ra = ef.get("ra", 0)
            if ef["k"].startswith("area") and ra:
                aoe = True
            avg = (ef["lo"] + ef["hi"]) / 2.0
            if t in DAMAGE_EFFECTS and direct is None:
                direct = [ef["lo"], ef["hi"]]
                kinds.add("damage")
            elif t in HEAL_EFFECTS and direct is None:
                direct = [ef["lo"], ef["hi"]]
                heal = True
                kinds.add("heal")
            elif t in WEAPON_EFFECTS:
                weapon = {"mode": WEAPON_EFFECTS[t], ("pct" if t == 31 else "bonus"): ef["lo"]}
                if ef["hi"] != ef["lo"]:
                    weapon["bonus_max"] = ef["hi"]
                kinds.add("damage")
            elif t in (6, 27, 35, 119) and au in DOT_AURAS | HOT_AURAS and dot is None:
                dot = {"tick": [ef["lo"], ef["hi"]], "ticks": ef.get("tk", 1), "period": ef.get("amp", 0)}
                if au in HOT_AURAS:
                    heal = True
                    kinds.add("hot")
                else:
                    kinds.add("dot")
            elif t in (6, 27, 35, 119):
                kinds.add("aura")
            elif t == 64 or au in TRIGGER_AURAS:
                kinds.add("trigger")
            elif t in (28, 41, 42, 56):
                kinds.add("summon")
        if direct:
            s["direct"] = direct
        if dot:
            s["dot"] = dot
        if weapon:
            s["weapon"] = weapon
        if heal:
            s["heal"] = True
        if aoe:
            s["aoe"] = True
        if channeled:
            s["channeled"] = True
        s["kind"] = "+".join(sorted(kinds)) if kinds else "utility"
        # spell power coefficients (the classic formulas; spell_bonus_data overrides when present)
        if (direct or dot) and not weapon and sp.get("ac", 0) in (0, 1) and sp.get("sc", 0) != 0:
            cd_, cdot = self.coefficients(sp, direct, dot, dur, cast, channeled, aoe)
            if cd_ is not None and direct:
                s["cd_direct"] = round(cd_, 4)
            if cdot is not None and dot:
                s["cd_dot"] = round(cdot, 4)
        return s

    def coefficients(self, sp, direct, dot, dur, cast, channeled, aoe):
        lvl = sp.get("lv", 0)
        d_amt = (direct[0] + direct[1]) / 2.0 if direct else 0
        t_amt = 0
        if dot:
            t_amt = (dot["tick"][0] + dot["tick"][1]) / 2.0 * dot["ticks"]
        d_amt, t_amt = abs(d_amt), abs(t_amt)
        cdir = cdot = None
        if channeled and dot:
            total = min(dur, 3500) / 3500.0 if dur > 0 else 0
            cdot = total
        else:
            if direct:
                cdir = min(max(cast, GCD_MS), 3500) / 3500.0
            if dot:
                cdot = min(dur, 15000) / 15000.0 if dur > 0 else 0
            if direct and dot and (d_amt + t_amt) > 0:
                cdir = cdir * d_amt / (d_amt + t_amt)
                cdot = cdot * t_amt / (d_amt + t_amt)
        if aoe:
            cdir = cdir / 3.0 if cdir is not None else None
            cdot = cdot / 3.0 if cdot is not None else None
        if 0 < lvl < 20:
            f = 1 - (20 - lvl) * 0.0375
            cdir = cdir * f if cdir is not None else None
            cdot = cdot * f if cdot is not None else None
        first = sp.get("first")
        b = None
        for key in (sp.get("_id"), first):
            if key in self.bonus:
                b = self.bonus[key]
                break
        if b:
            if b[0] >= 0:
                cdir = b[0]
            if b[1] >= 0:
                cdot = b[1]
            sp["bonus_src"] = "spell_bonus_data"
        return cdir, cdot


# ------------------------------------------------------------------- selection of spells
def fetch_all(cur, sd, ids):
    """full spell_template rows (SpellData.fetch only selects a few columns)"""
    out = []
    for part in chunks(sorted(ids)):
        cur.execute("SELECT * FROM spell_template WHERE `%s` IN (%s)" % (sd.sc["id"], ph(len(part))), part)
        out.extend(cur.fetchall())
    return out


PET_SKILL_FIRST, PET_SKILL_LAST = 203, 218          # Pet - Spider ... Pet - Tallstrider (the imp, felhunter below)
PET_SKILLS = {188, 189, 236, 251, 270, 653, 654, 655, 656}


def collect_player_ids(cur, sd):
    ids = {}
    for sid, lst in sd.sla.items():
        cm = rm = 0
        for skill, cmask, rmask, _ in lst:
            cm |= cmask
            rm |= rmask
        if cm:
            ids[sid] = ({CLASS_BITS[b] for b in CLASS_BITS if cm & b}, "class")
        elif rm and bin(rm).count("1") == 1:
            ids.setdefault(sid, (set(), "racial"))
    d = load_dbc("Talent")
    if d:
        for r in d.rows:
            for sid in r[4:13]:
                if sid:
                    ids.setdefault(sid, (set(), "talent"))
                    if ids[sid][1] != "talent":
                        ids[sid] = (ids[sid][0], ids[sid][1] + "+talent")
    # hunter pet and warlock demon abilities (the pet skill lines: Pet - Wolf ... Pet - Imp, Pet - Generic)
    for sid, lst in sd.sla.items():
        if any(PET_SKILL_FIRST <= skill <= PET_SKILL_LAST or skill in PET_SKILLS for skill, _, _, _ in lst):
            ids.setdefault(sid, (set(), "pet"))
    for sid in (18789, 18790, 18791, 18792):            # Demonic Sacrifice: the buff of each demon
        ids.setdefault(sid, (set(), "pet"))
    if table_exists(cur, "spell_pet_auras"):           # Master Demonologist, Soul Link, Spirit Bond: the auras they give
        cur.execute("SELECT * FROM spell_pet_auras")
        for r in cur.fetchall():
            ids.setdefault(r["aura"], (set(), "pet"))
    if table_exists(cur, "playercreateinfo_spell"):
        c = columns(cur, "playercreateinfo_spell")
        cur.execute("SELECT DISTINCT `%s` s FROM playercreateinfo_spell" % c["spell"])
        for r in cur.fetchall():
            ids.setdefault(r["s"], (set(), "class"))
    return ids


def collect_item_spells(cur):
    ic = columns(cur, "item_template")
    cols = [ic["spellid_%d" % n] for n in range(1, 6) if ("spellid_%d" % n) in ic]
    out = set()
    if cols:
        cur.execute("SELECT %s FROM item_template" % ", ".join("`%s`" % c for c in cols))
        for r in cur.fetchall():
            for c in cols:
                if r[c]:
                    out.add(r[c])
    return out


def collect_mob_uses(cur):
    """creature spells with every detail of the server's events (format: wow_mob_spells.py)"""
    from wow_mob_spells import mob_uses

    def rows(table):
        if not table_exists(cur, table):
            return []
        cur.execute("SELECT * FROM `%s`" % table)
        return [{k.lower(): v for k, v in r.items()} for r in cur.fetchall()]
    return mob_uses(rows("creature_template"), rows("creature_spell_list"), rows("creature_template_spells"), rows("creature_ai_scripts"))


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    sd = SpellData(cur)
    b = Builder(cur, sd)

    want = {}           # spell id -> {"cls": set, "src": set}

    def add(sid, src, cls=()):
        if not sid:
            return
        w = want.setdefault(sid, {"cls": set(), "src": set()})
        w["src"].add(src)
        w["cls"].update(cls)

    for sid, (cls, src) in collect_player_ids(cur, sd).items():
        for s_ in src.split("+"):
            add(sid, s_, cls)
    log("Player/class/racial/talent spells: %d" % len(want))
    for sid in collect_item_spells(cur):
        add(sid, "item")
    try:                                    # spells behind enchantments / random property suffixes
        import wow_items_json as ij
        for _, (_, eff) in ij.load_enchants().items():
            for t, a, arg in eff:
                if t in (1, 3) and arg:
                    add(arg, "enchant")
    except Exception as exc:
        log("  (enchant spells skipped: %s)" % str(exc)[:60])
    uses = collect_mob_uses(cur)
    for e, lst in uses.items():
        for u in lst:
            add(u[0], "mob")
    log("After items and mobs: %d spells (mob users: %d)" % (len(want), len(uses)))

    spells = {}
    pending = set(want)
    depth = 0
    while pending and depth < 4:
        rows = fetch_all(cur, sd, pending)
        pending = set()
        for r in rows:
            sid = g(r, sd.sc, "id")
            _, sp = b.build(r)
            sp["_id"] = sid
            # recompute coefficient now that _id is set (bonus data lookup)
            sp["s"] = b.summary(sp, sp.get("ef", []), sp.get("dur", 0) if sp.get("dur", 0) > 0 else 0,
                                sp.get("cast", 0), "channeled" in sp.get("fl", []))
            spells[sid] = sp
            for ef in sp.get("ef", []):
                tr = ef.get("tr")
                if tr and tr not in spells and tr not in want:
                    add(tr, "trigger")
                    pending.add(tr)
        depth += 1
    for sid, sp in spells.items():
        sp.pop("_id", None)
        w = want.get(sid)
        if w:
            if w["cls"]:
                sp["cls"] = sorted(w["cls"])
            sp["src"] = sorted(w["src"])
    # rage costs are stored x10 in the spell table: divide when every rage cost is a multiple of 10
    rage = [sp["pw"][1] for sp in spells.values() if sp.get("pw") and sp["pw"][0] == 1 and sp["pw"][1]]
    if rage and all(x % 10 == 0 for x in rage):
        for sp in spells.values():
            if sp.get("pw") and sp["pw"][0] == 1:
                sp["pw"][1] = sp["pw"][1] // 10
        log("  rage costs divided by 10")
    log("Spells exported: %d" % len(spells))

    # coefficients recomputed per effect for convenience: effect-level 'coef' on the first matching effect
    for sp in spells.values():
        s = sp.get("s", {})
        for ef in sp.get("ef", []):
            if ef["t"] in DAMAGE_EFFECTS | HEAL_EFFECTS and "cd_direct" in s:
                ef["coef"] = s["cd_direct"]
            elif ef.get("au") in DOT_AURAS | HOT_AURAS and "cd_dot" in s:
                ef["coef"] = s["cd_dot"]

    mob_use = {str(e): lst for e, lst in uses.items() if any(u[0] in spells for u in lst)}
    meta = {"effects": {str(k): v for k, v in EFFECTS.items()}, "auras": {str(k): v for k, v in AURAS.items()},
            "schools": {str(k): v for k, v in SCHOOL.items()}, "spellmods": {str(k): v for k, v in SPELL_MODS.items()},
            "power": {str(k): v for k, v in POWER.items()},
            "notes": "pw rage cost is already /10. lo/hi are at the spell's own level; add ppl per caster level "
                     "above bl (cap ml). Coefficients cd_direct/cd_dot: classic formula, replaced by spell_bonus_data "
                     "rows when the server table has them."}
    save_json("spells", {"meta": meta, "spells": {str(k): v for k, v in spells.items()}, "mob_use": mob_use})
    save_text("spellmath.js", SPELLMATH_JS)

    book = BigBook(OUTPUT)
    ws = book.sheet("Spells", ["Id", "Name", "Rank", "School", "Level", "Cast ms", "Cooldown ms", "GCD ms", "Range",
                               "Duration ms", "Power", "Cost", "Kind", "Direct min", "Direct max", "Tick min",
                               "Tick max", "Ticks", "Period ms", "Coef direct", "Coef dot", "AoE", "Classes",
                               "Sources", "Flags"],
                    [8, 28, 9, 9, 6, 8, 10, 7, 9, 10, 8, 8, 14, 9, 9, 8, 8, 6, 8, 9, 9, 5, 12, 14, 30])
    for sid in sorted(spells):
        sp = spells[sid]
        s = sp.get("s", {})
        dr = s.get("direct") or ["", ""]
        dt = s.get("dot")
        pw = sp.get("pw", [0, 0, 0, 0])
        ws.append([sid, sp["n"], sp["r"], SCHOOL.get(sp["sc"], ""), sp["lv"], sp.get("cast", 0), sp.get("cd", 0),
                   sp.get("gcd", 0), "%s-%s" % tuple(sp["rng"]) if "rng" in sp else "", sp.get("dur", ""),
                   POWER.get(pw[0], pw[0]), pw[1] or ("%d%%" % pw[2] if pw[2] else ""), s.get("kind", ""),
                   dr[0], dr[1], dt["tick"][0] if dt else "", dt["tick"][1] if dt else "",
                   dt["ticks"] if dt else "", dt["period"] if dt else "", s.get("cd_direct", ""),
                   s.get("cd_dot", ""), "yes" if s.get("aoe") else "",
                   ",".join(str(x) for x in sp.get("cls", [])), ",".join(sp.get("src", [])),
                   ",".join(sp.get("fl", []))])
    ws = book.sheet("Effects", ["Spell", "Name", "#", "Effect", "Aura", "Min", "Max", "Per level", "Period ms",
                                "Ticks", "Radius", "Chain", "Misc", "Trigger", "Target kind", "Coef"],
                    [8, 28, 3, 22, 24, 7, 7, 8, 9, 6, 7, 6, 8, 8, 12, 8])
    for sid in sorted(spells):
        sp = spells[sid]
        for i, ef in enumerate(sp.get("ef", []), start=1):
            ws.append([sid, sp["n"], i, EFFECTS.get(ef["t"], ef["t"]), AURAS.get(ef.get("au", 0), ef.get("au", "")),
                       ef["lo"], ef["hi"], ef.get("ppl", ""), ef.get("amp", ""), ef.get("tk", ""), ef.get("ra", ""),
                       ef.get("ch", ""), ef.get("mi", ""), ef.get("tr", ""), ef["k"], ef.get("coef", "")])
    book.save()
    conn.close()
    log("Done.")


SPELLMATH_JS = r"""// spellmath.js - helpers for spells.json
// const SM = makeSpellMath(data);   data = parsed spells.json
// SM.value(spell, effectIndex, casterLevel)      -> [lo, hi]   (value range at that caster level)
// SM.direct(spell, ctx, rng)                     -> rolled direct damage/heal (ctx: {level, power})
// SM.tick(spell, ctx, rng)                       -> rolled damage/heal of ONE periodic tick
// SM.cost(spell, baseMana)                       -> resource cost
// SM.castTime(spell, hasteMods)                  -> ms (spell mods can be applied by the caller)
function makeSpellMath(data) {
  const S = data.spells;
  function value(sp, i, level) {
    const e = sp.ef[i]; let lo = e.lo, hi = e.hi;
    if (e.ppl && level > (sp.bl || 0)) {
      const lv = sp.ml ? Math.min(level, sp.ml) : level;
      const add = Math.trunc((lv - (sp.bl || 0)) * e.ppl);
      lo += add; hi += add;
    }
    return [lo, hi];
  }
  function roll(range, rng) {
    const r = rng ? rng() : Math.random();
    return Math.floor(range[0] + r * (range[1] - range[0] + 1));
  }
  function direct(sp, ctx, rng) {
    const s = sp.s; if (!s || !s.direct) return 0;
    let idx = sp.ef.findIndex(e => e.t === 2 || e.t === 10 || e.t === 67 || e.t === 9 || e.t === 7);
    const rg = idx >= 0 ? value(sp, idx, ctx.level) : s.direct;
    let v = roll(rg, rng);
    if (s.cd_direct && ctx.power) v += Math.floor(ctx.power * s.cd_direct);
    return v;
  }
  function tick(sp, ctx, rng) {
    const s = sp.s; if (!s || !s.dot) return 0;
    const idx = sp.ef.findIndex(e => e.au === 3 || e.au === 8 || e.au === 89);
    const rg = idx >= 0 ? value(sp, idx, ctx.level) : s.dot.tick;
    let v = roll(rg, rng);
    if (s.cd_dot && ctx.power) v += Math.floor(ctx.power * s.cd_dot / Math.max(1, s.dot.ticks));
    return v;
  }
  function cost(sp, baseMana) {
    if (!sp.pw) return 0;
    return Math.floor(sp.pw[1] + (sp.pw[2] ? baseMana * sp.pw[2] / 100 : 0));
  }
  function castTime(sp, haste) { return Math.max(0, (sp.cast || 0) * (haste || 1)); }
  function modValue(sp, e) { return e; }
  return { value, direct, tick, cost, castTime, spells: S };
}
"""

if __name__ == "__main__":
    run(main)
