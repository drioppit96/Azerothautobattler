# Next session

Points saved from the 14 October 2026 session, in the order asked:

1. **Creature spells in raids**: creatures outside raids use their spells now (`game/mobspells.js`, data from `script/wow_mob_spells.py`); raids were left out on purpose - switch them on (`msRaid`) together with the raid simulation.
2. **Hiding experience**: asked for earlier, not started.
3. **Raid simulation**: asked for earlier, not started.

Done already: mercenaries spending mana like players (`game/mercs.js`); loot tables as the server rolls them (groups, references): `script/wow_loot_groups.py`, `lootDrops` in `game/combat.js`.

Possible follow-up for the loot: some raid bosses have no loot entry at all (Ragnaros, 11502), because `wow_loot_all.py` keeps only creatures that spawn in the world. Look at this together with the raid simulation.

Possible follow-ups for the pets (`game/pets.js`, data from `script/wow_pets.py`): a stable (more than one hunter pet), learning ability ranks by taming a beast that knows them (the database has no list of what each beast teaches, so ranks come with the level now), the warlock's Infernal / Doomguard / Enslave Demon / Eye of Kilrogg.
