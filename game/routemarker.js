'use strict';
/* routemarker.js - a tool for while the game is being made (it goes away later): marking the way groups take through a
   dungeon. On a dungeon map the top bar shows "Route marker"; with it open, a click on the map adds a point to the
   selected route. Up to 7 routes in 7 colours, taken in order (1 first, then 2 ...): one per floor, wing or part of
   the dungeon. A route that starts far from where the one before ended is a jump (another wing, a teleporter).
   Save keeps them in the browser and writes gamedata/route_marks.json through the game's server (serve.py), so they go
   up to GitHub with upload_to_github.bat; with "Runs follow these routes" on, dungeon runs walk them from then on
   (they take the place of the routes from make_dungeon_routes.py). Export downloads the same file. */

const RM_COLORS = ['#ff4a4a', '#ff9a2e', '#ffe14a', '#4ade5a', '#38d6e8', '#4a7dff', '#c26bff'];
const RM_N = RM_COLORS.length;
const RM_KEY = 'wow_route_marks_v1';
const RM = { on: false, sel: 0, msg: '' };

/* all marks: {map: {t, use, routes: [[[x, y, z, floorN], ...] x 7]}} - the newer of the browser's and the file's */
function rmAll() {
  if (G.rmarks) return G.rmarks;
  let local = {}; try { local = JSON.parse(localStorage.getItem(RM_KEY) || '{}') || {}; } catch (e) { local = {}; }
  const file = G.rmarksFile || {}; const out = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(file)])) { const a = local[k], b = file[k]; out[k] = !a ? b : !b ? a : (a.t || 0) >= (b.t || 0) ? a : b; }
  return (G.rmarks = out);
}
function rmOf(map) {
  const A = rmAll(); const k = String(map);
  if (!A[k]) A[k] = { t: 0, use: true, routes: [] };
  while (A[k].routes.length < RM_N) A[k].routes.push([]);
  return A[k];
}
/* at boot (after the routes and the marks file are loaded): the marked routes take over */
function rmApplyAll() { G.dgRoutesOrig = G.dgRoutesOrig || {}; for (const k in rmAll()) rmApply(+k); }
function rmApply(map) {
  const d = dungeonByMap(map); if (!d || !G.dgRoutes) return;
  G.dgRoutesOrig = G.dgRoutesOrig || {}; const k = String(map);
  if (!(k in G.dgRoutesOrig)) G.dgRoutesOrig[k] = G.dgRoutes[k] || null;
  const M = rmAll()[k]; const rs = M && M.use ? rmToRoutes(d, M) : [];
  if (rs.length) G.dgRoutes[k] = rs; else if (G.dgRoutesOrig[k]) G.dgRoutes[k] = G.dgRoutesOrig[k]; else delete G.dgRoutes[k];
  if (G.pullPlans) for (const key in G.pullPlans) if (key === k || key.indexOf(k + ':') === 0) delete G.pullPlans[key];
}
/* the marks as guide routes (pullplan.js): the bosses each route passes, in the order it passes them */
function rmToRoutes(d, M) {
  const rs = M.routes.map((pts, i) => ({ i, pts })).filter((r) => r.pts.length >= 2);
  const out = rs.map((r) => ({ name: d.name + ' - route ' + (r.i + 1), path: r.pts.map((p) => [p[0], p[1], p[2]]), stops: [], jumps: [], marked: true }));
  for (const b of d.bosses || []) {
    let best = null, bd = 45;
    out.forEach((r, ri) => r.path.forEach((p, pi) => { const dd = Math.hypot(p[0] - b.x, p[1] - b.y) + Math.max(0, Math.abs(p[2] - (b.z || p[2])) - 6) * 2; if (dd < bd) { bd = dd; best = [ri, pi]; } }));
    if (best) out[best[0]].stops.push([b.n, best[1]]);
  }
  for (const r of out) r.stops.sort((a, b) => a[1] - b[1]);
  return out;
}

/* ------------------------------------------------------------------ marking */
function rmOpen(on) {
  RM.on = on == null ? !RM.on : on; G.rmOn = RM.on && G.map && G.map.dmap;
  if (RM.on) { hideMenu(); RM.msg = ''; if ($('follow')) $('follow').checked = false; }       // the map stays where it is while marking
  rmRender();
}
/* the height of a click: the creatures or objects standing nearest on that floor (else the middle of the floor) */
function rmHeight(d, f, x, y) {
  let best = null, bd = 40;
  for (const m of ensureWorld(d.map).list) { if (m.z == null) continue; const dd = Math.hypot(m.hx - x, m.hy - y); if (dd < bd && dungeonFloorAt(d, m.hx, m.hy, m.z) === f) { bd = dd; best = m.z; } }
  if (best != null) return best;
  if (f.zc != null) return f.zc;
  if (f.z0 > -9999 && f.z1 < 999999) return (f.z0 + f.z1) / 2;
  return 0;
}
function rmClick(w) {
  if (!G.rmOn || !G.map || !G.map.dmap) return false;
  const d = G.map.dungeon, f = G.map.floor; const M = rmOf(d.map);
  const z = rmHeight(d, f, w.x, w.y);
  M.routes[RM.sel].push([Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10, Math.round(z * 10) / 10, f.n]);
  M.dirty = true; rmRender(); return true;
}
function rmUndo() { if (!G.map || !G.map.dmap) return; const M = rmOf(G.map.map); M.routes[RM.sel].pop(); M.dirty = true; rmRender(); }
/* save: in the browser, in gamedata/route_marks.json (the game's server writes it), and the runs follow them */
async function rmSave() {
  const map = G.map && G.map.dmap ? G.map.map : null; const A = rmAll();
  if (map != null) { const M = rmOf(map); M.t = Date.now(); delete M.dirty; rmApply(map); }
  const clean = {}; for (const k in A) { const M = A[k]; if (!M.routes.some((r) => r.length)) continue; clean[k] = { t: M.t, use: M.use, name: (dungeonByMap(+k) || {}).name, routes: M.routes }; }
  try { localStorage.setItem(RM_KEY, JSON.stringify(clean)); } catch (e) { /* */ }
  let ok = false;
  try { const r = await fetch('/save_route_marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean, null, 1) }); ok = r.ok; } catch (e) { ok = false; }
  RM.msg = ok ? 'Saved - gamedata/route_marks.json written; runs follow these routes' + (map != null && !rmOf(map).use ? ' (switched off for this dungeon)' : '') + '.'
    : 'Saved in this browser. The file could not be written (start the game with start_game.bat) - use Export.';
  log('Dungeon routes saved' + (ok ? ' to gamedata/route_marks.json' : ' in the browser') + '.');
  rmRender();
}
function rmExport() {
  const A = rmAll(); const clean = {}; for (const k in A) if (A[k].routes.some((r) => r.length)) clean[k] = { t: A[k].t, use: A[k].use, name: (dungeonByMap(+k) || {}).name, routes: A[k].routes };
  if (window.AzerothApp && AzerothApp.saveFile) { AzerothApp.saveFile('route_marks.json', JSON.stringify(clean, null, 1)); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(clean, null, 1)], { type: 'application/json' })); a.download = 'route_marks.json'; a.click();
}

/* ------------------------------------------------------------------ the top bar and the panel */
function rmRenderTop() {
  const m = G.map; const b = $('btnRmark'), fs = $('floorSel'); if (!b) return;
  const dm = !!(m && m.dmap);
  if (dm && RM.on && G._rmMap !== m.name) { G._rmMap = m.name; G.rmOn = true; rmRender(); return; }
  b.hidden = !dm; b.classList.toggle('on', dm && RM.on);
  if (!dm && G.rmOn) { G.rmOn = false; rmRender(); }
  if (dm && RM.on && !G.rmOn) { G.rmOn = true; rmRender(); }
  const fl = dm && m.dungeon.floors.length > 1 ? m.dungeon.floors : null;
  const h = fl ? fl.map((f, i) => '<button class="mini' + (f === m.floor ? ' on' : '') + '" data-rfloor="' + i + '" title="' + esc(f.name || 'Level ' + (i + 1)) + '">' + esc(f.name || String(i + 1)) + '</button>').join('') : '';
  if (fs._h !== h) { fs._h = h; fs.innerHTML = h; fs.hidden = !h; }
}
function rmRender() {
  rmRenderTop();
  const el = $('rmPanel'); if (!el) return;
  if (!G.rmOn) { el.hidden = true; return; }
  const d = G.map.dungeon; const M = rmOf(d.map);
  let h = '<div class="rmhead"><b>Route marker</b> <span class="small muted">' + esc(d.name) + (d.floors.length > 1 ? ' - ' + esc(G.map.floor.name || 'level ' + (d.floors.indexOf(G.map.floor) + 1)) : '') + '</span><button class="mini rmx" data-rm="close" title="Close">&times;</button></div>';
  h += '<div class="rmchips">' + RM_COLORS.map((col, i) => '<button class="rmchip' + (i === RM.sel ? ' on' : '') + '" data-rmsel="' + i + '" style="--c:' + col + '" title="Route ' + (i + 1) + ': ' + M.routes[i].length + ' points"><b>' + (i + 1) + '</b><span>' + M.routes[i].length + '</span></button>').join('') + '</div>';
  h += '<div class="small muted">Click the map: a point on route <b style="color:' + RM_COLORS[RM.sel] + '">' + (RM.sel + 1) + '</b>. Right-click: take the last one back. The routes are walked in order, 1 first; points on other floors are faint.</div>';
  h += '<div class="rmbtns"><button class="mini" data-rm="undo">Undo</button><button class="mini" data-rm="clear">Clear route ' + (RM.sel + 1) + '</button><button class="mini" data-rm="clearall">Clear all</button></div>';
  h += '<label class="chk small"><input type="checkbox" data-rm="use"' + (M.use ? ' checked' : '') + '> Runs follow these routes (after saving)</label>';
  h += '<div class="rmbtns"><button class="mini act" data-rm="save">Save' + (M.dirty ? ' *' : '') + '</button><button class="mini" data-rm="export" title="Download every marked dungeon as route_marks.json">Export</button></div>';
  if (RM.msg) h += '<div class="small rmmsg">' + esc(RM.msg) + '</div>';
  el.innerHTML = h; el.hidden = false;
}
function rmBind() {
  const el = $('rmPanel'); if (!el) return;
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-rmsel]'); if (s) { RM.sel = +s.dataset.rmsel; rmRender(); return; }
    const b = e.target.closest('[data-rm]'); if (!b || b.tagName === 'INPUT') return;
    const M = G.map && G.map.dmap ? rmOf(G.map.map) : null; const a = b.dataset.rm;
    if (a === 'close') rmOpen(false);
    else if (a === 'undo') rmUndo();
    else if (a === 'clear' && M && M.routes[RM.sel].length && confirm('Clear route ' + (RM.sel + 1) + '?')) { M.routes[RM.sel] = []; M.dirty = true; rmRender(); }
    else if (a === 'clearall' && M && confirm('Clear every route of ' + G.map.dungeon.name + '?')) { M.routes = []; rmOf(G.map.map); M.dirty = true; rmRender(); }
    else if (a === 'save') rmSave();
    else if (a === 'export') rmExport();
  });
  el.addEventListener('change', (e) => { if (e.target.dataset.rm === 'use' && G.map && G.map.dmap) { const M = rmOf(G.map.map); M.use = e.target.checked; M.dirty = true; rmRender(); } });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  $('btnRmark').onclick = () => rmOpen();
  $('floorSel').onclick = (e) => { const b = e.target.closest('[data-rfloor]'); if (b && G.map && G.map.dmap) { setMap(dungeonMapDef(G.map.dungeon, G.map.dungeon.floors[+b.dataset.rfloor])); $('follow').checked = false; rmRender(); } };
}
/* the marks on the dungeon map: the open panel shows all of them; closed, the saved ones the runs do not use are not drawn */
function drawRouteMarks(ctx, m) {
  if (!m.dmap || !G.rmOn) return;
  const M = rmAll()[String(m.map)]; if (!M) return;
  ctx.save(); ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.font = 'bold 10px Segoe UI';
  M.routes.forEach((pts, ri) => {
    if (!pts.length) return; const col = RM_COLORS[ri]; const sel = ri === RM.sel;
    const on = (p) => p[3] === m.floor.n;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]; const both = on(a) && on(b); if (!on(a) && !on(b)) continue;
      const [x1, y1] = w2s(a[0], a[1]), [x2, y2] = w2s(b[0], b[1]);
      ctx.globalAlpha = both ? (sel ? 1 : 0.8) : 0.35; ctx.setLineDash(both ? [] : [5, 5]);
      ctx.strokeStyle = '#000'; ctx.lineWidth = sel ? 5.5 : 4.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = sel ? 3.5 : 2.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.setLineDash([]);
    pts.forEach((p, i) => {
      const [x, y] = w2s(p[0], p[1]); ctx.globalAlpha = on(p) ? 1 : 0.3;
      const first = i === 0; const r = first ? 8 : sel ? 5.5 : 4.5;
      ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); ctx.stroke();
      if (first) { ctx.fillStyle = '#000'; ctx.fillText(String(ri + 1), x, y + 3.5); }
      else if (sel && on(p)) { ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.strokeText(String(i + 1), x, y - 8); ctx.fillText(String(i + 1), x, y - 8); }
    });
  });
  ctx.restore();
}
