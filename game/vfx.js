'use strict';
/* vfx.js - how a fight looks on the map: spells and arrows flying to their target with a burst where they land,
   melee lunges and the hit one twitching back, crits shaking the screen with big numbers, spell-school colours,
   creatures flashing red when hit, a "!" when one notices you, fading out when it dies - and, zoomed in far
   enough, portrait tokens with small health bars instead of dots (a little tabletop battle).
   Everything here is for the eye only (real time, not game time): the fight itself is decided in combat.js. */

const VFX = { list: [], shake: null, img: new Map() };
const SCHOOL_COL = { 0: '#f2e6c8', 1: '#ffe27a', 2: '#ff8a2a', 3: '#7fe06a', 4: '#8fd8ff', 5: '#b77cff', 6: '#ff9cf0' };
const SCHOOL_GLOW = { 0: '#c8b896', 1: '#fff3b0', 2: '#ffcf6a', 3: '#d4ffb0', 4: '#e4f6ff', 5: '#e0c8ff', 6: '#ffd8f8' };
/* the kind of creature, when it has no portrait of its own */
const TYPE_ICON = { 1: 'ability_hunter_pet_wolf', 2: 'inv_misc_head_dragon_01', 3: 'spell_shadow_summonfelhunter', 4: 'spell_frost_summonwaterelemental', 5: 'ability_warstomp',
  6: 'inv_misc_bone_humanskull_01', 7: 'inv_misc_head_human_01', 8: 'ability_hunter_pet_wolf', 9: 'inv_gizmo_02', 10: 'inv_misc_questionmark', 11: 'inv_misc_questionmark' };
/* spells that hit where they are (areas, shields, weapon procs): a burst, nothing flies */
const NO_FLY = /Shield|Weapon|Totem|Nova|Consecration|Explosion|Flamestrike|Blizzard|Rain of|Volley|Thunder Clap|Hellfire|Swipe|Whirlwind|Cleave|Holy Wrath|Hurricane|Seal|Judgement|Thorns|Aura|Blast Wave|Cone of Cold|Frost Nova|Starfall|Moonfire|Insect Swarm|Corruption|Curse|Pain|Sting|Bleed|Rend|Garrote|Rupture|Poison/;

function vnow() { return performance.now(); }
function vfxOn() { return !G.headless; }
function vPos(e) { return e && e.pos ? e.pos : e; }
const SCHOOL_BY_NAME = {};
function schoolOfName(n) {
  if (n in SCHOOL_BY_NAME) return SCHOOL_BY_NAME[n]; let sc = 0; const sp = G.d.spells && G.d.spells.spells;
  if (sp) for (const id in sp) if (sp[id].n === n && sp[id].sc != null && sp[id].ic !== 'temp') { sc = sp[id].sc; break; }
  return (SCHOOL_BY_NAME[n] = sc);
}

/* a melee swing: the attacker lunges at the target, the target twitches back */
function vfxLunge(att, tgt) {
  if (!vfxOn() || !att || !tgt) return; const a = vPos(att), b = vPos(tgt); if (!a || !b) return; const t = vnow();
  att._ln = { t, x: b.x, y: b.y }; tgt._kb = { t, x: a.x, y: a.y };
}
function vfxFlash(e) { if (e) e._hit = vnow(); }
function vfxAggro(m) { if (!vfxOn() || !m || m.beh === 'F') return; const t = vnow(); if (t - (m._aggroLast || -1e9) < 4000) return; m._aggroLast = t; m._aggro = t; }
/* a crit by one of the player's characters (or their group): the screen shakes a little */
function vfxCrit(c, big) {
  if (!vfxOn() || !c) return; const a = active(); if (!a) return;
  if (c !== a && !(typeof sameGroup === 'function' && c.id && sameGroup(a, c)) && !(c.role && rt(a).party)) return;
  VFX.shake = { t: vnow(), mag: big ? 5 : 3 };
}
/* something flies from src to dst (a spell, an arrow); text: the number shown where it lands */
function vfxShot(src, dst, school, text, color, crit, arrow) {
  const s = vPos(src), d = vPos(dst);
  if (!vfxOn() || !s || !d) { if (text && d) fx(d.x, d.y, text, color); return; }
  const dist = Math.hypot(d.x - s.x, d.y - s.y);
  if (dist < 1) { vfxBurst(dst, school, crit); if (text) fx(d.x, d.y, text, color); return; }
  VFX.list.push({ k: 'shot', s: { x: s.x, y: s.y }, d: dst, t: vnow(), dur: Math.min(420, 140 + dist * 9), school: school || 0, text, color, crit, arrow });
  if (VFX.list.length > 80) VFX.list.shift();
}
function vfxBurst(at, school, crit) {
  if (!vfxOn()) return; const p = vPos(at); if (!p) return;
  VFX.list.push({ k: 'burst', x: p.x, y: p.y, t: vnow(), dur: crit ? 420 : 300, school: school || 0, crit });
  if (VFX.list.length > 80) VFX.list.shift();
}
/* a spell hitting a creature (spellHit): flies there unless it is an area / where-you-are spell */
function vfxSpell(c, m, sp, text, crit) {
  const sc = sp && sp.sc != null ? sp.sc : 0; const col = crit ? '#ffd23a' : SCHOOL_COL[sc] || '#ffe58a';
  if (crit) vfxCrit(c, true);
  if (!sp || NO_FLY.test(sp.n || '') || !c || !c.pos) { vfxBurst(m, sc, crit); fx(m.x, m.y, text, col); return; }
  vfxShot(c, m, sc, text, col, crit, false);
}

/* -------------------------------------------------------------------- drawing */
/* where to draw a unit (lunge / knockback added), in screen pixels */
function vfxOff(e, sx, sy) {
  const now = vnow(); let ox = 0, oy = 0;
  const L = e._ln; if (L) { const p = (now - L.t) / 180; if (p >= 1) e._ln = null; else { const [tx, ty] = w2s(L.x, L.y); const dx = tx - sx, dy = ty - sy, n = Math.hypot(dx, dy) || 1; const k = Math.sin(Math.PI * p) * Math.min(6, n * 0.45); ox += dx / n * k; oy += dy / n * k; } }
  const K = e._kb; if (K) { const p = (now - K.t) / 160; if (p >= 1) e._kb = null; else { const [tx, ty] = w2s(K.x, K.y); const dx = sx - tx, dy = sy - ty, n = Math.hypot(dx, dy) || 1; const k = Math.sin(Math.PI * Math.min(1, p * 1.4)) * 3; ox += dx / n * k; oy += dy / n * k; } }
  return [sx + ox, sy + oy];
}
function vfxFlashA(e) { if (!e || !e._hit) return 0; const p = (vnow() - e._hit) / 220; return p >= 1 ? 0 : 1 - p; }
/* the screen shake (draw() calls it right after the transform) */
function vfxShake(ctx) {
  const S = VFX.shake; if (!S) return; const p = (vnow() - S.t) / 260; if (p >= 1) { VFX.shake = null; return; }
  const a = S.mag * (1 - p); ctx.translate((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
}
/* pixels per yard: the zoomed-in token view starts at about one pixel per yard */
function vfxPpy(m) { const [, H] = mapSize(m); return G.scale * H / Math.max(1, Math.abs(m.xt - m.xb)); }
function vfxTokenMode(m) { return !m.cont && !m.world && vfxPpy(m) >= 0.9; }
/* a round picture of a given size, made once (portraits, type icons) */
function vfxRound(src, px) {
  const k = src + '|' + px; let cv = VFX.img.get(k); if (cv) return cv;
  const im = mapSprite(src); if (!im) return null;
  if (VFX.img.size > 500) VFX.img.clear();
  cv = document.createElement('canvas'); cv.width = cv.height = px; const x = cv.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.beginPath(); x.arc(px / 2, px / 2, px / 2, 0, 6.3); x.clip();
  const s = Math.min(im.width, im.height); x.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, px, px);
  VFX.img.set(k, cv); return cv;
}
function mobTokenSrc(mob) {
  if (G.portraits && G.portraits[mob.e]) return '../portraits/by_name/' + encodeURIComponent(G.portraits[mob.e]);
  return '../icons/' + (TYPE_ICON[mob.info ? mob.info[5] : 10] || 'inv_misc_questionmark') + '.jpg';
}
function vfxHpBar(ctx, x, y, w, frac, col) {
  ctx.fillStyle = '#000c'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5); ctx.fillStyle = col || '#e0453a'; ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 3);
}
/* one creature: a dot (zoomed out) or a token (zoomed in); flashing when hit, "!" when it notices someone,
   fading away when it dies. Returns false when there is nothing to draw. */
function vfxDrawMob(ctx, mob, sx, sy, r, token) {
  const now = vnow();
  if (mob.st === 'dead') {
    const p = mob._die ? (now - mob._die) / 900 : 1; if (p >= 1) return;
    ctx.save(); ctx.globalAlpha = (1 - p) * 0.9; const R = (token ? token : r) * (1 + p * 0.5);
    ctx.fillStyle = '#7a1f17'; ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#ffb3a8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, R * (1 + p), 0, 6.3); ctx.stroke(); ctx.restore(); return;
  }
  const [x, y] = vfxOff(mob, sx, sy); const fl = vfxFlashA(mob); const chase = mob.st === 'chase';
  if (token) {
    const R = token; const px = Math.round(R * 2 * (G.dpr || 1)); const im = vfxRound(mobTokenSrc(mob), px);
    ctx.fillStyle = '#120e08'; ctx.beginPath(); ctx.arc(x, y, R + 1, 0, 6.3); ctx.fill();
    if (im) ctx.drawImage(im, x - R, y - R, R * 2, R * 2);
    ctx.lineWidth = chase ? 2.5 : 2; ctx.strokeStyle = BEH_COLORS[mob.beh] || '#888'; ctx.beginPath(); ctx.arc(x, y, R, 0, 6.3); ctx.stroke();
    if (mob.rank && mob.beh !== 'F') { ctx.strokeStyle = mob.rank === 2 || mob.rank === 4 ? '#e4e8f0' : '#ffc93a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, R + 2.5, 0, 6.3); ctx.stroke(); }
    if (fl) { ctx.globalAlpha = fl * 0.6; ctx.fillStyle = '#ff2a1a'; ctx.beginPath(); ctx.arc(x, y, R, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1; }
    if (chase || mob.hp < mob.maxhp) vfxHpBar(ctx, x, y + R + 3, R * 2, mob.hp / mob.maxhp);
  } else {
    ctx.fillStyle = BEH_COLORS[mob.beh] || '#888'; ctx.globalAlpha = chase ? 1 : .85;
    ctx.beginPath(); ctx.arc(x, y, chase ? r + 1.5 : r, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1;
    if (fl) { ctx.globalAlpha = fl; ctx.fillStyle = '#ff2a1a'; ctx.beginPath(); ctx.arc(x, y, (chase ? r + 1.5 : r) + 1.5 * fl, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1; }
    if (mob.rank && mob.beh !== 'F') drawRankRing(ctx, mob.rank, x, y, chase ? r + 1.5 : r);
    if (chase || (mob.hp < mob.maxhp && mob.st !== 'alive')) vfxHpBar(ctx, x, y - r - 7, 20, mob.hp / mob.maxhp);
  }
  const top = token ? y - token - 4 : y - r - 9;
  if (mob.auras && (chase || token)) { let k = 0; for (const a of mob.auras) if (a.until > G.gameTime) { ctx.fillStyle = a.au === 3 ? '#ff9a3c' : a.au === 12 || a.au === 7 ? '#ffffff' : '#a07cff'; ctx.fillRect(x - 10 + k * 5, top - 5, 4, 4); k++; } }
  if (mob.fleeing) { ctx.fillStyle = '#ffb36b'; ctx.font = '10px Segoe UI'; ctx.fillText('flee', x + 6, y + 3); }
  // it noticed someone: a "!" pops up and fades
  if (mob._aggro) { const p = (now - mob._aggro) / 1000; if (p >= 1) mob._aggro = 0; else {
    const s = p < 0.15 ? 0.6 + p / 0.15 * 0.7 : 1.3 - Math.min(0.3, (p - 0.15) * 1.5); ctx.save(); ctx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
    ctx.font = 'bold ' + Math.round(15 * s) + 'px Georgia'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ff3b30';
    ctx.strokeText('!', x, top - 6); ctx.fillText('!', x, top - 6); ctx.restore(); } }
}
/* a unit of the player's side (character, companion, pet): the lunge offset and a red flash when hit */
function vfxUnitFlash(ctx, e, x, y, R) {
  const fl = vfxFlashA(e); if (!fl) return; ctx.save(); ctx.globalAlpha = fl * 0.55; ctx.fillStyle = '#ff2a1a'; ctx.beginPath(); ctx.arc(x, y, R, 0, 6.3); ctx.fill(); ctx.restore();
}
/* the flying things and the bursts (after the units) */
function vfxDraw(ctx) {
  if (!VFX.list.length) return; const now = vnow(); const keep = [];
  ctx.save(); ctx.lineCap = 'round';
  for (const f of VFX.list) {
    const p = (now - f.t) / f.dur;
    if (f.k === 'shot') {
      const d = vPos(f.d); if (!d) continue;
      if (p >= 1) {      // it landed: the burst, the number, the flash
        vfxBurst(f.d, f.school, f.crit); if (f.text) fx(d.x, d.y, f.text, f.color); f.d._hit = now; continue;
      }
      const [ax, ay] = w2s(f.s.x, f.s.y), [bx, by] = w2s(d.x, d.y);
      const hx = ax + (bx - ax) * p, hy = ay + (by - ay) * p; const len = Math.min(22, Math.hypot(bx - ax, by - ay) * 0.4); const n = Math.hypot(bx - ax, by - ay) || 1;
      const tx = hx - (bx - ax) / n * len, ty = hy - (by - ay) / n * len;
      if (f.arrow) { ctx.strokeStyle = '#e8d8b0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 1.6, 0, 6.3); ctx.fill(); }
      else {
        const col = SCHOOL_COL[f.school] || '#fff', glow = SCHOOL_GLOW[f.school] || '#fff';
        const g = ctx.createLinearGradient(tx, ty, hx, hy); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col);
        ctx.strokeStyle = g; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hx, hy, 3, 0, 6.3); ctx.fill();
      }
      keep.push(f);
    } else if (f.k === 'burst') {
      if (p >= 1) continue; const [x, y] = w2s(f.x, f.y); const col = SCHOOL_COL[f.school] || '#fff'; const R = (f.crit ? 16 : 10) * (0.4 + p);
      ctx.globalAlpha = 1 - p; ctx.strokeStyle = col; ctx.lineWidth = f.crit ? 3 : 2; ctx.beginPath(); ctx.arc(x, y, R, 0, 6.3); ctx.stroke();
      for (let i = 0; i < (f.crit ? 8 : 5); i++) { const a = i / (f.crit ? 8 : 5) * 6.283 + f.t % 1; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 0.5, y + Math.sin(a) * R * 0.5); ctx.lineTo(x + Math.cos(a) * R * 1.2, y + Math.sin(a) * R * 1.2); ctx.stroke(); }
      ctx.globalAlpha = 1; keep.push(f);
    }
  }
  ctx.restore(); VFX.list = keep;          // (bursts added while drawing were drawn and kept in the same pass)
}
/* the floating numbers: crits big and bouncy */
function vfxText(ctx, f, x, y) {
  if (f.crit) {
    const p = Math.min(1, f.t / 0.3); const s = p < 1 ? 1 + 0.9 * Math.sin(p * Math.PI) + 0.5 * (1 - p) : 1.35;
    ctx.save(); ctx.font = 'bold ' + Math.round(14 * s) + 'px Segoe UI'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.fillStyle = f.color;
    ctx.strokeText(f.text, x, y); ctx.fillText(f.text, x, y); ctx.restore(); return;
  }
  ctx.strokeText(f.text, x, y); ctx.fillText(f.text, x, y);
}
