'use strict';
/* trade.js - trading between your characters, like the trade window of the game: both stand close together (10 yards),
   each side puts up to 6 items and some money on the table, both accept, and everything changes hands at once.
   Soulbound (bind on pickup) and quest items cannot be traded. The "Trade" tab of the character window. */

const TRADE_RANGE = 10, TRADE_SLOTS = 6;
const TR = { with: null, mine: [], theirs: [], goldMine: 0, goldTheirs: 0 };

function tradePartners(c) { return G.state.characters.filter((o) => o !== c && !rt(o).ghost); }
function tradeNear(c, o) { return o && o.pos.map === c.pos.map && Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) <= TRADE_RANGE; }
function tradable(inst) { const it = itemRow(inst.id); return !(it && (it.bo === 1 || it.bo === 4)) && !inst.bound; }
function tradeReset(keepWith) { TR.mine = []; TR.theirs = []; TR.goldMine = 0; TR.goldTheirs = 0; if (!keepWith) TR.with = null; }
/* the items on the table (as bag indexes) that are still there */
function tradeClean(c, o) {
  TR.mine = TR.mine.filter((i) => c.bags[i] && tradable(c.bags[i]));
  TR.theirs = o ? TR.theirs.filter((i) => o.bags[i] && tradable(o.bags[i])) : [];
  TR.goldMine = clamp(Math.floor(TR.goldMine || 0), 0, c.gold); TR.goldTheirs = o ? clamp(Math.floor(TR.goldTheirs || 0), 0, o.gold) : 0;
}
function tradeAdd(c, idx) {
  const inst = c.bags[idx]; if (!inst) return;
  if (!tradable(inst)) { log(itemName(inst.id, inst) + ' is soulbound and cannot be traded.'); return; }
  if (TR.mine.includes(idx)) return; if (TR.mine.length >= TRADE_SLOTS) { log('The trade window is full (6 items).'); return; }
  TR.mine.push(idx);
}
/* both accept: the items and the money change hands at once, or nothing happens */
function tradeAccept(c) {
  const o = charById(TR.with); if (!o) return;
  if (!tradeNear(c, o)) { log(o.name + ' is too far away to trade (stand within ' + TRADE_RANGE + ' yards).'); return; }
  tradeClean(c, o);
  const give = TR.mine.map((i) => c.bags[i]), take = TR.theirs.map((i) => o.bags[i]);
  if (!give.length && !take.length && !TR.goldMine && !TR.goldTheirs) { log('Nothing to trade.'); return; }
  if (bagCapacity(c) - (c.bags.length - give.length) < take.length) { log('Not enough room in your bags for the trade.'); return; }
  if (bagCapacity(o) - (o.bags.length - take.length) < give.length) { log(o.name + ' has not enough room in the bags for the trade.'); return; }
  c.bags = c.bags.filter((x) => !give.includes(x)); o.bags = o.bags.filter((x) => !take.includes(x));
  for (const x of give) o.bags.push(x); for (const x of take) c.bags.push(x);
  c.gold += TR.goldTheirs - TR.goldMine; o.gold += TR.goldMine - TR.goldTheirs;
  const desc = (list, g) => list.map((x) => (x.n > 1 ? x.n + ' x ' : '') + itemName(x.id, x)).concat(g ? [money(g)] : []).join(', ') || 'nothing';
  log('Trade with ' + o.name + ' done. You gave ' + desc(give, TR.goldMine) + ' and got ' + desc(take, TR.goldTheirs) + '.');
  withLog(o, () => log('Trade with ' + c.name + ' done. You gave ' + desc(take, TR.goldTheirs) + ' and got ' + desc(give, TR.goldMine) + '.'));
  for (const x of take) if (questNeeds(c, x.id)) onItemGained(c, x.id);
  for (const x of give) if (questNeeds(o, x.id)) withLog(o, () => onItemGained(o, x.id));
  autoEquip(o); if (o.prof) withLog(o, () => checkRecipeItems(o)); tradeReset(true); save(); refreshGear();
}
function tradeSlotHtml(list, owner, side) {
  let h = '<div class="tr-slots">';
  for (let k = 0; k < TRADE_SLOTS; k++) {
    const i = list[k]; const x = i != null ? owner.bags[i] : null;
    h += x ? '<div class="slot" data-trrem="' + side + ':' + k + '" data-iid="' + x.id + '" title="Click to take it back">' + iconHtml(x) + '</div>' : '<div class="slot empty"></div>';
  }
  return h + '</div>';
}
function tradeHtml(c) {
  const ps = tradePartners(c);
  if (!ps.length) return '<div class="muted">Trading is between your own characters - make another one first (Characters - New).</div>';
  let o = charById(TR.with); if (!o || o === c) { o = ps.find((x) => tradeNear(c, x)) || ps[0]; TR.with = o.id; tradeReset(true); }
  tradeClean(c, o);
  const near = tradeNear(c, o); const dist = o.pos.map === c.pos.map ? Math.round(Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y)) : null;
  let h = '<div class="trade"><div class="vhead"><b>Trade with</b> <select data-trwith="1">' + ps.map((x) => '<option value="' + x.id + '"' + (x === o ? ' selected' : '') + '>' + esc(x.name) + ' (' + x.level + ' ' + CLASS_NAMES[x.cls] + ')</option>').join('') + '</select> ' +
    (near ? '<span class="up small">in reach</span>' : '<span class="down small">' + (dist == null ? 'on another map' : dist + ' yards away') + '</span> <button class="mini" data-trgo="1">Walk to ' + esc(o.name) + '</button>') + '</div>';
  h += '<div class="tr-cols"><div class="tr-col"><h5>' + esc(c.name) + ' gives</h5>' + tradeSlotHtml(TR.mine, c, 'm') +
    '<div class="small">Money: <input type="number" min="0" step="1" data-trgold="m" value="' + Math.floor(TR.goldMine / 100) + '" style="width:70px"> silver <span class="muted">(you have ' + money(c.gold) + ')</span></div>' +
    '<div class="small muted">Click an item in your bags (right) to put it on the table.</div></div>';
  h += '<div class="tr-col"><h5>' + esc(o.name) + ' gives</h5>' + tradeSlotHtml(TR.theirs, o, 't') +
    '<div class="small">Money: <input type="number" min="0" step="1" data-trgold="t" value="' + Math.floor(TR.goldTheirs / 100) + '" style="width:70px"> silver <span class="muted">(' + esc(o.name) + ' has ' + money(o.gold) + ')</span></div>' +
    '<div class="small muted">' + esc(o.name) + '\'s bags - click to ask for an item:</div><div class="grid tr-their">';
  o.bags.forEach((x, i) => { const ok = tradable(x); const on = TR.theirs.includes(i); h += '<div class="slot' + (on ? ' sel' : '') + (ok ? '' : ' locked') + '" data-trtake="' + i + '" data-iid="' + x.id + '" title="' + esc(itemName(x.id, x)) + (ok ? '' : ' - soulbound') + '">' + iconHtml(x) + (ok ? '' : '<i class="red"></i>') + '</div>'; });
  h += '</div></div></div>';
  h += '<p><button class="act" data-trok="1"' + (near ? '' : ' disabled') + '>Trade</button> <button class="mini" data-trclear="1">Clear</button></p></div>';
  return h;
}
function tradeClick(e) {
  if (SH.tab !== 'trade') return false; const c = active(); const t = e.target; let b;
  if ((b = t.closest('[data-trgo]'))) { const o = charById(TR.with); if (o) { orderTravel(c, { map: o.pos.map, x: o.pos.x, y: o.pos.y }, o.name); closeSheet(); } return true; }
  if ((b = t.closest('[data-trok]'))) { tradeAccept(c); renderSheet(); return true; }
  if ((b = t.closest('[data-trclear]'))) { tradeReset(true); renderSheet(); return true; }
  if ((b = t.closest('[data-trrem]'))) { const [side, k] = b.dataset.trrem.split(':'); (side === 'm' ? TR.mine : TR.theirs).splice(+k, 1); renderSheet(); return true; }
  if ((b = t.closest('[data-trtake]'))) {
    const o = charById(TR.with); const i = +b.dataset.trtake; const x = o && o.bags[i]; if (!x) return true;
    if (!tradable(x)) log(itemName(x.id, x) + ' is soulbound and cannot be traded.');
    else if (TR.theirs.includes(i)) TR.theirs.splice(TR.theirs.indexOf(i), 1);
    else if (TR.theirs.length < TRADE_SLOTS) TR.theirs.push(i);
    renderSheet(); return true;
  }
  // an item in your own bags: on the table
  if ((b = t.closest('#sheetBags [data-idx]'))) { const i = +b.dataset.idx; if (TR.mine.includes(i)) TR.mine.splice(TR.mine.indexOf(i), 1); else tradeAdd(c, i); renderSheet(); return true; }
  return false;
}
function tradeChange(e) {
  if (SH.tab !== 'trade') return false; const t = e.target;
  if (t.dataset.trwith) { TR.with = t.value; tradeReset(true); setTimeout(renderSheet, 0); return true; }
  if (t.dataset.trgold) { const v = Math.max(0, Math.round(+t.value || 0)) * 100; if (t.dataset.trgold === 'm') TR.goldMine = v; else TR.goldTheirs = v; setTimeout(renderSheet, 0); return true; }
  return false;
}
