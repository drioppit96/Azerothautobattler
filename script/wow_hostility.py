# -*- coding: utf-8 -*-
"""
Hostility: which creatures attack, ignore or are friendly to each playable race.

Writes  C:\\wow excel\\wow_hostility.xlsx
        C:\\wow excel\\gamedata\\hostility.json

The rules are the ones the server uses (FactionTemplate.dbc):
  for creature template C and player template P
    P.faction in C.enemies          -> hostile
    P.faction in C.friends          -> friendly
    C.hostileMask & P.ourMask       -> hostile
    C.friendMask  & P.ourMask       -> friendly
    otherwise                       -> neutral (only fights back when attacked)

Reaction codes used in the JSON:   H hostile   N neutral   F friendly
Per creature a "behaviour" string with one letter per race (order = races list):
    A aggressive (attacks on sight)     N neutral (fights back)
    F friendly (cannot be attacked)     X not attackable / passive (quest NPCs, critters flagged so)

hostility.json
  races        [{id, name, mask, template, side}]      template = player faction template
  templates    {id: [factionId, name, ourMask, friendMask, hostileMask, [enemies], [friends],
                     flags, "HHNF..." reactions for the races]}
  creatures    {entry: [templateId, "AANF...", aggroBase, leash, callForHelp, civilian(0/1),
                        rank, minLevel, maxLevel, npcFlags]}
  aggro        formula notes + sample values
Use  reaction(a, b)  from hostility.js to compare ANY two templates (mob vs mob).

Run:  py wow_hostility.py
Needs wow_common.py, wow_util.py (same folder) and DBCs FactionTemplate, Faction, ChrRaces
(extract_dbc_multi.py; ChrRaces is optional - the standard values are used otherwise).
"""
import os
from collections import defaultdict

from wow_util import *   # noqa

OUTPUT = os.path.join(OUT_FOLDER, "wow_hostility.xlsx")

# playable races: id, name, faction template id (used when ChrRaces.dbc is missing)
PLAYER_RACES = [(1, "Human", 1), (2, "Orc", 2), (3, "Dwarf", 3), (4, "Night Elf", 4),
                (5, "Undead", 5), (6, "Tauren", 6), (7, "Gnome", 115), (8, "Troll", 116)]
ALLIANCE_RACES = (1, 3, 4, 7)

UF_NON_ATTACKABLE = 0x2
UF_NOT_ATTACKABLE_1 = 0x80
UF_OOC_NOT_ATTACKABLE = 0x100
UF_PASSIVE = 0x200
EXTRA_CIVILIAN = 0x2
FLAG_NPC = {1: "Gossip", 2: "Quest giver", 4: "Vendor", 8: "Flight master", 16: "Trainer",
            32: "Spirit healer", 64: "Spirit guide", 128: "Innkeeper", 256: "Banker",
            512: "Petitions", 1024: "Tabard", 2048: "Battlemaster", 4096: "Auctioneer",
            8192: "Stable master", 16384: "Repair"}


class Templates(object):
    def __init__(self):
        d = load_dbc("FactionTemplate")
        if not d:
            raise RuntimeError("FactionTemplate.dbc missing - run extract_dbc_multi.py")
        self.t = {}
        for r in d.rows:
            self.t[r[0]] = dict(id=r[0], faction=r[1], flags=r[2], our=r[3], friend=r[4], hostile=r[5],
                                enemies=[x for x in r[6:10] if x], friends=[x for x in r[10:14] if x])
        fn = load_faction_names()
        self.fname = fn

    def reaction(self, a, b):
        """reaction of template a TOWARDS template b: H / N / F"""
        A, B = self.t.get(a), self.t.get(b)
        if not A or not B:
            return "N"
        if a == b:
            return "F"
        if B["faction"]:
            if B["faction"] in A["enemies"]:
                return "H"
            if B["faction"] in A["friends"]:
                return "F"
        if A["hostile"] & B["our"]:
            return "H"
        if A["friend"] & B["our"]:
            return "F"
        return "N"


def player_races():
    out = []
    d = load_dbc("ChrRaces")
    names = {}
    facs = {}
    if d:
        idx = d.find_field(1, "Human")
        if idx is not None:
            for r in d.rows:
                names[r[0]] = d.s(r[idx])
                facs[r[0]] = r[2]
    for rid, nm, fac in PLAYER_RACES:
        out.append((rid, names.get(rid) or nm, facs.get(rid) or fac))
    return out


def behaviour(react, uflags, civilian, rank, family, ctype):
    """one letter for one race"""
    if uflags & (UF_NON_ATTACKABLE | UF_NOT_ATTACKABLE_1):
        return "X"
    if react == "F":
        return "F"
    if react == "H":
        if civilian or (uflags & UF_PASSIVE):
            return "N"
        return "A"
    return "N"


def aggro_radius(mob_level, player_level, base=20.0):
    """server formula (Creature::GetAttackDistance): 1 yard less per level you are above the mob"""
    diff = max(-25, min(25, player_level - mob_level))
    return max(5.0, base - diff)


def main():
    tpl = Templates()
    races = player_races()
    log("Races: " + ", ".join("%s(template %d)" % (n, f) for _, n, f in races))
    conn = connect()
    cur = conn.cursor()
    tc = columns(cur, "creature_template")
    cur.execute("SELECT * FROM creature_template")
    rows = cur.fetchall()
    log("Creature templates: %d" % len(rows))

    used = set()
    crea = {}
    for r in rows:
        e = g(r, tc, "entry")
        fac = g(r, tc, "faction") or g(r, tc, "factiontemplate") or g(r, tc, "faction_a")
        used.add(fac)
        uf = g(r, tc, "unitflags")
        ex = g(r, tc, "extraflags")
        civ = g(r, tc, "civilian", None)
        civ = 1 if (civ if civ is not None else (ex & EXTRA_CIVILIAN)) else 0
        beh = ""
        for rid, _, pf in races:
            beh += behaviour(tpl.reaction(fac, pf), uf, civ, g(r, tc, "rank"), g(r, tc, "family"),
                             g(r, tc, "creaturetype"))
        det = g(r, tc, "detection", 0) or 20
        crea[e] = [fac, beh, det, g(r, tc, "leash", 0), g(r, tc, "callforhelp", 0), civ,
                   g(r, tc, "rank"), g(r, tc, "minlevel"), g(r, tc, "maxlevel"), g(r, tc, "npcflags"),
                   g(r, tc, "name", "")]
    templates = {}
    for fid in sorted(used):
        t = tpl.t.get(fid)
        if not t:
            continue
        react = "".join(tpl.reaction(fid, pf) for _, _, pf in races)
        templates[fid] = [t["faction"], tpl.fname.get(t["faction"], ""), t["our"], t["friend"], t["hostile"],
                          t["enemies"], t["friends"], t["flags"], react]
    log("Faction templates in use: %d" % len(templates))

    # summary: how many creatures per behaviour for Human / Orc
    cnt = defaultdict(int)
    for e, c in crea.items():
        cnt[(c[1][0], c[1][1])] += 1
    for k in sorted(cnt):
        log("  Human=%s Orc=%s : %d creatures" % (k[0], k[1], cnt[k]))

    save_json("hostility", {
        "races": [{"id": rid, "name": nm, "template": pf, "side": "Alliance" if rid in ALLIANCE_RACES else "Horde"}
                  for rid, nm, pf in races],
        "templates": {str(k): v for k, v in templates.items()},
        "creatures": {str(e): c[:10] for e, c in crea.items()},
        "aggro": {"formula": "radius = clamp(base - (playerLevel - mobLevel), 5, 45) with the level difference "
                             "limited to +-25; base = creature 'Detection' (20 when 0)",
                  "sample_base20": {str(d): aggro_radius(20, 20 + d) for d in (-10, -5, 0, 5, 10, 20)}}})
    save_text("hostility.js", HOSTILITY_JS)

    # -------------------------------------------------------------- Excel
    book = BigBook(OUTPUT)
    rn = [n for _, n, _ in races]
    ws = book.sheet("Faction Templates", ["Template", "Faction", "Faction name", "Our mask", "Friend mask",
                                          "Hostile mask", "Enemies", "Friends"] + rn,
                    [9, 8, 28, 9, 9, 9, 18, 18] + [10] * 8)
    for fid, t in sorted(templates.items()):
        ws.append([fid, t[0], t[1], t[2], t[3], t[4], ",".join(map(str, t[5])), ",".join(map(str, t[6]))]
                  + [{"H": "Hostile", "N": "Neutral", "F": "Friendly"}[ch] for ch in t[8]])
    ws = book.sheet("Creatures", ["Entry", "Name", "Min Lvl", "Max Lvl", "Rank", "Template"] + rn
                    + ["Aggro base", "Leash", "Call for help", "Civilian", "NPC roles"],
                    [8, 32, 7, 7, 6, 9] + [10] * 8 + [9, 7, 9, 8, 30])
    word = {"A": "Attacks", "N": "Neutral", "F": "Friendly", "X": "Untargetable"}
    for e in sorted(crea):
        c = crea[e]
        roles = ", ".join(n for b, n in sorted(FLAG_NPC.items()) if c[9] & b)
        ws.append([e, c[10], c[7], c[8], c[6], c[0]] + [word[ch] for ch in c[1]]
                  + [c[2], c[3], c[4], "yes" if c[5] else "", roles])
    ws = book.sheet("Aggro Radius", ["Player level - mob level"] + ["Radius (base 20)"], [24, 18])
    for d in range(-25, 26, 5):
        ws.append([d, aggro_radius(30, 30 + d)])
    book.save()
    conn.close()
    log("Done.")


HOSTILITY_JS = r"""// hostility.js - use with hostility.json
// H = hostile, N = neutral, F = friendly
function makeHostility(data) {
  const T = data.templates;
  function reaction(a, b) {            // reaction of template a towards template b
    const A = T[a], B = T[b];
    if (!A || !B) return 'N';
    if (a === b) return 'F';
    if (B[0]) {
      if (A[5].indexOf(B[0]) >= 0) return 'H';
      if (A[6].indexOf(B[0]) >= 0) return 'F';
    }
    if (A[4] & B[2]) return 'H';
    if (A[3] & B[2]) return 'F';
    return 'N';
  }
  function behaviour(entry, raceIndex) {   // raceIndex: 0 = first race in data.races
    const c = data.creatures[entry];
    return c ? c[1][raceIndex] : 'N';      // A / N / F / X
  }
  function aggroRadius(mobLevel, playerLevel, base) {
    const d = Math.max(-25, Math.min(25, playerLevel - mobLevel));
    return Math.max(5, (base || 20) - d);
  }
  return { reaction, behaviour, aggroRadius };
}
"""

if __name__ == "__main__":
    run(main)
