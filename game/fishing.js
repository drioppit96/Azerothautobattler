'use strict';
/* fishing.js - the Fishing profession (secondary): learned at fishing trainers, needs a fishing pole (in the bags or
   in the hands), cast at the water's edge - the bobber, a bite after a few seconds, the catch from the zone's fishing
   loot (or from a school of fish close by, better). The zone decides how much skill a catch needs; poles and lures add
   skill. The order "Go fishing" finds the nearest shore, fishes until stopped (or the bags are full). */

const FISHING = 356;
const FISH_RANKS = [[7620, 75, 5, 10], [7731, 150, 10, 500], [7732, 225, 20, 10000], [18248, 300, 35, 25000]];
/* the fishing trainers of 1.12 (the trainer table of the database export has no fishing) */
const FISH_TRAINERS = [1651, 5493, 5161, 1700, 4156, 3607, 3179, 1683, 3332, 5941, 5938, 3028, 4573, 1680, 2834, 12961, 12032, 7946, 14740];
const FISH_POLES = { 6256: 0, 12225: 3, 6365: 5, 6366: 15, 6367: 20, 19022: 25, 19970: 35 };
const FISH_LURES = { 6529: 25, 6530: 50, 6811: 50, 6532: 75, 7307: 75 };
const FISH_LURE_TIME = 600;

/* the profession joins the others (skill, ranks, trainers) */
function fishingInit() {
  const P = G.d.prof; if (!P || P.skills[FISHING]) return;
  P.skills[FISHING] = { n: 'Fishing', kind: 'secondary', ranks: FISH_RANKS };
  for (const e of FISH_TRAINERS) { const k = String(e); P.trainers[k] = (P.trainers[k] || []).concat([FISHING]); }
}
function fishPole(c) {
  let best = null;
  const eq = c.equip[15]; if (eq && FISH_POLES[eq.id] != null) best = { id: eq.id, bonus: FISH_POLES[eq.id] };
  for (const s of c.bags) if (FISH_POLES[s.id] != null && (!best || FISH_POLES[s.id] > best.bonus)) best = { id: s.id, bonus: FISH_POLES[s.id] };
  return best;
}
function fishLure(c) { const r = rt(c); return r.lure && r.lure.until > G.gameTime ? r.lure : null; }
function fishSkill(c) { const p = fishPole(c); const l = fishLure(c); return profSkill(c, FISHING) + (p ? p.bonus : 0) + (l ? l.bonus : 0); }
/* how much skill a zone asks for (from its creature levels: starting zones need nothing, Stranglethorn about 130, Azshara 200+) */
function fishZoneReq(z) {
  if (!z) return 0; const L = (G.d.zoneLevels && G.d.zoneLevels.zones || []).find((x) => x.zone === z.name);
  const lv = L ? ((L.p10 || L.min) + (L.p90 || L.max)) / 2 : 20; return Math.max(-20, Math.round(lv * 4.5 - 25));
}
function fishTable(z) { const T = G.d.loot.tables.fishing || {}; return z ? T[z.id] || null : null; }
/* a shore spot near (x, y): standing ground with deep enough water a few yards away; returns {x, y, wx, wy} */
function fishSpot(c, x, y, radius) {
  if (!gridOf(c.pos.map)) return null; const R = radius || 250; let best = null, bd = Infinity;
  for (let d = 4; d <= R; d += 4) {
    const n = Math.max(8, Math.round(d * 1.2));
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2; const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (groundAt(c.pos.map, px, py) !== 1) continue;
      for (let b = 0; b < 8; b++) {
        const aa = b / 8 * Math.PI * 2; const wx = px + Math.cos(aa) * 9, wy = py + Math.sin(aa) * 9;
        if (groundAt(c.pos.map, wx, wy) === 2 && groundAt(c.pos.map, px + Math.cos(aa) * 14, py + Math.sin(aa) * 14) === 2) { const dd = Math.hypot(px - c.pos.x, py - c.pos.y); if (dd < bd) { bd = dd; best = { x: px, y: py, wx, wy }; } break; }
      }
    }
    if (best) return best;
  }
  return null;
}
/* a school of fish (a fishing pool object) within reach of the bobber */
function fishPool(c, s) {
  const list = (G.d.gathering || []).filter((g) => g.kind === 'Fishing hole' && g.loot && g.loot.length);
  for (const g of list) {
    const sp = objSpawns(g.id); for (let i = 0; i < sp.length; i++) { const p = sp[i]; if (p[0] !== c.pos.map || !goFree(g.id, i)) continue; if (Math.hypot(p[1] - s.wx, p[2] - s.wy) < 18) return { g, i }; }
  }
  return null;
}
/* the collision grid of the map knows water (older grids were built without it) */
function fishGridWater(c) { const g = gridOf(c.pos.map); return !!(g && g.water > 0); }
/* without water in the grid: the spot you show (or where you stand, casting the way you face), or the nearest school of fish */
function fishSpotBlind(c, here, at) {
  if (at) { const d = Math.hypot(at.x - c.pos.x, at.y - c.pos.y); const a = d > 2 ? Math.atan2(at.x - c.pos.x, at.y - c.pos.y) : c.pos.o || 0; return { x: at.x, y: at.y, wx: at.x + Math.sin(a) * 9, wy: at.y + Math.cos(a) * 9 }; }
  if (here) { const a = c.pos.o || 0; return { x: c.pos.x, y: c.pos.y, wx: c.pos.x + Math.sin(a) * 9, wy: c.pos.y + Math.cos(a) * 9 }; }
  let best = null, bd = 600;
  for (const g of (G.d.gathering || [])) {
    if (g.kind !== 'Fishing hole') continue;
    for (const p of objSpawns(g.id)) { if (p[0] !== c.pos.map) continue; const d = Math.hypot(p[1] - c.pos.x, p[2] - c.pos.y); if (d < bd) { bd = d; best = p; } }
  }
  if (!best) return null; const a = Math.atan2(best[1] - c.pos.x, best[2] - c.pos.y);
  return { x: best[1] - Math.sin(a) * 10, y: best[2] - Math.cos(a) * 10, wx: best[1], wy: best[2] };
}
function orderFishing(c, here, at) {
  if (!hasProf(c, FISHING)) { log('Learn Fishing first (at a fishing trainer).'); return; }
  if (!fishPole(c)) { log('You need a Fishing Pole - fishing suppliers sell them (next to the fishing trainers).'); return; }
  if (!OPEN_WORLD[c.pos.map]) { log('No fishing here.'); return; }
  const blind = !fishGridWater(c);
  const s = blind ? fishSpotBlind(c, here, at) : at ? fishSpot(c, at.x, at.y, 60) : fishSpot(c, c.pos.x, c.pos.y, here ? 30 : 400);
  if (!s) { log(blind ? 'The collision map of this continent has no water in it yet (rebuild it: py wow_navgrid.py). Until then right-click the map at a shore and choose "Fish at the water here", or use "Fish right here".' : here ? 'No water close enough to fish here.' : 'No water near here to fish in.'); return; }
  c.order = { type: 'fish', spot: s, casts: 0, caught: 0, label: 'Fishing', phase: 'walk' }; rt(c).mv = null; rt(c).tgt = null;
  log('Order: go fishing (' + Math.round(Math.hypot(s.x - c.pos.x, s.y - c.pos.y)) + ' yd to the water).'); save(); renderOrder();
}
function updateFishing(c, o, dt) {
  const r = rt(c);
  if (bagFree(c) <= 0) { log('Bags are full - fishing stopped.'); c.order = null; renderOrder(); return; }
  if (!fishPole(c)) { log('No fishing pole - fishing stopped.'); c.order = null; renderOrder(); return; }
  const s = o.spot;
  if (o.phase === 'walk') {
    if (!goTo(c, s.x, s.y, 1.5)) { if (r.blocked) { r.blocked = false; const n = fishGridWater(c) ? fishSpot(c, c.pos.x, c.pos.y, 60) : null; if (n) o.spot = n; else { log('Cannot get to the water.'); c.order = null; renderOrder(); } } return; }
    o.phase = 'cast';
  }
  c.pos.o = Math.atan2(s.wx - c.pos.x, s.wy - c.pos.y);
  // a lure on the pole when there is none
  if (!fishLure(c)) { let best = -1, bv = 0; c.bags.forEach((x, i) => { if (FISH_LURES[x.id] > bv) { bv = FISH_LURES[x.id]; best = i; } }); if (best >= 0) { const it = c.bags[best]; r.lure = { bonus: bv, until: G.gameTime + FISH_LURE_TIME, name: itemName(it.id) }; log('Put ' + itemName(it.id) + ' on the pole (+' + bv + ' fishing for 10 min).'); if (--it.n <= 0) c.bags.splice(best, 1); } }
  if (o.phase === 'cast') { o.bite = G.gameTime + 4 + Math.random() * 14; o.phase = 'wait'; o.casts++; fx(s.wx, s.wy, 'splash', '#9fd8ff'); return; }
  if (o.phase === 'wait' && G.gameTime >= o.bite) { o.phase = 'cast'; fishCatch(c, o); }
}
function fishCatch(c, o) {
  const s = o.spot; const z = zoneAt(c.pos.map, s.wx, s.wy) || zoneAt(c.pos.map, c.pos.x, c.pos.y); const req = fishZoneReq(z); const skill = fishSkill(c);
  const pool = fishPool(c, s);
  // below the zone's need, many fish get away
  const p = Math.max(0.05, Math.min(1, (skill - req + 5) / 100 + (skill >= req ? 0.5 : 0)));
  if (Math.random() > p) { log('Your fish got away.'); fx(s.wx, s.wy, 'got away', '#cfc6b0'); return; }
  let rows = null, from = '';
  if (pool) { rows = pool.g.loot.map((x) => [x.item, x.chance, x.min, x.max, 0]); from = ' (' + pool.g.name + ')'; o.poolN = (o.poolN || 0) + 1; if (o.poolN >= 3 + Math.floor(Math.random() * 3)) { useGo(pool.g.id, pool.i); o.poolN = 0; log(pool.g.name + ' is fished out.'); } }
  else rows = fishTable(z);
  if (!rows || !rows.length) { log('Nothing bites here.'); return; }
  // one catch: the first row that hits (the chances are of the whole table)
  let tot = 0; for (const x of rows) tot += x[1]; let roll = Math.random() * tot; let got = rows[rows.length - 1];
  for (const x of rows) { roll -= x[1]; if (roll <= 0) { got = x; break; } }
  const n = irnd(got[2] || 1, got[3] || 1);
  if (addItem(c, got[0], n)) { o.caught++; log('Caught: ' + (n > 1 ? n + ' x ' : '') + itemName(got[0]) + from + '.'); fx(c.pos.x, c.pos.y, itemName(got[0]), '#9fd8ff'); if (questNeeds(c, got[0])) onItemGained(c, got[0]); }
  // skill: every catch early on, rarer later (about one point per (skill-50)/25 catches)
  const v = profSkill(c, FISHING); if (Math.random() < Math.min(1, 25 / Math.max(25, v - 50))) { const sk = profState(c).skills[FISHING]; if (sk && sk.v < sk.max) { sk.v++; if (sk.v % 5 === 0 || sk.v === sk.max) log('Your skill in Fishing has increased to ' + sk.v + '.'); if (sk.max - sk.v === 25 && profNextRank(c, FISHING)) log('Visit a fishing trainer to learn the next rank.'); } }
  save(); refreshGear();
}
function fishText(c, o) { return { t: 'Fishing', d: o.phase === 'walk' ? 'walking to the water' : o.casts + ' casts, ' + o.caught + ' caught' + (fishLure(c) ? ' - ' + fishLure(c).name : '') }; }
/* the fishing part of the professions window */
function fishingHtml(c) {
  if (!hasProf(c, FISHING)) return '';
  const p = fishPole(c); const l = fishLure(c); const z = zoneAt(c.pos.map, c.pos.x, c.pos.y); const req = fishZoneReq(z);
  const fishing = c.order && c.order.type === 'fish';
  return '<div class="sgroup"><h5>Fishing</h5><div class="small">Skill ' + profSkill(c, FISHING) + (p && p.bonus ? ' + ' + p.bonus + ' (pole)' : '') + (l ? ' + ' + l.bonus + ' (' + esc(l.name) + ', ' + fmtTime(l.until - G.gameTime) + ')' : '') + ' = <b>' + fishSkill(c) + '</b>' +
    (z ? ' &middot; ' + esc(z.name) + ' needs about ' + Math.max(0, req) + (fishSkill(c) < req ? ' <span style="color:#ff9a8a">(many fish get away)</span>' : '') : '') + '</div>' +
    '<div class="small">' + (p ? 'Pole: ' + esc(itemName(p.id)) : '<span style="color:#ff9a8a">No fishing pole - buy one from a fishing supplier.</span>') + ' &middot; lures in the bags: ' + c.bags.filter((x) => FISH_LURES[x.id]).reduce((s, x) => s + x.n, 0) + '</div>' +
    '<p>' + (fishing ? '<button class="act red" data-fish="stop">Stop fishing</button>' : '<button class="act" data-fish="go"' + (p ? '' : ' disabled') + '>Go fishing (nearest water)</button> <button class="mini" data-fish="here"' + (p ? '' : ' disabled') + '>Fish right here</button>') + '</p>' +
    (fishGridWater(c) ? '' : '<div class="small" style="color:#ffcf6a">The collision map has no water in it yet (an older build - rerun py wow_navgrid.py). Until then: right-click a shore on the map and choose "Fish at the water here", or face the water and use "Fish right here".</div>') +
    '<div class="small muted">Schools of fish (pools) in the water give better catches. A lure in the bags goes on the pole by itself.</div></div>';
}
function fishingClick(e) {
  const b = e.target.closest('[data-fish]'); if (!b) return false; const c = active();
  if (b.dataset.fish === 'stop') { if (c.order && c.order.type === 'fish') { c.order = null; log('Stopped fishing.'); renderOrder(); } }
  else { orderFishing(c, b.dataset.fish === 'here'); if (c.order && c.order.type === 'fish') closeSheet(); }
  renderSheet(); return true;
}
