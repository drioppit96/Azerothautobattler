'use strict';
/* mastery.js - experience as a player, not as a character.
   Skill (0-10): how well someone plays their class anywhere - reaction time, pressing the right button, using
     cooldowns at the right moment. Grows very slowly (the game is hard to master): a character that levels to 60 with
     some dungeons on the way ends up around 2.
   Knowledge (0-10, per dungeon or raid, and per boss): knowing the place - the route, which packs to leave alone,
     when to wait. Grows with every run, faster from wipes than from easy kills.
   Execution (the rotation) is mostly skill, a little knowledge. Awareness (pulls, positioning) is mostly knowledge.
   The hired companions have the same values (a roster you hire from, for a fee that grows with their experience). */

const SKILL_K = 800, INST_K = 14, BOSS_K = 6;
const ROLE_CLASSES = { tank: [1, 1, 1, 2, 11], healer: [5, 5, 2, 7, 11], dps: [4, 8, 9, 3, 1, 4, 8, 9, 3, 7, 11, 5] };
const ROSTER_NAMES = ['Garrick', 'Mira', 'Tolvar', 'Selene', 'Brann', 'Kaela', 'Dorn', 'Ysra', 'Halvar', 'Nessa', 'Borik', 'Lyra', 'Thane', 'Iris', 'Korg', 'Vela', 'Rurik', 'Sana', 'Ulric', 'Fenna',
  'Grok', 'Zaela', 'Morn', 'Talia', 'Brom', 'Esk', 'Jorn', 'Lina', 'Varok', 'Tessa', 'Hagan', 'Ria', 'Doran', 'Pell', 'Krell', 'Aria', 'Stig', 'Neve', 'Orin', 'Kaz', 'Mael', 'Saro', 'Bel', 'Tyra', 'Gunn', 'Wren', 'Ozzi', 'Lomar'];

function masteryOf(o) { if (!o.mastery) o.mastery = { pts: 0, inst: {} }; return o.mastery; }
function curve(pts, k) { return 10 * (1 - Math.exp(-Math.max(0, pts) / k)); }
function skillLevel(o) { return curve(masteryOf(o).pts, SKILL_K) * (o.apt || 1); }
function instRec(o, map) { const m = masteryOf(o); return (m.inst[map] = m.inst[map] || { pts: 0, runs: 0, clears: 0, wipes: 0, best: 0, boss: {} }); }
function instLevel(o, map) { const i = masteryOf(o).inst[map]; return i ? curve(i.pts, INST_K) : 0; }
function bossLevel(o, map, e) { const i = masteryOf(o).inst[map]; const b = i && i.boss[e]; return b ? curve(b, BOSS_K) : 0; }
/* what the numbers do: execution (rotation) and awareness (pulls, staying alive) */
function execLevel(o, map) { const s = skillLevel(o); return map != null && isDungeonMap(map) ? 0.75 * s + 0.25 * instLevel(o, map) : s; }
function awareLevel(o, map) { const s = skillLevel(o); return map != null && isDungeonMap(map) ? 0.3 * s + 0.7 * instLevel(o, map) : s; }
function charExec(c) { const r = rt(c); if (!r.mEx || G.gameTime - r.mEx.t > 5 || r.mEx.map !== c.pos.map) r.mEx = { t: G.gameTime, map: c.pos.map, e: execLevel(c, c.pos.map), a: awareLevel(c, c.pos.map) }; return r.mEx.e; }
function charAware(c) { charExec(c); return rt(c).mEx.a; }
function gainSkill(o, v) { masteryOf(o).pts += v; }
function gainInst(o, map, v, boss) { const i = instRec(o, map); i.pts += v; if (boss) i.boss[boss] = (i.boss[boss] || 0) + (v > 0 ? 2 : 0); }

/* ------------------------------------------------------------------ the character's play */
/* after each action: maybe a moment of hesitation before the next one (a veteran hardly ever) */
function masteryAfterAction(c) {
  const e = charExec(c) / 10; const r = rt(c); const k = isDungeonMap(c.pos.map) ? 1 : 0.5;          // questing alone is easier than a group fight
  if (Math.random() < 0.02 + 0.55 * k * Math.pow(1 - e, 1.4)) r.hesUntil = G.gameTime + 0.12 + Math.random() * (0.15 + 1.5 * (1 - e));
}
function masteryHesitating(c) { return (rt(c).hesUntil || 0) > G.gameTime; }
/* pressing the wrong button: the rule is skipped and something lower in the list happens instead */
function masteryFumble(c) { const e = charExec(c) / 10; const k = isDungeonMap(c.pos.map) ? 1 : 0.5; return Math.random() < 0.004 + 0.1 * k * Math.pow(1 - e, 1.3); }
/* at the start of each fight: how late the emergency buttons come, whether the big cooldowns get wasted on trash */
function masteryFightRoll(c) {
  const e = charExec(c) / 10; const r = rt(c);
  r.mLate = 1 - 0.45 * (1 - e) * Math.random();          // emergency thresholds x this (1 = on time)
  r.mWaste = Math.random() < 0.35 * (1 - e);              // "only against elites" cooldowns used on anything
}
function masteryLate(c) { return rt(c).mLate || 1; }
/* careless groups walk closer to packs (more aggro range) - only inside dungeons, where it counts */
function masteryAggro(c) { if (!isDungeonMap(c.pos.map)) return 1; return 1 + 0.4 * (1 - charAware(c) / 10); }
/* before the next pull: how healthy the group has to be (veterans wait, beginners rush) */
function masteryReady(c) { return 0.45 + 0.35 * charAware(c) / 10; }

/* ------------------------------------------------------------------ learning */
function masteryKill(c, m) {
  const d = isDungeonMap(c.pos.map) ? dungeonByMap(c.pos.map) : null;
  if (!d) { gainSkill(c, m.rank >= 1 ? 0.05 : 0.004); return; }
  const boss = d.bosses.some((b) => b.e === m.e);
  const v = boss ? 1.0 : m.rank >= 1 ? 0.04 : 0.02; const s = boss ? 0.6 : m.rank >= 1 ? 0.05 : 0.01;
  for (const o of groupLearners(c)) { gainSkill(o, s); gainInst(o, d.map, v, boss ? m.e : null); }
}
function masteryWipe(c, d) {
  const boss = (rt(c).threats || []).find((m) => d.bosses.some((b) => b.e === m.e));
  for (const o of groupLearners(c)) { gainSkill(o, 0.4); const i = instRec(o, d.map); i.pts += 1.2; i.wipes++; if (boss) i.boss[boss.e] = (i.boss[boss.e] || 0) + 2.5; }
}
function masteryRunEnd(c, d, o) {
  const cleared = o && !o.questRun && dungeonBossesLeft(c, d).length === 0; const mins = o && o.entered != null ? (G.gameTime - o.entered) / 60 : 0;
  for (const x of groupLearners(c)) {
    const i = instRec(x, d.map); i.runs++; i.pts += cleared ? 3 : 1; gainSkill(x, cleared ? 2 : 0.6);
    if (cleared) { i.clears++; if (mins && (!i.best || mins < i.best)) i.best = Math.round(mins); }
    if (x.roster) x.runs = (x.runs || 0) + 1;
  }
}
function masteryLevelUp(c) { gainSkill(c, 0.6); }
function masteryDeath(c) { gainSkill(c, 0.3); }
function masteryQuest(c) { gainSkill(c, 0.02); }
/* who learns from a dungeon run: the character and the companions (their roster entries) */
function groupLearners(c) { const out = [c]; for (const u of rt(c).party || []) { const m = rosterById(u.rid); if (m) out.push(m); } return out; }

/* ------------------------------------------------------------------ the roster: companions to hire */
function roster() { G.state.roster = G.state.roster || []; return G.state.roster; }
function rosterById(id) { return id ? roster().find((m) => m.id === id) : null; }
function newRecruit(role, map) {
  const R = roster(); const used = new Set(R.map((m) => m.name));
  let name = ROSTER_NAMES.find((n) => !used.has(n)); if (!name) name = ROSTER_NAMES[Math.floor(Math.random() * ROSTER_NAMES.length)] + ' ' + (R.length + 1);
  const cls = ROLE_CLASSES[role][Math.floor(Math.random() * ROLE_CLASSES[role].length)];
  // most players out there are so-so, a few are very good
  const pts = -Math.log(1 - Math.random() * 0.97) * 260; const apt = 0.7 + Math.random() * 0.3;
  const m = { id: 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name, cls, role, apt: Math.round(apt * 100) / 100, mastery: { pts: Math.round(pts), inst: {} }, runs: 0, roster: true };
  if (map != null && Math.random() < 0.7) { const ip = -Math.log(1 - Math.random() * 0.95) * 6; m.mastery.inst[map] = { pts: Math.round(ip * 10) / 10, runs: Math.round(ip / 2), clears: Math.round(ip / 3), wipes: 0, best: 0, boss: {} }; }
  R.push(m); return m;
}
/* what one companion costs for a run (copper): grows with the level and with how good they are */
function hireFee(c, m, d) {
  const L = c.level; const base = L * L * 2.5 * ((d.players || 5) > 5 ? 0.6 : 1);
  return Math.round(base * (0.4 + skillLevel(m) / 4 + instLevel(m, d.map) / 6));
}
/* the group for a run: the best the money allows ('best') or the cheapest ('cheap'); first-timers come for free when
   there is not even money for that */
function partyPlan(c, d) {
  const n = Math.max(0, (d.players || 5) - 1); const raid = n >= 9;
  const tanks = n >= 19 ? (n >= 39 ? 4 : 2) : 1, heals = n >= 19 ? Math.ceil((n + 1) / 5) : 1;
  const want = []; for (let i = 0; i < n; i++) want.push(i < tanks ? 'tank' : i < tanks + heals ? 'healer' : 'dps');
  const policy = G.state.settings.dgHire || 'best'; const R = roster(); const taken = new Set(); const out = [];
  let budget = Math.max(0, c.gold - 500);
  for (const role of want) {
    let pool = R.filter((m) => m.role === role && !taken.has(m.id));
    if (pool.length < 3) for (let k = pool.length; k < 3; k++) pool.push(newRecruit(role, d.map));
    pool = pool.map((m) => ({ m, fee: hireFee(c, m, d), q: execLevel(m, d.map) + awareLevel(m, d.map) }));
    const share = budget / Math.max(1, want.length - out.length);
    let pick = null;
    if (policy === 'cheap') pick = pool.sort((a, b) => a.fee - b.fee)[0];
    else { const ok = pool.filter((x) => x.fee <= share * 1.6 && x.fee <= budget).sort((a, b) => b.q - a.q); pick = ok[0] || pool.sort((a, b) => a.fee - b.fee)[0]; }
    if (pick.fee > budget) { const v = newRecruit(role, null); v.mastery.pts = Math.round(Math.random() * 40); pick = { m: v, fee: 0, q: 0, volunteer: true }; }
    budget -= pick.fee; taken.add(pick.m.id); out.push(Object.assign({ role }, pick));
  }
  if (R.length > 80) { const keep = new Set(out.map((x) => x.m.id)); G.state.roster = R.filter((m) => keep.has(m.id) || m.runs > 0).slice(-80); }
  return { members: out, fee: out.reduce((s, x) => s + x.fee, 0), raid };
}
function stars(v) { return (Math.round(v * 10) / 10).toFixed(1); }
/* the dungeon panel: what the character and the next group know */
function masteryDungeonHtml(c, d) {
  if (G.state.settings.showMastery === false) return '';
  const i = masteryOf(c).inst[d.map]; const k = instLevel(c, d.map);
  let h = '<div class="sgroup mst"><h5>Experience</h5><div class="small">You: skill <b>' + stars(skillLevel(c)) + '</b>/10 &middot; knowledge of ' + esc(d.short || d.name) + ' <b>' + stars(k) + '</b>/10' +
    (i ? ' <span class="muted">(' + i.runs + ' run' + (i.runs === 1 ? '' : 's') + ', ' + i.clears + ' cleared, ' + i.wipes + ' wipe' + (i.wipes === 1 ? '' : 's') + (i.best ? ', best ' + i.best + ' min' : '') + ')</span>' : ' <span class="muted">(first time)</span>') + '</div>';
  if (!G.state.settings.dungeonSolo) {
    const plan = G.dgPlan && G.dgPlan.map === d.map && G.dgPlan.t > G.gameTime - 300 && G.dgPlan.cid === c.id ? G.dgPlan.p : null;
    if (plan) {
      h += '<div class="small" style="margin-top:4px">Group to hire: <b>' + money(plan.fee) + '</b></div>' + plan.members.slice(0, 12).map((x) => '<div class="small mst-m"><span style="color:' + CLASS_COLOR[x.m.cls] + '">' + esc(x.m.name) + '</span> <span class="muted">' + CLASS_NAMES[x.m.cls] + ' ' + x.role + '</span> &middot; skill ' + stars(skillLevel(x.m)) + ' &middot; knows it ' + stars(instLevel(x.m, d.map)) + (x.volunteer ? ' <span class="muted">(volunteer, free)</span>' : ' &middot; ' + money(x.fee)) + '</div>').join('') + (plan.members.length > 12 ? '<div class="small muted">and ' + (plan.members.length - 12) + ' more</div>' : '');
    } else h += '<button class="mini" data-dgplan="1" style="margin-top:4px">Who would come along (and the fee)?</button>';
    h += '<div class="small" style="margin-top:4px">Hire: <select data-dghire="1"><option value="best"' + ((G.state.settings.dgHire || 'best') === 'best' ? ' selected' : '') + '>the best the money allows</option><option value="cheap"' + (G.state.settings.dgHire === 'cheap' ? ' selected' : '') + '>the cheapest</option></select></div>';
  }
  return h + '</div>';
}
function masterySheetHtml(c) {
  if (G.state.settings.showMastery === false) return '';
  const m = masteryOf(c); const list = Object.keys(m.inst).map((k) => ({ d: dungeonByMap(+k), i: m.inst[k] })).filter((x) => x.d);
  return '<div class="sgroup"><h5>Experience</h5>' + statRow('Skill', stars(skillLevel(c)) + ' / 10', 'How well you play your class: reaction, the right button at the right time, cooldowns. Grows slowly with everything you do.') +
    list.map((x) => statRow(esc(x.d.short || x.d.name), stars(instLevel(c, x.d.map)) + ' / 10', x.i.runs + ' runs, ' + x.i.clears + ' cleared, ' + x.i.wipes + ' wipes')).join('') + '</div>';
}
