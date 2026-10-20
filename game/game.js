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
const IS_APP = /AzerothApp/.test(navigator.userAgent);          // the Android app: light world, phone controls, the lighter map drawing
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
/* the log: one per character (the one being simulated right now - G.logCtx - or the one you play) */
function log(msg) {
  const c = G.logCtx || (G.state && G.state.activeId ? active() : null);
  // the items named in it (made by itemName just before): links in the rarity's colour, click for the tooltip
  let links = null;
  if (G.inames && G.inames.size) { msg = String(msg); for (const [nm, rec] of G.inames) if (nm.length > 2 && msg.indexOf(nm) >= 0) (links = links || []).push([nm, rec.id, rec.inst || null]); G.inames.clear(); }
  if (c) { G.logs = G.logs || {}; const L = (G.logs[c.id] = G.logs[c.id] || []); L.unshift([G.gameTime, msg, links]); if (L.length > 80) L.length = 80; if (!isActive(c)) return; }
  const el = $('log'); if (!el) return; const d = document.createElement('div');
  d.innerHTML = '<span class="t">' + fmtTime(G.gameTime) + '</span> ' + logMsgHtml(msg, links); d._links = links;
  el.prepend(d); while (el.children.length > 80) el.removeChild(el.lastChild);
}
function logMsgHtml(msg, links) {
  let h = esc(msg); if (!links || !links.length) return h;
  const order = links.map((l, i) => i).sort((a, b) => links[b][0].length - links[a][0].length);
  for (const i of order) h = h.split(esc(links[i][0])).join('\u0001' + i + '\u0002');            // longest names first, then the shorter ones cannot hit inside them
  return h.replace(/\u0001(\d+)\u0002/g, (_, i) => { const [nm, id] = links[+i]; return '<span class="ilog" data-ilog="' + i + '" style="color:' + (QUALITY_COLORS[itemQuality(id)] || '#fff') + '">[' + esc(nm) + ']</span>'; });
}
function renderLog() {
  const el = $('log'); const c = active(); if (!el || !c) return;
  const L = (G.logs && G.logs[c.id]) || [];
  el.innerHTML = L.map(([t, m, links]) => '<div><span class="t">' + fmtTime(t) + '</span> ' + logMsgHtml(m, links) + '</div>').join('');
  [...el.children].forEach((d, i) => { d._links = L[i] && L[i][2]; });
}
/* clicking an item in the log: its tooltip (another click anywhere closes it) */
function bindLogLinks() {
  const el = $('log'); if (!el || el._bound) return; el._bound = true;
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-ilog]'); if (!s) return; const row = s.closest('#log > div'); const l = row && row._links && row._links[+s.dataset.ilog]; if (!l) return;
    e.stopPropagation(); showItemTip(e, { inst: l[2] || { id: l[1], n: 1 }, where: 'info' }); G.logTip = true;
  });
  document.addEventListener('click', (e) => { if (G.logTip && !e.target.closest('[data-ilog]')) { G.logTip = false; hideItemTip(); } });
}
function isActive(c) { return !!(c && G.state && c.id === G.state.activeId); }
/* the characters in the world right now: the one you play and the ones set to keep playing (Go) */
function liveChars() {
  const me = active(); const out = G.state.characters.filter((c) => c === me || c.bg);
  // a group is in the world together when one of them is
  for (const g of G.state.groups || []) if (g.members.length > 1 && g.members.some((m) => out.some((c) => c.id === m.id))) for (const m of g.members) { const c = G.state.characters.find((x) => x.id === m.id); if (c && !out.includes(c)) out.push(c); }
  return out;
}
function switchCharacter(id) {
  if (!G.state.characters.some((c) => c.id === id) || id === G.state.activeId) return;
  save(); G.state.activeId = id; const c = active();
  G.selected = null; if (SH.open) closeSheet(); hideMenu(); if (G.routeEdit) { G.routeEdit = null; if (typeof renderRouteBar === 'function') renderRouteBar(); }
  const uf = $('unitframes'); if (uf) uf._w = 0;
  ensureWorld(c.pos.map); loadGrid(c.pos.map); goToCharacter();
  renderLog(); bindLogLinks(); renderChar(); renderOrder(); renderInfo(null); renderGearCard(); renderQuests(); renderSettingsCard(); renderAbar(); renderGroup();
  if (typeof meterReset === 'function') meterReset();
  log('Now playing ' + c.name + (c.order ? ' (' + orderText(c).t + ')' : '') + '.'); save(); renderCharSwitch();
}
function levelColor(mob, lvl) {
  const diff = mob - lvl;
  if (diff >= 5) return '#ff3b30';
  if (diff >= 3) return '#ff8c1a';
  if (diff >= -2) return '#ffe14d';
  if (diff >= -(lvl < 6 ? 3 : lvl < 40 ? 5 + Math.floor((lvl - 6) / 5) * 0 : 9)) return '#4fc26b';
  return '#9a9a9a';
}
/* the version of the game files (shown in the log at the start: after an update it must be the new one) */
const GAME_VERSION = '2026-10-21 k (phone changes only in the Android app)';
/* data files: always asked fresh from the server (no old copies from the browser cache after an update) */
async function J(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}
async function listDir(url, ext) {
  try {
    const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) return [];
    const html = await r.text(); const out = [];
    const re = /href="([^"]+)"/g; let m;
    while ((m = re.exec(html))) { const n = decodeURIComponent(m[1]); if (n.toLowerCase().endsWith(ext)) out.push(n.split('/').pop()); }
    return out;
  } catch (e) { return []; }
}
/* class icons (game/img/class/<class>.png) and the dragon borders of elite and rare creatures, drawn on the map */
const MAP_SPR = {};
function mapSprite(src) { if (!(src in MAP_SPR)) { MAP_SPR[src] = null; const im = new Image(); im.onload = () => { MAP_SPR[src] = im; }; im.src = src; } return MAP_SPR[src]; }
/* a picture made at the exact size it is drawn at (in screen pixels), once: drawing the big picture smaller every frame
   for every creature on the screen was slow on phones */
const SPR_SIZED = new Map();
function spriteSized(im, key, w, h, round) {
  if (!IS_APP) return im;          // the browser draws the picture itself
  const dpr = G.dpr || 1; const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr)); const k = key + '|' + pw + 'x' + ph + (round ? 'o' : '');
  let cv = SPR_SIZED.get(k);
  if (!cv) {
    if (SPR_SIZED.size > 400) SPR_SIZED.clear();
    cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const x = cv.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    if (round) { x.beginPath(); x.arc(pw / 2, ph / 2, Math.min(pw, ph) / 2, 0, 6.3); x.clip(); }
    x.drawImage(im, 0, 0, pw, ph); SPR_SIZED.set(k, cv);
  }
  return cv;
}
/* a picture laid over the map (dx, dy, dw, dh: where all of it would be): only the part on the screen is drawn */
function drawOnScreen(ctx, im, dx, dy, dw, dh) {
  if (!IS_APP) { ctx.drawImage(im, dx, dy, dw, dh); return; }
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height; if (!iw || !ih || !dw || !dh) return;
  let x0 = Math.max(dx, 0), y0 = Math.max(dy, 0), x1 = Math.min(dx + dw, G.cw), y1 = Math.min(dy + dh, G.ch);
  if (dw < 0 || dh < 0) { ctx.drawImage(im, dx, dy, dw, dh); return; }
  if (x1 <= x0 || y1 <= y0) return;
  const kx = iw / dw, ky = ih / dh;
  // whole source pixels (no smoothing: the edges stay where they are)
  let sx = Math.floor((x0 - dx) * kx), sy = Math.floor((y0 - dy) * ky), ex = Math.min(iw, Math.ceil((x1 - dx) * kx)), ey = Math.min(ih, Math.ceil((y1 - dy) * ky));
  ctx.drawImage(im, sx, sy, ex - sx, ey - sy, dx + sx / kx, dy + sy / ky, (ex - sx) / kx, (ey - sy) / ky);
}
function drawClassIcon(ctx, cls, x, y, rad) {
  const src = 'img/class/' + cls + '.png'; const im = mapSprite(src); if (!im) return false;
  ctx.drawImage(spriteSized(im, src, rad * 2, rad * 2), x - rad, y - rad, rad * 2, rad * 2); return true;
}
/* rank 1 elite, 2 rare elite, 3 boss, 4 rare (not friendly ones): a gold / silver ring around the dot, and the dragon of
   the target frame around it when the map is zoomed in enough to see it */
function drawRankRing(ctx, rank, x, y, r) {
  const silver = rank === 2 || rank === 4; const col = silver ? '#e4e8f0' : '#ffc93a';
  const im = r >= 3.5 ? mapSprite('img/' + (silver ? 'rare' : 'elite') + '_ring.png') : null;
  if (im) { const k = (r + 2.5) / 24; ctx.drawImage(spriteSized(im, silver ? 'rare' : 'elite', im.width * k, im.height * k), x - 51 * k, y - 44.5 * k, im.width * k, im.height * k); }
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 6.3); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 6.3); ctx.stroke();
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
  G.scale = G.ch > G.cw * 1.15 && !G.map.dmap ? Math.max(G.cw / W, G.ch / H) * 0.9 : Math.min(G.cw / W, G.ch / H);
  G.ox = (G.cw - W * G.scale) / 2; G.oy = (G.ch - H * G.scale) / 2;
}
function bestMapFor(pos) {
  if (typeof dungeonMapAt === 'function') { const dm = dungeonMapAt(pos); if (dm) return dm; }
  let best = null;
  for (const m of G.maps) {
    if (m.map !== pos.map || !inMap(m, pos.x, pos.y)) continue;
    if (!best || (m.xt - m.xb) * (m.yl - m.yr) < (best.xt - best.xb) * (best.yl - best.yr)) best = m;
  }
  return best || G.maps[0];
}
/* high resolution terrain maps: maps_hd/<same name>.jpg (made by script/make_hd_maps.py) cover exactly the same world
   area as maps/<name>.png and are drawn 1:1 over it. maps_hd/index.json lists them.
   Optional maps_hd/hd_maps.json: { "Durotar": { "crop": [x, y, w, h] } } for a hand-made picture that shows more. */
const HD_EXT = ['.jpg', '.png', '.webp'];
function hdOn() { return G.state && G.state.settings.hdMaps !== false; }
function loadHd(m) {
  G.imgHd = G.imgHd || {};
  if (m.name in G.imgHd || m.world) return;
  G.imgHd[m.name] = null;
  const base = '../maps_hd/' + encodeURIComponent(m.file.split('/').pop().replace(/\.[a-z]+$/i, ''));
  const tryExt = (i) => { if (i >= HD_EXT.length) return; loadImage(base + HD_EXT[i]).then((img) => { if (img) { G.imgHd[m.name] = img; G.hdAny = true; renderHdToggle(); } else tryExt(i + 1); }); };
  const stem = m.file.split('/').pop().replace(/\.[a-z]+$/i, '');
  if (G.hdList) { const f = G.hdList.find((x) => x.replace(/\.[a-z]+$/i, '') === stem); if (!f) return; loadImage('../maps_hd/' + encodeURIComponent(f)).then((img) => { if (img) { G.imgHd[m.name] = img; G.hdAny = true; } renderHdToggle(); }); return; }
  tryExt(0);
}
function renderHdToggle() {
  const b = $('hdmaps'); if (!b) return;
  const has = !!(G.imgHd && G.map && G.imgHd[G.map.name]);
  b.classList.toggle('on', hdOn()); b.classList.toggle('dim', !has);
  b.textContent = 'HD map';
  b.title = has ? 'High resolution terrain map over the normal one (same place, 1:1). Click to switch.' : 'No high resolution picture for this map (maps_hd folder).';
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
  if (hdOn()) loadHd(m);
  renderHdToggle();
  renderNav();
}

/* ------------------------------------------------------------------ mobs */
function buildMobsForMap() {
  const m = G.map; const c = active ? active() : null; const out = [];
  const W = ensureWorld(m.map);
  for (const mob of W.list) {
    if (!inMap(m, mob.hx, mob.hy)) continue;
    if (m.dmap && !mobOnFloor(mob, m)) continue;
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
    if (d < bd) { bd = d; best = { kind: 'taxi', n, id: +id }; }
  }
  return best;
}

/* ------------------------------------------------------------- characters */
function newCharacter(name, race, cls, gender) {
  const st = G.d.races.start[race + '_' + cls];
  const gear = startGear(race, cls);
  return {
    id: 'c' + Date.now(), name, race, cls, gender: gender || 0, level: 1, xp: 0, gold: 0,
    pos: { map: st.map, x: st.x, y: st.y, z: st.z, o: st.o }, hp: null, rage: 0, mana: null, energy: 100, form: null,
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
  if (!TALENT_BUILDS[c.cls] || !TALENT_BUILDS[c.cls][c.cfg.talentBuild]) c.cfg.talentBuild = Object.keys(TALENT_BUILDS[c.cls] || { none: 1 })[0];
  if (c.energy == null) c.energy = 100; if (c.form === undefined) c.form = null; if (c.rage == null) c.rage = 0;
  if (c.resume && !c.order) { c.order = c.resume; c.hp = null; } delete c.resume;      // was dead when the game closed
  if (G.state && G.state.settings) { if (G.state.settings.autoEat === false) c.cfg.eatAt = 0; if (G.state.settings.autoPotion === false) c.cfg.potionAt = 0; }
  learnAbilities(c, !c._new); delete c._new;
  if (c.cfg.autoTalents !== false && talentFree(c) > 0) autoTalents(c, true);
  dirty(c);
  if (c.mana == null || c.mana > (charStats(c).maxMana || 0)) c.mana = charStats(c).maxMana || 0;
  if (typeof hearthInit === 'function' && G.spawnMap) hearthInit(c);          // the Hearthstone and the home inn
  if (typeof repInit === 'function') repInit(c);
  if (!c.cfg.tac) c.cfg.tac = { preset: 'auto', custom: {}, on: true };          // tactics (tactics.js): the default preset                              // reputation (the finished quests count for old characters)
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
  if (G.state) { G.state.gameTime = G.gameTime; G.state.lastReal = Date.now(); }       // lastReal: when the game was last running (away.js)       // order timers are in game time: keep the clock across sessions
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
  if (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map)) return dungeonPath(c, from, Object.assign({}, to, { z: target.z }));
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
  // somewhere on another map (another continent, or out of a dungeon): the way out first, then ships, zeppelins and flights
  if (target.map != null && target.map !== c.pos.map) {
    const inDg = typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map);
    c.order = { type: 'travel', label: label || 'a point', target: { x: target.x, y: target.y, map: target.map }, cross: true, path: [], idx: 1, total: 0, done: 0, via: inDg ? 'out of the dungeon first' : 'ships and flights' };
    if (!inDg) { const t = planTrip(c, c.order.target); if (!t) { c.order = null; log('No way to ' + (label || 'there') + ' found.'); renderOrder(); return; } c.order.trip = t; }
    log('Order: travel to ' + c.order.label + ' (' + c.order.via + ').'); rt(c).mv = null; save(); renderOrder(); return;
  }
  const p = planPath(c, target);
  // far on the same continent: a flight (or a boat) when it is clearly quicker than walking
  if (p.total > 600 && !(typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map))) {
    const t = planTrip(c, { map: c.pos.map, x: target.x, y: target.y });
    if (t && t.legs.some((l) => l.kind !== 'walk') && t.secs < p.total / RUN_SPEED * 0.8) {
      c.order = { type: 'travel', label: label || 'a point', target: { x: target.x, y: target.y, map: c.pos.map }, cross: true, trip: t, path: [], idx: 1, total: 0, done: 0, via: 'flight' };
      log('Order: travel to ' + c.order.label + ': ' + t.legs.map((l) => l.kind === 'walk' ? 'walk' : l.kind === 'fly' ? 'fly to ' + G.d.taxi.nodes[l.to].n : TRANSPORTS[l.t].name).join(', ') + ' (about ' + fmtTime(t.secs) + ').');
      rt(c).mv = null; save(); renderOrder(); return;
    }
  }
  c.order = { type: 'travel', label: label || 'a point', target: { x: target.x, y: target.y }, path: p.pts, idx: 1, total: p.total, done: 0, via: p.via };
  log('Order: travel to ' + c.order.label + ' (' + Math.round(p.total) + ' yd, ' + fmtTime(p.total / c.speed / Math.max(1, G.state.settings.speed || 1)) + ', ' + p.via + ').');
  save(); renderOrder();
}
/* Stop: the order and everything going on or waiting (casting, crafting, disenchanting, eating, resting, taming, the order
   to come back to); the idle automations (farming when idle, looking for a pet) wait 10 minutes */
function stopOrder(c) {
  const r = rt(c); const busy = !!(c.order || r.cast || r.craftQ || (r.deQueue && r.deQueue.length) || r.eating || r.drinking || r.resting || r.interact || r.tame || r.bandage);
  c.order = null; delete c.resume; r.saved = null;
  r.mv = null; r.tgt = null; r.resting = false; r.restFull = false; r.eating = null; r.drinking = null; r.bandage = null; r.interact = null; r.tame = null; r.queued = null; r.petGo = null;
  if (r.cast && !r.flying && !r.riding) r.cast = null;
  if (r.craftQ && typeof craftFinish === 'function') craftFinish(c);
  if (r.deQueue) r.deQueue = [];
  r.idleUntil = G.gameTime + 600;
  if (busy) log('Stopped - everything cancelled.');
  save(); renderOrder(); if (typeof SH !== 'undefined' && SH.open) renderSheet();
}
/* --------------------------------------------------------------------- UI */
function renderChar() {
  /* the left card holds only the unit frames (the character and what it fights); stats and money are in the character window */
  const c = active(); const s = charStats(c);
  if (c.hp == null || c.hp > s.maxHp) c.hp = s.maxHp;
  if (!$('unitframes')) $('charCard').innerHTML = '<div id="unitframes"></div>';
  renderUnitFrames();
}
/* ------------------------------------------------------------------ fold-away cards (right panel) */
function cardOpen(id, def) { const o = G.state.settings.cardOpen || {}; return id in o ? o[id] : def; }
function cardHead(id, title, def) { const on = cardOpen(id, def); return '<h3 class="ch" data-card="' + id + '"><span class="carr">' + (on ? '&#9662;' : '&#9656;') + '</span> ' + title + '</h3>'; }
function bindCards() {
  $('right').addEventListener('click', (e) => {
    const h = e.target.closest('[data-card]'); if (!h) return;
    const id = h.dataset.card; const o = G.state.settings.cardOpen = G.state.settings.cardOpen || {};
    o[id] = !cardOpen(id, (h.closest('.card') || {}).dataset ? h.closest('.card').dataset.def !== '0' : true); save();
    if (id === 'quests' || id === 'qact' || id === 'qnear') renderQuests(); else if (id === 'auto') renderSettingsCard(); else if (id === 'dgctl') renderDgCard(); else renderGearCard();
  });
}
/* the automatic behaviour, in groups (what the character does by itself) - each character has its own (c.auto);
   characters that never changed one use the old shared setting */
function cset(c, k) { return c && c.auto && k in c.auto ? c.auto[k] : G.state.settings[k]; }
const AUTO_GROUPS = [
  ['Selling and junk', [['autoSellJunk', 'Sell junk (grey and vendor trash) when near a vendor, and when the bags are full'], ['sellWhiteGear', 'Count white gear that is no upgrade as junk']]],
  ['Quests', [['chainQuests', 'After a single quest, continue with the next one'], ['dungeonQuests', 'Leveling and auto-quest do dungeon quests too', true], ['dungeonSolo', 'Do dungeon quests alone (no group)'], ['groupQuests', 'Do group quests (elites out in the world) with a hired group', true]]],
  ['Gear', [['autoEquip', 'Equip upgrades by itself'], ['autoBuyBags', 'Buy bags at vendors when there is a free bag slot'], ['autoRepair', 'Repair at vendors by itself'], ['autoDisenchant', 'Enchanters: disenchant green gear that is no upgrade (instead of selling it)']]],
  ['Fighting', [['rogueStealth', 'Rogues: slip into Stealth when not fighting (creatures rarely notice them)', true]]],
  ['Away', [['offlineProgress', 'Offline progress: keeps playing while the game is closed - up to 2 hours, the first 30 minutes in full, the rest at half rate; no dungeons', true]]],
];
function renderSettingsCard() {
  const el = $('setCard'); if (!el) return; const c = active(); const on = cardOpen('auto', false);
  let h = cardHead('auto', 'Automation <span class="small muted">(' + esc(c.name) + ')</span>', false);
  if (on) {
    for (const [title, list] of AUTO_GROUPS) {
      h += '<div class="aset"><h5>' + title + '</h5>' + list.map(([k, t, defTrue]) => '<label class="chk"><input type="checkbox" data-aset="' + k + '"' + ((defTrue ? cset(c, k) !== false : cset(c, k)) ? ' checked' : '') + '> ' + t + '</label>').join('') + '</div>';
    }
    if (typeof farmCardHtml === 'function') h += farmCardHtml(c);
    h += '<div class="small muted">Resting, food, potions, playstyle and abilities: <a href="#" data-abeh="1">Behaviour</a></div>';
  }
  el.innerHTML = h; el.dataset.def = '0';
  el.onchange = (e) => { if (typeof farmCardChange === 'function' && farmCardChange(e)) return; const k = e.target.dataset && e.target.dataset.aset; if (!k) return; const a = active(); a.auto = a.auto || {}; a.auto[k] = e.target.checked; save(); if (k === 'sellWhiteGear' || k === 'autoEquip') refreshGear(); };
  el.onclick = (e) => { if (typeof farmCardClick === 'function' && farmCardClick(e)) return; if (e.target.dataset && e.target.dataset.abeh) { e.preventDefault(); openSheet('beh'); } };
}
function orderText(c) {
  const o = c.order; if (!o) return null;
  if (o.type === 'travel' && o.cross) return { t: 'Travel to ' + o.label, d: o.leaving ? 'walking to the way out of the dungeon' : o.trip && o.trip.legs[o.trip.i] ? tripText(o.trip) : o.via };
  if (o.type === 'travel') return { t: 'Travel to ' + o.label, d: Math.round(Math.max(0, o.total - o.done)) + ' yd left (' + o.via + ')' };
  if (o.type === 'grind') return { t: 'Grind ' + o.label, d: 'Radius ' + o.radius + ' yd' + (o.entries ? ', only ' + mobName(o.entries[0]) : '') };
  if (o.type === 'quest') return { t: 'Quest: ' + o.label, d: (o.phase || '') + (o.where ? ' - ' + o.where : '') };
  if ((o.type === 'questing' || o.type === 'quest' || o.type === 'leveling') && o.wobj && G.q.byId[o.wobj[0]] && c.quests[o.wobj[0]] && o.phase === G.q.byId[o.wobj[0]].title) { const q = G.q.byId[o.wobj[0]]; const ob = q.objectives[o.wobj[1]]; o.where = (ob.type === 'Collect' ? 'collect ' : ob.id < 0 ? 'use ' : 'kill ') + ob.name + ' ' + progText(c, q, o.wobj[1]); }
  if (o.type === 'leveling') return levelingText(c, o);
  if (o.type === 'patrol') return patrolText(c, o);
  if (o.type === 'dungeon') return dungeonText(c, o);
  if (o.type === 'npc') return npcOrderText(c, o);
  if (o.type === 'farm') return farmText(c, o);
  if (o.type === 'kill') return killText(c, o);
  if (o.type === 'follow') return followText(c, o);
  if (o.type === 'fish') return fishText(c, o);
  if (o.type === 'trainer') return { t: 'Train ' + profName(o.skill), d: (o.trip && o.trip.legs[o.trip.i] ? tripText(o.trip) + ' - ' : '') + 'to ' + o.label };
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
  }
  {
    // Stop, and the two routes: start them (or set them up first) - the pencil edits the route on the map
    const gr = typeof routeOf === 'function' ? routeOf(c, 'gather') : null, ki = typeof routeOf === 'function' ? routeOf(c, 'grind') : null, sk = typeof routeOf === 'function' ? routeOf(c, 'skin') : null;
    const on = (k) => o && o.type === 'patrol' && (o.kind || 'gather') === k;
    h += '<div class="obtns">' + (o ? '<button class="act red" id="btnStop">Stop</button>' : '') +
      '<span class="obtn' + (on('gather') ? ' on' : '') + '"><button class="mini" data-oroute="gather" title="' + (gr && gr.pts.length >= 2 ? 'Walk the gathering route: herbs, ore, skinning' : 'Set up a gathering route on the map') + '">&#127807; Gather</button><button class="mini" data-oedit="gather" title="Edit the gathering route on the map">&#9998;</button></span>' +
      '<span class="obtn' + (on('grind') ? ' on' : '') + '"><button class="mini" data-oroute="grind" title="' + (ki && ki.pts.length >= 2 ? 'Walk the grinding route and fight the creatures along it' : 'Set up a grinding route on the map') + '">&#9876; Grind</button><button class="mini" data-oedit="grind" title="Edit the grinding route on the map">&#9998;</button></span>' +
      '<span class="obtn' + (on('skin') ? ' on' : '') + '"><button class="mini" data-oroute="skin" title="' + (sk && sk.pts.length >= 2 ? 'Walk the skinning route: kill the beasts that can be skinned along it and skin them' : 'Set up a skinning route on the map') + '">&#128298; Skin</button><button class="mini" data-oedit="skin" title="Edit the skinning route on the map">&#9998;</button></span></div>';
  }
  $('orderCard').innerHTML = h;
  const b = $('btnStop'); if (b) b.onclick = () => stopOrder(c);
  $('orderCard').querySelectorAll('[data-oroute]').forEach((x) => { x.onclick = () => { routeButton(c, x.dataset.oroute); renderOrder(); }; });
  $('orderCard').querySelectorAll('[data-oedit]').forEach((x) => { x.onclick = () => routeEditStart(x.dataset.oedit); });
}
function renderInfo(sel) {
  const el = $('infoCard');
  if (sel && sel.kind === 'dungeon') { el.innerHTML = dungeonInfoHtml(sel.d); el.onclick = (e) => dungeonInfoClick(e, sel.d); el.onchange = (e) => dungeonInfoClick(e, sel.d); return; }
  el.onclick = null; el.onchange = null;
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
  // a dungeon map while the character is outside: go there (the dungeon's own buttons), not to these coordinates
  const dmap = G.map.dmap && c.pos.map !== G.map.map ? G.map.dungeon : null;
  const away = !dmap && G.map.map !== c.pos.map;            // another continent, or the world outside while in a dungeon
  target.map = G.map.map;
  if (dmap) {
    const low = c.level < dmap.lmin - (dmap.kind === 'raid' ? 0 : 3);
    m.innerHTML = '<h4>' + esc(dmap.name) + '</h4>' +
      '<button data-a="dgrun"' + (low ? ' disabled' : '') + '>Run it with a group of ' + dmap.players + '</button>' +
      '<button data-a="dgsolo"' + (low ? ' disabled' : '') + '>Run it alone</button>' +
      '<button data-a="dggo">Travel to the entrance</button>' +
      '<button data-a="close" style="color:#9a8f77">Cancel</button>';
    m.hidden = false; G.menuOpen = true;
    const w = $('mapwrap').clientWidth, h = $('mapwrap').clientHeight;
    m.style.left = Math.min(sx + 6, w - 220) + 'px'; m.style.top = Math.max(4, Math.min(sy + 6, h - 160)) + 'px';
    m.onclick = (ev) => {
      const a = ev.target.dataset && ev.target.dataset.a; if (!a) return;
      if (a === 'dgrun' || a === 'dgsolo') orderDungeon(c, dmap, a === 'dgrun');
      else if (a === 'dggo') dungeonTravel(c, dmap);
      hideMenu();
    };
    return;
  }
  if (sel.kind === 'mob') {
    const i = sel.mob.info;
    if (sel.mob.st !== 'dead' && (sel.mob.beh === 'A' || sel.mob.beh === 'N')) extra += '<button data-a="kill">Kill ' + esc(title) + ' (lvl ' + sel.mob.lvl + ')</button>';
    if (sel.mob.st !== 'dead' && (sel.mob.beh === 'A' || sel.mob.beh === 'N') && !sel.mob.civ) { extra += '<button data-a="grindtype">Grind this kind of creature (' + esc(title) + ')</button>'; }
    const qs = (G.q.byGiver[sel.mob.e] || []).filter((q) => questAvailable(c, q));
    for (const q of qs.slice(0, 5)) { const why = questSupport(q); extra += '<button data-a="quest:' + q.id + '"' + (why ? ' disabled title="' + esc(why) + '"' : '') + '>Quest: ' + esc(q.title) + ' (' + q.level + ')</button>'; }
    const h9 = G.d.hostility.creatures[sel.mob.e];
    if (typeof innkeepers === 'function' && innkeepers().some((v) => v.e === sel.mob.e) && innUsable(c, { e: sel.mob.e })) extra += '<button data-a="inn">' + (c.bind && c.bind.e === sel.mob.e ? 'Your home inn' : 'Make this inn your home (Hearthstone)') + '</button>';
    if (h9 && (h9[9] & 4 || (G.d.vendorItems && G.d.vendorItems[sel.mob.e]))) extra += '<button data-a="vendor">Go to vendor (buy / sell' + (h9[9] & 16384 ? ' / repair' : '') + ')</button>';
    const ready = Object.keys(c.quests).map((id) => G.q.byId[id]).filter((q) => q && q.turnin.some((t) => t[1] === sel.mob.e) && questDone(c, q));
    for (const q of ready) extra += '<button data-a="quest:' + q.id + '">Turn in: ' + esc(q.title) + '</button>';
  }
  if (sel.kind === 'taxi' && !away && sideOk(c, sel.n.side)) extra = '<button data-a="flyfrom">Fly from here ... (choose where)</button>' + extra;
  m.innerHTML = '<h4>' + esc(title) + '</h4>' +
    '<button data-a="travel">Travel here' + (away ? (isDungeonMap(c.pos.map) ? ' (out of the dungeon first)' : ' (ships and flights)') : '') + '</button>' +
    (away ? '' : extra) +
    (typeof hasProf === 'function' && hasProf(c, 356) && !away ? '<button data-a="fish">Fish at the water here</button>' : '') +
    '<button data-a="route">Add a gathering route checkpoint here</button>' +
    '<button data-a="kroute">Add a grinding route checkpoint here</button>' +
    '<button data-a="sroute">Add a skinning route checkpoint here</button>' +
    '<button data-a="close" style="color:#9a8f77">Cancel</button>';
  m.hidden = false; G.menuOpen = true;
  const w = $('mapwrap').clientWidth, h = $('mapwrap').clientHeight;
  m.style.left = Math.min(sx + 6, w - 220) + 'px'; m.style.top = Math.max(4, Math.min(sy + 6, h - 40 - 30 * (m.children.length))) + 'px';
  m.onclick = (ev) => {
    const a = ev.target.dataset && ev.target.dataset.a; if (!a) return;
    if (a === 'travel') orderTravel(c, target, label);
    else if (a === 'fish') orderFishing(c, false, target);
    else if (a === 'flyfrom') openFlightWindow(sel.id);
    else if (a === 'route' || a === 'kroute' || a === 'sroute') { const k = a === 'route' ? 'gather' : a === 'sroute' ? 'skin' : 'grind'; if (G.routeEdit !== k) routeEditStart(k); routeAddPoint(target); }
    else if (a === 'kill') orderKill(c, sel.mob);
    else if (a === 'inn') { const v = innkeepers().find((x) => x.e === sel.mob.e && Math.hypot(x.x - sel.mob.x, x.y - sel.mob.y) < 5) || innkeepers().find((x) => x.e === sel.mob.e); if (v && !(c.bind && c.bind.e === v.e)) orderInn(c, v); }
    else if (a === 'grindtype') orderGrind(c, target.x, target.y, 250, [sel.mob.e], title + ' near here');
    else if (a.startsWith('quest:')) questAtGiver(c, +a.slice(6), sel.kind === 'mob' ? { map: c.pos.map, x: sel.mob.x, y: sel.mob.y } : null);
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
  if (img) {
    if (!IS_APP) {
    ctx.imageSmoothingQuality = 'high';
    const hd = hdOn() && G.imgHd && G.imgHd[m.name];
    if (hd) { const cr = (G.hdCal && G.hdCal[m.name] && G.hdCal[m.name].crop) || [0, 0, hd.naturalWidth, hd.naturalHeight]; ctx.drawImage(hd, cr[0], cr[1], cr[2], cr[3], G.ox, G.oy, img.naturalWidth * G.scale, img.naturalHeight * G.scale); }
    else ctx.drawImage(img, G.ox, G.oy, img.naturalWidth * G.scale, img.naturalHeight * G.scale);
    } else {
    // only the part of the map on the screen is drawn (zoomed in, the whole picture blown up tens of thousands of
    // pixels wide every frame made phones crawl); smoothing: the expensive kind only when the picture is made smaller
    const hd = hdOn() && G.imgHd && G.imgHd[m.name];
    const W = img.naturalWidth, H = img.naturalHeight, S = G.scale;
    const x0 = Math.max(0, -G.ox / S), y0 = Math.max(0, -G.oy / S), x1 = Math.min(W, (G.cw - G.ox) / S), y1 = Math.min(H, (G.ch - G.oy) / S);
    if (x1 > x0 && y1 > y0) {
      const cr = hd ? (G.hdCal && G.hdCal[m.name] && G.hdCal[m.name].crop) || [0, 0, hd.naturalWidth, hd.naturalHeight] : [0, 0, W, H];
      const kx = cr[2] / W, ky = cr[3] / H; const src = hd || img;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = S * G.dpr / Math.max(kx, ky) < 1 ? 'high' : 'low';
      ctx.drawImage(src, cr[0] + x0 * kx, cr[1] + y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky, G.ox + x0 * S, G.oy + y0 * S, (x1 - x0) * S, (y1 - y0) * S);
      ctx.imageSmoothingQuality = 'low';
    }
    }
  }
  if (!img) { ctx.fillStyle = '#9a8f77'; ctx.font = '16px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('Loading map ...', G.cw / 2, G.ch / 2); ctx.textAlign = 'start'; }
  if (m.world) { drawNavOverlay(ctx); return; }
  if ($('showterrain') && $('showterrain').checked) drawTerrain(ctx, m);
  if (m.dmap && (($('showdgwalls') && $('showdgwalls').checked) || ($('showterrain') && $('showterrain').checked)) && typeof drawDungeonWalls === 'function') drawDungeonWalls(ctx, m);      // Terrain shows the dungeon walls too
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
      if (mob.rank && mob.beh !== 'F') { ctx.globalAlpha = 1; drawRankRing(ctx, mob.rank, x, y, mob.st === 'chase' ? r + 1.5 : r); }
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
  drawProfOverlay(ctx, m);
  if (typeof drawHome === 'function') drawHome(ctx, m, c);          // the home inn (Hearthstone)
  drawDungeonMarks(ctx, m); drawParty(ctx, m);
  if (typeof drawRouteMarks === 'function') drawRouteMarks(ctx, m);
  // the pet
  if (petAlive(c) && c.pos.map === m.map && !rt(c).ghost && !rt(c).flying && !rt(c).riding) {
    const P = rt(c).pet; const [x, y] = w2s(P.x, P.y);
    const ic = petMapIcon(c.pet);
    if (ic && ic.complete && ic.naturalWidth) { ctx.drawImage(spriteSized(ic, ic.src, 14, 14, true), x - 7, y - 7, 14, 14); ctx.strokeStyle = '#1a1409'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.3); ctx.stroke(); }
    else { ctx.fillStyle = '#7fbf5a'; ctx.strokeStyle = '#1a1409'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.3); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#000'; ctx.fillRect(x - 9, y - 13, 18, 3); ctx.fillStyle = '#5ec06a'; ctx.fillRect(x - 9, y - 13, 18 * Math.max(0, c.pet.hp / petStats(c).maxhp), 3);
  }
  // the character
  if (c.pos.map === m.map && inMap(m, c.pos.x, c.pos.y)) {
    const [x, y] = w2s(c.pos.x, c.pos.y);
    ctx.save(); ctx.translate(x, y);
    if (rt(c).ghost) ctx.globalAlpha = .55;
    if (!drawClassIcon(ctx, c.cls, 0, 0, 10)) { ctx.fillStyle = rt(c).ghost ? '#8fd0ff' : '#c0662a'; ctx.strokeStyle = '#fff3d0'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.3); ctx.fill(); ctx.stroke(); }
    // facing arrow: o is the angle from north (x axis) towards west (y axis); screen east = -y
    const ang = Math.atan2(-Math.sin(c.pos.o), -Math.cos(c.pos.o));
    const dx = -Math.sin(c.pos.o), dy = -Math.cos(c.pos.o);
    ctx.fillStyle = '#fff3d0'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(dx * 17, dy * 17); ctx.lineTo(dx * 10 - dy * 5, dy * 10 + dx * 5); ctx.lineTo(dx * 10 + dy * 5, dy * 10 - dx * 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    const hm = charStats(c).maxHp; ctx.fillStyle = '#000'; ctx.fillRect(x - 14, y - 19, 28, 5); ctx.fillStyle = '#3fae5a'; ctx.fillRect(x - 14, y - 19, 28 * Math.max(0, c.hp / hm), 5);
  }
  // the other characters (running in the background, or waiting where they were left)
  for (const o of G.state.characters) {
    if (o === c || o.pos.map !== m.map || !inMap(m, o.pos.x, o.pos.y)) continue;
    const live = o.bg || (typeof sameGroup === 'function' && sameGroup(c, o)); const [x, y] = w2s(o.pos.x, o.pos.y); ctx.globalAlpha = live ? 1 : 0.6;
    if (!drawClassIcon(ctx, o.cls, x, y, 8)) { ctx.fillStyle = CLASS_COLOR[o.cls] || '#9fc7ff'; ctx.strokeStyle = '#1a1409'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.3); ctx.fill(); ctx.stroke(); }
    if (!live) { ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#cfe3ff'; ctx.strokeText('paused', x, y - 11); ctx.fillText('paused', x, y - 11); ctx.textAlign = 'start'; }
    ctx.globalAlpha = 1;
  }
  if (c.pos.map === m.map && inMap(m, c.pos.x, c.pos.y)) {
    const [x, y] = w2s(c.pos.x, c.pos.y); const r = rt(c);
    if (r.interact) { const p = Math.min(1, r.interact.t / r.interact.dur); ctx.fillStyle = '#000'; ctx.fillRect(x - 30, y + 12, 60, 6); ctx.fillStyle = '#e8c46a'; ctx.fillRect(x - 30, y + 12, 60 * p, 6); ctx.font = '11px Segoe UI'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.strokeText(r.interact.label, x, y + 30); ctx.fillText(r.interact.label, x, y + 30); ctx.textAlign = 'start'; }
    else if (r.cast) { const p = Math.min(1, r.cast.t / Math.max(0.01, r.cast.total)); ctx.fillStyle = '#000'; ctx.fillRect(x - 30, y + 12, 60, 6); ctx.fillStyle = r.cast.ch ? '#7fb0ff' : '#ffd04a'; ctx.fillRect(x - 30, y + 12, 60 * (r.cast.ch ? 1 - p : p), 6); ctx.font = '11px Segoe UI'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.strokeText(r.cast.name, x, y + 30); ctx.fillText(r.cast.name, x, y + 30); ctx.textAlign = 'start'; }
    else if (r.resting) { ctx.font = 'bold 12px Segoe UI'; ctx.fillStyle = r.eating ? '#9fe0a0' : r.drinking ? '#7fb0ff' : '#9fc7ff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; const t = r.eating && r.drinking ? 'eating, drinking' : r.eating ? 'eating' : r.drinking ? 'drinking' : 'Zz'; ctx.strokeText(t, x + 10, y - 8); ctx.fillText(t, x + 10, y - 8); }
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
  ctx.save(); ctx.imageSmoothingEnabled = false; drawOnScreen(ctx, t.cv, ax, ay, bx - ax, by - ay); ctx.restore();
}
function resize() {
  const wrap = $('mapwrap'); const dpr = IS_APP ? Math.min(window.devicePixelRatio || 1, 2) : window.devicePixelRatio || 1;          // phones: at most 2 canvas pixels per screen pixel (3x screens: less than half the pixels to fill)
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
    G.drag = { x, y, ox: G.ox, oy: G.oy, moved: false, touch: e.pointerType === 'touch', closed: G.menuOpen }; hideMenu();
  });
  cv.addEventListener('pointerup', (e) => {
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; G.drag = null; return; }
    const d = G.drag; G.drag = null; if (!d || d.moved) return;
    if (d.closed) return;                 // a click away from an open menu only closes it
    const [sx, sy] = pos(e);
    if (e.button === 2) return;
    const ex = !G.routeEdit && !G.rmOn && dungeonExitHit(sx, sy); if (ex) { dungeonExitClick(ex); return; }
    const dh = !G.routeEdit && dungeonHit(sx, sy); if (dh) { openDungeon(dh); return; }
    if (G.map.world || G.map.cont) { const h = navHit(sx, sy); if (h && h.def) { const w = s2w(sx, sy); setMap(h.def); } return; }
    if (G.routeEdit) { const w0 = s2w(sx, sy); if (inMap(G.map, w0.x, w0.y)) routeAddPoint(w0); return; }
    if (G.rmOn) { const w0 = s2w(sx, sy); if (inMap(G.map, w0.x, w0.y)) rmClick(w0); return; }          // the route marker (dungeons)
    const hit = pickAt(sx, sy, d.touch ? 18 : 8);
    const w = s2w(sx, sy);
    const sel = hit || { kind: 'ground', x: w.x, y: w.y };
    if (!hit && !inMap(G.map, w.x, w.y)) return;
    G.selected = sel; renderInfo(sel); showMenu(sx, sy, sel);
  });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); hideMenu(); if (G.rmOn) { rmUndo(); return; } goUp(); });
  // a click anywhere outside the menu closes it
  document.addEventListener('pointerdown', (e) => { if (G.menuOpen && e.target !== cv && !$('menu').contains(e.target)) hideMenu(); }, true);
  cv.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); pinch = null; G.drag = null; });
  cv.addEventListener('pointermove', (e) => {
    const [sx, sy] = pos(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: sx, y: sy });
    if (pinch && ptrs.size >= 2) {
      const [p1, p2] = [...ptrs.values()]; const dd = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const [W, H] = mapSize(G.map); const minS = Math.min(G.cw / W, G.ch / H) * 0.8;
      const ns = Math.max(minS, Math.min(12, pinch.s * dd / Math.max(1, pinch.d))); const k = ns / pinch.s;
      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      G.ox = cx - (pinch.cx - pinch.ox) * k; G.oy = cy - (pinch.cy - pinch.oy) * k; G.scale = ns; if (!IS_APP) $('follow').checked = false; return;          // the app: zooming keeps following
    }
    if (G.drag) {
      if (Math.abs(sx - G.drag.x) + Math.abs(sy - G.drag.y) > (G.drag.touch ? 10 : 5)) G.drag.moved = true;
      if (G.drag.moved) { G.ox = G.drag.ox + sx - G.drag.x; G.oy = G.drag.oy + sy - G.drag.y; $('follow').checked = false; }
    }
    if (e.pointerType === 'touch') return;
    const exh = G.drag && G.drag.moved ? null : dungeonExitHit(sx, sy);
    G.dgHover = exh || (G.drag && G.drag.moved ? null : dungeonHit(sx, sy));
    if (G.dgHover) { const tip = $('tip'); tip.innerHTML = exh ? dungeonExitTip(exh) : dungeonTip(G.dgHover); tip.hidden = false; tip.style.left = (sx + 14) + 'px'; tip.style.top = (sy + 14) + 'px'; cv.style.cursor = 'pointer'; G.navHover = null; return; }
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
  if (IS_APP) bindMapCtl();
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
  $('speed').addEventListener('click', (e) => { const s = e.target.dataset && e.target.dataset.s; if (s !== undefined) { setSpeed(+s); ddClose(); } });
  bindDropdowns(); if (typeof rmBind === 'function') rmBind();
  $('btnSave').onclick = () => {
    if (window.AzerothApp && AzerothApp.saveFile) { save(); AzerothApp.saveFile('auto_battler_save.json', JSON.stringify(G.state, null, 1)); return; }      // the Android app: to Downloads
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(G.state, null, 1)], { type: 'application/json' }));
    a.download = 'auto_battler_save.json'; a.click();
  };
  $('btnLoad').onclick = () => $('fileLoad').click();
  $('btnChars').onclick = () => openCharSwitch();
  $('btnMeter').onclick = () => toggleMeter();
  $('shownodes').onchange = () => { G.state.settings.showNodes = $('shownodes').checked; save(); };
  if ($('lightworld') && IS_APP) { $('lightworld').checked = lightWorld(); $('lightworld').onchange = () => { G.state.settings.lightWorld = $('lightworld').checked; save(); location.reload(); }; }
  $('hdmaps').onclick = () => { G.state.settings.hdMaps = !hdOn(); save(); if (hdOn()) loadHd(G.map); renderHdToggle(); };
  $('fileLoad').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const s = JSON.parse(await f.text()); if (!s.characters || !s.characters.length) throw new Error('no characters'); G.state = s; save(); location.reload(); }
    catch (err) { alert('Could not read that file: ' + err.message); }
  };
}
/* the top bar's drop-down menus (map view, speed): open under their button, close on a click elsewhere */
function ddClose() { document.querySelectorAll('.dd.open').forEach((d) => d.classList.remove('open')); }
/* the buttons on the map for phones: zoom, follow the character, pause */
function mapZoom(f) {
  const [W, H] = mapSize(G.map); const minS = Math.min(G.cw / W, G.ch / H) * 0.8; const ns = Math.max(minS, Math.min(12, G.scale * f));
  const k = ns / G.scale; const cx = G.cw / 2, cy = G.ch / 2; G.ox = cx - (cx - G.ox) * k; G.oy = cy - (cy - G.oy) * k; G.scale = ns;
}
function syncMapCtl() {
  const f = $('mcFollow'), p = $('mcPause'); if (!f) return;
  f.classList.toggle('on', $('follow').checked);
  const sp = G.state && G.state.settings.speed; p.innerHTML = sp ? '&#10074;&#10074;' : '&#9654;'; p.classList.toggle('on', !sp); p.title = sp ? 'Pause' : 'Go on';
}
function bindMapCtl() {
  const el = $('mapctl'); if (!el) return;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); hideMenu();
    if (b.id === 'mcIn') mapZoom(1.4);
    else if (b.id === 'mcOut') mapZoom(1 / 1.4);
    else if (b.id === 'mcFollow') { const on = !$('follow').checked; $('follow').checked = on; if (on) { const c = active(); if (c.pos.map !== G.map.map || G.map.world || G.map.cont) goToCharacter(); } }
    else if (b.id === 'mcPause') setSpeed(G.state.settings.speed ? 0 : (G.lastSpeed || 1));
    syncMapCtl();
  });
  $('follow').addEventListener('change', syncMapCtl);
  setInterval(syncMapCtl, 400);
}
function bindDropdowns() {
  document.querySelectorAll('.dd > .ddb').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation(); const dd = b.parentElement; const was = dd.classList.contains('open'); ddClose(); if (was) return;
      dd.classList.add('open'); const m = dd.querySelector('.ddm'); const r = b.getBoundingClientRect();
      m.style.top = (r.bottom + 4) + 'px'; m.style.left = Math.max(4, Math.min(window.innerWidth - m.offsetWidth - 4, r.right - m.offsetWidth)) + 'px';
    };
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.dd')) ddClose(); }, true);
  window.addEventListener('resize', ddClose);
}
/* the Android app's Back button: closes what is open (menus, windows, the route marker); false when nothing was */
function appBack() {
  if (document.querySelector('.dd.open')) { ddClose(); return true; }
  const ab = $('awayBox'); if (ab && !ab.hidden) { ab.hidden = true; return true; }
  if ($('iact') && !$('iact').hidden) { hideItemMenu(); return true; }
  if (G.menuOpen) { hideMenu(); return true; }
  if (SH.open) { closeSheet(); return true; }
  if (typeof METER !== 'undefined' && METER.show && typeof toggleMeter === 'function') { toggleMeter(); return true; }
  if (G.rmOn && typeof rmOpen === 'function') { rmOpen(false); return true; }
  const cs = $('charswitch'); if (cs && !cs.hidden) { cs.hidden = true; return true; }
  if (document.body.classList.contains('show-left') || document.body.classList.contains('show-right')) { const b = document.querySelector('#mnav [data-p="map"]'); if (b) { b.click(); return true; } }
  return false;
}
function setSpeed(s) {
  if (s) G.lastSpeed = s;
  G.state.settings.speed = s;
  document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s));
  const sb = $('speedBtn'); if (sb) sb.innerHTML = (s ? 'Speed ' + s + 'x' : '&#10074;&#10074; Paused') + ' &#9662;';
  save(); renderOrder();
}

/* ------------------------------------------------------------------- loop */
function frame(ts) {
  const dt = Math.min(0.25, (ts - (G.last || ts)) / 1000); G.last = ts;
  // the browser stopped the loop (tab in the background, the computer asleep): play the missed time (away.js)
  const now = Date.now(); const gap = (now - (G.lastReal || now)) / 1000; G.lastReal = now;
  if (gap > AWAY_MIN && !G.catching && typeof awayCatchUp === 'function') awayCatchUp(gap, 'hidden');
  const sp = G.catching ? 0 : G.state.settings.speed;
  if (sp > 0) {
    G.acc += dt * sp;
    const live = liveChars(); let n = 0; const cap = Math.max(60, Math.round(400 / live.length));
    while (G.acc >= STEP && n++ < cap) { G.acc -= STEP; G.gameTime += STEP; for (const ch of live) { G.logCtx = ch; updateChar(ch, STEP); } G.logCtx = null; worldTick(STEP); }
    if (G.acc > STEP * 40) G.acc = 0;          // the computer is too slow for this speed: drop the backlog instead of freezing
    for (const f of G.fx) f.t += dt * sp; G.fx = G.fx.filter((f) => f.t < 1.2);
  }
  const c = active();
  if (ts - (G.followT || 0) > 500) { G.followT = ts; followZone(c); if (!$('maptabs').matches(':hover')) renderNav(); }
  if ($('follow').checked && c.pos.map === G.map.map && !G.map.world) { const [px, py] = w2m(G.map, c.pos.x, c.pos.y); G.ox = G.cw / 2 - px * G.scale; G.oy = G.ch / 2 - py * G.scale; }
  draw(); if (typeof updateCraftBar === 'function') updateCraftBar();          // the crafting bar moves every frame
  if (typeof animateCastBars === 'function') animateCastBars();               // and the cast bars of the unit frames
  if (typeof updateWcBars === 'function') updateWcBars();                     // and the guild crafting orders
  if (ts - (G.saveT || 0) > 30000) { G.saveT = ts; save(); }
  if (ts - G.uiT > 250) {
    G.uiT = ts; renderChar(); renderAbar(); if (c.order) renderOrder();
    if (!G.qT || ts - G.qT > 1500) { G.qT = ts; if (!$('questCard').matches(':hover')) renderQuests(); }
    if (typeof renderDgCard === 'function' && (!G.dgT || ts - G.dgT > 500)) { G.dgT = ts; renderDgCard(); }
    if (G.selected && G.selected.kind === 'mob') renderInfo(G.selected);
    if (!G.csT || ts - G.csT > 1000) { G.csT = ts; renderCharSwitch(); if (!$('groupCard').matches(':hover')) renderGroup(); }
    if (METER.show && (!G.mtT || ts - G.mtT > 500)) { G.mtT = ts; renderMeter(); }
    if (SH.open && SH.tab === 'pet' && (!G.ptT || ts - G.ptT > 1000) && !$('sheet').querySelector('.sheet-body:hover')) { G.ptT = ts; renderSheet(); }       // the pet's bars move
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
    if (typeof lightningStrikeInit === 'function') lightningStrikeInit();          // Lightning Strike: ranks made from Lightning Bolt (classes.js)
    try { G.d.cstats = await J('../gamedata/creature_stats.json'); } catch (e) { G.d.cstats = null; console.warn('creature_stats.json not found - using estimated creature health and damage'); }
    try { G.d.vendorItems = await J('../gamedata/vendor_items.json'); } catch (e) { G.d.vendorItems = null; }
    try { G.d.objects = await J('../gamedata/objects.json'); } catch (e) { G.d.objects = null; }
    try { G.d.eventMobs = new Set(await J('../gamedata/event_mobs.json')); } catch (e) { G.d.eventMobs = null; }
    try { G.d.dungeons = await J('../gamedata/dungeons.json'); } catch (e) { G.d.dungeons = null; console.warn('dungeons.json not found - no dungeons'); }
    try { G.dgRoutes = await J('../gamedata/dungeon_routes.json'); } catch (e) { G.dgRoutes = {}; }
    try { G.rmarksFile = await J('../gamedata/route_marks.json'); } catch (e) { G.rmarksFile = null; }          // routes marked by hand (routemarker.js)
    if (typeof rmApplyAll === 'function') rmApplyAll();
    try { G.d.prof = await J('../gamedata/professions.json'); } catch (e) { G.d.prof = null; console.warn('professions.json not found - no professions'); }
    if (typeof enchantScrollsInit === 'function') enchantScrollsInit();          // the enchanting scrolls (items of their own)
    try { G.d.skinning = await J('../gamedata/skinning.json'); } catch (e) { G.d.skinning = null; }
    try { G.d.gathering = await J('../gamedata/gathering.json'); } catch (e) { G.d.gathering = null; }
    if (typeof fishingInit === 'function') fishingInit();
    try { G.d.pets = await J('../gamedata/pets.json'); } catch (e) { G.d.pets = null; }
    try { G.d.rep = await J('../gamedata/reputation.json'); } catch (e) { G.d.rep = null; console.warn('reputation.json not found - no reputation (run: py wow_reputation.py)'); }
    try { G.d.stances = await J('../gamedata/spell_stances.json'); } catch (e) { G.d.stances = null; }
    try { G.d.talents = await J('../gamedata/talents.json'); } catch (e) { G.d.talents = null; console.warn('talents.json not found - no talents'); }
    try { G.d.go = await J('../gamedata/go_data.json'); } catch (e) { G.d.go = null; console.warn('go_data.json not found - quests with objects are not automated (run: py build_gamedata.py goquest)'); }
    G.d.graveyards = DATA.graveyards;
    G.spawnList = Object.entries(G.d.spawns.spawns).map(([e, l]) => [+e, l]);
    G.spawnMap = new Map(G.spawnList);
    for (const m of DATA.mobs) G.mobIdx[m[0]] = m;
    if (G.d.dungeons && G.d.dungeons.mobs) for (const m of G.d.dungeons.mobs) if (!G.mobIdx[m[0]]) G.mobIdx[m[0]] = m;
    G.nav = makeNav(G.d.navgraph);
    loadMsg('quest index ...'); buildQuestIndex();
    if (typeof dungeonKeepersInit === 'function') dungeonKeepersInit();          // the vendors / quest givers at every dungeon entrance (dungeons.js)

    loadMsg('maps ...');
    let manifest = null; try { manifest = await J('../files.json'); } catch (e) { manifest = null; }
    const files = manifest ? manifest.maps : await listDir('../maps/', '.png');
    G.hdList = manifest && manifest.maps_hd ? manifest.maps_hd : null;
    if (!G.hdList) { try { G.hdList = (await J('../maps_hd/index.json')).files || null; } catch (e) { G.hdList = null; } }
    try { G.hdCal = await J('../maps_hd/hd_maps.json'); } catch (e) { G.hdCal = null; }
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
    const lastReal = G.state && G.state.lastReal;          // before anything saves again: when the game was closed
    if (!G.state || !G.state.characters || !G.state.characters.length) {
      G.state = Object.assign({ version: 1, activeId: null, characters: [], settings: { speed: 1, autoSellJunk: true, autoEquip: true, chainQuests: true } }, G.state || {}, { characters: [] });
      $('loading').style.display = 'none';
      const made = await charScreen(true);
      G.state.characters.push(made); G.state.activeId = made.id; save();
      $('loading').style.display = '';
    }
    G.gameTime = G.state.gameTime || 0;
    G.state.characters.forEach(migrate);
    for (const [k, v] of [['autoEquip', true], ['autoSellJunk', true], ['autoBuyBags', true], ['sellWhiteGear', true], ['chainQuests', true], ['autoEat', true], ['autoPotion', true], ['autoRepair', true]]) if (G.state.settings[k] === undefined) G.state.settings[k] = v;
    bindInput(); resize(); try { new ResizeObserver(() => resize()).observe($('mapwrap')); } catch (e) { /* old browser */ }
    const c = active();
    goToCharacter();
    loadGrid(c.pos.map);
    setSpeed(G.state.settings.speed === undefined ? 1 : G.state.settings.speed);
    renderChar(); renderOrder(); renderInfo(null); renderGearCard(); renderQuests(); renderSettingsCard(); bindCards(); bindSheet(); bindLogLinks(); syncNodeToggle();
    METER.show = !!G.state.settings.meter; renderMeter(true); syncMeterBtn();
    bindGroupCard(); renderGroup();
    log('Welcome. ' + c.name + ' stands in ' + (G.map.name) + '. Click the map to give an order.');
    log('Game version ' + GAME_VERSION + '.');
    $('loading').style.display = 'none';
    G.lastReal = Date.now(); requestAnimationFrame(frame);
    window.G = G;
    if (lastReal && typeof awayCatchUp === 'function') awayCatchUp((Date.now() - lastReal) / 1000, 'closed');          // offline progress
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
