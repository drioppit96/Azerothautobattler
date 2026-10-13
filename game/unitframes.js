'use strict';
/* unitframes.js - WoW style unit frames in the character card: the character (portrait on the left) and up to
   five creatures it is fighting (portrait on the right), made from the client textures in ui/TargetingFrame. */

const UF = {
  /* the used part of UI-TargetingFrame.png (256x128): x 24..230, y 8..86 */
  cropX: 24, cropY: 8, w: 206, h: 78,
  portrait: { x: 128, y: 8, d: 57 }, name: { x: 7, y: 17, w: 114, h: 14 },
  hp: { x: 7, y: 36, w: 112, h: 7 }, pw: { x: 7, y: 47, w: 114, h: 7 }, level: { x: 182, y: 60 },
  maxEnemies: 5,
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
  el._auras = document.createElement('div'); el._auras.className = 'ufauras'; el._auras.style.left = X({ x: UF.name.x, w: UF.name.w }) + 'px'; el._auras.style.top = (UF.pw.y + UF.pw.h + 2) * s + 'px'; el.appendChild(el._auras);
  return el;
}
function ufSet(el, k, v, fn) { if (el['_v' + k] !== v) { el['_v' + k] = v; fn(v); } }
function renderUnitFrames() {
  const box = $('unitframes'); if (!box) return;
  const c = active(); if (!c) return; const r = rt(c); const s = charStats(c);
  /* the character on top across the whole card, below it the creatures it fights (up to five), the same size */
  const W = box.clientWidth || 254;
  const sp = Math.min(1.6, (W - 4) / UF.w), se = sp * 0.94;
  if (box._w !== W) { box._w = W; box.innerHTML = ''; box._me = null; box._en = []; }
  // the character
  if (!box._me) {
    box._me = ufMake(sp, true); box._me.classList.add('ufplayer'); box.appendChild(box._me);
    box._me.onclick = () => openSheet('char');
  }
  const me = box._me;
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
  ufSet(me, 'auras', (r.buffs || []).filter((b) => b.until > G.gameTime).map((b) => b.name).join(','), (v) => { me._auras.innerHTML = v ? v.split(',').map((n) => '<i title="' + esc(n) + '">' + ufAuraIcon(n) + '</i>').join('') : ''; });
  // the creatures it fights: current target first
  const list = []; if (r.tgt && r.tgt.st !== 'dead' && (r.tgt.tgt === c || (r.threats || []).length === 0)) list.push(r.tgt);
  for (const m of r.threats || []) if (!list.includes(m)) list.push(m);
  const shown = list.slice(0, UF.maxEnemies);
  while (box._en.length < shown.length) { const e = ufMake(se, false); e.classList.add('ufenemy'); box.appendChild(e); box._en.push(e); e.onclick = () => { if (e._mob) { G.selected = { kind: 'mob', mob: e._mob }; renderInfo(G.selected); } }; }
  box._en.forEach((e, i) => {
    const m = shown[i]; e.style.display = m ? '' : 'none'; e._mob = m || null; if (!m) return;
    e.style.top = Math.round(UF.h * sp + 6 + i * (UF.h * se + 3)) + 'px';
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
    ufSet(e, 'tgt', m === r.tgt, (v) => e.classList.toggle('target', v));
    const au = (m.auras || []).filter((a) => a.until > G.gameTime).map((a) => a.key + (a.stacks > 1 ? ' x' + a.stacks : '')).join(',');
    ufSet(e, 'auras', au, (v) => { e._auras.innerHTML = v ? v.split(',').map((n) => '<i title="' + esc(n) + '">' + ufAuraIcon(n.replace(/ x\d+$/, '')) + '</i>').join('') : ''; });
  });
  const hE = shown.length ? 6 + shown.length * (UF.h * se + 3) : 0, hP = UF.h * sp;
  box.style.height = Math.ceil(hP + hE) + 'px';
  me.style.top = '0px';
}
/* a small icon for a buff / debuff by spell name (from the spell data), or its first letter */
function ufAuraIcon(name) {
  G.auraIcon = G.auraIcon || {};
  if (!(name in G.auraIcon)) {
    let ic = null; const sp = G.d.spells && G.d.spells.spells;
    if (sp) for (const id in sp) if (sp[id].n === name && sp[id].ic) { ic = sp[id].ic; break; }
    G.auraIcon[name] = ic;
  }
  const ic = G.auraIcon[name];
  return ic ? '<img src="../icons/' + esc(ic.toLowerCase()) + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'">' : esc(name[0]);
}
