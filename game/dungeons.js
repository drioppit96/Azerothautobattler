'use strict';
/* dungeons.js - 5-player dungeons and raids: their entrances on the world maps, the dungeon maps (one picture per
   floor, from gamedata/dungeons.json and maps_dungeon/), walking inside (a path graph made from where the creatures
   and objects stand), and running a dungeon with a group of companions (tank, healers, damage dealers). */

const DG_COLORS = { dungeon: '#b28cff', raid: '#ff9a3c' };
const DG_ROLE_COLOR = { tank: '#5aa0ff', healer: '#5ee07a', dps: '#ff6a5a' };
const DG_NAMES = ['Garrick', 'Mira', 'Tolvar', 'Selene', 'Brann', 'Kaela', 'Dorn', 'Ysra', 'Halvar', 'Nessa', 'Borik', 'Lyra', 'Thane', 'Iris', 'Korg', 'Vela', 'Rurik', 'Sana', 'Ulric', 'Fenna'];
const DG_TIME_LIMIT = 8 * 3600;      // game seconds before a run gives up (raids get half as much again)

function dungeonList() { return (G.d.dungeons && G.d.dungeons.dungeons) || []; }
function dungeonByMap(id) { G.dgIdx = G.dgIdx || {}; if (!(id in G.dgIdx)) G.dgIdx[id] = dungeonList().find((d) => d.map === id) || null; return G.dgIdx[id]; }
function isDungeonMap(id) { return !!dungeonByMap(id); }
function inDungeon(c) { return isDungeonMap(c.pos.map); }

/* ------------------------------------------------------------------ maps */
function dungeonMapDef(d, f) {
  G.dgMaps = G.dgMaps || {};
  f = f || d.floors[0]; if (!f) return null;
  const k = d.map + ':' + f.n;
  if (!G.dgMaps[k]) G.dgMaps[k] = { name: d.name + (d.floors.length > 1 ? ' - ' + (f.name || 'Level ' + (d.floors.indexOf(f) + 1)) : ''), file: f.file, map: d.map, xt: f.xt, xb: f.xb, yl: f.yl, yr: f.yr, dungeon: d, floor: f, dmap: true };
  return G.dgMaps[k];
}
/* the floor a point is on: inside the floor's area and, for floors on top of each other, in its height band */
function dungeonFloorAt(d, x, y, z) {
  let best = null, bs = -1e9;
  for (const f of d.floors) {
    if (x > f.xt || x < f.xb || y > f.yl || y < f.yr) continue;
    let s = 0;
    const banded = f.z0 > -9999 || f.z1 < 999999;
    if (z != null && banded) { if (z >= f.z0 && z <= f.z1) s = 100; else s = -Math.min(Math.abs(z - f.z0), Math.abs(z - f.z1)); }
    else s = 10;
    if (z != null && f.zc != null) s -= Math.abs(z - f.zc) * 0.05;
    s -= (f.xt - f.xb) * (f.yl - f.yr) * 1e-7;            // the smaller drawing when both fit
    if (s > bs) { bs = s; best = f; }
  }
  return best || d.floors[0];
}
function dungeonMapAt(pos) { const d = dungeonByMap(pos.map); return d ? dungeonMapDef(d, dungeonFloorAt(d, pos.x, pos.y, pos.z)) : null; }
function mobOnFloor(m, map) { if (m.floorN == null) m.floorN = dungeonFloorAt(map.dungeon, m.hx, m.hy, m.z).n; return m.floorN === map.floor.n; }

/* ------------------------------------------------------------------ entrances on the world maps */
function dungeonsOnMap(m) {
  if (m.world || m.dmap) return [];
  return dungeonList().filter((d) => d.entrance && d.entrance.map === m.map && inMap(m, d.entrance.x, d.entrance.y));
}
/* the ways out of a dungeon (where the portal puts you in), on the floor this map shows */
function dungeonExitsOn(m) {
  if (!m || !m.dmap) return [];
  const d = m.dungeon; return (d.enter || []).map((e, i) => ({ d, e, i })).filter((x) => dungeonFloorAt(d, x.e.x, x.e.y, x.e.z).n === m.floor.n);
}
function drawDungeonExits(ctx, m) {
  const list = dungeonExitsOn(m); if (!list.length) return;
  ctx.save(); ctx.textAlign = 'center';
  for (const x of list) {
    const [sx, sy] = w2s(x.e.x, x.e.y); const hov = G.dgHover && G.dgHover.e === x.e; const R = 11; const col = '#6fe3ff';
    ctx.shadowColor = col; ctx.shadowBlur = hov ? 18 : 10; ctx.fillStyle = '#0d1a22'; ctx.strokeStyle = col; ctx.lineWidth = hov ? 3 : 2.2;
    ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.3); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.lineWidth = 1.6; ctx.beginPath();
    for (let a = 0; a < 9.5; a += 0.3) { const rr = R * 0.75 * a / 9.5; const px = sx - Math.cos(a) * rr, py = sy + Math.sin(a) * rr; if (a) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke();
    ctx.font = 'bold 12px Segoe UI'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#bff3ff';
    const t = 'Exit' + ((x.d.enter || []).length > 1 && x.e.name && x.e.name !== x.d.name ? ' - ' + x.e.name.replace(x.d.name + ' ', '') : '');
    ctx.strokeText(t, sx, sy - R - 5); ctx.fillText(t, sx, sy - R - 5);
  }
  ctx.restore();
}
function dungeonExitHit(sx, sy) {
  let best = null, bd = 15 * 15;
  for (const x of dungeonExitsOn(G.map)) { const [px, py] = w2s(x.e.x, x.e.y); const dd = (px - sx) ** 2 + (py - sy) ** 2; if (dd < bd) { bd = dd; best = x; } }
  return best;
}
function zoneNameAt(p) { const m = G.maps.find((q) => !q.world && !q.cont && !q.dmap && q.map === p.map && inMap(q, p.x, p.y)); return m ? m.name : ''; }
function dungeonExitTip(x) {
  const c = active(); const inside = c.pos.map === x.d.map; const z = x.d.entrance ? zoneNameAt(x.d.entrance) : '';
  return '<b>Way out of ' + esc(x.d.name) + '</b>' + (z ? '<br>to ' + esc(z) : '') + '<br><span class="muted">' + (inside ? 'Click to walk out of the dungeon' : 'The entrance puts you in here') + '</span>';
}
function dungeonExitClick(x) {
  const c = active();
  if (c.pos.map === x.d.map) orderLeaveDungeon(c, x.e);
  G.selected = { kind: 'dungeon', d: x.d }; renderInfo(G.selected);
}
function drawDungeonMarks(ctx, m) {
  if (m.dmap) { if (typeof drawPullPlan === 'function') drawPullPlan(ctx, m); drawDungeonExits(ctx, m); return; }
  const list = dungeonsOnMap(m); if (!list.length) return;
  const c = active(); const R = m.cont ? 7 : 10;
  ctx.save(); ctx.textAlign = 'center';
  for (const d of list) {
    const [x, y] = w2s(d.entrance.x, d.entrance.y); if (x < -20 || y < -20 || x > G.cw + 20 || y > G.ch + 20) continue;
    const col = DG_COLORS[d.kind] || '#b28cff'; const hov = G.dgHover === d;
    ctx.shadowColor = col; ctx.shadowBlur = hov ? 16 : 8;
    ctx.fillStyle = '#1a1020'; ctx.strokeStyle = col; ctx.lineWidth = hov ? 3 : 2.2;
    ctx.beginPath(); ctx.arc(x, y, R, 0, 6.3); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    // a portal swirl
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let a = 0; a < 9.5; a += 0.3) { const rr = R * 0.75 * a / 9.5; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (a) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke();
    if (!m.cont || hov || G.scale > 2.2) {
      const lv = d.lmin + (d.lmax && d.lmax !== d.lmin ? '-' + d.lmax : '');
      ctx.font = 'bold ' + (m.cont ? 10 : 12) + 'px Segoe UI'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
      const t = (m.cont && !hov ? d.short : d.name) + ' (' + lv + ')';
      ctx.fillStyle = c && c.level >= d.lmin ? '#ffe9a8' : '#ff9a8a';
      ctx.strokeText(t, x, y - R - 5); ctx.fillText(t, x, y - R - 5);
    }
  }
  ctx.restore();
}
function dungeonHit(sx, sy) {
  if (!G.map) return null; const R = G.map.cont ? 11 : 14; let best = null, bd = R * R;
  for (const d of dungeonsOnMap(G.map)) { const [x, y] = w2s(d.entrance.x, d.entrance.y); const dd = (x - sx) ** 2 + (y - sy) ** 2; if (dd < bd) { bd = dd; best = d; } }
  return best;
}
function openDungeon(d, floor) {
  const m = dungeonMapDef(d, floor); if (!m) { log('No map for ' + d.name + '.'); return; }
  if ($('follow').checked && active().pos.map !== d.map) $('follow').checked = false;
  setMap(m); G.selected = { kind: 'dungeon', d }; renderInfo(G.selected);
}
function dungeonTip(d) {
  const c = active(); const lv = d.lmin + (d.lmax && d.lmax !== d.lmin ? ' - ' + d.lmax : '+');
  return '<b>' + esc(d.name) + '</b><br>' + (d.kind === 'raid' ? 'Raid, ' + d.players + ' players' : 'Dungeon, 5 players') + '<br>Level ' + lv + (c.level < d.lmin ? ' <span style="color:#ff8a7a">(too low)</span>' : '') + '<br><span class="muted">Click to open the dungeon map</span>';
}
function dungeonInfoHtml(d) {
  const c = active(); const o = c.order; const here = c.pos.map === d.map;
  const running = o && o.type === 'dungeon' && o.map === d.map;
  const W = G.world[d.map];
  const dead = (e) => W && W.list.some((m) => m.e === e) && W.list.filter((m) => m.e === e).every((m) => m.st === 'dead');
  let h = '<h3>' + (d.kind === 'raid' ? 'Raid' : 'Dungeon') + '</h3><div class="name" style="font-size:16px">' + esc(d.name) + '</div>' +
    '<div class="sub">Level ' + d.lmin + (d.lmax && d.lmax !== d.lmin ? ' - ' + d.lmax : '+') + ' &middot; ' + d.players + ' players</div>';
  if (d.floors.length > 1) h += '<div class="dgfloors">' + d.floors.map((f, i) => '<button class="mini' + (G.map.dmap && G.map.floor === f && G.map.dungeon === d ? ' on' : '') + '" data-dgfloor="' + i + '">' + esc(f.name || 'Level ' + (i + 1)) + '</button>').join('') + '</div>';
  if (d.bosses.length) h += '<div class="small" style="margin:6px 0">' + d.bosses.map((b) => '<div' + (dead(b.e) ? ' style="color:#7a7a7a;text-decoration:line-through"' : '') + '>&#9760; ' + esc(b.n) + '</div>').join('') + '</div>';
  const low = c.level < d.lmin - (d.kind === 'raid' ? 0 : 3);
  h += '<div class="dgbtns">';
  if (!G.map.dmap || G.map.dungeon !== d) h += '<button class="mini" data-dg="map">Open the dungeon map</button>';
  const leaving = running && o.phase === 'leaving';
  if (running || here) h += '<button class="act red" data-dg="leave"' + (leaving ? ' disabled' : '') + '>' + (leaving ? 'Walking to the exit...' : 'Leave the dungeon (walk to the exit)') + '</button>';
  if (!running) h += '<button class="act" data-dg="run"' + (low ? ' disabled title="Needs level ' + (d.lmin - (d.kind === 'raid' ? 0 : 3)) + '"' : '') + '>' + (here ? 'Clear it' : 'Run it') + ' with a group of ' + d.players + '</button>' +
    '<button class="mini" data-dg="solo"' + (low ? ' disabled' : '') + '>Run it alone</button>' +
    (!here && d.entrance ? '<button class="mini" data-dg="go">Travel to the entrance</button>' : '');
  h += '</div>' + masteryDungeonHtml(c, d) + (typeof pullPlanHtml === 'function' && d.bosses.length ? pullPlanHtml(d) : '') + '<label class="chk"><input type="checkbox" data-dgset="dgFullClear"' + (G.state.settings.dgFullClear ? ' checked' : '') + '> Kill every creature (otherwise: the bosses and what is in the way)</label>' +
    '<label class="chk"><input type="checkbox" data-dgset="mercLoot"' + (G.state.settings.mercLoot ? ' checked' : '') + '> Mercenaries roll on the loot too (otherwise they are paid and everything is yours)</label>';
  return h;
}
/* only walk (fly, sail) to the entrance */
function dungeonTravel(c, d) {
  if (!d.entrance) return;
  if (isDungeonMap(c.pos.map)) { orderTravel(c, d.entrance, 'the entrance of ' + d.name); return; }
  const t = planTrip(c, { map: d.entrance.map, x: d.entrance.x, y: d.entrance.y });
  if (t) { c.order = { type: 'dungeon', map: d.map, phase: 'travel', trip: t, onlyTravel: true, label: d.name }; rt(c).mv = null; log('Order: travel to ' + d.name + '.'); save(); renderOrder(); } else log('No way to ' + d.name + ' found.');
}
function dungeonInfoClick(e, d) {
  const b = e.target.closest('[data-dg],[data-dgfloor]'); const c = active();
  if (e.target.dataset && e.target.dataset.dgset) { G.state.settings[e.target.dataset.dgset] = e.target.checked; save(); return true; }
  if (e.target.dataset && e.target.dataset.dghire) { if (e.type !== 'change') return true; G.state.settings.dgHire = e.target.value; G.dgPlan = null; save(); renderInfo(G.selected); return true; }
  if (e.target.closest && e.target.closest('[data-dgplan]')) { G.dgPlan = { map: d.map, cid: c.id, t: G.gameTime, p: partyPlan(c, d) }; save(); renderInfo(G.selected); return true; }
  if (!b) return false;
  if (b.dataset.dgfloor != null) { openDungeon(d, d.floors[+b.dataset.dgfloor]); return true; }
  const a = b.dataset.dg;
  if (a === 'map') openDungeon(d);
  else if (a === 'run') orderDungeon(c, d, true);
  else if (a === 'solo') orderDungeon(c, d, false);
  else if (a === 'go') dungeonTravel(c, d);
  else if (a === 'leave') orderLeaveDungeon(c);
  renderInfo(G.selected); return true;
}

/* ------------------------------------------------------------------ walking inside: a path graph */
function dungeonGraph(mapId) {
  G.dgGraph = G.dgGraph || {};
  if (G.dgGraph[mapId]) return G.dgGraph[mapId];
  const pts = []; const seen = new Set();
  const add = (x, y, z) => { const k = Math.round(x / 2) + ',' + Math.round(y / 2) + ',' + Math.round(z / 3); if (seen.has(k)) return; seen.add(k); pts.push({ x, y, z, nb: [] }); };
  for (const [, l] of G.spawnList) for (const s of l) if (s[0] === mapId) add(s[1], s[2], s[3]);
  const ob = G.d.objects && G.d.objects.objects; if (ob) for (const e in ob) for (const s of ob[e]) if (s[0] === mapId) add(s[1], s[2], s[3]);
  const d = dungeonByMap(mapId); if (d) { for (const en of d.enter) add(en.x, en.y, en.z); for (const b of d.bosses) add(b.x, b.y, b.z); }
  // floors with exact walls (script/dungeon_walls.py): a point every 6 yards on the floor too, so paths go along the
  // corridors and never through a wall or over lava
  const exact = d ? d.floors.filter((f) => f.walk && f.walk.exact && floorWalk(f)) : [];
  const nSpawn = pts.length; const gridPts = [];
  if (exact.length) {
    const base = pts.slice();
    for (const f of exact) {
      const w = floorWalk(f); const step = 4; const cy = (f.xt - f.xb) / w.H, cx = (f.yl - f.yr) / w.W;
      for (let r = 0; r < w.H; r += step) for (let q = 0; q < w.W; q += step) {
        if (!w.a[r * w.W + q]) continue;
        const x = f.xt - (r + 0.5) * cy, y = f.yl - (q + 0.5) * cx;
        let z = null, bz = 60; for (const b of base) { const dd = Math.hypot(b.x - x, b.y - y); if (dd < bz) { bz = dd; z = b.z; } }
        if (z == null) continue;
        gridPts.push(pts.length); pts.push({ x, y, z, nb: [], g: true, gf: f });
      }
    }
  }
  const CELLG = 25; const grid = new Map(); pts.forEach((p, i) => { const k = Math.floor(p.x / CELLG) + ',' + Math.floor(p.y / CELLG); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  if (d) pts.forEach((p) => { p.f = p.gf || dungeonFloorAt(d, p.x, p.y, p.z); });
  const exactF = (p) => p.f && p.f.walk && p.f.walk.exact;
  const link = (i, j, w) => { const p = pts[i]; if (p.nb.some((x) => x[0] === j)) return; p.nb.push([j, w]); pts[j].nb.push([i, w]); };
  pts.forEach((p, i) => {
    const cx = Math.floor(p.x / CELLG), cy = Math.floor(p.y / CELLG); const near = [], far = [];
    for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) for (const j of grid.get((cx + a) + ',' + (cy + b)) || []) {
      if (j <= i) continue; const q = pts[j]; const dd = Math.hypot(q.x - p.x, q.y - p.y); const dz = Math.abs(q.z - p.z);
      if (dd <= 22 && dz <= Math.max(4, dd * 0.7)) { if (exactF(p) && p.f === q.f && !walkLine(p.f, p, q)) continue; near.push([dd + dz * 1.5, j]); }
      else if (!p.g && !q.g && dd <= 150 && p.f && p.f === q.f && dz <= Math.max(6, dd * 0.35) && walkLine(p.f, p, q)) far.push([dd + dz, j]);    // a straight walk on the drawn floor
    }
    near.sort((a, b) => a[0] - b[0]); for (const [w, j] of near.slice(0, p.g ? 8 : 6)) link(i, j, w);
    far.sort((a, b) => a[0] - b[0]); for (const [w, j] of far.slice(0, 8)) link(i, j, w);
  });
  // join the separate pieces (stairs and ramps between floors have few creatures on them): the closest pair each time
  for (let pass = 0; pass < 60; pass++) {
    const comp = new Int32Array(pts.length).fill(-1); let nc = 0;
    for (let i = 0; i < pts.length; i++) { if (comp[i] >= 0) continue; const st = [i]; comp[i] = nc; while (st.length) { const u = st.pop(); for (const [v] of pts[u].nb) if (comp[v] < 0) { comp[v] = nc; st.push(v); } } nc++; }
    if (nc <= 1) break;
    let merged = 0; const done = new Set();
    for (let k = 0; k < nc; k++) {
      if (done.has(k)) continue; let best = null, bd = 90;
      for (let i = 0; i < pts.length; i++) {
        if (comp[i] !== k) continue; const p = pts[i]; const cx = Math.floor(p.x / CELLG), cy = Math.floor(p.y / CELLG);
        for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) for (const j of grid.get((cx + a) + ',' + (cy + b)) || []) {
          if (comp[j] === k) continue; const q = pts[j]; const dd = Math.hypot(q.x - p.x, q.y - p.y) + Math.abs(q.z - p.z) * 1.5;
          if (dd < bd && exactF(p) && p.f === q.f && !walkLine(p.f, p, q)) continue;          // never join through a wall
          if (dd < bd) { bd = dd; best = [i, j]; }
        }
      }
      if (best) { link(best[0], best[1], bd * 1.5); done.add(k); done.add(comp[best[1]]); merged++; }
    }
    if (!merged) break;
  }
  return (G.dgGraph[mapId] = { pts, grid, CELLG });
}
/* the walkable cells of a floor picture (made by script/make_dungeon_maps.py) */
function floorWalk(f) {
  if (f._walk !== undefined) return f._walk;
  if (!f.walk) return (f._walk = null);
  const bin = atob(f.walk.bits); const W = f.walk.w, H = f.walk.h; const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return (f._walk = { W, H, a });
}
function walkAt(f, x, y) {
  const w = floorWalk(f); if (!w) return true;
  const px = Math.floor((f.yl - y) / (f.yl - f.yr) * w.W), py = Math.floor((f.xt - x) / (f.xt - f.xb) * w.H);
  if (px < 0 || py < 0 || px >= w.W || py >= w.H) return false;
  return !!w.a[py * w.W + px];
}
function walkLine(f, p, q) {
  const w = floorWalk(f); if (!w) return false;
  const cell = Math.min((f.yl - f.yr) / w.W, (f.xt - f.xb) / w.H); const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / Math.max(0.5, cell * 0.8));
  for (let k = 1; k < n; k++) { const t = k / n; if (!walkAt(f, p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)) return false; }
  return true;
}
/* exact walls on this spot of a dungeon (null: not known there) */
function dgExactFloor(mapId, x, y, z) { const d = dungeonByMap(mapId); if (!d) return null; const f = dungeonFloorAt(d, x, y, z); return f && f.walk && f.walk.exact && floorWalk(f) ? f : null; }
/* exact walls: can one walk straight from a to b */
function dgStraight(mapId, a, b) { const f = dgExactFloor(mapId, a.x, a.y, a.z); return !f || walkLine(f, a, b); }
/* the walls on the dungeon map (Map view - Dungeon walls): what cannot be walked on, in dark red */
function drawDungeonWalls(ctx, m) {
  const f = m.floor; if (!f || !floorWalk(f)) return;
  if (!f._wallImg) {
    const w = floorWalk(f); const cv = document.createElement('canvas'); cv.width = w.W; cv.height = w.H; const x = cv.getContext('2d'); const id = x.createImageData(w.W, w.H);
    for (let i = 0; i < w.W * w.H; i++) { const o = i * 4; if (!w.a[i]) { id.data[o] = 120; id.data[o + 1] = 10; id.data[o + 2] = 10; id.data[o + 3] = 150; } }
    x.putImageData(id, 0, 0); f._wallImg = cv;
  }
  const img = G.img[m.name]; if (!img) return;
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(f._wallImg, G.ox, G.oy, img.naturalWidth * G.scale, img.naturalHeight * G.scale); ctx.restore();
}
function dgNearest(g, x, y, z, f) {
  const cand = []; const cx = Math.floor(x / g.CELLG), cy = Math.floor(y / g.CELLG);
  for (let rad = 1; rad <= 6 && !cand.length; rad += 2) for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) for (const j of g.grid.get((cx + a) + ',' + (cy + b)) || []) {
    const p = g.pts[j]; cand.push([Math.hypot(p.x - x, p.y - y) + (z != null ? Math.abs(p.z - z) * 2 : 0), j]);
  }
  if (!cand.length) return -1;
  cand.sort((a, b) => a[0] - b[0]);
  // exact walls: the nearest one that can be walked to straight (not the one behind the wall)
  if (f) for (const [, j] of cand.slice(0, 16)) if (walkLine(f, { x, y }, g.pts[j])) return j;
  return cand[0][1];
}
/* path from the character to target {x, y, z?} along the graph; points carry z */
function dungeonPath(c, from, to) {
  const g = dungeonGraph(c.pos.map); const direct = { pts: [{ x: from.x, y: from.y }, { x: to.x, y: to.y, z: to.z }], total: Math.hypot(to.x - from.x, to.y - from.y), via: 'straight' };
  if (!g.pts.length) return direct;
  const ef = dgExactFloor(c.pos.map, from.x, from.y, c.pos.z);
  if (ef && dungeonFloorAt(ef && dungeonByMap(c.pos.map), to.x, to.y, to.z) === ef && walkLine(ef, from, to)) return direct;          // in plain sight on the floor
  const s = dgNearest(g, from.x, from.y, c.pos.z, ef), e = dgNearest(g, to.x, to.y, to.z, dgExactFloor(c.pos.map, to.x, to.y, to.z));
  if (s < 0 || e < 0) return direct;
  if (s === e) { const q = g.pts[s]; if (!ef || walkLine(ef, from, to)) return direct; return { pts: [{ x: from.x, y: from.y }, { x: q.x, y: q.y, z: q.z }, { x: to.x, y: to.y, z: to.z }], total: Math.hypot(q.x - from.x, q.y - from.y) + Math.hypot(to.x - q.x, to.y - q.y), via: 'through the dungeon', d: 0 }; }      // around the corner, by the path point
  const N = g.pts.length; const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1); dist[s] = 0;
  const heap = [[0, s]]; const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
  let n = 0;
  while (heap.length && n++ < 60000) { const [dv, u] = pop(); if (dv > dist[u]) continue; if (u === e) break; for (const [v, w] of g.pts[u].nb) { const nd = dv + w; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); } } }
  if (prev[e] < 0) return Object.assign(direct, { noPath: true });
  const chain = []; for (let v = e; v >= 0; v = prev[v]) chain.push(g.pts[v]); chain.reverse();
  // drop points that lie almost on the straight line between their neighbours
  const pts = [{ x: from.x, y: from.y }];
  for (let i = 0; i < chain.length; i++) { const p = chain[i]; const nx = chain[i + 1]; const pv = pts[pts.length - 1]; if (nx && Math.abs((p.x - pv.x) * (nx.y - pv.y) - (p.y - pv.y) * (nx.x - pv.x)) / Math.max(1, Math.hypot(nx.x - pv.x, nx.y - pv.y)) < 1.2 && Math.abs(p.z - pv.z || 0) < 2) continue; pts.push({ x: p.x, y: p.y, z: p.z }); }
  pts.push({ x: to.x, y: to.y, z: to.z });
  let total = 0; for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return { pts, total, via: 'through the dungeon', d: dist[e] };
}
function dungeonReach(c, m) { const p = dungeonPath(c, c.pos, { x: m.x, y: m.y, z: m.z }); return p.noPath ? Infinity : p.d || p.total; }

/* ------------------------------------------------------------------ the group */
function partyOf(c) { return rt(c).party || null; }
function partyUnit(c, id) { const p = partyOf(c); return p ? p.find((u) => u.id === id) : null; }
function makeParty(c, d) {
  const n = Math.max(0, (d.players || 5) - 1); const s = charStats(c); const out = [];
  const tanks = n >= 19 ? (n >= 39 ? 4 : 2) : 1, heals = n >= 19 ? Math.ceil((n + 1) / 5) : 1;
  const roles = []; for (let i = 0; i < n; i++) roles.push(i < tanks ? 'tank' : i < tanks + heals ? 'healer' : 'dps');
  const red = 1 - clamp(fbArmor(c.level) / (fbArmor(c.level) + 400 + 85 * c.level), 0, 0.75);
  const raid = (d.players || 5) > 5;
  // a companion does at least what a player of this level does in fitting gear; a raid is in raid gear
  const L = c.level; const typical = 3 + L * 1.2 + Math.max(0, L - 50) * 8;
  const myDps = Math.max(typical, (c.cls === 1 ? (s.mhDps + s.ohDps) * red * 1.3 : classDps(c, s, 1 - red))) * (raid ? 2.5 : 1);
  // the companions: hired from the roster (their skill and knowledge of this place decide how well they play)
  const plan = G.dgPlan && G.dgPlan.map === d.map && G.dgPlan.cid === c.id && G.dgPlan.t > G.gameTime - 900 ? G.dgPlan.p : partyPlan(c, d); G.dgPlan = null;
  if (plan.fee) { const pay = Math.min(plan.fee, c.gold); c.gold -= pay; log('Hired ' + plan.members.length + ' mercenar' + (plan.members.length > 1 ? 'ies' : 'y') + ' for ' + money(pay) + '.'); }
  else if (plan.members.length) log(plan.members.length + ' mercenaries come along for free (first-timers).');
  plan.members.forEach((x, i) => {
    const role = x.role; const mm = x.m; const ex = execLevel(mm, d.map), aw = awareLevel(mm, d.map); const eff = 0.65 + 0.35 * ex / 10;
    const hp = Math.round(s.maxHp * (role === 'tank' ? 1.7 : role === 'healer' ? 0.95 : 1.05) * (raid ? 1.6 : 1));
    out.push({ id: 'g' + i, rid: mm.id, cls: mm.cls, ex, aw, thr: role === 'tank' ? 3 * (0.7 + 0.3 * ex / 10) : role === 'healer' ? 0.5 : 0.55 + 0.35 * (1 - aw / 10),
      comp: true, role, name: mm.name, maxhp: hp, hp, dps: myDps * (role === 'dps' ? 1.0 : role === 'tank' ? 0.55 : 0.15) * eff, armorRed: role === 'tank' ? 0.55 : 0.2,
      x: c.pos.x + Math.cos(i * 2.1) * 3, y: c.pos.y + Math.sin(i * 2.1) * 3, swing: Math.random() * 2, cast: 0, dead: false, taunt: 0 });
    mercInit(c, out[out.length - 1]);
  });
  rt(c).party = out; rt(c).dmgLog = [];
  return out;
}
function partyAlive(c) { const p = partyOf(c); return p ? p.filter((u) => !u.dead) : []; }
/* who a creature hits: the one with the most threat (a little more is needed to take it away) */
function mobVictimKey(m, c) {
  let key = 'c', best = m.charThreat || 0;
  if (petAlive(c) && (m.petThreat || 0) > best * 1.1) { key = 'p'; best = m.petThreat; }
  if (m.gThr) for (const id in m.gThr) { const u = partyUnit(c, id); if (u && !u.dead && m.gThr[id] > best * 1.1) { key = id; best = m.gThr[id]; } }
  return key;
}
function gThreat(m, u, v) { m.gThr = m.gThr || {}; m.gThr[u.id] = (m.gThr[u.id] || 0) + v * (u.thr || (u.role === 'tank' ? 3 : u.role === 'healer' ? 0.5 : 0.7)); }
function compTakeHit(c, u, m, d) {
  if ((u.immuneUntil || 0) > G.gameTime) { fx(u.x, u.y, 'immune', '#cfc6b0'); return; }          // Ice Block, Divine Shield (mercs.js tactics)
  if ((u.drUntil || 0) > G.gameTime) d *= u.drMul || 1;                                       // Shield Wall, Evasion, Barkskin
  d = Math.max(1, Math.round(d * (1 - u.armorRed)));
  if (Math.random() < (u.role === 'tank' ? 0.25 : 0.08)) { fx(u.x, u.y, u.role === 'tank' ? 'parry' : 'dodge', '#cfc6b0'); return; }
  mercOnHit(u);
  if (u.absorb && u.absorb.until > G.gameTime && u.absorb.v > 0) { const a = Math.min(d, u.absorb.v); u.absorb.v -= a; d -= a; if (a) fx(u.x, u.y, 'absorb ' + a, '#9fe0ff'); if (u.absorb.v <= 0) { u.absorb = null; const b = mercBuff(u, 'Power Word: Shield'); if (b) b.until = 0; } if (!d) return; }
  u.hp -= d; meterGroup(c, u, 'taken', d); fx(u.x, u.y, '-' + d, '#ff9a8a'); const r = rt(c); (r.dmgLog = r.dmgLog || []).push([G.gameTime, d]);
  if (u.hp <= 0) { u.hp = 0; u.dead = true; u.deadAt = G.gameTime; u.cb = null; u.buffs = []; u.absorb = null; log(u.name + ' (' + u.role + ') has died.'); for (const x of threatsOf(c)) if (x.gThr) delete x.gThr[u.id]; }
}
function partyStep(c, dt) {
  const p = partyOf(c); if (!p || !p.length) return; const r = rt(c);
  const threats = r.threats || []; const now = G.gameTime;
  if (r.dmgLog && r.dmgLog.length > 60) r.dmgLog = r.dmgLog.filter((x) => now - x[0] < 10);
  // incoming damage per second over the last 8 seconds (the healers keep up with it)
  let inc = 0; for (const [t, v] of r.dmgLog || []) if (now - t < 8) inc += v; inc /= 8;
  const healers = p.filter((u) => u.role === 'healer' && !u.dead).length || 1;
  p.forEach((u, i) => {
    if (u.dead) {
      // out of combat a healer brings them back; with every healer dead it takes longer (a soulstone, a long walk back)
      const healer = p.some((h) => h.role === 'healer' && !h.dead);
      if (!threats.length && !r.ghost && now - u.deadAt > (healer ? 12 : 30)) { u.dead = false; u.hp = Math.round(u.maxhp * 0.6); if (u.pt === 0) u.mana = Math.round(u.maxmana * 0.6); u.x = c.pos.x; u.y = c.pos.y; log(u.name + ' is back on their feet.'); }
      return;
    }
    if (typeof msUnitStep === 'function' && msUnitStep(c, u, dt)) return;      // stunned (creature spells); its damage over time
    const mv = (tx, ty, stop) => { const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy); if (d > stop) { const st = Math.min(d - stop, 7.5 * dt); u.x += dx / d * st; u.y += dy / d * st; return false; } return true; };
    if (!threats.length && u.role === 'tank' && r.tankPull && r.tankPull.st === 'alive') {
      const m = r.tankPull; const far = Math.hypot(m.x - u.x, m.y - u.y);
      if (G.state.settings.dgRangedPull !== false && isDungeonMap(c.pos.map) && far <= 30 && (typeof dgStraight !== 'function' || dgStraight(c.pos.map, { x: u.x, y: u.y, z: c.pos.z }, m))) {      // a shot from where it stands
        fx(u.x, u.y, 'Shoot', '#ffe9a8'); engage(m, c); gThreat(m, u, 50 + c.level * 6); if (m.help) callHelp(ensureWorld(c.pos.map), m, c); for (const x of threatsOf(c)) gThreat(x, u, 30 + c.level * 4); r.tankPull = null; return;
      }
      if (mv(m.x, m.y, MELEE_RANGE - 0.5)) { engage(m, c); gThreat(m, u, 50 + c.level * 6); if (m.help) callHelp(ensureWorld(c.pos.map), m, c); for (const x of threatsOf(c)) gThreat(x, u, 30 + c.level * 4); r.tankPull = null; }
      return;
    }
    if (!threats.length) {
      const a = i * 2.4 + 0.6, rad = 3 + (i % 3) * 1.5; mv(c.pos.x + Math.cos(a) * rad, c.pos.y + Math.sin(a) * rad, 0.8);
      u.hp = Math.min(u.maxhp, u.hp + u.maxhp * 0.06 * dt); mercIdle(c, u, dt); return;
    }
    // spells: buffs, heals, debuffs, the casters' damage (mercs.js); the melee ones go on below
    if (mercFight(c, u, dt, threats, inc, healers, mv)) return;
    // tank: take the creatures that are not on a tank; damage dealers: the character's target
    let m = null;
    if (u.role === 'tank') {
      const loose = threats.filter((x) => { const k = mobVictimKey(x, c); const v = partyUnit(c, k); return !(v && v.role === 'tank'); });
      m = loose.sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0] || threats.find((x) => mobVictimKey(x, c) === u.id) || r.tgt;
      if (m && mobVictimKey(m, c) !== u.id && u.taunt <= now && Math.hypot(m.x - u.x, m.y - u.y) < 30 && Math.random() < dt * (0.6 + 4 * (u.aw == null ? 5 : u.aw) / 10)) {
        const top = Math.max(m.charThreat || 0, m.petThreat || 0, ...Object.values(m.gThr || {}));
        m.gThr = m.gThr || {}; m.gThr[u.id] = top * 1.3 + 60 + c.level * 4; u.taunt = now + 6; fx(u.x, u.y, 'Taunt', '#9fc7ff');
      }
    } else m = r.tgt && r.tgt.st !== 'dead' ? r.tgt : threats[0];
    if (u.role === 'tank') for (const x of threats) if (x !== m && Math.hypot(x.x - u.x, x.y - u.y) < 10) gThreat(x, u, (c.level + 10) * dt * 2);      // shouts and area attacks keep the pack on the tank
    if (!m || m.st === 'dead') return;
    if (!mv(m.x, m.y, MELEE_RANGE - 0.5)) return;
    if (u.role !== 'tank' && G.gameTime < (u.openAt || 0)) return;          // waits for the tank to take the pull
    mercMeleeExtra(c, u, m, threats);
    u.swing -= dt; if (u.swing > 0) return; u.swing += 2.0; if (Math.random() < 0.4 * (1 - (u.ex == null ? 5 : u.ex) / 10)) u.swing += 0.3 + Math.random() * 1.2;
    const diff = m.lvl - c.level; if (Math.random() < 0.05 + Math.max(0, diff) * 0.02) { fx(m.x, m.y, 'miss', '#cfc6b0'); return; }
    const arm = Math.max(0, m.armor + mobMods(m).armor); const red = 1 - clamp(arm / (arm + 400 + 85 * c.level), 0, 0.75);
    let v = u.dps * 2.0 * rnd(0.85, 1.15) * red; if (Math.random() < 0.08) v *= 2;
    v = Math.max(1, Math.round(v)); m.hp -= v; onMobDamaged(m, v); gThreat(m, u, v); mercOnSwing(u, v); meterGroup(c, u, 'dmg', v, u.role === 'tank' ? 'Tanking attacks' : 'Attacks'); fx(m.x, m.y, '' + v, '#e8d8b8');
    if (m.st === 'alive') engage(m, c);
    if (m.hp <= 0) killMob(c, m);
  });
}
function drawParty(ctx, m) {
  const c = active(); const p = partyOf(c); if (!p || c.pos.map !== m.map) return;
  ctx.save(); ctx.font = '10px Segoe UI'; ctx.textAlign = 'center';
  for (const u of p) {
    if (m.dmap && dungeonFloorAt(m.dungeon, u.x, u.y, c.pos.z) !== m.floor) continue;
    const [x, y] = w2s(u.x, u.y); ctx.globalAlpha = u.dead ? 0.35 : 1;
    if (!(u.cls && drawClassIcon(ctx, u.cls, x, y, 7))) { ctx.fillStyle = DG_ROLE_COLOR[u.role]; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.3); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#000'; ctx.fillRect(x - 9, y - 11, 18, 3); ctx.fillStyle = '#3fae5a'; ctx.fillRect(x - 9, y - 11, 18 * u.hp / u.maxhp, 3);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ the dungeon keepers
   An NPC of this game just inside the entrance of every dungeon, each with a name of its own: sells food and water of
   every level, repairs, and gives the quests of that dungeon - and takes them back when they are done (the turn-in of
   the dungeon's quests can be done right there). A dungeon quest: every objective is done with creatures or objects of
   that dungeon. */
const DG_KEEPER_BASE = 9500000;
const DG_KEEPER_NAMES = { 389: 'Grukka Emberhide', 36: 'Old Wendel Brackwater', 43: 'Tahla Mistrunner', 33: 'Corwin Ashgrave', 48: 'Neria Tidewhisper',
  34: 'Sergeant Pell Harrow', 90: 'Fizzlebolt Cogspanner', 47: 'Brakka Thornhide', 189: 'Brother Aldric Vane', 129: 'Shaggra Bonewise', 70: 'Dunric Stonebeard',
  209: 'Zaressa Sandstrider', 349: 'Velinde Moonroot', 109: "Jin'kesh the Swampkeeper", 230: 'Thurgan Coalfist', 229: 'Magda Ironclaw', 429: 'Eldrinor Starweave',
  289: 'Mortimer Graves', 329: 'Lady Elsbeth Crane', 409: 'Torvald Flameward', 249: 'Kasra Dragonwatch', 469: 'Varek Blackscale', 309: "Ma'zun the Peacekeeper",
  509: 'Sarissa Dunewalker', 531: 'Halvenor Sandshield', 533: 'Father Odran Lightvigil' };
/* water, bread and meat for every level (1, 5, 15, 25, 35, 45) */
const DG_KEEPER_GOODS = [159, 1179, 1205, 1708, 1645, 8766, 4540, 4541, 4542, 4544, 4601, 8950, 117, 2287, 3770, 3771, 4599, 8952];
function isDgKeeper(e) { return e >= DG_KEEPER_BASE && e < DG_KEEPER_BASE + 10000; }
function dgKeeperOf(map) { return G.dgKeepers && G.dgKeepers[map] || null; }
/* the dungeon a quest is done in, from where its creatures and objects are (null: not a dungeon quest) */
function dgQuestMap(q) {
  if (!q.objectives || !q.objectives.length) return null; let map = null;
  for (const ob of q.objectives) {
    const maps = new Map(); const add = (m) => maps.set(m, (maps.get(m) || 0) + 1);
    if ((ob.type === 'Kill' || ob.type === 'Use/Interact') && ob.id > 0) for (const sp of G.spawnMap.get(ob.id) || []) add(sp[0]);
    else if ((ob.type === 'Kill' || ob.type === 'Use/Interact') && ob.id < 0) for (const sp of objSpawns(-ob.id)) add(sp[0]);
    else if (ob.type === 'Collect') { for (const [e] of G.q.itemSrc[ob.id] || []) for (const sp of G.spawnMap.get(+e) || []) add(sp[0]); for (const [e] of G.q.goSrc[ob.id] || []) for (const sp of objSpawns(e)) add(sp[0]); }
    else return null;
    let best = null, bn = 0, tot = 0; for (const [m, n] of maps) { tot += n; if (n > bn) { bn = n; best = m; } }
    if (best == null || !isDungeonMap(best) || bn < tot * 0.6) return null;
    if (map != null && map !== best) return null; map = best;
  }
  return map;
}
/* at boot, after the quest index: the keepers as creatures (spawn, name, friendly, vendor + repair + quests) */
function dungeonKeepersInit() {
  if (!G.d.dungeons) return; G.dgKeepers = {}; const H = G.d.hostility; const nr = H.races.length;
  G.d.vendorItems = G.d.vendorItems || {};
  const qs = {}; for (const q of G.d.quests) { const m = dgQuestMap(q); if (m != null) (qs[m] = qs[m] || []).push(q); }
  for (const d of dungeonList()) {
    const e0 = d.enter && d.enter[0]; if (!e0) continue; const e = DG_KEEPER_BASE + d.map; const name = DG_KEEPER_NAMES[d.map] || ('Keeper of ' + d.name);
    // just inside, a couple of yards beside the way in
    const x = e0.x + 2.5, y = e0.y + 2.5;
    const lvl = Math.max(10, Math.min(60, (d.lmax || d.lmin || 20) + 5));
    const sp = [d.map, x, y, e0.z, 0, 0, 0, 300, 300, 0];
    G.spawnList.push([e, [sp]]); G.spawnMap.set(e, [sp]);
    G.mobIdx[e] = [e, name, lvl, lvl, 0, 7, 0];
    H.creatures[e] = [35, 'F'.repeat(nr), 0, 0, 0, 1, 0, lvl, lvl, NPC_VENDOR | NPC_REPAIR | 2];
    G.d.vendorItems[e] = DG_KEEPER_GOODS.filter((id) => itemRow(id)).map((id) => [id, 0]);
    const list = qs[d.map] || [];
    for (const q of list) {
      if (q.giver.some((x) => x[0] === 'npc') && !q.giver.some((x) => x[1] === e)) q.giver.push(['npc', e]);
      if (!q.turnin.some((x) => x[1] === e)) q.turnin.push(['npc', e]);
    }
    G.dgKeepers[d.map] = { e, name, map: d.map, x, y, z: e0.z, quests: list.map((q) => q.id) };
  }
  G.vend = null;
  buildQuestIndex();             // again, with the keepers as givers and turn-ins
}
/* ------------------------------------------------------------------ the run */
function orderDungeon(c, d, group, resume) {
  if (G.awayNoDungeon) return;                 // away.js: no dungeons while the game is closed
  const min = d.lmin - (d.kind === 'raid' ? 0 : 3);
  if (c.level < min) { log(d.name + ' needs level ' + min + '.'); return; }
  if (isDungeonMap(c.pos.map) && c.pos.map !== d.map) { log('Leave ' + dungeonByMap(c.pos.map).name + ' first.'); return; }
  // with your own group: the tank leads the run (it walks in front and pulls), the others follow it
  const grp = typeof groupOf === 'function' ? groupOf(c) : null;
  if (grp && grp.leader === c.id) {
    const tank = groupChars(grp).find((m) => m !== c && grpRole(m) === 'tank' && m.pos.map === c.pos.map);
    if (tank && grpRole(c) !== 'tank') {
      const back = resume !== undefined ? resume : (c.order && ['leveling', 'questing', 'quest'].includes(c.order.type) ? c.order : null);
      groupPromote(tank); log(tank.name + ' (the tank) leads the group through ' + d.name + '.');
      withLog(tank, () => orderDungeon(tank, d, group, back)); return;
    }
  }
  const o = { type: 'dungeon', map: d.map, label: d.name, group: !!group, phase: c.pos.map === d.map ? 'inside' : 'travel', started: G.gameTime, kills: 0, bossKills: 0, resume: resume !== undefined ? resume : (c.order && ['leveling', 'questing', 'quest'].includes(c.order.type) ? c.order : null) };
  if (o.phase === 'travel') {
    o.trip = d.entrance ? planTrip(c, { map: d.entrance.map, x: d.entrance.x, y: d.entrance.y }) : null;
    if (!o.trip) { log('No way to ' + d.name + ' found.'); return; }
  } else if (group && !partyOf(c)) makeParty(c, d);
  c.order = o; rt(c).mv = null; rt(c).tgt = null;
  if (o.phase === 'inside') { o.entered = G.gameTime; dungeonRunTier(c, d, o); }
  log('Order: ' + (group ? 'run ' + d.name + ' with a group of ' + d.players : 'run ' + d.name + ' alone') + '.'); save(); renderOrder();
}
/* hand-drawn dungeons: the tank's knowledge of the place decides the way (pullplan.js) */
function dungeonRunTier(c, d, o) {
  o.tier = dungeonHasTiers(d) ? tierOfKnowledge((dungeonTank(c, d) || { k: awareLevel(c, d.map) }).k) : null; o.gi = null; o.routeBegun = false;
  if (o.tier) { const tk = dungeonTank(c, d) || { name: c.name, k: awareLevel(c, d.map) }; log((tk.name === c.name ? 'You lead' : tk.name + ' tanks') + ' (knows ' + d.name + ' ' + stars(tk.k) + '/10): ' + ROUTE_TIERS[o.tier] + '.'); }
}
function enterDungeon(c, d, o) {
  const r = rt(c); const e = d.enter[o.wing || 0] || d.enter[0]; if (!e) { log('No way into ' + d.name + '.'); c.order = null; return; }
  // a fresh instance: every creature back in place
  const W = ensureWorld(d.map); for (const m of W.list) { initMob(m); m.gThr = null; } W.dead = []; W.active.clear();
  c.pos = { map: d.map, x: e.x, y: e.y, z: e.z, o: c.pos.o };
  r.mv = null; r.tgt = null; r.threats = []; r.danger = []; r.resting = false; r.interact = null;
  if (o.group) makeParty(c, d); else r.party = null;
  // hand-drawn dungeons: the tank's knowledge of the place decides the way
  dungeonRunTier(c, d, o);
  if (c.pet && rt(c).pet) { rt(c).pet.x = c.pos.x + 2; rt(c).pet.y = c.pos.y + 1; }
  o.phase = 'inside'; o.entered = G.gameTime; o.lastProgress = G.gameTime;
  const nm = (partyOf(c) || []).length; const own = typeof groupOf === 'function' && groupOf(c) ? groupChars(groupOf(c)).length - 1 : 0;
  log('Entered ' + d.name + (own ? ' with ' + own + ' of your characters' + (nm ? ' and ' + nm + ' mercenar' + (nm > 1 ? 'ies' : 'y') : '') : o.group && nm ? ' with ' + nm + ' mercenar' + (nm > 1 ? 'ies' : 'y') : '') + '.');
  if (isActive(c) && $('follow').checked) setMap(dungeonMapAt(c.pos), false, true);
  save();
}
function leaveDungeon(c, msg) {
  const d = dungeonByMap(c.pos.map) || (c.order && dungeonByMap(c.order.map)); const r = rt(c);
  const o = c.order;
  if (d && o && o.type === 'dungeon' && o.phase !== 'travel' && o.entered != null && !o.credited) { o.credited = true; masteryRunEnd(c, d, o); }
  if (d && c.pos.map === d.map && d.entrance) { c.pos = { map: d.entrance.map, x: d.entrance.x, y: d.entrance.y, z: 0, o: c.pos.o }; }
  r.party = null; r.mv = null; r.tgt = null; r.threats = []; r.danger = [];
  if (msg) log(msg);
  c.order = o && o.type === 'dungeon' && o.resume ? o.resume : null;
  if (c.order && c.order.type === 'leveling' && c.order.mode !== 'dgtour') { c.order.mode = 'pick'; c.order.trip = null; }
  if (isActive(c) && $('follow').checked) goToCharacter();
  save(); renderOrder();
}
/* the Quests card button: everyone of the group out of the dungeon at once (to the entrance outside) and the dungeon
   reset - every creature back, as a new instance */
function dungeonResetOut(c) {
  const g = typeof groupOf === 'function' ? groupOf(c) : null; const L = g ? groupLeader(g) || c : c;
  const d = dungeonByMap(L.pos.map) || dungeonByMap(c.pos.map); if (!d) return false;
  const who = g ? groupChars(g).filter((m) => m.pos.map === d.map) : [c]; if (!who.includes(c) && c.pos.map === d.map) who.push(c);
  const W = G.world[d.map]; if (W) for (const m of W.active) evade(W, m);
  for (const m of who) {
    const r = rt(m); if (r.ghost) { r.ghost = null; m.hp = Math.max(1, Math.round(charStats(m).maxHp * 0.5)); }
    r.cast = null; r.interact = null; r.resting = false; r.trail = null;
    if (m.order && m.order.type === 'dungeon') withLog(m, () => leaveDungeon(m, 'Teleported out of ' + d.name + '.'));
    else { if (d.entrance) m.pos = { map: d.entrance.map, x: d.entrance.x + (Math.random() - 0.5) * 4, y: d.entrance.y + (Math.random() - 0.5) * 4, z: 0, o: m.pos.o }; r.party = null; r.mv = null; r.tgt = null; r.threats = []; r.danger = []; if (m.order && m.order.type !== 'follow') m.order = null; }
  }
  if (W) { for (const m of W.list) { initMob(m); m.gThr = null; m.cThr = null; } W.dead = []; W.active.clear(); }
  if (g) g.hold = false;
  log(d.name + ' is reset - everyone is at the entrance outside.');
  if (isActive(c) && $('follow').checked) goToCharacter();
  save(); renderOrder(); return true;
}
/* the Quests card buttons while in a dungeon: Rest - everyone sits down and the group stays put until Continue;
   Continue dungeon - on with the run now: nobody waits or rests, whoever is far off is brought to the leader, the leader
   picks the way on again (and gets its dungeon order back if it was lost) */
function dungeonGroupOf(c) { const g = typeof groupOf === 'function' ? groupOf(c) : null; const L = g ? groupLeader(g) || c : c; return { g, L, who: g ? groupChars(g) : [c] }; }
function dungeonRest(c) {
  const { g, L, who } = dungeonGroupOf(c); const d = dungeonByMap(L.pos.map); if (!d) return;
  const h = g || L.order; if (!h) return;
  // first back to the route (the nearest point of it), then everyone sits down there
  const p = dgRoutePoint(L, d); h.hold = true; h.restAt = p; h.restSat = !p;
  if (p && L.order && L.order.type === 'dungeon') { L.order.gi = p.gi; L.order.target = null; }
  for (const m of who) { if (m.pos.map !== d.map) continue; const r = rt(m); if (r.ghost) continue; r.mv = null; r.tgt = null; r.resting = false; }
  if (!p) dgSitDown(c);
  log((p ? 'Back to the route, then resting' : 'Resting') + ' in ' + d.name + ' - press Continue dungeon to go on.'); save(); renderOrder();
}
/* the nearest point of the dungeon's route to the leader (on its floor): {x, y, z, gi} or null */
function dgRoutePoint(L, d) {
  const plan = dungeonPullPlan(d, (L.order && L.order.type === 'dungeon' && L.order.tier) || null); const R = plan && plan.route; if (!R || R.length < 2) return null;
  const f = dungeonFloorAt(d, L.pos.x, L.pos.y, L.pos.z); let best = null, bd = Infinity;
  for (let i = 1; i < R.length; i++) {
    const a = R[i - 1], b = R[i]; if (b.cut) continue;
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1; const t = clamp(((L.pos.x - a.x) * vx + (L.pos.y - a.y) * vy) / L2, 0, 1);
    const p = { x: a.x + vx * t, y: a.y + vy * t, z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t, gi: i };
    if (dungeonFloorAt(d, p.x, p.y, p.z) !== f) continue;
    const dd = Math.hypot(p.x - L.pos.x, p.y - L.pos.y) + Math.abs(p.z - (L.pos.z || p.z)) * 2; if (dd < bd) { bd = dd; best = p; }
  }
  return best;
}
/* everyone of the group in the dungeon sits down to rest to full */
function dgSitDown(c) {
  const { who } = dungeonGroupOf(c);
  for (const m of who) { const r = rt(m); if (r.ghost || !isDungeonMap(m.pos.map) || (r.threats || []).length) continue; r.mv = null; r.resting = true; r.restFull = true; }
}
/* holding (the Rest button): the leader walks back to the route point, then everyone sits there */
function dgHoldStep(c, h) {
  const r = rt(c);
  if (h.restAt && !h.restSat) {
    if (goTo(c, h.restAt.x, h.restAt.y, 2, h.restAt.z) || r.blocked) { r.blocked = false; h.restSat = true; r.mv = null; dgSitDown(c); }
    return;
  }
  r.mv = null;
}
function dungeonContinue(c) {
  const { g, L, who } = dungeonGroupOf(c); const d = dungeonByMap(L.pos.map) || dungeonByMap(c.pos.map); if (!d) return;
  if (g) { g.hold = false; g.restAt = null; } if (L.order) { L.order.hold = false; L.order.restAt = null; }
  if (!L.order || L.order.type !== 'dungeon' || L.order.map !== d.map) { withLog(L, () => orderDungeon(L, d, true)); }
  const o = L.order;
  if (o && o.type === 'dungeon') { o.target = null; o.since = G.gameTime; o.targetSince = null; o.lastPos = null; o.phase = o.phase === 'leaving' ? 'leaving' : 'inside'; if (o.entered == null) o.entered = G.gameTime; }
  for (const m of who) {
    if (m.pos.map !== d.map) continue; const r = rt(m); if (r.ghost) continue;
    r.mv = null; r.blocked = false; r.resting = false; r.restFull = false; r.eating = null; r.drinking = null;
    if (m !== L && (Math.hypot(m.pos.x - L.pos.x, m.pos.y - L.pos.y) > 25 || Math.abs((m.pos.z || 0) - (L.pos.z || 0)) > 10)) { m.pos = { map: L.pos.map, x: L.pos.x + (Math.random() - 0.5) * 3, y: L.pos.y + (Math.random() - 0.5) * 3, z: L.pos.z, o: L.pos.o }; r.trail = null; }
    if (m !== L && g && (!m.order || m.order.type !== 'follow')) m.order = { type: 'follow', label: L.name };
  }
  log('On with ' + d.name + '.'); save(); renderOrder();
}
/* the Dungeon control card (top of the right panel, only while in a dungeon): how the run goes, Rest, Continue
   dungeon, Teleport out and reset */
function renderDgCard() {
  const el = $('dgCard'); if (!el) return; const c = active(); if (!c) return;
  const { g, L } = dungeonGroupOf(c); const d = isDungeonMap(c.pos.map) ? dungeonByMap(c.pos.map) : isDungeonMap(L.pos.map) ? dungeonByMap(L.pos.map) : null;
  el.hidden = !d; if (!d) { el._h = ''; return; }
  let h = cardHead('dgctl', 'Dungeon control <span class="small muted">' + esc(d.name) + '</span>', true);
  if (cardOpen('dgctl', true)) {
    const held = (g && g.hold) || (L.order && L.order.hold); const ot = L.order && L.order.type === 'dungeon' ? orderText(L) : null;
    h += '<div class="small">' + (held ? '<b style="color:#ffd866">Paused</b> - ' + ((g ? g.restSat : L.order && L.order.restSat) ? 'on the route, resting. Nobody starts a fight or wanders off; give orders by hand if you like. Continue dungeon goes on.' : 'walking back to the route ...') : ot ? esc(ot.d) : '<span style="color:#e6b93c">' + esc(L.name) + ' is not running the dungeon right now - Continue dungeon starts it again.</span>') + '</div>';
    if (g) { const dead = groupChars(g).filter((m) => m.pos.map === d.map && rt(m).ghost).length; if (dead) h += '<div class="small" style="color:#ff8a7a">' + dead + ' down - back on their feet after the fight.</div>'; }
    h += '<div class="dgbtns"><button class="act" data-dgc="rest"' + (held ? ' disabled' : '') + ' title="A pause: back to the route, everyone sits down and stays put (you can give orders by hand) until Continue dungeon">' + (held ? 'Paused' : 'Rest (pause)') + '</button>' +
      '<button class="act" data-dgc="cont" title="On with the run now: nobody waits, the ones far off come to the leader, the leader finds the way on again">Continue dungeon</button></div>' +
      '<label class="chk small"><input type="checkbox" data-dgset="dgPreCC"' + (G.state.settings.dgPreCC !== false ? ' checked' : '') + '> Crowd control before each pull (Polymorph, Sap, Shackle, Hibernate, Banish, traps) - the others leave them alone, the tank pulls after</label>' +
      '<label class="chk small"><input type="checkbox" data-dgset="dgRangedPull"' + (G.state.settings.dgRangedPull !== false ? ' checked' : '') + '> The tank pulls with a shot from range (no ammo needed) and waits for the pack to come</label>' +
      '<button class="act red dgwide" data-dgc="reset" title="Everyone out to the entrance at once; the dungeon starts over (every creature back)">Teleport out and reset ' + esc(d.name) + '</button>';
  }
  if (el._h !== h) { el.innerHTML = h; el._h = h; }
  el.onchange = (e) => { const k = e.target.dataset && e.target.dataset.dgset; if (!k) return; G.state.settings[k] = e.target.checked; save(); renderDgCard(); };
  el.onclick = (e) => {
    const b = e.target.closest('[data-dgc]'); if (!b) return; const k = b.dataset.dgc;
    if (k === 'rest') dungeonRest(c);
    else if (k === 'cont') dungeonContinue(c);
    else if (k === 'reset' && confirm('Teleport ' + (g ? 'the group' : c.name) + ' out of ' + d.name + ' and reset it?\nThe run ends and every creature in it comes back.')) dungeonResetOut(c);
    renderDgCard();
  };
}
/* walking out: to the nearest way out (or the one given), then out through the portal to the entrance */
function dungeonNearestExit(c, d) {
  let best = null, bd = Infinity;
  for (const e of d.enter || []) { const p = dungeonPath(c, c.pos, { x: e.x, y: e.y, z: e.z }); const L = p.noPath ? 1e6 + Math.hypot(e.x - c.pos.x, e.y - c.pos.y) : p.total; if (L < bd) { bd = L; best = e; } }
  return best;
}
function orderLeaveDungeon(c, exit, msg) {
  const d = dungeonByMap(c.pos.map); if (!d) return;
  let o = c.order;
  if (!o || o.type !== 'dungeon' || o.map !== d.map) { o = { type: 'dungeon', map: d.map, label: d.name, group: !!rt(c).party, phase: 'inside', started: G.gameTime, entered: G.gameTime, kills: 0, bossKills: 0, resume: null }; c.order = o; }
  o.phase = 'leaving'; o.exit = exit || dungeonNearestExit(c, d); o.leaveT = G.gameTime; o.leaveMsg = msg || 'Left ' + d.name + '.'; o.target = null;
  rt(c).mv = null; log('Walking to the exit of ' + d.name + '.'); save(); renderOrder(); if (G.selected && G.selected.kind === 'dungeon') renderInfo(G.selected);
}
/* one step of walking to the way out; true once outside */
function dungeonExitStep(c, o, d) {
  const e = o.exit || (o.exit = dungeonNearestExit(c, d)); const r = rt(c);
  o.leaveT = o.leaveT || G.gameTime;
  const there = !e || goTo(c, e.x, e.y, 4, e.z);
  // stuck (or far too long): out anyway, like using the hearthstone
  if (!there && !r.blocked && G.gameTime - o.leaveT < 600) return false;
  r.blocked = false; dungeonPortalOut(c, d); return true;
}
/* through the portal: from inside to the entrance outside */
function dungeonPortalOut(c, d) {
  const r = rt(c); const o = c.order;
  if (o && o.type === 'dungeon' && o.entered != null && !o.credited) { o.credited = true; masteryRunEnd(c, d, o); }       // before the group leaves
  if (d.entrance) c.pos = { map: d.entrance.map, x: d.entrance.x, y: d.entrance.y, z: 0, o: c.pos.o };
  r.party = null; r.mv = null; r.tgt = null; r.threats = []; r.danger = [];
  if (isActive(c) && $('follow').checked) goToCharacter();
}
/* a travel order to another map that starts inside a dungeon, or needs ships and flights (from orderTravel) */
function travelCross(c, o) {
  if (isDungeonMap(c.pos.map) && c.pos.map !== o.target.map) {
    const d = dungeonByMap(c.pos.map); o.leaving = true;
    if (!dungeonExitStep(c, o, d)) return 'busy';
    o.leaving = false; log('Out of ' + d.name + '.');
    if (c.pos.map === o.target.map) { o.cross = false; o.via = 'walking'; replanTravel(c, o); return 'done'; }
    o.trip = planTrip(c, o.target); if (!o.trip) { log('No way to ' + o.label + ' found.'); c.order = null; renderOrder(); return 'fail'; }
    renderOrder();
  }
  if (o.trip) {
    const st = tripStep(c, o.trip); if (st === 'busy') return 'busy';
    if (st === 'fail') { log('Could not get to ' + o.label + '.'); c.order = null; save(); renderOrder(); return 'fail'; }
    o.trip = null;
  }
  if (c.pos.map !== o.target.map) { log('Could not get to ' + o.label + '.'); c.order = null; save(); renderOrder(); return 'fail'; }
  o.cross = false; o.done = 0; o.total = 0; o.via = 'walking'; replanTravel(c, o); renderOrder(); return 'done';
}
function dungeonText(c, o) {
  const d = dungeonByMap(o.map);
  if (o.phase === 'leaving') return { t: 'Dungeon: ' + o.label, d: 'walking to the exit' + (o.exit ? ' (' + Math.round(Math.hypot(o.exit.x - c.pos.x, o.exit.y - c.pos.y)) + ' yd)' : '') };
  if (o.phase === 'travel') return { t: (o.onlyTravel ? 'Travel to ' : 'Dungeon: ') + o.label, d: o.trip && o.trip.legs[o.trip.i] ? tripText(o.trip) : 'to the entrance' };
  const left = d ? dungeonBossesLeft(c, d).length : 0;
  const pl = d && o.gi != null && G.pullPlans && G.pullPlans[d.map + (o.tier ? ':' + o.tier : '')]; const rp = pl && pl.cum ? ' - route ' + Math.round(100 * (pl.cum[Math.min(o.gi, pl.cum.length - 1)] || 0) / Math.max(1, pl.length)) + '%' : '';
  return { t: 'Dungeon: ' + o.label + rp, d: (o.target && o.target.wp ? 'following the route, ' : o.target ? 'going for ' + (o.target.info ? o.target.info[1] : 'a creature') + ', ' : '') + o.bossKills + ' bosses down, ' + left + ' left, ' + o.kills + ' kills' + (typeof groupOf === 'function' && groupOf(c) ? ', group ' + groupChars(groupOf(c)).filter((m) => !rt(m).ghost && m.hp > 0).length + '/' + groupChars(groupOf(c)).length + ' up' + (partyOf(c) && partyOf(c).length ? ', mercenaries ' + partyAlive(c).length + '/' + partyOf(c).length : '') : o.group ? ', group ' + partyAlive(c).length + '/' + ((d && d.players - 1) || 0) + ' alive' : '') };
}
function dungeonBossesLeft(c, d) {
  const W = ensureWorld(d.map); const ids = new Set(d.bosses.map((b) => b.e));
  return W.list.filter((m) => ids.has(m.e) && m.st !== 'dead' && !m.unreach);
}
/* what to go for next: the nearest boss (by the way through the dungeon), or with "kill every creature" the nearest creature */
function dgTargetKey(x) { return x.key || (x.go ? x.e + ':' + x.i : 'm' + x.e); }
/* what the character's quests want in here: creatures to kill (or to loot an item from), objects to use or loot */
function dungeonQuestTargets(c, d) {
  const mobs = new Map(), gos = new Map();
  for (const qid in c.quests) {
    const q = G.q.byId[qid]; if (!q || questIgnored(c, q.id)) continue;
    q.objectives.forEach((ob, i) => {
      if (objDone(c, q, i)) return;
      if (ob.type === 'Kill' || ob.type === 'Use/Interact') { if (ob.id < 0) gos.set(-ob.id, [q.id, i, 'use']); else mobs.set(ob.id, [q.id, i]); }
      else if (ob.type === 'Collect') { for (const [e] of G.q.itemSrc[ob.id] || []) mobs.set(+e, [q.id, i]); for (const [e] of G.q.goSrc[ob.id] || []) gos.set(+e, [q.id, i, 'loot']); }
    });
  }
  const W = ensureWorld(d.map); const out = [];
  for (const m of W.list) if (m.st === 'alive' && !m.unreach && mobs.has(m.e) && attackable(m, c)) out.push(m);
  // quest givers and turn-ins in here (an NPC or an object, like a corpse or a tablet)
  const at = (s) => { if (s.obj) { const o = objSpawns(s.e)[s.i]; return o ? o[3] : null; } const m = W.list.find((x) => x.e === s.e && Math.hypot(x.hx - s.x, x.hy - s.y) < 3); return m ? m.z : null; };
  for (const qid in c.quests) {
    const q = G.q.byId[qid]; if (!q || !questDone(c, q) || questIgnored(c, q.id)) continue;
    for (const s of giverSpawns(q.turnin)) if (s.map === d.map) { out.push({ npc: 'turn', q, x: s.x, y: s.y, z: at(s), st: 'alive', info: [0, spotName(s)], key: 't' + q.id }); break; }
  }
  if (Object.keys(c.quests).length < 20) for (const { q, s } of (G.q.giverPts && G.q.giverPts[d.map]) || []) {
    if (out.some((x) => x.npc === 'pick' && x.q === q) || !questAvailable(c, q) || questSupport(q) || questIgnored(c, q.id) || q.level > c.level + 4 || !dungeonQuestOk(c, q, false) || !questDoable(c, q, {})) continue;
    out.push({ npc: 'pick', q, x: s.x, y: s.y, z: at(s), st: 'alive', info: [0, spotName(s)], key: 'p' + q.id });
  }
  for (const [e, qi] of gos) objSpawns(e).forEach((s, idx) => { if (s[0] === d.map && goFree(e, idx)) out.push({ go: true, e, i: idx, x: s[1], y: s[2], z: s[3], st: 'alive', info: [0, objName(e)], qi }); });
  return out;
}
/* ------------------------------------------------------------------ the guide route
   With a route (make_dungeon_routes.py) the group walks it from start to end, a yard or two to either side of the line,
   fights the packs that stand on the way and every boss of the guide on the way, and walks past the rest (unless it
   comes too close and they come). Before a big pack the classes of the group crowd-control what they can (skilled
   groups more often). */
function dungeonGroupClasses(c) {
  const cl = [c.cls]; for (const u of partyOf(c) || []) if (!u.dead && u.cls) cl.push(u.cls);
  if (typeof groupOf === 'function' && groupOf(c)) for (const o of groupChars(groupOf(c))) if (o !== c) cl.push(o.cls);
  return cl;
}
function dungeonSkill(c) { const p = partyOf(c) || []; const aw = p.filter((u) => u.aw != null).map((u) => u.aw); return aw.length ? aw.reduce((a, b) => a + b, 0) / aw.length : 5; }
function routeCC(c, d, o, p) {
  o.ccDone = o.ccDone || {}; const key = Math.round(p.x) + ',' + Math.round(p.y); if (o.ccDone[key]) return; o.ccDone[key] = true;
  if (p.kind === 'boss') return;
  const alive = p.members.filter((m) => m.st === 'alive' && !mobCCd(m));
  if (G.state.settings.dgPreCC !== false) {
    // the group's crowd control (your characters and the mercenaries) on as many as it can - one is left for the tank
    if (alive.length < 2) return;
    const cc = packCcFor({ members: alive }, dungeonGroupClasses(c)).slice(0, alive.length - 1);
    for (const x of cc) dgApplyCC(c, x);
    if (cc.length) o.ccWait = G.gameTime + 1.6 * cc.length;            // the casts take a moment; the tank pulls after them
    return;
  }
  if (p.n < 3 || Math.random() > 0.3 + 0.07 * dungeonSkill(c)) return;      // without the setting: first-timers forget it
  for (const x of packCcFor({ members: alive }, dungeonGroupClasses(c)).slice(0, p.n >= 5 ? 2 : 1)) dgApplyCC(c, x);
}
function dgApplyCC(c, x) {
  const a = addMobAura(c, x.m, { n: x.n, dur: 45000 }, { au: 12, lo: 0 }); a.cc = true;
  fx(x.m.x, x.m.y, x.n, '#c8a2ff'); log(CLASS_NAMES[x.cls] + ': ' + x.n + ' on ' + (x.m.info ? x.m.info[1] : 'a creature') + '.');
}
/* the group moves to another wing (its own way in) or through a teleporter */
function routeJump(c, d, q, say) {
  const r = rt(c); c.pos = { map: d.map, x: q.x, y: q.y, z: q.z, o: c.pos.o }; r.mv = null; r.tgt = null;
  for (const u of partyOf(c) || []) { u.x = q.x + (Math.random() - 0.5) * 4; u.y = q.y + (Math.random() - 0.5) * 4; }
  if (typeof groupOf === 'function' && groupOf(c)) for (const g of groupChars(groupOf(c))) if (g !== c) { g.pos = { map: d.map, x: q.x + (Math.random() - 0.5) * 4, y: q.y + (Math.random() - 0.5) * 4, z: q.z, o: 0 }; rt(g).mv = null; }
  const gr = (G.dgRoutes[String(d.map)] || [])[q.ri]; if (say) log('On to ' + (gr ? gr.name : 'the next part of ' + d.name) + '.');
}
function routeNext(c, d, o) {
  const plan = dungeonPullPlan(d, o.tier || null); if (!plan.cum) return undefined;          // no guide route for this dungeon
  const R = plan.route; if (o.gi == null) o.gi = 0;
  if (!o.routeBegun) { o.routeBegun = true; if (Math.hypot(R[0].x - c.pos.x, R[0].y - c.pos.y) > 60) routeJump(c, d, R[0], false); }
  // the packs on the way up to here (and the guide's bosses): the nearest one not crowd-controlled first
  const due = plan.packs.filter((p) => (p.kind === 'pull' || p.kind === 'boss') && p.gi != null && p.gi <= o.gi + 1 && p.members.some((m) => m.st === 'alive' && !m.unreach));
  if (due.length) {
    let best = null, bd = Infinity;
    for (const p of due) for (const m of p.members) {
      if (m.st !== 'alive' || m.unreach) continue; const ccd = (m.auras || []).some((a) => a.au === 12 && a.until > G.gameTime);
      const dd = Math.hypot(m.x - c.pos.x, m.y - c.pos.y) + (ccd ? 1000 : 0); if (dd < bd) { bd = dd; best = { m, p }; }
    }
    if (best) { routeCC(c, d, o, best.p); return best.m; }
  }
  // back on the line: after a fight (a pack a bit ahead, or one that came at us) the group picks the route up at the
  // nearest point ahead of where it stands - never walks back to a waypoint it is already past
  if (o.gi > 0 && o.gi < R.length && !R[o.gi].cut) {
    let bi = -1, bd = Infinity, bp = null;
    for (let i = o.gi; i < Math.min(R.length, o.gi + 12); i++) {
      if (R[i].cut || plan.cum[i - 1] - plan.cum[o.gi - 1] > 60) break;          // not past a dead end the route walks into and back out of
      const a = R[i - 1], b = R[i];
      const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
      const t = clamp(((c.pos.x - a.x) * vx + (c.pos.y - a.y) * vy) / L2, 0, 1);
      const px = a.x + vx * t, py = a.y + vy * t, pz = (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t;
      const dd = Math.hypot(px - c.pos.x, py - c.pos.y) + Math.abs(pz - (c.pos.z || pz)) * 2;
      if (dd <= bd + 0.5) { bd = dd; bi = i; bp = { x: px, y: py, z: pz, t, d2: Math.hypot(px - c.pos.x, py - c.pos.y) }; }
    }
    if (bi > o.gi) { o.gi = bi; }
    // after a fight off the line: on to the next waypoint ahead - not back to the line or to one it has passed
  }
  // waypoints behind (closer to the next one than this one is to it): skipped
  for (let k = 0; k < 6 && o.gi < R.length - 1 && !R[o.gi + 1].cut; k++) {
    const q = R[o.gi], n = R[o.gi + 1]; const dn = Math.hypot(n.x - c.pos.x, n.y - c.pos.y);
    if (dn < Math.hypot(n.x - q.x, n.y - q.y) && dn < 60 && Math.abs((n.z || 0) - (c.pos.z || 0)) < 12) o.gi++; else break;
  }
  // on along the line
  while (o.gi < R.length) {
    const q = R[o.gi];
    if (q.cut && Math.hypot(q.x - c.pos.x, q.y - c.pos.y) > 60) routeJump(c, d, q, true);     // another wing, or a teleporter
    o.jit = o.jit || {}; if (!o.jit[o.gi]) o.jit[o.gi] = [(Math.random() - 0.5) * 3.5, (Math.random() - 0.5) * 3.5];
    return { wp: true, gi: o.gi, x: q.x + o.jit[o.gi][0], y: q.y + o.jit[o.gi][1], z: q.z, st: 'alive', info: [0, 'the way on'] };
  }
  return null;     // the end of the route
}
function dungeonNext(c, d, o) {
  const W = ensureWorld(d.map); const full = G.state.settings.dgFullClear;
  // quests first (bosses are often quest targets anyway)
  const qAll = dungeonQuestTargets(c, d).filter((x) => !(o.qSkip && o.qSkip.includes(dgTargetKey(x))));
  // with a route: a quest target is only gone for once the route has come to it (no straight line across the dungeon)
  const rPlan = !full && dungeonRoutes(d, o.tier || null) ? dungeonPullPlan(d, o.tier || null) : null;
  let qc = rPlan && rPlan.cum && o.gi != null && o.gi < rPlan.route.length ? qAll.filter((x) => routeIndexOf(rPlan, x) <= o.gi + 1) : rPlan && rPlan.cum && o.gi == null ? [] : qAll;
  if (qAll.length && !qc.length && rPlan && rPlan.cum) { const rn = routeNext(c, d, o); if (rn) return rn; qc = qAll; }      // on along the route; at its end, what is left
  if (qc.length) {
    qc.sort((a, b) => Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y));
    let best = null, bd = Infinity; for (const m of qc.slice(0, 8)) { const dd = dungeonReach(c, m); if (dd < bd) { bd = dd; best = m; } }
    if (best) return best;
    if (o.questRun) return qc[0];
  }
  if (o.questRun && !full) return null;
  if (!full) { const rn = routeNext(c, d, o); if (rn !== undefined) return rn; }
  const cand = full ? W.list.filter((m) => m.st === 'alive' && !m.unreach && attackable(m, c) && !(m.info && (m.info[5] === 8 || m.info[5] === 11))) : dungeonBossesLeft(c, d).filter((m) => m.st === 'alive');
  if (!cand.length) return null;
  cand.sort((a, b) => Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y));
  let best = null, bd = Infinity;
  for (const m of cand.slice(0, 8)) { const dd = dungeonReach(c, m); if (dd < bd) { bd = dd; best = m; } }
  if (best) return best;
  // nothing reachable from here: another wing with its own way in (Scarlet Monastery, Stratholme, Dire Maul)
  o.wingsDone = o.wingsDone || [o.wing || 0];
  for (let i = 0; i < d.enter.length; i++) {
    if (o.wingsDone.includes(i)) continue; const e = d.enter[i];
    const save_ = c.pos; c.pos = { map: d.map, x: e.x, y: e.y, z: e.z, o: 0 };
    const ok = cand.slice(0, 20).some((m) => dungeonReach(c, m) < Infinity); c.pos = save_;
    if (!ok) continue;
    o.wingsDone.push(i); o.wing = i; c.pos = { map: d.map, x: e.x, y: e.y, z: e.z, o: c.pos.o }; const r = rt(c); r.mv = null; r.tgt = null;
    if (r.party) for (const u of r.party) { u.x = e.x; u.y = e.y; }
    log('On to ' + (e.name || 'another part of ' + d.name) + '.');
    return dungeonNext(c, d, o);
  }
  // still nothing: walk straight to the nearest one (the paths inside do not know every stair)
  return cand[0];
}
function updateDungeon(c, o, dt) {
  const d = dungeonByMap(o.map); const r = rt(c); if (!d) { c.order = null; return; }
  if (o.phase === 'travel') {
    if (c.pos.map === d.map) { o.phase = 'inside'; return; }
    const near = Math.hypot(d.entrance.x - c.pos.x, d.entrance.y - c.pos.y) < 150 && c.pos.map === d.entrance.map;     // the portal is often inside walls the map grid cannot pass
    if (near && !o.onlyTravel) o.trip = null;
    if (o.trip) {
      const st = tripStep(c, o.trip); if (st === 'busy') return;
      if (st === 'fail' && !near) {
        o.tripFails = (o.tripFails || 0) + 1;
        if (o.tripFails <= 3) { o.trip = planTrip(c, { map: d.entrance.map, x: d.entrance.x, y: d.entrance.y }, { noFly: o.tripFails > 1 }); if (o.trip) return; }
        log('Could not get to ' + d.name + '.'); c.order = o.resume || null; renderOrder(); return;
      }
      o.trip = null;
    }
    if (!near && !goTo(c, d.entrance.x, d.entrance.y, 4)) { if (r.blocked) { r.blocked = false; log('The way to the entrance of ' + d.name + ' is blocked.'); c.order = o.resume || null; renderOrder(); } return; }

    r.blocked = false;
    if (o.onlyTravel) { log('Arrived at ' + d.name + '.'); c.order = null; renderOrder(); return; }
    enterDungeon(c, d, o); return;
  }
  if (c.pos.map !== d.map) { c.order = o.resume || null; renderOrder(); return; }
  if (o.phase === 'leaving') { if (dungeonExitStep(c, o, d)) leaveDungeon(c, o.leaveMsg); return; }
  if (o.hold && !(r.threats && r.threats.length)) { dgHoldStep(c, o); o.since = G.gameTime; return; }          // alone: the Rest button
  if (G.gameTime - (o.lastCall || 0) > 2) o.since = G.gameTime;          // busy with fighting, resting or looting in between
  o.lastCall = G.gameTime;
  if (r.bagFull || bagFree(c) <= 0) { const junk = c.bags.map((x, i) => ({ x, i })).filter((q) => isJunk(c, q.x.id)).sort((a, b) => itemSell(a.x.id) * a.x.n - itemSell(b.x.id) * b.x.n); if (junk.length) { const k = Math.max(1, Math.ceil(junk.length / 3)); for (const q of junk.slice(0, k).sort((a, b) => b.i - a.i)) c.bags.splice(q.i, 1); r.bagFull = false; log('Bags are full - threw away ' + k + ' junk item' + (k > 1 ? 's' : '') + '.'); } }
  if (G.gameTime - o.entered > DG_TIME_LIMIT * (d.kind === 'raid' ? 1.5 : 1)) { orderLeaveDungeon(c, null, 'Spent too long in ' + d.name + ' - left.'); return; }
  // before each pull: everyone back on their feet
  const p = partyOf(c); const ready = masteryReady(c); if (p && (p.some((u) => u.dead || u.hp < u.maxhp * ready) || mercsResting(c))) { r.mv = null; o.since = G.gameTime; return; }
  if (dgGroupRest(c)) { r.mv = null; o.since = G.gameTime; return; }
  if (!o.target || o.target.st === 'dead' || o.target.unreach) {
    if (o.target && o.target.st === 'dead') o.lastProgress = G.gameTime;
    o.target = dungeonNext(c, d, o);
    if (!o.target) { orderLeaveDungeon(c, null, o.questRun ? 'Quest work in ' + d.name + ' done (' + o.kills + ' creatures).' : d.name + ' cleared: ' + o.bossKills + ' bosses, ' + o.kills + ' creatures.'); return; }
    o.since = G.gameTime; o.bestD = Infinity;
  }
  // stuck = no fight and no step closer for 4 minutes
  // stuck = no fight and no walking for 3 minutes (or 15 minutes on one target)
  if (!o.lastPos || Math.hypot(c.pos.x - o.lastPos.x, c.pos.y - o.lastPos.y) > 8 || (r.threats && r.threats.length) || r.resting) { o.since = G.gameTime; o.lastPos = { x: c.pos.x, y: c.pos.y }; }
  if (!o.targetSince || o.targetFor !== o.target || o.killsAt !== o.kills) { o.targetFor = o.target; o.targetSince = G.gameTime; o.killsAt = o.kills; }
  if (G.gameTime - (o.since || 0) > 180 || (G.gameTime - o.targetSince > 900 && !(r.threats && r.threats.length))) { o.target.unreach = true; if (o.target.wp) o.gi = o.target.gi + 1; if (o.target.go || o.target.npc) (o.qSkip = o.qSkip || []).push(dgTargetKey(o.target)); log('Cannot get to ' + (o.target.info ? o.target.info[1] : 'a creature') + ' - skipping it.'); o.target = null; return; }
  if (o.target.wp) {        // the way on along the route; packs that come into the way are fought on the spot
    const t = o.target;
    if (G.gameTime - (o.packT || 0) > 0.5) { o.packT = G.gameTime; const nx = routeNext(c, d, o); if (nx && !nx.wp) { o.target = nx; return; } }
    if (goTo(c, t.x, t.y, 2.5, t.z) || r.blocked) { r.blocked = false; o.gi = t.gi + 1; o.target = null; o.since = G.gameTime; }
    return;
  }
  if (o.target.npc) {       // a quest giver or turn-in in here
    const t = o.target;
    if (!goTo(c, t.x, t.y, 3, t.z)) { if (r.blocked) { r.blocked = false; (o.qSkip = o.qSkip || []).push(dgTargetKey(t)); o.target = null; } return; }
    startInteract(c, (t.npc === 'pick' ? 'Talking to ' : 'Turning in at ') + t.info[1], () => { t.st = 'dead'; if (t.npc === 'pick') { if (questAvailable(c, t.q)) acceptQuest(c, t.q); } else if (c.quests[t.q.id] && questDone(c, t.q)) turnInQuest(c, t.q); });
    return;
  }
  if (o.target.go) {        // a quest object: walk to it and use it
    const t = o.target; if (!goFree(t.e, t.i)) { o.target = null; return; }
    if (!goTo(c, t.x, t.y, 3, t.z)) { if (r.blocked) { r.blocked = false; (o.qSkip = o.qSkip || []).push(dgTargetKey(t)); o.target = null; } return; }
    startInteract(c, 'Using ' + objName(t.e), () => { useGo(t.e, t.i); t.st = 'dead'; const q = G.q.byId[t.qi[0]]; if (t.qi[2] === 'loot') lootGo(c, t.e); else if (q) credit(c, q, t.qi[1]); });
    return;
  }
  const fighting = r.threats && r.threats.length;
  if (!fighting && o.ccWait && o.ccWait > G.gameTime) { r.mv = null; return; }          // the crowd control goes on first
  if (!fighting && dgRangedPull(c, o.target)) return;
  const st = approach(c, o.target); if (st === 'gone') { if (o.target.st === 'alive') o.target.banUntil = 0; o.target = null; }
}
/* the tank pulls with a shot (no ammo needed) when the target is in sight and in range: the pack comes to the group,
   away from the crowd-controlled ones and from patrols; the tank stays put while they come (fightStep). Only when the
   character itself tanks - with a hired tank the mercenary shoots (partyStep). */
function dgRangedPull(c, m) {
  if (G.state.settings.dgRangedPull === false || !m || m.st !== 'alive' || m.wp || m.go || m.npc) return false;
  const p = partyOf(c); if (p && p.some((u) => u.role === 'tank' && !u.dead)) return false;
  if (typeof groupOf === 'function' && groupOf(c) && grpRole(c) !== 'tank') return false;
  const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y); if (d > 30 || d < 8 || Math.abs((m.z || 0) - (c.pos.z || 0)) > 10) return false;
  if (typeof dgStraight === 'function' && !dgStraight(c.pos.map, c.pos, m)) return false;
  const r = rt(c); if (r.cast || (r.gcdUntil || 0) > G.gameTime) return false;
  c.pos.o = Math.atan2(m.x - c.pos.x, m.y - c.pos.y); r.mv = null;
  fx(c.pos.x, c.pos.y, 'Shoot', '#ffe9a8'); engage(m, c); if (m.st === 'chase') { addThreat(m, c, 20 + c.level * 3); if (m.help) callHelp(ensureWorld(c.pos.map), m, c); }
  r.pullWait = G.gameTime + 6; r.tgt = m; r.gcdUntil = G.gameTime + 1.5;
  return true;
}
/* your own group between pulls: whoever is low on health (or a mana user low on mana) sits down and rests to full; the
   tank waits until they are up (the leader's groupHold sees them resting) */
function dgGroupRest(c) {
  if (typeof groupOf !== 'function' || !groupOf(c) || (rt(c).threats || []).length) return false; let any = false;
  for (const m of groupChars(groupOf(c))) {
    if (m.pos.map !== c.pos.map) continue; const mr = rt(m); if (mr.ghost || m.hp <= 0) { any = true; continue; }
    if ((mr.threats || []).length) return false;
    const s = charStats(m); const mana = usesMana(m) && m.cls !== 1 && s.maxMana;
    if (mr.resting) { any = true; continue; }
    if (m.hp < s.maxHp * 0.6 || (mana && m.mana < s.maxMana * (grpRole(m) === 'healer' ? 0.45 : 0.3))) { mr.resting = true; mr.restFull = false; mr.mv = null; any = true; }
  }
  return any;
}
/* creatures in a dungeon: no respawn while the instance lasts; companions share the experience */
function dungeonKill(c, m) {
  let o = c.order;
  if ((!o || o.type !== 'dungeon') && typeof groupOf === 'function' && groupOf(c)) { const L = groupLeader(groupOf(c)); o = L && L.order; }      // a group member's kill counts for the run
  if (!o || o.type !== 'dungeon') return;
  o.kills++; const d = dungeonByMap(o.map); if (d && d.bosses.some((b) => b.e === m.e)) { o.bossKills++; log('*** ' + (m.info ? m.info[1] : 'Boss') + ' defeated! ***'); fx(m.x, m.y, 'BOSS DEFEATED', '#ffd23a'); }
}
/* the character died inside: everyone runs back from the graveyard at the entrance and goes in again */
function dungeonDeath(c) {
  const d = dungeonByMap(c.pos.map); if (!d || !d.entrance) return false;
  const r = rt(c); const e = d.enter[(c.order && c.order.wing) || 0] || d.enter[0];
  if (r.party) for (const u of r.party) { u.dead = false; u.hp = u.maxhp; }
  masteryWipe(c, d);
  const W = G.world[d.map]; if (W) for (const m of W.active) evade(W, m);
  c.pos = { map: d.entrance.map, x: d.entrance.x, y: d.entrance.y, z: 0, o: c.pos.o };
  r.dgReturn = { map: d.map, x: e.x, y: e.y, z: e.z };
  return true;
}
