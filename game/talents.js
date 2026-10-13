'use strict';
/* talents.js - talent trees (from gamedata/talents.json), points from level 10 (one per level), automatic spending
   by a chosen build, the talent window, and the talent effects the combat code asks for (talentRank). */

const TREE_ART = { 'Warrior Arms': 'WarriorArms', 'Warrior Fury': 'WarriorFury', 'Warrior Protection': 'WarriorProtection',
  'Paladin Holy': 'PaladinHoly', 'Paladin Protection': 'PaladinProtection', 'Paladin Retribution': 'PaladinCombat',
  'Hunter Beast Mastery': 'HunterBeastMastery', 'Hunter Marksmanship': 'HunterMarksmanship', 'Hunter Survival': 'HunterSurvival',
  'Rogue Assassination': 'RogueAssassination', 'Rogue Combat': 'RogueCombat', 'Rogue Subtlety': 'RogueSubtlety',
  'Priest Discipline': 'PriestDiscipline', 'Priest Holy': 'PriestHoly', 'Priest Shadow': 'PriestShadow',
  'Shaman Elemental': 'ShamanElementalCombat', 'Shaman Enhancement': 'ShamanEnhancement', 'Shaman Restoration': 'ShamanRestoration',
  'Mage Arcane': 'MageArcane', 'Mage Fire': 'MageFire', 'Mage Frost': 'MageFrost',
  'Warlock Affliction': 'WarlockCurses', 'Warlock Demonology': 'WarlockSummoning', 'Warlock Destruction': 'WarlockDestruction',
  'Druid Balance': 'DruidBalance', 'Druid Feral Combat': 'DruidFeralCombat', 'Druid Restoration': 'DruidRestoration' };
/* '*WEAPON*' = the specialization of the weapon in the main hand when the point is spent */
const TALENT_BUILDS = {
  1: {
    arms: { name: 'Arms - Mortal Strike (leveling)', order: [['Improved Heroic Strike', 3], ['Improved Rend', 3], ['Tactical Mastery', 3], ['Improved Charge', 2], ['Deep Wounds', 3], ['Improved Overpower', 2], ['Two-Handed Weapon Specialization', 5], ['Impale', 2], ['Sweeping Strikes', 1], ['*WEAPON*', 5], ['Improved Hamstring', 1], ['Mortal Strike', 1], ['Cruelty', 5], ['Unbridled Wrath', 5], ['Improved Battle Shout', 5], ['Improved Execute', 2], ['Enrage', 3]] },
    fury: { name: 'Fury - Bloodthirst', order: [['Cruelty', 5], ['Unbridled Wrath', 5], ['Improved Battle Shout', 5], ['Enrage', 5], ['Improved Execute', 2], ['Death Wish', 1], ['Improved Cleave', 2], ['Flurry', 5], ['Bloodthirst', 1], ['Improved Heroic Strike', 3], ['Deflection', 2], ['Tactical Mastery', 5], ['Anger Management', 1], ['Improved Rend', 3], ['Deep Wounds', 3], ['Two-Handed Weapon Specialization', 3]] },
    prot: { name: 'Protection - Shield Slam (shield and one-hander)', order: [['Shield Specialization', 5], ['Anticipation', 5], ['Toughness', 5], ['Improved Revenge', 3], ['Improved Bloodrage', 2], ['Last Stand', 1], ['Improved Sunder Armor', 3], ['Concussion Blow', 1], ['One-Handed Weapon Specialization', 5], ['Shield Slam', 1], ['Improved Heroic Strike', 3], ['Deflection', 2], ['Tactical Mastery', 5], ['Cruelty', 5], ['Unbridled Wrath', 5]] },
  },
  /* the other classes: fill the trees in this order, row by row (preferred talents first in a row), skipping the listed ones */
  2: {
    ret: { name: 'Retribution - Seal of Command (leveling)', trees: ['Retribution', 'Holy', 'Protection'], prefer: ['Benediction', 'Improved Judgement', 'Deflection', 'Conviction', 'Seal of Command', 'Two-Handed Weapon Specialization', 'Sanctity Aura', 'Vengeance', 'Divine Strength', 'Divine Intellect', 'Improved Seal of Righteousness'], skip: ['Improved Seal of the Crusader', 'Eye for an Eye', 'Improved Retribution Aura', 'Pursuit of Justice', 'Improved Lay on Hands', 'Unyielding Faith', 'Improved Blessing of Wisdom'] },
    holy: { name: 'Holy - Holy Shock', trees: ['Holy', 'Retribution', 'Protection'], prefer: ['Divine Strength', 'Divine Intellect', 'Improved Seal of Righteousness', 'Spiritual Focus', 'Consecration', 'Healing Light', 'Illumination', 'Divine Favor', 'Holy Power', 'Holy Shock', 'Benediction', 'Improved Judgement', 'Conviction', 'Seal of Command'], skip: ['Unyielding Faith', 'Improved Blessing of Wisdom', 'Improved Seal of the Crusader', 'Eye for an Eye', 'Improved Retribution Aura'] },
    prot: { name: 'Protection - Holy Shield', trees: ['Protection', 'Retribution', 'Holy'], prefer: ['Redoubt', 'Toughness', 'Improved Devotion Aura', 'Precision', 'Shield Specialization', 'Anticipation', 'Blessing of Kings', 'Reckoning', 'One-Handed Weapon Specialization', 'Holy Shield'], skip: ["Guardian's Favor", 'Improved Concentration Aura', 'Improved Righteous Fury', 'Blessing of Sanctuary', 'Improved Seal of the Crusader', 'Eye for an Eye'] },
  },
  3: {
    bm: { name: 'Beast Mastery - strong pet (leveling)', trees: ['Beast Mastery', 'Marksmanship', 'Survival'], prefer: ['Improved Aspect of the Hawk', 'Endurance Training', 'Thick Hide', 'Unleashed Fury', 'Ferocity', 'Improved Mend Pet', 'Intimidation', 'Spirit Bond', 'Bestial Discipline', 'Frenzy', 'Bestial Wrath', 'Lethal Shots', 'Efficiency', 'Improved Hunter\'s Mark', 'Aimed Shot', 'Mortal Shots'], skip: ['Improved Eyes of the Beast', 'Pathfinding', 'Improved Revive Pet', 'Bestial Swiftness', 'Improved Aspect of the Monkey', 'Improved Concussive Shot', 'Improved Scorpid Sting'] },
    mm: { name: 'Marksmanship - Trueshot Aura', trees: ['Marksmanship', 'Beast Mastery', 'Survival'], prefer: ['Lethal Shots', 'Efficiency', 'Improved Hunter\'s Mark', 'Aimed Shot', 'Improved Arcane Shot', 'Mortal Shots', 'Improved Serpent Sting', 'Barrage', 'Ranged Weapon Specialization', 'Trueshot Aura', 'Improved Aspect of the Hawk', 'Endurance Training', 'Unleashed Fury'], skip: ['Improved Concussive Shot', 'Scatter Shot', 'Improved Scorpid Sting', 'Hawk Eye', 'Improved Eyes of the Beast', 'Pathfinding'] },
    surv: { name: 'Survival', trees: ['Survival', 'Marksmanship', 'Beast Mastery'], prefer: ['Monster Slaying', 'Humanoid Slaying', 'Deflection', 'Savage Strikes', 'Survivalist', 'Surefooted', 'Killer Instinct', 'Lightning Reflexes', 'Counterattack', 'Lethal Shots', 'Efficiency'], skip: ['Entrapment', 'Improved Wing Clip', 'Clever Traps', 'Trap Mastery', 'Improved Feign Death', 'Deterrence', 'Improved Concussive Shot'] },
  },
  4: {
    combat: { name: 'Combat - swords (leveling)', trees: ['Combat', 'Assassination', 'Subtlety'], prefer: ['Improved Sinister Strike', 'Lightning Reflexes', 'Precision', 'Deflection', 'Riposte', 'Dual Wield Specialization', 'Sword Specialization', 'Blade Flurry', 'Weapon Expertise', 'Aggression', 'Adrenaline Rush', 'Malice', 'Ruthlessness', 'Murder', 'Improved Slice and Dice', 'Relentless Strikes', 'Lethality'], skip: ['Improved Gouge', 'Improved Sprint', 'Improved Kick', 'Improved Backstab', 'Dagger Specialization', 'Mace Specialization', 'Fist Weapon Specialization', 'Improved Expose Armor', 'Improved Poisons', 'Vile Poisons', 'Improved Kidney Shot'] },
    assa: { name: 'Assassination - Seal Fate', trees: ['Assassination', 'Combat', 'Subtlety'], prefer: ['Improved Eviscerate', 'Malice', 'Ruthlessness', 'Murder', 'Improved Slice and Dice', 'Relentless Strikes', 'Lethality', 'Cold Blood', 'Seal Fate', 'Vigor', 'Improved Sinister Strike', 'Lightning Reflexes', 'Precision'], skip: ['Improved Expose Armor', 'Improved Poisons', 'Vile Poisons', 'Improved Kidney Shot', 'Improved Gouge', 'Improved Sprint', 'Improved Kick', 'Remorseless Attacks'] },
    sub: { name: 'Subtlety - Hemorrhage', trees: ['Subtlety', 'Combat', 'Assassination'], prefer: ['Opportunity', 'Ghostly Strike', 'Serrated Blades', 'Hemorrhage', 'Deadliness', 'Improved Sinister Strike', 'Lightning Reflexes', 'Precision'], skip: ['Master of Deception', 'Camouflage', 'Elusiveness', 'Improved Sap', 'Heightened Senses', 'Preparation', 'Improved Ambush', 'Initiative', 'Setup', 'Dirty Deeds', 'Premeditation'] },
  },
  5: {
    shadow: { name: 'Shadow - Shadowform (leveling)', trees: ['Shadow', 'Discipline', 'Holy'], prefer: ['Spirit Tap', 'Improved Shadow Word: Pain', 'Shadow Focus', 'Improved Mind Blast', 'Mind Flay', 'Shadow Weaving', 'Vampiric Embrace', 'Darkness', 'Shadowform', 'Wand Specialization', 'Improved Power Word: Shield', 'Meditation', 'Mental Agility', 'Mental Strength', 'Inner Focus', 'Divine Spirit', 'Improved Inner Fire'], skip: ['Improved Fade', 'Improved Psychic Scream', 'Silence', 'Unbreakable Will', 'Silent Resolve', 'Martyrdom', 'Improved Mana Burn', 'Improved Vampiric Embrace', 'Blackout'] },
    disc: { name: 'Discipline - Power Infusion', trees: ['Discipline', 'Shadow', 'Holy'], prefer: ['Wand Specialization', 'Improved Power Word: Shield', 'Improved Power Word: Fortitude', 'Meditation', 'Inner Focus', 'Mental Agility', 'Improved Inner Fire', 'Mental Strength', 'Divine Spirit', 'Force of Will', 'Power Infusion', 'Spirit Tap'], skip: ['Unbreakable Will', 'Silent Resolve', 'Martyrdom', 'Improved Mana Burn', 'Improved Fade', 'Improved Psychic Scream', 'Silence'] },
    holy: { name: 'Holy - Spiritual Guidance', trees: ['Holy', 'Discipline', 'Shadow'], prefer: ['Holy Specialization', 'Improved Renew', 'Divine Fury', 'Holy Nova', 'Inspiration', 'Improved Healing', 'Searing Light', 'Spiritual Guidance', 'Spiritual Healing', 'Lightwell', 'Wand Specialization', 'Meditation'], skip: ['Spell Warding', 'Healing Focus', 'Holy Reach', 'Improved Prayer of Healing', 'Spirit of Redemption', 'Unbreakable Will', 'Silent Resolve', 'Martyrdom'] },
  },
  7: {
    enh: { name: 'Enhancement - Stormstrike (leveling)', trees: ['Enhancement', 'Elemental', 'Restoration'], prefer: ['Ancestral Knowledge', 'Thundering Strikes', 'Improved Lightning Shield', 'Two-Handed Axes and Maces', 'Flurry', 'Elemental Weapons', 'Toughness', 'Anticipation', 'Weapon Mastery', 'Stormstrike', 'Convection', 'Concussion', 'Call of Flame', 'Elemental Focus', 'Reverberation'], skip: ['Improved Ghost Wolf', 'Guardian Totems', 'Shield Specialization', 'Enhancing Totems', 'Improved Weapon Totems', 'Parry'] },
    ele: { name: 'Elemental - Elemental Mastery', trees: ['Elemental', 'Restoration', 'Enhancement'], prefer: ['Convection', 'Concussion', 'Call of Flame', 'Elemental Focus', 'Reverberation', 'Call of Thunder', 'Elemental Fury', 'Lightning Mastery', 'Elemental Mastery', 'Improved Fire Totems', 'Tidal Focus', 'Totemic Focus', 'Nature\'s Guidance'], skip: ["Earth's Grasp", 'Elemental Warding', 'Eye of the Storm', 'Elemental Devastation', 'Storm Reach', 'Improved Reincarnation', 'Improved Ghost Wolf'] },
    resto: { name: 'Restoration', trees: ['Restoration', 'Enhancement', 'Elemental'], prefer: ['Improved Healing Wave', 'Tidal Focus', 'Ancestral Healing', 'Totemic Focus', "Nature's Guidance", 'Healing Focus', 'Tidal Mastery', 'Healing Way', "Nature's Swiftness", 'Purification', 'Mana Tide Totem', 'Ancestral Knowledge', 'Thundering Strikes'], skip: ['Improved Reincarnation', 'Totemic Mastery', 'Healing Grace', 'Restorative Totems', 'Improved Ghost Wolf', 'Guardian Totems'] },
  },
  8: {
    frost: { name: 'Frost - Ice Barrier (leveling)', trees: ['Frost', 'Arcane', 'Fire'], prefer: ['Improved Frostbolt', 'Elemental Precision', 'Ice Shards', 'Frostbite', 'Improved Frost Nova', 'Permafrost', 'Piercing Ice', 'Cold Snap', 'Shatter', 'Ice Block', 'Improved Cone of Cold', "Winter's Chill", 'Ice Barrier', 'Arcane Subtlety', 'Arcane Focus', 'Wand Specialization', 'Magic Absorption', 'Arcane Concentration', 'Arcane Meditation', 'Arcane Mind'], skip: ['Frost Warding', 'Improved Blizzard', 'Arctic Reach', 'Frost Channeling', 'Magic Attunement', 'Improved Arcane Explosion', 'Arcane Resilience', 'Improved Counterspell', 'Improved Mana Shield'] },
    fire: { name: 'Fire - Combustion', trees: ['Fire', 'Arcane', 'Frost'], prefer: ['Improved Fireball', 'Ignite', 'Improved Fire Blast', 'Incinerate', 'Pyroblast', 'Improved Scorch', 'Master of Elements', 'Critical Mass', 'Blast Wave', 'Fire Power', 'Combustion', 'Arcane Subtlety', 'Arcane Focus', 'Arcane Concentration', 'Arcane Meditation'], skip: ['Impact', 'Flame Throwing', 'Improved Flamestrike', 'Burning Soul', 'Improved Fire Ward', 'Magic Attunement', 'Improved Counterspell'] },
    arcane: { name: 'Arcane - Arcane Power', trees: ['Arcane', 'Frost', 'Fire'], prefer: ['Arcane Focus', 'Improved Arcane Missiles', 'Wand Specialization', 'Arcane Concentration', 'Improved Arcane Explosion', 'Arcane Meditation', 'Presence of Mind', 'Arcane Mind', 'Arcane Instability', 'Arcane Power', 'Improved Frostbolt', 'Elemental Precision'], skip: ['Magic Attunement', 'Arcane Resilience', 'Improved Counterspell', 'Improved Mana Shield', 'Frost Warding'] },
  },
  9: {
    affli: { name: 'Affliction - Siphon Life (leveling)', trees: ['Affliction', 'Demonology', 'Destruction'], prefer: ['Improved Corruption', 'Suppression', 'Improved Life Tap', 'Improved Drain Life', 'Improved Curse of Agony', 'Amplify Curse', 'Nightfall', 'Grim Reach', 'Siphon Life', 'Shadow Mastery', 'Dark Pact', 'Improved Imp', 'Demonic Embrace', 'Improved Voidwalker', 'Fel Intellect', 'Fel Stamina', 'Fel Domination'], skip: ['Improved Curse of Weakness', 'Improved Drain Soul', 'Fel Concentration', 'Improved Drain Mana', 'Curse of Exhaustion', 'Improved Curse of Exhaustion', 'Improved Healthstone', 'Improved Health Funnel'] },
    demo: { name: 'Demonology - Soul Link', trees: ['Demonology', 'Affliction', 'Destruction'], prefer: ['Demonic Embrace', 'Improved Voidwalker', 'Fel Intellect', 'Improved Health Funnel', 'Fel Stamina', 'Fel Domination', 'Unholy Power', 'Master Summoner', 'Demonic Sacrifice', 'Master Demonologist', 'Soul Link', 'Improved Corruption', 'Suppression'], skip: ['Improved Healthstone', 'Improved Imp', 'Improved Succubus', 'Improved Enslave Demon', 'Improved Firestone', 'Improved Spellstone'] },
    destro: { name: 'Destruction - Ruin', trees: ['Destruction', 'Affliction', 'Demonology'], prefer: ['Improved Shadow Bolt', 'Bane', 'Devastation', 'Shadowburn', 'Destructive Reach', 'Improved Immolate', 'Ruin', 'Emberstorm', 'Conflagrate', 'Cataclysm', 'Improved Corruption', 'Suppression'], skip: ['Improved Firebolt', 'Improved Lash of Pain', 'Intensity', 'Improved Searing Pain', 'Pyroclasm', 'Aftermath'] },
  },
  11: {
    feral: { name: 'Feral - cat and bear (leveling)', trees: ['Feral Combat', 'Restoration', 'Balance'], prefer: ['Ferocity', 'Feral Instinct', 'Thick Hide', 'Sharpened Claws', 'Feral Charge', 'Predatory Strikes', 'Blood Frenzy', 'Primal Fury', 'Savage Fury', 'Faerie Fire (Feral)', 'Heart of the Wild', 'Leader of the Pack', 'Furor', 'Improved Mark of the Wild', 'Natural Weapons', 'Natural Shapeshifter', 'Omen of Clarity'], skip: ['Feral Aggression', 'Brutal Impact', 'Feline Swiftness', 'Improved Shred'] },
    balance: { name: 'Balance - Moonkin', trees: ['Balance', 'Restoration', 'Feral Combat'], prefer: ['Improved Wrath', 'Improved Moonfire', 'Natural Weapons', 'Natural Shapeshifter', 'Omen of Clarity', "Nature's Reach", 'Vengeance', 'Improved Starfire', "Nature's Grace", 'Moonglow', 'Moonfury', 'Moonkin Form', 'Furor', 'Improved Mark of the Wild'], skip: ["Nature's Grasp", "Improved Nature's Grasp", 'Improved Entangling Roots', 'Improved Thorns'] },
    resto: { name: 'Restoration - Swiftmend', trees: ['Restoration', 'Balance', 'Feral Combat'], prefer: ['Furor', 'Improved Mark of the Wild', 'Improved Healing Touch', "Nature's Focus", 'Reflection', 'Insect Swarm', 'Subtlety', 'Improved Rejuvenation', "Nature's Swiftness", 'Gift of Nature', 'Improved Regrowth', 'Swiftmend', 'Improved Wrath', 'Improved Moonfire'], skip: ['Improved Enrage', 'Tranquil Spirit', 'Improved Tranquility'] },
  },
};

/* ------------------------------------------------------------------ data */
function classTalents(cls) {
  G.talCache = G.talCache || {};
  if (G.talCache[cls]) return G.talCache[cls];
  const cname = CLASS_NAMES[cls]; const T = G.d.talents; const out = { trees: [], list: [], byId: {}, byName: {}, abil: {} };
  if (!T) return (G.talCache[cls] = out);
  out.trees = T.trees.filter((t) => t.class === cname).sort((a, b) => a.order - b.order || a.id - b.id);
  const ids = new Set(out.trees.map((t) => t.id));
  for (const t of T.talents) if (ids.has(t.tree)) { out.list.push(t); out.byId[t.id] = t; out.byName[t.name] = t; }
  for (const t of out.list) { const sp = spellRow(t.ranks[0]); if (t.ranks.length === 1 && sp && sp.n === t.name && !(sp.fl || []).includes('passive')) out.abil[t.name] = t; }
  return (G.talCache[cls] = out);
}
function talentRank(c, name) { const t = classTalents(c.cls).byName[name]; return t && c.talents ? c.talents[t.id] || 0 : 0; }
function talentPoints(c) { return Math.max(0, c.level - 9); }
function talentSpent(c, treeId) { let n = 0; const D = classTalents(c.cls); for (const id in c.talents || {}) { const t = D.byId[id]; if (t && (treeId == null || t.tree === treeId)) n += c.talents[id]; } return n; }
function talentFree(c) { return talentPoints(c) - talentSpent(c); }
/* why a point cannot go into t now (null = it can) */
function talentBlock(c, t) {
  const r = (c.talents || {})[t.id] || 0;
  if (r >= t.ranks.length) return 'maxed';
  if (talentFree(c) <= 0) return 'no points left';
  if (talentSpent(c, t.tree) < t.row * 5) return 'needs ' + t.row * 5 + ' points in ' + classTalents(c.cls).trees.find((x) => x.id === t.tree).name;
  for (const p of t.prereq || []) { const pt = classTalents(c.cls).byId[p.talent]; if (((c.talents || {})[p.talent] || 0) < p.rank) return 'needs ' + p.rank + ' in ' + (pt ? pt.name : 'another talent'); }
  return null;
}
function learnTalent(c, t, quiet) {
  if (talentBlock(c, t)) return false;
  c.talents = c.talents || {}; c.talents[t.id] = (c.talents[t.id] || 0) + 1; dirty(c);
  if (!quiet) log('Talent: ' + t.name + ' ' + c.talents[t.id] + '/' + t.ranks.length + '.');
  if (classTalents(c.cls).abil[t.name]) learnAbilities(c);
  return true;
}
function resetTalents(c) {
  const D = classTalents(c.cls);
  for (const n in D.abil) { if (c.known) delete c.known[n]; }
  c.talents = {}; delete c.cfg.weaponSpec; dirty(c); log('Talents reset.');
}
function weaponSpecName(c) {
  const w = c.equip[15] && itemRow(c.equip[15].id); const s = w ? w.s : -1;
  if (s === 0 || s === 1) return 'Axe Specialization';
  if (s === 4 || s === 5) return 'Mace Specialization';
  if (s === 7 || s === 8) return 'Sword Specialization';
  return 'Axe Specialization';
}
/* spend free points along the chosen build, then anywhere sensible */
function autoTalents(c, quiet) {
  const D = classTalents(c.cls); const builds = TALENT_BUILDS[c.cls]; if (!builds || !D.list.length) return;
  const b = builds[c.cfg.talentBuild] || builds[Object.keys(builds)[0]]; let n = 0;
  if (b.trees) return autoTalentsTrees(c, b, quiet);
  for (const [name0, want] of b.order) {
    if (talentFree(c) <= 0) break;
    if (name0 === '*WEAPON*' && !c.cfg.weaponSpec) c.cfg.weaponSpec = weaponSpecName(c);      // decided once, at the first point
    const name = name0 === '*WEAPON*' ? c.cfg.weaponSpec : name0; const t = D.byName[name]; if (!t) continue;
    while (((c.talents || {})[t.id] || 0) < want && talentFree(c) > 0 && !talentBlock(c, t)) { learnTalent(c, t, quiet); n++; }
    if (((c.talents || {})[t.id] || 0) < want) break;          // keep the order: wait for the next level
  }
  return n;
}
/* the other classes: trees in order, row by row; skipped talents only when nothing else opens the next row */
function autoTalentsTrees(c, b, quiet) {
  const D = classTalents(c.cls); const skip = new Set(b.skip || []); const pi = (t) => { const i = (b.prefer || []).indexOf(t.name); return i < 0 ? 99 : i; };
  let n = 0;
  for (const treeName of b.trees) {
    const tr = D.trees.find((t) => t.name === treeName); if (!tr) continue;
    for (let guard = 0; guard < 80 && talentFree(c) > 0; guard++) {
      const open = D.list.filter((t) => t.tree === tr.id && !talentBlock(c, t));
      let cand = open.filter((t) => !skip.has(t.name));
      if (!cand.length) {
        const later = D.list.some((t) => t.tree === tr.id && !skip.has(t.name) && ((c.talents || {})[t.id] || 0) < t.ranks.length);
        if (!later) break; cand = open;            // a filler point to reach the next row
      }
      if (!cand.length) break;
      cand.sort((x, y) => x.row - y.row || pi(x) - pi(y) || x.col - y.col);
      if (!learnTalent(c, cand[0], quiet)) break; n++;
    }
    if (talentFree(c) <= 0) break;
  }
  return n;
}
function onLevelTalents(c) { if (c.cfg && c.cfg.autoTalents !== false && talentFree(c) > 0) autoTalents(c); }

/* ------------------------------------------------------------------ effects used by the combat code */
function abilityCost(c, sp, name) {
  let cost = sp && sp.pw && sp.pw[0] === 1 ? sp.pw[1] : 0; if (!cost || c.cls !== 1) return cost;
  const n = name || sp.n;
  if (n === 'Heroic Strike') cost -= talentRank(c, 'Improved Heroic Strike');
  else if (n === 'Thunder Clap') cost -= [0, 1, 2, 4][talentRank(c, 'Improved Thunder Clap')];
  else if (n === 'Sunder Armor') cost -= talentRank(c, 'Improved Sunder Armor');
  else if (n === 'Execute') cost -= [0, 2, 5][talentRank(c, 'Improved Execute')];
  return Math.max(0, cost);
}
function abilityCooldown(c, sp, name) {
  let cd = (sp.cd || sp.catcd || 0) / 1000; const n = name || sp.n;
  if (n === 'Intercept') cd -= 5 * talentRank(c, 'Improved Intercept');
  if (n === 'Taunt') cd -= talentRank(c, 'Improved Taunt');
  return Math.max(0, cd);
}
/* buff / debuff duration and strength changes: {dur, val} */
function auraTalentMods(c, name, dur, val) {
  if (c.cls !== 1) return { dur, val };
  if (name === 'Battle Shout') { dur *= 1 + 0.1 * talentRank(c, 'Booming Voice'); val *= 1 + 0.05 * talentRank(c, 'Improved Battle Shout'); }
  if (name === 'Demoralizing Shout') { dur *= 1 + 0.1 * talentRank(c, 'Booming Voice'); val *= 1 + 0.08 * talentRank(c, 'Improved Demoralizing Shout'); }
  if (name === 'Rend') val *= 1 + [0, 0.15, 0.25, 0.35][talentRank(c, 'Improved Rend')];
  if (name === 'Disarm') dur += talentRank(c, 'Improved Disarm');
  if (name === 'Shield Wall') dur += [0, 3, 5][talentRank(c, 'Improved Shield Wall')];
  if (name === 'Shield Block') dur += [0, 0.5, 1, 2][talentRank(c, 'Improved Shield Block')];
  return { dur, val };
}
/* stat changes from passive talents (called by charStats) */
function talentStats(c, s) {
  if (c.cls !== 1 || !c.talents) return;
  const R = (n) => talentRank(c, n);
  const mh = c.equip[15] && itemRow(c.equip[15].id); const sub = mh ? mh.s : -1; const twoH = mh && mh.t === 17;
  s.crit += R('Cruelty');
  if (sub === 0 || sub === 1) s.crit += R('Axe Specialization');
  if (sub === 6) s.crit += R('Polearm Specialization');
  if (s.parry > 0) s.parry += R('Deflection');
  s.def += 2 * R('Anticipation');
  s.armorItems *= 1 + 0.02 * R('Toughness');
  if (twoH) s.dmgDone *= 1 + 0.01 * R('Two-Handed Weapon Specialization');
  else if (mh) s.dmgDone *= 1 + 0.02 * R('One-Handed Weapon Specialization');
  s.ohMult = 0.5 * (1 + 0.05 * R('Dual Wield Specialization'));
  s.shieldSpec = R('Shield Specialization');
}

/* ------------------------------------------------------------------ talent window (sheet tab) */
function talentText(t, rank) {
  const ri = t.rank_info[Math.max(0, rank - 1)] || t.rank_info[0]; if (!ri) return '';
  const sp = spellRow(ri.spell); const ef = (sp && sp.ef) || [];
  const val = (k) => { const e = ef[k - 1]; return e ? Math.abs(e.lo) : '?'; };
  return esc(ri.text).replace(/\$\/(\d+);[sS](\d)/g, (m, d, k) => { const v = val(+k); return typeof v === 'number' ? +(v / +d).toFixed(1) : v; })
    .replace(/\$[sS](\d)/g, (m, k) => val(+k)).replace(/\$\/\d+;\d*[sS]\d/g, '?');
}
function talentsHtml(c) {
  const D = classTalents(c.cls); if (!D.trees.length) return '<div class="muted">No talent data (gamedata/talents.json).</div>';
  const builds = TALENT_BUILDS[c.cls] || {}; const cfg = c.cfg;
  let h = '<div class="talhead"><span>Points: <b>' + talentFree(c) + '</b> free of ' + talentPoints(c) + '</span>' +
    '<label class="chk"><input type="checkbox" data-tcfg="autoTalents"' + (cfg.autoTalents !== false ? ' checked' : '') + '> Spend automatically:</label>' +
    '<select data-tbuild>' + Object.keys(builds).map((k) => '<option value="' + k + '"' + (cfg.talentBuild === k ? ' selected' : '') + '>' + esc(builds[k].name) + '</option>').join('') + '</select>' +
    '<button class="mini" data-tact="auto">Spend now</button><button class="mini" data-tact="reset">Reset</button></div>';
  h += '<div class="taltrees">';
  for (const tr of D.trees) {
    const spent = talentSpent(c, tr.id);
    h += '<div class="taltree" style="background-image:url(../ui/composed/TalentFrame__' + (TREE_ART[tr.class + ' ' + tr.name] || TREE_ART[tr.name] || '') + '.png)"><div class="taltitle">' + esc(tr.name) + ' <span>' + spent + '</span></div><div class="talgrid">';
    for (const t of D.list.filter((x) => x.tree === tr.id)) {
      const r = (c.talents || {})[t.id] || 0; const why = talentBlock(c, t); const st = r >= t.ranks.length ? 'max' : !why ? 'can' : r ? 'some' : 'no';
      h += '<div class="tal ' + st + '" style="grid-row:' + (t.row + 1) + ';grid-column:' + (t.col + 1) + '" data-tal="' + t.id + '">' +
        '<img src="../gamedata/talent_icons/' + esc(t.icon) + '.png" alt="" onerror="this.style.visibility=\'hidden\'"><b>' + r + '/' + t.ranks.length + '</b></div>';
    }
    h += '</div></div>';
  }
  h += '</div><div class="small muted">Click a talent to spend a point. Talents give their effects in combat; Mortal Strike, Bloodthirst, Shield Slam, Sweeping Strikes, Death Wish, Last Stand, Concussion Blow and Piercing Howl become abilities.</div>';
  return h;
}
function talentTip(c, id) {
  const t = classTalents(c.cls).byId[id]; if (!t) return '';
  const r = (c.talents || {})[t.id] || 0; const why = talentBlock(c, t);
  let h = '<div class="tt"><div class="tt-name">' + esc(t.name) + '</div><div class="muted small">Rank ' + r + '/' + t.ranks.length + '</div>';
  if (r) h += '<div>' + talentText(t, r) + '</div>';
  if (r < t.ranks.length) h += '<div class="muted small" style="margin-top:4px">Next rank:</div><div>' + talentText(t, r + 1) + '</div>';
  if (why && why !== 'maxed') h += '<div style="color:#ff3b30">' + esc(why[0].toUpperCase() + why.slice(1)) + '</div>';
  return h + '</div>';
}
function talentClick(e) {
  const c = active();
  const a = e.target.closest('[data-tact]');
  if (a) { if (a.dataset.tact === 'reset') { if (confirm('Reset all talents?')) resetTalents(c); } else autoTalents(c); save(); renderSheet(); return true; }
  const el = e.target.closest('[data-tal]'); if (!el) return false;
  const t = classTalents(c.cls).byId[el.dataset.tal]; if (!t) return true;
  const why = talentBlock(c, t); if (why) { if (why !== 'maxed') log('Cannot learn ' + t.name + ': ' + why + '.'); } else { learnTalent(c, t); save(); }
  renderSheet(); return true;
}
function talentChange(e) {
  const c = active(); const t = e.target;
  if (t.dataset.tcfg) { c.cfg[t.dataset.tcfg] = t.checked; save(); return true; }
  if (t.dataset.tbuild != null) { c.cfg.talentBuild = t.value; save(); return true; }
  return false;
}
