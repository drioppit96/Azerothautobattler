'use strict';
/* farm.js - farming profession materials (Automation: "Profession materials"): leather, ore, herbs or cloth, and which one.
   - Leather: the beasts that give it when skinned (skinning.json), the character needs Skinning and the skill for them.
   - Ore / herbs: the veins and plants that give it (their loot), the character needs Mining / Herbalism and the skill
     for them; it walks from node to node in the area and gathers them.
   - Cloth: the creatures that drop it (their loot tables), anyone can.
   The place: where the most of it comes from for the character (its level, its skill), weighed by how far it is (by
   flight path, boat and zeppelin when far) and away from creatures too strong for it. Full bags: the junk is sold,
   then the materials go into the bank and the farming goes on. "Farm it whenever there is nothing else to do" starts
   it by itself when the character is idle. */

const FARM_KINDS = {
  leather: { n: 'Leather', skill: 393, items: [2934, 2318, 783, 2319, 4232, 4234, 4235, 4304, 8169, 8170, 8171] },
  ore: { n: 'Ore', skill: 186, items: [2770, 2771, 2772, 2775, 2776, 3858, 7911, 10620, 11370] },
  herb: { n: 'Herbs', skill: 182, items: [0, 2447, 765, 2449, 785, 2450, 3820, 2453, 3355, 3369, 3356, 3357, 3818, 3821, 3358, 3819, 4625, 8831, 8836, 8838, 8839, 8845, 8846, 13464, 13463, 13465, 13466, 13467, 13468] },
  cloth: { n: 'Cloth', skill: 0, items: [2589, 2592, 4306, 4338, 14047, 14256] },
};
/* item 0 of herbs: every herb the character can gather in the place */
const FARM_ALL_HERBS = () => FARM_KINDS.herb.items.filter((x) => x);
function farmItemName(item) { return item ? itemName(item) : 'all herbs'; }
function farmIsMine(o, id) { return o && (o.item ? id === o.item : o.kind === 'herb' && FARM_ALL_HERBS().includes(id)); }
function farmCount(c, o) { return o.item ? bagCount(c, o.item) : FARM_ALL_HERBS().reduce((t, id) => t + bagCount(c, id), 0); }
/* herbs and ore come from nodes (gathered on a round), leather and cloth from creatures */
function farmNode(kind) { return kind === 'ore' || kind === 'herb'; }
const FARM_CELL = { mob: 200, node: 450 };

function farmOf(c) { if (!c.farm) c.farm = { kind: 'cloth', item: 2589, idle: false }; return c.farm; }
function farmNeeds(c, kind) { const s = FARM_KINDS[kind].skill; return s && !hasProf(c, s) ? profName(s) : null; }

/* where it comes from, for this character: [{e, p (how much per kill / per vein), lo, hi, req}] */
function farmSources(c, kind, item) {
  const out = []; const L = G.d.loot;
  if (kind === 'cloth') {
    for (const e in L.creatures) {
      const row = (L.tables.creature[L.creatures[e][6]] || []).find((x) => x[0] === item); if (!row || row[1] < 1.5) continue;
      out.push({ e: +e, p: row[1] / 100 * (row[2] + row[3]) / 2 });
    }
  } else if (kind === 'leather') {
    for (const s of G.d.skinning || []) {
      if (s.kind !== 'Skinning') continue; const l = (s.loot || []).find((x) => x.item === item); if (!l) continue;
      const sum = s.loot.reduce((t, x) => t + (x.chance || 0), 0);
      out.push({ e: s.entry, p: (sum <= 110 ? l.chance / Math.max(1, sum) : l.chance / 100) * ((l.min || 1) + (l.max || 1)) / 2, req: skinReq(s.max_level || 1) });
    }
  } else {
    const P = G.d.prof, go = G.d.go;
    if (P && go) for (const e in P.nodes) {
      const [k, req] = P.nodes[e]; if (k !== kind) continue; const g = go.objects[e]; const rows = g && go.loot[g[2]];
      if (!item) { if (rows && rows.length) out.push({ e: +e, p: 1, req, node: true }); continue; }        // all herbs: every plant counts
      const row = rows && rows.find((x) => x[0] === item); if (!row) continue;
      out.push({ e: +e, p: row[1] / 100 * (row[2] + row[3]) / 2, req, node: true });
    }
  }
  for (const s of out) if (!s.node) { const m = G.mobIdx[s.e]; s.lo = m ? m[2] : 1; s.hi = m ? m[3] : 1; s.rank = m ? m[4] : 0; }
  return out;
}
/* the ones this character can take on */
function farmUsable(c, kind, s) {
  if (s.node) return profSkill(c, FARM_KINDS[kind].skill) >= s.req;
  if (s.rank >= 1 || s.hi > c.level + 1) return false;
  if (kind === 'leather' && profSkill(c, 393) < s.req) return false;
  const b = behOf({ e: s.e }, c); if (b !== 'A' && b !== 'N') return false;
  const h = G.d.hostility.creatures[s.e]; if (h && h[5]) return false;                 // civilians
  if (c.rep && G.d.rep && repKillHurts(c, s.e)) return false;
  if (typeof eventMob === 'function' && eventMob(s.e)) return false;
  return true;
}
/* creatures too strong for the character standing around a spot (from the spawn lists, per 200-yard cell) */
function farmDangerAt(c, map, x, y) {
  G.farmDg = G.farmDg || {};
  if (!G.farmDg[map]) {
    const g = new Map(); for (const [e, list] of G.spawnList) { const m = G.mobIdx[e]; if (!m) continue; for (const s of list) { if (s[0] !== map) continue; const k = Math.floor(s[1] / 200) + ',' + Math.floor(s[2] / 200); let a = g.get(k); if (!a) g.set(k, a = []); a.push([e, m[3], m[4]]); } }
    G.farmDg[map] = g;
  }
  const g = G.farmDg[map]; const cx = Math.floor(x / 200), cy = Math.floor(y / 200); let n = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [e, hi, rank] of g.get((cx + i) + ',' + (cy + j)) || []) {
    if (hi < c.level + 4 && !(rank >= 1 && hi > c.level - 4)) continue;
    if (behOf({ e }, c) === 'A') n++;
  }
  return n;
}
/* the best place: {map, x, y, score, entries, nodes, names, lo, hi} or null */
function farmSpot(c, kind, item) {
  const key = [c.id, kind, item, c.level, FARM_KINDS[kind].skill ? profSkill(c, FARM_KINDS[kind].skill) : 0, c.pos.map, Math.round(c.pos.x / 300), Math.round(c.pos.y / 300)].join(':');
  G.farmSpots = G.farmSpots || {}; if (key in G.farmSpots) return G.farmSpots[key];
  const srcs = farmSources(c, kind, item).filter((s) => farmUsable(c, kind, s)); const node = farmNode(kind); const C = node ? FARM_CELL.node : FARM_CELL.mob;
  const cells = new Map();
  const byZone = kind === 'herb' && !item;        // all herbs: a whole zone, every plant in it on the round
  const hereZ = byZone && typeof zoneAt === 'function' ? zoneAt(c.pos.map, c.pos.x, c.pos.y) : null;
  for (const s of srcs) {
    for (const sp of node ? objSpawns(s.e) : G.spawnMap.get(s.e) || []) {
      if (sp[0] !== 0 && sp[0] !== 1) continue;
      let k; if (byZone) { const z = typeof zoneAt === 'function' ? zoneAt(sp[0], sp[1], sp[2]) : null; if (!z) continue; k = sp[0] + ':z' + z.i; }
      else k = sp[0] + ':' + Math.floor(sp[1] / C) + ':' + Math.floor(sp[2] / C);
      let a = cells.get(k);
      if (!a) cells.set(k, a = { zi: byZone ? +k.split(':z')[1] : 0, map: sp[0], sc: 0, sx: 0, sy: 0, n: 0, ents: new Set(), pts: [] });
      a.sc += s.p; a.sx += sp[1] * s.p; a.sy += sp[2] * s.p; a.n++; a.ents.add(s.e); if (node) a.pts.push([sp[1], sp[2]]);
    }
  }
  // the closest place that gives enough of it wins (a richer one only when it is not much farther); another continent
  // counts as very far
  let best = null, bs = 0;
  for (const a of cells.values()) {
    if (a.n < (byZone ? 8 : node ? 3 : 4) || (!node && a.sc < 0.6)) continue;
    const x = a.sx / a.sc, y = a.sy / a.sc;
    let far = a.map === c.pos.map ? Math.hypot(x - c.pos.x, y - c.pos.y) : 8000;
    if (byZone) { if (a.map === c.pos.map) far = Math.min(...a.pts.map((p) => Math.hypot(p[0] - c.pos.x, p[1] - c.pos.y))); /* the zone it is in first */ const here = a.map === c.pos.map && hereZ && a.zi === hereZ.i; const sc = (here ? 1e6 : 0) + Math.sqrt(a.n) / (1 + far / 800); if (sc > bs) { bs = sc; best = Object.assign(a, { x, y, score: sc }); } continue; }
    let sc = Math.sqrt(a.sc) / (1 + far / 400);
    const dg = farmDangerAt(c, a.map, x, y); if (dg > 2) sc *= 0.15; else if (dg) sc *= 0.6;
    if (sc > bs) { bs = sc; best = Object.assign(a, { x, y, score: sc }); }
    // creatures: the nearest group that gives a fair amount (3 or more in a round) and has nothing too strong about
    if (!node && a.sc >= 2.5 && dg <= 1) { const d = far / (dg ? 0.7 : 1); if (!a.near || d < a.near) a.near = d; }
  }
  if (!node) { let nb = null; for (const a of cells.values()) if (a.near && (!nb || a.near < nb.near)) nb = a; if (nb) best = Object.assign(nb, { x: nb.sx / nb.sc, y: nb.sy / nb.sc, score: nb.sc }); }
  if (best) {
    const es = [...best.ents]; best.entries = node ? null : es; best.nodes = node ? es : null;
    best.names = [...new Set(es.map((e) => node ? ((G.d.go.objects[e] || [])[0] || 'vein') : (G.mobIdx[e] || [0, 'creature'])[1]))].slice(0, 4);
    if (!node) { best.lo = Math.min(...es.map((e) => (G.mobIdx[e] || [0, 0, 1])[2])); best.hi = Math.max(...es.map((e) => (G.mobIdx[e] || [0, 0, 0, 1])[3])); }
    const z = typeof zoneAt === 'function' ? zoneAt(best.map, best.x, best.y) : null; best.zone = z ? z.name : '';
    if (byZone) { const z0 = zoneAt(best.map, best.pts[0][0], best.pts[0][1]); if (z0) best.zone = z0.name; best.span = Math.max(...best.pts.map((p) => Math.hypot(p[0] - best.x, p[1] - best.y))) + 250; }
  }
  return (G.farmSpots[key] = best);
}
/* why it cannot be farmed (null: it can) */
function farmWhy(c, kind, item) {
  const need = farmNeeds(c, kind); if (need) return 'needs ' + need;
  const all = farmSources(c, kind, item); if (!all.length) return 'nothing in the world gives it';
  if (!farmSpot(c, kind, item)) {
    if (farmNode(kind)) { const sk = FARM_KINDS[kind].skill; const req = Math.min(...all.map((s) => s.req)); if (profSkill(c, sk) < req) return 'needs ' + profName(sk) + ' ' + req + ' (you have ' + profSkill(c, sk) + ')'; }
    if (kind === 'leather') { const req = Math.min(...all.map((s) => s.req)); if (profSkill(c, 393) < req) return 'needs Skinning ' + req + ' (you have ' + profSkill(c, 393) + ')'; }
    const lo = Math.min(...all.filter((s) => !s.node).map((s) => s.lo)); if (lo > c.level + 1) return 'its creatures are level ' + lo + '+';
    return 'no place to farm it for you';
  }
  return null;
}

/* ------------------------------------------------------------------ the order */
function orderFarm(c, kind, item, auto) {
  const why = farmWhy(c, kind, item); if (why) { if (!auto) log('Cannot farm ' + farmItemName(item) + ': ' + why + '.'); return false; }
  const s = farmSpot(c, kind, item);
  const o = { type: 'farm', kind, item, map: s.map, cx: s.x, cy: s.y, radius: farmNode(kind) ? 420 : 170, span: s.span || 0, entries: s.entries, nodes: s.nodes, lvl: c.level,
    label: farmItemName(item), where: (s.zone || 'out there'), have0: 0, banked: 0, t0: G.gameTime, wi: 0 };
  o.have0 = farmCount(c, o);
  if (farmNode(kind)) o.pts = farmTour(s.pts, c);
  c.order = o; rt(c).mv = null; rt(c).tgt = null;
  log('Order: farm ' + farmItemName(item) + ' - ' + (s.zone || 'the best place') + ' (' + s.names.join(', ') + (s.lo ? ', level ' + s.lo + (s.hi > s.lo ? '-' + s.hi : '') : '') + ').');
  save(); renderOrder(); return true;
}
/* the veins in a round, nearest next */
function farmTour(pts, c) {
  const left = pts.slice(); const out = []; let x = c.pos.x, y = c.pos.y;
  while (left.length) { let bi = 0, bd = Infinity; left.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; bi = i; } }); const p = left.splice(bi, 1)[0]; out.push(p); x = p[0]; y = p[1]; }
  return out;
}
function updateFarm(c, o, dt) {
  const r = rt(c);
  // getting there: by flight path, boat or zeppelin when far
  if (o.trip) { const st = tripStep(c, o.trip); if (st === 'busy') return; if (st === 'fail') { log('Could not get to the farming place.'); c.order = null; renderOrder(); return; } o.trip = null; }
  if (c.pos.map !== o.map || Math.hypot(o.cx - c.pos.x, o.cy - c.pos.y) > Math.max(700, o.span || 0)) {
    const t = planTrip(c, { map: o.map, x: o.cx, y: o.cy }); if (!t) { log('No way to the farming place.'); c.order = null; renderOrder(); return; }
    o.trip = t; return;
  }
  if (r.bagFull || bagFree(c) <= 0) { farmBagsFull(c, o); return; }
  // a level up: maybe a better place now
  if (o.lvl !== c.level) { o.lvl = c.level; const s = farmSpot(c, o.kind, o.item); if (s && (s.map !== o.map || Math.hypot(s.x - o.cx, s.y - o.cy) > 400)) { log('A better place to farm ' + farmItemName(o.item) + ' now: ' + (s.zone || 'elsewhere') + '.'); orderFarm(c, o.kind, o.item, true); if (c.order) { c.order.banked = o.banked; c.order.have0 = o.have0; } return; } }
  if (farmNode(o.kind)) {
    if (!(o._set instanceof Set)) o._set = new Set(o.nodes || []);
    if (gatherStep(c, o, 70)) return;
    if (!o.pts || !o.pts.length) return;
    const p = o.pts[o.wi % o.pts.length];
    if (goTo(c, p[0], p[1], 8)) o.wi++;
    else if (r.blocked) { r.blocked = false; o.wi++; }
    return;
  }
  updateGrind(c, o, dt);
}
function farmBagsFull(c, o) {
  if (junkCount(c) && cset(c, 'autoSellJunk') && nearestVendor(c)) { bagsFull(c, o); return; }
  if (bankFree(c) > 0 && orderNpc(c, 'bank', true, o)) { c.order.deposit = true; log('Bags are full - taking the materials to the bank.'); return; }
  log('Bags and bank are full - farming stopped.'); c.order = null; rt(c).mv = null; renderOrder();
}
/* at the bank: the trade goods go in (the farmed ones first), then back to farming */
function farmDeposit(c, o) {
  const back = o.resume; let n = 0, mine = 0;
  const order = c.bags.map((s, i) => ({ s, i })).filter((x) => { const it = itemRow(x.s.id); return it && it.c === 7; }).sort((a, b) => farmIsMine(back, b.s.id) - farmIsMine(back, a.s.id) || b.i - a.i);
  for (const x of order.sort((a, b) => b.i - a.i)) {
    const id = x.s.id, k = x.s.n; if (bankFree(c) <= 0 && !bankOf(c).items.some((y) => y.id === id && y.n < itemStack(id))) continue;
    if (bankPut(c, x.i, true)) { n += k; if (farmIsMine(back, id)) mine += k; }
  }
  log(n ? 'Put ' + n + ' trade goods in the bank.' : 'The bank is full.');
  if (back && back.type === 'farm') back.banked = (back.banked || 0) + mine;
  c.order = n ? back : null; if (c.order) c.order.wait = 0;
  rt(c).bagFull = bagFree(c) <= 0; renderOrder(); save();
}
function farmText(c, o) {
  const got = Math.max(0, farmCount(c, o) - (o.have0 || 0) + (o.banked || 0));
  return { t: 'Farm ' + o.label, d: (o.trip ? 'on the way to ' + o.where : o.where) + ' - ' + got + ' so far' + (o.banked ? ' (' + o.banked + ' in the bank)' : '') };
}
/* idle: start farming by itself (Automation), at most once a minute */
function farmIdle(c) {
  const f = c.farm; if (!f || !f.idle) return; const r = rt(c);
  if (G.gameTime - (r.farmT || -1e9) < 60) return; r.farmT = G.gameTime;
  if (typeof groupOf === 'function' && groupOf(c) && !isLeader(c)) return;
  orderFarm(c, f.kind, f.item, true);
}

/* ------------------------------------------------------------------ the Automation card */
function farmCardHtml(c) {
  const f = farmOf(c); const K = FARM_KINDS[f.kind]; const why = farmWhy(c, f.kind, f.item); const s = !why && farmSpot(c, f.kind, f.item);
  let h = '<div class="aset farmset"><h5>Profession materials</h5><div class="farmrow"><select data-farm="kind">' +
    Object.entries(FARM_KINDS).map(([k, x]) => '<option value="' + k + '"' + (k === f.kind ? ' selected' : '') + '>' + x.n + '</option>').join('') + '</select><select data-farm="item">' +
    K.items.map((id) => '<option value="' + id + '"' + (id === f.item ? ' selected' : '') + '>' + esc(id ? itemName(id) : 'All herbs (every one I can pick there)') + '</option>').join('') + '</select></div>';
  h += '<div class="small ' + (why ? 'bad' : 'muted') + '">' + (why ? esc(farmItemName(f.item)) + ': ' + esc(why) + '.' : 'Best place: ' + esc(s.zone || '?') + ' - ' + esc(s.names.join(', ')) + (s.lo ? ' (level ' + s.lo + (s.hi > s.lo ? '-' + s.hi : '') + ')' : '') + '.') + '</div>';
  h += '<label class="chk"><input type="checkbox" data-farm="idle"' + (f.idle ? ' checked' : '') + '> Farm it whenever there is nothing else to do</label>';
  h += '<button class="mini" data-farm="go"' + (why ? ' disabled' : '') + '>Farm ' + esc(farmItemName(f.item)) + ' now</button></div>';
  return h;
}
function farmCardChange(e) {
  const k = e.target.dataset && e.target.dataset.farm; if (!k) return false; const c = active(); const f = farmOf(c);
  if (k === 'kind') { f.kind = e.target.value; f.item = FARM_KINDS[f.kind].items.find((id) => !farmWhy(c, f.kind, id)) || FARM_KINDS[f.kind].items[0]; }
  else if (k === 'item') f.item = +e.target.value;
  else if (k === 'idle') f.idle = e.target.checked;
  save(); renderSettingsCard(); return true;
}
function farmCardClick(e) {
  const b = e.target.closest && e.target.closest('[data-farm="go"]'); if (!b) return false;
  const c = active(); const f = farmOf(c); orderFarm(c, f.kind, f.item); renderSettingsCard(); return true;
}
