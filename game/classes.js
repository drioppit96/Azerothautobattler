'use strict';
/* classes.js - everything that makes the nine classes play differently:
   mana / energy / rage, spell casting (cast times, channels), spell power and spell crit, heals and shields,
   ranged attacks (Auto Shot, wands), combo points, druid forms, hunter and warlock pets, weapon imbues and totems,
   generic talent effects (stat auras and spell modifiers for every class), and the default ability rules. */

/* ------------------------------------------------------------------ ability rules per class
   modes: see MODE_TEXT. p = number for the mode. Order = default priority (first that fits is used). */
const R = (st, modes, def, extra) => Object.assign({ st, modes, def }, extra || {});
Object.assign(CLASS_META, {
  2: {   // Paladin
    'Lay on Hands': R('', ['off', 'emergency'], { mode: 'emergency', p: 15 }),
    'Divine Shield': R('', ['off', 'emergency'], { mode: 'emergency', p: 20 }),
    'Divine Protection': R('', ['off', 'emergency'], { mode: 'emergency', p: 25 }),
    'Holy Light': R('', ['off', 'heal', 'emergency'], { mode: 'heal', p: 35 }),
    'Flash of Light': R('', ['off', 'heal', 'emergency'], { mode: 'emergency', p: 50 }),
    'Hammer of Justice': R('', ['off', 'emergency', 'spam'], { mode: 'emergency', p: 40 }),
    'Seal of Command': R('', ['off', 'buff'], { mode: 'buff' }),
    'Seal of Righteousness': R('', ['off', 'buff'], { mode: 'buff' }),
    'Seal of the Crusader': R('', ['off', 'buff'], { mode: 'off' }),
    'Judgement': R('', ['off', 'spam'], { mode: 'spam' }),
    'Hammer of Wrath': R('', ['off', 'execute'], { mode: 'execute', p: 20 }),
    'Exorcism': R('', ['off', 'spam'], { mode: 'off' }),
    'Holy Shock': R('', ['off', 'spam'], { mode: 'spam' }),
    'Consecration': R('', ['off', 'multi'], { mode: 'multi', p: 2 }),
    'Blessing of Might': R('', ['off', 'buff'], { mode: 'buff' }),
    'Blessing of Wisdom': R('', ['off', 'buff'], { mode: 'off' }),
    'Blessing of Kings': R('', ['off', 'buff'], { mode: 'off' }),
    'Devotion Aura': R('', ['off', 'buff'], { mode: 'buff' }),
    'Retribution Aura': R('', ['off', 'buff'], { mode: 'off' }),
    'Sanctity Aura': R('', ['off', 'buff'], { mode: 'buff' }),
    'Righteous Fury': R('', ['off', 'buff'], { mode: 'off' }),
  },
  3: {   // Hunter
    'Call Pet': R('', ['off', 'pet'], { mode: 'pet' }),
    'Revive Pet': R('', ['off', 'pet'], { mode: 'pet' }),
    'Mend Pet': R('', ['off', 'petheal'], { mode: 'petheal', p: 40 }),
    'Aspect of the Hawk': R('', ['off', 'buff'], { mode: 'buff' }),
    'Aspect of the Monkey': R('', ['off', 'buff'], { mode: 'buff', p: 0 }),
    "Hunter's Mark": R('', ['off', 'opener', 'debuff'], { mode: 'opener' }),
    'Serpent Sting': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Concussive Shot': R('', ['off', 'flee', 'spam'], { mode: 'flee' }),
    'Rapid Fire': R('', ['off', 'spam', 'multi'], { mode: 'multi', p: 2 }),
    'Aimed Shot': R('', ['off', 'opener', 'spam'], { mode: 'opener' }),
    'Multi-Shot': R('', ['off', 'spam', 'multi'], { mode: 'spam' }),
    'Arcane Shot': R('', ['off', 'spam'], { mode: 'spam' }),
    'Mongoose Bite': R('', ['off', 'spam'], { mode: 'spam' }),
    'Counterattack': R('', ['off', 'spam'], { mode: 'spam' }),
    'Raptor Strike': R('', ['off', 'spam'], { mode: 'spam' }),
    'Wing Clip': R('', ['off', 'debuff'], { mode: 'off' }),
    'Feign Death': R('', ['off', 'emergency'], { mode: 'off', p: 10 }),
  },
  4: {   // Rogue
    'Evasion': R('', ['off', 'emergency', 'multi'], { mode: 'emergency', p: 45 }),
    'Adrenaline Rush': R('', ['off', 'multi', 'spam'], { mode: 'multi', p: 2 }),
    'Blade Flurry': R('', ['off', 'multi'], { mode: 'multi', p: 2 }),
    'Riposte': R('', ['off', 'spam'], { mode: 'spam' }),
    'Kick': R('', ['off', 'spam'], { mode: 'off' }),
    'Gouge': R('', ['off', 'emergency'], { mode: 'off', p: 30 }),
    'Slice and Dice': R('', ['off', 'finisher'], { mode: 'finisher', p: 2 }),
    'Eviscerate': R('', ['off', 'finisher'], { mode: 'finisher', p: 4 }),
    'Rupture': R('', ['off', 'finisher'], { mode: 'off', p: 4 }),
    'Kidney Shot': R('', ['off', 'finisher'], { mode: 'off', p: 3 }),
    'Expose Armor': R('', ['off', 'finisher'], { mode: 'off', p: 3 }),
    'Ghostly Strike': R('', ['off', 'spam'], { mode: 'spam' }),
    'Hemorrhage': R('', ['off', 'spam'], { mode: 'spam' }),
    'Sinister Strike': R('', ['off', 'spam'], { mode: 'spam' }),
    'Backstab': R('', ['off', 'spam'], { mode: 'off' }),
    'Sprint': R('', ['off', 'emergency'], { mode: 'off', p: 15 }),
    'Vanish': R('', ['off', 'emergency'], { mode: 'off', p: 10 }),
  },
  5: {   // Priest
    'Power Word: Fortitude': R('', ['off', 'buff'], { mode: 'buff' }),
    'Inner Fire': R('', ['off', 'buff'], { mode: 'buff' }),
    'Shadowform': R('', ['off', 'buff'], { mode: 'buff' }),
    'Desperate Prayer': R('', ['off', 'emergency'], { mode: 'emergency', p: 20 }),
    'Psychic Scream': R('', ['off', 'emergency', 'multi'], { mode: 'multi', p: 2 }),
    'Power Word: Shield': R('', ['off', 'opener', 'emergency'], { mode: 'opener', p: 80 }),
    'Renew': R('', ['off', 'emergency', 'heal'], { mode: 'emergency', p: 60 }),
    'Flash Heal': R('', ['off', 'emergency', 'heal'], { mode: 'emergency', p: 35 }),
    'Greater Heal': R('', ['off', 'emergency', 'heal'], { mode: 'heal', p: 30 }),
    'Heal': R('', ['off', 'emergency', 'heal'], { mode: 'heal', p: 35 }),
    'Lesser Heal': R('', ['off', 'emergency', 'heal'], { mode: 'heal', p: 35 }),
    'Vampiric Embrace': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Shadow Word: Pain': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Devouring Plague': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Mind Blast': R('', ['off', 'spam'], { mode: 'spam' }),
    'Holy Fire': R('', ['off', 'opener', 'spam'], { mode: 'opener' }),
    'Mind Flay': R('', ['off', 'spam'], { mode: 'spam' }),
    'Smite': R('', ['off', 'spam'], { mode: 'spam' }),
  },
  7: {   // Shaman
    'Lightning Shield': R('', ['off', 'buff'], { mode: 'buff' }),
    'Windfury Weapon': R('', ['off', 'buff'], { mode: 'buff' }),
    'Flametongue Weapon': R('', ['off', 'buff'], { mode: 'buff' }),
    'Rockbiter Weapon': R('', ['off', 'buff'], { mode: 'buff' }),
    'Strength of Earth Totem': R('', ['off', 'buff'], { mode: 'buff' }),
    'Grace of Air Totem': R('', ['off', 'buff'], { mode: 'off' }),
    'Mana Spring Totem': R('', ['off', 'buff'], { mode: 'off' }),
    'Healing Wave': R('', ['off', 'heal', 'emergency'], { mode: 'heal', p: 35 }),
    'Lesser Healing Wave': R('', ['off', 'heal', 'emergency'], { mode: 'emergency', p: 40 }),
    'Searing Totem': R('', ['off', 'spam', 'multi'], { mode: 'spam' }),
    'Stormstrike': R('', ['off', 'spam'], { mode: 'spam' }),
    'Flame Shock': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Earth Shock': R('', ['off', 'spam'], { mode: 'spam' }),
    'Lightning Bolt': R('', ['off', 'opener', 'spam'], { mode: 'opener' }),
    'Chain Lightning': R('', ['off', 'multi'], { mode: 'off', p: 2 }),
  },
  8: {   // Mage
    'Frost Armor': R('', ['off', 'buff'], { mode: 'buff' }),
    'Ice Armor': R('', ['off', 'buff'], { mode: 'buff' }),
    'Mage Armor': R('', ['off', 'buff'], { mode: 'off' }),
    'Arcane Intellect': R('', ['off', 'buff'], { mode: 'buff' }),
    'Conjure Water': R('', ['off', 'conjure'], { mode: 'conjure' }),
    'Conjure Food': R('', ['off', 'conjure'], { mode: 'conjure' }),
    'Ice Barrier': R('', ['off', 'buff', 'emergency'], { mode: 'emergency', p: 70 }),
    'Mana Shield': R('', ['off', 'emergency'], { mode: 'emergency', p: 35 }),
    'Ice Block': R('', ['off', 'emergency'], { mode: 'emergency', p: 12 }),
    'Evocation': R('', ['off', 'lowmana'], { mode: 'lowmana', p: 10 }),
    'Frost Nova': R('', ['off', 'multi', 'emergency'], { mode: 'multi', p: 2 }),
    'Cone of Cold': R('', ['off', 'multi'], { mode: 'multi', p: 2 }),
    'Arcane Explosion': R('', ['off', 'multi'], { mode: 'multi', p: 3 }),
    'Fire Blast': R('', ['off', 'spam', 'execute'], { mode: 'spam' }),
    'Pyroblast': R('', ['off', 'opener'], { mode: 'off' }),
    'Frostbolt': R('', ['off', 'spam', 'opener'], { mode: 'spam' }),
    'Fireball': R('', ['off', 'spam', 'opener'], { mode: 'spam' }),
    'Arcane Missiles': R('', ['off', 'spam'], { mode: 'off' }),
    'Scorch': R('', ['off', 'spam'], { mode: 'off' }),
  },
  9: {   // Warlock
    'Demon Armor': R('', ['off', 'buff'], { mode: 'buff' }),
    'Demon Skin': R('', ['off', 'buff'], { mode: 'buff' }),
    'Summon Voidwalker': R('', ['off', 'pet'], { mode: 'pet' }),
    'Summon Imp': R('', ['off', 'pet'], { mode: 'pet' }),
    'Summon Succubus': R('', ['off', 'pet'], { mode: 'off' }),
    'Summon Felhunter': R('', ['off', 'pet'], { mode: 'off' }),
    'Health Funnel': R('', ['off', 'petheal'], { mode: 'petheal', p: 30 }),
    'Death Coil': R('', ['off', 'emergency'], { mode: 'emergency', p: 30 }),
    'Fear': R('', ['off', 'emergency', 'multi'], { mode: 'off', p: 30 }),
    'Howl of Terror': R('', ['off', 'multi'], { mode: 'multi', p: 3 }),
    'Life Tap': R('', ['off', 'lowmana'], { mode: 'lowmana', p: 30 }),
    'Drain Soul': R('', ['off', 'execute'], { mode: 'execute', p: 20 }),
    'Curse of Agony': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Corruption': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Siphon Life': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Immolate': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Drain Life': R('', ['off', 'emergency', 'spam'], { mode: 'emergency', p: 50 }),
    'Shadowburn': R('', ['off', 'execute'], { mode: 'execute', p: 20 }),
    'Searing Pain': R('', ['off', 'spam'], { mode: 'off' }),
    'Shadow Bolt': R('', ['off', 'spam'], { mode: 'spam' }),
  },
  11: {  // Druid (form abilities are only used in that form)
    'Mark of the Wild': R('', ['off', 'buff'], { mode: 'buff' }),
    'Thorns': R('', ['off', 'buff'], { mode: 'buff' }),
    'Cat Form': R('', ['off', 'form'], { mode: 'form' }),
    'Bear Form': R('', ['off', 'form'], { mode: 'form' }),
    'Dire Bear Form': R('', ['off', 'form'], { mode: 'form' }),
    'Barkskin': R('', ['off', 'emergency'], { mode: 'emergency', p: 30 }),
    'Frenzied Regeneration': R('', ['off', 'emergency'], { mode: 'emergency', p: 35 }),
    'Healing Touch': R('', ['off', 'heal', 'emergency'], { mode: 'heal', p: 35 }),
    'Regrowth': R('', ['off', 'heal', 'emergency'], { mode: 'heal', p: 40 }),
    'Rejuvenation': R('', ['off', 'heal', 'emergency'], { mode: 'emergency', p: 60 }),
    'Enrage': R('', ['off', 'lowrage'], { mode: 'lowrage', p: 20 }),
    "Tiger's Fury": R('', ['off', 'spam'], { mode: 'off' }),
    'Faerie Fire (Feral)': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Demoralizing Roar': R('', ['off', 'multi', 'debuff'], { mode: 'multi', p: 2 }),
    'Swipe': R('', ['off', 'multi'], { mode: 'multi', p: 2 }),
    'Maul': R('', ['off', 'rage', 'spam'], { mode: 'rage', p: 25 }),
    'Rip': R('', ['off', 'finisher'], { mode: 'finisher', p: 4 }),
    'Ferocious Bite': R('', ['off', 'finisher'], { mode: 'finisher', p: 4 }),
    'Rake': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Claw': R('', ['off', 'spam'], { mode: 'spam' }),
    'Insect Swarm': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Moonfire': R('', ['off', 'debuff'], { mode: 'debuff' }),
    'Faerie Fire': R('', ['off', 'debuff'], { mode: 'off' }),
    'Starfire': R('', ['off', 'opener', 'spam'], { mode: 'opener' }),
    'Wrath': R('', ['off', 'spam'], { mode: 'spam' }),
  },
});
Object.assign(MODE_TEXT, {
  heal: 'Heal myself below %', finisher: 'Finisher at combo points', lowmana: 'When mana below %', execute: 'When target health below %',
  pet: 'Keep my pet', petheal: 'When pet health below %', conjure: 'Make food and water', form: 'Shift into this form',
});
Object.assign(MODE_HAS_P, { heal: 1, finisher: 1, lowmana: 1, execute: 1, petheal: 1 });

/* ------------------------------------------------------------------ class facts */
const CASTERS = { 5: 1, 8: 1, 9: 1 };             // fight from range with spells
const SPELL_CRIT_INT = { 2: 54, 3: 60, 5: 59.2, 7: 59.5, 8: 59.5, 9: 60.6, 11: 60 };
const FINISHERS = { 'Eviscerate': 1, 'Slice and Dice': 1, 'Rupture': 1, 'Kidney Shot': 1, 'Expose Armor': 1, 'Rip': 1, 'Ferocious Bite': 1 };
const FORM_BITS = { cat: 1, bear: 16 | 128 };
const PET_KINDS = {
  hunter: { name: 'Pet', stats: '1', dmg: 0.75, tank: true },
  imp: { name: 'Imp', stats: '416', dmg: 0.0, ranged: true, firebolt: true },
  voidwalker: { name: 'Voidwalker', stats: '1860', dmg: 0.45, tank: true },
  succubus: { name: 'Succubus', stats: '1863', dmg: 0.8, tank: false },
  felhunter: { name: 'Felhunter', stats: '417', dmg: 0.65, tank: true },
};
const SUMMON_PET = { 'Summon Imp': 'imp', 'Summon Voidwalker': 'voidwalker', 'Summon Succubus': 'succubus', 'Summon Felhunter': 'felhunter' };

function isCaster(c) { return !!CASTERS[c.cls] || (c.cls === 11 && !c.form) || (c.cls === 7 && c.level < 10); }
function isHunter(c) { return c.cls === 3; }
function usesMana(c) { return c.cls !== 1 && c.cls !== 4; }

/* ------------------------------------------------------------------ power */
/* 0 mana, 1 rage, 3 energy */
function powerType(c) {
  if (c.cls === 1) return 1; if (c.cls === 4) return 3;
  if (c.cls === 11) { if (c.form === 'bear') return 1; if (c.form === 'cat') return 3; }
  return 0;
}
function powerName(t) { return t === 1 ? 'Rage' : t === 3 ? 'Energy' : 'Mana'; }
function powerOf(c, t) { if (t === 1) return c.rage || 0; if (t === 3) return c.energy || 0; if (t === 0) return c.mana || 0; if (t === 4294967294 || t === -2) return c.hp; return 0; }
function powerMax(c, t) { if (t === 1 || t === 3) return 100; if (t === 0) return charStats(c).maxMana || 0; return charStats(c).maxHp; }
function addPower(c, t, v) {
  if (t === 1) c.rage = clamp((c.rage || 0) + v, 0, 100);
  else if (t === 3) c.energy = clamp((c.energy || 0) + v, 0, 100);
  else if (t === 0) c.mana = clamp((c.mana || 0) + v, 0, powerMax(c, 0));
}
function baseMana(c) { const cs = G.d.races.classstats[c.cls] && G.d.races.classstats[c.cls][c.level - 1]; return cs ? cs[1] : 0; }
/* cost of a spell in its own power: [type, amount] */
function spellCost(c, sp, name) {
  const pw = sp && sp.pw; if (!pw) return [0, 0];
  let t = pw[0], v = pw[1] || 0;
  if (pw[2] && t === 0) v = Math.round(baseMana(c) * pw[2] / 100);
  if (pw[2] && (t === 4294967294 || t === -2)) v = Math.round(charStats(c).maxHp * pw[2] / 100);
  if (c.cls === 1) return [t, abilityCost(c, sp, name)];
  v = spellMod(c, sp, 14, v);
  return [t === 4294967294 ? -2 : t, Math.max(0, Math.round(v))];
}

/* ------------------------------------------------------------------ talents: generic effects (all classes but warrior) */
/* talent passive auras and spell modifiers of this character, cached by stat version */
function talentAuras(c) {
  const r = rt(c);
  if (r.talAura && r.talAura.v === r.statVer) return r.talAura;
  const out = { v: r.statVer, auras: [], mods: [] };
  if (c.cls !== 1 && c.talents && typeof classTalents === 'function') {
    const D = classTalents(c.cls);
    for (const id in c.talents) {
      const t = D.byId[id]; const rank = c.talents[id]; if (!t || !rank || D.abil[t.name]) continue;
      const sp = spellRow(t.ranks[rank - 1]); if (!sp) continue;
      for (const e of sp.ef || []) {
        if (e.t !== 6 && e.t !== 35) continue;
        if (e.au === 107 || e.au === 108) out.mods.push({ op: e.mi, v: e.lo, pct: e.au === 108, fam: (sp.fam || [0])[0], mask: e.it || 0 });
        else out.auras.push([e.au, e.mi, e.lo]);
      }
    }
  }
  r.talAura = out; return out;
}
/* apply talent spell modifiers (op: 0 damage, 1 duration, 7 crit chance, 10 cast time, 11 cooldown, 14 cost, 15 crit bonus) */
function spellMod(c, sp, op, base) {
  if (!sp || !sp.fam || c.cls === 1) return base;
  const m = talentAuras(c).mods; if (!m.length) return base;
  let flat = 0, pct = 0;
  for (const x of m) {
    if (x.op !== op || x.fam !== sp.fam[0] || !x.mask || !((sp.fam[1] >>> 0) & (x.mask >>> 0))) continue;
    if (x.pct) pct += x.v; else flat += x.v;
  }
  return (base + flat) * (1 + pct / 100);
}
/* talent stat auras (called from charStats) */
function classTalentStats(c, s) {
  if (c.cls === 1) return;
  for (const [au, mi, v] of talentAuras(c).auras) {
    if (au === 80 || au === 137) { for (let i = 0; i < 5; i++) if (mi === -1 || mi === i) s[AURA_STAT[i]] = Math.round(s[AURA_STAT[i]] * (1 + v / 100)); continue; }
    if (au === 57) { s.scrit += v; continue; }
    if (au === 101) { s.armorPct = (s.armorPct || 0) + v; continue; }
    if (au === 136) { s.healPct = (s.healPct || 0) + v; continue; }
    if (au === 79) { if (mi === 1 || mi === 127 || mi === -1) s.dmgDone *= 1 + v / 100; else s.spellPct = (s.spellPct || 0) + v; continue; }
    if (au === 138 || au === 9) { s.haste = (s.haste || 0) + v; continue; }
    applyAura(s, au, mi, v);
  }
}

/* ------------------------------------------------------------------ spell numbers */
function castTime(c, sp) {
  let t = sp.cast && sp.cast < 60000 ? sp.cast : 0;
  if (!t) return 0;
  t = spellMod(c, sp, 10, t);
  const s = charStats(c); if (s.castHaste) t /= 1 + s.castHaste / 100;
  return Math.max(0, t / 1000);
}
function isChanneled(sp) { return (sp.fl || []).includes('channeled'); }
/* value of effect e at the caster's level (points per level above the spell's base level, capped at its max level) */
function effValue(c, sp, e, lo) {
  let v = lo != null ? lo : e.lo;
  if (e.ppl && sp.bl) v += e.ppl * Math.max(0, Math.min(c.level, sp.ml || c.level) - sp.bl);
  return v;
}
function spellPower(c, sp, heal) {
  const s = charStats(c); return heal ? (s.heal || 0) + (s.sd || 0) * 0 : (s.sd || 0);
}
function spellCritChance(c) {
  const s = charStats(c); return 1 + s.int / (SPELL_CRIT_INT[c.cls] || 60) + (s.scrit || 0);
}
/* one magic damage hit: level resist, crit 150%, spell power, talents */
function spellHit(c, sp, e, m, opts) {
  opts = opts || {};
  if (!m || m.st === 'dead') return 0;
  const lo = effValue(c, sp, e, e.lo), hi = effValue(c, sp, e, Math.max(e.lo, e.hi || e.lo));
  let v = lo + Math.random() * (hi - lo);
  v += (e.coef != null ? e.coef : 0.4) * spellPower(c, sp, false) * (opts.coefMul || 1);
  if (opts.cp) v += (e.cp || 0) * opts.cp;
  v = spellMod(c, sp, 0, v);
  const s = charStats(c); v *= s.dmgDone * (1 + (s.spellPct || 0) / 100);
  const diff = m.lvl - c.level;
  const miss = clamp(4 + Math.max(0, diff) * (diff > 2 ? 7 : 1) - (s.shit || 0), 1, 60);
  if (Math.random() * 100 < miss) { fx(m.x, m.y, 'resist', '#cfc6b0'); if (m.st === 'alive') engage(m, c); return 0; }
  let crit = false; if (Math.random() * 100 < spellMod(c, sp, 7, spellCritChance(c))) { v *= 1.5 + spellMod(c, sp, 15, 0) / 100; crit = true; }
  v = Math.max(1, Math.round(v));
  m.hp -= v; onMobDamaged(m); addThreat(m, c, v); meterDmg(c, v, sp.n);
  fx(m.x, m.y, v + (crit ? '!' : ''), crit ? '#ffd23a' : '#ffe58a');
  if (m.st === 'alive') engage(m, c);
  if (m.hp <= 0) killMob(c, m);
  return v;
}
function healSelf(c, v, label) {
  const s = charStats(c); v = Math.round(v * (1 + (s.healPct || 0) / 100));
  const r = rt(c); if (r.healOn && r.healOn !== c && typeof healOther === 'function') { const to = r.healOn; r.healOn = null; return healOther(c, to, v, label); }
  r.healOn = null;
  const before = c.hp; c.hp = Math.min(s.maxHp, c.hp + v); fx(c.pos.x, c.pos.y, '+' + Math.round(c.hp - before), '#5ee07a'); meterHeal(c, c.hp - before, label || 'Heal');
  return v;
}
function spellHeal(c, sp, e, lo, hi) {
  let v = effValue(c, sp, e, lo) + Math.random() * (effValue(c, sp, e, hi) - effValue(c, sp, e, lo));
  v += (e.coef != null ? e.coef : 0.5) * ((charStats(c).heal || 0) + (charStats(c).sd || 0) * 0.5);
  v = spellMod(c, sp, 0, v);
  if (Math.random() * 100 < spellCritChance(c)) v *= 1.5;
  return healSelf(c, v, sp.n);
}

/* ------------------------------------------------------------------ threat (pets tank) */
function addThreat(m, src, v) {
  if (src && src.isPet) { m.petThreat = (m.petThreat || 0) + v * (src.tank ? 2.2 : 0.6); return; }
  // in a group of your characters: threat per character (the tank makes more); the creature turns to the one it hates most
  if (src && src.id && typeof groupOf === 'function' && groupOf(src)) {
    m.cThr = m.cThr || {}; m.cThr[src.id] = (m.cThr[src.id] || 0) + v * (grpRole(src) === 'tank' ? 1.8 : 1);
    const cur = m.tgt;
    if (cur && cur !== src && m.st === 'chase' && cur.pos && cur.pos.map === src.pos.map && m.cThr[src.id] > (m.cThr[cur.id] || 0) * 1.1) m.tgt = src;
    m.charThreat = m.tgt && m.tgt.id ? m.cThr[m.tgt.id] || 0 : m.cThr[src.id]; return;
  }
  m.charThreat = (m.charThreat || 0) + v;
}

/* ------------------------------------------------------------------ casting */
/* start casting sp at tgt (mob or the character). returns true when the cast started or the spell went off */
function startCast(c, name, sp, tgt) {
  const r = rt(c); const ct = castTime(c, sp); const ch = isChanneled(sp) && sp.dur > 0;
  if (sp.gcd) r.gcdUntil = G.gameTime + Math.max(1, sp.gcd / 1000);
  if (!ct && !ch) { finishSpell(c, name, sp, tgt); return true; }
  r.cast = { name, sp, tgt, t: 0, total: ch ? spellMod(c, sp, 1, sp.dur) / 1000 : ct, ch };
  r.mv = null;
  if (ch) finishSpell(c, name, sp, tgt);       // a channel: effects go on now, the character is busy for its duration
  return true;
}
function finishSpell(c, name, sp, tgt) {
  const r = rt(c); const [pt, cost] = spellCost(c, sp, name);
  if (pt === -2) c.hp -= cost; else addPower(c, pt, -cost);
  startCooldown(c, name, sp);
  if (pt === 0 && cost > 0) r.lastCast = G.gameTime;
  if (tgt && tgt !== c && tgt.equip && tgt.pos) { buffOther(c, tgt, sp); return; }      // a buff on another character
  if (tgt && tgt.merc) { mercGiveBuff(c, null, tgt, name, sp); fx(tgt.merc.x, tgt.merc.y, name, '#9fe0ff'); return; }      // on a mercenary
  const mob = tgt && tgt !== c ? tgt : (sp.ef || []).some((e) => e.k === 'enemy' || e.k === 'area_enemy') ? r.tgt : null;
  applySpell(c, sp, mob, { name });
  fx(c.pos.x, c.pos.y, name, '#ffe9a8');
}
/* returns true while casting (the character does nothing else) */
function castStep(c, dt) {
  const r = rt(c); const k = r.cast; if (!k) return false;
  const enemy = k.tgt && k.tgt !== c;
  if (enemy && (k.tgt.st === 'dead' || k.tgt.st === 'evade')) { r.cast = null; return false; }
  if (r.flying || r.riding || r.ghost) { r.cast = null; return false; }
  k.t += dt;
  if (k.t >= k.total) { r.cast = null; if (!k.ch) finishSpell(c, k.name, k.sp, k.tgt); }
  return true;
}

/* ------------------------------------------------------------------ class-specific spell effects (called by applySpell) */
/* returns true when the effect was handled here */
function classEffect(c, sp, e, tgt, ctx) {
  const r = rt(c); const s = charStats(c); const name = sp.n;
  switch (e.t) {
    case 2: {   // direct damage: magic (spell power, resists) or physical (Eviscerate, Rake: armor, dodge)
      if (c.cls === 1) return false;
      const area = e.k === 'area_enemy';
      const cp = FINISHERS[name] ? (r.cpUse || 0) : 0;
      if (sp.sc === 0 && !area) {
        if (!tgt || tgt.st === 'dead') return true;
        let base = effValue(c, sp, e, e.lo) + Math.random() * Math.max(0, effValue(c, sp, e, e.hi || e.lo) - effValue(c, sp, e, e.lo)) + (e.cp || 0) * cp;
        if (name === 'Ferocious Bite') { base += c.energy * 2.5; c.energy = 0; }
        base = spellMod(c, sp, 0, base);
        playerSwing(c, tgt, s, { min: 0, max: 0, speed: 0 }, { bonus: base, yellow: true, name });
        if (tgt.st === 'alive') engage(tgt, c);
        if (tgt.hp <= 0 && tgt.st !== 'dead') killMob(c, tgt);
        return true;
      }
      const targets = area ? areaTargets(c, Math.min(30, e.ra || AOE_RADIUS), true) : tgt ? [tgt] : [];
      for (const m of targets) spellHit(c, sp, e, m, { cp });
      return true;
    }
    case 10: spellHeal(c, sp, e, e.lo, Math.max(e.lo, e.hi || e.lo)); return true;
    case 67: healSelf(c, s.maxHp, name); return true;                                    // Lay on Hands
    case 77:
      if (/Holy Light|Flash of Light/.test(name)) { spellHeal(c, sp, e, e.lo, Math.max(e.lo, e.hi || e.lo)); return true; }
      if (name === 'Judgement' && tgt) { judgement(c, tgt); return true; }
      return true;
    case 3:
      if (name === 'Life Tap') { const v = Math.round(effValue(c, sp, e) + s.sd * 0.8); c.hp = Math.max(1, c.hp - v); addPower(c, 0, v); fx(c.pos.x, c.pos.y, '+' + v + ' mana', '#6fa8ff'); return true; }
      return false;
    case 24: {   // conjure food / water / healthstone
      if (!e.it) return true;
      const u = useInfo(e.it);
      if (u && (u.kind === 'food' || u.kind === 'drink')) {      // mage food and water: a stack of 20 for everyone in the group who needs it
        const to = conjureFor(c, e.it); if (!to.length) to.push(c);
        for (const o of to) { const k = Math.max(0, CONJURE_STACK - bagCount(o, e.it)); if (k && addItem(o, e.it, k)) { if (o === c) log('Conjured ' + k + ' x ' + itemName(e.it) + '.'); else withLog(o, () => log(c.name + ' gives you ' + k + ' x ' + itemName(e.it) + '.')); } }
        return true;
      }
      const n = Math.max(1, Math.round(effValue(c, sp, e)));
      if (addItem(c, e.it, n)) log('Conjured ' + n + ' x ' + itemName(e.it) + '.');
      return true;
    }
    case 54: addBuff(c, Object.assign({}, sp, { dur: 1800000 }), { au: 0, mi: 0, lo: 0 }); { const b = r.buffs.find((x) => x.name === name); if (b) b.imbue = name; } dirty(c); return true;
    case 56: { const k = SUMMON_PET[name] || (c.cls === 3 ? 'hunter' : null); if (k) summonPet(c, k); return true; }
    case 109: if (c.pet) { c.pet.dead = false; c.pet.hp = Math.round(c.pet.maxhp * 0.15); log('Your pet is revived.'); } return true;
    case 80: if (tgt) { if (r.cpTgt !== tgt) { r.cp = 0; r.cpTgt = tgt; } r.cp = Math.min(5, (r.cp || 0) + Math.max(1, e.lo || 1)); } return true;
    case 87: case 88: case 89: case 90: totem(c, sp, e); return true;
    case 30: if (e.mi === 0) { addPower(c, 0, effValue(c, sp, e)); return true; } return false;
    case 6: case 35: {
      if (e.au === 69) { const v = Math.round(effValue(c, sp, e) + 0.1 * s.sd); r.absorb = { v, until: G.gameTime + (sp.dur || 30000) / 1000, name }; fx(c.pos.x, c.pos.y, name, '#9fe0ff'); addBuff(c, sp, { au: 0, mi: 0, lo: 0 }); return true; }
      if (e.au === 97) { r.manaShield = { v: Math.round(effValue(c, sp, e)), until: G.gameTime + (sp.dur || 60000) / 1000 }; addBuff(c, sp, { au: 0, mi: 0, lo: 0 }); return true; }
      if (e.au === 36) { setForm(c, e.mi, name); return true; }
      if (e.au === 42 && e.k === 'self' && e.tr && /Lightning Shield/.test(name)) { const t2 = spellRow(e.tr); const d = t2 && (t2.ef || []).find((x) => x.t === 2); r.dmgShield = { v: d ? effValue(c, t2, d) : 10, charges: 3, until: G.gameTime + (sp.dur || 600000) / 1000 }; addBuff(c, sp, { au: 0, mi: 0, lo: 0 }); return true; }
      if (e.au === 8 && (e.k === 'self' || e.k === 'friend')) {   // heal over time
        if (/Mend Pet|Health Funnel/.test(name)) { if (c.pet && !c.pet.dead) c.pet.hp = Math.min(c.pet.maxhp, c.pet.hp + effValue(c, sp, e) * (sp.dur || 5000) / (e.amp || 1000)); return true; }
        addBuff(c, sp, { au: 0, mi: 0, lo: 0 }); const b = r.buffs.find((x) => x.name === name);
        if (b) { b.hot = { v: effValue(c, sp, e) + (e.coef || 0.2) * (s.heal || 0) / Math.max(1, (sp.dur || 12000) / (e.amp || 3000)), every: (e.amp || 3000) / 1000, t: 0 }; }
        return true;
      }
      if (e.au === 23 && e.tr && tgt) {   // Arcane Missiles: the triggered missile becomes ticks on the target
        const t2 = spellRow(e.tr); const d = t2 && (t2.ef || []).find((x) => x.t === 2); if (!d) return true;
        const per = effValue(c, t2, d) + (d.coef != null ? d.coef : 0.24) * s.sd;
        addMobAura(c, tgt, { n: name, dur: sp.dur || 3000 }, { au: 3, lo: Math.round(spellMod(c, sp, 0, per)), amp: e.amp || 1000, magic: true });
        if (tgt.st === 'alive') engage(tgt, c); return true;
      }
      if (e.au === 53 && tgt) { addMobAura(c, tgt, { n: name, dur: sp.dur || 5000 }, { au: 3, lo: Math.round(effValue(c, sp, e) + (e.coef || 0.1) * s.sd), amp: e.amp || 1000, leech: true }); if (tgt.st === 'alive') engage(tgt, c); return true; }
      if (e.au === 3 && tgt && (e.k === 'enemy' || e.k === 'area_enemy') && c.cls !== 1) {
        const ticks = Math.max(1, (sp.dur || 12000) / (e.amp || 3000));
        let v = effValue(c, sp, e) + (e.coef != null ? e.coef : 0.15) * (sp.sc ? s.sd : s.ap * 0.2) / Math.max(1, ticks / 4);
        if (FINISHERS[name] && e.cp) v += e.cp * (r.cpUse || 0);
        const targets = e.k === 'area_enemy' ? areaTargets(c, e.ra || AOE_RADIUS, true) : [tgt];
        for (const m of targets) { addMobAura(c, m, { n: name, dur: spellMod(c, sp, 1, sp.dur || 12000) }, { au: 3, lo: Math.round(spellMod(c, sp, 0, v)), amp: e.amp || 3000, magic: !!sp.sc }); if (m.st === 'alive') engage(m, c); addThreat(m, c, 10); }
        return true;
      }
      if (FINISHERS[name] && e.au === 138 && e.k === 'self') {   // Slice and Dice: longer with more combo points
        addBuff(c, Object.assign({}, sp, { dur: (sp.dur || 6000) + 3000 * Math.max(0, (r.cpUse || 1) - 1) }), e); return true;
      }
      return false;
    }
    default: return false;
  }
}
/* paladin: the seal's damage, then the seal is gone */
function judgement(c, m) {
  const r = rt(c); const seal = (r.buffs || []).find((b) => /^Seal of/.test(b.name) && b.until > G.gameTime);
  if (!seal) return;
  const s = charStats(c); const sp = { n: 'Judgement', sc: 1, fam: [10, 0] };
  const v = Math.round((seal.sealDmg || (5 + c.level * 1.3)) * 3 + s.sd * 0.5);
  spellHit(c, sp, { lo: v * 0.9, hi: v * 1.1, coef: 0 }, m);
  seal.until = 0; dirty(c);
}
/* shaman totems: buffs (Strength of Earth ...) or a damaging totem (Searing) */
function totem(c, sp, e) {
  const r = rt(c); const name = sp.n; const dur = (sp.dur || 60000) / 1000;
  const L = c.level;
  const fx_ = { 'Strength of Earth Totem': [29, 0, 8 + L * 0.9], 'Grace of Air Totem': [29, 1, 10 + L * 0.9], 'Stoneskin Totem': [87, 127, -5],
    'Healing Stream Totem': [161, 0, 6 + L * 0.5], 'Mana Spring Totem': [85, 0, 6 + L * 0.4], 'Windfury Totem': [0, 0, 0] };
  if (/Searing|Magma|Fire Nova/.test(name)) {
    r.totemDmg = { name, until: G.gameTime + dur, every: /Searing/.test(name) ? 2.2 : 2, t: 0, v: Math.round(effValue(c, sp, e) + 3 + L * 0.7) };
    log('Placed ' + name + '.'); return;
  }
  const a = fx_[name] || [0, 0, 0];
  addBuff(c, Object.assign({}, sp, { dur: dur * 1000 }), { au: a[0], mi: a[1], lo: Math.round(a[2]) });
}
function totemStep(c, dt) {
  const r = rt(c); const t = r.totemDmg; if (!t) return;
  if (t.until < G.gameTime) { r.totemDmg = null; return; }
  const m = r.tgt; if (!m || m.st === 'dead' || !r.threats.length) return;
  t.t += dt; if (t.t < t.every) return; t.t = 0;
  spellHit(c, { n: t.name, sc: 2, fam: [11, 0] }, { lo: t.v * 0.9, hi: t.v * 1.1, coef: 0.08 }, m);
}

/* melee swings of paladins and shamans: seals and weapon imbues */
function classMeleeHit(c, m, s, w, d, crit, opts) {
  if (m.hp <= 0 || opts.extra) return;
  const r = rt(c); const L = c.level; const spd = w.speed || 2;
  for (const b of r.buffs || []) {
    if (b.until <= G.gameTime) continue;
    let v = 0, school = 1;
    if (b.name === 'Seal of Righteousness') v = (b.sealDmg || 1 + L * 0.2) * spd * 1.0 + (s.sd || 0) * 0.1;
    else if (b.name === 'Seal of Command' && Math.random() < 7 * spd / 60) { playerSwing(c, m, s, w, { extra: true, pct: 70, yellow: true, name: 'Seal of Command' }); if (m.hp <= 0) return; continue; }
    else if (b.imbue === 'Rockbiter Weapon') { v = (1 + L * 0.25) * spd; school = 0; }
    else if (b.imbue === 'Flametongue Weapon') { v = (2 + L * 0.3) * spd * 0.6 + (s.sd || 0) * 0.1; school = 2; }
    else if (b.imbue === 'Frostbrand Weapon' && Math.random() < 9 * spd / 60) { v = 10 + L * 1.5; school = 4; }
    else if (b.imbue === 'Windfury Weapon' && Math.random() < 0.2) { fx(c.pos.x, c.pos.y, 'Windfury', '#9fe0ff'); playerSwing(c, m, s, w, { extra: true, bonus: L * 0.9, yellow: true, name: 'Windfury' }); if (m.hp <= 0) return; continue; }
    if (v <= 0) continue;
    v = Math.max(1, Math.round(v * s.dmgDone)); m.hp -= v; addThreat(m, c, v); meterDmg(c, v, b.imbue || b.name); fx(m.x, m.y + 1, '' + v, school === 2 ? '#ff9a3c' : school === 4 ? '#9fd8ff' : '#ffe98a');
  }
}

/* ------------------------------------------------------------------ druid forms */
function formOfMi(mi) { return mi === 1 ? 'cat' : mi === 5 || mi === 8 ? 'bear' : mi === 28 ? 'shadow' : mi === 30 ? 'stealth' : mi === 3 ? 'travel' : null; }
function setForm(c, mi, name) {
  const f = formOfMi(mi);
  if (c.cls === 5) { if (f === 'shadow') { addBuff(c, Object.assign({}, spellRow(c.known[name]) || {}, { n: name, dur: 3600000 }), { au: 79, mi: 32, lo: 15 }); } return; }
  if (c.cls !== 11 || (f !== 'cat' && f !== 'bear')) return;
  if (c.form === f) return;
  c.form = f; if (f === 'bear') c.rage = 10 * ((typeof talentRank === 'function' && talentRank(c, 'Furor')) ? 1 : 0); if (f === 'cat') c.energy = 0;
  dirty(c); log('Shifted into ' + name + '.');
}
function leaveForm(c) {
  if (c.cls !== 11 || !c.form) return;
  const r = rt(c); for (const b of r.buffs || []) if (/Form$/.test(b.name)) b.until = 0;
  c.form = null; r.queued = null; dirty(c);
}
/* the druid's form for fighting: cat from level 20, bear from 10, else caster */
function wantedForm(c) {
  if (c.cls !== 11) return null;
  const pref = c.cfg.form || 'auto';
  if (pref === 'caster') return null;
  const cat = c.known && c.known['Cat Form'], bear = c.known && (c.known['Dire Bear Form'] || c.known['Bear Form']);
  if (pref === 'cat') return cat ? 'cat' : null; if (pref === 'bear') return bear ? 'bear' : null;
  return cat ? 'cat' : bear ? 'bear' : null;
}
function formSpellName(c, f) { return f === 'cat' ? 'Cat Form' : c.known['Dire Bear Form'] ? 'Dire Bear Form' : 'Bear Form'; }
/* spell can be used in the current form (druid, rogue stealth) */
function formOk(c, name) {
  if (c.cls !== 11) return true;
  const id = c.known && c.known[name]; const st = id && G.d.stances ? G.d.stances[id] : null;
  const need = st ? st[0] & (FORM_BITS.cat | FORM_BITS.bear) : 0;
  if (/Form$/.test(name)) return true;
  if (need) return (c.form === 'cat' && (need & FORM_BITS.cat)) || (c.form === 'bear' && (need & FORM_BITS.bear));
  return !c.form;      // caster spells need caster form
}
/* druid / feral weapon in forms */
function formWeapon(c) {
  const L = c.level;
  if (c.form === 'cat') return { min: Math.max(1, L * 0.85), max: Math.max(2, L * 1.25), speed: 1.0, name: 'Cat claws', school: 0, form: true };
  if (c.form === 'bear') return { min: Math.max(2, L * 2.0), max: Math.max(3, L * 3.0), speed: 2.5, name: 'Bear paws', school: 0, form: true };
  return null;
}

/* ------------------------------------------------------------------ pets */
function petBase(c, kind) {
  const k = PET_KINDS[kind]; const tbl = G.d.pets && G.d.pets[k.stats]; const L = c.level;
  const row = tbl && (tbl[L] || tbl[Math.max(...Object.keys(tbl).map(Number).filter((x) => x <= L))]);
  const hp = row ? row[0] : fbHp(L, 0) * 0.9; const armor = row ? row[2] : fbArmor(L);
  const d = fbDmg(L, 0);
  return { hp: Math.round(hp * (kind === 'voidwalker' ? 1.0 : 1)), armor, dmin: d[0] * (k.dmg || 0.5), dmax: d[1] * (k.dmg || 0.5), atk: 2.0 };
}
function summonPet(c, kind) {
  const b = petBase(c, kind);
  c.pet = { kind, name: kind === 'hunter' ? (c.petName || 'Companion') : PET_KINDS[kind].name, maxhp: b.hp, hp: b.hp, level: c.level, dead: false };
  const r = rt(c); r.pet = { x: c.pos.x + 2, y: c.pos.y + 1, swing: 1 };
  log((kind === 'hunter' ? 'Called ' : 'Summoned ') + c.pet.name + '.');
}
function petAlive(c) { return !!(c.pet && !c.pet.dead && rt(c).pet); }
function petStats(c) {
  const p = c.pet; if (p.level !== c.level) { const b = petBase(c, p.kind); const f = p.hp / p.maxhp; p.maxhp = b.hp; p.hp = Math.round(b.hp * f); p.level = c.level; }
  return petBase(c, p.kind);
}
/* the pet follows, attacks what the character fights, tanks (hunter pet, voidwalker), heals out of combat */
function petStep(c, dt) {
  const p = c.pet; if (!p || p.dead) return; const r = rt(c);
  if (!r.pet) r.pet = { x: c.pos.x + 2, y: c.pos.y + 1, swing: 1 };
  const P = r.pet; const kind = PET_KINDS[p.kind] || {};
  const m = r.tgt && r.tgt.st !== 'dead' && r.tgt.st !== 'evade' && (r.threats.length || r.tgt.st === 'chase' || r.petGo === r.tgt) ? r.tgt : null;
  if (!m) {
    if (!r.threats.length) { p.hp = Math.min(p.maxhp, p.hp + p.maxhp * 0.02 * dt); }
    const d = Math.hypot(c.pos.x + 2 - P.x, c.pos.y + 1 - P.y); if (d > 1) { const st = Math.min(d, 9 * dt); P.x += (c.pos.x + 2 - P.x) / d * st; P.y += (c.pos.y + 1 - P.y) / d * st; }
    return;
  }
  const st = petStats(c);
  const dx = m.x - P.x, dy = m.y - P.y, d = Math.hypot(dx, dy);
  const reach = kind.ranged ? 25 : MELEE_RANGE;
  if (d > reach) { const step = Math.min(d - reach + 0.3, 9 * dt); P.x += dx / d * step; P.y += dy / d * step; return; }
  P.swing -= dt; if (P.swing > 0) return; P.swing += kind.firebolt ? 2.5 : st.atk;
  let v;
  if (kind.firebolt) v = 5 + c.level * 1.6 + charStats(c).sd * 0.1;
  else v = rnd(st.dmin, st.dmax) * (1 - clamp(m.armor / (m.armor + 400 + 85 * c.level), 0, 0.75));
  v = Math.max(1, Math.round(v));
  if (Math.random() < 0.06) { fx(m.x, m.y, 'miss', '#cfc6b0'); return; }
  m.hp -= v; onMobDamaged(m); addThreat(m, { isPet: true, tank: !!kind.tank }, v); meterDmg(c, v, kind.firebolt ? 'Firebolt' : 'Attack', true); fx(m.x, m.y, '' + v, '#d7b98a');
  if (kind.tank && (m.petThreat || 0) <= (m.charThreat || 0) * 1.15 && (P.growlT || 0) <= G.gameTime) { m.petThreat = (m.charThreat || 0) * 1.3 + 20 + c.level * 3; P.growlT = G.gameTime + 5; fx(P.x, P.y, p.kind === 'hunter' ? 'Growl' : 'Torment', '#d7b98a'); }
  if (m.st === 'alive') engage(m, c);
  if (m.hp <= 0) killMob(c, m);
}
/* a creature attacks the pet instead of the character when the pet has more threat */
function mobVictimIsPet(m, c) {
  if (!petAlive(c)) return false;
  return (m.petThreat || 0) > (m.charThreat || 0) * 1.1;
}
function petTakeHit(c, m, d) {
  const p = c.pet; const st = petStats(c);
  d = Math.round(d * (1 - clamp(st.armor / (st.armor + 400 + 85 * m.lvl), 0, 0.75)));
  p.hp -= d; fx(rt(c).pet.x, rt(c).pet.y, '-' + d, '#ff9a8a');
  if (p.hp <= 0) { p.hp = 0; p.dead = true; log(p.name + ' has died.'); for (const x of threatsOf(c)) x.petThreat = 0; }
}

/* ------------------------------------------------------------------ ranged auto attacks */
function rangedWeapon(c) {
  const inst = c.equip[17]; if (!inst || isBroken(inst)) return null;
  const it = itemRow(inst.id); if (!it || !it.dm) return null;
  const wand = it.s === 19;
  if (wand && !(c.cls === 5 || c.cls === 8 || c.cls === 9)) return null;
  if (!wand && it.s !== 2 && it.s !== 3 && it.s !== 18) return null;
  const w = weaponInfo(inst) || { min: it.dm[0][0], max: it.dm[0][1], speed: (it.dl || 2000) / 1000 };
  return Object.assign({ wand }, w);
}
/* hunters shoot, wand users shoot when out of mana or as a filler; returns true when a shot happened */
function rangedStep(c, m, dt, d) {
  const w = rangedWeapon(c); if (!w) return false;
  if (d > 35 || (!w.wand && d < 8)) return false;
  if (w.wand && !(c.mana < charStats(c).maxMana * (c.cfg.wandAt || 25) / 100 || rt(c).noSpell)) return false;
  const r = rt(c); r.rangeT = (r.rangeT == null ? 0.5 : r.rangeT) - dt; if (r.rangeT > 0) return true;
  r.rangeT += w.speed / (1 + (charStats(c).haste || 0) / 100);
  const s = charStats(c); let v = rnd(w.min, w.max);
  let ammo = null;
  if (!w.wand) {
    const k = ammoKind(c); ammo = c.bags.find((x) => { const it = itemRow(x.id); return it && it.c === 6 && it.s === k; });
    if (!ammo) { if (!r.noAmmoLog) { r.noAmmoLog = true; log('Out of ' + (k === 3 ? 'bullets' : 'arrows') + '!'); } return false; }
    r.noAmmoLog = false; v += (itemRow(ammo.id).dps || 0) * w.speed;
    if (--ammo.n <= 0) c.bags.splice(c.bags.indexOf(ammo), 1);
    const mark = (m.auras || []).find((a) => a.key === "Hunter's Mark" && a.au === 127 && a.until > G.gameTime);
    v += (s.rap + (mark ? mark.val : 0)) / 14 * w.speed;
    if (Math.random() * 100 < 5 + Math.max(0, m.lvl - c.level) - s.hit) { fx(m.x, m.y, 'miss', '#cfc6b0'); return true; }
    v *= 1 - clamp(m.armor / (m.armor + 400 + 85 * c.level), 0, 0.75);
    if (Math.random() * 100 < s.crit) v *= 2;
  } else { if (Math.random() * 100 < 5 + Math.max(0, m.lvl - c.level)) { fx(m.x, m.y, 'miss', '#cfc6b0'); return true; } }
  if (w.wand) { const ws = (typeof talentRank === 'function') ? talentRank(c, 'Wand Specialization') : 0; if (ws) v *= 1 + (c.cls === 5 ? 0.05 : 0.125) * ws; }
  v = Math.max(1, Math.round(v * s.dmgDone)); m.hp -= v; onMobDamaged(m); addThreat(m, c, v); meterDmg(c, v, w.wand ? 'Shoot (wand)' : 'Auto Shot');
  fx(m.x, m.y, '' + v, '#fff'); if (m.st === 'alive') engage(m, c); if (m.hp <= 0) killMob(c, m);
  return true;
}

/* one shot of a hunter ability with the ranged weapon (Multi-Shot, Aimed Shot) */
function rangedHit(c, m, bonus, pct, name) {
  const w = rangedWeapon(c); if (!w || !m || m.st === 'dead') return 0; const s = charStats(c);
  let v = (rnd(w.min, w.max) + s.rap / 14 * w.speed) * (pct || 100) / 100 + (bonus || 0);
  if (Math.random() * 100 < 5 + Math.max(0, m.lvl - c.level) - s.hit) { fx(m.x, m.y, 'miss', '#cfc6b0'); if (m.st === 'alive') engage(m, c); return 0; }
  v *= 1 - clamp(m.armor / (m.armor + 400 + 85 * c.level), 0, 0.75);
  let crit = false; if (Math.random() * 100 < s.crit) { v *= 2; crit = true; }
  v = Math.max(1, Math.round(v * s.dmgDone)); m.hp -= v; onMobDamaged(m); addThreat(m, c, v); meterDmg(c, v, name || 'Shot');
  fx(m.x, m.y, v + (crit ? '!' : ''), crit ? '#ffd23a' : '#fff'); if (m.st === 'alive') engage(m, c); if (m.hp <= 0) killMob(c, m);
  return v;
}

/* ------------------------------------------------------------------ regeneration and resting */
function spiritRegen(c, s) {
  if (c.cls === 5 || c.cls === 8) return 12.5 + s.spi / 4;
  if (c.cls === 9) return 8 + s.spi / 4;
  return 15 + s.spi / 5;
}
/* called every 2 seconds by regenStep */
function powerTick(c, s, r) {
  if (usesMana(c)) {
    const max = s.maxMana || 0; let v = (s.mp5 || 0) * 0.4;
    if (G.gameTime - (r.lastCast || -99) > 5) v += spiritRegen(c, s) * (r.resting ? 1.0 : 1);
    if (r.drinking) v += r.drinking.tick;
    c.mana = Math.min(max, (c.mana || 0) + v);
  }
  if (c.cls === 4 || (c.cls === 11 && c.form === 'cat')) c.energy = Math.min(100, (c.energy || 0) + 20 * (1 + ((r.buffs || []).some((b) => b.name === 'Adrenaline Rush' && b.until > G.gameTime) ? 1 : 0)));
  if (r.hotTick) r.hotTick();
}
function hotStep(c, dt) {
  const r = rt(c);
  for (const b of r.buffs || []) if (b.hot && b.until > G.gameTime) { b.hot.t += dt; while (b.hot.t >= b.hot.every) { b.hot.t -= b.hot.every; healSelf(c, b.hot.v); } }
  totemStep(c, dt);
}
function drinkStep(c, dt) {
  const r = rt(c); const d = r.drinking; if (!d) return;
  if (r.threats && r.threats.length) { r.drinking = null; return; }
  d.left -= dt; if (d.left <= 0 || c.mana >= charStats(c).maxMana) r.drinking = null;
}
function autoDrink(c) {
  const r = rt(c); if (r.drinking || !usesMana(c)) return false;
  let best = -1, bv = 0;
  c.bags.forEach((x, i) => { const it = itemRow(x.id); const u = useInfo(x.id); if (!u || u.kind !== 'drink' || (it.rl || 0) > c.level) return; const v = drinkValue(x.id) + (isConjured(x.id) ? 1e7 : 0); if (v > bv) { bv = v; best = i; } });
  if (best < 0) return false;
  const inst = c.bags[best]; const v = drinkValue(inst.id);
  r.drinking = { tick: v / 9, left: 18 }; r.resting = true;
  log('Drinking ' + itemName(inst.id) + '.');
  inst.n--; if (inst.n <= 0) c.bags.splice(best, 1);
  return true;
}
/* total mana a drink gives over 18 s */
function drinkValue(id) {
  const it = itemRow(id); if (!it || !it.fx) return 0;
  for (const f of it.fx) { const sp = spellRow(f.id); if (!sp) continue; for (const e of sp.ef || []) if (e.t === 6 && (e.au === 24 || e.au === 85)) return e.lo * (sp.dur || 18000) / (e.amp || 3000) / (e.au === 85 ? 1 : 1); }
  return 0;
}

/* ------------------------------------------------------------------ out of combat: buffs, pets, forms, conjuring, healing up */
/* returns true while doing something (the order waits) */
function oocStep(c) {
  const r = rt(c); if (!c.cfg || !c.known) return false;
  if (G.gameTime - (r.oocT || -9) < 0.5) return false;   // checked twice a second
  r.oocT = G.gameTime;
  const s = charStats(c); const hpPct = c.hp / s.maxHp * 100; const mp = usesMana(c) && s.maxMana ? c.mana / s.maxMana * 100 : 100;
  for (const rule of rulesOf(c)) {
    if (rule.mode === 'off') continue;
    const u = abilityUsable(c, rule.n); if (!u.ok) continue; const sp = u.sp;
    const [pt, cost] = spellCost(c, sp, rule.n); if (powerOf(c, pt) < cost) continue;
    if ((r.cd[rule.n] || 0) > G.gameTime) continue;
    let go = false;
    if (rule.mode === 'pet') {
      if (c.cls === 9 && SUMMON_PET[rule.n]) { const want = SUMMON_PET[rule.n]; const better = want === 'voidwalker' || !c.known['Summon Voidwalker']; go = better && (!c.pet || c.pet.dead || (c.pet.kind !== want && want === 'voidwalker')); }
      if (c.cls === 3 && rule.n === 'Call Pet') go = !c.pet && c.level >= 10;
      if (c.cls === 3 && rule.n === 'Revive Pet') go = !!(c.pet && c.pet.dead);
    } else if (rule.mode === 'buff') {
      const dur = sp.dur || 0;
      go = (dur < 0 || dur >= 60000 || /Seal|Aspect|Weapon$|Totem|Form$|Shadowform/.test(rule.n)) && !hasBuff(c, rule.n) && !(/Totem/.test(rule.n) && !r.threats.length);
      if (/^Seal of/.test(rule.n)) go = false;          // seals are put on in the fight
      if (/Aspect of the Monkey/.test(rule.n) && c.known['Aspect of the Hawk']) go = false;
      if (c.cls === 11 && formOk(c, rule.n) === false) go = false;
    } else if (rule.mode === 'conjure') {
      const it = (sp.ef || []).find((e) => e.t === 24); if (!it) continue;
      go = mp > 40 && conjureFor(c, it.it).length > 0;
    } else if (rule.mode === 'heal' || (rule.mode === 'emergency' && /Heal|Light|Wave|Touch|Regrowth|Renew|Rejuv/.test(rule.n))) {
      go = hpPct < 70 && mp > 30 && (sp.ef || []).some((e) => e.t === 10 || e.t === 77 || (e.au === 8));
      if (go && (sp.ef || []).some((e) => e.au === 8) && hasBuff(c, rule.n)) go = false;
    } else if (rule.mode === 'petheal') go = petAlive(c) && c.pet.hp < c.pet.maxhp * 0.6 && mp > 30;
    else if (rule.mode === 'lowmana' && rule.n === 'Life Tap') go = mp < 60 && hpPct > 75;
    // a long buff that can go on others (Arcane Intellect, Fortitude, Mark of the Wild, Divine Spirit ...): the group too
    let who = c;
    if (!go && rule.mode === 'buff' && mp > 25) { who = groupBuffTarget(c, rule.n, sp); go = !!who; }
    if (!go) continue;
    if (c.cls === 11 && c.form && !formOk(c, rule.n)) { leaveForm(c); }
    if (!formOk(c, rule.n)) continue;
    startCast(c, rule.n, sp, who);
    return true;
  }
  // druid: back into the fighting form when everything else is done
  const wf = wantedForm(c);
  if (c.cls === 11 && wf !== c.form && hpPct > 60) {
    if (!wf) { leaveForm(c); return false; }
    const fn = formSpellName(c, wf); const id = c.known[fn]; const sp = id && spellRow(id);
    if (sp) { const [pt, cost] = spellCost(c, sp, fn); if (powerOf(c, pt) >= cost) { startCast(c, fn, sp, c); return true; } }
  }
  return false;
}
/* who needs conjured food / water: the mage and the group members near it (water only for those who use mana) that
   are low on it, can use it (level) and have room in the bags */
const CONJURE_STACK = 20;
function conjureFor(c, item) {
  const u = useInfo(item); const it = itemRow(item); const out = [];
  const who = typeof groupOf === 'function' && groupOf(c) ? groupChars(groupOf(c)).filter((o) => o === c || (o.pos.map === c.pos.map && Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) <= 40 && !rt(o).ghost)) : [c];
  for (const o of who) {
    if (it && (it.rl || 0) > o.level) continue;
    if (u && u.kind === 'drink' && !usesMana(o)) continue;
    if (bagCount(o, item) >= 5 || bagFree(o) < 1) continue;
    out.push(o);
  }
  return out;
}
/* buffs worth putting on the other members of the group: 9 minutes or longer and castable on a friend */
const GROUP_BUFF_SKIP = /Amplify Magic|Dampen Magic|Unending Breath|Detect|Water Walking|Levitate/;
function groupBuffable(name, sp) {
  if (GROUP_BUFF_SKIP.test(name) || !(sp.dur >= 540000)) return false;
  const au = (sp.ef || []).filter((e) => e.t === 6 || e.t === 35); return au.length > 0 && au.every((e) => e.k === 'friend');
}
function groupBuffTarget(c, name, sp) {
  if (!groupBuffable(name, sp)) return null;
  if (rt(c).party && typeof mercBuffTarget === 'function') { const u = mercBuffTarget(c, name); if (u) return u; }     // the mercenaries
  if (typeof groupOf !== 'function' || !groupOf(c)) return null;
  const g = groupOf(c);
  for (const o of groupChars(g)) {
    if (o === c || o.pos.map !== c.pos.map || o.hp <= 0 || rt(o).ghost || hasBuff(o, name)) continue;
    if (name === 'Thorns' && (g.members.find((m) => m.id === o.id) || {}).role !== 'tank') continue;     // Thorns: on the tank
    if (Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) <= 30) return o;
  }
  return null;
}
/* the aura of a friendly buff goes on another character */
function buffOther(c, to, sp) {
  for (const e of sp.ef || []) if ((e.t === 6 || e.t === 35) && (e.k === 'friend' || e.k === 'self')) addBuff(to, sp, e);
  fx(to.pos.x, to.pos.y, sp.n, '#9fe0ff');
  withLog(to, () => log(c.name + ' casts ' + sp.n + ' on you.'));
}
function hasBuff(c, name) { const r = rt(c); return (r.buffs || []).some((b) => b.name === name && b.until > G.gameTime + 3); }

/* ------------------------------------------------------------------ damage taken: shields */
/* returns the damage left after absorbs and mana shield */
function absorbDamage(c, d) {
  const r = rt(c);
  if (r.absorb && r.absorb.until > G.gameTime && r.absorb.v > 0) { const a = Math.min(d, r.absorb.v); r.absorb.v -= a; d -= a; if (r.absorb.v <= 0) { r.absorb = null; const b = (r.buffs || []).find((x) => x.name === 'Power Word: Shield' || x.name === 'Ice Barrier'); if (b) b.until = 0; } if (a) fx(c.pos.x, c.pos.y, 'absorb ' + a, '#9fe0ff'); }
  if (d > 0 && r.manaShield && r.manaShield.until > G.gameTime && r.manaShield.v > 0) { const a = Math.min(d, r.manaShield.v, (c.mana || 0) / 2); r.manaShield.v -= a; c.mana -= a * 2; d -= a; }
  return Math.round(d);
}
function damageShield(c, m) {
  const r = rt(c); const ds = r.dmgShield; if (!ds || ds.until < G.gameTime || ds.charges <= 0) return;
  ds.charges--; spellHit(c, { n: 'Lightning Shield', sc: 3, fam: [11, 0] }, { lo: ds.v, hi: ds.v, coef: 0.27 }, m);
  if (ds.charges <= 0) { const b = (r.buffs || []).find((x) => x.name === 'Lightning Shield'); if (b) b.until = 0; r.dmgShield = null; }
}

/* ------------------------------------------------------------------ fighting range */
/* how far from its target the character wants to stand */
function combatRange(c, m) {
  if (c.cls === 3 && rangedWeapon(c) && ammoCount(c) > 0) { if (m.tgt === c && Math.hypot(m.x - c.pos.x, m.y - c.pos.y) < 8) return MELEE_RANGE; return 28; }
  if (isCaster(c)) { if (c.mana < charStats(c).maxMana * 0.08 && !rangedWeapon(c)) return MELEE_RANGE; return 27; }
  return MELEE_RANGE;
}
/* rough damage per second, for deciding whether a pull is safe */
function classDps(c, s, red) {
  if (c.cls === 1 || c.cls === 4 || c.cls === 2 || (c.cls === 11 && c.form) || c.cls === 7) return Math.max(1, (s.mhDps + s.ohDps) * (1 - red) * s.dmgDone * 1.35);
  let best = 0;
  for (const rule of rulesOf(c) || []) {
    if (rule.mode === 'off' || !c.known[rule.n]) continue; const sp = spellRow(c.known[rule.n]); if (!sp) continue;
    const e = (sp.ef || []).find((x) => x.t === 2 && x.k === 'enemy'); if (!e) continue;
    const v = (effValue(c, sp, e, e.lo) + effValue(c, sp, e, Math.max(e.lo, e.hi))) / 2 + (e.coef || 0.4) * (s.sd || 0);
    best = Math.max(best, v / Math.max(1.5, castTime(c, sp)));
  }
  let dps = Math.max(best, rangedWeapon(c) ? 5 + c.level * 0.4 : 2 + c.level * 0.3);
  if (c.cls === 3) { const w = rangedWeapon(c); dps = w ? ((w.min + w.max) / 2 + (s.rap + s.agi) / 14 * w.speed) / w.speed * 1.3 : s.mhDps; }
  if (petAlive(c)) { const p = petStats(c); dps += (p.dmin + p.dmax) / 2 / p.atk; if (c.pet.kind === 'imp') dps += (5 + c.level * 1.6) / 2.5; }
  return Math.max(1, dps);
}

/* ------------------------------------------------------------------ starting gear */
const START_KIT = {
  1: { equip: { 15: 25, 4: 38, 6: 39, 7: 40 }, by: { 2: { 15: 37 }, 3: { 15: 12282 }, 6: { 15: 2361 }, 8: { 15: 37 }, 5: { 15: 25 } }, off: 2362 },
  2: { equip: { 15: 2361, 4: 45, 6: 44, 7: 43 } },
  3: { equip: { 15: 37, 17: 2504, 4: 127, 6: 6126, 7: 6127 } },
  4: { equip: { 15: 2092, 17: 2947, 4: 49, 6: 48, 7: 47 } },
  5: { equip: { 15: 36, 20: 6098, 6: 52, 7: 51 } },
  7: { equip: { 15: 36, 4: 154, 6: 147, 7: 129 } },
  8: { equip: { 15: 35, 20: 56, 6: 1395, 7: 55 } },
  9: { equip: { 15: 2092, 20: 57, 6: 1396, 7: 59 } },
  11: { equip: { 15: 36, 20: 6123, 6: 6124 } },
};
function startGear(race, cls) {
  const k = START_KIT[cls] || START_KIT[1]; const eq = Object.assign({}, k.equip, (k.by && k.by[race]) || {});
  if (eq[20]) { eq[4] = eq[20]; delete eq[20]; }
  if (cls === 1 && race !== 3 && race !== 6 && k.off) eq[16] = k.off;
  const food = { 1: 2070, 2: 117, 3: 2070, 4: 2070, 5: 4604, 6: 4540, 7: 2070, 8: 117 }[race] || 117;
  const bags = [[food, 4]]; if (usesMana({ cls })) bags.push([159, 4]);
  if (cls === 3) bags.push([2512, 200]);
  return { equip: eq, bags };
}
