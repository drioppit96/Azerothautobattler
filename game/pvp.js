'use strict';
/* pvp.js - the honor system and the battlegrounds.

   Honor: every honorable kill (an enemy player of a level that is not grey to you, killed near you) gives honor, a
   battleground gives bonus honor at the end (more for a win). Honor is two things here:
     - lifetime honor: decides the rank (Private / Scout ... Grand Marshal / High Warlord) - it never goes down
     - honor points: spent at the honor vendors (the officers' quartermasters in Stormwind and Orgrimmar) on the
       rank gear of the database - an item also needs its rank, like the game.
   Battlegrounds: Warsong Gulch (10 v 10, capture the flag 3 times), Arathi Basin (15 v 15, 5 bases, first to 2000
   resources) and Alterac Valley (40 v 40, take the graveyards down the valley and kill the enemy general). Queue
   from the PvP window (H); a group queues together. The other players are simulated: their level, health and
   damage follow your own character at their level, healers heal, casters and hunters fight from range. Your
   characters fight in it with their own health and damage. Leaving early (Leave) gives no bonus honor. */

const PVP_RANKS = {
  Alliance: ['Private', 'Corporal', 'Sergeant', 'Master Sergeant', 'Sergeant Major', 'Knight', 'Knight-Lieutenant', 'Knight-Captain', 'Knight-Champion', 'Lieutenant Commander', 'Commander', 'Marshal', 'Field Marshal', 'Grand Marshal'],
  Horde: ['Scout', 'Grunt', 'Sergeant', 'Senior Sergeant', 'First Sergeant', 'Stone Guard', 'Blood Guard', 'Legionnaire', 'Centurion', 'Champion', 'Lieutenant General', 'General', 'Warlord', 'High Warlord'],
};
/* lifetime honor for ranks 1 .. 14 (it never decays) */
const PVP_RANK_HONOR = [0, 300, 1200, 2700, 4800, 7500, 10800, 14700, 19200, 24300, 30000, 36300, 43200, 50700, 58800];
/* the honor vendors (database vendors selling rank gear): per side */
const HONOR_VENDORS = { Alliance: [12777, 12781, 12782, 12783, 12805], Horde: [12792, 12793, 14581, 12796, 12799] };
const BG_TEAM_COL = { Alliance: '#4f8dff', Horde: '#e0453a' };
const BG_RES = 30;                // seconds between resurrection waves
const BG_SPEED = 7;

const BGS = {
  wsg: { key: 'wsg', name: 'Warsong Gulch', map: 489, minL: 10, size: 10, time: 1200,
    text: 'Capture the enemy flag and bring it home 3 times. 10 against 10, from level 10.',
    base: { Alliance: [1525, 1500], Horde: [930, 1420] }, gy: { Alliance: [1430, 1540], Horde: [1030, 1390] },
    flag: { Alliance: [1540.4, 1481.3], Horde: [916.5, 1433.8] }, mid: [1228, 1458] },
  ab: { key: 'ab', name: 'Arathi Basin', map: 529, minL: 20, size: 15, time: 1800,
    text: 'Take and hold the Stables, Blacksmith, Farm, Gold Mine and Lumber Mill: the first to 2000 resources wins. 15 against 15, from level 20.',
    base: { Alliance: [1270, 1290], Horde: [720, 720] }, gy: { Alliance: [1270, 1290], Horde: [720, 720] },
    nodes: [['Stables', 1166.8, 1200.1], ['Blacksmith', 977.0, 1046.6], ['Farm', 806.2, 874.3], ['Gold Mine', 1146.9, 848.2], ['Lumber Mill', 856.1, 1148.9]] },
  av: { key: 'av', name: 'Alterac Valley', map: 30, minL: 51, size: 40, time: 2700,
    text: 'Push down the valley, take the graveyards and kill the enemy general (or run them out of reinforcements). 40 against 40, from level 51.',
    base: { Alliance: [730, -40], Horde: [-1365, -250] }, gy: { Alliance: [730, -40], Horde: [-1365, -250] },
    // the graveyards down the valley, from the Horde end to the Alliance end, and who holds them at the start
    lane: [['Frostwolf Relief Hut', -1402.2, -307.5, 'Horde'], ['Frostwolf Graveyard', -1082.5, -346.6, 'Horde'], ['Iceblood Graveyard', -612.7, -396.7, 'Horde'],
      ['Snowfall Graveyard', -202.6, -112.6, null], ['Stonehearth Graveyard', 77.8, -404.7, 'Alliance'], ['Stormpike Graveyard', 669.3, -294.1, 'Alliance'], ['Stormpike Aid Station', 638.6, -32.2, 'Alliance']],
    general: { Alliance: ['Vanndar Stormpike', 722.4, -11.0], Horde: ["Drek'Thar", -1370.9, -219.8] } },
};
const PVP_BG_MAPS = new Set([489, 529, 30]);
function isBgMap(id) { return PVP_BG_MAPS.has(id); }
function pvpSide(c) { return charSide(c) === 'H' ? 'Horde' : 'Alliance'; }
const BOT_NAMES = { a: ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hal', 'Ir', 'Jor', 'Kae', 'Lor', 'Mal', 'Ner', 'Or', 'Pel', 'Quin', 'Ral', 'Syl', 'Tor', 'Ul', 'Vor', 'Wyn', 'Xan', 'Yr', 'Zar', 'Gro', 'Mok', 'Thu', 'Rak'],
  b: ['an', 'dor', 'eth', 'ias', 'ion', 'ok', 'ra', 'ric', 'sa', 'thas', 'ul', 'wen', 'zul', 'gar', 'nash', 'mir', 'dra', 'lia', 'vek', 'rok'] };

/* ------------------------------------------------------------------ honor and ranks */
function pvpOf(c) { if (!c.pvp) c.pvp = { honor: 0, life: 0, hks: 0, deaths: 0, played: 0, won: 0, hist: [] }; return c.pvp; }
function pvpRank(c) { const life = pvpOf(c).life; let r = 0; for (let i = 1; i < PVP_RANK_HONOR.length; i++) if (life >= PVP_RANK_HONOR[i]) r = i; return r; }
function pvpRankName(c, r) { r = r == null ? pvpRank(c) : r; return r ? PVP_RANKS[pvpSide(c)][r - 1] : 'No rank'; }
function hkHonor(victimLevel, myLevel) {
  if (victimLevel <= grayLevel(myLevel)) return 0;
  return Math.max(1, Math.round((4 + 16 * victimLevel / 60) * Math.min(1.2, victimLevel / Math.max(1, myLevel))));
}
function pvpGain(c, honor, why) {
  if (!honor) return; const P = pvpOf(c); const r0 = pvpRank(c);
  P.honor += honor; P.life += honor;
  const r1 = pvpRank(c);
  if (r1 > r0) { G.logCtx = c; log(c.name + ' reached rank ' + r1 + ': ' + pvpRankName(c, r1) + '!'); G.logCtx = null; if (isActive(c)) fx(c.pos.x, c.pos.y, pvpRankName(c, r1), '#ffd866'); }
}

/* ------------------------------------------------------------------ queues */
function bgBracket(c, bg) { if (bg.minL >= 51) return [51, 60]; const lo = Math.max(bg.minL, Math.floor(c.level / 10) * 10); return [lo, lo >= 60 ? 60 : lo + 9]; }
function bgCanJoin(c, bg) {
  if (c.level < bg.minL) return 'needs level ' + bg.minL;
  const r = rt(c); if (r.bg) return 'in a battleground';
  if (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map)) return 'in a dungeon';
  if (typeof groupOf === 'function' && groupOf(c) && !isLeader(c)) return 'the group leader queues';
  return null;
}
function bgQueue(c, key) {
  const bg = BGS[key]; const why = bgCanJoin(c, bg); if (why) { log('Cannot join ' + bg.name + ': ' + why + '.'); return false; }
  const g = typeof groupOf === 'function' ? groupOf(c) : null; const who = g ? groupChars(g) : [c];
  const pop = G.gameTime + 20 + Math.random() * 40 + (bg.size >= 40 ? 30 : 0);
  for (const x of who) { if (x.level < bg.minL) continue; pvpOf(x).q = { bg: key, pop, lead: c.id, t0: G.gameTime }; }
  log((who.length > 1 ? 'The group is' : c.name + ' is') + ' in the queue for ' + bg.name + '.'); save(); return true;
}
function bgLeaveQueue(c) { const g = typeof groupOf === 'function' ? groupOf(c) : null; for (const x of g ? groupChars(g) : [c]) if (x.pvp) delete x.pvp.q; log('Left the queue.'); save(); }
/* every step of a character (combat.js updateChar): the queue pops */
function pvpQueueStep(c) {
  const q = c.pvp && c.pvp.q; if (!q) return false; const r = rt(c);
  if (G.gameTime < q.pop || q.lead !== c.id) return false;
  if (r.ghost || r.flying || r.riding || (r.threats || []).length || r.cast) return false;
  const g = typeof groupOf === 'function' ? groupOf(c) : null;
  const who = (g ? groupChars(g) : [c]).filter((x) => x.pvp && x.pvp.q && x.pvp.q.lead === c.id && !rt(x).bg);
  for (const x of who) delete x.pvp.q;
  bgStart(q.bg, who); return true;
}

/* ------------------------------------------------------------------ a battleground */
function bgName(side) { const a = BOT_NAMES.a, b = BOT_NAMES.b; return a[(Math.random() * a.length) | 0] + b[(Math.random() * b.length) | 0]; }
function bgPick(list) { return list[(Math.random() * list.length) | 0]; }
function bgSides(side) { return [side, side === 'Alliance' ? 'Horde' : 'Alliance']; }
const BG_RACES = { Alliance: [1, 3, 4, 7], Horde: [2, 5, 6, 8] };
function bgUnitFromChar(c, team) {
  const s = charStats(c); const heal = typeof grpRole === 'function' && groupOf(c) && grpRole(c) === 'healer';
  const dps = Math.max(5, (typeof classDps === 'function' ? classDps(c, s, 0.25) : s.mhDps) * 0.9);
  return { id: c.id, c, name: c.name, team, cls: c.cls, race: c.race, level: c.level, maxhp: s.maxHp, hp: s.maxHp, dps, heal: heal ? dps * 1.1 : 0,
    ranged: [3, 5, 8, 9].includes(c.cls) || heal, alive: true, x: 0, y: 0, kills: 0, deaths: 0, hks: 0, honor: 0, dmg: 0, hit: new Set() };
}
function bgBot(B, team, ref) {
  const lo = B.bracket[0], hi = B.bracket[1]; const L = Math.max(lo, Math.min(hi, Math.round(lo + Math.pow(Math.random(), 0.6) * (hi - lo))));
  let race, cls; for (let k = 0; k < 30; k++) { race = bgPick(BG_RACES[team]); cls = bgPick([1, 2, 3, 4, 5, 7, 8, 9, 11]); if (raceClassOk(race, cls)) break; }
  const k = Math.pow(L / Math.max(1, ref.level), 1.5);
  const hpM = cls === 1 || cls === 2 ? 1.25 : [5, 8, 9].includes(cls) ? 0.85 : 1, dmM = cls === 4 || cls === 8 || cls === 9 ? 1.15 : cls === 2 || cls === 5 ? 0.85 : 1;
  const maxhp = Math.round(ref.maxhp * k * hpM * rnd(0.85, 1.15)); const dps = ref.dps * k * dmM * rnd(0.85, 1.15);
  const healer = [2, 5, 7, 11].includes(cls) && Math.random() < 0.45;
  return { id: 'b' + (B.nid++), name: bgName(team), team, cls, race, level: L, maxhp, hp: maxhp, dps: healer ? dps * 0.45 : dps, heal: healer ? dps * 1.1 : 0,
    ranged: [3, 5, 8, 9].includes(cls) || healer, alive: true, x: 0, y: 0, kills: 0, deaths: 0, hks: 0, honor: 0, dmg: 0, hit: new Set() };
}
function bgStart(key, chars) {
  const def = BGS[key]; const c0 = chars[0]; const [mine, theirs] = bgSides(pvpSide(c0));
  const B = { id: 'bg' + Math.round(G.gameTime * 100), key, def, map: def.map, t0: G.gameTime, side: mine, units: [], nid: 1, over: null, logs: [], bracket: bgBracket(c0, def) };
  // your characters, then the rest of both teams
  for (const c of chars) B.units.push(bgUnitFromChar(c, mine));
  const ref = B.units[0];
  while (B.units.filter((u) => u.team === mine).length < def.size) B.units.push(bgBot(B, mine, ref));
  while (B.units.filter((u) => u.team === theirs).length < def.size) B.units.push(bgBot(B, theirs, ref));
  B.units.forEach((u, i) => { u.role = bgRole(B, u, i); const p = bgSpawnPoint(B, u.team); u.x = p[0] + rnd(-6, 6); u.y = p[1] + rnd(-6, 6); u.jx = rnd(-14, 14); u.jy = rnd(-14, 14); });
  if (key === 'wsg') { B.score = { Alliance: 0, Horde: 0 }; B.flag = { Alliance: { carrier: null }, Horde: { carrier: null } }; }
  if (key === 'ab') { B.res = { Alliance: 0, Horde: 0 }; B.nodes = def.nodes.map(([n, x, y]) => ({ n, x, y, owner: null, capT: 0, capTeam: null })); B.resT = 0; }
  if (key === 'av') {
    B.reinf = { Alliance: 400, Horde: 400 }; B.gys = def.lane.map(([n, x, y, o]) => ({ n, x, y, owner: o, capT: 0, capTeam: null }));
    for (const t of [mine, theirs]) { const [n, x, y] = def.general[t]; const ex = B.units.filter((u) => u.team === t && !u.c); const avgHp = ex.reduce((a, u) => a + u.maxhp, 0) / Math.max(1, ex.length), avgD = ex.reduce((a, u) => a + u.dps, 0) / Math.max(1, ex.length);
      B.units.push({ id: 'gen' + t, name: n, team: t, general: true, cls: 1, level: 62, maxhp: Math.round(avgHp * 30), hp: Math.round(avgHp * 30), dps: avgD * 6, heal: 0, ranged: false, alive: true, x, y, hx: x, hy: y, kills: 0, deaths: 0, hks: 0, honor: 0, dmg: 0, hit: new Set() }); }
  }
  G.bgs = G.bgs || []; G.bgs.push(B);
  for (const c of chars) {
    const r = rt(c); const u = B.units.find((x) => x.c === c);
    c.bgReturn = { map: c.pos.map, x: c.pos.x, y: c.pos.y, z: c.pos.z }; c.bgResume = c.order && c.order.type !== 'bg' ? c.order : null;
    r.mv = null; r.tgt = null; r.threats = []; r.cast = null; r.resting = false; r.mounted = null; r.party = null; r.interact = null;
    c.order = { type: 'bg', label: def.name }; r.bg = B; c.pos = { map: def.map, x: u.x, y: u.y, z: 0, o: 0 };
    G.logCtx = c; log('Entered ' + def.name + ' (' + B.bracket[0] + '-' + B.bracket[1] + ', ' + def.size + ' against ' + def.size + ').'); G.logCtx = null;
  }
  if (chars.some(isActive) && !G.headless && typeof goToCharacter === 'function') goToCharacter();
  save(); if (typeof renderOrder === 'function') renderOrder();
}
function bgRole(B, u, i) {
  if (u.general) return 'general';
  if (B.key === 'wsg') { if (u.c) { const x = Math.random(); return x < 0.5 ? 'offense' : x < 0.8 ? 'mid' : 'defense'; } const k = i % 10; return k < 3 ? 'offense' : k < 6 ? 'defense' : 'mid'; }
  return 'push';
}
function bgSpawnPoint(B, team) {
  if (B.key === 'ab') { const own = B.nodes ? B.nodes.filter((n) => n.owner === team) : []; if (own.length) { const b = B.def.base[team]; const n = own.sort((a, c) => Math.hypot(a.x - b[0], a.y - b[1]) - Math.hypot(c.x - b[0], c.y - b[1]))[0]; return [n.x, n.y]; } }
  if (B.key === 'av' && B.gys) {
    const own = B.gys.filter((g) => g.owner === team); if (own.length) { const fwd = team === 'Alliance' ? own[0] : own[own.length - 1]; return [fwd.x, fwd.y]; }
  }
  return B.def.gy[team];
}
/* ------------------------------------------------------------------ the simulation (worldTick) */
function bgTick(dt) {
  if (!G.bgs || !G.bgs.length) return;
  for (const B of G.bgs.slice()) bgStep(B, dt);
}
function bgEnemies(B, u) { return B.units.filter((x) => x.alive && x.team !== u.team); }
function bgStep(B, dt) {
  const now = G.gameTime; const T = now - B.t0;
  if (B.over) { if (now - B.over.t > 12) bgEnd(B); return; }
  // resurrection waves
  for (const u of B.units) if (!u.alive && !u.general && now >= u.resAt) { u.alive = true; u.hp = u.maxhp; const p = bgSpawnPoint(B, u.team); u.x = p[0] + rnd(-5, 5); u.y = p[1] + rnd(-5, 5); u.tgt = null; u.hit = new Set(); }
  const alive = B.units.filter((u) => u.alive);
  for (const u of alive) if (u.alive) bgUnitStep(B, u, dt, alive);
  bgObjectives(B, dt, T);
  // your characters: where their fighter is
  for (const u of B.units) if (u.c) {
    const c = u.c; c.pos.x = u.x; c.pos.y = u.y; c.pos.map = B.map;
    const mx = charStats(c).maxHp; c.hp = Math.max(0, u.alive ? u.hp / u.maxhp * mx : 0);
  }
  if (!B.over && T > B.def.time) bgFinish(B, bgTimeWinner(B), 'time is up');
}
function bgUnitStep(B, u, dt, alive) {
  if (u.general) {          // stays at home and fights whoever comes
    const e = alive.filter((x) => x.alive && x.team !== u.team && Math.hypot(x.x - u.x, x.y - u.y) < 25).sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
    if (e) { if (Math.hypot(e.x - u.x, e.y - u.y) > 5) bgMove(u, e.x, e.y, dt, 5); else bgHit(B, u, e, u.dps * dt); }
    else bgMove(u, u.hx, u.hy, dt, 1);
    return;
  }
  // healers: someone of the team hurt near them
  if (u.heal) {
    const h = alive.filter((x) => x.alive && x.team === u.team && !x.general && x.hp < x.maxhp * 0.75 && Math.hypot(x.x - u.x, x.y - u.y) < 35).sort((a, b) => a.hp / a.maxhp - b.hp / b.maxhp)[0];
    if (h) { if (Math.hypot(h.x - u.x, h.y - u.y) > 28) bgMove(u, h.x, h.y, dt, 26); else h.hp = Math.min(h.maxhp, h.hp + u.heal * dt * rnd(0.7, 1.3)); return; }
  }
  // a target: keep the one it has, the enemy flag carrier first, else the nearest
  let t = u.tgt && u.tgt.alive && Math.hypot(u.tgt.x - u.x, u.tgt.y - u.y) < 45 ? u.tgt : null;
  if (!t) {
    let best = null, bd = 34;
    for (const x of alive) { if (!x.alive || x.team === u.team || x.general) continue; const d = Math.hypot(x.x - u.x, x.y - u.y) - (x.carry ? 25 : 0); if (d < bd) { bd = d; best = x; } }
    t = best; u.tgt = t;
  }
  if (u.carry && t && Math.hypot(t.x - u.x, t.y - u.y) > 8) t = null;          // the flag carrier keeps running
  if (t) {
    const d = Math.hypot(t.x - u.x, t.y - u.y); const range = u.ranged ? 26 : 4;
    if (d > range) bgMove(u, t.x, t.y, dt, range - 1); else bgHit(B, u, t, u.dps * dt * rnd(0.7, 1.3));
    return;
  }
  const g = bgGoal(B, u); if (g) bgMove(u, g[0] + (g[2] ? 0 : u.jx), g[1] + (g[2] ? 0 : u.jy), dt, 1);
}
function bgMove(u, x, y, dt, stop) { const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy); if (d <= stop) return; const s = Math.min(d - stop, BG_SPEED * (u.carry ? 1.25 : 1) * dt); /* a flag carrier runs a bit faster */ u.x += dx / d * s; u.y += dy / d * s; }
function bgHit(B, u, t, v) {
  if (!t.alive || !u.alive) return;          // died earlier in this same step
  if (t.carry) v *= 0.6;          // carriers are the toughest and get healed most
  t.hp -= v; u.dmg += v; t.hit.add(u.id);
  if (u.c && isActive(u.c) && Math.random() < 0.06) fx(t.x, t.y, '' + Math.round(v * 20), '#fff');
  if (t.hp <= 0) bgDie(B, t, u);
}
function bgDie(B, t, killer) {
  t.alive = false; t.hp = 0; t.deaths++; t.tgt = null; killer.kills++;
  const now = G.gameTime; t.resAt = B.t0 + Math.ceil((now - B.t0 + 5) / BG_RES) * BG_RES;
  if (t.carry) { const f = B.flag[t.carry]; f.carrier = null; t.carry = null; bgNote(B, t.team + ' dropped the flag - it returns.'); }
  if (B.key === 'av' && !t.general && B.reinf) { B.reinf[t.team] = Math.max(0, B.reinf[t.team] - 1); if (B.reinf[t.team] <= 0) bgFinish(B, t.team === 'Alliance' ? 'Horde' : 'Alliance', 'out of reinforcements'); }
  if (t.general) { bgNote(B, t.name + ' is dead!'); bgFinish(B, t.team === 'Alliance' ? 'Horde' : 'Alliance', t.name + ' was killed'); return; }
  // honorable kill: everyone of the other team near it or who hit it; the honor is shared among them (like the game)
  const cred = B.units.filter((u) => u.team !== t.team && !u.general && (t.hit.has(u.id) || (u.alive && Math.hypot(u.x - t.x, u.y - t.y) < 40)));
  const share = 1 / Math.max(1, cred.length / 2);
  for (const u of cred) {
    if (!u.c) continue;
    const h = Math.round(hkHonor(t.level, u.c.level) * share); if (!h) { pvpOf(u.c).hks++; u.hks++; continue; }
    u.hks++; u.honor += h; pvpOf(u.c).hks++; pvpGain(u.c, h);
    if (isActive(u.c)) fx(t.x, t.y, 'Honorable kill +' + h, '#ffd866');
  }
  if (t.c) { pvpOf(t.c).deaths++; G.logCtx = t.c; log(t.c.name + ' was killed by ' + killer.name + ' - back in the next wave.'); G.logCtx = null; }
}
function bgNote(B, s) { B.logs.unshift([G.gameTime, s]); if (B.logs.length > 8) B.logs.pop(); for (const u of B.units) if (u.c) { G.logCtx = u.c; log(B.def.name + ': ' + s); G.logCtx = null; } }

/* where a fighter goes when nobody is in reach */
function bgGoal(B, u) {
  const def = B.def; const foe = u.team === 'Alliance' ? 'Horde' : 'Alliance';
  if (B.key === 'wsg') {
    const myFlag = def.flag[u.team], theirFlag = def.flag[foe];
    if (u.carry) return [myFlag[0], myFlag[1], true];
    const enemyCarrier = B.units.find((x) => x.alive && x.carry === u.team);
    if (enemyCarrier && (u.role !== 'offense' || Math.hypot(enemyCarrier.x - u.x, enemyCarrier.y - u.y) < 120)) { u.tgt = enemyCarrier; return [enemyCarrier.x, enemyCarrier.y, true]; }
    if (u.role === 'offense') { const mate = B.units.find((x) => x.alive && x.carry === foe); return mate ? [mate.x, mate.y] : [theirFlag[0], theirFlag[1], true]; }
    if (u.role === 'defense') return [myFlag[0], myFlag[1]];
    return def.mid;
  }
  if (B.key === 'ab') {
    if (!u.node || G.gameTime > (u.nodeT || 0)) { u.nodeT = G.gameTime + 20 + Math.random() * 15; u.node = bgPickNode(B, u); }
    return [u.node.x, u.node.y];
  }
  if (B.key === 'av') {
    const L = B.gys; const order = u.team === 'Alliance' ? L.slice().reverse() : L.slice();          // from my end towards theirs
    const next = order.find((g) => g.owner !== u.team);
    if (next) return [next.x, next.y];
    const gen = B.units.find((x) => x.general && x.team === foe); if (gen && gen.alive) { u.tgt = gen; return [gen.x, gen.y, true]; }
    return def.base[foe];
  }
  return null;
}
function bgPickNode(B, u) {
  const b = B.def.base[u.team]; let best = null, bs = 1e9;
  for (const n of B.nodes) {
    const mine = n.owner === u.team; const guards = B.units.filter((x) => x.alive && x.team === u.team && x.node === n).length;
    const s = Math.hypot(n.x - b[0], n.y - b[1]) * 0.5 + (mine ? (guards >= 3 ? 600 : 150) : 0) + guards * 40 + Math.random() * 150;
    if (s < bs) { bs = s; best = n; }
  }
  return best;
}
/* flags, bases, graveyards; the score */
function bgObjectives(B, dt, T) {
  const def = B.def;
  if (B.key === 'wsg') {
    for (const team of ['Alliance', 'Horde']) {
      const foe = team === 'Alliance' ? 'Horde' : 'Alliance'; const ff = def.flag[foe], mine = def.flag[team];
      // taking the enemy flag (nobody of theirs guarding right next to it)
      if (!B.flag[foe].carrier) { const u = B.units.find((x) => x.alive && x.team === team && !x.carry && x.role === 'offense' && Math.hypot(x.x - ff[0], x.y - ff[1]) < 5); if (u) { u.carry = foe; B.flag[foe].carrier = u.id; bgNote(B, u.name + ' (' + team + ') took the ' + foe + ' flag!'); } }
      // bringing it home while the own flag is there
      const car = B.units.find((x) => x.alive && x.carry === foe && x.team === team);
      if (car && !B.flag[team].carrier && Math.hypot(car.x - mine[0], car.y - mine[1]) < 6) {
        car.carry = null; B.flag[foe].carrier = null; B.score[team]++; bgNote(B, car.name + ' captured the ' + foe + ' flag! ' + team + ' ' + B.score[team] + ' : ' + B.score[foe]);
        for (const u of B.units) if (u.c && u.team === team) pvpGain(u.c, Math.round(bgHonorScale(u.c) * 40));
        if (B.score[team] >= 3) bgFinish(B, team, '3 captures');
      }
    }
  }
  if (B.key === 'ab' || B.key === 'av') {
    const pts = B.key === 'ab' ? B.nodes : B.gys;
    for (const n of pts) {
      const near = B.units.filter((u) => u.alive && !u.general && Math.hypot(u.x - n.x, u.y - n.y) < 14);
      const teams = new Set(near.map((u) => u.team));
      if (teams.size === 1) { const t = [...teams][0]; if (n.owner !== t) { if (n.capTeam !== t) { n.capTeam = t; n.capT = 0; } n.capT += dt; if (n.capT >= (B.key === 'ab' ? 12 : 15)) { n.owner = t; n.capT = 0; n.capTeam = null; bgNote(B, t + ' took the ' + n.n + '.'); for (const u of near) if (u.c) pvpGain(u.c, Math.round(bgHonorScale(u.c) * 20)); } } }
      else if (teams.size !== 1) { n.capT = 0; n.capTeam = null; }
    }
  }
  if (B.key === 'ab') {
    B.resT += dt; if (B.resT >= 1) { B.resT -= 1; const RATE = [0, 0.8, 1.1, 1.7, 3.3, 10];
      for (const t of ['Alliance', 'Horde']) { const k = B.nodes.filter((n) => n.owner === t).length; B.res[t] = Math.min(2000, B.res[t] + RATE[k] * 2); if (B.res[t] >= 2000 && !B.over) bgFinish(B, t, '2000 resources'); } }
  }
}
function bgTimeWinner(B) {
  if (B.key === 'wsg') return B.score.Alliance === B.score.Horde ? null : B.score.Alliance > B.score.Horde ? 'Alliance' : 'Horde';
  if (B.key === 'ab') return B.res.Alliance === B.res.Horde ? null : B.res.Alliance > B.res.Horde ? 'Alliance' : 'Horde';
  if (B.key === 'av') return B.reinf.Alliance === B.reinf.Horde ? null : B.reinf.Alliance > B.reinf.Horde ? 'Alliance' : 'Horde';
  return null;
}
function bgHonorScale(c) { return Math.max(0.15, Math.min(1, c.level / 60)); }
function bgFinish(B, winner, why) {
  if (B.over) return; B.over = { winner, t: G.gameTime, why };
  bgNote(B, (winner ? winner + ' wins' : 'A draw') + ' (' + why + ').');
  for (const u of B.units) {
    if (!u.c) continue; const c = u.c; const P = pvpOf(c); const won = winner === u.team;
    const base = { wsg: [360, 120], ab: [450, 150], av: [700, 250] }[B.key];
    const extra = B.key === 'ab' ? Math.floor(B.res[u.team] / 330) * 30 : B.key === 'av' ? B.gys.filter((g) => g.owner === u.team).length * 25 : B.score[u.team] * 30;
    const bonus = Math.round(bgHonorScale(c) * ((won ? base[0] : base[1]) + extra));
    pvpGain(c, bonus); u.honor += bonus; P.played++; if (won) P.won++;
    P.hist.unshift({ bg: B.key, won, draw: !winner, hks: u.hks, deaths: u.deaths, honor: u.honor, t: Date.now() }); P.hist = P.hist.slice(0, 15);
    G.logCtx = c; log(B.def.name + ': ' + (winner ? (won ? 'Victory!' : 'Defeat.') : 'Draw.') + ' ' + u.hks + ' honorable kills, ' + u.deaths + ' deaths, +' + u.honor + ' honor (rank: ' + pvpRankName(c) + ').'); G.logCtx = null;
  }
  save();
}
/* back to where they were (after the result, or Leave) */
function bgEnd(B) {
  for (const u of B.units) if (u.c) bgLeaveChar(u.c, false);
  G.bgs = (G.bgs || []).filter((x) => x !== B);
}
function bgLeaveChar(c, early) {
  const r = rt(c); const B = r.bg; r.bg = null; r.tgt = null; r.threats = []; r.mv = null;
  const back = c.bgReturn; delete c.bgReturn;
  if (back) c.pos = { map: back.map, x: back.x, y: back.y, z: back.z || 0, o: c.pos.o };
  c.hp = charStats(c).maxHp; if (usesMana(c)) c.mana = charStats(c).maxMana;
  c.order = c.bgResume || null; delete c.bgResume; if (c.order && typeof resumeOrder === 'function') resumeOrder(c, c.order);
  if (early && B) { const u = B.units.find((x) => x.c === c); if (u) { u.c = null; u.name += ' (left)'; } G.logCtx = c; log('Left ' + B.def.name + ' early - no bonus honor.'); G.logCtx = null; if (!B.units.some((x) => x.c)) G.bgs = G.bgs.filter((x) => x !== B); }
  if (typeof loadGrid === 'function') loadGrid(c.pos.map);
  if (isActive(c) && !G.headless && typeof goToCharacter === 'function') goToCharacter();
  save(); renderOrder();
}
function bgLeave(c) { const g = typeof groupOf === 'function' ? groupOf(c) : null; for (const x of g ? groupChars(g) : [c]) if (rt(x).bg) bgLeaveChar(x, true); }
/* a game loaded in the middle of a battleground: back out */
function pvpMigrate(c) { if (c.bgReturn && !rt(c).bg) { const b = c.bgReturn; c.pos = { map: b.map, x: b.x, y: b.y, z: b.z || 0, o: 0 }; c.order = c.bgResume || null; delete c.bgReturn; delete c.bgResume; } if (c.pvp) delete c.pvp.q; }
function bgOrderText(c) {
  const B = rt(c).bg; if (!B) return { t: 'Battleground', d: '' };
  return { t: B.def.name, d: bgScoreText(B) + ' - ' + fmtTime(G.gameTime - B.t0) };
}
function bgScoreText(B) {
  if (B.key === 'wsg') return 'flags ' + B.score.Alliance + ' : ' + B.score.Horde + ' (Alliance : Horde)';
  if (B.key === 'ab') return 'Alliance ' + Math.round(B.res.Alliance) + ' (' + B.nodes.filter((n) => n.owner === 'Alliance').length + ' bases) : Horde ' + Math.round(B.res.Horde) + ' (' + B.nodes.filter((n) => n.owner === 'Horde').length + ')';
  if (B.key === 'av') return 'reinforcements Alliance ' + B.reinf.Alliance + ' : Horde ' + B.reinf.Horde;
  return '';
}

/* ------------------------------------------------------------------ the map */
function bgMapDefs() { if (!G.bgMapDefs) G.bgMapDefs = DATA.maps.filter((m) => isBgMap(m.map)); return G.bgMapDefs; }
function bgMapFor(pos) { return isBgMap(pos.map) ? bgMapDefs().find((m) => m.map === pos.map) || null : null; }
function bgDraw(ctx, m) {
  if (!G.bgs || !isBgMap(m.map)) return; const B = G.bgs.find((x) => x.map === m.map); if (!B) return;
  ctx.save(); ctx.textAlign = 'center';
  const ring = (x, y, r, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w || 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.stroke(); };
  // objectives
  if (B.key === 'wsg') for (const t of ['Alliance', 'Horde']) { const f = B.def.flag[t]; const [x, y] = w2s(f[0], f[1]); bgFlagIcon(ctx, x, y, BG_TEAM_COL[t], !B.flag[t].carrier); }
  const pts = B.key === 'ab' ? B.nodes : B.key === 'av' ? B.gys : [];
  ctx.font = 'bold 10px Segoe UI';
  for (const n of pts) {
    const [x, y] = w2s(n.x, n.y); const col = n.owner ? BG_TEAM_COL[n.owner] : '#bbb';
    ctx.fillStyle = '#000a'; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.3); ctx.fill(); ring(x, y, 9, col, 3);
    if (n.capTeam) { ctx.strokeStyle = BG_TEAM_COL[n.capTeam]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 13, -1.57, -1.57 + 6.283 * n.capT / (B.key === 'ab' ? 12 : 15)); ctx.stroke(); }
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.strokeText(n.n, x, y - 13); ctx.fillText(n.n, x, y - 13);
  }
  // the fighters (your own characters are drawn by the map itself)
  for (const u of B.units) {
    if (!u.alive || (u.c && G.state.characters.includes(u.c))) continue;
    const [x, y] = w2s(u.x, u.y); const R = u.general ? 10 : 6;
    if (!drawClassIcon(ctx, u.cls, x, y, R)) { ctx.fillStyle = BG_TEAM_COL[u.team]; ctx.beginPath(); ctx.arc(x, y, R, 0, 6.3); ctx.fill(); }
    ring(x, y, R + 1.5, BG_TEAM_COL[u.team], u.general ? 3 : 2);
    ctx.fillStyle = '#000'; ctx.fillRect(x - 8, y - R - 6, 16, 3); ctx.fillStyle = '#3fae5a'; ctx.fillRect(x - 8, y - R - 6, 16 * u.hp / u.maxhp, 3);
    if (u.carry) bgFlagIcon(ctx, x + 7, y - 9, BG_TEAM_COL[u.carry], true, 0.7);
  }
  for (const u of B.units) if (u.c && u.carry && u.alive) { const [x, y] = w2s(u.x, u.y); bgFlagIcon(ctx, x + 9, y - 12, BG_TEAM_COL[u.carry], true, 0.7); }
  ctx.restore();
}
function bgFlagIcon(ctx, x, y, col, up, k) {
  k = k || 1; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + 9 * k); ctx.lineTo(x, y - 9 * k); ctx.stroke();
  ctx.globalAlpha = up ? 1 : 0.35; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 9 * k); ctx.lineTo(x + 10 * k, y - 5 * k); ctx.lineTo(x, y - 1 * k); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ the battleground card (right side) */
function renderBgCard() {
  const el = $('bgCard'); if (!el) return; const c = active(); const r = rt(c); const B = r.bg; const q = c.pvp && c.pvp.q;
  if (!B && !q) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; } return; }
  el.hidden = false; let h = '';
  if (q && !B) { const bg = BGS[q.bg]; h = '<h3>PvP</h3><div class="small">In the queue for <b>' + esc(bg.name) + '</b> (' + fmtTime(G.gameTime - q.t0) + ')</div><button class="mini" data-bgq="leave">Leave queue</button>'; }
  else {
    const me = B.units.find((u) => u.c === c);
    h = '<h3>' + esc(B.def.name) + ' <span class="small muted">' + fmtTime(G.gameTime - B.t0) + '</span></h3><div class="small">' + esc(bgScoreText(B)) + '</div>';
    if (B.over) h += '<div class="bgres ' + (B.over.winner === B.side ? 'won' : 'lost') + '">' + (B.over.winner ? (B.over.winner === B.side ? 'Victory!' : 'Defeat') : 'Draw') + '</div>';
    if (me) h += '<div class="small">You: ' + me.hks + ' honorable kills, ' + me.deaths + ' deaths, +' + me.honor + ' honor' + (me.alive ? '' : ' - <span style="color:#ff6a5a">dead, back in ' + Math.ceil(Math.max(0, me.resAt - G.gameTime)) + 's</span>') + '</div>';
    h += '<div class="bglog">' + B.logs.slice(0, 4).map(([t, s]) => '<div class="small muted">' + fmtTime(t - B.t0) + ' ' + esc(s) + '</div>').join('') + '</div>';
    if (!B.over) h += '<button class="mini red" data-bgq="out">Leave battleground</button>';
  }
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
  el.onclick = (e) => { const b = e.target.closest('[data-bgq]'); if (!b) return; if (b.dataset.bgq === 'leave') bgLeaveQueue(active()); else if (b.dataset.bgq === 'out') bgLeave(active()); renderBgCard(); };
}

/* ------------------------------------------------------------------ the PvP window (H): Honor, Battlegrounds, Honor vendor */
function pvpTabHtml(c, tab) {
  const P = pvpOf(c); const rank = pvpRank(c); const side = pvpSide(c);
  if (tab === 'pvp') {
    const next = PVP_RANK_HONOR[rank + 1]; const prev = PVP_RANK_HONOR[rank];
    let h = '<div class="pvp"><div class="pvphead"><div class="pvprank">' + (rank ? '<b>' + rank + '</b>' : '-') + '</div><div><div class="pvpname">' + esc(pvpRankName(c)) + '</div>' +
      '<div class="small muted">' + side + (rank ? ', rank ' + rank + ' of 14' : '') + '</div></div></div>' +
      (next != null ? '<div class="small">Next: ' + esc(PVP_RANKS[side][rank]) + ' at ' + next.toLocaleString() + ' lifetime honor</div><div class="bar xp"><i style="width:' + Math.min(100, 100 * (P.life - prev) / (next - prev)) + '%"></i></div>' : '<div class="small">The highest rank.</div>') +
      '<div class="sgroup"><h5>Honor</h5>' + statRow('Honor points (to spend)', P.honor.toLocaleString()) + statRow('Lifetime honor (rank)', P.life.toLocaleString()) + statRow('Honorable kills', P.hks.toLocaleString()) +
      statRow('Deaths', P.deaths) + statRow('Battlegrounds', P.played + ' played, ' + P.won + ' won') + '</div>' +
      '<div class="sgroup"><h5>Ranks</h5><div class="pvpranks">' + PVP_RANKS[side].map((n, i) => '<div class="' + (i + 1 === rank ? 'on' : i + 1 < rank ? 'done' : '') + '"><span>' + (i + 1) + '</span> ' + esc(n) + '<em>' + PVP_RANK_HONOR[i + 1].toLocaleString() + '</em></div>').join('') + '</div>' +
      '<div class="small muted">Ranks come from lifetime honor and never go down. Honorable kills and battlegrounds give honor.</div></div>';
    if (P.hist.length) h += '<div class="sgroup"><h5>Last battlegrounds</h5>' + P.hist.slice(0, 8).map((x) => '<div class="small">' + (x.draw ? 'Draw' : x.won ? '<span style="color:#1eff00">Won</span>' : '<span style="color:#ff6a5a">Lost</span>') + ' ' + esc(BGS[x.bg].name) + ' - ' + x.hks + ' HK, ' + x.deaths + ' deaths, +' + x.honor + ' honor</div>').join('') + '</div>';
    return h + '</div>';
  }
  if (tab === 'bgs') {
    const r = rt(c); const q = P.q; let h = '<div class="pvp">';
    if (r.bg) h += '<div class="small">In <b>' + esc(r.bg.def.name) + '</b>: ' + esc(bgScoreText(r.bg)) + ' <button class="mini red" data-bgout="1">Leave</button></div>';
    else if (q) h += '<div class="small">In the queue for <b>' + esc(BGS[q.bg].name) + '</b> (' + fmtTime(G.gameTime - q.t0) + ') <button class="mini" data-bgleaveq="1">Leave queue</button></div>';
    for (const k in BGS) {
      const bg = BGS[k]; const why = bgCanJoin(c, bg); const br = c.level >= bg.minL ? bgBracket(c, bg) : null;
      h += '<div class="bgrow"><div class="bgname">' + esc(bg.name) + ' <span class="small muted">' + bg.size + ' v ' + bg.size + (br ? ', bracket ' + br[0] + '-' + br[1] : ', from level ' + bg.minL) + '</span></div><div class="small muted">' + esc(bg.text) + '</div>' +
        (why || q ? '<div class="small muted">' + esc(why || 'already in a queue') + '</div>' : '<button class="act" data-bgjoin="' + k + '">' + (typeof groupOf === 'function' && groupOf(c) ? 'Join as group' : 'Join') + '</button>') + '</div>';
    }
    return h + '<div class="small muted">While in the queue your character keeps doing what it does; it goes in when the queue pops (not in a fight, a dungeon or a flight).</div></div>';
  }
  if (tab === 'honorv') {
    const items = honorItems(c); const v = honorVendorNear(c); const vs = honorVendorSpot(c);
    let h = '<div class="pvp"><div class="small">Honor points: <b>' + P.honor.toLocaleString() + '</b> &middot; rank ' + rank + ' (' + esc(pvpRankName(c)) + ')</div>' +
      '<div class="small muted">' + (v ? 'At ' + esc(v.name) + ' - buying is right here.' : 'The honor vendors are ' + (side === 'Alliance' ? 'in Stormwind (Champion\'s Hall)' : 'in Orgrimmar (Hall of Legends)') + ': Buy sends the character there' + (vs ? ' (' + esc(vs.name) + ')' : '') + '.') + '</div><div class="vlist">';
    for (const x of items) {
      const it = itemRow(x.id); const need = (it.rq.honor || 0) - 4; const ok = rank >= need; const can = ok && P.honor >= x.cost;
      h += '<div class="vrow" data-tip-item="' + x.id + '">' + iconHtml({ id: x.id, n: 1 }) + '<div class="vname"><span class="q' + itemQuality(x.id) + '">' + esc(itemName(x.id)) + '</span><div class="small ' + (ok ? 'muted' : '') + '"' + (ok ? '' : ' style="color:#ff6a5a"') + '>' + esc(PVP_RANKS[side][need - 1] || 'any rank') + (it.rl > 1 ? ' &middot; level ' + it.rl : '') + ' &middot; ' + x.cost.toLocaleString() + ' honor</div></div>' +
        '<button class="mini" data-hbuy="' + x.id + '"' + (can ? '' : ' disabled') + '>Buy</button></div>';
    }
    return h + '</div></div>';
  }
  return '';
}
function pvpClick(e) {
  const c = active(); const t = e.target.closest('[data-bgjoin],[data-bgleaveq],[data-bgout],[data-hbuy]'); if (!t) return false; const d = t.dataset;
  if (d.bgjoin) bgQueue(c, d.bgjoin); else if (d.bgleaveq) bgLeaveQueue(c); else if (d.bgout) bgLeave(c); else if (d.hbuy) honorBuy(c, +d.hbuy);
  renderSheet(); renderBgCard(); return true;
}

/* ------------------------------------------------------------------ the honor vendor */
function honorCost(it) { const il = it.il || 40; return Math.max(50, Math.round(il * il * (it.q >= 4 ? 1.6 : it.q === 3 ? 1 : 0.5) * 0.9 / 10) * 10); }
function honorItems(c) {
  const side = pvpSide(c); const seen = new Set(); const out = [];
  for (const e of HONOR_VENDORS[side]) for (const x of (typeof vendorItems === 'function' ? vendorItems(e) : [])) {
    if (seen.has(x.id)) continue; seen.add(x.id); const it = itemRow(x.id); if (!it || !it.rq || !it.rq.honor) continue;
    if (it.rq.classes && !it.rq.classes.includes(c.cls)) continue; if (it.rq.races && !it.rq.races.includes(c.race)) continue;
    out.push({ id: x.id, e, cost: honorCost(it), need: it.rq.honor });
  }
  return out.sort((a, b) => a.need - b.need || a.cost - b.cost);
}
function honorVendorSpot(c) { for (const e of HONOR_VENDORS[pvpSide(c)]) { const s = typeof npcSpot === 'function' ? npcSpot(e) : null; if (s) return s; } return null; }
function honorVendorNear(c) { for (const e of HONOR_VENDORS[pvpSide(c)]) { const s = typeof npcSpot === 'function' ? npcSpot(e) : null; if (s && s.map === c.pos.map && Math.hypot(s.x - c.pos.x, s.y - c.pos.y) < 20) return s; } return null; }
function honorBuy(c, id, here) {
  const it = itemRow(id); if (!it) return false; const P = pvpOf(c); const cost = honorCost(it); const need = (it.rq.honor || 0) - 4;
  if (pvpRank(c) < need) { log('Needs the rank ' + PVP_RANKS[pvpSide(c)][need - 1] + '.'); return false; }
  if (P.honor < cost) { log('Needs ' + cost + ' honor.'); return false; }
  if (!here && !honorVendorNear(c)) {
    const s = honorVendorSpot(c); if (!s) { log('No honor vendor found.'); return false; }
    const far = s.map !== c.pos.map || Math.hypot(s.x - c.pos.x, s.y - c.pos.y) > 600; const trip = far ? planTrip(c, { map: s.map, x: s.x, y: s.y }) : null;
    if (s.map !== c.pos.map && !trip) { log('No way to ' + s.name + ' found.'); return false; }
    c.order = { type: 'npc', kind: 'honor', buy: id, e: s.e, map: s.map, x: s.x, y: s.y, trip, label: s.name, resume: c.order && c.order.type !== 'npc' ? c.order : null, t0: G.gameTime };
    rt(c).mv = null; log('Order: go to ' + s.name + ' and buy ' + itemName(id) + '.'); save(); renderOrder(); return true;
  }
  if (bagFree(c) <= 0) { log('Bags are full.'); return false; }
  P.honor -= cost; addItem(c, id, 1); log('Bought ' + itemName(id) + ' for ' + cost + ' honor.'); if (typeof autoEquip === 'function') autoEquip(c); save(); if (typeof refreshGear === 'function') refreshGear(); return true;
}
/* at the honor vendor (market.js updateNpcOrder) */
function honorArrive(c, o) { honorBuy(c, o.buy, true); c.order = o.resume || null; if (c.order && typeof resumeOrder === 'function') resumeOrder(c, c.order); renderOrder(); save(); }
