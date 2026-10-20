'use strict';
/* hearth.js - the Hearthstone: every character carries one, bound to an inn. Using it (from the bags, the action bar
   or the Bags window) is a 10 second cast that a hit breaks, then the character is at its inn - anywhere in the
   world, also out of a dungeon. 30 minutes (game time) before it can be used again. A new home: talk to any
   innkeeper (the character walks - flies, sails - there and makes that inn its home). */

const HEARTHSTONE = 6948, HEARTH_SPELL = 8690, HEARTH_CD = 1800, HEARTH_CAST = 10, NPC_INNKEEPER = 128;

/* the database gives the mount vendors (Raptor Handler, Horse Breeder ...) the innkeeper flag too: not them */
/* the first home of each race: the inn of the first town (Goldshire, Razor Hill, Kharanos, Dolanaar, Brill, Bloodhoof) */
const START_INN = { 1: 295, 2: 6928, 3: 1247, 4: 6736, 5: 5688, 6: 6747, 7: 1247, 8: 6928 };
const NOT_INN = new Set([384, 1261, 3362, 3685, 4730, 4731, 7952, 7955, 9087]);
/* the inns of the capitals (the zone map puts Ironforge in Dun Morogh and the Undercity in Tirisfal): their own names,
   and only for their own side */
const CAPITAL_INNS = { 6740: ['Stormwind', 'A'], 5111: ['Ironforge', 'A'], 6735: ['Darnassus', 'A'], 6929: ['Orgrimmar', 'H'], 6746: ['Thunder Bluff', 'H'], 6741: ['Undercity', 'H'] };
function innkeepers() { if (!G.innList) G.innList = npcsWith(NPC_INNKEEPER, 'innNpcs').filter((v) => !NOT_INN.has(v.e)); return G.innList; }
/* an innkeeper this character can talk to (not of the other faction) */
function innUsable(c, v) { const cap = CAPITAL_INNS[v.e]; if (cap) return cap[1] === charSide(c); const b = behOf({ e: v.e }, c); return b === 'F' || b === 'N'; }
function innZone(v) { if (CAPITAL_INNS[v.e]) return CAPITAL_INNS[v.e][0]; const z = typeof zoneAt === 'function' ? zoneAt(v.map, v.x, v.y) : null; return (z && z.name) || (typeof zoneNameAt === 'function' && zoneNameAt({ map: v.map, x: v.x, y: v.y })) || (v.map === 0 ? 'Eastern Kingdoms' : v.map === 1 ? 'Kalimdor' : ''); }
function innNearest(c, p) {
  let best = null, bd = Infinity;
  for (const v of innkeepers()) { if (v.map !== p.map || !innUsable(c, v)) continue; const d = Math.hypot(v.x - p.x, v.y - p.y) * (behOf({ e: v.e }, c) === 'F' ? 1 : 1.5); if (d < bd) { bd = d; best = v; } }
  return best;
}
function hasHearth(c) { return c.bags.some((x) => x.id === HEARTHSTONE); }
/* every character has a Hearthstone and a home (a new one: the inn nearest to where its race starts) */
function hearthInit(c) {
  if (!c.bags.some((x) => x.id === HEARTHSTONE) && !(c.bank && (c.bank.items || []).some((x) => x.id === HEARTHSTONE))) c.bags.unshift(makeInst(HEARTHSTONE, 1));
  if (!c.bind) {
    const st = G.d.races.start[c.race + '_' + c.cls]; const p = st ? { map: st.map, x: st.x, y: st.y } : c.pos;
    const v = innkeepers().find((x) => x.e === START_INN[c.race]) || innNearest(c, p) || innNearest(c, c.pos);
    if (v) hearthBindTo(c, v, true);
  }
}
function hearthBindTo(c, v, quiet) {
  c.bind = { map: v.map, x: v.x, y: v.y, e: v.e, name: v.name, zone: innZone(v) };
  if (!quiet) { log(c.name + ' makes the inn of ' + c.bind.zone + ' (' + v.name + ') its home.'); fx(c.pos.x, c.pos.y, 'Home: ' + c.bind.zone, '#ffd866'); save(); }
}
function hearthLeft(c) { return Math.max(0, (c.hearthCd || 0) - G.gameTime); }
function hearthWhy(c) {
  const r = rt(c);
  if (!c.bind) return 'no home inn';
  if (!hasHearth(c)) return 'no Hearthstone in the bags';
  if (hearthLeft(c) > 0) return 'ready in ' + fmtTime(hearthLeft(c));
  if (r.ghost) return 'dead';
  if (r.flying || r.riding) return 'travelling';
  if (r.threats && r.threats.length) return 'in combat';
  if (r.cast) return 'busy casting';
  return '';
}
/* start the cast */
function hearthUse(c, quiet) {
  const why = hearthWhy(c); if (why) { if (!quiet) log('Hearthstone: ' + why + '.'); return false; }
  const r = rt(c); r.mv = null; r.resting = false; r.eating = null; r.drinking = null;
  r.cast = { name: 'Hearthstone', sp: spellRow(HEARTH_SPELL) || { n: 'Hearthstone' }, tgt: c, t: 0, total: HEARTH_CAST, ch: true, hearth: true, onEnd: () => hearthArrive(c) };
  log('Hearthstone: going home to ' + c.bind.zone + ' ...'); fx(c.pos.x, c.pos.y, 'Hearthstone', '#9fe0ff');
  return true;
}
/* the cast is over: at the inn */
function hearthArrive(c) {
  const r = rt(c); const b = c.bind; if (!b) return;
  const from = c.pos.map;
  c.pos = { map: b.map, x: b.x + 1.5, y: b.y + 1.5, z: c.pos.z, o: c.pos.o };
  r.mv = null; r.tgt = null; r.threats = []; r.interact = null; r.charging = null; r.tame = null; r.dgReturn = null;
  c.hearthCd = G.gameTime + HEARTH_CD;
  const o = c.order;
  if (o && (o.type === 'dungeon' || o.type === 'travel' || o.type === 'npc' || o.type === 'vendor' || o.type === 'sell' || o.type === 'follow')) { r.party = null; c.order = o.type === 'dungeon' || o.type === 'npc' ? o.resume || null : null; }
  if (c.order && typeof resumeOrder === 'function') resumeOrder(c, c.order);
  log('Arrived home: ' + b.zone + ' (Hearthstone ready again in ' + fmtTime(HEARTH_CD) + ').'); fx(c.pos.x, c.pos.y, 'Home', '#ffd866');
  if (from !== c.pos.map && typeof loadGrid === 'function') loadGrid(c.pos.map);
  if (isActive(c) && !G.headless && $('follow') && $('follow').checked && typeof goToCharacter === 'function') goToCharacter();
  save(); renderOrder(); if (typeof refreshGear === 'function') refreshGear();
}
/* the cast breaks when something attacks (castStep) */
function hearthInterrupted(c) { const r = rt(c); r.cast = null; log('Hearthstone interrupted.'); fx(c.pos.x, c.pos.y, 'interrupted', '#ffb36b'); }

/* a new home: walk (fly, sail) to the innkeeper and make that inn the home */
function orderInn(c, v) {
  if (v.map === c.pos.map && Math.hypot(v.x - c.pos.x, v.y - c.pos.y) <= 8) { hearthBindTo(c, v); return true; }
  const far = v.map !== c.pos.map || Math.hypot(v.x - c.pos.x, v.y - c.pos.y) > 600;
  const trip = far ? planTrip(c, { map: v.map, x: v.x, y: v.y }) : null;
  if (v.map !== c.pos.map && !trip) { log('No way to ' + v.name + ' found.'); return false; }
  c.order = { type: 'npc', kind: 'inn', e: v.e, map: v.map, x: v.x, y: v.y, trip, label: v.name + ' (' + innZone(v) + ')', resume: c.order && c.order.type !== 'npc' ? c.order : null, t0: G.gameTime };
  rt(c).mv = null; rt(c).tgt = null; log('Order: go to ' + c.order.label + ' and make it the home inn.');
  save(); renderOrder(); return true;
}
function innArrive(c, o) {
  const v = innkeepers().find((x) => x.e === o.e && x.map === o.map && Math.abs(x.x - o.x) < 1 && Math.abs(x.y - o.y) < 1) || { e: o.e, map: o.map, x: o.x, y: o.y, name: o.label };
  hearthBindTo(c, v);
  c.order = o.resume || null; if (c.order) { c.order.wait = 0; resumeOrder(c, c.order); }
  renderOrder(); save(); if (SH.open) renderSheet();
}

/* ------------------------------------------------------------------ the Hearthstone in the Bags window */
const HS = { pick: '' };
function hearthHtml(c) {
  const why = hearthWhy(c); const left = hearthLeft(c);
  let h = '<div class="sgroup hearth"><h5>Hearthstone</h5>' +
    statRow('Home', c.bind ? esc(c.bind.zone) + ' <span class="muted small">(' + esc(c.bind.name) + ')</span>' : 'none') +
    statRow('Ready', left > 0 ? 'in ' + fmtTime(left) : '<span style="color:#1eff00">now</span>');
  h += '<div class="vbtns"><button class="act" data-hs="use"' + (why ? ' disabled title="' + esc(why) + '"' : ' title="10 second cast, then you are at your inn"') + '>Use Hearthstone</button>';
  const near = c.pos && innkeepers().find((v) => v.map === c.pos.map && innUsable(c, v) && Math.hypot(v.x - c.pos.x, v.y - c.pos.y) <= 8);
  if (near && (!c.bind || c.bind.e !== near.e || Math.abs(c.bind.x - near.x) > 1)) h += ' <button class="mini" data-hs="here">Make this inn your home</button>';
  h += '</div>';
  // the capitals of its side: one click to go there and make it home
  const caps = Object.entries(CAPITAL_INNS).filter(([, x]) => x[1] === charSide(c)).map(([e]) => innkeepers().find((v) => v.e === +e)).filter(Boolean);
  if (caps.length) h += '<div class="hscity"><span class="small muted">Major cities:</span> ' + caps.map((v) => { const home = c.bind && c.bind.e === v.e; return '<button class="mini' + (home ? ' on' : '') + '" data-hs="city:' + v.e + '"' + (home ? ' disabled title="Your home now"' : ' title="Go to ' + esc(v.name) + ' and make ' + esc(innZone(v)) + ' your home"') + '>' + esc(innZone(v)) + (home ? ' (home)' : '') + '</button>'; }).join(' ') + '</div>';
  // every inn the character can use: this continent first, by distance
  const list = innkeepers().filter((v) => innUsable(c, v)).map((v) => ({ v, d: v.map === c.pos.map ? Math.hypot(v.x - c.pos.x, v.y - c.pos.y) : 1e7 + v.map }))
    .sort((a, b) => a.d - b.d);
  const seen = new Set(); const opts = [];
  for (const x of list) { const k = x.v.e + ':' + Math.round(x.v.x); if (seen.has(k)) continue; seen.add(k); opts.push(x); }
  h += '<div class="hsnew"><select data-hspick="1"><option value="">Choose a new home inn...</option>' + opts.map((x) => {
    const k = x.v.e + ':' + Math.round(x.v.x) + ':' + Math.round(x.v.y) + ':' + x.v.map;
    return '<option value="' + k + '"' + (HS.pick === k ? ' selected' : '') + '>' + esc(innZone(x.v)) + ' - ' + esc(x.v.name) + (x.v.map === c.pos.map ? ' (' + Math.round(x.d) + ' yd)' : ' (' + (x.v.map === 0 ? 'Eastern Kingdoms' : 'Kalimdor') + ')') + '</option>';
  }).join('') + '</select> <button class="mini" data-hs="go"' + (HS.pick ? '' : ' disabled') + '>Go and make it home</button></div>';
  return h + '<div class="small muted">Talk to an innkeeper to make that inn your home; the Hearthstone takes you there from anywhere (also out of a dungeon) and then needs 30 minutes.</div></div>';
}
function innByKey(k) { const [e, x, y, map] = k.split(':').map(Number); return innkeepers().find((v) => v.e === e && v.map === map && Math.round(v.x) === x && Math.round(v.y) === y) || null; }
function hearthClick(e) {
  const b = e.target.closest('[data-hs]'); if (!b) return false; const c = active();
  if (b.dataset.hs === 'use') { if (hearthUse(c)) closeSheet(); else renderSheet(); return true; }
  if (b.dataset.hs === 'here') { const v = innkeepers().find((x) => x.map === c.pos.map && innUsable(c, x) && Math.hypot(x.x - c.pos.x, x.y - c.pos.y) <= 8); if (v) hearthBindTo(c, v); renderSheet(); return true; }
  if (b.dataset.hs.startsWith('city:')) { const v = innkeepers().find((x) => x.e === +b.dataset.hs.slice(5)); if (v && orderInn(c, v)) closeSheet(); return true; }
  if (b.dataset.hs === 'go') { const v = HS.pick && innByKey(HS.pick); if (v && orderInn(c, v)) { HS.pick = ''; closeSheet(); } return true; }
  return false;
}
function hearthChange(e) { if (!e.target.dataset || !e.target.dataset.hspick) return false; HS.pick = e.target.value; renderSheet(); return true; }
function hearthTipLine(c, id) {
  if (id !== HEARTHSTONE) return '';
  return '<div style="color:#1eff00">Use: returns you to ' + esc(c.bind ? c.bind.zone : 'your home inn') + '. Speak to an innkeeper in a different place to change your home location.</div>' +
    '<div class="small">10 s cast, 30 min cooldown' + (hearthLeft(c) > 0 ? ' - ready in ' + fmtTime(hearthLeft(c)) : '') + '</div>';
}
/* the home on the map: a small house */
function drawHome(ctx, m, c) {
  const b = c.bind; if (!b || b.map !== m.map || m.cont) return; if (typeof inMap === 'function' && !inMap(m, b.x, b.y)) return;
  const [x, y] = w2s(b.x, b.y);
  ctx.save(); ctx.fillStyle = '#ffd866'; ctx.strokeStyle = '#1a1409'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 7, y - 2); ctx.lineTo(x + 5, y - 2); ctx.lineTo(x + 5, y + 6); ctx.lineTo(x - 5, y + 6); ctx.lineTo(x - 5, y - 2); ctx.lineTo(x - 7, y - 2); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.restore();
}
