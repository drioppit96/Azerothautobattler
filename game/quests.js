'use strict';
/* quests.js - quest givers (NPCs and objects), objectives (kill, collect from creatures or objects, use objects,
   use items on NPCs, items from other quests), turn-in and rewards, the single-quest order and the automatic
   zone questing order (Valley of Trials, then Durotar ...). */

const INTERACT_TIME = 2.5;
const GO_RESPAWN = 90;
const NPC_REUSE = 45;

/* ------------------------------------------------------------------ index */
function buildQuestIndex() {
  const Q = { byId: {}, byGiver: {}, byGiverObj: {}, byPrev: {}, itemSrc: {}, goSrc: {}, rewardSrc: {}, support: {}, zoneOf: {} };
  for (const q of G.d.quests) {
    Q.byId[q.id] = q;
    for (const g of q.giver) {
      if (g[0] === 'npc') (Q.byGiver[g[1]] = Q.byGiver[g[1]] || []).push(q);
      else (Q.byGiverObj[g[1]] = Q.byGiverObj[g[1]] || []).push(q);
    }
    if (q.prev > 0) (Q.byPrev[q.prev] = Q.byPrev[q.prev] || []).push(q);
    for (const [it] of q.reward_items.concat(q.choice_items)) (Q.rewardSrc[it] = Q.rewardSrc[it] || []).push(q.id);
  }
  const users = {};
  for (const e in G.d.loot.creatures) { const lid = G.d.loot.creatures[e][6]; if (lid) (users[lid] = users[lid] || []).push(+e); }
  const tabs = G.d.loot.tables.creature;
  for (const lid in tabs) {
    const us = users[lid]; if (!us) continue;
    for (const [item, pct, , , quest] of tabs[lid]) {
      if (!quest) continue;
      const a = Q.itemSrc[item] = Q.itemSrc[item] || [];
      for (const e of us) a.push([e, pct]);
    }
  }
  const go = G.d.go;
  if (go) {
    for (const e in go.objects) {
      const lid = go.objects[e][2]; const rows = lid ? go.loot[lid] : null; if (!rows) continue;
      for (const [item, pct] of rows) (Q.goSrc[item] = Q.goSrc[item] || []).push([+e, pct]);
    }
  }
  G.q = Q;
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
  return out;
}
/* why a quest cannot be automated (null = it can) */
function questSupport(q) {
  if (q.id in G.q.support) return G.q.support[q.id];
  let why = null;
  if (!q.giver.length) why = 'starts from an item';
  else if (!giverSpawns(q.giver).length) why = 'quest giver not found';
  else if (!q.turnin.length || !giverSpawns(q.turnin).length) why = 'turn-in not found';
  else for (const o of q.objectives) {
    if (o.type === 'Kill' || o.type === 'Use/Interact') {
      if (o.id < 0) { if (!objSpawns(-o.id).length) { why = 'object to use not found'; break; } }
      else if (!G.spawnMap.get(o.id)) { why = 'target has no spawns'; break; }
    } else if (o.type === 'Collect') {
      if (!itemSources(q, o.id).length) { why = 'item source unknown' + (G.d.go ? '' : ' (run: py build_gamedata.py goquest)'); break; }
    } else { why = 'needs a spell cast at a place - not automated yet'; break; }
  }
  G.q.support[q.id] = why; return why;
}
function questAvailable(c, q) {
  if (c.done[q.id] || c.quests[q.id]) return false;
  if (q.races && !(q.races & (1 << (c.race - 1)))) return false;
  if (q.classes && !(q.classes & (1 << (c.cls - 1)))) return false;
  if (c.level < q.min_level) return false;
  if (q.prev > 0 && !c.done[q.prev]) return false;
  if (q.prev < 0 && !c.quests[-q.prev]) return false;
  if (q.exclusive_group > 0) { for (const o of G.d.quests) if (o.exclusive_group === q.exclusive_group && o.id !== q.id && (c.done[o.id] || c.quests[o.id])) return false; }
  return true;
}
function objDone(c, q, i) {
  const o = q.objectives[i]; const a = c.quests[q.id];
  if (o.type === 'Collect') return bagCount(c, o.id) >= o.count;
  return !!a && a.prog[i] >= o.count;
}
function questDone(c, q) { if (!c.quests[q.id]) return false; return q.objectives.every((o, i) => objDone(c, q, i)); }
function availableQuests(c, limit, maxD) {
  const out = [];
  for (const q of G.d.quests) {
    if (q.level < c.level - 6 || q.level > c.level + 4 || q.min_level > c.level) continue;
    if (!questAvailable(c, q)) continue;
    const s = nearestOf(c, giverSpawns(q.giver)); if (!s || s.d > (maxD || 2000)) continue;
    out.push({ q, d: s.d, s });
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
  log('Quest complete: ' + q.title + '. +' + xp + ' xp' + (cash ? ', +' + money(cash) : '') + (got.length ? '. Received: ' + got.join(', ') : '') + '.');
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
function goFree(e, i) { return !(G.goUsed && G.goUsed[goUsedKey(e, i)] > G.gameTime); }
function useGo(e, i) { G.goUsed = G.goUsed || {}; G.goUsed[goUsedKey(e, i)] = G.gameTime + GO_RESPAWN; }
function lootGo(c, e) {
  const o = G.d.go && G.d.go.objects[e]; const rows = o && o[2] ? G.d.go.loot[o[2]] || [] : []; const got = [];
  for (const [item, pct, mn, mx, quest] of rows) {
    if (quest && !questNeeds(c, item)) continue;
    if (Math.random() * 100 >= pct) continue;
    const n = irnd(mn, mx);
    if (addItem(c, item, n)) { got.push((n > 1 ? n + ' x ' : '') + itemName(item)); if (quest) onItemGained(c, item); }
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
  }
  return out;
}
function progText(c, q, i) { const ob = q.objectives[i]; const a = c.quests[q.id]; const n = ob.type === 'Collect' ? Math.min(ob.count, bagCount(c, ob.id)) : a ? a.prog[i] : 0; return n + '/' + ob.count; }
/* pick and pursue one way to progress objective i. returns 'busy' | 'none' | 'blocked' */
function workObjective(c, q, i, o) {
  const r = rt(c); const ob = q.objectives[i];
  let t = o.wt && o.wt.q === q.id && o.wt.i === i ? o.wt : null;
  const valid = (x) => x && (x.kind === 'mob' ? x.m.st === 'alive' && (x.m.banUntil || 0) < G.gameTime :
    x.kind === 'npc' ? (x.m.usedUntil || 0) < G.gameTime && x.m.st !== 'dead' : goFree(x.e, x.i));
  if (!valid(t)) {
    t = null;
    const opts = objectiveOptions(c, q, i); let bs = 1e18; let home = null, hd = 1e18;
    for (const x of opts) {
      const hx = x.m ? x.m.hx : x.x, hy = x.m ? x.m.hy : x.y; const dh = Math.hypot(hx - c.pos.x, hy - c.pos.y);
      if (dh < hd) { hd = dh; home = { x: hx, y: hy }; }
      if (!valid(x)) continue;
      if (x.kind === 'mob') {
        if (!attackable(x.m, c) || dangerous(x.m, c) || x.m.lvl > c.level + 3 || x.m.rank >= 1) continue;
        let blocked = false; for (const z of r.danger) if (!z.soft && Math.hypot(x.m.x - z.m.x, x.m.y - z.m.y) < z.R) { blocked = true; break; }
        if (blocked) continue;
        const pack = packSize(ensureWorld(c.pos.map), x.m, c);
        if (c.cfg.style === 'safe' && pack > 0 && (o.loneWait || 0) < 60) continue;
        const sc = (x.d + (c.cfg.style === 'aggressive' ? 0 : 40 * pack)) / (0.3 + x.w / 100);
        if (sc < bs) { bs = sc; t = x; }
      } else { const sc = x.d / (0.3 + x.w / 100); if (sc < bs) { bs = sc; t = x; } }
    }
    if (!t) {
      o.loneWait = (o.loneWait || 0) + 1;
      o.where = ob.name + ' (waiting for respawn)';
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
  const tx = t.kind === 'npc' ? t.m.x : t.x, ty = t.kind === 'npc' ? t.m.y : t.y;
  const arrived = goTo(c, tx, ty, 3);
  if (!arrived) { if (r.blocked) { r.blocked = false; o.wt = null; if (t.m) t.m.banUntil = G.gameTime + 120; else useGo(t.e, t.i); } return 'busy'; }
  const label = t.kind === 'npc' ? 'Using ' + (q.start_item ? itemName(q.start_item) + ' on ' : 'on ') + (t.m.info ? t.m.info[1] : ob.name) : 'Using ' + objName(t.e);
  startInteract(c, label, () => {
    if (t.kind === 'npc') { t.m.usedUntil = G.gameTime + NPC_REUSE; credit(c, q, i); }
    else { useGo(t.e, t.i); if (ob.type === 'Collect') lootGo(c, t.e); else credit(c, q, i); }
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
  else if (typeof res === 'string' && res[0] === '!') stop(res.slice(1));
}
/* one step of doing quest q: accept, work objectives, turn in. returns 'busy' | 'done' | '!message' | {feeder} */
function questStep(c, q, o) {
  const r = rt(c);
  if (!c.quests[q.id]) {
    if (!questAvailable(c, q)) return '!"' + q.title + '" is not available (level, race, class or an earlier quest).';
    const s = nearestOf(c, giverSpawns(q.giver)); if (!s) return '!Cannot find the quest giver of "' + q.title + '" on this map.';
    o.phase = 'pick up ' + q.title; o.where = spotName(s);
    if (goTo(c, s.x, s.y, 3.5)) acceptQuest(c, q);
    else if (r.blocked) { r.blocked = false; return '!Route to ' + spotName(s) + ' is blocked by dangerous creatures.'; }
    return 'busy';
  }
  for (let i = 0; i < q.objectives.length; i++) {
    if (objDone(c, q, i)) continue;
    const f = feederQuest(c, q, i, o); if (f) return { feeder: f };
    o.phase = q.title;
    const st = workObjective(c, q, i, o);
    if (st === 'none') return '!No ' + q.objectives[i].name + ' on this map for "' + q.title + '".';
    if (st === 'blocked') return '!Cannot reach ' + q.objectives[i].name + ' safely.';
    return 'busy';
  }
  const t = nearestOf(c, giverSpawns(q.turnin)); if (!t) return '!Cannot find where to turn in "' + q.title + '".';
  o.phase = 'turn in ' + q.title; o.where = spotName(t);
  const arrived = goTo(c, t.x, t.y, 3.5);
  if (!arrived && r.blocked) { r.blocked = false; return '!Route to ' + spotName(t) + ' is blocked by dangerous creatures.'; }
  if (arrived) { if (!turnInQuest(c, q)) return '!Bags are too full to receive the rewards of "' + q.title + '".'; return 'done'; }
  return 'busy';
}
function nextAfterQuest(c, q) {
  if (!G.state.settings.chainQuests) { c.order = null; renderOrder(); return; }
  let next = null;
  for (const n of G.q.byPrev[q.id] || []) if (questAvailable(c, n) && !questSupport(n)) { next = n; break; }
  if (!next) for (const a of availableQuests(c, 20)) { if (a.d < 700 && a.q.level <= c.level + 2 && !questSupport(a.q)) { next = a.q; break; } }
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
  return out.sort((a, b) => a.mid - b.mid || b.n - a.n);
}
function orderQuesting(c, zone) {
  const z = zoneList(c).find((x) => x.name === zone);
  const zones = z && z.parent && z.parent !== zone ? [zone, z.parent] : [zone];
  c.order = { type: 'questing', zones, zi: 0, label: zones.join(', then '), skip: {} };
  log('Order: quest through ' + c.order.label + '.'); save(); renderOrder();
}
function skipped(c, o, id) { return !!(o.skip && o.skip[id] && o.skip[id] >= c.level); }
function questLevelLimit(c) { return c.cfg.style === 'aggressive' ? 4 : c.cfg.style === 'safe' ? 2 : 3; }
function questingWanted(c, q, o) {
  if (skipped(c, o, q.id)) return false;
  if (questSupport(q)) return false;
  return q.level <= c.level + questLevelLimit(c);
}
function updateQuesting(c, o, dt) {
  const r = rt(c);
  if (r.bagFull || bagFree(c) <= 0) { bagsFull(c, o); return; }
  const zone = o.zones[o.zi];
  if (!zone) { log('Questing finished: nothing left in ' + o.zones.join(' and ') + '.'); c.order = null; renderOrder(); save(); return; }
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
      else if (typeof res === 'string' && res[0] === '!') { log(res.slice(1) + ' - skipping it until the next level.'); o.skip[q.id] = c.level; o.fq = null; o.wt = null; }
      return;
    }
  }
  o.grindMsg = o.grindMsg || 0;
  // 1. pick up quests offered right here (the hub we stand in)
  const near = availableQuests(c, 30, 60).filter((a) => questingWanted(c, a.q, o));
  if (near.length) { o.fq = near[0].q.id; o.fpick = true; return; }
  // 2. nearest thing to do: a turn-in or an open objective
  let pick = null, pd = 1e18, turn = false;
  for (const id in c.quests) {
    const q = G.q.byId[id]; if (!q || skipped(c, o, id) || questSupport(q)) continue;
    if (questDone(c, q) || !q.objectives.length) {
      const t = nearestOf(c, giverSpawns(q.turnin)); if (t && t.d < pd) { pd = t.d; pick = q; turn = true; }
      continue;
    }
    for (let i = 0; i < q.objectives.length; i++) {
      if (objDone(c, q, i)) continue;
      if (feederQuest(c, q, i, o)) { if (pd > 1) { pd = 1; pick = q; turn = false; } continue; }
      for (const x of objectiveOptions(c, q, i)) if (x.d < pd) { pd = x.d; pick = q; turn = false; }
    }
  }
  if (pick) { o.fq = pick.id; o.fturn = turn; return; }
  // 3. walk to a new quest of this zone
  const avail = availableQuests(c, 50, 6000).filter((a) => inZone(a.q, zone) && questingWanted(c, a.q, o));
  if (avail.length) { o.fq = avail[0].q.id; o.fpick = true; return; }
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
function renderQuests() {
  const el = $('questCard'); if (!el) return; const c = active();
  let h = '<h3>Quests</h3>';
  const zl = zoneList(c);
  let cur = G.state.settings.questZone && zl.find((z) => z.name === G.state.settings.questZone) ? G.state.settings.questZone : null;
  if (!cur) { const a0 = availableQuests(c, 1)[0]; const zz = a0 && questZoneOf(a0.q); cur = zz ? (zl.find((z) => z.name === zz.sub) ? zz.sub : zz.zone) : (zl[0] || {}).name; }
  h += '<div class="qauto"><select id="qzone">' + zl.map((z) => '<option value="' + esc(z.name) + '"' + (z.name === cur ? ' selected' : '') + '>' + esc(z.name) + ' (lvl ' + z.lo + '-' + z.hi + ', done ' + z.done + '/' + z.n + ')</option>').join('') + '</select>' +
    '<button class="act" id="qgo">Auto-quest</button></div>';
  const act = Object.keys(c.quests).map((id) => G.q.byId[id]).filter(Boolean);
  h += '<div class="qhead">Active (' + act.length + ')</div>';
  if (!act.length) h += '<div class="muted small">None.</div>';
  for (const q of act) {
    const done = questDone(c, q); const why = questSupport(q);
    h += '<div class="q' + (done ? ' ok' : '') + '"><div class="qt" style="color:' + levelColor(q.level, c.level) + '">[' + q.level + '] ' + esc(q.title) + (done ? ' <span class="muted">(ready)</span>' : '') + '</div>';
    q.objectives.forEach((o, i) => { h += '<div class="muted small">' + (o.type === 'Kill' ? (o.id < 0 ? 'Use ' : 'Kill ') : o.type === 'Collect' ? 'Collect ' : o.type + ' ') + esc(o.name) + ': ' + progText(c, q, i) + '</div>'; });
    if (!q.objectives.length) h += '<div class="muted small">Deliver to ' + esc(spotName(nearestOf(c, giverSpawns(q.turnin)))) + '</div>';
    if (why) h += '<div class="small" style="color:#e6b93c">' + esc(why) + '</div>';
    h += '<button class="mini" data-do="' + q.id + '"' + (why ? ' disabled' : '') + '>' + (done ? 'Turn in' : 'Do it') + '</button> <button class="mini" data-ab="' + q.id + '">Abandon</button></div>';
  }
  h += '<div class="qhead">Available nearby</div>';
  const av = availableQuests(c, 10);
  if (!av.length) h += '<div class="muted small">No quests nearby for your level.</div>';
  for (const { q, d, s } of av) {
    const why = questSupport(q);
    h += '<div class="q"><div class="qt" style="color:' + levelColor(q.level, c.level) + '">[' + q.level + '] ' + esc(q.title) + '</div><div class="muted small">' + esc(spotName(s)) + ' - ' + Math.round(d) + ' yd' + (why ? ' - <i>' + esc(why) + '</i>' : '') + '</div>' +
      '<button class="mini" data-do="' + q.id + '"' + (why ? ' disabled' : '') + '>Do it</button></div>';
  }
  h += '<label class="chk" style="margin-top:6px"><input type="checkbox" id="chainQ"' + (G.state.settings.chainQuests ? ' checked' : '') + '> After a single quest, continue with the next one</label>';
  el.innerHTML = h;
  el.onclick = (ev) => {
    const t = ev.target; if (!t.dataset) return;
    if (t.id === 'qgo') { const z = $('qzone').value; G.state.settings.questZone = z; orderQuesting(c, z); return; }
    if (t.dataset.do) orderQuest(c, +t.dataset.do);
    if (t.dataset.ab) { const q = G.q.byId[t.dataset.ab]; if (q && confirm('Abandon "' + q.title + '"?')) { delete c.quests[q.id]; if (c.order && c.order.type === 'quest' && c.order.qid === q.id) c.order = null; save(); renderQuests(); renderOrder(); } }
  };
  const zs = $('qzone'); if (zs) zs.onchange = () => { G.state.settings.questZone = zs.value; save(); };
  const ch = $('chainQ'); if (ch) ch.onchange = () => { G.state.settings.chainQuests = ch.checked; save(); };
  questMarks(c);
}
/* "!" over quest givers with a quest for you, "?" where a finished quest waits */
function questMarks(c) {
  const marks = [];
  for (const { q, s } of availableQuests(c, 40, 1500)) if (!questSupport(q)) marks.push({ x: s.x, y: s.y, t: '!', map: s.map });
  for (const id in c.quests) { const q = G.q.byId[id]; if (q && questDone(c, q)) { const t = nearestOf(c, giverSpawns(q.turnin)); if (t) marks.push({ x: t.x, y: t.y, t: '?', map: t.map }); } }
  G.qMarks = marks;
}
