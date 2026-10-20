'use strict';
/* away.js - progress while the game is closed or its tab is in the background.
   - Closed (Automation: "Offline progress", per character): the time away counts up to 2 hours. The first 30 minutes
     are played for real (the normal game, fast and without drawing - quests, fights, loot, deaths); the rest is worked
     out from what those 30 minutes gave (experience, money, trade goods, reputation) at half the rate. No dungeons
     while away: a character in a dungeon (or on its way to one) waits, with its group; nobody goes into one.
     Grouped characters stay together (they are played together).
   - Tab in the background (the browser stops the game's drawing loop there): when it comes back the missed time is
     played (at the game speed), up to 30 minutes; a longer absence counts like the game being closed.
   A "While you were away" window tells what happened. */

const AWAY_FULL = 1800;          // game seconds played for real
const AWAY_CAP = 7200;           // game seconds that count at all
const AWAY_RATE = 0.5;           // the rest: this much of the rate of the played part
const AWAY_MIN = 2;              // real seconds of gap that are caught up at all
/* rendering and saving are skipped while catching up (restored after) */
const AWAY_QUIET = ['save', 'renderQuests', 'renderOrder', 'renderChar', 'refreshGear', 'renderGroup', 'renderSheet', 'renderInfo', 'renderAbar', 'renderCharSwitch', 'renderGearCard', 'renderMeter', 'renderUnitFrames'];

function awayOn(c) { return cset(c, 'offlineProgress') !== false; }
function awayInDungeon(c) { return (typeof inDungeon === 'function' && inDungeon(c)) || !!(c.order && c.order.type === 'dungeon'); }
/* who is played while away: the characters in the world; a group goes as one (its leader's setting; any of it in a
   dungeon keeps all of it waiting when the game was closed) */
function awayChars(closed) {
  const out = [];
  for (const c of liveChars()) {
    const g = typeof groupOf === 'function' ? groupOf(c) : null; const L = g ? groupLeader(g) || c : c;
    const all = g ? groupChars(g) : [c];
    if (closed && (!awayOn(L) || all.some(awayInDungeon))) continue;
    out.push(c);
  }
  return out;
}

/* ------------------------------------------------------------------ catching up */
let AWAY_BUSY = false;
/* realSec: real seconds missed; why: 'closed' (the game was not running) or 'hidden' (the tab was in the background) */
async function awayCatchUp(realSec, why) {
  if (AWAY_BUSY || !(realSec > AWAY_MIN)) return;
  const sp = G.state.settings.speed || 0; if (!sp) return;               // paused: nothing goes on
  let closed = why === 'closed';
  let game = closed ? realSec : realSec * sp;           // closed: real time; in the background: at the game's speed
  if (!closed && game > AWAY_FULL) closed = true;       // a long time in the background counts like the game being closed
  game = Math.min(game, AWAY_CAP);
  const chars = awayChars(closed); if (!chars.length) return;
  const play = Math.min(game, AWAY_FULL); const extra = closed ? game - play : 0;
  AWAY_BUSY = true; G.catching = true;
  const before = new Map(chars.map((c) => [c, awaySnap(c)]));
  const quiet = {}; for (const k of AWAY_QUIET) if (typeof window[k] === 'function') { quiet[k] = window[k]; window[k] = () => {}; }
  const olog = window.log; G.away = { xp: {}, kills: {}, deaths: {} };
  window.log = function (m) { const c = G.logCtx; const k = /^(.+) was killed by /.exec(m); if (k) { const d = chars.find((x) => x.name === k[1]); if (d) G.away.deaths[d.id] = (G.away.deaths[d.id] || 0) + 1; } return olog.apply(this, arguments); };
  G.awayNoDungeon = closed;
  const big = play > 90;
  if (big) awayOverlay(0, play, closed);
  try {
    let done = 0; let t0 = performance.now();
    while (done < play) {
      G.gameTime += STEP; done += STEP;
      for (const c of chars) { G.logCtx = c; updateChar(c, STEP); } G.logCtx = null; worldTick(STEP);
      if (performance.now() - t0 > 60) { G.fx.length = 0; if (big) awayOverlay(done, play, closed); await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); }
    }
  } catch (e) { console.error(e); }
  for (const k in quiet) window[k] = quiet[k];
  window.log = olog; G.fx.length = 0; G.awayNoDungeon = false;
  // the rest of the time, from what the played part gave
  const rep = [];
  for (const c of chars) {
    const b = before.get(c); const r = { c, played: play, extra: 0, kills: G.away.kills[c.id] || 0, deaths: G.away.deaths[c.id] || 0 };
    const gain = awayDiff(c, b, G.away.xp[c.id] || 0);
    if (extra > 0 && awayOn(c) && !awayInDungeon(c) && play >= 300) { r.extra = extra; awayExtrapolate(c, gain, extra / play * AWAY_RATE, r); }
    Object.assign(r, awayDiff(c, b, G.away.xp[c.id] || 0));          // (gainXp counted the worked-out part too)
    rep.push(r);
  }
  G.away = null; AWAY_BUSY = false; G.catching = false; G.acc = 0; G.lastReal = Date.now();
  $('loading').style.display = 'none';
  save(); renderChar(); renderOrder(); renderQuests(); refreshGear(); renderGroup(); if (typeof renderUnitFrames === 'function') try { renderUnitFrames(); } catch (e) { /* */ }
  if (closed ? game >= 60 : game >= 600) awayReport(game, play, closed, rep); else if (game >= 60) log('In the background: ' + fmtDur(game) + ' went by.');
}
function awaySnap(c) {
  const bags = {}; for (const s of c.bags) bags[s.id] = (bags[s.id] || 0) + s.n;
  return { level: c.level, xp: c.xp, gold: c.gold, bags, done: Object.keys(c.done || {}).length, rep: Object.assign({}, c.rep || {}) };
}
/* what changed since the snapshot (xp: the experience gained, from gainXp) */
function awayDiff(c, b, xp) {
  const items = {}; for (const s of c.bags) items[s.id] = (items[s.id] || 0) + s.n;
  for (const id in items) { items[id] -= b.bags[id] || 0; if (items[id] <= 0) delete items[id]; }
  const rep = {}; for (const f in c.rep || {}) { const d = c.rep[f] - (f in b.rep ? b.rep[f] : (typeof repBase === 'function' ? repBase(c, +f).v : 0)); if (d) rep[f] = d; }
  return { levels: c.level - b.level, xp, gold: c.gold - b.gold, items, quests: Object.keys(c.done || {}).length - b.done, rep };
}
/* k: how much of the played part's gains the rest of the time gives */
function awayExtrapolate(c, gain, k, r) {
  const xp = Math.round(gain.xp * k); if (xp > 0) { gainXp(c, xp); r.xpExtra = xp; }
  if (gain.gold > 0) c.gold += Math.round(gain.gold * k);
  for (const f in gain.rep) if (gain.rep[f] > 0 && typeof repSet === 'function') repSet(c, +f, Math.round(gain.rep[f] * k), true);
  // trade goods (cloth, leather, ore, herbs ...): more of what was gathered; what does not fit is sold
  let sold = 0;
  for (const id in gain.items) {
    const it = itemRow(+id); if (!it || it.c !== 7) continue;
    const v = gain.items[id] * k; const n = Math.floor(v) + (Math.random() < v - Math.floor(v) ? 1 : 0); if (n <= 0) continue;
    if (!addItem(c, +id, n)) { c.gold += itemSell(+id) * n; sold += itemSell(+id) * n; }
  }
  r.sold = sold;
}

/* ------------------------------------------------------------------ the windows */
function awayOverlay(done, total, closed) {
  const el = $('loading'); el.style.display = '';
  el.innerHTML = '<div><b>' + (closed ? 'While you were away ...' : 'Catching up ...') + '</b><div id="loadmsg">Playing ' + fmtDur(done) + ' of ' + fmtDur(total) + '</div>' +
    '<div class="awaybar"><i style="width:' + (100 * done / Math.max(1, total)).toFixed(1) + '%"></i></div></div>';
}
function fmtDur(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m ? m + 'm' + (m < 10 && x ? ' ' + x + 's' : '') : x + 's'; }
function awayReport(game, play, closed, rep) {
  let h = '<div class="awaybox"><div class="awayhead"><b>' + (closed ? 'While you were away' : 'While the game was in the background') + '</b> <span class="muted small">' + fmtDur(game) + (closed ? ' (played ' + fmtDur(play) + (game > play ? ', the rest at half rate' : '') + ')' : '') + '</span><button class="mini" data-awayx="1">&times;</button></div>';
  for (const r of rep) {
    const c = r.c; const it = Object.entries(r.items).map(([id, n]) => n + ' x ' + itemName(+id)).slice(0, 8);
    const rp = Object.entries(r.rep).filter((x) => x[1] > 0).map(([f, v]) => '+' + v + ' ' + repName(+f)).slice(0, 4);
    h += '<div class="awayc"><b>' + esc(c.name) + '</b> <span class="muted small">level ' + c.level + (r.levels ? ' (+' + r.levels + ')' : '') + '</span>' +
      '<div class="small">' + [r.xp ? '+' + r.xp + ' xp' : '', r.gold ? (r.gold > 0 ? '+' : '-') + money(Math.abs(r.gold)) : '', r.kills ? r.kills + ' kills' : '', r.quests ? r.quests + ' quest' + (r.quests > 1 ? 's' : '') + ' done' : '', r.deaths ? '<span class="bad">' + r.deaths + ' death' + (r.deaths > 1 ? 's' : '') + '</span>' : ''].filter(Boolean).join(' &middot; ') + '</div>' +
      (it.length ? '<div class="small muted">' + esc(it.join(', ')) + (r.sold ? ' (no room for more: sold for ' + money(r.sold) + ')' : '') + '</div>' : '') +
      (rp.length ? '<div class="small" style="color:#9fc7ff">' + esc(rp.join(', ')) + '</div>' : '') +
      (c.order ? '<div class="small muted">Now: ' + esc(orderText(c).t) + '</div>' : '') + '</div>';
  }
  h += '</div>';
  let el = $('awayBox'); if (!el) { el = document.createElement('div'); el.id = 'awayBox'; document.body.appendChild(el); el.onclick = (e) => { if (e.target.dataset.awayx || e.target === el) el.hidden = true; }; }
  el.innerHTML = h; el.hidden = false;
  log((closed ? 'While you were away' : 'In the background') + ': ' + fmtDur(game) + ' went by.');
}
