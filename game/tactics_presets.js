'use strict';
/* tactics_presets.js - the preset tactics of every class: Damage (single target and packs in one list), Tank, Healer,
   by talent spec - what the characters play when you have not set them up yourself (tactics.js). The order is the
   priority, like the class guides of the time: staying alive first (healthstone, potions, the big defensive
   cooldowns), then interrupts, crowd control on the extra adds, the group (heals, dispels, taunts), then the damage:
   execute range, cooldowns on elites and bosses, area attacks on packs, keeping debuffs up, the main rotation, fillers.
   Abilities a character has not learned yet are skipped (shown faint in the tactics window). */

function T(c, p, a) { return { c, p, a }; }
/* staying alive: the same for everyone (mana users get the mana potion too) */
function tacSurvive(c, hp) {
  const L = [T('self.hp<', hp || 25, '#stone'), T('self.hp<', (hp || 25) - 5, '#hp')];
  if (usesMana(c)) L.push(T('self.mp<', 8, '#mp'));
  return L;
}
const TAC_CLASS = {
  /* ---------------- Warrior */
  1: {
    dps: (c, spec) => [
      ...tacSurvive(c, 25),
      T('self.any', null, spec === 'fury' ? 'Berserker Stance' : 'Battle Stance'),
      T('self.hp<', 20, 'Intimidating Shout'), T('self.sur>', 3, 'Retaliation'),
      T('enemy.cast', null, 'Pummel'), T('enemy.cast', null, 'Shield Bash'),
      T('enemy.flee', null, 'Hamstring'), T('enemy.flee', null, 'Piercing Howl'),
      T('self.rage<', 15, 'Bloodrage'), T('self.rage<', 10, 'Berserker Rage'),
      T('enemy.hp<', 20, 'Execute'), T('self.any', null, 'Overpower'),
      T('enemy.boss', null, 'Recklessness'), T('enemy.elite', null, 'Death Wish'),
      T('enemy.clus>', 2, 'Sweeping Strikes'), T('enemy.clus>', 3, 'Whirlwind'),
      T('enemy.att>', 3, 'Demoralizing Shout'), T('enemy.att>', 3, 'Thunder Clap'),
      T('enemy.tgt', null, 'Mortal Strike'), T('enemy.tgt', null, 'Bloodthirst'), T('enemy.tgt', null, 'Whirlwind'),
      T('enemy.nodeb', null, 'Rend'), T('enemy.elite', null, 'Sunder Armor'),
      T('self.nobuff', null, 'Battle Shout'),
      T('enemy.clus>', 2, 'Cleave'), T('self.rage>', spec === 'fury' ? 45 : 55, 'Heroic Strike'), T('enemy.far', null, 'Hamstring'),
    ],
    tank: (c) => [
      ...tacSurvive(c, 20),
      T('self.any', null, 'Defensive Stance'),
      T('self.hp<', 20, 'Last Stand'), T('self.hp<', 15, 'Shield Wall'),
      T('enemy.cast', null, 'Shield Bash'), T('enemy.cast', null, 'Pummel'),
      T('enemy.onally', null, 'Taunt'), T('enemy.onally', null, 'Mocking Blow'), T('enemy.att>', 4, 'Challenging Shout'),
      T('self.rage<', 10, 'Bloodrage'),
      T('self.melee', null, 'Shield Block'), T('self.any', null, 'Revenge'), T('enemy.tgt', null, 'Shield Slam'),
      T('enemy.nodebAll', null, 'Demoralizing Shout'), T('enemy.clus>', 2, 'Thunder Clap'),
      T('enemy.stack<', 5, 'Sunder Armor'), T('enemy.hp<', 20, 'Execute'),
      T('self.nobuff', null, 'Battle Shout'), T('enemy.clus>', 2, 'Cleave'), T('self.rage>', 40, 'Heroic Strike'), T('enemy.tgt', null, 'Sunder Armor'),
    ],
  },
  /* ---------------- Paladin */
  2: {
    dps: (c) => [
      ...tacSurvive(c, 20),
      T('self.hp<', 15, 'Divine Shield'), T('self.hp<', 12, 'Lay on Hands'), T('self.hp<', 20, 'Divine Protection'),
      T('self.hp<', 35, 'Flash of Light'), T('self.hp<', 30, 'Holy Light'),
      T('enemy.cast', null, 'Hammer of Justice'), T('self.disp', null, 'Cleanse'), T('self.disp', null, 'Purify'),
      T('enemy.hp<', 20, 'Hammer of Wrath'),
      T('self.nobuff', null, 'Seal of Command'), T('self.nobuff', null, 'Seal of Righteousness'),
      T('enemy.tgt', null, 'Judgement'), T('enemy.clus>', 3, 'Consecration'),
      T('enemy.tgt', null, 'Holy Shock'), T('enemy.tgt', null, 'Exorcism'),
      T('ally.hp<', 30, 'Flash of Light'), T('self.nobuff', null, 'Devotion Aura'),
    ],
    tank: (c) => [
      ...tacSurvive(c, 20),
      T('self.hp<', 12, 'Lay on Hands'), T('ally.hp<', 15, 'Blessing of Protection'),
      T('enemy.cast', null, 'Hammer of Justice'),
      T('self.nobuff', null, 'Righteous Fury'), T('self.melee', null, 'Holy Shield'),
      T('enemy.clus>', 2, 'Consecration'), T('self.nobuff', null, 'Seal of Righteousness'), T('enemy.tgt', null, 'Judgement'),
      T('enemy.hp<', 20, 'Hammer of Wrath'), T('self.hp<', 40, 'Flash of Light'), T('ally.disp', null, 'Cleanse'),
      T('enemy.tgt', null, 'Exorcism'), T('self.nobuff', null, 'Devotion Aura'),
    ],
    heal: (c) => [
      ...tacSurvive(c, 20),
      T('self.hp<', 15, 'Divine Shield'), T('ally.hp<', 12, 'Lay on Hands'), T('ally.hp<', 20, 'Blessing of Protection'),
      T('ally.hp<', 30, 'Holy Shock'), T('ally.hp<', 35, 'Flash of Light'),
      T('enemy.cast', null, 'Hammer of Justice'),
      T('ally.tank<', 55, 'Holy Light'), T('ally.hp<', 50, 'Holy Light'),
      T('ally.disp', null, 'Cleanse'), T('ally.disp', null, 'Purify'),
      T('ally.tank<', 80, 'Flash of Light'), T('ally.hp<', 70, 'Flash of Light'),
      T('self.mp<', 25, 'Divine Favor'), T('self.nobuff', null, 'Seal of Wisdom'), T('self.nobuff', null, 'Concentration Aura'),
    ],
  },
  /* ---------------- Hunter */
  3: {
    dps: (c) => [
      ...tacSurvive(c, 25),
      T('self.hp<', 15, 'Feign Death'), T('self.pethp<', 35, 'Mend Pet'), T('self.nopet', null, 'Revive Pet'),
      T('enemy.loose', null, 'Scare Beast'), T('enemy.flee', null, 'Concussive Shot'),
      T('self.melee', null, 'Wing Clip'), T('self.melee', null, 'Disengage'), T('self.melee', null, 'Mongoose Bite'), T('self.melee', null, 'Raptor Strike'),
      T('self.sur>', 2, 'Intimidation'),
      T('enemy.elite', null, 'Bestial Wrath'), T('enemy.elite', null, 'Rapid Fire'),
      T('enemy.nodeb', null, "Hunter's Mark"),
      T('enemy.clus>', 4, 'Volley'), T('enemy.clus>', 2, 'Multi-Shot'),
      T('enemy.nodeb', null, 'Serpent Sting'), T('enemy.tgt', null, 'Aimed Shot'),
      T('enemy.tgt', null, 'Multi-Shot'), T('enemy.tgt', null, 'Arcane Shot'),
      T('self.nobuff', null, 'Aspect of the Hawk'), T('self.nobuff', null, 'Trueshot Aura'),
    ],
  },
  /* ---------------- Rogue */
  4: {
    dps: (c) => [
      ...tacSurvive(c, 25),
      T('self.hp<', 12, 'Vanish'), T('self.hp<', 35, 'Evasion'), T('self.sur>', 2, 'Evasion'),
      T('enemy.cast', null, 'Kick'), T('enemy.cast', null, 'Gouge'),
      T('enemy.loose', null, 'Blind'), T('enemy.loose', null, 'Gouge'),
      T('enemy.att>', 2, 'Blade Flurry'), T('enemy.elite', null, 'Adrenaline Rush'), T('enemy.elite', null, 'Cold Blood'), T('enemy.boss', null, 'Preparation'),
      T('enemy.elite', null, 'Kidney Shot'),
      T('self.cp>', 2, 'Slice and Dice'), T('self.cp>', 5, 'Eviscerate'), T('enemy.hp<', 15, 'Eviscerate'),
      T('enemy.tgt', null, 'Riposte'), T('enemy.tgt', null, 'Ghostly Strike'), T('enemy.tgt', null, 'Hemorrhage'),
      T('enemy.elite', null, 'Expose Armor'), T('enemy.tgt', null, 'Sinister Strike'),
    ],
  },
  /* ---------------- Priest */
  5: {
    dps: (c, spec) => [
      ...tacSurvive(c, 25),
      T('self.hp<', 20, 'Desperate Prayer'), T('self.sur>', 2, 'Psychic Scream'),
      T('self.hp<', 45, 'Power Word: Shield'), T('self.hp<', 35, 'Flash Heal'), T('self.hp<', 60, 'Renew'),
      T('enemy.cast', null, 'Silence'), T('self.disp', null, 'Dispel Magic'), T('self.disp', null, 'Cure Disease'),
      T('enemy.loose', null, 'Shackle Undead'),
      T('self.nobuff', null, 'Shadowform'), T('self.nobuff', null, 'Inner Fire'),
      T('enemy.elite', null, 'Inner Focus'),
      T('enemy.nodeb', null, 'Vampiric Embrace'), T('enemy.nodeb', null, 'Shadow Word: Pain'), T('enemy.nodeb', null, 'Devouring Plague'),
      T('enemy.clus>', 3, 'Holy Nova'), T('enemy.hp>', 80, 'Holy Fire'),
      T('enemy.tgt', null, 'Mind Blast'), T('enemy.tgt', null, 'Mind Flay'), T('enemy.tgt', null, 'Smite'),
      T('ally.hp<', 35, 'Flash Heal'),
    ],
    heal: (c) => [
      ...tacSurvive(c, 20),
      T('self.hp<', 20, 'Desperate Prayer'), T('self.sur>', 2, 'Psychic Scream'),
      T('ally.hp<', 25, 'Power Word: Shield'), T('ally.hp<', 30, 'Flash Heal'),
      T('ally.hurt>', 3, 'Prayer of Healing'), T('ally.hurt>', 3, 'Holy Nova'),
      T('ally.tank<', 50, 'Greater Heal'), T('ally.tank<', 50, 'Heal'),
      T('ally.tank<', 85, 'Renew'), T('ally.hp<', 55, 'Heal'), T('ally.hp<', 55, 'Lesser Heal'),
      T('ally.disp', null, 'Dispel Magic'), T('ally.disp', null, 'Abolish Disease'), T('ally.disp', null, 'Cure Disease'),
      T('self.mp<', 30, 'Inner Focus'), T('ally.hp<', 75, 'Renew'), T('ally.hp<', 70, 'Flash Heal'),
      T('self.nobuff', null, 'Inner Fire'), T('enemy.loose', null, 'Shackle Undead'),
    ],
  },
  /* ---------------- Shaman */
  7: {
    dps: (c, spec) => [
      ...tacSurvive(c, 25),
      T('self.hp<', 35, 'Lesser Healing Wave'), T('self.hp<', 35, 'Healing Wave'),
      T('enemy.cast', null, 'Earth Shock'), T('self.disp', null, 'Cure Poison'), T('self.disp', null, 'Cure Disease'),
      T('enemy.flee', null, 'Frost Shock'),
      T('self.nobuff', null, 'Windfury Weapon'), T('self.nobuff', null, 'Flametongue Weapon'), T('self.nobuff', null, 'Rockbiter Weapon'), T('self.nobuff', null, 'Lightning Shield'),
      T('enemy.elite', null, 'Elemental Mastery'), T('enemy.elite', null, 'Searing Totem'),
      T('enemy.clus>', 3, 'Magma Totem'), T('enemy.clus>', 3, 'Fire Nova Totem'), T('enemy.clus>', 2, 'Chain Lightning'),
      T('self.att>', 1, 'Strength of Earth Totem'),
      T('enemy.nodeb', null, 'Flame Shock'), T('enemy.tgt', null, 'Stormstrike'),
      T('enemy.tgt', null, spec === 'enh' ? 'Earth Shock' : 'Lightning Bolt'), T('enemy.tgt', null, 'Lightning Bolt'),
    ],
    heal: (c) => [
      ...tacSurvive(c, 20),
      T('ally.hp<', 25, "Nature's Swiftness"), T('ally.hp<', 30, 'Lesser Healing Wave'),
      T('ally.hurt>', 3, 'Chain Heal'), T('enemy.cast', null, 'Earth Shock'),
      T('ally.tank<', 55, 'Healing Wave'), T('ally.hp<', 50, 'Healing Wave'),
      T('ally.disp', null, 'Cure Poison'), T('ally.disp', null, 'Cure Disease'),
      T('self.att>', 1, 'Mana Spring Totem'), T('self.att>', 1, 'Strength of Earth Totem'), T('self.att>', 2, 'Healing Stream Totem'),
      T('ally.hp<', 75, 'Lesser Healing Wave'), T('self.nobuff', null, 'Lightning Shield'),
    ],
  },
  /* ---------------- Mage */
  8: {
    dps: (c, spec) => [
      ...tacSurvive(c, 25),
      T('self.hp<', 15, 'Ice Block'), T('self.hp<', 50, 'Ice Barrier'), T('self.hp<', 30, 'Mana Shield'),
      T('self.melee', null, 'Frost Nova'), T('self.sur>', 2, 'Cone of Cold'),
      T('enemy.cast', null, 'Counterspell'), T('enemy.loose', null, 'Polymorph'),
      T('self.mp<', 12, 'Evocation'), T('self.disp', null, 'Remove Lesser Curse'),
      T('enemy.elite', null, 'Arcane Power'), T('enemy.elite', null, 'Combustion'), T('enemy.elite', null, 'Presence of Mind'), T('enemy.boss', null, 'Cold Snap'),
      T('self.sur>', 3, 'Arcane Explosion'), T('enemy.clus>', 3, 'Blizzard'), T('enemy.clus>', 3, 'Flamestrike'), T('enemy.clus>', 2, 'Blast Wave'),
      T('enemy.hp<', 20, 'Fire Blast'),
      T('enemy.hp>', 90, spec === 'fire' ? 'Pyroblast' : 'Frostbolt'),
      T('enemy.tgt', null, spec === 'fire' ? 'Fireball' : spec === 'arcane' ? 'Arcane Missiles' : 'Frostbolt'),
      T('enemy.tgt', null, 'Frostbolt'), T('enemy.tgt', null, 'Fireball'), T('enemy.melee', null, 'Fire Blast'),
      T('self.nobuff', null, 'Ice Armor'), T('self.nobuff', null, 'Frost Armor'), T('self.nobuff', null, 'Mage Armor'),
    ],
  },
  /* ---------------- Warlock */
  9: {
    dps: (c, spec) => [
      ...tacSurvive(c, 30),
      T('self.hp<', 30, 'Death Coil'), T('self.sur>', 2, 'Howl of Terror'), T('self.hp<', 25, 'Fear'),
      T('self.pethp<', 30, 'Health Funnel'),
      T('enemy.loose', null, 'Banish'), T('enemy.loose', null, 'Fear'),
      T('self.mp<', 30, 'Life Tap'), T('self.mp<', 35, 'Dark Pact'),
      T('enemy.hp<', 20, 'Shadowburn'), T('enemy.hp<', 15, 'Drain Soul'),
      T('self.sur>', 3, 'Hellfire'), T('enemy.clus>', 3, 'Rain of Fire'),
      T('enemy.nodeb', null, 'Curse of Agony'), T('enemy.nodeb', null, 'Corruption'), T('enemy.nodeb', null, 'Siphon Life'), T('enemy.nodeb', null, 'Immolate'),
      T('enemy.nodebAll', null, 'Corruption'), T('enemy.tgt', null, 'Conflagrate'),
      T('self.hp<', 60, 'Drain Life'), T('enemy.tgt', null, 'Shadow Bolt'),
      T('self.nobuff', null, 'Demon Armor'), T('self.nobuff', null, 'Demon Skin'),
    ],
  },
  /* ---------------- Druid */
  11: {
    dps: (c, spec) => spec === 'feral' ? [
      ...tacSurvive(c, 25),
      T('self.hp<', 25, 'Frenzied Regeneration'), T('self.hp<', 30, 'Barkskin'),
      T('self.any', null, 'Cat Form'), T('self.any', null, 'Bear Form'), T('self.any', null, 'Dire Bear Form'),
      T('enemy.cast', null, 'Bash'), T('enemy.nodeb', null, 'Faerie Fire (Feral)'),
      T('self.rage<', 10, 'Enrage'), T('enemy.clus>', 2, 'Swipe'), T('enemy.nodebAll', null, 'Demoralizing Roar'),
      T('self.cp>', 5, 'Rip'), T('self.cp>', 5, 'Ferocious Bite'), T('enemy.hp<', 20, 'Ferocious Bite'),
      T('enemy.nodeb', null, 'Rake'), T('enemy.tgt', null, 'Claw'), T('self.rage>', 30, 'Maul'),
    ] : [
      ...tacSurvive(c, 25),
      T('self.hp<', 30, 'Barkskin'), T('self.hp<', 40, 'Regrowth'), T('self.hp<', 35, 'Healing Touch'), T('self.hp<', 70, 'Rejuvenation'),
      T('self.disp', null, 'Remove Curse'), T('self.disp', null, 'Abolish Poison'), T('self.mp<', 15, 'Innervate'),
      T('enemy.loose', null, 'Hibernate'), T('enemy.loose', null, 'Entangling Roots'),
      T('self.nobuff', null, 'Moonkin Form'),
      T('enemy.clus>', 3, 'Hurricane'), T('enemy.nodeb', null, 'Faerie Fire'), T('enemy.nodeb', null, 'Insect Swarm'), T('enemy.nodeb', null, 'Moonfire'),
      T('enemy.hp>', 50, 'Starfire'), T('enemy.tgt', null, 'Wrath'),
    ],
    tank: (c) => [
      ...tacSurvive(c, 20),
      T('self.hp<', 25, 'Frenzied Regeneration'), T('self.hp<', 30, 'Barkskin'),
      T('self.any', null, 'Dire Bear Form'), T('self.any', null, 'Bear Form'),
      T('enemy.cast', null, 'Bash'), T('enemy.onally', null, 'Growl'), T('enemy.att>', 4, 'Challenging Roar'),
      T('self.rage<', 10, 'Enrage'), T('enemy.nodebAll', null, 'Demoralizing Roar'), T('enemy.clus>', 2, 'Swipe'),
      T('enemy.nodeb', null, 'Faerie Fire (Feral)'), T('self.rage>', 15, 'Maul'), T('enemy.tgt', null, 'Swipe'),
    ],
    heal: (c) => [
      ...tacSurvive(c, 20),
      T('self.hp<', 30, 'Barkskin'), T('ally.hp<', 20, "Nature's Swiftness"), T('ally.hp<', 25, 'Swiftmend'),
      T('ally.hp<', 35, 'Regrowth'), T('ally.hurt>', 4, 'Tranquility'),
      T('ally.tank<', 90, 'Rejuvenation'), T('ally.tank<', 50, 'Healing Touch'), T('ally.hp<', 50, 'Healing Touch'),
      T('ally.disp', null, 'Remove Curse'), T('ally.disp', null, 'Abolish Poison'),
      T('ally.mp<', 20, 'Innervate'), T('ally.hp<', 75, 'Rejuvenation'), T('ally.hp<', 65, 'Regrowth'),
      T('enemy.loose', null, 'Hibernate'),
    ],
  },
};
/* the preset list of a kind for this character: dps / tank / heal (what the class has; a class without that role plays
   Damage) */
function tacPreset(c, kind) {
  const K = TAC_CLASS[c.cls] || {}; const spec = typeof rotationSpec === 'function' ? rotationSpec(c) : '';
  const f = K[kind] || K.dps; if (!f) return [];
  // a healer alone still has to kill things: its damage list after the heals
  let list = f(c, spec);
  // (with less than 70% mana it saves the mana for the heals: the damage below is skipped, the wand does the rest)
  if (kind === 'heal' && K.dps) { const extra = K.dps(c, spec).filter((s) => s.c.indexOf('enemy') === 0 && !list.some((x) => x.a === s.a && x.c === s.c)); if (extra.length) list = list.concat([T('self.mp<', 70, '>end')], extra); }
  const out = []; const seen = new Set();
  for (const s of list) { const k = s.c + '|' + s.a + '|' + s.p; if (seen.has(k)) continue; seen.add(k); out.push(s); if (out.length >= TAC_MAX) break; }
  return out;
}
