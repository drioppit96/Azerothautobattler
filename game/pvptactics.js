'use strict';
/* pvptactics.js - how each class fights in a battleground (the players of both sides and your own characters).
   Gathered from the classic PvP guides (Warsong Gulch strategy, class PvP guides):
   - the flag carrier: druids are the best (Travel Form, Bear Form, shapeshifting out of roots and slows), shamans use
     Ghost Wolf, rogues Sprint, hunters Aspect of the Cheetah (dazed when hit), mages Blink and Frost Nova, warriors
     Hamstring and Intimidating Shout their chasers, priests shield themselves and scream. A carrier cannot stealth or
     use immunities (Divine Shield, Ice Block, Blessing of Protection drop the flag).
   - escorts keep the carrier going: Blessing of Freedom, Dispel Magic, Power Word: Shield, Earthbind Totem, Frost Nova
     and Cone of Cold on the chasers, Polymorph on a second attacker.
   - against the enemy carrier: slow, root and stun it first (Concussive Shot, Frost Shock, Hamstring, Entangling Roots,
     Hammer of Justice, Kidney Shot, Death Coil), Mortal Strike to cut its healing.
   - casters kite melee: freeze or slow them, Blink or step away, then cast. Healers get interrupted (Kick, Counterspell,
     Earth Shock, Spell Lock), crowd controlled (Polymorph, Fear, Blind) or stunned.
   - diminishing returns on stuns, fears, incapacitates and roots; the PvP trinket and racials (Will of the Forsaken,
     Escape Artist, War Stomp) break them.
   Statuses live on the battleground fighter (u.st: until when), cooldowns in u.cd. */

const BG_CC_CAT = { stun: 'stun', fear: 'fear', incap: 'incap', root: 'root', silence: 'silence' };
const BG_CC_COL = { stun: '#ffe066', fear: '#b07cff', incap: '#ff8ad8', root: '#7fd8ff', silence: '#9fd0ff', slow: '#6fb7ff', immune: '#ffd866' };
function bgSt(u) { if (!u.st) u.st = {}; if (!u.cd) u.cd = {}; if (!u.dr) u.dr = {}; return u.st; }
function bgHas(u, k) { return !!(u.st && u.st[k] > G.gameTime); }
function bgReady(u, k) { bgSt(u); return !(u.cd[k] > G.gameTime); }
function bgUse(u, k, cd) { bgSt(u); u.cd[k] = G.gameTime + cd; }
function bgFx(B, u, text, col) { if (!G.headless && G.map && G.map.map === B.map && B.units.some((x) => x.c && isActive(x.c) && rt(x.c).bg === B)) fx(u.x, u.y, text, col || '#ffe9a8'); }
/* crowd control and slows: diminishing returns (full, half, quarter, immune - reset after 18 s) */
function bgApply(B, src, t, kind, dur, name, opt) {
  if (!t.alive || t.general && kind !== 'slow') return false; const st = bgSt(t); const now = G.gameTime;
  if (bgHas(t, 'immune')) { bgFx(B, t, 'Immune', '#ffd866'); return false; }
  if ((kind === 'root' || kind === 'slow') && bgHas(t, 'free')) return false;
  if (kind === 'fear' && B.totems && B.totems.some((x) => x.kind === 'tremor' && x.team === t.team && x.until > now && Math.hypot(x.x - t.x, x.y - t.y) < 30)) return false;
  const cat = BG_CC_CAT[kind];
  if (cat) { const d = t.dr[cat] && now - t.dr[cat].t < 18 ? t.dr[cat] : (t.dr[cat] = { n: 0, t: now }); const k = [1, 0.5, 0.25, 0][Math.min(3, d.n)]; if (!k) return false; dur *= k; d.n++; d.t = now; }
  if (kind === 'slow') { t.slowF = Math.min(bgHas(t, 'slow') ? t.slowF : 1, (opt && opt.f) || 0.5); }
  st[kind] = Math.max(st[kind] || 0, now + dur);
  if (kind === 'fear' || kind === 'root') t.brk = { k: kind, left: t.maxhp * (kind === 'fear' ? 0.2 : 0.3) };          // breaks after this much damage
  if (kind === 'fear') t.fearFrom = src;
  if (kind === 'stun' || kind === 'incap' || kind === 'fear' || (kind === 'silence' && t.cls !== 3)) t.cast = null;          // interrupted
  if (kind === 'stun' || kind === 'incap' || kind === 'fear') { t.stealth = false; if (t.form === 'travel' || t.form === 'wolf' || t.form === 'cheetah') t.form = null; }
  if (name) bgFx(B, t, name, BG_CC_COL[kind] || '#fff');
  return true;
}
function bgClear(u, kinds) { const st = bgSt(u); let any = false; for (const k of kinds) if (st[k] > G.gameTime) { st[k] = 0; any = true; } return any; }
function bgCanAct(u) { return !(bgHas(u, 'stun') || bgHas(u, 'incap') || bgHas(u, 'fear') || bgHas(u, 'iceblock')); }
function bgCanCast(u) { return bgCanAct(u) && !bgHas(u, 'silence'); }
function bgSpeedMul(u) {
  if (bgHas(u, 'stun') || bgHas(u, 'incap') || bgHas(u, 'root') || bgHas(u, 'iceblock')) return 0;
  let k = u.carry ? 1.1 : 1;
  if (u.form === 'travel' || u.form === 'wolf') k *= 1.4; else if (u.form === 'cheetah') k *= 1.3; else if (u.stealth) k *= 0.85;
  if (bgHas(u, 'sprint')) k *= 1.7;
  if (bgHas(u, 'fear')) k *= 0.75;
  if (bgHas(u, 'slow')) k *= u.slowF || 0.5;
  return k;
}
/* damage on t: immunities, absorbs, forms; crowd control that breaks */
function bgDmgMul(B, t, src, v) {
  if (bgHas(t, 'immune')) return 0;
  if (t.form === 'bear') v *= 0.7;
  if (bgHas(t, 'evasion') && !src.ranged) v *= 0.5;
  if (bgHas(t, 'bark')) v *= 0.7;
  if (t.absorb > 0) { const a = Math.min(t.absorb, v); t.absorb -= a; v -= a; }
  if (bgHas(t, 'incap')) t.st.incap = 0;          // Polymorph, Blind, Gouge, Scatter Shot, Freezing Trap
  if (t.brk && (bgHas(t, t.brk.k))) { t.brk.left -= v; if (t.brk.left <= 0) { t.st[t.brk.k] = 0; t.brk = null; } }
  if (t.form === 'cheetah') { t.form = null; bgApply(B, src, t, 'slow', 4, 'Dazed', { f: 0.5 }); }
  t.stealth = false; src.stealth = false; t.lastHitT = G.gameTime;
  return v;
}
function bgHealMul(t) { return bgHas(t, 'ms') ? 0.5 : 1; }

/* the helpless: feared ones run away, the rest wait it out */
function bgHelpless(B, u, dt) {
  if (bgHas(u, 'fear')) { const f = u.fearFrom && u.fearFrom.alive ? u.fearFrom : null; const dx = f ? u.x - f.x : Math.cos(u.id.length), dy = f ? u.y - f.y : Math.sin(u.id.length); const d = Math.hypot(dx, dy) || 1; bgMove(u, u.x + dx / d * 30, u.y + dy / d * 30, dt, 0); }
}
/* breaking out: PvP trinket (rank 1+), Will of the Forsaken, Escape Artist; Berserker Rage, Blink, shapeshifting */
function bgBreakOut(B, u) {
  const now = G.gameTime; const bad = bgHas(u, 'stun') || bgHas(u, 'incap') || bgHas(u, 'fear');
  const matters = u.carry || u.heal || u.hp < u.maxhp * 0.55;
  if (u.race === 5 && (bgHas(u, 'fear') || bgHas(u, 'incap')) && bgReady(u, 'wotf')) { bgClear(u, ['fear', 'incap']); bgUse(u, 'wotf', 120); bgFx(B, u, 'Will of the Forsaken', '#cfc6b0'); return; }
  if (u.cls === 1 && bgHas(u, 'fear') && bgReady(u, 'brage')) { bgClear(u, ['fear']); bgUse(u, 'brage', 30); bgFx(B, u, 'Berserker Rage', '#ff7a5a'); return; }
  if (bad && matters && (u.rank || 0) >= 1 && bgReady(u, 'trinket')) { bgClear(u, ['stun', 'incap', 'fear', 'root', 'slow']); bgUse(u, 'trinket', 300); bgFx(B, u, 'PvP Trinket', '#ffd866'); return; }
  if ((bgHas(u, 'root') || bgHas(u, 'slow')) && !bad) {
    if (u.race === 7 && bgReady(u, 'escape')) { bgClear(u, ['root', 'slow']); bgUse(u, 'escape', 60); bgFx(B, u, 'Escape Artist', '#cfc6b0'); return; }
    if (u.cls === 11 && bgReady(u, 'shift') && (u.carry || bgHas(u, 'root'))) { bgClear(u, ['root', 'slow']); bgUse(u, 'shift', 4); u.form = u.carry ? 'travel' : null; bgFx(B, u, 'Shapeshift', '#ff9a3c'); return; }
  }
  if (u.cls === 8 && (bgHas(u, 'stun') || bgHas(u, 'root')) && bgReady(u, 'blink')) { bgClear(u, ['stun', 'root']); bgBlink(B, u); }
}
function bgBlink(B, u) {
  bgUse(u, 'blink', 15); const near = bgNearestEnemy(B, u, 40); let dx, dy;
  if (u.carry) { const h = B.def.flag[u.team]; dx = h[0] - u.x; dy = h[1] - u.y; } else if (near) { dx = u.x - near.x; dy = u.y - near.y; } else { dx = 1; dy = 0; }
  const d = Math.hypot(dx, dy) || 1; u.x += dx / d * 20; u.y += dy / d * 20; u.cast = null; bgFx(B, u, 'Blink', '#9fd0ff');
}
function bgNearestEnemy(B, u, r, f) { let best = null, bd = r; for (const x of B.units) { if (!x.alive || x.team === u.team || x.general || (f && !f(x))) continue; const d = Math.hypot(x.x - u.x, x.y - u.y); if (d < bd) { bd = d; best = x; } } return best; }
function bgEnemiesIn(B, u, r, f) { const out = []; for (const x of B.units) if (x.alive && x.team !== u.team && !x.general && Math.abs(x.x - u.x) < r && Math.abs(x.y - u.y) < r && Math.hypot(x.x - u.x, x.y - u.y) < r && (!f || f(x))) out.push(x); return out; }
function bgAlliesIn(B, u, r, f) { const out = []; for (const x of B.units) if (x.alive && x.team === u.team && !x.general && Math.hypot(x.x - u.x, x.y - u.y) < r && (!f || f(x))) out.push(x); return out; }
const bgMelee = (x) => !x.ranged;
const bgCasting = (x) => !!(x.cast && x.cls !== 3);          // casting a spell (a heal, a bolt): something to interrupt
/* the enemy flag carrier (carrying our flag) */
function bgTheirCarrier(B, u) { return B.key === 'wsg' ? B.units.find((x) => x.alive && x.carry === u.team) || null : null; }
function bgOurCarrier(B, u) { return B.key === 'wsg' ? B.units.find((x) => x.alive && x.team === u.team && x.carry) || null : null; }

/* the class kit: called a few times a second for each fighter that can act; t = its target, P = its plan */
function bgTactics(B, u, t, P) {
  bgSt(u); const now = G.gameTime; const dT = t ? Math.hypot(t.x - u.x, t.y - u.y) : 99;
  const eCar = bgTheirCarrier(B, u), mCar = bgOurCarrier(B, u);
  const fighting = now - (u.lastHitT || -99) < 5 || (t && dT < 30);
  const goalFar = P && P.goal && Math.hypot(P.goal[0] - u.x, P.goal[1] - u.y) > 45;
  const inCast = bgCanCast(u);
  // racials
  if (u.race === 6 && bgReady(u, 'stomp')) { const e = bgEnemiesIn(B, u, 8); if (e.length >= 2 || (u.carry && e.length)) { bgUse(u, 'stomp', 120); for (const x of e) bgApply(B, u, x, 'stun', 2); bgFx(B, u, 'War Stomp', '#ffe066'); } }
  switch (u.cls) {
    case 1: {          // warrior: Charge / Intercept in, Hamstring, Mortal Strike, Intimidating Shout, (Berserker Rage in bgBreakOut)
      const want = eCar && Math.hypot(eCar.x - u.x, eCar.y - u.y) < 25 ? eCar : t;
      if (want) { const d = Math.hypot(want.x - u.x, want.y - u.y);
        if (d > 8 && d < 25 && !u.carry && bgSpeedMul(u) > 0) { const k = fighting ? 'intercept' : 'charge'; if (bgReady(u, k)) { bgUse(u, k, k === 'charge' ? 15 : 30); const f = (d - 3) / d; u.x += (want.x - u.x) * f; u.y += (want.y - u.y) * f; bgApply(B, u, want, 'stun', k === 'charge' ? 1 : 3, k === 'charge' ? 'Charge' : 'Intercept'); u.tgt = want; } }
        if (d < 6 && !bgHas(want, 'slow') && bgReady(u, 'gcd')) { bgUse(u, 'gcd', 1.5); bgApply(B, u, want, 'slow', 15, 'Hamstring', { f: 0.5 }); }
        if (d < 6 && bgReady(u, 'ms')) { bgUse(u, 'ms', 6); bgSt(want).ms = now + 10; }
      }
      if (bgReady(u, 'ishout')) { const e = bgEnemiesIn(B, u, 10); if (e.length >= 3 || (u.carry && e.length >= 2) || (e.length >= 2 && u.hp < u.maxhp * 0.5)) { bgUse(u, 'ishout', 180); for (const x of e) bgApply(B, u, x, 'fear', 8); bgFx(B, u, 'Intimidating Shout', '#b07cff'); } }
      break;
    }
    case 2: {          // paladin: Blessing of Freedom, Hammer of Justice, Cleanse, Divine Shield, Lay on Hands
      if (inCast && bgReady(u, 'bof')) { const a = [mCar].concat(bgAlliesIn(B, u, 30)).find((x) => x && x.alive && Math.hypot(x.x - u.x, x.y - u.y) < 30 && (bgHas(x, 'root') || bgHas(x, 'slow'))); if (a) { bgUse(u, 'bof', 20); bgClear(a, ['root', 'slow']); bgSt(a).free = now + 10; bgFx(B, a, 'Blessing of Freedom', '#ffd866'); } }
      if (inCast && bgReady(u, 'hoj')) { const x = [eCar].concat(bgEnemiesIn(B, u, 10, (e) => e.heal)).concat(t && dT < 10 && t.hp < t.maxhp * 0.4 ? [t] : []).find((e) => e && e.alive && Math.hypot(e.x - u.x, e.y - u.y) < 10); if (x) { bgUse(u, 'hoj', 60); bgApply(B, u, x, 'stun', 6, 'Hammer of Justice'); } }
      if (inCast && bgReady(u, 'cleanse')) { const a = bgAlliesIn(B, u, 30, (x) => bgHas(x, 'incap') || bgHas(x, 'fear') || bgHas(x, 'root'))[0]; if (a) { bgUse(u, 'cleanse', 4); bgClear(a, ['incap', 'fear', 'root']); bgFx(B, a, 'Cleanse', '#ffd866'); } }
      if (inCast && bgReady(u, 'loh')) { const a = bgAlliesIn(B, u, 30, (x) => x.hp < x.maxhp * 0.15).sort((a, b) => (b.carry ? 1 : 0) - (a.carry ? 1 : 0))[0]; if (a) { bgUse(u, 'loh', 3600); a.hp = a.maxhp; bgFx(B, a, 'Lay on Hands', '#ffd866'); } }
      if (!u.carry && u.hp < u.maxhp * 0.2 && bgReady(u, 'bubble') && bgCanAct(u)) { bgUse(u, 'bubble', 300); bgSt(u).immune = now + 12; bgClear(u, ['root', 'slow', 'silence']); bgFx(B, u, 'Divine Shield', '#ffd866'); }
      break;
    }
    case 3: {          // hunter: Concussive Shot, Wing Clip, Scatter Shot, Frost Trap, Freezing Trap on the flag, Aspect of the Cheetah, Feign Death
      const melee = bgNearestEnemy(B, u, 8, bgMelee);
      if (bgReady(u, 'conc')) { const x = [eCar].concat([t]).find((e) => e && e.alive && !bgHas(e, 'slow') && Math.hypot(e.x - u.x, e.y - u.y) < 35 && Math.hypot(e.x - u.x, e.y - u.y) > 6); if (x) { bgUse(u, 'conc', 12); bgApply(B, u, x, 'slow', 4, 'Concussive Shot', { f: 0.5 }); } }
      if (melee && Math.hypot(melee.x - u.x, melee.y - u.y) < 5 && !bgHas(melee, 'slow') && bgReady(u, 'wclip')) { bgUse(u, 'wclip', 3); bgApply(B, u, melee, 'slow', 10, 'Wing Clip', { f: 0.5 }); }
      if (melee && bgReady(u, 'ftrap')) { bgUse(u, 'ftrap', 15); for (const x of bgEnemiesIn(B, u, 10)) bgApply(B, u, x, 'slow', 8, null, { f: 0.4 }); bgFx(B, u, 'Frost Trap', '#7fd8ff'); }
      if (bgReady(u, 'scatter')) { const x = (eCar && Math.hypot(eCar.x - u.x, eCar.y - u.y) < 15) ? eCar : melee && u.hp < u.maxhp * 0.5 ? melee : null; if (x) { bgUse(u, 'scatter', 30); bgApply(B, u, x, 'incap', 4, 'Scatter Shot'); } }
      if (B.key === 'wsg' && P && P.anchor && bgReady(u, 'freeze')) { const f = B.def.flag[u.team]; if (Math.hypot(f[0] - u.x, f[1] - u.y) < 40) { bgUse(u, 'freeze', 15); (B.traps = B.traps || []).push({ x: f[0], y: f[1], team: u.team, until: now + 60, src: u }); } }
      if (u.hp < u.maxhp * 0.2 && bgReady(u, 'feign')) { bgUse(u, 'feign', 30); for (const x of B.units) if (x.tgt === u) x.tgt = null; bgFx(B, u, 'Feign Death', '#cfc6b0'); }
      if (!fighting && (u.carry || goalFar) && !u.form && bgReady(u, 'gcd')) { u.form = 'cheetah'; bgUse(u, 'gcd', 1.5); }
      break;
    }
    case 4: {          // rogue: Stealth, Cheap Shot, Kidney Shot, Kick, Blind, Sprint, Evasion, Vanish
      if (!u.carry && !u.stealth && now - (u.lastHitT || -99) > 6 && !bgNearestEnemy(B, u, 30)) { u.stealth = true; }
      if (t && dT < 6) {
        if (u.stealth && bgReady(u, 'cheap')) { bgUse(u, 'cheap', 20); u.stealth = false; bgApply(B, u, t, 'stun', 4, 'Cheap Shot'); }
        else if (!bgHas(t, 'stun') && bgReady(u, 'kidney') && (t.heal || t.carry || t.hp < t.maxhp * 0.6)) { bgUse(u, 'kidney', 20); bgApply(B, u, t, 'stun', 5, 'Kidney Shot'); }
      }
      if (bgReady(u, 'kick')) { const h = bgEnemiesIn(B, u, 6, bgCasting)[0]; if (h) { bgUse(u, 'kick', 10); bgApply(B, u, h, 'silence', 5, 'Kick'); } }
      if (bgReady(u, 'blind')) { const x = bgEnemiesIn(B, u, 10, (e) => e !== t && e.tgt === u && !e.ranged)[0]; if (x) { bgUse(u, 'blind', 300); bgApply(B, u, x, 'incap', 10, 'Blind'); } }
      if (bgReady(u, 'sprint') && (u.carry && bgNearestEnemy(B, u, 30) || (eCar && Math.hypot(eCar.x - u.x, eCar.y - u.y) > 15 && Math.hypot(eCar.x - u.x, eCar.y - u.y) < 60))) { bgUse(u, 'sprint', 300); bgSt(u).sprint = now + 15; bgFx(B, u, 'Sprint', '#fff569'); }
      if (bgReady(u, 'evasion') && u.hp < u.maxhp * 0.5 && bgNearestEnemy(B, u, 5, bgMelee)) { bgUse(u, 'evasion', 300); bgSt(u).evasion = now + 15; bgFx(B, u, 'Evasion', '#fff569'); }
      if (!u.carry && u.hp < u.maxhp * 0.2 && bgReady(u, 'vanish')) { bgUse(u, 'vanish', 300); bgClear(u, ['root', 'slow']); u.stealth = true; for (const x of B.units) if (x.tgt === u) x.tgt = null; u.tgt = null; bgFx(B, u, 'Vanish', '#cfc6b0'); }
      break;
    }
    case 5: {          // priest: Power Word: Shield (the carrier first), Psychic Scream, Dispel Magic
      if (inCast && bgReady(u, 'gcd')) {
        const a = [mCar, u].concat(bgAlliesIn(B, u, 30, (x) => now - (x.lastHitT || -99) < 2)).find((x) => x && x.alive && Math.hypot(x.x - u.x, x.y - u.y) < 30 && !(x.wsoul > now) && x.hp < x.maxhp * 0.9 && now - (x.lastHitT || -99) < 3);
        if (a) { bgUse(u, 'gcd', 1.5); a.absorb = Math.max(a.absorb || 0, a.maxhp * 0.22); a.wsoul = now + 15; bgFx(B, a, 'Power Word: Shield', '#ffffff'); }
      }
      if (inCast && bgReady(u, 'scream')) { const e = bgEnemiesIn(B, u, 8); if (e.length >= 2 || (e.length && (u.hp < u.maxhp * 0.45 || u.carry))) { bgUse(u, 'scream', 30); for (const x of e) bgApply(B, u, x, 'fear', 8); bgFx(B, u, 'Psychic Scream', '#b07cff'); } }
      if (inCast && bgReady(u, 'dispel')) { const a = bgAlliesIn(B, u, 30, (x) => bgHas(x, 'incap') || bgHas(x, 'fear') || bgHas(x, 'root') || (x.carry && bgHas(x, 'slow'))).sort((a, b) => (b.carry ? 1 : 0) - (a.carry ? 1 : 0))[0]; if (a) { bgUse(u, 'dispel', 4); bgClear(a, ['incap', 'fear', 'root', 'slow']); bgFx(B, a, 'Dispel Magic', '#ffffff'); } }
      break;
    }
    case 7: {          // shaman: Ghost Wolf, Earthbind / Tremor Totem, Earth Shock (interrupt), Frost Shock, Purge, Nature's Swiftness
      if (inCast && bgReady(u, 'shock')) {
        const h = bgEnemiesIn(B, u, 20, bgCasting)[0];
        if (h) { bgUse(u, 'shock', 6); bgApply(B, u, h, 'silence', 2, 'Earth Shock'); }
        else { const x = [eCar, t].find((e) => e && e.alive && !bgHas(e, 'slow') && Math.hypot(e.x - u.x, e.y - u.y) < 20); if (x) { bgUse(u, 'shock', 6); bgApply(B, u, x, 'slow', 8, 'Frost Shock', { f: 0.5 }); } }
      }
      if (inCast && bgReady(u, 'ebind')) { const chasers = mCar && Math.hypot(mCar.x - u.x, mCar.y - u.y) < 15 ? bgEnemiesIn(B, mCar, 15) : bgEnemiesIn(B, u, 10, bgMelee); if (chasers.length) { bgUse(u, 'ebind', 15); (B.totems = B.totems || []).push({ kind: 'earthbind', x: u.x, y: u.y, team: u.team, until: now + 20 }); bgFx(B, u, 'Earthbind Totem', '#c9a46a'); } }
      if (inCast && bgReady(u, 'tremor') && bgAlliesIn(B, u, 30, (x) => bgHas(x, 'fear')).length) { bgUse(u, 'tremor', 20); (B.totems = B.totems || []).push({ kind: 'tremor', x: u.x, y: u.y, team: u.team, until: now + 30 }); for (const x of bgAlliesIn(B, u, 30)) bgClear(x, ['fear']); bgFx(B, u, 'Tremor Totem', '#c9a46a'); }
      if (inCast && bgReady(u, 'purge')) { const x = bgEnemiesIn(B, u, 30, (e) => e.absorb > 0 || bgHas(e, 'free'))[0]; if (x) { bgUse(u, 'purge', 6); x.absorb = 0; bgClear(x, ['free']); bgFx(B, x, 'Purge', '#9fd0ff'); } }
      if (u.heal && inCast && bgReady(u, 'ns')) { const a = bgAlliesIn(B, u, 35, (x) => x.hp < x.maxhp * 0.25)[0]; if (a) { bgUse(u, 'ns', 180); const v = a.maxhp * 0.45 * bgHealMul(a); a.hp = Math.min(a.maxhp, a.hp + v); u.healed += v; bgFx(B, a, "Nature's Swiftness", '#5eff7a'); } }
      if (!fighting && (u.carry || goalFar) && !u.form) u.form = 'wolf';
      break;
    }
    case 8: {          // mage: Frost Nova + Blink away (kite), Cone of Cold, Polymorph, Counterspell, Frostbolt slows, Ice Block
      const melee = bgEnemiesIn(B, u, 9, bgMelee);
      if (inCast && melee.length && bgReady(u, 'nova')) { bgUse(u, 'nova', 25); for (const x of bgEnemiesIn(B, u, 10)) bgApply(B, u, x, 'root', 8); bgFx(B, u, 'Frost Nova', '#7fd8ff'); u.kite = now + 2; }
      else if (inCast && melee.length && bgReady(u, 'coc')) { bgUse(u, 'coc', 10); for (const x of bgEnemiesIn(B, u, 10)) bgApply(B, u, x, 'slow', 8, null, { f: 0.5 }); bgFx(B, u, 'Cone of Cold', '#7fd8ff'); }
      if (melee.length && bgReady(u, 'blink') && bgCanAct(u) && (melee.every((x) => bgHas(x, 'root')) || u.carry)) bgBlink(B, u);
      if (inCast && bgReady(u, 'cs')) { const h = bgEnemiesIn(B, u, 30, bgCasting)[0]; if (h) { bgUse(u, 'cs', 30); bgApply(B, u, h, 'silence', 4, 'Counterspell'); } }
      if (inCast && bgReady(u, 'poly')) { const x = bgEnemiesIn(B, u, 30, (e) => e !== t && !bgHas(e, 'incap') && (e.heal || e.tgt === u || (mCar && e.tgt === mCar)) && !e.carry)[0]; if (x) { bgUse(u, 'poly', 10); if (x.tgt === u) x.tgt = null; bgApply(B, u, x, 'incap', 15, 'Polymorph'); } }
      if (inCast && t && dT < 30 && bgReady(u, 'fbolt')) { bgUse(u, 'fbolt', 3); if (!bgHas(t, 'slow')) bgApply(B, u, t, 'slow', 5, null, { f: 0.6 }); }
      if (!u.carry && u.hp < u.maxhp * 0.15 && bgReady(u, 'iceblock')) { bgUse(u, 'iceblock', 300); bgClear(u, ['root', 'slow', 'stun', 'silence']); bgSt(u).immune = now + 10; u.st.iceblock = now + 10; for (const x of B.units) if (x.tgt === u) x.tgt = null; bgFx(B, u, 'Ice Block', '#7fd8ff'); }
      break;
    }
    case 9: {          // warlock: Fear the melee on them, Death Coil, Howl of Terror, Spell Lock (Felhunter), Drain Life
      if (inCast && bgReady(u, 'howl')) { const e = bgEnemiesIn(B, u, 10); if (e.length >= 2) { bgUse(u, 'howl', 40); for (const x of e) bgApply(B, u, x, 'fear', 8); bgFx(B, u, 'Howl of Terror', '#b07cff'); } }
      if (inCast && bgReady(u, 'coil')) { const x = (eCar && Math.hypot(eCar.x - u.x, eCar.y - u.y) < 30) ? eCar : u.hp < u.maxhp * 0.5 ? bgNearestEnemy(B, u, 20, (e) => e.tgt === u) : null; if (x) { bgUse(u, 'coil', 120); bgApply(B, u, x, 'fear', 3, 'Death Coil'); u.hp = Math.min(u.maxhp, u.hp + u.maxhp * 0.15); } }
      if (inCast && bgReady(u, 'fear')) { const x = bgEnemiesIn(B, u, 20, (e) => e.tgt === u && !e.ranged && !bgHas(e, 'fear'))[0]; if (x) { bgUse(u, 'fear', 8); bgApply(B, u, x, 'fear', 10, 'Fear'); } }
      if (bgReady(u, 'lock')) { const h = bgEnemiesIn(B, u, 30, bgCasting)[0]; if (h) { bgUse(u, 'lock', 24); bgApply(B, u, h, 'silence', 3, 'Spell Lock'); } }
      if (inCast && t && dT < 30 && u.hp < u.maxhp * 0.6) u.hp = Math.min(u.maxhp, u.hp + u.dps * 0.25 * 0.4 * (B.dmgK || 1));          // Drain Life
      break;
    }
    case 11: {          // druid: Travel Form (the best flag carrier), Bear Form when caught, Entangling Roots, Bash, Barkskin
      if (u.carry) { const e = bgEnemiesIn(B, u, 8); u.form = e.length >= 2 && u.hp < u.maxhp * 0.6 ? 'bear' : 'travel'; }
      else if (!fighting && goalFar) { if (u.form !== 'travel') u.form = 'travel'; }
      else if (u.form === 'travel' && fighting) u.form = null;
      if (inCast && bgReady(u, 'roots')) { const x = [eCar].concat(bgEnemiesIn(B, u, 10, (e) => bgMelee(e) && e.tgt === u)).find((e) => e && e.alive && !bgHas(e, 'root') && Math.hypot(e.x - u.x, e.y - u.y) < 30); if (x) { bgUse(u, 'roots', 6); bgApply(B, u, x, 'root', 12, 'Entangling Roots'); } }
      if (bgReady(u, 'bash')) { const x = [eCar].concat(bgEnemiesIn(B, u, 5, (e) => e.heal)).find((e) => e && e.alive && Math.hypot(e.x - u.x, e.y - u.y) < 5); if (x) { bgUse(u, 'bash', 60); bgApply(B, u, x, 'stun', 4, 'Bash'); } }
      if (u.hp < u.maxhp * 0.4 && bgReady(u, 'bark')) { bgUse(u, 'bark', 60); bgSt(u).bark = now + 15; bgFx(B, u, 'Barkskin', '#ff9a3c'); }
      break;
    }
  }
  // forms that do not fight: dropped when there is something to hit
  if (!u.carry && (u.form === 'wolf' || u.form === 'cheetah') && fighting) u.form = null;
}
/* casters and hunters kite: a slowed or rooted melee close by - step away instead of standing in it */
function bgKite(B, u, dt) {
  if (!u.ranged || u.heal || u.carry || u.cls === 5 || bgSpeedMul(u) <= 0) return false;
  const m = bgNearestEnemy(B, u, 8, bgMelee); if (!m) return false;
  const stuck = bgHas(m, 'root') || bgHas(m, 'stun') || bgHas(m, 'incap') || bgHas(m, 'fear') || (bgHas(m, 'slow') && (m.slowF || 1) <= 0.6);
  if (!stuck && !(u.kite > G.gameTime)) return false;
  const dx = u.x - m.x, dy = u.y - m.y, d = Math.hypot(dx, dy) || 1; bgMove(u, u.x + dx / d * 12, u.y + dy / d * 12, dt, 0); return true;
}
/* totems and traps of both sides */
function bgEffects(B, dt) {
  const now = G.gameTime;
  if (B.totems && B.totems.length) { B.totems = B.totems.filter((x) => x.until > now);
    for (const x of B.totems) if (x.kind === 'earthbind') for (const e of B.units) if (e.alive && e.team !== x.team && Math.abs(e.x - x.x) < 10 && Math.abs(e.y - x.y) < 10 && !bgHas(e, 'free')) { bgSt(e).slow = Math.max(e.st.slow || 0, now + 1); e.slowF = Math.min(bgHas(e, 'slow') ? e.slowF || 1 : 1, 0.5); } }
  if (B.traps && B.traps.length) { B.traps = B.traps.filter((x) => x.until > now);
    for (const x of B.traps.slice()) { const e = B.units.find((v) => v.alive && v.team !== x.team && Math.hypot(v.x - x.x, v.y - x.y) < 4); if (e) { B.traps.splice(B.traps.indexOf(x), 1); bgApply(B, x.src || e, e, 'incap', 10, 'Freezing Trap'); } } }
}
/* drawing: statuses around a fighter, totems and traps */
function bgDrawStatus(ctx, u, x, y, R) {
  if (!u.st) return; const now = G.gameTime;
  const ring = (col, w, r, dash) => { ctx.strokeStyle = col; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.stroke(); if (dash) ctx.setLineDash([]); };
  if (u.st.immune > now) { ctx.fillStyle = '#ffd86640'; ctx.beginPath(); ctx.arc(x, y, R + 5, 0, 6.3); ctx.fill(); ring('#ffd866', 2, R + 5); }
  if (u.st.root > now) ring(BG_CC_COL.root, 3, R + 4, [3, 2]);
  if (u.st.stun > now) { ctx.fillStyle = '#ffe066'; for (let i = 0; i < 3; i++) { const a = now * 4 + i * 2.1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * (R + 2), y - R - 2 + Math.sin(a) * 2, 1.8, 0, 6.3); ctx.fill(); } }
  if (u.st.incap > now) ring(BG_CC_COL.incap, 3, R + 3);
  if (u.st.fear > now) ring(BG_CC_COL.fear, 3, R + 3, [2, 2]);
  if (u.st.silence > now) ring(BG_CC_COL.silence, 2, R + 6, [1, 3]);
  if (u.st.slow > now) { ctx.fillStyle = BG_CC_COL.slow; ctx.beginPath(); ctx.arc(x - R, y + R, 2.5, 0, 6.3); ctx.fill(); }
  if (u.absorb > 0) ring('#ffffffaa', 1.5, R + 2.5);
  if (u.form === 'travel' || u.form === 'wolf' || u.form === 'cheetah' || u.st.sprint > now) { ctx.strokeStyle = '#ffffff99'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - R - 7, y - 2); ctx.lineTo(x - R - 2, y - 2); ctx.moveTo(x - R - 9, y + 2); ctx.lineTo(x - R - 3, y + 2); ctx.stroke(); }
}
function bgDrawGround(ctx, B) {
  const now = G.gameTime;
  for (const x of B.totems || []) if (x.until > now) { const [sx, sy] = w2s(x.x, x.y); if (x.kind === 'earthbind') { const r = Math.max(6, 10 * bgPpy()); ctx.strokeStyle = BG_TEAM_COL[x.team] + '88'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.3); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#c9a46a'; ctx.fillRect(sx - 2, sy - 6, 4, 8); }
  for (const x of B.traps || []) if (x.until > now && x.team === B.side) { const [sx, sy] = w2s(x.x, x.y); ctx.strokeStyle = '#7fd8ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 6.3); ctx.stroke(); }
}
/* pixels per yard on the map now */
function bgPpy() { const m = G.map; if (!m) return 1; const [W] = mapSize(m); return G.scale * W / Math.max(1, m.yl - m.yr); }
