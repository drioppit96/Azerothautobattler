# Next session

Points saved from the 14 October 2026 session, in the order asked:

1. **Spells for every creature**: inside and outside dungeons and raids. `gamedata/mob_spells.json` already holds the creature spell data; check how much of it is used.
2. **Mercenaries spend mana carefully**: (`game/mercs.js`)
   - Healers heal only someone who has really lost health (not a full-health tank), and pick the heal by how much is missing.
   - Damage casters pace their mana so long fights can run them dry; they still drink between pulls.
3. **Hiding experience**: asked for earlier, not started.
4. **Raid simulation**: asked for earlier, not started.

Done already: loot tables as the server rolls them (groups, references): `script/wow_loot_groups.py`, `lootDrops` in `game/combat.js`.

Possible follow-up for the loot: some raid bosses have no loot entry at all (Ragnaros, 11502), because `wow_loot_all.py` keeps only creatures that spawn in the world. Look at this together with the raid simulation.
