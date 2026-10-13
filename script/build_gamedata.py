# -*- coding: utf-8 -*-
"""
Runs the new game-data scripts one after another (each one is independent; a failing one is
reported at the end and the rest continue).

   py build_gamedata.py                 everything except the collision grid (fast, ~ a few minutes)
   py build_gamedata.py grid            only the collision grid (slow, 10-25 min)
   py build_gamedata.py all             everything including the grid
   py build_gamedata.py loot items      only the named parts

Parts:  loot  hostility  races  items  taxi  navgraph  spells  grid
Run extract_dbc_multi.py first (new tables were added to it).
"""
import importlib
import sys
import traceback

PARTS = [("loot", "wow_loot_all"), ("hostility", "wow_hostility"), ("races", "wow_races"),
         ("items", "wow_items_json"), ("taxi", "wow_taxi"), ("navgraph", "wow_navgraph"),
         ("spells", "wow_spells_json"), ("cstats", "wow_creature_stats"), ("goquest", "wow_quest_objects"),
         ("grid", "wow_navgrid")]


def main():
    args = [a.lower() for a in sys.argv[1:]]
    if not args:
        want = [p for p, _ in PARTS if p != "grid"]
    elif args == ["all"]:
        want = [p for p, _ in PARTS]
    else:
        want = [a for a in args if a in dict(PARTS)]
    sys.argv = sys.argv[:1]
    failed = []
    for part, mod in PARTS:
        if part not in want:
            continue
        print("\n================ %s ================" % part)
        try:
            m = importlib.import_module(mod)
            m.main()
        except Exception:
            traceback.print_exc()
            failed.append(part)
    print("\nFinished. Failed parts: %s" % (", ".join(failed) if failed else "none"))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
    input("\nPress Enter to close this window...")
