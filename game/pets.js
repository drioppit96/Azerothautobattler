'use strict';
/* pets.js - hunter pets and warlock demons, as in the 1.12 game (data: gamedata/pets.json, script/wow_pets.py).

   Hunter (from level 10)
   - Tame Beast: the hunter tames a beast near it (a tameable family, its level or lower): 20 seconds of channeling while
     the beast attacks. The pet keeps the beast's level, attack speed and family (health / armor / damage of the family).
   - The pet levels up on its own (it gets experience from the kills, never past the hunter's level), has loyalty
     (Rebellious ... Best Friend) that grows while it is content or happy, and happiness that drops over time (faster in a
     fight) and comes back by feeding it the food its family eats (Feed Pet). Unhappy pets do 75% damage, happy ones 125%.
   - Training points = pet level x (loyalty level - 1). Beast Training: each ability rank costs the points of the server
     (a higher rank costs the difference). Abilities: Bite, Claw, Growl, Cower, Dash, Dive, Charge, Prowl, Screech,
     Furious Howl, Lightning Breath, Scorpid Poison, Thunderstomp, Shell Shield, Great Stamina, Natural Armor and the five
     resistances - each family only its own. The hunter knows a rank once it reaches its level (like its own spells).
   - Talents (Beast Mastery): Endurance Training, Thick Hide, Unleashed Fury, Ferocity, Bestial Discipline, Frenzy,
     Bestial Swiftness, Improved Mend Pet, Improved Revive Pet, Spirit Bond, Intimidation, Bestial Wrath.
   Warlock
   - Imp (Firebolt, Blood Pact, Fire Shield, Phase Shift), Voidwalker (Torment, Suffering, Sacrifice, Consume Shadows),
     Succubus (Lash of Pain, Seduction, Soothing Kiss, Lesser Invisibility), Felhunter (Devour Magic, Spell Lock,
     Tainted Blood, Paranoia). The ranks come with the warlock's level (the grimoires). Summoning one takes a Soul Shard
     (not the imp); Drain Soul on a dying creature that gives experience makes one.
   - Talents (Demonology): Improved Imp / Voidwalker / Succubus, Fel Intellect, Fel Stamina, Unholy Power, Master
     Summoner, Fel Domination, Master Demonologist, Demonic Sacrifice, Soul Link; Improved Firebolt, Improved Lash of Pain.
   Every ability can be switched on or off (autocast) in the Pet tab of the character window. */

const DEMON_OF = { 416: 'imp', 1860: 'voidwalker', 1863: 'succubus', 417: 'felhunter' };
const DEMON_ENTRY = { imp: 416, voidwalker: 1860, succubus: 1863, felhunter: 417 };
const SUMMON_PET = { 'Summon Imp': 'imp', 'Summon Voidwalker': 'voidwalker', 'Summon Succubus': 'succubus', 'Summon Felhunter': 'felhunter' };
const DEMON_NAME = { imp: 'Imp', voidwalker: 'Voidwalker', succubus: 'Succubus', felhunter: 'Felhunter' };
const LOYALTY = ['Rebellious', 'Unruly', 'Submissive', 'Dependable', 'Faithful', 'Best Friend'];
const LOYAL_UP = [5500, 11500, 17000, 23500, 31000, 39500];          // loyalty points to reach the next level (the server's)
const LOYAL_START = [2000, 4500, 7000, 10000, 13500, 17500];         // points at the start of each level
const HAPPY_STEP = 333000, HAPPY_MAX = 1050000;                       // unhappy < 333000 <= content < 666000 <= happy
const PET_XP_FACTOR = 0.05;                                           // a pet needs 5% of what a character of its level needs
const SOUL_SHARD = 6265, SHARD_KEEP = 5;            // shards do not stack: the warlock keeps a few
const PET_SPEED = 7;
/* the order a pet uses its abilities in (the first that fits) */
const PET_ORDER = {
  hunter: ['Growl', 'Charge', 'Dash', 'Dive', 'Shell Shield', 'Thunderstomp', 'Furious Howl', 'Screech', 'Scorpid Poison', 'Lightning Breath', 'Bite', 'Claw', 'Cower'],
  imp: ['Fire Shield', 'Firebolt'],
  voidwalker: ['Sacrifice', 'Suffering', 'Torment'],
  succubus: ['Seduction', 'Soothing Kiss', 'Lash of Pain'],
  felhunter: ['Spell Lock', 'Devour Magic', 'Tainted Blood'],
};
const PET_PASSIVE = new Set(['Great Stamina', 'Natural Armor', 'Fire Resistance', 'Frost Resistance', 'Nature Resistance', 'Shadow Resistance', 'Arcane Resistance', 'Paranoia']);
const PET_AUTO_OFF = new Set(['Cower', 'Prowl', 'Phase Shift', 'Lesser Invisibility']);
/* what the hunter spends training points on first (automatic training) */
const TRAIN_ORDER = ['Growl', 'Claw', 'Bite', 'Lightning Breath', 'Scorpid Poison', 'Screech', 'Furious Howl', 'Charge', 'Thunderstomp', 'Shell Shield', 'Dash', 'Dive', 'Great Stamina', 'Natural Armor'];
/* taming: which families a hunter prefers when it can choose (leveling: damage first, then the sturdy ones) */
const TAME_PREF = [2, 1, 11, 5, 4, 9, 27, 20, 6, 25, 26, 24, 7, 12, 3, 8, 21];
const FOOD_NAMES = { 1: 'Meat', 2: 'Fish', 3: 'Cheese', 4: 'Bread', 5: 'Fungus', 6: 'Fruit', 7: 'Raw Meat', 8: 'Raw Fish' };

function PETD() { const d = G.d.pets; return d && d.stats ? d : null; }
function petEntry(p) { return p.kind === 'hunter' ? 1 : DEMON_ENTRY[p.kind]; }
function petLvl(c) { return c.pet && c.pet.kind === 'hunter' ? c.pet.level || c.level : c.level; }
function petFam(p) { const D = PETD(); return p && p.kind === 'hunter' && D ? D.fam[p.fam] || null : null; }
function petRow(entry, L) {
  const D = PETD(); const t = D && D.stats[entry]; if (!t) return null;
  if (t[L]) return t[L]; let b = null, bl = -1; for (const k in t) { const n = +k; if (n <= L && n > bl) { bl = n; b = t[k]; } } return b;
}
function petRt(c) {
  const r = rt(c); if (!r.pet) r.pet = { x: c.pos.x + 2, y: c.pos.y + 1 };
  const P = r.pet; if (!P.cd) { P.cd = {}; P.buffs = []; P.swing = P.swing || 1; P.focus = 100; P.gcd = 0; P.t2 = 0; P.happyT = 0; P.loyT = 0; P.regT = 0; P.map = c.pos.map; }
  return P;
}
function petAlive(c) { return !!(c.pet && !c.pet.dead && c.pet.out !== false && rt(c).pet); }
function petTalent(c, n) { return typeof talentRank === 'function' ? talentRank(c, n) || 0 : 0; }
function petBuff(P, name) { const now = G.gameTime; return (P.buffs || []).find((b) => b.name === name && b.until > now) || null; }
function petAddBuff(P, b) { P.buffs = (P.buffs || []).filter((x) => x.until > G.gameTime && x.name !== b.name); P.buffs.push(b); return b; }

/* ------------------------------------------------------------------ creating pets */
function demonName(c, kind) {
  c.demonNames = c.demonNames || {};
  if (!c.demonNames[kind]) {
    const D = PETD(); const n = D && D.names[DEMON_ENTRY[kind]];
    c.demonNames[kind] = n && n[0].length && n[1].length ? n[0][Math.floor(Math.random() * n[0].length)] + n[1][Math.floor(Math.random() * n[1].length)] : DEMON_NAME[kind];
  }
  return c.demonNames[kind];
}
/* an old save: the pet without a family (a placeholder) becomes a wolf of the hunter's level; demons get their names */
function petMigrate(c) {
  const p = c.pet; if (!p || p.v === 2) return;
  if (p.kind === 'hunter') {
    Object.assign(p, { fam: p.fam || 1, e: p.e || 0, level: Math.min(c.level, p.level || c.level), xp: 0, loy: 3, lp: LOYAL_START[2], happy: 700000, abil: {}, auto: {}, atk: 2, out: true });
    if (!p.name || p.name === 'Companion') p.name = 'Wolf';
  } else if (DEMON_ENTRY[p.kind]) { p.e = DEMON_ENTRY[p.kind]; p.name = demonName(c, p.kind); }
  p.v = 2;
  if (p.kind === 'hunter') petAutoTrain(c, true);
}
function summonDemon(c, kind) {
  const r = rt(c);
  if ((r.buffs || []).some((b) => b.sacrifice && b.until > G.gameTime)) { for (const b of r.buffs) if (b.sacrifice) b.until = 0; dirty(c); }       // Demonic Sacrifice ends
  for (const b of r.buffs || []) if (b.name === 'Fel Domination') b.until = 0;          // used up
  c.pet = { kind, e: DEMON_ENTRY[kind], name: demonName(c, kind), dead: false, v: 2 };
  const st = petStats(c); c.pet.hp = st.maxhp; c.pet.mana = st.maxmana;
  r.pet = null; const P = petRt(c); P.x = c.pos.x + 2; P.y = c.pos.y + 1;
  log('Summoned ' + c.pet.name + ' (' + DEMON_NAME[kind] + ').');
}
function callPet(c) {
  const p = c.pet; if (!p || p.kind !== 'hunter' || p.dead) return;
  p.out = true; rt(c).pet = null; const P = petRt(c); P.x = c.pos.x + 2; P.y = c.pos.y + 1; log('Called ' + p.name + '.');
}
function dismissPet(c) {
  const p = c.pet; if (!p) return;
  if (p.kind === 'hunter') { p.out = false; log(p.name + ' is dismissed.'); } else { log(p.name + ' is banished.'); c.pet = null; }
  petLeft(c);
}
/* the pet is gone (dead, dismissed, sacrificed): what came from it ends */
function petLeft(c) {
  const r = rt(c); const P = r.pet; if (P) { P.cast = null; P.tgt = null; }
  for (const m of threatsOf(c)) m.petThreat = 0;
  let ch = false; for (const b of r.buffs || []) if (b.fromPet && b.until > G.gameTime) { b.until = 0; ch = true; }
  if (ch) dirty(c);
}
function petDie(c) {
  const p = c.pet; if (!p) return;
  log(p.name + ' has died.'); fx(rt(c).pet ? rt(c).pet.x : c.pos.x, rt(c).pet ? rt(c).pet.y : c.pos.y, 'DEAD', '#ff3b30');
  if (p.kind === 'hunter') { p.dead = true; p.hp = 0; } else c.pet = null;
  petLeft(c);
}

/* ------------------------------------------------------------------ stats */
function petKnown(c, name) {
  const p = c.pet; if (!p) return null;
  if (p.kind === 'hunter') return p.abil && p.abil[name] ? spellRow(p.abil[name]) : null;
  const D = PETD(); const dm = D && D.demons[p.e]; const l = dm && dm.ab[name]; if (!l) return null;
  let best = null; for (const [id, lv] of l) if (lv <= c.level || (dm.start || []).includes(id)) best = id;
  return best ? spellRow(best) : null;
}
function petAbilities(c) {
  const p = c.pet; if (!p) return [];
  if (p.kind === 'hunter') return Object.keys(p.abil || {});
  const D = PETD(); const dm = D && D.demons[p.e]; return dm ? Object.keys(dm.ab).filter((n) => petKnown(c, n)) : [];
}
function petAutoOn(c, name) {
  const p = c.pet; if (!p) return false;
  const a = p.kind === 'hunter' ? p.auto || {} : ((c.cfg.petAuto || {})[p.kind] || {});
  return name in a ? !!a[name] : !PET_AUTO_OFF.has(name);
}
function staHp(sta) { return Math.min(sta, 20) + Math.max(0, sta - 20) * 10; }
function petStats(c) {
  const p = c.pet; const r = rt(c); const P = petRt(c); const L = petLvl(c);
  const key = p.kind + L + '|' + (p.fam || 0) + '|' + Object.values(p.abil || {}).join(',') + '|' + (r.statVer || 0) + '|' + (p.atk || 2);
  if (P.stc && P.stc.k === key) return P.stc.s;
  const row = petRow(petEntry(p), L) || [fbHp(L, 0) * 0.6, 0, fbArmor(L) * 0.8, 20 + L, 20 + L, 20 + L * 2, 20, 20];
  let [hp0, mana0, ar0, str, agi, sta, int, spi] = row;
  const res = { holy: 0, fire: 0, nature: 0, frost: 0, shadow: 0, arcane: 0 };
  let addAr = 0;
  for (const n of p.kind === 'hunter' ? Object.keys(p.abil || {}) : []) {
    const sp = spellRow(p.abil[n]); if (!sp || !PET_PASSIVE.has(n)) continue;
    for (const e of sp.ef || []) {
      if (e.t !== 6) continue;
      if (e.au === 29 && e.mi === 2) sta += e.lo; else if (e.au === 22 && e.mi === 1) addAr += e.lo;
      else if (e.au === 22) for (let i = 0; i < 6; i++) if ((e.mi || 0) & (2 << i)) res[RES_NAMES[i]] += e.lo;
    }
  }
  const fam = petFam(p); const D = PETD(); const dm = p.kind === 'hunter' ? (fam ? fam.dm : 1) : ((D && D.demons[p.e] && D.demons[p.e].dm) || 1);
  let maxhp = hp0 + staHp(sta), maxmana = mana0 > 1 ? mana0 + Math.min(int, 20) + Math.max(0, int - 20) * 15 : 0;
  let armor = ar0 + agi * 2 + addAr;
  if (p.kind === 'hunter') { maxhp *= (fam ? fam.hp : 1) * (1 + 0.03 * petTalent(c, 'Endurance Training')); armor *= (fam ? fam.ar : 1) * (1 + 0.1 * petTalent(c, 'Thick Hide')); }
  else { maxhp *= 1 + 0.03 * petTalent(c, 'Fel Stamina'); maxmana *= 1 + 0.03 * petTalent(c, 'Fel Intellect'); }
  if (p.kind === 'felhunter') { const md = petTalent(c, 'Master Demonologist'); for (const k in res) if (k !== 'holy') res[k] += Math.round(0.2 * md * L); }
  const ap = Math.max(0, 2 * str - 20); const atk = p.kind === 'hunter' ? clamp(p.atk || 2, 1, 2.5) : 2;
  const wmin = Math.max(1, L - Math.floor(L / 4)), wmax = Math.max(2, L + Math.floor(L / 4));
  const per = (w) => (w + ap / 14 * 2) * dm * atk / 2;           // damage per second does not depend on the attack speed
  const s = { L, maxhp: Math.round(maxhp), maxmana: Math.round(maxmana), armor: Math.round(armor), ap, atk, dmin: per(wmin), dmax: per(wmax), str, agi, sta, int, spi, res,
    crit: 5 + (p.kind === 'hunter' ? 3 * petTalent(c, 'Ferocity') : 0), dodge: 5,
    dmgPct: p.kind === 'hunter' ? 1 + 0.04 * petTalent(c, 'Unleashed Fury') : p.kind === 'imp' ? 1 : 1 + 0.04 * petTalent(c, 'Unholy Power'),
    focusRegen: 6 * (1 + 0.1 * petTalent(c, 'Bestial Discipline')), manaRegen: (spi / 5 + 17) / 2 };
  P.stc = { k: key, s }; p.maxhp = s.maxhp;
  return s;
}
/* everything that changes the damage the pet does right now */
function petDmgMul(c, P, spell) {
  const p = c.pet; const st = petStats(c); let m = spell === 'Firebolt' ? 1 + 0.04 * petTalent(c, 'Unholy Power') : st.dmgPct;
  if (p.kind === 'hunter') { const h = petHappy(p); m *= h === 3 ? 1.25 : h === 1 ? 0.75 : 1; }
  const bw = petBuff(P, 'Bestial Wrath'); if (bw) m *= 1 + bw.dmg / 100;
  if (p.kind === 'succubus') m *= 1 + 0.02 * petTalent(c, 'Master Demonologist');
  if ((rt(c).buffs || []).some((b) => b.name === 'Soul Link' && b.until > G.gameTime)) m *= 1.03;
  return m;
}
function petHappy(p) { const h = p.happy == null ? HAPPY_STEP * 2 : p.happy; return h < HAPPY_STEP ? 1 : h < HAPPY_STEP * 2 ? 2 : 3; }
function petIsTank(c) {
  if (!petAlive(c)) return false; const p = c.pet;
  if (p.kind !== 'hunter' && p.kind !== 'voidwalker') return false;
  const taunt = p.kind === 'hunter' ? 'Growl' : 'Torment';
  if (!petKnown(c, taunt) || !petAutoOn(c, taunt)) return false;
  const party = rt(c).party; if (party && party.some((u) => u.role === 'tank' && !u.dead)) return false;     // a group with a tank: the pet does not take its creatures
  if (typeof groupOf === 'function' && groupOf(c) && groupChars(groupOf(c)).some((o) => o !== c && typeof grpRole === 'function' && grpRole(o) === 'tank')) return false;
  return true;
}

/* ------------------------------------------------------------------ hunter: training points and Beast Training */
function petTpTotal(p) { return (p.level || 1) * Math.max(0, (p.loy || 1) - 1); }
function petTpOf(name, id) { const l = (PETD() || { train: {} }).train[name] || []; const r = l.find((x) => x[0] === id); return r ? r[2] : 0; }
function petTpSpent(p) { let n = 0; for (const k in p.abil || {}) n += petTpOf(k, p.abil[k]); return n; }
function petTpFree(p) { return petTpTotal(p) - petTpSpent(p); }
/* the ranks this pet could learn now: [{name, id, rank, lv, cost, have}] (cost = the difference to the rank it has) */
function petTrainable(c) {
  const p = c.pet; const D = PETD(); if (!p || p.kind !== 'hunter' || !D) return [];
  const fam = petFam(p); const names = (fam ? fam.ab : []).concat(D.generic || []); const out = [];
  for (const n of names) {
    const l = D.train[n]; if (!l) continue; const have = p.abil && p.abil[n]; const hv = have ? petTpOf(n, have) : 0;
    const hi = have ? l.findIndex((x) => x[0] === have) : -1;
    for (let i = hi + 1; i < l.length; i++) {
      const [id, lv, tp] = l[i]; if (lv > p.level || lv > c.level) break;
      out.push({ name: n, id, rank: i + 1, lv, cost: Math.max(0, tp - hv), have });
    }
  }
  return out;
}
function petLearn(c, name, id, quiet) {
  const p = c.pet; const t = petTrainable(c).find((x) => x.name === name && x.id === id); if (!t) return false;
  if (t.cost > 0 && t.cost > petTpFree(p)) { if (!quiet) log('Not enough training points (' + t.cost + ' needed).'); return false; }
  p.abil = p.abil || {}; p.abil[name] = id; if (p.auto && !(name in p.auto)) p.auto[name] = !PET_AUTO_OFF.has(name);
  if (!quiet) log(p.name + ' learned ' + name + ' (Rank ' + t.rank + ').');
  rt(c).pet && (rt(c).pet.stc = null); return true;
}
/* the best ranks the training points pay for, in TRAIN_ORDER */
function petAutoTrain(c, quiet) {
  const p = c.pet; if (!p || p.kind !== 'hunter' || (c.cfg && c.cfg.petAutoTrain === false)) return;
  const learned = [];
  for (let guard = 0; guard < 40; guard++) {
    const can = petTrainable(c); let best = null;
    for (const n of TRAIN_ORDER) {
      const opts = can.filter((x) => x.name === n && (x.cost === 0 || x.cost <= petTpFree(p))); if (!opts.length) continue;
      best = opts[opts.length - 1]; break;
    }
    if (!best) break;
    petLearn(c, best.name, best.id, true); learned.push(best.name + ' ' + best.rank);
  }
  if (learned.length && !quiet) log(p.name + ' learned: ' + learned.join(', ') + '.');
}
function petUntrain(c) {
  const p = c.pet; if (!p || p.kind !== 'hunter') return;
  const cost = 1000 * Math.min(10, (p.untrained || 0) + 1);
  if (c.gold < cost) { log('Untraining costs ' + money(cost) + '.'); return; }
  c.gold -= cost; p.untrained = (p.untrained || 0) + 1; p.abil = {}; rt(c).pet && (rt(c).pet.stc = null);
  log(p.name + ' forgot its training (' + money(cost) + '). ' + petTpTotal(p) + ' training points to spend.');
  petAutoTrain(c);
}

/* ------------------------------------------------------------------ hunter: experience, loyalty, happiness, food */
function petXpNeed(L) { const r = G.d.xp.levels[L - 1]; return Math.max(1, Math.floor((r ? r.xp_to_next : 400) * PET_XP_FACTOR)); }
function petOnKill(c, m, share) {
  const p = c.pet; if (!p || p.kind !== 'hunter' || p.dead || p.out === false) {
    if (c.cls === 9) petShardOnKill(c, m); return;
  }
  // loyalty for the kill (the lower the level and the loyalty, the more)
  if (killXp({ level: p.level }, m) > 0) petLoyalty(c, Math.floor((100 - p.level) / 10) + (6 - (p.loy || 1)));
  if (p.level >= c.level) return;
  const xp = Math.round(killXp({ level: p.level }, m) * (share == null ? 1 : share)); if (xp <= 0) return;
  p.xp = (p.xp || 0) + xp;
  while (p.level < c.level && p.xp >= petXpNeed(p.level)) {
    p.xp -= petXpNeed(p.level); p.level++;
    const st = petStats(c); p.hp = st.maxhp; log(p.name + ' is now level ' + p.level + '.'); fx(rt(c).pet.x, rt(c).pet.y, 'Level ' + p.level, '#ffd866');
    petAutoTrain(c);
  }
  if (p.level >= c.level) p.xp = 0;
}
function petLoyalty(c, v) {
  const p = c.pet; if (!p) return;
  p.lp = (p.lp == null ? LOYAL_START[0] : p.lp) + v; p.loy = p.loy || 1;
  if (p.lp < 0) {
    if (p.loy > 1) { p.loy--; p.lp = LOYAL_START[p.loy - 1]; log(p.name + ' is now ' + LOYALTY[p.loy - 1] + ' (loyalty dropped - feed it).'); petTrimTraining(c); }
    else { log(p.name + ' is too unhappy and has run away!'); c.pet = null; petLeft(c); }
  } else if (p.lp > LOYAL_UP[p.loy - 1]) {
    if (p.loy < 6) { p.loy++; p.lp = LOYAL_START[p.loy - 1]; log(p.name + ' is now ' + LOYALTY[p.loy - 1] + ' (' + petTpTotal(p) + ' training points).'); petAutoTrain(c); }
    else p.lp = LOYAL_UP[5];
  }
}
/* fewer training points than spent (loyalty dropped): the most expensive abilities are forgotten */
function petTrimTraining(c) {
  const p = c.pet; while (p && petTpFree(p) < 0) {
    let worst = null, wv = -1; for (const k in p.abil) { const v = petTpOf(k, p.abil[k]); if (v > wv) { wv = v; worst = k; } }
    if (!worst || wv <= 0) break; delete p.abil[worst]; log(p.name + ' forgot ' + worst + '.');
  }
}
/* how much happiness a food gives this pet (the server's: by the item level against the pet's level) */
function petFoodBenefit(p, id) {
  const it = itemRow(id); const fam = petFam(p); if (!it || !it.ft || !fam || !fam.diet.includes(it.ft)) return -1;
  const d = (p.level || 1) - (it.il || 1); return d < 5 ? 35000 : d < 10 ? 17000 : d < 15 ? 8000 : 0;
}
function petFoodFor(c) {
  const p = c.pet; let best = -1, bv = 0, bil = 1e9;
  // the most it likes; of those what the hunter does not eat itself (raw meat, fish), then the cheapest
  c.bags.forEach((x, i) => { const v = petFoodBenefit(p, x.id); if (v <= 0) return; const own = useInfo(x.id) && useInfo(x.id).kind === 'food' ? 1 : 0; const il = ((itemRow(x.id) || {}).il || 0) + own * 1000; if (v > bv || (v === bv && il < bil)) { bv = v; bil = il; best = i; } });
  return best < 0 ? null : { idx: best, v: bv };
}
function petFeed(c, quiet) {
  const p = c.pet; const P = petRt(c); if (!p || p.kind !== 'hunter' || !petAlive(c) || petBuff(P, 'Feed Pet Effect')) return false;
  if (!c.known || !c.known['Feed Pet']) return false;
  const f = petFoodFor(c); if (!f) { if (!quiet && G.gameTime - (P.noFoodT || -999) > 600) { P.noFoodT = G.gameTime; log(p.name + ' is hungry, but there is no ' + petDietText(p) + ' in the bags.'); } return false; }
  const inst = c.bags[f.idx]; const name = itemName(inst.id); inst.n--; if (inst.n <= 0) c.bags.splice(f.idx, 1);
  petAddBuff(P, { name: 'Feed Pet Effect', ic: 'ability_hunter_beasttraining', until: G.gameTime + 20, feed: f.v, every: 2, t: 0 });
  if (!quiet) log(p.name + ' eats ' + name + '.');
  return true;
}
function petDietText(p) { const f = petFam(p); return f ? f.diet.filter((x) => x <= 6).map((x) => FOOD_NAMES[x].toLowerCase()).join(', ') : 'food'; }
function petKeeps(c, id) {
  if (c.cls === 9 && id === SOUL_SHARD) return true;
  if (c.cls === 3 && c.pet && c.pet.kind === 'hunter' && petFoodBenefit(c.pet, id) > 0) {
    let n = 0; for (const x of c.bags) if (petFoodBenefit(c.pet, x.id) > 0) n += x.n; return n <= 40;
  }
  return false;
}
/* at a vendor: food for the pet (what it eats, the best it likes) */
function autoBuyPetFood(c, v) {
  const p = c.pet; if (!v || !p || p.kind !== 'hunter' || G.state.settings.autoBuyFood === false) return;
  let have = 0; for (const x of c.bags) if (petFoodBenefit(p, x.id) > 0) have += x.n; if (have >= 10) return;
  let best = null;
  for (const x of vendorItems(v.e)) { const b = petFoodBenefit(p, x.id); if (b <= 0 || !repItemOk(c, x.id)) continue; const it = itemRow(x.id); const price = vendorPrice(c, x.id, v.e); const val = b * 1000 - (it.il || 0); if (!best || val > best.val) best = { id: x.id, val, price }; }
  if (!best || bagFree(c) <= 0 || c.gold < best.price * 2) return;
  const per = buyCount(best.id); const stacks = Math.min(2, Math.floor(c.gold * 0.1 / Math.max(1, best.price)));
  if (stacks >= 1 && addItem(c, best.id, per * stacks)) { c.gold -= stacks * best.price; log('Bought ' + per * stacks + ' x ' + itemName(best.id) + ' for ' + p.name + '.'); }
}

/* the pet is unhappy and there is nothing it eats in the bags: to the nearest vendor that sells its food */
function petFoodTrip(c) {
  const r = rt(c); const P = petRt(c); const now = G.gameTime; const o = c.order;
  if (!o || o.type === 'vendor' || o.type === 'dungeon' || r.party || now - (P.tripT || -9999) < 600 || c.gold < 100) return;
  P.tripT = now;
  const list = vendorsOnMap(c.pos.map).map((v) => [Math.hypot(v.x - c.pos.x, v.y - c.pos.y), v]).filter(([d, v]) => d < 1500 && behOf({ e: v.e }, c) !== 'A').sort((a, b) => a[0] - b[0]);
  for (const [, v] of list.slice(0, 30)) {
    if (!vendorItems(v.e).some((x) => petFoodBenefit(c.pet, x.id) > 0) || !vendorSafe(c, v)) continue;
    log(c.pet.name + ' is unhappy and there is no ' + petDietText(c.pet) + ' in the bags - going to ' + v.name + ' for food.');
    c.order = { type: 'vendor', label: v.name, vx: v.x, vy: v.y, e: v.e, auto: true, resume: o }; r.mv = null; r.tgt = null; renderOrder(); return;
  }
}

/* ------------------------------------------------------------------ warlock: soul shards, summoning */
function petShardOnKill(c, m) {
  if (c.cls !== 9) return;
  const a = (m.auras || []).find((x) => x.key === 'Drain Soul' && x.src === c && x.until > G.gameTime - 0.5);
  if (!a || killXp(c, m) <= 0) return;
  if (bagCount(c, SOUL_SHARD) >= SHARD_KEEP || bagFree(c) < 2) return;
  if (addItem(c, SOUL_SHARD, 1)) { log('Drain Soul: +1 Soul Shard (' + bagCount(c, SOUL_SHARD) + ').'); fx(c.pos.x, c.pos.y, 'Soul Shard', '#c56cf0'); }
}
/* the demon the warlock wants out: the one chosen in the Pet tab, else the voidwalker alone and the imp in a group */
function wantedDemon(c) {
  const has = (k) => c.known && c.known['Summon ' + DEMON_NAME[k]];
  const sac = c.cfg.petSacrifice; if (sac && petTalent(c, 'Demonic Sacrifice') && has(sac)) return sac;
  const ch = c.cfg.petChoice || 'auto';
  if (ch === 'none') return null;
  if (ch !== 'auto' && has(ch)) return ch;
  const grp = !!(rt(c).party && rt(c).party.length) || !!(typeof groupOf === 'function' && groupOf(c));
  if (grp && has('imp')) return 'imp';
  return has('voidwalker') ? 'voidwalker' : 'imp';
}
function summonReady(c, kind) {
  if (kind !== 'imp' && bagCount(c, SOUL_SHARD) < 1) return false;
  const r = rt(c); if ((r.buffs || []).some((b) => b.sacrifice && b.until > G.gameTime) && c.cfg.petSacrifice) return false;      // the sacrifice's buff is up
  return true;
}
/* the 'pet' rule of the warlock and the hunter (oocStep): should this spell be cast now */
function petRuleWants(c, name) {
  if (c.cls === 9 && SUMMON_PET[name]) return false;                 // the warlock's demon: petOoc (the one chosen in the Pet tab)
  if (c.cls === 3 && name === 'Call Pet') return !!(c.pet && !c.pet.dead && c.pet.out === false);
  if (c.cls === 3 && name === 'Revive Pet') return !!(c.pet && c.pet.dead);
  return false;
}
/* a summon / Call Pet / Revive Pet spell went off */
function petSummonSpell(c, name, sp) {
  if (SUMMON_PET[name]) {
    const kind = SUMMON_PET[name];
    if (sp && (sp.re || []).some((x) => x[0] === SOUL_SHARD)) { if (bagCount(c, SOUL_SHARD) < 1) { log('No Soul Shard to summon a ' + DEMON_NAME[kind] + '.'); return; } removeItem(c, SOUL_SHARD, 1); }
    summonDemon(c, kind); return;
  }
  if (name === 'Call Pet') { callPet(c); return; }
}
function petRevive(c, sp, e) {
  const p = c.pet; if (!p || !p.dead) return;
  const pct = (e && e.lo ? e.lo : 15) + 15 * petTalent(c, 'Improved Revive Pet');
  p.dead = false; p.out = true; const st = petStats(c); p.hp = Math.round(st.maxhp * pct / 100);
  p.happy = Math.max(0, (p.happy || 0) - 100000);         // a revived pet is less happy
  rt(c).pet = null; const P = petRt(c); P.x = c.pos.x + 2; P.y = c.pos.y + 1;
  log(p.name + ' is revived.');
}
/* cast time of summoning: Fel Domination (5.5 s faster) */
function petCastTimeMod(c, sp, t) {
  if (sp && SUMMON_PET[sp.n] && (rt(c).buffs || []).some((b) => b.name === 'Fel Domination' && b.until > G.gameTime)) return Math.max(0, t - 5500);
  return t;
}
/* the owner's spells that need the pet out (Mend Pet, Bestial Wrath, Intimidation, Health Funnel, Soul Link, Demonic Sacrifice) */
function petNeeded(c, name, sp) {
  if (!sp) return false;
  if (name === 'Revive Pet') return !(c.pet && c.pet.dead);
  if (name === 'Call Pet' || SUMMON_PET[name] || name === 'Tame Beast' || name === 'Fel Domination') return false;
  return (sp.ef || []).some((e) => e.ta === 5) && !petAlive(c);
}
/* an effect of the owner's spell on the pet; true when it was handled here */
function petSpellEffect(c, sp, e, tgt) {
  if (e.ta !== 5 && !(e.t === 1 && sp.n === 'Demonic Sacrifice')) return false;
  const name = sp.n; const p = c.pet; const P = petAlive(c) ? petRt(c) : null; const now = G.gameTime;
  if (name === 'Revive Pet' || name === 'Dismiss Pet' || name === 'Feed Pet' || name === 'Call Pet') return true;
  if (!P) return true;
  if (e.au === 8) {                      // Mend Pet, Health Funnel: heal over time on the pet
    const ticks = Math.max(1, (sp.dur || 5000) / (e.amp || 1000)); let v = effValue(c, sp, e);
    if (name === 'Health Funnel') v *= 1 + 0.1 * petTalent(c, 'Improved Health Funnel');
    v = spellMod(c, sp, 0, v);
    const imp = name === 'Mend Pet' ? petTalent(c, 'Improved Mend Pet') : 0;
    petAddBuff(P, { name, ic: sp.ic, until: now + ticks * (e.amp || 1000) / 1000, hot: { v, every: (e.amp || 1000) / 1000, t: 0 }, cleanse: imp ? (imp === 1 ? 15 : 50) : 0, funnel: name === 'Health Funnel' ? (sp.pw ? sp.pw[3] || 0 : 0) : 0 });
    return true;
  }
  if (name === 'Bestial Wrath') { if (e.au === 79) { petAddBuff(P, { name, ic: sp.ic, until: now + (sp.dur || 18000) / 1000, dmg: e.lo, immune: true }); fx(P.x, P.y, name, '#ff9a3c'); } return true; }
  if (name === 'Intimidation') { P.intim = e.tr || 24394; fx(P.x, P.y, name, '#ffe9a8'); return true; }
  if (name === 'Soul Link') {
    const a = spellRow(25228); const au = a ? (a.ef || []).filter((x) => x.au === 79) : [];
    addBuff(c, { n: 'Soul Link', ic: sp.ic, dur: -1 }, { au: 79, mi: 127, lo: au.length ? au[0].lo : 3 });
    const b = rt(c).buffs.find((x) => x.name === 'Soul Link'); if (b) { b.fromPet = true; b.ic = sp.ic; }
    return true;
  }
  if (name === 'Demonic Sacrifice') { demonicSacrifice(c); return true; }
  return true;
}
const SACRIFICE_BUFF = { imp: 18789, voidwalker: 18790, succubus: 18791, felhunter: 18792 };
function demonicSacrifice(c) {
  const p = c.pet; if (!p || !SACRIFICE_BUFF[p.kind]) return;
  const sp = spellRow(SACRIFICE_BUFF[p.kind]); const r = rt(c);
  log('Sacrificed ' + p.name + ': ' + (sp ? sp.n : 'its power') + ' for 30 minutes.');
  c.pet = null; petLeft(c);
  if (!sp) return;
  r.buffs = (r.buffs || []).filter((b) => !b.sacrifice);
  const b = { name: sp.n, ic: sp.ic || 'spell_shadow_psychicscream', auras: [], until: G.gameTime + (sp.dur || 1800000) / 1000, sacrifice: true };
  for (const e of sp.ef || []) {
    if (e.au === 79 && e.mi !== 127 && e.mi !== 1) b.auras.push([9002, e.mi, e.lo]);         // one school: +15% fire / shadow damage
    else if (e.au === 20) b.regenHp = { pct: e.lo, every: (e.amp || 4000) / 1000, t: 0 };
    else if (e.au === 21) b.regenMana = { pct: e.lo, every: (e.amp || 4000) / 1000, t: 0 };
  }
  r.buffs.push(b); dirty(c);
}

/* ------------------------------------------------------------------ the owner's side every step */
function petOwnerStep(c, dt) {
  const r = rt(c); const now = G.gameTime;
  for (const b of r.buffs || []) {                       // Fel Stamina / Fel Energy (Demonic Sacrifice): health or mana every 4 seconds
    if (b.until <= now || !(b.regenHp || b.regenMana)) continue;
    const x = b.regenHp || b.regenMana; x.t += dt; if (x.t < x.every) continue; x.t -= x.every;
    const s = charStats(c); if (b.regenHp) c.hp = Math.min(s.maxHp, c.hp + s.maxHp * x.pct / 100); else c.mana = Math.min(s.maxMana, (c.mana || 0) + s.maxMana * x.pct / 100);
  }
  if (!petAlive(c) && (r.buffs || []).some((b) => b.fromPet && b.until > now)) petLeft(c);          // Soul Link, Blood Pact ... end with the pet
  if (c.cls === 9 && !petAlive(c) && r.threats && r.threats.length && !r.cast) petFelDomination(c);
}
/* the demon died in a fight: Fel Domination, then a fast summon of a new one */
function petFelDomination(c) {
  const r = rt(c); if (!c.known || !c.known['Fel Domination']) return;
  const rule = rulesOf(c).find((x) => x.n === 'Fel Domination'); if (rule && rule.mode === 'off') return;
  const want = wantedDemon(c); if (!want) return; const sn = 'Summon ' + DEMON_NAME[want]; if (!c.known[sn] || !summonReady(c, want)) return;
  const fd = (r.buffs || []).some((b) => b.name === 'Fel Domination' && b.until > G.gameTime);
  if (!fd) { const u = abilityUsable(c, 'Fel Domination'); if (!u.ok || !abilityReady(c, 'Fel Domination', u.sp)) return; startCast(c, 'Fel Domination', u.sp, c); return; }
  const u = abilityUsable(c, sn); if (!u.ok) return; const [pt, cost] = spellCost(c, u.sp, sn); if (powerOf(c, pt) < cost * 0.5) return;
  startCast(c, sn, u.sp, c);
}
/* out of a fight (before the other out-of-combat things): taming, feeding, the sacrifice */
function petOoc(c, dt) {
  if (c.cls === 3) {
    if (c.pet && c.pet.kind === 'hunter') {
      if (petAlive(c) && petHappy(c.pet) < 3 && (c.pet.happy || 0) < HAPPY_MAX - 350000 && !petFeed(c) && petHappy(c.pet) === 1) petFoodTrip(c);
      return false;
    }
    return petTameStep(c, dt);
  }
  if (c.cls !== 9) return false;
  if (c.pet && c.cfg.petSacrifice && petTalent(c, 'Demonic Sacrifice') && c.pet.kind === c.cfg.petSacrifice && petAlive(c)) {
    const rule = rulesOf(c).find((x) => x.n === 'Demonic Sacrifice');
    if (rule && rule.mode === 'sacrifice') { const u = abilityUsable(c, 'Demonic Sacrifice'); if (u.ok && abilityReady(c, 'Demonic Sacrifice', u.sp)) { startCast(c, 'Demonic Sacrifice', u.sp, c); return true; } }
  }
  // the demon: summon the one wanted when it is not out (a Soul Shard for all but the imp)
  const want = wantedDemon(c);
  if (!want && c.pet && c.cfg.petChoice === 'none') { dismissPet(c); return false; }
  if (!want || (c.pet && c.pet.kind === want && !c.pet.dead)) return false;
  const sn = 'Summon ' + DEMON_NAME[want]; if (!c.known || !c.known[sn] || !summonReady(c, want)) {
    if (want !== 'imp' && c.known && c.known[sn] && !c.pet && c.known['Summon Imp'] && !((rt(c).buffs || []).some((b) => b.sacrifice && b.until > G.gameTime))) { const u = abilityUsable(c, 'Summon Imp'); if (u.ok) { const [pt, cost] = spellCost(c, u.sp, 'Summon Imp'); if (powerOf(c, pt) >= cost) { startCast(c, 'Summon Imp', u.sp, c); return true; } } }      // no shard yet: the imp until there is one
    return false;
  }
  if (c.pet && c.pet.kind !== want && c.pet.kind !== 'imp' && !summonReady(c, want)) return false;
  const u = abilityUsable(c, sn); if (!u.ok) return false;
  const [pt, cost] = spellCost(c, u.sp, sn); if (powerOf(c, pt) < cost || (rt(c).cd[sn] || 0) > G.gameTime) return false;
  startCast(c, sn, u.sp, c); return true;
}

/* ------------------------------------------------------------------ hunter: taming a beast */
function tameCandidate(c, m) {
  const D = PETD(); const b = D && D.beasts[m.e]; if (!b || m.st !== 'alive' || m.rank) return 0;
  if (m.lvl > c.level || m.lvl < Math.max(1, c.level - 6) || m.civ || behOf(m, c) === 'F' || (m.banUntil || 0) > G.gameTime) return 0;
  const pref = c.cfg.tameFamily && c.cfg.tameFamily !== 'auto' ? (+c.cfg.tameFamily === b[0] ? 0 : 30) : Math.max(0, TAME_PREF.indexOf(b[0]));
  const lvl = c.level - m.lvl; const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y);
  return 100 - pref * 2 - Math.abs(lvl - 2) * 3 - d / 15 - (b[1] < 2000 ? -4 : 0);
}
function petTameStep(c, dt) {
  const r = rt(c); const now = G.gameTime;
  if (c.pet || !c.known || !c.known['Tame Beast'] || c.cfg.petTame === false || r.party || (r.idleUntil || 0) > now || (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map))) { r.tame = null; return false; }
  if (r.tame && (r.tame.m.st !== 'alive' || now - r.tame.t0 > 90)) { if (r.tame.m.st === 'alive') r.tame.m.banUntil = now + 300; r.tame = null; }
  if (!r.tame) {
    if (now - (r.tameLook || -99) < 5) return false; r.tameLook = now;
    const W = ensureWorld(c.pos.map); let best = null, bs = 0;
    mobsNear(W, c.pos.x, c.pos.y, 90, (m) => { const s = tameCandidate(c, m); if (s > bs && packSize(W, m, c) === 0) { bs = s; best = m; } });
    if (!best) { if (!r.tameSaid) { r.tameSaid = true; log('Looking for a beast to tame (a tameable beast of level ' + Math.max(1, c.level - 6) + '-' + c.level + ' nearby).'); } return false; }
    r.tame = { m: best, t0: now }; r.tameSaid = false;
    const fam = PETD().fam[PETD().beasts[best.e][0]];
    log('Going to tame ' + (best.info ? best.info[1] : 'a beast') + ' (level ' + best.lvl + ' ' + (fam ? fam.n : 'beast') + ').');
  }
  return petTameGo(c);
}
/* walk to the beast and start Tame Beast (also when it already attacks) */
function petTameGo(c) {
  const r = rt(c); const t = r.tame; if (!t) return false; const m = t.m;
  const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y);
  if (d > 24) { goTo(c, m.x, m.y, 20, m.z); if (r.blocked) { r.blocked = false; m.banUntil = G.gameTime + 600; r.tame = null; } return true; }
  const sp = spellRow(c.known['Tame Beast']); if (!sp) { r.tame = null; return false; }
  r.mv = null; c.pos.o = Math.atan2(m.x - c.pos.x, m.y - c.pos.y);
  if (sp.gcd) r.gcdUntil = G.gameTime + 1.5;
  r.cast = { name: 'Tame Beast', sp, tgt: m, t: 0, total: (sp.dur || 20000) / 1000, ch: true, onEnd: () => tameDone(c, m) };
  if (m.st === 'alive') engage(m, c);
  log('Taming ' + (m.info ? m.info[1] : 'the beast') + ' ...');
  return true;
}
/* in a fight: the beast being tamed attacks - keep channeling instead of killing it */
function petTameFight(c) {
  const r = rt(c); const t = r.tame; if (!t || r.cast || c.pet) return false;
  if (t.m.st === 'dead' || t.m.st === 'evade') { r.tame = null; return false; }
  return petTameGo(c);
}
function tameDone(c, m) {
  const r = rt(c); r.tame = null;
  if (!m || m.st === 'dead' || m.st === 'evade' || c.pet) return;
  const D = PETD(); const b = D.beasts[m.e]; if (!b) return;
  const W = ensureWorld(m.wid != null ? m.wid : c.pos.map);
  m.st = 'dead'; m.tgt = null; m.hp = 0; m.respAt = G.gameTime + irnd(m.rmin, m.rmax); m.deadAt = G.gameTime - 99; m.skinned = true; m.tamed = true; W.active.delete(m); W.dead.push(m);
  const name = m.info ? m.info[1] : PETD().fam[b[0]].n;
  c.pet = { kind: 'hunter', e: m.e, fam: b[0], name, level: m.lvl, xp: 0, loy: 1, lp: LOYAL_START[0], happy: 166500, abil: {}, auto: {}, atk: (b[1] || 2000) / 1000, out: true, dead: false, v: 2 };
  const st = petStats(c); c.pet.hp = st.maxhp;
  r.pet = null; const P = petRt(c); P.x = m.x; P.y = m.y;
  r.threats = r.threats.filter((x) => x !== m); if (r.tgt === m) r.tgt = null;
  // what the beast knew: its family's attack at the rank of its level (it uses up training points the new pet does not
  // have yet - like in the game, the points come with loyalty)
  for (const n of ['Claw', 'Bite']) {
    const l = (PETD().fam[b[0]].ab || []).includes(n) && PETD().train[n]; if (!l) continue;
    let id = 0; for (const x of l) if (x[1] <= m.lvl) id = x[0]; if (id) { c.pet.abil[n] = id; c.pet.auto[n] = true; break; }
  }
  petAutoTrain(c, true);
  log('Tamed ' + name + ' - a level ' + m.lvl + ' ' + PETD().fam[b[0]].n + ' (attack speed ' + c.pet.atk.toFixed(1) + '). It is hungry: it eats ' + petDietText(c.pet) + '.');
  fx(c.pos.x, c.pos.y, 'Tamed!', '#7fe07f');
  save();
}
function abandonPet(c) {
  const p = c.pet; if (!p || p.kind !== 'hunter') return;
  log('Abandoned ' + p.name + '.'); c.pet = null; petLeft(c); rt(c).pet = null; save();
}

/* ------------------------------------------------------------------ the pet's turn */
function petStep(c, dt) {
  petOwnerStep(c, dt);
  const p = c.pet; if (!p) return; if (p.v !== 2) petMigrate(c);
  if (!c.pet || p.dead || p.out === false) return;
  const r = rt(c); const P = petRt(c); const now = G.gameTime; const st = petStats(c);
  if (p.hp == null || p.hp > st.maxhp) p.hp = Math.min(st.maxhp, p.hp == null ? st.maxhp : p.hp);
  if (st.maxmana && (p.mana == null || p.mana > st.maxmana)) p.mana = Math.min(st.maxmana, p.mana == null ? st.maxmana : p.mana);
  // left behind (a flight, a portal, the dungeon's door): it comes along
  if (P.map !== c.pos.map || Math.hypot(P.x - c.pos.x, P.y - c.pos.y) > 70) { P.x = c.pos.x + 2; P.y = c.pos.y + 1; P.map = c.pos.map; P.tgt = null; P.cast = null; }
  const fight = !!(r.threats && r.threats.length) || !!(P.tgt && P.tgt.st === 'chase');
  petTimers(c, p, P, st, dt, fight);
  if (!c.pet || p.dead) return;
  P.t2 += dt; if (P.t2 >= 2) { P.t2 = 0; petAurasOnOwner(c, P, st); }
  if ((P.stunUntil || 0) > now) return;
  if (P.cast) { petCastStep(c, P, st, dt); return; }
  if (P.charge) { petChargeStep(c, P, st, dt); return; }
  const m = petTarget(c, P);
  if (!m) { petIdle(c, P, st, dt); return; }
  P.tgt = m; P.phased = false;
  petFight(c, P, st, m, dt);
}
/* regeneration, happiness, loyalty, heals and damage over time on the pet */
function petTimers(c, p, P, st, dt, fight) {
  const now = G.gameTime;
  P.regT += dt;
  if (P.regT >= 2) {
    P.regT -= 2;
    P.focus = Math.min(100, P.focus + st.focusRegen * 2);
    if (st.maxmana) p.mana = Math.min(st.maxmana, (p.mana || 0) + st.manaRegen * 2 * (fight ? 0.6 : 1));
    if (!fight && !(P.cast && P.cast.ch)) p.hp = Math.min(st.maxhp, p.hp + st.maxhp * 0.025);          // out of a fight it heals up slowly
  }
  if (p.kind === 'hunter') {
    P.happyT += dt;
    if (P.happyT >= 7.5) { P.happyT -= 7.5; p.happy = Math.max(0, (p.happy == null ? HAPPY_STEP * 2 : p.happy) - (140 >> (p.loy || 1)) * 125 * (fight ? 1.5 : 1)); }
    P.loyT += dt;
    if (P.loyT >= 12) { P.loyT -= 12; const h = petHappy(p); petLoyalty(c, h === 3 ? 20 : h === 2 ? 10 : -20); if (!c.pet) return; }
    const sb = petTalent(c, 'Spirit Bond');
    if (sb) { P.sbT = (P.sbT || 0) + dt; if (P.sbT >= 10) { P.sbT -= 10; p.hp = Math.min(st.maxhp, p.hp + st.maxhp * sb / 100); if (c.hp > 0 && !rt(c).ghost) c.hp = Math.min(charStats(c).maxHp, c.hp + charStats(c).maxHp * sb / 100); } }
  }
  if (P.buffs && P.buffs.length) {
    for (const b of P.buffs) {
      if (b.until <= now - 0.01) continue;
      if (b.hot) { b.hot.t += dt; while (b.hot.t >= b.hot.every) { b.hot.t -= b.hot.every; const h0 = p.hp; p.hp = Math.min(st.maxhp, p.hp + b.hot.v); if (p.hp > h0) { fx(P.x, P.y, '+' + Math.round(p.hp - h0), '#5ee07a'); meterHeal(c, Math.round(p.hp - h0), b.name); } if (b.funnel) c.hp = Math.max(1, c.hp - b.funnel); if (b.cleanse && Math.random() * 100 < b.cleanse) petCleanse(P); } }
      if (b.feed) { b.t += dt; while (b.t >= b.every) { b.t -= b.every; p.happy = Math.min(HAPPY_MAX, (p.happy || 0) + b.feed); } }
      if (b.dot) { b.dot.t += dt; while (b.dot.t >= b.dot.every && p.hp > 0) { b.dot.t -= b.dot.every; petTakeHit(c, b.src || { lvl: c.level }, b.dot.v, { school: b.sc || 0, dot: true, name: b.name }); if (!c.pet || p.dead) return; } }
    }
    if (P.buffs.length > 8) P.buffs = P.buffs.filter((b) => b.until > now);
  }
}
function petCleanse(P) { const d = (P.buffs || []).find((b) => b.kind === 'debuff' && b.until > G.gameTime); if (d) { d.until = 0; fx(P.x, P.y, 'cleansed', '#9fe0ff'); } }
/* what the pet gives its master (and the group): Blood Pact, Master Demonologist, Soul Link stays while it lives */
function petAurasOnOwner(c, P, st) {
  const p = c.pet; const D = PETD(); const now = G.gameTime;
  const give = (o, name, ic, aura) => {
    const ro = rt(o); ro.buffs = ro.buffs || []; let b = ro.buffs.find((x) => x.name === name && x.fromPet);
    if (!b) { b = { name, ic, auras: [], until: 0, fromPet: true }; ro.buffs.push(b); }
    const ch = !b.auras.length || b.auras[0][2] !== aura[2] || b.until <= now; b.auras = [aura]; b.until = now + 5; b.ic = ic; if (ch) dirty(o);
  };
  if (p.kind === 'imp' && petAutoOn(c, 'Blood Pact')) {
    const sp = petKnown(c, 'Blood Pact');
    if (sp) {
      const e = sp.ef[0]; let v = e.lo + Math.trunc((e.ppl || 0) * Math.max(0, Math.min(c.level, sp.ml || c.level) - (sp.bl || 0))); v = Math.round(spellMod(c, sp, 8, v));
      const who = typeof groupOf === 'function' && groupOf(c) ? groupChars(groupOf(c)) : [c];
      for (const o of who) if (o.pos.map === c.pos.map && Math.hypot(o.pos.x - P.x, o.pos.y - P.y) <= 30 && !rt(o).ghost) give(o, 'Blood Pact', sp.ic, [29, 2, v]);
    }
  }
  const md = petTalent(c, 'Master Demonologist');
  if (md && D) {
    const rank = [23785, 23822, 23823, 23824, 23825][md - 1]; const aid = D.petauras[rank] && D.petauras[rank][p.e]; const a = aid && spellRow(aid);
    const e = a && (a.ef || [])[0];
    if (e && e.au !== 10) give(c, 'Master Demonologist', a.ic, [e.au, e.mi, Math.round(e.lo + (e.ppl || 0) * c.level)]);
  }
  const sl = (rt(c).buffs || []).find((b) => b.name === 'Soul Link' && b.until > now); if (sl) sl.until = now + 86400;
}
/* the target: the master's, or (as a tank) what is hitting the master */
function petTarget(c, P) {
  const r = rt(c); const ok = (m) => m && m.st !== 'dead' && m.st !== 'evade' && m.hp > 0 && !(m.auras || []).some((a) => a.key === 'Seduction' && a.until > G.gameTime);
  let m = r.tgt && ok(r.tgt) && (r.threats.length || r.tgt.st === 'chase' || r.petGo === r.tgt) ? r.tgt : null;
  if (!m && P.tgt && ok(P.tgt) && P.tgt.st === 'chase' && r.threats.includes(P.tgt)) m = P.tgt;
  if (petIsTank(c) && r.threats.length && !r.party) {
    const loose = r.threats.filter((x) => ok(x) && x.st === 'chase' && !mobVictimIsPet(x, c));
    if (loose.length && (!m || mobVictimIsPet(m, c))) { let b = null, bd = 1e9; for (const x of loose) { const d = Math.hypot(x.x - P.x, x.y - P.y); if (d < bd) { bd = d; b = x; } } m = b; }
  }
  return m;
}
function petSpeed(c, P) {
  let s = PET_SPEED; const now = G.gameTime;
  const d = petBuff(P, 'Dash') || petBuff(P, 'Dive'); if (d) s *= 1 + d.speed / 100;
  if (c.pet.kind === 'hunter' && petTalent(c, 'Bestial Swiftness') && !(typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map))) s *= 1.3;
  if (P.prowl) s *= 0.5;
  if (P.snare && P.snare.until > now) s *= P.snare.f;
  return s;
}
function petMove(P, x, y, stop, sp, dt) {
  const dx = x - P.x, dy = y - P.y, d = Math.hypot(dx, dy); if (d <= stop) return true;
  const st = Math.min(d - stop + 0.2, sp * dt); P.x += dx / d * st; P.y += dy / d * st; return false;
}
/* no fight: follow, heal up, buffs (Fire Shield, Consume Shadows), Prowl */
function petIdle(c, P, st, dt) {
  const p = c.pet; const now = G.gameTime; P.tgt = null;
  if (P.gcd <= now && petIdleSpell(c, P, st)) return;
  if (p.kind === 'imp' && petAutoOn(c, 'Phase Shift') && petKnown(c, 'Phase Shift')) P.phased = true;
  if (p.kind === 'hunter' && petAutoOn(c, 'Prowl') && petKnown(c, 'Prowl') && !P.prowl && P.focus >= 40 && (P.cd.Prowl || 0) <= now) { P.prowl = true; P.focus -= 40; }
  petMove(P, c.pos.x + 2, c.pos.y + 1, 1, petSpeed(c, P) * 1.2, dt);
}
function petIdleSpell(c, P, st) {
  const p = c.pet;
  if (p.kind === 'voidwalker' && p.hp < st.maxhp * 0.7 && petAutoOn(c, 'Consume Shadows')) { const sp = petKnown(c, 'Consume Shadows'); if (sp && petCanPay(c, P, sp)) { petStartCast(c, P, 'Consume Shadows', sp, null); return true; } }
  if (p.kind === 'imp' && petAutoOn(c, 'Fire Shield')) { const sp = petKnown(c, 'Fire Shield'); const t = petFireShieldTarget(c); if (sp && t && petCanPay(c, P, sp)) { petUse(c, P, 'Fire Shield', sp, t); return true; } }
  return false;
}
function petFireShieldTarget(c) {
  const has = (o) => (rt(o).buffs || []).some((b) => b.name === 'Fire Shield' && b.until > G.gameTime + 5);
  if (typeof groupOf === 'function' && groupOf(c)) { const t = groupChars(groupOf(c)).find((o) => o.pos.map === c.pos.map && typeof grpRole === 'function' && grpRole(o) === 'tank' && !rt(o).ghost && !has(o)); if (t) return t; }
  return has(c) ? null : c;
}
function petCanPay(c, P, sp) {
  const pw = sp.pw; if (!pw) return true;
  if (pw[0] === 2) return P.focus >= pw[1];
  const cost = pw[1] + (pw[2] ? Math.round(petStats(c).maxmana * pw[2] / 100 / 3) : 0);
  return (c.pet.mana || 0) >= cost;
}
function petPay(c, P, sp) {
  const pw = sp.pw; if (!pw) return;
  if (pw[0] === 2) P.focus = Math.max(0, P.focus - pw[1]);
  else { const cost = pw[1] + (pw[2] ? Math.round(petStats(c).maxmana * pw[2] / 100 / 3) : 0); c.pet.mana = Math.max(0, (c.pet.mana || 0) - cost); }
}
function petReady(c, P, name, sp) {
  const now = G.gameTime; if ((P.cd[name] || 0) > now) return false;
  if (sp.sc && (P.silenceUntil || 0) > now) return false;
  return petCanPay(c, P, sp);
}
function petStartCooldown(c, P, name, sp) {
  let cd = Math.max(sp.cd || 0, sp.catcd || 0); if (cd) { cd = spellMod(c, sp, 11, cd); P.cd[name] = G.gameTime + cd / 1000; }
  P.gcd = G.gameTime + (sp.gcd ? Math.max(1, sp.gcd / 1000) : 0);
}
function petStartCast(c, P, name, sp, tgt) {
  let ct = sp.cast && sp.cast < 60000 ? spellMod(c, sp, 10, sp.cast) / 1000 : 0; const ch = (sp.fl || []).includes('channeled') && sp.dur > 0;
  P.cast = { name, sp, tgt, t: 0, total: ch && !ct ? sp.dur / 1000 : Math.max(0, ct), ch: ch && !ct, chAfter: ch && ct > 0 };
  if (P.cast.ch) { petPay(c, P, sp); petStartCooldown(c, P, name, sp); petChannelStart(c, P, name, sp); }
  else if (!P.cast.total) { P.cast = null; petUse(c, P, name, sp, tgt); }
}
function petCastStep(c, P, st, dt) {
  const k = P.cast; const t = k.tgt;
  if (t && t.st != null && (t.st === 'dead' || t.st === 'evade')) { P.cast = null; return; }
  if (t && t.x != null && k.sp.rng && Math.hypot(t.x - P.x, t.y - P.y) > k.sp.rng[1] + 5) { P.cast = null; return; }
  k.t += dt;
  if (k.ch) { petChannelTick(c, P, k, dt); if (k.t >= k.total) { P.cast = null; petChannelEnd(c, P, k); } return; }
  if (k.t < k.total) return;
  P.cast = null; petUse(c, P, k.name, k.sp, t);
}
function petChannelStart(c, P, name, sp) {
  if (name === 'Consume Shadows') { const e = sp.ef.find((x) => x.au === 8); const v = spellMod(c, sp, 8, effValue(c, sp, e)); P.cast.heal = { v, every: (e.amp || 2000) / 1000, t: 0 }; fx(P.x, P.y, name, '#c56cf0'); }
}
function petChannelTick(c, P, k, dt) {
  const p = c.pet;
  if (k.heal) { k.heal.t += dt; while (k.heal.t >= k.heal.every) { k.heal.t -= k.heal.every; const st = petStats(c); const h0 = p.hp; p.hp = Math.min(st.maxhp, p.hp + k.heal.v); fx(P.x, P.y, '+' + Math.round(p.hp - h0), '#5ee07a'); } if (rt(c).threats.length) { P.cast = null; } }
  if (k.name === 'Seduction' && k.tgt && !(k.tgt.auras || []).some((a) => a.key === 'Seduction' && a.until > G.gameTime)) P.cast = null;
}
function petChannelEnd(c, P, k) { /* the channel ran out */ }

/* fighting */
function petFight(c, P, st, m, dt) {
  const p = c.pet; const now = G.gameTime;
  const ranged = p.kind === 'imp';
  const reach = ranged ? 26 : MELEE_RANGE;
  const d = Math.hypot(m.x - P.x, m.y - P.y);
  if (P.gcd <= now && petFightSpell(c, P, st, m, d)) return;
  if (P.cast || P.charge) return;
  if (d > reach) { petMove(P, m.x, m.y, reach - 0.4, petSpeed(c, P), dt); return; }
  if (ranged) return;
  let haste = 1; if (petBuff(P, 'Frenzy')) haste *= 1.3; if (petBuff(P, 'Shell Shield')) haste *= 0.57;
  P.swing -= dt * haste; if (P.swing > 0) return; P.swing += st.atk;
  petMelee(c, P, st, m);
}
/* one pet ability in the fight; true when it did something */
function petFightSpell(c, P, st, m, d) {
  const p = c.pet; const now = G.gameTime; const r = rt(c);
  for (const name of PET_ORDER[p.kind] || []) {
    if (!petAutoOn(c, name)) continue;
    const sp = petKnown(c, name); if (!sp || !petReady(c, P, name, sp)) continue;
    let tgt = m; const melee = sp.rng && sp.rng[1] <= 6;
    switch (name) {
      case 'Growl': case 'Torment':
        if (!petIsTank(c)) continue;
        if (mobVictimIsPet(m, c) && (m.petThreat || 0) > (m.charThreat || 0) * 1.6) continue; break;
      case 'Charge': if (d < 8 || d > 25) continue; break;
      case 'Dash': case 'Dive': if (d < 12) continue; break;
      case 'Shell Shield': if (p.hp > st.maxhp * 0.4 || !r.threats.some((x) => mobVictimIsPet(x, c))) continue; break;
      case 'Thunderstomp': if (r.threats.filter((x) => Math.hypot(x.x - P.x, x.y - P.y) <= 8).length < 2) continue; break;
      case 'Furious Howl': if (d > MELEE_RANGE + 1 || !((r.party && r.party.length) || (typeof groupOf === 'function' && groupOf(c)) || inMelee(c, m))) continue; break;
      case 'Screech': if ((m.auras || []).some((a) => a.key === 'Screech' && a.until > now + 1)) continue; break;
      case 'Scorpid Poison': { const a = (m.auras || []).find((x) => x.key === 'Scorpid Poison' && x.until > now); if (a && a.stacks >= 5 && a.until - now > 3) continue; break; }
      case 'Bite': break;
      case 'Claw': if (petKnown(c, 'Bite') && (P.cd.Bite || 0) - now < 1.5 && P.focus < 25 + 35) continue; break;      // keep focus for Bite when it is ready
      case 'Cower': if (!mobVictimIsPet(m, c) || p.hp > st.maxhp * 0.3) continue; break;
      case 'Fire Shield': tgt = petFireShieldTarget(c); if (!tgt) continue; break;
      case 'Firebolt': break;
      case 'Sacrifice': if (!(c.hp < charStats(c).maxHp * 0.25 || (p.hp < st.maxhp * 0.1 && c.hp < charStats(c).maxHp * 0.6))) continue; tgt = c; break;
      case 'Suffering': if (r.threats.filter((x) => !mobVictimIsPet(x, c) && Math.hypot(x.x - P.x, x.y - P.y) <= 10).length < 2) continue; break;
      case 'Seduction': {
        if (r.threats.length < 2) continue;
        const o = r.threats.find((x) => x !== m && x.st === 'chase' && x.info && x.info[5] === 7 && !(x.auras || []).some((a) => a.key === 'Seduction' && a.until > now) && Math.hypot(x.x - P.x, x.y - P.y) <= 30);
        if (!o || r.threats.some((x) => (x.auras || []).some((a) => a.key === 'Seduction' && a.until > now))) continue;
        tgt = o; break;
      }
      case 'Soothing Kiss': if (!mobVictimIsPet(m, c) || petIsTank(c)) continue; break;
      case 'Lash of Pain': break;
      case 'Spell Lock': { const o = r.threats.find((x) => x.cast && !x.cast.intBy && x.cast.total >= 1 && Math.hypot(x.x - P.x, x.y - P.y) <= 30); if (!o) continue; tgt = o; break; }
      case 'Devour Magic': { const t = petDevourTarget(c, m); if (!t) continue; tgt = t; break; }
      case 'Tainted Blood': if (petBuff(P, 'Tainted Blood') || !r.threats.some((x) => mobVictimIsPet(x, c))) continue; break;
      default: break;
    }
    if (melee && tgt && tgt.x != null && Math.hypot(tgt.x - P.x, tgt.y - P.y) > MELEE_RANGE + 0.5) continue;
    if (sp.rng && sp.rng[1] > 6 && tgt && tgt.x != null && Math.hypot(tgt.x - P.x, tgt.y - P.y) > sp.rng[1]) continue;
    if (name === 'Seduction' || name === 'Firebolt') { petStartCast(c, P, name, sp, tgt); return true; }
    petUse(c, P, name, sp, tgt);
    return true;
  }
  return false;
}
function petDevourTarget(c, m) {
  const now = G.gameTime;
  const deb = (o) => (rt(o).buffs || []).some((b) => b.kind === 'debuff' && b.until > now && b.disp === 1);
  if (deb(c)) return { c };
  if (typeof groupOf === 'function' && groupOf(c)) { const o = groupChars(groupOf(c)).find((x) => x !== c && x.pos.map === c.pos.map && deb(x)); if (o) return { c: o }; }
  if ((m.auras || []).some((a) => a.mob && a.disp === 1 && a.until > now)) return m;
  return null;
}
/* the effect of a pet ability */
function petUse(c, P, name, sp, tgt) {
  const p = c.pet; if (!p) return; const now = G.gameTime; const L = petLvl(c);
  petPay(c, P, sp); petStartCooldown(c, P, name, sp);
  if (P.prowl && name !== 'Prowl') P.prowl = false;
  const ev = (e) => { let v = e.lo + Math.random() * Math.max(0, (e.hi || e.lo) - e.lo); if (e.ppl && sp.bl) v += e.ppl * Math.max(0, Math.min(L, sp.ml || L) - sp.bl); return spellMod(c, sp, 8, spellMod(c, sp, 0, v)); };
  const show = () => fx(P.x, P.y, name, '#e8d29a');
  switch (name) {
    case 'Bite': case 'Claw': { const e = sp.ef.find((x) => x.t === 2); petPhys(c, P, tgt, ev(e), name); return; }
    case 'Screech': {
      const e = sp.ef.find((x) => x.t === 2); petPhys(c, P, tgt, ev(e), name);
      const a = sp.ef.find((x) => x.au === 99); if (a) for (const m of rt(c).threats) if (m.st !== 'dead' && Math.hypot(m.x - tgt.x, m.y - tgt.y) <= (a.ra || 5)) addMobAura(c, m, { n: 'Screech', dur: sp.dur || 4000 }, { au: 99, lo: a.lo });
      return;
    }
    case 'Lightning Breath': case 'Firebolt': case 'Lash of Pain': { const e = sp.ef.find((x) => x.t === 2); petMagic(c, P, tgt, ev(e), name, sp.sc); return; }
    case 'Thunderstomp': { const e = sp.ef.find((x) => x.t === 2); show(); for (const m of rt(c).threats.slice()) if (m.st !== 'dead' && Math.hypot(m.x - P.x, m.y - P.y) <= (e.ra || 8)) petMagic(c, P, m, ev(e), name, 3); return; }
    case 'Scorpid Poison': {
      const e = sp.ef.find((x) => x.au === 3); const per = Math.max(1, Math.round(ev(e)));
      const a = addMobAura(c, tgt, { n: name, dur: sp.dur || 10000, stack: 5 }, { au: 3, lo: per, amp: e.amp || 2000 });
      a.val = per * a.stacks; a.cu = null; tgt.petThreat = (tgt.petThreat || 0) + 5; if (tgt.st === 'alive') engage(tgt, c); show(); return;
    }
    case 'Growl': case 'Torment': case 'Cower': case 'Soothing Kiss': {
      const e = sp.ef.find((x) => x.t === 63); let v = e.lo + (e.ppl || 0) * Math.max(0, Math.min(L, sp.ml || L) - (sp.bl || 0)); v = spellMod(c, sp, 8, v);
      if (v > 0) { tgt.petThreat = Math.max((tgt.petThreat || 0) + v * 2, (tgt.charThreat || 0) * 1.25 + v); if (tgt.st === 'alive') engage(tgt, c); }
      else tgt.petThreat = Math.max(0, (tgt.petThreat || 0) + v * 2);
      show(); return;
    }
    case 'Suffering': {
      const e = sp.ef.find((x) => x.t === 63); const v = spellMod(c, sp, 8, e.lo);
      for (const m of rt(c).threats) if (Math.hypot(m.x - P.x, m.y - P.y) <= (e.ra || 10)) { m.petThreat = Math.max((m.petThreat || 0) + v, (m.charThreat || 0) * 1.25 + v); }
      show(); return;
    }
    case 'Charge': { P.charge = { m: tgt, sp }; show(); return; }
    case 'Dash': case 'Dive': { const e = sp.ef.find((x) => x.au === 31); petAddBuff(P, { name, ic: sp.ic, until: now + (sp.dur || 15000) / 1000, speed: e ? e.lo : 40 }); show(); return; }
    case 'Shell Shield': petAddBuff(P, { name, ic: sp.ic, until: now + (sp.dur || 12000) / 1000, taken: 0.5 }); show(); return;
    case 'Furious Howl': {
      const e = sp.ef.find((x) => x.au === 13); const v = Math.round(ev(e)); P.howl = v;
      for (const o of [c].concat(typeof groupOf === 'function' && groupOf(c) ? groupChars(groupOf(c)).filter((x) => x !== c) : [])) if (o.pos.map === c.pos.map && Math.hypot(o.pos.x - P.x, o.pos.y - P.y) <= (e.ra || 15)) { addBuff(o, { n: name, ic: sp.ic, dur: sp.dur || 10000 }, { au: 9001, mi: 0, lo: v }); }
      for (const u of rt(c).party || []) if (!u.dead && Math.hypot(u.x - P.x, u.y - P.y) <= (e.ra || 15)) { u.buffs = (u.buffs || []).filter((b) => b.name !== name); u.buffs.push({ name, ic: sp.ic, until: now + (sp.dur || 10000) / 1000, kind: 'buff' }); }
      show(); return;
    }
    case 'Fire Shield': {
      const e = sp.ef.find((x) => x.au === 15); const v = Math.round(spellMod(c, sp, 8, e.lo)); const o = tgt;
      addBuff(o, { n: name, ic: sp.ic, dur: sp.dur || 180000 }, { au: 0, mi: 0, lo: 0 }); const b = rt(o).buffs.find((x) => x.name === name); if (b) { b.fireShield = v; b.owner = c; b.ic = sp.ic; }
      fx(o.pos.x, o.pos.y, name, '#ff9a3c'); return;
    }
    case 'Sacrifice': {
      const e = sp.ef.find((x) => x.au === 69); const v = Math.round(spellMod(c, sp, 8, effValue({ level: c.level }, sp, e)));
      const r = rt(c); r.absorb = { v, until: now + (sp.dur || 30000) / 1000, name };
      addBuff(c, { n: name, ic: sp.ic, dur: sp.dur || 30000 }, { au: 0, mi: 0, lo: 0 }); fx(c.pos.x, c.pos.y, name + ' (' + v + ')', '#c56cf0');
      log(p.name + ' sacrifices itself: a shield of ' + v + '.'); c.pet = null; petLeft(c); return;
    }
    case 'Seduction': {
      const dur = (sp.dur || 15000) / 1000 * (1 + 0.1 * petTalent(c, 'Improved Succubus'));
      const a = addMobAura(c, tgt, { n: name, dur: dur * 1000 }, { au: 12, lo: 0 }); a.seduce = true;
      tgt.petThreat = (tgt.petThreat || 0) + 10; if (tgt.st === 'alive') engage(tgt, c);
      P.cast = { name, sp, tgt, t: 0, total: dur, ch: true }; fx(tgt.x, tgt.y, 'Seduced', '#ff7ad9'); return;
    }
    case 'Spell Lock': {
      if (tgt.cast) { tgt.cast = null; if (typeof msInterrupted === 'function') msInterrupted(tgt, { n: name }, now); }
      tgt.sgcd = Math.max(tgt.sgcd || 0, now + 4); fx(P.x, P.y, name, '#c56cf0'); return;
    }
    case 'Devour Magic': {
      if (tgt.c) { const b = (rt(tgt.c).buffs || []).find((x) => x.kind === 'debuff' && x.disp === 1 && x.until > now); if (b) { b.until = 0; dirty(tgt.c); fx(tgt.c.pos.x, tgt.c.pos.y, 'Devour Magic', '#c56cf0'); } }
      else { const a = (tgt.auras || []).find((x) => x.mob && x.disp === 1 && x.until > now); if (a) { a.until = 0; fx(tgt.x, tgt.y, 'Devoured ' + a.key, '#c56cf0'); } }
      const st = petStats(c); p.hp = Math.min(st.maxhp, p.hp + Math.round(st.maxhp * 0.08)); return;
    }
    case 'Tainted Blood': { const e = sp.ef.find((x) => x.tr); petAddBuff(P, { name, ic: sp.ic, until: now + (sp.dur || 60000) / 1000, taint: e ? e.tr : 0 }); show(); return; }
    default: show();
  }
}
/* a physical hit of the pet (white swing or Bite / Claw): miss, dodge, crit, armor */
function petPhys(c, P, m, base, name) {
  if (!m || m.st === 'dead') return;
  const st = petStats(c); const L = st.L; const diff = m.lvl - L; let r = Math.random() * 100;
  if ((r -= 5 + Math.max(0, diff) * (diff > 2 ? 2 : 0.5)) < 0) { fx(m.x, m.y, 'miss', '#cfc6b0'); if (m.st === 'alive') engage(m, c); return; }
  if ((r -= 5 + Math.max(0, diff) * 0.5) < 0) { fx(m.x, m.y, 'dodge', '#cfc6b0'); if (m.st === 'alive') engage(m, c); return; }
  let v = base * petDmgMul(c, P, name);
  let crit = false; if ((r -= st.crit - Math.max(0, diff)) < 0) { v *= 2; crit = true; }
  const arm = Math.max(0, m.armor + mobMods(m).armor); v *= 1 - clamp(arm / (arm + 400 + 85 * L), 0, 0.75);
  if (P.prowl) { v *= 1.2; P.prowl = false; }
  petHitMob(c, P, m, Math.max(1, Math.round(v)), name, crit);
  if (crit && petTalent(c, 'Frenzy') && Math.random() < 0.2 * petTalent(c, 'Frenzy')) { petAddBuff(P, { name: 'Frenzy', ic: 'inv_misc_monsterclaw_03', until: G.gameTime + 8 }); fx(P.x, P.y, 'Frenzy', '#ffb36b'); }
}
function petMelee(c, P, st, m) {
  let base = rnd(st.dmin, st.dmax);
  if (P.howl) { base += P.howl; P.howl = 0; }
  const ch = petBuff(P, 'Charge'); if (ch) base += ch.ap / 14 * 2;
  petPhys(c, P, m, base, 'Attack');
  if (P.intim && m.st !== 'dead') {
    const sp = spellRow(P.intim); P.intim = 0;
    addMobAura(c, m, { n: 'Intimidation', dur: (sp && sp.dur) || 3000 }, { au: 12, lo: 0 });
    const e = sp && (sp.ef || []).find((x) => x.t === 63); if (e) m.petThreat = (m.petThreat || 0) + e.lo + (e.ppl || 0) * Math.max(0, petLvl(c) - (sp.bl || 0));
    fx(m.x, m.y, 'Intimidation', '#ffe9a8');
  }
}
function petMagic(c, P, m, base, name, school) {
  if (!m || m.st === 'dead') return;
  const L = petLvl(c); const diff = m.lvl - L;
  if (Math.random() * 100 < clamp(4 + Math.max(0, diff) * (diff > 2 ? 7 : 1), 1, 60)) { fx(m.x, m.y, 'resist', '#cfc6b0'); if (m.st === 'alive') engage(m, c); return; }
  let v = base * petDmgMul(c, P, name);
  let crit = false; if (Math.random() * 100 < 5) { v *= 1.5; crit = true; }
  petHitMob(c, P, m, Math.max(1, Math.round(v)), name, crit, school);
}
function petHitMob(c, P, m, v, name, crit, school) {
  m.hp -= v; onMobDamaged(m, v); addThreat(m, { isPet: true, tank: petIsTank(c) }, v); meterDmg(c, v, name === 'Attack' ? 'Attack' : name, true);
  fx(m.x, m.y, v + (crit ? '!' : ''), school === 2 ? '#ff9a3c' : school === 5 ? '#c56cf0' : school === 3 ? '#9fe0ff' : '#d7b98a');
  if (m.st === 'alive') engage(m, c);
  if (m.hp <= 0 && m.st !== 'dead') killMob(c, m);
}
/* the boar's Charge: a rush at the target, it is held for a moment, more attack power for a few seconds */
function petChargeStep(c, P, st, dt) {
  const k = P.charge; const m = k.m; if (!m || m.st === 'dead') { P.charge = null; return; }
  if (petMove(P, m.x, m.y, MELEE_RANGE - 0.5, 28, dt)) {
    P.charge = null; const sp = k.sp; const a = sp.ef.find((x) => x.au === 99); const L = petLvl(c);
    if (a) petAddBuff(P, { name: 'Charge', ic: sp.ic, until: G.gameTime + (sp.dur || 4000) / 1000, ap: a.lo + (a.ppl || 0) * Math.max(0, Math.min(L, sp.ml || L) - (sp.bl || 0)) });
    addMobAura(c, m, { n: 'Charge', dur: 1000 }, { au: 26, lo: 0 }); if (m.st === 'alive') engage(m, c); m.petThreat = (m.petThreat || 0) + 5; P.swing = 0;
  }
}

/* ------------------------------------------------------------------ the pet takes damage */
/* a creature attacks the pet instead of the master when the pet has more threat (a little more to take it away) */
function mobVictimIsPet(m, c) {
  if (!petAlive(c) || (rt(c).pet && rt(c).pet.phased)) return false;
  if (rt(c).party && typeof mobVictimKey === 'function') return mobVictimKey(m, c) === 'p';
  return (m.petThreat || 0) > (m.charThreat || 0) * 1.1;
}
/* d: the damage before armor / resistances. o: {school, phys, dot, name} (a creature's swing: nothing) */
function petTakeHit(c, m, d, o) {
  const p = c.pet; if (!p || p.dead) return; const P = petRt(c); const st = petStats(c); o = o || {};
  if (P.phased) return;
  const school = o.school || 0; const phys = !school && !o.magic;
  if (phys && !o.dot && Math.random() * 100 < st.dodge) { fx(P.x, P.y, 'dodge', '#cfc6b0'); return; }
  if (phys) d *= 1 - clamp(st.armor / (st.armor + 400 + 85 * (m.lvl || c.level)), 0, 0.75);
  else { const res = st.res[['', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'][school]] || 0; d *= 1 - Math.min(0.75, res / Math.max(1, (m.lvl || c.level) * 5) * 0.75); }
  const sh = petBuff(P, 'Shell Shield'); if (sh) d *= sh.taken;
  if (p.kind === 'voidwalker' && phys) d *= 1 - 0.02 * petTalent(c, 'Master Demonologist');
  d = Math.max(1, Math.round(d));
  p.hp -= d; fx(P.x, P.y, '-' + d, '#ff9a8a');
  if (phys && !o.dot && m && m.st === 'chase') { const tb = petBuff(P, 'Tainted Blood'); if (tb && tb.taint) { const t2 = spellRow(tb.taint); const e = t2 && (t2.ef || []).find((x) => x.au === 99); if (e) addMobAura(c, m, { n: t2.n, dur: t2.dur || 10000, stack: t2.stack || 5 }, { au: 99, lo: e.lo }); } }
  if (P.cast && !P.cast.ch && !o.dot) P.cast.t = Math.max(0, P.cast.t - 0.5);          // pushback
  if (p.hp <= 0) petDie(c);
}
/* a creature's debuff on the pet: damage over time, stun / fear, slows, silence */
function petDebuff(c, m, sp, e, dur) {
  if (!petAlive(c)) return; const P = petRt(c); const now = G.gameTime; const until = now + dur;
  if (petBuff(P, 'Bestial Wrath') && (e.au === 12 || e.au === 5 || e.au === 7 || e.au === 26 || e.au === 33)) return;      // immune
  let b = (P.buffs || []).find((x) => x.name === sp.n && x.kind === 'debuff');
  if (!b) { b = { name: sp.n, ic: sp.ic, kind: 'debuff', until: 0 }; P.buffs.push(b); }
  b.until = until; b.src = m; b.sc = sp.sc || 0; b.disp = sp.disp || 0;
  switch (e.au) {
    case 3: case 89: b.dot = { t: 0, every: (e.amp || 3000) / 1000, v: Math.max(1, typeof msVal === 'function' ? msVal(m, sp, e) : e.lo) }; break;
    case 12: case 5: case 7: P.stunUntil = Math.max(P.stunUntil || 0, until); P.cast = null; fx(P.x, P.y, e.au === 7 ? 'feared' : 'stunned', '#ffb36b'); break;
    case 27: P.silenceUntil = Math.max(P.silenceUntil || 0, until); break;
    case 26: P.snare = { f: 0, until }; break;
    case 33: P.snare = { f: Math.max(0.2, 1 + (typeof msVal === 'function' ? msVal(m, sp, e) : e.lo) / 100), until }; break;
    default: break;
  }
}
/* the warlock's Soul Link: part of the damage the warlock takes goes to the demon (called from absorbDamage) */
function soulLinkSplit(c, d) {
  if (c.cls !== 9 || !petAlive(c) || !(rt(c).buffs || []).some((b) => b.name === 'Soul Link' && b.until > G.gameTime)) return d;
  const a = spellRow(25228); const e = a && (a.ef || []).find((x) => x.au === 81); const pct = e ? e.lo : 30;
  const part = Math.round(d * pct / 100); if (part <= 0) return d;
  const p = c.pet; p.hp -= part; if (p.hp <= 0) petDie(c);
  return d - part;
}
/* Fire Shield on a character: the attacker burns (called from damageShield) */
function fireShieldHit(c, m) {
  const b = (rt(c).buffs || []).find((x) => x.fireShield && x.until > G.gameTime); if (!b || !m || m.st === 'dead') return;
  const own = b.owner || c; const v = Math.max(1, Math.round(b.fireShield));
  m.hp -= v; fx(m.x, m.y, '' + v, '#ff9a3c'); meterDmg(own, v, 'Fire Shield', own !== c || own.cls === 9);
  if (m.hp <= 0 && m.st !== 'dead') killMob(c, m);
}

/* ------------------------------------------------------------------ the pet frame (unit frames) */
function petPortrait(p) {
  if (p.kind === 'hunter') return p.e && G.portraits && G.portraits[p.e] ? '../portraits/by_name/' + encodeURIComponent(G.portraits[p.e]) : '../ui/CharacterFrame/TemporaryPortrait-Pet.png';
  const e = DEMON_ENTRY[p.kind]; return G.portraits && G.portraits[e] ? '../portraits/by_name/' + encodeURIComponent(G.portraits[e]) : '../ui/CharacterFrame/TemporaryPortrait-Pet.png';
}
function petIcon(p) { const f = petFam(p); if (f) return f.ic; const D = PETD(); const d = D && D.demons[DEMON_ENTRY[p.kind]]; return d ? d.ic : 'ability_hunter_beastcall'; }
/* like the PetFrame of the game: UI-SmallTargetingFrame, portrait, name, health, focus / mana, happiness */
function ufMakePet(s) {
  const el = document.createElement('div'); el.className = 'uf ufpet'; el.style.width = Math.round(128 * s) + 'px'; el.style.height = Math.round(53 * s) + 'px'; el.style.setProperty('--s', s);
  const box = (cls, x, y, w, h) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, { left: x * s + 'px', top: y * s + 'px', width: w * s + 'px', height: h * s + 'px' }); el.appendChild(d); return d; };
  el._por = box('ufpor', 7, 6, 37, 37); el._img = document.createElement('img'); el._por.appendChild(el._img);
  el._namebg = box('ufnamebg', 46, 8, 74, 12);
  el._hp = box('ufbar hp', 47, 22, 70, 8); el._hpi = document.createElement('i'); el._hp.appendChild(el._hpi);
  el._pw = box('ufbar pw', 47, 30, 70, 7); el._pwi = document.createElement('i'); el._pw.appendChild(el._pwi);
  const bg = document.createElement('div'); bg.className = 'ufbg petbg'; bg.style.backgroundImage = 'url(../ui/TargetingFrame/UI-SmallTargetingFrame.png)';
  bg.style.backgroundSize = 128 * s + 'px ' + 64 * s + 'px'; bg.style.backgroundPosition = '0 ' + 2 * s + 'px'; el.appendChild(bg); el._bg = bg; el._bgs = [bg];
  el._name = box('ufname', 46, 8, 74, 12);
  el._hpt = box('uftxt', 47, 20, 70, 12); el._pwt = box('uftxt', 47, 28, 70, 11);
  el._happy = box('ufhappy', 112, 12, 24, 23);
  el._lv = document.createElement('div'); el._lv.className = 'uflvl'; el._lv.style.display = 'none'; el.appendChild(el._lv);
  el._auras = document.createElement('div'); el._auras.className = 'ufauras'; el._auras.style.left = 46 * s + 'px'; el._auras.style.top = 40 * s + 'px'; el._auras.style.width = 120 * s + 'px'; el.appendChild(el._auras); el._rows = 0;
  return el;
}
function ufFillPet(me, c) {
  const p = c.pet; const P = petRt(c); const st = petStats(c);
  ufSet(me, 'img', p.kind + (p.e || ''), () => { me._img.onerror = () => { me._img.onerror = null; me._img.src = '../ui/CharacterFrame/TemporaryPortrait-Pet.png'; }; me._img.src = petPortrait(p); });
  ufSet(me, 'name', p.name + (p.dead ? ' (dead)' : ''), (v) => { me._name.textContent = v; });
  const hp = Math.max(0, Math.round(p.dead ? 0 : p.hp));
  ufSet(me, 'hp', hp + '/' + st.maxhp, () => { me._hpi.style.width = 100 * hp / st.maxhp + '%'; me._hpt.textContent = p.dead ? 'Dead' : hp + ' / ' + st.maxhp; });
  const focus = p.kind === 'hunter'; const pv = Math.round(focus ? P.focus : p.mana || 0), pm = focus ? 100 : Math.max(1, st.maxmana);
  ufSet(me, 'pw', pv + '/' + pm + focus, () => { me._pwi.style.width = 100 * pv / pm + '%'; me._pwi.className = focus ? 'p2' : 'p0'; me._pwt.textContent = focus ? 'Focus ' + pv : pv + ' / ' + pm; });
  const h = p.kind === 'hunter' ? petHappy(p) : 0;
  ufSet(me, 'happy', h, (v) => { me._happy.style.display = v ? '' : 'none'; me._happy.style.backgroundPosition = 'calc(' + (-(3 - v) * 24) + 'px * var(--s, 1)) 0'; me._happy.title = ['', 'Unhappy - 75% damage', 'Content - 100% damage', 'Happy - 125% damage'][v] || ''; });
  ufCastBar(me, P.cast, () => P.cast);
  const now = G.gameTime; const au = [];
  for (const b of P.buffs || []) if (b.until > now) au.push({ n: b.name, ic: b.ic, left: b.until - now, k: b.kind || 'buff' });
  ufAuras(me, p.dead ? [] : au);
  me.classList.toggle('dead', !!p.dead);
}

/* ------------------------------------------------------------------ the Pet tab of the character window */
function petTabHtml(c) {
  if (c.cls !== 3 && c.cls !== 9) return '<div class="petpane"><p class="small">Only hunters and warlocks have pets.</p></div>';
  const p = c.pet; let h = '<div class="petpane">';
  if (c.cls === 3 && c.level < 10) return h + '<p class="small">Hunters tame their first beast at level 10 (Tame Beast).</p></div>';
  if (p && p.v !== 2) petMigrate(c);
  if (!c.pet) {
    if (c.cls === 3) h += '<p>No pet. ' + (c.cfg.petTame === false ? 'Taming is switched off.' : 'The hunter tames a beast of its level or a few levels lower when one is near (not in a group or dungeon).') + '</p>';
    else h += '<p>No demon out. ' + (c.cfg.petSacrifice && petTalent(c, 'Demonic Sacrifice') ? 'Demonic Sacrifice: the ' + DEMON_NAME[c.cfg.petSacrifice] + ' is summoned and sacrificed for its buff.' : wantedDemon(c) ? 'The warlock summons the ' + DEMON_NAME[wantedDemon(c)] + ' out of a fight' + (wantedDemon(c) !== 'imp' && bagCount(c, SOUL_SHARD) < 1 ? ' once it has a Soul Shard' : '') + '.' : '') + '</p>';
  } else {
    const st = petStats(c); const P = petRt(c); const fam = petFam(c.pet);
    h += '<div class="pethead"><img class="petpor" src="' + petPortrait(c.pet) + '" onerror="this.src=\'../ui/CharacterFrame/TemporaryPortrait-Pet.png\'"><div>' +
      '<div class="petname"><b>' + esc(c.pet.name) + '</b>' + (c.pet.kind === 'hunter' ? ' <button class="mini" data-pet="rename">Rename</button>' : '') + '</div>' +
      '<div class="small">Level ' + petLvl(c) + ' ' + (fam ? fam.n : DEMON_NAME[c.pet.kind]) + (c.pet.dead ? ' - <span class="bad">dead</span>' : c.pet.out === false ? ' - dismissed' : '') + '</div>' +
      (c.pet.kind === 'hunter' ? '<div class="small">Loyalty: <b>' + LOYALTY[(c.pet.loy || 1) - 1] + '</b> (' + (c.pet.loy || 1) + ')</div>' : '') + '</div>' +
      (c.pet.kind === 'hunter' ? '<span class="pethappy" style="background-position:' + (-(3 - petHappy(c.pet)) * 24) + 'px 0" title="' + ['', 'Unhappy', 'Content', 'Happy'][petHappy(c.pet)] + '"></span>' : '') + '</div>';
    const bar = (label, v, max, cls, txt) => '<div class="petbar"><span>' + label + '</span><div class="pbar ' + cls + '"><i style="width:' + Math.max(0, Math.min(100, 100 * v / Math.max(1, max))) + '%"></i><em>' + (txt || Math.round(v) + ' / ' + Math.round(max)) + '</em></div></div>';
    h += bar('Health', c.pet.dead ? 0 : c.pet.hp, st.maxhp, 'hp');
    if (c.pet.kind === 'hunter') {
      h += bar('Focus', P.focus, 100, 'focus');
      h += c.pet.level < c.level ? bar('Experience', c.pet.xp || 0, petXpNeed(c.pet.level), 'xp') : bar('Experience', 1, 1, 'xp', 'at the hunter\'s level');
      const loy = c.pet.loy || 1; h += bar('Loyalty', loy >= 6 ? 1 : (c.pet.lp || 0) - LOYAL_START[loy - 1], loy >= 6 ? 1 : LOYAL_UP[loy - 1] - LOYAL_START[loy - 1], 'loy', loy >= 6 ? 'Best Friend' : 'to ' + LOYALTY[loy]);
      const hp = petHappy(c.pet); h += bar('Happiness', c.pet.happy || 0, HAPPY_MAX, 'happy' + hp, ['', 'Unhappy (75% damage, losing loyalty)', 'Content (100% damage)', 'Happy (125% damage)'][hp]);
      const food = petFoodFor(c); let nfood = 0; for (const x of c.bags) if (petFoodBenefit(c.pet, x.id) > 0) nfood += x.n;
      h += '<div class="small">Eats: ' + petDietText(c.pet) + ' - ' + (nfood ? nfood + ' in the bags' + (food ? ' (' + esc(itemName(c.bags[food.idx].id)) + ')' : '') : '<span class="bad">none in the bags</span>') + '. Fed automatically when not happy.</div>';
    } else if (st.maxmana) h += bar('Mana', c.pet.mana || 0, st.maxmana, 'mana');
    const RS = ['fire', 'nature', 'frost', 'shadow', 'arcane'];
    h += '<div class="petstats">' + statRow('Armor', st.armor) + (c.pet.kind === 'imp' ? statRow('Firebolt', petFireboltText(c)) : statRow('Damage', Math.round(st.dmin * petDmgMul(c, P)) + ' - ' + Math.round(st.dmax * petDmgMul(c, P)))) + statRow('Attack speed', st.atk.toFixed(2)) +
      statRow('Attack power', st.ap) + statRow('Crit', st.crit + '%') + statRow('Stamina', st.sta) + statRow('Resistances', RS.map((k) => st.res[k]).join(' / '), 'fire / nature / frost / shadow / arcane') + '</div>';
  }
  // abilities
  if (c.pet && c.pet.kind === 'hunter') {
    const p2 = c.pet; const free = petTpFree(p2);
    h += '<h5>Training points: ' + free + ' free of ' + petTpTotal(p2) + ' <span class="small">(level x (loyalty - 1))</span></h5>' + (free < 0 ? '<div class="small">Below zero: what the beast knew when it was tamed costs more than it has - more come with loyalty.</div>' : '');
    h += '<label class="small"><input type="checkbox" data-petcfg="petAutoTrain"' + (c.cfg.petAutoTrain !== false ? ' checked' : '') + '> Train automatically</label> <button class="mini" data-pet="untrain">Untrain (' + money(1000 * Math.min(10, (p2.untrained || 0) + 1)) + ')</button>';
  }
  if (c.pet) {
    const ab = petAbilities(c); const all = c.pet.kind === 'hunter' ? Array.from(new Set(ab.concat(petTrainable(c).map((x) => x.name)))) : ab;
    const order = (PET_ORDER[c.pet.kind] || []).concat(TRAIN_ORDER, Object.keys((PETD() || { train: {} }).train));
    all.sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    h += '<table class="petab"><tr><th></th><th>Ability</th><th>Autocast</th>' + (c.pet.kind === 'hunter' ? '<th>Training</th>' : '') + '</tr>';
    for (const n of all) {
      const sp = petKnown(c, n); const nx = c.pet.kind === 'hunter' ? petTrainable(c).filter((x) => x.name === n).pop() : null;
      const any = sp || (nx && spellRow(nx.id));
      h += '<tr' + (sp ? '' : ' class="dim"') + '><td>' + spellIcon(any) + '</td><td title="' + esc(petAbilityText(c, n, sp)) + '">' + esc(n) + (sp && sp.r ? ' <span class="small">' + esc(sp.r) + '</span>' : sp ? '' : ' <span class="small">(not learned)</span>') + '</td>';
      h += '<td>' + (sp && !PET_PASSIVE.has(n) ? '<input type="checkbox" data-petauto="' + esc(n) + '"' + (petAutoOn(c, n) ? ' checked' : '') + '>' : '') + '</td>';
      if (c.pet.kind === 'hunter') h += '<td>' + (nx ? '<button class="mini" data-petlearn="' + nx.id + '" data-n="' + esc(n) + '"' + (nx.cost > 0 && nx.cost > petTpFree(c.pet) ? ' disabled' : '') + '>Rank ' + nx.rank + ' (' + nx.cost + ' TP)</button>' : sp ? '<span class="small">best rank</span>' : '') + '</td>';
      h += '</tr>';
    }
    h += '</table>';
    if (c.pet.kind === 'hunter') { const up = petUpcoming(c); if (up.length) h += '<div class="small">Later: ' + up.map((x) => esc(x.name) + ' ' + x.rank + ' (level ' + x.lv + ', ' + x.tp + ' TP)').join(', ') + '</div>'; }
  }
  // settings
  h += '<h5>Settings</h5>';
  if (c.cls === 3) {
    const D = PETD(); h += '<div class="kv"><span>Beast to tame</span><select data-petcfg="tameFamily"><option value="auto">Best near (cat, wolf, raptor ...)</option>' + (D ? Object.keys(D.fam).map((k) => '<option value="' + k + '"' + (String(c.cfg.tameFamily) === k ? ' selected' : '') + '>' + D.fam[k].n + '</option>').join('') : '') + '</select></div>';
    h += '<label class="small"><input type="checkbox" data-petcfg="petTame"' + (c.cfg.petTame !== false ? ' checked' : '') + '> Tame a beast when there is no pet</label>';
    if (c.pet) h += '<div class="petbtns">' + (c.pet.out === false && !c.pet.dead ? '<button class="mini" data-pet="call">Call Pet</button>' : !c.pet.dead ? '<button class="mini" data-pet="dismiss">Dismiss Pet</button>' : '') + (!c.pet.dead ? ' <button class="mini" data-pet="feed">Feed Pet</button>' : '') + ' <button class="mini" data-pet="abandon">Abandon pet</button></div>';
  } else {
    const has = (k) => c.known && c.known['Summon ' + DEMON_NAME[k]];
    h += '<div class="kv"><span>Demon</span><select data-petcfg="petChoice"><option value="auto">Voidwalker alone, imp in a group</option><option value="none"' + (c.cfg.petChoice === 'none' ? ' selected' : '') + '>None</option>' + ['imp', 'voidwalker', 'succubus', 'felhunter'].filter(has).map((k) => '<option value="' + k + '"' + (c.cfg.petChoice === k ? ' selected' : '') + '>' + DEMON_NAME[k] + '</option>').join('') + '</select></div>';
    if (petTalent(c, 'Demonic Sacrifice')) h += '<div class="kv"><span>Demonic Sacrifice</span><select data-petcfg="petSacrifice"><option value="">Keep the demon</option>' + ['imp', 'voidwalker', 'succubus', 'felhunter'].filter(has).map((k) => '<option value="' + k + '"' + (c.cfg.petSacrifice === k ? ' selected' : '') + '>Sacrifice the ' + DEMON_NAME[k] + ' (' + ((spellRow(SACRIFICE_BUFF[k]) || {}).n || '') + ')</option>').join('') + '</select></div>';
    h += '<div class="small">Soul Shards: ' + bagCount(c, SOUL_SHARD) + ' (Drain Soul on a dying creature makes one; summoning anything but the imp takes one).</div>';
    if (c.pet) h += '<div class="petbtns"><button class="mini" data-pet="dismiss">Banish demon</button></div>';
  }
  return h + '</div>';
}
function petFireboltText(c) {
  const sp = petKnown(c, 'Firebolt'); const e = sp && sp.ef.find((x) => x.t === 2); if (!e) return '-';
  const add = e.ppl && sp.bl ? e.ppl * Math.max(0, Math.min(c.level, sp.ml || c.level) - sp.bl) : 0; const m = petDmgMul(c, petRt(c), 'Firebolt');
  const f = (v) => Math.round(spellMod(c, sp, 8, spellMod(c, sp, 0, v + add)) * m);
  return f(e.lo) + ' - ' + f(e.hi || e.lo) + ' (' + (spellMod(c, sp, 10, sp.cast || 2000) / 1000).toFixed(1) + ' s)';
}
function petUpcoming(c) {
  const p = c.pet; const D = PETD(); if (!p || !D) return []; const fam = petFam(p); const out = [];
  for (const n of (fam ? fam.ab : []).concat(D.generic || [])) { const l = D.train[n] || []; const i = l.findIndex((x) => x[1] > Math.min(p.level, c.level)); if (i >= 0) out.push({ name: n, rank: i + 1, lv: l[i][1], tp: l[i][2] }); }
  return out.sort((a, b) => a.lv - b.lv).slice(0, 6);
}
function petAbilityText(c, n, sp) {
  const T = { Growl: 'Taunts: the creature turns to the pet (off in a group with a tank).', Cower: 'Less threat.', Bite: 'Bites for damage (10 s cooldown).', Claw: 'Claws for damage.',
    Dash: 'Runs faster for 15 s.', Dive: 'Flies faster for 15 s.', Charge: 'Charges a creature 8-25 yards away, holding it for a moment; more attack power for 4 s.', Prowl: 'Sneaks (slower); the first attack does 20% more.',
    Screech: 'Damage, and the creatures near have less attack power.', 'Furious Howl': 'The party\'s next melee hit does more damage.', 'Lightning Breath': 'Nature damage from range.', 'Scorpid Poison': 'Poison stacking up to 5 times.',
    Thunderstomp: 'Nature damage to everything near (2 or more creatures).', 'Shell Shield': 'Half the damage taken for 12 s (below 40% health).', 'Great Stamina': 'More stamina.', 'Natural Armor': 'More armor.',
    Firebolt: 'Fire damage from range.', 'Blood Pact': 'More stamina for the warlock and its group.', 'Fire Shield': 'Burns whoever hits the warlock (or the group\'s tank).', 'Phase Shift': 'Out of phase between fights.',
    Torment: 'Taunts (more threat).', Suffering: 'Taunts every creature near (2 or more on the warlock).', Sacrifice: 'Gives its life for a shield on the warlock (when the warlock is about to die).', 'Consume Shadows': 'Heals itself out of a fight.',
    'Lash of Pain': 'Shadow damage.', Seduction: 'Charms a second humanoid attacker for 15 s (breaks on damage).', 'Soothing Kiss': 'Less threat when it has drawn a creature.', 'Lesser Invisibility': 'Invisible (not used).',
    'Devour Magic': 'Removes a magic debuff from the warlock (or a magic buff from the creature).', 'Spell Lock': 'Interrupts a creature\'s spell and silences it.', 'Tainted Blood': 'Attackers lose attack power.', Paranoia: 'Sees stealthed enemies.' };
  return (T[n] || (/Resistance$/.test(n) ? 'More resistance to that school.' : '')) + (sp ? '' : ' Not learned yet.');
}
function petTabClick(e) {
  const c = active(); const b = e.target.closest('[data-pet],[data-petlearn]'); if (!b) return false;
  if (b.dataset.petlearn) { if (petLearn(c, b.dataset.n, +b.dataset.petlearn)) save(); renderSheet(); return true; }
  const a = b.dataset.pet;
  if (a === 'rename' && c.pet) { const n = prompt('Name of your pet:', c.pet.name); if (n && n.trim()) { c.pet.name = n.trim().slice(0, 16); save(); } }
  else if (a === 'untrain') petUntrain(c);
  else if (a === 'abandon') { if (confirm('Abandon ' + c.pet.name + '? It will be gone for good.')) abandonPet(c); }
  else if (a === 'dismiss') dismissPet(c);
  else if (a === 'call') callPet(c);
  else if (a === 'feed') { if (!petFeed(c)) log('Cannot feed now.'); }
  save(); renderSheet(); return true;
}
function petTabChange(e) {
  const c = active(); const t = e.target;
  if (t.dataset.petauto) {
    const n = t.dataset.petauto; if (!c.pet) return true;
    if (c.pet.kind === 'hunter') { c.pet.auto = c.pet.auto || {}; c.pet.auto[n] = t.checked; }
    else { c.cfg.petAuto = c.cfg.petAuto || {}; (c.cfg.petAuto[c.pet.kind] = c.cfg.petAuto[c.pet.kind] || {})[n] = t.checked; }
    save(); return true;
  }
  if (t.dataset.petcfg) {
    const k = t.dataset.petcfg; c.cfg[k] = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'petAutoTrain' && t.checked) petAutoTrain(c);
    save(); renderSheet(); return true;
  }
  return false;
}
/* the pet's icon on the map (the family's or the demon's) */
function petMapIcon(p) {
  G.petIcons = G.petIcons || {}; const k = petIcon(p);
  if (!G.petIcons[k]) { const im = new Image(); im.src = '../icons/' + k + '.jpg'; G.petIcons[k] = im; }
  return G.petIcons[k];
}
