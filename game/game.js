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
  menuOpen: false, drag: null, dpr: 1, world: {}, fx: [], uiT: 0,
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
  G.scale = G.ch > G.cw * 1.15 ? Math.max(G.cw / W, G.ch / H) * 0.9 : Math.min(G.cw / W, G.ch / H);
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
function setMap(m, keepView, onChar) {
  G.map = m; G.navHover = null; $('tip').hidden = true;
  if (m.world) G.mobs = []; else buildMobsForMap();
  const done = () => {
    if (G.map !== m) return;
    if (onChar) { const c = active(); centerOn(c.pos.x, c.pos.y, m.cont ? 1 : 1.8); }
    else if (!keepView) fitMap();
  };
  if (!G.img[m.name]) {
    G.img[m.name] = null; fitMap();
    loadImage('../' + m.file).then((img) => { if (img) { G.img[m.name] = img; done(); } else delete G.img[m.name]; });
  } else done();
  renderNav();
}

/* ------------------------------------------------------------------ mobs */
function buildMobsForMap() {
  const m = G.map; const c = active ? active() : null; const out = [];
  const W = ensureWorld(m.map);
  for (const mob of W.list) {
    if (!inMap(m, mob.hx, mob.hy)) continue;
    mob.beh = c ? behOf(mob, c) : 'N'; out.push(mob);
  }
  G.mobs = out;
}
function pickAt(sx, sy, rad) {
  const r = rad || 8; let best = null, bd = r * r;
  const show = $('showmobs').checked && (G.map.cont ? G.scale > 1.6 : true);
  if (show) {
    for (const mob of G.mobs) {
      const [x, y] = w2s(mob.x, mob.y); const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (mob.st !== 'dead' && d < bd) { bd = d; best = { kind: 'mob', mob }; }
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
  const gear = START_GEAR[race + '_' + cls] || { equip: {}, bags: [] };
  return {
    id: 'c' + Date.now(), name, race, cls, level: 1, xp: 0, gold: 0,
    pos: { map: st.map, x: st.x, y: st.y, z: st.z, o: st.o }, hp: null, rage: 0,
    order: null, speed: RUN_SPEED,
    equip: {}, bags: [], bagSlots: [null, null, null, null], quests: {}, done: {},
    _gear: gear, _new: true,
  };
}
function migrate(c) {
  c.equip = c.equip || {}; c.bags = c.bags || []; c.quests = c.quests || {}; c.done = c.done || {}; c.gold = c.gold || 0;
  c.bagSlots = c.bagSlots || [null, null, null, null];
  if (c._gear) { for (const k in c._gear.equip) c.equip[k] = makeInst(c._gear.equip[k], 1); for (const [id, n] of c._gear.bags) addItem(c, id, n); delete c._gear; }
  for (const k in c.equip) c.equip[k] = normInst(c.equip[k]);
  for (const s of c.bags) { const m = maxDur(s.id); if (m && s.dur == null) s.dur = m; }
  c.cfg = Object.assign(defaultCfg(), c.cfg || {}); c.talents = c.talents || {}; c.taxi = c.taxi || {};
  if (c.resume && !c.order) { c.order = c.resume; c.hp = null; } delete c.resume;      // was dead when the game closed
  if (G.state && G.state.settings) { if (G.state.settings.autoEat === false) c.cfg.eatAt = 0; if (G.state.settings.autoPotion === false) c.cfg.potionAt = 0; }
  learnAbilities(c, !c._new); delete c._new;
  if (c.cfg.autoTalents !== false && talentFree(c) > 0) autoTalents(c, true);
  dirty(c);
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
  if (G.state) G.state.gameTime = G.gameTime;       // order timers are in game time: keep the clock across sessions
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.state, (k, v) => (k === 'rt' || k === '_set' ? undefined : v))); } catch (e) { /* ignore */ }
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
  const ghost = !!(c.rt && c.rt.ghost);
  if (typeof gridOf === 'function' && gridOf(c.pos.map) && direct > 6) {
    const gp = gridPath(c, from, to, ghost);
    if (gp) {
      const out = [gp[0]]; for (let i = 1; i < gp.length; i++) if (dist(out[out.length - 1], gp[i]) > 0.5) out.push(gp[i]);
      let total = 0; for (let i = 1; i < out.length; i++) total += dist(out[i - 1], out[i]);
      return { pts: out, total, via: 'terrain path (' + (out.length - 1) + ' legs)' };
    }
  }
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
  const safe = c.cfg && !(c.rt && c.rt.ghost) && direct > 40 && direct <= 4000 ? safePath(c, from, to, pts.length > 2 ? pts : null) : null;
  if (safe) { pts = safe; via = 'around hostile camps'; }
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) if (dist(out[out.length - 1], pts[i]) > 0.5) out.push(pts[i]);
  let total = 0; for (let i = 1; i < out.length; i++) total += dist(out[i - 1], out[i]);
  return { pts: out, total, via };
}
/* A* on a coarse grid where the aggro circles of hostile creatures cost extra (how much depends on the playstyle).
   Returns null when the straight line is already clear. */
function safePath(c, from, to, road) {
  if (typeof ensureWorld !== 'function') return null;
  const style = c.cfg.style; const W = ensureWorld(c.pos.map);
  const pad = 120; let x0 = Math.min(from.x, to.x) - pad, x1 = Math.max(from.x, to.x) + pad, y0 = Math.min(from.y, to.y) - pad, y1 = Math.max(from.y, to.y) + pad;
  if (road) for (const p of road) { x0 = Math.min(x0, p.x - 30); x1 = Math.max(x1, p.x + 30); y0 = Math.min(y0, p.y - 30); y1 = Math.max(y1, p.y + 30); }
  const cell = Math.max(8, Math.ceil(Math.max(x1 - x0, y1 - y0) / 170));
  const w = Math.ceil((x1 - x0) / cell) + 1, h = Math.ceil((y1 - y0) / cell) + 1;
  const cost = new Float32Array(w * h).fill(1); let any = false;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rad = Math.hypot(x1 - x0, y1 - y0) / 2;
  mobsNear(W, cx, cy, rad, (m) => {
    if (m.st !== 'alive' || m.civ || behOf(m, c) !== 'A') return;
    if (m === (c.rt && c.rt.tgt)) return;
    const dng = dangerous(m, c); const pen = dng ? 80 : style === 'safe' ? 30 : style === 'balanced' ? 15 : 0; if (!pen) return;
    const R = aggroRadius(m, c) + (dng ? 10 : 4);
    if (Math.hypot(m.x - to.x, m.y - to.y) < R && !dng) return;     // the goal itself is next to it
    const i0 = Math.max(0, Math.floor((m.x - R - x0) / cell)), i1 = Math.min(w - 1, Math.ceil((m.x + R - x0) / cell));
    const j0 = Math.max(0, Math.floor((m.y - R - y0) / cell)), j1 = Math.min(h - 1, Math.ceil((m.y + R - y0) / cell));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const px = x0 + i * cell, py = y0 + j * cell; if (Math.hypot(px - m.x, py - m.y) <= R) { cost[j * w + i] += pen; any = true; } }
  });
  if (!any) return null;
  const idx = (p) => Math.min(h - 1, Math.max(0, Math.round((p.y - y0) / cell))) * w + Math.min(w - 1, Math.max(0, Math.round((p.x - x0) / cell)));
  const lineCost = (a, b) => { const n = Math.ceil(dist(a, b) / (cell / 2)); let mx = 1; for (let k = 0; k <= n; k++) { const t = k / Math.max(1, n); mx = Math.max(mx, cost[idx({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })]); } return mx; };
  if (road) { let bad = false; for (let k = 1; k < road.length && !bad; k++) if (lineCost(road[k - 1], road[k]) > 1) bad = true; if (!bad) return null; }
  else if (lineCost(from, to) <= 1) return null;
  const s = idx(from), goal = idx(to); const N = w * h;
  const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const gx = goal % w, gy = (goal / w) | 0;
  g[s] = 0; push(s, 0); let iter = 0;
  while (heap.length && iter++ < 60000) {
    const [, n] = pop(); if (closed[n]) continue; closed[n] = 1; if (n === goal) break;
    const nx = n % w, ny = (n / w) | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue; const mx = nx + dx, my = ny + dy; if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
      const m = my * w + mx; if (closed[m]) continue;
      const step = (dx && dy ? 1.414 : 1) * (cost[n] + cost[m]) / 2;
      const ng = g[n] + step; if (ng < g[m]) { g[m] = ng; came[m] = n; push(m, ng + Math.hypot(mx - gx, my - gy)); }
    }
  }
  if (came[goal] < 0) return null;
  const cells = []; for (let n = goal; n !== s && n >= 0; n = came[n]) cells.push(n); cells.reverse();
  const raw = [from].concat(cells.map((n) => ({ x: x0 + (n % w) * cell, y: y0 + ((n / w) | 0) * cell })), [to]);
  // pull the string: skip points while the straight line costs no more than the path it replaces
  const out = [raw[0]]; let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && lineCost(raw[i], raw[j]) > 1.01) j--;
    out.push(raw[j]); i = j;
  }
  return out;
}
function orderTravel(c, target, label) {
  const p = planPath(c, target);
  c.order = { type: 'travel', label: label || 'a point', target: { x: target.x, y: target.y }, path: p.pts, idx: 1, total: p.total, done: 0, via: p.via };
  log('Order: travel to ' + c.order.label + ' (' + Math.round(p.total) + ' yd, ' + fmtTime(p.total / c.speed / Math.max(1, G.state.settings.speed || 1)) + ', ' + p.via + ').');
  save(); renderOrder();
}
function stopOrder(c) {
  if (c.order) { log('Order cancelled.'); c.order = null; const r = rt(c); r.mv = null; r.tgt = null; r.resting = false; save(); renderOrder(); }
}
/* --------------------------------------------------------------------- UI */
function renderChar() {
  const c = active(); const s = charStats(c); const r = rt(c);
  const xpNext = (G.d.xp.levels[c.level - 1] || {}).xp_to_next || 1;
  if (c.hp == null || c.hp > s.maxHp) c.hp = s.maxHp;
  let status = 'Idle';
  if (r.ghost) status = 'Ghost - running to the corpse';
  else if (r.flying) status = 'Flying to ' + G.d.taxi.nodes[r.flying.to].n;
  else if (r.riding) status = 'Travelling on ' + r.riding.name;
  else if (r.fleeing) status = 'Fleeing';
  else if (r.threats && r.threats.length) status = 'In combat: ' + (r.tgt && r.tgt.info ? r.tgt.info[1] : '...');
  else if (r.resting) status = 'Resting';
  else if (c.order) status = 'Working on an order';
  if (!$('charTop')) $('charCard').innerHTML = '<div id="charTop"></div><div id="unitframes"></div><div id="charStats"></div>';
  $('charTop').innerHTML =
    '<h3>Character</h3><div class="name" id="cname" title="Click to rename" style="cursor:pointer">' + esc(c.name) + '</div>' +
    '<div class="sub">Level ' + c.level + ' ' + RACE_NAMES[c.race] + ' ' + CLASS_NAMES[c.cls] + ' &middot; ' + status + '</div>' +
    '<div class="bar hp"><i style="width:' + (100 * Math.max(0, c.hp) / s.maxHp) + '%"></i><span>' + Math.round(c.hp) + ' / ' + s.maxHp + '</span></div>' +
    '<div class="bar rage"><i style="width:' + c.rage + '%"></i><span>Rage ' + Math.round(c.rage) + ' / 100</span></div>' +
    '<div class="bar xp"><i style="width:' + (100 * c.xp / xpNext) + '%"></i><span>XP ' + c.xp + ' / ' + xpNext + '</span></div>';
  $('charStats').innerHTML =
    '<div class="stats"><div>Strength <b>' + s.str + '</b></div><div>Agility <b>' + s.agi + '</b></div><div>Stamina <b>' + s.sta + '</b></div>' +
    '<div>Intellect <b>' + s.int + '</b></div><div>Spirit <b>' + s.spi + '</b></div><div>Armor <b>' + Math.round(s.armor) + '</b></div>' +
    '<div>Attack power <b>' + s.ap + '</b></div><div>Crit <b>' + s.crit.toFixed(1) + '%</b></div></div>' +
    '<div class="kv" style="margin-top:6px"><span>Money</span><span style="color:#ffd866">' + money(c.gold) + '</span></div>';
  renderUnitFrames();
  $('cname').onclick = () => { const n = prompt('Name:', c.name); if (n && n.trim()) { c.name = n.trim().slice(0, 20); save(); renderChar(); } };
}
function orderText(c) {
  const o = c.order; if (!o) return null;
  if (o.type === 'travel') return { t: 'Travel to ' + o.label, d: Math.round(Math.max(0, o.total - o.done)) + ' yd left (' + o.via + ')' };
  if (o.type === 'grind') return { t: 'Grind ' + o.label, d: 'Radius ' + o.radius + ' yd' + (o.entries ? ', only ' + mobName(o.entries[0]) : '') };
  if (o.type === 'quest') return { t: 'Quest: ' + o.label, d: (o.phase || '') + (o.where ? ' - ' + o.where : '') };
  if ((o.type === 'questing' || o.type === 'quest' || o.type === 'leveling') && o.wobj && G.q.byId[o.wobj[0]] && active().quests[o.wobj[0]] && o.phase === G.q.byId[o.wobj[0]].title) { const q = G.q.byId[o.wobj[0]]; const ob = q.objectives[o.wobj[1]]; o.where = (ob.type === 'Collect' ? 'collect ' : ob.id < 0 ? 'use ' : 'kill ') + ob.name + ' ' + progText(active(), q, o.wobj[1]); }
  if (o.type === 'leveling') return levelingText(c, o);
  if (o.type === 'questing') { const q = o.fq && G.q.byId[o.fq]; return { t: 'Questing: ' + (o.zones[o.zi] || 'done'), d: (q ? (o.phase && o.phase.indexOf(q.title) >= 0 ? o.phase : q.title) : (o.phase || 'looking for quests')) + (o.where ? ' - ' + o.where : '') }; }
  if (o.type === 'sell' || o.type === 'vendor') return { t: 'Vendor: ' + o.label, d: o.resume ? 'Selling junk, then back to work' : 'Walking to the vendor' };
  return { t: o.type, d: '' };
}
function renderOrder() {
  const c = active(); const o = c.order; const speed = Math.max(1, G.state.settings.speed || 1);
  let h = '<h3>Orders</h3>';
  if (!o) h += '<div class="muted">Idle. Click the map to give an order, or pick a quest.</div>';
  else {
    const tx = orderText(c);
    h += '<div><b>' + esc(tx.t) + '</b></div><div class="muted">' + esc(tx.d) + '</div>';
    if (o.type === 'travel') { const left = Math.max(0, o.total - o.done); h += '<div class="muted">about ' + fmtTime(left / c.speed / speed) + '</div><div class="bar xp" style="margin:8px 0"><i style="width:' + (100 * o.done / Math.max(1, o.total)) + '%"></i></div>'; }
    if (o.type === 'grind') h += '<div class="muted">Kills so far: ' + (o.kills || 0) + '</div>';
    h += '<button class="act red" id="btnStop" style="margin-top:8px">Stop</button>';
  }
  h += '<div style="margin-top:10px"><label class="chk"><input type="checkbox" id="autoSell"' + (G.state.settings.autoSellJunk ? ' checked' : '') + '> Auto-sell junk (grey and vendor trash): when near a vendor, and when bags are full</label>' +
    '<label class="chk"><input type="checkbox" id="sellWhite"' + (G.state.settings.sellWhiteGear ? ' checked' : '') + '> Count white gear that is no upgrade as junk</label></div>';
  $('orderCard').innerHTML = h;
  const b = $('btnStop'); if (b) b.onclick = () => stopOrder(c);
  const a = $('autoSell'); if (a) a.onchange = () => { G.state.settings.autoSellJunk = a.checked; save(); };
  const sw = $('sellWhite'); if (sw) sw.onchange = () => { G.state.settings.sellWhiteGear = sw.checked; save(); refreshGear(); };
}
function renderInfo(sel) {
  const el = $('infoCard');
  if (!sel) { el.innerHTML = '<h3>Selection</h3><div class="muted">Click a creature, a graveyard or the ground on the map.</div>'; return; }
  const c = active();
  if (sel.kind === 'mob') {
    const mob = sel.mob; const i = mob.info; const lvl = mob.lvl || (i ? (i[2] === i[3] ? i[2] : i[2] + '-' + i[3]) : '?');
    const portrait = G.portraits[mob.e] ? '<img class="portrait" src="../portraits/by_name/' + encodeURIComponent(G.portraits[mob.e]) + '">' : '';
    const count = (G.spawnMap.get(mob.e) || []).length;
    el.innerHTML = '<h3>Creature</h3>' + portrait + '<div class="name" style="font-size:16px">' + esc(i ? i[1] : 'Creature ' + mob.e) + '</div>' +
      '<div class="sub" style="color:' + (i ? levelColor(i[3], c.level) : '#fff') + '">Level ' + lvl + ' ' + (RANK_NAMES[i ? i[4] : 0] || '') + '</div>' +
      '<div style="clear:both"></div>' +
      '<div class="kv"><span>Type</span><span>' + (TYPE_NAMES[i ? i[5] : 0] || '-') + '</span></div>' +
      '<div class="kv"><span>Towards you</span><span style="color:' + BEH_COLORS[mob.beh] + '">' + BEH_NAMES[mob.beh] + '</span></div>' +
      '<div class="kv"><span>Health</span><span>' + Math.max(0, Math.round(mob.hp)) + ' / ' + mob.maxhp + '</span></div><div class="kv"><span>Damage</span><span>' + Math.round(mob.dmin) + '-' + Math.round(mob.dmax) + '</span></div><div class="kv"><span>Spawn points</span><span>' + count + '</span></div>' +
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
  let extra = '';
  const acts = {};
  if (sel.kind === 'mob') {
    const i = sel.mob.info;
    if (sel.mob.st !== 'dead' && (sel.mob.beh === 'A' || sel.mob.beh === 'N') && !sel.mob.civ) { extra += '<button data-a="grindtype">Grind this kind of creature (' + esc(title) + ')</button>'; }
    const qs = (G.q.byGiver[sel.mob.e] || []).filter((q) => questAvailable(c, q));
    for (const q of qs.slice(0, 5)) { const why = questSupport(q); extra += '<button data-a="quest:' + q.id + '"' + (why ? ' disabled title="' + esc(why) + '"' : '') + '>Quest: ' + esc(q.title) + ' (' + q.level + ')</button>'; }
    const h9 = G.d.hostility.creatures[sel.mob.e];
    if (h9 && (h9[9] & 4 || (G.d.vendorItems && G.d.vendorItems[sel.mob.e]))) extra += '<button data-a="vendor">Go to vendor (buy / sell' + (h9[9] & 16384 ? ' / repair' : '') + ')</button>';
    const ready = Object.keys(c.quests).map((id) => G.q.byId[id]).filter((q) => q && q.turnin.some((t) => t[1] === sel.mob.e) && questDone(c, q));
    for (const q of ready) extra += '<button data-a="quest:' + q.id + '">Turn in: ' + esc(q.title) + '</button>';
  }
  m.innerHTML = '<h4>' + esc(title) + '</h4>' +
    '<button data-a="travel">Travel here</button>' +
    '<button data-a="grind">Grind around here</button>' + extra +
    '<button disabled>Gather around here (stage 5)</button>' +
    '<button data-a="close" style="color:#9a8f77">Cancel</button>';
  m.hidden = false; G.menuOpen = true;
  const w = $('mapwrap').clientWidth, h = $('mapwrap').clientHeight;
  m.style.left = Math.min(sx + 6, w - 220) + 'px'; m.style.top = Math.max(4, Math.min(sy + 6, h - 40 - 30 * (m.children.length))) + 'px';
  m.onclick = (ev) => {
    const a = ev.target.dataset && ev.target.dataset.a; if (!a) return;
    if (a === 'travel') orderTravel(c, target, label);
    else if (a === 'grind') orderGrind(c, target.x, target.y, 100, null, 'around ' + (sel.kind === 'ground' ? label : title));
    else if (a === 'grindtype') orderGrind(c, target.x, target.y, 250, [sel.mob.e], title + ' near here');
    else if (a.startsWith('quest:')) orderQuest(c, +a.slice(6));
    else if (a === 'vendor') { const v = vendorList().find((x) => x.e === sel.mob.e && Math.hypot(x.x - sel.mob.x, x.y - sel.mob.y) < 5) || vendorList().find((x) => x.e === sel.mob.e); if (v) orderVendor(c, v); }
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
  if (!img) { ctx.fillStyle = '#9a8f77'; ctx.font = '16px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Loading map ...', G.cw / 2, G.ch / 2); ctx.textAlign = 'start'; }
  if (m.world) { drawNavOverlay(ctx); return; }
  if ($('showterrain') && $('showterrain').checked) drawTerrain(ctx, m);
  drawNavOverlay(ctx);
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
      if (mob.st === 'dead') {
        if (G.gameTime - mob.deadAt < CORPSE_SHOW) { ctx.strokeStyle = '#8a8f9c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); }
        continue;
      }
      ctx.fillStyle = BEH_COLORS[mob.beh] || '#888'; ctx.globalAlpha = mob.st === 'chase' ? 1 : .85;
      ctx.beginPath(); ctx.arc(x, y, mob.st === 'chase' ? r + 1.5 : r, 0, 6.3); ctx.fill();
      if (mob.st === 'chase' || (mob.hp < mob.maxhp && mob.st !== 'alive')) {
        ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(x - 10, y - r - 7, 20, 4); ctx.fillStyle = '#e0453a'; ctx.fillRect(x - 10, y - r - 7, 20 * Math.max(0, mob.hp / mob.maxhp), 4);
        if (mob.auras) { let k = 0; for (const a of mob.auras) if (a.until > G.gameTime) { ctx.fillStyle = a.au === 3 ? '#ff9a3c' : a.au === 12 || a.au === 7 ? '#ffffff' : '#a07cff'; ctx.fillRect(x - 10 + k * 5, y - r - 12, 4, 4); k++; } }
        if (mob.fleeing) { ctx.fillStyle = '#ffb36b'; ctx.font = '10px Segoe UI'; ctx.fillText('flee', x + 6, y + 3); }
      }
    }
    ctx.globalAlpha = 1;
  }
  // graveyards / flight masters
  ctx.font = '11px Segoe UI';
  for (const gy of G.d.graveyards) {
    if (m.cont || gy[2] !== m.map || !inMap(m, gy[3], gy[4])) continue;
    const [x, y] = w2s(gy[3], gy[4]);
    ctx.fillStyle = '#cfd6e6'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.stroke(); ctx.fill();
  }
  for (const id in G.d.taxi.nodes) {
    const n = G.d.taxi.nodes[id];
    if (m.cont || n.map !== m.map || !inMap(m, n.x, n.y) || !n.npcs.length) continue;
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
  // quest marks
  if (G.qMarks && !m.cont) {
    ctx.font = 'bold 16px Georgia'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
    for (const q of G.qMarks) { if (q.map !== m.map) continue; const [x, y] = w2s(q.x, q.y); if (x < -9 || y < -9 || x > G.cw + 9 || y > G.ch + 9) continue; ctx.fillStyle = q.t === '?' ? '#ffd23a' : '#ffe14d'; ctx.strokeText(q.t, x, y - 6); ctx.fillText(q.t, x, y - 6); }
    ctx.textAlign = 'start';
  }
  // the character
  if (c.pos.map === m.map && inMap(m, c.pos.x, c.pos.y)) {
    const [x, y] = w2s(c.pos.x, c.pos.y);
    ctx.save(); ctx.translate(x, y);
    if (rt(c).ghost) ctx.globalAlpha = .55;
    ctx.fillStyle = rt(c).ghost ? '#8fd0ff' : '#c0662a'; ctx.strokeStyle = '#fff3d0'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.3); ctx.fill(); ctx.stroke();
    // facing arrow: o is the angle from north (x axis) towards west (y axis); screen east = -y
    const ang = Math.atan2(-Math.sin(c.pos.o), -Math.cos(c.pos.o));
    const dx = -Math.sin(c.pos.o), dy = -Math.cos(c.pos.o);
    ctx.fillStyle = '#fff3d0'; ctx.beginPath(); ctx.moveTo(dx * 14, dy * 14); ctx.lineTo(dx * 7 - dy * 4, dy * 7 + dx * 4); ctx.lineTo(dx * 7 + dy * 4, dy * 7 - dx * 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffe9a8';
    ctx.strokeText(c.name, x, y - 22); ctx.fillText(c.name, x, y - 22); ctx.textAlign = 'start';
    const hm = charStats(c).maxHp; ctx.fillStyle = '#000'; ctx.fillRect(x - 14, y - 18, 28, 5); ctx.fillStyle = '#3fae5a'; ctx.fillRect(x - 14, y - 18, 28 * Math.max(0, c.hp / hm), 5);
  }
  if (c.pos.map === m.map && inMap(m, c.pos.x, c.pos.y)) {
    const [x, y] = w2s(c.pos.x, c.pos.y); const r = rt(c);
    if (r.interact) { const p = Math.min(1, r.interact.t / r.interact.dur); ctx.fillStyle = '#000'; ctx.fillRect(x - 30, y + 12, 60, 6); ctx.fillStyle = '#e8c46a'; ctx.fillRect(x - 30, y + 12, 60 * p, 6); ctx.font = '11px Segoe UI'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.strokeText(r.interact.label, x, y + 30); ctx.fillText(r.interact.label, x, y + 30); ctx.textAlign = 'start'; }
    else if (r.resting) { ctx.font = 'bold 12px Segoe UI'; ctx.fillStyle = r.eating ? '#9fe0a0' : '#9fc7ff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; const t = r.eating ? 'eating' : 'Zz'; ctx.strokeText(t, x + 10, y - 8); ctx.fillText(t, x + 10, y - 8); }
  }
  const ghost = rt(c).ghost;
  if (ghost && ghost.corpse.map === m.map) {
    const [cx, cy] = w2s(ghost.corpse.x, ghost.corpse.y); ctx.strokeStyle = '#8fd0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 6.3); ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5); ctx.stroke();
  }
  ctx.font = 'bold 13px Segoe UI'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
  for (const f of G.fx) {
    const [fx_, fy_] = w2s(f.x, f.y); const yy = fy_ - 26 - f.t * 28; ctx.globalAlpha = Math.max(0, 1 - f.t / 1.2);
    ctx.fillStyle = f.color; ctx.strokeText(f.text, fx_, yy); ctx.fillText(f.text, fx_, yy);
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'start';
}
/* red tint over ground the characters cannot walk on (from the collision grid) */
function drawTerrain(ctx, m) {
  const g = typeof gridOf === 'function' ? gridOf(m.map) : null; if (!g) return;
  G.terrainImg = G.terrainImg || {};
  let t = G.terrainImg[m.name];
  if (!t) {
    const cs = g.cell * COARSE;
    const C0 = Math.max(0, Math.floor((g.origin - m.yl) / cs)), C1 = Math.min(g.cw - 1, Math.ceil((g.origin - m.yr) / cs));
    const R0 = Math.max(0, Math.floor((g.origin - m.xt) / cs)), R1 = Math.min(g.ch - 1, Math.ceil((g.origin - m.xb) / cs));
    const w = C1 - C0 + 1, h = R1 - R0 + 1; const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); const im = cx.createImageData(w, h);
    for (let R = 0; R < h; R++) for (let C = 0; C < w; C++) {
      const k = g.coarse[(R + R0) * g.cw + C + C0]; const p = (R * w + C) * 4;
      if (k === 0) { im.data[p] = 255; im.data[p + 1] = 40; im.data[p + 2] = 40; im.data[p + 3] = 110; }
      else if (k === 2) { im.data[p] = 40; im.data[p + 1] = 120; im.data[p + 2] = 255; im.data[p + 3] = 70; }
    }
    cx.putImageData(im, 0, 0);
    t = G.terrainImg[m.name] = { cv, x0: g.origin - R0 * cs, y0: g.origin - C0 * cs, x1: g.origin - (R1 + 1) * cs, y1: g.origin - (C1 + 1) * cs };
  }
  const [ax, ay] = w2s(t.x0, t.y0), [bx, by] = w2s(t.x1, t.y1);
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(t.cv, ax, ay, bx - ax, by - ay); ctx.restore();
}
function resize() {
  const wrap = $('mapwrap'); const dpr = window.devicePixelRatio || 1;
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (cw === G.cw && ch === G.ch && dpr === G.dpr) return;
  const first = !G.cw; const ocx = G.cw / 2, ocy = G.ch / 2;
  G.dpr = dpr; G.cw = cw; G.ch = ch;
  const cv = $('map'); cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  if (G.map) { if (first) fitMap(); else { G.ox += cw / 2 - ocx; G.oy += ch / 2 - ocy; } }
}

/* ------------------------------------------------------------------ input */
function bindInput() {
  const cv = $('map');
  const ptrs = new Map(); let pinch = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ptrs.set(e.pointerId, { x, y });
    if (ptrs.size === 2) {
      const [p1, p2] = [...ptrs.values()]; pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), s: G.scale, cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2, ox: G.ox, oy: G.oy }; G.drag = null; return;
    }
    G.drag = { x, y, ox: G.ox, oy: G.oy, moved: false, touch: e.pointerType === 'touch' }; hideMenu();
  });
  cv.addEventListener('pointerup', (e) => {
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; G.drag = null; return; }
    const d = G.drag; G.drag = null; if (!d || d.moved) return;
    const [sx, sy] = pos(e);
    if (e.button === 2) return;
    if (G.map.world || G.map.cont) { const h = navHit(sx, sy); if (h && h.def) { const w = s2w(sx, sy); setMap(h.def); } return; }
    const hit = pickAt(sx, sy, d.touch ? 18 : 8);
    const w = s2w(sx, sy);
    const sel = hit || { kind: 'ground', x: w.x, y: w.y };
    if (!hit && !inMap(G.map, w.x, w.y)) return;
    G.selected = sel; renderInfo(sel); showMenu(sx, sy, sel);
  });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); hideMenu(); goUp(); });
  cv.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); pinch = null; G.drag = null; });
  cv.addEventListener('pointermove', (e) => {
    const [sx, sy] = pos(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: sx, y: sy });
    if (pinch && ptrs.size >= 2) {
      const [p1, p2] = [...ptrs.values()]; const dd = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const [W, H] = mapSize(G.map); const minS = Math.min(G.cw / W, G.ch / H) * 0.8;
      const ns = Math.max(minS, Math.min(12, pinch.s * dd / Math.max(1, pinch.d))); const k = ns / pinch.s;
      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      G.ox = cx - (pinch.cx - pinch.ox) * k; G.oy = cy - (pinch.cy - pinch.oy) * k; G.scale = ns; $('follow').checked = false; return;
    }
    if (G.drag) {
      if (Math.abs(sx - G.drag.x) + Math.abs(sy - G.drag.y) > (G.drag.touch ? 10 : 5)) G.drag.moved = true;
      if (G.drag.moved) { G.ox = G.drag.ox + sx - G.drag.x; G.oy = G.drag.oy + sy - G.drag.y; $('follow').checked = false; }
    }
    if (e.pointerType === 'touch') return;
    if (G.map.world || G.map.cont) {
      G.navHover = G.drag && G.drag.moved ? null : navHit(sx, sy); const tip = $('tip');
      if (G.navHover) { tip.innerHTML = navTip(G.navHover); tip.hidden = false; tip.style.left = (sx + 14) + 'px'; tip.style.top = (sy + 14) + 'px'; cv.style.cursor = G.navHover.def ? 'pointer' : 'default'; }
      else { tip.hidden = true; cv.style.cursor = 'default'; }
      return;
    }
    const w = s2w(sx, sy);
    if (inMap(G.map, w.x, w.y)) { const [a, b] = mapCoords(G.map, w.x, w.y); $('coords').textContent = a + ', ' + b; } else $('coords').textContent = '';
    const hit = G.drag && G.drag.moved ? null : pickAt(sx, sy); const tip = $('tip');
    if (hit) {
      let t = '';
      if (hit.kind === 'mob') { const i = hit.mob.info; t = '<b>' + esc(i ? i[1] : 'Creature') + '</b><br><span style="color:' + (i ? levelColor(hit.mob.lvl || i[3], active().level) : '#fff') + '">Level ' + (hit.mob.lvl || '?') + '</span> ' + (RANK_NAMES[i ? i[4] : 0] || '') + '<br><span style="color:' + BEH_COLORS[hit.mob.beh] + '">' + BEH_NAMES[hit.mob.beh] + '</span>'; }
      else if (hit.kind === 'grave') t = '<b>' + esc(hit.g[1]) + '</b><br>Graveyard';
      else t = '<b>' + esc(hit.n.n) + '</b><br>Flight master';
      tip.innerHTML = t; tip.hidden = false; tip.style.left = (sx + 14) + 'px'; tip.style.top = (sy + 14) + 'px'; cv.style.cursor = 'pointer';
    } else { tip.hidden = true; cv.style.cursor = G.drag && G.drag.moved ? 'grabbing' : 'crosshair'; }
  });
  cv.addEventListener('mouseleave', () => { $('tip').hidden = true; });
  cv.style.touchAction = 'none';
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [W] = mapSize(G.map); const minS = Math.min(G.cw / W, G.ch / mapSize(G.map)[1]) * 0.8;
    const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; const ns = Math.max(minS, Math.min(12, G.scale * f));
    const k = ns / G.scale; G.ox = e.offsetX - (e.offsetX - G.ox) * k; G.oy = e.offsetY - (e.offsetY - G.oy) * k; G.scale = ns;
  }, { passive: false });
  $('mnav').addEventListener('click', (e) => {
    const p = e.target.dataset && e.target.dataset.p; if (!p) return;
    if (p === 'sheet') { openSheet('char'); return; }
    document.body.classList.toggle('show-left', p === 'left'); document.body.classList.toggle('show-right', p === 'right');
    $('mnav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
    if (p === 'map') setTimeout(resize, 0);
  });
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
    while (G.acc >= STEP) { G.acc -= STEP; G.gameTime += STEP; for (const c of G.state.characters) updateChar(c, STEP); worldTick(STEP); }
    for (const f of G.fx) f.t += dt * sp; G.fx = G.fx.filter((f) => f.t < 1.2);
  }
  const c = active();
  if (ts - (G.followT || 0) > 500) { G.followT = ts; followZone(c); if (!$('maptabs').matches(':hover')) renderNav(); }
  if ($('follow').checked && c.pos.map === G.map.map && !G.map.world) { const [px, py] = w2m(G.map, c.pos.x, c.pos.y); G.ox = G.cw / 2 - px * G.scale; G.oy = G.ch / 2 - py * G.scale; }
  draw();
  if (ts - (G.saveT || 0) > 30000) { G.saveT = ts; save(); }
  if (ts - G.uiT > 250) {
    G.uiT = ts; renderChar(); renderAbar(); if (c.order) renderOrder();
    if (!G.qT || ts - G.qT > 1500) { G.qT = ts; if (!$('questCard').matches(':hover')) renderQuests(); }
    if (G.selected && G.selected.kind === 'mob') renderInfo(G.selected);
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------- boot */
async function boot() {
  try {
    loadMsg('game data ...');
    const names = ['races', 'hostility', 'spawns', 'xp', 'taxi', 'navgraph', 'items', 'spells', 'quests', 'vendors', 'loot'];
    const res = await Promise.all(names.map((n) => J('../gamedata/' + n + '.json')));
    names.forEach((n, i) => { G.d[n] = res[i]; });
    try { G.d.cstats = await J('../gamedata/creature_stats.json'); } catch (e) { G.d.cstats = null; console.warn('creature_stats.json not found - using estimated creature health and damage'); }
    try { G.d.vendorItems = await J('../gamedata/vendor_items.json'); } catch (e) { G.d.vendorItems = null; }
    try { G.d.objects = await J('../gamedata/objects.json'); } catch (e) { G.d.objects = null; }
    try { G.d.talents = await J('../gamedata/talents.json'); } catch (e) { G.d.talents = null; console.warn('talents.json not found - no talents'); }
    try { G.d.go = await J('../gamedata/go_data.json'); } catch (e) { G.d.go = null; console.warn('go_data.json not found - quests with objects are not automated (run: py build_gamedata.py goquest)'); }
    G.d.graveyards = DATA.graveyards;
    G.spawnList = Object.entries(G.d.spawns.spawns).map(([e, l]) => [+e, l]);
    G.spawnMap = new Map(G.spawnList);
    for (const m of DATA.mobs) G.mobIdx[m[0]] = m;
    G.nav = makeNav(G.d.navgraph);
    loadMsg('quest index ...'); buildQuestIndex();

    loadMsg('maps ...');
    let manifest = null; try { manifest = await J('../files.json'); } catch (e) { manifest = null; }
    const files = manifest ? manifest.maps : await listDir('../maps/', '.png');
    const has = (f) => !files.length || files.includes(f.split('/').pop());
    G.maps = DATA.maps.filter((m) => has(m.file) && (m.map === 0 || m.map === 1));
    if (has(WORLD_MAP.file) && files.length) G.maps.push(WORLD_MAP);
    if (!G.maps.length) throw new Error('no map images found in the maps folder');
    loadMsg('zones ...');
    try { G.d.zoneLevels = await J('../gamedata/zone_levels.json'); } catch (e) { G.d.zoneLevels = null; }
    await loadZoneMaps();

    loadMsg('portraits ...');
    for (const f of (manifest ? manifest.portraits : await listDir('../portraits/by_name/', '.png'))) { const m = /^(\d+)_/.exec(f); if (m) G.portraits[+m[1]] = f; }

    G.state = loadSave();
    if (!G.state || !G.state.characters || !G.state.characters.length) {
      const c = newCharacter('Throg', 2, 1);
      G.state = { version: 1, activeId: c.id, characters: [c], settings: { speed: 1, autoSellJunk: true, autoEquip: true, chainQuests: true } };
      save();
    }
    G.gameTime = G.state.gameTime || 0;
    G.state.characters.forEach(migrate);
    for (const [k, v] of [['autoEquip', true], ['autoSellJunk', true], ['autoBuyBags', true], ['sellWhiteGear', true], ['chainQuests', true], ['autoEat', true], ['autoPotion', true], ['autoRepair', true]]) if (G.state.settings[k] === undefined) G.state.settings[k] = v;
    bindInput(); resize(); try { new ResizeObserver(() => resize()).observe($('mapwrap')); } catch (e) { /* old browser */ }
    const c = active();
    goToCharacter();
    loadGrid(c.pos.map);
    setSpeed(G.state.settings.speed === undefined ? 1 : G.state.settings.speed);
    renderChar(); renderOrder(); renderInfo(null); renderGearCard(); renderQuests(); bindSheet();
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
document.addEventListener('visibilitychange', () => { if (G.state && document.hidden) save(); });
window.addEventListener('pagehide', () => { if (G.state) save(); });
if ('serviceWorker' in navigator && location.protocol === 'https:' && !/AzerothApp/.test(navigator.userAgent)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e)); });
}
