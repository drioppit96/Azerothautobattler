'use strict';
/* tactics_ui.js - the Tactics tab of the Character window, a book like Dragon Age: Origins: the character (with arrows
   to the others), Presets and Behavior at the top, then the slots - number, condition, action. Click the condition or
   the action for a list to choose from (abilities with their icons, items, jump to a tactic, wait, attack); the + of a
   row inserts, moves, disables or deletes. Changing a preset makes it a Custom one (like the game: "Custom 1*"). */

const TACUI = { pop: null };
function tacCondText(sl) {
  const cd = TAC_CONDS[sl.c]; if (!cd) return 'Choose a condition';
  return cd.g + ': ' + cd.t.replace('X', sl.p != null ? sl.p : cd.p);
}
function tacActText(c, sl) {
  if (!sl.a) return 'Choose an action';
  if (sl.a[0] === '>') return +sl.a.slice(1) > tacSlots(c).length ? 'Jump to the end (stop here)' : 'Jump to tactic ' + sl.a.slice(1);
  if (sl.a === '#wait') return 'Wait';
  if (sl.a === '#atk') return 'Attack';
  if (sl.a[0] === '#') return TAC_ITEMS[sl.a] || sl.a;
  return sl.a;
}
function tacActIcon(c, sl) {
  if (!sl.a) return '';
  if (sl.a[0] === '#' || sl.a[0] === '>') {
    const ic = { '#hp': 'inv_potion_54', '#hpmin': 'inv_potion_51', '#stone': 'inv_stone_04', '#mp': 'inv_potion_76', '#mpmin': 'inv_potion_72', '#band': 'inv_misc_bandage_15', '#bomb': 'inv_misc_bomb_04', '#atk': 'ability_meleedamage', '#wait': 'spell_nature_timestop' }[sl.a] || 'ability_spy';
    return '<img class="sic" src="../icons/' + ic + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'">';
  }
  const id = c.known && c.known[sl.a]; const sp = id ? spellRow(id) : null;
  if (sp) return spellIcon(sp);
  const l = classAbilityList(c.cls)[sl.a]; return l && l[0] ? spellIcon(l[0]) : '<span class="sic"></span>';
}
function tacHtml(c) {
  const T = tacState(c); const slots = T.preset === 'classic' ? [] : tacSlots(c);
  const chars = G.state.characters; const others = chars.length > 1;
  let h = '<div class="tacbook"><div class="tacspine"></div>';
  h += '<div class="tactop"><div class="tachalf"><div class="tacname">' + (others ? '<button class="tacarr" data-tacch="-1">&#9664;</button>' : '') + '<span>' + esc(c.name) + '</span>' + (others ? '<button class="tacarr" data-tacch="1">&#9654;</button>' : '') + '</div>' +
    '<div class="tacsel"><span>Presets</span><select data-tacpreset="1">' + Object.entries(TAC_PRESETS).map(([k, t]) => '<option value="' + k + '"' + (T.preset === k ? ' selected' : '') + '>' + esc(t + (/^c\d$/.test(k) && !(T.custom[k] || []).length ? ' (empty)' : '')) + '</option>').join('') + '</select></div></div>' +
    '<div class="tachalf"><div class="tacsel"><span>Behavior</span><select data-tacbeh="1">' + Object.entries(TAC_BEHAVIOR).map(([k, t]) => '<option value="' + k + '"' + ((c.cfg.style || 'balanced') === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>' +
    '<div class="small tacnote">' + tacNote(c) + '</div></div></div>';
  if (T.preset === 'classic') {
    h += '<div class="tacempty">This character plays its own list from the <a href="#" data-tacgo="beh">Abilities &amp; behaviour</a> tab. Choose a preset above to use tactics.</div>';
  } else {
    h += '<div class="tacrows' + (T.on === false ? ' off' : '') + '">';
    slots.forEach((sl, i) => {
      const known = !sl.a || sl.a[0] === '#' || sl.a[0] === '>' || (c.known && c.known[sl.a]);
      h += '<div class="tacrow' + (sl.off ? ' dis' : '') + (known ? '' : ' unk') + '"><div class="tachalf"><button class="tacplus" data-tacplus="' + i + '" title="Insert, move, disable or delete">&#10010;</button><span class="tacnum">' + (i + 1) + '</span>' +
        '<button class="taccond' + (TAC_CONDS[sl.c] && TAC_CONDS[sl.c].g === 'Enemy' ? ' en' : '') + '" data-taccond="' + i + '">' + esc(tacCondText(sl)) + '</button></div>' +
        '<div class="tachalf"><button class="tacact" data-tacact="' + i + '"><span>' + esc(tacActText(c, sl)) + (known ? '' : ' <i>(not learned yet)</i>') + '</span>' + tacActIcon(c, sl) + '</button></div></div>';
    });
    if (slots.length < TAC_MAX) h += '<div class="tacrow add"><div class="tachalf"><button class="tacplus" data-tacadd="1">&#10010;</button><span class="tacnum">' + (slots.length + 1) + '</span><button class="taccond" data-tacadd="1">Add a tactic</button></div><div class="tachalf"></div></div>';
    h += '</div>';
  }
  h += '<div class="tacbottom"><label class="chk"><input type="checkbox" data-tacoff="1"' + (T.on === false ? ' checked' : '') + '> Disable tactics <span class="muted small">(only the behavior: auto attack)</span></label>' +
    '<span class="small muted">' + slots.length + ' / ' + TAC_MAX + ' tactics - checked from the top; the first that can be done is done.</span></div>';
  h += '</div>';
  return h;
}
function tacNote(c) {
  const T = tacState(c);
  if (T.preset === 'auto') { const role = tacRole(c); const k = tacAutoKind(c, role); return 'Plays: <b>' + esc(TAC_PRESETS[k]) + '</b>' + (role === 'solo' ? ' (alone)' : ' (group role: ' + esc(role) + ')'); }
  return esc((CLASS_NAMES[c.cls] || '') + ' - ' + (((TALENT_BUILDS[c.cls] || {})[rotationSpec(c)] || {}).name || rotationSpec(c)));
}
/* ------------------------------------------------------------------ editing */
/* the list to change: a built-in preset becomes the first free Custom list */
function tacEditable(c) {
  const T = tacState(c); if (/^c\d$/.test(T.preset)) { T.custom[T.preset] = T.custom[T.preset] || []; return T.custom[T.preset]; }
  const copy = tacSlots(c).map((s) => Object.assign({}, s));
  let k = ['c1', 'c2', 'c3'].find((x) => !(T.custom[x] || []).length);
  if (!k) { if (!confirm('All three Custom lists are in use. Replace Custom 1 with a copy of this preset?')) return null; k = 'c1'; }
  T.custom[k] = copy; const was = TAC_PRESETS[T.preset]; T.preset = k; log('Tactics: "' + was + '" copied into ' + TAC_PRESETS[k] + ' to change it.');
  return T.custom[k];
}
function tacChanged(c) { rt(c).tacCache = null; save(); renderSheet(); }
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
const TAC_VALUES = { 'self.hp<': [10, 15, 20, 25, 30, 40, 50, 60, 75, 90], 'self.hp>': [50, 75, 90], 'self.mp<': [5, 10, 15, 20, 25, 30, 40, 50, 75], 'self.mp>': [25, 50, 75, 90],
  'self.rage>': [10, 15, 20, 30, 40, 50, 60, 80], 'self.rage<': [5, 10, 15, 20, 30], 'self.cp>': [1, 2, 3, 4, 5], 'self.att>': [1, 2, 3, 4, 5], 'self.sur>': [1, 2, 3, 4, 5], 'self.pethp<': [25, 40, 50, 75],
  'ally.hp<': [10, 20, 25, 30, 40, 50, 60, 75, 90], 'ally.tank<': [20, 30, 40, 50, 60, 70, 80, 90], 'ally.mp<': [10, 20, 30, 50], 'ally.hurt>': [2, 3, 4, 5],
  'enemy.hp<': [10, 20, 25, 35, 50], 'enemy.hp>': [50, 75, 90], 'enemy.stack<': [1, 2, 3, 4, 5], 'enemy.clus>': [2, 3, 4, 5], 'enemy.att>': [2, 3, 4, 5, 6] };
function tacCondPopup(c, i, anchor) {
  let h = '<div class="tpcols"><div class="tpcol">';
  for (const g of ['Self', 'Ally', 'Enemy']) {
    h += '<div class="tphead">' + g + '</div>';
    for (const k of TAC_COND_ORDER) { const cd = TAC_CONDS[k]; if (cd.g !== g) continue; h += '<button class="tpitem" data-pk="' + k + '">' + esc(cd.t) + (cd.p != null ? ' &#9656;' : '') + '</button>'; }
  }
  h += '</div><div class="tpcol tpvals" hidden></div></div>';
  tacPopup(anchor, h, (k, b) => {
    const cd = TAC_CONDS[k]; if (!cd) return;
    if (cd.p != null && !b.dataset.v) {
      const col = TACUI.pop.querySelector('.tpvals'); col.hidden = false;
      col.innerHTML = '<div class="tphead">' + esc(g0(cd)) + '</div>' + (TAC_VALUES[k] || [cd.p]).map((v) => '<button class="tpitem" data-pk="' + k + '" data-v="' + v + '">' + esc(cd.t.replace('X', v)) + '</button>').join('');
      return false;
    }
    const L = tacEditable(c); if (!L) return; if (!L[i]) L[i] = { c: k, a: null };
    L[i].c = k; L[i].p = b.dataset.v != null ? +b.dataset.v : cd.p; tacChanged(c);
  });
  function g0(cd) { return cd.g + ': ' + cd.t; }
}
function tacActPopup(c, i, anchor) {
  const names = Object.keys(c.known || {}).filter((n) => !(typeof PET_SPELLS !== 'undefined' && PET_SPELLS.has(n))).sort();
  const slots = tacSlots(c);
  let h = '<div class="tpcols"><div class="tpcol tpmain">' +
    '<button class="tpitem" data-pk="#clear">Clear</button><button class="tpitem" data-pk="#wait">Wait</button><button class="tpitem" data-pk="#atk">Attack (switch to this enemy)</button>' +
    '<button class="tpitem" data-pk="@ab">&#9664; Use ability</button><button class="tpitem" data-pk="@it">&#9664; Use item</button><button class="tpitem" data-pk="@jump">&#9664; Jump to tactic</button>' +
    '<button class="tpitem" data-pk="#toggle">' + (slots[i] && slots[i].off ? 'Enable' : 'Disable') + ' this tactic</button></div><div class="tpcol tpsub" hidden></div></div>';
  tacPopup(anchor, h, (k, b) => {
    const sub = TACUI.pop.querySelector('.tpsub');
    if (k === '@ab') { sub.hidden = false; sub.innerHTML = names.map((n) => '<button class="tpitem ab" data-pk="=' + esc(n) + '">' + spellIcon(spellRow(c.known[n])) + esc(n) + '</button>').join('') || '<div class="small muted">Nothing learned yet.</div>'; return false; }
    if (k === '@it') { sub.hidden = false; sub.innerHTML = Object.entries(TAC_ITEMS).map(([x, t]) => '<button class="tpitem" data-pk="=' + x + '">' + tacActIcon(c, { a: x }) + esc(t) + '</button>').join(''); return false; }
    if (k === '@jump') { sub.hidden = false; sub.innerHTML = slots.map((s, j) => j > i ? '<button class="tpitem" data-pk="=>' + (j + 1) + '">Tactic ' + (j + 1) + ' <span class="muted small">' + esc(tacCondText(s)) + '</span></button>' : '').join('') || '<div class="small muted">No tactic below this one.</div>'; sub.innerHTML += '<button class="tpitem" data-pk="=>' + (TAC_MAX + 1) + '">To the end (stop here)</button>'; return false; }
    const L = tacEditable(c); if (!L) return;
    if (k === '#clear') { L.splice(i, 1); tacChanged(c); return; }
    if (k === '#toggle') { if (L[i]) L[i].off = !L[i].off; tacChanged(c); return; }
    if (!L[i]) L[i] = { c: 'enemy.tgt', a: null };
    L[i].a = k[0] === '=' ? k.slice(1) : k; tacChanged(c);
  });
}
function tacPlusPopup(c, i, anchor) {
  const h = '<div class="tpcol"><button class="tpitem" data-pk="above">Insert a tactic above</button><button class="tpitem" data-pk="below">Insert a tactic below</button>' +
    '<button class="tpitem" data-pk="up">Move up</button><button class="tpitem" data-pk="down">Move down</button><button class="tpitem" data-pk="toggle">Disable / enable</button><button class="tpitem" data-pk="del">Delete</button></div>';
  tacPopup(anchor, h, (k) => {
    const L = tacEditable(c); if (!L) return;
    const blank = { c: 'self.any', a: null };
    if (k === 'above' && L.length < TAC_MAX) L.splice(i, 0, blank);
    else if (k === 'below' && L.length < TAC_MAX) L.splice(i + 1, 0, blank);
    else if (k === 'up' && i > 0) { const t = L[i - 1]; L[i - 1] = L[i]; L[i] = t; }
    else if (k === 'down' && i < L.length - 1) { const t = L[i + 1]; L[i + 1] = L[i]; L[i] = t; }
    else if (k === 'toggle' && L[i]) L[i].off = !L[i].off;
    else if (k === 'del') L.splice(i, 1);
    tacChanged(c);
  });
}
function tacClick(e) {
  const c = active(); const t = e.target;
  const ch = t.closest('[data-tacch]'); if (ch) { const L = G.state.characters; const k = L.indexOf(c); const n = L[(k + +ch.dataset.tacch + L.length) % L.length]; if (n && n !== c) { switchCharacter(n.id); openSheet('tac'); } return true; }
  const go = t.closest('[data-tacgo]'); if (go) { e.preventDefault(); openSheet(go.dataset.tacgo); return true; }
  const cnd = t.closest('[data-taccond]'); if (cnd) { tacCondPopup(c, +cnd.dataset.taccond, cnd); return true; }
  const act = t.closest('[data-tacact]'); if (act) { tacActPopup(c, +act.dataset.tacact, act); return true; }
  const pl = t.closest('[data-tacplus]'); if (pl) { tacPlusPopup(c, +pl.dataset.tacplus, pl); return true; }
  const add = t.closest('[data-tacadd]'); if (add) { const L = tacEditable(c); if (L && L.length < TAC_MAX) { L.push({ c: 'self.any', a: null }); tacChanged(c); } return true; }
  return false;
}
function tacChange(e) {
  const c = active(); const t = e.target; const T = tacState(c);
  if (t.dataset.tacpreset) { T.preset = t.value; rt(c).tacCache = null; save(); renderSheet(); if (typeof renderAbar === 'function') renderAbar(); return true; }
  if (t.dataset.tacbeh) { c.cfg.style = t.value; save(); renderSheet(); return true; }
  if (t.dataset.tacoff) { T.on = !t.checked; save(); renderSheet(); return true; }
  return false;
}
