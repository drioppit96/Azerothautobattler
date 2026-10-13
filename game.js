'use strict';
/* Azeroth Auto Battler - stage 1: map, character, click-to-travel.
   Data comes from ../gamedata (JSON made by the extraction scripts) and ../maps. */

const TYPE_NAMES = {1:'Beast',2:'Dragonkin',3:'Demon',4:'Elemental',5:'Giant',6:'Undead',7:'Humanoid',8:'Critter',9:'Mechanical',10:'Not specified',11:'Totem'};
const RANK_NAMES = {0:'',1:'Elite',2:'Rare Elite',3:'Boss',4:'Rare'};
const BEH_NAMES = {A:'Attacks on sight', N:'Neutral', F:'Friendly', X:'Cannot be attacked'};
const BEH_COLORS = {A:'#e0453a', N:'#e6b93c', F:'#4fc26b', X:'#8a8f9c'};
const RACE_NAMES = {1:'Human',2:'Orc',3:'Dwarf',4:'Night Elf',5:'Undead',6:'Tauren',7:'Gnome',8:'Troll'};
const CLASS_NAMES = {1:'Warrior',2:'Paladin',3:'Hunter',4:'Rogue',5:'Priest',7:'Shaman',8:'Mage',9:'Warlock',11:'Druid'};
const SAVE_KEY = 'wow_auto_battler_save_v1';
const RUN_SPEED = 7;            // yards per second
const STEP = 0.05;              // simulation step (seconds of game time)

const $ = (id) => document.getElementById(id);
const G = {
  d: {}, state: null, maps: [], map: null, img: {}, scale: 1, ox: 0, oy: 0, cw: 0, ch: 0,
  mobs: [], mobIdx: {}, portraits: {}, nav: null, hover: null, selected: null, acc: 0, last: 0, gameTime: 0,
  menuOpen: false, drag: null, dpr: 1,
};

/* ------------------------------------------------------------------ utils */
function fmtTime(s) { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function log(msg) {
  const el = $('log'); const d = document.createElement('div');
  d.innerHTML = '<span class="t">' + fmtTime(G.gameTime) + '</span> ' + esc(msg);
  el.prepend(d); while (el.children.length > 80) el.removeChild(el.lastChild);
}
function levelColor(mob, lvl) {
  const diff = mob - lvl;
  if (diff >= 5) return '#ff3b30';
  if (diff >= 3) return '#ff8c1a';
  if (diff >= -2) return '#ffe14d';
  if (diff >= -(lvl < 6 ? 3 : lvl < 40 ? 5 + Math.floor((lvl - 6) / 5) * 0 : 9)) return '#4fc26b';
  return '#9a9a9a';
}
async function J(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}
async function listDir(url, ext) {
  try {
    const r = await fetch(url); if (!r.ok) return [];
    const html = await r.text(); const out = [];
    const re = /href="([^"]+)"/g; let m;
    while ((m = re.exec(html))) { const n = decodeURIComponent(m[1]); if (n.toLowerCase().endsWith(ext)) out.push(n.split('/').pop()); }
    return out;
  } catch (e) { return []; }
}
function loadImage(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
const loadMsg = (t) => { $('loadmsg').textContent = t; };

/* ------------------------------------------------------------- map coords */
function mapSize(m) { const i = G.img[m.name]; return i ? [i.naturalWidth, i.naturalHeight] : [1002, 668]; }
function w2m(m, x, y) { const [W, H] = mapSize(m); return [(m.yl - y) / (m.yl - m.yr) * W, (m.xt - x) / (m.xt - m.xb) * H]; }
function m2w(m, px, py) { const [W, H] = mapSize(m); return { x: m.xt - py / H * (m.xt - m.xb), y: m.yl - px / W * (m.yl - m.yr) }; }
function w2s(x, y) { const [px, py] = w2m(G.map, x, y); return [G.ox + px * G.scale, G.oy + py * G.scale]; }
function s2w(sx, sy) { return m2w(G.map, (sx - G.ox) / G.scale, (sy - G.oy) / G.scale); }
function inMap(m, x, y) { return x <= m.xt && x >= m.xb && y <= m.yl && y >= m.yr; }
function mapCoords(m, x, y) { return [((m.yl - y) / (m.yl - m.yr) * 100).toFixed(1), ((m.xt - x) / (m.xt - m.xb) * 100).toFixed(1)]; }

function fitMap() {
  const [W, H] = mapSize(G.map);
  G.scale = Math.min(G.cw / W, G.ch / H);
  G.ox = (G.cw - W * G.scale) / 2; G.oy = (G.ch - H * G.scale) / 2;
}
function bestMapFor(pos) {
  let best = null;
  for (const m of G.maps) {
    if (m.map !== pos.map || !inMap(m, pos.x, pos.y)) continue;
    if (!best || (m.xt - m.xb) * (m.yl - m.yr) < (best.xt - best.xb) * (best.yl - best.yr)) best = m;
  }
  return best || G.maps[0];
}
function setMap(m, keepView) {
  G.map = m;
  document.querySelectorAll('#maptabs button').forEach((b) => b.classList.toggle('on', b.dataset.n === m.name));
  buildMobsForMap();
  if (!keepView) fitMap();
}

/* ------------------------------------------------------------------ mobs */
function buildMobsForMap() {
  const m = G.map; const out = [];
  const orcIdx = 1;
  for (const [e, lst] of G.spawnList) {
    for (const s of lst) {
      if (s[0] !== m.map || !inMap(m, s[1], s[2])) continue;
      const info = G.mobIdx[e];
      const h = G.d.hostility.creatures[e];
      out.push({ e, x: s[1], y: s[2], info, beh: h ? h[1][orcIdx] : 'N' });
    }
  }
  G.mobs = out;
}
function pickAt(sx, sy) {
  const r = 8; let best = null, bd = r * r;
  const show = $('showmobs').checked && (G.map.cont ? G.scale > 1.6 : true);
  if (show) {
    for (const mob of G.mobs) {
      const [x, y] = w2s(mob.x, mob.y); const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = { kind: 'mob', mob }; }
    }
  }
  for (const gy of G.d.graveyards) {
    if (gy[2] !== G.map.map || !inMap(G.map, gy[3], gy[4])) continue;
    const [x, y] = w2s(gy[3], gy[4]); const d = (x - sx) ** 2 + (y - sy) ** 2;
    if (d < bd) { bd = d; best = { kind: 'grave', g: gy }; }
  }
  for (const id in G.d.taxi.nodes) {
    const n = G.d.taxi.nodes[id];
    if (n.map !== G.map.map || !inMap(G.map, n.x, n.y) || !n.npcs.length) continue;
    const [x, y] = w2s(n.x, n.y); const d = (x - sx) ** 2 + (y - sy) ** 2;
    if (d < bd) { bd = d; best = { kind: 'taxi', n }; }
  }
  return best;
}

/* ------------------------------------------------------------- characters */
function newCharacter(name, race, cls) {
  const st = G.d.races.start[race + '_' + cls];
  return {
    id: 'c' + Date.now(), name, race, cls, level: 1, xp: 0, gold: 0,
    pos: { map: st.map, x: st.x, y: st.y, z: st.z, o: st.o }, hp: null, rage: 0,
    order: null, speed: RUN_SPEED,
  };
}
function active() { return G.state.characters.find((c) => c.id === G.state.activeId); }
function baseStats(c) {
  const t = G.d.races.stats[c.race] && G.d.races.stats[c.race][c.cls];
  const s = t && t[c.level - 1] ? t[c.level - 1] : [20, 20, 20, 20, 20];
  const cs = G.d.races.classstats[c.cls] && G.d.races.classstats[c.cls][c.level - 1];
  const base = cs ? cs[0] : 20;
  const hp = base + Math.min(s[2], 20) + Math.max(0, s[2] - 20) * 10;
  return { str: s[0], agi: s[1], sta: s[2], int: s[3], spi: s[4], maxHp: hp, power: cs ? cs[1] : 0 };
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.state)); } catch (e) { /* ignore */ }
}
function loadSave() {
  try { const t = localStorage.getItem(SAVE_KEY); if (t) return JSON.parse(t); } catch (e) { /* ignore */ }
  return null;
}

/* ----------------------------------------------------------------- orders */
function planPath(c, target) {
  const from = { x: c.pos.x, y: c.pos.y }; const to = { x: target.x, y: target.y };
  let pts = [from, to]; let via = 'straight line';
  const direct = dist(from, to);
  if (G.nav && direct > 350) {
    const a = G.nav.nearest(c.pos.map, from.x, from.y), b = G.nav.nearest(c.pos.map, to.x, to.y);
    if (a != null && b != null && a !== b) {
      const r = G.nav.route(a, b, { types: [1] });
      if (r && r.points.length) {
        const mid = r.points.map((p) => ({ x: p[0], y: p[1] }));
        const cand = [from].concat(mid, [to]);
        let len = 0; for (let i = 1; i < cand.length; i++) len += dist(cand[i - 1], cand[i]);
        if (len < direct * 4) { pts = cand; via = 'road network (' + r.nodes.length + ' waypoints)'; }
      }
    }
  }
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) if (dist(out[out.length - 1], pts[i]) > 0.5) out.push(pts[i]);
  let total = 0; for (let i = 1; i < out.length; i++) total += dist(out[i - 1], out[i]);
  return { pts: out, total, via };
}
function orderTravel(c, target, label) {
  const p = planPath(c, target);
  c.order = { type: 'travel', label: label || 'a point', target: { x: target.x, y: target.y }, path: p.pts, idx: 1, total: p.total, done: 0, via: p.via };
  log('Order: travel to ' + c.order.label + ' (' + Math.round(p.total) + ' yd, ' + fmtTime(p.total / c.speed / Math.max(1, G.state.settings.speed || 1)) + ', ' + p.via + ').');
  save(); renderOrder();
}
function stopOrder(c) {
  if (c.order) { log('Order cancelled.'); c.order = null; save(); renderOrder(); }
}
function updateChar(c, dt) {
  const o = c.order;
  if (!o) return;
  if (o.type === 'travel') {
    let left = c.speed * dt;
    while (left > 0 && o.idx < o.path.length) {
      const nx = o.path[o.idx]; const dx = nx.x - c.pos.x, dy = nx.y - c.pos.y; const d = Math.hypot(dx, dy);
      if (d <= left) { c.pos.x = nx.x; c.pos.y = nx.y; left -= d; o.done += d; o.idx++; }
      else { c.pos.x += dx / d * left; c.pos.y += dy / d * left; o.done += left; c.pos.o = Math.atan2(dx, dy); left = 0; }
    }
    if (o.idx >= o.path.length) { log('Arrived at ' + o.label + '.'); c.order = null; save(); renderOrder(); }
  }
}

/* --------------------------------------------------------------------- UI */
function renderChar() {
  const c = active(); const s = baseStats(c);
  const xpNext = (G.d.xp.levels[c.level - 1] || {}).xp_to_next || 1;
  if (c.hp == null || c.hp > s.maxHp) c.hp = s.maxHp;
  $('charCard').innerHTML =
    '<h3>Character</h3><div class="name" id="cname" title="Click to rename" style="cursor:pointer">' + esc(c.name) + '</div>' +
    '<div class="sub">Level ' + c.level + ' ' + RACE_NAMES[c.race] + ' ' + CLASS_NAMES[c.cls] + '</div>' +
    '<div class="bar hp"><i style="width:' + (100 * c.hp / s.maxHp) + '%"></i><span>' + Math.round(c.hp) + ' / ' + s.maxHp + '</span></div>' +
    '<div class="bar rage"><i style="width:' + c.rage + '%"></i><span>Rage ' + Math.round(c.rage) + ' / 100</span></div>' +
    '<div class="bar xp"><i style="width:' + (100 * c.xp / xpNext) + '%"></i><span>XP ' + c.xp + ' / ' + xpNext + '</span></div>' +
    '<div class="stats"><div>Strength <b>' + s.str + '</b></div><div>Agility <b>' + s.agi + '</b></div><div>Stamina <b>' + s.sta + '</b></div>' +
    '<div>Intellect <b>' + s.int + '</b></div><div>Spirit <b>' + s.spi + '</b></div><div>Run speed <b>' + c.speed + ' yd/s</b></div></div>';
  $('cname').onclick = () => { const n = prompt('Name:', c.name); if (n && n.trim()) { c.name = n.trim().slice(0, 20); save(); renderChar(); } };
}
function renderOrder() {
  const c = active(); const o = c.order; const speed = Math.max(1, G.state.settings.speed || 1);
  let h = '<h3>Orders</h3>';
  if (!o) h += '<div class="muted">Idle. Click the map to give an order.</div>';
  else {
    const left = Math.max(0, o.total - o.done);
    h += '<div><b>Travel</b> to ' + esc(o.label) + '</div><div class="muted">' + Math.round(left) + ' yd left, about ' + fmtTime(left / c.speed / speed) + ' (' + o.via + ')</div>' +
      '<div class="bar xp" style="margin:8px 0"><i style="width:' + (100 * o.done / Math.max(1, o.total)) + '%"></i></div>' +
      '<button class="act red" id="btnStop">Stop</button>';
  }
  h += '<div class="muted" style="margin-top:8px;font-size:12px">Coming next: grind, quest, gather, flight paths.</div>';
  $('orderCard').innerHTML = h;
  const b = $('btnStop'); if (b) b.onclick = () => stopOrder(c);
}
function renderInfo(sel) {
  const el = $('infoCard');
  if (!sel) { el.innerHTML = '<h3>Selection</h3><div class="muted">Click a creature, a graveyard or the ground on the map.</div>'; return; }
  const c = active();
  if (sel.kind === 'mob') {
    const mob = sel.mob; const i = mob.info; const lvl = i ? (i[2] === i[3] ? i[2] : i[2] + '-' + i[3]) : '?';
    const portrait = G.portraits[mob.e] ? '<img class="portrait" src="../portraits/by_name/' + encodeURIComponent(G.portraits[mob.e]) + '">' : '';
    const count = (G.spawnMap.get(mob.e) || []).length;
    el.innerHTML = '<h3>Creature</h3>' + portrait + '<div class="name" style="font-size:16px">' + esc(i ? i[1] : 'Creature ' + mob.e) + '</div>' +
      '<div class="sub" style="color:' + (i ? levelColor(i[3], c.level) : '#fff') + '">Level ' + lvl + ' ' + (RANK_NAMES[i ? i[4] : 0] || '') + '</div>' +
      '<div style="clear:both"></div>' +
      '<div class="kv"><span>Type</span><span>' + (TYPE_NAMES[i ? i[5] : 0] || '-') + '</span></div>' +
      '<div class="kv"><span>Towards you</span><span style="color:' + BEH_COLORS[mob.beh] + '">' + BEH_NAMES[mob.beh] + '</span></div>' +
      '<div class="kv"><span>Spawn points</span><span>' + count + '</span></div>' +
      '<div class="kv"><span>Entry</span><span>' + mob.e + '</span></div>';
  } else if (sel.kind === 'grave') {
    el.innerHTML = '<h3>Graveyard</h3><div class="name" style="font-size:16px">' + esc(sel.g[1]) + '</div><div class="muted">Where you return after dying.</div>';
  } else if (sel.kind === 'taxi') {
    el.innerHTML = '<h3>Flight master</h3><div class="name" style="font-size:16px">' + esc(sel.n.n) + '</div><div class="muted">' + esc(sel.n.npcs[0][1]) + '</div>';
  } else {
    const [mx, my] = mapCoords(G.map, sel.x, sel.y);
    el.innerHTML = '<h3>Location</h3><div class="kv"><span>Map position</span><span>' + mx + ', ' + my + '</span></div>' +
      '<div class="kv"><span>World</span><span>' + sel.x.toFixed(0) + ', ' + sel.y.toFixed(0) + '</span></div>';
  }
}
function showMenu(sx, sy, sel) {
  const m = $('menu'); const c = active();
  let target, title, label;
  if (sel.kind === 'mob') { target = { x: sel.mob.x, y: sel.mob.y }; title = sel.mob.info ? sel.mob.info[1] : 'Creature'; label = title; }
  else if (sel.kind === 'grave') { target = { x: sel.g[3], y: sel.g[4] }; title = sel.g[1] + ' graveyard'; label = title; }
  else if (sel.kind === 'taxi') { target = { x: sel.n.x, y: sel.n.y }; title = sel.n.n; label = title + ' flight master'; }
  else { target = { x: sel.x, y: sel.y }; const [a, b] = mapCoords(G.map, sel.x, sel.y); title = 'Position ' + a + ', ' + b; label = 'position ' + a + ', ' + b; }
  m.innerHTML = '<h4>' + esc(title) + '</h4>' +
    '<button data-a="travel">Travel here</button>' +
    '<button disabled>Grind around here (stage 2)</button>' +
    '<button disabled>Gather around here (stage 5)</button>' +
    '<button data-a="close" style="color:#9a8f77">Cancel</button>';
  m.hidden = false; G.menuOpen = true;
  const w = $('mapwrap').clientWidth, h = $('mapwrap').clientHeight;
  m.style.left = Math.min(sx + 6, w - 220) + 'px'; m.style.top = Math.min(sy + 6, h - 140) + 'px';
  m.onclick = (ev) => {
    const a = ev.target.dataset && ev.target.dataset.a; if (!a) return;
    if (a === 'travel') orderTravel(c, target, label);
    hideMenu();
  };
}
function hideMenu() { $('menu').hidden = true; G.menuOpen = false; }

/* -------------------------------------------------------------- rendering */
function draw() {
  const cv = $('map'); const ctx = cv.getContext('2d');
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, G.cw, G.ch);
  const img = G.img[G.map.name]; const m = G.map;
  if (img) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, G.ox, G.oy, img.naturalWidth * G.scale, img.naturalHeight * G.scale); }
  const c = active();
  // routes (debug)
  if ($('showroutes').checked && G.d.navgraph) {
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(80,200,255,.55)'; ctx.beginPath();
    const ng = G.d.navgraph;
    for (const L of ng.links) {
      if (L[2] !== 1 || L[7] < 0) continue;
      const p = ng.paths[L[7]]; let started = false;
      for (let i = 0; i < p.length; i += 3) {
        const [x, y] = w2s(p[i], p[i + 1]);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  // creatures
  if ($('showmobs').checked && (!m.cont || G.scale > 1.6)) {
    const r = Math.max(2, Math.min(5, G.scale * 1.6));
    for (const mob of G.mobs) {
      const [x, y] = w2s(mob.x, mob.y);
      if (x < -5 || y < -5 || x > G.cw + 5 || y > G.ch + 5) continue;
      ctx.fillStyle = BEH_COLORS[mob.beh] || '#888'; ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // graveyards / flight masters
  ctx.font = '11px Segoe UI';
  for (const gy of G.d.graveyards) {
    if (gy[2] !== m.map || !inMap(m, gy[3], gy[4])) continue;
    const [x, y] = w2s(gy[3], gy[4]);
    ctx.fillStyle = '#cfd6e6'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.stroke(); ctx.fill();
  }
  for (const id in G.d.taxi.nodes) {
    const n = G.d.taxi.nodes[id];
    if (n.map !== m.map || !inMap(m, n.x, n.y) || !n.npcs.length) continue;
    const [x, y] = w2s(n.x, n.y);
    ctx.fillStyle = '#4aa8ff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.3); ctx.stroke(); ctx.fill();
  }
  // path preview
  if (c.order && c.order.type === 'travel' && c.pos.map === m.map) {
    ctx.setLineDash([6, 5]); ctx.strokeStyle = '#ffd866'; ctx.lineWidth = 2; ctx.beginPath();
    let [x, y] = w2s(c.pos.x, c.pos.y); ctx.moveTo(x, y);
    for (let i = c.order.idx; i < c.order.path.length; i++) { [x, y] = w2s(c.order.path[i].x, c.order.path[i].y); ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    const t = c.order.target; const [tx, ty] = w2s(t.x, t.y);
    ctx.strokeStyle = '#ffd866'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, 7, 0, 6.3); ctx.moveTo(tx - 10, ty); ctx.lineTo(tx + 10, ty); ctx.moveTo(tx, ty - 10); ctx.lineTo(tx, ty + 10); ctx.stroke();
  }
  // selection ring
  const sel = G.selected;
  if (sel && sel.kind === 'mob') {
    const [x, y] = w2s(sel.mob.x, sel.mob.y); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.3); ctx.stroke();
  }
  // the character
  if (c.pos.map === m.map && inMap(m, c.pos.x, c.pos.y)) {
    const [x, y] = w2s(c.pos.x, c.pos.y);
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#c0662a'; ctx.strokeStyle = '#fff3d0'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.3); ctx.fill(); ctx.stroke();
    // facing arrow: o is the angle from north (x axis) towards west (y axis); screen east = -y
    const ang = Math.atan2(-Math.sin(c.pos.o), -Math.cos(c.pos.o));
    const dx = -Math.sin(c.pos.o), dy = -Math.cos(c.pos.o);
    ctx.fillStyle = '#fff3d0'; ctx.beginPath(); ctx.moveTo(dx * 14, dy * 14); ctx.lineTo(dx * 7 - dy * 4, dy * 7 + dx * 4); ctx.lineTo(dx * 7 + dy * 4, dy * 7 - dx * 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffe9a8';
    ctx.strokeText(c.name, x, y - 14); ctx.fillText(c.name, x, y - 14); ctx.textAlign = 'start';
  }
}
function resize() {
  const wrap = $('mapwrap'); G.dpr = window.devicePixelRatio || 1;
  G.cw = wrap.clientWidth; G.ch = wrap.clientHeight;
  const cv = $('map'); cv.width = Math.round(G.cw * G.dpr); cv.height = Math.round(G.ch * G.dpr);
  if (G.map) fitMap();
}

/* ------------------------------------------------------------------ input */
function bindInput() {
  const cv = $('map');
  cv.addEventListener('mousedown', (e) => { G.drag = { x: e.offsetX, y: e.offsetY, ox: G.ox, oy: G.oy, moved: false }; hideMenu(); });
  window.addEventListener('mouseup', (e) => {
    const d = G.drag; G.drag = null; if (!d) return;
    if (d.moved || e.target !== cv) return;
    const sx = e.offsetX, sy = e.offsetY; const hit = pickAt(sx, sy);
    const w = s2w(sx, sy);
    const sel = hit || { kind: 'ground', x: w.x, y: w.y };
    if (!hit && !inMap(G.map, w.x, w.y)) return;
    G.selected = sel; renderInfo(sel); showMenu(sx, sy, sel);
  });
  cv.addEventListener('mousemove', (e) => {
    const sx = e.offsetX, sy = e.offsetY;
    if (G.drag) {
      if (Math.abs(sx - G.drag.x) + Math.abs(sy - G.drag.y) > 5) G.drag.moved = true;
      if (G.drag.moved) { G.ox = G.drag.ox + sx - G.drag.x; G.oy = G.drag.oy + sy - G.drag.y; $('follow').checked = false; }
    }
    const w = s2w(sx, sy);
    if (inMap(G.map, w.x, w.y)) { const [a, b] = mapCoords(G.map, w.x, w.y); $('coords').textContent = a + ', ' + b; } else $('coords').textContent = '';
    const hit = G.drag && G.drag.moved ? null : pickAt(sx, sy); const tip = $('tip');
    if (hit) {
      let t = '';
      if (hit.kind === 'mob') { const i = hit.mob.info; t = '<b>' + esc(i ? i[1] : 'Creature') + '</b><br><span style="color:' + (i ? levelColor(i[3], active().level) : '#fff') + '">Level ' + (i ? (i[2] === i[3] ? i[2] : i[2] + '-' + i[3]) : '?') + '</span> ' + (RANK_NAMES[i ? i[4] : 0] || '') + '<br><span style="color:' + BEH_COLORS[hit.mob.beh] + '">' + BEH_NAMES[hit.mob.beh] + '</span>'; }
      else if (hit.kind === 'grave') t = '<b>' + esc(hit.g[1]) + '</b><br>Graveyard';
      else t = '<b>' + esc(hit.n.n) + '</b><br>Flight master';
      tip.innerHTML = t; tip.hidden = false; tip.style.left = (sx + 14) + 'px'; tip.style.top = (sy + 14) + 'px'; cv.style.cursor = 'pointer';
    } else { tip.hidden = true; cv.style.cursor = G.drag && G.drag.moved ? 'grabbing' : 'crosshair'; }
  });
  cv.addEventListener('mouseleave', () => { $('tip').hidden = true; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [W] = mapSize(G.map); const minS = Math.min(G.cw / W, G.ch / mapSize(G.map)[1]) * 0.8;
    const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; const ns = Math.max(minS, Math.min(12, G.scale * f));
    const k = ns / G.scale; G.ox = e.offsetX - (e.offsetX - G.ox) * k; G.oy = e.offsetY - (e.offsetY - G.oy) * k; G.scale = ns;
  }, { passive: false });
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMenu();
    if (e.key === ' ' && document.activeElement === document.body) { e.preventDefault(); setSpeed(G.state.settings.speed ? 0 : (G.lastSpeed || 1)); }
  });
  $('speed').addEventListener('click', (e) => { const s = e.target.dataset && e.target.dataset.s; if (s !== undefined) setSpeed(+s); });
  $('btnSave').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(G.state, null, 1)], { type: 'application/json' }));
    a.download = 'auto_battler_save.json'; a.click();
  };
  $('btnLoad').onclick = () => $('fileLoad').click();
  $('fileLoad').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const s = JSON.parse(await f.text()); if (!s.characters || !s.characters.length) throw new Error('no characters'); G.state = s; save(); location.reload(); }
    catch (err) { alert('Could not read that file: ' + err.message); }
  };
}
function setSpeed(s) {
  if (s) G.lastSpeed = s;
  G.state.settings.speed = s;
  document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s));
  save(); renderOrder();
}

/* ------------------------------------------------------------------- loop */
function frame(ts) {
  const dt = Math.min(0.25, (ts - (G.last || ts)) / 1000); G.last = ts;
  const sp = G.state.settings.speed;
  if (sp > 0) {
    G.acc += dt * sp;
    while (G.acc >= STEP) { G.acc -= STEP; G.gameTime += STEP; for (const c of G.state.characters) updateChar(c, STEP); }
  }
  const c = active();
  if ($('follow').checked && c.pos.map === G.map.map) { const [px, py] = w2m(G.map, c.pos.x, c.pos.y); G.ox = G.cw / 2 - px * G.scale; G.oy = G.ch / 2 - py * G.scale; }
  draw();
  if (c.order && ((ts | 0) % 4 === 0)) renderOrder();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------- boot */
async function boot() {
  try {
    loadMsg('game data ...');
    const names = ['races', 'hostility', 'spawns', 'xp', 'taxi', 'navgraph'];
    const res = await Promise.all(names.map((n) => J('../gamedata/' + n + '.json')));
    names.forEach((n, i) => { G.d[n] = res[i]; });
    G.d.graveyards = DATA.graveyards;
    G.spawnList = Object.entries(G.d.spawns.spawns).map(([e, l]) => [+e, l]);
    G.spawnMap = new Map(G.spawnList);
    for (const m of DATA.mobs) G.mobIdx[m[0]] = m;
    G.nav = makeNav(G.d.navgraph);

    loadMsg('maps ...');
    const files = await listDir('../maps/', '.png');
    const wanted = DATA.maps.filter((m) => files.includes(m.file.split('/').pop()) || (!files.length && m.name === 'Kalimdor'));
    for (const m of wanted) { G.img[m.name] = await loadImage('../' + m.file); }
    G.maps = wanted.filter((m) => G.img[m.name]);
    if (!G.maps.length) throw new Error('no map images found in the maps folder');
    const order = ['Durotar', 'Orgrimmar', 'The Barrens', 'Kalimdor'];
    G.maps.sort((a, b) => (order.indexOf(a.name) + 99) % 99 - (order.indexOf(b.name) + 99) % 99);
    $('maptabs').innerHTML = G.maps.map((m) => '<button data-n="' + esc(m.name) + '">' + esc(m.name) + '</button>').join('');
    $('maptabs').onclick = (e) => { const n = e.target.dataset && e.target.dataset.n; if (n) { setMap(G.maps.find((m) => m.name === n)); } };

    loadMsg('portraits ...');
    for (const f of await listDir('../portraits/by_name/', '.png')) { const m = /^(\d+)_/.exec(f); if (m) G.portraits[+m[1]] = f; }

    G.state = loadSave();
    if (!G.state || !G.state.characters || !G.state.characters.length) {
      const c = newCharacter('Throg', 2, 1);
      G.state = { version: 1, activeId: c.id, characters: [c], settings: { speed: 1, autoSellJunk: false } };
      save();
    }
    bindInput(); resize();
    const c = active();
    setMap(bestMapFor(c.pos));
    // zoom in a little on the character at the start
    if (!G.map.cont) { G.scale *= 1.8; const [px, py] = w2m(G.map, c.pos.x, c.pos.y); G.ox = G.cw / 2 - px * G.scale; G.oy = G.ch / 2 - py * G.scale; }
    setSpeed(G.state.settings.speed === undefined ? 1 : G.state.settings.speed);
    renderChar(); renderOrder(); renderInfo(null);
    log('Welcome. ' + c.name + ' stands in ' + (G.map.name) + '. Click the map to give an order.');
    $('loading').style.display = 'none';
    requestAnimationFrame(frame);
    window.G = G;
  } catch (e) {
    $('loading').innerHTML = '<div><b style="color:#e0453a">Could not start</b><div id="loadmsg" style="max-width:520px">' + esc(e.message) + '<br><br>Start the game with start_game.bat (it serves your "wow excel" folder), then open http://localhost:8000/game/</div></div>';
    console.error(e);
  }
}
boot();
