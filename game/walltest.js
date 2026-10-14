'use strict';
/* walltest.js - a testing window for the dungeon walls (gamedata/dungeon_walls.json, made by make_dungeon_walls.py):
   every dungeon and raid map with the calculated walls, the walkable floor, the creature spots and the ways between
   floors (click one to go to the floor it leads to). Click the floor to light up everything reachable from there
   without crossing a wall. Only for checking - the game does not use these walls yet. */

const WT = { open: false, data: null, map: null, floor: null, show: { walls: true, walk: true, spots: false, links: true, reach: true }, img: {}, reach: null, flash: null, hover: null };

async function openWallTest() {
  let el = $('walltest');
  if (!el) {
    el = document.createElement('div'); el.id = 'walltest'; document.body.appendChild(el);
    el.innerHTML = '<div class="wt-box"><div class="wt-head"><b>Dungeon walls - test</b><select id="wtDungeon"></select><span id="wtFloors"></span>' +
      '<span class="wt-opts">' + [['walls', 'Walls'], ['walk', 'Walkable floor'], ['links', 'Ways between floors'], ['spots', 'Creature spots'], ['reach', 'Reach on click']].map(([k, t]) => '<label class="chk"><input type="checkbox" data-wt="' + k + '"' + (WT.show[k] ? ' checked' : '') + '> ' + t + '</label>').join('') + '</span>' +
      '<button class="mini" id="wtClose">&#10005;</button></div><div class="wt-main"><canvas id="wtCanvas"></canvas><div id="wtInfo" class="small"></div></div></div>';
    $('wtClose').onclick = closeWallTest;
    el.onclick = (e) => { if (e.target === el) closeWallTest(); };
    el.querySelector('.wt-opts').onchange = (e) => { const k = e.target.dataset.wt; if (k) { WT.show[k] = e.target.checked; wtDraw(); } };
    $('wtDungeon').onchange = (e) => { wtSelect(+e.target.value, null); };
    $('wtFloors').onclick = (e) => { const b = e.target.closest('[data-wtf]'); if (b) wtSelect(WT.map, b.dataset.wtf); };
    const cv = $('wtCanvas');
    cv.onclick = wtClick; cv.onmousemove = wtMove; cv.onmouseleave = () => { WT.hover = null; wtDraw(); };
  }
  el.hidden = false; WT.open = true;
  if (!WT.data) {
    $('wtInfo').textContent = 'Loading the walls ...';
    try { WT.data = await J('../gamedata/dungeon_walls.json'); } catch (e) { $('wtInfo').textContent = 'gamedata/dungeon_walls.json is missing (run script\\make_dungeon_walls.py).'; return; }
    const list = (G.d.dungeons && G.d.dungeons.dungeons || []).slice().sort((a, b) => (a.kind !== 'dungeon') - (b.kind !== 'dungeon') || a.lmin - b.lmin);
    $('wtDungeon').innerHTML = list.map((d) => '<option value="' + d.map + '">' + esc(d.name) + (d.kind === 'raid' ? ' (raid)' : '') + '</option>').join('');
    const c = active(); const here = list.find((d) => d.map === c.pos.map);
    wtSelect(here ? here.map : list[0].map, null);
  } else wtDraw();
}
function closeWallTest() { const el = $('walltest'); if (el) el.hidden = true; WT.open = false; }
function wtDungeon() { return (G.d.dungeons.dungeons || []).find((d) => d.map === WT.map); }
function wtSelect(map, floor) {
  WT.map = map; const d = wtDungeon(); const W = WT.data[String(map)]; if (!d || !W) return;
  WT.floor = floor != null ? String(floor) : String(d.floors[0].n); WT.reach = null;
  $('wtDungeon').value = String(map);
  $('wtFloors').innerHTML = d.floors.map((f) => '<button class="mini' + (String(f.n) === WT.floor ? ' on' : '') + '" data-wtf="' + f.n + '">' + (f.name || 'Floor ' + f.n) + '</button>').join('');
  const f = d.floors.find((x) => String(x.n) === WT.floor);
  if (!WT.img[f.file]) { const im = new Image(); im.onload = () => { WT.img[f.file] = im; wtDraw(); }; im.src = '../' + f.file; WT.img[f.file] = null; }
  wtDraw();
}
function wtFloorData() { const W = WT.data && WT.data[String(WT.map)]; return W ? W.floors[WT.floor] : null; }
function wtBits(F) {
  if (!F._b) { const raw = atob(F.bits); const b = new Uint8Array(F.w * F.h); for (let i = 0; i < b.length; i++) b[i] = (raw.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1; F._b = b; }
  return F._b;
}
/* the picture is 1002 x 668; the canvas shows it scaled to the window */
function wtScale() { const cv = $('wtCanvas'); return cv.width / 1002; }
function wtDraw() {
  if (!WT.open) return; const cv = $('wtCanvas'); const d = wtDungeon(); const F = wtFloorData(); if (!d || !F) return;
  const box = cv.parentElement; const head = $('walltest').querySelector('.wt-head');
  const room = window.innerHeight * 0.96 - head.offsetHeight - 70;          // the picture fits the window, info line below
  const w = Math.max(400, Math.min(box.clientWidth - 4, Math.floor(room * 1002 / 668))), h = Math.round(w * 668 / 1002);
  if (cv.width !== w) { cv.width = w; cv.height = h; cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  const ctx = cv.getContext('2d'); const k = wtScale(); const f = d.floors.find((x) => String(x.n) === WT.floor);
  ctx.fillStyle = '#1a140b'; ctx.fillRect(0, 0, cv.width, cv.height);
  const im = WT.img[f.file]; if (im) ctx.drawImage(im, 0, 0, cv.width, cv.height);
  // walkable floor / reach
  if (WT.show.walk || (WT.show.reach && WT.reach)) {
    const b = wtBits(F); const oc = document.createElement('canvas'); oc.width = F.w; oc.height = F.h; const ox = oc.getContext('2d'); const id = ox.createImageData(F.w, F.h);
    for (let i = 0; i < b.length; i++) {
      const r = WT.reach && WT.reach[i];
      if (WT.show.reach && r) { id.data[i * 4] = 60; id.data[i * 4 + 1] = 170; id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = 140; }
      else if (WT.show.walk && b[i]) { id.data[i * 4] = 40; id.data[i * 4 + 1] = 220; id.data[i * 4 + 2] = 90; id.data[i * 4 + 3] = 85; }
    }
    ox.putImageData(id, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(oc, 0, 0, F.w * F.cell * k, F.h * F.cell * k); ctx.imageSmoothingEnabled = true;
  }
  if (WT.show.walls) {
    ctx.strokeStyle = '#ff2a1a'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (const L of F.walls) { ctx.beginPath(); for (let i = 0; i < L.length; i += 2) { const x = L[i] * k, y = L[i + 1] * k; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); }
  }
  if (WT.show.spots) {
    ctx.fillStyle = '#00dcff';
    for (const [x, y, z] of wtSpots(d, f)) { const [u, v] = wtPx(f, x, y); ctx.beginPath(); ctx.arc(u * k, v * k, 2.2, 0, 6.3); ctx.fill(); }
  }
  if (WT.show.links) {
    ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'left';
    for (const L of wtLinks()) {
      const x = L.me.x * k, y = L.me.y * k; const fl = WT.flash && WT.flash.L === L.raw && WT.flash.until > performance.now();
      ctx.lineWidth = fl ? 5 : 3; ctx.strokeStyle = fl ? '#fff' : '#ff4dff'; ctx.fillStyle = 'rgba(40,0,40,.6)';
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff9cff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; const t = (L.up ? '▲ ' : '▼ ') + wtFloorName(d, L.to.f);
      ctx.strokeText(t, x + 12, y + 4); ctx.fillText(t, x + 12, y + 4);
    }
  }
  if (WT.flash && WT.flash.until > performance.now()) requestAnimationFrame(wtDraw);
  wtInfo();
}
function wtFloorName(d, n) { const f = d.floors.find((x) => x.n === n || String(x.n) === String(n)); return f ? (f.name || 'floor ' + f.n) : 'floor ' + n; }
/* the ways between floors that start on the floor shown */
function wtLinks() {
  const W = WT.data[String(WT.map)]; const out = [];
  for (const L of W.links || []) {
    if (String(L.a.f) === WT.floor) out.push({ raw: L, me: L.a, to: L.b, up: L.b.wz > L.a.wz });
    if (String(L.b.f) === WT.floor) out.push({ raw: L, me: L.b, to: L.a, up: L.a.wz > L.b.wz });
  }
  return out;
}
function wtPx(f, x, y) { return [(f.yl - y) / (f.yl - f.yr) * 1002, (f.xt - x) / (f.xt - f.xb) * 668]; }
function wtSpots(d, f) {
  const out = [];
  for (const [, l] of G.spawnList) for (const s of l) if (s[0] === d.map && dungeonFloorAt(d, s[1], s[2], s[3]) === f) out.push([s[1], s[2], s[3]]);
  return out;
}
function wtHitLink(px, py) { const k = wtScale(); return wtLinks().find((L) => Math.hypot(L.me.x * k - px, L.me.y * k - py) < 12) || null; }
function wtClick(e) {
  const r = e.target.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
  const L = WT.show.links && wtHitLink(px, py);
  if (L) { wtSelect(WT.map, L.to.f); WT.flash = { L: L.raw, until: performance.now() + 2500 }; wtDraw(); return; }
  if (!WT.show.reach) return;
  // everything reachable from the clicked cell without crossing a wall
  const F = wtFloorData(); const b = wtBits(F); const k = wtScale();
  const cx = Math.floor(px / k / F.cell), cy = Math.floor(py / k / F.cell);
  if (cx < 0 || cy < 0 || cx >= F.w || cy >= F.h || !b[cy * F.w + cx]) { WT.reach = null; WT.reachInfo = 'Not walkable there (outside the walls).'; wtDraw(); return; }
  const reach = new Uint8Array(F.w * F.h); const st = [cy * F.w + cx]; reach[st[0]] = 1; let n = 0;
  while (st.length) { const i = st.pop(); n++; const x = i % F.w, y = (i / F.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= F.w || Y >= F.h) continue; const j = Y * F.w + X; if (b[j] && !reach[j]) { reach[j] = 1; st.push(j); } } }
  WT.reach = reach; let tot = 0; for (const v of b) tot += v;
  WT.reachInfo = 'Reachable from there: ' + Math.round(100 * n / Math.max(1, tot)) + '% of the walkable floor of this picture.';
  wtDraw();
}
function wtMove(e) {
  const r = e.target.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
  const L = WT.show.links && wtHitLink(px, py); const d = wtDungeon();
  WT.hover = L ? (L.up ? 'Up' : 'Down') + ' to ' + wtFloorName(d, L.to.f) + ' (' + Math.abs(Math.round(L.to.wz - L.me.wz)) + ' yards ' + (L.up ? 'higher' : 'lower') + ', ' + Math.round(L.raw.d) + ' yards across' + (L.raw.close ? '' : ' - no creature stands on the way, a guess') + ') - click to go there' : null;
  e.target.style.cursor = L ? 'pointer' : 'crosshair'; wtInfo();
}
function wtInfo() {
  const F = wtFloorData(); const d = wtDungeon(); if (!F || !d) return;
  const links = wtLinks();
  $('wtInfo').innerHTML = (WT.hover ? '<b>' + esc(WT.hover) + '</b><br>' : '') +
    esc(d.name) + ' - ' + esc(wtFloorName(d, WT.floor)) + ': ' + F.walls.length + ' wall lines, walkable ' + F.pct + '% of the picture, ' + F.spots + ' creature / object spots' + (F.drawn ? ' (walls drawn by hand)' : '') +
    (links.length ? ', ' + links.length + ' way' + (links.length > 1 ? 's' : '') + ' to other floors' : '') + '. ' + (WT.reachInfo ? esc(WT.reachInfo) : 'Click the floor to see what can be reached from there; click a pink circle to take that way.');
}
