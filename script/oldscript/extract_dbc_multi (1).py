# -*- coding: utf-8 -*-
"""
Step 2: pulls several DBC tables out of the 1.12 client (zones, skills, spells...).
Saves them to  C:\\wow excel\\dbc\\
Run:  py extract_dbc_multi.py      (needs: py -m pip install mpyq)
"""
import os
import traceback

CLIENT_DATA = r"C:\GOG Games\mangos\SoloCraft\SoloCraft 1.12.1\Data"
ARCHIVES = ["patch-2.MPQ", "patch.MPQ", "dbc.MPQ"]   # newest first
OUT_DIR = r"C:\wow excel\dbc"
NAMES = ["AreaTable", "WorldMapArea", "SkillLine", "SkillLineAbility", "Spell",
         "SpellIcon", "ItemDisplayInfo", "Faction", "FactionTemplate", "Map",
         "SpellCastTimes", "SpellRange", "SpellDuration", "AreaTrigger",
         "WorldMapOverlay"]


def main():
    from mpyq import MPQArchive
    os.makedirs(OUT_DIR, exist_ok=True)
    archives = []
    for a in ARCHIVES:
        p = os.path.join(CLIENT_DATA, a)
        if os.path.exists(p):
            archives.append((a, MPQArchive(p, listfile=False)))
    for n in NAMES:
        got = False
        for an, arc in archives:
            try:
                data = arc.read_file("DBFilesClient\\%s.dbc" % n)
            except Exception:
                data = None
            if data and data[:4] == b"WDBC":
                with open(os.path.join(OUT_DIR, n + ".dbc"), "wb") as f:
                    f.write(data)
                print("%-18s from %-12s %8d bytes" % (n, an, len(data)))
                got = True
                break
        if not got:
            print("%-18s NOT FOUND" % n)
    print("\nSaved into: %s" % OUT_DIR)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
    input("\nPress Enter to close this window...")
