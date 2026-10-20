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
  return Math.min(v, u.maxmana * 0.15);
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
/* the blessing a paladin gives someone: Might for the melee and the tanks, Wisdom for the casters */
function mercBlessingFor(t) { return MERC_MELEE_BLESS.has(t.cls) || t.role === 'tank' || (t.cls === 2 && t.role !== 'healer') ? 'Blessing of Might' : 'Blessing of Wisdom'; }
/* everyone of the raid (any distance on the map): a group buff reaches them all */
function mercRaidFolk(c) {
  const out = mercFolk(c);
  if (typeof raidMembers === 'function') { const R = raidMembers(c); for (const o of R.chars) if (!out.some((t) => t.c === o)) out.push({ c: o, cls: o.cls, x: o.pos.x, y: o.pos.y, role: typeof grpRole === 'function' ? grpRole(o) : 'dps' }); for (const u of R.mercs) if (!out.some((t) => t.merc === u)) out.push({ merc: u, cls: u.cls, x: u.x, y: u.y, role: u.role }); }
  return out;
}
function mercCastBuff(c, u, due) {
  const [t, n, s] = due; const cost = mercCost(c, u, s); if (mercPower(u) < cost) return false;
  mercPay(u, cost); u.gcd = G.gameTime + 1.5;
  const k = mercKit(u); const self = (k.self || []).includes(n);
  if (t && !self) {      // a group buff: one cast and the whole raid has it (a blessing: everyone it is meant for)
    const bless = /^Blessing of/.test(n);
    for (const x of mercRaidFolk(c)) if (!bless || mercBlessingFor(x) === n || !mercSpell(u.cls, 'Blessing of Wisdom', mercLevel(c))) mercGiveBuff(c, x === t ? u : null, x, n, s);
  } else if (t) mercGiveBuff(c, u, t, n, s);
  else {      // Battle Shout, a totem: the whole group near
    const dur = /Totem/.test(n) ? 120 : null;
    for (const x of mercFolk(c)) if (Math.hypot(x.x - u.x, x.y - u.y) < 30) mercGiveBuff(c, null, x, n, s, dur);
  }
  fx(u.x, u.y, n, '#9fe0ff'); return true;
}

/* ------------------------------------------------------------------ casting with a cast bar */
function mercStartCast(c, u, n, sp, tgt, time, done, check) {
  u.cb = { name: n, ic: sp && sp.ic, t: 0, total: Math.max(0.3, time), tgt, done, check };
  u.gcd = G.gameTime + 1.5;
}
/* true while casting (the mercenary does nothing else) */
function mercCastStep(c, u, dt) {
  const k = u.cb; if (!k) return false;
  if (k.tgt && k.tgt.st && (k.tgt.st === 'dead' || k.tgt.hp <= 0)) { u.cb = null; return false; }
  k.t += dt;
  if (k.check && !k.checked && k.t >= k.total * 0.8) { k.checked = true; if (!k.check()) { u.cb = null; fx(u.x, u.y, 'stops casting', '#cfc6b0'); return false; } }
  if (k.t < k.total) return true;
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
  if (inFight && u.mana < u.maxmana * 0.15 && G.gameTime - u.potT > 120 && (u.role === 'healer' || (rt(c).threats || []).some((m) => m.rank >= 1 && m.maxhp > 3 * (u.baseHp || 100)))) { u.potT = G.gameTime; u.mana = Math.min(u.maxmana, u.mana + u.maxmana * 0.3); fx(u.x, u.y, 'Mana Potion', '#7fa8ff'); }
}
/* the mercenaries still drinking: the group waits for them before the next pull */
function mercsResting(c) { return (partyOf(c) || []).some((u) => !u.dead && u.drinking); }

/* ------------------------------------------------------------------ out of combat */
function mercIdle(c, u, dt) {
  mercMods(c, u); mercRegen(c, u, dt, false); mercAuraStep(c, u); mercHotStep(c, u, dt);
  if (mercCastStep(c, u, dt)) return;
  if (u.gcd > G.gameTime || u.drinking) return;
  const due = mercBuffDue(c, u, false); if (due) { mercCastBuff(c, u, due); return; }
  if (u.role === 'healer' && u.mana > u.maxmana * 0.5) mercHealStep(c, u, dt, false);
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

/* ------------------------------------------------------------------ heals
   Like a player: a heal only for health that is really missing, the rank that fits the gap (downranking - cheaper, less
   wasted), the fast heal when someone is about to die, a heal over time on the tank that keeps taking hits, a shield
   when it gets bad. An experienced healer stops a cast that is not needed any more and rarely heals the wrong one;
   a beginner heals with the biggest rank, overheals and runs out of mana sooner. */
function mercHealBonus(L) { return L * L / 12; }            // +healing from the gear of a player of that level
function mercHealAmount(u, sp, L) {
  const lv = { level: L }; let v = 0;
  for (const e of sp.ef || []) {
    if (e.t === 10) v += (effValue(lv, sp, e, e.lo) + effValue(lv, sp, e, e.hi || e.lo)) / 2 + (e.coef != null ? e.coef : Math.min(1, (sp.cast || 1500) / 3500)) * mercHealBonus(L);
    else if (e.t === 6 && e.au === 8) { const ticks = Math.max(1, (sp.dur || 12000) / (e.amp || 3000)); v += effValue(lv, sp, e) * ticks + (e.coef != null ? e.coef : 0.2) * mercHealBonus(L); }
    else if (e.t === 6 && e.au === 69) v += effValue(lv, sp, e) + 0.1 * mercHealBonus(L);
  }
  const ct = Math.max(1.5, (sp.cast || 1500) / 1000);
  return Math.round(Math.max(v, (12 + L * 4.5) * ct / 2.5));       // odd data: what a heal of that cast time does
}
/* every rank a player of level L has of these spells: [{sp, val, cost, ct}] */
function mercHealRanks(c, u, names, L) {
  const out = [];
  for (const n of names || []) for (const sp of classAbilityList(u.cls)[n] || []) if ((sp.lv || 1) <= L) out.push({ sp, n, val: mercHealAmount(u, sp, L), cost: mercCost(c, u, sp), ct: Math.max(1.5, Math.min(3.5, (sp.cast || 2500) / 1000)) });
  return out.sort((a, b) => a.val - b.val);
}
/* how hurt someone of the group is: {hp, max, miss, pct} */
function mercHurt(c, t) {
  if (t.pet) { const mx = petStats(c).maxhp; return { hp: c.pet.hp, max: mx, miss: mx - c.pet.hp, pct: c.pet.hp / mx }; }
  if (t.merc) return { hp: t.merc.hp, max: t.merc.maxhp, miss: t.merc.maxhp - t.merc.hp, pct: t.merc.hp / t.merc.maxhp };
  const mx = charStats(t.c).maxHp; return { hp: t.c.hp, max: mx, miss: mx - t.c.hp, pct: t.c.hp / mx };
}
function mercHealLand(c, u, t, v, n) {
  const r = rt(c); let got;
  if (t.pet) { if (!petAlive(c)) return; const h0 = c.pet.hp; c.pet.hp = Math.min(petStats(c).maxhp, c.pet.hp + v); got = c.pet.hp - h0; fx(rt(c).pet.x, rt(c).pet.y, '+' + Math.round(got), '#5ee07a'); }
  else if (t.merc) { const o = t.merc; if (o.dead) return; const h0 = o.hp; o.hp = Math.min(o.maxhp, o.hp + v); got = o.hp - h0; fx(o.x, o.y, '+' + Math.round(got), '#5ee07a'); }
  else { const o = t.c; if (rt(o).ghost || o.hp <= 0) return; const h0 = o.hp; o.hp = Math.min(charStats(o).maxHp, o.hp + v); got = o.hp - h0; fx(o.pos.x, o.pos.y, '+' + Math.round(got), '#5ee07a'); }
  meterGroup(c, u, 'heal', Math.round(got), n);
  const th = r.threats || []; for (const m of th) gThreat(m, u, got * 0.5 / Math.max(1, th.length));
}
/* who is being hit right now */
function mercUnderFire(c, t) {
  const th = rt(c).threats || [];
  if (t.merc) return th.some((m) => mobVictimKey(m, c) === t.merc.id);
  if (t.c === c) return th.some((m) => mobVictimKey(m, c) === 'c');
  return th.some((m) => m.tgt === t.c);
}
/* a healer's turn: true when it did something (or is busy) */
function mercHealStep(c, u, dt, inFight) {
  const k = mercKit(u); const L = mercLevel(c); const ux = (u.ex == null ? 5 : u.ex) / 10; const now = G.gameTime;
  if (u.react > now || u.gcd > now) return true;
  const main = mercHealRanks(c, u, k.heal, L); if (!main.length) return false;
  const fast = mercHealRanks(c, u, k.fast ? [k.fast] : [], L);
  const smallest = main[0].val;
  // who needs a heal: real health missing (not a scratch), the tank a little earlier; out of a fight only the ones low
  const folk = mercFolk(c).concat(petAlive(c) ? [{ pet: true, role: petIsTank(c) ? 'tank' : 'pet', x: rt(c).pet.x, y: rt(c).pet.y }] : []);
  const need = [];
  for (const t of folk) {
    const h = mercHurt(c, t); if (h.miss <= 0) continue;
    const ok = inFight ? h.miss >= smallest * (0.75 - 0.25 * (1 - ux)) || h.pct < 0.5 : h.pct < 0.7;
    if (ok) need.push(Object.assign(t, h, { prio: h.pct - (t.role === 'tank' ? 0.12 : 0) - (mercUnderFire(c, t) ? 0.05 : 0) }));
  }
  if (!need.length) return false;
  need.sort((a, b) => a.prio - b.prio);
  let t = need[0];
  if (need.length > 1 && Math.random() < 0.2 * (1 - ux)) t = need[1 + Math.floor(Math.random() * (need.length - 1))];     // a beginner heals the wrong one now and then
  const key = t.merc ? t.merc.id : t.c ? t.c.id : 'pet'; const tank = t.role === 'tank';
  const castable = (o) => o && mercPower(u) >= o.cost;
  const instant = (o, fn) => { mercPay(u, o.cost); u.gcd = now + 1.5; u.react = now + 1.5 + (0.1 + 0.8 * (1 - ux)) * Math.random(); fn(); return true; };
  if (inFight) {
    // a shield on the one about to go down (Weakened Soul: not again for 15 s)
    const sh = k.shield && mercHealRanks(c, u, [k.shield], L).pop();
    if (castable(sh) && !t.pet && t.pct < (tank ? 0.45 : 0.35) && mercUnderFire(c, t) && !((u.shieldOn || {})[key] > now)) return instant(sh, () => mercShield(c, u, t, sh.sp, sh.val));
    // a heal over time on the tank that keeps taking hits (the rank that fits; a beginner always the biggest)
    const hots = k.hot ? mercHealRanks(c, u, [k.hot], L) : [];
    if (hots.length && tank && mercUnderFire(c, t) && t.miss >= hots[0].val * 0.6 && !mercHasBuff(t, hots[0].sp.n, 1)) {
      const h = ux >= 0.5 ? hots.find((o) => o.val >= t.miss * 0.8) || hots[hots.length - 1] : hots[hots.length - 1];
      if (castable(h) && t.pct > 0.4) return instant(h, () => mercGiveHot(c, u, t, h.sp.n, h.sp, h.val));
    }
  }
  // the heal: the fast one when someone is about to die, else the rank that fits the gap
  const urgent = inFight && t.pct < 0.35 && fast.length;
  const pool = urgent ? fast : main;
  const fit = pool.filter((o) => o.val >= t.miss * 0.85);
  let pick = Math.random() < 0.1 + 0.9 * Math.sqrt(ux) ? fit[0] || pool[pool.length - 1] : pool[pool.length - 1];      // experienced: the rank that fits; a beginner mostly the biggest
  if (!castable(pick)) pick = pool.filter(castable).pop();          // low on mana: a smaller rank
  if (!pick) { if (now - (u.oomT || -99) > 20) { u.oomT = now; fx(u.x, u.y, 'Out of mana', '#7fa8ff'); log(u.name + ' is out of mana.'); } return false; }
  const ct = pick.ct; const v = Math.round(pick.val * rnd(0.92, 1.08));
  u.react = now + ct + (0.15 + 1.2 * (1 - ux)) * Math.random();
  // an experienced healer stops the cast when the gap is mostly gone (someone else healed it); anyone stops it on a full
  // health bar
  const miss0 = t.miss; const check = ux >= 0.35 ? () => mercHurt(c, t).miss >= Math.min(v, miss0) * 0.3 : () => mercHurt(c, t).miss > 0;
  mercStartCast(c, u, pick.sp.n, pick.sp, null, ct, () => { mercPay(u, pick.cost); mercHealLand(c, u, t, v, pick.sp.n); }, check);
  return true;
}
/* heals over time: on the mercenaries ticked here, on the characters through their buffs (classes.js) */
function mercHotStep(c, u, dt) {
  for (const b of u.buffs || []) if (b.hot && b.until > G.gameTime - 0.01) { b.hot.t += dt; while (b.hot.t >= b.hot.every) { b.hot.t -= b.hot.every; if (!u.dead) { u.hp = Math.min(u.maxhp, u.hp + b.hot.v); if (b.hot.from) meterGroup(c, b.hot.from, 'heal', b.hot.v, b.name); else if (typeof meterHeal === 'function') meterHeal(c, b.hot.v, b.name); } } }
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
/* ------------------------------------------------------------------ damage spells (the ranged damage dealers) */
function mercNukeStep(c, u, m, wandOnly) {
  const k = mercKit(u); const L = mercLevel(c);
  if (u.gcd > G.gameTime || u.react > G.gameTime) return;
  let sp = null; if (!wandOnly) for (const n of k.nuke || []) { const s = mercSpell(u.cls, n, L); if (s && !(n === 'Aimed Shot' && (u.aimT || 0) > G.gameTime) && !(n === 'Mind Blast' && (u.mbT || 0) > G.gameTime)) { sp = s; break; } }
  let cost = sp ? mercCost(c, u, sp) : 0;
  const wand = !sp || mercPower(u) < cost || (u.pt === 0 && !mercSpendOk(u, m));     // the wand when the mana is worth saving
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
  mercOpening(c, u);
  if (G.gameTime >= (u.openAt || 0) && mercTactics(c, u, threats)) return true;          // the tactics: survive, crowd control, cooldowns, packs, the group
  if (u.role === 'healer') {
    mv(c.pos.x, c.pos.y, 14);
    if (mercHealStep(c, u, dt, true)) return true;
    // nothing to heal: like a player, the wand on the target (a damage over time on something big when the mana is plenty)
    const m = r.tgt && r.tgt.st !== 'dead' ? r.tgt : threats[0];
    if (!m || G.gameTime < u.openAt || u.gcd > G.gameTime) return true;
    if (u.cls !== 2 && mercPower(u) > mercPowerMax(u) * 0.8) { const d = mercDebuffDue(c, u, m, threats); if (d && (m.rank >= 1 || m.maxhp > 2 * (u.baseHp || 100)) && mercApplyDebuff(c, u, d[0], d[1], d[2])) return true; }
    if (u.cls !== 2 && Math.hypot(m.x - u.x, m.y - u.y) < 30) mercNukeStep(c, u, m, true);
    return true;
  }
  const k = mercKit(u);
  const m = u.role === 'tank' ? null : r.tgt && r.tgt.st !== 'dead' ? r.tgt : threats[0];
  if (u.role !== 'tank' && k.ranged && m) {
    if (!mv(m.x, m.y, 22)) return true;
    if (G.gameTime < u.openAt) return true;                   // the tank gets a moment to take the pull first
    if (u.gcd <= G.gameTime && mercSpendOk(u, m)) { const d = mercDebuffDue(c, u, m, threats); if (d && mercApplyDebuff(c, u, d[0], d[1], d[2])) return true; }
    mercNukeStep(c, u, m); return true;
  }
  return false;
}
/* at the start of each fight: how long a damage dealer waits for the tank (an experienced one waits for the tank to
   have the pack, a beginner goes at once - and pulls the aggro) */
function mercOpening(c, u) {
  const r = rt(c); const fs = r.fightStart || 0; if (u.fsSeen === fs) return; u.fsSeen = fs;
  const ux = (u.ex == null ? 5 : u.ex) / 10;
  u.openAt = u.role === 'tank' ? 0 : fs + (0.3 + 2.4 * ux) * (0.7 + 0.6 * Math.random());
}
/* worth the mana: a damage over time / a spell on something that dies anyway in a moment is a waste - with little mana
   left, only on the big ones */
function mercSpendOk(u, m) {
  if (u.pt !== 0) return true; const big = m.rank >= 1 || m.maxhp > 3 * (u.baseHp || 100); const mp = u.mana / Math.max(1, u.maxmana);
  if (big) return mp > 0.1; return mp > 0.3 && m.hp / m.maxhp > 0.25;
}
/* melee mercenaries (tank, warrior, rogue, paladin, shaman ...): their debuffs between the swings */
function mercMeleeExtra(c, u, m, threats) {
  if (u.gcd > G.gameTime || !m || m.st === 'dead' || !mercSpendOk(u, m)) return;
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

/* ------------------------------------------------------------------ tactics (like the characters' presets, tactics.js)
   Every mercenary has a list by class and role, checked from the top each moment it is free: staying alive (potions,
   Shield Wall, Ice Block, Evasion, Feign Death ...), crowd control on the extra adds (Polymorph, Shackle, Banish,
   Hibernate, Fear, Blind, Freezing Trap), group heals and dispels, mana (Evocation, Life Tap, Innervate on the healer),
   cooldowns on elites and bosses, area attacks on packs, execute range. Its experience decides how often it thinks of
   them (a beginner forgets half). The heals, debuffs and the main damage stay in the code above. */
const MT = (c, p, n, k, cd, v) => ({ c, p, n, k, cd: cd || 0, v });
const MERC_TAC = {
  1: { tank: [MT('self.hp<', 25, 'Last Stand', 'heal', 600, 0.3), MT('self.hp<', 18, 'Shield Wall', 'dr', 1800, [0.25, 10]), MT('enemy.att>', 4, 'Challenging Shout', 'taunt', 600),
              MT('enemy.clus>', 2, 'Thunder Clap', 'aoe', 6, 0.5)],
       dps: [MT('enemy.hp<', 20, 'Execute', 'exec', 0, 2.2), MT('enemy.boss', null, 'Recklessness', 'cd', 1800, [0.5, 15]), MT('enemy.elite', null, 'Death Wish', 'cd', 180, [0.2, 30]),
              MT('enemy.clus>', 2, 'Sweeping Strikes', 'cd', 30, [0.3, 10]), MT('enemy.clus>', 3, 'Whirlwind', 'aoe', 10, 1.0), MT('self.sur>', 3, 'Intimidating Shout', 'fear', 180, 8)] },
  2: { tank: [MT('self.hp<', 15, 'Lay on Hands', 'heal', 3600, 1), MT('enemy.clus>', 2, 'Consecration', 'aoe', 8, 0.6), MT('self.hp<', 30, 'Divine Protection', 'dr', 300, [0.5, 8])],
       healer: [MT('self.hp<', 15, 'Divine Shield', 'immune', 300, 12), MT('ally.disp', null, 'Cleanse', 'disp', 0, [1, 3, 4]), MT('ally.disp', null, 'Purify', 'disp', 0, [3, 4]), MT('self.mp<', 30, 'Divine Favor', 'mana', 120, 0.1)],
       dps: [MT('enemy.hp<', 20, 'Hammer of Wrath', 'exec', 6, 1.6), MT('enemy.clus>', 3, 'Consecration', 'aoe', 8, 0.6), MT('self.hp<', 15, 'Divine Shield', 'immune', 300, 12), MT('ally.disp', null, 'Cleanse', 'disp', 0, [1, 3, 4])] },
  3: { dps: [MT('self.hp<', 15, 'Feign Death', 'drop', 30), MT('enemy.loose', null, 'Freezing Trap', 'cc', 15, 20), MT('enemy.elite', null, 'Rapid Fire', 'cd', 300, [0.4, 15]),
              MT('enemy.elite', null, 'Bestial Wrath', 'cd', 120, [0.3, 18]), MT('enemy.clus>', 4, 'Volley', 'aoe', 30, 1.4), MT('enemy.clus>', 3, 'Multi-Shot', 'aoe', 10, 0.7)] },
  4: { dps: [MT('self.hp<', 12, 'Vanish', 'drop', 300), MT('self.hp<', 35, 'Evasion', 'dr', 300, [0.5, 15]), MT('enemy.loose', null, 'Blind', 'cc', 300, 10), MT('enemy.loose', null, 'Gouge', 'cc', 10, 4),
              MT('enemy.att>', 2, 'Blade Flurry', 'cd', 120, [0.4, 15]), MT('enemy.elite', null, 'Adrenaline Rush', 'cd', 300, [0.5, 15]), MT('enemy.hp<', 25, 'Eviscerate', 'exec', 8, 1.6)] },
  5: { healer: [MT('self.hp<', 20, 'Desperate Prayer', 'heal', 600, 0.35), MT('self.sur>', 2, 'Psychic Scream', 'fear', 30, 8), MT('ally.hurt>', 3, 'Prayer of Healing', 'gheal', 4, 1.0),
                 MT('ally.disp', null, 'Dispel Magic', 'disp', 0, [1]), MT('ally.disp', null, 'Abolish Disease', 'disp', 0, [3]), MT('ally.disp', null, 'Cure Disease', 'disp', 0, [3]),
                 MT('enemy.loose', null, 'Shackle Undead', 'cc', 0, 30), MT('self.mp<', 25, 'Inner Focus', 'mana', 180, 0.12)],
       dps: [MT('self.hp<', 20, 'Desperate Prayer', 'heal', 600, 0.35), MT('self.sur>', 2, 'Psychic Scream', 'fear', 30, 8), MT('enemy.loose', null, 'Shackle Undead', 'cc', 0, 30), MT('ally.disp', null, 'Dispel Magic', 'disp', 0, [1])] },
  7: { healer: [MT('ally.hurt>', 3, 'Chain Heal', 'gheal', 3, 0.8), MT('ally.disp', null, 'Cure Poison', 'disp', 0, [4]), MT('ally.disp', null, 'Cure Disease', 'disp', 0, [3]), MT('self.mp<', 25, 'Mana Tide Totem', 'mana', 300, 0.3)],
       dps: [MT('enemy.clus>', 3, 'Chain Lightning', 'aoe', 6, 0.8), MT('enemy.clus>', 3, 'Magma Totem', 'aoe', 20, 1.2), MT('enemy.elite', null, 'Elemental Mastery', 'cd', 180, [0.4, 10]), MT('ally.disp', null, 'Cure Poison', 'disp', 0, [4])] },
  8: { dps: [MT('self.hp<', 15, 'Ice Block', 'immune', 300, 10), MT('self.hp<', 50, 'Ice Barrier', 'shield', 30, 0.3), MT('self.sur>', 1, 'Frost Nova', 'root', 25, 8), MT('enemy.loose', null, 'Polymorph', 'cc', 0, 30),
              MT('self.mp<', 12, 'Evocation', 'mana', 480, 0.6), MT('enemy.elite', null, 'Arcane Power', 'cd', 180, [0.3, 15]), MT('enemy.elite', null, 'Combustion', 'cd', 180, [0.3, 15]),
              MT('self.sur>', 3, 'Arcane Explosion', 'aoe', 0, 0.6), MT('enemy.clus>', 3, 'Blizzard', 'aoe', 8, 1.5), MT('enemy.clus>', 3, 'Flamestrike', 'aoe', 8, 1.3), MT('ally.disp', null, 'Remove Lesser Curse', 'disp', 0, [2])] },
  9: { dps: [MT('self.hp<', 30, 'Death Coil', 'heal', 120, 0.2), MT('self.sur>', 2, 'Howl of Terror', 'fear', 40, 8), MT('enemy.loose', null, 'Banish', 'cc', 0, 20), MT('enemy.loose', null, 'Fear', 'cc', 0, 10),
              MT('self.mp<', 25, 'Life Tap', 'mana', 0, 0.15), MT('self.sur>', 3, 'Hellfire', 'aoe', 15, 1.0), MT('enemy.clus>', 3, 'Rain of Fire', 'aoe', 8, 1.5), MT('enemy.hp<', 20, 'Shadowburn', 'exec', 15, 1.8)] },
  11: { tank: [MT('self.hp<', 25, 'Frenzied Regeneration', 'heal', 180, 0.3), MT('self.hp<', 30, 'Barkskin', 'dr', 60, [0.2, 15]), MT('enemy.att>', 4, 'Challenging Roar', 'taunt', 600), MT('enemy.clus>', 2, 'Swipe', 'aoe', 3, 0.5)],
        healer: [MT('self.hp<', 30, 'Barkskin', 'dr', 60, [0.2, 15]), MT('ally.hurt>', 4, 'Tranquility', 'gheal', 300, 1.5), MT('ally.disp', null, 'Remove Curse', 'disp', 0, [2]), MT('ally.disp', null, 'Abolish Poison', 'disp', 0, [4]),
                 MT('ally.mp<', 20, 'Innervate', 'innervate', 360, 0.4), MT('enemy.loose', null, 'Hibernate', 'cc', 0, 20)],
        dps: [MT('self.hp<', 30, 'Barkskin', 'dr', 60, [0.2, 15]), MT('enemy.loose', null, 'Hibernate', 'cc', 0, 20), MT('enemy.clus>', 3, 'Hurricane', 'aoe', 60, 1.5), MT('ally.mp<', 15, 'Innervate', 'innervate', 360, 0.4)] },
};
/* the cooldowns make the mercenary hit harder for a while (mercMods adds MERC_BUFF_FX) */
for (const cls in MERC_TAC) for (const role in MERC_TAC[cls]) for (const t of MERC_TAC[cls][role]) if (t.k === 'cd' && !MERC_BUFF_FX[t.n]) MERC_BUFF_FX[t.n] = { dps: t.v[0] };
function mercCcTypes(n) { return typeof TAC_CC !== 'undefined' ? TAC_CC[n] : null; }        // tactics.js
function mercTacList(u) { const K = MERC_TAC[u.cls] || {}; return K[u.role] || K.dps || []; }
/* one look at the list: true when it did something */
function mercTactics(c, u, threats) {
  const now = G.gameTime; if (u.gcd > now || (u.stunUntil || 0) > now) return false;
  const list = mercTacList(u); if (!list.length) return false;
  const ux = (u.ex == null ? 5 : u.ex) / 10; const L = mercLevel(c); const r = rt(c);
  if (Math.random() > 0.35 + 0.65 * ux) return false;                    // a beginner does not think of it now
  const tgt = r.tgt && r.tgt.st !== 'dead' ? r.tgt : threats[0];
  u.tcd = u.tcd || {};
  // the potion: like a player, low on health in a fight that is going badly
  if (u.hp < u.maxhp * 0.25 && now - (u.hpPotT || -999) > 120 && L >= 5) { u.hpPotT = now; const v = Math.round(u.maxhp * 0.3); u.hp = Math.min(u.maxhp, u.hp + v); fx(u.x, u.y, 'Healing Potion +' + v, '#5ee07a'); return true; }
  for (const t of list) {
    if ((u.tcd[t.n] || 0) > now) continue;
    const sp = mercSpell(u.cls, t.n, L); if (!sp) continue;
    const who = mercTacCond(c, u, t, tgt, threats); if (!who) continue;
    const cost = mercCost(c, u, sp); if (t.k !== 'mana' && mercPower(u) < cost) continue;
    if (!mercTacDo(c, u, t, sp, who, threats, tgt)) continue;
    if (t.k !== 'mana') mercPay(u, cost);
    u.tcd[t.n] = now + Math.max(t.cd, 1.5); u.gcd = now + 1.5; fx(u.x, u.y, t.n, '#ffe9a8');
    return true;
  }
  return false;
}
function mercTacCond(c, u, t, tgt, threats) {
  const p = t.p; const near = (x, y, R) => threats.filter((m) => m.st !== 'dead' && Math.hypot(m.x - x, m.y - y) <= R);
  switch (t.c) {
    case 'self.hp<': return u.hp / u.maxhp * 100 < p ? u : null;
    case 'self.mp<': return u.pt === 0 && u.maxmana && u.mana / u.maxmana * 100 < p ? u : null;
    case 'self.sur>': return near(u.x, u.y, 7).length >= p ? u : null;
    case 'enemy.att>': return threats.length >= p ? tgt : null;
    case 'enemy.clus>': return tgt && near(tgt.x, tgt.y, 10).length >= p ? tgt : null;
    case 'enemy.hp<': return tgt && tgt.hp / tgt.maxhp * 100 < p ? tgt : null;
    case 'enemy.elite': return tgt && tgt.rank >= 1 ? tgt : null;
    case 'enemy.boss': return tgt && tgt.rank === 3 ? tgt : null;
    case 'enemy.loose': {
      if (threats.length < 3 && !(threats.length >= 2 && threats.some((m) => m.rank >= 1))) return null;
      const types = mercCcTypes(t.n);
      return threats.find((m) => m !== tgt && m.st !== 'dead' && m.rank < 3 && !(m.auras || []).some((a) => a.au === 12 && a.until > G.gameTime) && (!types || !m.info || types.includes(m.info[5]))) || null;
    }
    case 'ally.hurt>': { const f = mercFolk(c).filter((x) => mercHurt(c, x).pct < 0.7); return f.length >= p ? f : null; }
    case 'ally.mp<': { const f = mercFolk(c).filter((x) => (x.merc ? x.merc.pt === 0 && x.merc.maxmana && x.merc.mana / x.merc.maxmana * 100 < p : usesMana(x.c) && x.c.mana / Math.max(1, charStats(x.c).maxMana) * 100 < p)); f.sort((a, b) => (b.role === 'healer') - (a.role === 'healer')); return f[0] || null; }
    case 'ally.disp': { const types = t.v || []; const now = G.gameTime; return mercFolk(c).find((x) => (x.merc ? x.merc.buffs || [] : rt(x.c).buffs || []).some((b) => b.kind === 'debuff' && b.until > now && types.includes(b.disp))) || null; }
    default: return null;
  }
}
function mercTacDo(c, u, t, sp, who, threats, tgt) {
  const now = G.gameTime; const L = mercLevel(c);
  const hit = (m, v) => { v = Math.max(1, Math.round(v)); m.hp -= v; onMobDamaged(m, v); gThreat(m, u, v); meterGroup(c, u, 'dmg', v, t.n); fx(m.x, m.y, '' + v, '#ffd27a'); if (m.st === 'alive') engage(m, c); if (m.hp <= 0) killMob(c, m); };
  switch (t.k) {
    case 'heal': { const v = Math.round(u.maxhp * t.v); u.hp = Math.min(u.maxhp, u.hp + v); fx(u.x, u.y, '+' + v, '#5ee07a'); meterGroup(c, u, 'heal', v, t.n); return true; }
    case 'dr': u.drUntil = now + t.v[1]; u.drMul = t.v[0]; return true;
    case 'immune': u.immuneUntil = now + t.v; for (const m of threats) if (m.gThr) m.gThr[u.id] = 0; return true;
    case 'shield': u.absorb = { v: Math.round(u.maxhp * t.v), until: now + 30 }; return true;
    case 'drop': for (const m of threats) if (m.gThr) m.gThr[u.id] = 0; return true;
    case 'taunt': { let top = 0; for (const m of threats) top = Math.max(top, m.charThreat || 0, m.petThreat || 0, ...Object.values(m.gThr || {})); for (const m of threats) { m.gThr = m.gThr || {}; m.gThr[u.id] = top * 1.3 + 50; } return true; }
    case 'cd': mercGiveBuff(c, null, { merc: u }, t.n, sp, t.v[1]); return true;
    case 'exec': if (!tgt || tgt.st === 'dead') return false; hit(tgt, u.dps * t.v * rnd(0.9, 1.1)); return true;
    case 'aoe': { const ms = threats.filter((m) => m.st !== 'dead' && Math.hypot(m.x - who.x, m.y - who.y) <= 10); if (!ms.length) return false; for (const m of ms) hit(m, u.dps * t.v * rnd(0.85, 1.15)); return true; }
    case 'cc': case 'fear': case 'root': {
      const ms = t.k === 'cc' ? [who] : threats.filter((m) => m.st !== 'dead' && m.rank < 3 && Math.hypot(m.x - u.x, m.y - u.y) <= 10);
      if (!ms.length) return false;
      for (const m of ms) { addMobAura(c, m, { n: t.n, dur: (t.k === 'cc' ? t.v : t.v) * 1000 }, { au: 12, lo: 0 }); fx(m.x, m.y, t.n, '#c8a2ff'); }
      if (t.k === 'cc') log(u.name + ': ' + t.n + ' on ' + (who.info ? who.info[1] : 'a creature') + '.');
      return true;
    }
    case 'gheal': { const v = Math.round(mercHealAmount(u, sp, L) * t.v); for (const x of who) mercHealLand(c, u, x, v * rnd(0.9, 1.1), t.n); return true; }
    case 'disp': {
      const types = t.v || []; const list = who.merc ? who.merc.buffs || [] : rt(who.c).buffs || [];
      const b = list.find((x) => x.kind === 'debuff' && x.until > now && types.includes(x.disp)); if (!b) return false;
      b.until = 0; if (who.merc) { if (who.merc.stunUntil > now) who.merc.stunUntil = 0; } else { const rr = rt(who.c); if (rr.cc && rr.cc.until > now) rr.cc = null; dirty(who.c); }
      fx(who.x, who.y, t.n, '#9fe0ff'); return true;
    }
    case 'mana': if (u.pt !== 0 || !u.maxmana) return false; if (t.n === 'Life Tap') { if (u.hp < u.maxhp * 0.5) return false; u.hp -= Math.round(u.maxhp * 0.1); } u.mana = Math.min(u.maxmana, u.mana + u.maxmana * t.v); return true;
    case 'innervate': { if (who.merc) { const o = who.merc; if (!o.maxmana) return false; o.mana = Math.min(o.maxmana, o.mana + o.maxmana * t.v); } else { const s = charStats(who.c); who.c.mana = Math.min(s.maxMana, who.c.mana + s.maxMana * t.v); } fx(who.x, who.y, 'Innervate', '#7fa8ff'); return true; }
    default: return false;
  }
}
