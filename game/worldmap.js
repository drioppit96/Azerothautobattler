'use strict';
/* worldmap.js - map navigation like the in-game world map:
   World (both continents)  ->  Kalimdor / Eastern Kingdoms  ->  a zone (Durotar, The Barrens ...).
   Click a continent or a zone to open it, right-click (or the Up button) to go back one level.
   Zone shapes come from gamedata/zonemap_<Kalimdor|Azeroth>.png (made by make_zonemap.py). */

const WORLD_MAP = { name: 'World', file: 'maps/World Map (cosmic).png', world: true, map: -1, yl: 1, yr: 0, xt: 1, xb: 0 };
const ZONEMAP_FILES = { 0: 'Azeroth', 1: 'Kalimdor' };
/* where the two continents are on the cosmic map (fractions of the picture) */
const COSMIC = [
  { cont: 'Kalimdor', x0: 0.10, x1: 0.40, y0: 0.14, y1: 0.90 },
  { cont: 'Eastern Kingdoms', x0: 0.64, x1: 0.94, y0: 0.05, y1: 0.88 },
];

/* ------------------------------------------------------------- zone raster */
async function loadZoneMaps() {
  G.zm = { maps: {} };
  let meta = null; try { meta = await J('../gamedata/zonemap.json'); } catch (e) { return; }
  G.zm.meta = meta;
  for (const mp in ZONEMAP_FILES) {
    const name = ZONEMAP_FILES[mp]; const info = meta.maps[name]; if (!info) continue;
    const img = await loadImage('../gamedata/zonemap_' + name + '.png'); if (!img) continue;
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data; const idx = new Uint8Array(cv.width * cv.height);
    for (let i = 0; i < idx.length; i++) idx[i] = d[i * 4];
    const zones = {}; for (const [i, zid, zname] of info.zones) zones[i] = { id: zid, name: zname };
    G.zm.maps[mp] = { w: cv.width, h: cv.height, idx, zones, cache: {} };
  }
}
/* zone {id, name} at a world position, or null */
function zoneAt(mapId, x, y) {
  const z = G.zm && G.zm.maps[mapId]; if (!z) return null;
  const ch = G.zm.meta.chunk, o = G.zm.meta.origin;
  const col = Math.floor((o - y) / ch), row = Math.floor((o - x) / ch);
  if (col < 0 || row < 0 || col >= z.w || row >= z.h) return null;
  const i = z.idx[row * z.w + col]; return i ? Object.assign({ i }, z.zones[i]) : null;
}
function zoneMapDef(zoneId) { return G.maps.find((m) => !m.cont && !m.world && m.area === zoneId) || null; }
function continentDef(mapId) { return G.maps.find((m) => m.cont && m.map === mapId) || null; }
function zoneLevels(name) {
  const z = (G.d.zoneLevels && G.d.zoneLevels.zones || []).find((x) => x.zone === name);
  return z ? Math.round(z.p10 || z.min) + '-' + Math.round(z.p90 || z.max) : '';
}
/* a canvas with the shape of one zone (gold tint), cached */
function zoneShape(mapId, i) {
  const z = G.zm.maps[mapId]; if (z.cache[i]) return z.cache[i];
  let c0 = z.w, c1 = -1, r0 = z.h, r1 = -1;
  for (let r = 0; r < z.h; r++) for (let c = 0; c < z.w; c++) if (z.idx[r * z.w + c] === i) { if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
  if (c1 < 0) return null;
  const w = c1 - c0 + 1, h = r1 - r0 + 1; const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d'); const im = cx.createImageData(w, h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (z.idx[(r + r0) * z.w + c + c0] !== i) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => z.idx[(r + r0 + dr) * z.w + c + c0 + dc] !== i);
    const p = (r * w + c) * 4; im.data[p] = 255; im.data[p + 1] = edge ? 240 : 215; im.data[p + 2] = edge ? 160 : 90; im.data[p + 3] = edge ? 230 : 70;
  }
  cx.putImageData(im, 0, 0);
  const ch = G.zm.meta.chunk, o = G.zm.meta.origin;
  return (z.cache[i] = { cv, x0: o - r0 * ch, y0: o - c0 * ch, x1: o - (r1 + 1) * ch, y1: o - (c1 + 1) * ch });
}

/* ------------------------------------------------------------- navigation */
function mapLevel(m) { return m.world ? 0 : m.cont ? 1 : 2; }
function goUp() {
  const m = G.map; if (m.world) return;
  if (m.dmap) { const e = m.dungeon.entrance; const z = e && zoneAt(e.map, e.x, e.y); const zd = z && zoneMapDef(z.id); setMap(zd || (e && continentDef(e.map)) || WORLD_MAP); return; }
  if (m.cont) { setMap(WORLD_MAP); return; }
  const cont = continentDef(m.map); setMap(cont || WORLD_MAP);
}
function goToCharacter() {
  const c = active(); const z = zoneAt(c.pos.map, c.pos.x, c.pos.y);
  const m = (z && zoneMapDef(z.id)) || bestMapFor(c.pos);
  setMap(m, false, true);
}
function centerOn(x, y, zoom) {
  if (G.map.world) return;
  fitMap(); G.scale *= zoom || 1; const [px, py] = w2m(G.map, x, y); G.ox = G.cw / 2 - px * G.scale; G.oy = G.ch / 2 - py * G.scale;
}
function renderNav() {
  const m = G.map; const parts = [WORLD_MAP];
  if (m.dmap) {
    const e = m.dungeon.entrance; const cont = e && continentDef(e.map); if (cont) parts.push(cont);
    const z = e && zoneAt(e.map, e.x, e.y); const zd = z && zoneMapDef(z.id); if (zd) parts.push(zd); parts.push(m);
  } else if (!m.world) { const cont = m.cont ? m : continentDef(m.map); if (cont) parts.push(cont); if (!m.cont) parts.push(m); }
  const c = active ? active() : null; const cz = c && zoneAt(c.pos.map, c.pos.x, c.pos.y);
  $('maptabs').innerHTML =
    '<button class="navup" data-nav="up" title="Up one level (right-click on the map)"' + (m.world ? ' disabled' : '') + '>&#9650;</button>' +
    parts.map((p, i) => (i ? '<span class="crumbsep">&rsaquo;</span>' : '') + '<button data-crumb="' + i + '"' + (i === parts.length - 1 ? ' class="on"' : '') + '>' + esc(p.world ? 'World' : p.dmap ? p.dungeon.name : p.name) + '</button>').join('') +
    (m.dmap && m.dungeon.floors.length > 1 ? '<span class="crumbsep">&rsaquo;</span>' + m.dungeon.floors.map((f, i) => '<button data-floor="' + i + '"' + (f === m.floor ? ' class="on"' : '') + ' title="' + esc(f.name || 'Level ' + (i + 1)) + '">' + esc(f.name || String(i + 1)) + '</button>').join('') : '') +
    (c ? '<button class="navme" data-nav="me" title="Show my character">&#9673; ' + esc(c.name) + (cz ? ' &middot; ' + esc(cz.name) : '') + '</button>' : '');
  $('maptabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.nav === 'up') goUp();
    else if (b.dataset.nav === 'me') goToCharacter();
    else if (b.dataset.floor != null) setMap(dungeonMapDef(m.dungeon, m.dungeon.floors[+b.dataset.floor]));
    else if (b.dataset.crumb != null) { const p = parts[+b.dataset.crumb]; if (p !== G.map) setMap(p); }
  };
  if (typeof rmRenderTop === 'function') rmRenderTop();          // the route marker tab and the floors (dungeon maps)
}
/* what is under the pointer on the world / continent maps */
function navHit(sx, sy) {
  const m = G.map;
  if (m.world) {
    const [W, H] = mapSize(m); const fx = (sx - G.ox) / G.scale / W, fy = (sy - G.oy) / G.scale / H;
    const hit = COSMIC.find((r) => fx >= r.x0 && fx <= r.x1 && fy >= r.y0 && fy <= r.y1);
    return hit ? { kind: 'cont', def: G.maps.find((x) => x.name === hit.cont), box: hit } : null;
  }
  if (m.cont) {
    const w = s2w(sx, sy); const z = zoneAt(m.map, w.x, w.y); if (!z) return null;
    return { kind: 'zone', zone: z, def: zoneMapDef(z.id) };
  }
  return null;
}
function drawNavOverlay(ctx) {
  const m = G.map; const h = G.navHover; if (!h) return;
  if (m.world && h.kind === 'cont') {
    const [W, H] = mapSize(m); const b = h.box;
    const x0 = G.ox + b.x0 * W * G.scale, y0 = G.oy + b.y0 * H * G.scale, x1 = G.ox + b.x1 * W * G.scale, y1 = G.oy + b.y1 * H * G.scale;
    ctx.save(); ctx.strokeStyle = 'rgba(255,225,140,.9)'; ctx.lineWidth = 3; ctx.shadowColor = '#ffd866'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, 6.3); ctx.stroke(); ctx.restore();
    return;
  }
  if (m.cont && h.kind === 'zone') {
    const sh = zoneShape(m.map, h.zone.i); if (!sh) return;
    const [ax, ay] = w2s(sh.x0, sh.y0), [bx, by] = w2s(sh.x1, sh.y1);
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = h.def ? 1 : 0.5; drawOnScreen(ctx, sh.cv, ax, ay, bx - ax, by - ay); ctx.restore();
  }
}
function navTip(h) {
  if (!h) return '';
  if (h.kind === 'cont') return '<b>' + esc(h.def ? h.def.name : h.box.cont) + '</b><br><span class="muted">Click to open</span>';
  const lv = zoneLevels(h.zone.name);
  return '<b>' + esc(h.zone.name) + '</b>' + (lv ? '<br>Level ' + lv : '') + '<br><span class="muted">' + (h.def ? 'Click to open the map' : 'No map for this area') + '</span>';
}
/* keep the zone of the character on screen when "Follow" is on */
function followZone(c) {
  if (!$('follow').checked || G.map.world) return;
  if (isDungeonMap(c.pos.map)) { const dm = dungeonMapAt(c.pos); if (dm && dm !== G.map) setMap(dm, false, true); return; }
  if (G.map.dmap) { goToCharacter(); return; }
  if (G.map.cont) return;
  if (c.pos.map === G.map.map && inMap(G.map, c.pos.x, c.pos.y)) {
    const z = zoneAt(c.pos.map, c.pos.x, c.pos.y); if (!z || z.id === G.map.area) return;
    const d = zoneMapDef(z.id); if (d && d !== G.map) setMap(d, false, true);
    return;
  }
  const z = zoneAt(c.pos.map, c.pos.x, c.pos.y); const d = (z && zoneMapDef(z.id)) || bestMapFor(c.pos); if (d && d !== G.map) setMap(d, false, true);
}
