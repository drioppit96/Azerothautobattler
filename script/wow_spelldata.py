# -*- coding: utf-8 -*-
"""
Spell helpers used by wow_spells.py and wow_classes.py (same folder, nothing to run).
"""
import re
import struct

from wow_common import *   # noqa

SCHOOL = {0: "Physical", 1: "Holy", 2: "Fire", 3: "Nature", 4: "Frost",
          5: "Shadow", 6: "Arcane"}
POWER = {0: "Mana", 1: "Rage", 2: "Focus", 3: "Energy", 4: "Happiness", -2: "Health"}
DMG_CLASS = {0: "", 1: "Magic", 2: "Melee", 3: "Ranged"}
EFFECTS = {
    1: "Instakill", 2: "School Damage", 3: "Dummy", 5: "Teleport", 6: "Apply Aura",
    7: "Environmental Damage", 8: "Power Drain", 9: "Health Leech", 10: "Heal",
    11: "Bind", 12: "Portal", 16: "Quest Complete", 17: "Weapon Damage (no school)",
    18: "Resurrect", 19: "Extra Attacks", 24: "Create Item", 27: "Persistent Area Aura",
    28: "Summon", 29: "Leap", 30: "Energize", 31: "Weapon % Damage", 33: "Open Lock",
    35: "Apply Area Aura (Party)", 36: "Learn Spell", 38: "Dispel", 40: "Dual Wield",
    41: "Summon Wild", 42: "Summon Guardian", 44: "Skill Step", 47: "Trade Skill",
    48: "Stealth", 50: "Summon Object", 53: "Enchant Item (permanent)",
    54: "Enchant Item (temporary)", 55: "Tame Creature", 56: "Summon Pet",
    58: "Weapon Damage", 59: "Create Random Item", 60: "Proficiency", 61: "Send Event",
    62: "Power Burn", 63: "Threat", 64: "Trigger Spell", 65: "Health Funnel",
    66: "Power Funnel", 67: "Heal Max Health", 68: "Interrupt Cast", 69: "Distract",
    70: "Pull", 71: "Pickpocket", 77: "Script Effect", 78: "Attack", 79: "Sanctuary",
    80: "Add Combo Points", 94: "Self Resurrect", 95: "Skinning", 96: "Charge",
    98: "Knock Back", 99: "Disenchant", 101: "Feed Pet", 102: "Dismiss Pet",
    103: "Reputation", 119: "Apply Area Aura (Pet)",
}
AURAS = {
    3: "Periodic Damage", 4: "Dummy", 5: "Confuse", 6: "Charm", 7: "Fear",
    8: "Periodic Heal", 9: "Mod Attack Speed", 10: "Mod Threat", 11: "Taunt", 12: "Stun",
    13: "Mod Damage Done", 14: "Mod Damage Taken", 15: "Damage Shield", 16: "Stealth",
    18: "Invisibility", 21: "Mana Regen", 22: "Mod Resistance", 23: "Periodic Trigger Spell",
    24: "Periodic Energize", 25: "Pacify", 26: "Root", 27: "Silence", 28: "Reflect Spells",
    29: "Mod Stat", 30: "Mod Skill", 31: "Increase Speed", 33: "Decrease Speed",
    34: "Increase Health", 35: "Increase Energy", 36: "Shapeshift", 37: "Effect Immunity",
    38: "State Immunity", 39: "School Immunity", 40: "Damage Immunity", 41: "Dispel Immunity",
    42: "Proc Trigger Spell", 43: "Proc Trigger Damage", 44: "Track Creatures",
    45: "Track Resources", 47: "Mod Parry %", 49: "Mod Dodge %", 51: "Mod Block %",
    52: "Mod Crit %", 53: "Periodic Leech", 54: "Mod Hit %", 55: "Mod Spell Hit %",
    56: "Transform", 57: "Mod Spell Crit %", 61: "Mod Scale", 64: "Periodic Mana Leech",
    65: "Mod Casting Speed", 66: "Feign Death", 67: "Disarm", 69: "School Absorb",
    72: "Mod Power Cost", 77: "Mechanic Immunity", 78: "Mounted", 79: "Mod Damage Done %",
    80: "Mod Stat %", 85: "Mod Power Regen", 86: "Channel Death Item", 87: "Mod Damage Taken %",
    89: "Periodic Damage %", 99: "Mod Attack Power", 101: "Mod Armor %",
    106: "Levitate / Water Walk", 107: "Add Flat Modifier", 108: "Add % Modifier",
    115: "Mod Healing Taken", 116: "Mod Regen During Combat", 117: "Mechanic Resistance",
    118: "Mod Healing %", 124: "Mod Ranged Attack Power", 135: "Mod Healing Done",
    136: "Mod Healing Done %", 137: "Mod Total Stat %", 138: "Mod Melee Haste",
}
MECHANIC = {1: "Charm", 2: "Disorient", 3: "Disarm", 4: "Distract", 5: "Fear",
            7: "Root", 8: "Pacify", 9: "Silence", 10: "Sleep", 11: "Snare", 12: "Stun",
            13: "Freeze", 14: "Knockout", 15: "Bleed", 16: "Bandage", 17: "Polymorph",
            18: "Banish", 19: "Shield", 20: "Shackle", 21: "Mount", 22: "Persuade",
            23: "Turn", 24: "Horror", 25: "Invulnerability", 26: "Interrupt", 27: "Daze",
            28: "Discovery", 29: "Immune Shield", 30: "Sap", 31: "Enrage"}
SKILL_CATEGORY = {5: "Attributes", 6: "Weapon", 7: "Class", 8: "Armor", 9: "Secondary",
                  10: "Language", 11: "Profession", 12: "Generic"}
SPELL_COLUMNS = (
    ["Id", "School", "Category", "Dispel", "Mechanic", "CastingTimeIndex", "RecoveryTime",
     "CategoryRecoveryTime", "DurationIndex", "PowerType", "ManaCost", "ManaCostPerlevel",
     "ManaPerSecond", "RangeIndex", "SpellIconID", "SpellName", "Rank1", "ManaCostPercentage",
     "SpellLevel", "BaseLevel", "MaxLevel", "ProcChance", "ProcCharges", "StackAmount",
     "DmgClass", "SpellFamilyName", "EquippedItemClass", "Attributes", "Speed", "Totem1",
     "Totem2", "RequiresSpellFocus", "MaxTargetLevel", "MaxAffectedTargets"]
    + ["%s%d" % (p, i) for p in ("Effect", "EffectDieSides", "EffectBaseDice", "EffectBasePoints",
                                 "EffectApplyAuraName", "EffectAmplitude", "EffectMiscValue",
                                 "EffectTriggerSpell", "EffectItemType", "EffectChainTarget",
                                 "EffectMechanic", "EffectRadiusIndex", "EffectRealPointsPerLevel")
       for i in (1, 2, 3)]
    + ["Reagent%d" % i for i in range(1, 9)] + ["ReagentCount%d" % i for i in range(1, 9)])


def _fmt_secs(ms):
    if not ms:
        return ""
    s = ms / 1000.0
    return ("%g" % round(s, 2))


class SpellData(object):
    def __init__(self, cur):
        self.sc = columns(cur, "spell_template")
        self.cast = {}
        self.range = {}
        self.dur = {}
        self.desc = {}
        self.skill_names = {}
        self.skill_cat = {}
        self.sla = {}          # spell -> list of (skillline, classmask, racemask, min rank)
        self._load_dbcs()

    def _load_dbcs(self):
        d = load_dbc("SpellCastTimes")
        if d:
            self.cast = {r[0]: r[1] for r in d.rows}
        d = load_dbc("SpellRange")
        if d:
            for r in d.rows:
                lo = struct.unpack("<f", struct.pack("<I", r[1]))[0]
                hi = struct.unpack("<f", struct.pack("<I", r[2]))[0]
                self.range[r[0]] = (lo, hi)
        d = load_dbc("SpellDuration")
        if d:
            self.dur = {r[0]: r[1] for r in d.rows}
        sk = load_dbc("SkillLine")
        if sk:
            idx = sk.find_field(171, "Alchemy")
            if idx is not None:
                for r in sk.rows:
                    self.skill_names[r[0]] = sk.s(r[idx])
                    self.skill_cat[r[0]] = r[1]
        sla = load_dbc("SkillLineAbility")
        if sla:
            for r in sla.rows:
                self.sla.setdefault(r[2], []).append((r[1], r[4], r[3], r[7]))
        sp = load_dbc("Spell")
        if sp:
            ni = sp.find_field(829, "Thickskull")
            if ni is None:
                ni = sp.find_field(133, "Fireball")
            if ni is not None and ni + 18 < sp.fc:
                for r in sp.rows:
                    t = sp.s(r[ni + 18])
                    if t:
                        self.desc[r[0]] = t
                log("Spell descriptions loaded: %d" % len(self.desc))
            else:
                log("  (could not locate description field in Spell.dbc)")

    # ---------------------------------------------------------------- query
    def select_columns(self):
        cols = [self.sc[c.lower()] for c in SPELL_COLUMNS if c.lower() in self.sc]
        return ", ".join("`%s`" % c for c in cols)

    def fetch(self, cur, ids=None):
        sel = self.select_columns()
        if ids is None:
            cur.execute("SELECT %s FROM spell_template" % sel)
            return cur.fetchall()
        out = []
        for part in chunks(sorted(ids)):
            cur.execute("SELECT %s FROM spell_template WHERE `%s` IN (%s)"
                        % (sel, self.sc["id"], ph(len(part))), part)
            out.extend(cur.fetchall())
        return out

    # -------------------------------------------------------------- compute
    def effect_range(self, r, e):
        base = g(r, self.sc, "effectbasepoints%d" % e)
        die = g(r, self.sc, "effectdiesides%d" % e)
        if die <= 0:
            return base, base
        if die == 1:
            return base + 1, base + 1
        return base + 1, base + die

    def duration_ms(self, r):
        return self.dur.get(g(r, self.sc, "durationindex"), 0) or 0

    def cast_ms(self, r):
        return self.cast.get(g(r, self.sc, "castingtimeindex"), 0) or 0

    def effects_text(self, r, names=None):
        """(damage/healing summary, detailed effects text)"""
        parts, summary = [], []
        dur = self.duration_ms(r)
        for e in (1, 2, 3):
            eff = g(r, self.sc, "effect%d" % e)
            if not eff:
                continue
            lo, hi = self.effect_range(r, e)
            val = "%d" % lo if lo == hi else "%d-%d" % (lo, hi)
            ename = EFFECTS.get(eff, "Effect %d" % eff)
            aura = g(r, self.sc, "effectapplyauraname%d" % e)
            amp = g(r, self.sc, "effectamplitude%d" % e)
            txt = ename
            if eff == 6 or eff in (27, 35, 119):
                an = AURAS.get(aura, "Aura %d" % aura) if aura else "Aura"
                txt = "Aura: %s" % an
                if aura in (3, 8, 24, 53, 64, 89):
                    txt += " %s" % val
                    if amp:
                        txt += " every %ss" % _fmt_secs(amp)
                        if dur:
                            summary.append("%s %s x%d ticks" % (an, val, max(1, dur // amp)))
                        else:
                            summary.append("%s %s" % (an, val))
                    else:
                        summary.append("%s %s" % (an, val))
                elif aura in (22, 29, 99, 101, 13, 14, 79, 87, 80, 118, 135, 136, 137):
                    txt += " %s" % val
                    misc = g(r, self.sc, "effectmiscvalue%d" % e)
                    if aura in (22, 13, 14, 79, 87) and misc:
                        txt += " (school mask %d)" % misc
                elif aura in (31, 33, 9, 65, 52, 47, 49, 51, 54, 55, 57):
                    txt += " %s%%" % val
                elif val != "0":
                    txt += " %s" % val
            elif eff in (2, 10, 9, 8, 30, 31, 58, 17, 67):
                txt += " %s" % val
                summary.append("%s %s" % (ename, val))
            elif eff == 24:
                it = g(r, self.sc, "effectitemtype%d" % e)
                txt += " (item %d)" % it if it else ""
            elif eff in (64, 36):
                tr = g(r, self.sc, "effecttriggerspell%d" % e)
                txt += " (spell %d)" % tr if tr else ""
            elif val not in ("0", "-1"):
                txt += " %s" % val
            parts.append(txt)
        return "; ".join(summary), "; ".join(parts)

    def power_text(self, r):
        pt = g(r, self.sc, "powertype")
        pname = POWER.get(pt, "Power %d" % pt)
        cost = g(r, self.sc, "manacost")
        pct = g(r, self.sc, "manacostpercentage")
        out = []
        if cost:
            out.append("%d %s" % (cost, pname))
        if pct:
            out.append("%d%% of base %s" % (pct, pname.lower()))
        ps = g(r, self.sc, "manapersecond")
        if ps:
            out.append("%d %s per sec" % (ps, pname.lower()))
        return ", ".join(out)

    def reagents_text(self, r, item_names=None):
        out = []
        for n in range(1, 9):
            rid = g(r, self.sc, "reagent%d" % n)
            if rid > 0:
                cnt = g(r, self.sc, "reagentcount%d" % n) or 1
                nm = item_names.get(rid, "item %d" % rid) if item_names else "item %d" % rid
                out.append("%dx %s" % (cnt, nm))
        return ", ".join(out)

    def range_text(self, r):
        rg = self.range.get(g(r, self.sc, "rangeindex"))
        if not rg:
            return ""
        lo, hi = rg
        if hi <= 0:
            return ""
        return ("%g-%g" % (round(lo, 1), round(hi, 1))) if lo else ("%g" % round(hi, 1))

    def duration_text(self, r):
        ms = self.duration_ms(r)
        if ms <= 0 or ms >= 2 ** 31:
            return ""
        return _fmt_secs(ms)

    def class_names(self, spell_id):
        names = set()
        for _, cm, _, _ in self.sla.get(spell_id, []):
            if cm:
                names.update(mask_names(cm, CLASSES))
        return ", ".join(sorted(names))

    def skill_info(self, spell_id):
        lst = self.sla.get(spell_id, [])
        if not lst:
            return "", ""
        sl = lst[0][0]
        return self.skill_names.get(sl, "skill %d" % sl), SKILL_CATEGORY.get(self.skill_cat.get(sl), "")

    def race_names(self, spell_id):
        for _, _, rm, _ in self.sla.get(spell_id, []):
            if rm:
                return ", ".join(mask_names(rm, RACES))
        return ""

    def description(self, r):
        sid = g(r, self.sc, "id")
        t = self.desc.get(sid, "")
        if not t:
            return ""

        def val(e, which):
            lo, hi = self.effect_range(r, e)
            lo, hi = abs(lo), abs(hi)
            if which == "m":
                return str(lo)
            if which == "M":
                return str(hi)
            return str(lo) if lo == hi else "%d to %d" % (lo, hi)

        def sub(m):
            tok, num = m.group(1), m.group(2)
            e = int(num) if num else 1
            if tok in ("s", "S", "m", "M"):
                return val(e, "s" if tok in "sS" else tok)
            if tok == "o":
                lo, _ = self.effect_range(r, e)
                amp = g(r, self.sc, "effectamplitude%d" % e)
                dur = self.duration_ms(r)
                if amp and dur:
                    return str(abs(lo) * (dur // amp))
                return str(abs(lo))
            if tok == "t":
                amp = g(r, self.sc, "effectamplitude%d" % e)
                return _fmt_secs(amp) or "?"
            if tok == "d":
                ms = self.duration_ms(r)
                if ms <= 0 or ms >= 2 ** 31:
                    return "until cancelled"
                s = ms / 1000.0
                if s >= 3600:
                    return "%g hour%s" % (round(s / 3600.0, 1), "" if s == 3600 else "s")
                if s >= 60:
                    return "%g min" % round(s / 60.0, 1)
                return "%g sec" % round(s, 1)
            if tok == "h":
                return str(g(r, self.sc, "procchance"))
            if tok == "n":
                return str(g(r, self.sc, "procscharges") or g(r, self.sc, "proccharges"))
            if tok == "x":
                return str(g(r, self.sc, "effectchaintarget%d" % e))
            return "?"

        t = re.sub(r"\$\{[^}]*\}", "?", t)
        t = re.sub(r"\$[gG]([^:;]*):([^;]*);", r"\1/\2", t)
        t = re.sub(r"\$[lL]([^:;]*):([^;]*);", r"\2", t)
        t = re.sub(r"\$(\d+)[a-zA-Z]\d?", "?", t)
        t = re.sub(r"\$([sSmMotdhnx])(\d?)", sub, t)
        t = t.replace("$b", " ").replace("$B", " ")
        return re.sub(r"\s+", " ", t).strip()

    def row(self, r):
        """dict of display values for one spell row"""
        sid = g(r, self.sc, "id")
        dmg, eff = self.effects_text(r)
        skill, cat = self.skill_info(sid)
        rank = g(r, self.sc, "rank1", "") or ""
        cd = max(g(r, self.sc, "recoverytime"), g(r, self.sc, "categoryrecoverytime"))
        return {
            "id": sid,
            "name": g(r, self.sc, "spellname", "") or "",
            "rank": rank,
            "class": self.class_names(sid),
            "race": self.race_names(sid),
            "skill": skill, "category": cat,
            "school": SCHOOL.get(g(r, self.sc, "school"), ""),
            "level": g(r, self.sc, "spelllevel") or g(r, self.sc, "baselevel") or "",
            "cost": self.power_text(r),
            "cast": _fmt_secs(self.cast_ms(r)) if self.cast_ms(r) else "Instant",
            "cooldown": _fmt_secs(cd),
            "range": self.range_text(r),
            "duration": self.duration_text(r),
            "damage": dmg,
            "effects": eff,
            "type": DMG_CLASS.get(g(r, self.sc, "dmgclass"), ""),
            "mechanic": MECHANIC.get(g(r, self.sc, "mechanic"), ""),
            "proc": g(r, self.sc, "procchance") or "",
            "icon_id": g(r, self.sc, "spelliconid"),
            "desc": self.description(r),
        }


SPELL_COLS = [
    ("ID", 8, "id"), ("Name", 30, "name"), ("Rank", 10, "rank"), ("Class", 14, "class"),
    ("Race", 14, "race"), ("Skill Line", 18, "skill"), ("Category", 11, "category"),
    ("School", 10, "school"), ("Level", 6, "level"), ("Cost", 22, "cost"),
    ("Cast Time (s)", 10, "cast"), ("Cooldown (s)", 10, "cooldown"), ("Range (yd)", 9, "range"),
    ("Duration (s)", 10, "duration"), ("Damage / Healing", 36, "damage"),
    ("Effects", 56, "effects"), ("Attack Type", 9, "type"), ("Mechanic", 10, "mechanic"),
    ("Proc %", 7, "proc"), ("Description", 70, "desc"),
]
