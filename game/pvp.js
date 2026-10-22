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
  wsg: { key: 'wsg', name: 'Warsong Gulch', map: 489, minL: 10, size: 10, time: 1500,
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
  for (const x of who) { if (x.level < bg.minL || rt(x).bg) continue; pvpOf(x).q = { bg: key, pop, lead: c.id, t0: G.gameTime }; }
  withLogC(c, () => log((who.length > 1 ? (g.raid ? 'The raid is' : 'The group is') : c.name + ' is') + ' in the queue for ' + bg.name + '.')); save(); return true;
}
function withLogC(c, fn) { const p = G.logCtx; G.logCtx = c; try { return fn(); } finally { G.logCtx = p; } }
function bgLeaveQueue(c) { const g = typeof groupOf === 'function' ? groupOf(c) : null; for (const x of g ? groupChars(g) : [c]) if (x.pvp) delete x.pvp.q; log('Left the queue.'); save(); }
/* every step of a character (combat.js updateChar): the queue pops; auto battlegrounds queue again */
function pvpQueueStep(c) {
  const q = c.pvp && c.pvp.q; const r = rt(c);
  if (!q) { pvpAutoQueue(c); return false; }
  if (G.gameTime < q.pop || q.lead !== c.id) return false;
  if (r.ghost || r.flying || r.riding || (r.threats || []).length || r.cast) return false;
  const g = typeof groupOf === 'function' ? groupOf(c) : null;
  const who = (g ? groupChars(g) : [c]).filter((x) => x.pvp && x.pvp.q && x.pvp.q.lead === c.id && !rt(x).bg);
  for (const x of who) delete x.pvp.q;
  bgStart(q.bg, [c].concat(who.filter((x) => x !== c)).slice(0, BGS[q.bg].size)); return true;
}
/* Automation - auto battlegrounds: queue by itself (when it is the leader or alone), the chosen one or any it can */
function bgAutoKey(c) { return (c.auto && c.auto.autoBgKey) || 'any'; }
function bgAutoPick(c) {
  const ok = Object.keys(BGS).filter((k) => !bgCanJoin(c, BGS[k])); const want = bgAutoKey(c);
  if (want !== 'any') return ok.includes(want) ? want : null;
  return ok.length ? bgPick(ok) : null;
}
function pvpAutoQueue(c) {
  if (!cset(c, 'autoBg')) return; const r = rt(c); if (r.bg || G.gameTime < (r.bgAutoT || 0)) return; r.bgAutoT = G.gameTime + 5;
  if (typeof groupOf === 'function' && groupOf(c) && !isLeader(c)) return;
  if (r.ghost || r.flying || r.riding) return;
  const k = bgAutoPick(c); if (k) withLogC(c, () => bgQueue(c, k));
}

/* ------------------------------------------------------------------ a battleground */
function bgName(side) { const a = BOT_NAMES.a, b = BOT_NAMES.b; return a[(Math.random() * a.length) | 0] + b[(Math.random() * b.length) | 0]; }
function bgPick(list) { return list[(Math.random() * list.length) | 0]; }
function bgSides(side) { return [side, side === 'Alliance' ? 'Horde' : 'Alliance']; }
const BG_RACES = { Alliance: [1, 3, 4, 7], Horde: [2, 5, 6, 8] };
function bgNewUnit(o) { return Object.assign({ alive: true, x: 0, y: 0, kills: 0, deaths: 0, hks: 0, honor: 0, dmg: 0, healed: 0, oa: 0, od: 0, hit: new Set() }, o); }
function bgUnitFromChar(c, team) {
  const s = charStats(c); const heal = typeof grpRole === 'function' && groupOf(c) && grpRole(c) === 'healer';
  const dps = Math.max(5, (typeof classDps === 'function' ? classDps(c, s, 0.25) : s.mhDps) * 0.9);
  return bgNewUnit({ id: c.id, c, name: c.name, team, cls: c.cls, race: c.race, level: c.level, maxhp: s.maxHp, hp: s.maxHp, dps, heal: heal ? dps * 1.1 : 0, ranged: [3, 5, 8, 9].includes(c.cls) || heal, rank: pvpRank(c) });
}
/* the other players: mercenaries from the roster (free here) - their gear, skill and honor rank are random; level 60s
   are rank 6 or higher, the others rank 0-5. Healers: 1 to one per raid group on each side. */
const BG_CLASSES = { Alliance: [1, 2, 3, 4, 5, 8, 9, 11], Horde: [1, 3, 4, 5, 7, 8, 9, 11] };
const BG_HEAL_CLASSES = { Alliance: [5, 5, 2, 2, 11], Horde: [5, 5, 7, 7, 11] };
function bgHealerCount(B) { const n = bgGroups(B); return 1 + Math.floor(Math.random() * n); }
function bgMercPool(B) {
  if (!B.pool) { const R = typeof roster === 'function' ? roster().slice() : []; for (let i = R.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [R[i], R[j]] = [R[j], R[i]]; } B.pool = R; B.usedNames = new Set(); }
  return B.pool;
}
function bgMerc(B, team, healer) {
  const ok = (healer ? BG_HEAL_CLASSES : BG_CLASSES)[team];
  const pool = bgMercPool(B); const i = pool.findIndex((m) => ok.includes(m.cls) && (m.role === 'healer') === healer && !B.usedNames.has(m.name));
  if (i >= 0) { const m = pool.splice(i, 1)[0]; B.usedNames.add(m.name); return { name: m.name, cls: m.cls, skill: typeof execLevel === 'function' ? execLevel(m, null) : 3, rid: m.id }; }
  // nobody fitting on the roster: a new face (not kept on the roster)
  const pts = -Math.log(1 - Math.random() * 0.97) * 260; const apt = 0.7 + Math.random() * 0.3; let name; for (let k = 0; k < 20; k++) { name = bgName(team); if (!B.usedNames.has(name)) break; } B.usedNames.add(name);
  return { name, cls: bgPick(ok), skill: (typeof curve === 'function' ? curve(pts, SKILL_K) : 3) * apt };
}
function bgBot(B, team, ref, healer) {
  const lo = B.bracket[0], hi = B.bracket[1]; const L = Math.max(lo, Math.min(hi, Math.round(lo + Math.pow(Math.random(), 0.6) * (hi - lo))));
  const m = bgMerc(B, team, healer); const cls = m.cls;
  let race; for (let k = 0; k < 30; k++) { race = bgPick(BG_RACES[team]); if (raceClassOk(race, cls)) break; }
  const rank = L >= 60 ? 6 + Math.floor(Math.pow(Math.random(), 1.6) * 9) : Math.floor(Math.random() * 6);
  const gear = rnd(0.82, 1.18) * (1 + rank * 0.012);          // random gear; higher ranks wear their rank gear
  const eff = (0.65 + 0.35 * Math.min(10, m.skill) / 10) / 0.8;          // how well they play (the mercenary skill)
  const k = Math.pow(L / Math.max(1, ref.level), 1.5);
  const hpM = cls === 1 || cls === 2 ? 1.25 : [5, 8, 9].includes(cls) ? 0.85 : 1, dmM = cls === 4 || cls === 8 || cls === 9 ? 1.15 : cls === 2 || cls === 5 ? 0.85 : 1;
  const maxhp = Math.round(ref.maxhp * k * hpM * gear); const dps = ref.dps * k * dmM * gear * eff;
  return bgNewUnit({ id: 'b' + (B.nid++), name: m.name, rid: m.rid, team, cls, race, level: L, maxhp, hp: maxhp, dps: healer ? dps * 0.45 : dps, heal: healer ? dps * 1.1 : 0,
    ranged: [3, 5, 8, 9].includes(cls) || healer, rank, skill: Math.round(m.skill * 10) / 10, gear: Math.round(gear * 100) / 100 });
}
function bgFill(B, team, ref) {
  const mine = B.units.filter((u) => u.team === team); let heals = Math.max(0, bgHealerCount(B) - mine.filter((u) => u.heal).length);
  const free = B.def.size - mine.length; const hs = new Set(); while (hs.size < Math.min(heals, free)) hs.add((Math.random() * free) | 0);
  for (let i = 0; i < free; i++) B.units.push(bgBot(B, team, ref, hs.has(i)));
}
function bgRankName(u) { return u.rank ? PVP_RANKS[u.team][u.rank - 1] : 'No rank'; }
function bgGroups(B) { return Math.ceil(B.def.size / 5); }
/* the raid groups (1 ..) of a team: your characters keep their raid group, the others fill the free places */
function bgAssignGroups(B, team) {
  const n = bgGroups(B); const cnt = new Array(n + 1).fill(0); const list = B.units.filter((u) => u.team === team && !u.general);
  for (const u of list) if (u.c) { const g = groupOf(u.c); const i = g ? g.members.findIndex((m) => m.id === u.c.id) : 0; let k = Math.min(n, Math.floor(Math.max(0, i) / 5) + 1); while (cnt[k] >= 5 && k < n) k++; u.grp = k; cnt[k]++; }
  const hg = new Set(list.filter((u) => u.c && u.heal).map((u) => u.grp));
  for (const u of list) if (!u.c && u.heal) { let k = 1; while (k < n && (cnt[k] >= 5 || hg.has(k))) k++; if (cnt[k] >= 5) { k = 1; while (k < n && cnt[k] >= 5) k++; } u.grp = k; cnt[k]++; hg.add(k); }
  for (const u of list) if (!u.c && !u.heal) { let k = 1; while (k < n && cnt[k] >= 5) k++; u.grp = k; cnt[k]++; }
}
function bgStart(key, chars) {
  const def = BGS[key]; const c0 = chars[0]; const [mine, theirs] = bgSides(pvpSide(c0));
  const B = { id: 'bg' + Math.round(G.gameTime * 100), key, def, map: def.map, t0: G.gameTime, side: mine, units: [], nid: 1, over: null, logs: [], bracket: bgBracket(c0, def), uord: {} };
  // your characters, then the rest of both teams
  for (const c of chars) B.units.push(bgUnitFromChar(c, mine));
  const ref = B.units[0];
  bgFill(B, mine, ref); bgFill(B, theirs, ref);
  B.units.forEach((u, i) => { u.role = bgRole(B, u, i); const p = bgSpawnPoint(B, u.team); u.x = p[0] + rnd(-6, 6); u.y = p[1] + rnd(-6, 6); u.jx = rnd(-14, 14); u.jy = rnd(-14, 14); });
  bgAssignGroups(B, mine); bgAssignGroups(B, theirs);
  if (key === 'wsg') { B.score = { Alliance: 0, Horde: 0 }; B.flag = { Alliance: { carrier: null }, Horde: { carrier: null } }; B.firstCap = null; }
  if (key === 'ab') { B.res = { Alliance: 0, Horde: 0 }; B.nodes = def.nodes.map(([n, x, y]) => ({ n, x, y, owner: null, capT: 0, capTeam: null })); B.resT = 0; }
  if (key === 'av') {
    B.reinf = { Alliance: 400, Horde: 400 }; B.gys = def.lane.map(([n, x, y, o]) => ({ n, x, y, owner: o, capT: 0, capTeam: null }));
    for (const t of [mine, theirs]) { const [n, x, y] = def.general[t]; const ex = B.units.filter((u) => u.team === t && !u.c); const avgHp = ex.reduce((a, u) => a + u.maxhp, 0) / Math.max(1, ex.length), avgD = ex.reduce((a, u) => a + u.dps, 0) / Math.max(1, ex.length);
      B.units.push(bgNewUnit({ id: 'gen' + t, name: n, team: t, general: true, cls: 1, level: 62, maxhp: Math.round(avgHp * 30), hp: Math.round(avgHp * 30), dps: avgD * 6, heal: 0, ranged: false, x, y, hx: x, hy: y, grp: 0 })); }
  }
  G.bgs = G.bgs || []; G.bgs.push(B);
  for (const c of chars) bgEnterChar(B, c, B.units.find((x) => x.c === c));
  if (chars.some(isActive) && !G.headless) { if (typeof goToCharacter === 'function') goToCharacter(); if (G.state.settings.raidPanel !== false) RAID.show = true; }
  save(); if (typeof renderOrder === 'function') renderOrder();
}
function bgEnterChar(B, c, u) {
  const r = rt(c); const def = B.def;
  c.bgReturn = { map: c.pos.map, x: c.pos.x, y: c.pos.y, z: c.pos.z }; c.bgResume = c.order && c.order.type !== 'bg' ? c.order : null;
  r.mv = null; r.tgt = null; r.threats = []; r.cast = null; r.resting = false; r.mounted = null; r.party = null; r.interact = null;
  c.order = { type: 'bg', label: def.name }; r.bg = B; c.pos = { map: def.map, x: u.x, y: u.y, z: 0, o: 0 };
  withLogC(c, () => log('Entered ' + def.name + ' (' + B.bracket[0] + '-' + B.bracket[1] + ', ' + def.size + ' against ' + def.size + ').'));
}
/* a character invited into the raid while the raid is in a battleground: takes the place of one of the others */
function bgJoinRaid(leader, c) {
  const B = rt(leader).bg; if (!B || B.over || rt(c).bg || c.level < B.def.minL || pvpSide(c) !== B.side) return false;
  const bot = B.units.filter((u) => u.team === B.side && !u.c && !u.general).sort((a, b) => (a.alive ? 1 : 0) - (b.alive ? 1 : 0))[0]; if (!bot) return false;
  const u = bgUnitFromChar(c, B.side); u.grp = bot.grp; u.role = bot.role; u.jx = bot.jx; u.jy = bot.jy; const p = bgSpawnPoint(B, u.team); u.x = p[0]; u.y = p[1];
  B.units[B.units.indexOf(bot)] = u; delete B.uord[bot.id];
  if (c.pvp) delete c.pvp.q; bgEnterChar(B, c, u); bgNote(B, c.name + ' joined the raid.'); return true;
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
/* resurrection like the game: the spirit healers raise everyone waiting every 30 seconds (one timer for the whole
   battleground), at the side's graveyard - the one nearest to where they died: the base, the bases held (Arathi Basin)
   or the graveyards held (Alterac Valley) */
function bgNextWave(B) { const k = Math.floor((G.gameTime - B.t0) / BG_RES) + 1; return B.t0 + k * BG_RES; }
function bgGraveyards(B, team) {
  const out = [B.def.gy[team]];
  if (B.key === 'ab' && B.nodes) for (const n of B.nodes) if (n.owner === team) out.push([n.x, n.y]);
  if (B.key === 'av' && B.gys) for (const g of B.gys) if (g.owner === team) out.push([g.x, g.y]);
  return out;
}
function bgNearestGy(B, team, x, y) { let best = null, bd = 1e9; for (const g of bgGraveyards(B, team)) { const d = Math.hypot(g[0] - x, g[1] - y); if (d < bd) { bd = d; best = g; } } return best; }
function bgDeadText(B, team) { const n = B.units.filter((u) => u.team === team && !u.alive && !u.general).length; return n ? ' (' + n + ' waiting)' : ''; }
/* ------------------------------------------------------------------ the simulation (worldTick) */
const BG_CLOSE = 120;          // (old: the battleground used to close 2 minutes after the end)
const BG_AUTO_LEAVE = 15;      // auto battlegrounds: leave after a look at the scoreboard
function bgTick(dt) {
  if (!G.bgs || !G.bgs.length) return;
  for (const B of G.bgs.slice()) bgStep(B, dt);
}
function bgEnemies(B, u) { return B.units.filter((x) => x.alive && x.team !== u.team); }
function bgStep(B, dt) {
  const now = G.gameTime; const T = now - B.t0;
  if (B.over) {          // the scoreboard: nobody acts; auto battlegrounds leave after a moment, the rest when it closes
    for (const u of B.units) if (u.c && rt(u.c).bg === B && cset(u.c, 'autoBg') && now - B.over.t > BG_AUTO_LEAVE) bgLeaveChar(u.c, false);
    // without auto battlegrounds it stays (the scoreboard, the game paused) until you press Leave Battleground
    return;
  }
  // resurrection waves
  for (const u of B.units) if (!u.alive && !u.general && now >= u.resAt) { u.alive = true; u.hp = u.maxhp; const p = bgNearestGy(B, u.team, u.x, u.y); u.x = p[0] + rnd(-5, 5); u.y = p[1] + rnd(-5, 5); u.tgt = null; u.hit = new Set(); u.node = null; u.path = null; }
  const alive = B.units.filter((u) => u.alive);
  for (const u of alive) if (u.alive) bgUnitStep(B, u, dt, alive);
  bgEffects(B, dt);
  bgObjectives(B, dt, T);
  // your characters: where their fighter is
  for (const u of B.units) if (u.c && rt(u.c).bg === B) {
    const c = u.c; c.pos.x = u.x; c.pos.y = u.y; c.pos.map = B.map;
    const mx = charStats(c).maxHp; c.hp = Math.max(0, u.alive ? u.hp / u.maxhp * mx : 0);
  }
  if (!B.over && T > B.def.time) bgFinish(B, bgTimeWinner(B), 'time is up');
}
const bgDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function bgUnitStep(B, u, dt, alive) {
  if (u.general) {          // stays at home and fights whoever comes
    const e = alive.filter((x) => x.alive && x.team !== u.team && Math.hypot(x.x - u.x, x.y - u.y) < 25).sort((a, b) => bgDist(a, u) - bgDist(b, u))[0];
    if (e) { if (bgDist(e, u) > 5) bgMove(u, e.x, e.y, dt, 5); else bgHit(B, u, e, u.dps * dt); }
    else bgMove(u, u.hx, u.hy, dt, 1);
    return;
  }
  // stunned, sheeped, feared, in Ice Block: a way out (trinket, racials, Blink ...) or wait / run
  if (!bgCanAct(u)) { if (G.gameTime >= (u.boT || 0)) { u.boT = G.gameTime + 0.5; bgBreakOut(B, u); } if (!bgCanAct(u)) { bgHelpless(B, u, dt); u.healing = 0; return; } }
  const P = bgPlan(B, u); const A = P.anchor; const inA = (x) => !A || Math.hypot(x.x - A[0], x.y - A[1]) <= A[2];
  // a target: the one the order names, else keep the one it has, else the enemy flag carrier first, else the nearest
  // (stealthed ones only seen up close, the sheeped and the ones in Ice Block / Divine Shield left alone)
  const seen = (x) => (!x.stealth || bgDist(x, u) < 7) && !bgHas(x, 'incap') && !bgHas(x, 'immune');
  let t = P.hunt && P.hunt.alive && seen(P.hunt) ? P.hunt : null;
  if (!t && u.tgt && u.tgt.alive && !u.tgt.general && seen(u.tgt) && bgDist(u.tgt, u) < 45 && (!A || Math.hypot(u.tgt.x - A[0], u.tgt.y - A[1]) <= A[2] + 12)) t = u.tgt;
  if (!t) {
    let best = null, bd = P.range || 34;
    for (const x of alive) { if (!x.alive || x.team === u.team || x.general || !inA(x) || !seen(x)) continue; const d = bgDist(x, u) - (x.carry ? 25 : 0); if (d < bd) { bd = d; best = x; } }
    t = best;
  }
  u.tgt = t;
  // the class: abilities a few times a second (pvptactics.js)
  if (G.gameTime >= (u.tacT || 0)) { u.tacT = G.gameTime + 0.35 + Math.random() * 0.2; bgBreakOut(B, u); bgTactics(B, u, t, P); if (!bgCanAct(u)) return; }
  // healers: someone of the team hurt near them (not while silenced)
  if (u.heal && bgCanCast(u)) {
    const h = alive.filter((x) => x.alive && x.team === u.team && !x.general && x.hp < x.maxhp * (x.carry ? 0.95 : 0.75) && bgDist(x, u) < 35).sort((a, b) => a.hp / a.maxhp - (a.carry ? 0.5 : 0) - b.hp / b.maxhp + (b.carry ? 0.5 : 0))[0];
    if (h) { u.form = null; if (bgDist(h, u) > 28) bgMove(u, h.x, h.y, dt, 26); else { const v = Math.min(h.maxhp - h.hp, u.heal * dt * rnd(0.7, 1.3) * bgHealMul(h)); h.hp += v; u.healed += v; u.healing = G.gameTime + 0.6; } return; }
  }
  if (u.carry && t && bgDist(t, u) > 8) t = null;          // the flag carrier keeps running
  if (t && bgKite(B, u, dt)) return;          // casters and hunters: step away from a slowed / frozen melee first
  if (t && (u.form === 'travel' || u.form === 'wolf' || u.form === 'cheetah') && !u.carry) u.form = null;
  if (t && !(u.form === 'travel' && u.carry)) {
    const d = bgDist(t, u); const range = u.ranged ? 26 : 4;
    if (d > range) { if (d > 70) bgGo(B, u, t.x, t.y, dt, range - 1); else bgMove(u, t.x, t.y, dt, range - 1); } else if (u.ranged && !bgCanCast(u) && [5, 8, 9].includes(u.cls)) bgMove(u, t.x, t.y, dt, 3); else bgHit(B, u, t, u.dps * dt * rnd(0.7, 1.3));
    return;
  }
  const g = P.goal; if (g) bgGo(B, u, g[0] + (g[2] ? 0 : u.jx), g[1] + (g[2] ? 0 : u.jy), dt, 1);
}
/* ------------------------------------------------------------------ routes: the walkable ground of each battleground
   (points on its map picture, joined to their neighbours). Fighters going somewhere far take a route over it - each
   their own way (a little randomness per fighter), flag carriers around the enemies - so the whole field gets used. */
const BG_NAV = {
  wsg: { r: 125, cx: 510, half: 140, pts: [[490, 76], [495, 130], [470, 185], [439, 172], [590, 170], [430, 240], [520, 250], [620, 250], [390, 330], [510, 320], [640, 320], [420, 420], [510, 440], [610, 440], [500, 480], [440, 510], [580, 505], [570, 522], [520, 570], [440, 575], [532, 610], [350, 280], [660, 380], [360, 400], [470, 360], [570, 370]] },
  ab: { r: 110, pts: [[324, 136], [376, 195], [420, 165], [500, 190], [576, 206], [463, 303], [405, 372], [561, 401], [649, 450], [360, 280], [520, 250], [620, 300], [470, 400], [440, 240], [600, 360], [300, 180], [540, 330], [640, 400]] },
  av: { r: 88, cx: 488, half: 45, pts: [] },
};
for (let py = 70; py <= 600; py += 50) BG_NAV.av.pts.push([445, py], [530, py]);
function bgNav(B) {
  const N = BG_NAV[B.key]; if (!N) return null; if (N.w) return N;
  const m = DATA.maps.find((x) => x.map === B.map); if (!m) return null; const W = 1002, H = 668;
  N.w = N.pts.map(([px, py]) => [m.xt - py / H * (m.xt - m.xb), m.yl - px / W * (m.yl - m.yr)]);
  N.lat = N.pts.map(([px]) => N.half ? Math.max(-1, Math.min(1, (px - N.cx) / N.half)) : 0); N.adj = N.w.map(() => []);
  N.pts.forEach((a, i) => N.pts.forEach((b, j) => { if (i < j && Math.hypot(a[0] - b[0], a[1] - b[1]) <= N.r) { const d = Math.hypot(N.w[i][0] - N.w[j][0], N.w[i][1] - N.w[j][1]); N.adj[i].push([j, d]); N.adj[j].push([i, d]); } }));
  return N;
}
/* a point across the field on the fighter's lane (the middle of Warsong Gulch is wide) */
function bgLanePoint(B, u, p) { const N = bgNav(B); if (!N || !N.half) return p; if (u.lane == null) u.lane = bgPick([-1, -0.6, 0, 0.6, 1]); const m = DATA.maps.find((x) => x.map === B.map); const dy = -u.lane * N.half * 0.9 * (m.yl - m.yr) / 1002; return [p[0], p[1] + dy]; }
function bgNearNode(N, x, y) { let b = 0, bd = 1e9; N.w.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; b = i; } }); return b; }
function bgRoute(B, u, gx, gy) {
  const N = bgNav(B); if (!N) return null; const s = bgNearNode(N, u.x, u.y), e = bgNearNode(N, gx, gy); if (s === e) return null;
  const seed = u.pseed || (u.pseed = 1 + Math.random() * 1000); if (u.lane == null || (u.carry && G.gameTime > (u.laneT || 0))) { u.lane = bgPick([-1, -0.6, 0, 0.6, 1]); u.laneT = G.gameTime + 30; } const noise = (i, j) => { const v = Math.sin((i * 73.1 + j * 37.7) * seed) * 43758.5; return v - Math.floor(v); };
  const foes = u.carry ? B.units.filter((x) => x.alive && x.team !== u.team) : null;
  const dist = N.w.map(() => Infinity), prev = N.w.map(() => -1), done = N.w.map(() => false); dist[s] = 0;
  for (;;) { let i = -1, bd = Infinity; for (let k = 0; k < dist.length; k++) if (!done[k] && dist[k] < bd) { bd = dist[k]; i = k; } if (i < 0 || i === e) break; done[i] = true;
    for (const [j, d] of N.adj[i]) { let w = d * (1 + 0.6 * noise(Math.min(i, j), Math.max(i, j)) + (N.half ? 1.6 * Math.abs(N.lat[j] - u.lane) : 0));          /* each fighter keeps to its lane: west, middle or east */
      if (foes) { const p = N.w[j]; for (const f of foes) if (Math.abs(f.x - p[0]) < 30 && Math.abs(f.y - p[1]) < 30) w += 60; }
      if (dist[i] + w < dist[j]) { dist[j] = dist[i] + w; prev[j] = i; } } }
  const out = []; for (let k = e; k >= 0 && k !== s; k = prev[k]) out.unshift(N.w[k]); if (!out.length) return null;
  const sc = Math.max(4, Math.min(12, Math.hypot(u.jx || 0, u.jy || 0)));
  return out.map((p) => [p[0] + (u.jx || 0) / 14 * sc, p[1] + (u.jy || 0) / 14 * sc]);
}
/* walking to a far goal: along a route; close by: straight */
function bgGo(B, u, gx, gy, dt, stop) {
  const d = Math.hypot(gx - u.x, gy - u.y);
  if (d < 70) { u.path = null; bgMove(u, gx, gy, dt, stop); return; }
  const P = u.path; const stale = !P || Math.hypot(P.gx - gx, P.gy - gy) > 40 || G.gameTime > P.t || (u.carry && G.gameTime > P.t - 12);
  if (stale) { const r = bgRoute(B, u, gx, gy); u.path = { pts: r || [], gx, gy, t: G.gameTime + 25 }; }
  const pts = u.path.pts; while (pts.length && Math.hypot(pts[0][0] - u.x, pts[0][1] - u.y) < 9) pts.shift();
  if (pts.length) bgMove(u, pts[0][0], pts[0][1], dt, 0); else bgMove(u, gx, gy, dt, stop);
}
function bgMove(u, x, y, dt, stop) { const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy); if (d <= stop) return; const s = Math.min(d - stop, BG_SPEED * bgSpeedMul(u) * dt); /* forms, Sprint, slows and roots (pvptactics.js) */ if (s <= 0) return; u.x += dx / d * s; u.y += dy / d * s; }
function bgHit(B, u, t, v) {
  if (!t.alive || !u.alive) return;          // died earlier in this same step
  if (t.carry) { const held = G.gameTime - (t.carryT || G.gameTime); v *= held > 90 ? 1 : held > 45 ? 0.7 : 0.45; }          // carriers are tough - until they hold it too long (Focused / Brutal Assault)
  v = bgDmgMul(B, t, u, v); if (!(v > 0)) return;
  t.hp -= v; u.dmg += v; t.hit.add(u.id);
  if (u.c && isActive(u.c) && Math.random() < 0.06) fx(t.x, t.y, '' + Math.round(v * 20), '#fff');
  if (t.hp <= 0) bgDie(B, t, u);
}
function bgUScale(u) { return Math.max(0.15, Math.min(1, (u.c ? u.c.level : u.level) / 60)); }
function bgGive(u, h) { if (!h) return; u.honor += h; if (u.c) pvpGain(u.c, Math.round(h)); }
function bgDie(B, t, killer) {
  t.alive = false; t.hp = 0; t.deaths++; t.tgt = null; killer.kills++; t.st = {}; t.absorb = 0; t.form = null; t.stealth = false; t.brk = null;
  const now = G.gameTime; t.resAt = bgNextWave(B);
  // released: the spirit waits at its side's nearest graveyard for the next wave
  const gy = bgNearestGy(B, t.team, t.x, t.y); t.x = gy[0] + rnd(-3, 3); t.y = gy[1] + rnd(-3, 3);
  if (t.carry) { const f = B.flag[t.carry]; f.carrier = null; const back = t.carry; t.carry = null; if (killer.team === back) killer.od++; bgNote(B, killer.name + ' (' + killer.team + ') returned the ' + back + ' flag!'); }
  if (B.key === 'av' && !t.general && B.reinf) { B.reinf[t.team] = Math.max(0, B.reinf[t.team] - 1); if (B.reinf[t.team] <= 0) bgFinish(B, t.team === 'Alliance' ? 'Horde' : 'Alliance', 'out of reinforcements'); }
  if (t.general) { bgNote(B, t.name + ' is dead!'); bgFinish(B, t.team === 'Alliance' ? 'Horde' : 'Alliance', t.name + ' was killed'); return; }
  // honorable kill: everyone of the other team near it or who hit it; the honor is shared among them (like the game)
  const cred = B.units.filter((u) => u.team !== t.team && !u.general && (t.hit.has(u.id) || (u.alive && bgDist(u, t) < 40)));
  const share = 1 / Math.max(1, cred.length / 2);
  for (const u of cred) {
    u.hks++; if (u.c) pvpOf(u.c).hks++;
    const h = hkHonor(t.level, u.c ? u.c.level : u.level) * share; bgGive(u, h);
    if (u.c && h >= 0.5 && isActive(u.c)) fx(t.x, t.y, 'Honorable kill +' + Math.round(h), '#ffd866');
  }
  if (t.c && rt(t.c).bg === B) { pvpOf(t.c).deaths++; withLogC(t.c, () => log(t.c.name + ' was killed by ' + killer.name + ' - back in the next wave.')); }
}
function bgNote(B, s) { B.logs.unshift([G.gameTime, s]); if (B.logs.length > 8) B.logs.pop(); for (const u of B.units) if (u.c && rt(u.c).bg === B) withLogC(u.c, () => log(B.def.name + ': ' + s)); }

/* ------------------------------------------------------------------ orders (the raid panel) and what a fighter does */
/* orders: saved per battleground - for each raid group and each of your characters (a strategy you set up once);
   the other players of your side can get one for this match. The enemy team plays by itself (Auto). */
function bgStrat(key) { const S = G.state.bgStrat = G.state.bgStrat || {}; return (S[key] = S[key] || { grp: {}, chars: {} }); }
function bgOrdOf(B, u) { if (u.team !== B.side || u.general) return 'auto'; const S = bgStrat(B.key); return (u.c && S.chars[u.c.id]) || B.uord[u.id] || S.grp[u.grp] || 'auto'; }
function bgOrders(B) {
  const L = [['auto', 'Auto', 'Their own judgement (the default)'], ['roam', 'Roam', 'Hunt lone enemies all over the field'], ['focus', 'Focus their healers', 'Go after the enemy healers first, the nearest one']];
  if (B.key === 'wsg') L.push(['wsg:take', 'Capture the flag', 'Run into the enemy flag room, take the flag and bring it home'], ['wsg:esc', 'Defend the flag carrier', 'Stay with your flag carrier and keep it alive'],
    ['wsg:def', 'Defend our flag', 'Guard your own flag room'], ['wsg:hunt', 'Kill their flag carrier', 'Chase the enemy carrier and return your flag'], ['wsg:mid', 'Hold the middle', 'Fight in the middle of the field']);
  if (B.key === 'ab') { L.push(['ab:cap', 'Capture bases', 'Take the bases you do not hold, the nearest first'], ['ab:defall', 'Defend our bases', 'Spread over the bases you hold, the attacked ones first']);
    B.def.nodes.forEach(([n], i) => L.push(['ab:hold:' + i, 'Defend ' + n, 'Go to the ' + n + ', take it if it is not yours and guard it'])); }
  if (B.key === 'av') { L.push(['av:push', 'Push the graveyards', 'Take the graveyards down the valley, then the general'], ['av:gen', 'Kill the general', 'Rush past everything to the enemy general'], ['av:def', 'Defend our graveyards', 'Guard the graveyards you hold, the attacked first']);
    B.def.lane.forEach(([n], i) => L.push(['av:hold:' + i, 'Defend ' + n.replace(' Graveyard', ''), 'Go to the ' + n + ', take it if it is not yours and guard it'])); }
  return L;
}
function bgOrdShort(B, o) {
  if (!o || o === 'auto') return ''; const m = /^(ab|av):hold:(\d+)$/.exec(o);
  if (m) { const n = (m[1] === 'ab' ? B.def.nodes : B.def.lane)[+m[2]][0]; return n.replace(/ (Graveyard|Station|Hut)$/, '').split(' ').pop(); }
  return { roam: 'Roam', focus: 'Healers', 'wsg:take': 'Flag', 'wsg:esc': 'Escort', 'wsg:def': 'Defend', 'wsg:hunt': 'Hunt', 'wsg:mid': 'Mid', 'ab:cap': 'Capture', 'ab:defall': 'Defend', 'av:push': 'Push', 'av:gen': 'General', 'av:def': 'Defend' }[o] || o;
}
/* strategies: orders for the raid groups in one click */
function bgStrategies(B) {
  const n = bgGroups(B); const all = (o) => { const r = {}; for (let i = 1; i <= n; i++) r[i] = o; return r; };
  if (B.key === 'wsg') return [['Balanced', 'Everyone by their own judgement', {}], ['Offense', 'Group 1 takes the flag, group 2 guards the carrier', { 1: 'wsg:take', 2: 'wsg:esc' }],
    ['Turtle', 'Group 1 guards the flag room, group 2 takes the flag', { 1: 'wsg:def', 2: 'wsg:take' }], ['Hunters', 'Group 1 hunts their carrier, group 2 takes the flag', { 1: 'wsg:hunt', 2: 'wsg:take' }]];
  if (B.key === 'ab') {
    const base = B.def.base[B.side]; const near = B.def.nodes.map((x, i) => [i, Math.hypot(x[1] - base[0], x[2] - base[1])]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
    return [['Balanced', 'Everyone by their own judgement', {}], ['Three bases', 'Take and hold the two bases nearest to you and the Blacksmith', { 1: 'ab:hold:' + near[0], 2: 'ab:hold:1', 3: 'ab:hold:' + (near[0] === 1 ? near[2] : near[1]) }],
      ['Five bases', 'Two groups capture, one defends', { 1: 'ab:cap', 2: 'ab:cap', 3: 'ab:defall' }], ['Roamers', 'One group hunts, one captures, one defends', { 1: 'roam', 2: 'ab:cap', 3: 'ab:defall' }]];
  }
  if (B.key === 'av') return [['Balanced', 'Everyone by their own judgement (push)', {}], ['Rush', 'Six groups rush the general, two defend', Object.assign(all('av:gen'), { [n - 1]: 'av:def', [n]: 'av:def' })],
    ['Turtle', 'Half defend the graveyards, half push', Object.assign(all('av:push'), { 1: 'av:def', 2: 'av:def', 3: 'av:def', 4: 'av:def' })], ['Graveyards', 'Everyone pushes the graveyards', all('av:push')]];
  return [];
}
function bgSetOrder(B, sel, o) {
  const S = bgStrat(B.key); const mine = B.units.filter((u) => u.team === B.side && !u.general);
  const clear = (u) => { delete B.uord[u.id]; if (u.c) delete S.chars[u.c.id]; u.node = null; u.roam = null; };
  if (sel.kind === 'raid') { S.grp = {}; for (let i = 1; i <= bgGroups(B); i++) if (o !== 'auto') S.grp[i] = o; mine.forEach(clear); }
  else if (sel.kind === 'grp') { if (o === 'auto') delete S.grp[sel.id]; else S.grp[sel.id] = o; mine.filter((u) => u.grp === +sel.id).forEach(clear); }
  else { const u = mine.find((x) => String(x.id) === String(sel.id)); if (!u) return; clear(u); if (o !== 'auto' || S.grp[u.grp]) { if (u.c) S.chars[u.c.id] = o; else B.uord[u.id] = o; } }
  save();
}
function bgApplyStrategy(B, grp) { const S = bgStrat(B.key); S.grp = Object.assign({}, grp); S.chars = {}; B.uord = {}; for (const u of B.units) { u.node = null; u.roam = null; } save(); }

/* what a fighter does now: { goal: [x, y, exact], anchor: [x, y, radius] (stays and fights there), hunt: a unit, range } */
function bgPlan(B, u) {
  const def = B.def; const foe = u.team === 'Alliance' ? 'Horde' : 'Alliance'; let o = bgOrdOf(B, u);
  if (o === 'roam') return bgRoam(B, u);
  if (o === 'focus') { const h = bgFocusHealer(B, u); if (h) return h; o = 'auto'; }
  if (B.key === 'wsg') {
    const myFlag = def.flag[u.team], theirFlag = def.flag[foe];
    if (u.carry) return { goal: [myFlag[0], myFlag[1], true], range: 10 };
    const eCar = B.units.find((x) => x.alive && x.carry === u.team), mCar = B.units.find((x) => x.alive && x.carry === foe);
    if (o === 'auto') {
      if (eCar && (u.role !== 'offense' || bgDist(eCar, u) < 120)) o = 'wsg:hunt';
      else o = u.role === 'offense' ? 'wsg:take' : u.role === 'defense' ? 'wsg:def' : mCar ? 'wsg:esc' : (u.jx > 0 ? 'wsg:take' : 'wsg:mid');
    }
    if (o === 'wsg:take') { if (eCar && bgDist(eCar, u) < 40) return { goal: [eCar.x, eCar.y, true], hunt: eCar }; return mCar ? { goal: [mCar.x, mCar.y], anchor: [mCar.x, mCar.y, 35] } : { goal: [theirFlag[0], theirFlag[1], true], range: 9 }; }          /* runners: straight for the flag room */
    if (o === 'wsg:esc') { if (mCar) return { goal: [mCar.x + u.jx * 0.4, mCar.y + u.jy * 0.4, true], anchor: [mCar.x, mCar.y, 30] }; if (eCar) return { goal: [eCar.x, eCar.y, true], hunt: eCar }; return { goal: [theirFlag[0], theirFlag[1]] }; }
    if (o === 'wsg:def') { const g = { goal: [myFlag[0], myFlag[1]], anchor: [myFlag[0], myFlag[1], 45] }; if (eCar && bgDist(eCar, u) < 70) g.hunt = eCar; return g; }
    if (o === 'wsg:hunt') return eCar ? { goal: [eCar.x, eCar.y, true], hunt: bgDist(eCar, u) < 30 ? eCar : null, range: 22 } : { goal: bgLanePoint(B, u, def.mid) };          /* the escort is in the way first */
    const mid = bgLanePoint(B, u, def.mid); return { goal: mid, anchor: [mid[0], mid[1], 70] };
  }
  if (B.key === 'ab') {
    const m = /^ab:hold:(\d+)$/.exec(o);
    if (m) { const n = B.nodes[+m[1]]; return { goal: [n.x, n.y], anchor: [n.x, n.y, 35] }; }
    if (!u.node || G.gameTime > (u.nodeT || 0) || (o === 'ab:cap' && u.node.owner === u.team)) { u.nodeT = G.gameTime + 20 + Math.random() * 15; u.node = o === 'ab:cap' ? bgCapNode(B, u) : o === 'ab:defall' ? bgDefNode(B, u, B.nodes) : bgPickNode(B, u); }
    const n = u.node; return o === 'ab:defall' && n.owner === u.team ? { goal: [n.x, n.y], anchor: [n.x, n.y, 35] } : { goal: [n.x, n.y] };
  }
  if (B.key === 'av') {
    const m = /^av:hold:(\d+)$/.exec(o); const gen = B.units.find((x) => x.general && x.team === foe);
    if (m) { const n = B.gys[+m[1]]; return { goal: [n.x, n.y], anchor: [n.x, n.y, 35] }; }
    if (o === 'av:gen') { if (!gen || !gen.alive) return { goal: def.base[foe] }; const d = bgDist(gen, u); return d < 45 ? { goal: [gen.x, gen.y, true], hunt: gen } : { goal: [gen.x, gen.y], range: 8 }; }
    if (o === 'av:def') { if (!u.node || G.gameTime > (u.nodeT || 0)) { u.nodeT = G.gameTime + 15; u.node = bgDefNode(B, u, B.gys); } const n = u.node; return { goal: [n.x, n.y], anchor: [n.x, n.y, 35] }; }
    const order = u.team === 'Alliance' ? B.gys.slice().reverse() : B.gys.slice();          // from my end towards theirs
    const next = order.find((g) => g.owner !== u.team);
    if (next) return { goal: [next.x, next.y] };
    if (gen && gen.alive) return bgDist(gen, u) < 50 ? { goal: [gen.x, gen.y, true], hunt: gen } : { goal: [gen.x, gen.y] };
    return { goal: def.base[foe] };
  }
  return { goal: null };
}
/* focusing healers: the nearest enemy healer alive (back to the battleground's own order when none is left) */
function bgFocusHealer(B, u) {
  if (!u.foc || !u.foc.alive || G.gameTime > (u.focT || 0)) { u.focT = G.gameTime + 3; let best = null, bd = 1e9; for (const x of B.units) if (x.alive && x.team !== u.team && x.heal && !x.general) { const d = bgDist(x, u); if (d < bd) { bd = d; best = x; } } u.foc = best; }
  const h = u.foc; return h ? { goal: [h.x, h.y, true], hunt: bgDist(h, u) < 50 ? h : null, range: 12 } : null;
}
/* roaming: the enemy with the fewest friends around it, not too far */
function bgRoam(B, u) {
  if (!u.roam || !u.roam.alive || G.gameTime > (u.roamT || 0)) {
    u.roamT = G.gameTime + 4; let best = null, bs = 1e9;
    for (const x of B.units) { if (!x.alive || x.team === u.team || x.general) continue; let f = 0; for (const y of B.units) if (y !== x && y.alive && y.team === x.team && !y.general && Math.abs(y.x - x.x) < 20 && Math.abs(y.y - x.y) < 20) f++; const s = bgDist(x, u) + f * 70; if (s < bs) { bs = s; best = x; } }
    u.roam = best;
  }
  return u.roam ? { goal: [u.roam.x, u.roam.y, true], hunt: bgDist(u.roam, u) < 60 ? u.roam : null, range: 20 } : { goal: B.def.mid || B.def.base[u.team] };
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
function bgCapNode(B, u) {
  const list = B.nodes.filter((n) => n.owner !== u.team); if (!list.length) return bgDefNode(B, u, B.nodes);
  return list.sort((a, b) => bgDist(a, u) - bgDist(b, u))[0];
}
/* the own point to guard: one being taken first, else the one with the fewest guards (the most forward in Alterac) */
function bgDefNode(B, u, pts) {
  const own = pts.filter((n) => n.owner === u.team); if (!own.length) return B.key === 'ab' ? bgCapNode(B, u) : pts[u.team === 'Alliance' ? pts.length - 1 : 0];
  const hit = own.filter((n) => n.capTeam && n.capTeam !== u.team).sort((a, b) => bgDist(a, u) - bgDist(b, u))[0]; if (hit) return hit;
  const guards = (n) => B.units.filter((x) => x.alive && x.team === u.team && x.node === n).length;
  if (B.key === 'av') { const fwd = u.team === 'Alliance' ? own[0] : own[own.length - 1]; return guards(fwd) < 8 ? fwd : own.sort((a, b) => guards(a) - guards(b))[0]; }
  return own.sort((a, b) => guards(a) - guards(b) || bgDist(a, u) - bgDist(b, u))[0];
}
/* flags, bases, graveyards; the score */
function bgObjectives(B, dt, T) {
  const def = B.def;
  if (B.key === 'wsg') {
    for (const team of ['Alliance', 'Horde']) {
      const foe = team === 'Alliance' ? 'Horde' : 'Alliance'; const ff = def.flag[foe], mine = def.flag[team];
      // taking the enemy flag
      if (!B.flag[foe].carrier) { const u = B.units.find((x) => x.alive && x.team === team && !x.carry && Math.hypot(x.x - ff[0], x.y - ff[1]) < 5); if (u) { u.carry = foe; u.carryT = G.gameTime; u.stealth = false; if (u.form === 'cheetah') u.form = null; if (u.st) { u.st.immune = 0; u.st.iceblock = 0; } B.flag[foe].carrier = u.id; bgNote(B, u.name + ' (' + team + ') took the ' + foe + ' flag!'); } }
      // bringing it home while the own flag is there
      const car = B.units.find((x) => x.alive && x.carry === foe && x.team === team);
      if (car && !B.flag[team].carrier && Math.hypot(car.x - mine[0], car.y - mine[1]) < 6) {
        car.carry = null; car.oa++; B.flag[foe].carrier = null; B.score[team]++; if (!B.firstCap) B.firstCap = team;
        bgNote(B, car.name + ' captured the ' + foe + ' flag! ' + team + ' ' + B.score[team] + ' : ' + B.score[foe]);
        for (const u of B.units) if (u.team === team && !u.general) bgGive(u, 40 * bgUScale(u));
        if (B.score[team] >= 3) bgFinish(B, team, '3 captures');
      }
    }
  }
  if (B.key === 'ab' || B.key === 'av') {
    const pts = B.key === 'ab' ? B.nodes : B.gys;
    for (const n of pts) {
      const near = B.units.filter((u) => u.alive && !u.general && Math.abs(u.x - n.x) < 14 && Math.abs(u.y - n.y) < 14 && Math.hypot(u.x - n.x, u.y - n.y) < 14);
      const teams = new Set(near.map((u) => u.team));
      if (teams.size === 1) {
        const t = [...teams][0];
        if (n.owner !== t) { if (n.capTeam !== t) { n.capTeam = t; n.capT = 0; } n.capT += dt;
          if (n.capT >= (B.key === 'ab' ? 12 : 15)) { n.owner = t; n.capT = 0; n.capTeam = null; bgNote(B, t + ' took the ' + n.n + '.'); for (const u of near) { u.oa++; bgGive(u, 20 * bgUScale(u)); } } }
        else if (n.capTeam) { n.capT = 0; n.capTeam = null; }
      } else if (teams.size > 1) {
        // an assault broken up by the owners: they defended it
        if (n.capTeam && n.owner && n.owner !== n.capTeam && n.capT > 1) { for (const u of near) if (u.team === n.owner) { u.od++; bgGive(u, 10 * bgUScale(u)); } bgNote(B, n.owner + ' defended the ' + n.n + '.'); }
        n.capT = 0; n.capTeam = null;
      } else if (n.capTeam) { n.capT = Math.max(0, n.capT - dt); if (!n.capT) n.capTeam = null; }
    }
  }
  if (B.key === 'ab') {
    B.resT += dt; if (B.resT >= 1) { B.resT -= 1; const RATE = [0, 0.8, 1.1, 1.7, 3.3, 10];
      for (const t of ['Alliance', 'Horde']) { const k = B.nodes.filter((n) => n.owner === t).length; B.res[t] = Math.min(2000, B.res[t] + RATE[k] * 2); if (B.res[t] >= 2000 && !B.over) bgFinish(B, t, '2000 resources'); } }
  }
}
/* when the time runs out: Warsong Gulch - more captures, on a tie the first capture; Arathi Basin - more resources;
   Alterac Valley - more reinforcements */
function bgTimeWinner(B) {
  if (B.key === 'wsg') return B.score.Alliance === B.score.Horde ? B.firstCap : B.score.Alliance > B.score.Horde ? 'Alliance' : 'Horde';
  if (B.key === 'ab') return B.res.Alliance === B.res.Horde ? null : B.res.Alliance > B.res.Horde ? 'Alliance' : 'Horde';
  if (B.key === 'av') return B.reinf.Alliance === B.reinf.Horde ? null : B.reinf.Alliance > B.reinf.Horde ? 'Alliance' : 'Horde';
  return null;
}
function bgHonorScale(c) { return Math.max(0.15, Math.min(1, c.level / 60)); }
function bgFinish(B, winner, why) {
  if (B.over) return; B.over = { winner, t: G.gameTime, why };
  bgNote(B, (winner ? winner + ' wins' : 'A draw') + ' (' + why + ').');
  const base = { wsg: [360, 120], ab: [450, 150], av: [700, 250] }[B.key];
  for (const u of B.units) {
    if (u.general) continue; const won = winner === u.team;
    const extra = B.key === 'ab' ? Math.floor(B.res[u.team] / 330) * 30 : B.key === 'av' ? B.gys.filter((g) => g.owner === u.team).length * 25 : B.score[u.team] * 30;
    bgGive(u, bgUScale(u) * ((won ? base[0] : base[1]) + extra));
    if (!u.c || rt(u.c).bg !== B) continue; const c = u.c; const P = pvpOf(c);
    P.played++; if (won) P.won++;
    P.hist.unshift({ bg: B.key, won, draw: !winner, hks: u.hks, deaths: u.deaths, honor: Math.round(u.honor), t: Date.now() }); P.hist = P.hist.slice(0, 15);
    withLogC(c, () => log(B.def.name + ': ' + (winner ? (won ? 'Victory!' : 'Defeat.') : 'Draw.') + ' ' + u.kills + ' killing blows, ' + u.hks + ' honorable kills, ' + u.deaths + ' deaths, +' + Math.round(u.honor) + ' honor (rank: ' + pvpRankName(c) + ').'));
  }
  save();
}
/* the battleground closes: everyone still in it goes back */
function bgEnd(B) {
  for (const u of B.units) if (u.c && rt(u.c).bg === B) bgLeaveChar(u.c, false);
  G.bgs = (G.bgs || []).filter((x) => x !== B);
}
function bgLeaveChar(c, early) {
  const r = rt(c); const B = r.bg; r.bg = null; r.tgt = null; r.threats = []; r.mv = null;
  const back = c.bgReturn; delete c.bgReturn;
  if (back) c.pos = { map: back.map, x: back.x, y: back.y, z: back.z || 0, o: c.pos.o };
  c.hp = charStats(c).maxHp; if (usesMana(c)) c.mana = charStats(c).maxMana;
  c.order = c.bgResume || null; delete c.bgResume; if (c.order && typeof resumeOrder === 'function') resumeOrder(c, c.order);
  if (B) {
    if (early && !B.over) { const u = B.units.find((x) => x.c === c); if (u) { u.c = null; u.name += ' (left)'; } withLogC(c, () => log('Left ' + B.def.name + ' early - no bonus honor.')); }
    if (!B.units.some((x) => x.c && rt(x.c).bg === B)) G.bgs = (G.bgs || []).filter((x) => x !== B);
  }
  if (typeof loadGrid === 'function') loadGrid(c.pos.map);
  if (isActive(c) && !G.headless && typeof goToCharacter === 'function') goToCharacter();
  save(); renderOrder();
}
function bgLeave(c) { const g = typeof groupOf === 'function' ? groupOf(c) : null; const B = rt(c).bg; for (const x of g ? groupChars(g) : [c]) if (rt(x).bg && rt(x).bg === B) bgLeaveChar(x, true); }
/* a game loaded in the middle of a battleground: back out */
function pvpMigrate(c) { if (c.bgReturn && !rt(c).bg) { const b = c.bgReturn; c.pos = { map: b.map, x: b.x, y: b.y, z: b.z || 0, o: 0 }; c.order = c.bgResume || null; delete c.bgReturn; delete c.bgResume; } if (c.pvp) delete c.pvp.q; }
function bgOrderText(c) {
  const B = rt(c).bg; if (!B) return { t: 'Battleground', d: '' };
  return { t: B.def.name, d: B.over ? (B.over.winner ? B.over.winner + ' wins' : 'Draw') + ' - the scoreboard' : bgScoreText(B) + ' - ' + fmtTime(G.gameTime - B.t0) };
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
  if (B.key === 'wsg') for (const t of ['Alliance', 'Horde']) { const f = B.def.flag[t]; const [x, y] = w2s(f[0], f[1]); bgFlagIcon(ctx, x, y, BG_TEAM_COL[t], !B.flag[t].carrier, 1.4); }
  const pts = B.key === 'ab' ? B.nodes : B.key === 'av' ? B.gys : [];
  ctx.font = 'bold 10px Segoe UI';
  for (const n of pts) {
    const [x, y] = w2s(n.x, n.y); const col = n.owner ? BG_TEAM_COL[n.owner] : '#bbb';
    ctx.fillStyle = '#000a'; ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.3); ctx.fill(); ring(x, y, 9, col, 3);
    if (n.capTeam) { ctx.strokeStyle = BG_TEAM_COL[n.capTeam]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 13, -1.57, -1.57 + 6.283 * n.capT / (B.key === 'ab' ? 12 : 15)); ctx.stroke(); }
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.strokeText(n.n, x, y - 13); ctx.fillText(n.n, x, y - 13);
  }
  // the dead, waiting at the graveyards for the next wave
  if (!B.over) { const wv = Math.ceil(bgNextWave(B) - G.gameTime); const at = new Map();
    for (const u of B.units) if (!u.alive && !u.general) { const g = bgNearestGy(B, u.team, u.x, u.y); const k = g[0] + ',' + g[1] + u.team; const e = at.get(k) || { x: g[0], y: g[1], n: 0, t: u.team }; e.n++; at.set(k, e); }
    ctx.font = 'bold 10px Segoe UI'; ctx.lineWidth = 3;
    for (const e of at.values()) { const [x, y] = w2s(e.x, e.y); const s = e.n + ' dead \u00b7 ' + wv + 's'; ctx.strokeStyle = '#000'; ctx.strokeText(s, x, y + 20); ctx.fillStyle = BG_TEAM_COL[e.t]; ctx.fillText(s, x, y + 20); } }
  bgDrawGround(ctx, B);
  // the fighters (your own characters are drawn by the map itself): bigger icons, and the ones on top of each other
  // spread a little on screen only (their places in the battleground stay the same)
  const R = Math.max(10, Math.min(20, bgPpy() * 4.5)); const pos = bgLayout(B, R);
  for (const u of B.units) {
    if (!u.alive) continue; const p = pos.get(u); if (!p) continue; const [x, y] = p; const own = u.c && rt(u.c).bg === B;
    if (own) { bgDrawStatus(ctx, u, x, y, R); continue; }
    const r = u.general ? R + 5 : R;
    ctx.globalAlpha = u.stealth ? 0.4 : 1;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 6.3); ctx.fill();
    if (!drawClassIcon(ctx, u.cls, x, y, r)) { ctx.fillStyle = BG_TEAM_COL[u.team]; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); }
    ring(x, y, r + 1.5, BG_TEAM_COL[u.team], u.general ? 3.5 : 2.5);
    if (u.heal) { ctx.fillStyle = '#000'; ctx.fillRect(x + r - 5, y + r - 5, 8, 8); ctx.fillStyle = '#5eff7a'; ctx.fillRect(x + r - 4, y + r - 2, 6, 2); ctx.fillRect(x + r - 2, y + r - 4, 2, 6); }
    const bw = r * 2.4; ctx.fillStyle = '#000'; ctx.fillRect(x - bw / 2 - 1, y - r - 8, bw + 2, 5); ctx.fillStyle = u.team === B.side ? '#3fae5a' : '#d64a3a'; ctx.fillRect(x - bw / 2, y - r - 7, bw * Math.max(0, u.hp / u.maxhp), 3);
    ctx.globalAlpha = 1;
    bgDrawStatus(ctx, u, x, y, r);
    if (u.carry) bgFlagIcon(ctx, x + r * 0.8, y - r - 4, BG_TEAM_COL[u.carry], true, 0.9);
  }
  // what is picked in the raid panel: a gold ring
  if (RAID.show && B.side) { const sl = RAID.sel; ctx.strokeStyle = '#ffd866'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    for (const u of B.units) if (u.alive && u.team === B.side && !u.general && (sl.kind === 'unit' ? String(u.id) === sl.id : sl.kind === 'grp' ? u.grp === +sl.id : false)) { const p = pos.get(u); if (!p) continue; ctx.beginPath(); ctx.arc(p[0], p[1], R + 6, 0, 6.3); ctx.stroke(); }
    ctx.setLineDash([]); }
  for (const u of B.units) if (u.c && u.carry && u.alive) { const [x, y] = w2s(u.x, u.y); bgFlagIcon(ctx, x + 9, y - 12, BG_TEAM_COL[u.carry], true, 0.7); }
  ctx.restore();
}
/* where each fighter is drawn: its place on screen, pushed apart from the ones it overlaps (smoothly, a little) */
function bgLayout(B, R) {
  const pts = []; for (const u of B.units) if (u.alive) { const [x, y] = w2s(u.x, u.y); pts.push({ u, x, y, ox: 0, oy: 0, fix: !!(u.c && rt(u.c).bg === B) }); }
  const D = R * 2.1;
  for (let it = 0; it < 5; it++) for (let i = 0; i < pts.length; i++) { const a = pts[i];
    for (let j = i + 1; j < pts.length; j++) { const b = pts[j]; const dx = b.x + b.ox - a.x - a.ox, dy = b.y + b.oy - a.y - a.oy; if (Math.abs(dx) >= D || Math.abs(dy) >= D) continue; const d = Math.hypot(dx, dy); if (d >= D) continue;
      const nx = d > 0.01 ? dx / d : Math.cos(i * 2.4 + j), ny = d > 0.01 ? dy / d : Math.sin(i * 2.4 + j); const push = (D - d) / (a.fix || b.fix ? 1 : 2);
      if (!a.fix) { a.ox -= nx * push; a.oy -= ny * push; } if (!b.fix) { b.ox += nx * push; b.oy += ny * push; } } }
  const out = new Map(); const cap = R * 4;
  for (const p of pts) { const m = Math.hypot(p.ox, p.oy); if (m > cap) { p.ox *= cap / m; p.oy *= cap / m; } const u = p.u; u.lx = (u.lx || 0) * 0.75 + p.ox * 0.25; u.ly = (u.ly || 0) * 0.75 + p.oy * 0.25; out.set(u, [p.x + u.lx, p.y + u.ly]); }
  return out;
}
function bgFlagIcon(ctx, x, y, col, up, k) {
  k = k || 1; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + 9 * k); ctx.lineTo(x, y - 9 * k); ctx.stroke();
  ctx.globalAlpha = up ? 1 : 0.35; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 9 * k); ctx.lineTo(x + 10 * k, y - 5 * k); ctx.lineTo(x, y - 1 * k); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ the battleground card (right side) */
function renderBgCard() {
  const el = $('bgCard'); if (!el) return; const c = active(); const r = rt(c); const B = r.bg; const q = c.pvp && c.pvp.q;
  const rb = $('btnRaid'); if (rb) { rb.hidden = !B; rb.classList.toggle('on', !!(B && RAID.show)); }
  renderRaidCtl(); renderBgScore();
  if (!B && !q) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; el._h = ''; } return; }
  el.hidden = false; let h = '';
  if (q && !B) { const bg = BGS[q.bg]; h = '<h3>PvP</h3><div class="small">In the queue for <b>' + esc(bg.name) + '</b> (' + fmtTime(G.gameTime - q.t0) + ')' + (cset(c, 'autoBg') ? ' &middot; auto' : '') + '</div><button class="mini" data-bgq="leave">Leave queue</button>'; }
  else {
    const me = B.units.find((u) => u.c === c);
    h = '<h3>' + esc(B.def.name) + ' <span class="small muted">' + fmtTime((B.over ? B.over.t : G.gameTime) - B.t0) + '</span></h3><div class="small">' + esc(bgScoreText(B)) + '</div>';
    if (B.over) h += '<div class="bgres ' + (B.over.winner === B.side ? 'won' : 'lost') + '">' + (B.over.winner ? (B.over.winner === B.side ? 'Victory!' : 'Defeat') : 'Draw') + '</div><div class="small muted">' + (cset(c, 'autoBg') ? 'Leaving after the scoreboard (auto battlegrounds)' : 'Press Leave battleground to go on') + '</div>';
    if (!B.over) h += '<div class="small rc-wave">Resurrection wave in ' + Math.ceil(bgNextWave(B) - G.gameTime) + 's' + bgDeadText(B, B.side) + '</div>';
    if (me) h += '<div class="small">You: ' + me.kills + ' killing blows, ' + me.hks + ' honorable kills, ' + me.deaths + ' deaths, +' + Math.round(me.honor) + ' honor' + (me.alive || B.over ? '' : ' - <span style="color:#ff6a5a">dead, at the graveyard - back in ' + Math.ceil(Math.max(0, me.resAt - G.gameTime)) + 's</span>') + '</div>';
    if (me && !B.over) { const o = bgOrdOf(B, me); h += '<div class="small">Order: <b>' + esc((bgOrders(B).find((x) => x[0] === o) || ['', 'Auto'])[1]) + '</b></div>'; }
    h += '<div class="bglog">' + B.logs.slice(0, 4).map(([t, s]) => '<div class="small muted">' + fmtTime(t - B.t0) + ' ' + esc(s) + '</div>').join('') + '</div>';
    h += '<button class="mini" data-bgq="raid">Raid</button> <button class="mini" data-bgq="score">Scoreboard</button> <button class="mini red" data-bgq="out">Leave battleground</button>';
  }
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
  el.onclick = (e) => { const b = e.target.closest('[data-bgq]'); if (!b) return; const d = b.dataset.bgq;
    if (d === 'leave') bgLeaveQueue(active()); else if (d === 'out') bgLeaveNow(active()); else if (d === 'raid') toggleRaid(); else if (d === 'score') { SCORE.show = !SCORE.show; SCORE.forced = SCORE.show; }
    renderBgCard(); };
}

/* ------------------------------------------------------------------ the scoreboard */
const SCORE = { show: false, sort: 'kills', team: 'all', forced: false };
function bgK(v) { v = Math.round(v); return v >= 100000 ? Math.round(v / 1000) + 'K' : v.toLocaleString(); }
function bgObjCols(B) { return B.key === 'wsg' ? ['Flags Captured', 'Flags Returned'] : B.key === 'ab' ? ['Bases Assaulted', 'Bases Defended'] : ['Graveyards Assaulted', 'Graveyards Defended']; }
function renderBgScore() {
  let el = $('bgScore'); const c = active(); const B = rt(c).bg;
  if (B && B.over && !B.scoreShown) { B.scoreShown = true; SCORE.show = true; if (!cset(c, 'autoBg') && !G.headless) { SCORE.paused = true; SCORE.prevSpeed = G.state.settings.speed || G.lastSpeed || 1; setSpeed(0); } }
  const manual = B && B.over && !cset(c, 'autoBg'); if (manual) SCORE.show = true;          /* stays up until Leave */
  if (!B || !SCORE.show) { if (el && !el.hidden) { el.hidden = true; el._h = ''; } if (!B) SCORE.show = false; return; }
  if (!el) { el = document.createElement('div'); el.id = 'bgScore'; $('mapwrap').appendChild(el); el.addEventListener('pointerdown', bgScoreClick); }
  const oc = bgObjCols(B);
  const cols = [['kills', 'Killing Blows'], ['deaths', 'Deaths'], ['hks', 'Honorable Kills'], ['dmg', 'Damage Done'], ['healed', 'Healing Done'], ['oa', oc[0]], ['od', oc[1]], ['honor', 'Honor Gained']];
  const list = B.units.filter((u) => !u.general && (SCORE.team === 'all' || u.team === SCORE.team)).sort((a, b) => (b[SCORE.sort] || 0) - (a[SCORE.sort] || 0) || b.kills - a.kills);
  const title = B.over ? (B.over.winner ? B.over.winner + ' Wins' : 'Draw') : B.def.name;
  let h = '<div class="bs-title ' + (B.over && B.over.winner ? B.over.winner.toLowerCase() : '') + '">' + esc(title) + (manual ? '' : '<button class="mini" data-bsclose="1" title="Close">&#10005;</button>') + '</div>' +
    '<div class="bs-tabs">' + [['all', 'All'], ['Alliance', 'Alliance'], ['Horde', 'Horde']].map(([k, t]) => '<button class="mini' + (SCORE.team === k ? ' on' : '') + '" data-bsteam="' + k + '">' + t + '</button>').join('') + '<span class="small muted">' + esc(bgScoreText(B)) + '</span></div>' +
    '<div class="bs-wrap"><table class="bs"><thead><tr><th class="bs-n">Name</th>' + cols.map(([k, t]) => '<th data-bssort="' + k + '"' + (SCORE.sort === k ? ' class="on"' : '') + '>' + t + '</th>').join('') + '</tr></thead><tbody>';
  for (const u of list) {
    const me = u.c && G.state.characters.includes(u.c);
    h += '<tr class="' + u.team.toLowerCase() + (me ? ' me' : '') + '"><td class="bs-n"><img src="img/class/' + u.cls + '.png" alt=""><b class="bs-rk" title="' + esc(bgRankName(u)) + '">' + (u.rank || '') + '</b><span style="color:' + (CLASS_COLOR[u.cls] || '#fff') + '" title="' + esc(bgRankName(u) + ' - level ' + u.level + (u.skill != null ? ' - skill ' + u.skill + '/10' : '')) + '">' + esc(u.name) + '</span></td>' +
      cols.map(([k]) => '<td>' + (k === 'dmg' || k === 'healed' || k === 'honor' ? bgK(u[k] || 0) : (u[k] || 0)) + '</td>').join('') + '</tr>';
  }
  const n = (t) => B.units.filter((u) => u.team === t && !u.general).length;
  h += '</tbody></table></div><div class="bs-foot"><span class="small">' + n('Alliance') + ' Alliance Players / ' + n('Horde') + ' Horde Players<br>Time Elapsed: ' + Math.floor(((B.over ? B.over.t : G.gameTime) - B.t0) / 60) + ' Min</span>' +
    (B.over ? '<span class="small bs-close">' + (manual ? 'Game paused - press Leave Battleground to go on' : 'Leaving in ' + Math.max(0, Math.ceil(BG_AUTO_LEAVE - (G.gameTime - B.over.t))) + 's (auto battlegrounds)') + '</span>' : '<span></span>') + '<button class="act red" data-bsleave="1">Leave Battleground</button></div>';
  if (el._h !== h) { el._h = h; const sc = el.querySelector('.bs-wrap'); const top = sc ? sc.scrollTop : 0; el.innerHTML = h; const sc2 = el.querySelector('.bs-wrap'); if (sc2) sc2.scrollTop = top; }
  el.hidden = false;
}
function bgScoreClick(e) {
  const t = e.target.closest('[data-bsclose],[data-bsteam],[data-bssort],[data-bsleave]'); if (!t) return; e.preventDefault(); const d = t.dataset;
  if (d.bsclose) SCORE.show = false; else if (d.bsteam) SCORE.team = d.bsteam; else if (d.bssort) SCORE.sort = d.bssort; else if (d.bsleave) bgLeaveNow(active());
  renderBgCard();
}

/* Leave Battleground (scoreboard, BG card, PvP window): out, and the game goes on if the scoreboard paused it */
function bgLeaveNow(c) { SCORE.show = false; bgLeave(c); if (SCORE.paused) { SCORE.paused = false; setSpeed(SCORE.prevSpeed || 1); } }
/* ------------------------------------------------------------------ the raid panel: orders for groups and players */
const RAID = { show: false, sel: { kind: 'raid', id: null } };
function toggleRaid() { RAID.show = !RAID.show; G.state.settings.raidPanel = RAID.show; save(); if (RAID.show && window.matchMedia && matchMedia('(max-width: 900px), (pointer: coarse) and (max-width: 1100px)').matches) { const b = document.querySelector('#mnav [data-p="left"]'); if (b) b.click(); } renderBgCard(); }
function renderRaidCtl() {
  const el = $('raidCtl'); if (!el) return; const c = active(); const B = rt(c).bg; const logC = $('logCard');
  if (!B || !RAID.show) { if (!el.hidden) { el.hidden = true; el._h = ''; } if (logC && logC.hidden) logC.hidden = false; return; }
  if (!el._bound) { el._bound = true; el.addEventListener('pointerdown', raidClick); }
  if (logC && !logC.hidden) logC.hidden = true;          /* the raid panel takes the place of the log while it is open */
  const S = bgStrat(B.key); const n = bgGroups(B); const mine = B.units.filter((u) => u.team === B.side && !u.general); const ords = bgOrders(B);
  if (RAID.sel.kind === 'unit' && !mine.some((u) => String(u.id) === RAID.sel.id)) RAID.sel = { kind: 'raid', id: null };
  const sel = RAID.sel; const nm = (o) => (ords.find((x) => x[0] === o) || ['', 'Auto'])[1];
  let h = '<div class="rc-head"><b>Raid</b><span class="small muted">' + esc(B.def.name) + '</span><button class="mini" data-rcscore="1">Score</button><button class="mini" data-rcclose="1" title="Close (back to the log)">&#10005;</button></div>' +
    '<div class="small muted">' + esc(bgScoreText(B)) + '</div>' + (B.over ? '' : '<div class="small rc-wave">Resurrection wave in ' + Math.ceil(bgNextWave(B) - G.gameTime) + 's' + bgDeadText(B, B.side) + '</div>');
  h += '<div class="rc-strat"><span class="small muted">Strategy</span>' + bgStrategies(B).map(([t, tip, g]) => '<button class="mini" data-rcstrat="' + esc(t) + '" title="' + esc(tip) + '">' + esc(t) + '</button>').join('') + '</div>';
  h += '<div class="rc-grid' + (n > 4 ? ' many' : '') + '">';
  for (let g = 1; g <= n; g++) {
    const go = S.grp[g] || 'auto';
    h += '<div class="rc-g"><div class="rc-gh' + (sel.kind === 'grp' && +sel.id === g ? ' sel' : '') + '" data-rcg="' + g + '">Group ' + g + (go !== 'auto' ? ' <em>' + esc(bgOrdShort(B, go)) + '</em>' : '') + '</div>';
    for (const u of mine.filter((x) => x.grp === g)) {
      const own = (u.c && S.chars[u.c.id]) || B.uord[u.id]; const col = CLASS_COLOR[u.cls] || '#bbb'; const me = u.c && G.state.characters.includes(u.c);
      h += '<div class="rc-m' + (sel.kind === 'unit' && sel.id === String(u.id) ? ' sel' : '') + (u.alive ? '' : ' dead') + (me ? ' me' : '') + '" data-rcu="' + esc(u.id) + '" title="' + esc(u.name + ' - level ' + u.level + ' ' + (CLASS_NAMES[u.cls] || '') + (u.heal ? ' (healer)' : '') + ' - ' + bgRankName(u) + (u.skill != null ? ', skill ' + u.skill + '/10' : '') + ' - ' + nm(bgOrdOf(B, u))) + '">' +
        '<i style="width:' + Math.max(0, 100 * u.hp / u.maxhp) + '%;background:' + col + '"></i><span>' + (me ? '&#9733;' : '') + (u.heal ? '<b class="rc-h">+</b>' : '') + esc(u.name) + '</span>' + (own ? '<em>' + esc(bgOrdShort(B, own)) + '</em>' : u.carry ? '<em>&#9873;</em>' : '') + '</div>';
    }
    h += '</div>';
  }
  h += '</div>';
  let cur, who;
  if (sel.kind === 'raid') { who = 'the whole raid'; const v = new Set(); for (let g = 1; g <= n; g++) v.add(S.grp[g] || 'auto'); cur = v.size === 1 ? [...v][0] : null; }
  else if (sel.kind === 'grp') { who = 'Group ' + sel.id; cur = S.grp[sel.id] || 'auto'; }
  else { const u = mine.find((x) => String(x.id) === sel.id); who = u.name; cur = bgOrdOf(B, u); }
  h += '<div class="rc-sel"><span>Orders for <b>' + esc(who) + '</b></span>' + (sel.kind !== 'raid' ? '<button class="mini" data-rcall="1">Whole raid</button>' : '') + '</div><div class="rc-ords">' +
    ords.map(([k, t, tip]) => '<button class="mini' + (cur === k ? ' on' : '') + '" data-rco="' + k + '" title="' + esc(tip) + '">' + esc(t) + '</button>').join('') + '</div>' +
    '<div class="small muted">Click a group or a player, then an order. Orders and strategies are kept for the next ' + esc(B.def.name) + '.</div>';
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
  el.hidden = false;
}
function raidClick(e) {
  const c = active(); const B = rt(c).bg; if (!B) return;
  const t = e.target.closest('[data-rcclose],[data-rcscore],[data-rcstrat],[data-rcg],[data-rcu],[data-rco],[data-rcall]'); if (!t) return; e.preventDefault(); const d = t.dataset;
  if (d.rcclose) { toggleRaid(); return; }
  if (d.rcscore) { SCORE.show = !SCORE.show; }
  else if (d.rcstrat) { const s = bgStrategies(B).find((x) => x[0] === d.rcstrat); if (s) { bgApplyStrategy(B, s[2]); withLogC(c, () => log('Raid strategy: ' + s[0] + ' - ' + s[1] + '.')); } }
  else if (d.rcg) RAID.sel = RAID.sel.kind === 'grp' && RAID.sel.id === d.rcg ? { kind: 'raid', id: null } : { kind: 'grp', id: d.rcg };
  else if (d.rcu) RAID.sel = RAID.sel.kind === 'unit' && RAID.sel.id === d.rcu ? { kind: 'raid', id: null } : { kind: 'unit', id: d.rcu };
  else if (d.rcall) RAID.sel = { kind: 'raid', id: null };
  else if (d.rco) bgSetOrder(B, RAID.sel, d.rco);
  renderBgCard();
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
    const ak = bgAutoKey(c); const on = !!cset(c, 'autoBg');
    h += '<div class="bgrow bgauto"><div class="bgname">Auto battlegrounds</div><label class="chk"><input type="checkbox" data-bgauto="1"' + (on ? ' checked' : '') + '> Queue by itself, and again after every match (leaves the scoreboard after ' + BG_AUTO_LEAVE + ' seconds)</label>' +
      '<div class="bgpick">' + [['any', 'Any I can join']].concat(Object.keys(BGS).map((k) => [k, BGS[k].name])).map(([k, t]) => '<button class="mini' + (ak === k ? ' on' : '') + '" data-bgakey="' + k + '">' + esc(t) + '</button>').join('') + '</div></div>';
    return h + '<div class="small muted">While in the queue your character keeps doing what it does; it goes in when the queue pops (not in a fight, a dungeon or a flight). Inside, the Raid panel gives orders to groups and players.</div></div>';
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
  const c = active(); const t = e.target.closest('[data-bgjoin],[data-bgleaveq],[data-bgout],[data-hbuy],[data-bgauto],[data-bgakey]'); if (!t) return false; const d = t.dataset;
  if (d.bgauto) { if (e.type !== 'click' || e.target !== t) return true; c.auto = c.auto || {}; c.auto.autoBg = t.checked; if (!t.checked && c.pvp && c.pvp.q && c.pvp.q.lead === c.id) bgLeaveQueue(c); save(); renderSheet(); renderBgCard(); if (typeof renderSettingsCard === 'function') renderSettingsCard(); return true; }
  if (d.bgakey) { c.auto = c.auto || {}; c.auto.autoBgKey = d.bgakey; save(); renderSheet(); return true; }
  if (d.bgjoin) bgQueue(c, d.bgjoin); else if (d.bgleaveq) bgLeaveQueue(c); else if (d.bgout) bgLeaveNow(c); else if (d.hbuy) honorBuy(c, +d.hbuy);
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
