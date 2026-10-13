'use strict';
/* leveling.js - the "Level up" order: picks the best questing zone for the character's level and faction,
   travels there (walking, flight paths it has discovered, zeppelins and boats), quests through it with the
   zone questing logic, and grinds level-appropriate creatures when no zone has quests left for its level. */

const FLY_SPEED = 32;               // yards per second on a flight path (taxi.json speed)
const SHIP_TIME = 150;              // waiting + crossing on a zeppelin or boat (seconds)
const TRANSPORTS = [
  { side: 'Horde', name: 'the zeppelin between Orgrimmar and Undercity', a: { map: 1, x: 1331.1, y: -4649.5 }, b: { map: 0, x: 2064.0, y: 288.6 } },
  { side: 'Horde', name: "the zeppelin between Orgrimmar and Grom'gol", a: { map: 1, x: 1354.0, y: -4642.6 }, b: { map: 0, x: -12441.3, y: 215.0 } },
  { side: 'Horde', name: "the zeppelin between Undercity and Grom'gol", a: { map: 0, x: 2054.6, y: 241.7 }, b: { map: 0, x: -12441.3, y: 215.0 } },
  { side: '', name: 'the boat between Ratchet and Booty Bay', a: { map: 1, x: -985.6, y: -3796.7 }, b: { map: 0, x: -14285.0, y: 554.0 } },
  { side: 'Alliance', name: 'the boat between Menethil Harbor and Theramore', a: { map: 0, x: -3892.0, y: -600.0 }, b: { map: 1, x: -3996.0, y: -4724.0 } },
  { side: 'Alliance', name: 'the boat between Menethil Harbor and Auberdine', a: { map: 0, x: -3725.0, y: -584.0 }, b: { map: 1, x: 6421.0, y: 817.0 } },
  { side: 'Alliance', name: 'the Deeprun Tram between Stormwind and Ironforge', a: { map: 0, x: -8352.0, y: 523.0 }, b: { map: 0, x: -4839.0, y: -1320.0 }, secs: 110 },
  { side: 'Alliance', name: "the boat between Auberdine and Rut'theran Village", a: { map: 1, x: 6544.0, y: 917.0 }, b: { map: 1, x: 8553.0, y: 1020.0 } },
];

function sideOf(c) { const r = G.d.hostility.races.find((x) => x.id === c.race); return r ? r.side : 'Horde'; }
function sideOk(c, side) { return !side || side === sideOf(c); }

/* ------------------------------------------------------------------ flight paths */
function taxiNodesOn(mapId) {
  G.taxiOn = G.taxiOn || {};
  if (!G.taxiOn[mapId]) { G.taxiOn[mapId] = []; for (const id in G.d.taxi.nodes) { const n = G.d.taxi.nodes[id]; if (n.map === mapId && n.npcs && n.npcs.length) G.taxiOn[mapId].push(Object.assign({ id: +id }, n)); } }
  return G.taxiOn[mapId];
}
/* walking past a flight master teaches its flight path */
function taxiDiscover(c) {
  c.taxi = c.taxi || {};
  for (const n of taxiNodesOn(c.pos.map)) {
    if (c.taxi[n.id] || !sideOk(c, n.side)) continue;
    if (Math.abs(n.x - c.pos.x) < 30 && Math.abs(n.y - c.pos.y) < 30 && Math.hypot(n.x - c.pos.x, n.y - c.pos.y) < 30) {
      c.taxi[n.id] = 1; log('Discovered flight path: ' + n.n + '.'); fx(c.pos.x, c.pos.y, 'New flight path', '#9fe0ff');
    }
  }
}
function taxiGraph() {
  if (G.taxiG) return G.taxiG;
  const adj = {};
  for (const e of G.d.taxi.edges) (adj[e.from] = adj[e.from] || []).push(e);
  return (G.taxiG = adj);
}
/* cheapest flight (by time) between two nodes; only through nodes of this character's side. {secs, cost, pts} or null */
function flightRoute(c, a, b) {
  G.flightCache = G.flightCache || {}; const key = sideOf(c) + ':' + a + '>' + b;
  if (key in G.flightCache) return G.flightCache[key];
  const adj = taxiGraph(); const dist = { [a]: 0 }; const prev = {}; const done = new Set(); const q = [[0, a]];
  while (q.length) {
    q.sort((x, y) => x[0] - y[0]); const [d, n] = q.shift(); if (done.has(n)) continue; done.add(n); if (n === b) break;
    for (const e of adj[n] || []) {
      const to = G.d.taxi.nodes[e.to]; if (!to || !sideOk(c, to.side)) continue;
      const nd = d + e.secs + 5; if (nd < (dist[e.to] ?? Infinity)) { dist[e.to] = nd; prev[e.to] = e; q.push([nd, e.to]); }
    }
  }
  if (!(b in dist)) return (G.flightCache[key] = null);
  const chain = []; for (let n = b; n !== a; n = prev[n].from) chain.unshift(prev[n]);
  const pts = []; let cost = 0; for (const e of chain) { cost += e.cost || 0; for (const p of e.pts) pts.push({ x: p[0], y: p[1] }); }
  return (G.flightCache[key] = { secs: dist[b], cost, pts, chain: chain.map((e) => e.to) });
}

/* ------------------------------------------------------------------ trip planning */
/* legs from the character to dest {map, x, y}: walk / fly / ship. Dijkstra over flight masters and ports. */
const CITY_ZONES = new Set(['Orgrimmar', 'Thunder Bluff', 'Undercity', 'Stormwind City', 'Stormwind', 'Ironforge', 'Darnassus']);
/* extra cost (seconds) of walking straight from a to b through zones far above the character's level */
function walkDanger(c, map, a, b) {
  if (typeof zoneAt !== 'function' || !G.d.zoneLevels) return 0;
  G.zoneLvCache = G.zoneLvCache || {};
  const d = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.min(40, Math.ceil(d / 150)); let pen = 0;
  for (let k = 1; k < n; k++) {
    const z = zoneAt(map, a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n); if (!z) continue;
    if (CITY_ZONES.has(z.name)) continue;
    let lv = G.zoneLvCache[z.name];
    if (lv === undefined) { const zl = (G.d.zoneLevels.zones || []).find((x) => x.zone === z.name); lv = G.zoneLvCache[z.name] = zl ? (zl.p10 || zl.min || 0) : 0; }
    if (lv > c.level + 8) pen += Math.min(600, (lv - c.level) * 40);
  }
  return pen;
}
function planTrip(c, dest, opts) {
  opts = opts || {};
  const nodes = [{ k: 'S', map: c.pos.map, x: c.pos.x, y: c.pos.y }, { k: 'D', map: dest.map, x: dest.x, y: dest.y }];
  if (!opts.noFly) for (const id in c.taxi || {}) { const n = G.d.taxi.nodes[id]; if (n && n.npcs && n.npcs.length) nodes.push({ k: 'T', id: +id, map: n.map, x: n.x, y: n.y }); }
  TRANSPORTS.forEach((t, i) => { if (sideOk(c, t.side)) { nodes.push({ k: 'P', t: i, end: 'a', map: t.a.map, x: t.a.x, y: t.a.y }); nodes.push({ k: 'P', t: i, end: 'b', map: t.b.map, x: t.b.x, y: t.b.y }); } });
  const N = nodes.length; const dist = new Array(N).fill(Infinity); const prev = new Array(N).fill(null); const done = new Array(N).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1; for (let i = 0; i < N; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === 1) break; done[u] = true; const a = nodes[u];
    for (let v = 0; v < N; v++) {
      if (done[v] || v === u) continue; const b = nodes[v]; let cost = Infinity, leg = null;
      if (a.map === b.map) { cost = Math.hypot(a.x - b.x, a.y - b.y) / RUN_SPEED * 1.3 + walkDanger(c, a.map, a, b); leg = { kind: 'walk', map: b.map, x: b.x, y: b.y }; }
      if (a.k === 'T' && b.k === 'T') { const f = flightRoute(c, a.id, b.id); if (f && f.secs + 20 < cost && (c.gold || 0) >= f.cost) { cost = f.secs + 20; leg = { kind: 'fly', from: a.id, to: b.id, pts: f.pts, cost: f.cost, secs: f.secs }; } }
      if (a.k === 'P' && b.k === 'P' && a.t === b.t && a.end !== b.end) { cost = TRANSPORTS[a.t].secs || SHIP_TIME; leg = { kind: 'ship', t: a.t, map: b.map, x: b.x, y: b.y }; }
      if (dist[u] + cost < dist[v]) { dist[v] = dist[u] + cost; prev[v] = { u, leg }; }
    }
  }
  if (dist[1] === Infinity) return null;
  const legs = []; for (let v = 1; v !== 0; v = prev[v].u) legs.unshift(prev[v].leg);
  // merge walking legs that follow each other
  const out = []; for (const l of legs) { const last = out[out.length - 1]; if (last && last.kind === 'walk' && l.kind === 'walk' && last.map === l.map) Object.assign(last, l); else out.push(l); }
  return { legs: out, secs: dist[1], i: 0, dest };
}
function tripText(t) {
  const r = rt(active());
  if (r.flying) return 'flying to ' + G.d.taxi.nodes[r.flying.to].n;
  if (r.riding) return 'on ' + r.riding.name + ' (' + fmtTime(r.riding.total - r.riding.t) + ')';
  if (!t) return '';
  const l = t.legs[t.i]; if (!l) return 'arriving';
  if (l.kind === 'walk') return 'walking (' + Math.round(Math.hypot(l.x - active().pos.x, l.y - active().pos.y)) + ' yd)';
  if (l.kind === 'fly') return 'flight to ' + G.d.taxi.nodes[l.to].n;
  return TRANSPORTS[l.t].name;
}
/* one step along a trip. returns 'busy' | 'done' | 'fail' */
function tripStep(c, t) {
  const r = rt(c); const l = t.legs[t.i];
  if (!l) return 'done';
  if (l.kind === 'walk') {
    if (l.map !== c.pos.map) return 'fail';
    const ok = goTo(c, l.x, l.y, 4);
    if (r.blocked) { r.blocked = false; t.fails = (t.fails || 0) + 1; r.mv = null; if (t.fails > 4) return 'fail'; return 'busy'; }
    if (ok) { t.i++; t.fails = 0; }
    return 'busy';
  }
  if (l.kind === 'fly') {
    const n = G.d.taxi.nodes[l.from];
    if (Math.hypot(n.x - c.pos.x, n.y - c.pos.y) > 8) { const ok = goTo(c, n.x, n.y, 4); if (r.blocked) { r.blocked = false; return 'fail'; } if (!ok) return 'busy'; }
    if ((c.gold || 0) < l.cost) { log('Not enough money for the flight to ' + G.d.taxi.nodes[l.to].n + '.'); return 'fail'; }
    c.gold -= l.cost; r.mv = null;
    r.flying = { pts: l.pts.slice(), idx: 0, to: l.to };
    log('Flying to ' + G.d.taxi.nodes[l.to].n + (l.cost ? ' (' + money(l.cost) + ')' : '') + ', about ' + fmtTime(l.secs) + '.');
    t.i++; return 'busy';
  }
  if (l.kind === 'ship') {
    const tr = TRANSPORTS[l.t]; const from = tr.a.map === l.map && tr.a.x === l.x ? tr.b : tr.a;
    if (Math.hypot(from.x - c.pos.x, from.y - c.pos.y) > 6 || from.map !== c.pos.map) { if (from.map !== c.pos.map) return 'fail'; const ok = goTo(c, from.x, from.y, 4); if (r.blocked) { r.blocked = false; return 'fail'; } if (!ok) return 'busy'; }
    r.mv = null; r.riding = { t: 0, total: tr.secs || SHIP_TIME, to: { map: l.map, x: l.x, y: l.y }, name: tr.name };
    log('Taking ' + tr.name + '.'); t.i++; return 'busy';
  }
  return 'fail';
}
/* flying and sailing move the character without any fighting */
function flyStep(c, dt) {
  const r = rt(c); const f = r.flying; let left = FLY_SPEED * dt;
  while (left > 0 && f.idx < f.pts.length) {
    const p = f.pts[f.idx]; const dx = p.x - c.pos.x, dy = p.y - c.pos.y, d = Math.hypot(dx, dy);
    if (d <= left) { c.pos.x = p.x; c.pos.y = p.y; left -= d; f.idx++; } else { c.pos.x += dx / d * left; c.pos.y += dy / d * left; c.pos.o = Math.atan2(dx, dy); left = 0; }
  }
  if (f.idx >= f.pts.length) { const n = G.d.taxi.nodes[f.to]; c.pos.x = n.x; c.pos.y = n.y; r.flying = null; r.mv = null; c.taxi[f.to] = 1; log('Landed at ' + n.n + '.'); save(); }
}
function rideStep(c, dt) {
  const r = rt(c); const s = r.riding; s.t += dt;
  if (s.t >= s.total) {
    const changed = c.pos.map !== s.to.map;
    c.pos.map = s.to.map; c.pos.x = s.to.x; c.pos.y = s.to.y; r.riding = null; r.mv = null; r.tgt = null; r.threats = [];
    if (changed) { ensureWorld(c.pos.map); loadGrid(c.pos.map); }
    log('Arrived with ' + s.name + '.'); save();
  }
}

/* ------------------------------------------------------------------ zone choice */
/* quests this character could ever do automatically (cached per race and class) */
function questPool(c) {
  const k = c.race + '_' + c.cls; G.qpool = G.qpool || {};
  if (G.qpool[k]) return G.qpool[k];
  const out = [];
  for (const q of G.d.quests) {
    if (q.races && !(q.races & (1 << (c.race - 1)))) continue;
    if (q.classes && !(q.classes & (1 << (c.cls - 1)))) continue;
    if (!q.giver.length || q.level < 1 || q.level > 62) continue;
    if (questSupport(q) || !questFactionOk(c, q)) continue;
    const z = questZoneOf(q); if (!z || !OPEN_WORLD[z.map]) continue;
    const pts = giverSpawns(q.giver).filter((s) => OPEN_WORLD[s.map]);
    out.push({ q, zone: z.zone || z.sub, map: z.map, pts });
  }
  return (G.qpool[k] = out);
}
function questOpenFor(c, q, o) {
  if (c.done[q.id] || c.quests[q.id] || (c.abandoned && c.abandoned[q.id])) return false;
  if (q.min_level > c.level || (q.prev > 0 && !c.done[q.prev]) || q.prev < 0) return false;
  if (o && skipped(c, o, q.id)) return false;
  if (q.exclusive_group > 0) { for (const id in c.done) { const x = G.q.byId[id]; if (x && x.exclusive_group === q.exclusive_group) return false; } }
  const m = questMeta(q); if (m.elite && c.level < m.elite + 3) return false;
  return true;
}
/* {zone, map, n, hub:{map,x,y}, score} for every zone with quests for this level, best first */
function zoneChoices(c, o) {
  const lim = questLevelLimit(c); const z = {};
  for (const p of questPool(c)) {
    const q = p.q; if (q.level < c.level - 3 || q.level > c.level + lim) continue;
    if (!questOpenFor(c, q, o)) continue;
    if (!p.zone || !questDoable(c, q, o)) continue;
    const e = z[p.zone] = z[p.zone] || { zone: p.zone, map: p.map, n: 0, pts: [], act: 0 };
    e.n++; for (const s of p.pts) if (s.map === p.map) e.pts.push(s);
  }
  // active quests count for the zone where their next step is (the turn-in for finished ones)
  for (const id in c.quests) {
    const q = G.q.byId[id]; if (!q || questSupport(q) || (o && skipped(c, o, q.id))) continue;
    const done = questDone(c, q) || !q.objectives.length;
    const spots = giverSpawns(done ? q.turnin : q.giver).filter((sp) => OPEN_WORLD[sp.map]); if (!spots.length) continue;
    spots.sort((a, b) => (a.map !== c.pos.map) - (b.map !== c.pos.map) || Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y));
    const sp = spots[0]; const k = placeName(sp, 'zone') || placeName(sp, 'sub'); if (!k || !String(k).trim()) continue;
    if (!z[k]) z[k] = { zone: k, map: sp.map, n: 0, pts: [], act: 0 };
    if (z[k].map !== sp.map) continue;
    z[k].act++; z[k].pts.push(sp);
  }
  const out = [];
  for (const k in z) {
    const e = z[k]; if (!e.pts.length) continue;
    // hub: the quest giver with most other givers around it (a town)
    let best = null, bn = -1;
    for (const a of e.pts) { let n = 0; for (const b of e.pts) if (Math.abs(a.x - b.x) < 200 && Math.abs(a.y - b.y) < 200) n++; const d = a.map === c.pos.map ? Math.hypot(a.x - c.pos.x, a.y - c.pos.y) : 1e5; if (n > bn || (n === bn && d < best.d)) { bn = n; best = Object.assign({ d }, a); } }
    e.hub = { map: best.map, x: best.x, y: best.y };
    // travel costs: about one quest per 3 minutes on the road (flights make far zones cheaper)
    const trip = e.map === c.pos.map && Math.hypot(e.hub.x - c.pos.x, e.hub.y - c.pos.y) < 500 ? null : planTrip(c, e.hub);
    const far = trip ? trip.secs / 180 : 0;
    e.score = Math.min(e.n, 12) + e.act * 1.5 - far;
    out.push(e);
  }
  return out.sort((a, b) => b.score - a.score);
}
/* a place with many creatures of about the character's level, away from guards and elites */
function grindSpot(c, bad) {
  const W = ensureWorld(c.pos.map); const cells = new Map(); const S = 120;
  for (const m of W.list) {
    if (m.civ || m.rank || (m.info && (m.info[5] === 8 || m.info[5] === 11))) continue;
    const b = behOf(m, c); if (b !== 'A' && b !== 'N') continue;
    if (b === 'N' && m.info && m.info[5] === 7) continue;            // neutral humanoids are townsfolk of some faction
    if (factionNpc(m)) { const k0 = Math.floor(m.hx / S) + ',' + Math.floor(m.hy / S); let e0 = cells.get(k0); if (!e0) cells.set(k0, e0 = { n: 0, bad: 0, x: 0, y: 0 }); e0.bad += 2; continue; }   // towns of the other faction
    const lv = m.info ? (m.info[2] + m.info[3]) / 2 : m.lvl; const k = Math.floor(m.hx / S) + ',' + Math.floor(m.hy / S);
    let e = cells.get(k); if (!e) cells.set(k, e = { n: 0, bad: 0, x: 0, y: 0 });
    if (lv > c.level + 4) { e.bad++; continue; }
    if (lv < c.level - 2 || lv > c.level + 1) continue;
    e.n++; e.x += m.hx; e.y += m.hy; if (m.help) e.soc = (e.soc || 0) + 1; if (m.info && m.info[5] === 7) e.hum = (e.hum || 0) + 1;
  }
  let best = null, bs = -1e9;
  for (const e of cells.values()) {
    if (e.n < 6 || e.bad > 1) continue;
    const x = e.x / e.n, y = e.y / e.n; const d = Math.hypot(x - c.pos.x, y - c.pos.y);
    if ((bad || []).some((b) => b.map === c.pos.map && Math.hypot(b.x - x, b.y - y) < 300)) continue;
    // camps of humanoids that call for help are hard for a single character: prefer beasts
    const camp = ((e.soc || 0) + (e.hum || 0)) / (2 * e.n);
    const s = Math.min(e.n, 25) * 40 * (1 - 0.6 * camp) - d / 4; if (s > bs) { bs = s; best = { x, y, n: e.n }; }
  }
  return best;
}

/* ------------------------------------------------------------------ the order */
function orderLeveling(c) {
  c.order = { type: 'leveling', label: 'Level up to 60', zones: [], zi: 0, skip: {}, mode: 'pick' };
  log('Order: level up - questing zone by zone, travelling and grinding when needed.'); save(); renderOrder();
}
function updateLeveling(c, o, dt) {
  const r = rt(c);
  if (c.level >= MAX_LEVEL) { log(c.name + ' reached level ' + MAX_LEVEL + '. Leveling finished.'); c.order = null; renderOrder(); save(); return; }
  if (!r.threats.length && (r.bagFull || bagFree(c) <= 0) && !o.noSell && junkCount(c)) { if (o.mode === 'travel') { o.mode = 'pick'; o.trip = null; } bagsFull(c, o); return; }
  if (!r.threats.length && (durabilityPct(c) < 0.35 || worstDurability(c) < 0.1) && G.gameTime - (o.repairT || -1e9) > 600) {
    if (o.mode === 'travel') { o.mode = 'pick'; o.trip = null; }
    o.repairT = G.gameTime; const v = nearestVendor(c, true);
    if (v && c.gold >= repairCost(c) * 0.5) { log('Gear is almost broken - going to ' + v.name + ' to repair.'); c.order = { type: 'vendor', label: v.name, vx: v.x, vy: v.y, e: v.e, auto: true, repair: true, resume: o }; r.mv = null; r.tgt = null; renderOrder(); return; }
  }
  if (o.mode === 'travel') {
    if (!o.trip) { o.mode = 'pick'; return; }
    const st = tripStep(c, o.trip);
    if (st === 'done') { o.trip = null; if (o.afterTrip === 'grind' && o.grind) { o.mode = 'grind'; o.grindStart = G.gameTime; o.grindUntil = G.gameTime + 1800; } else { o.mode = 'quest'; log('Arrived in ' + (o.zones[0] || 'the new zone') + '.'); } o.afterTrip = null; }
    else if (st === 'fail') {
      o.tripFails = (o.tripFails || 0) + 1; const dest = o.trip.dest; o.trip = null;
      if (o.tripFails <= 2) { o.trip = planTrip(c, dest, { noFly: o.tripFails > 1 }); if (!o.trip) o.mode = 'pick'; }
      else if (o.afterTrip === 'grind' && o.grind) { o.badSpots = (o.badSpots || []).concat([{ map: c.pos.map, x: o.grind.cx, y: o.grind.cy }]); o.grind = null; o.afterTrip = null; o.mode = 'pick'; o.tripFails = 0; }
      else { log('Could not get to ' + (o.zones[0] || 'the next zone') + ' - choosing again.'); o.avoid = o.avoid || {}; o.avoid[o.zones[0]] = c.level + 2; o.mode = 'pick'; o.tripFails = 0; }
    }
    return;
  }
  if (o.mode === 'grind') {
    if (c.level > o.grindLevel || G.gameTime > o.grindUntil) { o.mode = 'pick'; o.grind = null; return; }
    if (r.bagFull || bagFree(c) <= 0) { bagsFull(c, o); return; }
    if (o.grind.failed || (G.gameTime - o.grindStart > 900 && !o.grind.kills)) {
      log('Cannot grind there - looking for another place.'); o.badSpots = (o.badSpots || []).concat([{ map: c.pos.map, x: o.grind.cx, y: o.grind.cy }]).slice(-30); o.mode = 'pick'; o.grind = null; return;
    }
    updateGrind(c, o.grind, dt); if (c.order !== o && c.order && c.order.type !== 'vendor') c.order = o;
    return;
  }
  if (o.mode === 'dgtour') { updateDungeonTour(c, o, dt); return; }
  if (o.mode === 'pick' && c.prof && profAutoTrain(c, o)) return;
  if (o.mode === 'pick') { levelingPick(c, o); return; }
  // questing in the chosen zone (zone questing logic; calls levelingIdle when the zone has nothing for now)
  if (G.gameTime - (o.recheck || 0) > 300) { o.recheck = G.gameTime; abandonStale(c); }
  updateQuesting(c, o, dt);
}
function levelingPick(c, o) {
  if (G.gameTime - (o.recheckP || -1e9) > 60) { o.recheckP = G.gameTime; abandonStale(c); }
  if (dungeonTourPick(c, o)) return;
  const choices = zoneChoices(c, o).filter((z) => !(o.avoid && o.avoid[z.zone] >= c.level));
  const cur = choices.find((z) => z.zone === o.zones[0]);
  let pick = choices[0];
  if (cur && (cur.n >= 2 || cur.act) && pick && pick.score < cur.score + 4) pick = cur;
  if (!pick || (pick.n < 2 && !pick.act)) {
    // nothing worth questing for this level: grind
    const spot = grindSpot(c, o.badSpots);
    if (spot) {
      o.mode = 'grind'; o.grindLevel = c.level; o.grindUntil = G.gameTime + 1800; o.grindStart = G.gameTime;
      o.grind = { type: 'grind', cx: spot.x, cy: spot.y, radius: 150, entries: null, kills: 0, label: 'creatures around level ' + c.level, noFallback: true };
      log('No quests left for level ' + c.level + ' nearby - grinding ' + spot.n + ' creatures of my level until level ' + (c.level + 1) + '.');
      if (Math.hypot(spot.x - c.pos.x, spot.y - c.pos.y) > 400) { o.trip = planTrip(c, { map: c.pos.map, x: spot.x, y: spot.y }); if (o.trip) { o.mode = 'travel'; o.afterTrip = 'grind'; o.tripFails = 0; } }
      return;
    }
    if (pick) { /* go even for one quest */ } else { log('Nothing to do for level ' + c.level + ' - leveling stopped.'); c.order = null; renderOrder(); return; }
  }
  if (o.zones[0] !== pick.zone) log('Next questing zone: ' + pick.zone + ' (' + pick.n + ' quests for level ' + c.level + ').');
  o.zones = [pick.zone]; o.zi = 0; o.grind = null; o.fq = null; o.wt = null; o.pickT = G.gameTime;
  const d = pick.hub.map === c.pos.map ? Math.hypot(pick.hub.x - c.pos.x, pick.hub.y - c.pos.y) : Infinity;
  if (d > 400) { o.trip = planTrip(c, pick.hub); o.tripFails = 0; if (o.trip) { o.mode = 'travel'; log('Travelling to ' + pick.zone + ': ' + o.trip.legs.map((l) => l.kind === 'walk' ? 'walk' : l.kind === 'fly' ? 'fly to ' + G.d.taxi.nodes[l.to].n : TRANSPORTS[l.t].name).join(', ') + ' (about ' + fmtTime(o.trip.secs) + ').'); return; } }
  o.mode = 'quest';
}
/* the zone has nothing for now (called by updateQuesting) */
function levelingIdle(c, o, dt) {
  // picked this zone a moment ago and still nothing to do here: leave it alone for this level
  if (o.zones[0] && G.gameTime - (o.pickT || -1e9) < 3) { o.avoid = o.avoid || {}; o.avoid[o.zones[0]] = c.level; }
  o.mode = 'pick'; o.zi = 0;
}
/* quests far below the character's level that are not finished: drop them */
function abandonStale(c) {
  const o = c.order;
  if (o && Object.keys(c.quests).length >= 18) {
    for (const id in c.quests) { const q = G.q.byId[id]; if (q && !questDone(c, q) && skipped(c, o, q.id)) { log('Quest log is full - abandoned "' + q.title + '".'); delete c.quests[id]; } }
  }
  for (const id in c.quests) { const q = G.q.byId[id]; if (q && !questDone(c, q) && !questDoable(c, q, o)) { log('Abandoned "' + q.title + '" (its items cannot be had).'); delete c.quests[id]; c.abandoned = c.abandoned || {}; c.abandoned[id] = 1; } }
  for (const id in c.quests) {
    const q = G.q.byId[id]; if (!q) { delete c.quests[id]; continue; }
    if (questDone(c, q)) continue;
    if (c.level - q.level >= 8 || questSupport(q)) { log('Abandoned "' + q.title + '" (' + (questSupport(q) || 'too low level now') + ').'); delete c.quests[id]; }
  }
}
/* dungeon quests for this level: pick them up in town, run the dungeon (with a group), turn them in */
function dungeonTourPick(c, o) {
  if (G.state.settings.dungeonQuests === false || typeof dungeonList !== 'function') return false;
  o.dgDone = o.dgDone || {}; if (G.gameTime - (o.dgLook || -1e9) < 120) return false; o.dgLook = G.gameTime;
  let best = null;
  for (const d of dungeonList()) {
    if (d.kind === 'raid' || !d.entrance || d.entrance.map !== c.pos.map || c.level < d.lmin || c.level >= (d.lmax || d.lmin + 8)) continue;
    if (o.dgDone[d.map] != null && o.dgDone[d.map] + 3 > c.level) continue;          // once every few levels
    const qs = [];
    for (const p of questPool(c)) {
      const q = p.q; if (questDungeon(q) !== d) continue;
      if (!questOpenFor(c, q, o) || !questDoable(c, q, o) || q.level > c.level + 3 || q.min_level > c.level) continue;
      if (!p.pts.some((s) => s.map === c.pos.map)) continue;
      qs.push(q.id);
    }
    for (const id in c.quests) { const q = G.q.byId[id]; if (q && questDungeon(q) === d && !qs.includes(q.id)) qs.push(q.id); }
    if (qs.length >= 2 && (!best || qs.length > best.qs.length)) best = { d, qs };
  }
  if (!best) return false;
  o.tour = { map: best.d.map, qs: best.qs, phase: 'pickup', runs: 0 }; o.mode = 'dgtour'; o.fq = null; o.wt = null; o.trip = null;
  log('Dungeon quests in ' + best.d.name + ': ' + best.qs.map((id) => '"' + G.q.byId[id].title + '"').join(', ') + ' - picking them up, then going in' + (G.state.settings.dungeonSolo ? '' : ' with a group') + '.');
  return true;
}
function updateDungeonTour(c, o) {
  const T = o.tour; const d = T && dungeonByMap(T.map); const r = rt(c);
  const end = (msg) => { if (msg) log(msg); o.dgDone = o.dgDone || {}; if (T) o.dgDone[T.map] = c.level; o.tour = null; o.mode = 'pick'; o.fq = null; o.wt = null; };
  if (!d) { end(); return; }
  if (r.bagFull || bagFree(c) <= 0) { bagsFull(c, o); return; }
  T.qs = T.qs.filter((id) => !c.done[id] && G.q.byId[id] && (c.quests[id] || questAvailable(c, G.q.byId[id])));
  if (!T.qs.length) { end('Dungeon quests of ' + d.name + ' finished.'); return; }
  if (T.phase === 'pickup') {
    const id = T.qs.find((x) => !c.quests[x]); if (id == null) { T.phase = 'run'; return; }
    const res = questStep(c, G.q.byId[id], o);
    if (typeof res === 'string' && res[0] === '!') { log(res.slice(1) + ' - leaving it out.'); T.qs = T.qs.filter((x) => x !== id); }
    else if (res && res.dungeon) T.qs = T.qs.filter((x) => x !== id);       // given inside: picked up on the run
    return;
  }
  if (T.phase === 'run') {
    const need = T.qs.filter((id) => c.quests[id] && (!questDone(c, G.q.byId[id]) || questMeta(G.q.byId[id]).turnDungeon === T.map));
    if (need.length && T.runs < 2) {
      T.runs++; log('Into ' + d.name + (T.runs > 1 ? ' again' : '') + ' for ' + need.length + ' quest' + (need.length > 1 ? 's' : '') + '.');
      orderDungeon(c, d, G.state.settings.dungeonSolo !== true, o);
      if (c.order && c.order.type === 'dungeon') c.order.questRun = true; else end('Could not go into ' + d.name + '.');
      return;
    }
    T.phase = 'turnin'; return;
  }
  // quests picked up inside (a follow-up from a corpse or a tablet) are turned in on the way too
  for (const x in c.quests) { const q = G.q.byId[x]; if (q && !T.qs.includes(q.id) && questMeta(q).giverDungeon === T.map && questDone(c, q)) T.qs.push(q.id); }
  let id = null, bd = Infinity;            // the nearest turn-in first
  for (const x of T.qs) { const q = G.q.byId[x]; if (!c.quests[x] || !questDone(c, q)) continue; const s = nearestOf(c, giverSpawns(q.turnin)); const dd = s ? s.d : 1e7; if (dd < bd) { bd = dd; id = x; } }
  if (T.cur && T.qs.includes(T.cur) && c.quests[T.cur] && questDone(c, G.q.byId[T.cur])) id = T.cur; T.cur = id;
  if (id == null) { end(T.qs.some((x) => c.quests[x]) ? 'Could not finish every dungeon quest of ' + d.name + '.' : 'Dungeon quests of ' + d.name + ' finished.'); return; }
  const res = questStep(c, G.q.byId[id], o);
  if (res === 'done') o.fq = null;
  else if (typeof res === 'string' && res[0] === '!') { log(res.slice(1)); T.qs = T.qs.filter((x) => x !== id); }
  else if (res && res.dungeon) T.qs = T.qs.filter((x) => x !== id);
}
function levelingText(c, o) {
  if (o.mode === 'dgtour' && o.tour) { const d = dungeonByMap(o.tour.map); return { t: 'Level up: dungeon quests - ' + (d ? d.name : ''), d: (o.tour.phase === 'pickup' ? 'picking up ' : o.tour.phase === 'turnin' ? 'turning in ' : 'going in ') + (o.phase ? '- ' + o.phase : '') + (o.where ? ' - ' + o.where : '') }; }
  if (o.mode === 'travel') return { t: 'Level up: travelling to ' + (o.afterTrip === 'grind' ? 'a grinding spot' : o.zones[0] || '...'), d: tripText(o.trip) };
  if (o.mode === 'grind') return { t: 'Level up: grinding', d: o.grind ? o.grind.label + ' (kills ' + (o.grind.kills || 0) + ')' : '' };
  if (o.mode === 'pick') return { t: 'Level up', d: 'choosing the next zone' };
  const q = o.fq && G.q.byId[o.fq];
  return { t: 'Level up: questing in ' + (o.zones[0] || '...'), d: (q ? (o.phase && o.phase.indexOf(q.title) >= 0 ? o.phase : q.title) : (o.phase || 'looking for quests')) + (o.where ? ' - ' + o.where : '') };
}
/* the character keeps running from the same dangerous creatures: give up what leads it there */
function fleeLoop(c, o) {
  const r = rt(c); r.mv = null;
  if (o.type === 'leveling' && o.mode === 'travel') {
    log('The way to ' + (o.zones[0] || 'the next zone') + ' leads past creatures far too strong - choosing again.');
    o.avoid = o.avoid || {}; if (o.zones[0]) o.avoid[o.zones[0]] = c.level + 2; o.mode = 'pick'; o.trip = null; return;
  }
  if ((o.type === 'leveling' || o.type === 'questing') && o.fq) {
    const q = G.q.byId[o.fq]; log('"' + (q ? q.title : o.fq) + '" leads past creatures far too strong - skipping it for now.');
    o.skip = o.skip || {}; o.skip[o.fq] = c.level; o.fq = null; o.wt = null; o.ftrip = null; return;
  }
  if (o.type === 'leveling' && o.mode === 'grind' && o.grind) { o.badSpots = (o.badSpots || []).concat([{ map: c.pos.map, x: o.grind.cx, y: o.grind.cy }]).slice(-30); o.mode = 'pick'; o.grind = null; return; }
  if (o.type === 'travel' || o.type === 'trainer') { log('The way is too dangerous - order cancelled.'); c.order = o.resume || null; renderOrder(); }
}
