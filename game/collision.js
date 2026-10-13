'use strict';
/* collision.js - walking around mountains, cliffs, deep holes and lava using the collision grid made by
   wow_navgrid.py (gamedata/navgrid_<Kalimdor|Azeroth>.bin.gz). Buildings are not in the grid.
   Without the file everything still works (straight lines / roads, as before). */

const GRID_FILES = { 0: 'Azeroth', 1: 'Kalimdor' };
const COARSE = 4;                    // path finding runs on 4x4 fine cells (about 16.7 yards)

/* load the grid of one continent in the background; G.grids[map] = {w, h, cell, origin, data, cw, ch, coarse} */
async function loadGrid(mapId) {
  G.grids = G.grids || {};
  if (mapId in G.grids) return G.grids[mapId];
  G.grids[mapId] = null;
  const name = GRID_FILES[mapId]; if (!name) return null;
  try {
    const res = await fetch('../gamedata/navgrid_' + name + '.bin.gz');
    if (!res.ok) return null;
    let buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) {          // still gzip-packed (most servers)
      const ds = new DecompressionStream('gzip');
      buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer());
    }
    if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'NVG1') { console.warn('collision grid: unknown format'); return null; }
    const dv = new DataView(buf.buffer, buf.byteOffset, 16);
    const g = { w: dv.getUint16(4, true), h: dv.getUint16(6, true), cell: dv.getFloat32(8, true), origin: dv.getFloat32(12, true), data: buf.subarray(16) };
    // coarse grid: 1 walk, 2 swim only, 0 blocked
    g.cw = Math.ceil(g.w / COARSE); g.ch = Math.ceil(g.h / COARSE); g.coarse = new Uint8Array(g.cw * g.ch);
    for (let R = 0; R < g.ch; R++) for (let C = 0; C < g.cw; C++) {
      let walk = 0, swim = 0;
      for (let r = R * COARSE; r < Math.min(g.h, R * COARSE + COARSE); r++) {
        const row = r * g.w;
        for (let c = C * COARSE; c < Math.min(g.w, C * COARSE + COARSE); c++) { const k = g.data[row + c]; if (k === 1) walk++; else if (k === 2) swim++; }
      }
      g.coarse[R * g.cw + C] = walk >= 4 ? 1 : walk + swim >= 6 ? 2 : 0;
    }
    G.grids[mapId] = g;
    log('Collision loaded for ' + name + ': mountains, cliffs and lava are avoided now.');
    return g;
  } catch (e) { console.warn('collision grid not loaded', e); return null; }
}
function gridOf(mapId) { return G.grids ? G.grids[mapId] || null : null; }
/* fine-grid code at a world position (1 walk, 2 swim, other = blocked; -1 = no grid) */
function groundAt(mapId, x, y) {
  const g = gridOf(mapId); if (!g) return -1;
  const c = Math.floor((g.origin - y) / g.cell), r = Math.floor((g.origin - x) / g.cell);
  if (c < 0 || r < 0 || c >= g.w || r >= g.h) return 0;
  return g.data[r * g.w + c];
}
function passable(mapId, x, y) { const k = groundAt(mapId, x, y); return k === -1 || k === 1 || k === 2; }
/* straight walk between two points over passable ground only */
function lineWalkable(mapId, a, b) {
  const g = gridOf(mapId); if (!g) return true;
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (g.cell * 0.7));
  for (let k = 1; k <= n; k++) { const t = k / n; if (!passable(mapId, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false; }
  return true;
}

/* A* over the coarse grid: walkable ground, a little extra for swimming, extra cost inside hostile aggro circles.
   Returns [{x,y}...] or null when there is no grid / no way. */
function gridPath(c, from, to, ghost) {
  const g = gridOf(c.pos.map); if (!g) return null;
  const cs = g.cell * COARSE;
  const toC = (p) => [Math.floor((g.origin - p.y) / cs), Math.floor((g.origin - p.x) / cs)];
  const toW = (C, R) => ({ x: g.origin - (R + 0.5) * cs, y: g.origin - (C + 0.5) * cs });
  let [c0, r0] = toC(from), [c1, r1] = toC(to);
  const pad = 12;
  const minC = Math.max(0, Math.min(c0, c1) - pad), maxC = Math.min(g.cw - 1, Math.max(c0, c1) + pad);
  const minR = Math.max(0, Math.min(r0, r1) - pad), maxR = Math.min(g.ch - 1, Math.max(r0, r1) + pad);
  const w = maxC - minC + 1, h = maxR - minR + 1; const N = w * h;
  if (N > 900000) return null;
  const cost = new Float32Array(N);
  for (let R = 0; R < h; R++) for (let C = 0; C < w; C++) { const k = g.coarse[(R + minR) * g.cw + C + minC]; cost[R * w + C] = k === 1 ? 1 : k === 2 ? 3 : 0; }
  // hostile aggro circles
  if (!ghost && c.cfg && typeof ensureWorld === 'function') {
    const style = c.cfg.style; const W = ensureWorld(c.pos.map);
    const wx0 = toW(minC, maxR), wx1 = toW(maxC, minR);
    const cx = (wx0.x + wx1.x) / 2, cy = (wx0.y + wx1.y) / 2, rad = Math.hypot(wx0.x - wx1.x, wx0.y - wx1.y) / 2 + 30;
    mobsNear(W, cx, cy, rad, (m) => {
      if (m.st !== 'alive' || m.civ || behOf(m, c) !== 'A' || m === (c.rt && c.rt.tgt)) return;
      const dng = dangerous(m, c); const pen = dng ? 80 : style === 'safe' ? 30 : style === 'balanced' ? 15 : 0; if (!pen) return;
      const Rr = aggroRadius(m, c) + (dng ? 10 : 4);
      if (!dng && Math.hypot(m.x - to.x, m.y - to.y) < Rr) return;
      const [mc, mr] = toC(m); const k = Math.ceil(Rr / cs);
      for (let R = mr - k; R <= mr + k; R++) for (let C = mc - k; C <= mc + k; C++) {
        if (C < minC || C > maxC || R < minR || R > maxR) continue;
        const p = toW(C, R); if (Math.hypot(p.x - m.x, p.y - m.y) > Rr) continue;
        const i = (R - minR) * w + C - minC; if (cost[i]) cost[i] += pen;
      }
    });
  }
  const idx = (C, R) => (R - minR) * w + C - minC;
  const snap = (C, R) => {   // nearest passable coarse cell
    if (C >= minC && C <= maxC && R >= minR && R <= maxR && cost[idx(C, R)]) return [C, R];
    for (let d = 1; d < 8; d++) for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue; const a = C + dc, b = R + dr;
      if (a >= minC && a <= maxC && b >= minR && b <= maxR && cost[idx(a, b)]) return [a, b];
    }
    return null;
  };
  const sA = snap(c0, r0), sB = snap(c1, r1); if (!sA || !sB) return null;
  [c0, r0] = sA; [c1, r1] = sB;
  const s = idx(c0, r0), goal = idx(c1, r1);
  if (s === goal) return [from, to];
  const gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  gs[s] = 0; push(s, 0); let iter = 0;
  while (heap.length && iter++ < 400000) {
    const [, n] = pop(); if (closed[n]) continue; closed[n] = 1; if (n === goal) break;
    const nx = n % w, ny = (n / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const mx = nx + dx, my = ny + dy; if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
      const m = my * w + mx; if (closed[m] || !cost[m]) continue;
      if (dx && dy && (!cost[ny * w + mx] || !cost[my * w + nx])) continue;     // no corner cutting
      const ng = gs[n] + (dx && dy ? 1.414 : 1) * (cost[n] + cost[m]) / 2;
      if (ng < gs[m]) { gs[m] = ng; came[m] = n; push(m, ng + Math.hypot(mx - (c1 - minC), my - (r1 - minR))); }
    }
  }
  if (came[goal] < 0) return null;
  const cells = []; for (let n = goal; n !== s && n >= 0; n = came[n]) cells.push(n); cells.reverse();
  const raw = [from].concat(cells.map((n) => toW(n % w + minC, ((n / w) | 0) + minR)), [to]);
  // string pulling: drop corners when the straight line is walkable and not more costly
  const lineCost = (a, b) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cs / 2)); let mx = 0;
    for (let k = 0; k <= n; k++) { const t = k / Math.max(1, n); const [C, R] = toC({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      if (C < minC || C > maxC || R < minR || R > maxR) return Infinity; const v = cost[idx(C, R)]; if (!v) return Infinity; mx = Math.max(mx, v); }
    return mx;
  };
  const out = [raw[0]]; let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1) {
      const lc = lineCost(raw[i], raw[j]);
      if (lc <= 3 && lineWalkable(c.pos.map, raw[i], raw[j])) break;
      j--;
    }
    out.push(raw[j]); i = j;
  }
  return out;
}
