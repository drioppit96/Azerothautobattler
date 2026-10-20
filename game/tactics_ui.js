'use strict';
/* tactics_ui.js - the abilities list of the "Abilities & behaviour" tab. Every ability (or item) once, in the order
   they are tried, and under it the conditions it is used on - one or more, the first one that is true picks the target:
   Heal  when  Ally: the tank's health < 60%
         or    Ally: health < 50%
         or    Self: health < 40%
   Click a condition for the list of conditions (Self / Ally / Enemy, then the number). The presets (Default by talents and
   role, Damage, Tank, Healer) are what every character plays until it is changed; changing one makes it a Custom list.
   The data under it is the tactics list of tactics.js (one slot per condition). */

const TACUI = { pop: null };
function tacCondText(sl) {
  const cd = TAC_CONDS[sl.c]; if (!cd) return 'Choose a condition';
  return cd.g + ': ' + cd.t.replace('X', sl.p != null ? sl.p : cd.p);
}
function tacActName(a) {
  if (a === '>end' || (a && a[0] === '>')) return 'Stop here';
  if (a === '#wait') return 'Wait';
  if (a === '#atk') return 'Attack (switch to that enemy)';
  if (a && a[0] === '#') return TAC_ITEMS[a] || a;
  return a || '?';
}
function tacActIcon(c, a) {
  if (!a) return '';
  if (a[0] === '#' || a[0] === '>') {
    const ic = { '#hp': 'inv_potion_54', '#hpmin': 'inv_potion_51', '#stone': 'inv_stone_04', '#mp': 'inv_potion_76', '#mpmin': 'inv_potion_72', '#band': 'inv_misc_bandage_15', '#bomb': 'inv_misc_bomb_04', '#atk': 'ability_meleedamage', '#wait': 'spell_nature_timestop' }[a] || 'spell_holy_sealofsacrifice';
    return '<img class="sic" src="../icons/' + ic + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'">';
  }
  const id = c.known && c.known[a]; const sp = id ? spellRow(id) : null;
  if (sp) return spellIcon(sp);
  const l = classAbilityList(c.cls)[a]; return l && l[0] ? spellIcon(l[0]) : '<span class="sic"></span>';
}

/* ------------------------------------------------------------------ slots <-> abilities */
/* the slots by ability: [{a, conds: [{c, p, off}]}], in the order each ability first comes */
function tacGroup(slots) {
  const out = []; const at = {};
  for (const s of slots || []) {
    if (!s || !s.a) continue; const a = s.a[0] === '>' ? '>end' : s.a;
    let g = at[a]; if (!g) { g = at[a] = { a, conds: [] }; out.push(g); }
    g.conds.push({ c: s.c, p: s.p, off: s.off });
  }
  return out;
}
function tacFlat(gs) {
  const out = [];
  for (const g of gs) for (const k of g.conds) { const s = { c: k.c, a: g.a }; if (k.p != null) s.p = k.p; if (k.off) s.off = true; out.push(s); }
  return out;
}
/* a condition to start a new ability with: what it is made for */
function tacDefaultCond(c, a) {
  if (a === '>end') return { c: 'self.mp<', p: 30 };
  if (a === '#hp' || a === '#hpmin' || a === '#stone' || a === '#band') return { c: 'self.hp<', p: 30 };
  if (a === '#mp' || a === '#mpmin') return { c: 'self.mp<', p: 20 };
  if (a === '#bomb') return { c: 'enemy.clus>', p: 3 };
  if (a === '#atk') return { c: 'enemy.onally' };
  if (a === '#wait') return { c: 'self.mp<', p: 10 };
  const sp = c.known && c.known[a] ? spellRow(c.known[a]) : null; const ef = (sp && sp.ef) || [];
  if (TAC_INTERRUPTS.has(a)) return { c: 'enemy.cast' };
  if (TAC_CC[a]) return { c: 'enemy.loose' };
  if (TAC_DISPELS[a]) return { c: 'ally.disp' };
  if (ef.some((e) => e.k === 'area_enemy')) return { c: 'enemy.clus>', p: 3 };
  if (ef.some((e) => e.k === 'enemy')) return ef.some((e) => (e.t === 6 || e.t === 35) && e.k === 'enemy') && !ef.some((e) => e.t === 2) ? { c: 'enemy.nodeb' } : { c: 'enemy.tgt' };
  const heal = ef.some((e) => e.t === 10 || e.au === 8);
  if (heal) return ef.some((e) => e.k === 'friend') ? { c: 'ally.hp<', p: 60 } : { c: 'self.hp<', p: 50 };
  if (ef.some((e) => e.k === 'friend')) return { c: 'ally.nobuff' };
  return { c: 'self.nobuff' };
}
/* change the list (a built-in preset first becomes a Custom list) */
function tacEdit(c, fn) {
  const L = tacEditable(c); if (!L) return;
  const gs = tacGroup(L); fn(gs);
  const flat = tacFlat(gs.filter((g) => g.conds.length));
  if (flat.length > TAC_MAX) { log('At most ' + TAC_MAX + ' conditions in all.'); return; }
  L.splice(0, L.length, ...flat); tacChanged(c);
}
function tacEditable(c) {
  const T = tacState(c); if (/^c\d$/.test(T.preset)) { T.custom[T.preset] = T.custom[T.preset] || []; return T.custom[T.preset]; }
  const copy = tacSlots(c).map((s) => Object.assign({}, s));
  let k = ['c1', 'c2', 'c3'].find((x) => !(T.custom[x] || []).length);
  if (!k) { if (!confirm('All three Custom lists are in use. Replace Custom 1 with a copy of this preset?')) return null; k = 'c1'; }
  T.custom[k] = copy; const was = TAC_PRESETS[T.preset]; T.preset = k; log('Abilities: "' + was + '" copied into ' + TAC_PRESETS[k] + ' to change it.');
  return T.custom[k];
}
function tacChanged(c) { rt(c).tacCache = null; save(); renderSheet(); if (typeof renderAbar === 'function') renderAbar(); }

/* ------------------------------------------------------------------ the list in the tab */
function tacPresetHtml(c) {
  const T = tacState(c);
  return '<div class="tacpre"><label>Preset</label><select data-tacpreset="1">' + Object.entries(TAC_PRESETS).map(([k, t]) => '<option value="' + k + '"' + (T.preset === k ? ' selected' : '') + '>' + esc(t + (/^c\d$/.test(k) && !(T.custom[k] || []).length ? ' (empty)' : '')) + '</option>').join('') + '</select>' +
    '<span class="small muted">' + tacNote(c) + '</span></div>';
}
function tacAbilHtml(c) {
  const T = tacState(c); const gs = tacGroup(tacSlots(c)); const n = tacSlots(c).length;
  let h = '<div class="sgroup tacab' + (T.on === false ? ' dimmed' : '') + '"><h5>Abilities - tried from the top; under each, the conditions it is used on (the first true one picks the target)</h5>';
  if (!/^c\d$/.test(T.preset)) h += '<div class="small muted" style="margin-bottom:4px">A ready-made list - changing anything copies it into a Custom list of your own.</div>';
  if (!gs.length) h += '<div class="muted small">No abilities in this list yet.</div>';
  gs.forEach((g, gi) => {
    const a = g.a; const off = g.conds.every((k) => k.off);
    const spell = a[0] !== '#' && a[0] !== '>';
    const known = !spell || (c.known && c.known[a]);
    let info = '';
    if (spell && known) {
      const sp = spellRow(c.known[a]); const u = abilityUsable(c, a);
      const ct = sp && sp.pw ? spellCost(c, sp, a) : [0, 0]; const castS = sp ? castTime(c, sp) : 0; const cd = sp && (sp.cd || sp.catcd) ? ((sp.cd || sp.catcd) / 1000) + 's cd' : '';
      info = [ct[1] ? ct[1] + ' ' + (ct[0] === -2 ? 'health' : powerName(ct[0]).toLowerCase()) : '', castS ? castS.toFixed(1) + 's cast' : sp && isChanneled(sp) ? 'channeled' : '', cd].filter(Boolean).join(', ') + (u.ok ? '' : ' <span style="color:#e6b93c">' + esc(u.why) + '</span>');
    } else if (spell) info = '<i>not learned yet</i>';
    else if (a === '>end') info = 'while true, nothing below it is used (the wand / auto attack does the rest)';
    else if (a[0] === '#' && TAC_ITEMS[a]) info = 'an item from the bags';
    h += '<div class="tabk' + (off ? ' off' : '') + (known ? '' : ' unk') + '"><div class="tabh">' +
      '<input type="checkbox" data-tgon="' + gi + '"' + (off ? '' : ' checked') + ' title="Use this ability">' + tacActIcon(c, a) +
      '<div class="aname"><b>' + esc(tacActName(a)) + '</b><div class="small muted">' + info + '</div></div>' +
      '<span class="updn"><button class="mini" data-tgup="' + gi + '"' + (gi ? '' : ' disabled') + ' title="Try it earlier">&#9650;</button><button class="mini" data-tgdn="' + gi + '"' + (gi < gs.length - 1 ? '' : ' disabled') + ' title="Try it later">&#9660;</button><button class="mini" data-tgdel="' + gi + '" title="Take it out of the list">&#10005;</button></span></div>';
    h += '<div class="tabcs">';
    g.conds.forEach((k, j) => {
      const cd = TAC_CONDS[k.c];
      h += '<div class="tabc' + (k.off ? ' off' : '') + '"><span class="tabw">' + (j ? 'or' : 'when') + '</span>' +
        '<button class="tcbtn ' + (cd ? cd.g.toLowerCase() : '') + '" data-tgc="' + gi + ':' + j + '">' + esc(tacCondText(k)) + ' &#9662;</button>' +
        (j ? '<button class="mini" data-tgcu="' + gi + ':' + j + '" title="Check it first">&#9650;</button>' : '<span></span>') +
        '<button class="mini" data-tgcx="' + gi + ':' + j + '" title="Remove this condition">&#10005;</button></div>';
    });
    h += '<button class="mini tabadd" data-tgca="' + gi + '">+ another condition</button></div></div>';
  });
  h += '<div class="tabfoot"><button data-tgadd="1">+ Add an ability or item</button><span class="small muted">' + n + ' / ' + TAC_MAX + ' conditions</span>' +
    '<label class="chk small"><input type="checkbox" data-tacoff="1"' + (T.on === false ? ' checked' : '') + '> No abilities at all (only auto attack)</label></div>';
  return h + '</div>';
}
function tacNote(c) {
  const T = tacState(c);
  if (T.preset === 'auto') { const role = tacRole(c); const k = tacAutoKind(c, role); return 'Plays: <b>' + esc(TAC_PRESETS[k]) + '</b>' + (role === 'solo' ? ' (alone)' : ' (group role: ' + esc(role) + ')'); }
  if (T.preset === 'classic') return 'the older list below, by modes';
  return esc((CLASS_NAMES[c.cls] || '') + ' - ' + (((TALENT_BUILDS[c.cls] || {})[rotationSpec(c)] || {}).name || rotationSpec(c)));
}

/* ------------------------------------------------------------------ popups */
function tacPopup(anchor, html, onPick) {
  tacClosePop();
  const el = document.createElement('div'); el.id = 'tacpop'; el.innerHTML = html; document.body.appendChild(el);
  const r = anchor.getBoundingClientRect(); const W = window.innerWidth, H = window.innerHeight;
  el.style.left = Math.max(4, Math.min(W - el.offsetWidth - 4, r.left)) + 'px';
  el.style.top = (r.bottom + el.offsetHeight + 4 > H ? Math.max(4, r.top - el.offsetHeight - 2) : r.bottom + 2) + 'px';
  el.onclick = (e) => { const b = e.target.closest('[data-pk]'); if (!b) return; e.stopPropagation(); if (onPick(b.dataset.pk, b) !== false) tacClosePop(); };
  TACUI.pop = el;
  setTimeout(() => document.addEventListener('pointerdown', tacOutside, true), 0);
}
function tacOutside(e) { if (TACUI.pop && !TACUI.pop.contains(e.target)) tacClosePop(); }
function tacClosePop() { if (TACUI.pop) { TACUI.pop.remove(); TACUI.pop = null; } document.removeEventListener('pointerdown', tacOutside, true); }
const TAC_VALUES = { 'self.hp<': [10, 15, 20, 25, 30, 40, 50, 60, 75, 90], 'self.hp>': [50, 75, 90], 'self.mp<': [5, 10, 15, 20, 25, 30, 40, 50, 70, 75], 'self.mp>': [25, 50, 75, 90],
  'self.rage>': [10, 15, 20, 30, 40, 50, 60, 80], 'self.rage<': [5, 10, 15, 20, 30], 'self.cp>': [1, 2, 3, 4, 5], 'self.att>': [1, 2, 3, 4, 5], 'self.sur>': [1, 2, 3, 4, 5], 'self.pethp<': [25, 40, 50, 75],
  'ally.hp<': [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90], 'ally.tank<': [20, 30, 40, 50, 60, 70, 80, 90], 'ally.mp<': [10, 20, 30, 50], 'ally.hurt>': [2, 3, 4, 5],
  'enemy.hp<': [10, 20, 25, 35, 50], 'enemy.hp>': [50, 75, 90], 'enemy.stack<': [1, 2, 3, 4, 5], 'enemy.clus>': [2, 3, 4, 5], 'enemy.att>': [2, 3, 4, 5, 6] };
/* the condition list: Self / Ally / Enemy, then the number when it has one; cb(key, number) */
/* which kinds of conditions fit an action: items are for oneself, an ability on others only when it can be cast on them */
function tacCondGroups(c, a) {
  if (a === '#bomb' || a === '#atk') return ['Self', 'Enemy'];
  if (a[0] === '#') return a === '#wait' ? ['Self', 'Ally', 'Enemy'] : ['Self'];
  if (a === '>end') return ['Self', 'Ally', 'Enemy'];
  const sp = c.known && c.known[a] ? spellRow(c.known[a]) : null; const ef = (sp && sp.ef) || [];
  return ef.some((e) => e.k === 'friend') ? ['Self', 'Ally', 'Enemy'] : ['Self', 'Enemy'];
}
function tacCondPick(anchor, cb, groups) {
  let h = '<div class="tpcols"><div class="tpcol">';
  for (const g of groups || ['Self', 'Ally', 'Enemy']) {
    h += '<div class="tphead">' + g + '</div>';
    for (const k of TAC_COND_ORDER) { const cd = TAC_CONDS[k]; if (cd.g !== g) continue; h += '<button class="tpitem" data-pk="' + k + '">' + esc(cd.t) + (cd.p != null ? ' &#9656;' : '') + '</button>'; }
  }
  h += '</div><div class="tpcol tpvals" hidden></div></div>';
  tacPopup(anchor, h, (k, b) => {
    const cd = TAC_CONDS[k]; if (!cd) return;
    if (cd.p != null && !b.dataset.v) {
      const col = TACUI.pop.querySelector('.tpvals'); col.hidden = false;
      col.innerHTML = '<div class="tphead">' + esc(cd.g + ': ' + cd.t) + '</div>' + (TAC_VALUES[k] || [cd.p]).map((v) => '<button class="tpitem" data-pk="' + k + '" data-v="' + v + '">' + esc(cd.t.replace('X', v)) + '</button>').join('');
      return false;
    }
    cb(k, b.dataset.v != null ? +b.dataset.v : cd.p);
  });
}
/* abilities (with their icons), items, stop / wait / attack; cb(action) */
function tacActPick(c, anchor, cb) {
  const names = Object.keys(c.known || {}).filter((n) => !(typeof PET_SPELLS !== 'undefined' && PET_SPELLS.has(n))).sort();
  const h = '<div class="tpcols"><div class="tpcol"><div class="tphead">Abilities</div>' +
    (names.map((n) => '<button class="tpitem ab" data-pk="' + esc(n) + '">' + spellIcon(spellRow(c.known[n])) + esc(n) + '</button>').join('') || '<div class="small muted">Nothing learned yet.</div>') +
    '</div><div class="tpcol"><div class="tphead">Items</div>' + Object.entries(TAC_ITEMS).map(([x, t]) => '<button class="tpitem" data-pk="' + x + '">' + tacActIcon(c, x) + esc(t) + '</button>').join('') +
    '<div class="tphead">Other</div><button class="tpitem" data-pk="#atk">' + tacActIcon(c, '#atk') + 'Attack (switch to that enemy)</button><button class="tpitem" data-pk=">end">' + tacActIcon(c, '>end') + 'Stop here (save the rest)</button><button class="tpitem" data-pk="#wait">' + tacActIcon(c, '#wait') + 'Wait</button></div></div>';
  tacPopup(anchor, h, (k) => cb(k));
}

/* ------------------------------------------------------------------ clicks */
function tacBehClick(e) {
  const c = active(); const t = e.target;
  const pr = (s) => s.split(':').map(Number);
  let b;
  const actOf = (gi) => { const g = tacGroup(tacSlots(c))[gi]; return g ? g.a : ''; };
  if ((b = t.closest('[data-tgc]'))) { const [gi, j] = pr(b.dataset.tgc); tacCondPick(b, (k, p) => tacEdit(c, (gs) => { const x = gs[gi] && gs[gi].conds[j]; if (x) { x.c = k; x.p = p; } }), tacCondGroups(c, actOf(gi))); return true; }
  if ((b = t.closest('[data-tgca]'))) { const gi = +b.dataset.tgca; tacCondPick(b, (k, p) => tacEdit(c, (gs) => { if (gs[gi]) gs[gi].conds.push({ c: k, p }); }), tacCondGroups(c, actOf(gi))); return true; }
  if ((b = t.closest('[data-tgcx]'))) { const [gi, j] = pr(b.dataset.tgcx); tacEdit(c, (gs) => { if (gs[gi]) gs[gi].conds.splice(j, 1); }); return true; }
  if ((b = t.closest('[data-tgcu]'))) { const [gi, j] = pr(b.dataset.tgcu); tacEdit(c, (gs) => { const L = gs[gi] && gs[gi].conds; if (L && j > 0) { const x = L[j - 1]; L[j - 1] = L[j]; L[j] = x; } }); return true; }
  if ((b = t.closest('[data-tgup]'))) { const gi = +b.dataset.tgup; tacEdit(c, (gs) => { if (gi > 0) { const x = gs[gi - 1]; gs[gi - 1] = gs[gi]; gs[gi] = x; } }); return true; }
  if ((b = t.closest('[data-tgdn]'))) { const gi = +b.dataset.tgdn; tacEdit(c, (gs) => { if (gi < gs.length - 1) { const x = gs[gi + 1]; gs[gi + 1] = gs[gi]; gs[gi] = x; } }); return true; }
  if ((b = t.closest('[data-tgdel]'))) { const gi = +b.dataset.tgdel; tacEdit(c, (gs) => { gs.splice(gi, 1); }); return true; }
  if ((b = t.closest('[data-tgadd]'))) {
    tacActPick(c, b, (a) => tacEdit(c, (gs) => { const g = gs.find((x) => x.a === a); const d = tacDefaultCond(c, a); if (g) g.conds.push(d); else gs.push({ a, conds: [d] }); }));
    return true;
  }
  return false;
}
function tacChange(e) {
  const c = active(); const t = e.target; const T = tacState(c);
  if (t.dataset.tgon != null) { const gi = +t.dataset.tgon; const on = t.checked; tacEdit(c, (gs) => { if (gs[gi]) for (const k of gs[gi].conds) k.off = !on; }); return true; }
  if (t.dataset.tacpreset) { T.preset = t.value; rt(c).tacCache = null; save(); renderSheet(); if (typeof renderAbar === 'function') renderAbar(); return true; }
  if (t.dataset.tacoff) { T.on = !t.checked; save(); renderSheet(); return true; }
  return false;
}
