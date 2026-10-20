'use strict';
/* combat.js - stage 2: creatures in the world, aggro, melee combat, XP, loot, bags, respawn, death.
   Uses the globals from game.js (G, log, dist, ...). */

const MELEE_RANGE = 4.5;
const CELL = 60;
const SCAN_EVERY = 0.25;
const MAX_LEVEL = 60;
const CORPSE_SHOW = 12;          // seconds a corpse stays visible on the map
function r_(c) { return rt(c); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function irnd(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rt(c) { return c.rt || (c.rt = { threats: [], tgt: null, ghost: null, resting: false, scanT: 0, regenT: 0, swingT: 0, danger: [], outT: 99, mv: null, cd: {}, gcdUntil: 0, queued: null, buffs: [] }); }

function rageConv(level) { return 0.0091107836 * level * level + 3.225598133 * level + 4.2652911; }

/* ------------------------------------------------------------ creatures */
function cell(x) { return Math.floor(x / CELL); }
function gk(cx, cy) { return cx * 100003 + cy; }
function behIndex(c) { if (c.rt && c.rt.raceIdx != null) return c.rt.raceIdx; const i = G.d.hostility.races.findIndex((r) => r.id === c.race); rt(c).raceIdx = i < 0 ? 1 : i; return rt(c).raceIdx; }
function behOf(m, c) { const h = G.d.hostility.creatures[m.e]; if (!h) return 'N'; const b = h[1][behIndex(c)]; return c && c.rep && G.d.rep ? repBeh(c, h[0], b) : b; }

function fbHp(L, rank) { const b = 30 + 1.2 * L * L + 8 * L; return Math.round(b * (rank === 1 ? 2.1 : rank === 2 ? 2.8 : rank === 3 ? 12 : rank === 4 ? 1.8 : 1)); }
function fbDmg(L, rank) { const a = 2 + 0.6 * L + 0.045 * L * L; const m = rank === 1 || rank === 2 ? 1.6 : rank === 3 ? 2.5 : 1; return [a * 0.7 * m, a * 1.3 * m]; }
function fbArmor(L) { return Math.round(0.6 * L * L + 20 * L); }
function initMob(m) {
  const i = m.info; const lo = i ? i[2] : 1, hi = i ? i[3] : lo;
  m.lvl = lo + Math.floor(Math.random() * (hi - lo + 1));
  const st = G.d.cstats && G.d.cstats[m.e];
  const rank = i ? i[4] : 0;
  const k = Math.min(Math.max(0, m.lvl - lo), st ? st[1].length - 1 : 0);
  if (st && st[1][k]) { m.maxhp = st[1][k]; m.dmin = st[2][k]; m.dmax = st[3][k]; m.armor = st[4][k]; m.atk = (st[0] || 2000) / 1000; }
  else { m.maxhp = fbHp(m.lvl, rank); const d = fbDmg(m.lvl, rank); m.dmin = d[0]; m.dmax = d[1]; m.armor = fbArmor(m.lvl); m.atk = 2.0; }
  m.hp = m.maxhp; m.st = 'alive'; m.x = m.hx; m.y = m.hy; m.tgt = null; m.swing = rnd(0.5, 1.5); m.petThreat = 0; m.charThreat = 0; m.skinned = false; m.sk = null; m.cast = null; m.maxmana = null;      // a new creature: it can be skinned again, its spells start over
}
/* creatures of world events (Scourge invasion, Ahn'Qiraj war, holidays): not part of the normal world */
const EVENT_MOBS = [[15414, 15424], [15591, 15591], [15685, 15692], [15730, 15730], [15740, 15811], [16136, 16143], [16172, 16172], [16230, 16230], [16255, 16255], [16285, 16310], [16356, 16401], [16419, 16438], [16995, 16995]];
function eventMob(e) { if (G.d.eventMobs && G.d.eventMobs.has(e)) return true; for (const [a, b] of EVENT_MOBS) if (e >= a && e <= b) return true; return false; }
function ensureWorld(mapId) {
  if (G.world[mapId]) return G.world[mapId];
  if (typeof loadGrid === 'function') loadGrid(mapId);
  const list = [], grid = new Map(), W = { id: mapId, list, grid, active: new Set(), dead: [] };
  const dgMap = typeof isDungeonMap === 'function' && isDungeonMap(mapId);
  for (const [e, lst0] of G.spawnList) {
    if (eventMob(e)) continue;
    const h = G.d.hostility.creatures[e]; const rank = h ? h[6] : 0;
    let lst = lst0.filter((s) => s[0] === mapId); if (!lst.length) continue;
    // a rare (or rare elite) out in the world: ONE of it, at one of its spawn points, up only now and then (rarePool)
    const pool = !dgMap && (rank === 2 || rank === 4) ? lst : null; if (pool) lst = [pool[(Math.random() * pool.length) | 0]];
    for (const s of lst) {
      const m = { e, wid: mapId, info: G.mobIdx[e] || null, hx: s[1], hy: s[2], z: s[3], rmin: s[7] || 300, rmax: s[8] || s[7] || 300 };
      m.aggro = h && h[2] ? h[2] : 20; m.leash = h && h[3] ? h[3] : 45; m.help = h ? h[4] : 0; m.tmpl = h ? h[0] : 0; m.civ = h ? h[5] : 0; m.rank = rank;
      initMob(m); list.push(m);
      const k = gk(cell(m.hx), cell(m.hy)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(m);
      if (pool) rarePool(W, m, pool);
    }
  }
  G.world[mapId] = W; return W;
}
/* rare creatures: one at a time, at a random one of its spawn points, with its long respawn time (hours for most).
   When the world is made, about 40% of them are up and the rest come some time later; the rares quests need
   are always up at first and come back within 10 minutes. A dead rare is not shown on the map. */
const RARE_UP = 0.4, RARE_QUEST_RESP = 600;
function questMobs() {
  if (G.questMobs) return G.questMobs;
  const s = new Set(); if (!G.d.quests || !G.q || !G.q.itemSrc) return s;
  for (const q of G.d.quests) for (const o of q.objectives || []) {
    if (o.type === 'Kill' && o.id > 0) s.add(o.id);
    else if (o.type === 'Collect') { const it = G.d.items.items[o.id]; if (it && it.c === 12) for (const [e, pc] of G.q.itemSrc[o.id] || []) if (pc >= 20) s.add(+e); }      // a quest item it surely drops
  }
  return (G.questMobs = s);
}
function rarePool(W, m, pool) {
  m.pool = pool.map((s) => [s[1], s[2], s[3]]);
  if (questMobs().has(m.e)) { m.rmin = Math.min(m.rmin, RARE_QUEST_RESP); m.rmax = Math.min(m.rmax, RARE_QUEST_RESP); return; }
  if (Math.random() < RARE_UP) return;
  m.st = 'dead'; m.hp = 0; m.deadAt = -1e9; m.respAt = G.gameTime + rnd(0.15, 1) * m.rmin; W.dead.push(m);
}
/* a rare comes back at another of its spawn points */
function rareMove(W, m) {
  if (!m.pool || m.pool.length < 2) return;
  const p = m.pool[(Math.random() * m.pool.length) | 0];
  const k0 = gk(cell(m.hx), cell(m.hy)); const a0 = W.grid.get(k0); if (a0) { const i = a0.indexOf(m); if (i >= 0) a0.splice(i, 1); }
  m.hx = p[0]; m.hy = p[1]; m.z = p[2];
  const k = gk(cell(m.hx), cell(m.hy)); let a = W.grid.get(k); if (!a) W.grid.set(k, a = []); a.push(m);
  if (G.map && G.map.map === W.id && typeof buildMobsForMap === 'function') buildMobsForMap();       // the map shows it where it is now
}
function mobsNear(W, x, y, r, fn) {
  const c0 = cell(x - r), c1 = cell(x + r), r0 = cell(y - r), r1 = cell(y + r);
  for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) { const a = W.grid.get(gk(cx, cy)); if (a) for (const m of a) fn(m); }
}
const AGGRO_SCALE = 0.77;        // aggro ranges: 30% smaller than on the server, then 10% larger again (0.7 x 1.1)
function aggroRadius(m, c) {
  // dungeons: the server's own range (base - level difference, the difference limited to 25, at least 5 and at most 45);
  // careless groups only make it larger (masteryAggro)
  if (c.pos && typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map)) return clamp(m.aggro - clamp(c.level - m.lvl, -25, 25), 5, 45) * (typeof masteryAggro === 'function' ? masteryAggro(c) : 1);
  return clamp((m.aggro - (c.level - m.lvl)) * AGGRO_SCALE * (c.pos && typeof masteryAggro === 'function' ? masteryAggro(c) : 1), 4, 40);
}
/* how many fight alongside c out in the world: its hired group, its own characters grouped with it close by and their
   hired group (a member of a group whose leader hired mercenaries is as safe as the leader). Counted once per tick. */
function fightersWith(c) {
  const r = rt(c); if (r.fwT === G.gameTime) return r.fwN;
  let n = r.party ? r.party.filter((u) => !u.dead).length : 0;
  if (typeof groupNear === 'function' && G.state && G.state.groups && G.state.groups.length) for (const o of groupNear(c, 60)) { n++; const op = rt(o).party; if (op) n += op.filter((u) => !u.dead).length; }
  r.fwT = G.gameTime; r.fwN = n; return n;
}
function effLevel(m) { return m.lvl + (m.rank === 1 ? 4 : m.rank === 2 ? 5 : m.rank === 3 ? 8 : 0); }
function dangerous(m, c) {
  if (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map)) return m.lvl - c.level >= (rt(c).party ? 8 : 5);      // dungeons are full of elites: only run from the far too strong
  const n = fightersWith(c); if (n >= 2) return m.lvl - c.level >= (m.rank === 3 ? 2 : n >= 3 ? 4 : 3);     // a group out in the world (group quests): elites of about the level are fine
  return effLevel(m) - c.level >= 4;
}
/* a creature some race is friendly with: a town guard or citizen of the other faction (not for grinding) */
function factionNpc(m) { const h = G.d.hostility.creatures[m.e]; return !!(h && h[1].indexOf('F') >= 0); }
function attackable(m, c) { const b = behOf(m, c); return (b === 'A' || (b === 'N' && !(c.rep && G.d.rep && repKillHurts(c, m.e)))) && !m.civ && m.st === 'alive'; }
function grayLevel(level) { const r = G.d.xp.levels[level - 1]; return r ? r.gray_level : 0; }

/* ------------------------------------------------------------------ xp */
function killXp(c, m) {
  const L = c.level, M = m.lvl; if (L >= MAX_LEVEL) return 0;
  if (m.info && m.info[5] === 8) return 0;
  const base = M * 5 + 45; let xp;
  if (M >= L) xp = base * (1 + 0.05 * Math.min(4, M - L));
  else { if (M <= grayLevel(L)) return 0; let zd = 5; for (const [lv, z] of G.d.xp.formulas.zero_difference_table || [[8, 5], [10, 6], [12, 7], [16, 8], [20, 9], [30, 11], [40, 12], [45, 13], [50, 14], [55, 15], [60, 16], [999, 17]]) { if (L < lv) { zd = z; break; } } xp = base * (1 - (L - M) / zd); }
  if (m.rank >= 1 && m.rank <= 3) xp *= 2;
  return Math.max(0, Math.round(xp));
}
/* quest XP as the server computes it: from the money a level-60 character would get instead (RewMoneyMaxLevel) */
function questXp(q, c) {
  let full = q.reward_money_max_level ? q.reward_money_max_level / (q.level >= 60 ? 1.2 : 0.6) : (q.level * 5 + 45) * 2.6;
  if (c) { const d = c.level - q.level; if (d >= 10) full *= 0.1; else if (d === 9) full *= 0.2; else if (d === 8) full *= 0.4; else if (d === 7) full *= 0.6; else if (d === 6) full *= 0.8; }
  return Math.ceil(full);
}
function gainXp(c, xp, why) {
  if (xp <= 0 || c.level >= MAX_LEVEL) return;
  if (G.away) G.away.xp[c.id] = (G.away.xp[c.id] || 0) + xp;          // away.js: what the time away gave
  c.xp += xp;
  fx(c.pos.x, c.pos.y, '+' + xp + ' xp', '#c58cf0');
  for (;;) {
    const need = (G.d.xp.levels[c.level - 1] || {}).xp_to_next; if (!need || c.xp < need || c.level >= MAX_LEVEL) break;
    c.xp -= need; c.level++; masteryLevelUp(c); dirty(c); const s = charStats(c); c.hp = s.maxHp; learnAbilities(c);
    if (typeof checkStarterItems === 'function') checkStarterItems(c);
    if (typeof onLevelTalents === 'function') onLevelTalents(c);
    log('*** ' + c.name + ' reached level ' + c.level + '! ***'); fx(c.pos.x, c.pos.y, 'LEVEL ' + c.level, '#ffe14d');
    if (c.level === 20 && (c.cls === 1 || c.cls === 3)) log('You can now dual wield one-handed weapons.');
    if (c.level === 10 && c.cls === 4) log('You can now dual wield one-handed weapons.');
    if (c.level === 40 && (c.cls === 1 || c.cls === 2)) log('You can now wear plate armor.');
    if (c.level === 40 && (c.cls === 3 || c.cls === 7)) log('You can now wear mail armor.');
  }
  if (c.level >= MAX_LEVEL) c.xp = 0;
  refreshGear();
}

/* --------------------------------------------------------------- effects */
function fx(x, y, text, color) { G.fx.push({ x, y, text, color: color || '#fff', t: 0 }); if (G.fx.length > 60) G.fx.shift(); }

/* ----------------------------------------------------------------- loot */
function questNeeds(c, id) {
  for (const qid in c.quests) {
    const q = G.q.byId[qid]; if (!q) continue;
    for (let i = 0; i < q.objectives.length; i++) {
      const o = q.objectives[i]; if (o.type === 'Collect' && o.id === id && bagCount(c, id) < o.count) return true;
    }
  }
  return false;
}
/* what a corpse holds: [[item, count, questItem]] - rolled like the server does (loot.json "raw": groups give at most
   one item each, references roll another table); without the raw tables, every item on its own (the flat chances) */
function lootDrops(lootId, needs) {
  const raw = G.d.loot.raw; const out = [];
  const rows = raw && raw.creature[lootId];
  if (!rows) {
    for (const [item, pct, mn, mx, quest] of G.d.loot.tables.creature[lootId] || []) { if (quest && !needs(item)) continue; if (Math.random() * 100 < pct) out.push([item, irnd(mn, mx), !!quest]); }
    return out;
  }
  lootRollRows(rows, needs, out, 0);
  return out;
}
function lootRollRows(rows, needs, out, depth) {
  const groups = {};
  for (const r of rows) { if (r[2]) (groups[r[2]] = groups[r[2]] || []).push(r); else lootRollRow(r, needs, out, depth, false); }
  for (const g in groups) {
    // one item of the group at most: the ones with a chance first (a single roll over their chances), else one of the
    // ones with an equal share
    const list = groups[g]; let roll = Math.random() * 100; let pick = null;
    for (const r of list) { if (!r[1]) continue; const ch = Math.abs(r[1]); if (ch >= 100 || roll < ch) { pick = r; break; } roll -= ch; }
    if (!pick) { const eq = list.filter((r) => !r[1]); if (eq.length) pick = eq[Math.floor(Math.random() * eq.length)]; }
    if (pick) lootRollRow(pick, needs, out, depth, true);
  }
}
function lootRollRow(r, needs, out, depth, chosen) {
  const [item, ch, , mref, mx] = r;
  if (!chosen && Math.random() * 100 >= Math.abs(ch)) return;
  if (mref < 0) {          // a reference table, rolled maxCount times
    const ref = G.d.loot.raw.reference[-mref]; if (!ref || depth > 4) return;
    for (let k = 0; k < Math.max(1, mx); k++) lootRollRows(ref, needs, out, depth + 1);
    return;
  }
  const quest = ch < 0;
  if (quest && !needs(item)) return;
  out.push([item, irnd(Math.max(1, mref), Math.max(1, mref, mx)), quest]);
}
/* roll: group loot - {chars: the characters near (money is shared), comps: dungeon companions}; green and better items
   are rolled for (Need / Greed), the rest goes to the looter (c) */
function lootMob(c, m, questOnly, roll) {
  const info = G.d.loot.creatures[m.e]; if (!info) return;
  const got = []; const rolls = [];
  const gmin = info[9], gmax = info[10];
  if (gmax && !questOnly) {
    const g = irnd(gmin, gmax); const share = roll && roll.chars.length > 1 ? Math.floor(g / roll.chars.length) : g;
    c.gold += g - share * ((roll && roll.chars.length > 1 ? roll.chars.length : 1) - 1); if (g) got.push(money(g) + (share !== g ? ' (shared)' : ''));
    if (share !== g) for (const o of roll.chars) if (o !== c && share) { o.gold += share; withLog(o, () => log('Your share of the loot: ' + money(share) + '.')); }
  }
  // mercenaries are paid for the run: they roll on the loot only when the setting says so
  if (roll && !G.state.settings.mercLoot) roll = Object.assign({}, roll, { comps: [] });
  for (const [item, n, quest] of lootDrops(info[6], (it) => questNeeds(c, it))) {
    if (questOnly && !questNeeds(c, item)) continue;              // a group member: only its own quest drops
    if (roll && !quest && !questNeeds(c, item) && itemQuality(item) >= LOOT_ROLL_Q && roll.chars.length + roll.comps.length > 1) { rolls.push([item, n]); continue; }
    if (G.q.startBy[item] && (bagCount(c, item) || G.q.startBy[item].every((q) => c.done[q.id] || c.quests[q.id]))) continue;   // one quest starter is enough
    if (quest || questNeeds(c, item)) roomForQuestItem(c, item);
    const before = c.bags.length;
    if (addItem(c, item, n)) {
      const inst = c.bags.length > before ? c.bags[c.bags.length - 1] : null;
      got.push((n > 1 ? n + ' x ' : '') + itemName(item, inst && inst.id === item ? inst : null));
      if (quest || questNeeds(c, item)) onItemGained(c, item);
      if (G.q.startBy[item]) itemStartsQuest(c, item);
      if (inst && inst.id === item && upgradeFor(c, inst)) log('Possible upgrade: ' + itemName(item, inst) + ' (open the character sheet to equip it).');
    } else { log('Bags are full - left ' + itemName(item) + ' behind.'); }
  }
  if (got.length) log('Looted: ' + got.join(', '));
  for (const [item, n] of rolls) lootRoll(roll, item, n, m);
  if (bagFree(c) <= 0) rt(c).bagFull = true;
  if (c.prof) checkRecipeItems(c);
  autoEquip(c);
  refreshGear();
}

/* ----------------------------------------------------------- mob combat */
function engage(m, c) {
  if (m.st !== 'alive') return;
  m.st = 'chase'; m.tgt = c; m.engT = G.gameTime; ensureWorld(c.pos.map).active.add(m);
  if (c.id && typeof groupOf === 'function' && groupOf(c)) { m.cThr = m.cThr || {}; m.cThr[c.id] = Math.max(m.cThr[c.id] || 0, 1); }
}
function mobDamage(m, c, s, mods) {
  /* one roll on the attack table: miss, dodge, parry, block, crit, hit (defense vs the mob's weapon skill) */
  const skillDiff = s.def - m.lvl * 5;
  let r = Math.random() * 100;
  const miss = Math.max(0, 5 + skillDiff * 0.04);
  if ((r -= miss) < 0) return { t: 'miss' };
  if ((r -= Math.max(0, s.dodge)) < 0) return { t: 'dodge' };
  if ((r -= Math.max(0, s.parry)) < 0) return { t: 'parry' };
  let blocked = 0; if (s.hasShield && (r -= Math.max(0, s.block)) < 0) blocked = s.blockValue;
  let d = rnd(m.dmin, m.dmax);
  if (mods) { d += mods.ap / 14 * m.atk + (mods.dmg || 0); d *= mods.dmgPct || 1; if (mods.disarm) d *= 0.5; }
  d = Math.max(1, d) * s.dmgTaken;
  d *= 1 - s.armorReduction(m.lvl);
  let crit = false;
  if (!blocked && Math.random() * 100 < Math.max(0, 5 - skillDiff * 0.04)) { d *= 2; crit = true; }
  else if (!blocked && m.lvl - c.level >= 3 && Math.random() < 0.15) { d *= 1.5; crit = true; }
  d = Math.round(d - blocked);
  if (d <= 0) return { t: 'block' };
  return { t: 'hit', d, crit, blocked };
}
function mobTick(W, m, dt, now) {
  let c = m.tgt;
  if (m.st === 'chase' && m.cThr && c && (c.hp <= 0 || rt(c).ghost || c.pos.map !== W.id)) { const n = mobRetarget(m, W); if (n) { m.tgt = n; c = n; } }
  if (m.st === 'chase') {
    if (!c || c.hp <= 0 || rt(c).ghost || rt(c).flying || rt(c).riding || c.pos.map !== W.id) return evade(W, m);
    mobAuraTick(W, m, dt); if (m.st !== 'chase') return;
    const mods = mobMods(m);
    const dh = Math.hypot(m.x - m.hx, m.y - m.hy);
    if (dh > m.leash + 20 && !m.fleeing) return evade(W, m);
    const vk = rt(c).party ? mobVictimKey(m, c) : mobVictimIsPet(m, c) ? 'p' : 'c';
    const onPet = vk === 'p'; const vu = vk !== 'c' && vk !== 'p' ? partyUnit(c, vk) : null;
    const vx = onPet ? rt(c).pet.x : vu ? vu.x : c.pos.x, vy = onPet ? rt(c).pet.y : vu ? vu.y : c.pos.y;
    const d = Math.hypot(vx - m.x, vy - m.y);
    // low-health humanoids try to run away (and bring friends)
    if (!m.fled && m.rank === 0 && m.info && m.info[5] === 7 && m.hp < m.maxhp * 0.15) { m.fled = true; if (Math.random() < 0.6 && !mods.stun) { m.fleeing = now + 8; fx(m.x, m.y, 'flees!', '#ffb36b'); } }
    if (m.fleeing) {
      if (now > m.fleeing || mods.stun) { m.fleeing = 0; }
      else {
        const sp = 5.2 * mods.snare * dt; m.x += (m.x - c.pos.x) / (d || 1) * sp; m.y += (m.y - c.pos.y) / (d || 1) * sp;
        if (m.help) callHelp(W, m, c);
        return;
      }
    }
    if ((mods.stun || mods.fear) && m.cast) { m.cast = null; fx(m.x, m.y, 'interrupted', '#cfc6b0'); }
    if (mods.fear) { const sp = 3 * dt; m.x += (m.x - c.pos.x) / (d || 1) * sp; m.y += (m.y - c.pos.y) / (d || 1) * sp; return; }
    if (mods.stun) return;
    if (typeof mobSpellStep === 'function' && mobSpellStep(W, m, c, dt, now, mods, vk, vu, onPet, d)) return;      // its own spells (mobspells.js)
    const want = m.sk && typeof msKeepRange === 'function' ? msKeepRange(m, W) : MELEE_RANGE - 0.5;       // casters keep their distance
    if (d > want) {
      const step = Math.min(d - want + 0.3, 7 * mods.snare * dt); m.x += (vx - m.x) / d * step; m.y += (vy - m.y) / d * step; m.swing = Math.max(m.swing, 0.4);
    } else if (d <= MELEE_RANGE + 0.5) {
      m.swing -= dt;
      if (m.swing <= 0 && vu) { m.swing += m.atk / mods.haste; compTakeHit(c, vu, m, Math.max(1, rnd(m.dmin, m.dmax) + mods.ap / 14 * m.atk + mods.dmg) * mods.dmgPct * (mods.disarm ? 0.5 : 1)); if (m.auras && typeof msOnMobHit === 'function') msOnMobHit(W, m, c, { u: vu, x: vu.x, y: vu.y }); }
      else if (m.swing <= 0 && onPet) { m.swing += m.atk / mods.haste; petTakeHit(c, m, Math.max(1, rnd(m.dmin, m.dmax) + mods.ap / 14 * m.atk + (mods.dmg || 0)) * (mods.dmgPct || 1) * (mods.disarm ? 0.5 : 1)); if (m.auras && typeof msOnMobHit === 'function') msOnMobHit(W, m, c, { pet: true, x: rt(c).pet.x, y: rt(c).pet.y }); }
      else if (m.swing <= 0) {
        m.swing += m.atk / mods.haste; const s = charStats(c); const h = mobDamage(m, c, s, mods);
        const r = rt(c);
        if (h.t === 'hit' && c.cls !== 1) { h.d = absorbDamage(c, h.d); damageShield(c, m); if (m.hp <= 0) { killMob(c, m); return; } if (h.d <= 0) { h.t = 'absorb'; } }
        if (h.t === 'dodge' || h.t === 'parry' || h.t === 'block' || h.blocked) r.revWindow = now + 5;
        if (h.t === 'hit') {
          hitTakenTalents(c, h);
          c.hp -= h.d; meterTaken(c, h.d); if (r.party) (r.dmgLog = r.dmgLog || []).push([now, h.d]); fx(c.pos.x, c.pos.y, '-' + h.d + (h.crit ? '!' : '') + (h.blocked ? ' (' + h.blocked + ' blocked)' : ''), '#ff6a5a');
          if (c.cls === 1 || (c.cls === 11 && c.form === 'bear')) c.rage = Math.min(100, c.rage + 2.5 * h.d / rageConv(c.level) * 2.0);
          if (r.cast && !r.cast.ch && c.cls !== 1) r.cast.t = Math.max(0, r.cast.t - 0.5);      // spell pushback
          if (c.hp <= 0) { c.hp = 0; charDie(c, m); return; }
          if (r.bandage) bandageHit(c);
          autoPotion(c);
          if (m.auras && typeof msOnMobHit === 'function') msOnMobHit(W, m, c, { c, x: c.pos.x, y: c.pos.y });      // its procs (poison on the blade)
        } else fx(c.pos.x, c.pos.y, h.t, '#cfc6b0');
        const ret = (r.buffs || []).find((b) => b.retaliation && b.until > now);
        if (ret) { ret.retaliation--; if (ret.retaliation <= 0) ret.until = 0; playerSwing(c, m, s, s.mh, { yellow: true }); if (m.hp <= 0) killMob(c, m); }
      }
    }
  } else if (m.st === 'evade') {
    m.fleeing = 0; m.auras = null;
    const d = Math.hypot(m.hx - m.x, m.hy - m.y);
    if (d < 1) { m.st = 'alive'; m.hp = m.maxhp; if (m.maxmana) m.mana = m.maxmana; m.x = m.hx; m.y = m.hy; m.fled = false; W.active.delete(m); }
    else { const step = Math.min(d, 10 * dt); m.x += (m.hx - m.x) / d * step; m.y += (m.hy - m.y) / d * step; m.hp = Math.min(m.maxhp, m.hp + m.maxhp * 0.2 * dt); }
  }
}
function evade(W, m) { m.sk = null; m.cast = null; m.st = 'evade'; m.tgt = null; m.petThreat = 0; m.charThreat = 0; }
function worldTick(dt) {
  const now = G.gameTime;
  if (typeof marketTick === 'function') marketTick();
  if (typeof wcTick === 'function') wcTick(dt);             // guild crafting orders (workshop.js)
  for (const id in G.world) {
    const W = G.world[id];
    for (const m of W.active) mobTick(W, m, dt, now);
    if (W.dead.length && ((now * 4) | 0) % 4 === 0) {
      for (let i = W.dead.length - 1; i >= 0; i--) {
        const m = W.dead[i]; if (now >= m.respAt) { W.dead.splice(i, 1); if (m.pool) rareMove(W, m); initMob(m); }
      }
    }
  }
}

/* ---------------------------------------------------------- kills / death */
function killMob(c, m) {
  // the creature's own world (a damage-over-time can finish it after the killer went elsewhere, into a dungeon even)
  const wid = m.wid != null ? m.wid : c.pos.map; const W = ensureWorld(wid);
  const dg = typeof isDungeonMap === 'function' && isDungeonMap(wid);
  if (m.st === 'dead') return;
  m.st = 'dead'; m.tgt = null; m.hp = 0; m.respAt = dg ? Infinity : G.gameTime + irnd(m.rmin, m.rmax); m.deadAt = G.gameTime; W.active.delete(m); W.dead.push(m);
  const name = m.info ? m.info[1] : 'creature';
  if (dg) dungeonKill(c, m);
  if (G.away) G.away.kills[c.id] = (G.away.kills[c.id] || 0) + 1;
  masteryKill(c, m);
  if (typeof groupOf === 'function' && groupOf(c)) groupKill(c, m, W);           // your characters together: shared kill, experience in parts
  else {
    const party = rt(c).party; const xp = Math.round(killXp(c, m) * (party && party.length ? Math.min(1, 1.6 / (party.length + 1)) : 1)); gainXp(c, xp);
    if (typeof petOnKill === 'function') petOnKill(c, m, party && party.length ? Math.min(1, 1.6 / (party.length + 1)) : 1);
    if (G.d.rep) repOnKill(c, m, dg || !party || !party.length ? 1 : Math.min(1, 1.6 / (party.length + 1)));      // reputation: all of it in a dungeon, shared in a group out in the world
    log(name + ' (lvl ' + m.lvl + ') slain' + (xp ? ', +' + xp + ' xp' : ', no xp') + '.');
    const comps = party ? party.filter((u) => u.comp && !u.dead) : [];
    lootMob(c, m, false, comps.length ? { chars: [c], comps } : null);
    onKill(c, m);
    if (c.prof) onKillProf(c, m);
  }
  if (c.order && (c.order.type === 'grind' || c.order.type === 'patrol')) c.order.kills = (c.order.kills || 0) + 1;
  if (c.order && c.order.type === 'leveling' && c.order.grind) c.order.grind.kills = (c.order.grind.kills || 0) + 1;
  const r = rt(c); if (r.tgt === m) r.tgt = null;
  c.rage = c.rage; save();
}
function nearestGraveyard(c) {
  let best = null, bd = 1e18;
  for (const gy of G.d.graveyards) { if (gy[2] !== c.pos.map) continue; const d = Math.hypot(gy[3] - c.pos.x, gy[4] - c.pos.y); if (d < bd) { bd = d; best = gy; } }
  return best;
}
function charDie(c, killer) {
  const r = rt(c); if (r.ghost) return;              // already dead
  // in a dungeon with your own group: one who dies lies where it fell; when the fight is over a groupmate brings it
  // back (like a healer's resurrection). Only when the last one falls is it a wipe: everyone back from the graveyard.
  const grp = typeof groupOf === 'function' ? groupOf(c) : null;
  if (grp && !G.dgWipe && typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map)) {
    const alive = groupChars(grp).filter((o) => o !== c && o.pos.map === c.pos.map && !rt(o).ghost && o.hp > 0);
    if (alive.length) {
      log(c.name + ' was killed by ' + (killer && killer.info ? killer.info[1] : 'a creature') + ' - lies there until the fight is over.');
      fx(c.pos.x, c.pos.y, 'DEAD', '#ff3b30'); masteryDeath(c); durabilityLoss(c, 0.1);
      const W = ensureWorld(c.pos.map); for (const m of W.active) if (m.tgt === c) { const n = m.cThr && typeof mobRetarget === 'function' ? mobRetarget(m, W) : null; if (n) m.tgt = n; else evade(W, m); }
      c.hp = 0; r.ghost = { inPlace: true, t: G.gameTime, corpse: { map: c.pos.map, x: c.pos.x, y: c.pos.y } };
      r.cast = null; r.drinking = null; r.eating = null; r.absorb = null; r.tgt = null; r.interact = null; r.charging = null; r.queued = null; r.threats = []; r.mv = null; r.resting = false; c.form = null; c.energy = 0; c.rage = 0;
      if (c.pet && c.pet.kind !== 'hunter') c.pet = null;
      save(); renderOrder(); return;
    }
    // the last one: the ones lying in there go back with it
    const lying = groupChars(grp).filter((o) => o !== c && rt(o).ghost && rt(o).ghost.inPlace);
    if (lying.length) { log('The group wiped.'); G.dgWipe = true; try { for (const o of lying) { rt(o).ghost = null; o.hp = 0; withLog(o, () => charDie(o, null)); } } finally { G.dgWipe = false; } }
  }
  const dgDeath = typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map) && dungeonDeath(c);     // inside: the body is back at the entrance
  const corpse = { map: c.pos.map, x: c.pos.x, y: c.pos.y };
  if (!dgDeath) masteryDeath(c);
  log(c.name + ' was killed by ' + (killer && killer.info ? killer.info[1] : 'a creature') + '.');
  fx(c.pos.x, c.pos.y, 'DEAD', '#ff3b30');
  const W = ensureWorld(c.pos.map); for (const m of W.active) if (m.tgt === c) { const n = m.cThr && typeof mobRetarget === 'function' ? mobRetarget(m, W) : null; if (n) m.tgt = n; else evade(W, m); }
  if (c.order && c.order.type === 'vendor' && c.order.resume) c.order = c.order.resume;     // the walk to a vendor belongs to the order behind it
  if (c.order && c.order.type === 'leveling') {
    const o = c.order; o.deaths = (o.deaths || 0) + 1;
    // three deaths in 15 minutes: this area is too much right now - leave the zone for a level
    o.recentDeaths = (o.recentDeaths || []).filter((t) => G.gameTime - t < 900).concat([G.gameTime]);
    if (o.recentDeaths.length >= 3 && o.zones && o.zones[0]) {
      log('Died ' + o.recentDeaths.length + ' times in a short while - leaving ' + o.zones[0] + ' for now.');
      o.avoid = o.avoid || {}; o.avoid[o.zones[0]] = c.level; o.recentDeaths = [];
      if (o.grind) o.badSpots = (o.badSpots || []).concat([{ map: c.pos.map, x: o.grind.cx, y: o.grind.cy }]);
      o.mode = 'pick'; o.fq = null; o.wt = null; o.grind = null; o.trip = null;
    }
    if (o.mode === 'grind') { o.gdeaths = (o.gdeaths || 0) + 1; if (o.gdeaths >= 2) { log('Died twice at this grinding spot - looking for another place.'); o.badSpots = (o.badSpots || []).concat([{ map: c.pos.map, x: o.grind.cx, y: o.grind.cy }]).slice(-30); o.mode = 'pick'; o.grind = null; o.gdeaths = 0; } }
    else if (o.fq) { o.qdeaths = o.qdeaths || {}; o.qdeaths[o.fq] = (o.qdeaths[o.fq] || 0) + 1; if (o.qdeaths[o.fq] >= 2) { const q = G.q.byId[o.fq]; log('Died twice on "' + (q ? q.title : o.fq) + '" - skipping it until the next level.'); o.skip = o.skip || {}; o.skip[o.fq] = c.level; o.qdeaths[o.fq] = 0; o.fq = null; o.wt = null; } }
    else if (o.mode === 'travel' && o.deaths % 3 === 0 && o.zones[0]) { log('Keeps dying on the way to ' + o.zones[0] + ' - choosing again.'); o.avoid = o.avoid || {}; o.avoid[o.zones[0]] = c.level + 1; o.mode = 'pick'; o.trip = null; }
  } else if (c.order && c.order.type === 'dungeon') {
    const o = c.order; if (dgDeath) o.deaths = (o.deaths || 0) + 1;
    if (o.deaths >= 4) { log('The group wiped ' + o.deaths + ' times - giving up on ' + o.label + '.'); r.dgReturn = null; r.party = null; c.order = o.resume || null; }
    else if (dgDeath) log('Wipe! Running back to ' + o.label + ' from the graveyard.');
  } else if (c.order && c.order.type === 'questing' && c.order.fq) {
    const o = c.order; o.qdeaths = o.qdeaths || {}; o.qdeaths[o.fq] = (o.qdeaths[o.fq] || 0) + 1;
    if (o.qdeaths[o.fq] >= 3) { const q = G.q.byId[o.fq]; log('Died 3 times on "' + (q ? q.title : o.fq) + '" - skipping it until the next level.'); o.skip = o.skip || {}; o.skip[o.fq] = c.level; o.qdeaths[o.fq] = 0; o.fq = null; o.wt = null; }
  } else if (c.order && c.order.type !== 'questing') { c.order.deaths = (c.order.deaths || 0) + 1; if (c.order.deaths >= 3) { log('Died 3 times on this order - it is too dangerous. Order cancelled.'); c.order = null; } }
  durabilityLoss(c, 0.1);
  r.cast = null; r.drinking = null; r.absorb = null; r.totemDmg = null; c.form = null; c.energy = 0;
  if (c.pet) { if (c.pet.kind === 'hunter') c.pet.dead = true; else c.pet = null; }
  r.saved = c.order; c.resume = c.order; r.ghost = { corpse }; r.tgt = null; r.interact = null; r.charging = null; r.queued = null; r.threats = []; c.order = null; c.rage = 0; r.mv = null; r.resting = false; r.flying = null; r.riding = null;
  const gy = nearestGraveyard(c);
  if (gy) { c.pos.x = gy[3]; c.pos.y = gy[4]; log('Released at ' + gy[1] + '. Running back to the corpse ...'); }
  const p = planPath(c, corpse); r.ghost.path = p.pts; r.ghost.idx = 1;
  save(); renderOrder();
}
function safeSpot(c, x, y) {
  /* a point near (x, y) outside the aggro range of every hostile creature, or null */
  const W = ensureWorld(c.pos.map); const hostile = [];
  mobsNear(W, x, y, 90, (m) => { if (m.st === 'alive' && behOf(m, c) === 'A' && !m.civ) hostile.push(m); });
  const ok = (px, py) => passable(c.pos.map, px, py) && hostile.every((m) => Math.hypot(px - m.x, py - m.y) > aggroRadius(m, c) + 5);
  if (ok(x, y)) return { x, y };
  let best = null, bd = 1e9;
  for (const rad of [8, 16, 24, 32]) for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2; const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    if (!ok(px, py)) continue; const d = Math.hypot(px - c.pos.x, py - c.pos.y); if (d < bd) { bd = d; best = { x: px, y: py }; }
  }
  return best;
}
function revive(c, how) {
  const r = rt(c); r.ghost = null; delete c.resume; const s = charStats(c); c.hp = Math.round(s.maxHp * 0.5);
  if (r.dgReturn) { c.pos = { map: r.dgReturn.map, x: r.dgReturn.x, y: r.dgReturn.y, z: r.dgReturn.z, o: c.pos.o }; r.dgReturn = null; log('Back inside.'); if (isActive(c) && $('follow').checked) goToCharacter(); }
  if (how === 'spirit') { durabilityLoss(c, 0.25); log(c.name + ' was resurrected by the spirit healer (extra 25% durability loss).'); }
  else log(c.name + ' is back among the living.');
  r.resting = true;   // catch the breath before going on
  if (r.saved) { const o = r.saved; r.saved = null; resumeOrder(c, o); }
  save(); renderOrder();
}
function ghostStep(c, dt) {
  const gh = rt(c).ghost; let left = charSpeed(c) * 1.25 * dt;
  if (gh.inPlace) { inPlaceDeadStep(c, gh, dt); return; }
  if (!gh.spot) {
    const dc = Math.hypot(gh.corpse.x - c.pos.x, gh.corpse.y - c.pos.y);
    if (dc < 40) {
      gh.spot = safeSpot(c, gh.corpse.x, gh.corpse.y);
      if (gh.spot) { gh.path = [{ x: c.pos.x, y: c.pos.y }, gh.spot]; gh.idx = 1; }
      else {
        gh.wait = (gh.wait || 0) + dt;
        if (gh.wait > 20) { const gy = nearestGraveyard(c); if (gy) { c.pos.x = gy[3]; c.pos.y = gy[4]; } revive(c, 'spirit'); }
        return;
      }
    }
  }
  while (left > 0 && gh.idx < gh.path.length) {
    const nx = gh.path[gh.idx]; const dx = nx.x - c.pos.x, dy = nx.y - c.pos.y; const d = Math.hypot(dx, dy);
    if (d <= left) { c.pos.x = nx.x; c.pos.y = nx.y; left -= d; gh.idx++; }
    else { c.pos.x += dx / d * left; c.pos.y += dy / d * left; c.pos.o = Math.atan2(dx, dy); left = 0; }
  }
  if (gh.idx >= gh.path.length) {
    if (!gh.spot) { gh.spot = safeSpot(c, gh.corpse.x, gh.corpse.y); if (gh.spot) { gh.path = [{ x: c.pos.x, y: c.pos.y }, gh.spot]; gh.idx = 1; return; } gh.wait = (gh.wait || 0) + dt; if (gh.wait > 20) { const gy = nearestGraveyard(c); if (gy) { c.pos.x = gy[3]; c.pos.y = gy[4]; } revive(c, 'spirit'); } return; }
    revive(c);
  }
}
/* dead on the spot in a dungeon (charDie): back on its feet a few seconds after the group's fight is over */
function inPlaceDeadStep(c, gh, dt) {
  const r = rt(c); const g = typeof groupOf === 'function' ? groupOf(c) : null;
  const near = g ? groupChars(g).filter((o) => o !== c && o.pos.map === c.pos.map && !rt(o).ghost && o.hp > 0) : [];
  if (!near.length) { r.ghost = null; c.hp = 0; G.dgWipe = true; try { charDie(c, null); } finally { G.dgWipe = false; } return; }            // nobody left to help: back from the graveyard
  if (near.some((o) => (rt(o).threats || []).length)) { gh.calm = 0; return; }
  gh.calm = (gh.calm || 0) + dt; if (gh.calm < 4) return;
  const h = near.find((o) => typeof grpRole === 'function' && grpRole(o) === 'healer') || near[0];
  const s = charStats(c); r.ghost = null; c.hp = Math.round(s.maxHp * 0.4); if (usesMana(c) && s.maxMana) c.mana = Math.max(c.mana || 0, Math.round(s.maxMana * 0.4));
  r.resting = true; fx(c.pos.x, c.pos.y, 'Resurrected', '#9fe0ff'); log(h.name + ' brings ' + c.name + ' back to life.');
  save(); renderOrder();
}
function resumeOrder(c, o) {
  if (o.type === 'travel') orderTravel(c, o.target, o.label);
  else { c.order = o; o.state = null; o.wait = 0; o.wt = null; if (o.type === 'leveling' && o.mode === 'travel' && o.trip) { o.trip = planTrip(c, o.trip.dest); if (!o.trip) o.mode = 'pick'; } }
}

/* ------------------------------------------------------------ char combat */
function regenStep(c, dt) {
  const r = rt(c); const s = charStats(c);
  r.outT += dt;
  if (r.buffs && r.buffs.length) { const n = r.buffs.length; r.buffs = r.buffs.filter((b) => b.until > G.gameTime); if (r.buffs.length !== n) dirty(c); }
  buffStep(c, dt);
  if (r.eating) eatStep(c, dt);
  if (r.bandage) bandageStep(c, dt);
  if (c.cls !== 1) { hotStep(c, dt); drinkStep(c, dt); }
  r.regenT += dt;
  while (r.regenT >= 2) {
    r.regenT -= 2;
    if (c.cls !== 1) powerTick(c, s, r);
    if (s.hp5) c.hp = Math.min(s.maxHp, c.hp + s.hp5 * 0.4);
    if (r.outT > 5 || r.resting) { const per = Math.max(1, s.spi * 0.25) * (r.resting ? 2.5 : 1); c.hp = Math.min(s.maxHp, c.hp + per); }
  }
  if (r.outT > 6) c.rage = Math.max(0, c.rage - 1.5 * dt * (talentRank(c, 'Anger Management') ? 0.7 : 1));
  if (c.hp > s.maxHp) c.hp = s.maxHp;
}
/* sitting down: below cfg.sitAt % health when no enemy is near; eat food below cfg.eatAt %; stand at cfg.standAt % */
function restStep(c) {
  const r = rt(c); const cfg = c.cfg; const max = charStats(c).maxHp; const pct = c.hp / max * 100;
  const mana = usesMana(c) && c.cls !== 1; const mmax = mana ? charStats(c).maxMana : 0; const mp = mana && mmax ? c.mana / mmax * 100 : 100;
  const drinkAt = cfg.drinkAt == null ? 45 : cfg.drinkAt;
  if (r.resting) {
    const to = r.restFull ? 100 : cfg.standAt;
    const hpOk = pct >= Math.min(100, to) - 0.01 || (to >= 100 && c.hp >= max);
    const mpOk = !mana || !drinkAt || mp >= 99 || (!r.drinking && mp >= Math.min(95, drinkAt + 40));
    if (hpOk && mpOk) { r.resting = false; r.eating = null; r.drinking = null; r.restFull = false; return false; }
    if (!r.eating && cfg.eatAt > 0 && pct < cfg.eatAt) autoEat(c);
    if (mana && !r.drinking && drinkAt && mp < Math.max(drinkAt, 70)) autoDrink(c);
    return true;
  }
  if (pct < cfg.sitAt || (mana && drinkAt && mp < drinkAt)) {
    r.resting = true; r.mv = null; if (c.form && c.cls === 11 && mana && mp < drinkAt) leaveForm(c);
    if (cfg.eatAt > 0 && pct < cfg.eatAt) autoEat(c); if (mana && drinkAt && mp < drinkAt) autoDrink(c); return true;
  }
  return false;
}
function scanThreats(c) {
  const r = rt(c); const W = ensureWorld(c.pos.map); const safe = c.cfg && c.cfg.style === 'safe';
  const dg = typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map) && c.pos.z != null;
  r.danger = [];
  mobsNear(W, c.pos.x, c.pos.y, 70, (m) => {
    if (m.st !== 'alive') return;
    if (dg && m.z != null && Math.abs(m.z - c.pos.z) > 14) return;          // another level of the dungeon
    const b = behOf(m, c); if (b !== 'A' || m.civ) return;
    const R = aggroRadius(m, c); const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y);
    if (dangerous(m, c)) r.danger.push({ m, R: R + 8 });
    else if (safe && m !== r.tgt) r.danger.push({ m, R: R + 3, soft: true });
    if (d <= R) {
      engage(m, c);
      if (m.help) callHelp(W, m, c);
    }
  });
}
/* social aggro: only creatures that attack on sight (red) help each other; neutral (yellow) ones never join in */
function callHelp(W, m, c) {
  if (behOf(m, c) !== 'A') return;
  mobsNear(W, m.x, m.y, 8, (o) => { if (o !== m && o.st === 'alive' && (o.z == null || m.z == null || Math.abs(o.z - m.z) < 12) && o.tmpl === m.tmpl && Math.hypot(o.x - m.x, o.y - m.y) <= 8 && behOf(o, c) === 'A' && !o.civ) engage(o, c); });
}
function threatsOf(c) {
  const W = G.world[c.pos.map]; const out = []; if (!W) return out;
  for (const m of W.active) if (m.st === 'chase' && m.tgt === c) out.push(m);
  return out;
}
function playerSwing(c, m, s, w, opts) {
  /* one melee hit with weapon info w. opts: {bonus, off (off-hand), yellow (ability), normalized, pct, name} */
  opts = opts || {}; const r = rt(c);
  const spd = opts.normalized ? (w.it && w.it.t === 17 ? 3.3 : w.it && w.it.s === 15 ? 1.7 : 2.4) : w.speed;
  let d = rnd(w.min, w.max) + (s.ap + apVs(s, m)) / 14 * spd;
  if (opts.pct) d *= opts.pct / 100;
  d += opts.bonus || 0;
  if (opts.name === 'Cleave') d += (opts.bonus || 0) * 0.4 * talentRank(c, 'Improved Cleave');
  if (opts.off) d *= s.ohMult || 0.5;
  const diff = m.lvl - c.level;
  const dw = s.oh && !opts.yellow ? 19 : 0;
  let roll = Math.random() * 100;
  const miss = Math.max(0, 5 + dw + Math.max(0, diff) * (diff > 2 ? 2 : 1) - s.hit);
  if ((roll -= miss) < 0) { fx(m.x, m.y, 'miss', '#cfc6b0'); return 0; }
  if (opts.name !== 'Overpower' && (roll -= 5 + Math.max(0, diff) * 0.5) < 0) { fx(m.x, m.y, 'dodge', '#cfc6b0'); r.opWindow = G.gameTime + 5; r.opTarget = m; return 0; }
  const mm = mobMods(m); const arm = Math.max(0, m.armor + mm.armor);
  d *= 1 - clamp(arm / (arm + 400 + 85 * c.level), 0, 0.75);
  d *= s.dmgDone;
  let critCh = s.crit - Math.max(0, diff) * 0.2; if (opts.name === 'Overpower') critCh += 25 * talentRank(c, 'Improved Overpower');
  let crit = false; if (Math.random() * 100 < critCh) { d *= opts.yellow ? 2 + 0.1 * talentRank(c, 'Impale') : 2; crit = true; }
  d = Math.max(1, Math.round(d));
  m.hp -= d; onMobDamaged(m, d); if (c.cls !== 1) addThreat(m, c, d); meterDmg(c, d, opts.name || (opts.off ? 'Off hand' : 'Melee'));
  if (m.auras && typeof msThorns === 'function') msThorns(c, m);          // a damage shield on it (Fire Shield)
  fx(m.x, m.y, '' + d + (crit ? '!' : ''), crit ? '#ffd23a' : opts.off ? '#ddd' : '#fff');
  if (c.cls !== 1 && !opts.yellow) classMeleeHit(c, m, s, w, d, crit, opts);
  if (c.cls === 11 && c.form === 'bear' && !opts.yellow) c.rage = Math.min(100, c.rage + 7.5 * d / rageConv(c.level));
  if (c.cls === 1 && !opts.yellow) { c.rage = Math.min(100, c.rage + 7.5 * d / rageConv(c.level)); if (Math.random() < 0.08 * talentRank(c, 'Unbridled Wrath')) c.rage = Math.min(100, c.rage + 1); }
  if (c.cls === 1 && c.talents) meleeTalentProcs(c, m, s, w, d, crit, opts);
  procs(c, m, s, w, opts.off ? 16 : 15);
  return d;
}
/* talents that react to a melee hit of the character */
function meleeTalentProcs(c, m, s, w, d, crit, opts) {
  const r = rt(c);
  if (crit) {
    const dw = talentRank(c, 'Deep Wounds');
    if (dw && m.hp > 0) { const avg = ((s.mh.min + s.mh.max) / 2) * 0.2 * dw; addMobAura(c, m, { n: 'Deep Wounds', dur: 12000 }, { au: 3, lo: Math.max(1, Math.round(avg / 4)), amp: 3000 }); }
    const fl = talentRank(c, 'Flurry'); if (fl) r.flurry = { n: 3, haste: [0, 0.1, 0.15, 0.2, 0.25, 0.3][fl] };
  }
  if (!opts.extra && w && w.it && m.hp > 0) {
    const sub = w.it.s;
    if ((sub === 7 || sub === 8) && Math.random() < 0.01 * talentRank(c, 'Sword Specialization')) { fx(c.pos.x, c.pos.y, 'Sword Specialization', '#ffe9a8'); playerSwing(c, m, s, w, { extra: true }); }
    if ((sub === 4 || sub === 5) && Math.random() < 0.012 * talentRank(c, 'Mace Specialization')) addMobAura(c, m, { n: 'Mace Stun Effect', dur: 3000 }, { au: 12, lo: 0 });
  }
  if (opts.name === 'Hamstring' && Math.random() < 0.05 * talentRank(c, 'Improved Hamstring')) addMobAura(c, m, { n: 'Improved Hamstring', dur: 5000 }, { au: 26, lo: 0 });
  // Sweeping Strikes: the same damage on a second enemy fighting us
  const sw = (r.buffs || []).find((b) => b.sweep > 0 && b.until > G.gameTime);
  if (sw && !opts.sweep) {
    const other = attackersOf(c).find((x) => x !== m && x.hp > 0 && inMelee(c, x));
    if (other) { sw.sweep--; other.hp -= d; onMobDamaged(other, d); meterDmg(c, d, 'Sweeping Strikes'); fx(other.x, other.y, '' + d, '#ffd23a'); if (other.hp <= 0) killMob(c, other); if (sw.sweep <= 0) sw.until = 0; }
  }
}
/* talents that react to the character being hit */
function hitTakenTalents(c, h) {
  if (!h.crit || c.cls !== 1 || !c.talents) return;
  const en = talentRank(c, 'Enrage'); if (en) addBuff(c, { n: 'Enrage', dur: 12000 }, { au: 79, mi: 1, lo: 5 * en });
  const bc = talentRank(c, 'Blood Craze'); if (bc) addBuff(c, { n: 'Blood Craze', dur: 6000 }, { au: 161, mi: 0, lo: Math.round(charStats(c).maxHp * bc / 100 * 5 / 6) });
}
function apVs(s, m) { let v = 0; const t = m.info ? m.info[5] : 0; for (const [mask, add] of s.apVs) if (t && (mask & (1 << (t - 1)))) v += add; return v; }
function procs(c, m, s, w, slot) {
  for (const p of s.procs) {
    if ((p.slot === 15 || p.slot === 16) ? p.slot !== slot : slot !== 15) continue;
    const ch = p.ppm ? p.ppm * w.speed / 60 : p.chance ? p.chance / 100 : 0.05;
    if (Math.random() >= ch) continue;
    const sp = spellRow(p.spell); if (!sp) continue;
    for (const e of sp.ef || []) {
      if (e.t === 2 && m.hp > 0) { const v = Math.round(e.lo + Math.random() * Math.max(0, e.hi - e.lo)); m.hp -= v; fx(m.x, m.y, v + ' ' + sp.n, '#ff9a3c'); meterDmg(c, v, sp.n); break; }
      if (e.t === 6 && e.k === 'self') { const r = rt(c); (r.buffs = r.buffs || []).push({ name: sp.n, until: G.gameTime + (sp.dur || 10000) / 1000, auras: [[e.au, e.mi, e.lo]] }); dirty(c); fx(c.pos.x, c.pos.y, sp.n, '#9fe0ff'); break; }
    }
  }
}
function fightStep(c, m, dt) {
  const r = rt(c); const s = charStats(c);
  r.outT = 0; r.resting = false; r.eating = null; r.drinking = null;
  if (typeof consumablesFight === 'function') { consumablesFight(c, m); if (r.bandage) return; }
  if (c.cls === 8 && frostNovaStep(c, m, dt)) return;           // mage: Frost Nova when they reach it, then a few steps back
  const dx = m.x - c.pos.x, dy = m.y - c.pos.y, d = Math.hypot(dx, dy);
  c.pos.o = Math.atan2(dx, dy);
  const want = c.cls === 1 ? MELEE_RANGE : combatRange(c, m);
  if (d > want) {
    if (r.cast) return;
    if (typeof dgStraight === 'function' && isDungeonMap(c.pos.map) && !dgStraight(c.pos.map, c.pos, m)) { goTo(c, m.x, m.y, want - 0.5, m.z); if (r.blocked) { r.blocked = false; r.mv = null; } return; }      // a wall between: around it
    const step = Math.min(d - want + 0.5, charSpeed(c) * dt); c.pos.x += dx / d * step; c.pos.y += dy / d * step; return;
  }
  useAbilities(c, m);
  if (m.hp <= 0 || m.st === 'dead' || r.cast) return;
  if (d > MELEE_RANGE + 0.5) { if (c.cls !== 1) rangedStep(c, m, dt, d); return; }
  r.swingT -= dt;
  if (r.swingT <= 0) {
    const fl = r.flurry && r.flurry.n > 0 ? r.flurry : null; if (fl) fl.n--;
    r.swingT += s.mh.speed / (fl ? 1 + fl.haste : 1) / (1 + (s.haste || 0) / 100);
    const q = r.queued; r.queued = null;
    const [qpt, cost] = q ? queuedCost(c, q.sp, q.name) : [1, 0];
    if (q && powerOf(c, qpt) >= cost && abilityUsable(c, q.name).ok) {
      addPower(c, qpt, -cost); const bonus = (q.sp.ef[0] || {}).lo || 0; if (c.cls !== 1) startCooldown(c, q.name, q.sp);
      playerSwing(c, m, s, s.mh, { bonus, yellow: true, name: q.name }); fx(c.pos.x, c.pos.y, q.name, '#ffe9a8');
      if (q.name === 'Cleave') { const other = attackersOf(c).find((x) => x !== m && inMelee(c, x)); if (other) { playerSwing(c, other, s, s.mh, { bonus, yellow: true }); if (other.hp <= 0) killMob(c, other); } }
    } else playerSwing(c, m, s, s.mh, {});
    if (m.hp <= 0) { killMob(c, m); return; }
  }
  if (s.oh) {
    if (r.ohT == null) r.ohT = s.oh.speed / 2;
    r.ohT -= dt;
    if (r.ohT <= 0) { r.ohT += s.oh.speed / (1 + (s.haste || 0) / 100); playerSwing(c, m, s, s.oh, { off: true }); if (m.hp <= 0) killMob(c, m); }
  }
}
function fleeStep(c, dt, danger) {
  const r = rt(c); let ax = 0, ay = 0;
  for (const m of danger) { const dx = c.pos.x - m.x, dy = c.pos.y - m.y, d = Math.hypot(dx, dy) || 1; ax += dx / d; ay += dy / d; }
  const L = Math.hypot(ax, ay) || 1; ax /= L; ay /= L;
  r.cast = null;
  if (!r.fleeing) {
    r.fleeing = { t: 0 }; log(c.name + ' runs from ' + (danger[0].info ? danger[0].info[1] : 'a creature') + ' (level ' + danger[0].lvl + ').');
    // running from the same kind of danger again and again on the way: this way is too dangerous now
    const o = c.order; if (o) { o.flees = (o.flees || []).filter((t) => G.gameTime - t < 300).concat([G.gameTime]); if (o.flees.length >= 7) { o.flees = []; if (typeof fleeLoop === 'function') fleeLoop(c, o); } }
  }
  r.fleeing.t += dt; r.outT = 0;
  if (!passable(c.pos.map, c.pos.x + ax * 6, c.pos.y + ay * 6)) {
    const base = Math.atan2(ay, ax);
    for (const off of [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) { const a = base + off; if (passable(c.pos.map, c.pos.x + Math.cos(a) * 6, c.pos.y + Math.sin(a) * 6)) { ax = Math.cos(a); ay = Math.sin(a); break; } }
  }
  c.pos.x += ax * charSpeed(c) * dt; c.pos.y += ay * charSpeed(c) * dt; c.pos.o = Math.atan2(ax, ay);
  const o = c.order; if (o && o.type === 'travel') { /* re-plan from the new spot later */ o.replan = true; }
}

/* ---------------------------------------------------------------- steering */
function steer(c, dx, dy, step) {
  const r = rt(c); const dng = r.danger.filter((z) => z.m !== r.tgt && z.m.st === 'alive' && (!z.soft || Math.hypot(z.m.x - (r.tgt ? r.tgt.x : 1e9), z.m.y - (r.tgt ? r.tgt.y : 1e9)) > 2));
  if (!dng.length) return [dx, dy];
  const ang = Math.atan2(dy, dx); let best = null, bestScore = -1e9;
  for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, 3.14]) {
    const a = ang + off; const nx = c.pos.x + Math.cos(a) * step * 12, ny = c.pos.y + Math.sin(a) * step * 12;
    let clear = 1e9; for (const z of dng) clear = Math.min(clear, Math.hypot(nx - z.m.x, ny - z.m.y) - z.R);
    const score = (clear >= 0 ? 100 : clear * 5) - Math.abs(off) * 3;
    if (score > bestScore) { bestScore = score; best = a; }
    if (clear >= 0 && off === 0) break;
  }
  return [Math.cos(best), Math.sin(best)];
}

/* ------------------------------------------------------------ movement api */
/* A movement plan {path, idx, done, total} is advanced by advance(); travel orders use the same record. */
function advance(c, mv, dt) {
  // stuck detection (steering around dangerous creatures can dead-end); a pause (a fight, resting, the group leader
  // waiting for the others) is not being stuck: the check starts over after it
  if (mv.lastT != null && G.gameTime - mv.lastT > 0.5) mv.chk = null; mv.lastT = G.gameTime;
  if (!mv.chk) mv.chk = { t: G.gameTime, x: c.pos.x, y: c.pos.y };
  else if (G.gameTime - mv.chk.t >= 4) {
    if (Math.hypot(c.pos.x - mv.chk.x, c.pos.y - mv.chk.y) < 6) { mv.blocked = true; return false; }
    mv.chk = { t: G.gameTime, x: c.pos.x, y: c.pos.y };
  }
  let left = charSpeed(c) * dt;
  while (left > 0 && mv.idx < mv.path.length) {
    const nx = mv.path[mv.idx]; let dx = nx.x - c.pos.x, dy = nx.y - c.pos.y; const d = Math.hypot(dx, dy);
    if (d < 0.01) { mv.idx++; continue; }
    const step = Math.min(d, left);
    let ux = dx / d, uy = dy / d;
    if (rt(c).danger.length) { const [sx, sy] = steer(c, ux, uy, step); if (passable(c.pos.map, c.pos.x + sx * step * 3, c.pos.y + sy * step * 3)) { ux = sx; uy = sy; } }
    c.pos.x += ux * step; c.pos.y += uy * step; mv.done = (mv.done || 0) + step; left -= step; c.pos.o = Math.atan2(ux, uy);
    if (Math.hypot(nx.x - c.pos.x, nx.y - c.pos.y) < 0.6) { if (nx.z != null) c.pos.z = nx.z; mv.idx++; }
    if (ux * dx + uy * dy < d * 0.2 && step < d) break;   // steering away: stop for this tick
  }
  return mv.idx >= mv.path.length;
}
function goTo(c, x, y, stop, z) {
  const r = rt(c); const d0 = Math.hypot(x - c.pos.x, y - c.pos.y);
  if (d0 <= (stop || 1)) return true;
  if (!r.mv || Math.hypot(r.mv.tx - x, r.mv.ty - y) > 8 || r.mv.map !== c.pos.map) {
    const p = planPath(c, { x, y, z }); r.mv = { path: p.pts, idx: 1, done: 0, total: p.total, tx: x, ty: y, map: c.pos.map };
  }
  const arrived = advance(c, r.mv, STEP);
  if (r.mv && r.mv.blocked) {
    const det = r.mv.detours || 0;
    if (det < 3 && !(typeof dgExactFloor === 'function' && dgExactFloor(c.pos.map, c.pos.x, c.pos.y, c.pos.z))) {   // try to walk around the blocking creatures (not where the walls are known: the path already goes around)
      const dx = x - c.pos.x, dy = y - c.pos.y, L = Math.hypot(dx, dy) || 1; const side = det % 2 ? -1 : 1; const off = 45 + det * 30;
      const wx = c.pos.x + dx / L * Math.min(40, L / 2) - dy / L * off * side, wy = c.pos.y + dy / L * Math.min(40, L / 2) + dx / L * off * side;
      const rest = planPath({ pos: { map: c.pos.map, x: wx, y: wy } }, { x, y });
      r.mv = { path: [{ x: c.pos.x, y: c.pos.y }, { x: wx, y: wy }].concat(rest.pts.slice(1)), idx: 1, done: 0, total: 0, tx: x, ty: y, map: c.pos.map, detours: det + 1 };
      return false;
    }
    r.blocked = true; r.mv = null; return false;
  }
  if (arrived || Math.hypot(x - c.pos.x, y - c.pos.y) <= (stop || 1)) { r.mv = null; return true; }
  return false;
}

/* ---------------------------------------------------------- target picking */
function pickTarget(c, o) {
  const W = ensureWorld(c.pos.map); const r = rt(c); const style = c.cfg ? c.cfg.style : 'balanced';
  const cx = o.cx != null ? o.cx : c.pos.x, cy = o.cy != null ? o.cy : c.pos.y, R = o.radius || 100;
  const gray = grayLevel(c.level); let best = null, bd = 1e18, lone = null, ld = 1e18;
  mobsNear(W, cx, cy, R + 20, (m) => {
    if (m.st !== 'alive' || !attackable(m, c) || (m.banUntil || 0) > G.gameTime) return;
    if (o.entries && !o.entries.has(m.e)) return;
    if (!o.entries) { if (m.lvl <= gray && c.level > 1) return; if (m.info && m.info[5] === 8) return; if (m.info && (m.info[5] === 11)) return; if (m.info && m.info[5] === 7 && behOf(m, c) === 'N') return; if (factionNpc(m)) return; }
    if (dangerous(m, c) || m.lvl > c.level + (o.entries ? 3 : 2)) return;
    if (m.rank >= 1) return;
    if (Math.hypot(m.hx - cx, m.hy - cy) > R) return;
    for (const z of r.danger) if (!z.soft && Math.hypot(m.x - z.m.x, m.y - z.m.y) < z.R) return;
    const pack = packSize(W, m, c); const d0 = Math.hypot(m.x - c.pos.x, m.y - c.pos.y);
    const d = style === 'aggressive' ? d0 : d0 + 40 * pack;
    if (d < bd) { bd = d; best = m; }
    if (pack === 0 && d0 < ld) { ld = d0; lone = m; }
  });
  if (style === 'safe') {
    if (lone) { o.loneWait = 0; return lone; }
    o.loneWait = (o.loneWait || 0) + 1; return o.loneWait > 60 ? best : null;   // ~15 s without a lone target: take the best one
  }
  return best;
}
function packSize(W, m, c) { let n = 0; mobsNear(W, m.hx, m.hy, 25, (o) => { if (o !== m && o.st === 'alive' && attackable(o, c) && behOf(o, c) === 'A' && Math.hypot(o.x - m.x, o.y - m.y) < Math.max(10, aggroRadius(o, c) + 2)) n++; }); return n; }
/* approach & attack one chosen mob; returns 'moving' | 'engaged' | 'gone' */
/* expected health lost killing m (and the creatures that would join), from both sides' damage per second */
function fightCost(c, m) {
  const s = charStats(c); const W = ensureWorld(c.pos.map);
  const arm = Math.max(0, m.armor); const red = clamp(arm / (arm + 400 + 85 * c.level), 0, 0.75);
  const myDps = c.cls === 1 ? Math.max(1, (s.mhDps + s.ohDps) * (1 - red) * s.dmgDone * 1.3) : classDps(c, s, red);
  const hit = Math.max(0.3, 1 - (s.dodge + s.parry + s.block) / 100 - 0.05);
  const mobDps = ((m.dmin + m.dmax) / 2) * (1 - s.armorReduction(m.lvl)) * s.dmgTaken * hit / Math.max(0.8, m.atk);
  const pack = c.cfg && c.cfg.style === 'aggressive' ? packSize(W, m, c) : Math.min(2, packSize(W, m, c));
  let cost = mobDps * (m.hp / myDps);
  if (pack) cost += pack * mobDps * (m.hp / myDps + m.maxhp / myDps * 0.5);
  if (c.cls !== 1 && petIsTank(c)) cost *= 0.35;           // the pet takes the hits
  else if (c.cls !== 1 && isCaster(c)) cost *= 0.75;                                       // a few spells land before it arrives
  return cost;
}
function approach(c, m) {
  if (!m || m.st !== 'alive') return 'gone';
  const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y);
  const r0 = rt(c);
  if (!r0.threats.length && d > MELEE_RANGE + 1 && d < 60 && !r0.party) {
    const need = fightCost(c, m) * 1.2 + charStats(c).maxHp * 0.08;
    if (c.hp < need) {
      if (c.hp >= charStats(c).maxHp * 0.98) { m.banUntil = G.gameTime + 90; return 'gone'; }     // too strong even when full
      r0.resting = true; r0.restFull = true; r0.mv = null; if (c.cfg.eatAt > 0) autoEat(c); return 'moving';
    }
  }
  const reach = c.cls === 1 ? MELEE_RANGE + 1 : Math.max(MELEE_RANGE + 1, combatRange(c, m) - 1);
  // with a group: the tank goes in first, the others wait a moment at range (at most 8 seconds)
  const tank = r0.party && r0.party.find((u) => u.role === 'tank' && !u.dead);
  if (tank && !r0.threats.length && d <= Math.max(reach, 30)) {
    if (r0.tankPullM !== m) { r0.tankPullM = m; r0.tankPullT = G.gameTime; }
    if (G.gameTime - r0.tankPullT < 8 && m.st === 'alive') { r0.tankPull = m; r0.mv = null; return 'moving'; }
  }
  if (d <= reach) {
    if (c.cls !== 1 && petIsTank(c) && d > MELEE_RANGE + 1) {
      // send the pet in first and wait until it is there (up to 6 seconds)
      r0.petGo = m; r0.tgt = m; const P = r0.pet; const pd = Math.hypot(P.x - m.x, P.y - m.y);
      if (r0.petGoM !== m) { r0.petGoM = m; r0.petGoT = G.gameTime; }
      if (pd > MELEE_RANGE + 1 && G.gameTime - r0.petGoT < 6 && m.st === 'alive') return 'moving';
      m.petThreat = Math.max(m.petThreat || 0, 30);
    }
    engage(m, c); if (m.help) callHelp(ensureWorld(c.pos.map), m, c); return 'engaged';
  }
  if (d <= 25 && c.cls === 1 && tryOpener(c, m)) return 'moving';
  goTo(c, m.x, m.y, reach - 0.5, m.z);
  if (rt(c).blocked) { rt(c).blocked = false; m.banUntil = G.gameTime + 120; return 'gone'; }
  return 'moving';
}

/* ------------------------------------------------------------- grind order */
function orderGrind(c, cx, cy, radius, entries, label) {
  c.order = { type: 'grind', label: label || 'here', cx, cy, radius: radius || 100, entries: entries ? Array.from(entries) : null, kills: 0, started: G.gameTime };
  log('Order: grind ' + c.order.label + '.'); save(); renderOrder();
}
function orderSet(o) { return o.entries ? new Set(o.entries) : null; }
function updateGrind(c, o, dt) {
  const r = rt(c);
  if (r.bagFull || bagFree(c) <= 0) { bagsFull(c, o); return; }
  if (!o._set) o._set = orderSet(o);
  if (!r.tgt || r.tgt.st !== 'alive') {
    const oo = { cx: o.cx, cy: o.cy, radius: o.radius, entries: o._set, loneWait: o.loneWait };
    r.tgt = pickTarget(c, oo); o.loneWait = oo.loneWait;
    if (!r.tgt) {
      if (!o.wait) { o.wait = 1; log(c.cfg.style === 'safe' ? 'Waiting for a creature that stands alone ...' : 'No suitable creatures nearby - waiting for respawns.'); }
      if (Math.hypot(c.pos.x - o.cx, c.pos.y - o.cy) > 25) { goTo(c, o.cx, o.cy, 15); if (rt(c).blocked) { rt(c).blocked = false; if (o.noFallback) { o.failed = true; return; } log('Cannot reach the grinding area safely - grinding here instead.'); o.cx = c.pos.x; o.cy = c.pos.y; } }
      return;
    }
    o.wait = 0;
  }
  const st = approach(c, r.tgt);
  if (st === 'gone') r.tgt = null;
}

/* ------------------------------------------------------------- kill order: one creature the player clicked */
function orderKill(c, m) {
  const name = m.info ? m.info[1] : 'creature';
  c.order = { type: 'kill', label: name, e: m.e, wid: m.wid != null ? m.wid : c.pos.map, hx: m.hx, hy: m.hy, started: G.gameTime };
  rt(c).killM = m; log('Order: kill ' + name + '.'); save(); renderOrder();
}
function killOrderMob(c, o) {
  const r = rt(c); if (r.killM && r.killM.e === o.e) return r.killM;
  const W = G.world[o.wid]; if (!W) return null;
  return (r.killM = W.list.find((x) => x.e === o.e && x.hx === o.hx && x.hy === o.hy) || null);
}
function updateKill(c, o) {
  const r = rt(c); const m = killOrderMob(c, o);
  const end = (msg) => { if (msg) log(msg); r.killM = null; c.order = null; save(); renderOrder(); };
  if (!m || c.pos.map !== o.wid) { end('The creature to kill is not here any more - order finished.'); return; }
  if (m.st === 'dead') { end(o.hit || m.deadAt >= o.started ? null : o.label + ' is dead already.'); return; }
  if (m.st === 'evade') { o.where = 'waiting - it is running back'; return; }
  o.where = 'going for it';
  const st = approach(c, m);
  if (st === 'engaged') { o.hit = true; return; }
  if (st !== 'gone') return;
  // approach gave up on it (too strong, out of reach): the player said so - go anyway, unless there is no way there
  m.banUntil = 0; r.tgt = m;
  const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y); const reach = c.cls === 1 ? MELEE_RANGE + 1 : Math.max(MELEE_RANGE + 1, combatRange(c, m) - 1);
  if (d <= reach) { engage(m, c); o.hit = true; return; }
  goTo(c, m.x, m.y, reach - 0.5, m.z);
  if (r.blocked) { r.blocked = false; end('Cannot reach ' + o.label + ' - order finished.'); }
}
function killText(c, o) {
  const m = killOrderMob(c, o);
  return { t: 'Kill ' + o.label, d: m ? (m.st === 'chase' ? 'fighting it (' + Math.round(100 * m.hp / m.maxhp) + '%)' : (o.where || 'going for it') + ' - ' + Math.round(Math.hypot(m.x - c.pos.x, m.y - c.pos.y)) + ' yd') : '' };
}

/* ------------------------------------------------------------- char update */
function updateChar(c, dt) {
  const r = rt(c);
  if (r.ghost) { ghostStep(c, dt); return; }
  if (r.flying) { flyStep(c, dt); return; }
  if (r.riding) { rideStep(c, dt); return; }
  regenStep(c, dt);
  if (typeof trailStep === 'function' && isLeader(c)) trailStep(c);          // group.js: the way the leader walked (dungeons)
  if (r.charging) { chargeStep(c, dt); return; }
  if (typeof charCcStep === 'function' && charCcStep(c, dt)) return;           // stunned or feared by a creature's spell
  r.scanT -= dt;
  if (r.scanT <= 0) { r.scanT = SCAN_EVERY; scanThreats(c); autoSellNearVendor(c); taxiDiscover(c); if (r.equipLater && !threatsOf(c).length) autoEquip(c); }
  const threats = typeof groupOf === 'function' && groupOf(c) ? groupThreats(c) : threatsOf(c); r.threats = threats;
  if (typeof meterTick === 'function' && isActive(c)) meterTick(c);
  if (threats.length && !r.inFight) { r.fightStart = G.gameTime; masteryFightRoll(c); } r.inFight = threats.length > 0;
  const dg = threats.filter((m) => dangerous(m, c) && !(r.killM && m === r.killM && c.order && c.order.type === 'kill'));      // the one the player ordered killed: no running away from it
  if (dg.length) { fleeStep(c, dt, dg); return; }
  if (c.pet || c.cls === 9) petStep(c, dt);
  if (r.party) { partyStep(c, dt); if (r.partyQ) groupQuestPartyStep(c, threats); }
  if (r.cast && castStep(c, dt)) { if (threats.length && (!r.tgt || r.tgt.st === 'dead')) r.tgt = threats[0]; return; }
  if (r.fleeing) { r.fleeing = null; r.mv = null; const o = c.order; if (o && o.type === 'travel') replanTravel(c, o); }
  if (r.tame && threats.length && typeof petTameFight === 'function' && petTameFight(c)) return;     // the beast being tamed attacks: keep taming
  if (threats.length && groupOf(c)) {
    r.tgt = groupPickTarget(c, threats, r.tgt); r.mv = null;
    if (!(typeof tacActive === 'function' && tacActive(c)) && groupHealStep(c)) return;          // with tactics the heals are in the tactics
    // a dungeon: the tank pulls - the others hold back two seconds (unless it is on them) so it gets the creatures first
    if (r.tgt && r.tgt.tgt !== c && grpRole(c) !== 'tank' && isDungeonMap(c.pos.map) && G.gameTime - (r.tgt.engT || 0) < 2 && groupChars(groupOf(c)).some((o) => o !== c && grpRole(o) === 'tank')) return;
    if (r.tgt) { fightStep(c, r.tgt, dt); return; }
  }
  if (threats.length) {
    if (!r.tgt || r.tgt.st !== 'chase' || r.tgt.tgt !== c) {
      let b = null, bd = 1e18; for (const m of threats) { const d = Math.hypot(m.x - c.pos.x, m.y - c.pos.y); if (d < bd) { bd = d; b = m; } }
      r.tgt = b;
    }
    r.mv = null; fightStep(c, r.tgt, dt); return;
  }
  if (r.interact) { if (interactStep(c, dt)) return; }
  if (typeof craftStep === 'function' && craftStep(c, dt)) return;             // crafting (each item takes its time)
  if (typeof deQueueStep === 'function' && deQueueStep(c)) return;             // disenchanting what was chosen (before resting)
  if (typeof consumablesOoc === 'function' && consumablesOoc(c)) return;
  if (groupOf(c) && groupHealStep(c)) return;               // a group healer tops everyone up
  if (restStep(c)) return;
  if ((c.cls === 3 || c.cls === 9) && typeof petOoc === 'function' && petOoc(c, dt)) return;      // taming, feeding the pet, Demonic Sacrifice
  if (c.cls !== 1 && oocStep(c)) return;
  if (c.prof && profStep(c)) return;
  const o = c.order;
  if (!o) { if (c.farm && c.farm.idle && typeof farmIdle === 'function') farmIdle(c); return; }          // farm.js: materials when idle
  if (typeof groupHold === 'function' && groupHold(c, o)) return;      // the leader waits for the group
  if (o.type === 'travel') {
    if (o.cross && typeof travelCross === 'function') { const st = travelCross(c, o); if (st !== 'done') return; }
    const done = advance(c, o, dt);
    if (o.blocked) { log('Route blocked by dangerous creatures - travel cancelled.'); c.order = null; save(); renderOrder(); }
    else if (done) { log('Arrived at ' + o.label + '.'); c.order = null; save(); renderOrder(); }
  } else if (o.type === 'grind') updateGrind(c, o, dt);
  else if (o.type === 'quest') updateQuest(c, o, dt);
  else if (o.type === 'questing') updateQuesting(c, o, dt);
  else if (o.type === 'leveling') updateLeveling(c, o, dt);
  else if (o.type === 'vendor' || o.type === 'sell') updateVendor(c, o, dt);
  else if (o.type === 'trainer') updateTrainer(c, o, dt);
  else if (o.type === 'npc') updateNpcOrder(c, o);
  else if (o.type === 'follow') updateFollow(c, o, dt);
  else if (o.type === 'fish') updateFishing(c, o, dt);
  else if (o.type === 'patrol') updatePatrol(c, o, dt);
  else if (o.type === 'dungeon') updateDungeon(c, o, dt);
  else if (o.type === 'farm') updateFarm(c, o, dt);
  else if (o.type === 'kill') updateKill(c, o);
}
function replanTravel(c, o) {
  if (o.cross) return;
  const p = planPath(c, o.target); o.path = p.pts; o.idx = 1; o.total = o.done + p.total; o.replan = false;
}

