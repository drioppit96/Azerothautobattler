'use strict';
/* groupquest.js - group quests out in the world (quest type "Group" in the database, or objectives that only elite
   creatures give): as a player would, the character looks for a group for them - its own characters when they are
   grouped with it, else mercenaries hired from the same roster as the dungeon groups (mastery.js), half the dungeon fee.
   The group comes along while the quest's objectives are open, fights the elites with it (the tank takes them, the healer
   heals; partyStep in dungeons.js plays them) and leaves when the objectives are done, the character goes elsewhere or
   works on other things for a long time. Alone the character still does them once it is well above their level. */

const GQ_LFG_TIME = 20;            // seconds of "looking for a group" before the group is there
const GQ_IDLE_LIMIT = 300;         // seconds of working on other things before the hired group leaves

/* a quest for a group: the database says so, or only elite creatures give its objectives */
function questIsGroup(q) { return q.type === 1 || !!questMeta(q).elite; }
/* the level of the elites (with +3 for rare elites and bosses), 0 when there are none */
function groupQuestElite(q) { const m = questMeta(q); return m.elite || (q.type === 1 ? q.level : 0); }        // a group quest without elites: its own level
/* how many players it wants: the suggested number, else by how far above the character the elites are */
function groupQuestSize(c, q) {
  const e = groupQuestElite(q); const diff = e - c.level;
  const n = diff >= 3 ? 5 : diff >= 0 ? 4 : 3;
  return Math.max(2, Math.min(5, Math.max(q.sugg || 0, n)));
}
/* the character can take it on: alone when well above it, with a group from 3 levels below the elites */
function groupQuestOk(c, q) {
  const e = groupQuestElite(q); if (!e || c.level >= e + 3) return true;
  if (cset(c, 'groupQuests') === false) return false;
  return c.level >= Math.max(8, e - 3);
}
/* needs a group right now (null = alone is fine) */
function groupQuestNeed(c, q) {
  const e = groupQuestElite(q); if (!e || c.level >= e + 3 || cset(c, 'groupQuests') === false) return 0;
  return groupQuestSize(c, q);
}
function groupQuestText(c, q) {
  const n = groupQuestNeed(c, q); const e = groupQuestElite(q);
  if (!e) return 'Group quest' + (q.sugg ? ' (' + q.sugg + ' players)' : '') + '.';
  if (!n) return 'Group quest - you are strong enough to do it alone now.';
  if (!groupQuestOk(c, q)) return 'Group quest - elites of level ' + e + '; with a group from level ' + Math.max(8, e - 3) + (cset(c, 'groupQuests') === false ? ' (group quests are switched off in Automation)' : '') + '.';
  return 'Group quest - elites of level ' + e + ': a group of ' + n + ' is formed for it.';
}
/* fights the character takes on because a group is with it */
function groupFights(c, m) {
  if (fightersWith(c) < 2 || (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map))) return false;
  return m.lvl <= c.level + (m.rank === 3 ? 1 : 3);
}
/* hostile elites close by (the group quest's area) */
function gqElitesNear(c, R) {
  let n = 0; mobsNear(ensureWorld(c.pos.map), c.pos.x, c.pos.y, R, (m) => { if (!n && m.st === 'alive' && m.rank >= 1 && m.lvl >= c.level - 2 && behOf(m, c) === 'A') n = 1; });
  return n > 0;
}
/* own characters grouped with this one and close by */
function gqOwnNear(c) { return typeof groupNear === 'function' ? groupNear(c, 200).length : 0; }

/* before working on an objective of q: true = go on; false = still forming the group (stand by) */
function groupQuestReady(c, q, o) {
  const need = groupQuestNeed(c, q); const r = rt(c);
  if (!need) return true;
  if (r.party && r.party.length) { if (r.partyQ) { r.partyQ.q = q.id; r.partyQ.t = G.gameTime; } return true; }
  const own = gqOwnNear(c); const hire = need - 1 - own;
  if (hire <= 0) return true;                                // own characters are enough
  if (!o.lfg || o.lfg.q !== q.id) { o.lfg = { q: q.id, t: G.gameTime }; log('"' + q.title + '" is a group quest - looking for a group of ' + need + '.'); }
  o.where = 'looking for a group (' + need + ' players) for "' + q.title + '"'; r.mv = null;
  if (G.gameTime - o.lfg.t < GQ_LFG_TIME) return false;
  // the group's size in all (partyPlan leaves out the roles of the own characters in the group, near or not)
  const g = typeof groupOf === 'function' ? groupOf(c) : null;
  o.lfg = null; gqHire(c, q, g ? need + Math.max(0, g.members.length - 1 - own) : hire + 1);
  return true;
}
function gqHire(c, q, players) {
  const d = { players, map: null, name: q.title, feeMul: 0.5 };
  const keep = G.dgPlan; G.dgPlan = null;
  makeParty(c, d); G.dgPlan = keep;
  const r = rt(c); r.partyQ = { q: q.id, map: c.pos.map, t: G.gameTime, since: G.gameTime };
  log((r.party || []).map((u) => u.name + ' (' + u.role + ')').join(', ') + ' join' + ((r.party || []).length === 1 ? 's' : '') + ' you for "' + q.title + '".');
  save();
}
function gqDismiss(c, why) {
  const r = rt(c); if (!r.party) { r.partyQ = null; return; }
  for (const u of r.party) { const m = rosterById(u.rid); if (m) m.runs = (m.runs || 0) + 1; }
  r.party = null; r.partyQ = null; for (const m of threatsOf(c)) if (m.gThr) m.gThr = null;
  log('The group leaves' + (why ? ' (' + why + ')' : '') + '.');
  if (typeof renderUnitFrames === 'function') try { renderUnitFrames(); } catch (e) { /* */ }
}
/* every step with a hired quest group: keep it close, send it home when it is no longer needed */
function groupQuestPartyStep(c, threats) {
  const r = rt(c); const pq = r.partyQ; if (!pq) return;
  if (typeof isDungeonMap === 'function' && isDungeonMap(c.pos.map)) { r.partyQ = null; return; }       // a dungeon group took over
  if (threats && threats.length) return;
  const q = G.q.byId[pq.q];
  if (c.pos.map !== pq.map) return gqDismiss(c, 'you left the area');
  if (!q || !c.quests[q.id]) return gqDismiss(c, q ? '"' + q.title + '" is no longer in the quest log' : '');
  if (gQuestDone(c, q)) {
    // done: the group stays until the character is out of the elites' area (it would walk out alone past them)
    pq.doneAt = pq.doneAt || G.gameTime;
    if (G.gameTime - pq.doneAt < 300 && gqElitesNear(c, 90)) return;
    return gqDismiss(c, '"' + q.title + '" is done');
  }
  const o = c.order; const auto = o && ['quest', 'questing', 'leveling'].includes(o.type);
  if (!auto) return gqDismiss(c, 'no more questing');
  if (o.wobj && o.wobj[0] === q.id) pq.t = G.gameTime;
  if (G.gameTime - pq.t > GQ_IDLE_LIMIT) return gqDismiss(c, 'you went on with other things');
  // far behind (a flight, a long run): they catch up
  for (const u of r.party) if (!u.dead && Math.hypot(u.x - c.pos.x, u.y - c.pos.y) > 120) { u.x = c.pos.x + (Math.random() - 0.5) * 6; u.y = c.pos.y + (Math.random() - 0.5) * 6; }
}
