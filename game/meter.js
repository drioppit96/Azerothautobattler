'use strict';
/* meter.js - a damage meter: damage done, healing and damage taken of the character you play, its pet and its group,
   per fight (the current one, the last ones) and overall. The window sits on the map; "DPS" in the top bar. */

const METER = { show: false, view: 'dmg', seg: 'cur', open: null };
const METER_KEEP = 12;
function meterState() { G.meter = G.meter || { fights: [], cur: null, all: { start: G.gameTime, end: G.gameTime, units: {} } }; return G.meter; }
function meterUnit(seg, key, name, cls) { let u = seg.units[key]; if (!u) u = seg.units[key] = { name, cls, dmg: 0, heal: 0, taken: 0, ab: {}, hab: {} }; return u; }
/* who a unit belongs to: the character you play (and its pet and group) or nobody (background characters) */
function meterOwner(src) { if (!src) return null; if (src.id && G.state && src.id === G.state.activeId) return src; return null; }
function meterAdd(kind, key, name, cls, v, ability) {
  if (!(v > 0)) return; const M = meterState();
  for (const seg of [M.cur, M.all]) {
    if (!seg) continue; const u = meterUnit(seg, key, name, cls); u[kind] += v; seg.end = G.gameTime;
    if (kind === 'dmg') u.ab[ability || 'Melee'] = (u.ab[ability || 'Melee'] || 0) + v;
    else if (kind === 'heal') u.hab[ability || 'Heal'] = (u.hab[ability || 'Heal'] || 0) + v;
  }
}
/* the character (c), its pet (pet: true) or a group member (u) did v damage with an ability */
function meterDmg(c, v, ability, pet) { if (!meterOwner(c)) return; if (pet) meterAdd('dmg', c.id + ':pet', (c.pet && c.pet.name) || 'Pet', c.cls, v, ability || 'Attack'); else meterAdd('dmg', c.id, c.name, c.cls, v, ability); }
function meterHeal(c, v, ability) { if (!meterOwner(c)) return; meterAdd('heal', c.id, c.name, c.cls, v, ability); }
function meterTaken(c, v) { if (!meterOwner(c)) return; meterAdd('taken', c.id, c.name, c.cls, v); }
function meterGroup(c, u, kind, v, ability) { if (!meterOwner(c)) return; meterAdd(kind, 'g:' + u.name, u.name, u.cls || 0, v, ability); }
/* fights: from the first blow until nothing has fought the character or its group for 3 seconds */
function meterTick(c) {
  const M = meterState(); const r = rt(c); const fighting = !!(r.threats && r.threats.length);
  if (fighting) { if (!M.cur) M.cur = { start: G.gameTime, end: G.gameTime, units: {}, name: '' }; M.cur.end = G.gameTime; M.lastFight = G.gameTime; if (!M.cur.name && r.tgt && r.tgt.info) M.cur.name = r.tgt.info[1]; }
  else if (M.cur && G.gameTime - (M.lastFight || 0) > 3) {
    if (Object.keys(M.cur.units).length) { M.fights.unshift(M.cur); if (M.fights.length > METER_KEEP) M.fights.length = METER_KEEP; }
    M.cur = null;
  }
}
function meterReset() { G.meter = null; meterState(); renderMeter(true); }
function meterSegment() {
  const M = meterState();
  if (METER.seg === 'all') return M.all;
  if (METER.seg === 'cur') return M.cur || M.fights[0] || null;
  return M.fights[+METER.seg] || null;
}
function renderMeter(force) {
  let el = $('meter');
  if (!METER.show) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('div'); el.id = 'meter'; $('mapwrap').appendChild(el); el.onclick = meterClick; el.onchange = meterClick; }
  if (!force && el.querySelector('select:focus')) return;
  el.hidden = false; const seg = meterSegment(); const M = meterState();
  const k = METER.view; const dur = seg ? Math.max(1, seg.end - seg.start) : 1;
  const rows = seg ? Object.entries(seg.units).map(([key, u]) => ({ key, u, v: u[k] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v) : [];
  const top = rows.length ? rows[0].v : 1; const tot = rows.reduce((s, x) => s + x.v, 0);
  let h = '<div class="mt-head"><select data-mseg="1"><option value="cur"' + (METER.seg === 'cur' ? ' selected' : '') + '>Current fight</option>' +
    M.fights.map((f, i) => '<option value="' + i + '"' + (METER.seg === String(i) ? ' selected' : '') + '>' + esc((f.name || 'Fight') + ' (' + fmtTime(Math.max(1, f.end - f.start)) + ')') + '</option>').join('') +
    '<option value="all"' + (METER.seg === 'all' ? ' selected' : '') + '>Overall</option></select>' +
    '<span class="mt-tabs">' + [['dmg', 'Damage'], ['heal', 'Healing'], ['taken', 'Taken']].map(([v, t]) => '<button class="mini' + (k === v ? ' on' : '') + '" data-mview="' + v + '">' + t + '</button>').join('') + '</span>' +
    '<button class="mini" data-mreset="1" title="Reset">&#8634;</button><button class="mini" data-mclose="1" title="Close">&#10005;</button></div>';
  h += '<div class="mt-sum small muted">' + (seg ? fmtTime(dur) + ' &middot; ' + Math.round(tot).toLocaleString() + ' total &middot; ' + Math.round(tot / dur).toLocaleString() + ' per second' : 'No fight yet') + '</div>';
  for (const { key, u, v } of rows) {
    const col = (typeof CLASS_COLOR !== 'undefined' && CLASS_COLOR[u.cls]) || '#bfa66a';
    h += '<div class="mt-row" data-mopen="' + esc(key) + '"><i style="width:' + (100 * v / top) + '%;background:' + col + '"></i><span class="mt-n">' + esc(u.name) + '</span><span class="mt-v">' + Math.round(v).toLocaleString() + ' (' + (v / dur).toFixed(1) + ')</span></div>';
    if (METER.open === key) {
      const ab = k === 'heal' ? u.hab : k === 'dmg' ? u.ab : null;
      if (ab) h += '<div class="mt-ab">' + Object.entries(ab).sort((a, b) => b[1] - a[1]).map(([n, x]) => '<div class="small"><span>' + esc(n) + '</span><span>' + Math.round(x).toLocaleString() + ' &middot; ' + Math.round(100 * x / v) + '%</span></div>').join('') + '</div>';
    }
  }
  if (!rows.length && seg) h += '<div class="small muted">Nothing here yet.</div>';
  el.innerHTML = h;
}
function meterClick(e) {
  const t = e.target; let b;
  if (t.dataset && t.dataset.mseg && e.type === 'change') { METER.seg = t.value; renderMeter(true); return; }
  if ((b = t.closest('[data-mview]'))) { METER.view = b.dataset.mview; renderMeter(true); return; }
  if ((b = t.closest('[data-mreset]'))) { meterReset(); return; }
  if ((b = t.closest('[data-mclose]'))) { METER.show = false; renderMeter(); syncMeterBtn(); return; }
  if ((b = t.closest('[data-mopen]'))) { METER.open = METER.open === b.dataset.mopen ? null : b.dataset.mopen; renderMeter(true); }
}
function toggleMeter() { METER.show = !METER.show; G.state.settings.meter = METER.show; save(); renderMeter(true); syncMeterBtn(); }
function syncMeterBtn() { const b = $('btnMeter'); if (b) b.classList.toggle('on', METER.show); }
