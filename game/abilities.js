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
function defaultCfg() { return { style: 'balanced', sitAt: 70, standAt: 100, eatAt: 60, potionAt: 30, stance: 'b', rules: [] }; }

/* ------------------------------------------------------------- learning */
function classAbilityList(cls) {
  G.abilCache = G.abilCache || {};
  if (G.abilCache[cls]) return G.abilCache[cls];
  const groups = {};
  for (const id in G.d.spells.spells) {
    const sp = G.d.spells.spells[id];
    if (!sp.cls || !sp.cls.includes(cls) || !sp.lv) continue;
    const src = sp.src || [];
    if (!src.includes('class') || src.includes('talent')) continue;
    if ((sp.fl || []).some((f) => f === 'passive' || f === 'hidden' || f === 'ranged')) continue;
    (groups[sp.n] = groups[sp.n] || []).push(Object.assign({ id: +id }, sp));
  }
  const out = {};
  for (const n in groups) {
    let l = groups[n]; if (l.some((x) => /Rank/.test(x.r || ''))) l = l.filter((x) => /Rank/.test(x.r || ''));
    l.sort((a, b) => a.lv - b.lv); out[n] = l;
  }
  G.abilCache[cls] = out; return out;
}
function knownRank(c, name) { const l = classAbilityList(c.cls)[name]; if (!l) return null; let b = null; for (const s of l) if (s.lv <= c.level) b = s; return b; }
function learnAbilities(c, quiet) {
  const list = classAbilityList(c.cls); const meta = CLASS_META[c.cls] || {}; c.known = c.known || {};
  const order = Object.keys(meta); const learned = [];
  for (const n in list) {
    const sp = knownRank(c, n); if (!sp) continue;
    if (c.known[n] !== sp.id) { if (c.known[n] == null || c.known[n] !== sp.id) learned.push(n + (sp.r ? ' (' + sp.r + ')' : '')); c.known[n] = sp.id; }
    if (STANCES[n]) continue;
    if (!c.cfg.rules.find((r) => r.n === n)) {
      const m = meta[n] || { def: { mode: guessMode(sp) } }; const rule = Object.assign({ n }, m.def);
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
  for (const n in list) for (const s of list[n]) if (s.lv > c.level) { out.push({ n, lv: s.lv, r: s.r, id: s.id, isNew: !c.known || !c.known[n] }); break; }
  return out.sort((a, b) => a.lv - b.lv);
}

/* ------------------------------------------------------------- creature auras */
function mobAura(m, key) { if (!m.auras) return null; for (const a of m.auras) if (a.key === key && a.until > G.gameTime) return a; return null; }
function addMobAura(c, m, sp, e) {
  m.auras = (m.auras || []).filter((a) => a.until > G.gameTime);
  const key = sp.n; let a = m.auras.find((x) => x.key === key && x.au === e.au);
  const dur = sp.dur && sp.dur > 0 ? sp.dur / 1000 : 10;
  if (!a) { a = { key, au: e.au, val: e.lo, stacks: 0, src: c, t: 0 }; m.auras.push(a); }
  a.until = G.gameTime + dur; a.val = e.lo; a.src = c;
  if (sp.stack) a.stacks = Math.min(sp.stack, a.stacks + 1); else a.stacks = 1;
  if (e.au === 3) { a.every = (e.amp || 3000) / 1000; a.t = 0; }
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
      m.hp -= v; fx(m.x, m.y, '' + v, '#ff9a3c');
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
  const cost = sp.pw && sp.pw[0] === 1 ? sp.pw[1] : 0;
  if (cost > c.rage) return false;
  if (sp.pw && sp.pw[0] === 4294967294 && c.hp <= baseStats(c).maxHp * (sp.pw[2] || 0) / 100 + 5) return false;
  return true;
}
function stanceOk(c, name) { const m = (CLASS_META[c.cls] || {})[name]; if (!m || !m.st) return true; return m.st.indexOf(c.cfg.stance || 'b') >= 0; }
function shieldOk(c, name) { const m = (CLASS_META[c.cls] || {})[name]; return !m || !m.shield || charStats(c).hasShield; }
function abilityUsable(c, name) {
  const sp = c.known && c.known[name] ? spellRow(c.known[name]) : null;
  if (!sp) return { ok: false, why: 'not learned' };
  if (!stanceOk(c, name)) return { ok: false, why: 'needs ' + (CLASS_META[c.cls][name].st.split('').map((x) => STANCE_NAME[x]).join(' or ')) };
  if (!shieldOk(c, name)) return { ok: false, why: 'needs a shield' };
  return { ok: true, sp };
}
function spendCost(c, sp) {
  if (!sp.pw) return;
  if (sp.pw[0] === 1) c.rage = Math.max(0, c.rage - sp.pw[1]);
  else if (sp.pw[0] === 4294967294) c.hp -= Math.round(baseStats(c).maxHp * (sp.pw[2] || 0) / 100);
}
function startCooldown(c, name, sp) {
  const r = rt(c); const cd = (sp.cd || sp.catcd || 0) / 1000;
  if (cd) r.cd[name] = G.gameTime + cd;
  if (sp.gcd) r.gcdUntil = G.gameTime + sp.gcd / 1000;
}
function areaTargets(c, rad, engagedOnly) {
  const W = ensureWorld(c.pos.map); const out = [];
  mobsNear(W, c.pos.x, c.pos.y, rad + 20, (m) => {
    if (m.st !== 'alive' && m.st !== 'chase') return;
    if (behOf(m, c) === 'F' || behOf(m, c) === 'X' || m.civ) return;
    if (engagedOnly && m.tgt !== c) return;
    if (Math.hypot(m.x - c.pos.x, m.y - c.pos.y) <= rad) out.push(m);
  });
  return out;
}
/* apply all effects of a spell; returns true when something happened */
function applySpell(c, sp, tgt, ctx) {
  ctx = ctx || {}; const s = charStats(c); let did = false; let weaponDone = false;
  for (const e of sp.ef || []) {
    const area = e.k === 'area_enemy';
    const targets = area ? areaTargets(c, AOE_RADIUS, true) : tgt ? [tgt] : [];   // area attacks only hit what already fights you
    switch (e.t) {
      case 17: case 58: case 121: case 31: {
        if (weaponDone || !tgt) break; weaponDone = true;
        const nTargets = sp.n === 'Whirlwind' ? areaTargets(c, AOE_RADIUS, true).slice(0, 4) : [tgt];
        for (const m of nTargets) {
          const bonus = e.t === 31 ? 0 : e.lo;
          const dmg = playerSwing(c, m, s, s.mh, { bonus, yellow: true, normalized: e.t === 121, pct: e.t === 31 ? e.lo : 0, name: sp.n });
          if (m.tgt !== c && m.st === 'alive') engage(m, c);
          if (m.hp <= 0) killMob(c, m);
          did = did || dmg >= 0;
        }
        break;
      }
      case 2: {
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
      case 30: if (e.mi === 1 || e.mi == null) { c.rage = Math.min(100, c.rage + e.lo / 10); did = true; } break;
      case 64: if (e.tr) { const t2 = spellRow(e.tr); if (t2) { applySpell(c, Object.assign({}, t2, { n: t2.n }), e.k === 'self' ? null : tgt, ctx); did = true; } } break;
      default: break;
    }
  }
  return did;
}
function addBuff(c, sp, e) {
  const r = rt(c); r.buffs = (r.buffs || []).filter((b) => b.until > G.gameTime);
  const dur = sp.dur && sp.dur > 0 ? sp.dur / 1000 : 10;
  let b = r.buffs.find((x) => x.name === sp.n);
  if (!b) { b = { name: sp.n, auras: [], until: 0 }; r.buffs.push(b); }
  b.until = G.gameTime + dur;
  if (!b.auras.some((a) => a[0] === e.au && a[1] === e.mi)) b.auras.push([e.au, e.mi, e.lo]);
  if (e.au === 4 && sp.n === 'Retaliation') b.retaliation = 30;
  if (e.au === 24) { b.energize = e.lo / 10; b.every = (e.amp || 1000) / 1000; b.t = 0; }
  dirty(c);
}
function buffLeft(c, name) { const r = rt(c); const b = (r.buffs || []).find((x) => x.name === name && x.until > G.gameTime); return b ? b.until - G.gameTime : 0; }
function buffStep(c, dt) {
  const r = rt(c); if (!r.buffs) return;
  for (const b of r.buffs) if (b.energize && b.until > G.gameTime) { b.t += dt; while (b.t >= b.every) { b.t -= b.every; c.rage = Math.min(100, c.rage + b.energize); } }
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
  switch (rule.mode) {
    case 'spam': return selfOnly || area ? (att.length ? tgt || c : null) : defT;
    case 'rage': return c.rage >= (rule.p || 0) ? defT : null;
    case 'lowrage': return att.length && c.rage < (rule.p || 20) ? c : null;
    case 'buff': return att.length && buffLeft(c, sp.n) < 8 ? c : null;
    case 'emergency': return att.length && hpPct < (rule.p || 30) ? (selfOnly ? c : tgt) : null;
    case 'multi': return att.length >= (rule.p || 2) ? (selfOnly || area ? c : tgt) : null;
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
function useAbilities(c, tgt) {
  const r = rt(c); if (!c.cfg || !c.cfg.rules) return;
  for (const rule of c.cfg.rules) {
    if (rule.mode === 'off') continue;
    const u = abilityUsable(c, rule.n); if (!u.ok) continue; const sp = u.sp;
    const nextSwing = (sp.fl || []).includes('next_swing');
    if (nextSwing) {
      if (r.queued) continue;
      let ok = false;
      if (rule.mode === 'spam') ok = true;
      else if (rule.mode === 'rage') ok = c.rage >= (rule.p || 0);
      else if (rule.mode === 'multi') ok = attackersOf(c).length >= (rule.p || 2) && c.rage >= (rule.r || 0);
      const cost = sp.pw && sp.pw[0] === 1 ? sp.pw[1] : 0;
      if (ok && c.rage >= cost) r.queued = { name: rule.n, sp };
      continue;
    }
    if (!abilityReady(c, rule.n, sp)) continue;
    const t = ruleTarget(c, rule, sp, tgt); if (!t) continue;
    const mob = t === c ? tgt : t;
    const melee = sp.rng && sp.rng[1] <= 6;
    if (melee && !inMelee(c, mob)) continue;
    spendCost(c, sp); startCooldown(c, rule.n, sp);
    applySpell(c, sp, mob);
    if (rule.n === 'Overpower') r.opWindow = 0;
    if (rule.n === 'Revenge') r.revWindow = 0;
    fx(c.pos.x, c.pos.y, rule.n, '#ffe9a8');
    return;
  }
}
/* the pull: Charge / Intercept when the target is 8-25 yards away */
function tryOpener(c, m) {
  if (!c.cfg || (rt(c).threats && rt(c).threats.length)) return false;
  for (const n of ['Charge', 'Intercept']) {
    const rule = c.cfg.rules.find((x) => x.n === n); if (!rule || rule.mode !== 'opener') continue;
    const u = abilityUsable(c, n); if (!u.ok || !abilityReady(c, n, u.sp)) continue;
    const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y); if (d < 8 || d > 25) continue;
    spendCost(c, u.sp); startCooldown(c, n, u.sp);
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
