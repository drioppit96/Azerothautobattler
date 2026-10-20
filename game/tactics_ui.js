'use strict';
/* tactics_ui.js - the abilities list of the "Abilities & behaviour" tab, like the old list: one row per ability (or item)
   with a condition and its number, and "+ or" for more conditions under it - the first true one is used, so a heal can
   go to the tank below 60% first and to anyone else below 50% after that. Only what the character has is shown (learned
   abilities, items in the bags). The presets (Default by talents and role, Damage, Tank, Healer) are what every
   character plays until it is changed; changing one makes it a Custom list. The data under it is the tactics list of
   tactics.js (one slot per condition). */

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
/* the conditions in plain words, as the old list said it (the number goes in the box next to it) */
const TAC_LABEL = {
  'self.any': 'Whenever ready', 'self.hp<': 'My health below %', 'self.hp>': 'My health above %', 'self.mp<': 'My mana / energy below %', 'self.mp>': 'My mana / energy above %',
  'self.rage>': 'Rage at least', 'self.rage<': 'Rage below', 'self.cp>': 'Combo points at least', 'self.melee': 'I am hit in melee', 'self.att>': 'Attackers on me at least',
  'self.sur>': 'Enemies next to me at least', 'self.nobuff': 'Keep it up on me', 'self.disp': 'Cleanse myself', 'self.pethp<': 'Pet health below %', 'self.nopet': 'Pet missing or dead',
  'ally.tank<': "Tank's health below %", 'ally.hp<': "Anyone's health below %", 'ally.mp<': "An ally's mana below %", 'ally.hit': 'An ally (not the tank) is attacked',
  'ally.nobuff': 'Keep it up on everyone', 'ally.disp': 'Cleanse anyone', 'ally.hurt>': 'Allies below 70% health at least',
  'enemy.tgt': 'On my target', 'enemy.nodeb': 'Keep on my target', 'enemy.nodebAll': 'Keep on every attacker', 'enemy.stack<': 'Stack it on my target up to',
  'enemy.hp<': 'Target health below %', 'enemy.hp>': 'Target health above %', 'enemy.elite': 'Only on elites, rares, bosses', 'enemy.boss': 'Only on bosses',
  'enemy.cast': 'Interrupt a casting enemy', 'enemy.flee': 'An enemy runs away', 'enemy.clus>': 'Enemies close together at least', 'enemy.att>': 'Enemies fighting us at least',
  'enemy.onally': 'An enemy hits an ally (not the tank)', 'enemy.loose': 'An extra attacker (crowd control)', 'enemy.melee': 'Target in melee range', 'enemy.far': 'Target out of melee range' };
/* the conditions that make sense for an action, in a sensible order */
function tacCondChoices(c, a) {
  const gs = tacCondGroups(c, a); const out = [];
  for (const g of ['Ally', 'Self', 'Enemy']) if (gs.includes(g)) for (const k of TAC_COND_ORDER) if (TAC_CONDS[k].g === g && TAC_LABEL[k]) out.push(k);
  return out;
}
/* what the character has now: learned abilities, items in the bags */
function tacHave(c, a) {
  if (a === '>end' || a === '#atk' || a === '#wait') return true;
  if (a[0] === '#') return tacItemFind(c, a) >= 0;
  return !!(c.known && c.known[a]);
}
function tacCondRow(c, a, k, gi, j) {
  const cd = TAC_CONDS[k.c]; const hasP = cd && cd.p != null;
  let ch = tacCondChoices(c, a); if (!ch.includes(k.c)) ch = [k.c].concat(ch);
  return '<select data-tgc="' + gi + ':' + j + '">' + ch.map((x) => '<option value="' + x + '"' + (x === k.c ? ' selected' : '') + '>' + esc(TAC_LABEL[x] || tacCondText({ c: x })) + '</option>').join('') + '</select>' +
    (hasP ? '<input type="number" data-tgp="' + gi + ':' + j + '" value="' + (k.p != null ? k.p : cd.p) + '" min="0" max="100" step="' + (/hp|mp|tank/.test(k.c) ? 5 : 1) + '">' : '<span class="pfill"></span>');
}
function tacAbilHtml(c) {
  const T = tacState(c); const all = tacSlots(c); const gs = tacGroup(all);
  const shown = gs.map((g, gi) => ({ g, gi })).filter((x) => tacHave(c, x.g.a));
  let h = '<div class="sgroup tacab' + (T.on === false ? ' dimmed' : '') + '"><h5>Abilities - checked from the top, the first that fits is used</h5>';
  if (!/^c\d$/.test(T.preset)) h += '<div class="small muted" style="margin-bottom:4px">A ready-made list - changing anything copies it into a Custom list of your own.</div>';
  if (!shown.length) h += '<div class="muted small">No abilities yet.</div>';
  shown.forEach(({ g, gi }, si) => {
    const a = g.a; const off = g.conds.every((k) => k.off); const spell = a[0] !== '#' && a[0] !== '>';
    let info = '';
    if (spell) {
      const sp = spellRow(c.known[a]); const u = abilityUsable(c, a);
      const ct = sp && sp.pw ? spellCost(c, sp, a) : [0, 0]; const castS = sp ? castTime(c, sp) : 0; const cd = sp && (sp.cd || sp.catcd) ? ((sp.cd || sp.catcd) / 1000) + 's cd' : '';
      info = [ct[1] ? ct[1] + ' ' + (ct[0] === -2 ? 'health' : powerName(ct[0]).toLowerCase()) : '', castS ? castS.toFixed(1) + 's cast' : sp && isChanneled(sp) ? 'channeled' : '', cd].filter(Boolean).join(', ') + (u.ok ? '' : ' <span style="color:#e6b93c">' + esc(u.why) + '</span>');
    } else if (a === '>end') info = 'nothing below is used then';
    else if (a[0] === '#' && TAC_ITEMS[a]) { const b = tacItemFind(c, a); info = b >= 0 ? esc(itemName(c.bags[b].id)) : ''; }
    const prevGi = si ? shown[si - 1].gi : -1, nextGi = si < shown.length - 1 ? shown[si + 1].gi : -1;
    h += '<div class="tabk' + (off ? ' off' : '') + '">';
    g.conds.forEach((k, j) => {
      if (!j) h += '<div class="arow tarow"><input type="checkbox" data-tgon="' + gi + '"' + (off ? '' : ' checked') + ' title="Use it">' + tacActIcon(c, a) +
        '<div class="aname"><b>' + esc(tacActName(a)) + '</b><div class="small muted">' + info + '</div></div>' + tacCondRow(c, a, k, gi, j) +
        '<span class="updn"><button class="mini" data-tgca="' + gi + '" title="Add another condition (or ...)">+ or</button><button class="mini" data-tgmv="' + gi + ':' + prevGi + '"' + (prevGi >= 0 ? '' : ' disabled') + '>&#9650;</button><button class="mini" data-tgmv="' + gi + ':' + nextGi + '"' + (nextGi >= 0 ? '' : ' disabled') + '>&#9660;</button><button class="mini" data-tgdel="' + gi + '" title="Take it out of the list">&#10005;</button></span></div>';
      else h += '<div class="arow tarow tor"><span></span><span></span><div class="aname small muted">or</div>' + tacCondRow(c, a, k, gi, j) + '<span class="updn"><button class="mini" data-tgcx="' + gi + ':' + j + '" title="Remove this condition">&#10005;</button></span></div>';
    });
    h += '</div>';
  });
  // add: learned abilities and items in the bags that are not in the list yet
  const inList = new Set(gs.map((g) => g.a));
  const ab = Object.keys(c.known || {}).filter((n) => !inList.has(n) && !(typeof PET_SPELLS !== 'undefined' && PET_SPELLS.has(n)) && !/^(Attack|Shoot|Auto Shot)$/.test(n)).sort();
  const it = Object.keys(TAC_ITEMS).filter((x) => !inList.has(x) && tacItemFind(c, x) >= 0);
  h += '<div class="tabfoot"><select data-tgadd="1"><option value="">+ Add an ability or item ...</option>' + ab.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('') +
    it.map((x) => '<option value="' + x + '">' + esc(TAC_ITEMS[x]) + '</option>').join('') + (inList.has('>end') ? '' : '<option value=">end">Stop here (save the rest)</option>') + '</select>' +
    '<label class="chk small"><input type="checkbox" data-tacoff="1"' + (T.on === false ? ' checked' : '') + '> No abilities at all (only auto attack)</label></div>';
  return h + '</div>';
}
function tacNote(c) {
  const T = tacState(c);
  if (T.preset === 'auto') { const role = tacRole(c); const k = tacAutoKind(c, role); return 'Plays: <b>' + esc(TAC_PRESETS[k]) + '</b>' + (role === 'solo' ? ' (alone)' : ' (group role: ' + esc(role) + ')'); }
  if (T.preset === 'classic') return 'the older list below, by modes';
  return esc((CLASS_NAMES[c.cls] || '') + ' - ' + (((TALENT_BUILDS[c.cls] || {})[rotationSpec(c)] || {}).name || rotationSpec(c)));
}

/* which kinds of conditions fit an action: items are for oneself, an ability on others only when it can be cast on them */
function tacCondGroups(c, a) {
  if (a === '#bomb' || a === '#atk') return ['Self', 'Enemy'];
  if (a[0] === '#') return a === '#wait' ? ['Self', 'Ally', 'Enemy'] : ['Self'];
  if (a === '>end') return ['Self', 'Ally', 'Enemy'];
  const sp = c.known && c.known[a] ? spellRow(c.known[a]) : null; const ef = (sp && sp.ef) || [];
  return ef.some((e) => e.k === 'friend') ? ['Self', 'Ally', 'Enemy'] : ['Self', 'Enemy'];
}
function tacBehClick(e) {
  const c = active(); const t = e.target; const pr = (s) => s.split(':').map(Number); let b;
  if ((b = t.closest('[data-tgca]'))) { const gi = +b.dataset.tgca; tacEdit(c, (gs) => { const g = gs[gi]; if (!g) return; const used = new Set(g.conds.map((k) => k.c)); const ch = tacCondChoices(c, g.a); const pref = ['ally.tank<', 'ally.hp<', 'self.hp<', 'enemy.tgt', 'enemy.elite', 'enemy.clus>', 'self.any'].filter((x) => ch.includes(x)); const k = pref.concat(ch).find((x) => !used.has(x)) || 'self.any'; g.conds.push({ c: k, p: TAC_CONDS[k].p }); }); return true; }
  if ((b = t.closest('[data-tgcx]'))) { const [gi, j] = pr(b.dataset.tgcx); tacEdit(c, (gs) => { if (gs[gi]) gs[gi].conds.splice(j, 1); }); return true; }
  if ((b = t.closest('[data-tgmv]'))) { const [gi, to] = pr(b.dataset.tgmv); if (to < 0) return true; tacEdit(c, (gs) => { const x = gs[gi]; gs[gi] = gs[to]; gs[to] = x; }); return true; }
  if ((b = t.closest('[data-tgdel]'))) { const gi = +b.dataset.tgdel; tacEdit(c, (gs) => { gs.splice(gi, 1); }); return true; }
  return false;
}
function tacChange(e) {
  const c = active(); const t = e.target; const T = tacState(c); const pr = (s) => s.split(':').map(Number);
  if (t.dataset.tgc != null) { const [gi, j] = pr(t.dataset.tgc); const k = t.value; tacEdit(c, (gs) => { const x = gs[gi] && gs[gi].conds[j]; if (x) { x.c = k; x.p = TAC_CONDS[k].p; } }); return true; }
  if (t.dataset.tgp != null) { const [gi, j] = pr(t.dataset.tgp); const v = Math.max(0, +t.value || 0); tacEdit(c, (gs) => { const x = gs[gi] && gs[gi].conds[j]; if (x) x.p = v; }); return true; }
  if (t.dataset.tgadd != null) { const a = t.value; if (!a) return true; tacEdit(c, (gs) => { gs.push({ a, conds: [tacDefaultCond(c, a)] }); }); return true; }
  if (t.dataset.tgon != null) { const gi = +t.dataset.tgon; const on = t.checked; tacEdit(c, (gs) => { if (gs[gi]) for (const k of gs[gi].conds) k.off = !on; }); return true; }
  if (t.dataset.tacpreset) { T.preset = t.value; rt(c).tacCache = null; save(); renderSheet(); if (typeof renderAbar === 'function') renderAbar(); return true; }
  if (t.dataset.tacoff) { T.on = !t.checked; save(); renderSheet(); return true; }
  return false;
}
