'use strict';
/* unitframes.js - WoW style unit frames in the character card: the character (portrait on the left) and up to
   five creatures it is fighting (portrait on the right), made from the client textures in ui/TargetingFrame. */

const UF = {
  /* the used part of UI-TargetingFrame.png (256x128): x 24..230, y 8..86 */
  cropX: 24, cropY: 8, w: 206, h: 78,
  portrait: { x: 128, y: 8, d: 57 }, name: { x: 7, y: 17, w: 114, h: 14 },
  hp: { x: 7, y: 36, w: 112, h: 7 }, pw: { x: 7, y: 47, w: 114, h: 7 }, level: { x: 182, y: 60 },
  maxEnemies: 5,
  /* buff / debuff icons under the bars, like the target frame of the game: 5 in a row, the time left below each */
  aura: { y: 56, d: 22, gap: 2, row: 32, perRow: 5 },
};
const RACE_PORTRAIT = { 1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'NightElf', 5: 'Scourge', 6: 'Tauren', 7: 'Gnome', 8: 'Troll' };
const REACTION_BG = { A: 'rgba(200,30,20,.75)', N: 'rgba(210,180,20,.7)', F: 'rgba(30,170,40,.7)', X: 'rgba(110,110,120,.7)' };

function ufFrameTexture(rank) {
  const f = rank === 1 || rank === 3 ? 'UI-TargetingFrame-Elite' : rank === 2 ? 'UI-TargetingFrame-Rare' : rank === 4 ? 'UI-TargetingFrame-Rare' : 'UI-TargetingFrame';
  return '../ui/TargetingFrame/' + f + '.png';
}
/* build the DOM of one frame; mirror = portrait on the left (the player frame) */
function ufMake(s, mirror, trim) {
  /* trim (creature frames only): the bars are made shorter by that many texture pixels (the small frames of the creatures
     fighting the group) - the left end of the frame is kept, the middle of the bars is cut out */
  trim = mirror ? 0 : trim || 0;
  const el = document.createElement('div'); el.className = 'uf' + (mirror ? ' me' : '') + (trim ? ' trim' : '');
  el.style.width = Math.round((UF.w - trim) * s) + 'px'; el.style.height = Math.round(UF.h * s) + 'px'; el.style.setProperty('--s', s);
  const X = (b) => (mirror ? UF.w - b.x - (b.w || b.d || 0) : b.x - (b.x > 60 ? trim : 0)) * s;
  const box = (cls, b, w, h) => { if (trim && b.x < 60) w -= trim; const d = document.createElement('div'); d.className = cls; d.style.left = X(Object.assign({}, b, { w })) + 'px'; d.style.top = b.y * s + 'px'; d.style.width = w * s + 'px'; d.style.height = h * s + 'px'; el.appendChild(d); return d; };
  const p = UF.portrait;
  el._por = box('ufpor', p, p.d, p.d); el._img = document.createElement('img'); el._por.appendChild(el._img);
  el._namebg = box('ufnamebg', UF.name, UF.name.w, UF.name.h);
  el._hp = box('ufbar hp', UF.hp, UF.hp.w, UF.hp.h); el._hpi = document.createElement('i'); el._hp.appendChild(el._hpi);
  el._pw = box('ufbar pw', UF.pw, UF.pw.w, UF.pw.h); el._pwi = document.createElement('i'); el._pw.appendChild(el._pwi);
  const bg = document.createElement('div'); bg.className = 'ufbg';
  bg.style.backgroundSize = 256 * s + 'px ' + 128 * s + 'px'; bg.style.backgroundPosition = (-UF.cropX * s) + 'px ' + (-UF.cropY * s) + 'px';
  el.appendChild(bg); el._bg = bg; el._bgs = [bg];
  if (trim) {
    const CAP = 10; bg.style.left = CAP * s + 'px'; bg.style.right = '0'; bg.style.width = 'auto';
    bg.style.backgroundPosition = (-(UF.cropX + trim + CAP) * s) + 'px ' + (-UF.cropY * s) + 'px';
    const cap = document.createElement('div'); cap.className = 'ufbg'; cap.style.width = CAP * s + 'px'; cap.style.right = 'auto';
    cap.style.backgroundSize = bg.style.backgroundSize; cap.style.backgroundPosition = (-UF.cropX * s) + 'px ' + (-UF.cropY * s) + 'px';
    el.insertBefore(cap, bg); el._bgs.push(cap);
  }
  el._name = box('ufname', UF.name, UF.name.w, UF.name.h);
  el._hpt = box('uftxt', { x: UF.hp.x, y: UF.hp.y - 2 }, UF.hp.w, UF.hp.h + 4);
  el._pwt = box('uftxt', { x: UF.pw.x, y: UF.pw.y - 2 }, UF.pw.w, UF.pw.h + 4);
  const lv = document.createElement('div'); lv.className = 'uflvl';
  lv.style.left = ((mirror ? UF.w - UF.level.x : UF.level.x - trim) * s - 12) + 'px'; lv.style.top = (UF.level.y * s - 7) + 'px'; el.appendChild(lv); el._lv = lv;
  const A = UF.aura; const aw = A.perRow * A.d + (A.perRow - 1) * A.gap;
  el._auras = document.createElement('div'); el._auras.className = 'ufauras'; el._auras.style.left = X({ x: UF.name.x, w: aw }) + 'px'; el._auras.style.top = A.y * s + 'px'; el._auras.style.width = aw * s + 'px';
  if (mirror) el._auras.style.justifyContent = 'flex-end';
  el.appendChild(el._auras); el._rows = 0;
  return el;
}
function ufBgImg(el, url) { for (const b of el._bgs || [el._bg]) b.style.backgroundImage = url; }
function ufSet(el, k, v, fn) { if (el['_v' + k] !== v) { el['_v' + k] = v; fn(v); } }
/* a character's frame: portrait, name, level, health, power, combo points, cast bar, buffs */
function ufFillChar(me, c) {
  const r = rt(c); const s = charStats(c);
  ufSet(me, 'img', c.race + '_' + (c.gender || 0) + (typeof lookKey === 'function' && c.look ? lookKey(c.race, c.gender, c.look) + ':' + LOOK.ver : ''), () => { me._img.src = typeof charPortrait === 'function' ? charPortrait(c) : '../ui/CharacterFrame/TemporaryPortrait-' + (c.gender ? 'Female' : 'Male') + '-' + (RACE_PORTRAIT[c.race] || 'Orc') + '.png'; });          // the chosen look (looks.js)
  ufSet(me, 'name', c.name, (v) => { me._name.textContent = v; });
  ufSet(me, 'lv', c.level, (v) => { me._lv.textContent = v; });
  ufSet(me, 'cls', c.cls, (v) => {          // the class: a small round icon at the start of the name plate
    if (!me._cls) { const k = document.createElement('img'); k.className = 'ufcls'; const nb = me._namebg.style; const sc = parseFloat(me.style.getPropertyValue('--s')) || 1; const d = Math.round(UF.name.h * sc + 4);
      Object.assign(k.style, { left: (parseFloat(nb.left) + 1) + 'px', top: (parseFloat(nb.top) - 2) + 'px', width: d + 'px', height: d + 'px' }); me.appendChild(k); me._cls = k; me._name.style.paddingLeft = (d - 2) + 'px'; }
    me._cls.src = 'img/class/' + v + '.png'; me._cls.title = CLASS_NAMES[v] || '';
  });
  ufSet(me, 'bg', 1, () => { ufBgImg(me, 'url(' + ufFrameTexture(0) + ')'); me._namebg.style.background = 'rgba(0,0,0,.35)'; });
  const hp = Math.max(0, Math.round(c.hp)); const ghost = !!r.ghost;
  ufSet(me, 'hp', hp + '/' + s.maxHp + ghost, () => { me._hpi.style.width = (ghost ? 0 : 100 * hp / s.maxHp) + '%'; me._hpt.textContent = ghost ? 'Ghost' : hp + ' / ' + s.maxHp; });
  const pt = powerType(c); const pv = Math.round(powerOf(c, pt)), pm = Math.max(1, Math.round(powerMax(c, pt)));
  ufSet(me, 'pw', pt + ':' + pv + '/' + pm, () => { me._pwi.style.width = (100 * pv / pm) + '%'; me._pwi.className = 'p' + pt; me._pwt.textContent = pt === 0 ? pv + ' / ' + pm : powerName(pt) + ' ' + pv; });
  const cpn = r.cpTgt && r.cpTgt.st !== 'dead' ? r.cp || 0 : 0;
  ufSet(me, 'cp', cpn, (v) => { me._cp = me._cp || (() => { const d = document.createElement('div'); d.className = 'ufcp'; me.appendChild(d); return d; })(); me._cp.innerHTML = '<i class="on"></i>'.repeat(v) + (c.cls === 4 || c.form === 'cat' ? '<i></i>'.repeat(5 - v) : ''); });
  const castOf = () => { const it = r.interact; const ck = typeof craftNow === 'function' ? craftNow(c) : null; return r.cast || ck || (it ? { name: it.label, t: it.t, total: it.dur } : null) || (typeof wcBarOf === 'function' ? wcBarOf(c) : null) || (me._hud ? hudSwingBar(c) : ufSwingBar(c)); };
  ufCastBar(me, castOf(), castOf);
  ufSet(me, 'combat', !!(r.threats && r.threats.length), (v) => me.classList.toggle('combat', v));
  ufAuras(me, me._hud ? [] : ufPlayerAuras(c, r));
}
/* a mercenary's frame: class icon, name (coloured by role), health, mana / rage / energy, cast bar, buffs */
function ufFillComp(me, u, lvl) {
  ufSet(me, 'img', 'cls' + u.cls, () => { me._img.src = 'img/class/' + u.cls + '.png'; });
  ufSet(me, 'name', u.name, (v) => { me._name.textContent = v; });
  ufSet(me, 'lv', lvl, (v) => { me._lv.textContent = v; });
  ufSet(me, 'bg', u.role, (v) => { ufBgImg(me, 'url(' + ufFrameTexture(0) + ')'); me._namebg.style.background = v === 'tank' ? 'rgba(40,90,190,.55)' : v === 'healer' ? 'rgba(30,150,60,.55)' : 'rgba(170,40,30,.5)'; });
  const hp = Math.max(0, Math.round(u.hp));
  ufSet(me, 'hp', hp + '/' + u.maxhp + u.dead, () => { me._hpi.style.width = (u.dead ? 0 : 100 * hp / u.maxhp) + '%'; me._hpt.textContent = u.dead ? 'Dead' : hp + ' / ' + u.maxhp; });
  const pt = u.pt || 0; const pm = Math.max(1, Math.round(pt === 0 ? u.maxmana || 0 : 100)); const pv = u.dead ? 0 : Math.round(pt === 1 ? u.rage || 0 : pt === 3 ? u.energy || 0 : u.mana || 0);
  ufSet(me, 'pw', pt + ':' + pv + '/' + pm + (pt === 0 && !u.maxmana), () => {
    if (pt === 0 && !u.maxmana) { me._pwi.style.width = '0%'; me._pwt.textContent = ''; return; }
    me._pwi.style.width = (100 * pv / pm) + '%'; me._pwi.className = 'p' + pt; me._pwt.textContent = pt === 0 ? pv + ' / ' + pm : powerName(pt) + ' ' + pv;
  });
  ufCastBar(me, u.cb && !u.dead ? u.cb : null, () => (u.cb && !u.dead ? u.cb : null));
  const now = G.gameTime; const au = [];
  for (const b of u.buffs || []) if (b.until > now) au.push({ n: b.name, ic: b.ic, left: b.until - now, k: b.kind || 'buff' });
  if (u.drinking) au.push({ n: 'Drink', ic: 'inv_drink_07', left: null, k: 'buff' });
  ufAuras(me, u.dead ? [] : au);
}
/* melee characters (warriors, rogues, paladins, Enhancement shamans, druids in cat or bear form): when nothing is
   being cast, the bar is the swing timer of the main hand while they fight */
function ufMelee(c) { return c.cls === 1 || c.cls === 4 || c.cls === 2 || (c.cls === 7 && c.level >= 10) || (c.cls === 11 && (c.form === 'cat' || c.form === 'bear')); }
function ufSwingBar(c) {
  const r = rt(c); if (!ufMelee(c) || !r.threats || !r.threats.length || r.ghost) return null;
  const s = charStats(c); const sp = s.mh && s.mh.speed ? s.mh.speed / (1 + (s.haste || 0) / 100) : 2; const left = Math.max(0, Math.min(sp, r.swingT || 0));
  return { name: 'Auto Attack', t: sp - left, total: sp, swing: true };
}
/* the cast bar: under the player's frame; on the small frames of the group over the name. get() gives what is cast
   right now ({name, t, total}): the bar itself moves every frame (animateCastBars), smoothly, not with the 4 redraws
   a second of the frames */
function ufCastBar(me, cb, get) {
  me._cbGet = get || null;
  ufSet(me, 'cast', cb ? cb.name : '', () => {
    if (!me._cb) {
      const d = document.createElement('div'); d.className = 'ufcast'; d.innerHTML = '<i></i><span></span>'; me.appendChild(d); me._cb = d;
      if ((me.classList.contains('ufmate') || me.classList.contains('ufenemy')) && !me._under) { const nb = me._namebg.style; Object.assign(d.style, { left: nb.left, top: nb.top, width: nb.width, height: nb.height, right: 'auto', bottom: 'auto' }); d.classList.add('onname'); }
    }
    me._cb.hidden = !cb; if (cb) me._cb.lastChild.textContent = cb.name; me._cb.classList.toggle('swing', !!(cb && cb.swing));
    if (me._hudIcon) ufCastIcon(me, cb);
  });
  if (cb && me._cb) ufCastWidth(me, cb);
}
function ufCastWidth(me, k, extra) { const w = Math.min(100, 100 * ((k.t || 0) + (extra || 0)) / Math.max(0.01, k.total || 1)); me._cb.firstChild.style.width = w.toFixed(2) + '%'; }
/* every animation frame: the cast bars of the frames on screen (the part of a game step not simulated yet is added,
   so the bar does not move in steps) */
function animateCastBars() {
  const extra = (G.state.settings.speed || 0) > 0 ? Math.min(STEP, G.acc || 0) * 1 : 0;
  const els = []; for (const id of ['unitframes', 'mhudL', 'mhudR']) { const b = $(id); if (b) els.push(...b.children); }
  for (const el of els) {
    if (!el._cb || el._cb.hidden || !el._cbGet || el.style.display === 'none') continue;
    const k = el._cbGet();
    if (!k) { el._cb.hidden = true; el._vcast = ''; continue; }
    if (el._vcast !== k.name) { el._vcast = k.name; el._cb.lastChild.textContent = k.name; el._cb.classList.toggle('swing', !!k.swing); if (el._hudIcon) ufCastIcon(el, k); }
    ufCastWidth(el, k, extra);
  }
}
/* a creature's frame, as seen by the character c */
function ufFillMob(e, m, c, isTgt, noAuras) {
  const info = m.info; const beh = behOf(m, c);
  ufSet(e, 'id', m, () => {
    ufBgImg(e, 'url(' + ufFrameTexture(m.rank) + ')');
    // portraits/by_name/<entry>_<name>.png is the creature's own picture (portraits/small is by model id, not creature)
    const p = G.portraits[m.e] ? '../portraits/by_name/' + encodeURIComponent(G.portraits[m.e]) : '../ui/CharacterFrame/TemporaryPortrait-Monster.png';
    e._img.onerror = () => { e._img.onerror = null; e._img.src = '../ui/CharacterFrame/TemporaryPortrait-Monster.png'; };
    e._img.src = p;
    e._name.textContent = info ? info[1] : 'Creature';
  });
  ufSet(e, 'react', beh, (v) => { e._namebg.style.background = REACTION_BG[v] || REACTION_BG.N; });
  ufSet(e, 'lv', m.lvl + '|' + c.level, () => { e._lv.textContent = effLevel(m) - c.level >= 10 ? '??' : m.lvl; e._lv.style.color = levelColor(m.lvl, c.level); });
  const hpPct = Math.max(0, Math.round(100 * m.hp / m.maxhp));
  ufSet(e, 'hp', hpPct, (v) => { e._hpi.style.width = v + '%'; e._hpt.textContent = v + '%'; });
  ufSet(e, 'tgt', isTgt, (v) => e.classList.toggle('target', v));
  const mc = () => (m.cast && m.cast.u ? { name: m.cast.u.sp.n, t: m.cast.t, total: m.cast.total } : e._under ? mobSwingBar(m) : null);
  ufCastBar(e, mc(), mc);       // what it is casting
  ufAuras(e, noAuras ? [] : ufMobAuras(m));
}
/* the other members of the group (your other characters and the dungeon companions), each with what it is fighting */
function ufMates(c) {
  const out = [];
  if (typeof groupOf === 'function' && groupOf(c)) for (const o of groupChars(groupOf(c))) if (o !== c) out.push({ c: o });
  const p = typeof partyOf === 'function' ? partyOf(c) : null;
  if (p) for (const u of p) if (u.comp) out.push({ u });
  return out;
}
/* the creatures fighting the group (any member), the ones attacking someone first */
function ufPartyEnemies(c, skip) {
  const set = new Set(); const add = (m) => { if (m && m !== skip && m.st !== 'dead' && m.hp > 0) set.add(m); };
  for (const m of rt(c).threats || []) add(m);
  if (typeof groupOf === 'function' && groupOf(c)) for (const o of groupChars(groupOf(c))) { const r = rt(o); for (const m of r.threats || []) add(m); if (r.tgt && r.tgt.st === 'chase') add(r.tgt); }
  return [...set].sort((a, b) => (b.st === 'chase') - (a.st === 'chase') || a.hp / a.maxhp - b.hp / b.maxhp);
}
function ufEnemyFrame(box, list, i, s, trim) {
  while (list.length <= i) { const e = ufMake(s, false, trim); e.classList.add('ufenemy'); box.appendChild(e); list.push(e); e.onclick = () => { if (e._mob) { G.selected = { kind: 'mob', mob: e._mob }; renderInfo(G.selected); } }; }
  return list[i];
}
function renderUnitFrames() {
  const box = $('unitframes'); if (!box) return;
  const c = active(); if (!c) return; const r = rt(c);
  /* the width of the card, not counting a scrollbar of the left column: with many creatures the column grows, a scrollbar
     comes and goes, and the frames would rescale back and forth with it */
  const lc = $('left'); const sb = lc ? lc.offsetWidth - lc.clientWidth - (parseFloat(getComputedStyle(lc).borderRightWidth) || 0) : 0;
  const W = (box.clientWidth || 254) + Math.max(0, sb);
  const mates = ufMates(c); const mode = mates.length ? 'group' : 'solo';
  if (!box._w || Math.abs(box._w - W) > 2 || box._mode !== mode) { box._w = W; box._mode = mode; box.innerHTML = ''; box._me = null; box._en = []; box._mf = []; box._pe = []; box._sep = null; box._pet = null; }
  const sp = Math.min(1.6, (box._w - 4 - 18) / UF.w), se = sp * 0.94;
  if (!box._me) {
    box._me = ufMake(sp, true); box._me.classList.add('ufplayer'); box.appendChild(box._me);
    box._me.onclick = (e) => { if (e.target.closest('.ufpor')) openCharSwitch(); else openSheet('char'); };
    box._me._por.title = 'Characters - switch, or let them play on their own';
  }
  const me = box._me; ufFillChar(me, c); me.style.top = '0px';
  let y = ufSlot(me) * sp + 6;
  // the pet under the character (like the PetFrame of the game)
  if (c.pet && c.pet.out !== false && typeof ufMakePet === 'function') {
    const ps = sp * 0.95;
    if (!box._pet || box._petS !== ps) { if (box._pet) box._pet.remove(); box._pet = ufMakePet(ps); box._petS = ps; box.appendChild(box._pet); box._pet.onclick = () => openSheet('pet'); box._pet.title = 'Pet - click for the Pet tab'; }
    box._pet.style.display = ''; box._pet.style.top = Math.round(y - 4) + 'px'; ufFillPet(box._pet, c);
    y += (box._pet._rows ? 66 : 53) * ps + 2;
  } else if (box._pet) box._pet.style.display = 'none';
  if (mode === 'solo') {
    // alone: the creatures it fights below it, the same size (current target first)
    const list = []; if (r.tgt && r.tgt.st !== 'dead' && (r.tgt.tgt === c || (r.threats || []).length === 0)) list.push(r.tgt);
    for (const m of r.threats || []) if (!list.includes(m)) list.push(m);
    const shown = list.slice(0, UF.maxEnemies);
    for (let i = 0; i < shown.length; i++) ufEnemyFrame(box, box._en, i, se, 0);
    box._en.forEach((e, i) => {
      const m = shown[i]; e.style.display = m ? '' : 'none'; e._mob = m || null; if (!m) return;
      e.style.top = Math.round(y) + 'px'; ufFillMob(e, m, c, m === r.tgt); y += ufSlot(e) * se + 3;
    });
    box.style.height = Math.ceil(shown.length || (box._pet && box._pet.style.display !== 'none') ? y : ufSlot(me) * sp) + 'px';
    return;
  }
  /* in a group: the current target big under the character; below, on the left the other members, on the right the
     creatures fighting the group (as many as fit the window, at most 7) */
  const tg = r.tgt && r.tgt.st !== 'dead' && r.tgt.hp > 0 ? r.tgt : (r.threats || []).find((m) => m.st !== 'dead') || null;
  const big = ufEnemyFrame(box, box._en, 0, se, 0); big.style.display = tg ? '' : 'none'; big._mob = tg;
  if (tg) { big.style.top = Math.round(y) + 'px'; ufFillMob(big, tg, c, true); y += ufSlot(big) * se + 4; }
  if (!box._sep) { box._sep = document.createElement('div'); box._sep.className = 'ufsep'; box.appendChild(box._sep); }
  box._sep.style.top = Math.round(y) + 'px'; y += 5;
  const TRIM = 40; const colL = Math.floor(box._w * 0.54); const sm = Math.min(sp * 0.8, (colL - 4) / UF.w); const st = Math.min(se * 0.8, (box._w - colL - 6) / (UF.w - TRIM));
  // the members
  let yl = y;
  while (box._mf.length < mates.length) { const f = ufMake(sm, true); f.classList.add('ufmate'); box.appendChild(f); box._mf.push(f); f.onclick = () => { if (f._o && f._o.c) switchCharacter(f._o.c.id); }; }
  box._mf.forEach((f, i) => {
    const o = mates[i]; f._o = o || null; f.style.display = o ? '' : 'none'; if (!o) return;
    f.style.top = Math.round(yl) + 'px';
    if (o.c) { ufFillChar(f, o.c); f.title = 'Play ' + o.c.name; } else { ufFillComp(f, o.u, c.level); f.title = o.u.name + ' (mercenary, ' + (o.u.role === 'healer' ? 'healer' : o.u.role === 'tank' ? 'tank' : 'damage') + ')'; }
    f.classList.toggle('dead', !!(o.u ? o.u.dead : rt(o.c).ghost));
    yl += ufSlot(f) * sm + 3;
  });
  // the creatures fighting the group: as many as fit without scrolling (2 to 7)
  const slotH = UF.h * st + 3; const top = box.getBoundingClientRect().top;
  const room = Math.max(yl - y, window.innerHeight - top - y - 12);
  const cap = Math.max(2, Math.min(7, Math.floor(room / slotH)));
  const pe = ufPartyEnemies(c, tg).slice(0, cap); let yr = y;
  for (let i = 0; i < pe.length; i++) ufEnemyFrame(box, box._pe, i, st, TRIM);
  box._pe.forEach((e, i) => {
    const m = pe[i]; e.style.display = m ? '' : 'none'; e._mob = m || null; if (!m) return;
    e.style.top = Math.round(yr) + 'px'; ufFillMob(e, m, c, false, true); yr += UF.h * st + 3;
  });
  box.style.height = Math.ceil(Math.max(yl, yr)) + 'px';
}
/* height of a frame with its rows of auras (in texture pixels) */
function ufSlot(el) { return el._rows ? Math.max(UF.h, UF.aura.y + el._rows * UF.aura.row) : UF.h; }
/* time left like the game: 25m, 2h, 45s */
function ufTime(t) { if (t == null || t > 7200 * 4) return ''; if (t >= 3600) return Math.ceil(t / 3600) + 'h'; if (t >= 60) return Math.ceil(t / 60) + 'm'; return Math.ceil(t) + 's'; }
/* the character's buffs (and a few debuffs) */
function ufPlayerAuras(c, r) {
  const now = G.gameTime; const out = [];
  for (const b of r.buffs || []) if (b.until > now) out.push({ n: b.name, ic: b.ic, left: b.until - now, k: b.kind || 'buff' });
  if (r.bandage) out.push({ n: 'First Aid (' + r.bandage.name + ')', ic: r.bandage.ic || 'spell_holy_heal', left: r.bandage.left, k: 'buff' });
  if (r.eating) out.push({ n: 'Food', ic: 'inv_misc_food_14', left: r.eating.left, k: 'buff' });
  if (r.drinking) out.push({ n: 'Drink', ic: 'inv_drink_07', left: r.drinking.left, k: 'buff' });
  if (r.icd && r.icd.bandaged > now) out.push({ n: 'Recently Bandaged', ic: 'inv_misc_bandage_09', left: r.icd.bandaged - now, k: 'debuff' });
  return out;
}
/* what the character put on a creature (one icon per spell) */
function ufMobAuras(m) {
  const now = G.gameTime; const out = []; const seen = {};
  for (const a of m.auras || []) {
    if (a.until <= now) continue; const o = seen[a.key];
    if (o) { o.left = Math.max(o.left, a.until - now); o.st = Math.max(o.st, a.stacks || 1); continue; }
    out.push(seen[a.key] = { n: a.key, left: a.until - now, st: a.stacks || 1, k: 'debuff' });
  }
  return out;
}
function ufAuras(el, list) {
  // the same buffs as before: only the times change (the icons stay - drawing them again makes them flicker)
  const shape = list.map((a) => a.n + '|' + (a.st || 1) + '|' + a.k + '|' + (a.ic || '')).join(',');
  if (el._vaurashape === shape && el._auras.children.length === list.length) {
    list.forEach((a, i) => { const em = el._auras.children[i].lastChild; const t = ufTime(a.left); if (em.textContent !== t) { em.textContent = t; el._auras.children[i].title = a.n + (a.left && a.left < 7200 * 4 ? ' - ' + t + ' left' : ''); } });
    return;
  }
  el._vaurashape = shape;
  const key = list.map((a) => a.n + '|' + ufTime(a.left) + '|' + (a.st || 1) + '|' + a.k).join(',');
  ufSet(el, 'auras', key, () => {
    el._rows = Math.ceil(list.length / UF.aura.perRow);
    el._auras.innerHTML = list.map((a) => '<i class="' + a.k + '" title="' + esc(a.n + (a.left && a.left < 7200 * 4 ? ' - ' + ufTime(a.left) + ' left' : '')) + '"><span>' +
      (a.ic ? '<img src="../icons/' + esc(a.ic.toLowerCase()) + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'">' : ufAuraIcon(a.n)) +
      (a.st > 1 ? '<b>' + a.st + '</b>' : '') + '</span><em>' + ufTime(a.left) + '</em></i>').join('');
  });
}
/* a small icon for a buff / debuff by spell name (from the spell data), or its first letter */
function ufAuraIcon(name) {
  G.auraIcon = G.auraIcon || {};
  if (!(name in G.auraIcon)) {
    let ic = null; const sp = G.d.spells && G.d.spells.spells;
    if (sp) for (const id in sp) if (sp[id].n === name && sp[id].ic && sp[id].ic !== 'temp') { ic = sp[id].ic; break; }
    G.auraIcon[name] = ic;
  }
  const ic = G.auraIcon[name];
  return ic ? '<img src="../icons/' + esc(ic.toLowerCase()) + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'">' : esc(name[0]);
}

/* ------------------------------------------------------------------ the Android app: frames on the map
   Where the ability bar was: the character (its pet above it) on the left, what it fights on the right - the target
   big, the other creatures fighting the group small above it. The cast bars have the icon of what is being done. */
const HUD_ICON = {};
function spellIconByName(n) {
  if (n in HUD_ICON) return HUD_ICON[n]; let ic = null; const sp = G.d.spells && G.d.spells.spells;
  if (sp) for (const id in sp) if (sp[id].n === n && sp[id].ic && sp[id].ic !== 'temp') { ic = sp[id].ic; break; }
  return (HUD_ICON[n] = ic);
}
function ufCastIcon(me, cb) {
  if (!me._cb) return;
  if (!me._cic) { const k = document.createElement('img'); k.className = 'ufcic'; k.onerror = () => { k.onerror = null; k.src = '../icons/inv_misc_questionmark.jpg'; }; me._cb.insertBefore(k, me._cb.lastChild); me._cic = k; }
  if (!cb) return;
  let ic = cb.ic || null; const c = me._hudC;
  if (!ic && cb.swing && c) { const w = c.equip[15]; ic = w ? (itemRow(w.id) || {}).ic : 'inv_gauntlets_04'; if (!ic) ic = 'inv_gauntlets_04'; }
  if (!ic) ic = spellIconByName(cb.name) || (cb.name === 'Auto Attack' ? 'inv_gauntlets_04' : null);
  const src = '../icons/' + (ic || 'inv_misc_questionmark').toLowerCase() + '.jpg';
  if (me._cicSrc !== src) { me._cicSrc = src; me._cic.src = src; }
}
function hudFrame(box, key, make) {
  if (!box[key]) { box[key] = make(); box[key]._hud = true; box[key].classList.add('hud'); box.appendChild(box[key]); }
  return box[key];
}
function renderMapHud() {
  if (typeof IS_APP === 'undefined' || !IS_APP) return;
  const L = $('mhudL'), R = $('mhudR'); if (!L || !R) return;
  const c = active(); if (!c) return; const r = rt(c);
  const W = $('mapwrap').clientWidth || 360;
  const sp = Math.max(0.6, Math.min(1, (W / 2 - 10) / UF.w));
  if (L._s !== sp) { L.innerHTML = ''; R.innerHTML = ''; L._s = R._s = sp; for (const k of ['_me', '_pet', '_tg']) { L[k] = null; R[k] = null; } R._sm = []; }
  // the character: at the bottom, the cast bar under it
  const me = hudFrame(L, '_me', () => { const f = ufMake(sp, true); f.classList.add('ufplayer'); f.onclick = (e) => { if (e.target.closest('.ufpor')) openCharSwitch(); else openSheet('char'); }; return f; });
  me._hudC = c; me._hudIcon = true; ufFillChar(me, c);
  const meH = UF.h * sp, castH = 20;
  let yl = 0;
  // the pet: small, above the character
  if (c.pet && c.pet.out !== false && typeof ufMakePet === 'function') {
    const ps = sp * 0.7;
    const pet = hudFrame(L, '_pet', () => { const f = ufMakePet(ps); f.onclick = () => openSheet('pet'); return f; });
    pet.style.display = ''; pet._hudC = c; ufFillPet(pet, c); pet.style.top = '0px'; yl = 53 * ps + 2;
  } else if (L._pet) L._pet.style.display = 'none';
  me.style.top = Math.round(yl) + 'px'; L.style.height = Math.ceil(yl + meH + castH) + 'px';
  // the creatures: the target (or the first one fighting) big at the bottom, the others small above it
  const tg = r.tgt && r.tgt.st !== 'dead' && r.tgt.hp > 0 && (r.tgt.st === 'chase' || (r.threats || []).length) ? r.tgt : (r.threats || []).find((m) => m.st !== 'dead' && m.hp > 0) || null;
  const others = tg ? ufPartyEnemies(c, tg).slice(0, 3) : [];
  const TRIM = 40, ss = Math.max(0.5, sp * 0.62);
  while (R._sm.length < others.length) { const f = ufMake(ss, false, TRIM); f.classList.add('ufenemy', 'hud'); f._hud = true; R.appendChild(f); R._sm.push(f); f.onclick = () => { if (f._mob) { G.selected = { kind: 'mob', mob: f._mob }; renderInfo(G.selected); } }; }
  let yr = 0; const smH = UF.h * ss + 3;
  R._sm.forEach((f, i) => {
    const m = others[others.length - 1 - i]; f.style.display = m ? '' : 'none'; f._mob = m || null; if (!m) return;
    f.style.top = Math.round(yr) + 'px'; f._hudC = c; ufFillMob(f, m, c, false, true); yr += smH;
  });
  const big = hudFrame(R, '_tg', () => { const f = ufMake(sp, false); f.classList.add('ufenemy'); f._under = true; f.onclick = () => { if (f._mob) { G.selected = { kind: 'mob', mob: f._mob }; renderInfo(G.selected); } }; return f; });
  big.style.display = tg ? '' : 'none'; big._mob = tg;
  if (tg) { big.style.top = Math.round(yr) + 'px'; big._hudC = c; ufFillMob(big, tg, c, true); yr += UF.h * sp + castH; }
  R.style.height = Math.ceil(yr) + 'px'; R.style.display = tg ? '' : 'none';
}

/* the Android frames: when nothing is cast, the bar is the attack timer - the swing of the weapon in melee, Auto Shot
   (or the wand) at range - with the weapon's icon */
function hudSwingBar(c) {
  const r = rt(c); if (!r.threats || !r.threats.length || r.ghost) return null;
  const m = r.tgt && r.tgt.st !== 'dead' ? r.tgt : null; const d = m ? Math.hypot(m.x - c.pos.x, m.y - c.pos.y) : 99; const s = charStats(c);
  const w = typeof rangedWeapon === 'function' ? rangedWeapon(c) : null;
  if (w && m && d > MELEE_RANGE + 1 && d <= 35) {
    const shooting = w.wand ? (c.mana < s.maxMana * ((c.cfg && c.cfg.wandAt) || 25) / 100 || r.noSpell) : c.cls === 3;
    if (shooting) { const sp = w.speed / (1 + (s.haste || 0) / 100); const left = Math.max(0, Math.min(sp, r.rangeT || 0)); const it = c.equip[17] && itemRow(c.equip[17].id);
      return { name: w.wand ? 'Shoot' : 'Auto Shot', t: sp - left, total: sp, swing: true, ic: it && it.ic }; }
  }
  if (!m || d > MELEE_RANGE + 1.5) return null;
  const sp = s.mh && s.mh.speed ? s.mh.speed / (1 + (s.haste || 0) / 100) : 2; const left = Math.max(0, Math.min(sp, r.swingT || 0));
  const mh = c.equip[15] && itemRow(c.equip[15].id);
  return { name: 'Auto Attack', t: sp - left, total: sp, swing: true, ic: (mh && mh.ic) || 'inv_gauntlets_04' };
}
/* a creature's attack timer (the big frame of the target, when it is not casting) */
function mobSwingBar(m) {
  if (m.st !== 'chase' || !m.tgt || !m.atk) return null; const t = m.tgt.pos || m.tgt;
  if (Math.hypot(t.x - m.x, t.y - m.y) > MELEE_RANGE + 1.5) return null;
  const total = m.atk; const left = Math.max(0, Math.min(total, m.swing || 0));
  return { name: 'Attack', t: total - left, total, swing: true };
}
