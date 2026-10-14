# Next session

Points saved from the 14 October 2026 session, in the order asked:

1. **Spells for every creature**: inside and outside dungeons and raids. `gamedata/mob_spells.json` already holds the creature spell data; check how much of it is used.
2. **Hiding experience**: asked for earlier, not started.
3. **Raid simulation**: asked for earlier, not started.

Done already: mercenaries spending mana like players (`game/mercs.js`); loot tables as the server rolls them (groups, references): `script/wow_loot_groups.py`, `lootDrops` in `game/combat.js`.

Possible follow-up for the loot: some raid bosses have no loot entry at all (Ragnaros, 11502), because `wow_loot_all.py` keeps only creatures that spawn in the world. Look at this together with the raid simulation.
