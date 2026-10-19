'use strict';
/* professions.js - professions: learning them at trainers (with a "find trainer" walk), skill ranks, recipes, crafting,
   enchanting gear, gathering nodes (herbs, ore) that stay hidden on the map until gathered once, skinning,
   and a gathering route (checkpoints the character walks in a loop, gathering every node it passes). */

const PROF_PRIMARY_MAX = 2;
const GATHER_KIND = { 182: 'herb', 186: 'ore' };
const SKINNING = 393;
const NODE_SEE = 45;                  // yards: nodes this close to the route are noticed
const NODE_RESPAWN = [420, 900];      // seconds until a gathered node is back
const PROF_RANK_NAMES = ['Apprentice', 'Journeyman', 'Expert', 'Artisan'];
const INV_SLOT = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 20: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, 11: 10, 12: 12, 16: 14, 13: 15, 17: 15, 21: 15, 14: 16, 22: 16, 23: 16, 15: 17, 25: 17, 26: 17 };

function PD() { return G.d.prof; }
function profState(c) { if (!c.prof) c.prof = { skills: {}, recipes: {}, found: {}, route: null }; return c.prof; }
function hasProf(c, id) { return !!(c.prof && c.prof.skills[id]); }
function profSkill(c, id) { const s = c.prof && c.prof.skills[id]; return s ? s.v : 0; }
function profName(id) { const s = PD() && PD().skills[id]; return s ? s.n : 'profession ' + id; }
function profKind(id) { const s = PD() && PD().skills[id]; return s ? s.kind : 'craft'; }
function primaryCount(c) { let n = 0; for (const id in profState(c).skills) if (profKind(id) !== 'secondary') n++; return n; }
function profRankIdx(c, id) { const s = profState(c).skills[id]; if (!s) return -1; return PD().skills[id].ranks.findIndex((r) => r[1] === s.max); }
function profNextRank(c, id) {
  const ranks = PD().skills[id].ranks; const cur = profRankIdx(c, id); const next = ranks[cur + 1];
  if (!next) return null;
  const s = profState(c).skills[id];
  return { idx: cur + 1, spell: next[0], max: next[1], lvl: next[2], cost: next[3], ready: c.level >= next[2] && (!s || s.v >= ranks[cur][1] - 25) };
}

/* ------------------------------------------------------------------ indexes */
function profIndex() {
  if (G.profIdx) return G.profIdx;
  const byItem = {}, reag = {}, made = {};
  for (const sid in PD().recipes) {
    const r = PD().recipes[sid];
    if (r.item) byItem[r.item] = +sid;
    for (const [it] of r.re || []) (reag[it] = reag[it] || new Set()).add(r.skill);
    if (r.cr) made[r.cr[0]] = r.skill;
  }
  const gathered = new Set();
  for (const e in PD().nodes) { const o = G.d.go && G.d.go.objects[e]; for (const row of (o && G.d.go.loot[o[2]]) || []) gathered.add(row[0]); }
  return (G.profIdx = { byItem, reag, made, gathered });
}
function skinLoot(entry) {
  if (!G.skinIdx) { G.skinIdx = {}; for (const s of G.d.skinning || []) if (s.kind === 'Skinning') G.skinIdx[s.entry] = s.loot; }
  return G.skinIdx[entry] || null;
}
/* items a character with professions keeps (never sold as junk) */
function profKeeps(c, id) {
  if (!c.prof || !Object.keys(c.prof.skills).length || !PD()) return false;
  if (rt(c).sellMats) return false;                     // bags full and nothing else to sell: materials go too
  const X = profIndex();
  if (X.reag[id]) for (const sk of X.reag[id]) if (c.prof.skills[sk]) return true;
  if (X.byItem[id]) { const r = PD().recipes[X.byItem[id]]; if (r && c.prof.skills[r.skill] && !c.prof.recipes[X.byItem[id]]) return true; }
  if (X.gathered.has(id) && (c.prof.skills[182] || c.prof.skills[186])) return true;
  const it = itemRow(id); if (it && it.c === 7 && c.prof.skills[SKINNING] && /Leather|Hide|Scale/.test(it.n)) return true;
  return false;
}

/* ------------------------------------------------------------------ learning */
function learnProfession(c, id, rank) {
  const P = profState(c); const R = PD().skills[id].ranks[rank];
  const s = P.skills[id] || (P.skills[id] = { v: 1, max: 0 });
  s.max = R[1];
  if (rank === 0) for (const sid in PD().recipes) { const r = PD().recipes[sid]; if (r.skill === +id && r.free) P.recipes[sid] = 1; }
  log((rank === 0 ? 'Learned ' : 'Trained ') + PROF_RANK_NAMES[rank] + ' ' + profName(id) + ' (skill up to ' + R[1] + ').');
}
function unlearnProfession(c, id) {
  const P = profState(c); delete P.skills[id];
  for (const sid in P.recipes) if (PD().recipes[sid] && PD().recipes[sid].skill === +id) delete P.recipes[sid];
  log('Unlearned ' + profName(id) + '.'); save();
}
/* everything this trainer can teach the character now: the profession, its next rank, new recipes */
function trainAt(c, npc, focus) {
  const P = profState(c); const skills = (PD().trainers[npc] || []).slice().sort((a, b) => (b === focus) - (a === focus));
  let spent = 0, learned = 0;
  for (const sk of skills) {
    if (!P.skills[sk]) {
      if (sk !== focus) continue;
      if (profKind(sk) !== 'secondary' && primaryCount(c) >= PROF_PRIMARY_MAX) { log('You already have two main professions - unlearn one first.'); continue; }
      const R = PD().skills[sk].ranks[0];
      if (c.level < R[2]) { log(profName(sk) + ' can be learned from level ' + R[2] + '.'); continue; }
      if (c.gold < R[3]) { log('Not enough money to learn ' + profName(sk) + ' (' + money(R[3]) + ').'); continue; }
      c.gold -= R[3]; spent += R[3]; learnProfession(c, sk, 0);
    }
    const nx = profNextRank(c, sk);
    if (nx && nx.ready && c.gold >= nx.cost) { c.gold -= nx.cost; spent += nx.cost; learnProfession(c, sk, nx.idx); }
    const v = profSkill(c, sk);
    const list = Object.keys(PD().recipes).filter((sid) => { const r = PD().recipes[sid]; return r.skill === sk && !P.recipes[sid] && !r.item && r.learn <= v && (r.trainers.includes(+npc) || r.trainers.length === 0); })
      .sort((a, b) => PD().recipes[a].learn - PD().recipes[b].learn);
    for (const sid of list) { const r = PD().recipes[sid]; if (c.gold < r.cost) break; c.gold -= r.cost; spent += r.cost; P.recipes[sid] = 1; learned++; }
  }
  if (learned) log('Learned ' + learned + ' new recipe' + (learned > 1 ? 's' : '') + (spent ? ' (' + money(spent) + ' in total)' : '') + '.');
  else if (!spent) log('Nothing new to learn here right now.');
  save(); refreshGear();
}
/* recipe items (Recipe: ..., Pattern: ..., Plans: ...) in the bags are learned when the skill is high enough */
/* recipe items (Recipe:, Pattern:, Plans:, Schematic:, Formula:) are learned by hand ("Learn recipe" in the item menu)
   when the character has the profession with enough skill */
function recipeOf(id) { if (!PD()) return null; const sid = profIndex().byItem[id]; return sid ? { sid, r: PD().recipes[sid] } : null; }
function recipeLearnWhy(c, id) {
  const x = recipeOf(id); if (!x) return 'not a recipe';
  if (c.prof && c.prof.recipes[x.sid]) return 'already known';
  if (!c.prof || !c.prof.skills[x.r.skill]) return 'requires ' + profName(x.r.skill);
  if (profSkill(c, x.r.skill) < x.r.learn) return 'requires ' + profName(x.r.skill) + ' (' + x.r.learn + ')';
  return null;
}
function learnRecipeItem(c, idx, quiet) {
  const inst = c.bags[idx]; if (!inst) return false; const x = recipeOf(inst.id); if (!x) return false;
  const why = recipeLearnWhy(c, inst.id); if (why) { if (!quiet) log('Cannot learn ' + itemName(inst.id) + ': ' + why + '.'); return false; }
  profState(c).recipes[x.sid] = 1; log('Learned ' + x.r.n + ' (' + profName(x.r.skill) + ') from ' + itemName(inst.id) + '.'); fx(c.pos.x, c.pos.y, 'New recipe', '#ffd23a');
  if (--inst.n <= 0) c.bags.splice(idx, 1);
  return true;
}
/* recipes are learned only by hand (the item menu); this only says once when one in the bags can be learned now */
function checkRecipeItems(c) {
  if (!c.prof || !PD()) return; const r = rt(c); r.recipeSaid = r.recipeSaid || {};
  for (const x of c.bags) { const rc = recipeOf(x.id); if (!rc || r.recipeSaid[x.id] || recipeLearnWhy(c, x.id)) continue; r.recipeSaid[x.id] = 1; withLog(c, () => log('You can learn ' + itemName(x.id) + ' now (click it in the bags - Learn recipe).')); }
}
function recipeTipLine(c, id) {
  const x = recipeOf(id); if (!x) return ''; const why = recipeLearnWhy(c, id);
  const made = x.r.cr ? itemName(x.r.cr[0]) : x.r.n;
  return '<div class="small" style="color:' + (why && why !== 'already known' ? '#ff6a5a' : '#1eff00') + '">Teaches ' + esc(profName(x.r.skill)) + ': ' + esc(made) + ' (skill ' + x.r.learn + ')' + (why ? ' - ' + esc(why) : ' - click it, Learn recipe') + '</div>' +
    (x.r.re ? '<div class="small muted">Reagents: ' + x.r.re.map(([it, n]) => n + ' x ' + esc(itemName(it))).join(', ') + '</div>' : '');
}

/* ------------------------------------------------------------------ skill ups */
function chanceByColor(col) { return col === 'orange' ? 1 : col === 'yellow' ? 0.75 : col === 'green' ? 0.25 : 0; }
function recipeColor(c, r) { const v = profSkill(c, r.skill); if (v < r.learn) return 'red'; if (v < r.y) return 'orange'; if (v < r.g) return 'yellow'; if (v < r.gr) return 'green'; return 'grey'; }
function gatherColor(v, req) { if (v < req) return 'red'; if (v < req + 25) return 'orange'; if (v < req + 50) return 'yellow'; if (v < req + 100) return 'green'; return 'grey'; }
function skillUp(c, id, col) {
  const s = profState(c).skills[id]; if (!s || s.v >= s.max) return;
  if (rt(c).rcT !== s.v) { rt(c).rcT = s.v; setTimeout(() => checkRecipeItems(c), 0); }
  if (Math.random() >= chanceByColor(col)) return;
  s.v++; if (s.v % 5 === 0 || s.v === s.max) log('Your skill in ' + profName(id) + ' has increased to ' + s.v + '.');
  if (s.max - s.v === 25 && profNextRank(c, id)) log('Visit a ' + profName(id) + ' trainer to learn the next rank.');
}
function skinReq(L) { return L <= 10 ? Math.max(1, (L - 10) * 10 + 1) : L * 5; }

/* ------------------------------------------------------------------ crafting */
const ENCH_TIER = { Minor: 1, Lesser: 2, '': 3, Greater: 5, Superior: 7, Major: 9 };
/* a rough bonus from the enchant's name: Enchant Bracer - Lesser Strength -> +2 strength ... */
function enchantBonus(name) {
  const m = / - (Minor |Lesser |Greater |Superior |Major )?(.*)$/.exec(name) || [];
  const tier = ENCH_TIER[(m[1] || '').trim()] || 3; const what = (m[2] || '').trim(); const b = { n: name.replace(/^(Enchant|Imbue) /, '') };
  const stat = { Strength: 'str', Agility: 'agi', Stamina: 'sta', Intellect: 'int', Spirit: 'spi' }[what];
  if (stat) b.st = [[stat, tier]];
  else if (/Health/.test(what)) b.hp = [5, 15, 25, 35, 50, 65, 80, 100, 120][tier - 1];
  else if (/Mana/.test(what)) b.mana = [5, 20, 30, 40, 55, 65, 80, 100, 120][tier - 1];
  else if (/Stats/.test(what)) b.st = ['str', 'agi', 'sta', 'int', 'spi'].map((k) => [k, Math.max(1, Math.round(tier / 2))]);
  else if (/Protection|Defense|Deflect|Armor|Absorption/.test(what)) b.armor = tier * 10;
  else if (/Resistance/.test(what)) b.res = tier;
  else if (/Striking|Impact|Beastslayer|Crusader|Fiery|Icy|Lifestealing|Demonslaying|Unholy/.test(what)) b.dmg = Math.max(1, tier - (/Impact/.test(what) ? -1 : 0));
  else if (/Skinning|Mining|Herbalism|Fishing/.test(what)) b.none = true;
  else if (/Haste|Agility|Dodge/.test(what)) b.st = [['agi', tier]];
  return b;
}
function enchantSlot(r) {
  const sl = r.slot; if (!sl) return null;
  if (sl[0] === 2) return 15;
  for (const t in INV_SLOT) if (sl[2] & (1 << +t)) return INV_SLOT[t];
  return null;
}
function craftCount(c, sid) {
  const r = PD().recipes[sid]; let n = Infinity;
  for (const [it, k] of r.re || []) n = Math.min(n, Math.floor(bagCount(c, it) / k));
  return n === Infinity ? 0 : n;
}
/* crafting takes as long as in the game (the recipe's cast time: a bolt of cloth 3 s, an enchant 5 s, a hauberk a
   minute): Craft / All put it in a queue, one item after the other; a fight pauses it (the item being made starts over),
   the character stands still while crafting. The progress bar is in the bag panel and under the portrait. */
function craftTime(r) { return Math.max(0.5, (r.ct || 3000) / 1000); }
function craft(c, sid, times) {
  const r = PD().recipes[sid]; if (!r || !profState(c).recipes[sid]) return 0;
  const n = Math.min(times || 1, craftCount(c, sid)); if (n < 1) return 0;
  const R = rt(c);
  if (R.craftQ && R.craftQ.sid !== sid) craftFinish(c);          // something else was being made: it stops there
  R.craftQ = { sid, left: n, total: n, done: 0, made: {}, t: 0 };
  R.resting = false; R.eating = null; R.drinking = null; R.mv = null;
  log((r.ench ? 'Enchanting: ' : 'Crafting ' + (n > 1 ? n + ' x ' : '')) + r.n + ' (' + fmtCraft(craftTime(r)) + (n > 1 ? ' each' : '') + ').');
  return n;
}
function fmtCraft(s) { return s >= 60 ? Math.round(s / 60 * 10) / 10 + ' min' : (Math.round(s * 10) / 10) + ' s'; }
/* one item of the recipe made: true when it worked */
function craftOne(c, r, made) {
  if (r.ench) {
    const slot = enchantSlot(r); const inst = slot != null ? c.equip[slot] : null;
    if (!inst) { log('Nothing to enchant: ' + r.n + ' needs an item in that slot.'); return false; }
    if (/2H Weapon/.test(r.ench) && (itemRow(inst.id) || {}).t !== 17) { log(r.n + ' needs a two-handed weapon.'); return false; }
    for (const [it, n] of r.re || []) removeItem(c, it, n);
    inst.ench = enchantBonus(r.ench); dirty(c);
    log('Enchanted ' + itemName(inst.id, inst) + ': ' + inst.ench.n + '.');
  } else if (r.cr) {
    if (bagFree(c) <= 0 && !c.bags.some((x) => x.id === r.cr[0] && x.n < itemStack(r.cr[0]))) { log('Bags are full.'); return false; }
    for (const [it, n] of r.re || []) removeItem(c, it, n);
    const n = irnd(r.cr[1] || 1, Math.max(r.cr[1] || 1, r.cr[2] || 1)); addItem(c, r.cr[0], n); made[r.cr[0]] = (made[r.cr[0]] || 0) + n;
  } else return false;
  skillUp(c, r.skill, recipeColor(c, r));
  return true;
}
/* every frame (updateChar, out of a fight): true while crafting */
function craftStep(c, dt) {
  const R = rt(c); const q = R.craftQ; if (!q) return false;
  const r = PD() && PD().recipes[q.sid]; if (!r || q.left <= 0 || craftCount(c, q.sid) < 1) { craftFinish(c); return false; }
  R.mv = null; q.t += dt;
  if (q.t < craftTime(r)) return true;
  q.t = 0;
  if (!craftOne(c, r, q.made)) { craftFinish(c); return false; }
  q.done++; q.left--;
  if (q.left <= 0 || craftCount(c, q.sid) < 1) craftFinish(c);
  else { save(); if (SH.open) renderSheet(); }
  return true;
}
function craftFinish(c) {
  const R = rt(c); const q = R.craftQ; if (!q) return; R.craftQ = null;
  for (const id in q.made) log('Created ' + q.made[id] + ' x ' + itemName(+id) + '.');
  if (q.done) { checkRecipeItems(c); autoEquip(c); save(); refreshGear(); } else if (SH.open) renderSheet();
}
function craftCancel(c) { const q = rt(c).craftQ; if (!q) return; log('Crafting stopped' + (q.done ? ' after ' + q.done + ' of ' + q.total : '') + '.'); craftFinish(c); }
/* what is being made, for the bars: {name, t, total, n} */
function craftNow(c) {
  const q = rt(c).craftQ; const r = q && PD() && PD().recipes[q.sid]; if (!r) return null;
  return { name: r.n, t: q.t, total: craftTime(r), n: q.total > 1 ? (q.done + 1) + '/' + q.total : '', ic: r.ic };
}
function craftBarHtml(c) {
  const k = craftNow(c); if (!k) return '';
  return '<div class="craftbar" id="craftBar"><div class="cbfill"><i style="width:' + Math.min(100, 100 * k.t / k.total).toFixed(1) + '%"></i><span>' + esc(k.name) + (k.n ? ' (' + k.n + ')' : '') + '</span></div><button class="mini" data-ccancel="1" title="Stop crafting">&#10006;</button></div>';
}
/* the bar moves without redrawing the whole window */
function updateCraftBar() {
  if (!SH.open) return; const el = $('craftBar'); const k = craftNow(active());
  if (!k) { if (el) renderSheet(); return; }
  if (!el) { renderSheet(); return; }
  el.querySelector('i').style.width = Math.min(100, 100 * k.t / k.total).toFixed(1) + '%';
}

/* ------------------------------------------------------------------ nodes */
function nodeGrid(map) {
  G.nodeGrid = G.nodeGrid || {};
  if (G.nodeGrid[map]) return G.nodeGrid[map];
  const g = new Map();
  for (const e in PD().nodes) {
    const [kind, req] = PD().nodes[e];
    objSpawns(+e).forEach((s, i) => {
      if (s[0] !== map) return;
      const n = { e: +e, i, x: s[1], y: s[2], kind, req, key: e + ':' + i };
      const k = gk(cell(n.x), cell(n.y)); let a = g.get(k); if (!a) g.set(k, a = []); a.push(n);
    });
  }
  return (G.nodeGrid[map] = g);
}
function nodesNear(map, x, y, rad, fn) {
  const g = nodeGrid(map); const c0 = cell(x - rad), c1 = cell(x + rad), r0 = cell(y - rad), r1 = cell(y + rad);
  for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) { const a = g.get(gk(cx, cy)); if (a) for (const n of a) if (Math.hypot(n.x - x, n.y - y) <= rad) fn(n); }
}
function nodeFree(n) { return !(G.nodeUsed && G.nodeUsed[n.key] > G.gameTime); }
function canGather(c, n) { const sk = n.kind === 'herb' ? 182 : 186; return hasProf(c, sk) && profSkill(c, sk) >= n.req; }
/* the nearest node the character can gather (free, reachable, not next to dangerous creatures) */
function findNode(c, rad) {
  const r = rt(c); let best = null, bd = 1e9; const W = ensureWorld(c.pos.map);
  nodesNear(c.pos.map, c.pos.x, c.pos.y, rad, (n) => {
    if (!canGather(c, n) || !nodeFree(n) || (r.nodeBan && r.nodeBan[n.key] > G.gameTime)) return;
    const d = Math.hypot(n.x - c.pos.x, n.y - c.pos.y); if (d >= bd) return;
    let bad = false; mobsNear(W, n.x, n.y, 30, (m) => { if (!bad && m.st === 'alive' && behOf(m, c) === 'A' && dangerous(m, c) && Math.hypot(m.x - n.x, m.y - n.y) < aggroRadius(m, c) + 6) bad = true; });
    if (!bad) { bd = d; best = n; }
  });
  return best;
}
function gatherNode(c, n) {
  const sk = n.kind === 'herb' ? 182 : 186;
  startInteract(c, n.kind === 'herb' ? 'Herb Gathering' : 'Mining', () => {
    if (!nodeFree(n)) return;
    lootGo(c, n.e, true);
    G.nodeUsed = G.nodeUsed || {}; G.nodeUsed[n.key] = G.gameTime + rnd(NODE_RESPAWN[0], NODE_RESPAWN[1]);
    const P = profState(c); if (!P.found[n.key]) P.found[n.key] = [c.pos.map, Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10, n.kind, n.e];
    skillUp(c, sk, gatherColor(profSkill(c, sk), n.req));
    const o = c.order; if (o && o.type === 'patrol') o.gathered = (o.gathered || 0) + 1;
    if (bagFree(c) <= 0) rt(c).bagFull = true;
    save();
  }, n.kind === 'herb' ? 2.5 : 3.5);
}
/* walk to a node and gather it. returns true while busy with it */
function gatherStep(c, o, rad) {
  const r = rt(c);
  if (o.node && (!nodeFree(o.node) || !canGather(c, o.node))) o.node = null;
  if (!o.node) { if (G.gameTime - (o.nodeT || -9) < 1) return false; o.nodeT = G.gameTime; o.node = findNode(c, rad); if (!o.node) return false; o.nodeSince = G.gameTime; }
  const n = o.node;
  if (G.gameTime - o.nodeSince > 60) { r.nodeBan = r.nodeBan || {}; r.nodeBan[n.key] = G.gameTime + 600; o.node = null; return false; }
  if (!goTo(c, n.x, n.y, 3)) { if (r.blocked) { r.blocked = false; r.nodeBan = r.nodeBan || {}; r.nodeBan[n.key] = G.gameTime + 600; o.node = null; } return true; }
  o.node = null; gatherNode(c, n); return true;
}

/* ------------------------------------------------------------------ disenchanting (Enchanting)
   Green, blue and purple armor and weapons break down into dust, essences and shards (one result each time, from the
   item's own disenchant table). The skill needed grows with the item level: 1 up to item level 20, then 25 more for
   every 5 levels; epics need at least 225. */
const ENCHANTING = 333;
function disenchantReq(it) { const il = it.il || 1; const r = il <= 20 ? 1 : Math.ceil((il - 20) / 5) * 25; return Math.min(300, it.q >= 4 ? Math.max(225, r) : r); }
/* why this cannot be disenchanted by c (null: it can) */
function disenchantWhy(c, inst) {
  const it = itemRow(inst.id); if (!it || !it.de || !(it.q >= 2 && it.q <= 4)) return 'cannot be disenchanted';
  if (!hasProf(c, ENCHANTING)) return 'needs Enchanting';
  const req = disenchantReq(it); if (profSkill(c, ENCHANTING) < req) return 'needs Enchanting ' + req;
  return null;
}
function disenchantable(id) { const it = itemRow(id); return !!(it && it.de && it.q >= 2 && it.q <= 4); }
/* disenchanting goes through a queue (one item or many - the mass disenchant of the bag panel): 2 seconds each, a fight in
   between only pauses it; at the end one line with everything it gave. Materials: about half more than in the game
   (Enchanting is less of a grind here). */
const DE_TIME = 2, DE_BONUS = 1.5;
function deBonus(n) { const v = n * DE_BONUS; const f = Math.floor(v); return f + (Math.random() < v - f ? 1 : 0); }
function disenchantQueue(c, insts) {
  const r = rt(c); r.deQueue = r.deQueue || []; r.deGot = r.deGot || {}; r.deDone = r.deDone || 0; let n = 0;
  for (const inst of insts) if (inst && !r.deQueue.includes(inst) && c.bags.includes(inst) && !disenchantWhy(c, inst)) { r.deQueue.push(inst); n++; }
  return n;
}
function disenchantItem(c, idx, quiet) {
  const inst = c.bags[idx]; if (!inst) return false; const why = disenchantWhy(c, inst);
  if (why) { if (!quiet) log(itemName(inst.id, inst) + ': ' + why + '.'); return false; }
  return disenchantQueue(c, [inst]) > 0;
}
/* one step of the queue (profStep): true while busy with it */
function deQueueStep(c) {
  const r = rt(c); if (!r.deQueue || !r.deQueue.length) return false;
  if (r.interact) return true;
  while (r.deQueue.length && (!c.bags.includes(r.deQueue[0]) || disenchantWhy(c, r.deQueue[0]))) r.deQueue.shift();      // sold, traded, moved away
  if (!r.deQueue.length) { deSummary(c); return false; }
  const inst = r.deQueue[0]; const it = itemRow(inst.id);
  r.resting = false; r.eating = null; r.drinking = null; r.mv = null;          // stands up for it, rests again afterwards
  startInteract(c, 'Disenchanting ' + itemName(inst.id, inst), () => {
    const i = c.bags.indexOf(inst); if (r.deQueue[0] === inst) r.deQueue.shift(); if (i < 0) return;
    c.bags.splice(i, 1); r.deDone = (r.deDone || 0) + 1; r.deNames = (r.deNames || []).concat([itemName(inst.id, inst)]);
    const raw = G.d.loot.raw && G.d.loot.raw.disenchant && G.d.loot.raw.disenchant[it.de]; const out = [];
    if (raw) lootRollRows(raw, () => false, out, 0);
    else for (const [item, pct, mn, mx] of (G.d.loot.tables.disenchant || {})[it.de] || []) if (Math.random() * 100 < pct) out.push([item, irnd(mn, mx)]);
    for (const [item, n0] of out) {
      const n = deBonus(n0); if (!n) continue;
      if (addItem(c, item, n)) r.deGot[item] = (r.deGot[item] || 0) + n; else log('Bags are full - ' + itemName(item) + ' is lost.');
    }
    if (!r.deQueue.length) deSummary(c);
    if (c.prof) checkRecipeItems(c);
    save(); refreshGear();
  }, DE_TIME);
  return true;
}
function deSummary(c) {
  const r = rt(c); if (!r.deDone) { r.deGot = {}; return; }
  const got = Object.keys(r.deGot).map((id) => (r.deGot[id] > 1 ? r.deGot[id] + ' x ' : '') + itemName(+id));
  log('Disenchanted ' + (r.deDone === 1 ? r.deNames[0] : r.deDone + ' items') + ': ' + (got.join(', ') || 'nothing') + '.');
  r.deGot = {}; r.deDone = 0; r.deNames = [];
}
/* the automation option: green gear that is no upgrade is disenchanted instead of sold (out of a fight, one at a time) */
function autoDisenchantStep(c) {
  if (!hasProf(c, ENCHANTING) || !cset(c, 'autoDisenchant')) return false;
  if (G.gameTime - (rt(c).deT || -9) < 2) return false; rt(c).deT = G.gameTime;
  const inst = c.bags.find((x) => { const it = itemRow(x.id); return it && it.q === 2 && it.de && !disenchantWhy(c, x) && !upgradeFor(c, x) && !(G.q.startBy && G.q.startBy[x.id]); });
  return !!inst && disenchantQueue(c, [inst]) > 0 && deQueueStep(c);
}

/* ------------------------------------------------------------------ skinning */
function skinnable(c, m) { if (!hasProf(c, SKINNING) || !m || m.skinned) return false; const l = skinLoot(m.e); return !!(l && l.length) && profSkill(c, SKINNING) >= skinReq(m.lvl); }
const LEATHERWORKING = 165, SKIN_CORPSE_TIME = 120;
/* after a kill: a beast that can be skinned goes on the list (corpses stay a while, so a fight right after does not lose
   it); a leatherworker without Skinning is told once how to get the leather */
function onKillProf(c, m) {
  const r = rt(c);
  if (skinnable(c, m)) { r.skin = (r.skin || []).filter((x) => G.gameTime - x.t < SKIN_CORPSE_TIME && !x.m.skinned).concat([{ m, x: m.x, y: m.y, t: G.gameTime }]); return; }
  if (!hasProf(c, SKINNING) && hasProf(c, LEATHERWORKING) && !r.lwHint && (skinLoot(m.e) || []).length) { r.lwHint = true; log(c.name + ' could skin this ' + (m.info ? m.info[1] : 'beast') + ' for leather - learn Skinning at a trainer (Professions) and every beast it kills is skinned.'); }
}
function skinStep(c) {
  const r = rt(c); if (!r.skin || !r.skin.length) return false;
  const s = r.skin[0];
  if (G.gameTime - s.t > SKIN_CORPSE_TIME || s.m.st !== 'dead' || s.m.skinned) { r.skin.shift(); return false; }
  if (!goTo(c, s.x, s.y, 3)) { if (r.blocked) { r.blocked = false; r.skin.shift(); } return true; }
  // the corpse stays on the list until it is skinned: a creature that attacks in the middle only delays it
  startInteract(c, 'Skinning', () => {
    const k = r.skin.indexOf(s); if (k >= 0) r.skin.splice(k, 1);
    if (s.m.skinned || s.m.st !== 'dead') return;
    const got = [];
    // a skin gives one of the beast's leathers (one roll over their chances, like the game: never nothing)
    // (tables adding up to well over 100%: each item on its own - scales and the like on top - but never nothing)
    const L = skinLoot(s.m.e) || []; const sum = L.reduce((t, l) => t + (l.chance || 0), 0);
    const pickOne = () => { let roll = Math.random() * sum; return L.find((x) => (roll -= x.chance || 0) < 0) || L[L.length - 1]; };
    let picks = sum <= 110 ? [pickOne()] : L.filter((x) => Math.random() * 100 < x.chance); if (!picks.length && L.length) picks = [pickOne()];
    for (const l of picks) { const n = irnd(l.min || 1, l.max || 1); if (addItem(c, l.item, n)) got.push((n > 1 ? n + ' x ' : '') + itemName(l.item)); else log('Bags are full - ' + itemName(l.item) + ' is lost.'); }
    s.m.skinned = true; if (got.length) log('Skinned: ' + got.join(', ') + '.');
    const o = c.order; if (o && o.type === 'patrol' && o.kind === 'skin') o.skinned = (o.skinned || 0) + 1;
    skillUp(c, SKINNING, gatherColor(profSkill(c, SKINNING), skinReq(s.m.lvl)));
    if (bagFree(c) <= 0) r.bagFull = true;
  }, 2);
  return true;
}
/* called by updateChar when nothing else is going on: skin corpses, gather nodes near the way while leveling */
function profStep(c) {
  if (!c.prof || !PD()) return false; const r = rt(c);
  if (r.sellMats && bagFree(c) > 4) r.sellMats = false;
  if (autoDisenchantStep(c)) return true;           // frees a bag slot, so before the full-bags check
  if (bagFree(c) <= 2) return false;
  if (skinStep(c)) return true;
  const o = c.order; if (!o || G.state.settings.gatherWhileLeveling === false) return false;
  if (o.type !== 'leveling' && o.type !== 'questing' && o.type !== 'grind') return false;
  if (!c.prof.skills[182] && !c.prof.skills[186]) return false;
  r.gw = r.gw || {};
  return gatherStep(c, r.gw, 30);
}

/* ------------------------------------------------------------------ orders: find trainer, gathering route */
function trainerSpots(c, skill) {
  const out = [];
  for (const e in PD().trainers) {
    if (!PD().trainers[e].includes(+skill)) continue;
    const h = G.d.hostility.creatures[e]; if (!h || h[1][behIndex(c)] !== 'F') continue;
    for (const s of G.spawnMap.get(+e) || []) if (s[0] === 0 || s[0] === 1) out.push({ e: +e, map: s[0], x: s[1], y: s[2] });
  }
  return out;
}
function orderTrainer(c, skill) {
  const spots = trainerSpots(c, skill);
  if (!spots.length) { log('No ' + profName(skill) + ' trainer found for your faction.'); return; }
  spots.sort((a, b) => (a.map !== c.pos.map) - (b.map !== c.pos.map) || Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y));
  let best = null;
  for (const s of spots.slice(0, 10)) { const trip = planTrip(c, { map: s.map, x: s.x, y: s.y }); if (trip && (!best || trip.secs < best.trip.secs)) best = { s, trip }; }
  if (best) {
    const s = best.s, trip = best.trip;
    const resume = c.order && c.order.type !== 'trainer' ? c.order : null;
    c.order = { type: 'trainer', skill: +skill, e: s.e, map: s.map, x: s.x, y: s.y, trip, label: mobName(s.e), resume };
    rt(c).mv = null; rt(c).tgt = null;
    log('Order: walk to ' + mobName(s.e) + ' to train ' + profName(skill) + '.');
    save(); renderOrder(); return;
  }
  log('Cannot find a way to a ' + profName(skill) + ' trainer.');
}
/* while leveling: a profession can learn its next rank - visit a trainer on the way (once per level) */
function profAutoTrain(c, o) {
  if (G.state.settings.autoTrainProf === false || o.profTrainLv === c.level) return false;
  for (const id in profState(c).skills) {
    const nx = profNextRank(c, +id); if (!nx || !nx.ready || c.gold < nx.cost * 1.5 + 500) continue;
    o.profTrainLv = c.level; log(profName(+id) + ' can learn ' + PROF_RANK_NAMES[nx.idx] + ' now - visiting a trainer first.');
    orderTrainer(c, +id); return c.order && c.order.type === 'trainer';
  }
  return false;
}
function updateTrainer(c, o, dt) {
  const st = tripStep(c, o.trip);
  if (st === 'busy') return;
  if (st === 'fail') { log('Could not reach ' + o.label + '.'); c.order = o.resume || null; renderOrder(); return; }
  if (Math.hypot(o.x - c.pos.x, o.y - c.pos.y) > 5 && c.pos.map === o.map) { goTo(c, o.x, o.y, 4); if (rt(c).blocked) { rt(c).blocked = false; c.order = o.resume || null; } return; }
  c.order = o.resume || null;
  startInteract(c, 'Training', () => { trainAt(c, o.e, o.skill); renderOrder(); }, 1.5);
  renderOrder();
}
/* three routes: 'gather' (herbs, ore), 'grind' (creatures along the way, no gathering) and 'skin' (the beasts along the
   way that can be skinned: killed, then skinned - the others are walked past) */
const ROUTE_KIND = { gather: { key: 'route', name: 'Gathering route', color: 'rgba(120,230,120,.9)', dot: '#1c3a1c', ring: '#9cf09c', text: '#d8ffd8' },
  grind: { key: 'routeGrind', name: 'Grinding route', color: 'rgba(255,120,100,.9)', dot: '#3a1c1c', ring: '#ff9c8c', text: '#ffe0d8' },
  skin: { key: 'routeSkin', name: 'Skinning route', color: 'rgba(225,170,100,.9)', dot: '#3a2a14', ring: '#f0c48c', text: '#ffeed8' } };
function routeFights(kind) { return kind === 'grind' || kind === 'skin'; }
function routeOf(c, kind) { return profState(c)[ROUTE_KIND[kind || 'gather'].key] || null; }
function setRoute(c, kind, R) { profState(c)[ROUTE_KIND[kind || 'gather'].key] = R; }
function orderPatrol(c, kind) {
  kind = kind || 'gather'; const K = ROUTE_KIND[kind];
  const R = routeOf(c, kind); if (!R || R.pts.length < 2) { log('Set at least two checkpoints for the ' + K.name.toLowerCase() + ' first.'); return; }
  if (kind === 'gather' && !c.prof.skills[182] && !c.prof.skills[186] && !c.prof.skills[SKINNING]) log('No gathering profession yet - the route is walked anyway (learn Herbalism, Mining or Skinning at a trainer).');
  if (kind === 'skin' && !hasProf(c, SKINNING)) log('No Skinning yet - the beasts along the route are killed anyway (learn Skinning at a trainer to skin them).');
  let best = 0, bd = 1e9; R.pts.forEach((p, i) => { const d = Math.hypot(p.x - c.pos.x, p.y - c.pos.y); if (d < bd) { bd = d; best = i; } });
  const trip = R.map !== c.pos.map || bd > 400 ? planTrip(c, { map: R.map, x: R.pts[best].x, y: R.pts[best].y }) : null;
  if (R.map !== c.pos.map && !trip) { log('Cannot find a way to the ' + K.name.toLowerCase() + '.'); return; }
  c.order = { type: 'patrol', kind, i: best, laps: 0, gathered: 0, kills: 0, skinned: 0, trip, started: G.gameTime, label: K.name.toLowerCase() };
  rt(c).mv = null; rt(c).tgt = null;
  log('Order: walk the ' + K.name.toLowerCase() + ' (' + R.pts.length + ' checkpoints).'); save(); renderOrder();
}
function updatePatrol(c, o, dt) {
  const r = rt(c); const kind = o.kind || 'gather'; const R = routeOf(c, kind);
  if (!R || R.pts.length < 2) { c.order = null; renderOrder(); return; }
  if (r.bagFull || bagFree(c) <= 0) { bagsFull(c, o); return; }
  if (o.trip) { const st = tripStep(c, o.trip); if (st === 'busy') return; if (st === 'fail') { log('Could not reach the ' + ROUTE_KIND[kind].name.toLowerCase() + '.'); c.order = null; renderOrder(); return; } o.trip = null; }
  if (kind === 'gather' && gatherStep(c, o, NODE_SEE)) return;
  if (routeFights(kind)) {
    // every creature within the fight range of the route is attacked (the nearest first; on the skinning route only the
    // beasts that can be skinned); then back to the route
    if (r.tgt && (r.tgt.st !== 'alive' || (r.tgt.banUntil || 0) > G.gameTime)) r.tgt = null;
    if (r.tgt && r.tgt.st === 'alive' && routeDist(R, r.tgt.x, r.tgt.y) > (R.range || ROUTE_FIGHT_RANGE) + 25) r.tgt = null;     // walked away from the route before the fight began
    if (!r.tgt && G.gameTime - (o.lookT || -9) > 0.5) { o.lookT = G.gameTime; r.tgt = routeTarget(c, R, o, kind); }
    if (r.tgt) { o.off = true; const st = approach(c, r.tgt); if (st === 'gone') r.tgt = null; return; }
    if (o.off) {      // back onto the route where it left it (the nearest point of the leg it was walking)
      const a = R.pts[(o.i - 1 + R.pts.length) % R.pts.length], b = R.pts[o.i % R.pts.length]; const q = nearestOnSeg(c.pos, a, b);
      if (Math.hypot(q.x - c.pos.x, q.y - c.pos.y) > 6 && !goTo(c, q.x, q.y, 3) && !r.blocked) return;
      r.blocked = false; o.off = false;
    }
  }
  const p = R.pts[o.i % R.pts.length];
  if (goTo(c, p.x, p.y, 3) || r.blocked) {
    if (r.blocked) { r.blocked = false; log('Checkpoint ' + (o.i + 1) + ' cannot be reached - skipping it.'); }
    o.i = (o.i + 1) % R.pts.length; if (o.i === 0 && !R.open) o.laps++;
    if (R.open && o.i === 0) { R.pts.reverse(); o.i = 1; o.laps++; }
  }
}
const ROUTE_FIGHT_RANGE = 40;
function nearestOnSeg(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y; const L = dx * dx + dy * dy || 1; const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1); return { x: a.x + dx * t, y: a.y + dy * t }; }
function routeDist(R, x, y) {
  let best = Infinity; const n = R.pts.length; const segs = R.open ? n - 1 : n;
  for (let i = 0; i < segs; i++) { const a = R.pts[i], b = R.pts[(i + 1) % n]; const q = nearestOnSeg({ x, y }, a, b); best = Math.min(best, Math.hypot(q.x - x, q.y - y)); }
  return best;
}
/* the grinding route: every creature near the way that can be fought (not critters, totems, town guards, elites,
   ones far above the character's level or too dangerous) - the nearest to the character first */
function routeTarget(c, R, o, kind) {
  const skin = kind === 'skin'; const canSkin = skin && hasProf(c, SKINNING);
  const W = ensureWorld(c.pos.map); const rng = R.range || ROUTE_FIGHT_RANGE; let best = null, bd = Infinity;
  // only along the leg being walked (what the character passes), so it keeps moving on instead of waiting for respawns
  const n = R.pts.length; const a = R.pts[(o.i - 1 + n) % n], b = R.pts[o.i % n];
  mobsNear(W, c.pos.x, c.pos.y, rng + 30, (m) => {
    if (m.st !== 'alive' || !attackable(m, c) || (m.banUntil || 0) > G.gameTime || m.civ) return;
    if (m.info && (m.info[5] === 8 || m.info[5] === 11)) return;
    if (factionNpc(m) || m.rank >= 1 || dangerous(m, c) || m.lvl > c.level + 3) return;
    // the skinning route: only what can be skinned (with Skinning: what the skill is high enough for)
    if (skin && (!(skinLoot(m.e) || []).length || (canSkin && profSkill(c, SKINNING) < skinReq(m.lvl)))) return;
    const q = nearestOnSeg({ x: m.x, y: m.y }, a, b); if (Math.hypot(q.x - m.x, q.y - m.y) > rng) return;      // where it is now (some walk far from home)
    const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y); if (d < bd) { bd = d; best = m; }
  });
  return best;
}
function patrolText(c, o) {
  const kind = o.kind || 'gather'; const R = routeOf(c, kind);
  const where = o.trip ? tripText(o.trip) : 'checkpoint ' + ((o.i % (R ? R.pts.length : 1)) + 1) + '/' + (R ? R.pts.length : 0);
  if (kind === 'grind') { const t = rt(c).tgt; return { t: 'Grinding route', d: where + ', lap ' + (o.laps + 1) + ', ' + (o.kills || 0) + ' kills' + (t && t.info ? ' - fighting ' + t.info[1] : '') }; }
  if (kind === 'skin') { const t = rt(c).tgt; return { t: 'Skinning route', d: where + ', lap ' + (o.laps + 1) + ', ' + (o.kills || 0) + ' kills, ' + (o.skinned || 0) + ' skinned' + (t && t.info ? ' - fighting ' + t.info[1] : '') }; }
  return { t: 'Gathering route', d: where + ', lap ' + (o.laps + 1) + ', ' + (o.gathered || 0) + ' nodes gathered' + (o.node ? ' - going to ' + objName(o.node.e) : '') };
}
/* the buttons next to Stop: start the route, or set it up when there is none */
function routeButton(c, kind) {
  const R = routeOf(c, kind); const K = ROUTE_KIND[kind];
  if (R && R.pts.length >= 2) { if (G.routeEdit) { G.routeEdit = null; renderRouteBar(); } orderPatrol(c, kind); } else routeEditStart(kind);
}

/* ------------------------------------------------------------------ route editing on the map */
function routeEditStart(kind) {
  kind = kind || 'gather'; const c = active();
  if (G.map.world || G.map.cont || G.map.dmap) goToCharacter();
  const R = routeOf(c, kind);
  if (!R || R.map !== G.map.map) setRoute(c, kind, { map: G.map.map, pts: [], open: false });
  G.routeEdit = kind; closeSheet(); renderRouteBar(); log('Click the map to add checkpoints to the ' + ROUTE_KIND[kind].name.toLowerCase() + '.');
}
function routeAddPoint(w) {
  const c = active(); const kind = typeof G.routeEdit === 'string' ? G.routeEdit : 'gather';
  const R = routeOf(c, kind);
  if (!R || R.map !== G.map.map) setRoute(c, kind, { map: G.map.map, pts: [], open: false });
  if (!passable(G.map.map, w.x, w.y)) { log('Cannot walk there.'); return; }
  routeOf(c, kind).pts.push({ x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10 }); save(); renderRouteBar();
}
function renderRouteBar() {
  let el = $('routebar');
  if (!G.routeEdit) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'routebar'; $('mapwrap').appendChild(el); el.onclick = routeBarClick;
    el.onchange = (e) => { if (e.target.dataset && e.target.dataset.rrange != null) { const R = routeOf(active(), typeof G.routeEdit === 'string' ? G.routeEdit : 'grind'); if (R) { R.range = clamp(+e.target.value || ROUTE_FIGHT_RANGE, 10, 150); save(); } } };
  }
  const kind = typeof G.routeEdit === 'string' ? G.routeEdit : 'gather';
  const R = routeOf(active(), kind); const n = R ? R.pts.length : 0;
  el.hidden = false;
  el.innerHTML = '<b>' + ROUTE_KIND[kind].name + '</b> - click the map to add checkpoints (' + n + ')' +
    '<label class="chk"><input type="checkbox" data-ropen' + (R && R.open ? ' checked' : '') + '> walk back and forth</label>' +
    (routeFights(kind) ? '<label class="chk">' + (kind === 'skin' ? 'hunt skinnable beasts' : 'fight everything') + ' within <input type="number" data-rrange min="10" max="150" step="5" value="' + ((R && R.range) || ROUTE_FIGHT_RANGE) + '" style="width:52px"> yd of the route</label>' : '') +
    '<button class="mini" data-r="undo"' + (n ? '' : ' disabled') + '>Undo</button><button class="mini" data-r="clear"' + (n ? '' : ' disabled') + '>Clear</button>' +
    '<button class="mini" data-r="done">Done</button><button class="act" data-r="start"' + (n >= 2 ? '' : ' disabled') + '>Start route</button>';
}
function routeBarClick(e) {
  const c = active(); const kind = typeof G.routeEdit === 'string' ? G.routeEdit : 'gather'; const R = routeOf(c, kind);
  if (e.target.dataset && e.target.dataset.ropen != null) { if (R) R.open = e.target.checked; save(); return; }
  if (e.target.dataset && e.target.dataset.rrange != null) return;
  const b = e.target.closest('[data-r]'); if (!b) return; const a = b.dataset.r;
  if (a === 'undo' && R) R.pts.pop();
  if (a === 'clear' && R) R.pts = [];
  if (a === 'done') G.routeEdit = false;
  if (a === 'start') { G.routeEdit = false; orderPatrol(c, kind); }
  save(); renderRouteBar(); renderOrder();
}

/* ------------------------------------------------------------------ drawing */
function drawProfOverlay(ctx, m) {
  const c = active(); if (!c.prof) return;
  for (const kind in ROUTE_KIND) {
    const R = routeOf(c, kind); const K = ROUTE_KIND[kind];
    const busy = c.order && c.order.type === 'patrol' && (c.order.kind || 'gather') === kind;
    if (!R || R.map !== m.map || !R.pts.length || !(G.routeEdit === kind || busy || G.state.settings.showRoute !== false)) continue;
    ctx.save(); ctx.setLineDash([7, 5]); ctx.strokeStyle = K.color; ctx.lineWidth = 2.2; ctx.beginPath();
    R.pts.forEach((p, i) => { const [x, y] = w2s(p.x, p.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    if (!R.open && R.pts.length > 2) { const [x, y] = w2s(R.pts[0].x, R.pts[0].y); ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center';
    R.pts.forEach((p, i) => { const [x, y] = w2s(p.x, p.y); ctx.fillStyle = K.dot; ctx.strokeStyle = K.ring; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.3); ctx.fill(); ctx.stroke(); ctx.fillStyle = K.text; ctx.fillText(String(i + 1), x, y + 3.5); });
    ctx.textAlign = 'start'; ctx.restore();
  }
  if (G.state.settings.showNodes === false) return;
  const sz = Math.max(3, Math.min(6, G.scale * 1.5));
  for (const k in c.prof.found) {
    const f = c.prof.found[k]; if (f[0] !== m.map || !inMap(m, f[1], f[2])) continue;
    const [x, y] = w2s(f[1], f[2]); if (x < -8 || y < -8 || x > G.cw + 8 || y > G.ch + 8) continue;
    const up = nodeFree({ key: k });
    ctx.globalAlpha = up ? 1 : 0.4;
    if (f[3] === 'herb') { ctx.fillStyle = '#5fe06a'; ctx.strokeStyle = '#0b3010'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - sz - 1); ctx.quadraticCurveTo(x + sz + 1, y, x, y + sz + 1); ctx.quadraticCurveTo(x - sz - 1, y, x, y - sz - 1); ctx.fill(); ctx.stroke(); }
    else { ctx.fillStyle = '#e0a050'; ctx.strokeStyle = '#3a2208'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - sz); ctx.lineTo(x + sz, y); ctx.lineTo(x, y + sz); ctx.lineTo(x - sz, y); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ the professions window */
function profBar(c, id) { const s = profState(c).skills[id]; return '<div class="bar xp pbar"><i style="width:' + (100 * s.v / Math.max(1, s.max)) + '%"></i><span>' + s.v + ' / ' + s.max + '</span></div>'; }
function reagHtml(c, r) { return (r.re || []).map(([it, n]) => { const have = bagCount(c, it); return '<span class="reag' + (have >= n ? '' : ' miss') + '" data-iid="' + it + '">' + esc(itemName(it)) + ' ' + Math.min(have, 999) + '/' + n + '</span>'; }).join(' '); }
/* the professions window: every part is a drop-down section (click its title), a search over all recipes
   (recipe, item and reagent names) and a "can craft now" filter */
const PROFUI = { q: '', can: false };
function profOpen(key, def) { const o = G.state.settings.profOpen || {}; return key in o ? o[key] : def; }
function profSection(key, title, body, def, force) {
  const open = force || profOpen(key, def);
  return '<div class="sgroup psec' + (open ? ' open' : '') + '"><h5 data-psec="' + key + '"><span class="parr">' + (open ? '&#9662;' : '&#9656;') + '</span> ' + title + '</h5>' + (open ? '<div class="pbody">' + body + '</div>' : '') + '</div>';
}
function recipeMatches(r, q) {
  if (!q) return true; if (r.n.toLowerCase().indexOf(q) >= 0) return true;
  if (r.cr && itemName(r.cr[0]).toLowerCase().indexOf(q) >= 0) return true;
  return (r.re || []).some(([it]) => itemName(it).toLowerCase().indexOf(q) >= 0);
}
function professionsHtml(c) {
  if (!PD()) return '<div class="muted">professions.json is missing (run script\\wow_professions_json.py).</div>';
  const P = profState(c); const q = PROFUI.q.trim().toLowerCase(); const filtering = !!q || PROFUI.can;
  let h = '<div class="prof"><div class="psearch"><input id="profSearch" type="search" placeholder="Search recipes, items, reagents..." value="' + esc(PROFUI.q) + '">' +
    '<label class="chk"><input type="checkbox" data-pcan="1"' + (PROFUI.can ? ' checked' : '') + '> Can craft now</label>' +
    '<button class="mini" data-pall="1" title="Open every section">Open all</button><button class="mini" data-pall="0" title="Close every section">Close all</button></div>';
  const mine = Object.keys(P.skills).map(Number);
  let b = '';
  if (!mine.length) b += '<div class="muted small">None yet. Pick up to two main professions and any of the secondary ones below.</div>';
  for (const id of mine) {
    const nx = profNextRank(c, id); const ri = profRankIdx(c, id);
    b += '<div class="prow"><b>' + esc(profName(id)) + '</b> <span class="muted small">' + (PROF_RANK_NAMES[ri] || '') + '</span>' + profBar(c, id) +
      '<button class="mini" data-ptrain="' + id + '" title="Walks to the nearest trainer and learns new ranks and recipes">Find trainer</button>' +
      '<button class="mini red" data-punlearn="' + id + '" title="Forget this profession">&#10005;</button>' +
      (nx ? '<div class="small muted">Next: ' + PROF_RANK_NAMES[nx.idx] + ' (up to ' + nx.max + ') at level ' + nx.lvl + ', skill ' + (PD().skills[id].ranks[ri][1] - 25) + ', ' + money(nx.cost) + (nx.ready ? ' - <span class="up">ready, visit a trainer</span>' : '') + '</div>' : '') + '</div>';
  }
  h += profSection('mine', 'Your professions', b, true);
  b = '<div class="plearn">';
  for (const id of Object.keys(PD().skills).map(Number).filter((x) => !P.skills[x])) {
    const prim = profKind(id) !== 'secondary'; const block = prim && primaryCount(c) >= PROF_PRIMARY_MAX;
    b += '<button class="mini" data-ptrain="' + id + '"' + (block ? ' disabled title="You already have two main professions"' : '') + '>' + esc(profName(id)) + (prim ? '' : ' <span class="muted">(secondary)</span>') + '</button>';
  }
  b += '</div><div class="small muted">The button walks to the nearest trainer of your faction (by flight path and ship if needed) and learns it there.</div>';
  h += profSection('learn', 'Learn a profession', b, false);
  // crafting
  let hits = 0;
  for (const id of mine) {
    if (id === FISHING) { if (!filtering) h += profSection('fish', 'Fishing', fishingHtml(c), true); continue; }
    const all = Object.keys(P.recipes).filter((sid) => PD().recipes[sid] && PD().recipes[sid].skill === id).sort((a, b) => PD().recipes[b].learn - PD().recipes[a].learn);
    if (profKind(id) === 'gather' && !all.length) continue;
    const list = all.filter((sid) => recipeMatches(PD().recipes[sid], q) && (!PROFUI.can || craftCount(c, sid) > 0));
    if (filtering && !list.length) continue;
    hits += list.length;
    b = '';
    if (!all.length) b += '<div class="muted small">No recipes yet - visit a trainer.</div>';
    for (const sid of list) {
      const r = PD().recipes[sid]; const col = recipeColor(c, r); const n = craftCount(c, sid);
      const it = r.cr ? itemRow(r.cr[0]) : null;
      b += '<div class="rrow">' + (it && it.ic ? '<img class="sic" src="../icons/' + it.ic.toLowerCase() + '.jpg" alt="">' : '<span class="sic"></span>') +
        '<div class="rname"><b class="rc-' + col + '"' + (r.cr ? ' data-iid="' + r.cr[0] + '"' : '') + '>' + esc(r.n) + '</b>' + (n ? ' <span class="muted">[' + n + ']</span>' : '') + '<div class="small">' + reagHtml(c, r) + '</div></div>' +
        '<button class="mini" data-pcraft="' + sid + '"' + (n ? '' : ' disabled') + '>' + (r.ench ? 'Enchant' : 'Craft') + '</button>' +
        (r.ench ? '' : '<button class="mini" data-pcraftall="' + sid + '"' + (n > 1 ? '' : ' disabled') + '>All</button>') + '</div>';
    }
    const waiting = c.bags.filter((x) => { const rc = recipeOf(x.id); return rc && rc.r.skill === id && !profState(c).recipes[rc.sid]; });
    if (waiting.length) b += '<div class="small" style="margin:4px 0">Recipes in your bags (click one in the bags to learn it when the skill is high enough): ' + waiting.map((x) => '<span data-iid="' + x.id + '" style="color:#ff9a8a">' + esc(itemName(x.id)) + ' (' + recipeOf(x.id).r.learn + ')</span>').join(', ') + '</div>';
    b += '<div class="small muted">Colors: <span class="rc-orange">orange</span> always raises the skill, <span class="rc-yellow">yellow</span> usually, <span class="rc-green">green</span> rarely, <span class="rc-grey">grey</span> never.</div>';
    const craftable = all.filter((sid) => craftCount(c, sid) > 0).length;
    h += profSection('r' + id, esc(profName(id)) + ' - recipes <span class="pcount">' + (filtering ? list.length + ' of ' + all.length : all.length) + (craftable ? ', ' + craftable + ' craftable' : '') + '</span>', b, false, filtering);
  }
  if (filtering && !hits) h += '<div class="sgroup muted small">No recipe matches' + (q ? ' "' + esc(PROFUI.q) + '"' : '') + (PROFUI.can ? ' that you can craft now' : '') + '.</div>';
  if (filtering) return h + '</div>';
  // gathering
  const R = routeOf(c, 'gather'); const nf = Object.keys(P.found).length;
  b = '<div class="small">' + (R && R.pts.length ? R.pts.length + ' checkpoints on ' + (R.map === 0 ? 'Eastern Kingdoms' : 'Kalimdor') + (R.open ? ', walked back and forth' : ', walked in a loop') : 'No route yet.') + '</div>' +
    '<div class="pbtns"><button class="mini" data-proute="edit">Edit route on the map</button><button class="mini" data-proute="clear"' + (R && R.pts.length ? '' : ' disabled') + '>Clear route</button><button class="act" data-proute="start"' + (R && R.pts.length >= 2 ? '' : ' disabled') + '>Start route</button></div>' +
    '<div class="small muted">The character walks from checkpoint to checkpoint and gathers every herb or ore it can (within ' + NODE_SEE + ' yards), fights what attacks it, skins its kills (Skinning) and sells junk when the bags are full. Nodes are hidden on the map until gathered once (' + nf + ' found so far).</div>' +
    '<label class="chk"><input type="checkbox" data-pset="gatherWhileLeveling"' + (G.state.settings.gatherWhileLeveling !== false ? ' checked' : '') + '> Gather nodes near the way while leveling and questing</label>' +
    '<label class="chk"><input type="checkbox" data-pset="autoTrainProf"' + (G.state.settings.autoTrainProf !== false ? ' checked' : '') + '> Visit a trainer for the next rank by itself while leveling</label>' +
    '<label class="chk"><input type="checkbox" data-pset="showNodes"' + (G.state.settings.showNodes !== false ? ' checked' : '') + '> Show found nodes on the map</label>';
  h += profSection('route', 'Gathering route', b, false);
  return h + '</div>';
}
/* typing in the search box: the list follows at once, the box keeps the focus */
function professionsInput(e) {
  if (e.target.id !== 'profSearch') return false;
  PROFUI.q = e.target.value; renderSheet(); return true;
}
function professionsClick(e) {
  const c = active(); const b = e.target.closest('[data-ptrain],[data-punlearn],[data-pcraft],[data-pcraftall],[data-proute],[data-psec],[data-pall]'); if (!b) return false;
  const d = b.dataset;
  if (d.psec) { const o = G.state.settings.profOpen = G.state.settings.profOpen || {}; const def = d.psec === 'mine' || d.psec === 'fish'; o[d.psec] = !profOpen(d.psec, def); save(); renderSheet(); return true; }
  if (d.pall) { const o = G.state.settings.profOpen = {}; for (const k of ['mine', 'learn', 'fish', 'route'].concat(Object.keys(profState(c).skills).map((x) => 'r' + x))) o[k] = d.pall === '1'; save(); renderSheet(); return true; }
  if (d.ptrain) { orderTrainer(c, +d.ptrain); closeSheet(); return true; }
  if (d.punlearn) { if (confirm('Forget ' + profName(+d.punlearn) + ' and all its recipes?')) unlearnProfession(c, +d.punlearn); renderSheet(); return true; }
  if (d.pcraft) { craft(c, +d.pcraft, 1); renderSheet(); return true; }
  if (d.pcraftall) { craft(c, +d.pcraftall, 999); renderSheet(); return true; }
  if (d.proute === 'edit') { routeEditStart('gather'); return true; }
  if (d.proute === 'clear') { profState(c).route = null; save(); renderSheet(); return true; }
  if (d.proute === 'start') { orderPatrol(c, 'gather'); closeSheet(); return true; }
  return false;
}
function professionsChange(e) {
  const t = e.target; if (t.dataset && t.dataset.pcan) { PROFUI.can = t.checked; renderSheet(); return true; }
  if (!t.dataset || t.dataset.pset == null) return false;
  G.state.settings[t.dataset.pset] = t.checked; save(); syncNodeToggle(); return true;
}
function syncNodeToggle() { const n = $('shownodes'); if (n) n.checked = G.state.settings.showNodes !== false; }
