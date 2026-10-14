'use strict';
/* sheet.js - stage 3 UI: character sheet (paper doll + stats), bags, item tooltips, vendor window, gear card. */

const DOLL_LEFT = [0, 1, 2, 14, 4, 3, 18, 8];
const DOLL_RIGHT = [9, 5, 6, 7, 10, 11, 12, 13];
const DOLL_BOTTOM = [15, 16, 17];
const SLOT_LABEL = { 0: 'Head', 1: 'Neck', 2: 'Shoulder', 3: 'Shirt', 4: 'Chest', 5: 'Waist', 6: 'Legs', 7: 'Feet', 8: 'Wrist', 9: 'Hands', 10: 'Finger', 11: 'Finger', 12: 'Trinket', 13: 'Trinket', 14: 'Back', 15: 'Main Hand', 16: 'Off Hand', 17: 'Ranged', 18: 'Tabard' };
const SH = { tab: 'char', open: false, sel: null };

function iconHtml(inst, extra) {
  const id = inst.id; const q = itemQuality(id); const src = itemIcon(id);
  const name = itemName(id, inst);
  const broken = isBroken(inst);
  return '<div class="ico q' + q + (broken ? ' broken' : '') + '"' + (extra || '') + '>' +
    (src ? '<img src="' + src + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
    '<span class="ini">' + esc(name.slice(0, 2)) + '</span>' +
    (inst.n > 1 ? '<b class="cnt">' + inst.n + '</b>' : '') + '</div>';
}
function slotHtml(c, slot) {
  const inst = c.equip[slot];
  if (!inst) return '<div class="slot empty" data-slot="' + slot + '" title="' + SLOT_LABEL[slot] + '"><span>' + SLOT_LABEL[slot] + '</span></div>';
  const md = maxDur(inst.id); const low = md && inst.dur / md < 0.25;
  return '<div class="slot" data-slot="' + slot + '">' + iconHtml(inst) + (low ? '<i class="durw" title="Low durability"></i>' : '') + '</div>';
}
function statRow(k, v, tip) { return '<div class="kv"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><span>' + k + '</span><b>' + v + '</b></div>'; }
function statsHtml(c) {
  const s = charStats(c); const b = baseStats(c); const pct = (x) => x.toFixed(2) + '%';
  const st = (k) => { const d = s[k] - b[k]; return s[k] + (d ? ' <span class="' + (d > 0 ? 'up' : 'down') + '">(' + (d > 0 ? '+' : '') + d + ')</span>' : ''); };
  let h = '<div class="sgroup"><h5>Attributes</h5>' + statRow('Health', Math.round(c.hp) + ' / ' + s.maxHp) + (s.maxMana ? statRow('Mana', s.maxMana) : '') +
    statRow('Strength', st('str')) + statRow('Agility', st('agi')) + statRow('Stamina', st('sta')) + statRow('Intellect', st('int')) + statRow('Spirit', st('spi')) + '</div>';
  const mh = s.mh; const lo = Math.round(mh.min + s.ap / 14 * mh.speed), hi = Math.round(mh.max + s.ap / 14 * mh.speed);
  h += '<div class="sgroup"><h5>Melee</h5>' + statRow('Damage', lo + ' - ' + hi, mh.name) + statRow('Speed', mh.speed.toFixed(2)) + statRow('DPS', (s.mhDps + s.ohDps).toFixed(1), s.oh ? 'Main hand ' + s.mhDps.toFixed(1) + ' + off hand ' + s.ohDps.toFixed(1) : '') +
    (s.oh ? statRow('Off hand', Math.round(s.oh.min * 0.5) + ' - ' + Math.round(s.oh.max * 0.5) + ' / ' + s.oh.speed.toFixed(2)) : '') +
    statRow('Attack power', s.ap) + statRow('Crit chance', pct(s.crit)) + (s.hit ? statRow('Hit bonus', pct(s.hit)) : '') + '</div>';
  h += '<div class="sgroup"><h5>Defense</h5>' + statRow('Armor', s.armor, 'Reduces physical damage from a same-level attacker by ' + (s.armorReduction(c.level) * 100).toFixed(1) + '%') +
    statRow('Defense', s.def) + statRow('Dodge', pct(s.dodge)) + (s.parry ? statRow('Parry', pct(s.parry)) : '') + (s.hasShield ? statRow('Block', pct(s.block) + ' / ' + s.blockValue) : '') + '</div>';
  const res = RES_NAMES.filter((k) => s.res[k]);
  if (res.length) h += '<div class="sgroup"><h5>Resistances</h5>' + res.map((k) => statRow(k[0].toUpperCase() + k.slice(1), s.res[k])).join('') + '</div>';
  if (s.sd || s.heal || s.mp5 || s.hp5) h += '<div class="sgroup"><h5>Other</h5>' + (s.sd ? statRow('Spell damage', s.sd) : '') + (s.heal ? statRow('Healing', s.heal) : '') + (s.mp5 ? statRow('Mana / 5 s', s.mp5) : '') + (s.hp5 ? statRow('Health / 5 s', s.hp5) : '') + '</div>';
  const r = rt(c); if (r.buffs && r.buffs.length) h += '<div class="sgroup"><h5>Buffs</h5>' + r.buffs.map((x) => '<div class="small">' + esc(x.name) + ' (' + Math.ceil(x.until - G.gameTime) + 's)</div>').join('') + '</div>';
  if (typeof masterySheetHtml === 'function') h += masterySheetHtml(c);
  h += '<div class="sgroup"><h5>Gear</h5>' + statRow('Durability', Math.round(durabilityPct(c) * 100) + '%') + statRow('Repair cost', money(repairCost(c))) + '</div>';
  return h;
}
function bagsHtml(c) {
  let h = '<div class="bagslots">';
  for (let i = 0; i < 4; i++) {
    const b = c.bagSlots[i];
    h += b ? '<div class="slot bag" data-bag="' + i + '" title="' + esc(itemName(b.id)) + '">' + iconHtml(b) + '</div>' : '<div class="slot empty bag" data-bag="' + i + '"><span>Bag</span></div>';
  }
  h += '<div class="bagcap">' + c.bags.length + ' / ' + bagCapacity(c) + ' <button class="mini" data-bsort="1" title="Sort the bags: gear, consumables, trade goods, recipes, quest items, junk last; stacks merged">Sort</button></div></div><div class="grid">';
  const cap = bagCapacity(c);
  for (let i = 0; i < cap; i++) {
    const s = c.bags[i];
    if (!s) { h += '<div class="slot empty"></div>'; continue; }
    const up = upgradeFor(c, s); const junk = isJunk(c, s.id); const cant = itemRow(s.id) && itemRow(s.id).sl && itemRow(s.id).sl.length && canEquip(c, s.id);
    const de = SH.de ? (SH.de.has(s) ? ' desel' : disenchantWhy(c, s) ? ' dedim' : ' decan') : '';
    h += '<div class="slot' + (SH.sel === 'b' + i ? ' sel' : '') + de + '" data-idx="' + i + '">' + iconHtml(s) + (up ? '<i class="up" title="Upgrade"></i>' : '') + (junk ? '<i class="junk" title="Junk"></i>' : '') + (cant ? '<i class="red"></i>' : '') + '</div>';
  }
  h += '</div><div class="moneyline">' + moneyHtml(c.gold) + '</div>';
  // enchanters: disenchant many items at once - choose them, then the green tick does it, the red circle cancels
  if (typeof hasProf === 'function' && hasProf(c, ENCHANTING)) {
    const q = (rt(c).deQueue || []).length;
    h += '<div class="debar">' + (!SH.de ? '<button class="mini" data-demode="on" title="Choose items in the bags, then confirm with the green tick">Disenchant...</button>' + (q ? ' <span class="small muted">disenchanting, ' + q + ' left</span>' : '') :
      '<span class="small">Choose items to disenchant: <b>' + SH.de.size + '</b></span><button class="debtn ok" data-demode="ok" title="Disenchant the chosen items"' + (SH.de.size ? '' : ' disabled') + '>&#10004;</button><button class="debtn no" data-demode="cancel" title="Cancel"><i></i></button>') + '</div>';
  }
  return h;
}
function vendorHtml(c) {
  const v = vendorNear(c);
  if (!v) {
    const nv = nearestVendor(c), nr = nearestVendor(c, true);
    return '<div class="muted">No vendor in reach.</div>' +
      (nv ? '<p><button class="act" data-go="v">Go to ' + esc(nv.name) + ' (' + Math.round(Math.hypot(nv.x - c.pos.x, nv.y - c.pos.y)) + ' yd)</button></p>' : '') +
      (nr && nr !== nv ? '<p><button class="act" data-go="r">Go to repair: ' + esc(nr.name) + ' (' + Math.round(Math.hypot(nr.x - c.pos.x, nr.y - c.pos.y)) + ' yd)</button></p>' : '');
  }
  const items = vendorItems(v.e);
  let h = '<div class="vhead"><b>' + esc(v.name) + '</b>' + (v.repair ? ' <span class="muted">(repairs)</span>' : '') + '</div>' +
    '<div class="vbtns"><button class="mini" data-vact="junk"' + (junkCount(c) ? '' : ' disabled') + '>Sell junk (' + junkCount(c) + ')</button>' +
    (v.repair ? ' <button class="mini" data-vact="repair"' + (repairCost(c) ? '' : ' disabled') + '>Repair all: ' + money(repairCost(c)) + '</button>' : '') + '</div>';
  if (!items.length) h += '<div class="muted small" style="margin-top:8px">This vendor\'s goods are not in the game data. Run <code>py build_gamedata.py cstats</code> to export every vendor list. You can still sell here: click an item in your bags.</div>';
  h += '<div class="vlist">';
  items.forEach((x) => {
    const inst = makeInst(x.id, 1); const price = itemBuy(x.id); const cant = c.gold < price;
    const bn = buyCount(x.id);
    h += '<div class="vrow" data-buy="' + x.id + '">' + iconHtml(Object.assign(inst, { n: bn })) + '<div class="vname"><span style="color:' + QUALITY_COLORS[itemQuality(x.id)] + '">' + esc(itemName(x.id)) + '</span><div class="small">' + moneyHtml(price) + (bn > 1 ? ' for ' + bn : '') + '</div></div><button class="mini" data-buyb="' + x.id + '"' + (cant ? ' disabled' : '') + '>Buy' + (bn > 1 ? ' ' + bn : '') + '</button></div>';
  });
  h += '</div><div class="muted small" style="margin-top:6px">To sell: click an item in your bags and choose Sell.</div>';
  return h;
}
function openSheet(tab) {
  SH.open = true; if (tab) SH.tab = tab; $('sheet').hidden = false; renderSheet();
}
function closeSheet() { SH.de = null; SH.open = false; $('sheet').hidden = true; hideItemTip(); hideItemMenu(); }
function renderSheet() {
  if (!SH.open) return; const c = active();
  $('sheetTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === SH.tab));
  $('sheetTitle').textContent = c.name + (guildOf(c) ? ' <' + guildOf(c).name + '>' : '') + ' - level ' + c.level + ' ' + RACE_NAMES[c.race] + ' ' + CLASS_NAMES[c.cls];
  $('sheet').classList.toggle('wide', SH.tab === 'talents');
  if (SH.tab === 'talents') { $('sheetLeft').innerHTML = talentsHtml(c); $('sheetBags').innerHTML = ''; return; }
  if (SH.tab === 'prof') {
    const f = document.activeElement && document.activeElement.id === 'profSearch' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    $('sheetLeft').innerHTML = professionsHtml(c); $('sheetBags').innerHTML = bagsHtml(c);
    if (f) { const i = $('profSearch'); if (i) { i.focus(); try { i.setSelectionRange(f[0], f[1]); } catch (e) { /* */ } } }
    return;
  }
  const left = SH.tab === 'vendor' ? '<div class="vendor">' + vendorHtml(c) + '</div>' : SH.tab === 'beh' ? behaviourHtml(c) : SH.tab === 'ah' ? ahHtml(c) : SH.tab === 'bank' ? '<div class="vendor">' + bankHtml(c) + '</div>' : SH.tab === 'trade' ? tradeHtml(c) : SH.tab === 'guild' ? guildHtml(c) :
    '<div class="doll"><div class="dcol">' + DOLL_LEFT.map((s) => slotHtml(c, s)).join('') + '</div><div class="dmid">' + statsHtml(c) + '</div><div class="dcol">' + DOLL_RIGHT.map((s) => slotHtml(c, s)).join('') + '</div>' +
    '<div class="dbot">' + DOLL_BOTTOM.map((s) => slotHtml(c, s)).join('') + '</div></div>';
  $('sheetLeft').innerHTML = left;
  $('sheetBags').innerHTML = bagsHtml(c);
  if (!G.qtHover) { /* keep */ }
}
function refreshGear() { renderGearCard(); if (SH.open) renderSheet(); }

/* ------------------------------------------------------------------ tooltip */
function instFromEl(el) {
  const c = active(); if (!el) return null;
  if (el.dataset.idx != null) return { inst: c.bags[+el.dataset.idx], where: 'bag', idx: +el.dataset.idx };
  if (el.dataset.slot != null) return c.equip[el.dataset.slot] ? { inst: c.equip[el.dataset.slot], where: 'eq', slot: +el.dataset.slot } : null;
  if (el.dataset.bag != null) return c.bagSlots[el.dataset.bag] ? { inst: c.bagSlots[el.dataset.bag], where: 'bagslot', i: +el.dataset.bag } : null;
  if (el.dataset.buy != null) return { inst: makeInst(+el.dataset.buy, 1), where: 'vendor', price: itemBuy(+el.dataset.buy) };
  if (el.dataset.iid != null) return { inst: { id: +el.dataset.iid, n: 1 }, where: 'info' };
  if (el.dataset.bk != null) return bankOf(c).items[+el.dataset.bk] ? { inst: bankOf(c).items[+el.dataset.bk], where: 'bank', i: +el.dataset.bk } : null;
  if (el.dataset.ahl != null) { const [id, i] = el.dataset.ahl.split(':').map(Number); const v = auctioneerNear(c); const L = listings(id, v ? v.side : charSide(c)).find((x) => x.i === i); return L ? { inst: { id, n: L.n, rp: L.rp }, where: 'info' } : null; }
  return null;
}
function showItemTip(ev, ref) {
  const c = active(); const tip = $('itip'); if (!ref || !ref.inst) return hideItemTip();
  let h = '<div class="tt">' + tooltipHtml(c, ref.inst, { price: ref.price }) + '</div>';
  const it = itemRow(ref.inst.id);
  if (ref.where !== 'eq' && it && it.sl && it.sl.length) {
    for (const sl of it.sl) { const cur = c.equip[sl]; if (cur && cur !== ref.inst) h += '<div class="tt cmp"><div class="muted small">Currently equipped</div>' + tooltipHtml(c, cur) + '</div>'; }
  }
  tip.innerHTML = h; tip.hidden = false;
  const W = window.innerWidth, H = window.innerHeight; const r = tip.getBoundingClientRect();
  let x = ev.clientX + 16, y = ev.clientY + 12; if (x + r.width > W - 4) x = Math.max(4, ev.clientX - r.width - 16); if (y + r.height > H - 4) y = Math.max(4, H - r.height - 4);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideItemTip() { const t = $('itip'); if (t) t.hidden = true; }
function hideItemMenu() { const m = $('iact'); if (m) m.hidden = true; SH.sel = null; }
function showItemMenu(ev, ref) {
  const c = active(); const m = $('iact'); if (!ref || !ref.inst) return;
  const inst = ref.inst; const it = itemRow(inst.id); const acts = [];
  if (ref.where === 'bag') {
    if (it && it.c === 1 && it.cs) acts.push(['bag', 'Equip bag']);
    else if (it && it.sl && it.sl.length) { const why = canEquip(c, inst.id); acts.push(['equip', why ? 'Equip (' + why + ')' : 'Equip', !!why]); if (it.t === 13 && canDualWield(c)) { acts.push(['equip15', 'Equip in main hand']); acts.push(['equip16', 'Equip in off hand']); } }
    if (typeof disenchantable === 'function' && disenchantable(inst.id) && hasProf(c, ENCHANTING)) { const why = disenchantWhy(c, inst); acts.push(['dis', why ? 'Disenchant (' + why + ')' : 'Disenchant', !!why]); }
    if (typeof recipeOf === 'function' && recipeOf(inst.id)) { const why = recipeLearnWhy(c, inst.id); acts.push(['learn', why ? 'Learn (' + why + ')' : 'Learn recipe', !!why]); }
    const u = useInfo(inst.id); const cu = typeof consInfo === 'function' && consInfo(inst.id);
    if (u && (u.kind !== 'other' || cu)) acts.push(['use', u.kind === 'potion' ? 'Drink potion' : u.kind === 'food' ? 'Eat' : cu && cu.kind === 'bandage' ? 'Apply bandage' : cu && cu.kind === 'weapon' ? 'Apply to weapon' : cu && cu.kind === 'bomb' ? 'Throw' : 'Use']);
    if (SH.tab === 'ah' && auctioneerNear(c) && ahSellable(inst)) acts.unshift(['ahsell', 'Sell at the auction house']);
    if (bankerNear(c)) { acts.unshift(['bankput', 'Put in the bank']); if (it && it.c === 1 && it.cs && bankOf(c).bags.slice(0, bankOf(c).slots).filter(Boolean).length < bankOf(c).slots) acts.push(['bankbag', 'Put in a bank bag slot']); }
    const v = vendorNear(c); acts.push(['sell', v ? 'Sell for ' + money(itemSell(inst.id) * inst.n) : 'Sell (go to a vendor first)', !v || !itemSell(inst.id)]);
    acts.push(['destroy', 'Destroy']);
  } else if (ref.where === 'eq') acts.push(['unequip', 'Take off']);
  else if (ref.where === 'bagslot') acts.push(['unbag', 'Take bag off']);
  else if (ref.where === 'vendor') acts.push(['buy', 'Buy ' + (buyCount(inst.id) > 1 ? buyCount(inst.id) + ' ' : '') + 'for ' + money(ref.price), c.gold < ref.price]);
  acts.push(['close', 'Close']);
  m.innerHTML = '<div class="tt">' + tooltipHtml(c, inst, { price: ref.price }) + '</div>' + acts.map(([a, t, dis]) => '<button data-ia="' + a + '"' + (dis ? ' disabled' : '') + '>' + esc(t) + '</button>').join('');
  m.hidden = false; hideItemTip();
  const W = window.innerWidth, H = window.innerHeight; const r = m.getBoundingClientRect();
  let x = ev.clientX + 8, y = ev.clientY + 8; if (x + r.width > W - 4) x = Math.max(4, W - r.width - 4); if (y + r.height > H - 4) y = Math.max(4, H - r.height - 4);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  m.onclick = (e) => {
    const a = e.target.dataset && e.target.dataset.ia; if (!a) return;
    if (a === 'equip') equipFromBag(c, ref.idx);
    else if (a === 'equip15') equipFromBag(c, ref.idx, 15);
    else if (a === 'equip16') equipFromBag(c, ref.idx, 16);
    else if (a === 'bag') equipBag(c, ref.idx);
    else if (a === 'use') useItem(c, ref.idx);
    else if (a === 'learn') { learnRecipeItem(c, ref.idx); save(); }
    else if (a === 'dis') disenchantItem(c, ref.idx);
    else if (a === 'sell') sellIndex(c, ref.idx);
    else if (a === 'destroy') destroyItem(c, ref.idx);
    else if (a === 'unequip') unequipSlot(c, ref.slot);
    else if (a === 'unbag') unequipBag(c, ref.i);
    else if (a === 'buy') buyItem(c, ref.inst.id);
    else if (a === 'ahsell') { AHUI.sub = 'sell'; AHUI.sel = ref.idx; AHUI.price = null; }
    else if (a === 'bankput') bankPut(c, ref.idx);
    else if (a === 'bankbag') bankPutBag(c, ref.idx);
    hideItemMenu(); renderSheet();
  };
}
function bindSheet() {
  const sh = $('sheet');
  sh.addEventListener('click', (e) => {
    if (e.target === sh) { closeSheet(); return; }
    const t = e.target.closest('[data-tab]'); if (t) { SH.tab = t.dataset.tab; hideItemMenu(); renderSheet(); return; }
    if (e.target.id === 'sheetClose') { closeSheet(); return; }
    const c = active();
    // mass disenchant: choosing items in the bags
    const dm = e.target.closest('[data-demode]');
    if (dm) {
      const a = dm.dataset.demode;
      if (a === 'on') SH.de = new Set();
      else if (a === 'cancel') SH.de = null;
      else if (a === 'ok' && SH.de) { const n = disenchantQueue(c, [...SH.de]); SH.de = null; if (n) log('Disenchanting ' + n + ' item' + (n > 1 ? 's' : '') + ' ...'); }
      hideItemMenu(); renderSheet(); return;
    }
    if (SH.de) { const b = e.target.closest('#sheetBags [data-idx]'); if (b) { const inst = c.bags[+b.dataset.idx]; if (inst && !disenchantWhy(c, inst)) { if (SH.de.has(inst)) SH.de.delete(inst); else SH.de.add(inst); } renderSheet(); return; } }
    if (SH.tab === 'ah' && ahClick(e)) return;
    if (SH.tab === 'bank' && bankClick(e)) return;
    if (SH.tab === 'trade' && tradeClick(e)) return;
    if (SH.tab === 'guild' && guildClick(e)) return;
    if (e.target.closest('[data-bsort]')) { sortBags(c); return; }
    if (behaviourClick(e)) return;
    if (typeof consumablesClick === 'function' && consumablesClick(e)) return;
    if (typeof rotationClick === 'function' && rotationClick(e)) return;
    if (SH.tab === 'talents' && talentClick(e)) return;
    if (SH.tab === 'prof' && typeof fishingClick === 'function' && fishingClick(e)) return;
    if (SH.tab === 'prof' && professionsClick(e)) return;
    const g = e.target.closest('[data-go]'); if (g) { if (g.dataset.go === 'v') orderVendor(c); else orderRepair(c); closeSheet(); return; }
    const va = e.target.closest('[data-vact]'); if (va) { if (va.dataset.vact === 'junk') sellJunk(c); else repairAll(c); renderSheet(); return; }
    const bb = e.target.closest('[data-buyb]'); if (bb) { buyItem(c, +bb.dataset.buyb); renderSheet(); return; }
    const el = e.target.closest('[data-idx],[data-slot],[data-bag],[data-buy]');
    if (el) { const ref = instFromEl(el); if (ref && ref.inst) { SH.sel = ref.where === 'bag' ? 'b' + ref.idx : null; showItemMenu(e, ref); } return; }
    hideItemMenu();
  });
  sh.addEventListener('change', (e) => { if (SH.tab === 'ah' && ahChange(e)) return; if (SH.tab === 'trade' && tradeChange(e)) return; if (SH.tab === 'guild' && guildChange(e)) return; if (!talentChange(e) && !professionsChange(e)) behaviourChange(e); });
  sh.addEventListener('keydown', (e) => { if (SH.tab === 'ah') ahKey(e); });
  sh.addEventListener('input', (e) => { if (SH.tab === 'prof') professionsInput(e); });
  sh.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-idx],[data-slot]'); if (!el) return; const c = active();
    if (el.dataset.idx != null) { const inst = c.bags[+el.dataset.idx]; if (!inst) return; const it = itemRow(inst.id); if (it && it.sl && it.sl.length) equipFromBag(c, +el.dataset.idx); else if (useInfo(inst.id)) useItem(c, +el.dataset.idx); }
    else unequipSlot(c, +el.dataset.slot);
    hideItemMenu(); renderSheet();
  });
  sh.addEventListener('mousemove', (e) => {
    if (!$('iact').hidden) return;
    const tl = e.target.closest('[data-tal]');
    if (tl) { const tip = $('itip'); tip.innerHTML = talentTip(active(), tl.dataset.tal); tip.hidden = false; const r = tip.getBoundingClientRect(); let x = e.clientX + 16, y = e.clientY + 12; if (x + r.width > window.innerWidth - 4) x = e.clientX - r.width - 16; if (y + r.height > window.innerHeight - 4) y = window.innerHeight - r.height - 4; tip.style.left = x + 'px'; tip.style.top = y + 'px'; return; }
    const el = e.target.closest('[data-idx],[data-slot],[data-bag],[data-buy],[data-iid],[data-bk],[data-ahl]');
    if (!el) { hideItemTip(); return; } showItemTip(e, instFromEl(el));
  });
  sh.addEventListener('mouseleave', hideItemTip);
  window.addEventListener('keydown', (e) => {
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'c' || e.key === 'C' || e.key === 'b' || e.key === 'B') { if (SH.open && SH.tab === 'char') closeSheet(); else openSheet('char'); }
    if (e.key === 'Escape' && SH.open) closeSheet();
    if (e.key === 'n' || e.key === 'N') { if (SH.open && SH.tab === 'talents') closeSheet(); else openSheet('talents'); }
  });
}

/* ------------------------------------------------------------- gear card */
function renderGearCard() {
  const el = $('gearCard'); if (!el) return; const c = active(); const st = G.state.settings;
  const dur = durabilityPct(c); const v = vendorNear(c);
  const upgrades = c.bags.filter((s) => upgradeFor(c, s)).length;
  el.innerHTML = '<h3>Gear</h3>' +
    '<div class="kv"><span>Bags</span><b' + (bagFree(c) <= 0 ? ' style="color:#ff6a5a"' : '') + '>' + c.bags.length + ' / ' + bagCapacity(c) + '</b></div>' +
    '<div class="kv"><span>Durability</span><b' + (dur < 0.3 ? ' style="color:#ff6a5a"' : '') + '>' + Math.round(dur * 100) + '%</b></div>' +
    '<div class="kv"><span>Money</span><b>' + moneyHtml(c.gold) + '</b></div>' +
    (upgrades ? '<div class="kv"><span>Upgrades in bags</span><b style="color:#1eff00">' + upgrades + '</b></div>' : '') +
    (talentFree(c) > 0 ? '<div class="kv"><span>Talent points</span><b style="color:#1eff00">' + talentFree(c) + ' free</b></div>' : '') +
    '<div class="btnrow"><button class="act" id="btnSheet">Character &amp; bags (C)</button><button class="mini" id="btnTal">Talents (N)</button><button class="mini" id="btnVendor">' + (v ? 'Vendor' : 'Go to vendor') + '</button><button class="mini" id="btnRepair">Repair</button><button class="mini" id="btnAh">Auction house' + (mailWaiting(c) ? ' (mail ' + mailWaiting(c) + ')' : '') + '</button><button class="mini" id="btnBank">Bank</button></div>' +
    '';
  $('btnSheet').onclick = () => openSheet('char'); $('btnTal').onclick = () => openSheet('talents');
  $('btnVendor').onclick = () => { if (vendorNear(c)) openSheet('vendor'); else orderVendor(c); };
  $('btnRepair').onclick = () => { const vv = vendorNear(c); if (vv && vv.repair) { repairAll(c); } else orderRepair(c); };
  $('btnAh').onclick = () => openSheet('ah'); $('btnBank').onclick = () => openSheet('bank');
}

/* ------------------------------------------------------------- behaviour tab */
function pctOptions(cur, from, to, never) {
  let h = never ? '<option value="0"' + (!cur ? ' selected' : '') + '>Never</option>' : '';
  for (let v = from; v <= to; v += 10) h += '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + v + '%</option>';
  return h;
}
function spellIcon(sp) { return sp && sp.ic ? '<img class="sic" src="../icons/' + sp.ic.toLowerCase() + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'">' : '<span class="sic"></span>'; }
function behaviourHtml(c) {
  const cfg = c.cfg; let h = '<div class="beh">';
  h += '<div class="sgroup"><h5>Playstyle</h5>' + Object.keys(PLAYSTYLES).map((k) => '<label class="pstyle' + (cfg.style === k ? ' on' : '') + '"><input type="radio" name="pst" data-cfgs="style" value="' + k + '"' + (cfg.style === k ? ' checked' : '') + '> ' + esc(PLAYSTYLES[k]) + '</label>').join('') + '</div>';
  h += '<div class="sgroup"><h5>Resting and consumables</h5><div class="rgrid">' +
    '<label>Sit down below</label><select data-cfg="sitAt">' + pctOptions(cfg.sitAt, 10, 90, true) + '</select>' +
    '<label>Stand up at</label><select data-cfg="standAt">' + pctOptions(cfg.standAt, 50, 100, false) + '</select>' +
    '<label>Eat food below</label><select data-cfg="eatAt">' + pctOptions(cfg.eatAt, 10, 90, true) + '</select>' +
    '<label>Drink a potion below</label><select data-cfg="potionAt">' + pctOptions(cfg.potionAt, 10, 90, true) + '</select>' +
    (usesMana(c) && c.cls !== 1 ? '<label>Rest and drink below mana</label><select data-cfg="drinkAt">' + pctOptions(cfg.drinkAt, 10, 90, true) + '</select>' : '') +
    ([5, 8, 9].includes(c.cls) ? '<label>Shoot the wand below mana</label><select data-cfg="wandAt">' + pctOptions(cfg.wandAt, 10, 90, true) + '</select>' : '') +
    '</div><div class="small muted">Health % out of combat. Food is only eaten while sitting; potions only in combat.' + (usesMana(c) && c.cls !== 1 ? ' Drinks (water, milk, juice) refill mana while sitting.' : '') + '</div></div>';
  if (c.cls === 11) h += '<div class="sgroup"><h5>Druid form for fighting</h5><select data-cfgs="form">' + [['auto', 'Automatic (Cat Form from 20, Bear Form from 10)'], ['cat', 'Cat Form'], ['bear', 'Bear Form'], ['caster', 'Caster form (Wrath, Moonfire)']].map(([k, t]) => '<option value="' + k + '"' + ((cfg.form || 'auto') === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select> <span class="small muted">Heals are cast in caster form between fights.</span></div>';
  if (c.pet) h += '<div class="sgroup"><h5>Pet</h5><div class="small">' + esc(c.pet.name) + ' - level ' + c.level + ', ' + (c.pet.dead ? 'dead (revive it)' : Math.round(c.pet.hp) + ' / ' + c.pet.maxhp + ' health') + (PET_KINDS[c.pet.kind] && PET_KINDS[c.pet.kind].tank ? ' - holds the attention of the creatures' : '') + '</div></div>';
  const stances = Object.keys(STANCES).filter((n) => c.known && c.known[n]);
  if (stances.length) h += '<div class="sgroup"><h5>Stance</h5><select data-cfgs="stance">' + stances.map((n) => '<option value="' + STANCES[n] + '"' + (cfg.stance === STANCES[n] ? ' selected' : '') + '>' + n + '</option>').join('') + '</select> <span class="small muted">Abilities that need another stance are skipped.</span></div>';
  if (typeof consumablesHtml === 'function') h += consumablesHtml(c);
  h += rotationHtml(c);
  h += '<div class="sgroup' + ((cfg.rotation || 'custom') !== 'custom' ? ' dimmed' : '') + '"><h5>' + ((cfg.rotation || 'custom') !== 'custom' ? 'My own list (not used while a ready-made rotation is chosen)' : 'Abilities - checked from the top, the first that fits is used') + '</h5>';
  if (!cfg.rules.length) h += '<div class="muted small">No abilities yet.</div>';
  cfg.rules.forEach((rule, i) => {
    const id = c.known[rule.n]; const sp = id ? spellRow(id) : null; const meta = (CLASS_META[c.cls] || {})[rule.n] || { modes: genericModes(c, sp) };
    const u = abilityUsable(c, rule.n);
    const ct = sp && sp.pw ? spellCost(c, sp, rule.n) : [0, 0];
    const cost = ct[1] ? ct[1] + ' ' + (ct[0] === -2 ? 'health' : powerName(ct[0]).toLowerCase()) : '';
    const castS = sp ? castTime(c, sp) : 0;
    const cd = sp && (sp.cd || sp.catcd) ? ((sp.cd || sp.catcd) / 1000) + 's cd' : '';
    h += '<div class="arow' + (rule.mode === 'off' ? ' off' : '') + '">' + spellIcon(sp) +
      '<div class="aname"><b>' + esc(rule.n) + '</b> <span class="muted small">' + esc(sp && sp.r ? sp.r : '') + '</span><div class="small muted">' + [cost, castS ? castS.toFixed(1) + 's cast' : sp && isChanneled(sp) ? 'channeled' : '', cd].filter(Boolean).join(', ') + (u.ok ? '' : ' <span style="color:#e6b93c">' + esc(u.why) + '</span>') + '</div></div>' +
      '<select data-rmode="' + i + '">' + ruleModes(rule.n, meta.modes).map((m) => '<option value="' + m + '"' + (rule.mode === m ? ' selected' : '') + '>' + MODE_TEXT[m] + '</option>').join('') + '</select>' +
      (MODE_HAS_P[rule.mode] ? '<input type="number" data-rp="' + i + '" value="' + (rule.p || 0) + '" min="0" max="100" step="' + (rule.mode === 'multi' || rule.mode === 'stack' ? 1 : 5) + '">' : '<span class="pfill"></span>') +
      '<span class="updn"><button class="mini" data-up="' + i + '"' + (i ? '' : ' disabled') + '>&#9650;</button><button class="mini" data-dn="' + i + '"' + (i < cfg.rules.length - 1 ? '' : ' disabled') + '>&#9660;</button></span></div>';
  });
  h += '</div>';
  const up = upcomingAbilities(c).slice(0, 8);
  if (up.length) h += '<div class="sgroup"><h5>Coming with levels (learned automatically)</h5>' + up.map((x) => '<div class="small">Level ' + x.lv + ': ' + esc(x.n) + (x.r ? ' (' + esc(x.r) + ')' : '') + (x.isNew ? ' <span class="up">new</span>' : '') + '</div>').join('') + '</div>';
  h += '<div class="sgroup small muted">Modes: <b>Keep on my target</b> re-applies a debuff (Rend, Hamstring...) only when it has run out. <b>Keep on every attacker</b> spreads it to each creature hitting you. <b>When attackers at least</b> is for area abilities. Heroic Strike and Cleave replace the next swing.</div>';
  return h + '</div>';
}
/* every fighting ability can also be kept for rare and elite creatures only */
function ruleModes(n, modes) {
  if (modes.includes('elite') || n === 'Charge' || n === 'Intercept' || modes.every((m) => ['off', 'conjure', 'pet', 'petheal', 'form', 'heal'].includes(m))) return modes;
  return modes.concat(['elite']);
}
/* rule modes for abilities without a hand-made entry */
function genericModes(c, sp) {
  if (c.cls === 1 || !sp) return ['off', 'spam'];
  const self = (sp.ef || []).every((e) => e.k === 'self' || e.k === 'friend' || e.k === 'other');
  if (self) return ['off', 'buff', 'emergency', 'heal'];
  if ((sp.ef || []).some((e) => e.k === 'area_enemy')) return ['off', 'multi', 'spam'];
  return ['off', 'spam', 'opener', 'debuff', 'execute', 'emergency'];
}
function behaviourChange(e) {
  const t = e.target; const c = active(); if (!c || !c.cfg) return;
  if (typeof consumablesChange === 'function' && consumablesChange(e)) return;
  if (typeof rotationChange === 'function' && rotationChange(e)) return;
  if (t.dataset.cfg) { c.cfg[t.dataset.cfg] = +t.value; if (t.dataset.cfg === 'standAt' && c.cfg.standAt <= c.cfg.sitAt) c.cfg.standAt = Math.min(100, c.cfg.sitAt + 10); }
  else if (t.dataset.cfgs) { c.cfg[t.dataset.cfgs] = t.value; if (t.dataset.cfgs === 'stance') { dirty(c); log('Switched to ' + STANCE_NAME[t.value] + '.'); } }
  else if (t.dataset.rmode != null) { const r = c.cfg.rules[+t.dataset.rmode]; r.mode = t.value; const m = ((CLASS_META[c.cls] || {})[r.n] || {}).def || {}; if (MODE_HAS_P[r.mode] && !r.p) r.p = m.p || (r.mode === 'multi' ? 2 : r.mode === 'rage' ? 40 : 30); }
  else if (t.dataset.rp != null) { c.cfg.rules[+t.dataset.rp].p = Math.max(0, +t.value || 0); }
  else return;
  save(); renderSheet();
}
function behaviourClick(e) {
  const c = active(); const b = e.target.closest('[data-up],[data-dn]'); if (!b) return false;
  const R = c.cfg.rules; const i = +(b.dataset.up != null ? b.dataset.up : b.dataset.dn); const j = b.dataset.up != null ? i - 1 : i + 1;
  if (j < 0 || j >= R.length) return true; const t = R[i]; R[i] = R[j]; R[j] = t; save(); renderSheet(); return true;
}

/* ------------------------------------------------------------- ability bar on the map */
function renderAbar() {
  const el = $('abar'); if (!el) return; const c = active(); if (!c.cfg) return; const r = rt(c);
  const items = rulesOf(c).filter((x) => x.mode !== 'off' && c.known[x.n]);
  let h = '';
  for (const rule of items) {
    const sp = spellRow(c.known[rule.n]); if (!sp) continue; const u = abilityUsable(c, rule.n);
    const cdLeft = Math.max(0, (r.cd[rule.n] || 0) - G.gameTime); const cdTot = (sp.cd || sp.catcd || 0) / 1000;
    const ct = spellCost(c, sp, rule.n);
    const dim = !u.ok || (ct[0] !== -2 && ct[1] > powerOf(c, ct[0]));
    h += '<div class="ab' + (dim ? ' dim' : '') + (r.queued && r.queued.name === rule.n ? ' q' : '') + '" title="' + esc(rule.n + ' - ' + MODE_TEXT[rule.mode] + (MODE_HAS_P[rule.mode] ? ' ' + rule.p : '')) + '">' + spellIcon(sp) +
      (cdLeft > 0 && cdTot ? '<i style="height:' + Math.round(100 * cdLeft / cdTot) + '%"></i><b>' + Math.ceil(cdLeft) + '</b>' : '') + '</div>';
  }
  if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}
