'use strict';
/* pullplan.js - the pull plan of a dungeon, worked out once from the creatures in it:
   - packs: creatures standing together (they come together when one is pulled);
   - the route: from the way in to every boss, in the order a group goes (along the walking paths of the dungeon);
   - for every pack: on the way (must be fought), close to the way (careful - a careless group pulls it) or off the
     way (a group that knows the place walks past);
   - crowd control: which classes can take members of a pack out of the fight (Sap, Polymorph, Shackle ...).
   The runs use it as the walls of the dungeons get real (then experienced groups follow the plan, beginners do not). */

const CC_SPELLS = [
  { cls: 4, n: 'Sap', types: [7], ooc: true }, { cls: 8, n: 'Polymorph', types: [7, 1] }, { cls: 5, n: 'Shackle Undead', types: [6] },
  { cls: 9, n: 'Banish', types: [3, 4] }, { cls: 9, n: 'Seduction', types: [7] }, { cls: 11, n: 'Hibernate', types: [1, 2] },
  { cls: 3, n: 'Freezing Trap', types: [1, 2, 3, 4, 5, 6, 7, 9, 10] }, { cls: 2, n: 'Turn Undead', types: [6] },
];
const CREATURE_TYPE = { 1: 'beast', 2: 'dragonkin', 3: 'demon', 4: 'elemental', 5: 'giant', 6: 'undead', 7: 'humanoid', 8: 'critter', 9: 'mechanical', 10: 'not specified', 11: 'totem' };
const PACK_COLOR = { boss: '#c77dff', pull: '#ff5a4a', careful: '#ffb03a', skip: '#8a8a8a' };

function dungeonPullPlan(d) {
  G.pullPlans = G.pullPlans || {}; if (G.pullPlans[d.map]) return G.pullPlans[d.map];
  const W = ensureWorld(d.map); const L = d.lmin || 1; const bossE = new Set(d.bosses.map((b) => b.e));
  const mobs = W.list.filter((m) => m.info && !m.civ && m.info[5] !== 8 && m.info[5] !== 11 && G.d.hostility.creatures[m.e] && G.d.hostility.creatures[m.e][1].indexOf('A') >= 0);
  // packs: union of creatures within 10 yards (and about the same height)
  const par = mobs.map((_, i) => i); const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < mobs.length; i++) for (let j = i + 1; j < mobs.length; j++) {
    const a = mobs[i], b = mobs[j]; if (Math.abs(a.hx - b.hx) > 10 || Math.abs(a.hy - b.hy) > 10) continue;
    if (Math.hypot(a.hx - b.hx, a.hy - b.hy) <= 10 && Math.abs((a.z || 0) - (b.z || 0)) < 6) par[find(i)] = find(j);
  }
  const groups = new Map(); mobs.forEach((m, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); });
  const packs = [];
  for (const ms of groups.values()) {
    const n = ms.length; const p = { members: ms, n, x: ms.reduce((s, m) => s + m.hx, 0) / n, y: ms.reduce((s, m) => s + m.hy, 0) / n, z: ms.reduce((s, m) => s + (m.z || 0), 0) / n,
      elites: ms.filter((m) => m.rank >= 1).length, boss: ms.some((m) => bossE.has(m.e)), lvl: [Math.min(...ms.map((m) => m.lvl)), Math.max(...ms.map((m) => m.lvl))], types: {} };
    for (const m of ms) p.types[m.info[5]] = (p.types[m.info[5]] || 0) + 1;
    p.aggro = Math.max(...ms.map((m) => clamp((m.aggro - (L - m.lvl)) * AGGRO_SCALE, 4, 32)));
    p.cc = CC_SPELLS.filter((s) => ms.some((m) => s.types.includes(m.info[5])) && !ms.every((m) => bossE.has(m.e))).map((s) => ({ cls: s.cls, n: s.n, ooc: !!s.ooc, k: ms.filter((m) => s.types.includes(m.info[5]) && !bossE.has(m.e)).length }));
    packs.push(p);
  }
  // the route: the guide route of the dungeon (dungeon_walls.json) when there is one, else from the way in to the nearest
  // boss left, and on (by the walking paths)
  const gw = G.dgWalls && G.dgWalls[String(d.map)];
  if (gw && gw.routes && gw.routes.length) return (G.pullPlans[d.map] = pullPlanFrom(d, packs, gw.routes));
  if (!G.dgWalls) loadDungeonWalls();
  const e0 = d.enter[0]; const walker = { pos: { map: d.map, x: e0.x, y: e0.y, z: e0.z }, rt: {} };
  const route = [{ x: e0.x, y: e0.y, z: e0.z }]; const left = packs.filter((p) => p.boss); const order = [];
  while (left.length) {
    let bi = 0, bd = Infinity, bp = null;
    left.forEach((p, i) => { const path = dungeonPath(walker, walker.pos, { x: p.x, y: p.y, z: p.z }); const len = path.noPath ? Infinity : path.total; if (len < bd || (bd === Infinity && Math.hypot(p.x - walker.pos.x, p.y - walker.pos.y) < Math.hypot(left[bi].x - walker.pos.x, left[bi].y - walker.pos.y))) { bd = len; bi = i; bp = path; } });
    const p = left.splice(bi, 1)[0]; order.push(p);
    for (const q of (bp && !bp.noPath ? bp.pts.slice(1) : [{ x: p.x, y: p.y, z: p.z }])) route.push({ x: q.x, y: q.y, z: q.z != null ? q.z : p.z });
    walker.pos = { map: d.map, x: p.x, y: p.y, z: p.z };
  }
  // where every pack is along the route, and how close to it
  const cum = [0]; for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y));
  for (const p of packs) {
    let best = Infinity, along = 0;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i]; const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy || 1;
      const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1); const qx = a.x + dx * t, qy = a.y + dy * t; const qz = (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t;
      const dd = Math.hypot(p.x - qx, p.y - qy) + Math.max(0, Math.abs(p.z - qz) - 8) * 3;
      if (dd < best) { best = dd; along = cum[i - 1] + Math.sqrt(L2) * t; }
    }
    p.dist = best; p.along = along;
    p.kind = p.boss ? 'boss' : best < p.aggro + 4 ? 'pull' : best < p.aggro + 14 ? 'careful' : 'skip';
  }
  packs.sort((a, b) => a.along - b.along); let k = 0; for (const p of packs) if (p.kind !== 'skip') p.no = ++k;
  const plan = { packs, route, bosses: order.length, pulls: packs.filter((p) => p.kind === 'pull').length, careful: packs.filter((p) => p.kind === 'careful').length, skip: packs.filter((p) => p.kind === 'skip').length,
    ccPacks: packs.filter((p) => p.kind !== 'skip' && p.kind !== 'boss' && p.n >= 3 && p.cc.length).length, length: Math.round(cum[cum.length - 1] || 0) };
  return (G.pullPlans[d.map] = plan);
}
/* the walls, floors and guide routes of the dungeons (made by make_dungeon_walls.py), loaded once */
function loadDungeonWalls() {
  if (G.dgWallsLoading) return; G.dgWallsLoading = true;
  J('../gamedata/dungeon_walls.json').then((w) => { G.dgWalls = w; G.pullPlans = {}; }).catch(() => { G.dgWalls = {}; });
}
/* the plan along the guide routes: every pack is placed along the way (how far along, how close to it) */
function pullPlanFrom(d, packs, routes) {
  const route = []; const order = [];
  for (const r of routes) {
    r.path.forEach((p, i) => route.push({ x: p[0], y: p[1], z: p[2], cut: i === 0 && route.length > 0 }));
    for (const [bn] of r.stops) { const p = packs.find((k) => k.boss && k.members.some((m) => m.info && m.info[1] === bn)); if (p) order.push(p); }
  }
  const cum = [0]; for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + (route[i].cut ? 0 : Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y)));
  for (const p of packs) {
    let best = Infinity, along = 0;
    for (let i = 1; i < route.length; i++) {
      if (route[i].cut) continue;
      const a = route[i - 1], b = route[i]; const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy || 1;
      const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1); const qx = a.x + dx * t, qy = a.y + dy * t; const qz = (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t;
      const dd = Math.hypot(p.x - qx, p.y - qy) + Math.max(0, Math.abs(p.z - qz) - 8) * 3;
      if (dd < best) { best = dd; along = cum[i - 1] + Math.sqrt(L2) * t; }
    }
    p.dist = best; p.along = along;
    p.kind = p.boss ? (order.includes(p) ? 'boss' : 'skip') : best < p.aggro + 4 ? 'pull' : best < p.aggro + 14 ? 'careful' : 'skip';
  }
  packs.sort((a, b) => a.along - b.along); let k = 0; for (const p of packs) if (p.kind !== 'skip') p.no = ++k;
  return { packs, route, guide: routes.map((r) => r.name), bosses: order.length, pulls: packs.filter((p) => p.kind === 'pull').length, careful: packs.filter((p) => p.kind === 'careful').length, skip: packs.filter((p) => p.kind === 'skip').length,
    ccPacks: packs.filter((p) => p.kind !== 'skip' && p.kind !== 'boss' && p.n >= 3 && p.cc.length).length, length: Math.round(cum[cum.length - 1] || 0) };
}
/* which members of a pack this group can take out, and with what (the classes in the group) */
function packCcFor(p, classes) {
  const out = []; const used = new Set();
  for (const s of CC_SPELLS) { if (!classes.includes(s.cls)) continue; const m = p.members.find((x) => !used.has(x) && s.types.includes(x.info[5]) && !(x.rank >= 3)); if (m) { used.add(m); out.push({ n: s.n, cls: s.cls, m }); } }
  return out;
}
function drawPullPlan(ctx, map) {
  if (!map.dmap || !G.state.settings.showPullPlan) return; const plan = dungeonPullPlan(map.dungeon); const f = map.floor;
  ctx.save();
  // the route
  ctx.strokeStyle = 'rgba(255,210,90,.75)'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 5]); ctx.beginPath(); let on = false;
  for (const q of plan.route) { const inF = dungeonFloorAt(map.dungeon, q.x, q.y, q.z) === f; const [x, y] = w2s(q.x, q.y); if (inF && !q.cut) { if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y); on = true; } else if (inF) { ctx.moveTo(x, y); on = true; } else on = false; }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.font = 'bold 11px Segoe UI';
  for (const p of plan.packs) {
    if (dungeonFloorAt(map.dungeon, p.x, p.y, p.z) !== f) continue;
    const [x, y] = w2s(p.x, p.y); const R = Math.max(6, p.aggro * G.scale * 0.9);
    ctx.globalAlpha = p.kind === 'skip' ? 0.35 : 0.85; ctx.strokeStyle = PACK_COLOR[p.kind]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, Math.min(R, 60), 0, 6.3); ctx.stroke();
    if (p.no) { ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = PACK_COLOR[p.kind]; const t = String(p.no) + (p.n > 1 ? ' (' + p.n + ')' : ''); ctx.strokeText(t, x, y - Math.min(R, 60) - 3); ctx.fillText(t, x, y - Math.min(R, 60) - 3); }
  }
  ctx.restore();
}
function pullPlanHtml(d) {
  const p = dungeonPullPlan(d);
  return '<div class="sgroup"><h5>Pull plan</h5><div class="small">' + (p.guide ? 'Route from the guides: ' + esc(p.guide.join(', ')) + '. ' : '') + (p.pulls + p.bosses) + ' fights on the way (' + p.bosses + ' bosses), ' + p.careful + ' packs close to the way (a careless group pulls them), ' + p.skip + ' off the way. ' + p.ccPacks + ' big packs where crowd control helps.</div>' +
    '<label class="chk"><input type="checkbox" data-dgset="showPullPlan"' + (G.state.settings.showPullPlan ? ' checked' : '') + '> Show it on the dungeon map <span class="small" style="color:' + PACK_COLOR.pull + '">on the way</span> <span class="small" style="color:' + PACK_COLOR.careful + '">careful</span> <span class="small" style="color:' + PACK_COLOR.skip + '">off the way</span></label></div>';
}
