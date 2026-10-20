'use strict';
/* reputation.js - standing with the factions of the world, as in the game (1.12):
   - eight ranks from Hated to Exalted; every character starts with the standing Faction.dbc gives its race and class
     (a Human is Friendly with Stormwind, Hated by Orgrimmar; everyone Hostile with Timbermaw Hold ...)
   - kills (creature_onkill_reputation: the value, the rank where it stops, team awards, team dependent factions) and quest
     turn-ins (the quest's reputation rewards) change it; part of it spills over to related factions (the Steamwheedle
     Cartel towns, the Alliance / Horde capitals). In a group out in the world the kill reputation is shared by level like
     the experience; in a dungeon everyone gets all of it. Humans get 10% more (Diplomacy).
   - vendors give a discount from Friendly on (5, 10, 15, 20%), on what they sell and on repairs
   - items can need a standing to be bought and used ("Requires Timbermaw Hold - Honored"), quests to be offered
   - creatures of a faction turn hostile when the standing falls to Hostile, and stop attacking (or even become friendly)
     when it climbs out of Hostile (Timbermaw furbolgs at Unfriendly)
   The Reputation tab of the Character window lists the factions under their headers with a bar per faction; a click on
   one shows its rewards, the discount and where the reputation comes from.
   Data: gamedata/reputation.json (script/wow_reputation.py), "rf"/"rr" in items.json, "rep"/"minrep"/"maxrep" in quests. */

const REP_RANKS = ['Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];
const REP_LO = [-42000, -6000, -3000, 0, 3000, 9000, 21000, 42000];
const REP_HI = [-6000, -3000, 0, 3000, 9000, 21000, 42000, 43000];
const REP_MIN = -42000, REP_MAX = 42999;
const REP_COLORS = ['#cc4d38', '#cc4d38', '#bf4500', '#e6b300', '#00991a', '#00991a', '#00991a', '#00991a'];   // the game's bar colours
const REP_DISCOUNT = [0, 0, 0, 0, 0.05, 0.10, 0.15, 0.20];
const REP_HEADERS = [469, 67, 891, 892, 169];          // Alliance, Horde, Alliance Forces, Horde Forces, Steamwheedle Cartel
const ALLIANCE_RACES = new Set([1, 3, 4, 7]);
const RF_VISIBLE = 1, RF_HIDDEN = 4, RF_INVISIBLE = 8;

function REPD() { return G.d.rep || { f: {}, kill: {}, spill: {} }; }
function repFac(f) { return REPD().f[f] || null; }
function repName(f) { const x = repFac(f); return x ? x.n : 'faction ' + f; }
function repRank(v) { for (let i = 7; i > 0; i--) if (v >= REP_LO[i]) return i; return 0; }
/* the standing a character starts with, and the faction's flags for it (Faction.dbc: race / class masks) */
function repBase(c, f) {
  const k = c.race + '/' + c.cls; G.repBaseC = G.repBaseC || {}; const m = G.repBaseC[k] = G.repBaseC[k] || {};
  if (f in m) return m[f];
  const x = repFac(f); let out = { v: 0, fl: 0 };
  if (x) for (const [rm, cm, v, fl] of x.b) if ((rm & (1 << (c.race - 1))) && (!cm || (cm & (1 << (c.cls - 1))))) { out = { v, fl }; break; }
  return (m[f] = out);
}
function repVal(c, f) { return c.rep && f in c.rep ? c.rep[f] : repBase(c, f).v; }
function repRankOf(c, f) { return repFac(f) ? repRank(repVal(c, f)) : 3; }
function repChildren(h) { G.repKids = G.repKids || {}; if (!G.repKids[h]) { G.repKids[h] = []; for (const id in REPD().f) if (REPD().f[id].p === h) G.repKids[h].push(+id); } return G.repKids[h]; }
function repIsAlliance(c) { return ALLIANCE_RACES.has(c.race); }

/* ------------------------------------------------------------------ gaining and losing */
/* the value the character really gets: Diplomacy (Humans) +10% on gains, losses 10% smaller */
function repCalc(c, v) { if (c.race === 1) v = v > 0 ? v * 1.1 : v * 0.9; return Math.trunc(v); }
/* change the standing (the bonuses already counted): the spillover factions first, as the server does */
function repModify(c, f, v, quiet) {
  if (!v) return;
  // a header without a bar of its own (the Steamwheedle Cartel: the goblins of all four towns give their reputation to it):
  // its factions get it
  if (REP_HEADERS.indexOf(f) >= 0) { for (const k of repChildren(f)) repSet(c, k, v, quiet); return; }
  const sp = REPD().spill[f];
  if (sp) for (const [o, rate, rk] of sp) if (repRankOf(c, o) <= rk) repSet(c, o, Math.trunc(v * rate), quiet);
  repSet(c, f, v, quiet);
}
function repSet(c, f, d, quiet) {
  const x = repFac(f); if (!d || !x) return;
  c.rep = c.rep || {};
  const old = repVal(c, f); const nv = Math.max(REP_MIN, Math.min(REP_MAX, old + d)); if (nv === old) return;
  c.rep[f] = nv; G.repStamp = (G.repStamp || 0) + 1;
  if (quiet) return;
  withRepLog(c, () => {
    log('Reputation with ' + x.n + ' ' + (nv > old ? 'increased' : 'decreased') + ' by ' + Math.abs(nv - old) + '.');
    const a = repRank(old), b = repRank(nv);
    if (a !== b) { log('You are now ' + REP_RANKS[b] + ' with ' + x.n + '.'); if (!G.headless && isActive(c)) fx(c.pos.x, c.pos.y, REP_RANKS[b] + ': ' + x.n, b > a ? '#7fe08a' : '#ff8a6a'); }
  });
}
function withRepLog(c, fn) { if (typeof withLog === 'function') withLog(c, fn); else fn(); }
/* a kill: rate = the character's share (1 alone or in a dungeon, its level share in a group out in the world) */
function repOnKill(c, m, rate) {
  const k = REPD().kill[m.e]; if (!k) return;
  const ally = repIsAlliance(c);
  for (const j of [0, 4]) {
    const f = k[j], v = k[j + 1]; if (!f || !v) continue;
    if (k[8] && (j === 0) !== ally) continue;                         // team dependent: the first faction for the Alliance, the second for the Horde
    const d = Math.trunc(repCalc(c, v) * (rate == null ? 1 : rate)); if (!d) continue;
    if (repRankOf(c, f) <= k[j + 2]) repModify(c, f, d);               // stops past the rank the kill is good for
    if (k[j + 3]) { const p = repFac(f) && repFac(f).p; if (p) repModify(c, p, Math.trunc(d / 2)); }     // team award: half to the faction's team
  }
}
function repOnQuest(c, q, quiet) { for (const [f, v] of q.rep || []) if (f && v) repModify(c, f, repCalc(c, v), quiet); }
/* a character from before the reputation existed: its finished quests count (kills are lost) */
function repInit(c) {
  if (c.rep) return;
  c.rep = {};
  if (!G.d.rep || !G.q || !G.q.byId) return;
  for (const id in c.done || {}) { const q = G.q.byId[id]; if (q) repOnQuest(c, q, true); }
}

/* ------------------------------------------------------------------ what the standing does */
/* creatures: Hostile or worse turns a faction's creatures against the character; climbing out of Hostile calms them
   (furbolgs of Timbermaw stop attacking at Unfriendly, become friendly at Friendly). Only a change of the kind of standing
   (hostile / unfriendly / neutral / friendly) against the starting one changes what the world data says. */
const REP_BEH_ORD = { A: 0, N: 1, F: 2 }; const REP_BEH_OF = ['A', 'N', 'N', 'F'];
function repKind(r) { return r <= 1 ? 0 : r === 2 ? 1 : r === 3 ? 2 : 3; }
function repTmplFaction(t) {
  if (!G.repTm) { G.repTm = {}; const T = G.d.hostility.templates || {}; for (const id in T) if (repFac(T[id][0]) && REP_HEADERS.indexOf(T[id][0]) < 0) G.repTm[id] = T[id][0]; }
  return G.repTm[t];
}
function repBeh(c, t, b) {
  if (!c.rep || !(b in REP_BEH_ORD)) return b;
  const f = repTmplFaction(t); if (f == null || !(f in c.rep)) return b;
  const cur = repKind(repRank(c.rep[f])), base = repKind(repRank(repBase(c, f).v)); if (cur === base) return b;
  const m = REP_BEH_OF[cur];
  return cur < base ? (REP_BEH_ORD[m] < REP_BEH_ORD[b] ? m : b) : (REP_BEH_ORD[m] > REP_BEH_ORD[b] ? m : b);
}
/* killing it would cost reputation with a faction the character is not hostile with (left alone by the automation) */
function repKillHurts(c, e) {
  const k = REPD().kill[e]; if (!k) return false; const ally = repIsAlliance(c);
  for (const j of [0, 4]) { const f = k[j], v = k[j + 1]; if (!f || v >= 0 || (k[8] && (j === 0) !== ally)) continue; if (repRankOf(c, f) >= 2) return true; }
  return false;
}
/* the faction of a creature (its faction template), or null when it has no reputation */
function repOfNpc(e) {
  const h = G.d.hostility.creatures[e]; if (!h) return null;
  const T = G.d.hostility.templates[h[0]]; const f = T ? T[0] : 0; return repFac(f) ? f : null;
}
/* vendors: Friendly 5%, Honored 10%, Revered 15%, Exalted 20% off */
function repDiscount(c, e) { if (!c || e == null) return 0; const f = repOfNpc(e); return f ? REP_DISCOUNT[repRankOf(c, f)] : 0; }
function vendorPrice(c, id, e) { const p = itemBuy(id); const d = repDiscount(c, e); return d ? Math.max(1, Math.floor(p * (1 - d))) : p; }
/* items that need a standing to be bought and used */
function repItemOk(c, id) { const it = itemRow(id); return !it || !it.rf || repRankOf(c, it.rf) >= it.rr; }
function repItemReq(id) { const it = itemRow(id); return it && it.rf ? repName(it.rf) + ' - ' + REP_RANKS[it.rr] : ''; }
function repTipLine(c, id) {
  const it = itemRow(id); if (!it || !it.rf) return '';
  return '<div' + (repItemOk(c, id) ? '' : ' style="color:#ff3b30"') + '>Requires ' + esc(repItemReq(id)) + '</div>';
}
/* quests offered from (minrep) or below (maxrep) a standing */
function repQuestOk(c, q) {
  if (q.minrep && repFac(q.minrep[0]) && repVal(c, q.minrep[0]) < q.minrep[1]) return false;
  if (q.maxrep && repFac(q.maxrep[0]) && repVal(c, q.maxrep[0]) >= q.maxrep[1]) return false;
  return true;
}
function repQuestText(q) { return (q.rep || []).filter((x) => x[1]).map(([f, v]) => (v > 0 ? '+' : '') + v + ' ' + repName(f)).join(', '); }

/* ------------------------------------------------------------------ the Reputation tab */
const REPUI = { open: {} };
function repShown(c, f) {
  const x = repFac(f); if (!x || REP_HEADERS.indexOf(f) >= 0) return false;
  const fl = repBase(c, f).fl;
  if (fl & RF_HIDDEN) return false;
  if (c.rep && f in c.rep) return true;
  return !!(fl & RF_VISIBLE) && !(fl & RF_INVISIBLE);
}
/* what a faction's quartermasters sell for standing: {rank: [itemIds]} */
function repRewards(f) {
  G.repRw = G.repRw || {}; if (G.repRw[f]) return G.repRw[f];
  const out = {}; const sold = new Set(); for (const v of vendorList()) for (const x of vendorItems(v.e)) sold.add(x.id);
  const I = G.d.items.items; for (const id in I) { const it = I[id]; if (it.rf === f && sold.has(+id)) (out[it.rr] = out[it.rr] || []).push(+id); }
  return (G.repRw[f] = out);
}
/* where the standing comes from: the creatures (by name, the best first) and how many quests */
function repSources(f) {
  G.repSrc = G.repSrc || {}; if (G.repSrc[f]) return G.repSrc[f];
  const by = {}; const K = REPD().kill; const par = repFac(f) && REP_HEADERS.indexOf(repFac(f).p) >= 0 ? repFac(f).p : -1;      // the Cartel's goblins count for each town
  for (const e in K) { const k = K[e]; for (const j of [0, 4]) if ((k[j] === f || k[j] === par) && k[j + 1]) { const n = (G.mobIdx[e] || [0, 'creature ' + e])[1]; const o = by[n] = by[n] || { n, v: k[j + 1], cap: k[j + 2], lv: (G.mobIdx[e] || [])[2] || 0 }; if (Math.abs(k[j + 1]) > Math.abs(o.v)) { o.v = k[j + 1]; o.cap = k[j + 2]; } } }
  const kills = Object.values(by).sort((a, b) => (b.v > 0) - (a.v > 0) || Math.abs(b.v) - Math.abs(a.v));
  let quests = 0; for (const q of G.d.quests) if ((q.rep || []).some((x) => x[0] === f && x[1] > 0)) quests++;
  return (G.repSrc[f] = { kills, quests });
}
function repBarHtml(c, f) {
  const v = repVal(c, f); const r = repRank(v); const lo = REP_LO[r], hi = r === 7 ? 43000 : REP_HI[r];
  const pct = Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  return '<div class="repbar" title="' + (v - lo) + ' / ' + (hi - lo) + '"><div style="width:' + pct.toFixed(1) + '%;background:' + REP_COLORS[r] + '"></div><span>' + REP_RANKS[r] + '</span></div>' +
    '<span class="repnum small muted">' + (v - lo) + ' / ' + (hi - lo) + '</span>';
}
function repTabHtml(c) {
  if (!G.d.rep) return '<div class="muted small">gamedata/reputation.json is missing - run <code>py wow_reputation.py</code>.</div>';
  const ally = repIsAlliance(c);
  const groups = new Map(); for (const h of ally ? [469, 891, 169] : [67, 892, 169]) groups.set(h, []);
  groups.set(0, []);
  for (const id in REPD().f) {
    const f = +id; if (!repShown(c, f)) continue;
    const p = repFac(f).p; const g = groups.has(p) ? p : 0; groups.get(g).push(f);
  }
  let h = '<div class="rep"><div class="small muted reptop">Standing with the factions you have met. Kills and quests raise or lower it; from Friendly on their vendors are cheaper (5% to 20% at Exalted), and some goods, recipes and quests need a standing.' +
    (c.race === 1 ? ' <span style="color:#7fe08a">Diplomacy: +10% reputation.</span>' : '') + '</div>';
  for (const [g, list] of groups) {
    if (!list.length) continue;
    list.sort((a, b) => repName(a).localeCompare(repName(b)));
    h += '<div class="rephead">' + esc(g ? repName(g) : 'Other') + '</div>';
    for (const f of list) {
      const on = !!REPUI.open[f]; const r = repRankOf(c, f); const atWar = repBase(c, f).fl & 2;
      h += '<div class="reprow' + (on ? ' open' : '') + '"><div class="repline" data-repf="' + f + '"><span class="carr">' + (on ? '&#9662;' : '&#9656;') + '</span><span class="repname">' + esc(repName(f)) + '</span>' + repBarHtml(c, f) + '</div>';
      if (on) h += repDetailHtml(c, f, r, atWar);
      h += '</div>';
    }
  }
  return h + '</div>';
}
function repDetailHtml(c, f, r, atWar) {
  const x = repFac(f); let h = '<div class="repdet">';
  if (x.d) h += '<div class="small">' + esc(x.d) + '</div>';
  const base = repBase(c, f).v;
  h += '<div class="small muted">Started ' + REP_RANKS[repRank(base)] + ' (' + base + '); now ' + repVal(c, f) + '.' + (atWar && r <= 3 ? ' At war: their creatures attack you.' : '') +
    (REP_DISCOUNT[r] ? ' <span style="color:#7fe08a">Their vendors: ' + Math.round(REP_DISCOUNT[r] * 100) + '% discount.</span>' : r >= 3 ? ' Friendly and better: a discount at their vendors.' : '') + '</div>';
  const rw = repRewards(f); const ranks = Object.keys(rw).map(Number).sort((a, b) => a - b);
  if (ranks.length) {
    h += '<div class="repsub">Rewards</div>';
    for (const k of ranks) {
      const got = r >= k;
      h += '<div class="reprw"><span class="small" style="color:' + (got ? '#7fe08a' : '#ff8a6a') + '">' + REP_RANKS[k] + '</span> ' +
        rw[k].slice(0, 24).map((id) => iconHtml(makeInst(id, 1), ' data-iid="' + id + '"' + (got ? '' : ' style="opacity:.55"'))).join('') + (rw[k].length > 24 ? ' <span class="small muted">+' + (rw[k].length - 24) + '</span>' : '') + '</div>';
    }
  }
  const src = repSources(f);
  if (src.kills.length || src.quests) {
    h += '<div class="repsub">Where it comes from</div>';
    if (src.quests) h += '<div class="small">' + src.quests + ' quest' + (src.quests > 1 ? 's' : '') + ' reward it.</div>';
    for (const k of src.kills.slice(0, 8)) {
      const stop = k.v > 0 && k.cap < 7 ? ' (until the end of ' + REP_RANKS[k.cap] + ')' : '';
      h += '<div class="small"><span style="color:' + (k.v > 0 ? '#7fe08a' : '#ff8a6a') + '">' + (k.v > 0 ? '+' : '') + repCalc(c, k.v) + '</span> ' + esc(k.n) + stop + '</div>';
    }
    if (src.kills.length > 8) h += '<div class="small muted">... and ' + (src.kills.length - 8) + ' more kinds of creature.</div>';
  }
  return h + '</div>';
}
function repTabClick(e) {
  const r = e.target.closest('[data-repf]'); if (!r) return false;
  const f = +r.dataset.repf; REPUI.open[f] = !REPUI.open[f]; renderSheet(); return true;
}
