'use strict';
/* mobspells.js - creatures use their own spells and abilities, the ones the game server gives them (spells.json
   "mob_use": the creature spell lists, the EventAI timers and the template spells):
   - timed spells (the server's first-cast and repeat timers, chance), abilities on the pull, buffs they keep up (Fire
     Shield, poison on the weapon), heals on hurt friends, a last resort at low health, ranged abilities at range;
   - a spell with a cast time is cast standing (a cast bar on its unit frame); a stun or fear stops it;
   - the effects come from the spell data: damage (resisted by the school's resistance, physical by armor), weapon
     strikes (Strike, Cleave, Sinister Strike - dodge, parry and armor like a swing), damage over time, slows, roots,
     stuns, fear, silences, interrupts, stat debuffs (Curse of Weakness, Sunder Armor ...), heals and buffs on
     creatures, damage shields, procs;
   - on the character, its other characters in the group, the pet and the mercenaries; area spells hit everyone near.
   Raids are left out for now, and summons. */

const MS_SUMMON = new Set([28, 41, 42, 50, 56]);
const MS_WEAPON = new Set([17, 31, 58, 121]);
function msRaid(map) { const d = typeof dungeonByMap === 'function' && dungeonByMap(map); return !!(d && d.kind === 'raid'); }
function msLv(m) { return { level: m.lvl }; }
/* an effect's value for this creature: damage, heals and damage over time of a spell made for a higher level are scaled
   down for a creature below it (low level creatures share spells like the level 20 Shadow Bolt) */
function msVal(m, sp, e, hi) {
  const lo = effValue(msLv(m), sp, e, e.lo); const h = effValue(msLv(m), sp, e, e.hi != null ? e.hi : e.lo);
  let v = hi ? h : lo + Math.random() * Math.max(0, h - lo);
  const sl = sp.lv || sp.bl || 0;
  if (sl > m.lvl && (e.t === 2 || e.t === 9 || e.t === 10 || MS_WEAPON.has(e.t) || e.au === 3 || e.au === 8)) v *= Math.pow(Math.max(1, m.lvl) / sl, 1.5);
  return v;
}

/* what a spell is for a creature: 'harm' (on its enemies), 'heal', 'buff' (on itself), or null (left out) */
function msKind(sp, depth) {
  if (!sp || !sp.ef || !sp.ef.length || /^Summon|Spawn/.test(sp.n)) return null;
  let harm = false, heal = false, buff = false;
  for (const e of sp.ef) {
    if (MS_SUMMON.has(e.t)) return null;
    if (e.t === 64 && e.tr && (depth || 0) < 2) { const k = msKind(spellRow(e.tr), (depth || 0) + 1); if (k === 'harm') harm = true; else if (k === 'heal') heal = true; else if (k === 'buff') buff = true; continue; }
    const foe = e.k === 'enemy' || e.k === 'area_enemy';
    if (e.t === 10 || ((e.t === 6 || e.t === 35) && e.au === 8 && !foe)) heal = true;
    else if (foe && (e.t === 2 || e.t === 9 || e.t === 6 || e.t === 35 || e.t === 27 || e.t === 68 || MS_WEAPON.has(e.t))) harm = true;
    else if (MS_WEAPON.has(e.t)) harm = true;
    else if ((e.t === 6 || e.t === 35) && e.au && !foe) buff = true;
  }
  return harm ? 'harm' : heal ? 'heal' : buff ? 'buff' : null;
}
/* the spells of a creature entry (cached): [{sid, sp, kind, ev, i, rp (ms ranges), rep, ch, tg, ...}]
   ev: timer | aggro | buff (kept up) | heal (a friend missing health) | low (own health %) | exec (target's health %) |
   range (target at a distance) | tcast (target casting); the server's numbers as they are (wow_mob_spells.py) */
function mobKit(e) {
  G.mobKits = G.mobKits || {}; if (e in G.mobKits) return G.mobKits[e];
  const uses = ((G.d.spells && G.d.spells.mob_use) || {})[e] || []; const out = []; const seen = new Set();
  const order = uses.slice().sort((a, b) => (a[1] === 'template') - (b[1] === 'template'));     // the timed entries first
  const R = (a, b) => [a || 0, Math.max(a || 0, b || 0)];
  for (const u of order) {
    const [sid, src, p1, p2, p3, p4, ch, tg, fl] = u; const sp = spellRow(sid); const kind = msKind(sp); if (!kind) continue;
    const x = { sid, sp, kind, ch: ch > 0 ? ch : 100, tg: tg || 0, i: [1500, 6000], rp: [7000, 15000], rep: true };
    const base = kind === 'heal' ? 'heal' : kind === 'buff' ? 'buff' : 'timer';
    if (src === 'list') { x.ev = base; if (p1 || p2 || p3 || p4) { x.i = R(p1, p2); x.rp = R(p3, p4); x.rep = p4 > 0; } }
    else if (src === 'template') { if (seen.has(sid)) continue; x.ev = base; }
    else {
      const ev = +String(src).slice(3); const rep = !!((fl || 0) & 1);
      if (ev === 0) { x.ev = base; x.i = R(p1, p2); x.rp = R(p3, p4); x.rep = rep && p4 > 0; }
      else if (ev === 1 || ev === 11 || ev === 27 || ev === 16) { if (kind !== 'buff') continue; x.ev = 'buff'; }
      else if (ev === 4) x.ev = kind === 'buff' ? 'buff' : 'aggro';
      else if (ev === 2) { x.ev = 'low'; x.hp = [p2 || 0, p1 || 35]; x.rp = R(p3, p4); x.rep = rep; }
      else if (ev === 12) { if (kind !== 'harm') continue; x.ev = 'exec'; x.hp = [p2 || 0, p1 || 20]; x.rp = R(p3, p4); x.rep = rep; }
      else if (ev === 9) { if (kind !== 'harm') continue; x.ev = 'range'; x.dist = [p1 || 0, p2 || 30]; x.rp = R(p3, p4); x.rep = rep; x.i = [0, 0]; }
      else if (ev === 13) { if (kind !== 'harm') continue; x.ev = 'tcast'; x.rp = R(p1, p2); x.rep = rep; }
      else if (ev === 14) { x.ev = 'heal'; x.miss = p1 || 0; x.rad = p2 || 30; x.rp = R(p3, p4); x.rep = true; }
      else continue;
    }
    if (seen.has(sid + ':' + x.ev)) continue; seen.add(sid + ':' + x.ev); seen.add(sid);
    out.push(x);
  }
  return (G.mobKits[e] = out);
}
function msRand(a) { return (a[0] + Math.random() * Math.max(0, a[1] - a[0])) / 1000; }
/* mana: what a spell costs the creature (its mana from creature_stats.json; none known: free) */
function msCost(m, sp) { const pw = sp.pw; if (!pw || pw[0] !== 0 || !m.maxmana) return 0; return pw[2] ? m.maxmana * pw[2] / 100 : pw[1] || 0; }
function msMana(m) {
  const st = G.d.cstats && G.d.cstats[m.e]; const mm = st && st[5]; if (!mm) return 0;
  const i = m.info; const lo = i ? i[2] : m.lvl, hi = i ? i[3] : m.lvl; return Math.round(mm[0] + (mm[1] - mm[0]) * (hi > lo ? (m.lvl - lo) / (hi - lo) : 0));
}
/* at the start of a fight */
function msInit(m, now) {
  m.sk = mobKit(m.e).map((u) => ({ u, next: u.ev === 'aggro' || u.ev === 'buff' ? now : u.ev === 'timer' || u.ev === 'range' ? now + msRand(u.i) : now + 0.5, done: false }));
  m.cast = null; m.sgcd = 0;
  if (m.maxmana == null) { m.maxmana = msMana(m); m.mana = m.maxmana; }
  // a caster (a spell thrown from range with a cast time): it keeps its distance while it has the mana for it
  const rs = m.sk.map((s) => s.u).filter((u) => u.ev === 'timer' && u.kind === 'harm' && u.sp.cast > 0 && u.sp.rng && u.sp.rng[1] >= 20 && !(u.sp.ef || []).some(msArea));
  m.keep = rs.length ? { at: Math.min(28, Math.min(...rs.map((u) => u.sp.rng[1])) - 3), cost: Math.min(...rs.map((u) => msCost(m, u.sp))) } : null;
}
/* how close a creature comes (mobTick): casters stay at range while they can cast, the rest come to melee */
function msKeepRange(m, W) {
  const k = m.keep; if (!k || msRaid(W.id)) return MELEE_RANGE - 0.5;
  return m.maxmana && m.mana < k.cost ? MELEE_RANGE - 0.5 : k.at;
}

/* ------------------------------------------------------------------ targets */
/* everyone on the character's side: [{c} | {u} | {pet}] with x, y */
function msFoes(c) {
  const out = []; const r = rt(c);
  if (!r.ghost && c.hp > 0) out.push({ c, x: c.pos.x, y: c.pos.y });
  if (typeof groupOf === 'function' && groupOf(c)) for (const o of groupChars(groupOf(c))) if (o !== c && o.pos.map === c.pos.map && !rt(o).ghost && o.hp > 0) out.push({ c: o, x: o.pos.x, y: o.pos.y });
  for (const u of r.party || []) if (!u.dead) out.push({ u, x: u.x, y: u.y });
  if (typeof petAlive === 'function' && petAlive(c) && r.pet) out.push({ pet: true, x: r.pet.x, y: r.pet.y });
  return out;
}
function msVictim(c, vk, vu, onPet) { const r = rt(c); return vu ? { u: vu, x: vu.x, y: vu.y } : onPet ? { pet: true, x: r.pet.x, y: r.pet.y } : { c, x: c.pos.x, y: c.pos.y }; }
function msRange(sp) { const rg = sp.rng ? sp.rng[1] : 0; return rg > 0 ? Math.min(40, rg) : MELEE_RANGE + 0.5; }
function msArea(e) { return e.k === 'area_enemy' || e.ta === 22 || e.ta === 15; }

/* ------------------------------------------------------------------ one step of a creature in a fight
   true: it is casting (it does not move or swing) */
function mobSpellStep(W, m, c, dt, now, mods, vk, vu, onPet, d) {
  if (!G.d.spells || !G.d.spells.mob_use || msRaid(W.id)) return false;
  if (!m.sk) msInit(m, now);
  if (m.auras) for (const a of m.auras) {
    if (a.until <= now || !(a.hot || a.ptr)) continue;
    a.t = (a.t || 0) + dt; if (a.t < a.every) continue; a.t -= a.every;
    if (a.hot) m.hp = Math.min(m.maxhp, m.hp + a.val);                                 // its heals over time
    else { const t2 = spellRow(a.ptr); if (t2) msFire(W, m, c, { kind: 'harm', sp: t2 }, { mob: m }, t2, 1); }      // Fire Shield's pulses
  }
  if (m.cast) {
    if (mods.stun || mods.fear) { m.cast = null; fx(m.x, m.y, 'interrupted', '#cfc6b0'); return false; }
    m.cast.t += dt;
    const ib = m.cast.intBy;
    if (ib && m.cast.t >= ib.at) { m.cast = null; msInterrupted(m, ib, now); return false; }        // Kick, Pummel, Earth Shock ...
    if (m.cast.t < m.cast.total) return true;
    const k = m.cast; m.cast = null;
    const cost = msCost(m, k.u.sp); if (m.maxmana && m.mana < cost) return false; m.mana -= cost;
    msFire(W, m, c, k.u, k.tgt); return false;
  }
  if (mods.stun || mods.fear || !m.sk.length || (m.sgcd || 0) > now) return false;
  const victim = msVictim(c, vk, vu, onPet);
  for (const s of m.sk) {
    if (s.done || s.next > now) continue;
    const u = s.u; let tgt = null;
    if (m.maxmana && m.mana < msCost(m, u.sp)) { s.next = now + 2; continue; }          // out of mana for it
    if (u.ev === 'buff') {
      // kept up: put on again when it is gone
      if ((m.auras || []).some((a) => a.key === u.sp.n && a.until > now + 1)) { s.next = now + 2; continue; }
      tgt = { mob: m };
    } else if (u.ev === 'heal' || u.kind === 'heal') {
      const f = msHurtFriend(W, m, u); if (!f) { s.next = now + 0.5; continue; }
      tgt = { mob: f };
    } else if (u.ev === 'low') {
      const p = 100 * m.hp / m.maxhp; if (p > u.hp[1] || p < u.hp[0]) { s.next = now + 0.5; continue; }
      tgt = u.kind === 'harm' ? victim : { mob: m };
    } else if (u.kind === 'buff') tgt = { mob: m };
    else {
      tgt = (u.tg === 4 || u.tg === 5 || u.tg === 2) ? msRandomFoe(c, m, u) || victim : victim;
      const rg = msRange(u.sp); const dist = Math.hypot(tgt.x - m.x, tgt.y - m.y);
      const area = (u.sp.ef || []).some(msArea);
      if (u.ev === 'range' && (dist < u.dist[0] || dist > u.dist[1] + 1)) { s.next = now + 0.5; continue; }
      if (u.ev === 'exec') { const p = msHpPct(c, tgt); if (p > u.hp[1] || p < u.hp[0]) { s.next = now + 0.5; continue; } }
      if (u.ev === 'tcast' && !msCasting(c, tgt)) { s.next = now + 0.3; continue; }
      if (area && !(u.sp.rng && u.sp.rng[1] > 8)) { const ra = Math.max(...u.sp.ef.map((e) => e.ra || 0), 8); if (!msFoes(c).some((f) => Math.hypot(f.x - m.x, f.y - m.y) <= ra)) { s.next = now + 0.5; continue; } }
      else if (dist > rg + 1) { s.next = now + 0.5; continue; }
    }
    // the chance of the server's entry; the timer runs again either way (not repeatable: once a fight)
    s.next = now + (u.rep ? (u.rp[1] ? msRand(u.rp) : u.ev === 'heal' ? 10 + Math.random() * 6 : u.ev === 'buff' ? 3 : 8 + Math.random() * 7) : 1e9);
    if (u.ev === 'aggro') s.done = true;
    if (Math.random() * 100 >= u.ch) continue;
    m.sgcd = now + 1.5;
    const ct = u.sp.cast && u.sp.cast < 60000 ? Math.min(4, u.sp.cast / 1000) : 0;
    if (ct > 0) { m.cast = { u, tgt, t: 0, total: ct }; msWatchCast(c, m); return true; }
    const cost = msCost(m, u.sp); m.mana = Math.max(0, (m.mana || 0) - cost);
    msFire(W, m, c, u, tgt); return false;
  }
  return false;
}
function msHpPct(c, t) { if (t.u) return 100 * t.u.hp / t.u.maxhp; if (t.c) return 100 * t.c.hp / charStats(t.c).maxHp; if (t.pet && c.pet) return 100 * c.pet.hp / c.pet.maxhp; return 100; }
function msCasting(c, t) { if (t.u) return !!t.u.cb; if (t.c) return !!rt(t.c).cast; return false; }

/* ------------------------------------------------------------------ your side interrupts (like players do)
   a creature starts a heal or a spell with a cast time: someone of the group with an interrupt ready may stop it -
   the character or your other characters (Pummel, Shield Bash, Kick, Earth Shock, Counterspell, by their skill), the
   mercenaries (their class and experience) */
const MS_INTERRUPTS = [['Pummel', 1, 38, 10, 5], ['Shield Bash', 1, 12, 12, 5], ['Kick', 4, 12, 10, 5], ['Earth Shock', 7, 4, 6, 20], ['Counterspell', 8, 24, 30, 30]];
function msWatchCast(c, m) {
  const k = m.cast; if (!k || k.total < 1.2) return;
  const now = G.gameTime; let best = null;
  for (const f of msFoes(c)) {
    if (f.pet) continue; const dist = Math.hypot(f.x - m.x, f.y - m.y);
    for (const [n, cls, lv, cd, rg] of MS_INTERRUPTS) {
      if (dist > rg + 1) continue;
      if (f.u) {
        const u = f.u; if (u.cls !== cls || c.level < lv || (u.intCd || 0) > now || u.cb || (u.stunUntil || 0) > now) continue;
        if (n === 'Shield Bash' && u.role !== 'tank') continue;
        const ux = (u.ex == null ? 5 : u.ex) / 10;
        if (Math.random() < 0.25 + 0.6 * ux) { const at = Math.min(k.total - 0.1, 0.3 + (1 - ux) * 1.1 * Math.random()); if (!best || at < best.at) best = { at, n, u, cd }; }
      } else {
        const o = f.c; const r = rt(o); if (o.cls !== cls || !(o.known && o.known[n]) || ((r.cd && r.cd[n]) || 0) > now || (r.cc && r.cc.until > now)) continue;
        const ab = abilityUsable(o, n); if (!ab.ok) continue;
        const [pt, cost] = spellCost(o, ab.sp, n); if (powerOf(o, pt) < cost) continue;
        const ex = (typeof charExec === 'function' ? charExec(o) : 5) / 10;
        if (Math.random() < 0.35 + 0.55 * ex) { const at = Math.min(k.total - 0.1, 0.25 + (1 - ex) * 1.0 * Math.random()); if (!best || at < best.at) best = { at, n, o, sp: ab.sp, cd }; }
      }
      break;
    }
  }
  if (best) k.intBy = best;
}
function msInterrupted(m, ib, now) {
  m.sgcd = now + 4;                                   // its school is locked for a moment
  if (ib.u) { ib.u.intCd = now + ib.cd; fx(ib.u.x, ib.u.y, ib.n, '#ffd27a'); }
  else if (ib.o) { const r = rt(ib.o); r.cd = r.cd || {}; r.cd[ib.n] = now + ib.cd; if (typeof spendCost === 'function') spendCost(ib.o, ib.sp, ib.n); fx(ib.o.pos.x, ib.o.pos.y, ib.n, '#ffd27a'); }
  fx(m.x, m.y, 'interrupted', '#ffb36b');
}
/* a friend to heal: one missing the server's amount of health within its radius (else below 60%) */
function msHurtFriend(W, m, u) {
  let best = null, low = Infinity; const rad = (u && u.rad) || 30; const miss = (u && u.miss) || 0;
  for (const o of W.active) {
    if (o.st !== 'chase' || o.hp <= 0 || Math.hypot(o.x - m.x, o.y - m.y) > rad) continue;
    if (miss ? o.maxhp - o.hp < miss : o.hp > o.maxhp * 0.6) continue;
    const p = o.hp / o.maxhp; if (p < low) { low = p; best = o; }
  }
  return best;
}
function msRandomFoe(c, m, u) {
  const rg = msRange(u.sp); const l = msFoes(c).filter((f) => Math.hypot(f.x - m.x, f.y - m.y) <= rg + 1);
  return l.length ? l[Math.floor(Math.random() * l.length)] : null;
}

/* ------------------------------------------------------------------ the effects */
function msFire(W, m, c, u, tgt, sp0, depth) {
  const sp = sp0 || u.sp; if (m.st === 'dead' || m.hp <= 0) return;
  if (!depth) fx(m.x, m.y - 1, sp.n, u.kind === 'harm' ? '#ff9c5a' : '#9fe0ff');
  const dur = sp.dur > 0 ? Math.min(60, sp.dur / 1000) : 10;
  for (const e of sp.ef || []) {
    if (e.t === 64 && e.tr && (depth || 0) < 2) { const t2 = spellRow(e.tr); if (t2) msFire(W, m, c, u, tgt, t2, (depth || 0) + 1); continue; }
    const foe = e.k === 'enemy' || e.k === 'area_enemy';
    let targets = [];
    if (foe && msArea(e)) {
      // around the creature (Fire Nova, War Stomp), or around the target for a spell thrown at range (Flamestrike)
      const atTarget = sp.rng && sp.rng[1] > 8 && !tgt.mob; const cx = atTarget ? tgt.x : m.x, cy = atTarget ? tgt.y : m.y;
      targets = msFoes(c).filter((f) => Math.hypot(f.x - cx, f.y - cy) <= (e.ra || 8));
    } else if (foe && !tgt.mob) targets = [tgt];
    if (e.t === 2 || e.t === 9) { const v = msVal(m, sp, e); for (const f of targets) msHurt(c, f, m, v, sp.sc || 0, sp.n, false); if (e.t === 9) m.hp = Math.min(m.maxhp, m.hp + v * 0.5); continue; }
    if (MS_WEAPON.has(e.t)) {
      const base = rnd(m.dmin, m.dmax); const v = e.t === 31 ? base * (e.lo || 100) / 100 : base + Math.max(0, msVal(m, sp, e));
      const list = targets.length ? targets : [tgt].filter((x) => !x.mob);
      const hit = /Cleave|Sweep/.test(sp.n) ? list.concat(msFoes(c).filter((f) => !list.includes(f) && Math.hypot(f.x - m.x, f.y - m.y) <= MELEE_RANGE + 2).slice(0, 1)) : list;
      for (const f of hit) msHurt(c, f, m, v, 0, sp.n, true);
      continue;
    }
    if (e.t === 10) { const o = tgt.mob || m; const v = Math.round(msVal(m, sp, e)); o.hp = Math.min(o.maxhp, o.hp + v); fx(o.x, o.y, '+' + v, '#5ee07a'); continue; }
    if (e.t === 68) { for (const f of targets) msInterrupt(c, f, m, sp); continue; }
    if (e.t === 6 || e.t === 35 || e.t === 27) {
      if (foe) for (const f of targets) msDebuff(c, f, m, sp, e, dur);
      else msMobAura(tgt.mob || m, m, sp, e, dur);
    }
  }
}
/* damage on one of the character's side: magic is resisted by the school's resistance, physical goes through the
   attack table (dodge, parry, block) and armor like a swing */
function msHurt(c, f, m, v, school, name, phys, dot) {
  if (f.pet) { if (petAlive(c)) petTakeHit(c, m, Math.max(1, v)); return; }
  if (f.u) {
    const u = f.u; if (u.dead) return;
    let d = phys ? v * (1 - u.armorRed) : v * (1 - Math.min(0.75, (u.res || 0)));
    if (phys && !dot && Math.random() < (u.role === 'tank' ? 0.2 : 0.08)) { fx(u.x, u.y, 'dodge', '#cfc6b0'); return; }
    d = Math.max(1, Math.round(d));
    if (u.absorb && u.absorb.until > G.gameTime && u.absorb.v > 0) { const a = Math.min(d, u.absorb.v); u.absorb.v -= a; d -= a; if (u.absorb.v <= 0) u.absorb = null; if (!d) return; }
    u.hp -= d; meterGroup(c, u, 'taken', d); fx(u.x, u.y, '-' + d + (dot ? '' : ' ' + name), '#ff9a8a'); const r = rt(c); (r.dmgLog = r.dmgLog || []).push([G.gameTime, d]);
    if (typeof mercOnHit === 'function') mercOnHit(u);
    if (u.hp <= 0) { u.hp = 0; u.dead = true; u.deadAt = G.gameTime; u.cb = null; u.buffs = []; u.absorb = null; log(u.name + ' (' + u.role + ') has died.'); for (const x of threatsOf(c)) if (x.gThr) delete x.gThr[u.id]; }
    return;
  }
  const o = f.c; const r = rt(o); if (r.ghost || o.hp <= 0) return; const s = charStats(o);
  let d = v;
  if (phys && !dot) {
    const h = mobDamage(m, o, s, null); if (h.t !== 'hit') { fx(o.pos.x, o.pos.y, h.t, '#cfc6b0'); return; }
    d = h.d / Math.max(1, (m.dmin + m.dmax) / 2) * v;          // the attack table's result, scaled to the ability
  } else if (phys) d = v * (1 - s.armorReduction(m.lvl)) * s.dmgTaken;
  else {
    const RN = ['', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane']; const res = (s.res && s.res[RN[school]]) || 0;
    if (!dot && Math.random() < 0.04 + Math.max(0, o.level - m.lvl) * 0.02) { fx(o.pos.x, o.pos.y, 'resist', '#cfc6b0'); return; }
    d = v * (1 - Math.min(0.75, res / Math.max(1, m.lvl * 5) * 0.75)) * s.dmgTaken;
  }
  d = Math.max(1, Math.round(d));
  if (o.cls !== 1 && typeof absorbDamage === 'function') { d = absorbDamage(o, d); if (d <= 0) { fx(o.pos.x, o.pos.y, 'absorb', '#9fe0ff'); return; } }
  o.hp -= d; meterTaken(o, d); if (r.party) (r.dmgLog = r.dmgLog || []).push([G.gameTime, d]);
  fx(o.pos.x, o.pos.y, '-' + d + (dot ? '' : ' ' + name), '#ff6a5a');
  if (o.cls === 1 || (o.cls === 11 && o.form === 'bear')) o.rage = Math.min(100, (o.rage || 0) + 2.5 * d / rageConv(o.level));
  if (r.cast && !r.cast.ch && o.cls !== 1 && !dot) r.cast.t = Math.max(0, r.cast.t - 0.5);
  if (o.hp <= 0) { o.hp = 0; charDie(o, m); return; }
  if (r.bandage && typeof bandageHit === 'function') bandageHit(o);
  if (typeof autoPotion === 'function') autoPotion(o);
}
function msInterrupt(c, f, m, sp) {
  if (f.u) { if (f.u.cb) { f.u.cb = null; fx(f.u.x, f.u.y, 'interrupted', '#ffb36b'); } return; }
  if (!f.c) return; const r = rt(f.c);
  if (r.cast) { r.cast = null; r.silenceUntil = G.gameTime + 4; fx(f.c.pos.x, f.c.pos.y, 'interrupted (' + sp.n + ')', '#ffb36b'); }
}
/* a debuff from a creature: damage over time, crowd control, slows, stat debuffs - shown with the buffs */
function msDebuff(c, f, m, sp, e, dur) {
  const now = G.gameTime; const until = now + dur;
  if (f.pet) return;
  if (f.u) {
    const u = f.u; if (u.dead) return; u.buffs = u.buffs || [];
    let b = u.buffs.find((x) => x.name === sp.n && x.kind === 'debuff'); if (!b) { b = { name: sp.n, ic: sp.ic, kind: 'debuff', until: 0 }; u.buffs.push(b); }
    b.until = until; b.src = m; b.sc = sp.sc || 0;
    if (e.au === 3) b.dot = { t: 0, every: (e.amp || 3000) / 1000, v: Math.max(1, msVal(m, sp, e)) };
    if (e.au === 12 || e.au === 5 || e.au === 7) { u.stunUntil = until; u.cb = null; }
    return;
  }
  const o = f.c; const r = rt(o); if (r.ghost || o.hp <= 0) return;
  r.buffs = (r.buffs || []).filter((x) => x.until > now);
  let b = r.buffs.find((x) => x.name === sp.n && x.kind === 'debuff');
  if (!b) { b = { name: sp.n, ic: sp.ic, kind: 'debuff', auras: [], until: 0 }; r.buffs.push(b); }
  b.until = until; b.src = m; b.sc = sp.sc || 0;
  switch (e.au) {
    case 3: case 89: b.dot = { t: 0, every: (e.amp || 3000) / 1000, v: Math.max(1, e.au === 89 ? charStats(o).maxHp * msVal(m, sp, e) / 100 : msVal(m, sp, e)) }; break;
    case 12: case 5: r.cc = { kind: 'stun', until, from: m }; r.cast = null; fx(o.pos.x, o.pos.y, e.au === 5 ? 'confused' : 'stunned', '#ffb36b'); break;
    case 7: r.cc = { kind: 'fear', until, from: m }; r.cast = null; fx(o.pos.x, o.pos.y, 'feared', '#ffb36b'); break;
    case 27: r.silenceUntil = Math.max(r.silenceUntil || 0, until); r.cast = null; fx(o.pos.x, o.pos.y, 'silenced', '#ffb36b'); break;
    case 26: r.snare = { f: 0, until }; break;
    case 33: r.snare = { f: Math.max(0.2, 1 + msVal(m, sp, e) / 100), until }; break;
    default: {
      const v = msVal(m, sp, e); const au = e.au === 13 && ((e.mi || 0) & 1) ? 9001 : e.au;          // physical damage down: the weapon's damage
      const ex = b.auras.find((a) => a[0] === au && a[1] === e.mi);
      if (ex) ex[2] = sp.stack ? Math.max(-9999, ex[2] + v) : v; else b.auras.push([au, e.mi, v]);
      if (typeof dirty === 'function') dirty(o);
    }
  }
}
/* a buff on a creature (itself or a friend): armor, attack power, haste, damage shield, a proc on its hits */
function msMobAura(o, m, sp, e, dur) {
  o.auras = (o.auras || []).filter((a) => a.until > G.gameTime);
  let a = o.auras.find((x) => x.key === sp.n && x.au === e.au); if (!a) { a = { key: sp.n, au: e.au, val: 0, stacks: 1, src: null, t: 0 }; o.auras.push(a); }
  a.until = G.gameTime + (sp.dur < 0 || sp.dur > 600000 ? 600 : dur); a.val = msVal(m, sp, e, true); a.mob = true;
  if (e.au === 42 && e.tr) { a.tr = e.tr; a.pch = (sp.pr && sp.pr.chance) || 20; }
  if (e.au === 23 && e.tr) { a.ptr = e.tr; a.every = (e.amp || 3000) / 1000; a.t = 0; }       // a spell it sends out every few seconds (Fire Shield)
  if (e.au === 8) { a.every = (e.amp || 3000) / 1000; a.hot = true; }
}
/* after a creature's swing lands: its procs (Poison Proc: a poison on the victim) */
function msOnMobHit(W, m, c, victim) {
  if (!m.auras || msRaid(W.id)) return;
  for (const a of m.auras) if (a.tr && a.until > G.gameTime && Math.random() * 100 < a.pch) { const t2 = spellRow(a.tr); if (t2) msFire(W, m, c, { kind: 'harm', sp: t2 }, victim, t2, 1); }
}
/* the character hits a creature with a damage shield (Fire Shield, Thorns): it takes the damage back */
function msThorns(c, m) {
  if (!m.auras) return;
  for (const a of m.auras) if (a.au === 15 && a.mob && a.until > G.gameTime && a.val > 0) msHurt(c, { c, x: c.pos.x, y: c.pos.y }, m, a.val, 2, a.key, false, true);
}

/* ------------------------------------------------------------------ the character's side */
/* stunned or feared: true while it cannot act */
function charCcStep(c, dt) {
  const r = rt(c); const cc = r.cc; if (!cc) return false;
  if (cc.until <= G.gameTime || c.hp <= 0) { r.cc = null; return false; }
  r.cast = null; r.mv = null; r.interact = null;
  if (cc.kind === 'fear' && cc.from) {
    const dx = c.pos.x - cc.from.x, dy = c.pos.y - cc.from.y, d = Math.hypot(dx, dy) || 1;
    const st = charSpeed(c) * 0.75 * dt; if (passable(c.pos.map, c.pos.x + dx / d * 3, c.pos.y + dy / d * 3)) { c.pos.x += dx / d * st; c.pos.y += dy / d * st; }
  }
  return true;
}
function charSpeed(c) { const s = rt(c).snare; return c.speed * (s && s.until > G.gameTime ? s.f : 1); }
function charSilenced(c) { return (rt(c).silenceUntil || 0) > G.gameTime; }
/* damage over time from creatures (hotStep) */
function charDotStep(c, dt) {
  const r = rt(c);
  for (const b of r.buffs || []) if (b.dot && b.until > G.gameTime - 0.01) { b.dot.t += dt; while (b.dot.t >= b.dot.every && c.hp > 0) { b.dot.t -= b.dot.every; msHurt(c, { c, x: c.pos.x, y: c.pos.y }, b.src || { lvl: c.level, dmin: 1, dmax: 1 }, b.dot.v, b.sc || 0, b.name, false, true); } }
}
/* a mercenary: its damage over time and stuns (partyStep) - true while stunned */
function msUnitStep(c, u, dt) {
  for (const b of u.buffs || []) if (b.dot && b.until > G.gameTime - 0.01 && !u.dead) { b.dot.t += dt; while (b.dot.t >= b.dot.every && !u.dead) { b.dot.t -= b.dot.every; msHurt(c, { u }, b.src || { lvl: c.level }, b.dot.v, b.sc || 0, b.name, false, true); } }
  return (u.stunUntil || 0) > G.gameTime;
}
