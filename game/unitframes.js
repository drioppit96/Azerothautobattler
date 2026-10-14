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
function ufMake(s, mirror) {
  const el = document.createElement('div'); el.className = 'uf' + (mirror ? ' me' : '');
  el.style.width = Math.round(UF.w * s) + 'px'; el.style.height = Math.round(UF.h * s) + 'px'; el.style.setProperty('--s', s);
  const X = (b) => (mirror ? UF.w - b.x - (b.w || b.d || 0) : b.x) * s;
  const box = (cls, b, w, h) => { const d = document.createElement('div'); d.className = cls; d.style.left = X(Object.assign({}, b, { w })) + 'px'; d.style.top = b.y * s + 'px'; d.style.width = w * s + 'px'; d.style.height = h * s + 'px'; el.appendChild(d); return d; };
  const p = UF.portrait;
  el._por = box('ufpor', p, p.d, p.d); el._img = document.createElement('img'); el._por.appendChild(el._img);
  el._namebg = box('ufnamebg', UF.name, UF.name.w, UF.name.h);
  el._hp = box('ufbar hp', UF.hp, UF.hp.w, UF.hp.h); el._hpi = document.createElement('i'); el._hp.appendChild(el._hpi);
  el._pw = box('ufbar pw', UF.pw, UF.pw.w, UF.pw.h); el._pwi = document.createElement('i'); el._pw.appendChild(el._pwi);
  const bg = document.createElement('div'); bg.className = 'ufbg';
  bg.style.backgroundSize = 256 * s + 'px ' + 128 * s + 'px'; bg.style.backgroundPosition = (-UF.cropX * s) + 'px ' + (-UF.cropY * s) + 'px';
  el.appendChild(bg); el._bg = bg;
  el._name = box('ufname', UF.name, UF.name.w, UF.name.h);
  el._hpt = box('uftxt', { x: UF.hp.x, y: UF.hp.y - 2 }, UF.hp.w, UF.hp.h + 4);
  el._pwt = box('uftxt', { x: UF.pw.x, y: UF.pw.y - 2 }, UF.pw.w, UF.pw.h + 4);
  const lv = document.createElement('div'); lv.className = 'uflvl';
  lv.style.left = ((mirror ? UF.w - UF.level.x : UF.level.x) * s - 12) + 'px'; lv.style.top = (UF.level.y * s - 7) + 'px'; el.appendChild(lv); el._lv = lv;
  const A = UF.aura; const aw = A.perRow * A.d + (A.perRow - 1) * A.gap;
  el._auras = document.createElement('div'); el._auras.className = 'ufauras'; el._auras.style.left = X({ x: UF.name.x, w: aw }) + 'px'; el._auras.style.top = A.y * s + 'px'; el._auras.style.width = aw * s + 'px';
  if (mirror) el._auras.style.justifyContent = 'flex-end';
  el.appendChild(el._auras); el._rows = 0;
  return el;
}
function ufSet(el, k, v, fn) { if (el['_v' + k] !== v) { el['_v' + k] = v; fn(v); } }
/* a character's frame: portrait, name, level, health, power, combo points, cast bar, buffs */
function ufFillChar(me, c) {
  const r = rt(c); const s = charStats(c);
  ufSet(me, 'img', c.race + '_' + (c.gender || 0), () => { me._img.src = '../ui/CharacterFrame/TemporaryPortrait-' + (c.gender ? 'Female' : 'Male') + '-' + (RACE_PORTRAIT[c.race] || 'Orc') + '.png'; });
  ufSet(me, 'name', c.name, (v) => { me._name.textContent = v; });
  ufSet(me, 'lv', c.level, (v) => { me._lv.textContent = v; });
  ufSet(me, 'bg', 1, () => { me._bg.style.backgroundImage = 'url(' + ufFrameTexture(0) + ')'; me._namebg.style.background = 'rgba(0,0,0,.35)'; });
  const hp = Math.max(0, Math.round(c.hp)); const ghost = !!r.ghost;
  ufSet(me, 'hp', hp + '/' + s.maxHp + ghost, () => { me._hpi.style.width = (ghost ? 0 : 100 * hp / s.maxHp) + '%'; me._hpt.textContent = ghost ? 'Ghost' : hp + ' / ' + s.maxHp; });
  const pt = powerType(c); const pv = Math.round(powerOf(c, pt)), pm = Math.max(1, Math.round(powerMax(c, pt)));
  ufSet(me, 'pw', pt + ':' + pv + '/' + pm, () => { me._pwi.style.width = (100 * pv / pm) + '%'; me._pwi.className = 'p' + pt; me._pwt.textContent = pt === 0 ? pv + ' / ' + pm : powerName(pt) + ' ' + pv; });
  const cpn = r.cpTgt && r.cpTgt.st !== 'dead' ? r.cp || 0 : 0;
  ufSet(me, 'cp', cpn, (v) => { me._cp = me._cp || (() => { const d = document.createElement('div'); d.className = 'ufcp'; me.appendChild(d); return d; })(); me._cp.innerHTML = '<i class="on"></i>'.repeat(v) + (c.cls === 4 || c.form === 'cat' ? '<i></i>'.repeat(5 - v) : ''); });
  ufSet(me, 'cast', r.cast ? r.cast.name + Math.round(10 * r.cast.t / r.cast.total) : '', () => {
    me._cb = me._cb || (() => { const d = document.createElement('div'); d.className = 'ufcast'; d.innerHTML = '<i></i><span></span>'; me.appendChild(d); return d; })();
    me._cb.hidden = !r.cast; if (r.cast) { me._cb.firstChild.style.width = Math.min(100, 100 * r.cast.t / Math.max(0.01, r.cast.total)) + '%'; me._cb.lastChild.textContent = r.cast.name; }
  });
  ufSet(me, 'combat', !!(r.threats && r.threats.length), (v) => me.classList.toggle('combat', v));
  ufAuras(me, ufPlayerAuras(c, r));
}
/* a dungeon companion's frame: its class icon, name, health and role */
function ufFillComp(me, u, lvl) {
  ufSet(me, 'img', 'cls' + u.cls, () => { me._img.src = 'img/class/' + u.cls + '.png'; });
  ufSet(me, 'name', u.name, (v) => { me._name.textContent = v; });
  ufSet(me, 'lv', lvl, (v) => { me._lv.textContent = v; });
  ufSet(me, 'bg', 1, () => { me._bg.style.backgroundImage = 'url(' + ufFrameTexture(0) + ')'; me._namebg.style.background = 'rgba(0,0,0,.35)'; });
  const hp = Math.max(0, Math.round(u.hp));
  ufSet(me, 'hp', hp + '/' + u.maxhp + u.dead, () => { me._hpi.style.width = (u.dead ? 0 : 100 * hp / u.maxhp) + '%'; me._hpt.textContent = u.dead ? 'Dead' : hp + ' / ' + u.maxhp; });
  ufSet(me, 'pw', u.role, (v) => { me._pwi.style.width = '0%'; me._pwt.textContent = v === 'tank' ? 'Tank' : v === 'healer' ? 'Healer' : 'Damage'; });
  ufAuras(me, []);
}
/* a creature's frame, as seen by the character c */
function ufFillMob(e, m, c, isTgt) {
  const info = m.info; const beh = behOf(m, c);
  ufSet(e, 'id', m, () => {
    e._bg.style.backgroundImage = 'url(' + ufFrameTexture(m.rank) + ')';
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
  ufAuras(e, ufMobAuras(m));
}
/* the other members of the group (your other characters and the dungeon companions), each with what it is fighting */
function ufMates(c) {
  const out = [];
  if (typeof groupOf === 'function' && groupOf(c)) for (const o of groupChars(groupOf(c))) if (o !== c) out.push({ c: o });
  const p = typeof partyOf === 'function' ? partyOf(c) : null;
  if (p) for (const u of p) if (u.comp) out.push({ u });
  return out;
}
function ufMateTarget(o) {
  if (!o.c) return null; const r = rt(o.c);
  if (r.tgt && r.tgt.st !== 'dead' && r.tgt.st !== 'evade' && r.tgt.hp > 0) return r.tgt;
  return (r.threats || []).find((m) => m.st !== 'dead') || null;
}
function renderUnitFrames() {
  const box = $('unitframes'); if (!box) return;
  const c = active(); if (!c) return; const r = rt(c);
  /* the character on top across the whole card, below it the creatures it fights (up to five), the same size;
     in a group the other members follow, smaller, each with its own target */
  /* the width of the card, not counting a scrollbar of the left column: with many creatures the column grows, a scrollbar
     comes and goes, and the frames would rescale back and forth with it */
  const lc = $('left'); const sb = lc ? lc.offsetWidth - lc.clientWidth - (parseFloat(getComputedStyle(lc).borderRightWidth) || 0) : 0;
  const W = (box.clientWidth || 254) + Math.max(0, sb);
  if (!box._w || Math.abs(box._w - W) > 2) { box._w = W; box.innerHTML = ''; box._me = null; box._en = []; box._mt = []; }
  const sp = Math.min(1.6, (box._w - 4 - 18) / UF.w), se = sp * 0.94, sm = sp * 0.78, st = sp * 0.7;
  // the character
  if (!box._me) {
    box._me = ufMake(sp, true); box._me.classList.add('ufplayer'); box.appendChild(box._me);
    box._me.onclick = (e) => { if (e.target.closest('.ufpor')) openCharSwitch(); else openSheet('char'); };
    box._me._por.title = 'Characters - switch, or let them play on their own';
  }
  const me = box._me; ufFillChar(me, c);
  // the creatures it fights: current target first
  const list = []; if (r.tgt && r.tgt.st !== 'dead' && (r.tgt.tgt === c || (r.threats || []).length === 0)) list.push(r.tgt);
  for (const m of r.threats || []) if (!list.includes(m)) list.push(m);
  const mates = ufMates(c);
  const shown = list.slice(0, mates.length ? 3 : UF.maxEnemies);
  while (box._en.length < shown.length) { const e = ufMake(se, false); e.classList.add('ufenemy'); box.appendChild(e); box._en.push(e); e.onclick = () => { if (e._mob) { G.selected = { kind: 'mob', mob: e._mob }; renderInfo(G.selected); } }; }
  let y = ufSlot(me) * sp + 6;
  box._en.forEach((e, i) => {
    const m = shown[i]; e.style.display = m ? '' : 'none'; e._mob = m || null; if (!m) return;
    e.style.top = Math.round(y) + 'px'; ufFillMob(e, m, c, m === r.tgt);
    y += ufSlot(e) * se + 3;
  });
  // the group
  while (box._mt.length < mates.length) {
    const sep = document.createElement('div'); sep.className = 'ufsep'; box.appendChild(sep);
    const f = ufMake(sm, true); f.classList.add('ufmate'); box.appendChild(f);
    const t = ufMake(st, false); t.classList.add('ufenemy', 'ufmtgt'); box.appendChild(t);
    const slot = { sep, f, t }; box._mt.push(slot);
    f.onclick = () => { if (slot.o && slot.o.c) switchCharacter(slot.o.c.id); };
    t.onclick = () => { if (t._mob) { G.selected = { kind: 'mob', mob: t._mob }; renderInfo(G.selected); } };
  }
  box._mt.forEach((slot, i) => {
    const o = mates[i]; slot.o = o || null; const on = !!o;
    slot.sep.style.display = slot.f.style.display = on ? '' : 'none'; if (!on) { slot.t.style.display = 'none'; return; }
    slot.sep.style.top = Math.round(y) + 'px'; y += 5;
    slot.f.style.top = Math.round(y) + 'px';
    if (o.c) { ufFillChar(slot.f, o.c); slot.f.title = 'Play ' + o.c.name; } else { ufFillComp(slot.f, o.u, c.level); slot.f.title = o.u.name + ' (companion)'; }
    slot.f.classList.toggle('dead', !!(o.u ? o.u.dead : rt(o.c).ghost));
    y += ufSlot(slot.f) * sm + 2;
    const m = ufMateTarget(o); slot.t.style.display = m ? '' : 'none'; slot.t._mob = m;
    if (m) { slot.t.style.top = Math.round(y) + 'px'; ufFillMob(slot.t, m, o.c, true); y += ufSlot(slot.t) * st + 3; }
  });
  box.style.height = Math.ceil(shown.length || mates.length ? y : ufSlot(me) * sp) + 'px';
  me.style.top = '0px';
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
