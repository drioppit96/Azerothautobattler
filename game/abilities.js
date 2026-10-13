'use strict';
/* abilities.js - class abilities learned by level, rules that decide when to use them (priority list),
   auras on creatures (DoTs and debuffs), self buffs, stances and the behaviour settings of a character. */

const GCD = 1.5;
const AOE_RADIUS = 8;
/* warrior ability meta. st: stances (b battle, d defensive, z berserker, '' any). modes: what the rule menu offers.
   def: default rule. p: the number the rule uses (rage, %, count, stacks). */
const CLASS_META = {
  1: {
    'Execute': { st: 'bz', modes: ['off', 'spam'], def: { mode: 'spam' } },
    'Overpower': { st: 'b', modes: ['off', 'spam'], def: { mode: 'spam' } },
    'Revenge': { st: 'd', modes: ['off', 'spam'], def: { mode: 'spam' } },
    'Last Stand': { st: '', modes: ['off', 'emergency'], def: { mode: 'emergency', p: 20 } },
    'Death Wish': { st: '', modes: ['off', 'spam', 'emergency', 'multi'], def: { mode: 'multi', p: 2 } },
    'Sweeping Strikes': { st: 'b', modes: ['off', 'multi', 'spam'], def: { mode: 'multi', p: 2 } },
    'Mortal Strike': { st: '', modes: ['off', 'spam'], def: { mode: 'spam' } },
    'Bloodthirst': { st: '', modes: ['off', 'spam'], def: { mode: 'spam' } },
    'Shield Slam': { st: '', modes: ['off', 'spam'], def: { mode: 'spam' }, shield: true },
    'Concussion Blow': { st: '', modes: ['off', 'spam', 'emergency'], def: { mode: 'spam' } },
    'Piercing Howl': { st: '', modes: ['off', 'flee', 'multi'], def: { mode: 'flee' } },
    'Retaliation': { st: 'b', modes: ['off', 'emergency'], def: { mode: 'emergency', p: 40 } },
    'Intimidating Shout': { st: '', modes: ['off', 'emergency', 'multi'], def: { mode: 'emergency', p: 25 } },
    'Shield Wall': { st: 'd', modes: ['off', 'emergency'], def: { mode: 'emergency', p: 20 }, shield: true },
    'Recklessness': { st: 'z', modes: ['off', 'emergency', 'spam'], def: { mode: 'off', p: 30 } },
    'Bloodrage': { st: '', modes: ['off', 'lowrage', 'spam'], def: { mode: 'lowrage', p: 20 } },
    'Berserker Rage': { st: 'z', modes: ['off', 'spam'], def: { mode: 'off' } },
    'Battle Shout': { st: '', modes: ['off', 'buff'], def: { mode: 'buff' } },
    'Charge': { st: 'b', modes: ['off', 'opener'], def: { mode: 'opener' } },
    'Intercept': { st: 'z', modes: ['off', 'opener'], def: { mode: 'opener' } },
    'Thunder Clap': { st: 'b', modes: ['off', 'multi', 'debuff', 'spam'], def: { mode: 'multi', p: 2 } },
    'Demoralizing Shout': { st: '', modes: ['off', 'multi', 'debuff', 'debuffAll'], def: { mode: 'multi', p: 2 } },
    'Whirlwind': { st: 'z', modes: ['off', 'spam', 'multi'], def: { mode: 'spam', p: 2 } },
    'Rend': { st: 'bd', modes: ['off', 'debuff', 'debuffAll'], def: { mode: 'debuff' } },
    'Sunder Armor': { st: '', modes: ['off', 'stack', 'spam'], def: { mode: 'off', p: 3 } },
    'Hamstring': { st: 'bz', modes: ['off', 'flee', 'debuff', 'spam'], def: { mode: 'flee' } },
    'Mocking Blow': { st: 'b', modes: ['off', 'spam'], def: { mode: 'off' } },
    'Slam': { st: '', modes: ['off', 'spam', 'rage'], def: { mode: 'off', p: 50 } },
    'Disarm': { st: 'd', modes: ['off', 'spam', 'emergency'], def: { mode: 'off', p: 50 } },
    'Shield Block': { st: 'd', modes: ['off', 'spam', 'emergency'], def: { mode: 'off', p: 60 }, shield: true },
    'Shield Bash': { st: 'bd', modes: ['off', 'spam'], def: { mode: 'off' }, shield: true },
    'Pummel': { st: 'z', modes: ['off', 'spam'], def: { mode: 'off' } },
    'Taunt': { st: 'd', modes: ['off'], def: { mode: 'off' } },
    'Challenging Shout': { st: '', modes: ['off', 'emergency'], def: { mode: 'off', p: 20 } },
    'Cleave': { st: '', modes: ['off', 'multi', 'rage'], def: { mode: 'multi', p: 2, r: 30 } },
    'Heroic Strike': { st: '', modes: ['off', 'rage', 'spam'], def: { mode: 'rage', p: 40 } },
  },
};
const STANCES = { 'Battle Stance': 'b', 'Defensive Stance': 'd', 'Berserker Stance': 'z' };
const STANCE_NAME = { b: 'Battle Stance', d: 'Defensive Stance', z: 'Berserker Stance' };
const MODE_TEXT = {
  off: 'Never', spam: 'Whenever ready', rage: 'When rage at least', buff: 'Keep the buff up', opener: 'To open a fight',
  debuff: 'Keep on my target', debuffAll: 'Keep on every attacker', multi: 'When attackers at least', emergency: 'When my health below %',
  flee: 'When the target flees', lowrage: 'When rage below', stack: 'Keep stacks on target',
};
const MODE_HAS_P = { rage: 1, multi: 1, emergency: 1, lowrage: 1, stack: 1 };
const PLAYSTYLES = {
  aggressive: 'Aggressive - walks straight through, ignores aggro ranges, pulls the nearest target even in packs. Still runs from creatures far above its level.',
  balanced: 'Balanced - avoids creatures far above its level, prefers lone targets but will fight packs.',
  safe: 'Safe - walks around every hostile aggro range, only pulls targets standing alone, one at a time, and avoids area attacks that would pull more.',
};
function defaultCfg() { return { style: 'balanced', sitAt: 70, standAt: 100, eatAt: 60, potionAt: 30, drinkAt: 45, wandAt: 20, form: 'auto', stance: 'b', rules: [], autoTalents: true, talentBuild: 'arms' }; }
/* hunter pet abilities and other spells that are no use to the character itself */
const PET_SPELLS = new Set(['Bite', 'Claw', 'Dash', 'Dive', 'Growl', 'Cower', 'Prowl', 'Screech', 'Furious Howl', 'Lightning Breath', 'Scorpid Poison', 'Thunderstomp', 'Shell Shield', 'Cobra Reflexes', 'Natural Armor', 'Great Stamina',
  'Fire Resistance', 'Frost Resistance', 'Shadow Resistance', 'Nature Resistance', 'Arcane Resistance', 'Charge']);
const NOT_MINE = new Set(['Immolation Trap Effect', 'Explosive Trap Effect', 'Hellfire Effect', 'Ritual of Doom Effect', 'Pounce Bleed', 'Moonkin Aura', 'Chilled', 'Frostbite', 'Impact', 'Master of Elements', 'Lightwell Renew', 'Healing Way', 'Eye for an Eye', 'Throw',
  'Shoot Bow', 'Shoot Gun', 'Shoot Crossbow', 'Auto Shot', 'Shoot', 'Poisons', 'Beast Training']);

/* ------------------------------------------------------------- learning */
function classAbilityList(cls) {
  G.abilCache = G.abilCache || {};
  if (G.abilCache[cls]) return G.abilCache[cls];
  const groups = {};
  for (const id in G.d.spells.spells) {
    const sp = G.d.spells.spells[id];
    if (!sp.cls || !sp.cls.includes(cls) || !sp.lv) continue;
    const src = sp.src || [];
    if (!src.includes('class')) continue;
    if ((sp.fl || []).some((f) => f === 'passive' || f === 'hidden' || (f === 'ranged' && cls !== 3))) continue;
    if (NOT_MINE.has(sp.n) || (cls === 3 && PET_SPELLS.has(sp.n))) continue;
    (groups[sp.n] = groups[sp.n] || []).push(Object.assign({ id: +id }, sp));
  }
  // abilities that come from talents: rank 1 is the talent's own spell
  const TA = typeof classTalents === 'function' ? classTalents(cls).abil : {};
  for (const n in TA) {
    const sp0 = spellRow(TA[n].ranks[0]); if (!sp0) continue;
    const l = (groups[n] || []).filter((x) => x.id !== TA[n].ranks[0]);
    groups[n] = [Object.assign({}, sp0, { id: TA[n].ranks[0], lv: Math.max(10, (TA[n].row || 0) * 5 + 10), talent: true })].concat(l.filter((x) => /Rank [2-9]/.test(x.r || '')));
  }
  const out = {};
  for (const n in groups) {
    let l = groups[n]; if (l.some((x) => /Rank/.test(x.r || ''))) l = l.filter((x) => /Rank/.test(x.r || ''));
    l.sort((a, b) => a.lv - b.lv); out[n] = l;
  }
  G.abilCache[cls] = out; return out;
}
function knownRank(c, name) {
  const l = classAbilityList(c.cls)[name]; if (!l) return null;
  if (typeof classTalents === 'function' && classTalents(c.cls).abil[name] && !talentRank(c, name)) return null;
  let b = null; for (const s of l) if (s.lv <= c.level || (s.talent && talentRank(c, name))) { if (!b || s.lv >= b.lv) b = s; } return b;
}
function learnAbilities(c, quiet) {
  const list = classAbilityList(c.cls); const meta = CLASS_META[c.cls] || {}; c.known = c.known || {};
  for (const n in c.known) if (!knownRank(c, n) && list[n]) delete c.known[n];
  const order = Object.keys(meta); const learned = [];
  for (const n in list) {
    const sp = knownRank(c, n); if (!sp) continue;
    if (c.known[n] !== sp.id) { if (c.known[n] == null || c.known[n] !== sp.id) learned.push(n + (sp.r ? ' (' + sp.r + ')' : '')); c.known[n] = sp.id; }
    if (STANCES[n]) continue;
    if (!c.cfg.rules.find((r) => r.n === n)) {
      const m = meta[n] || { def: { mode: c.cls === 1 ? guessMode(sp) : 'off' } }; const rule = Object.assign({ n }, m.def);
      // insert by the default priority order
      const pos = order.indexOf(n); let at = c.cfg.rules.length;
      if (pos >= 0) { at = c.cfg.rules.findIndex((r) => { const p = order.indexOf(r.n); return p < 0 || p > pos; }); if (at < 0) at = c.cfg.rules.length; }
      c.cfg.rules.splice(at, 0, rule);
    }
  }
  if (learned.length && !quiet) log('Learned: ' + learned.join(', ') + '.');
}
function guessMode(sp) { const k = sp.s && sp.s.kind; if (k === 'dot') return 'debuff'; if (k === 'damage') return 'spam'; return 'off'; }
function upcomingAbilities(c) {
  const out = []; const list = classAbilityList(c.cls);
  for (const n in list) { if (typeof classTalents === 'function' && classTalents(c.cls).abil[n] && !talentRank(c, n)) continue; for (const s of list[n]) if (s.lv > c.level) { out.push({ n, lv: s.lv, r: s.r, id: s.id, isNew: !c.known || !c.known[n] }); break; } }
  return out.sort((a, b) => a.lv - b.lv);
}

/* ------------------------------------------------------------- creature auras */
function mobAura(m, key) { if (!m.auras) return null; for (const a of m.auras) if (a.key === key && a.until > G.gameTime) return a; return null; }
function addMobAura(c, m, sp, e) {
  m.auras = (m.auras || []).filter((a) => a.until > G.gameTime);
  const key = sp.n; let a = m.auras.find((x) => x.key === key && x.au === e.au);
  const tm = auraTalentMods(c, sp.n, sp.dur && sp.dur > 0 ? sp.dur / 1000 : 10, e.lo); const dur = tm.dur;
  if (!a) { a = { key, au: e.au, val: tm.val, stacks: 0, src: c, t: 0 }; m.auras.push(a); }
  a.until = G.gameTime + dur; a.val = tm.val; a.src = c;
  if (sp.stack) a.stacks = Math.min(sp.stack, a.stacks + 1); else a.stacks = 1;
  if (e.au === 3) { a.every = (e.amp || 3000) / 1000; a.t = 0; a.leech = !!e.leech; }
  if (e.au === 7 || e.au === 12) { a.brk = G.gameTime + 1; }
  return a;
}
function mobMods(m) {
  const o = { armor: 0, ap: 0, haste: 1, stun: false, fear: false, snare: 1, disarm: false };
  if (!m.auras) return o;
  for (const a of m.auras) {
    if (a.until <= G.gameTime) continue;
    if (a.au === 22) o.armor += a.val * a.stacks;
    else if (a.au === 99) o.ap += a.val;
    else if (a.au === 138) o.haste *= 1 - a.val / 100;
    else if (a.au === 12) o.stun = true;
    else if (a.au === 7) o.fear = true;
    else if (a.au === 33 || a.au === 31) o.snare *= Math.max(0.2, 1 + a.val / 100);
    else if (a.au === 26) o.snare = 0;
    else if (a.au === 67) o.disarm = true;
  }
  return o;
}
function mobAuraTick(W, m, dt) {
  if (!m.auras || !m.auras.length) return;
  for (const a of m.auras) {
    if (a.au !== 3 || a.until <= G.gameTime - 0.01) continue;
    a.t += dt;
    while (a.t >= a.every && m.hp > 0) {
      a.t -= a.every; const v = Math.round(a.val * (a.src ? charStats(a.src).dmgDone : 1));
      m.hp -= v; fx(m.x, m.y, '' + v, a.leech ? '#c56cf0' : '#ff9a3c');
      if (a.src) { addThreat(m, a.src, v); if (a.leech && a.src.hp > 0) healSelf(a.src, v); }
      if (m.hp <= 0 && a.src) { killMob(a.src, m); return; }
    }
  }
  if (m.auras.length > 6) m.auras = m.auras.filter((x) => x.until > G.gameTime);
}
/* damage on a creature breaks fear (not stuns) */
function onMobDamaged(m) { if (m.auras) for (const a of m.auras) if (a.au === 7 && G.gameTime > a.brk) a.until = 0; }

/* ------------------------------------------------------------- casting */
function abilityReady(c, name, sp) {
  const r = rt(c); const now = G.gameTime;
  if ((r.cd[name] || 0) > now) return false;
  if (sp.gcd && r.gcdUntil > now) return false;
  if (c.cls === 1) {
    const cost = abilityCost(c, sp, name);
    if (cost > c.rage) return false;
    if (sp.pw && sp.pw[0] === 4294967294 && c.hp <= baseStats(c).maxHp * (sp.pw[2] || 0) / 100 + 5) return false;
    return true;
  }
  const [pt, cost] = spellCost(c, sp, name);
  if (pt === -2) return c.hp > cost + 5;
  return powerOf(c, pt) >= cost;
}
function stanceOk(c, name) { const m = (CLASS_META[c.cls] || {})[name]; if (!m || !m.st) return true; return m.st.indexOf(c.cfg.stance || 'b') >= 0; }
function shieldOk(c, name) { const m = (CLASS_META[c.cls] || {})[name]; return !m || !m.shield || charStats(c).hasShield; }
function abilityUsable(c, name) {
  const sp = c.known && c.known[name] ? spellRow(c.known[name]) : null;
  if (!sp) return { ok: false, why: 'not learned' };
  if (!stanceOk(c, name)) return { ok: false, why: 'needs ' + (CLASS_META[c.cls][name].st.split('').map((x) => STANCE_NAME[x]).join(' or ')) };
  if (!shieldOk(c, name)) return { ok: false, why: 'needs a shield' };
  if (c.cls !== 1) {
    if (!formOk(c, name)) return { ok: false, why: c.form ? 'not in ' + c.form + ' form' : 'needs ' + (/Maul|Swipe|Roar|Frenzied|Enrage|Bash/.test(name) ? 'bear' : 'cat') + ' form' };
    if ((sp.fl || []).includes('ranged') && c.cls === 3 && !rangedWeapon(c)) return { ok: false, why: 'needs a bow, gun or crossbow' };
    if (name === 'Judgement' && !(rt(c).buffs || []).some((b) => /^Seal of/.test(b.name) && b.until > G.gameTime)) return { ok: false, why: 'needs a seal' };
  }
  return { ok: true, sp };
}
function spendCost(c, sp, name) {
  if (!sp.pw) return;
  if (c.cls !== 1) { const [pt, cost] = spellCost(c, sp, name); if (pt === -2) c.hp -= cost; else addPower(c, pt, -cost); if (pt === 0 && cost > 0) rt(c).lastCast = G.gameTime; return; }
  if (sp.pw[0] === 1) c.rage = Math.max(0, c.rage - abilityCost(c, sp, name));
  else if (sp.pw[0] === 4294967294) c.hp -= Math.round(baseStats(c).maxHp * (sp.pw[2] || 0) / 100);
}
function startCooldown(c, name, sp) {
  const r = rt(c); const cd = abilityCooldown(c, sp, name);
  if (cd) r.cd[name] = G.gameTime + cd;
  if (sp.gcd) r.gcdUntil = G.gameTime + Math.max(c.cls === 1 ? 0 : 1, sp.gcd / 1000);
}
function areaTargets(c, rad, engagedOnly) {
  const W = ensureWorld(c.pos.map); const out = [];
  // creatures fighting us can be far from their spawn point (the grid is by spawn point): take them from the threat list
  if (engagedOnly) { for (const m of threatsOf(c)) if (Math.hypot(m.x - c.pos.x, m.y - c.pos.y) <= rad) out.push(m); return out; }
  mobsNear(W, c.pos.x, c.pos.y, rad + 20, (m) => {
    if (m.st !== 'alive' && m.st !== 'chase') return;
    if (behOf(m, c) === 'F' || behOf(m, c) === 'X' || m.civ) return;
    if (engagedOnly && m.tgt !== c) return;
    if (Math.hypot(m.x - c.pos.x, m.y - c.pos.y) <= rad) out.push(m);
  });
  return out;
}
/* apply all effects of a spell; returns true when something happened */
const PHYS_FLAT = { 'Bloodthirst': 1, 'Shield Slam': 1, 'Revenge': 1, 'Pummel': 1, 'Hamstring': 1, 'Shield Bash': 1, 'Intercept Stun': 1 };
function applySpell(c, sp, tgt, ctx) {
  ctx = ctx || {}; const s = charStats(c); let did = false; let weaponDone = false;
  if (sp.n === 'Last Stand') { const add = Math.round(s.maxHp * 0.3); addBuff(c, Object.assign({}, sp, { dur: 20000 }), { au: 34, mi: 0, lo: add }); c.hp += add; return true; }
  if (sp.n === 'Sweeping Strikes') { addBuff(c, Object.assign({}, sp, { dur: 20000 }), { au: 0, mi: 0, lo: 0 }); const b = rt(c).buffs.find((x) => x.name === 'Sweeping Strikes'); if (b) b.sweep = 5; return true; }
  for (const e of sp.ef || []) {
    if (c.cls !== 1 && classEffect(c, sp, e, tgt, ctx)) { did = true; continue; }
    const area = e.k === 'area_enemy';
    const targets = area ? areaTargets(c, AOE_RADIUS, true) : tgt ? [tgt] : [];   // area attacks only hit what already fights you
    switch (e.t) {
      case 17: case 58: case 121: case 31: {
        if (weaponDone || !tgt) break; weaponDone = true;
        if (c.cls === 3 && (sp.fl || []).includes('ranged') && rangedWeapon(c)) {       // Multi-Shot, Aimed Shot: the bow or gun
          const nT = sp.n === 'Multi-Shot' ? areaTargets(c, 10, true).filter((x) => x !== tgt).slice(0, 2).concat([tgt]) : [tgt];
          for (const m of nT) rangedHit(c, m, e.t === 31 ? 0 : effValue(c, sp, e, e.lo), e.t === 31 ? e.lo : 100, sp.n);
          did = true; break;
        }
        const nTargets = sp.n === 'Whirlwind' ? areaTargets(c, AOE_RADIUS, true).slice(0, 4) : [tgt];
        for (const m of nTargets) {
          const bonus = e.t === 31 ? 0 : e.lo;
          const pe = e.t === 31 ? e : (sp.ef || []).find((x) => x.t === 31);     // Backstab: 150% weapon damage plus a bonus
          const dmg = playerSwing(c, m, s, s.mh, { bonus: pe && pe !== e ? bonus * pe.lo / 100 : bonus, yellow: true, normalized: e.t === 121, pct: pe ? pe.lo : 0, name: sp.n });
          if (m.tgt !== c && m.st === 'alive') engage(m, c);
          if (m.hp <= 0) killMob(c, m);
          did = did || dmg >= 0;
        }
        break;
      }
      case 2: {
        if (c.cls === 1 && (PHYS_FLAT[sp.n] || sp.sc === 0) && !area && tgt) {
          // physical abilities with a fixed amount: they can miss, be dodged, crit and are reduced by armor
          let base = e.lo + Math.random() * Math.max(0, (e.hi || e.lo) - e.lo);
          if (sp.n === 'Bloodthirst') base = s.ap * e.lo / 100;
          if (sp.n === 'Shield Slam') base += s.blockValue;
          const d = playerSwing(c, tgt, s, { min: 0, max: 0, speed: 0 }, { bonus: base, yellow: true, name: sp.n });
          if (tgt.st === 'alive') engage(tgt, c);
          if (d > 0 && sp.n === 'Revenge' && Math.random() < 0.15 * talentRank(c, 'Improved Revenge')) addMobAura(c, tgt, { n: 'Revenge Stun', dur: 3000 }, { au: 12, lo: 0 });
          if (tgt.hp <= 0) killMob(c, tgt);
          did = true; break;
        }
        for (const m of targets) {
          if (m.st === 'dead') continue;
          const lo = e.lo, hi = Math.max(e.lo, e.hi || e.lo);
          let v = Math.round((lo + Math.random() * (hi - lo)) * s.dmgDone);
          if (Math.random() * 100 < 5 + Math.max(0, m.lvl - c.level)) { fx(m.x, m.y, 'resist', '#cfc6b0'); continue; }
          m.hp -= v; onMobDamaged(m); fx(m.x, m.y, v + '', '#ffd23a');
          if (m.st === 'alive') engage(m, c);
          if (m.hp <= 0) killMob(c, m);
        }
        did = true; break;
      }
      case 3:
        if (sp.n === 'Execute' && tgt) {
          const rank = +((sp.r || '').replace(/\D/g, '') || 1); const extra = c.rage; c.rage = 0;
          const v = Math.round((e.lo + extra * rank * 3) * s.dmgDone * (1 - clamp((tgt.armor + mobMods(tgt).armor) / ((tgt.armor + mobMods(tgt).armor) + 400 + 85 * c.level), 0, 0.75)));
          tgt.hp -= v; onMobDamaged(tgt); fx(tgt.x, tgt.y, v + ' Execute', '#ffd23a'); if (tgt.hp <= 0) killMob(c, tgt); did = true;
        }
        break;
      case 6: case 35:
        if (e.k === 'self' || e.k === 'friend') { addBuff(c, sp, e); did = true; }
        else for (const m of targets) { if (m.st === 'dead') continue; addMobAura(c, m, sp, e); if (m.st === 'alive') engage(m, c); did = true; }
        break;
      case 30: if (c.cls === 1 && (e.mi === 1 || e.mi == null)) {
        let add = e.lo / 10;
        if (sp.n === 'Charge') add += 3 * talentRank(c, 'Improved Charge');
        if (sp.n === 'Bloodrage') add += 2 * talentRank(c, 'Improved Bloodrage');
        c.rage = Math.min(100, c.rage + add); did = true;
      } break;
      case 64: if (e.tr) { const t2 = spellRow(e.tr); if (t2) { applySpell(c, Object.assign({}, t2, { n: t2.n }), e.k === 'self' ? null : tgt, ctx); did = true; } } break;
      default: break;
    }
  }
  return did;
}
function addBuff(c, sp, e) {
  const r = rt(c); r.buffs = (r.buffs || []).filter((b) => b.until > G.gameTime);
  const tm = auraTalentMods(c, sp.n, sp.dur && sp.dur > 0 ? sp.dur / 1000 : sp.dur < 0 ? 86400 : 10, e.lo); const dur = tm.dur;
  let b = r.buffs.find((x) => x.name === sp.n);
  if (!b) { b = { name: sp.n, auras: [], until: 0 }; r.buffs.push(b); }
  b.until = G.gameTime + dur;
  const ex = b.auras.find((a) => a[0] === e.au && a[1] === e.mi); if (ex) ex[2] = tm.val; else b.auras.push([e.au, e.mi, tm.val]);
  if (e.au === 4 && sp.n === 'Retaliation') b.retaliation = 30;
  if (e.au === 24) { b.ptype = e.mi == null ? 1 : e.mi; b.energize = b.ptype === 1 ? e.lo / 10 : e.lo; b.every = (e.amp || 1000) / 1000; b.t = 0; }
  if (/^Seal of/.test(sp.n) && e.au === 4) b.sealDmg = effValue(c, sp, e) / 100;
  dirty(c);
}
function buffLeft(c, name) { const r = rt(c); const b = (r.buffs || []).find((x) => x.name === name && x.until > G.gameTime); return b ? b.until - G.gameTime : 0; }
function buffStep(c, dt) {
  const r = rt(c); if (!r.buffs) return;
  for (const b of r.buffs) if (b.energize && b.until > G.gameTime) { b.t += dt; while (b.t >= b.every) { b.t -= b.every; addPower(c, b.ptype, b.energize); } }
}

/* ------------------------------------------------------------- the rule engine */
function attackersOf(c) { return rt(c).threats || []; }
function inMelee(c, m) { return m && Math.hypot(m.x - c.pos.x, m.y - c.pos.y) <= MELEE_RANGE + 1; }
function safeForAoe(c) {
  if (c.cfg.style !== 'safe') return true;
  return !areaTargets(c, AOE_RADIUS + 4).some((m) => m.tgt !== c && m.st === 'alive');
}
/* choose the target of one rule, or null if the rule does not fire now */
function ruleTarget(c, rule, sp, tgt) {
  const r = rt(c); const att = attackersOf(c); const hpPct = c.hp / charStats(c).maxHp * 100;
  const area = (sp.ef || []).some((e) => e.k === 'area_enemy'); const selfOnly = (sp.ef || []).every((e) => e.k === 'self' || e.k === 'friend');
  const name = rule.n;
  if (name === 'Execute' && !(tgt && tgt.hp / tgt.maxhp < 0.2)) return null;
  if (name === 'Overpower' && !(r.opWindow > G.gameTime && r.opTarget && r.opTarget.hp > 0)) return null;
  if (name === 'Revenge' && !(r.revWindow > G.gameTime)) return null;
  if (name === 'Charge' || name === 'Intercept') return null;          // used by the pull logic
  if (area && !safeForAoe(c)) return null;
  const defT = name === 'Overpower' ? r.opTarget : tgt;
  if (c.cls !== 1) {
    // totems, seals and weapon imbues that are still up; heal-over-time already ticking
    if (/Totem$/.test(name) && ((r.totemDmg && r.totemDmg.name === name && r.totemDmg.until > G.gameTime + 2) || buffLeft(c, name) > 2)) return null;
    if ((sp.ef || []).some((e) => e.au === 8 && (e.k === 'self' || e.k === 'friend')) && buffLeft(c, name) > 1) return null;
    const mp = usesMana(c) ? c.mana / Math.max(1, charStats(c).maxMana) * 100 : 100;
    switch (rule.mode) {
      case 'heal': return att.length && hpPct < (rule.p || 35) ? c : null;
      case 'finisher': {
        if (!tgt || r.cpTgt !== tgt || !r.cp) return null;
        const selfBuff = (sp.ef || []).some((e) => e.k === 'self' && (e.t === 6 || e.t === 35));
        const dmg = (sp.ef || []).some((e) => e.t === 2 || (e.au === 3 && e.k === 'enemy'));
        if (selfBuff && (buffLeft(c, name) > 1 || tgt.hp / tgt.maxhp < 0.5)) return null;        // Slice and Dice: only on a fresh target
        if (r.cp >= Math.min(rule.p || 3, 5)) return tgt;
        if (dmg && name !== 'Rupture' && name !== 'Rip' && tgt.hp / tgt.maxhp < 0.2) return tgt;                   // finish it off with what there is
        return null;
      }
      case 'lowmana': return att.length && mp < (rule.p || 20) && (name !== 'Life Tap' || hpPct > 50) ? c : null;
      case 'execute': return tgt && tgt.hp / tgt.maxhp * 100 < (rule.p || 20) ? tgt : null;
      case 'petheal': return att.length && petAlive(c) && c.pet.hp < c.pet.maxhp * (rule.p || 40) / 100 ? c : null;
      case 'form': return att.length && hpPct > 35 && wantedForm(c) && c.form !== wantedForm(c) && formSpellName(c, wantedForm(c)) === name ? c : null;
      case 'opener': {
        if (!tgt) return null;
        if (selfOnly) return buffLeft(c, name) <= 0 && (rule.p == null || hpPct <= (rule.p || 100) || true) ? c : null;
        if (mobAura(tgt, name) || (tgt.hp < tgt.maxhp * 0.97 && r.opened === tgt)) return null;
        return tgt;
      }
      case 'buff':
        if (!att.length || buffLeft(c, sp.n) > 3) return null;
        if (sp.dur >= 60000 && !/^Seal|Totem$|Lightning Shield|Weapon$/.test(name)) return null;      // long buffs are put on between fights
        return c;
      case 'pet': case 'conjure': return null;
      case 'spam': if (/^Seal of/.test(name)) return buffLeft(c, name) > 1 ? null : c; break;
      case 'emergency': if (/Shield$|Barrier|Block$/.test(name) && buffLeft(c, name) > 0) return null; break;
      default: break;
    }
  }
  switch (rule.mode) {
    case 'spam': return selfOnly || area ? (att.length ? tgt || c : null) : defT;
    case 'rage': return c.rage >= (rule.p || 0) ? defT : null;
    case 'lowrage': return att.length && c.rage < (rule.p || 20) ? c : null;
    case 'buff': return att.length && buffLeft(c, sp.n) < 8 ? c : null;
    case 'emergency': return att.length && hpPct < (rule.p || 30) ? (selfOnly ? c : tgt) : null;
    case 'multi': {
      if (att.length < (rule.p || 2)) return null;
      // a debuff-only shout (Demoralizing Shout, Piercing Howl ...): only when someone fighting us does not have it yet
      const debuffOnly = (sp.ef || []).length && (sp.ef || []).every((e) => (e.t === 6 || e.t === 35) && e.k !== 'self' && e.k !== 'friend');
      if (debuffOnly && !att.some((m) => inMelee(c, m) && !mobAura(m, sp.n))) return null;
      return selfOnly || area ? c : tgt;
    }
    case 'flee': return tgt && tgt.fleeing && !mobAura(tgt, sp.n) ? tgt : null;
    case 'stack': { if (!tgt) return null; const a = mobAura(tgt, sp.n); return !a || a.stacks < (rule.p || 1) || a.until - G.gameTime < 3 ? tgt : null; }
    case 'debuff': {
      if (!tgt || tgt.hp / tgt.maxhp < 0.25) return null;
      if (area) return mobAura(tgt, sp.n) ? null : c;
      return mobAura(tgt, sp.n) ? null : tgt;
    }
    case 'debuffAll': {
      for (const m of att) if (inMelee(c, m) && m.hp / m.maxhp > 0.25 && !mobAura(m, sp.n)) return area ? c : m;
      return null;
    }
    default: return null;
  }
}
/* cost of a next-swing ability (Heroic Strike, Maul, Raptor Strike) in its own power */
function queuedCost(c, sp, name) { return c.cls === 1 ? [1, abilityCost(c, sp, name)] : spellCost(c, sp, name); }
function useAbilities(c, tgt) {
  const r = rt(c); if (!c.cfg || !c.cfg.rules) return;
  if (r.cast) return;
  const dist_ = tgt ? Math.hypot(tgt.x - c.pos.x, tgt.y - c.pos.y) : 0;
  let wanted = false;
  for (const rule of c.cfg.rules) {
    if (rule.mode === 'off') continue;
    const u = abilityUsable(c, rule.n); if (!u.ok) continue; const sp = u.sp;
    const nextSwing = (sp.fl || []).includes('next_swing');
    if (nextSwing) {
      if (r.queued || !inMelee(c, tgt)) continue;
      let ok = false; const [pt, cost] = queuedCost(c, sp, rule.n); const pw = powerOf(c, pt);
      if (rule.mode === 'spam') ok = true;
      else if (rule.mode === 'rage') ok = pw >= (rule.p || 0);
      else if (rule.mode === 'multi') ok = attackersOf(c).length >= (rule.p || 2) && pw >= (rule.r || 0);
      if (ok && pw >= cost && (r.cd[rule.n] || 0) <= G.gameTime) r.queued = { name: rule.n, sp };
      continue;
    }
    const t0 = ruleTarget(c, rule, sp, tgt); if (!t0) continue;
    if (!abilityReady(c, rule.n, sp)) { if (c.cls !== 1 && (r.cd[rule.n] || 0) <= G.gameTime) wanted = true; continue; }
    const t = t0;
    const mob = t === c ? tgt : t;
    const melee = sp.rng && sp.rng[1] <= 6;
    if (melee && !inMelee(c, mob)) continue;
    if (c.cls !== 1 && t !== c && mob) {
      const dm = Math.hypot(mob.x - c.pos.x, mob.y - c.pos.y);
      if (sp.rng && sp.rng[1] > 6 && dm > sp.rng[1] + 1) continue;
      if (sp.rng && sp.rng[0] >= 5 && dm < sp.rng[0]) continue;        // hunter shots need 8 yards
    }
    if (c.cls !== 1) {
      if (FINISHERS[rule.n]) { r.cpUse = r.cp || 0; r.cp = 0; }
      if (rule.mode === 'opener' && t !== c) r.opened = mob;
      startCast(c, rule.n, sp, t === c ? c : mob);
      r.cpUse = 0; r.noSpell = false;
      return;
    }
    spendCost(c, sp, rule.n); startCooldown(c, rule.n, sp);
    applySpell(c, sp, mob);
    if (rule.n === 'Slam') r.swingT = Math.max(r.swingT, 1.5 - 0.1 * talentRank(c, 'Improved Slam')) + charStats(c).mh.speed * 0.5;
    if (rule.n === 'Berserker Rage' && talentRank(c, 'Improved Berserker Rage')) c.rage = Math.min(100, c.rage + 5 * talentRank(c, 'Improved Berserker Rage'));
    if (rule.n === 'Overpower') r.opWindow = 0;
    if (rule.n === 'Revenge') r.revWindow = 0;
    fx(c.pos.x, c.pos.y, rule.n, '#ffe9a8');
    return;
  }
  if (c.cls !== 1 && r.gcdUntil <= G.gameTime) r.noSpell = wanted || !usesMana(c) || c.mana < charStats(c).maxMana * 0.1;
}
/* the pull: Charge / Intercept when the target is 8-25 yards away */
function tryOpener(c, m) {
  if (!c.cfg || (rt(c).threats && rt(c).threats.length)) return false;
  for (const n of ['Charge', 'Intercept']) {
    const rule = c.cfg.rules.find((x) => x.n === n); if (!rule || rule.mode !== 'opener') continue;
    const u = abilityUsable(c, n); if (!u.ok || !abilityReady(c, n, u.sp)) continue;
    const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y); if (d < 8 || d > 25) continue;
    spendCost(c, u.sp, n); startCooldown(c, n, u.sp);
    rt(c).charging = { m, sp: u.sp, name: n };
    fx(c.pos.x, c.pos.y, n, '#ffe9a8');
    return true;
  }
  return false;
}
function chargeStep(c, dt) {
  const r = rt(c); const ch = r.charging; const m = ch.m;
  if (!m || m.st === 'dead') { r.charging = null; return; }
  const dx = m.x - c.pos.x, dy = m.y - c.pos.y, d = Math.hypot(dx, dy);
  const step = 28 * dt;
  if (d - MELEE_RANGE + 1 <= step) {
    c.pos.x += dx / d * Math.max(0, d - 3); c.pos.y += dy / d * Math.max(0, d - 3);
    r.charging = null; engage(m, c); applySpell(c, ch.sp, m); r.swingT = Math.min(r.swingT, 0.1);
  } else { c.pos.x += dx / d * step; c.pos.y += dy / d * step; c.pos.o = Math.atan2(dx, dy); }
}
