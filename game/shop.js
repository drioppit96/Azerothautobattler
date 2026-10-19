'use strict';
/* shop.js - the Vendor tab's tools: a search over everything the vendors of the world sell (by name and category),
   the closest vendor that has it, and an order to go there and buy it (by flight path and ship when it is far);
   the nearest vendor and repairs. */

const SHOP = { q: '', cat: 'all' };
const SHOP_CATS = [['all', 'All categories'], ['food', 'Food and drink'], ['potion', 'Potions, elixirs, scrolls'], ['reagent', 'Reagents'], ['trade', 'Trade goods'],
  ['ammo', 'Arrows, bullets, quivers'], ['bag', 'Bags'], ['weapon', 'Weapons'], ['armor', 'Armor'], ['recipe', 'Recipes'], ['other', 'Other']];
function shopCat(id) {
  const it = itemRow(id); if (!it) return 'other';
  switch (it.c) {
    case 0: { const u = useInfo(id); return u && (u.kind === 'food' || u.kind === 'drink') ? 'food' : 'potion'; }
    case 1: return 'bag'; case 2: return 'weapon'; case 4: return 'armor'; case 5: return 'reagent';
    case 6: case 11: return 'ammo'; case 7: return 'trade'; case 9: return 'recipe'; default: return 'other';
  }
}
/* every item any vendor sells: [{id, n (lower-case name), cat, v: [vendor spawns]}] */
function shopIndex() {
  if (G.shopIdx) return G.shopIdx;
  const by = new Map();
  for (const v of vendorList()) for (const x of vendorItems(v.e)) {
    let o = by.get(x.id);
    if (!o) { if (!itemRow(x.id)) continue; o = { id: x.id, n: itemName(x.id).toLowerCase(), cat: shopCat(x.id), v: [] }; by.set(x.id, o); }
    o.v.push(v);
  }
  G.shopIdx = [...by.values()].sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
  return G.shopIdx;
}
const CONT_NAME = { 0: 'Eastern Kingdoms', 1: 'Kalimdor' };
/* the closest vendor of an item for this character: same continent by distance, else one on the other continent */
function shopClosest(c, o) {
  let best = null, bd = Infinity;
  for (const v of o.v) {
    if (behOf({ e: v.e }, c) === 'A') continue;           // the other faction's
    const d = v.map === c.pos.map ? Math.hypot(v.x - c.pos.x, v.y - c.pos.y) : 1e6 + (v.map === 0 || v.map === 1 ? 0 : 1e6);
    if (d < bd) { bd = d; best = v; }
  }
  return best ? { v: best, d: bd } : null;
}
function shopResults(c) {
  const q = SHOP.q.trim().toLowerCase(); if (!q && SHOP.cat === 'all') return null;
  const out = [];
  for (const o of shopIndex()) {
    if (SHOP.cat !== 'all' && o.cat !== SHOP.cat) continue;
    if (q && o.n.indexOf(q) < 0) continue;
    const cl = shopClosest(c, o); if (!cl) continue;
    out.push({ o, v: cl.v, d: cl.d });
  }
  // the ones at hand first; a category alone: the closest ones
  out.sort((a, b) => (q ? (a.o.n.indexOf(q) === 0 ? 0 : 1) - (b.o.n.indexOf(q) === 0 ? 0 : 1) : 0) || a.d - b.d);
  return out;
}
function shopHtml(c) {
  const v = vendorNear(c); const rc = repairCost(c);
  let h = '<div class="shop"><div class="vtools"><button class="mini" data-shop="find" title="Walk to the nearest vendor">Find the nearest vendor</button>' +
    '<button class="mini" data-shop="repair"' + (rc ? '' : ' disabled') + ' title="' + (v && v.repair ? 'Repair everything here' : 'Walk to the nearest vendor that repairs') + '">' + (rc ? 'Repair: ' + money(rc) + (v && v.repair ? '' : ' (go there)') : 'Nothing to repair') + '</button>' +
    '<span class="small muted">Durability ' + Math.round(durabilityPct(c) * 100) + '%</span></div>';
  h += '<div class="psearch"><input id="vsQ" type="search" placeholder="Find an item the vendors sell..." value="' + esc(SHOP.q) + '"><select data-shopcat="1">' +
    SHOP_CATS.map(([k, t]) => '<option value="' + k + '"' + (SHOP.cat === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>';
  const res = shopResults(c);
  if (res) {
    h += '<div class="vlist shoplist">';
    if (!res.length) h += '<div class="muted small">No vendor of your faction sells that.</div>';
    for (const x of res.slice(0, 40)) {
      const it = itemRow(x.o.id); const price = itemBuy(x.o.id); const bn = buyCount(x.o.id); const here = v && v.e === x.v.e;
      const where = x.v.map === c.pos.map ? Math.round(x.d) + ' yd' : (CONT_NAME[x.v.map] || 'far away');
      const zone = typeof zoneNameAt === 'function' ? zoneNameAt({ map: x.v.map, x: x.v.x, y: x.v.y }) : '';
      h += '<div class="vrow">' + iconHtml(Object.assign(makeInst(x.o.id, 1), { n: bn }), ' data-iid="' + x.o.id + '"') + '<div class="vname"><span style="color:' + QUALITY_COLORS[itemQuality(x.o.id)] + '" data-iid="' + x.o.id + '">' + esc(itemName(x.o.id)) + '</span>' +
        (it && it.rl > 1 ? ' <span class="small' + (it.rl > c.level ? ' bad' : ' muted') + '">level ' + it.rl + '</span>' : '') +
        '<div class="small">' + moneyHtml(price) + (bn > 1 ? ' for ' + bn : '') + ' &middot; ' + esc(x.v.name) + (zone ? ', ' + esc(zone) : '') + ' &middot; ' + where + (x.o.v.length > 1 ? ' <span class="muted">(' + new Set(x.o.v.map((y) => y.e)).size + ' vendors)</span>' : '') + '</div></div>' +
        (here ? '<button class="mini" data-buyb="' + x.o.id + '"' + (c.gold < price ? ' disabled' : '') + '>Buy</button>' : '<button class="mini" data-shopgo="' + x.o.id + '" data-v="' + x.v.e + ':' + Math.round(x.v.x) + ':' + Math.round(x.v.y) + ':' + x.v.map + '" title="Go to ' + esc(x.v.name) + ' and buy it there">Go and buy</button>') + '</div>';
    }
    if (res.length > 40) h += '<div class="small muted">' + (res.length - 40) + ' more - type more of the name.</div>';
    h += '</div>';
  } else h += '<div class="small muted">Search by name, or choose a category: the closest vendor that sells it is shown, and "Go and buy" walks (flies, sails) there and buys it.</div>';
  return h + '</div>';
}
function shopInput(e) { if (e.target.id !== 'vsQ') return false; SHOP.q = e.target.value; renderSheet(); return true; }
function shopChange(e) { if (!e.target.dataset || !e.target.dataset.shopcat) return false; SHOP.cat = e.target.value; renderSheet(); return true; }
function shopClick(e) {
  const c = active(); const b = e.target.closest('[data-shop],[data-shopgo]'); if (!b) return false;
  if (b.dataset.shop === 'find') { orderVendor(c); closeSheet(); return true; }
  if (b.dataset.shop === 'repair') { const v = vendorNear(c); if (v && v.repair) repairAll(c); else { orderRepair(c); closeSheet(); return true; } renderSheet(); return true; }
  if (b.dataset.shopgo) {
    const [e2, x, y, map] = b.dataset.v.split(':').map(Number); const v = vendorList().find((w) => w.e === e2 && w.map === map && Math.round(w.x) === x && Math.round(w.y) === y);
    if (v && shopGo(c, +b.dataset.shopgo, v)) closeSheet();
    return true;
  }
  return false;
}
/* the order: to the vendor (a trip when it is on another continent or far), buy the item there */
function shopGo(c, id, v) {
  const far = v.map !== c.pos.map || Math.hypot(v.x - c.pos.x, v.y - c.pos.y) > 600;
  const trip = far ? planTrip(c, { map: v.map, x: v.x, y: v.y }) : null;
  if (v.map !== c.pos.map && !trip) { log('No way to ' + v.name + ' found.'); return false; }
  c.order = { type: 'npc', kind: 'vendor', buy: id, e: v.e, map: v.map, x: v.x, y: v.y, trip, label: v.name, resume: c.order && c.order.type !== 'npc' ? c.order : null, t0: G.gameTime };
  rt(c).mv = null; rt(c).tgt = null; log('Order: go to ' + v.name + ' and buy ' + itemName(id) + '.');
  save(); renderOrder(); return true;
}
/* arrived: sell the junk, repair, buy what the order is for */
function shopArrive(c, o) {
  if (cset(c, 'autoSellJunk')) sellJunk(c);
  const vv = vendorList().find((x) => x.e === o.e); if (vv && vv.repair && cset(c, 'autoRepair') && repairCost(c)) repairAll(c);
  if (o.buy) {
    const price = itemBuy(o.buy); const n = buyCount(o.buy);
    if (c.gold < price) log('Not enough money for ' + itemName(o.buy) + ' (' + money(price) + ').');
    else if (!addItem(c, o.buy, n)) log('Bags are full.');
    else { c.gold -= price; log('Bought ' + (n > 1 ? n + ' x ' : '') + itemName(o.buy) + ' for ' + money(price) + '.'); }
  }
  c.order = o.resume || null; if (c.order) { c.order.wait = 0; c.order.noSell = false; }
  renderOrder(); save(); refreshGear();
  if (!G.headless && isActive(c) && !o.resume) openSheet('vendor');
}
