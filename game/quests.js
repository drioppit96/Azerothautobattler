'use strict';
/* quests.js - quest givers (NPCs and objects), objectives (kill, collect from creatures or objects, use objects,
   use items on NPCs, items from other quests), turn-in and rewards, the single-quest order and the automatic
   zone questing order (Valley of Trials, then Durotar ...). */

const INTERACT_TIME = 2.5;
const GO_RESPAWN = 90;
const NPC_REUSE = 45;

/* ------------------------------------------------------------------ index */
function buildQuestIndex() {
  const Q = { byId: {}, byGiver: {}, byGiverObj: {}, byPrev: {}, itemSrc: {}, goSrc: {}, rewardSrc: {}, vendorSrc: {}, startBy: {}, support: {}, zoneOf: {}, meta: {}, fac: {} };
  const need = new Set();
  for (const q of G.d.quests) {
    Q.byId[q.id] = q;
    for (const g of q.giver) {
      if (g[0] === 'npc') (Q.byGiver[g[1]] = Q.byGiver[g[1]] || []).push(q);
      else (Q.byGiverObj[g[1]] = Q.byGiverObj[g[1]] || []).push(q);
    }
    if (q.prev > 0) (Q.byPrev[q.prev] = Q.byPrev[q.prev] || []).push(q);
    for (const [it] of q.reward_items.concat(q.choice_items)) (Q.rewardSrc[it] = Q.rewardSrc[it] || []).push(q.id);
    for (const o of q.objectives) if (o.type === 'Collect') need.add(o.id);
    if (q.start_item) { need.add(q.start_item); if (!q.giver.length) (Q.startBy[q.start_item] = Q.startBy[q.start_item] || []).push(q); }
  }
  const users = {};
  for (const e in G.d.loot.creatures) { const lid = G.d.loot.creatures[e][6]; if (lid) (users[lid] = users[lid] || []).push(+e); }
  const tabs = G.d.loot.tables.creature;
  for (const lid in tabs) {
    const us = users[lid]; if (!us) continue;
    for (const [item, pct, , , quest] of tabs[lid]) {
      if (!quest && !need.has(item)) continue;           // every drop of an item some quest asks for counts as a source
      const a = Q.itemSrc[item] = Q.itemSrc[item] || [];
      for (const e of us) a.push([e, pct]);
    }
  }
  const go = G.d.go;
  if (go) {
    for (const e in go.objects) {
      const lid = go.objects[e][2]; const rows = lid ? go.loot[lid] : null; if (!rows) continue;
      // treasure chests and ore veins are not quest sources (endless loot), small quest objects are
      const generic = rows.length > 4 || /chest|strongbox|lockbox|footlocker|cache|vein|deposit|coffer/i.test(go.objects[e][0] || '');
      for (const [item, pct, , , quest] of rows) if (quest || !generic) (Q.goSrc[item] = Q.goSrc[item] || []).push([+e, pct]);
    }
  }
  const vi = G.d.vendorItems || {};
  for (const e in vi) for (const [id] of vi[e]) if (need.has(id)) (Q.vendorSrc[id] = Q.vendorSrc[id] || []).push(+e);
  G.q = Q;
  buildGiverIndex();
}
/* every place a quest can be picked up, per map: [{q, x, y, e, obj}] */
function buildGiverIndex() {
  const idx = {};
  for (const q of G.d.quests) for (const s of giverSpawns(q.giver)) (idx[s.map] = idx[s.map] || []).push({ q, s });
  G.q.giverPts = idx;
}
function spawnsOf(entry, mapId) { return (G.spawnMap.get(+entry) || []).filter((s) => s[0] === mapId); }
function objSpawns(entry) { const o = G.d.objects && G.d.objects.objects[entry]; return o || []; }
function giverSpawns(list) {
  const out = [];
  for (const [kind, e] of list) {
    if (kind === 'npc') for (const s of G.spawnMap.get(+e) || []) out.push({ kind, e: +e, map: s[0], x: s[1], y: s[2], zone: s[5], sub: s[6] });
    else objSpawns(e).forEach((s, i) => out.push({ kind: 'object', e: +e, i, map: s[0], x: s[1], y: s[2], zone: s[4], sub: s[5], obj: true }));
  }
  return out;
}
function nearestOf(c, list) {
  let best = null, bd = 1e18;
  for (const s of list) { if (s.map !== c.pos.map) continue; const d = Math.hypot(s.x - c.pos.x, s.y - c.pos.y); if (d < bd) { bd = d; best = s; } }
  if (best) best.d = bd; return best;
}
function nearestNpcSpawn(c, ids) { return nearestOf(c, giverSpawns(ids.map((e) => ['npc', e]))); }
function mobName(e) { const i = G.mobIdx[e]; return i ? i[1] : 'NPC ' + e; }
function objName(e) { const o = G.d.go && G.d.go.objects[e]; return o ? o[0] : 'object ' + e; }
function spotName(s) { return s ? (s.obj ? objName(s.e) : mobName(s.e)) : '?'; }
function placeName(s, which) {
  if (!s) return '';
  const places = s.obj ? (G.d.objects ? G.d.objects.places : []) : G.d.spawns.places;
  return places[which === 'zone' ? s.zone : s.sub] || '';
}

/* ------------------------------------------------------------------ support */
function itemSources(q, id) {
  const out = [];
  if (id === q.start_item) out.push('start');
  if (G.q.itemSrc[id] && G.q.itemSrc[id].length) out.push('mob');
  if (G.q.goSrc[id] && G.q.goSrc[id].length) out.push('object');
  if (G.q.rewardSrc[id] && G.q.rewardSrc[id].some((x) => x !== q.id)) out.push('quest');
  if (G.q.vendorSrc[id] && G.q.vendorSrc[id].length) out.push('vendor');
  return out;
}
const OPEN_WORLD = { 0: 1, 1: 1 };
function npcRank(e) { const h = G.d.hostility.creatures[e]; return h ? h[6] || 0 : 0; }
function npcMaxLevel(e) { const i = G.mobIdx[e]; return i ? i[3] : 1; }
/* maps where objective o can be done, and the creatures involved: {maps:Set, mobs:[[entry, pct]], best} */
function objectiveSources(q, o) {
  const maps = new Set(); const mobs = [];
  const addMob = (e, p) => { let any = false; for (const sp of G.spawnMap.get(+e) || []) { maps.add(sp[0]); any = true; } if (any) mobs.push([+e, p]); };
  const addGo = (e) => { for (const sp of objSpawns(e)) maps.add(sp[0]); };
  if (o.type === 'Kill' || o.type === 'Use/Interact') { if (o.id < 0) addGo(-o.id); else addMob(o.id, 100); }
  else if (o.type === 'Collect') {
    for (const [e, p] of G.q.itemSrc[o.id] || []) addMob(e, p);
    for (const [e] of G.q.goSrc[o.id] || []) addGo(e);
    for (const e of G.q.vendorSrc[o.id] || []) for (const sp of G.spawnMap.get(e) || []) maps.add(sp[0]);
  }
  return { maps, mobs };
}
/* why a quest cannot be automated (null = it can). Also fills G.q.meta[id] = {home, elite, rare} */
/* quest sorts (negative zone_or_sort) that are not normal leveling quests: battlegrounds, holidays, professions, events */
const SKIP_SORTS = { '-1': 'epic (raid) quest', '-22': 'holiday quest', '-24': 'profession quest', '-25': 'battleground quest', '-101': 'profession quest', '-121': 'profession quest', '-181': 'profession quest', '-182': 'profession quest', '-201': 'profession quest', '-264': 'profession quest', '-304': 'profession quest', '-324': 'profession quest', '-344': 'legendary quest', '-364': 'Darkmoon Faire quest', '-365': "Ahn'Qiraj war effort", '-366': 'holiday quest', '-367': 'reputation turn-in', '-368': 'world event quest', '-369': 'holiday quest', '-370': 'holiday quest', '-284': 'special event quest' };
const BG_MAPS = { 30: 1, 489: 1, 529: 1 };
function questSupport(q) {
  if (q.id in G.q.support) return G.q.support[q.id];
  let why = null; const meta = { home: null, elite: 0 };
  if (/^(A )?Donation of /.test(q.title)) { G.q.meta[q.id] = meta; return (G.q.support[q.id] = 'reputation turn-in'); }
  if (q.repobj && q.repobj[1] > 0) { G.q.meta[q.id] = meta; return (G.q.support[q.id] = 'needs a reputation standing (' + (typeof repName === 'function' ? repName(q.repobj[0]) : 'a faction') + ')'); }
  if (q.zone_or_sort === 3277 || q.zone_or_sort === 3358 || q.zone_or_sort === 2597) { G.q.meta[q.id] = meta; return (G.q.support[q.id] = 'battleground quest'); }
  if (SKIP_SORTS[q.zone_or_sort]) { G.q.meta[q.id] = meta; return (G.q.support[q.id] = SKIP_SORTS[q.zone_or_sort]); }
  const open = (list) => list.filter((s) => OPEN_WORLD[s.map]);
  const dg = (list) => typeof dungeonByMap === 'function' ? list.filter((s) => dungeonByMap(s.map) && dungeonByMap(s.map).entrance) : [];
  const givers = giverSpawns(q.giver), turn = giverSpawns(q.turnin);
  if (!q.giver.length && !(q.start_item && itemSources(q, q.start_item).some((k) => k === 'mob' || k === 'object'))) why = 'starts from an item';
  else if (q.giver.length && !givers.length) why = 'quest giver not found';
  else if (q.giver.length && !open(givers).length && !dg(givers).length) why = 'dungeon quest';
  else if (!q.turnin.length || !turn.length) why = 'turn-in not found';
  else if (!open(turn).length && !dg(turn).length) why = 'dungeon quest';
  if (!why) {
    // given or turned in inside a dungeon: done on a dungeon run
    if (q.giver.length && !open(givers).length) meta.giverDungeon = dg(givers)[0].map;
    if (!open(turn).length) meta.turnDungeon = dg(turn)[0].map;
    const ho = open(givers)[0] || open(turn)[0];
    meta.home = ho ? ho.map : dungeonByMap((dg(givers)[0] || dg(turn)[0]).map).entrance.map;
    for (const o of q.objectives) {
      if (o.type !== 'Kill' && o.type !== 'Use/Interact' && o.type !== 'Collect') { why = 'needs a spell cast at a place - not automated yet'; break; }
      if (o.type === 'Collect' && !itemSources(q, o.id).length) { why = 'item source unknown'; break; }
      if (o.type === 'Collect' && itemSources(q, o.id).every((k) => k === 'quest' || k === 'start')) continue;
      const src = objectiveSources(q, o);
      if (o.type !== 'Collect' && !src.maps.size) { why = o.id < 0 ? 'object to use not found' : 'target has no spawns'; break; }
      if (o.type === 'Collect' && !src.maps.size) { why = 'item source unknown'; break; }
      if (![...src.maps].some((m) => OPEN_WORLD[m])) {
        // only inside a dungeon: done with a dungeon run (the quest giver and the turn-in are outside)
        const dm = typeof dungeonByMap === 'function' ? [...src.maps].find((m) => dungeonByMap(m) && dungeonByMap(m).entrance) : null;
        if (!dm) { why = 'dungeon quest'; break; }
        if (meta.dungeon && meta.dungeon !== dm) { why = 'objectives in two dungeons'; break; }
        meta.dungeon = dm; continue;
      }
      if (!src.maps.has(meta.home)) { why = 'objectives are on the other continent'; break; }
      if (src.mobs.length && !(o.type === 'Collect' && (G.q.goSrc[o.id] || G.q.vendorSrc[o.id]))) {
        // only elite creatures (group quest): remember their level; drops too rare to farm: give up
        const normal = src.mobs.filter(([e]) => npcRank(e) === 0);
        if (!normal.length) meta.elite = Math.max(meta.elite, ...src.mobs.map(([e]) => npcMaxLevel(e) + (npcRank(e) >= 2 ? 3 : 0)));
        if (o.type === 'Collect') { const best = Math.max(...src.mobs.map(([, p]) => p)); if (o.count * 100 / Math.max(0.01, best) > 250) { why = 'drops too rarely'; break; } }
      }
    }
  }
  G.q.meta[q.id] = meta; G.q.support[q.id] = why; return why;
}
function questMeta(q) { if (!(q.id in G.q.meta)) questSupport(q); return G.q.meta[q.id] || {}; }
/* the dungeon a quest is done in (or null) */
function questDungeon(q) { const m = questMeta(q); const id = m.dungeon || m.turnDungeon || m.giverDungeon; return id && typeof dungeonByMap === 'function' ? dungeonByMap(id) : null; }
/* level and settings allow the dungeon of a quest; auto = leveling / auto-questing (no raids, settings) */
function dungeonQuestOk(c, q, auto) {
  const d = questDungeon(q); if (!d) return true;
  if (auto && (cset(c, 'dungeonQuests') === false || d.kind === 'raid' || G.awayNoDungeon)) return false;
  return c.level >= d.lmin - (auto ? 0 : 3);
}
function dungeonQuestDist(c, d) { return d.entrance && d.entrance.map === c.pos.map ? Math.hypot(d.entrance.x - c.pos.x, d.entrance.y - c.pos.y) + 300 : 6000; }
/* a quest objective inside a dungeon: go in (with a group unless set otherwise), do it, come out, carry on with o */
function questDungeonRun(c, d, o, q) {
  o.dgTries = o.dgTries || {};
  if ((o.dgTries[q.id] || 0) >= 3) { log('"' + q.title + '": tried ' + d.name + ' three times - giving up on it.'); return false; }
  if (c.level < d.lmin - 3) { log('"' + q.title + '" is done in ' + d.name + ' - it needs level ' + (d.lmin - 3) + '.'); return false; }
  o.dgTries[q.id] = (o.dgTries[q.id] || 0) + 1;
  const group = cset(c, 'dungeonSolo') !== true;
  log('"' + q.title + '" is done in ' + d.name + ' - going in' + (group ? ' with a group' : ' alone') + '.');
  orderDungeon(c, d, group, o); if (!c.order || c.order.type !== 'dungeon') return false;
  c.order.questRun = true; return true;
}
/* the quest giver and the turn-in are friendly to this character (not an Alliance quest for a Horde character) */
function questFactionOk(c, q) {
  const k = behIndex(c); const cache = G.q.fac[k] = G.q.fac[k] || {};
  if (q.id in cache) return cache[q.id];
  const ok = (list) => { if (!list.length) return true; for (const [kind, e] of list) { if (kind !== 'npc') return true; const h = G.d.hostility.creatures[e]; if (!h || h[1][k] === 'F') return true; } return false; };
  return (cache[q.id] = ok(q.giver) && ok(q.turnin));
}
function questAvailable(c, q) {
  if (c.done[q.id] || c.quests[q.id] || (c.abandoned && c.abandoned[q.id])) return false;
  if (q.races && !(q.races & (1 << (c.race - 1)))) return false;
  if (q.classes && !(q.classes & (1 << (c.cls - 1)))) return false;
  if (c.level < q.min_level) return false;
  if (q.prev > 0 && !c.done[q.prev]) return false;
  if (q.prev < 0 && !c.quests[-q.prev]) return false;
  if (q.exclusive_group > 0) { for (const o of G.d.quests) if (o.exclusive_group === q.exclusive_group && o.id !== q.id && (c.done[o.id] || c.quests[o.id])) return false; }
  if (!questFactionOk(c, q)) return false;
  if (typeof repQuestOk === 'function' && G.d.rep && !repQuestOk(c, q)) return false;      // offered from (or below) a reputation standing
  return true;
}
/* a dropped item that starts a quest: take the quest */
function itemStartsQuest(c, id) {
  for (const q of G.q.startBy[id] || []) {
    if (!questAvailable(c, q) || questSupport(q) || questIgnored(c, q.id)) continue;
    log(itemName(id) + ' starts a quest.'); acceptQuest(c, q); return true;
  }
  return false;
}
function checkStarterItems(c) { for (const s of c.bags.slice()) if (G.q.startBy[s.id]) itemStartsQuest(c, s.id); }
function objDone(c, q, i) {
  const o = q.objectives[i]; const a = c.quests[q.id];
  if (o.type === 'Collect') return bagCount(c, o.id) >= o.count;
  return !!a && a.prog[i] >= o.count;
}
function questDone(c, q) { if (!c.quests[q.id]) return false; return q.objectives.every((o, i) => objDone(c, q, i)); }
function availableQuests(c, limit, maxD) {
  const out = []; const R = maxD || 2000; const seen = new Set();
  for (const { q, s } of (G.q.giverPts && G.q.giverPts[c.pos.map]) || []) {
    if (Math.abs(s.x - c.pos.x) > R || Math.abs(s.y - c.pos.y) > R) continue;
    if (q.level < c.level - 6 || q.level > c.level + 4 || q.min_level > c.level) continue;
    const d = Math.hypot(s.x - c.pos.x, s.y - c.pos.y); if (d > R) continue;
    if (seen.has(q.id)) { const o = out.find((x) => x.q === q); if (o && d < o.d) { o.d = d; o.s = s; } continue; }
    if (!questAvailable(c, q)) continue;
    seen.add(q.id); out.push({ q, d, s: Object.assign({}, s, { d }) });
  }
  out.sort((a, b) => (!!questSupport(a.q) - !!questSupport(b.q)) || a.d - b.d); return out.slice(0, limit || 12);
}

/* ------------------------------------------------------------------ progress */
function onKill(c, m) {
  for (const qid in c.quests) {
    const q = G.q.byId[qid]; const a = c.quests[qid]; if (!q) continue; let changed = false;
    q.objectives.forEach((o, i) => {
      if (o.type === 'Kill' && o.id === m.e && a.prog[i] < o.count) {
        a.prog[i]++; changed = true;
        log(q.title + ': ' + (m.info ? m.info[1] : o.name) + ' ' + a.prog[i] + '/' + o.count);
      }
    });
    if (changed && questDone(c, q)) log('Quest objectives complete: ' + q.title + '.');
  }
  renderQuests();
}
function onItemGained(c, id) {
  for (const qid in c.quests) {
    const q = G.q.byId[qid]; if (!q) continue;
    q.objectives.forEach((o) => {
      if (o.type === 'Collect' && o.id === id) { log(q.title + ': ' + itemName(id) + ' ' + Math.min(o.count, bagCount(c, id)) + '/' + o.count); if (questDone(c, q)) log('Quest objectives complete: ' + q.title + '.'); }
    });
  }
  renderQuests();
}
function credit(c, q, i) {
  const a = c.quests[q.id]; const o = q.objectives[i]; if (!a || a.prog[i] >= o.count) return;
  a.prog[i]++; log(q.title + ': ' + o.name + ' ' + a.prog[i] + '/' + o.count);
  if (questDone(c, q)) log('Quest objectives complete: ' + q.title + '.');
  save(); renderQuests();
}

/* ------------------------------------------------------------------ accept / turn in */
function acceptQuest(c, q) {
  c.quests[q.id] = { prog: q.objectives.map(() => 0), t: G.gameTime };
  if (q.start_item && !bagCount(c, q.start_item)) addItem(c, q.start_item, 1);
  log('Quest accepted: ' + q.title + ' (level ' + q.level + ').'); save(); renderQuests(); refreshGear();
  if (typeof questGroup === 'function') groupShareQuest(c, q);          // the group takes it too (quest mode)
}
function pickReward(c, q) {
  if (!q.choice_items.length) return null;
  let best = null, bs = -Infinity;
  for (const [id] of q.choice_items) {
    const it = itemRow(id); let score = itemSell(id);
    if (it && it.sl && !canEquip(c, id)) {
      const inst = makeInst(id, 1); const mine = itemScore(c, inst);
      let worst = Infinity; for (const sl of it.sl) { const cur = c.equip[sl]; const v = cur ? itemScore(c, cur) : -1; if (v < worst) worst = v; }
      score = 100000 + (mine - worst) * 100 + mine;
    }
    if (score > bs) { bs = score; best = id; }
  }
  return best;
}
function turnInQuest(c, q) {
  const need = q.reward_items.length + (q.choice_items.length ? 1 : 0);
  const freed = q.objectives.filter((o) => o.type === 'Collect').length;
  if (bagFree(c) + freed < need) return false;
  for (const o of q.objectives) if (o.type === 'Collect') removeItem(c, o.id, o.count);
  if (q.start_item && !q.objectives.some((o) => o.id === q.start_item) && !G.d.quests.some((x) => x.id !== q.id && c.quests[x.id] && x.start_item === q.start_item)) removeItem(c, q.start_item, 1);
  delete c.quests[q.id]; c.done[q.id] = 1;
  const xp = questXp(q, c); gainXp(c, xp);
  const cash = q.reward_money || 0; c.gold += cash;
  const got = [];
  for (const [id, n] of q.reward_items) { addItem(c, id, n); got.push((n > 1 ? n + ' x ' : '') + itemName(id)); }
  const ch = pickReward(c, q); if (ch) { const n = (q.choice_items.find((x) => x[0] === ch) || [0, 1])[1]; addItem(c, ch, n); got.push(itemName(ch) + ' (chosen reward)'); }
  masteryQuest(c);
  if (typeof questGroup === 'function') groupTurnIn(c, q);
  log('Quest complete: ' + q.title + '. +' + xp + ' xp' + (cash ? ', +' + money(cash) : '') + (got.length ? '. Received: ' + got.join(', ') : '') + '.');
  if (G.d.rep) repOnQuest(c, q);
  rt(c).bagFull = bagFree(c) <= 0;
  autoEquip(c);
  save(); renderQuests(); refreshGear(); renderChar();
  return true;
}

/* ------------------------------------------------------------------ interacting */
function startInteract(c, label, fn, dur) { rt(c).interact = { t: 0, dur: dur || INTERACT_TIME, label, fn }; }
/* returns true while busy (the character stands still) */
function interactStep(c, dt) {
  const r = rt(c); const it = r.interact; if (!it) return false;
  if (r.threats && r.threats.length) { r.interact = null; return false; }
  it.t += dt;
  if (it.t >= it.dur) { r.interact = null; it.fn(); }
  return true;
}
function goUsedKey(e, i) { return e + ':' + i; }
/* c given (quest objects): the one another character just used is still there for this one - like the game, where
   everyone in a group takes their own book from the shelf */
function goFree(e, i, c) { const k = goUsedKey(e, i); return !(G.goUsed && G.goUsed[k] > G.gameTime) || !!(c && G.goBy && G.goBy[k] && !G.goBy[k].includes(c.id)); }
function useGo(e, i, c) {
  const k = goUsedKey(e, i); G.goUsed = G.goUsed || {}; G.goBy = G.goBy || {};
  if (c && G.goUsed[k] > G.gameTime && G.goBy[k]) { G.goBy[k].push(c.id); return; }
  G.goUsed[k] = G.gameTime + GO_RESPAWN; G.goBy[k] = c ? [c.id] : null;
}
/* gather: a herb or ore node - its own herb / ore (the sure drop) comes 1 to 3 at a time */
function lootGo(c, e, gather) {
  const o = G.d.go && G.d.go.objects[e]; const rows = o && o[2] ? G.d.go.loot[o[2]] || [] : []; const got = [];
  for (const [item, pct, mn, mx, quest] of rows) {
    if (quest && !questNeeds(c, item)) continue;
    if (Math.random() * 100 >= pct) continue;
    const n = gather && pct >= 100 ? irnd(Math.max(1, mn), Math.max(3, mx)) : irnd(mn, mx);
    if (quest || questNeeds(c, item)) roomForQuestItem(c, item);
    if (addItem(c, item, n)) { got.push((n > 1 ? n + ' x ' : '') + itemName(item)); if (quest || questNeeds(c, item)) onItemGained(c, item); if (G.q.startBy[item]) itemStartsQuest(c, item); }
  }
  if (got.length) log('Took from ' + objName(e) + ': ' + got.join(', ')); else log(objName(e) + ' was empty.');
  refreshGear();
}

/* ------------------------------------------------------------------ objectives */
/* every way to make progress on objective i: [{kind, d, ...}] */
function objectiveOptions(c, q, i) {
  const o = q.objectives[i]; const out = []; const W = ensureWorld(c.pos.map);
  if (!W.byEntry) { W.byEntry = {}; for (const m of W.list) (W.byEntry[m.e] = W.byEntry[m.e] || []).push(m); }
  const mobs = (entries) => {
    for (const [e, w] of entries) for (const m of W.byEntry[e] || []) {
      const friendly = behOf(m, c) === 'F' || behOf(m, c) === 'X';
      if (friendly && o.type === 'Collect') continue;
      out.push({ kind: friendly ? 'npc' : 'mob', m, w, d: Math.hypot(m.x - c.pos.x, m.y - c.pos.y) });
    }
  };
  const gos = (entries) => {
    for (const [e, w] of entries) objSpawns(e).forEach((s, idx) => { if (s[0] === c.pos.map) out.push({ kind: 'go', e, i: idx, x: s[1], y: s[2], w, d: Math.hypot(s[1] - c.pos.x, s[2] - c.pos.y) }); });
  };
  if (o.type === 'Kill' || o.type === 'Use/Interact') { if (o.id < 0) gos([[-o.id, 100]]); else mobs([[o.id, 100]]); }
  else if (o.type === 'Collect') {
    const src = {}; for (const [e, p] of G.q.itemSrc[o.id] || []) src[e] = Math.max(src[e] || 0, p);
    mobs(Object.entries(src).map(([e, p]) => [+e, p]));
    gos(G.q.goSrc[o.id] || []);
    for (const e of G.q.vendorSrc[o.id] || []) for (const sp of G.spawnMap.get(e) || []) {
      if (sp[0] !== c.pos.map) continue; const b = behOf({ e }, c); if (b === 'A') continue;
      out.push({ kind: 'vendor', e, x: sp[1], y: sp[2], w: 100, d: Math.hypot(sp[1] - c.pos.x, sp[2] - c.pos.y) });
    }
  }
  return out;
}
function progText(c, q, i) { const ob = q.objectives[i]; const a = c.quests[q.id]; const n = ob.type === 'Collect' ? Math.min(ob.count, bagCount(c, ob.id)) : a ? a.prog[i] : 0; return n + '/' + ob.count; }
/* pick and pursue one way to progress objective i. returns 'busy' | 'none' | 'blocked' */
function workObjective(c, q, i, o) {
  const r = rt(c); const ob = q.objectives[i];
  // no progress on this objective for 12 minutes (targets too strong, always taken, out of reach): give up for now
  const pk = q.id + ':' + i + ':' + progText(c, q, i) + (typeof questGroup === 'function' ? questGroup(c).map((m) => m.quests[q.id] ? progText(m, q, i) : '').join(',') : '');
  if (o.progKey !== pk) { o.progKey = pk; o.progT = G.gameTime; }
  if (G.gameTime - o.progT > 720) { o.progT = G.gameTime; o.wt = null; return 'blocked'; }
  let t = o.wt && o.wt.q === q.id && o.wt.i === i ? o.wt : null;
  const valid = (x) => x && (x.kind === 'mob' ? x.m.st === 'alive' && (x.m.banUntil || 0) < G.gameTime :
    x.kind === 'npc' ? (x.m.usedUntil || 0) < G.gameTime && x.m.st !== 'dead' : x.kind === 'vendor' ? (typeof repItemOk !== 'function' || repItemOk(c, ob.id)) && c.gold >= vendorPrice(c, ob.id, x.e) * Math.ceil(Math.max(1, ob.count - bagCount(c, ob.id)) / buyCount(ob.id)) : goFree(x.e, x.i, c) && !(o.goBan && o.goBan[x.e + ':' + x.i] > G.gameTime));
  if (!valid(t)) {
    t = null;
    const opts = objectiveOptions(c, q, i); let bs = 1e18; let home = null, hd = 1e18; let strong = 0, soft = 0;
    // a named creature with only one or two spawns (Serena Bloodfeather, Yarrog Baneshadow): one more level is allowed
    const few = (x) => (ensureWorld(c.pos.map).byEntry || {})[x.m.e] && ensureWorld(c.pos.map).byEntry[x.m.e].length <= 2 ? 1 : 0;
    for (const x of opts) {
      const hx = x.m ? x.m.hx : x.x, hy = x.m ? x.m.hy : x.y; const dh = Math.hypot(hx - c.pos.x, hy - c.pos.y);
      if (dh < hd) { hd = dh; home = { x: hx, y: hy }; }
      if (!valid(x)) continue;
      if (x.kind === 'mob') {
        if (!attackable(x.m, c)) continue;
        const cap = (c.cfg.style === 'aggressive' ? 3 : c.cfg.style === 'safe' ? 1 : 2) + (groupFights(c, x.m) ? 1 : 0) + few(x);
        const eGap = x.m.rank === 1 ? 3 : x.m.rank === 4 ? 2 : 6;          // elites only when well above them (or with a group), rares a little
        const eliteOk = !(x.m.rank >= 1 && x.m.lvl > c.level - eGap && !groupFights(c, x.m));
        if (dangerous(x.m, c) || x.m.lvl > c.level + cap || !eliteOk) {
          // alive, but too strong for now: the level to come back at
          const need = Math.max(x.m.lvl - cap, effLevel(x.m) - 3, eliteOk ? 0 : x.m.lvl + eGap);
          if (!strong || need < strong) { strong = need; o.strongName = x.m.info ? x.m.info[1] + ' (level ' + x.m.lvl + ')' : ob.name; } continue;
        }
        let blocked = false; for (const z of r.danger) if (!z.soft && Math.hypot(x.m.x - z.m.x, x.m.y - z.m.y) < z.R) { blocked = true; break; }
        if (blocked) { soft++; continue; }
        const pack = packSize(ensureWorld(c.pos.map), x.m, c);
        if (c.cfg.style === 'safe' && pack > 0 && (o.loneWait || 0) < 60) { soft++; continue; }
        const sc = (x.d + (c.cfg.style === 'aggressive' ? 0 : 40 * pack)) / (0.3 + x.w / 100);
        if (sc < bs) { bs = sc; t = x; }
      } else { const sc = x.d / (0.3 + x.w / 100); if (sc < bs) { bs = sc; t = x; } }
    }
    if (!t) {
      o.loneWait = (o.loneWait || 0) + 1;
      // nothing to do but too strong ones (not dead ones): no point standing there - back to it at that level
      if (strong && !soft && !opts.some((x) => x.kind !== 'mob' && valid(x))) {
        o.strongLvl = Math.max(c.level + 1, strong); o.where = ob.name + ' is too strong (back at level ' + o.strongLvl + ')'; return 'strong';
      }
      o.where = ob.name + (opts.some((x) => x.kind === 'mob' && x.m.st === 'alive') || opts.some((x) => x.kind === 'go' && o.goBan && o.goBan[x.e + ':' + x.i] > G.gameTime) ? ' (waiting for a safe moment)' : ' (waiting for respawn)');
      if (home && Math.hypot(home.x - c.pos.x, home.y - c.pos.y) > 12) { goTo(c, home.x, home.y, 8); if (r.blocked) { r.blocked = false; return 'blocked'; } }
      return home ? 'busy' : 'none';
    }
    o.loneWait = 0;
    t.q = q.id; t.i = i; o.wt = t;
  }
  o.where = (ob.type === 'Collect' ? 'collect ' : ob.id < 0 || t.kind === 'npc' ? 'use ' : 'kill ') + ob.name + ' ' + progText(c, q, i); o.wobj = [q.id, i];
  if (t.kind === 'mob') {
    r.tgt = t.m; const st = approach(c, t.m);
    if (st === 'gone') { o.wt = null; r.tgt = null; }
    return 'busy';
  }
  if (t.kind === 'vendor') {
    if (!goTo(c, t.x, t.y, 3)) { if (r.blocked) { r.blocked = false; o.wt = null; } return 'busy'; }
    const per = buyCount(ob.id); const n = Math.ceil(Math.max(1, ob.count - bagCount(c, ob.id)) / per) * per; const price = vendorPrice(c, ob.id, t.e) * n / per;
    if (c.gold >= price && addItem(c, ob.id, n)) { c.gold -= price; log('Bought ' + n + ' x ' + itemName(ob.id) + ' for ' + money(price) + ' (' + q.title + ').'); onItemGained(c, ob.id); }
    o.wt = null; return 'busy';
  }
  const tx = t.kind === 'npc' ? t.m.x : t.x, ty = t.kind === 'npc' ? t.m.y : t.y;
  const arrived = goTo(c, tx, ty, 3);
  if (!arrived) { if (r.blocked) { r.blocked = false; o.wt = null; if (t.m) t.m.banUntil = G.gameTime + 120; else { o.goBan = o.goBan || {}; o.goBan[t.e + ':' + t.i] = G.gameTime + 60; } } return 'busy'; }
  const label = t.kind === 'npc' ? 'Using ' + (q.start_item ? itemName(q.start_item) + ' on ' : 'on ') + (t.m.info ? t.m.info[1] : ob.name) : 'Using ' + objName(t.e);
  startInteract(c, label, () => {
    if (t.kind === 'npc') { t.m.usedUntil = G.gameTime + NPC_REUSE; credit(c, q, i); }
    else { useGo(t.e, t.i, c); if (ob.type === 'Collect') lootGo(c, t.e); else credit(c, q, i); }
    o.wt = null;
  });
  return 'busy';
}
/* a collect objective whose item only comes from another quest: that quest, if it can be taken now */
function feederQuest(c, q, i, o) {
  const ob = q.objectives[i]; if (ob.type !== 'Collect') return null;
  const s = itemSources(q, ob.id); if (s.includes('mob') || s.includes('object') || s.includes('start')) return null;
  for (const qid of G.q.rewardSrc[ob.id] || []) { const f = G.q.byId[qid]; if (f && f.id !== q.id && (c.quests[f.id] || questAvailable(c, f)) && !questSupport(f) && !(o && skipped(c, o, f.id))) return f; }
  return null;
}

/* ------------------------------------------------------------------ single quest order */
function orderQuest(c, qid) {
  const q = G.q.byId[qid]; if (!q) return;
  const why = questSupport(q); if (why) { log('"' + q.title + '": ' + why + '.'); return; }
  c.order = { type: 'quest', qid, label: q.title, phase: 'start', stack: [] };
  log('Order: quest "' + q.title + '".'); save(); renderOrder();
}
function updateQuest(c, o, dt) {
  const r = rt(c); const q = G.q.byId[o.qid];
  const stop = (msg) => { log(msg); c.order = null; r.mv = null; r.tgt = null; save(); renderOrder(); };
  if (!q || c.done[q.id]) {
    if (o.stack && o.stack.length) { o.qid = o.stack.pop(); o.wt = null; return; }
    c.order = null; renderOrder(); return;
  }
  if ((r.bagFull || bagFree(c) <= 0) && !questDone(c, q)) { bagsFull(c, o); return; }
  const res = questStep(c, q, o);
  if (res === 'done') {
    if (o.stack && o.stack.length) { o.qid = o.stack.pop(); o.wt = null; log('Back to "' + G.q.byId[o.qid].title + '".'); }
    else nextAfterQuest(c, q);
  } else if (res && res.feeder) { o.stack = o.stack || []; o.stack.push(q.id); o.qid = res.feeder.id; o.label = res.feeder.title; o.wt = null; log('"' + q.title + '" needs an item from "' + res.feeder.title + '" - doing that first.'); }
  else if (res && res.dungeon) { if (!questDungeonRun(c, res.dungeon, o, q)) stop('"' + q.title + '" stopped.'); }
  else if (typeof res === 'string' && res[0] === '!') stop(res.slice(1));
}
/* one step of doing quest q: accept, work objectives, turn in. returns 'busy' | 'done' | '!message' | {feeder} */
function phaseTimeout(o, key, secs) {
  // the time allowed is set when the phase starts (the distance shrinks on the way)
  if (o.phaseKey !== key) { o.phaseKey = key; o.phaseT = G.gameTime; o.phaseLim = secs; }
  return G.gameTime - o.phaseT > Math.max(secs, o.phaseLim || 0);
}
/* walking to a far quest giver: use the tram, boats or known flight paths when that is quicker */
function farGo(c, o, x, y, stop) {
  const key = Math.round(x) + ',' + Math.round(y);
  if (Math.hypot(x - c.pos.x, y - c.pos.y) < 900) { o.ftrip = null; return goTo(c, x, y, stop); }
  if (!o.ftrip || o.ftrip.key !== key) {
    const t = planTrip(c, { map: c.pos.map, x, y });
    o.ftrip = t && t.legs.some((l) => l.kind !== 'walk') ? Object.assign(t, { key }) : { key, none: true };
  }
  if (o.ftrip.none) return goTo(c, x, y, stop);
  const st = tripStep(c, o.ftrip);
  if (st === 'busy') return false;
  if (st === 'fail') { o.ftrip.none = true; return false; }
  o.ftrip.none = true; return goTo(c, x, y, stop);
}
function questStep(c, q, o) {
  const r = rt(c);
  if (!c.quests[q.id]) {
    if (!questAvailable(c, q)) return '!"' + q.title + '" is not available (level, race, class or an earlier quest).';
    const s = nearestOf(c, giverSpawns(q.giver));
    if (!s) { const dq = questMeta(q).giverDungeon && questDungeon(q); if (dq && c.pos.map !== dq.map) return { dungeon: dq }; return '!Cannot find the quest giver of "' + q.title + '" on this map.'; }
    o.phase = 'pick up ' + q.title; o.where = spotName(s);
    if (phaseTimeout(o, 'p' + q.id, 600 + s.d / RUN_SPEED * 2.5)) { o.phaseKey = null; return '!Could not get to ' + spotName(s) + ' for "' + q.title + '".'; }
    if (farGo(c, o, s.x, s.y, 3.5)) acceptQuest(c, q);
    else if (r.blocked) { r.blocked = false; return '!Route to ' + spotName(s) + ' is blocked by dangerous creatures.'; }
    return 'busy';
  }
  for (let i = 0; i < q.objectives.length; i++) {
    if (gObjDone(c, q, i)) continue;
    // done myself, the group not yet: kills and drops - keep going (they count for them too); their own objects - wait for them
    if (objDone(c, q, i) && ownHandsObjective(q, i, c)) {
      o.phase = q.title; o.wobj = [q.id, i]; o.where = 'waiting for the group: ' + q.objectives[i].name;
      // stay by the thing they need (the object, the one to use the item on), so they do it with the group around them
      const m = questGroup(c).find((x) => x.quests[q.id] && !objDone(x, q, i)); let best = null, bd = 1e9;
      if (m) for (const x of objectiveOptions(m, q, i)) { const xx = x.m ? x.m.x : x.x, yy = x.m ? x.m.y : x.y; const d = Math.hypot(xx - c.pos.x, yy - c.pos.y); if (d < bd) { bd = d; best = { x: xx, y: yy }; } }
      if (best && bd > 30) { goTo(c, best.x, best.y, 12); if (r.blocked) { r.blocked = false; return '!Cannot reach ' + q.objectives[i].name + ' safely.'; } }
      else rt(c).mv = null;
      return 'busy';
    }
    const f = feederQuest(c, q, i, o); if (f) return { feeder: f };
    const dq = questDungeon(q); if (dq && c.pos.map !== dq.map && !objectiveOptions(c, q, i).length) return { dungeon: dq };
    o.phase = q.title;
    if (!groupQuestReady(c, q, o)) return 'busy';          // a group quest: find a group first (groupquest.js)
    const st = workObjective(c, q, i, o);
    if (st === 'none') return '!No ' + q.objectives[i].name + ' on this map for "' + q.title + '".';
    if (st === 'blocked') return '!Cannot reach ' + q.objectives[i].name + ' safely.';
    if (st === 'strong') { o.strongQ = q.id; return '!' + (o.strongName || q.objectives[i].name) + ' is too strong for now - "' + q.title + '" waits until level ' + o.strongLvl + '.'; }
    return 'busy';
  }
  const t = nearestOf(c, giverSpawns(q.turnin));
  if (!t) { const dq = questMeta(q).turnDungeon && questDungeon(q); if (dq && c.pos.map !== dq.map) return { dungeon: dq }; return '!Cannot find where to turn in "' + q.title + '".'; }
  o.phase = 'turn in ' + q.title; o.where = spotName(t);
  if (phaseTimeout(o, 't' + q.id, 900 + t.d / RUN_SPEED * 2.5)) { o.phaseKey = null; return '!Could not get to ' + spotName(t) + ' to turn in "' + q.title + '".'; }
  const arrived = farGo(c, o, t.x, t.y, 3.5);
  if (!arrived && r.blocked) { r.blocked = false; return '!Route to ' + spotName(t) + ' is blocked by dangerous creatures.'; }
  if (arrived) { if (!turnInQuest(c, q)) return '!Bags are too full to receive the rewards of "' + q.title + '".'; return 'done'; }
  return 'busy';
}
function nextAfterQuest(c, q) {
  if (!cset(c, 'chainQuests')) { c.order = null; renderOrder(); return; }
  let next = null;
  for (const n of G.q.byPrev[q.id] || []) if (questAvailable(c, n) && !questSupport(n) && !questIgnored(c, n.id)) { next = n; break; }
  if (!next) for (const a of availableQuests(c, 20)) { if (a.d < 700 && a.q.level <= c.level + 2 && !questSupport(a.q) && !questIgnored(c, a.q.id)) { next = a.q; break; } }
  if (next) { c.order = { type: 'quest', qid: next.id, label: next.title, phase: 'start', stack: [] }; log('Next quest: "' + next.title + '".'); }
  else { c.order = null; log('No further quests available nearby - order finished.'); }
  renderOrder();
}

/* ------------------------------------------------------------------ zone questing */
function questZoneOf(q) {
  if (q.id in G.q.zoneOf) return G.q.zoneOf[q.id];
  const s = giverSpawns(q.giver)[0];
  const z = s ? { zone: placeName(s, 'zone'), sub: placeName(s, 'sub'), map: s.map } : null;
  G.q.zoneOf[q.id] = z; return z;
}
function inZone(q, zone) { const z = questZoneOf(q); return !!z && (z.sub === zone || z.zone === zone); }
function zoneList(c) {
  const z = {};
  for (const q of G.d.quests) {
    if (q.races && !(q.races & (1 << (c.race - 1)))) continue;
    if (q.classes && !(q.classes & (1 << (c.cls - 1)))) continue;
    if (q.level > 62 || q.level < 1) continue;
    const zz = questZoneOf(q); if (!zz || zz.map !== c.pos.map) continue;
    for (const [name, parent] of [[zz.sub, zz.zone], [zz.zone, '']]) {
      if (!name) continue; const k = z[name] = z[name] || { name, parent, lv: [], n: 0, done: 0, ok: 0 };
      k.lv.push(q.level); k.n++; if (c.done[q.id]) k.done++; if (!questSupport(q)) k.ok++;
    }
  }
  const out = Object.values(z).filter((x) => x.n >= 3);
  for (const k of out) { k.lv.sort((a, b) => a - b); k.lo = k.lv[Math.floor(k.lv.length * 0.1)]; k.hi = k.lv[Math.floor(k.lv.length * 0.9)]; k.mid = k.lv[Math.floor(k.lv.length / 2)]; }
  return out.sort((a, b) => a.lo - b.lo || a.hi - b.hi || b.n - a.n);        // by level, lowest first (as the list shows them)
}
function orderQuesting(c, zone) {
  const z = zoneList(c).find((x) => x.name === zone);
  const zones = z && z.parent && z.parent !== zone ? [zone, z.parent] : [zone];
  c.order = { type: 'questing', zones, zi: 0, label: zones.join(', then '), skip: {} };
  log('Order: quest through ' + c.order.label + '.'); save(); renderOrder();
}
function skipped(c, o, id) { return questIgnored(c, id) || !!(o && o.skip && o.skip[id] && o.skip[id] >= c.level); }
/* quests the player put on ignore: at the bottom of the quest list, the automation leaves them alone (not picked up,
   not worked on, not turned in, not abandoned); the player can take them back */
function questIgnored(c, id) { return !!(c && c.qignore && c.qignore[id]); }
function questIgnoreToggle(c, id) {
  const q = G.q.byId[id]; c.qignore = c.qignore || {};
  if (c.qignore[id]) { delete c.qignore[id]; log('"' + (q ? q.title : id) + '" is no longer ignored.'); }
  else {
    c.qignore[id] = 1; log('"' + (q ? q.title : id) + '" is ignored - the automation leaves it alone.');
    const o = c.order; if (o) { if (o.fq === +id) { o.fq = null; o.wt = null; } if (o.wt && o.wt.q === +id) o.wt = null; if (o.type === 'quest' && o.qid === +id) { c.order = null; rt(c).mv = null; rt(c).tgt = null; } }
  }
  save(); renderQuests(); renderOrder();
}
function questLevelLimit(c) { return c.cfg.style === 'aggressive' ? 4 : c.cfg.style === 'safe' ? 1 : 2; }
function questingWanted(c, q, o) {
  if (skipped(c, o, q.id)) return false;
  if (questSupport(q)) return false;
  if (!groupQuestOk(c, q)) return false;     // group quest: with a group from a little below its level, alone when well above it
  if (!dungeonQuestOk(c, q, true)) return false;
  if (q.level > c.level + questLevelLimit(c)) return false;
  return questDoable(c, q, o);
}
/* not a copy of a quest already in the log, and items that only come from other quests can be had now */
function questDoable(c, q, o) {
  if (!c.quests[q.id]) for (const id in c.quests) { const x = G.q.byId[id]; if (x && x.title === q.title) return false; }
  for (let i = 0; i < q.objectives.length; i++) {
    const ob = q.objectives[i]; if (ob.type !== 'Collect' || bagCount(c, ob.id) >= ob.count) continue;
    const src = itemSources(q, ob.id);
    if (!src.includes('mob') && !src.includes('object') && !src.includes('vendor') && !src.includes('start') && !feederQuest(c, q, i, o)) return false;
    if (src.length === 1 && src[0] === 'mob' && ob.count > 3) { let top = 0; for (const [e] of G.q.itemSrc[ob.id] || []) top = Math.max(top, npcMaxLevel(e)); if (top <= grayLevel(c.level)) return false; }
  }
  return true;
}
function updateQuesting(c, o, dt) {
  const r = rt(c);
  if (r.bagFull || bagFree(c) <= 0) { bagsFull(c, o); return; }
  const zone = o.zones[o.zi];
  if (!zone) { if (o.type === 'leveling') { levelingIdle(c, o, dt); return; } log('Questing finished: nothing left in ' + o.zones.join(' and ') + '.'); c.order = null; renderOrder(); save(); return; }
  o.skip = o.skip || {};
  // keep working on the quest in focus
  if (o.fq) {
    const q = G.q.byId[o.fq];
    if (!q || c.done[q.id] || skipped(c, o, q.id) || (o.fturn && !questDone(c, q))) { o.fq = null; o.wt = null; o.fturn = false; }
    else if (o.fpick && c.quests[q.id]) { o.fq = null; o.fpick = false; }
    else {
      const res = questStep(c, q, o);
      if (res === 'done') { o.fq = null; o.wt = null; o.fturn = false; }
      else if (res && res.feeder) { o.fq = res.feeder.id; o.wt = null; }
      else if (res && res.dungeon) { if (!questDungeonRun(c, res.dungeon, o, q)) { o.skip[q.id] = c.level; o.fq = null; o.wt = null; } }
      else if (typeof res === 'string' && res[0] === '!') {
        if (o.strongQ === q.id) { o.strongQ = null; log(res.slice(1)); o.skip[q.id] = o.strongLvl - 1; o.fq = null; o.wt = null; return; }      // too strong: not given up, back at that level
        o.skipN = o.skipN || {}; o.skipN[q.id] = (o.skipN[q.id] || 0) + 1;
        if (o.skipN[q.id] >= 3 && c.quests[q.id] && !questDone(c, q)) { log(res.slice(1) + ' - giving up on it (abandoned).'); delete c.quests[q.id]; c.abandoned = c.abandoned || {}; c.abandoned[q.id] = 1; }
        else log(res.slice(1) + ' - skipping it until the next level.');
        o.skip[q.id] = c.level; o.fq = null; o.wt = null;
      }
      return;
    }
  }
  o.grindMsg = o.grindMsg || 0;
  // 1. pick up quests offered right here (the hub we stand in); at most 20 quests in the log
  const full = Object.keys(c.quests).length >= 20;
  const near = full ? [] : availableQuests(c, 30, 60).filter((a) => questingWanted(c, a.q, o));
  if (near.length) { o.fq = near[0].q.id; o.fpick = true; return; }
  // 2. nearest thing to do: a turn-in or an open objective
  let pick = null, pd = 1e18, turn = false;
  for (const id in c.quests) {
    const q = G.q.byId[id]; if (!q || skipped(c, o, id) || questSupport(q)) continue;
    if (gQuestDone(c, q) || !q.objectives.length) {
      const t = nearestOf(c, giverSpawns(q.turnin)); if (t && t.d < pd) { pd = t.d; pick = q; turn = true; }
      else if (!t && questMeta(q).turnDungeon && dungeonQuestOk(c, q, true)) { const dd = dungeonQuestDist(c, questDungeon(q)); if (dd < pd) { pd = dd; pick = q; turn = true; } }
      continue;
    }
    if (o.type === 'leveling' && !groupQuestOk(c, q)) continue;
    const dq = questDungeon(q);
    for (let i = 0; i < q.objectives.length; i++) {
      if (gObjDone(c, q, i)) continue;
      if (dq && c.pos.map !== dq.map && !objectiveOptions(c, q, i).length) { if (dungeonQuestOk(c, q, true)) { const dd = dungeonQuestDist(c, dq); if (dd < pd) { pd = dd; pick = q; turn = false; } } continue; }
      if (feederQuest(c, q, i, o)) { if (pd > 1) { pd = 1; pick = q; turn = false; } continue; }
      for (const x of objectiveOptions(c, q, i)) if (x.d < pd) { pd = x.d; pick = q; turn = false; }
    }
  }
  if (pick) { o.fq = pick.id; o.fturn = turn; return; }
  // 3. walk to a new quest of this zone
  const avail = full ? [] : availableQuests(c, 50, 6000).filter((a) => inZone(a.q, zone) && questingWanted(c, a.q, o));
  if (avail.length) { o.fq = avail[0].q.id; o.fpick = true; return; }
  if (o.type === 'leveling') { levelingIdle(c, o, dt); return; }
  // 4. quests left that need a higher level: grind near them
  const lim = questLevelLimit(c);
  const later = G.d.quests.filter((q) => inZone(q, zone) && !c.done[q.id] && !c.quests[q.id] && !questSupport(q) && !skipped(c, o, q.id) &&
    (!q.races || q.races & (1 << (c.race - 1))) && (!q.classes || q.classes & (1 << (c.cls - 1))) && q.level <= c.level + 7 &&
    (q.prev <= 0 || c.done[q.prev]) && (q.min_level > c.level || q.level > c.level + lim)).sort((a, b) => a.level - b.level);
  if (later.length) {
    const s = nearestOf(c, giverSpawns(later[0].giver));
    if (!o.grind || o.grind.lvl !== c.level) { o.grind = { lvl: c.level, cx: s ? s.x : c.pos.x, cy: s ? s.y : c.pos.y, radius: 250 }; log('No quest for level ' + c.level + ' left in ' + zone + ' - grinding until "' + later[0].title + '" opens up.'); }
    o.phase = 'grinding'; o.where = 'until level ' + Math.max(later[0].min_level, later[0].level - lim);
    updateGrind(c, o.grind, dt); if (c.order !== o && c.order && c.order.type !== 'vendor') c.order = o; return;
  }
  log('Finished the quests of ' + zone + '.'); o.zi++; o.grind = null;
}

/* ------------------------------------------------------------------------- UI */
const QUI = { open: {} };
function renderQuests() {
  const el = $('questCard'); if (!el) return; const c = active();
  let h = cardHead('quests', 'Quests' + (Object.keys(c.quests).length ? ' <span class="small muted">(' + Object.keys(c.quests).length + ' active)</span>' : ''), true);
  if (!cardOpen('quests', true)) { el.innerHTML = h; el.onclick = null; questMarks(c); return; }
  const zl = zoneList(c);
  let cur = G.state.settings.questZone && zl.find((z) => z.name === G.state.settings.questZone) ? G.state.settings.questZone : null;
  if (!cur) { const a0 = availableQuests(c, 1)[0]; const zz = a0 && questZoneOf(a0.q); cur = zz ? (zl.find((z) => z.name === zz.sub) ? zz.sub : zz.zone) : (zl[0] || {}).name; }
  const lv = c.order && c.order.type === 'leveling';
  h += '<div class="qlevel"><button class="act' + (lv ? ' red' : '') + '" id="qlevel">' + (lv ? 'Stop leveling' : 'Level up to 60 (auto)') + '</button><div class="muted small">Quests zone by zone across the world, travels by flight path, zeppelin and boat, grinds when needed.</div></div>';
  h += '<div class="qauto"><select id="qzone">' + zl.map((z) => '<option value="' + esc(z.name) + '"' + (z.name === cur ? ' selected' : '') + '>' + esc(z.name) + ' (lvl ' + z.lo + '-' + z.hi + ', done ' + z.done + '/' + z.n + ')</option>').join('') + '</select>' +
    '<button class="act" id="qgo">Auto-quest</button></div>';
  { const g = typeof groupOf === 'function' ? groupOf(c) : null; const L = g ? groupLeader(g) || c : c; const dn = isDungeonMap(c.pos.map) ? dungeonByMap(c.pos.map) : isDungeonMap(L.pos.map) ? dungeonByMap(L.pos.map) : null;
    if (dn) h += '<div class="qauto"><button class="act red" id="qdgreset" title="Everyone out to the entrance at once; the dungeon starts over (every creature back)">Teleport out and reset ' + esc(dn.name) + '</button></div>'; }
  /* the quests as fold-out lists: a line per quest (title, level, progress); click it for the objectives and buttons */
  const act = Object.keys(c.quests).map((id) => G.q.byId[id]).filter(Boolean).sort((a, b) => questIgnored(c, a.id) - questIgnored(c, b.id));      // the ignored ones at the bottom
  const qOpen = (k) => !!(QUI.open[k]);
  const secOn = (k, def) => cardOpen('q' + k, def);
  h += '<div class="qhead qsec" data-card="qact"><span class="carr">' + (secOn('act', true) ? '&#9662;' : '&#9656;') + '</span> Active (' + act.length + ')</div>';
  if (secOn('act', true)) {
    if (!act.length) h += '<div class="muted small">None.</div>';
    for (const q of act) {
      const done = questDone(c, q); const why = questSupport(q); const k = 'a' + q.id; const on = qOpen(k); const ign = questIgnored(c, q.id);
      const prog = q.objectives.length ? q.objectives.map((o, i) => progText(c, q, i)).join(', ') : 'deliver';
      h += '<div class="q qfold' + (done ? ' ok' : '') + (on ? ' open' : '') + (ign ? ' qign' : '') + '"><div class="qt" data-qf="' + k + '" style="color:' + levelColor(q.level, c.level) + '"><span class="carr">' + (on ? '&#9662;' : '&#9656;') + '</span>[' + q.level + '] ' + esc(q.title) + (questIsGroup(q) ? ' <span class="qgrp">(Group)</span>' : '') + ' <span class="muted small">' + (ign ? '(ignored) ' : '') + (done ? '(ready)' : esc(prog)) + '</span></div>';
      if (on) {
        q.objectives.forEach((o, i) => { h += '<div class="muted small">' + (o.type === 'Kill' ? (o.id < 0 ? 'Use ' : 'Kill ') : o.type === 'Collect' ? 'Collect ' : o.type + ' ') + esc(o.name) + ': ' + progText(c, q, i) + '</div>'; });
        if (!q.objectives.length) h += '<div class="muted small">Deliver to ' + esc(spotName(nearestOf(c, giverSpawns(q.turnin)))) + '</div>';
        if (q.rep && q.rep.length && typeof repQuestText === 'function') h += '<div class="small" style="color:#9fc7ff">Reputation: ' + esc(repQuestText(q)) + '</div>';
        if (!why && questIsGroup(q)) h += '<div class="small qgrp">' + esc(groupQuestText(c, q)) + '</div>';
        if (why) h += '<div class="small" style="color:#e6b93c">' + esc(why) + '</div>';
        else if (questDungeon(q)) h += '<div class="small" style="color:#b28cff">Dungeon: ' + esc(questDungeon(q).name) + ' (level ' + questDungeon(q).lmin + '+)</div>';
        if (ign) h += '<div class="small muted">Ignored: the automation does not work on it or turn it in.</div>';
        h += '<button class="mini" data-do="' + q.id + '"' + (why ? ' disabled' : '') + '>' + (done ? 'Turn in' : 'Do it') + '</button> <button class="mini" data-ign="' + q.id + '" title="' + (ign ? 'Let the automation do this quest again' : 'The automation leaves this quest alone; it moves to the bottom of the list') + '">' + (ign ? 'Stop ignoring' : 'Ignore') + '</button> <button class="mini" data-ab="' + q.id + '">Abandon</button>';
      }
      h += '</div>';
    }
  }
  const av = availableQuests(c, 24).filter((a) => !/holiday|battleground|profession|event|Darkmoon|war effort|reputation|raid|legendary|dungeon/.test(questSupport(a.q) || '')).slice(0, 10).sort((a, b) => questIgnored(c, a.q.id) - questIgnored(c, b.q.id));
  h += '<div class="qhead qsec" data-card="qnear"><span class="carr">' + (secOn('near', true) ? '&#9662;' : '&#9656;') + '</span> Available nearby (' + av.length + ')</div>';
  if (secOn('near', true)) {
    if (!av.length) h += '<div class="muted small">No quests nearby for your level.</div>';
    for (const { q, d, s } of av) {
      const why = questSupport(q); const dq = !why && questDungeon(q); const k = 'n' + q.id; const on = qOpen(k); const ign = questIgnored(c, q.id);
      h += '<div class="q qfold' + (on ? ' open' : '') + (ign ? ' qign' : '') + '"><div class="qt" data-qf="' + k + '" style="color:' + levelColor(q.level, c.level) + '"><span class="carr">' + (on ? '&#9662;' : '&#9656;') + '</span>[' + q.level + '] ' + esc(q.title) + (questIsGroup(q) ? ' <span class="qgrp">(Group)</span>' : '') + ' <span class="muted small">' + (ign ? '(ignored) ' : '') + Math.round(d) + ' yd' + (dq ? ' - dungeon' : '') + '</span></div>';
      if (on) h += '<div class="muted small">' + esc(spotName(s)) + ' - ' + Math.round(d) + ' yd' + (why ? ' - <i>' + esc(why) + '</i>' : '') + (dq ? ' - <span style="color:#b28cff">dungeon: ' + esc(dq.short || dq.name) + '</span>' : '') + '</div>' +
        '<button class="mini" data-do="' + q.id + '"' + (why ? ' disabled' : '') + '>Do it</button> <button class="mini" data-ign="' + q.id + '">' + (ign ? 'Stop ignoring' : 'Ignore') + '</button>';
      h += '</div>';
    }
  }
  el.innerHTML = h;
  el.onclick = (ev) => {
    const t = ev.target; if (!t.dataset) return;
    const f = t.closest('[data-qf]'); if (f) { QUI.open[f.dataset.qf] = !QUI.open[f.dataset.qf]; renderQuests(); return; }
    if (t.id === 'qdgreset') { const g = typeof groupOf === 'function' ? groupOf(c) : null; const L = g ? groupLeader(g) || c : c; const dn = dungeonByMap(c.pos.map) || dungeonByMap(L.pos.map); if (dn && confirm('Teleport ' + (g ? 'the group' : c.name) + ' out of ' + dn.name + ' and reset it?\nThe run ends and every creature in it comes back.')) dungeonResetOut(c); renderQuests(); return; }
    if (t.id === 'qlevel') { if (c.order && c.order.type === 'leveling') stopOrder(c); else orderLeveling(c); renderQuests(); return; }
    if (t.id === 'qgo') { const z = $('qzone').value; G.state.settings.questZone = z; orderQuesting(c, z); return; }
    if (t.dataset.ign) { questIgnoreToggle(c, +t.dataset.ign); return; }
    if (t.dataset.do) orderQuest(c, +t.dataset.do);
    if (t.dataset.ab) { const q = G.q.byId[t.dataset.ab]; if (q && confirm('Abandon "' + q.title + '"?')) { delete c.quests[q.id]; if (c.order && c.order.type === 'quest' && c.order.qid === q.id) c.order = null; save(); renderQuests(); renderOrder(); } }
  };
  const zs = $('qzone'); if (zs) zs.onchange = () => { G.state.settings.questZone = zs.value; save(); };
  questMarks(c);
}
/* "!" over quest givers with a quest for you, "?" where a finished quest waits */
function questMarks(c) {
  const marks = [];
  for (const { q, s } of availableQuests(c, 40, 1500)) if (!questSupport(q) && !questIgnored(c, q.id)) marks.push({ x: s.x, y: s.y, t: '!', map: s.map });
  for (const id in c.quests) { const q = G.q.byId[id]; if (q && questDone(c, q) && !questIgnored(c, q.id)) { const t = nearestOf(c, giverSpawns(q.turnin)); if (t) marks.push({ x: t.x, y: t.y, t: '?', map: t.map }); } }
  G.qMarks = marks;
}
