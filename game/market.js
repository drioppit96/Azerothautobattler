'use strict';
/* market.js - the auction house, the mail and the bank.

   There are no other players, so the market is simulated:
   - every item has a fair price, worked out from the game data: the vendor price, quality, how rare it is (drop
     chances times spawn points, gathering nodes) and how much it is wanted (how many recipes use it);
   - the other sellers' auctions are made up when you look, from the fair price and a seed (item, house, 2-hour
     window), so they are the same every time you look in the same window and change after;
   - what you sell or buy moves the price ("saturation"): flood the market with linen and it gets cheaper, buy out the
     cheap ore and it gets dearer; this fades with game time (half of it in a day);
   - your own auctions sell over time with a chance that depends on your price against the market. The money and the
     items that did not sell come by mail (any mailbox, auctioneer or banker).
   The Alliance auction houses share one market, the Horde ones another; Booty Bay, Gadgetzan and Everlook are neutral
   (both factions, higher cut). */

const AH_HOUSES = [
  { k: 'H', n: 'Orgrimmar', map: 1, x: 1680, y: -4462 }, { k: 'H', n: 'Undercity', map: 0, x: 1600, y: 240 }, { k: 'H', n: 'Thunder Bluff', map: 1, x: -1205, y: 100 },
  { k: 'A', n: 'Stormwind', map: 0, x: -8820, y: 662 }, { k: 'A', n: 'Ironforge', map: 0, x: -4958, y: -908 }, { k: 'A', n: 'Darnassus', map: 1, x: 9862, y: 2341 },
  { k: 'N', n: 'Booty Bay', map: 0, x: -14420, y: 470 }, { k: 'N', n: 'Gadgetzan', map: 1, x: -7239, y: -3804 }, { k: 'N', n: 'Everlook', map: 1, x: 6772, y: -4679 },
];
const AH_SIDE_NAME = { A: 'Alliance', H: 'Horde', N: 'Neutral' };
const AH_CUT = { A: 0.05, H: 0.05, N: 0.15 };
const AH_DURS = [[2, 0.05], [8, 0.10], [24, 0.20]];          // hours, deposit as a share of the vendor price (neutral: x3)
const HORDE_RACES = [2, 5, 6, 8];
const NPC_AUCTIONEER = 4096, NPC_BANKER = 256;
const MAIL_DELAY = 3600;                                       // the money of a sold auction arrives an hour later
const BANK_SLOTS = 24, BANK_BAG_COST = [1000, 10000, 100000, 250000, 500000, 1000000];
const AH_CATS = [['all', 'Everything'], ['weapon', 'Weapons'], ['armor', 'Armor'], ['cons', 'Consumables'], ['trade', 'Trade goods'], ['recipe', 'Recipes'], ['bag', 'Containers'], ['other', 'Other']];
const AH_SYL = ['gar', 'thok', 'mel', 'dra', 'vin', 'zul', 'kor', 'ash', 'bel', 'ryn', 'tal', 'mok', 'shi', 'dor', 'ela', 'grim', 'lor', 'nak', 'fen', 'ul', 'bro', 'kas', 'tyr', 'ves', 'ama', 'jin', 'orn', 'rel'];

/* ------------------------------------------------------------------ helpers */
function mkHash() { let h = 2166136261; for (let a = 0; a < arguments.length; a++) { const s = String(arguments[a]); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= 0x9e37; h = Math.imul(h, 16777619); } return h >>> 0; }
function mkRng(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
function charSide(c) { return HORDE_RACES.includes(c.race) ? 'H' : 'A'; }
function market() {
  const s = G.state; if (!s.market) s.market = {};
  const m = s.market; m.sat = m.sat || {}; m.bought = m.bought || {}; m.auctions = m.auctions || []; m.mail = m.mail || {}; m.seq = m.seq || 1; m.hist = m.hist || {};
  return m;
}
function houseAt(p) { let best = null, bd = 600; for (const h of AH_HOUSES) { if (h.map !== p.map) continue; const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; best = h; } } return best; }
function houseOk(c, k) { return k === 'N' || k === charSide(c); }

/* ------------------------------------------------------------------ NPCs and mailboxes */
function npcsWith(flag, key) {
  if (G[key]) return G[key];
  const out = []; const cr = G.d.hostility.creatures;
  for (const e in cr) {
    if (!(cr[e][9] & flag)) continue; const name = (G.mobIdx[e] || [0, ''])[1] || '';
    if (flag === NPC_AUCTIONEER && !/^Auctioneer/.test(name)) continue;
    for (const s of G.spawnMap.get(+e) || []) { const p = { e: +e, name, map: s[0], x: s[1], y: s[2] }; const h = houseAt(p); p.side = h ? h.k : 'N'; p.house = h; out.push(p); }
  }
  return (G[key] = out);
}
function auctioneers() { return npcsWith(NPC_AUCTIONEER, 'ahNpcs').filter((v) => v.house); }
function bankers() { return npcsWith(NPC_BANKER, 'bankNpcs'); }
function mailboxes() {
  if (G.mailboxes) return G.mailboxes; const out = [];
  const go = G.d.go && G.d.go.objects, ob = G.d.objects && G.d.objects.objects;
  if (go && ob) for (const e in go) if (go[e][1] === 19) for (const s of ob[e] || []) out.push({ e: +e, name: 'Mailbox', map: s[0], x: s[1], y: s[2] });
  return (G.mailboxes = out);
}
function npcUsable(c, v) { return houseOk(c, v.side); }
function npcNear(c, list, range) {
  let best = null, bd = range || 12;
  for (const v of list) { if (v.map !== c.pos.map || !npcUsable(c, v)) continue; const d = Math.hypot(v.x - c.pos.x, v.y - c.pos.y); if (d <= bd) { bd = d; best = v; } }
  return best;
}
function auctioneerNear(c, range) { return npcNear(c, auctioneers(), range); }
function bankerNear(c, range) { return npcNear(c, bankers(), range); }
function mailNear(c) { return npcNear(c, mailboxes(), 10) || auctioneerNear(c) || bankerNear(c); }
/* the closest usable one by the way there (walking, flights, ships); a few candidates by straight distance first */
function npcTrip(c, list) {
  const cand = list.filter((v) => npcUsable(c, v)).sort((a, b) => (a.map !== c.pos.map) - (b.map !== c.pos.map) || Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y));
  let best = null; const seen = new Set();
  for (const v of cand) {
    const k = (v.house ? v.house.n : '') + Math.round(v.x / 60) + ':' + Math.round(v.y / 60); if (seen.has(k)) continue; seen.add(k); if (seen.size > 6) break;
    const trip = planTrip(c, { map: v.map, x: v.x, y: v.y }); if (trip && (!best || trip.secs < best.trip.secs)) best = { v, trip };
  }
  return best;
}
/* walk (fly, sail) to an auctioneer, banker or mailbox; on arrival open the window (or do the automatic visit) */
function orderNpc(c, kind, auto, resume) {
  const list = kind === 'ah' ? auctioneers() : kind === 'bank' ? bankers() : mailboxes().concat(auctioneers(), bankers());
  const b = npcTrip(c, list); if (!b) { log('No ' + (kind === 'ah' ? 'auctioneer' : kind === 'bank' ? 'banker' : 'mailbox') + ' you can reach.'); return false; }
  c.order = { type: 'npc', kind, auto: !!auto, e: b.v.e, map: b.v.map, x: b.v.x, y: b.v.y, trip: b.trip, label: b.v.name + (b.v.house ? ' (' + b.v.house.n + ')' : ''), resume: resume !== undefined ? resume : (c.order && c.order.type !== 'npc' ? c.order : null), t0: G.gameTime };
  rt(c).mv = null; rt(c).tgt = null; if (!auto) log('Order: go to ' + c.order.label + '.');
  save(); renderOrder(); return true;
}
function updateNpcOrder(c, o) {
  if (o.trip) { const st = tripStep(c, o.trip); if (st === 'busy') return; if (st === 'fail') { log('Could not reach ' + o.label + '.'); c.order = o.resume || null; renderOrder(); return; } o.trip = null; }
  if (c.pos.map !== o.map || Math.hypot(o.x - c.pos.x, o.y - c.pos.y) > 5) {
    goTo(c, o.x, o.y, 4);
    if (rt(c).blocked || G.gameTime - o.t0 > 3600) { rt(c).blocked = false; log('Could not reach ' + o.label + '.'); c.order = o.resume || null; renderOrder(); }
    return;
  }
  if (o.kind === 'vendor') { shopArrive(c, o); return; }
  if (o.kind === 'inn') { innArrive(c, o); return; }                  // hearth.js: a new home            // shop.js: Go and buy
  c.order = o.resume || null; if (c.order) { c.order.wait = 0; c.order.noSell = false; }
  collectMail(c, true);
  renderOrder(); save();
  if (!G.headless && isActive(c)) openSheet(o.kind === 'bank' ? 'bank' : 'ah');
}
function npcOrderText(c, o) { return { t: (o.kind === 'ah' ? 'Auction house: ' : o.kind === 'bank' ? 'Bank: ' : o.kind === 'vendor' ? 'Buy ' + (o.buy ? itemName(o.buy) + ' at ' : 'at ') : o.kind === 'inn' ? 'New home: ' : 'Mail: ') + o.label, d: o.trip && o.trip.legs[o.trip.i] ? tripText(o.trip) : 'walking there' }; }

/* ------------------------------------------------------------------ what things are worth */
function marketIndex() {
  if (G.mkIdx) return G.mkIdx;
  const sup = {}, dem = {}, vend = new Set(); const L = G.d.loot;
  // creature drops: spawn points x chance x count
  for (const e in L.creatures) {
    const rows = L.tables.creature[L.creatures[e][6]]; if (!rows) continue; const n = (G.spawnMap.get(+e) || []).length; if (!n) continue;
    for (const [item, pct, mn, mx, q] of rows) if (!q) sup[item] = (sup[item] || 0) + n * pct / 100 * (mn + mx) / 2;
  }
  // gathering: node spawns x what they give
  const P = G.d.prof, go = G.d.go, ob = G.d.objects && G.d.objects.objects;
  if (P && P.nodes && go && ob) for (const e in P.nodes) {
    const g = go.objects[e]; const rows = g && go.loot[g[2]]; const n = (ob[e] || []).length; if (!rows || !n) continue;
    for (const [item, pct, mn, mx] of rows) sup[item] = (sup[item] || 0) + n * pct / 100 * (mn + mx) / 2 * 1.5;
  }
  // skinning (and mining, herb gathering on creatures): spawn points x chance (a skinner gets one in two)
  for (const s of G.d.skinning || []) { const n = (G.spawnMap.get(s.entry) || []).length; if (!n) continue; for (const x of s.loot || []) sup[x.item] = (sup[x.item] || 0) + n * x.chance / 100 * (x.min + x.max) / 2 * 0.5; }
  // demand: how many recipes use it; what goes into a wanted product is wanted too (ore for bars, hides for leather)
  const made = {};
  if (P && P.recipes) {
    for (const id in P.recipes) { const r = P.recipes[id]; for (const [it, k] of r.re || []) dem[it] = (dem[it] || 0) + k; if (r.cr && r.cr[0]) (made[r.cr[0]] = made[r.cr[0]] || []).push(r); }
    for (const id in P.recipes) { const r = P.recipes[id]; const pr = r.cr && r.cr[0]; if (!pr || !dem[pr]) continue; const per = Math.max(1, r.cr[1] || 1); for (const [it, k] of r.re || []) dem[it] += dem[pr] * k / per / Math.max(1, made[pr].length); }
  }
  for (const e in G.d.vendorItems || {}) for (const [id, mc] of G.d.vendorItems[e]) if (!mc) vend.add(id);
  // the reference: a common cloth
  const ref = Math.max(50, sup[2589] || 2000);
  return (G.mkIdx = { sup, dem, vend, ref, made });
}
/* test and placeholder items of the database */
function ahBadName(n) { return /test|deprecated|\bOLD\b|\[PH\]|^QA|Monster -|unused|debug|\(old\)|^zz/i.test(n || ''); }
/* can it go on the auction house at all */
function ahSellable(inst) {
  const it = itemRow(inst.id); if (!it || inst.bound || ahBadName(it.n) || !(it.q || 0)) return false;
  if (it.bo === 1 || it.bo === 4 || it.c === 12 || ((it.fl || 0) & 2)) return false;
  return fairPrice(inst.id) > 0;
}
/* what the materials of the cheapest recipe for it cost (crafted goods) */
function craftCost(id, depth) {
  const X = marketIndex(); const rs = X.made[id]; if (!rs || depth > 3) return 0; let best = 0;
  for (const r of rs) { let s = 0; for (const [it, k] of r.re || []) { const v = X.vend.has(it) ? unitBuy(it) : fairPrice(it, depth + 1); if (!v) { s = 0; break; } s += v * k; } s /= Math.max(1, (r.cr[1] + (r.cr[2] || r.cr[1])) / 2); if (s && (!best || s < best)) best = s; }
  return best;
}
function fairPrice(id, depth) {
  G.mkFair = G.mkFair || {}; if (id in G.mkFair) return G.mkFair[id];
  if ((depth || 0) > 4) return 0; G.mkFair[id] = 0;           // (a loop in the recipes)
  const it = itemRow(id); let sp = itemSell(id); let p = 0;
  const X = marketIndex(); const sup = X.sup[id] || 0, dem = X.dem[id] || 0;
  if (it && !sp && dem > 0 && it.c === 7) sp = Math.max(1, Math.round((it.il || 1) * (it.il || 1) * 0.6));     // enchanting dust and essences: no vendor price
  if (it && sp > 0) {
    if (it.sl && it.sl.length && it.c !== 1) {
      p = sp * ([1, 1.35, 3.5, 8, 14, 20][it.q || 0] || 1);
      if ((it.q || 0) >= 2 && sup > 0) p *= Math.min(2.2, Math.max(0.85, Math.pow(0.4 / sup, 0.12)));     // a rare world drop costs more
      if (it.rl >= 55) p *= 1.25;                                                                        // what level 60s want
    } else if (it.c === 7 || it.c === 5 || dem > 0) {
      const cc = sup > 0 ? 0 : craftCost(id, depth || 0);
      const scar = sup > 0 ? Math.min(60, Math.max(0.6, Math.pow(X.ref / sup, 0.32))) : cc ? 1 : 2.5;
      p = sp * (1.1 + 0.55 * Math.log1p(dem)) * scar;
      if (cc) p = Math.max(cc * 1.12, Math.min(p, cc * 1.6));                                          // crafted: about what its materials cost
    } else if (it.c === 9) p = sp * ((it.q || 1) >= 2 ? 7 : 3.5);
    else if (it.c === 0) { const cc = craftCost(id, depth || 0); p = cc ? Math.max(sp * 1.2, cc * 1.15) : sp * 2.6; }
    else if (it.c === 1) p = sp * 1.6;
    else if (it.c === 6) p = sp * 1.2;
    else p = sp * 1.4;
    if (X.vend.has(id)) p = Math.min(p, unitBuy(id) * 0.95);                // anyone can buy it from a vendor
    p = Math.max(Math.round(p), sp + 1);
  }
  return (G.mkFair[id] = p);
}
/* how many change hands in a day at one market (units) */
function marketVolume(id) {
  const it = itemRow(id); if (!it) return 1; const X = marketIndex();
  if (it.sl && it.sl.length && it.c !== 1) return [4, 4, 3, 1, 0.3, 0.1][it.q || 0] || 1;
  if (itemStack(id) > 1) return Math.min(800, Math.max(6, 120 * Math.pow((X.sup[id] || X.ref * 0.2) / X.ref, 0.5) * (1 + Math.log1p(X.dem[id] || 0) * 0.3)));
  if (it.c === 9) return 0.6;
  return 3;
}
function satOf(k, id) { const s = market().sat[k + ':' + id]; if (!s) return 0; return s[0] * Math.pow(0.5, (G.gameTime - s[1]) / 86400); }
function addSat(k, id, v) { const m = market(); m.sat[k + ':' + id] = [satOf(k, id) + v, G.gameTime]; }
function marketDrift(id) {
  const t = G.gameTime / 86400; const d = Math.floor(t), f = t - d;
  const n0 = mkRng(mkHash('d', id, d))(), n1 = mkRng(mkHash('d', id, d + 1))();
  let k = 1 + 0.18 * ((n0 + (n1 - n0) * f) - 0.5);
  const it = itemRow(id); if (it && it.c === 0 && (d % 7 === 2 || d % 7 === 3)) k *= 1.12;          // raid nights: consumables cost more
  return k;
}
/* the going price of one now, at a market (A, H or N) */
function marketPrice(id, k) {
  const f = fairPrice(id); if (!f) return 0;
  const V = marketVolume(id); const s = satOf(k, id);
  const satK = Math.min(1.8, Math.max(0.4, 1 - 0.45 * s / Math.max(1, V)));
  return Math.max(1, Math.round(f * marketDrift(id) * satK * (k === 'N' ? 1.08 : 1)));
}
function sellerName(rng) { const n = 2 + Math.floor(rng() * 2); let s = ''; for (let i = 0; i < n; i++) s += AH_SYL[Math.floor(rng() * AH_SYL.length)]; return s[0].toUpperCase() + s.slice(1); }
/* the other sellers' auctions of one item right now */
function listings(id, k) {
  const row = itemRow(id); if (!row || !row.q || !(fairPrice(id) > 0) || ahBadName(row.n)) return [];
  const bucket = Math.floor(G.gameTime / 7200); const rng = mkRng(mkHash('L', id, k, bucket));
  const V = marketVolume(id); if (rng() > 1 - Math.exp(-V / 3.5)) return [];
  const it = itemRow(id); const st = itemStack(id); const price = marketPrice(id, k); const out = [];
  const n = 1 + Math.floor(rng() * Math.min(7, 1 + V / 4));
  const gone = market().bought[k + ':' + id + ':' + bucket] || [];
  for (let i = 0; i < n; i++) {
    const cnt = st > 1 ? Math.min(st, [1, 5, 10, 20, 20, st][Math.floor(rng() * 6)]) : 1;
    const unit = Math.max(1, Math.round(price * (0.86 + rng() * 0.42)));
    let rp = 0; if (it && it.rp && G.d.items.random_tmpl[it.rp]) { const t = G.d.items.random_tmpl[it.rp]; let tot = 0; for (const x of t) tot += x[1]; let r = rng() * tot; for (const [pid, ch] of t) { r -= ch; if (r <= 0) { rp = pid; break; } } if (!rp) rp = t[t.length - 1][0]; }
    const seller = sellerName(rng); const left = ['Short', 'Medium', 'Long', 'Very long'][Math.floor(rng() * 4)];
    if (gone.includes(i)) continue;
    out.push({ i, id, n: cnt, unit, rp, seller, left, bucket });
  }
  return out.sort((a, b) => a.unit - b.unit);
}

/* ------------------------------------------------------------------ buying */
function ahBuy(c, id, i, k) {
  const L = listings(id, k).find((x) => x.i === i); if (!L) { log('That auction is gone.'); return false; }
  const cost = L.unit * L.n; if (c.gold < cost) { log('Not enough money.'); return false; }
  const inst = makeInst(id, L.n); if (L.rp) inst.rp = L.rp; const st = itemStack(id);
  let room = bagFree(c) * st; if (st > 1 && !L.rp) for (const s of c.bags) if (s.id === id) room += st - s.n;
  if (room < L.n) { sendMail(c.id, { from: L.seller, sub: 'Auction won: ' + itemName(id, inst), inst, t: G.gameTime }); log('Bags are full - it waits in the mail.'); }
  else if (st > 1 && !L.rp) addItem(c, id, L.n); else c.bags.push(inst);
  c.gold -= cost; const m = market(); const key = k + ':' + id + ':' + L.bucket; (m.bought[key] = m.bought[key] || []).push(i);
  addSat(k, id, -L.n); priceHist(id, k, L.unit);
  log('Bought ' + (L.n > 1 ? L.n + ' x ' : '') + itemName(id, inst) + ' for ' + money(cost) + ' at the auction house.');
  save(); refreshGear(); return true;
}
function priceHist(id, k, unit) { const m = market(); const key = k + ':' + id; const h = (m.hist[key] = m.hist[key] || []); h.push([Math.round(G.gameTime), unit]); if (h.length > 24) h.splice(0, h.length - 24); }

/* ------------------------------------------------------------------ selling */
function ahDeposit(id, n, hours, k) { const d = AH_DURS.find((x) => x[0] === hours) || AH_DURS[1]; return Math.max(1, Math.round(itemSell(id) * n * d[1] * (k === 'N' ? 3 : 1))); }
function ahList(c, idx, unit, hours, k, quiet) {
  const inst = c.bags[idx]; if (!inst || !ahSellable(inst)) { if (!quiet) log('That cannot go on the auction house.'); return false; }
  unit = Math.max(1, Math.round(unit)); const dep = ahDeposit(inst.id, inst.n, hours, k);
  if (c.gold < dep) { if (!quiet) log('Not enough money for the deposit (' + money(dep) + ').'); return false; }
  c.gold -= dep; c.bags.splice(idx, 1); rt(c).bagFull = false;
  const m = market(); m.auctions.push({ a: m.seq++, cid: c.id, k, inst, unit, start: G.gameTime, end: G.gameTime + hours * 3600, dep });
  log('Auction created: ' + (inst.n > 1 ? inst.n + ' x ' : '') + itemName(inst.id, inst) + ' for ' + money(unit * inst.n) + ' (' + hours + ' h, deposit ' + money(dep) + ').');
  save(); refreshGear(); return true;
}
function ahCancel(c, a) {
  const m = market(); const i = m.auctions.findIndex((x) => x.a === a && x.cid === c.id); if (i < 0) return;
  const A = m.auctions.splice(i, 1)[0]; sendMail(c.id, { from: 'Auction house', sub: 'Auction cancelled: ' + itemName(A.inst.id, A.inst), inst: A.inst, t: G.gameTime });
  log('Auction cancelled - the item comes back by mail (the deposit is lost).'); save(); renderSheet();
}
/* every game minute: other players buy (or not) */
function marketTick() {
  const now = G.gameTime; if (now - (G.mkTick || 0) < 60) return; const dt = (now - (G.mkTick || now - 60)) / 3600; G.mkTick = now;
  if (!G.state) return; const m = market(); if (!m.auctions.length) return;
  const me = active();
  for (let i = m.auctions.length - 1; i >= 0; i--) {
    const A = m.auctions[i]; const id = A.inst.id; const mp = marketPrice(id, A.k) || 1; const rho = A.unit / mp;
    const f = Math.min(6, Math.max(0.02, Math.exp(-6 * (rho - 0.95))));
    const h = marketVolume(id) / 24 / Math.max(1, A.inst.n) * f * 0.9;
    if (Math.random() < 1 - Math.exp(-h * Math.min(dt, 2))) {
      m.auctions.splice(i, 1); const gross = A.unit * A.inst.n; const cut = Math.round(gross * AH_CUT[A.k]);
      sendMail(A.cid, { from: 'Auction house', sub: 'Auction successful: ' + itemName(id, A.inst) + (A.inst.n > 1 ? ' x' + A.inst.n : ''), gold: gross - cut + A.dep, t: now + MAIL_DELAY, note: 'Sale ' + money(gross) + ', cut ' + money(cut) + ', deposit back ' + money(A.dep) });
      addSat(A.k, id, A.inst.n); priceHist(id, A.k, A.unit);
      if (me && A.cid === me.id) log('Your auction of ' + itemName(id, A.inst) + (A.inst.n > 1 ? ' x' + A.inst.n : '') + ' sold for ' + money(gross) + ' - the money comes by mail.');
    } else if (now >= A.end) {
      m.auctions.splice(i, 1);
      sendMail(A.cid, { from: 'Auction house', sub: 'Auction expired: ' + itemName(id, A.inst), inst: A.inst, t: now });
      if (me && A.cid === me.id) log('Your auction of ' + itemName(id, A.inst) + ' expired - it comes back by mail.');
    }
  }
  // forget old "bought" windows
  const bucket = Math.floor(now / 7200); for (const key in m.bought) if (+key.split(':')[2] < bucket - 1) delete m.bought[key];
}

/* ------------------------------------------------------------------ mail */
function sendMail(cid, msg) { const m = market(); msg.id = m.seq++; (m.mail[cid] = m.mail[cid] || []).push(msg); }
function mailFor(c) { return (market().mail[c.id] || []).filter((x) => x.t <= G.gameTime); }
function mailWaiting(c) { return mailFor(c).length; }
function collectMail(c, quiet) {
  const m = market(); const box = m.mail[c.id] || []; let gold = 0, items = 0, left = 0;
  for (let i = 0; i < box.length; i++) {
    const x = box[i]; if (x.t > G.gameTime) continue;
    if (x.gold) { gold += x.gold; c.gold += x.gold; x.gold = 0; }
    if (x.inst) { const ok = itemStack(x.inst.id) > 1 && !x.inst.rp ? addItem(c, x.inst.id, x.inst.n) : (bagFree(c) > 0 ? (c.bags.push(x.inst), true) : false); if (ok) { x.inst = null; items++; } else left++; }
    if (!x.gold && !x.inst) { box.splice(i, 1); i--; }
  }
  if (gold || items) log('Mail: ' + (gold ? money(gold) : '') + (gold && items ? ' and ' : '') + (items ? items + ' item' + (items > 1 ? 's' : '') : '') + ' collected.' + (left ? ' ' + left + ' item(s) wait - bags are full.' : ''));
  else if (!quiet) log(left ? 'Bags are full - the mail stays in the mailbox.' : 'No mail.');
  save(); refreshGear(); return gold || items;
}

/* ------------------------------------------------------------------ bank */
function bankOf(c) { if (!c.bank) c.bank = { items: [], bags: [], slots: 0 }; return c.bank; }
function bankCapacity(c) { const b = bankOf(c); let n = BANK_SLOTS; for (const x of b.bags) if (x) n += (itemRow(x.id) || {}).cs || 0; return n; }
function bankFree(c) { return bankCapacity(c) - bankOf(c).items.length; }
function bankPut(c, idx, quiet) {
  const inst = c.bags[idx]; if (!inst) return false; const b = bankOf(c); const st = itemStack(inst.id);
  if (st > 1 && !inst.rp) for (const s of b.items) if (s.id === inst.id && s.n < st) { const k = Math.min(st - s.n, inst.n); s.n += k; inst.n -= k; if (!inst.n) break; }
  if (inst.n > 0) { if (bankFree(c) <= 0) { if (!quiet) log('The bank is full.'); save(); refreshGear(); return false; } b.items.push(inst); }
  c.bags.splice(idx, 1); rt(c).bagFull = false; if (!quiet) log('Put ' + itemName(inst.id, inst) + ' in the bank.'); save(); refreshGear(); return true;
}
function bankTake(c, i) {
  const b = bankOf(c); const inst = b.items[i]; if (!inst) return;
  const ok = itemStack(inst.id) > 1 && !inst.rp ? addItem(c, inst.id, inst.n) : (bagFree(c) > 0 ? (c.bags.push(inst), true) : false);
  if (!ok) { log('Bags are full.'); return; } b.items.splice(i, 1); save(); refreshGear();
}
function bankBuySlot(c) {
  const b = bankOf(c); const cost = BANK_BAG_COST[b.slots]; if (cost == null) return;
  if (c.gold < cost) { log('A bank bag slot costs ' + money(cost) + '.'); return; }
  c.gold -= cost; b.slots++; log('Bought a bank bag slot for ' + money(cost) + '.'); save(); refreshGear();
}
function bankPutBag(c, idx) {
  const b = bankOf(c); const inst = c.bags[idx]; const it = inst && itemRow(inst.id); if (!it || it.c !== 1 || !it.cs) return;
  let slot = -1; for (let i = 0; i < b.slots; i++) if (!b.bags[i]) { slot = i; break; }
  if (slot < 0) { log('No free bank bag slot - buy one first.'); return; }
  b.bags[slot] = inst; c.bags.splice(idx, 1); log('Put ' + itemName(inst.id) + ' in a bank bag slot (+' + it.cs + ' bank slots).'); save(); refreshGear();
}
function bankTakeBag(c, i) {
  const b = bankOf(c); const bag = b.bags[i]; if (!bag) return; const cs = (itemRow(bag.id) || {}).cs || 0;
  if (b.items.length > bankCapacity(c) - cs) { log('Empty the bank first - the items would not fit without that bag.'); return; }
  if (bagFree(c) <= 0) { log('Bags are full.'); return; } b.bags[i] = null; c.bags.push(bag); save(); refreshGear();
}
function bankDepositMats(c, quiet) {
  let n = 0;
  for (let i = c.bags.length - 1; i >= 0; i--) { const it = itemRow(c.bags[i].id); if (it && (it.c === 7 || it.c === 5) && !questWants(c, c.bags[i].id) && bankPut(c, i, true)) n++; }
  if (n || !quiet) log(n ? 'Put ' + n + ' stack' + (n > 1 ? 's' : '') + ' of materials in the bank.' : 'No materials to put away.');
  return n;
}

/* ------------------------------------------------------------------ the windows */
const AHUI = { sub: 'browse', q: '', cat: 'all', lmin: '', lmax: '', usable: false, open: null, sel: null, hours: 24, price: null };
function ahItemCat(it) { return it.c === 2 ? 'weapon' : it.c === 4 ? 'armor' : it.c === 0 ? 'cons' : it.c === 7 || it.c === 5 ? 'trade' : it.c === 9 ? 'recipe' : it.c === 1 || it.c === 11 ? 'bag' : 'other'; }
function ahSearchList() {
  if (G.ahAll) return G.ahAll; const out = [];
  for (const id in G.d.items.items) { const it = G.d.items.items[id]; if (!it.q || it.bo === 1 || it.bo === 4 || it.c === 12 || ((it.fl || 0) & 2) || ahBadName(it.n) || !(fairPrice(+id) > 0)) continue; out.push({ id: +id, n: it.n.toLowerCase(), cat: ahItemCat(it), rl: it.rl || 0, q: it.q || 0 }); }
  out.sort((a, b) => a.rl - b.rl || a.n.localeCompare(b.n));
  return (G.ahAll = out);
}
function ahHtml(c) {
  const v = auctioneerNear(c); const mailN = mailWaiting(c);
  const subs = [['browse', 'Browse'], ['sell', 'Sell'], ['mine', 'My auctions (' + market().auctions.filter((a) => a.cid === c.id).length + ')'], ['mail', 'Mail' + (mailN ? ' (' + mailN + ')' : '')]];
  let h = '<div class="ah">';
  if (!v) {
    const near = mailNear(c);
    h += '<div class="muted">No auctioneer in reach. You can still see your auctions, the mail (at a mailbox) and the settings.</div><p><button class="act" data-ahgo="ah">Go to the nearest auction house</button>' + (mailN && !near ? ' <button class="mini" data-ahgo="mail">Go to a mailbox (' + mailN + ' waiting)</button>' : '') + '</p>';
  } else h += '<div class="vhead"><b>' + esc(v.house.n) + ' auction house</b> <span class="muted">(' + AH_SIDE_NAME[v.side] + ', ' + Math.round(AH_CUT[v.side] * 100) + '% cut)</span></div>';
  h += '<nav class="ahsubs">' + subs.map(([k, t]) => '<button class="mini' + (AHUI.sub === k ? ' on' : '') + '" data-ahsub="' + k + '">' + t + '</button>').join('') + '</nav>';
  const k = v ? v.side : charSide(c);
  if (AHUI.sub === 'browse') h += v ? ahBrowseHtml(c, k) : '<div class="muted small">Browsing needs an auctioneer.</div>';
  else if (AHUI.sub === 'sell') h += v ? ahSellHtml(c, k) : '<div class="muted small">Selling needs an auctioneer.</div>';
  else if (AHUI.sub === 'mine') h += ahMineHtml(c);
  else if (AHUI.sub === 'mail') h += ahMailHtml(c);
  else h += ahMailHtml(c);
  return h + '</div>';
}
function ahRow(c, id, inner, extra) {
  const it = itemRow(id); return '<div class="vrow ahrow"' + (extra || '') + '>' + iconHtml({ id, n: 1 }, ' data-iid="' + id + '"') + '<div class="vname"><span style="color:' + QUALITY_COLORS[it ? it.q || 0 : 1] + '">' + esc(itemName(id)) + '</span>' + inner + '</div></div>';
}
function ahBrowseHtml(c, k) {
  let h = '<div class="ahsearch"><input type="text" id="ahq" placeholder="Search by name" value="' + esc(AHUI.q) + '"><select id="ahcat">' + AH_CATS.map(([v, t]) => '<option value="' + v + '"' + (AHUI.cat === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
    '<input type="number" id="ahlmin" placeholder="Lvl" min="0" max="60" value="' + esc(AHUI.lmin) + '"><input type="number" id="ahlmax" placeholder="to" min="0" max="60" value="' + esc(AHUI.lmax) + '">' +
    '<label class="chk"><input type="checkbox" id="ahusable"' + (AHUI.usable ? ' checked' : '') + '> Usable</label><button class="act" data-ahsearch="1">Search</button></div>';
  if (AHUI.res == null) return h + '<div class="muted small">Search for an item, or pick a category and press Search.</div><div class="sgroup small muted" style="margin-top:10px">The market is simulated: prices come from the vendor price, how rare an item is and how many recipes need it. Selling a lot of one thing lowers its price for a while, buying raises it. Your auctions sell over time - cheaper ones faster - and the money comes by mail. The Horde and the Alliance each have one market; Booty Bay, Gadgetzan and Everlook are neutral and take 15%.</div>';
  const res = AHUI.res; if (!res.length) return h + '<div class="muted small">Nothing on offer right now. Other sellers come and go every two hours.</div>';
  h += '<div class="small muted" style="margin:4px 0">' + res.length + (res.length >= 60 ? '+' : '') + ' items on offer. Click one to see the auctions.</div><div class="ahlist">';
  for (const r of res) {
    const L = listings(r.id, k); if (!L.length) continue; const min = L[0].unit; const cnt = L.reduce((s, x) => s + x.n, 0); const it = itemRow(r.id);
    h += ahRow(c, r.id, '<div class="small">' + (it.rl > 1 ? 'Level ' + it.rl + ' &middot; ' : '') + cnt + ' on offer &middot; from ' + moneyHtml(min) + (cnt > 1 ? ' each' : '') + '</div>', ' data-ahopen="' + r.id + '"');
    if (AHUI.open === r.id) {
      h += '<div class="ahauctions">';
      for (const x of L) { const inst = { id: r.id, n: x.n, rp: x.rp }; const cost = x.unit * x.n;
        h += '<div class="ahauc">' + iconHtml(inst, ' data-ahl="' + r.id + ':' + x.i + '"') + '<span class="aname">' + esc(itemName(r.id, inst)) + (x.n > 1 ? ' x' + x.n : '') + '<br><span class="muted small">' + esc(x.seller) + ' &middot; ' + x.left + '</span></span><span class="small">' + moneyHtml(cost) + (x.n > 1 ? '<br><span class="muted">' + money(x.unit) + ' each</span>' : '') + '</span><button class="mini" data-ahbuy="' + r.id + ':' + x.i + '"' + (c.gold < cost ? ' disabled' : '') + '>Buy</button></div>'; }
      const fp = marketPrice(r.id, k); h += '<div class="small muted">Going price about ' + money(fp) + ' each. Vendor pays ' + money(itemSell(r.id)) + '.</div></div>';
    }
  }
  return h + '</div>';
}
function ahDoSearch(c, k) {
  const q = AHUI.q.trim().toLowerCase(); const lmin = +AHUI.lmin || 0, lmax = +AHUI.lmax || 99; const out = [];
  for (const r of ahSearchList()) {
    if (AHUI.cat !== 'all' && r.cat !== AHUI.cat) continue; if (r.rl < lmin || r.rl > lmax) continue; if (q && r.n.indexOf(q) < 0) continue;
    if (AHUI.usable && itemRow(r.id).sl && itemRow(r.id).sl.length && canEquip(c, r.id)) continue;
    if (!listings(r.id, k).length) continue; out.push(r); if (out.length >= 60) break;
  }
  AHUI.res = out; AHUI.open = out.length === 1 ? out[0].id : null;
}
function ahSellHtml(c, k) {
  let h = '<div class="small muted" style="margin:4px 0">Click an item in your bags (right) to put it up. Whole stacks are sold at once.</div>';
  const inst = AHUI.sel != null ? c.bags[AHUI.sel] : null;
  if (inst && ahSellable(inst)) {
    const mp = marketPrice(inst.id, k); if (AHUI.price == null) AHUI.price = Math.max(itemSell(inst.id) + 1, Math.round(mp * 0.97));
    const dep = ahDeposit(inst.id, inst.n, AHUI.hours, k);
    h += '<div class="ahsell">' + ahRow(c, inst.id, '<div class="small">' + (inst.n > 1 ? inst.n + ' in the stack &middot; ' : '') + 'going price ' + money(mp) + ' each &middot; vendor ' + money(itemSell(inst.id)) + '</div>') +
      '<div class="rgrid"><label>Price each</label><span><input type="number" id="ahg" min="0" value="' + Math.floor(AHUI.price / 10000) + '">g <input type="number" id="ahs" min="0" max="99" value="' + Math.floor(AHUI.price % 10000 / 100) + '">s <input type="number" id="ahc" min="0" max="99" value="' + AHUI.price % 100 + '">c</span>' +
      '<label>Duration</label><select id="ahh">' + AH_DURS.map(([hh]) => '<option value="' + hh + '"' + (AHUI.hours === hh ? ' selected' : '') + '>' + hh + ' hours</option>').join('') + '</select>' +
      '<label>Total</label><span>' + moneyHtml(AHUI.price * inst.n) + '</span><label>Deposit</label><span>' + moneyHtml(dep) + '</span>' +
      '<label>You get</label><span>' + moneyHtml(Math.round(AHUI.price * inst.n * (1 - AH_CUT[k]))) + ' <span class="muted small">after the ' + Math.round(AH_CUT[k] * 100) + '% cut</span></span></div>' +
      '<div class="small" style="color:' + (AHUI.price > mp * 1.15 ? '#ff9a8a' : AHUI.price < mp * 0.9 ? '#9fe09f' : '#cfc6b0') + '">' + (AHUI.price > mp * 1.3 ? 'Far above the going price - it will hardly sell.' : AHUI.price > mp * 1.1 ? 'Above the going price - it sells slowly.' : AHUI.price < mp * 0.9 ? 'Below the going price - it sells fast.' : 'About the going price.') + '</div>' +
      '<p><button class="act" data-ahlist="1"' + (c.gold < dep ? ' disabled' : '') + '>Create auction</button> <button class="mini" data-ahsuggest="1">Undercut a little</button></p></div>';
  } else if (inst) h += '<div class="muted">' + esc(itemName(inst.id, inst)) + ' cannot be sold at the auction house (soulbound, a quest item or worthless).</div>';
  // what is worth selling
  const worth = c.bags.map((x, i) => ({ x, i })).filter((q) => ahSellable(q.x) && marketPrice(q.x.id, k) > itemSell(q.x.id) * 1.5);
  if (worth.length) h += '<h5 style="margin-top:10px">Worth more here than at a vendor</h5>' + worth.map((q) => '<div class="ahauc">' + iconHtml(q.x, ' data-idx="' + q.i + '"') + '<span class="aname">' + esc(itemName(q.x.id, q.x)) + (q.x.n > 1 ? ' x' + q.x.n : '') + '</span><span class="small">' + moneyHtml(marketPrice(q.x.id, k) * q.x.n) + '<br><span class="muted">vendor ' + money(itemSell(q.x.id) * q.x.n) + '</span></span><button class="mini" data-ahpick="' + q.i + '">Sell</button></div>').join('');
  return h;
}
function ahMineHtml(c) {
  const mine = market().auctions.filter((a) => a.cid === c.id); if (!mine.length) return '<div class="muted small">No auctions running.</div>';
  return mine.map((a) => { const left = Math.max(0, a.end - G.gameTime); const mp = marketPrice(a.inst.id, a.k);
    return '<div class="ahauc">' + iconHtml(a.inst) + '<span class="aname">' + esc(itemName(a.inst.id, a.inst)) + (a.inst.n > 1 ? ' x' + a.inst.n : '') + '<br><span class="muted small">' + esc((AH_HOUSES.find((x) => x.k === a.k) || {}).k === 'N' ? 'Neutral' : AH_SIDE_NAME[a.k]) + ' &middot; ' + fmtTime(left) + ' left &middot; going price ' + money(mp) + '</span></span><span class="small">' + moneyHtml(a.unit * a.inst.n) + '</span><button class="mini" data-ahcancel="' + a.a + '">Cancel</button></div>'; }).join('');
}
function ahMailHtml(c) {
  const box = market().mail[c.id] || []; const now = G.gameTime; const near = mailNear(c);
  let h = '<div class="vbtns">' + (near ? '<button class="act" data-ahmail="1"' + (mailWaiting(c) ? '' : ' disabled') + '>Take everything</button>' : '<span class="muted small">Mail is picked up at a mailbox, an auctioneer or a banker.</span> <button class="mini" data-ahgo="mail">Go to a mailbox</button>') + '</div>';
  if (!box.length) return h + '<div class="muted small">No mail.</div>';
  for (const x of box) h += '<div class="ahauc">' + (x.inst ? iconHtml(x.inst) : '<span class="sic"></span>') + '<span class="aname">' + esc(x.sub) + '<br><span class="muted small">' + esc(x.from) + (x.t > now ? ' &middot; arrives in ' + fmtTime(x.t - now) : '') + (x.note ? ' &middot; ' + esc(x.note) : '') + '</span></span><span class="small">' + (x.gold ? moneyHtml(x.gold) : '') + '</span></div>';
  return h;
}
function ahClick(e) {
  const c = active(); const t = e.target; const v = auctioneerNear(c); const k = v ? v.side : charSide(c);
  const q = (sel) => t.closest(sel);
  let b;
  if ((b = q('[data-ahsub]'))) { AHUI.sub = b.dataset.ahsub; renderSheet(); return true; }
  if ((b = q('[data-ahgo]'))) { orderNpc(c, b.dataset.ahgo); closeSheet(); return true; }
  if ((b = q('[data-ahsearch]'))) { ahReadForm(); ahDoSearch(c, k); renderSheet(); return true; }
  if ((b = q('[data-ahbuy]'))) { const [id, i] = b.dataset.ahbuy.split(':').map(Number); ahBuy(c, id, i, k); renderSheet(); return true; }
  if ((b = q('[data-ahopen]'))) { const id = +b.dataset.ahopen; AHUI.open = AHUI.open === id ? null : id; renderSheet(); return true; }
  if ((b = q('[data-ahpick]'))) { AHUI.sel = +b.dataset.ahpick; AHUI.price = null; renderSheet(); return true; }
  if ((b = q('[data-ahsuggest]'))) { const inst = c.bags[AHUI.sel]; if (inst) { const L = listings(inst.id, k); AHUI.price = Math.max(itemSell(inst.id) + 1, L.length ? L[0].unit - 1 : Math.round(marketPrice(inst.id, k) * 0.95)); } renderSheet(); return true; }
  if ((b = q('[data-ahlist]'))) { ahReadForm(); if (AHUI.sel != null && ahList(c, AHUI.sel, AHUI.price, AHUI.hours, k)) { AHUI.sel = null; AHUI.price = null; } renderSheet(); return true; }
  if ((b = q('[data-ahcancel]'))) { ahCancel(c, +b.dataset.ahcancel); return true; }
  if ((b = q('[data-ahmail]'))) { collectMail(c); renderSheet(); return true; }
  return false;
}
function ahReadForm() {
  const g = (id) => document.getElementById(id);
  if (g('ahq')) { AHUI.q = g('ahq').value; AHUI.cat = g('ahcat').value; AHUI.lmin = g('ahlmin').value; AHUI.lmax = g('ahlmax').value; AHUI.usable = g('ahusable').checked; }
  if (g('ahg')) { AHUI.price = Math.max(1, (+g('ahg').value || 0) * 10000 + (+g('ahs').value || 0) * 100 + (+g('ahc').value || 0)); AHUI.hours = +g('ahh').value || 24; }
}
function ahChange(e) {
  const t = e.target;
  if (['ahg', 'ahs', 'ahc', 'ahh'].includes(t.id)) { ahReadForm(); renderSheet(); return true; }
  if (['ahcat', 'ahusable'].includes(t.id)) { ahReadForm(); return true; }
  return false;
}
function ahKey(e) { if (e.key === 'Enter' && e.target && e.target.id === 'ahq') { const c = active(); const v = auctioneerNear(c); ahReadForm(); ahDoSearch(c, v ? v.side : charSide(c)); renderSheet(); return true; } return false; }

function bankHtml(c) {
  const v = bankerNear(c); const b = bankOf(c);
  if (!v) return '<div class="muted">No banker in reach.</div><p><button class="act" data-bkgo="1">Go to the nearest banker</button></p>' + (b.items.length ? '<div class="small muted">In the bank: ' + b.items.length + ' / ' + bankCapacity(c) + ' slots used.</div>' : '');
  let h = '<div class="vhead"><b>' + esc(v.name) + '</b> <span class="muted">(banker)</span></div>' +
    '<div class="vbtns"><button class="mini" data-bksort="1">Sort</button> <button class="mini" data-bkmats="1">Put away trade goods</button> <span class="muted small">Click an item in your bags to put it in, click one here to take it out.</span></div>';
  h += '<div class="bagslots">';
  for (let i = 0; i < 6; i++) { const x = b.bags[i];
    h += i >= b.slots ? '<div class="slot empty bag locked" data-bkbuy="' + i + '" title="' + (i === b.slots ? 'Buy this bank bag slot: ' + money(BANK_BAG_COST[i]) : 'Locked') + '"><span>' + (i === b.slots ? money(BANK_BAG_COST[i]) : '&#128274;') + '</span></div>' :
      x ? '<div class="slot bag" data-bkbag="' + i + '" title="' + esc(itemName(x.id)) + ' - click to take it out">' + iconHtml(x) + '</div>' : '<div class="slot empty bag" title="Free bank bag slot: click a bag in your bags to put it here"><span>Bag</span></div>'; }
  h += '<div class="bagcap">' + b.items.length + ' / ' + bankCapacity(c) + '</div></div><div class="grid bankgrid">';
  for (let i = 0; i < bankCapacity(c); i++) { const s = b.items[i]; h += s ? '<div class="slot" data-bk="' + i + '">' + iconHtml(s) + '</div>' : '<div class="slot empty"></div>'; }
  return h + '</div>';
}
function bankClick(e) {
  const c = active(); const t = e.target; let b;
  if ((b = t.closest('[data-bkgo]'))) { orderNpc(c, 'bank'); closeSheet(); return true; }
  if (!bankerNear(c)) return false;
  if ((b = t.closest('[data-bkmats]'))) { bankDepositMats(c); return true; }
  if ((b = t.closest('[data-bksort]'))) { sortBank(c); return true; }
  if ((b = t.closest('[data-bkbuy]'))) { if (+b.dataset.bkbuy === bankOf(c).slots && confirm('Buy a bank bag slot for ' + money(BANK_BAG_COST[bankOf(c).slots]) + '?')) bankBuySlot(c); return true; }
  if ((b = t.closest('[data-bkbag]'))) { bankTakeBag(c, +b.dataset.bkbag); return true; }
  if ((b = t.closest('[data-bk]'))) { bankTake(c, +b.dataset.bk); return true; }
  return false;
}
/* a line for the item tooltip */
function ahTipLine(c, inst) {
  if (!inst || !ahSellable(inst)) return ''; const k = (auctioneerNear(c) || {}).side || charSide(c); const p = marketPrice(inst.id, k);
  return '<div class="small" style="color:#d9c27a">Auction house: about ' + moneyHtml(p) + (itemStack(inst.id) > 1 ? ' each' : '') + '</div>';
}
