'use strict';
/* mercs.js - the mercenaries (the hired dungeon companions) play their class: mana, rage or energy, spells with a cast
   time (shown in a cast bar on their unit frame), buffs on the group (Fortitude, Arcane Intellect, Mark of the Wild,
   blessings, Battle Shout, auras, totems), debuffs and damage over time on the creatures (Sunder Armor, Demoralizing
   Shout, Faerie Fire, Shadow Word: Pain, curses ...). The ranks are the ones a player of the character's level has.
   partyStep (dungeons.js) moves them and calls in here. */

const MERC_KIT = {
  1: { buffs: ['Battle Shout'], deb: { tank: ['Sunder Armor', 'Demoralizing Shout', 'Thunder Clap'], dps: ['Sunder Armor'] } },
  2: { blessing: true, aura: 'Devotion Aura', deb: { all: ['Judgement of the Crusader'] }, heal: ['Holy Light'], fast: 'Flash of Light' },
  3: { aura: 'Trueshot Aura', self: ['Aspect of the Hawk'], deb: { all: ["Hunter's Mark", 'Serpent Sting'] }, nuke: ['Aimed Shot', 'Arcane Shot'], ranged: true },
  4: { deb: { all: ['Rupture'] } },
  5: { buffs: ['Power Word: Fortitude', 'Divine Spirit'], deb: { dps: ['Shadow Word: Pain'] }, heal: ['Greater Heal', 'Heal', 'Lesser Heal'], fast: 'Flash Heal', hot: 'Renew', shield: 'Power Word: Shield', nuke: ['Mind Blast', 'Smite'], ranged: true },
  7: { totems: ['Strength of Earth Totem', 'Mana Spring Totem'], self: ['Lightning Shield'], deb: { all: ['Flame Shock'] }, heal: ['Healing Wave'], nuke: ['Lightning Bolt'], ranged: true },
  8: { buffs: ['Arcane Intellect'], self: ['Mage Armor', 'Ice Armor', 'Frost Armor'], nuke: ['Frostbolt'], ranged: true },
  9: { self: ['Demon Armor', 'Demon Skin'], deb: { all: ['Curse of Agony', 'Corruption', 'Immolate'] }, nuke: ['Shadow Bolt'], ranged: true },
  11: { buffs: ['Mark of the Wild', 'Thorns'], deb: { all: ['Faerie Fire'], dps: ['Faerie Fire', 'Moonfire', 'Insect Swarm'] }, heal: ['Healing Touch'], fast: 'Regrowth', hot: 'Rejuvenation', nuke: ['Wrath'], ranged: true },
};
/* what the buffs do for a mercenary (their numbers are kept simple: share of health, damage, mana, regen, armor) */
const MERC_BUFF_FX = {
  'Power Word: Fortitude': { hp: 0.08 }, 'Mark of the Wild': { hp: 0.04, dps: 0.04, arm: 0.03 }, 'Blessing of Kings': { hp: 0.1, dps: 0.1 },
  'Blessing of Might': { dps: 0.08 }, 'Battle Shout': { dps: 0.07 }, 'Trueshot Aura': { dps: 0.04 }, 'Strength of Earth Totem': { dps: 0.05 }, 'Aspect of the Hawk': { dps: 0.06 },
  'Arcane Intellect': { mana: 0.1 }, 'Divine Spirit': { regen: 0.25 }, 'Blessing of Wisdom': { regen: 0.25 }, 'Mana Spring Totem': { regen: 0.3 }, 'Mage Armor': { regen: 0.2 },
  'Devotion Aura': { arm: 0.05 }, 'Frost Armor': { arm: 0.04 }, 'Ice Armor': { arm: 0.06 }, 'Demon Skin': { arm: 0.04 }, 'Demon Armor': { arm: 0.07 },
};
const MERC_MELEE_BLESS = new Set([1, 3, 4]);       // Might for these, Wisdom for the mana users
const MERC_MANA_BUFF = /Arcane Intellect|Divine Spirit|Arcane Brilliance|Prayer of Spirit/;
function mercUsesMana(t) { return t.merc ? t.merc.pt === 0 : usesMana(t.c) && !(t.c.cls === 11 && t.c.form); }
const MERC_DEBUFF_AU = new Set([3, 14, 22, 31, 33, 99, 124, 138]);

/* the rank of a spell a player of level L has */
function mercSpell(cls, name, L) {
  const l = classAbilityList(cls)[name]; if (!l) return null; let best = null;
  for (const s of l) if ((s.lv || 1) <= L) best = s;
  return best;
}
function mercLevel(c) { return c.level; }
function mercKit(u) { return MERC_KIT[u.cls] || {}; }
/* power: 0 mana, 1 rage, 3 energy */
function mercInit(c, u) {
  const L = mercLevel(c);
  u.pt = u.cls === 1 || (u.cls === 11 && u.role === 'tank') ? 1 : u.cls === 4 ? 3 : 0;
  const cs = G.d.races.classstats && G.d.races.classstats[u.cls] && G.d.races.classstats[u.cls][L - 1];
  u.baseMana = u.pt === 0 ? Math.round((cs ? cs[1] : L * 18) + L * L * 1.1 + L * 10) : 0;
  u.maxmana = u.baseMana; u.mana = u.maxmana; u.rage = 0; u.energy = 100;
  u.baseHp = u.maxhp; u.buffs = []; u.cb = null; u.gcd = 0; u.lastCast = -99; u.potT = -999;
  u.dps0 = u.dps; u.arm0 = u.armorRed;
}
function mercPower(u) { return u.pt === 1 ? u.rage || 0 : u.pt === 3 ? u.energy || 0 : u.mana || 0; }
function mercPowerMax(u) { return u.pt === 0 ? u.maxmana || 0 : 100; }
function mercCost(c, u, sp) {
  const pw = sp && sp.pw; if (!pw) return 0;
  if (pw[0] === 1 || pw[0] === 3) return (pw[1] || 0) / (pw[0] === 1 ? 10 : 1);
  if (pw[0] !== 0 || u.pt !== 0) return 0;
  let v = pw[1] || 0; if (pw[2]) { const cs = G.d.races.classstats[u.cls] && G.d.races.classstats[u.cls][mercLevel(c) - 1]; v = Math.round((cs ? cs[1] : 0) * pw[2] / 100); }
  return Math.min(v, u.maxmana * 0.05);      // they wear gear with mana on it
}
function mercPay(u, cost) {
  if (u.pt === 1) u.rage = Math.max(0, u.rage - cost); else if (u.pt === 3) u.energy = Math.max(0, u.energy - cost); else { u.mana = Math.max(0, u.mana - cost); u.lastCast = G.gameTime; }
}
/* the buffs on a mercenary and what they add up to */
function mercBuff(u, name) { return (u.buffs || []).find((b) => b.name === name && b.until > G.gameTime) || null; }
function mercMods(c, u) {
  const now = G.gameTime; u.buffs = (u.buffs || []).filter((b) => b.until > now);
  const m = { hp: 0, dps: 0, mana: 0, regen: 0, arm: 0 };
  for (const b of u.buffs) { const f = MERC_BUFF_FX[b.name]; if (f) for (const k in f) m[k] += f[k]; }
  const hp = Math.round(u.baseHp * (1 + m.hp)); if (hp !== u.maxhp) { if (!u.dead && hp > u.maxhp) u.hp += hp - u.maxhp; u.maxhp = hp; u.hp = Math.min(u.hp, hp); }
  if (u.pt === 0) { const mm = Math.round(u.baseMana * (1 + m.mana)); if (mm !== u.maxmana) { if (mm > u.maxmana) u.mana += mm - u.maxmana; u.maxmana = mm; u.mana = Math.min(u.mana, mm); } }
  u.dps = u.dps0 * (1 + m.dps); u.armorRed = 1 - (1 - u.arm0) * (1 - m.arm);
  u.mods = m; return m;
}
/* a buff landing on someone of the group: the character (or another of your characters), or a mercenary */
function mercGiveBuff(c, from, to, name, sp, dur) {
  const until = G.gameTime + (dur || (sp && sp.dur > 0 ? sp.dur / 1000 : 600));
  if (to.merc) {
    const u = to.merc; let b = mercBuff(u, name); if (!b) { b = { name, ic: sp && sp.ic, until: 0 }; u.buffs.push(b); }
    b.until = until; b.ic = (sp && sp.ic) || b.ic; mercMods(c, u);
    return;
  }
  const o = to.c; if (!sp) return;
  for (const e of sp.ef || []) if ((e.t === 6 || e.t === 35) && e.au && e.k !== 'enemy' && e.k !== 'area_enemy') addBuff(o, Object.assign({}, sp, { n: name, dur: (until - G.gameTime) * 1000 }), e);
  const b = (rt(o).buffs || []).find((x) => x.name === name); if (b) b.ic = sp.ic;
  if (from) withLog(o, () => { if (o !== c || isActive(c)) log(from.name + ' casts ' + name + ' on you.'); });
}
function mercHasBuff(t, name, left) {
  left = left == null ? 60 : left;
  if (t.merc) { const b = mercBuff(t.merc, name); return !!b && b.until - G.gameTime > left; }
  const b = (rt(t.c).buffs || []).find((x) => x.name === name && x.until > G.gameTime); return !!b && b.until - G.gameTime > left;
}
/* everyone the mercenaries look after: the character, your other characters in the group near, the mercenaries */
function mercFolk(c) {
  const p = partyOf(c) || []; const myRole = typeof grpRole === 'function' && typeof groupOf === 'function' && groupOf(c) ? grpRole(c) : !p.some((u) => u.role === 'tank') ? 'tank' : !p.some((u) => u.role === 'healer') ? 'healer' : 'dps';
  const out = []; if (!rt(c).ghost && c.hp > 0) out.push({ c, cls: c.cls, x: c.pos.x, y: c.pos.y, role: myRole });
  if (typeof groupOf === 'function' && groupOf(c)) for (const o of groupChars(groupOf(c))) if (o !== c && o.pos.map === c.pos.map && !rt(o).ghost && o.hp > 0 && Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) < 40) out.push({ c: o, cls: o.cls, x: o.pos.x, y: o.pos.y, role: grpRole(o) });
  for (const u of partyOf(c) || []) if (!u.dead) out.push({ merc: u, cls: u.cls, x: u.x, y: u.y, role: u.role });
  return out;
}
/* the buff a mercenary owes the group right now: [target, name, spell] or null */
function mercBuffDue(c, u, inFight) {
  const k = mercKit(u); const L = mercLevel(c); const folk = mercFolk(c); const me = folk.find((t) => t.merc === u);
  const sp = (n) => mercSpell(u.cls, n, L);
  if (!inFight) {
    for (const n of k.self || []) { const s = sp(n); if (s) { if (!mercHasBuff(me, n)) return [me, n, s]; break; } }
    for (const n of k.buffs || []) {
      const s = sp(n); if (!s || n === 'Battle Shout') continue;
      const who = n === 'Thorns' ? folk.filter((t) => t.role === 'tank') : MERC_MANA_BUFF.test(n) ? folk.filter(mercUsesMana) : folk;
      for (const t of who) if (!mercHasBuff(t, n)) return [t, n, s];
    }
    if (k.blessing) for (const t of folk) {
      const n = MERC_MELEE_BLESS.has(t.cls) || t.role === 'tank' || (t.cls === 2 && t.role !== 'healer') ? 'Blessing of Might' : 'Blessing of Wisdom'; const s = sp(n) || sp('Blessing of Might'); if (!s) break;
      if (!mercHasBuff(t, s.n, 30)) return [t, s.n, s];
    }
  }
  if (k.buffs && k.buffs.includes('Battle Shout') && inFight) { const s = sp('Battle Shout'); if (s && !mercHasBuff(me, 'Battle Shout', 5)) return [null, 'Battle Shout', s]; }
  if (k.totems && inFight) for (const n of k.totems) { const s = sp(n); if (s && !mercHasBuff(me, n, 3)) return [null, n, s]; }
  return null;
}
/* the aura (paladin, hunter): on everyone near, as long as the mercenary lives */
function mercAuraStep(c, u) {
  const n = mercKit(u).aura; if (!n) return; const s = mercSpell(u.cls, n, mercLevel(c)); if (!s) return;
  if (G.gameTime - (u.auraT || -99) < 5) return; u.auraT = G.gameTime;
  for (const t of mercFolk(c)) if (Math.hypot(t.x - u.x, t.y - u.y) < 30) { if (t.merc) mercGiveBuff(c, null, t, n, s, 8); else if (!mercHasBuff(t, n, 3)) mercGiveBuff(c, null, t, n, s, 8); }
}
function mercCastBuff(c, u, due) {
  const [t, n, s] = due; const cost = mercCost(c, u, s); if (mercPower(u) < cost) return false;
  mercPay(u, cost); u.gcd = G.gameTime + 1.5;
  if (t) mercGiveBuff(c, u, t, n, s);
  else {      // Battle Shout, a totem: the whole group near
    const dur = /Totem/.test(n) ? 120 : null;
    for (const x of mercFolk(c)) if (Math.hypot(x.x - u.x, x.y - u.y) < 30) mercGiveBuff(c, null, x, n, s, dur);
  }
  fx(u.x, u.y, n, '#9fe0ff'); return true;
}

/* ------------------------------------------------------------------ casting with a cast bar */
function mercStartCast(c, u, n, sp, tgt, time, done) {
  u.cb = { name: n, ic: sp && sp.ic, t: 0, total: Math.max(0.3, time), tgt, done };
  u.gcd = G.gameTime + 1.5;
}
/* true while casting (the mercenary does nothing else) */
function mercCastStep(c, u, dt) {
  const k = u.cb; if (!k) return false;
  if (k.tgt && k.tgt.st && (k.tgt.st === 'dead' || k.tgt.hp <= 0)) { u.cb = null; return false; }
  k.t += dt; if (k.t < k.total) return true;
  u.cb = null; k.done(); return false;
}

/* ------------------------------------------------------------------ power over time */
function mercRegen(c, u, dt, inFight) {
  const m = u.mods || mercMods(c, u);
  if (u.pt === 3) { u.energy = Math.min(100, (u.energy || 0) + 10 * dt); u.drinking = false; return; }
  if (u.pt === 1) { if (!inFight) u.rage = Math.max(0, (u.rage || 0) - 3 * dt); u.drinking = false; return; }
  if (!u.maxmana) return;
  let rate;
  if (inFight) { rate = (G.gameTime - u.lastCast > 5 ? 0.02 : 0.006) * (1 + m.regen); u.drinking = false; }
  else { u.drinking = u.drinking ? u.mana < u.maxmana : u.mana < u.maxmana * 0.8; rate = u.drinking ? 0.07 : 0.02 * (1 + m.regen); }
  u.mana = Math.min(u.maxmana, u.mana + u.maxmana * rate * dt);
  // a mana potion when it runs dry in a fight
  if (inFight && u.mana < u.maxmana * 0.15 && G.gameTime - u.potT > 120 && (u.role === 'healer' || Math.random() < 0.5)) { u.potT = G.gameTime; u.mana = Math.min(u.maxmana, u.mana + u.maxmana * 0.3); fx(u.x, u.y, 'Mana Potion', '#7fa8ff'); }
}
/* the mercenaries still drinking: the group waits for them before the next pull */
function mercsResting(c) { return (partyOf(c) || []).some((u) => !u.dead && u.drinking); }

/* ------------------------------------------------------------------ out of combat */
function mercIdle(c, u, dt) {
  mercMods(c, u); mercRegen(c, u, dt, false); mercAuraStep(c, u); mercHotStep(c, u, dt);
  if (mercCastStep(c, u, dt)) return;
  if (u.gcd > G.gameTime || u.drinking) return;
  const due = mercBuffDue(c, u, false); if (due) mercCastBuff(c, u, due);
}

/* ------------------------------------------------------------------ debuffs and damage over time on the creatures */
function mercDebuffDue(c, u, m, threats) {
  const k = mercKit(u); const list = (k.deb && (k.deb[u.role] || k.deb.all)) || []; const L = mercLevel(c);
  const big = m.rank > 0 || m.maxhp > 3 * (u.baseHp || 100);
  if (m.hp / m.maxhp < (big ? 0.15 : 0.4)) return null;          // not worth it any more
  for (const n of list) {
    const s = mercSpell(u.cls, n, L); if (!s) continue;
    const area = n === 'Demoralizing Shout' || n === 'Thunder Clap';
    if (area) { const near = threats.filter((x) => x.st !== 'dead' && Math.hypot(x.x - u.x, x.y - u.y) < 10); if ((near.length >= 2 || big) && near.some((x) => !mobAura(x, n))) return [n, s, near]; continue; }
    const a = mobAura(m, n);
    if (n === 'Sunder Armor') { if (!a || a.stacks < 5 || a.until - G.gameTime < 5) return [n, s, [m]]; continue; }
    if (!a || a.until - G.gameTime < 1.5) return [n, s, [m]];
  }
  return null;
}
function mercApplyDebuff(c, u, n, sp, mobs) {
  const L = mercLevel(c); const now = G.gameTime;
  const cost = mercCost(c, u, sp); if (mercPower(u) < cost) return false; mercPay(u, cost); u.gcd = now + 1.5;
  for (const m of mobs) {
    if (m.st === 'dead') continue; m.auras = (m.auras || []).filter((a) => a.until > now);
    const dur = sp.dur > 0 ? sp.dur / 1000 : 15; let did = false;
    for (const e of sp.ef || []) {
      if (e.t === 2) { const v = Math.max(1, Math.round(u.dps * 0.9 * rnd(0.9, 1.1))); m.hp -= v; onMobDamaged(m, v); gThreat(m, u, v); meterGroup(c, u, 'dmg', v, n); fx(m.x, m.y, '' + v, '#ffd27a'); did = true; continue; }
      if (e.t !== 6 || !MERC_DEBUFF_AU.has(e.au)) continue;
      let a = m.auras.find((x) => x.key === n && x.au === e.au);
      if (!a) { a = { key: n, au: e.au, val: 0, stacks: 0, src: c, cu: u, t: 0 }; m.auras.push(a); }
      a.until = now + dur; a.src = c; a.cu = u;
      if (e.au === 3) {         // damage over time: about one and a half casts of its damage over the duration
        const every = (e.amp || 3000) / 1000; const ticks = Math.max(1, Math.round(dur / every));
        a.every = every; a.t = 0; a.val = Math.max(1, Math.round(u.dps * 1.6 * Math.min(dur, 18) / 12 / ticks)); a.stacks = 1;
      } else {
        a.val = effValue({ level: L }, sp, e); a.stacks = sp.stack ? Math.min(sp.stack, a.stacks + 1) : 1;
      }
      did = true;
    }
    if (!did) {           // a mark or a judgement the game has no number for: it is still there to see
      let a = m.auras.find((x) => x.key === n); if (!a) { a = { key: n, au: 0, val: 0, stacks: 1, src: c, cu: u, t: 0 }; m.auras.push(a); } a.until = now + dur; did = true;
    }
    if (did) { gThreat(m, u, 20 + L * 2); if (m.st === 'alive') engage(m, c); if (m.hp <= 0) killMob(c, m); }
  }
  fx(u.x, u.y, n, '#c8a2ff');
  if (u.pt === 1 || u.pt === 3) { u.swing = Math.max(u.swing || 0, 0); }
  return true;
}

/* ------------------------------------------------------------------ heals */
function mercHealTarget(c, low) {
  let tgt = null;
  for (const t of mercFolk(c)) {
    const hp = t.merc ? t.merc.hp / t.merc.maxhp : t.c.hp / charStats(t.c).maxHp; const lim = t.role === 'tank' ? low + 0.08 : low;
    if (hp < lim && (!tgt || hp - (lim - low) < tgt.p)) tgt = Object.assign(t, { p: hp - (lim - low), hp });
  }
  if (!tgt && petAlive(c) && c.pet.hp / c.pet.maxhp < low) tgt = { pet: true, p: c.pet.hp / c.pet.maxhp, hp: c.pet.hp / c.pet.maxhp };
  return tgt;
}
function mercHealLand(c, u, t, v, n) {
  const r = rt(c); let got;
  if (t.pet) { const h0 = c.pet.hp; c.pet.hp = Math.min(c.pet.maxhp, c.pet.hp + v); got = c.pet.hp - h0; }
  else if (t.merc) { const o = t.merc; if (o.dead) return; const h0 = o.hp; o.hp = Math.min(o.maxhp, o.hp + v); got = o.hp - h0; fx(o.x, o.y, '+' + Math.round(got), '#5ee07a'); }
  else { const o = t.c; if (rt(o).ghost || o.hp <= 0) return; const h0 = o.hp; o.hp = Math.min(charStats(o).maxHp, o.hp + v); got = o.hp - h0; fx(o.pos.x, o.pos.y, '+' + Math.round(got), '#5ee07a'); }
  meterGroup(c, u, 'heal', Math.round(got), n);
  const th = r.threats || []; for (const m of th) gThreat(m, u, got * 0.5 / Math.max(1, th.length));
}
/* heals over time: on the mercenaries ticked here, on the characters through their buffs (classes.js) */
function mercHotStep(c, u, dt) {
  for (const b of u.buffs || []) if (b.hot && b.until > G.gameTime - 0.01) { b.hot.t += dt; while (b.hot.t >= b.hot.every) { b.hot.t -= b.hot.every; if (!u.dead) { u.hp = Math.min(u.maxhp, u.hp + b.hot.v); meterGroup(c, b.hot.from, 'heal', b.hot.v, b.name); } } }
}
function mercGiveHot(c, u, t, n, sp, total) {
  const dur = sp.dur > 0 ? sp.dur / 1000 : 12; const every = 3; const v = Math.max(1, Math.round(total / Math.max(1, dur / every)));
  if (t.merc) { let b = mercBuff(t.merc, n); if (!b) { b = { name: n, until: 0 }; t.merc.buffs.push(b); } b.ic = sp.ic; b.until = G.gameTime + dur; b.hot = { t: 0, every, v, from: u }; }
  else { const r = rt(t.c); r.buffs = (r.buffs || []).filter((x) => x.until > G.gameTime && x.name !== n); r.buffs.push({ name: n, ic: sp.ic, until: G.gameTime + dur, auras: [], hot: { t: 0, every, v } }); dirty(t.c); }
  fx(t.x, t.y, n, '#5ee07a');
}
function mercShield(c, u, t, sp, v) {
  const until = G.gameTime + 30;
  if (t.merc) { t.merc.absorb = { v, until }; let b = mercBuff(t.merc, sp.n); if (!b) { b = { name: sp.n, until: 0 }; t.merc.buffs.push(b); } b.ic = sp.ic; b.until = until; }
  else { const r = rt(t.c); r.absorb = { v, until }; r.buffs = (r.buffs || []).filter((x) => x.until > G.gameTime && x.name !== sp.n); r.buffs.push({ name: sp.n, ic: sp.ic, until, auras: [] }); dirty(t.c); }
  u.shieldOn = u.shieldOn || {}; u.shieldOn[t.merc ? t.merc.id : t.c.id] = G.gameTime + 15;     // Weakened Soul
  fx(t.x, t.y, sp.n, '#9fe0ff');
}
/* a healer's turn in a fight: true when it did something (or is busy) */
function mercHealStep(c, u, dt, inc, healers) {
  const k = mercKit(u); const L = mercLevel(c); const ux = (u.ex == null ? 5 : u.ex) / 10;
  if (u.react > G.gameTime || u.gcd > G.gameTime) return true;
  const t = mercHealTarget(c, 0.9); if (!t) return false;
  if (Math.random() < 0.15 * (1 - ux)) { const f = mercFolk(c); const o = f[Math.floor(Math.random() * f.length)]; if (o) Object.assign(t, o, { pet: false }); }     // healed the wrong one
  const v0 = Math.round(Math.max(12 + L * 4.5, inc * 2.5 * 1.25 / healers) * rnd(0.9, 1.1));
  const sp = (n) => n && mercSpell(u.cls, n, L);
  const tank = t.role === 'tank';
  // a shield on the tank taking a beating
  const sh = sp(k.shield); const key = t.merc ? t.merc.id : t.c ? t.c.id : 'pet';
  if (sh && !t.pet && tank && t.hp < 0.7 && !((u.shieldOn || {})[key] > G.gameTime) && mercPower(u) >= mercCost(c, u, sh)) { mercPay(u, mercCost(c, u, sh)); u.gcd = G.gameTime + 1.5; mercShield(c, u, t, sh, Math.round(v0 * 0.9)); return true; }
  // a heal over time on the tank before it is needed
  const hot = sp(k.hot);
  if (hot && !t.pet && tank && t.hp < 0.95 && !mercHasBuff(t, hot.n, 1) && mercPower(u) >= mercCost(c, u, hot)) { mercPay(u, mercCost(c, u, hot)); u.gcd = G.gameTime + 1.5; mercGiveHot(c, u, t, hot.n, hot, v0 * 0.9); return true; }
  // a fast heal when it is urgent, the big one otherwise
  let spell = null, fast = false;
  if (t.hp < 0.45 && sp(k.fast)) { spell = sp(k.fast); fast = true; }
  if (!spell) for (const n of k.heal || []) { spell = sp(n); if (spell) break; }
  if (!spell) return false;
  const cost = mercCost(c, u, spell) * (fast ? 0.8 : 1);
  if (mercPower(u) < cost) { if (G.gameTime - (u.oomT || -99) > 20) { u.oomT = G.gameTime; fx(u.x, u.y, 'Out of mana', '#7fa8ff'); log(u.name + ' is out of mana.'); } return false; }
  const ct = Math.max(1.5, Math.min(3.5, (spell.cast || 2500) / 1000)) * (fast ? 0.6 : 1);
  const v = Math.round(v0 * ct / 2.5 * (fast ? 1.1 : 1));
  u.react = G.gameTime + ct + (0.2 + 1.8 * (1 - ux)) * Math.random();
  mercStartCast(c, u, spell.n, spell, null, ct, () => { mercPay(u, cost); mercHealLand(c, u, t, v, spell.n); });
  return true;
}

/* ------------------------------------------------------------------ damage spells (the ranged damage dealers) */
function mercNukeStep(c, u, m) {
  const k = mercKit(u); const L = mercLevel(c);
  if (u.gcd > G.gameTime || u.react > G.gameTime) return;
  let sp = null; for (const n of k.nuke || []) { const s = mercSpell(u.cls, n, L); if (s && !(n === 'Aimed Shot' && (u.aimT || 0) > G.gameTime) && !(n === 'Mind Blast' && (u.mbT || 0) > G.gameTime)) { sp = s; break; } }
  let cost = sp ? mercCost(c, u, sp) : 0;
  const wand = !sp || mercPower(u) < cost;
  if (wand) { sp = { n: u.cls === 3 ? 'Auto Shot' : 'Shoot', ic: u.cls === 3 ? 'ability_whirlwind' : 'ability_shootwand', cast: 1500 }; cost = 0; }
  let ct = Math.max(1.5, Math.min(3.5, (sp.cast || 1500) / 1000)); if (u.cls === 8 && sp.n === 'Frostbolt') ct = Math.min(ct, 2.5);     // Improved Frostbolt
  const ux = (u.ex == null ? 5 : u.ex) / 10;
  u.react = G.gameTime + ct + (0.1 + 0.6 * (1 - ux)) * Math.random();
  if (sp.n === 'Aimed Shot') u.aimT = G.gameTime + 6; if (sp.n === 'Mind Blast') u.mbT = G.gameTime + 8;
  mercStartCast(c, u, sp.n, sp, m, ct, () => {
    if (m.st === 'dead') return; mercPay(u, cost);
    const diff = m.lvl - c.level; if (Math.random() < 0.04 + Math.max(0, diff) * 0.02) { fx(m.x, m.y, 'resist', '#cfc6b0'); return; }
    let v = u.dps * ct * (wand ? 0.45 : 1) * rnd(0.9, 1.1); if (Math.random() < 0.1) v *= 1.5;
    v = Math.max(1, Math.round(v)); m.hp -= v; onMobDamaged(m, v); gThreat(m, u, v); meterGroup(c, u, 'dmg', v, sp.n); fx(m.x, m.y, '' + v, '#ffd27a');
    if (m.st === 'alive') engage(m, c);
    if (m.hp <= 0) killMob(c, m);
  });
}

/* ------------------------------------------------------------------ one step in a fight
   true: the mercenary did its part this step (casting, healing, the ranged damage); false: on to the melee code */
function mercFight(c, u, dt, threats, inc, healers, mv) {
  mercMods(c, u); mercRegen(c, u, dt, true); mercAuraStep(c, u); mercHotStep(c, u, dt);
  if (mercCastStep(c, u, dt)) return true;
  const r = rt(c);
  if (u.gcd <= G.gameTime) { const due = mercBuffDue(c, u, true); if (due && mercCastBuff(c, u, due)) return true; }
  if (u.role === 'healer') {
    mv(c.pos.x, c.pos.y, 14);
    if (mercHealStep(c, u, dt, inc, healers)) return true;
    // nothing to heal: a damage over time on the target now and then
    const m = r.tgt && r.tgt.st !== 'dead' ? r.tgt : threats[0];
    if (m && u.gcd <= G.gameTime && mercPower(u) > mercPowerMax(u) * 0.6) { const d = mercDebuffDue(c, u, m, threats); if (d && (u.cls !== 2)) mercApplyDebuff(c, u, d[0], d[1], d[2]); }
    return true;
  }
  const k = mercKit(u);
  const m = u.role === 'tank' ? null : r.tgt && r.tgt.st !== 'dead' ? r.tgt : threats[0];
  if (u.role !== 'tank' && k.ranged && m) {
    if (!mv(m.x, m.y, 22)) return true;
    if (u.gcd <= G.gameTime) { const d = mercDebuffDue(c, u, m, threats); if (d && mercApplyDebuff(c, u, d[0], d[1], d[2])) return true; }
    mercNukeStep(c, u, m); return true;
  }
  return false;
}
/* melee mercenaries (tank, warrior, rogue, paladin, shaman ...): their debuffs between the swings */
function mercMeleeExtra(c, u, m, threats) {
  if (u.gcd > G.gameTime || !m || m.st === 'dead') return;
  if (Math.hypot(m.x - u.x, m.y - u.y) > MELEE_RANGE + 2) return;
  const d = mercDebuffDue(c, u, m, threats); if (d) mercApplyDebuff(c, u, d[0], d[1], d[2]);
}
/* rage from hitting and being hit */
function mercOnSwing(u, v) { if (u.pt === 1) u.rage = Math.min(100, (u.rage || 0) + Math.max(3, Math.min(15, v / Math.max(1, u.dps0 || 1) * 3))); }
function mercOnHit(u) { if (u.pt === 1) u.rage = Math.min(100, (u.rage || 0) + 4); }

/* the character's own long buffs: on the mercenaries too (classes.js: groupBuffTarget) */
function mercBuffTarget(c, name) {
  for (const u of partyOf(c) || []) {
    if (u.dead || !u.buffs || mercHasBuff({ merc: u }, name, 3)) continue;
    if (name === 'Thorns' && u.role !== 'tank') continue;
    if (MERC_MANA_BUFF.test(name) && u.pt !== 0) continue;
    if (Math.hypot(u.x - c.pos.x, u.y - c.pos.y) <= 30) return { merc: u, x: u.x, y: u.y };
  }
  return null;
}
