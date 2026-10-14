'use strict';
/* group.js - your own characters as a group: invite alts, give them a role (tank, healer, damage), they follow the
   leader in a formation and fight with it. Quest mode: they take the leader's quests, kills count for everyone (in
   range), quest drops and quest objects are each member's own, and the leader moves on only when every member is
   done with the current objective. The whole group is in the world as long as one of them is played or running. */

const GROUP_MAX = 5;
const FORMATIONS = { column: 'Column (in a line behind)', line: 'Line (side by side behind)', wedge: 'Wedge (V behind)', circle: 'Circle (around the leader)' };
const ROLE_NAMES = { tank: 'Tank', healer: 'Healer', dps: 'Damage' };
const GROUP_RANGE = 100;           // kills, quest sharing and turn-ins count within this distance of the leader

function groups() { G.state.groups = G.state.groups || []; return G.state.groups; }
function charById(id) { return G.state.characters.find((c) => c.id === id) || null; }
/* the group a character is in (only groups with 2+ members count) */
function groupOf(c) {
  if (!c || !G.state || !G.state.groups) return null;
  for (const g of G.state.groups) if (g.members.length > 1 && g.members.some((m) => m.id === c.id)) return g;
  return null;
}
function groupLeader(g) { return charById(g.leader); }
function groupChars(g) { return g.members.map((m) => charById(m.id)).filter(Boolean); }
function grpRole(c) { const g = groupOf(c); const m = g && g.members.find((x) => x.id === c.id); return m ? m.role : null; }
function isLeader(c) { const g = groupOf(c); return !!(g && g.leader === c.id); }
function sameGroup(a, b) { const g = groupOf(a); return !!(g && b && g.members.some((m) => m.id === b.id)); }
/* members near this character (same map, within range), not counting it */
function groupNear(c, range) { const g = groupOf(c); if (!g) return []; return groupChars(g).filter((o) => o !== c && o.pos.map === c.pos.map && !rt(o).ghost && Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) <= (range || GROUP_RANGE)); }
function withLog(c, fn) { const p = G.logCtx; G.logCtx = c; try { return fn(); } finally { G.logCtx = p; } }
function defaultRole(c) { return [5].includes(c.cls) ? 'healer' : c.cls === 1 || (c.cls === 11 && c.level >= 10) ? 'tank' : 'dps'; }

/* ------------------------------------------------------------------ forming the group */
function groupInvite(leader, alt) {
  if (!leader || !alt || leader === alt) return;
  if (groupOf(alt)) { log(alt.name + ' is already in a group.'); return; }
  let g = groupOf(leader) || groups().find((x) => x.leader === leader.id);
  if (!g) { g = { id: 'g' + Date.now().toString(36), leader: leader.id, members: [{ id: leader.id, role: defaultRole(leader) }], questMode: true, formation: 'wedge', dist: 4 }; groups().push(g); }
  if (g.members.length >= GROUP_MAX) { log('The group is full (5).'); return; }
  g.members.push({ id: alt.id, role: defaultRole(alt) });
  alt.order = { type: 'follow', label: leader.name, resume: alt.order && alt.order.type !== 'follow' ? alt.order : null };
  rt(alt).mv = null; rt(alt).tgt = null;
  log(alt.name + ' joins the group (' + ROLE_NAMES[g.members[g.members.length - 1].role] + ').'); withLog(alt, () => log('Joined ' + leader.name + "'s group."));
  save(); renderGroup(); renderCharSwitch(true);
}
function groupLeave(c, quiet) {
  const g = groupOf(c) || groups().find((x) => x.members.some((m) => m.id === c.id)); if (!g) return;
  g.members = g.members.filter((m) => m.id !== c.id);
  if (c.order && c.order.type === 'follow') c.order = null;
  rt(c).mv = null; rt(c).tgt = null;
  if (g.leader === c.id && g.members.length) { g.leader = g.members[0].id; const L = charById(g.leader); if (L && L.order && L.order.type === 'follow') L.order = null; if (!quiet) log((L ? L.name : 'Someone') + ' leads the group now.'); }
  if (g.members.length < 2) groupDisband(g, true);
  if (!quiet) log(c.name + ' left the group.');
  save(); renderGroup();
}
function groupDisband(g, quiet) {
  for (const m of g.members) { const c = charById(m.id); if (c && c.order && c.order.type === 'follow') c.order = null; if (c) { rt(c).mv = null; rt(c).tgt = null; } }
  G.state.groups = groups().filter((x) => x !== g);
  if (!quiet) log('The group is disbanded.');
  save(); renderGroup(); renderCharSwitch(true);
}
function groupPromote(c) { const g = groupOf(c); if (!g || g.leader === c.id) return; const old = groupLeader(g); g.leader = c.id; if (c.order && c.order.type === 'follow') c.order = null; if (old) old.order = { type: 'follow', label: c.name }; log(c.name + ' leads the group now.'); save(); renderGroup(); }

/* ------------------------------------------------------------------ following */
/* the spot of member k (0..) behind / around the leader: forward = the way the leader faces */
function formationSlot(g, L, c) {
  const others = g.members.filter((m) => m.id !== L.id); const k = Math.max(0, others.findIndex((m) => m.id === c.id)); const n = others.length;
  const D = Math.max(1.5, g.dist || 4); const o = L.pos.o || 0; const fx = Math.sin(o), fy = Math.cos(o), sx = Math.cos(o), sy = -Math.sin(o);
  let f = 0, s = 0;
  if (g.formation === 'column') { f = -D * (k + 1); }
  else if (g.formation === 'line') { f = -D; s = (k - (n - 1) / 2) * D; }
  else if (g.formation === 'circle') { const a = (k + 0.5) / n * Math.PI * 2; f = Math.cos(a) * D; s = Math.sin(a) * D; }
  else { const row = Math.floor(k / 2) + 1; f = -D * row; s = (k % 2 ? -1 : 1) * D * row * 0.8; }
  return { x: L.pos.x + fx * f + sx * s, y: L.pos.y + fy * f + sy * s };
}
function updateFollow(c, o, dt) {
  const g = groupOf(c); const L = g && groupLeader(g);
  if (!L || L === c) { c.order = o.resume || null; renderOrder(); return; }
  const r = rt(c); const lr = rt(L);
  if (lr.flying || lr.riding) { r.mv = null; return; }                          // on the same flight / boat: wait for the landing
  const d = L.pos.map === c.pos.map ? Math.hypot(L.pos.x - c.pos.x, L.pos.y - c.pos.y) : Infinity;
  if (d > 350 || L.pos.map !== c.pos.map) {
    // far away (another zone, a dungeon, a flight): catch up
    const a = Math.random() * 6.3; c.pos = { map: L.pos.map, x: L.pos.x + Math.cos(a) * 2, y: L.pos.y + Math.sin(a) * 2, z: L.pos.z, o: L.pos.o };
    r.mv = null; r.tgt = null; ensureWorld(c.pos.map); log('Caught up with ' + L.name + '.'); return;
  }
  if (g.questMode && memberQuestWork(c, L, o, dt)) return;
  const s = formationSlot(g, L, c); const ds = Math.hypot(s.x - c.pos.x, s.y - c.pos.y);
  o.where = 'following ' + L.name;
  if (ds > 1.2) { goTo(c, s.x, s.y, 0.8); if (r.blocked) { r.blocked = false; r.mv = null; } }
  else { c.pos.o = L.pos.o; }
}
function followText(c, o) { const g = groupOf(c); const L = g && groupLeader(g); return { t: 'In ' + (L ? L.name + "'s" : 'a') + ' group (' + ROLE_NAMES[grpRole(c) || 'dps'] + ')', d: o.where || 'following' }; }
/* the leader waits for the group: someone dead, resting, or left behind */
function groupHold(c, o) {
  if (!isLeader(c) || !o || o.type === 'follow') return false; const g = groupOf(c); const r = rt(c);
  if (r.threats && r.threats.length) return false;
  const tripping = (o.trip && o.trip.legs && o.trip.legs[o.trip.i] && o.trip.legs[o.trip.i].kind !== 'walk') || (o.mode === 'travel');
  for (const m of groupChars(g)) {
    if (m === c) continue; const mr = rt(m);
    if (mr.ghost || m.hp <= 0) { o.where = 'waiting for ' + m.name + ' (dead)'; r.mv = null; return true; }
    if (m.pos.map !== c.pos.map) continue;
    const d = Math.hypot(m.pos.x - c.pos.x, m.pos.y - c.pos.y);
    if (mr.resting || mr.interact || mr.bandage) { o.where = 'waiting for ' + m.name + (mr.resting ? ' (resting)' : ''); r.mv = null; return true; }
    if (!tripping && d > 45 && d < 350) { o.where = 'waiting for ' + m.name + ' to catch up'; r.mv = null; return true; }
  }
  return false;
}

/* ------------------------------------------------------------------ fighting together */
/* everything that fights the group near this character */
function groupThreats(c) {
  const g = groupOf(c); const W = G.world[c.pos.map]; if (!W || !g) return threatsOf(c);
  const ids = new Set(g.members.map((m) => m.id)); const out = [];
  for (const m of W.active) if (m.st === 'chase' && m.tgt && ids.has(m.tgt.id) && Math.hypot(m.x - c.pos.x, m.y - c.pos.y) < 60) out.push(m);
  return out;
}
/* whom a member attacks: the tank takes what hits the others, the rest help the leader */
function groupPickTarget(c, threats, cur) {
  const g = groupOf(c); const role = grpRole(c); const L = groupLeader(g);
  const alive = (m) => m && m.st === 'chase' && threats.includes(m);
  const near = (list) => list.slice().sort((a, b) => Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y))[0];
  if (role === 'tank') {
    const loose = threats.filter((m) => m.tgt !== c);
    if (loose.length) { const m = near(loose); groupTaunt(c, m); return m; }
    return alive(cur) ? cur : near(threats);
  }
  if (L && L !== c) { const lt = rt(L).tgt; if (alive(lt)) return lt; }
  if (alive(cur)) return cur;
  const healerHit = threats.filter((m) => m.tgt && grpRole(m.tgt) === 'healer');
  return near(healerHit.length ? healerHit : threats);
}
/* Taunt (warrior, defensive stance) or Growl (bear): the creature turns to the tank */
function groupTaunt(c, m) {
  const r = rt(c); const n = c.cls === 1 ? 'Taunt' : c.cls === 11 && c.form === 'bear' ? 'Growl' : null; if (!n || !m || m.tgt === c) return;
  if ((r.cd[n] || 0) > G.gameTime || Math.hypot(m.x - c.pos.x, m.y - c.pos.y) > 20) return;
  if (n === 'Taunt' && !(c.known && c.known.Taunt)) return;
  m.cThr = m.cThr || {}; const top = Math.max(0, ...Object.values(m.cThr)); m.cThr[c.id] = top * 1.1 + 10; m.tgt = c; m.charThreat = m.cThr[c.id];
  r.cd[n] = G.gameTime + 10; fx(c.pos.x, c.pos.y, n, '#9fc7ff');
}
/* healers in a group heal whoever needs it most (themselves included) */
const GROUP_HEALS = { 5: [['Flash Heal', 0.4], ['Lesser Heal', 1], ['Heal', 1], ['Greater Heal', 1]], 2: [['Flash of Light', 0.45], ['Holy Light', 1]], 7: [['Lesser Healing Wave', 0.45], ['Healing Wave', 1]], 11: [['Regrowth', 0.5], ['Healing Touch', 1]] };
function groupHealStep(c) {
  if (grpRole(c) !== 'healer' || !GROUP_HEALS[c.cls]) return false; const r = rt(c); if (r.cast || (r.gcdUntil || 0) > G.gameTime) return false;
  if (c.cls === 11 && c.form) return false;
  let tgt = null, low = 0.72;
  for (const o of [c].concat(groupNear(c, 40))) { const p = o.hp / charStats(o).maxHp; const lim = grpRole(o) === 'tank' ? 0.82 : 0.72; if (p < lim && p - (lim - 0.72) < low) { low = p - (lim - 0.72); tgt = o; } }
  if (!tgt) return false;
  const pct = tgt.hp / charStats(tgt).maxHp; let pick = null;
  for (const [n, below] of GROUP_HEALS[c.cls]) { if (!c.known[n] || pct > below) continue; const u = abilityUsable(c, n); if (!u.ok) continue; const [pt, cost] = spellCost(c, u.sp, n); if (powerOf(c, pt) < cost) continue; pick = { n, sp: u.sp }; if (below < 1) break; }
  if (!pick) return false;
  r.healOn = tgt; startCast(c, pick.n, pick.sp, c); masteryAfterAction(c); return true;
}
/* a heal that lands on another character (from healSelf) */
/* a creature whose target died or left: on to the group member it hates most (near), else it gives up */
function mobRetarget(m, W) {
  const c = m.tgt; if (!c || !m.cThr) return null; const g = groupOf(c); if (!g) return null; let best = null, bv = -1;
  for (const o of groupChars(g)) { if (o.hp <= 0 || rt(o).ghost || rt(o).flying || o.pos.map !== W.id || Math.hypot(o.pos.x - m.x, o.pos.y - m.y) > 60) continue; const v = m.cThr[o.id] || 0; if (v > bv) { bv = v; best = o; } }
  return best;
}
function healOther(c, to, v, label) {
  const s = charStats(to); const before = to.hp; to.hp = Math.min(s.maxHp, to.hp + v); const got = to.hp - before;
  fx(to.pos.x, to.pos.y, '+' + Math.round(got), '#5ee07a'); meterHeal(c, got, label || 'Heal');
  // healing draws the attention of what fights the group
  const th = groupThreats(c); for (const m of th) addThreat(m, c, got * 0.5 / th.length);
  return v;
}

/* ------------------------------------------------------------------ quest mode */
function questGroup(c) { const g = groupOf(c); return g && g.questMode && g.leader === c.id ? groupChars(g).filter((m) => m !== c) : []; }
/* done for the whole group: the leader moves on only when everyone who has the quest is done with it */
function gObjDone(c, q, i) { if (!objDone(c, q, i)) return false; for (const m of questGroup(c)) if (m.quests[q.id] && !objDone(m, q, i)) return false; return true; }
function gQuestDone(c, q) { if (!questDone(c, q)) return false; for (const m of questGroup(c)) if (m.quests[q.id] && !questDone(m, q)) return false; return true; }
/* an objective each one has to do with their own hands (objects, using an item on someone) */
function ownHandsObjective(q, i, c) {
  const ob = q.objectives[i]; if (ob.type === 'Use/Interact') return true;
  if (ob.type === 'Kill') { if (ob.id < 0) return true; const b = c ? behOf({ e: ob.id }, c) : 'A'; return b === 'F' || b === 'X'; }      // using something on a friendly one (peons, wounded...)
  if (ob.type === 'Collect') return !!(G.q.goSrc[ob.id] && G.q.goSrc[ob.id].length);                                                   // picked up from objects
  return false;
}
/* the leader took a quest: everyone near who can take it, takes it too */
function groupShareQuest(c, q) {
  for (const m of questGroup(c)) { if (Math.hypot(m.pos.x - c.pos.x, m.pos.y - c.pos.y) > GROUP_RANGE || m.pos.map !== c.pos.map) continue; if (!m.quests[q.id] && questAvailable(m, q)) withLog(m, () => acceptQuest(m, q)); }
}
function groupTurnIn(c, q) {
  for (const m of questGroup(c)) { if (m.pos.map !== c.pos.map || Math.hypot(m.pos.x - c.pos.x, m.pos.y - c.pos.y) > 40) continue; if (m.quests[q.id] && questDone(m, q)) withLog(m, () => turnInQuest(m, q)); }
}
/* a member does its own part of the leader's current objective (objects, items used on someone) */
function memberQuestWork(c, L, o, dt) {
  const lo = L.order; const w = lo && lo.wobj; if (!w) return false;
  const q = G.q.byId[w[0]]; const i = w[1]; if (!q || !c.quests[q.id] || objDone(c, q, i) || !ownHandsObjective(q, i, c)) return false;
  if ((rt(L).threats || []).length) return false;
  o.qw = o.qw || {}; const st = workObjective(c, q, i, o.qw);
  o.where = 'doing my part: ' + (o.qw.where || q.objectives[i].name);
  return st === 'busy';
}
/* kills: the creature counts for everyone in the group near the leader (experience is shared, like the game) */
const GROUP_XP_BONUS = [1, 1, 1, 1.166, 1.3, 1.4];
function groupKill(c, m, W) {
  const g = groupOf(c); const near = groupChars(g).filter((o) => o.pos.map === c.pos.map && !rt(o).ghost && o.hp > 0 && Math.hypot(o.pos.x - m.x, o.pos.y - m.y) <= GROUP_RANGE);
  if (!near.includes(c)) near.push(c);
  const sum = near.reduce((s, o) => s + o.level, 0); const bonus = GROUP_XP_BONUS[Math.min(5, near.length)];
  g.rr = ((g.rr || 0) + 1) % near.length; const looter = near[g.rr];
  for (const o of near) withLog(o, () => {
    const xp = Math.round(killXp(o, m) * o.level / sum * bonus); gainXp(o, xp);
    log((m.info ? m.info[1] : 'creature') + ' (lvl ' + m.lvl + ') slain' + (o !== c ? ' by ' + c.name : '') + (xp ? ', +' + xp + ' xp' : '') + '.');
    lootMob(o, m, o !== looter);            // one gets the loot (in turns), the others only their own quest drops
    onKill(o, m); if (o.prof && o === looter) onKillProf(o, m);
    if (o !== c) { if (!isDungeonMap(o.pos.map)) masteryKill(o, m); const ro = rt(o); if (ro.tgt === m) ro.tgt = null; }
  });
}

/* ------------------------------------------------------------------ the group card */
function renderGroup() {
  const el = $('groupCard'); if (!el) return; const c = active(); const g = groupOf(c) || groups().find((x) => x.members.some((m) => m.id === c.id));
  const alts = G.state.characters.filter((x) => x !== c && !groupOf(x));
  let h = '<h3>Group</h3>';
  if (!g) {
    h += alts.length ? '<div class="grp-inv"><select id="grpAlt">' + alts.map((a) => '<option value="' + a.id + '">' + esc(a.name) + ' (' + a.level + ' ' + CLASS_NAMES[a.cls] + ')</option>').join('') + '</select><button class="act" data-ginv="1">Invite</button></div><div class="small muted">Your other characters join you, follow you and fight with you.</div>'
      : '<div class="small muted">Make another character to group with (Characters - New).</div>';
    el.innerHTML = h; return;
  }
  const L = groupLeader(g);
  for (const m of g.members) {
    const x = charById(m.id); if (!x) continue; const s = charStats(x); const xr = rt(x);
    const st = xr.ghost ? 'dead' : xr.threats && xr.threats.length ? 'fighting' : xr.resting ? 'resting' : x.id === g.leader ? 'leading' : 'following';
    h += '<div class="grp-m' + (x === c ? ' me' : '') + '"><div class="grp-top"><span class="grp-n" style="color:' + CLASS_COLOR[x.cls] + '">' + (x.id === g.leader ? '&#9813; ' : '') + esc(x.name) + '</span><span class="small muted">' + x.level + ' &middot; ' + st + '</span>' +
      '<select data-grole="' + x.id + '">' + Object.keys(ROLE_NAMES).map((k) => '<option value="' + k + '"' + (m.role === k ? ' selected' : '') + '>' + ROLE_NAMES[k] + '</option>').join('') + '</select>' +
      (x.id !== g.leader ? '<button class="mini" data-glead="' + x.id + '" title="Make leader">&#9813;</button>' : '') + '<button class="mini" data-gkick="' + x.id + '" title="Remove from the group">&#10005;</button></div>' +
      '<div class="grp-bars"><i class="hp" style="width:' + Math.max(0, 100 * x.hp / s.maxHp) + '%"></i></div>' + (usesMana(x) && s.maxMana ? '<div class="grp-bars mp"><i style="width:' + 100 * x.mana / s.maxMana + '%"></i></div>' : '') + '</div>';
  }
  if (alts.length && g.members.length < GROUP_MAX) h += '<div class="grp-inv"><select id="grpAlt">' + alts.map((a) => '<option value="' + a.id + '">' + esc(a.name) + ' (' + a.level + ' ' + CLASS_NAMES[a.cls] + ')</option>').join('') + '</select><button class="mini" data-ginv="1">Invite</button></div>';
  h += '<label class="chk"><input type="checkbox" data-gq="1"' + (g.questMode ? ' checked' : '') + '> Quest mode - do what the leader does (quests, grinding); the leader goes on only when everyone is done with the objective</label>' +
    '<div class="rgrid"><label>Formation</label><select data-gform="1">' + Object.keys(FORMATIONS).map((k) => '<option value="' + k + '"' + (g.formation === k ? ' selected' : '') + '>' + FORMATIONS[k] + '</option>').join('') + '</select>' +
    '<label>Follow distance</label><span><input type="number" data-gdist="1" min="1" max="20" step="1" value="' + (g.dist || 4) + '"> yards</span></div>' +
    (c.id !== g.leader && !(c.order && c.order.type === 'follow') ? '<button class="mini" data-gfollow="1">Follow ' + esc(L ? L.name : 'the leader') + ' again</button> ' : '') +
    '<button class="mini red" data-gdis="1">Disband</button>';
  el.innerHTML = h;
}
function bindGroupCard() {
  const el = $('groupCard'); if (!el) return;
  el.onclick = (e) => {
    const c = active(); const g = groupOf(c); const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.ginv) { const a = charById($('grpAlt').value); if (a) groupInvite(g ? groupLeader(g) : c, a); }
    else if (d.gkick) { const x = charById(d.gkick); if (x) groupLeave(x); }
    else if (d.glead) { const x = charById(d.glead); if (x) groupPromote(x); }
    else if (d.gdis && g) { groupDisband(g); }
    else if (d.gfollow && g) { c.order = { type: 'follow', label: (groupLeader(g) || {}).name }; rt(c).mv = null; save(); renderOrder(); }
    renderGroup();
  };
  el.onchange = (e) => {
    const c = active(); const g = groupOf(c); if (!g) return; const t = e.target;
    if (t.dataset.grole) { const m = g.members.find((x) => x.id === t.dataset.grole); if (m) m.role = t.value; }
    else if (t.dataset.gq) g.questMode = t.checked;
    else if (t.dataset.gform) g.formation = t.value;
    else if (t.dataset.gdist) g.dist = Math.max(1, Math.min(20, +t.value || 4));
    save(); renderGroup();
  };
}
