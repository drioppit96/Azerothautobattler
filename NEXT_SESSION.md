# Next session

Points saved from the 14 October 2026 session, in the order asked:

1. **Creature spells in raids**: creatures outside raids use their spells now (`game/mobspells.js`, data from `script/wow_mob_spells.py`); raids were left out on purpose - switch them on (`msRaid`) together with the raid simulation.
2. **Hiding experience**: asked for earlier, not started.
3. **Raid simulation**: asked for earlier, not started.

Done already: mercenaries spending mana like players (`game/mercs.js`); loot tables as the server rolls them (groups, references): `script/wow_loot_groups.py`, `lootDrops` in `game/combat.js`.

Possible follow-up for the loot: some raid bosses have no loot entry at all (Ragnaros, 11502), because `wow_loot_all.py` keeps only creatures that spawn in the world. Look at this together with the raid simulation.

Possible follow-ups for the pets (`game/pets.js`, data from `script/wow_pets.py`): a stable (more than one hunter pet), learning ability ranks by taming a beast that knows them (the database has no list of what each beast teaches, so ranks come with the level now), the warlock's Infernal / Doomguard / Enslave Demon / Eye of Kilrogg.

Possible follow-ups for reputation (`game/reputation.js`, data from `script/wow_reputation.py`) and group quests (`game/groupquest.js`): quests whose objective is a reputation standing (Argent Dawn, Cenarion Circle, Zandalar, Brood of Nozdormu turn-ins) are still marked "needs a reputation standing" and skipped; reputation turn-ins ("Donation of ...", Argent Dawn insignia and scourgestones) are not automated; there is no "at war" checkbox; the battleground factions get nothing yet (no battlegrounds).

## Planned 21 October 2026: character appearance and portraits (not started - waiting for the PC)

The player asked for character creation with appearance choices (skin colour, face, hair style, hair colour,
facial hair / race feature) and a portrait that shows them, like the real game. Agreed plan (option 1):

- **Extraction script (runs on the player's PC, reads the 1.12 client data):** the 16 race/gender character
  models (`Character\<Race>\<Gender>\<Race><Gender>.mdx`), the textures listed in `CharSections.dbc`
  (skin, face lower/upper, facial hair lower/upper, hair + scalp lower/upper, per colour), and the tables
  `CharSections.dbc`, `CharHairGeosets.dbc`, `CharacterFacialHairStyles.dbc`. Reuse `script/wow_m2.py`
  (the creature-portrait reader / software renderer) and `script/extract_dbc_multi.py`. Output into the game
  folder (model JSON + PNG layers), pushed with the upload script.
- **In the game:** a small software renderer (like `wow_m2.render_model`, in JS) draws the head from the model's
  portrait camera: chosen geosets (hair style, facial hair) + skin texture composed from the CharSections layers.
  Rendered when the look changes and saved with the character (works in the browser and the Android app).
- **Character creation:** big portrait, arrow pickers like the original (Skin Colour, Face, Hair Style, Hair
  Colour, the race feature named per race), Randomize. Existing characters: an "Appearance" button on the
  character sheet (free barber); until then a default look.
- **Where it shows:** player frame, party frames, the Android map frames, character switcher. The map keeps the
  class icons.
- **Open questions for the player:** (1) is the client data folder from the creature portraits / maps still
  there; (2) should helmets show on the portrait (hiding the hair) or always the bare head; (3) portrait only,
  or a bigger rotating view in character creation.
