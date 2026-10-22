'use strict';
/* mounts.js - riding and mounts, like the game (this database has the Riding skill, 762):
   - level 40: Apprentice Riding (75) from the race's riding trainer, then a mount from the race's mount vendor:
     60% faster; level 60: Journeyman Riding (150) and a swift mount: 100% faster. About 100 gold at 40 and 1000 at 60
     altogether, like the original.
   - Paladins and warlocks get their class mount (Warhorse / Felsteed, at 60 Charger / Dreadsteed) instead, no riding
     skill needed (the class quests are not played out).
   - Automatic: a long way to walk (more than ~120 yards, not in a dungeon, not fighting) - the character mounts up
     (3 second cast) and rides; it gets off when it arrives, stops, is attacked, starts a fight, gathers, rests, flies
     or goes on a boat. Group members ride along with their leader.
   - Automatic: when leveling or questing and there is enough money, the character goes to learn riding and buy the
     mount by itself (Automation: Travel). The mount type does not matter: the first the vendor sells. */

const RIDE_NPC = { 1: [4732, 384], 3: [4772, 1261], 4: [4753, 4730], 7: [7954, 7955], 2: [4752, 3362], 5: [4773, 4731], 6: [3690, 3685], 8: [7953, 7952] };   // race: [riding trainer, mount vendor]
const RIDE_RANKS = [
  { skill: 75, level: 40, cost: 900000, name: 'Apprentice Riding', speed: 60 },
  { skill: 150, level: 60, cost: 9000000, name: 'Journeyman Riding', speed: 100 },
];
const CLASS_MOUNTS = { 2: [[40, 'Summon Warhorse', 60], [60, 'Summon Charger', 100]], 9: [[40, 'Summon Felsteed', 60], [60, 'Summon Dreadsteed', 100]] };
const MOUNT_MIN = 120;              // yards of way left to be worth mounting
const MOUNT_CAST = 3;

function npcSpot(e) {
  const s = G.spawnMap && G.spawnMap.get(e); if (!s || !s.length) return null;
  const info = G.mobIdx[e]; return { e, map: s[0][0], x: s[0][1], y: s[0][2], name: info ? info[1] : 'NPC ' + e };
}
function spellNamed(n) { const sp = G.d.spells && G.d.spells.spells; if (sp) for (const id in sp) if (sp[id].n === n && sp[id].ic !== 'temp') return sp[id]; return null; }
/* the mounts a character owns: [{name, ic, speed, item?, cls?}] */
function mountsOf(c) {
  const out = [];
  for (const [lvl, n, speed] of CLASS_MOUNTS[c.cls] || []) if (c.level >= lvl) { const sp = spellNamed(n); out.push({ name: n.replace('Summon ', ''), ic: sp ? sp.ic : 'spell_nature_swiftness', speed, cls: true }); }
  for (const id of c.mountItems || []) {
    const it = itemRow(id); if (!it) continue; const f = (it.fx || [])[0]; const sp = f && spellRow(f.id);
    const sp32 = sp && (sp.ef || []).find((e) => e.au === 32); const need = (it.rq && it.rq.skillRank) || 75;
    if ((c.riding || 0) < need) continue;
    out.push({ name: sp ? sp.n : it.n, ic: sp ? sp.ic : it.ic, speed: sp32 ? sp32.lo : 60, item: id });
  }
  return out.sort((a, b) => b.speed - a.speed);
}
function mountBest(c) { return mountsOf(c)[0] || null; }
/* what the character could get next: {rank, train, buy} or null */
function ridingNext(c) {
  if (CLASS_MOUNTS[c.cls]) return null;
  const have = mountsOf(c); const best = have[0] ? have[0].speed : 0;
  for (const rk of RIDE_RANKS) {
    if (c.level < rk.level || best >= rk.speed) continue;
    const train = (c.riding || 0) < rk.skill; const price = mountPrice(c, rk);
    return { rank: rk, train, buy: true, cost: (train ? rk.cost : 0) + price, price };
  }
  return null;
}
/* the mount the race's vendor sells for a riding rank */
function mountForSale(c, rk) {
  const n = RIDE_NPC[c.race]; if (!n) return null; const list = typeof vendorItems === 'function' ? vendorItems(n[1]) : [];
  for (const x of list) { const it = itemRow(x.id); if (!it || it.c !== 15 || !it.rq || it.rq.skill !== 762) continue; if ((it.rq.skillRank || 75) !== rk.skill) continue; if (it.rq.races && !it.rq.races.includes(c.race)) continue; return x.id; }
  for (const x of list) { const it = itemRow(x.id); if (it && it.c === 15 && it.rq && it.rq.skill === 762 && (it.rq.skillRank || 75) === rk.skill) return x.id; }
  return null;
}
function mountPrice(c, rk) { const id = mountForSale(c, rk); return id ? (typeof vendorPrice === 'function' ? vendorPrice(c, id, RIDE_NPC[c.race][1]) : itemBuy(id)) : 0; }

/* ------------------------------------------------------------------ going to the trainer / vendor */
function orderRiding(c, quiet) {
  const nx = ridingNext(c); if (!nx) { if (!quiet) log('Nothing to learn or buy for riding now.'); return false; }
  if (c.gold < nx.cost) { if (!quiet) log('Riding needs ' + money(nx.cost) + ' (' + (nx.train ? nx.rank.name + ' ' + money(nx.rank.cost) + ' + ' : '') + 'mount ' + money(nx.price) + ').'); return false; }
  const n = RIDE_NPC[c.race]; const who = npcSpot(nx.train ? n[0] : n[1]); if (!who) { if (!quiet) log('The riding trainer was not found.'); return false; }
  const far = who.map !== c.pos.map || Math.hypot(who.x - c.pos.x, who.y - c.pos.y) > 600;
  const trip = far && typeof planTrip === 'function' ? planTrip(c, { map: who.map, x: who.x, y: who.y }) : null;
  if (who.map !== c.pos.map && !trip) { if (!quiet) log('No way to ' + who.name + ' found.'); return false; }
  c.order = { type: 'npc', kind: 'riding', step: nx.train ? 'train' : 'buy', e: who.e, map: who.map, x: who.x, y: who.y, trip, label: who.name, resume: c.order && c.order.type !== 'npc' ? c.order : null, t0: G.gameTime };
  rt(c).mv = null; rt(c).tgt = null;
  log('Order: ' + (nx.train ? 'learn ' + nx.rank.name + ' from ' : 'buy a mount from ') + who.name + '.');
  save(); renderOrder(); return true;
}
/* at the trainer / vendor (market.js updateNpcOrder) */
function ridingArrive(c, o) {
  const nx = ridingNext(c);
  if (nx && o.step === 'train' && nx.train && c.gold >= nx.rank.cost) {
    c.gold -= nx.rank.cost; c.riding = nx.rank.skill; log('Learned ' + nx.rank.name + ' (' + money(nx.rank.cost) + ').'); fx(c.pos.x, c.pos.y, nx.rank.name, '#ffd866');
    const v = npcSpot(RIDE_NPC[c.race][1]);
    if (v) { Object.assign(o, { step: 'buy', e: v.e, map: v.map, x: v.x, y: v.y, label: v.name, trip: v.map !== c.pos.map || Math.hypot(v.x - c.pos.x, v.y - c.pos.y) > 600 ? planTrip(c, { map: v.map, x: v.x, y: v.y }) : null, t0: G.gameTime }); log('Now to ' + v.name + ' for the mount.'); save(); renderOrder(); return; }
  } else if (nx && o.step === 'buy' && !nx.train) {
    const id = mountForSale(c, nx.rank); const price = nx.price;
    if (id && c.gold >= price) { c.gold -= price; c.mountItems = (c.mountItems || []).concat([id]); log('Bought ' + itemName(id) + ' (' + money(price) + ') - ' + (mountBest(c) ? mountBest(c).speed : 60) + '% faster on long ways.'); fx(c.pos.x, c.pos.y, itemName(id), '#a335ee'); }
    else log('Could not buy a mount here' + (id ? ' (needs ' + money(price) + ')' : '') + '.');
  }
  c.order = o.resume || null; if (c.order) { c.order.wait = 0; if (typeof resumeOrder === 'function') resumeOrder(c, c.order); }
  save(); renderOrder(); if (typeof SH !== 'undefined' && SH.open) renderSheet();
}
/* leveling / questing: off to the trainer when there is money for it (every half minute, not when busy) */
function ridingAuto(c) {
  const r = rt(c); if (G.gameTime - (r.rideChk || -99) < 30) return; r.rideChk = G.gameTime;
  if (cset(c, 'autoRiding') === false || !c.order || !['leveling', 'questing', 'grind', 'patrol'].includes(c.order.type)) return;
  if ((r.threats || []).length || r.ghost || r.flying || r.riding || (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map))) return;
  if (typeof groupOf === 'function' && groupOf(c)) return;          // not in the middle of a group
  const nx = ridingNext(c); if (!nx || c.gold < nx.cost * 1.1) return;
  orderRiding(c, true);
}
/* paladins / warlocks: the class mount comes with the level */
function classMountNews(c) {
  const k = (CLASS_MOUNTS[c.cls] || []).filter(([lvl]) => c.level >= lvl).length; if (!k || (c.clsMounts || 0) >= k) return;
  c.clsMounts = k; const m = mountBest(c); if (m) log(c.name + ' can call ' + m.name + ' now (' + m.speed + '% faster on long ways).');
}

/* ------------------------------------------------------------------ mounting up and getting off */
function mountSpeed(c) { const m = rt(c).mounted; return m ? 1 + m.speed / 100 : 1; }
function mountUp(c) {
  const m = mountBest(c); if (!m) return; const r = rt(c);
  if (r.stealthed && typeof stealthBreak === 'function') stealthBreak(c);
  r.mounted = { name: m.name, ic: m.ic, speed: m.speed }; r.mountMoveT = G.gameTime; dirty(c);
  fx(c.pos.x, c.pos.y, m.name, '#ffe9a8');
}
function dismount(c, why) {
  const r = rt(c); if (!r.mounted) return; r.mounted = null; dirty(c);
  if (why && isActive(c)) fx(c.pos.x, c.pos.y, why, '#cfc6b0');
}
/* advance() calls this on every step of a walk: true = no step now (mounting up) */
function mountTick(c, mv) {
  const r = rt(c);
  if (r.mounted) { r.mountMoveT = G.gameTime; return false; }
  if (r.cast || (r.threats || []).length || r.ghost || r.flying || r.riding || r.resting || r.interact || r.fleeing) return false;
  if (cset(c, 'autoMount') === false || !mv || !mv.path || !mv.path.length) return false;
  if (G.gameTime - (r.mountTry || -99) < 6) return false;
  if (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map)) return false;
  const m = mountBest(c); if (!m) return false;
  const end = mv.path[mv.path.length - 1]; const left = Math.hypot(end.x - c.pos.x, end.y - c.pos.y);
  const L = typeof groupOf === 'function' && groupOf(c) ? groupLeader(groupOf(c)) : null;
  const leaderRides = L && L !== c && rt(L).mounted;
  if (left < MOUNT_MIN && !(leaderRides && left > 15)) return false;
  r.mountTry = G.gameTime;
  r.cast = { name: m.name, sp: { n: m.name, ic: m.ic }, ic: m.ic, tgt: c, t: 0, total: MOUNT_CAST, mount: true, onDone: () => mountUp(c) };
  return true;
}
/* every step: off the mount when it is time */
function mountCheck(c) {
  const r = rt(c); if (!r.mounted) return;
  const why = (r.threats || []).length ? 'Dismounted' : r.ghost || r.flying || r.riding ? '' : r.resting || r.eating || r.drinking || r.interact || (r.cast && !r.cast.mount) ? 'Dismount' :
    (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map)) ? 'Dismount' : G.gameTime - (r.mountMoveT || 0) > 1.2 ? 'Dismount' : null;
  if (why !== null) dismount(c, why);
}

/* the Character tab: riding and the mount */
function ridingHtml(c) {
  const m = mountBest(c); const nx = ridingNext(c); const rk = RIDE_RANKS.filter((x) => (c.riding || 0) >= x.skill).pop();
  let h = '<div class="sgroup"><h5>Riding</h5>' + statRow('Skill', CLASS_MOUNTS[c.cls] ? 'class mount' : rk ? rk.name + ' (' + c.riding + ')' : 'none') +
    statRow('Mount', m ? esc(m.name) + ' (+' + m.speed + '%)' : '<span class="muted">none' + (c.level < 40 ? ' (level 40)' : '') + '</span>');
  if (nx) h += '<div class="small muted" style="margin:3px 0">' + (nx.train ? nx.rank.name + ' ' + money(nx.rank.cost) + ' + ' : '') + 'mount ' + money(nx.price) + ' at ' + esc((npcSpot(RIDE_NPC[c.race][nx.train ? 0 : 1]) || {}).name || 'the trainer') + '</div>' +
    '<button class="mini" data-riding="1"' + (c.gold < nx.cost ? ' disabled title="Not enough money"' : '') + '>Go and get it</button>';
  return h + '</div>';
}
