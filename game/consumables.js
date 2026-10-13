'use strict';
/* consumables.js - everything in the bags that can be used besides food, drink and healing potions:
   bandages (First Aid), scrolls, elixirs, flasks and juju (buffs), mana and rage potions, sharpening stones,
   weightstones and weapon oils, dynamite and bombs. Each kind has rules in the tactics window (when to use it). */

const CONS_MODES = {
  buff: ['off', 'buff', 'fight', 'elite', 'emergency'],
  bandage: ['off', 'afterfight', 'emergency'],
  mana: ['off', 'lowmana', 'fight', 'elite'],
  weapon: ['off', 'buff'],
  bomb: ['off', 'fight', 'elite', 'multi', 'spam'],
};
Object.assign(MODE_TEXT, { afterfight: 'After a fight, health below %', fight: 'At the start of a fight', lowmana: 'When mana/power below %' });
Object.assign(MODE_HAS_P, { afterfight: 1, lowmana: 1 });
const CONS_KIND_TEXT = { buff: 'Buff', bandage: 'Bandage', mana: 'Restores power', weapon: 'Weapon enhancement', bomb: 'Explosive' };
const STONE_TIER = { Rough: 2, Coarse: 3, Heavy: 4, Solid: 6, Dense: 8, Elemental: 6 };
const OIL = { 'Minor Wizard Oil': [13, 8], 'Lesser Wizard Oil': [13, 16], 'Wizard Oil': [13, 24], 'Brilliant Wizard Oil': [13, 36], 'Minor Mana Oil': [85, 4], 'Lesser Mana Oil': [85, 8], 'Brilliant Mana Oil': [85, 12] };

/* what an item does when used, or null (the item's "Use:" spell) */
function consInfo(id) {
  G.consCache = G.consCache || {};
  if (id in G.consCache) return G.consCache[id];
  const it = itemRow(id); let out = null;
  if (it && it.fx) for (const f of it.fx) {
    if ((f.trigger || 0) !== 0) continue; const sp = spellRow(f.id); if (!sp) continue;
    const ef = sp.ef || []; const cd = { key: f.cat ? 'c' + f.cat : 'i' + id, secs: ((f.catcd || 0) || (f.cd || 0)) / 1000 };
    if (ef.some((e) => e.t === 10 || e.au === 84 || e.au === 20 || e.au === 85)) break;          // healing potions, food and drink have their own settings
    if (ef.some((e) => e.t === 6 && e.au === 8) && (sp.fl || []).includes('channeled')) { const e = ef.find((x) => x.au === 8); out = { kind: 'bandage', sp, heal: e.lo, every: (e.amp || 1000) / 1000, dur: (sp.dur || 6000) / 1000, cd }; break; }
    if (ef.some((e) => e.t === 54)) { out = { kind: 'weapon', sp, cd, cast: (sp.cast || 0) / 1000, name: it.n }; break; }
    if (ef.some((e) => e.t === 30)) { const e = ef.find((x) => x.t === 30); out = { kind: 'mana', sp, ptype: e.mi || 0, lo: e.lo, hi: e.hi || e.lo, cd }; break; }
    if (ef.some((e) => e.t === 2 && (e.k === 'enemy' || e.k === 'area_enemy'))) { const e = ef.find((x) => x.t === 2); out = { kind: 'bomb', sp, lo: e.lo, hi: e.hi || e.lo, area: e.k === 'area_enemy', cd }; break; }
    if (ef.some((e) => (e.t === 6 || e.t === 35) && (e.k === 'self' || e.k === 'friend')) && (sp.dur || 0) > 0) { out = { kind: 'buff', sp, dur: sp.dur / 1000, cd }; break; }
  }
  return (G.consCache[id] = out);
}
function consText(id) {
  const u = consInfo(id); if (!u) return '';
  if (u.kind === 'bandage') return 'heals ' + Math.round(u.heal * u.dur / u.every) + ' over ' + u.dur + ' s';
  if (u.kind === 'mana') { const k = u.ptype === 1 ? 10 : 1; return '+' + u.lo / k + '-' + u.hi / k + ' ' + powerName(u.ptype).toLowerCase(); }
  if (u.kind === 'bomb') return u.lo + '-' + u.hi + ' damage' + (u.area ? ' around the target' : '');
  if (u.kind === 'weapon') { const b = weaponBonus(u.name); return b ? (b[0] === 9001 ? '+' + b[1] + ' weapon damage' : b[0] === 13 ? '+' + b[1] + ' spell damage' : '+' + b[1] + ' mana per 5 s') + ', 30 min' : '30 min'; }
  const parts = []; for (const e of u.sp.ef || []) { if (e.t !== 6 && e.t !== 35) continue; const t = e.au === 34 ? '+' + e.lo + ' health' : e.au === 8 ? 'heals ' + e.lo + ' every ' + (e.amp || 1000) / 1000 + ' s' : auraText(e.au, e.au === 29 ? (e.mi == null ? 0 : e.mi) : e.mi, e.lo); if (t) parts.push(t.replace(/^Equip: /, '').replace(/\.$/, '')); }
  return (parts.join(', ') || u.sp.n) + (u.dur >= 60 ? ', ' + Math.round(u.dur / 60) + ' min' : ', ' + u.dur + ' s');
}
/* sharpening stones (blades), weightstones (blunt weapons) and oils */
function weaponBonus(name) {
  if (OIL[name]) return OIL[name];
  const m = /^(\w+) (Sharpening Stone|Weightstone)$/.exec(name || ''); if (m) return [9001, STONE_TIER[m[1]] || 3];
  return null;
}
function weaponFits(c, name) {
  const w = c.equip[15] && itemRow(c.equip[15].id); if (!w) return false;
  if (/Sharpening Stone/.test(name)) return [0, 1, 6, 7, 8, 15].includes(w.s);
  if (/Weightstone/.test(name)) return [4, 5, 10, 13].includes(w.s);
  return true;
}
function consDefault(c, id) {
  const u = consInfo(id); const it = itemRow(id); if (!u) return { mode: 'off' };
  if (u.kind === 'bandage') return { mode: 'afterfight', p: 65 };
  if (u.kind === 'mana') return u.ptype === 0 && usesMana(c) && c.cls !== 1 ? { mode: 'lowmana', p: 15 } : u.ptype === 1 && c.cls === 1 ? { mode: 'lowmana', p: 10 } : { mode: 'off' };
  if (u.kind === 'weapon') return { mode: weaponFits(c, u.name) && weaponBonus(u.name) && !(OIL[u.name] && !usesMana(c)) ? 'buff' : 'off' };
  if (u.kind === 'buff' && (/^Scroll of/.test(it.n) || u.dur >= 600)) return { mode: 'buff' };
  return { mode: 'off', p: u.kind === 'bomb' ? 3 : 30 };
}
function consRule(c, id) { const r = c.cfg.items && c.cfg.items[id]; return r || consDefault(c, id); }
function consReady(c, u) { const r = rt(c); r.icd = r.icd || {}; if (u.cd.key === 'c4' && (r.potionCd || 0) > G.gameTime) return false; return !((r.icd[u.cd.key] || 0) > G.gameTime); }
/* why the character cannot use it (level, class, First Aid / Engineering skill), or '' */
function consBlock(c, id) {
  const it = itemRow(id); if (!it) return 'unknown item';
  if ((it.rl || 0) > c.level) return 'requires level ' + it.rl;
  if (it.rq && it.rq.classes && !it.rq.classes.includes(c.cls)) return 'not for your class';
  if (it.rq && it.rq.skill && profSkill(c, it.rq.skill) < (it.rq.skillRank || 1)) return 'requires ' + profName(it.rq.skill) + ' ' + (it.rq.skillRank || 1);
  return '';
}
/* kept in the bags while leveling (not sold): usable and set to be used */
function consKeep(c, id) { return !!consInfo(id) && !consBlock(c, id) && consRule(c, id).mode !== 'off'; }
function consBagIndex(c, id) { for (let i = 0; i < c.bags.length; i++) if (c.bags[i].id === id) return i; return -1; }

/* use one item; returns true when it was used */
function useConsumable(c, idx, why) {
  const inst = c.bags[idx]; if (!inst) return false; const u = consInfo(inst.id); if (!u) return false;
  const r = rt(c); const it = itemRow(inst.id); const fight = r.threats && r.threats.length;
  const blk = consBlock(c, inst.id); if (blk) { if (!why) log(itemName(inst.id) + ': ' + blk + '.'); return false; }
  if (!consReady(c, u)) { if (!why) log(itemName(inst.id) + ' is not ready yet.'); return false; }
  if (u.kind === 'bandage') {
    if ((r.icd.bandaged || 0) > G.gameTime) { if (!why) log('Recently bandaged - wait a little.'); return false; }
    r.bandage = { tick: u.heal, every: u.every, left: u.dur, t: 0, name: itemName(inst.id), ic: (it.ic || '').toLowerCase() }; r.icd.bandaged = G.gameTime + 60; r.mv = null; r.cast = null;
    log('Applying ' + itemName(inst.id) + '.');
  } else if (u.kind === 'mana') {
    const v0 = irnd(u.lo, u.hi); const v = u.ptype === 1 ? Math.round(v0 / 10) : v0; addPower(c, u.ptype, v); fx(c.pos.x, c.pos.y, '+' + v + ' ' + powerName(u.ptype).toLowerCase(), '#6fa8ff');
    if (u.cd.key === 'c4') r.potionCd = G.gameTime + (u.cd.secs || 120);
    log('Used ' + itemName(inst.id) + '.');
  } else if (u.kind === 'weapon') {
    const b = weaponBonus(u.name); if (!c.equip[15]) { if (!why) log('No weapon to use it on.'); return false; }
    if (!weaponFits(c, u.name)) { if (!why) log(u.name + ' does not fit this weapon.'); return false; }
    if (fight) return false;
    const bn = u.name.replace(/^(Rough|Coarse|Heavy|Solid|Dense|Elemental) /, '');
    const apply = () => { addBuff(c, { n: bn, dur: 1800000 }, { au: b ? b[0] : 0, mi: 0, lo: b ? b[1] : 0 }); consTagBuff(c, bn, it.ic, 'ench'); log('Used ' + u.name + ' on ' + itemName(c.equip[15].id, c.equip[15]) + '.'); };
    if (u.cast && !why) apply(); else if (u.cast) { startInteract(c, u.sp.n, apply, u.cast); }
    else apply();
  } else if (u.kind === 'bomb') {
    const m = r.tgt; if (!m || m.st === 'dead' || !fight) { if (!why) log('Nothing to throw it at.'); return false; }
    if (Math.hypot(m.x - c.pos.x, m.y - c.pos.y) > 30) return false;
    const hit = u.area ? (r.threats || []).filter((x) => Math.hypot(x.x - m.x, x.y - m.y) < 8) : [m];
    for (const x of hit) { const v = irnd(u.lo, u.hi); x.hp -= v; onMobDamaged(x); meterDmg(c, v, itemName(inst.id)); addThreat(x, c, v); fx(x.x, x.y, v + '', '#ff9a3c'); if (x.st === 'alive') engage(x, c); if (x.hp <= 0) killMob(c, x); }
    log('Threw ' + itemName(inst.id) + '.');
  } else if (u.kind === 'buff') {
    for (const e of u.sp.ef || []) if ((e.t === 6 || e.t === 35) && (e.k === 'self' || e.k === 'friend')) addBuff(c, u.sp, Object.assign({}, e, { mi: e.au === 29 && e.mi == null ? 0 : e.mi }));
    consTagBuff(c, u.sp.n, it.ic);
    if (u.sp.ef.some((e) => e.au === 34)) { /* more health right away, like the game */ }
    fx(c.pos.x, c.pos.y, u.sp.n, '#9fe0ff'); log('Used ' + itemName(inst.id) + '.');
  } else return false;
  if (u.cd.secs) r.icd[u.cd.key] = G.gameTime + u.cd.secs;
  inst.n--; if (inst.n <= 0) c.bags.splice(idx, 1);
  dirty(c); refreshGear(); return true;
}
/* the icon of a buff from an item (shown under the unit frame) */
function consTagBuff(c, name, ic, kind) { const b = (rt(c).buffs || []).find((x) => x.name === name); if (b) { if (ic) b.ic = ic.toLowerCase(); if (kind) b.kind = kind; } }
/* the bandage ticks (called by regenStep); damage stops it */
function bandageStep(c, dt) {
  const r = rt(c); const b = r.bandage; if (!b) return;
  b.t += dt; b.left -= dt;
  while (b.t >= b.every) { b.t -= b.every; healSelf(c, b.tick); }
  if (b.left <= 0 || c.hp >= charStats(c).maxHp) r.bandage = null;
}
function bandageHit(c) { const r = rt(c); if (r.bandage) { r.bandage = null; fx(c.pos.x, c.pos.y, 'interrupted', '#cfc6b0'); } }

/* the rules: what is in the bags and when to use it */
function consList(c) { const seen = new Set(); const out = []; for (const x of c.bags) if (!seen.has(x.id) && consInfo(x.id)) { seen.add(x.id); out.push(x.id); } return out; }
function consBuffUp(c, u) { const n = u.kind === 'weapon' ? u.name.replace(/^(Rough|Coarse|Heavy|Solid|Dense|Elemental) /, '') : u.sp.n; return buffLeft(c, n) > 5; }
/* out of combat (returns true while busy: bandaging, sharpening) */
function consumablesOoc(c) {
  const r = rt(c); if (r.bandage) return true; if (!c.cfg) return false;
  if (G.gameTime - (r.consT || -9) < 1) return false; r.consT = G.gameTime;
  const hpPct = c.hp / charStats(c).maxHp * 100;
  for (const id of consList(c)) {
    const rule = consRule(c, id); if (rule.mode === 'off' || consBlock(c, id)) continue; const u = consInfo(id); if (!consReady(c, u)) continue;
    let go = false;
    if (rule.mode === 'afterfight') go = hpPct < (rule.p || 65) && !((r.icd || {}).bandaged > G.gameTime);
    else if (rule.mode === 'buff') go = !consBuffUp(c, u) && (u.kind !== 'weapon' || weaponFits(c, u.name));
    if (!go) continue;
    const i = consBagIndex(c, id); if (i >= 0 && useConsumable(c, i, 'rule')) return !!(r.bandage || r.interact);
  }
  return false;
}
/* in a fight (from fightStep) */
function consumablesFight(c, m) {
  const r = rt(c); if (!c.cfg || r.bandage) return;
  if (G.gameTime - (r.consF || -9) < 0.5) return; r.consF = G.gameTime;
  const s = charStats(c); const hpPct = c.hp / s.maxHp * 100; const mp = usesMana(c) && s.maxMana ? c.mana / s.maxMana * 100 : 100;
  const att = (r.threats || []).length; const fresh = m && m.hp / m.maxhp > 0.9 && G.gameTime - (r.fightStart || 0) < 6;
  for (const id of consList(c)) {
    const rule = consRule(c, id); if (rule.mode === 'off' || rule.mode === 'buff' || rule.mode === 'afterfight' || consBlock(c, id)) continue;
    const u = consInfo(id); if (!consReady(c, u)) continue;
    let go = false;
    if (rule.mode === 'fight') go = fresh && (u.kind !== 'buff' || !consBuffUp(c, u)) && !(r.usedIn === m && u.kind !== 'bomb');
    else if (rule.mode === 'emergency') go = hpPct < (rule.p || 30) && (u.kind !== 'buff' || !consBuffUp(c, u));
    else if (rule.mode === 'lowmana') go = u.ptype === 0 ? mp < (rule.p || 15) : powerOf(c, u.ptype) < (rule.p || 15);
    else if (rule.mode === 'multi') go = att >= (rule.p || 3);
    else if (rule.mode === 'elite') { const tough = isTough(m) || (r.threats || []).some(isTough); go = tough && (u.kind === 'bomb' || (u.kind === 'buff' ? !consBuffUp(c, u) : u.kind === 'mana' ? (u.ptype === 0 ? mp < 60 : powerOf(c, u.ptype) < 30) : true)); }
    else if (rule.mode === 'spam') go = true;
    if (!go) continue;
    const i = consBagIndex(c, id); if (i >= 0 && useConsumable(c, i, 'rule')) { r.usedIn = m; return; }
  }
}

/* the tactics window: a section with the consumables in the bags */
function consumablesHtml(c) {
  const list = consList(c); let h = '<div class="sgroup"><h5>Consumables - bandages, scrolls, elixirs, stones, explosives</h5>';
  if (!list.length) h += '<div class="muted small">Nothing usable in the bags right now. Rules for an item appear here when you carry it (healing potions, food and drink use the settings above).</div>';
  for (const id of list) {
    const u = consInfo(id); const rule = consRule(c, id); const it = itemRow(id); const modes = CONS_MODES[u.kind] || ['off'];
    h += '<div class="arow' + (rule.mode === 'off' ? ' off' : '') + '"><span data-iid="' + id + '">' + (it.ic ? '<img class="sic" src="../icons/' + it.ic.toLowerCase() + '.jpg" alt="">' : '<span class="sic"></span>') + '</span>' +
      '<div class="aname"><b style="color:' + QUALITY_COLORS[it.q || 1] + '">' + esc(it.n) + '</b> <span class="muted small">x' + bagCount(c, id) + '</span><div class="small muted">' + esc(CONS_KIND_TEXT[u.kind]) + ': ' + esc(consText(id)) +
      (consBlock(c, id) ? ' <span style="color:#e6b93c">' + esc(consBlock(c, id)) + '</span>' : '') + (u.kind === 'weapon' && !weaponFits(c, u.name) ? ' <span style="color:#e6b93c">does not fit the weapon</span>' : '') + '</div></div>' +
      '<select data-cmode="' + id + '">' + modes.map((m) => '<option value="' + m + '"' + (rule.mode === m ? ' selected' : '') + '>' + MODE_TEXT[m] + '</option>').join('') + '</select>' +
      (MODE_HAS_P[rule.mode] ? '<input type="number" data-cp="' + id + '" value="' + (rule.p || 0) + '" min="0" max="100" step="' + (rule.mode === 'multi' ? 1 : 5) + '">' : '<span class="pfill"></span>') +
      '<button class="mini" data-cuse="' + id + '" title="Use one now">Use</button></div>';
  }
  return h + '</div>';
}
function consumablesChange(e) {
  const t = e.target; const c = active();
  if (t.dataset.cmode != null) { c.cfg.items = c.cfg.items || {}; const id = +t.dataset.cmode; const old = consRule(c, id); const p = old.p || (t.value === 'multi' ? 3 : t.value === 'lowmana' ? 15 : t.value === 'afterfight' ? 65 : 30); c.cfg.items[id] = { mode: t.value, p }; save(); renderSheet(); return true; }
  if (t.dataset.cp != null) { c.cfg.items = c.cfg.items || {}; const id = +t.dataset.cp; c.cfg.items[id] = Object.assign({}, consRule(c, id), { p: Math.max(0, +t.value || 0) }); save(); return true; }
  return false;
}
function consumablesClick(e) {
  const b = e.target.closest('[data-cuse]'); if (!b) return false; const c = active();
  const i = consBagIndex(c, +b.dataset.cuse); if (i >= 0) useConsumable(c, i); renderSheet(); return true;
}
