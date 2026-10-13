'use strict';
/* rotations.js - the "meta" ways to play each class and spec (1.12), as priority lists, for those who do not want to
   set every ability by hand. Behaviour: Custom (your own list), Optimised single target, Optimised AoE.
   The same lists are the go-to raid rotations the raid members will use.
   Each entry: [ability, mode, number]. Abilities the character does not know are skipped. Support rules of the custom
   list (pets, conjuring, forms, pet healing) are kept. Sources: the common Classic class guides of the time. */

const ROTATION_NAMES = { custom: 'Custom (my own list below)', st: 'Optimised single target', aoe: 'Optimised AoE (packs)' };
const ROT_KEEP_MODES = new Set(['pet', 'conjure', 'form', 'petheal']);
/* abilities that are the same for every spec of a class (buffs, defensive cooldowns, heals) */
const ROT_COMMON = {
  1: [['Battle Shout', 'buff'], ['Bloodrage', 'lowrage', 25], ['Last Stand', 'emergency', 20], ['Shield Wall', 'emergency', 15], ['Hamstring', 'flee'], ['Charge', 'opener'], ['Intercept', 'opener']],
  2: [['Devotion Aura', 'buff'], ['Blessing of Might', 'buff'], ['Divine Shield', 'emergency', 15], ['Lay on Hands', 'emergency', 12], ['Hammer of Justice', 'emergency', 35], ['Holy Light', 'heal', 30], ['Flash of Light', 'emergency', 45]],
  3: [['Aspect of the Hawk', 'buff'], ['Mend Pet', 'petheal', 40], ['Concussive Shot', 'flee'], ['Feign Death', 'emergency', 10]],
  4: [['Evasion', 'emergency', 40], ['Vanish', 'emergency', 10]],
  5: [['Power Word: Fortitude', 'buff'], ['Inner Fire', 'buff'], ['Power Word: Shield', 'opener'], ['Desperate Prayer', 'emergency', 20], ['Psychic Scream', 'emergency', 25], ['Renew', 'emergency', 60], ['Flash Heal', 'emergency', 35], ['Greater Heal', 'heal', 30], ['Heal', 'heal', 30], ['Lesser Heal', 'heal', 30]],
  7: [['Lightning Shield', 'buff'], ['Strength of Earth Totem', 'buff'], ['Lesser Healing Wave', 'emergency', 40], ['Healing Wave', 'heal', 30]],
  8: [['Ice Armor', 'buff'], ['Frost Armor', 'buff'], ['Arcane Intellect', 'buff'], ['Ice Barrier', 'emergency', 75], ['Ice Block', 'emergency', 12], ['Mana Shield', 'emergency', 30], ['Evocation', 'lowmana', 10]],
  9: [['Demon Armor', 'buff'], ['Demon Skin', 'buff'], ['Death Coil', 'emergency', 30], ['Life Tap', 'lowmana', 25], ['Health Funnel', 'petheal', 30]],
  11: [['Mark of the Wild', 'buff'], ['Thorns', 'buff'], ['Barkskin', 'emergency', 30], ['Frenzied Regeneration', 'emergency', 35], ['Regrowth', 'heal', 40], ['Healing Touch', 'heal', 30], ['Rejuvenation', 'emergency', 60]],
};
/* per spec (the talent build): single target and AoE priority */
const ROTATIONS = {
  1: {
    arms: { st: [['Execute', 'spam'], ['Overpower', 'spam'], ['Mortal Strike', 'spam'], ['Whirlwind', 'spam'], ['Death Wish', 'elite'], ['Recklessness', 'elite'], ['Rend', 'debuff'], ['Heroic Strike', 'rage', 55]],
      aoe: [['Sweeping Strikes', 'multi', 2], ['Whirlwind', 'spam'], ['Thunder Clap', 'multi', 3], ['Demoralizing Shout', 'multi', 3], ['Cleave', 'multi', 2], ['Mortal Strike', 'spam'], ['Execute', 'spam'], ['Overpower', 'spam'], ['Death Wish', 'multi', 3], ['Heroic Strike', 'rage', 60]] },
    fury: { st: [['Execute', 'spam'], ['Bloodthirst', 'spam'], ['Whirlwind', 'spam'], ['Death Wish', 'elite'], ['Recklessness', 'elite'], ['Overpower', 'spam'], ['Heroic Strike', 'rage', 45]],
      aoe: [['Whirlwind', 'spam'], ['Cleave', 'multi', 2], ['Bloodthirst', 'spam'], ['Demoralizing Shout', 'multi', 3], ['Thunder Clap', 'multi', 3], ['Death Wish', 'multi', 3], ['Execute', 'spam'], ['Heroic Strike', 'rage', 60]] },
    prot: { st: [['Shield Block', 'spam'], ['Revenge', 'spam'], ['Shield Slam', 'spam'], ['Sunder Armor', 'stack', 5], ['Demoralizing Shout', 'debuff'], ['Thunder Clap', 'debuff'], ['Heroic Strike', 'rage', 35]],
      aoe: [['Revenge', 'spam'], ['Demoralizing Shout', 'debuffAll'], ['Thunder Clap', 'multi', 2], ['Cleave', 'multi', 2], ['Shield Slam', 'spam'], ['Shield Block', 'spam'], ['Sunder Armor', 'spam'], ['Challenging Shout', 'emergency', 25]] },
  },
  2: {
    ret: { st: [['Seal of Command', 'buff'], ['Seal of Righteousness', 'buff'], ['Judgement', 'spam'], ['Hammer of Wrath', 'execute', 20], ['Exorcism', 'spam'], ['Holy Shock', 'spam']],
      aoe: [['Seal of Command', 'buff'], ['Seal of Righteousness', 'buff'], ['Consecration', 'multi', 2], ['Judgement', 'spam'], ['Hammer of Wrath', 'execute', 20], ['Exorcism', 'spam']] },
    holy: { st: [['Seal of Righteousness', 'buff'], ['Judgement', 'spam'], ['Holy Shock', 'spam'], ['Exorcism', 'spam'], ['Hammer of Wrath', 'execute', 20]],
      aoe: [['Seal of Righteousness', 'buff'], ['Consecration', 'multi', 2], ['Holy Shock', 'spam'], ['Judgement', 'spam'], ['Exorcism', 'spam']] },
    prot: { st: [['Righteous Fury', 'buff'], ['Seal of Righteousness', 'buff'], ['Holy Shield', 'spam'], ['Judgement', 'spam'], ['Consecration', 'multi', 2], ['Exorcism', 'spam']],
      aoe: [['Righteous Fury', 'buff'], ['Seal of Righteousness', 'buff'], ['Holy Shield', 'spam'], ['Consecration', 'multi', 1], ['Judgement', 'spam']] },
  },
  3: {
    bm: { st: [["Hunter's Mark", 'opener'], ['Bestial Wrath', 'elite'], ['Rapid Fire', 'elite'], ['Serpent Sting', 'debuff'], ['Multi-Shot', 'spam'], ['Arcane Shot', 'spam'], ['Mongoose Bite', 'spam'], ['Raptor Strike', 'spam']],
      aoe: [['Multi-Shot', 'spam'], ['Volley', 'multi', 3], ['Rapid Fire', 'multi', 3], ['Bestial Wrath', 'multi', 3], ['Serpent Sting', 'debuffAll'], ['Arcane Shot', 'spam'], ['Mongoose Bite', 'spam'], ['Raptor Strike', 'spam']] },
    mm: { st: [["Hunter's Mark", 'opener'], ['Aimed Shot', 'spam'], ['Rapid Fire', 'elite'], ['Multi-Shot', 'spam'], ['Serpent Sting', 'debuff'], ['Arcane Shot', 'spam'], ['Mongoose Bite', 'spam'], ['Raptor Strike', 'spam']],
      aoe: [['Multi-Shot', 'spam'], ['Volley', 'multi', 3], ['Rapid Fire', 'multi', 3], ['Aimed Shot', 'spam'], ['Serpent Sting', 'debuffAll'], ['Arcane Shot', 'spam'], ['Raptor Strike', 'spam']] },
    surv: { st: [["Hunter's Mark", 'opener'], ['Rapid Fire', 'elite'], ['Multi-Shot', 'spam'], ['Serpent Sting', 'debuff'], ['Arcane Shot', 'spam'], ['Mongoose Bite', 'spam'], ['Counterattack', 'spam'], ['Raptor Strike', 'spam'], ['Wing Clip', 'debuff']],
      aoe: [['Multi-Shot', 'spam'], ['Volley', 'multi', 3], ['Rapid Fire', 'multi', 3], ['Serpent Sting', 'debuffAll'], ['Mongoose Bite', 'spam'], ['Raptor Strike', 'spam']] },
  },
  4: {
    combat: { st: [['Slice and Dice', 'finisher', 2], ['Adrenaline Rush', 'elite'], ['Blade Flurry', 'elite'], ['Riposte', 'spam'], ['Eviscerate', 'finisher', 5], ['Sinister Strike', 'spam']],
      aoe: [['Blade Flurry', 'multi', 2], ['Adrenaline Rush', 'multi', 3], ['Slice and Dice', 'finisher', 1], ['Riposte', 'spam'], ['Eviscerate', 'finisher', 4], ['Sinister Strike', 'spam']] },
    assa: { st: [['Slice and Dice', 'finisher', 2], ['Cold Blood', 'elite'], ['Eviscerate', 'finisher', 5], ['Ghostly Strike', 'spam'], ['Sinister Strike', 'spam']],
      aoe: [['Slice and Dice', 'finisher', 1], ['Eviscerate', 'finisher', 4], ['Sinister Strike', 'spam']] },
    sub: { st: [['Slice and Dice', 'finisher', 2], ['Preparation', 'elite'], ['Eviscerate', 'finisher', 5], ['Ghostly Strike', 'spam'], ['Hemorrhage', 'spam'], ['Sinister Strike', 'spam']],
      aoe: [['Slice and Dice', 'finisher', 1], ['Eviscerate', 'finisher', 4], ['Hemorrhage', 'spam'], ['Sinister Strike', 'spam']] },
  },
  5: {
    shadow: { st: [['Shadowform', 'buff'], ['Vampiric Embrace', 'debuff'], ['Shadow Word: Pain', 'debuff'], ['Devouring Plague', 'debuff'], ['Mind Blast', 'spam'], ['Mind Flay', 'spam'], ['Smite', 'spam']],
      aoe: [['Shadowform', 'buff'], ['Shadow Word: Pain', 'debuffAll'], ['Psychic Scream', 'multi', 3], ['Holy Nova', 'multi', 3], ['Mind Blast', 'spam'], ['Mind Flay', 'spam']] },
    disc: { st: [['Inner Focus', 'elite'], ['Shadow Word: Pain', 'debuff'], ['Holy Fire', 'opener'], ['Mind Blast', 'spam'], ['Smite', 'spam']],
      aoe: [['Holy Nova', 'multi', 3], ['Shadow Word: Pain', 'debuffAll'], ['Mind Blast', 'spam'], ['Smite', 'spam']] },
    holy: { st: [['Shadow Word: Pain', 'debuff'], ['Holy Fire', 'opener'], ['Mind Blast', 'spam'], ['Smite', 'spam']],
      aoe: [['Holy Nova', 'multi', 3], ['Shadow Word: Pain', 'debuffAll'], ['Holy Fire', 'opener'], ['Smite', 'spam']] },
  },
  7: {
    enh: { st: [['Windfury Weapon', 'buff'], ['Rockbiter Weapon', 'buff'], ['Stormstrike', 'spam'], ['Flame Shock', 'debuff'], ['Earth Shock', 'spam'], ['Searing Totem', 'elite']],
      aoe: [['Windfury Weapon', 'buff'], ['Rockbiter Weapon', 'buff'], ['Magma Totem', 'multi', 3], ['Fire Nova Totem', 'multi', 3], ['Chain Lightning', 'multi', 2], ['Stormstrike', 'spam'], ['Flame Shock', 'debuffAll'], ['Earth Shock', 'spam']] },
    ele: { st: [['Flametongue Weapon', 'buff'], ['Elemental Mastery', 'elite'], ['Flame Shock', 'debuff'], ['Chain Lightning', 'spam'], ['Lightning Bolt', 'spam'], ['Earth Shock', 'spam']],
      aoe: [['Flametongue Weapon', 'buff'], ['Chain Lightning', 'spam'], ['Magma Totem', 'multi', 3], ['Fire Nova Totem', 'multi', 3], ['Flame Shock', 'debuffAll'], ['Lightning Bolt', 'spam']] },
    resto: { st: [['Flametongue Weapon', 'buff'], ['Flame Shock', 'debuff'], ['Lightning Bolt', 'spam'], ['Earth Shock', 'spam']],
      aoe: [['Flametongue Weapon', 'buff'], ['Chain Lightning', 'multi', 2], ['Magma Totem', 'multi', 3], ['Flame Shock', 'debuffAll'], ['Lightning Bolt', 'spam']] },
  },
  8: {
    frost: { st: [['Frostbolt', 'spam'], ['Fire Blast', 'execute', 25], ['Frost Nova', 'emergency', 50], ['Cone of Cold', 'multi', 2]],
      aoe: [['Frost Nova', 'multi', 2], ['Blizzard', 'multi', 3], ['Cone of Cold', 'multi', 2], ['Arcane Explosion', 'multi', 3], ['Frostbolt', 'spam'], ['Fire Blast', 'spam']] },
    fire: { st: [['Combustion', 'elite'], ['Pyroblast', 'opener'], ['Fireball', 'spam'], ['Fire Blast', 'spam'], ['Frost Nova', 'emergency', 50]],
      aoe: [['Blast Wave', 'multi', 2], ['Flamestrike', 'multi', 3], ['Frost Nova', 'multi', 2], ['Arcane Explosion', 'multi', 3], ['Fireball', 'spam'], ['Fire Blast', 'spam']] },
    arcane: { st: [['Arcane Power', 'elite'], ['Presence of Mind', 'elite'], ['Arcane Missiles', 'spam'], ['Frostbolt', 'spam'], ['Fire Blast', 'spam'], ['Frost Nova', 'emergency', 50]],
      aoe: [['Arcane Power', 'multi', 3], ['Arcane Explosion', 'multi', 2], ['Frost Nova', 'multi', 2], ['Blizzard', 'multi', 3], ['Frostbolt', 'spam']] },
  },
  9: {
    affli: { st: [['Curse of Agony', 'debuff'], ['Corruption', 'debuff'], ['Siphon Life', 'debuff'], ['Immolate', 'debuff'], ['Drain Soul', 'execute', 15], ['Shadow Bolt', 'spam']],
      aoe: [['Corruption', 'debuffAll'], ['Curse of Agony', 'debuffAll'], ['Siphon Life', 'debuffAll'], ['Howl of Terror', 'multi', 3], ['Hellfire', 'multi', 3], ['Rain of Fire', 'multi', 3], ['Shadow Bolt', 'spam']] },
    demo: { st: [['Curse of Agony', 'debuff'], ['Corruption', 'debuff'], ['Immolate', 'debuff'], ['Drain Soul', 'execute', 15], ['Shadow Bolt', 'spam']],
      aoe: [['Corruption', 'debuffAll'], ['Curse of Agony', 'debuffAll'], ['Hellfire', 'multi', 3], ['Rain of Fire', 'multi', 3], ['Howl of Terror', 'multi', 3], ['Shadow Bolt', 'spam']] },
    destro: { st: [['Immolate', 'debuff'], ['Curse of Agony', 'debuff'], ['Conflagrate', 'spam'], ['Shadowburn', 'execute', 20], ['Shadow Bolt', 'spam']],
      aoe: [['Rain of Fire', 'multi', 3], ['Hellfire', 'multi', 3], ['Immolate', 'debuffAll'], ['Corruption', 'debuffAll'], ['Shadow Bolt', 'spam']] },
  },
  11: {
    feral: { st: [['Faerie Fire (Feral)', 'debuff'], ['Rake', 'debuff'], ['Rip', 'finisher', 5], ['Ferocious Bite', 'finisher', 5], ['Claw', 'spam'], ['Enrage', 'lowrage', 20], ['Maul', 'rage', 20], ['Demoralizing Roar', 'debuff']],
      aoe: [['Swipe', 'multi', 2], ['Demoralizing Roar', 'multi', 2], ['Enrage', 'lowrage', 20], ['Maul', 'rage', 30], ['Faerie Fire (Feral)', 'debuff'], ['Claw', 'spam'], ['Ferocious Bite', 'finisher', 4]] },
    balance: { st: [['Moonkin Form', 'buff'], ['Faerie Fire', 'debuff'], ['Insect Swarm', 'debuff'], ['Moonfire', 'debuff'], ['Starfire', 'spam'], ['Wrath', 'spam']],
      aoe: [['Moonkin Form', 'buff'], ['Hurricane', 'multi', 3], ['Moonfire', 'debuffAll'], ['Insect Swarm', 'debuffAll'], ['Wrath', 'spam']] },
    resto: { st: [['Insect Swarm', 'debuff'], ['Moonfire', 'debuff'], ['Wrath', 'spam']],
      aoe: [['Hurricane', 'multi', 3], ['Moonfire', 'debuffAll'], ['Insect Swarm', 'debuffAll'], ['Wrath', 'spam']] },
  },
};
function rotationSpec(c) {
  const R = ROTATIONS[c.cls] || {}; const b = c.cfg && c.cfg.talentBuild;
  if (R[b]) return b; return Object.keys(R)[0];
}
/* the priority list a mode gives (rules like the custom ones: {n, mode, p}) */
function presetRules(c, mode) {
  const R = (ROTATIONS[c.cls] || {})[rotationSpec(c)]; if (!R) return null;
  const list = (R[mode] || R.st).concat(ROT_COMMON[c.cls] || []); const out = []; const seen = new Set();
  // the most important first: defensive cooldowns of the common list go before the damage
  const def = list.filter((x) => x[1] === 'emergency' || x[1] === 'heal'); const rest = list.filter((x) => x[1] !== 'emergency' && x[1] !== 'heal');
  for (const [n, md, p] of def.concat(rest)) { if (seen.has(n)) continue; seen.add(n); out.push({ n, mode: md, p: p != null ? p : (MODE_HAS_P[md] ? 30 : undefined), preset: true }); }
  // support rules of my own list (pets, conjuring, forms)
  for (const r of c.cfg.rules || []) if (ROT_KEEP_MODES.has(r.mode) && !seen.has(r.n)) { seen.add(r.n); out.push(r); }
  return out;
}
/* the rules the character fights with right now */
function rulesOf(c) {
  const mode = c.cfg && c.cfg.rotation; if (!mode || mode === 'custom') return c.cfg ? c.cfg.rules : [];
  const r = rt(c); const key = mode + '|' + rotationSpec(c) + '|' + c.cfg.rules.length;
  if (!r.rotCache || r.rotCache.key !== key) r.rotCache = { key, rules: presetRules(c, mode) || c.cfg.rules };
  return r.rotCache.rules;
}
function rotationHtml(c) {
  const mode = c.cfg.rotation || 'custom'; const spec = rotationSpec(c); const b = (TALENT_BUILDS[c.cls] || {})[spec];
  let h = '<div class="sgroup"><h5>Rotation</h5><div class="rotmodes">' + Object.keys(ROTATION_NAMES).map((k) => '<label class="pstyle' + (mode === k ? ' on' : '') + '"><input type="radio" name="rotm" data-rotm="' + k + '" value="' + k + '"' + (mode === k ? ' checked' : '') + '> ' + esc(ROTATION_NAMES[k]) + '</label>').join('') + '</div>';
  if (mode !== 'custom') {
    const rules = rulesOf(c).filter((r) => c.known[r.n]);
    h += '<div class="small muted" style="margin:4px 0">The usual way to play ' + esc(b ? b.name.replace(/ \(leveling\)/, '') : CLASS_NAMES[c.cls]) + ' (from your talent build). It changes with the talent build. In raids the raid members play the same lists.</div>' +
      '<div class="rotlist">' + rules.map((r, i) => '<div class="small">' + (i + 1) + '. ' + spellIcon(spellRow(c.known[r.n])) + ' <b>' + esc(r.n) + '</b> <span class="muted">' + esc(MODE_TEXT[r.mode] || r.mode) + (MODE_HAS_P[r.mode] && r.p != null ? ' ' + r.p : '') + '</span></div>').join('') + '</div>' +
      '<button class="mini" data-rotcopy="1">Copy into my own list to change it</button>';
  }
  return h + '</div>';
}
function rotationChange(e) {
  const t = e.target; if (t.dataset.rotm == null) return false; const c = active();
  c.cfg.rotation = t.value; rt(c).rotCache = null; save(); renderSheet(); renderAbar(); return true;
}
function rotationClick(e) {
  const b = e.target.closest('[data-rotcopy]'); if (!b) return false; const c = active();
  const rules = presetRules(c, c.cfg.rotation || 'st'); if (!rules) return true;
  const rest = c.cfg.rules.filter((r) => !rules.some((x) => x.n === r.n)).map((r) => Object.assign({}, r, { mode: 'off' }));
  c.cfg.rules = rules.map((r) => { const o = Object.assign({}, r); delete o.preset; return o; }).concat(rest);
  const was = ROTATION_NAMES[c.cfg.rotation || 'st']; c.cfg.rotation = 'custom'; rt(c).rotCache = null; log('Copied the ' + was.toLowerCase() + ' list into your own list.'); save(); renderSheet(); return true;
}
