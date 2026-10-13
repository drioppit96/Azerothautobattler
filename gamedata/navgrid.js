// navgrid.js - collision grid + A* path finder (works in the browser, serve the files over http)
// const grid = await NavGrid.load('gamedata/navgrid_Azeroth.bin.gz');
// const path = grid.findPath(x0, y0, x1, y1, {swim:false});   // world coordinates in, [[x,y],...] out
class NavGrid {
  constructor(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.w = dv.getUint16(4, true); this.h = dv.getUint16(6, true);
    this.cell = dv.getFloat32(8, true); this.origin = dv.getFloat32(12, true);
    this.data = buf.subarray(16);
  }
  static async load(url) {
    const res = await fetch(url);
    const ds = new DecompressionStream('gzip');
    const buf = new Uint8Array(await new Response(res.body.pipeThrough(ds)).arrayBuffer());
    return new NavGrid(buf);
  }
  toCell(x, y) { return [Math.floor((this.origin - y) / this.cell), Math.floor((this.origin - x) / this.cell)]; }
  toWorld(c, r) { return [this.origin - (r + 0.5) * this.cell, this.origin - (c + 0.5) * this.cell]; }   // [x, y]
  code(c, r) { return (c < 0 || r < 0 || c >= this.w || r >= this.h) ? 0 : this.data[r * this.w + c]; }
  walkable(c, r, swim) { const k = this.code(c, r); return k === 1 || (swim && k === 2); }
  // nearest walkable cell around (c, r) within 'max' cells
  nearestWalkable(c, r, swim, max) {
    max = max || 40;
    if (this.walkable(c, r, swim)) return [c, r];
    for (let d = 1; d <= max; d++) {
      for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
        if (this.walkable(c + dc, r + dr, swim)) return [c + dc, r + dr];
      }
    }
    return null;
  }
  lineClear(c0, r0, c1, r1, swim) {
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1);
    for (let k = 0; k <= n; k++) {
      const c = Math.round(c0 + (c1 - c0) * k / n), r = Math.round(r0 + (r1 - r0) * k / n);
      if (!this.walkable(c, r, swim)) return false;
    }
    return true;
  }
  findPath(x0, y0, x1, y1, opt) {
    opt = opt || {}; const swim = !!opt.swim, maxNodes = opt.maxNodes || 200000;
    let [c0, r0] = this.toCell(x0, y0), [c1, r1] = this.toCell(x1, y1);
    const s = this.nearestWalkable(c0, r0, swim), e = this.nearestWalkable(c1, r1, swim);
    if (!s || !e) return null;
    [c0, r0] = s; [c1, r1] = e;
    const W = this.w, D = 1.41421356, start = r0 * W + c0, goal = r1 * W + c1;
    const gs = new Map([[start, 0]]), prev = new Map(), done = new Set();
    const heap = [[0, start]];
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let exp = 0, found = false;
    while (heap.length) {
      const [, u] = pop();
      if (done.has(u)) continue; done.add(u);
      if (u === goal) { found = true; break; }
      if (++exp > maxNodes) return null;
      const ur = Math.floor(u / W), uc = u % W;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = ur + dr, cc = uc + dc, k = this.code(cc, rr);
        if (!(k === 1 || (swim && k === 2))) continue;
        if (dr && dc && (!this.walkable(uc + dc, ur, swim) || !this.walkable(uc, ur + dr, swim))) continue;
        const v = rr * W + cc; if (done.has(v)) continue;
        const ng = gs.get(u) + (dr && dc ? D : 1) * (k === 2 ? 4 : 1);
        if (!gs.has(v) || ng < gs.get(v)) {
          gs.set(v, ng); prev.set(v, u);
          const ddx = Math.abs(cc - c1), ddy = Math.abs(rr - r1);
          push([ng + ddx + ddy + (D - 2) * Math.min(ddx, ddy), v]);
        }
      }
    }
    if (!found) return null;
    let cells = [], cur = goal;
    while (cur !== undefined) { cells.push([cur % W, Math.floor(cur / W)]); cur = prev.get(cur); }
    cells.reverse();
    // string pulling: keep only the corners that are needed
    const out = [cells[0]]; let a = 0;
    for (let b = 2; b < cells.length; b++) {
      if (!this.lineClear(cells[a][0], cells[a][1], cells[b][0], cells[b][1], swim)) { out.push(cells[b - 1]); a = b - 1; }
    }
    if (cells.length > 1) out.push(cells[cells.length - 1]);
    return out.map(p => this.toWorld(p[0], p[1]));
  }
}
if (typeof module !== 'undefined') module.exports = { NavGrid };
