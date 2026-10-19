'use strict';
/* workshop.js - guild crafting orders (Professions window, Guild crafters tab): every crafter of the guild (your
   characters in it) with the recipes it knows. An order takes the materials from the guild bank (what is missing
   there from the bags of the character who orders), and the crafter makes the items on its own - wherever it is,
   playing or paused - in the recipe's real time, one after another. Each item can raise the crafter's skill like its
   own crafting (by the recipe's colour). What is made goes into the bags of the one who ordered it (the guild bank or
   the mailbox when they are full); an enchant goes on that character's item. The active character shows the order's
   progress in its cast bar. */

const GC = { sel: null, q: '', can: false };
let WC_ID = 1;

function gcOrders(g) { g.orders = g.orders || []; return g.orders; }
function gbankCount(g, id) { let n = 0; for (const s of g.bank.items) if (s.id === id) n += s.n; return n; }
function gbankRemove(g, id, n) {
  let took = 0;
  for (let i = g.bank.items.length - 1; i >= 0 && n > 0; i--) { const s = g.bank.items[i]; if (s.id !== id) continue; const k = Math.min(s.n, n); s.n -= k; n -= k; took += k; if (!s.n) g.bank.items.splice(i, 1); }
  return took;
}
/* put n of an item in the guild bank; returns what did not fit */
function gbankAdd(g, id, n) {
  const st = itemStack(id);
  if (st > 1) for (const s of g.bank.items) { if (s.id === id && s.n < st && !s.rp) { const k = Math.min(st - s.n, n); s.n += k; n -= k; if (!n) return 0; } }
  while (n > 0 && gbankFree(g) > 0) { const k = Math.min(st, n); g.bank.items.push(makeInst(id, k, true)); n -= k; }
  return n;
}
/* the crafters of a guild: one entry per character and crafting profession that has recipes */
function gcCrafters(g) {
  const out = []; if (!PD()) return out;
  for (const { c } of guildMembers(g)) {
    if (!c.prof) continue;
    for (const sk in c.prof.skills) {
      const id = +sk; if (id === FISHING) continue;
      const list = Object.keys(c.prof.recipes).filter((sid) => PD().recipes[sid] && PD().recipes[sid].skill === id);
      if (!list.length) continue;
      out.push({ c, skill: id, key: c.id + ':' + id, recipes: list.sort((a, b) => PD().recipes[b].learn - PD().recipes[a].learn) });
    }
  }
  return out;
}
/* how many the guild bank and the character's bags have materials for */
function gcMakeable(g, c, r) {
  let n = Infinity; for (const [it, k] of r.re || []) n = Math.min(n, Math.floor((gbankCount(g, it) + bagCount(c, it)) / k));
  return n === Infinity ? 0 : n;
}
function gcOrder(by, crafter, sid, n) {
  const g = guildOf(by); const r = PD().recipes[sid]; if (!g || !r || guildOf(crafter) !== g || !crafter.prof || !crafter.prof.recipes[sid]) return false;
  n = Math.max(1, Math.min(n, gcMakeable(g, by, r))); if (!gcMakeable(g, by, r)) { log('Not enough materials for ' + r.n + ' in the guild bank and the bags.'); return false; }
  if (r.ench) { const slot = enchantSlot(r); if (slot == null || !by.equip[slot]) { log(r.n + ': ' + by.name + ' has nothing in that slot to enchant.'); return false; } n = 1; }
  const mats = [];
  for (const [it, k] of r.re || []) { let need = k * n; const fromBank = gbankRemove(g, it, need); need -= fromBank; if (need > 0) removeItem(by, it, need); mats.push([it, k * n]); }
  const o = { id: WC_ID++ + '-' + Math.floor(G.gameTime), crafter: crafter.id, by: by.id, sid: +sid, n, done: 0, t: 0, mats };
  gcOrders(g).push(o);
  guildLog(g, by.name + ' ordered ' + (n > 1 ? n + ' x ' : '') + r.n + ' from ' + crafter.name + '.');
  log('Ordered ' + (n > 1 ? n + ' x ' : '') + r.n + ' from ' + crafter.name + ' (' + fmtCraft(craftTime(r) * n) + ').');
  save(); refreshGear(); return true;
}
/* cancelled: the materials not used yet go back to the guild bank (the bags of the one who ordered when it is full) */
function gcCancel(g, o, why) {
  const L = gcOrders(g); const i = L.indexOf(o); if (i < 0) return; L.splice(i, 1);
  const r = PD().recipes[o.sid]; const by = charById(o.by); const left = o.n - o.done;
  for (const [it, tot] of o.mats) { const back = Math.round(tot / o.n * left); if (back <= 0) continue; const rest = gbankAdd(g, it, back); if (rest && by) addItem(by, it, rest); }
  if (by) withLog(by, () => log((why || 'Order cancelled') + ': ' + (r ? r.n : 'crafting') + (o.done ? ' (' + o.done + ' of ' + o.n + ' made)' : '') + ' - the materials went back.'));
  save();
}
/* every game step (worldTick): each crafter works on its first order */
function wcTick(dt) {
  if (!G.state || !G.state.guilds) return;
  for (const g of G.state.guilds) {
    const L = g.orders; if (!L || !L.length) continue;
    const busy = new Set();
    for (const o of L.slice()) {
      if (busy.has(o.crafter)) continue; busy.add(o.crafter);
      const crafter = charById(o.crafter), by = charById(o.by); const r = PD() && PD().recipes[o.sid];
      if (!crafter || !by || !r || guildOf(crafter) !== g) { gcCancel(g, o, 'The crafter is gone'); continue; }
      o.t += dt; if (o.t < craftTime(r)) continue;
      o.t = 0; gcMakeOne(g, o, crafter, by, r);
      o.done++;
      if (o.done >= o.n) {
        L.splice(L.indexOf(o), 1);
        guildLog(g, crafter.name + ' made ' + (o.n > 1 ? o.n + ' x ' : '') + r.n + ' for ' + by.name + '.');
        withLog(by, () => log(crafter.name + ' finished ' + (o.n > 1 ? o.n + ' x ' : '') + r.n + ' for you.'));
        save(); if (SH.open) renderSheet();
      }
    }
  }
}
function gcMakeOne(g, o, crafter, by, r) {
  if (r.ench) {
    const slot = enchantSlot(r); const inst = slot != null ? by.equip[slot] : null;
    if (inst) { inst.ench = enchantBonus(r.ench); dirty(by); withLog(by, () => log(crafter.name + ' enchanted your ' + itemName(inst.id, inst) + ': ' + inst.ench.n + '.')); }
  } else if (r.cr) {
    const n = irnd(r.cr[1] || 1, Math.max(r.cr[1] || 1, r.cr[2] || 1));
    if (!addItem(by, r.cr[0], n)) {
      const rest = gbankAdd(g, r.cr[0], n);
      if (rest && typeof sendMail === 'function') sendMail(by.id, { from: crafter.name, sub: itemName(r.cr[0]), inst: makeInst(r.cr[0], rest, true), t: G.gameTime });
      withLog(by, () => log('Bags full: ' + itemName(r.cr[0]) + ' from ' + crafter.name + ' went to the ' + (rest ? 'mailbox' : 'guild bank') + '.'));
    }
  }
  withLog(crafter, () => skillUp(crafter, r.skill, recipeColor(crafter, r)));
  if (isActive(by) || isActive(crafter)) refreshGear();
}
/* the order shown in the cast bar of a character: the first one it ordered (or makes) that is being worked on */
function wcBarOf(c) {
  const g = guildOf(c); if (!g || !g.orders || !g.orders.length) return null;
  const first = {}; for (const o of g.orders) if (!first[o.crafter]) first[o.crafter] = o;
  const o = Object.values(first).find((x) => x.by === c.id) || Object.values(first).find((x) => x.crafter === c.id); if (!o) return null;
  const r = PD().recipes[o.sid]; const cr = charById(o.crafter); if (!r) return null;
  return { name: (cr && cr.id !== c.id ? cr.name + ': ' : '') + r.n + (o.n > 1 ? ' (' + (o.done + 1) + '/' + o.n + ')' : ''), t: o.t, total: craftTime(r) };
}

/* ------------------------------------------------------------------ the Guild crafters tab */
function gcReagHtml(g, c, r, n) {
  return (r.re || []).map(([it, k]) => { const gb = gbankCount(g, it), bg = bagCount(c, it); const need = k * Math.max(1, n || 1);
    return '<span class="reag' + (gb + bg >= need ? '' : ' miss') + '" data-iid="' + it + '" title="Guild bank ' + gb + ', bags ' + bg + '">' + esc(itemName(it)) + ' ' + Math.min(gb + bg, 999) + '/' + k + '</span>'; }).join(' ');
}
function gcraftHtml(c) {
  const g = guildOf(c);
  if (!g) return '<div class="gcraft"><div class="muted">' + esc(c.name) + ' is not in a guild. The crafters of a guild make things for each other from the guild bank - found or join one in the Guild window.</div></div>';
  if (!PD()) return '<div class="muted">professions.json is missing.</div>';
  const crafters = gcCrafters(g); let h = '<div class="gcraft">';
  // orders on the way
  const L = gcOrders(g);
  if (L.length) {
    const first = {}; for (const o of L) if (!first[o.crafter]) first[o.crafter] = o;
    h += '<div class="sgroup"><h5>Orders</h5>';
    for (const o of L) {
      const r = PD().recipes[o.sid]; const cr = charById(o.crafter), by = charById(o.by); if (!r) continue;
      const work = first[o.crafter] === o; const pct = work ? Math.min(100, 100 * o.t / craftTime(r)) : 0;
      h += '<div class="wcrow"><span class="small"><b style="color:' + (cr ? CLASS_COLOR[cr.cls] : '#fff') + '">' + esc(cr ? cr.name : '?') + '</b> makes <b>' + esc(r.n) + '</b> (' + o.done + '/' + o.n + ') for ' + esc(by ? by.name : '?') + '</span>' +
        '<div class="cbfill wcbar" data-wc="' + o.id + '"><i style="width:' + pct.toFixed(1) + '%"></i><span>' + (work ? fmtCraft(craftTime(r) - o.t) + ' left' : 'waiting') + '</span></div>' +
        (o.by === c.id || guildRank(g, c) <= 1 ? '<button class="mini" data-wcx="' + o.id + '" title="Cancel - the materials not used go back">&#10006;</button>' : '') + '</div>';
    }
    h += '</div>';
  }
  if (!crafters.length) return h + '<div class="muted">Nobody in &lt;' + esc(g.name) + '&gt; knows a crafting recipe yet.</div></div>';
  if (!GC.sel || !crafters.some((x) => x.key === GC.sel)) GC.sel = (crafters.find((x) => x.c !== c) || crafters[0]).key;
  // one tab per crafter and profession
  h += '<div class="gtabs gctabs">' + crafters.map((x) => '<button class="mini' + (x.key === GC.sel ? ' on' : '') + '" data-gcsel="' + x.key + '"><b style="color:' + CLASS_COLOR[x.c.cls] + '">' + esc(x.c.name) + '</b> ' + esc(profName(x.skill)) + ' ' + profSkill(x.c, x.skill) + '</button>').join('') + '</div>';
  const cur = crafters.find((x) => x.key === GC.sel); const q = GC.q.trim().toLowerCase();
  h += '<div class="psearch"><input id="gcQ" type="search" placeholder="Search ' + esc(cur.c.name) + '\'s recipes..." value="' + esc(GC.q) + '"><label class="chk"><input type="checkbox" data-gccan="1"' + (GC.can ? ' checked' : '') + '> Only what there are materials for</label></div>';
  h += '<div class="small muted">Materials come from the guild bank (' + g.bank.items.length + ' / ' + GUILD_BANK_SLOTS + ' slots), what is missing from ' + esc(c.name) + '\'s bags. ' + esc(cur.c.name) + ' makes it on its own; it goes into ' + esc(c.name) + '\'s bags.</div>';
  const list = cur.recipes.filter((sid) => recipeMatches(PD().recipes[sid], q) && (!GC.can || gcMakeable(g, c, PD().recipes[sid]) > 0));
  h += '<div class="gclist">';
  if (!list.length) h += '<div class="muted small">No recipe' + (q ? ' matches "' + esc(GC.q) + '"' : '') + (GC.can ? ' with materials in the guild bank' : '') + '.</div>';
  for (const sid of list.slice(0, 120)) {
    const r = PD().recipes[sid]; const col = recipeColor(cur.c, r); const mk = gcMakeable(g, c, r); const it = r.cr ? itemRow(r.cr[0]) : null;
    h += '<div class="rrow">' + (it && it.ic ? '<img class="sic" src="../icons/' + it.ic.toLowerCase() + '.jpg" alt="">' : '<span class="sic"></span>') +
      '<div class="rname"><b class="rc-' + col + '"' + (r.cr ? ' data-iid="' + r.cr[0] + '"' : '') + ' title="' + ({ orange: 'Always raises ', yellow: 'Usually raises ', green: 'Rarely raises ', grey: 'Does not raise ' }[col] || '') + esc(cur.c.name) + '\'s skill">' + esc(r.n) + '</b>' + (mk ? ' <span class="muted">[' + mk + ']</span>' : '') +
      ' <span class="small muted">' + fmtCraft(craftTime(r)) + '</span><div class="small">' + gcReagHtml(g, c, r, 1) + '</div></div>' +
      (r.ench ? '' : '<input type="number" class="gcn" data-gcn="' + sid + '" min="1" max="' + Math.max(1, mk) + '" value="1"' + (mk ? '' : ' disabled') + '>') +
      '<button class="mini" data-gcord="' + sid + '"' + (mk ? '' : ' disabled') + '>' + (r.ench ? 'Enchant mine' : 'Order') + '</button></div>';
  }
  if (list.length > 120) h += '<div class="small muted">' + (list.length - 120) + ' more - search for them.</div>';
  return h + '</div></div>';
}
function gcraftInput(e) { if (e.target.id !== 'gcQ') return false; GC.q = e.target.value; renderSheet(); const i = $('gcQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } return true; }
function gcraftChange(e) { if (!e.target.dataset || !e.target.dataset.gccan) return false; GC.can = e.target.checked; renderSheet(); return true; }
function gcraftClick(e) {
  const c = active(); const g = guildOf(c); const b = e.target.closest('[data-gcsel],[data-gcord],[data-wcx]'); if (!b || !g) return false;
  if (b.dataset.gcsel) { GC.sel = b.dataset.gcsel; renderSheet(); return true; }
  if (b.dataset.wcx) { const o = gcOrders(g).find((x) => x.id === b.dataset.wcx); if (o) gcCancel(g, o); renderSheet(); return true; }
  if (b.dataset.gcord) {
    const cur = gcCrafters(g).find((x) => x.key === GC.sel); if (!cur) return true;
    const inp = $('sheetLeft').querySelector('[data-gcn="' + b.dataset.gcord + '"]'); const n = inp ? Math.max(1, +inp.value || 1) : 1;
    gcOrder(c, cur.c, +b.dataset.gcord, n); renderSheet(); return true;
  }
  return false;
}
/* the bars of the orders move every frame while the tab is open */
function updateWcBars() {
  if (!SH.open || SH.tab !== 'gcraft') return; const g = guildOf(active()); if (!g || !g.orders) return;
  for (const el of document.querySelectorAll('.wcbar')) {
    const o = g.orders.find((x) => x.id === el.dataset.wc); const r = o && PD().recipes[o.sid]; if (!o || !r) continue;
    const first = g.orders.find((x) => x.crafter === o.crafter); if (first !== o) continue;
    el.firstChild.style.width = Math.min(100, 100 * o.t / craftTime(r)).toFixed(1) + '%'; el.lastChild.textContent = fmtCraft(Math.max(0, craftTime(r) - o.t)) + ' left';
  }
}
