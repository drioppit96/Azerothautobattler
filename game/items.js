'use strict';
/* items.js - stage 3: item instances, bags, equipment, random suffixes, durability, character stats,
   equip effects, consumables, vendors (buy / sell / repair). */

const BACKPACK = 16;
const MELEE_RANGE_ = 4.5;
/* start gear per race_class (item ids). Only the orc warrior is filled in; others start empty for now. */
const START_GEAR = { '2_1': { equip: { 15: 37, 3: 6125, 6: 139, 7: 40 }, bags: [[117, 4], [159, 2]] } };
const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80'];
const WEAPON_SUB = { 0: 'Axe', 1: 'Axe', 2: 'Bow', 3: 'Gun', 4: 'Mace', 5: 'Mace', 6: 'Polearm', 7: 'Sword', 8: 'Sword', 10: 'Staff', 13: 'Fist Weapon', 14: 'Miscellaneous', 15: 'Dagger', 16: 'Thrown', 17: 'Spear', 18: 'Crossbow', 19: 'Wand', 20: 'Fishing Pole' };
const ARMOR_SUB = { 0: '', 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 6: 'Shield', 7: 'Libram', 8: 'Idol', 9: 'Totem' };
const STAT_KEY = { 3: 'agi', 4: 'str', 5: 'int', 6: 'spi', 7: 'sta' };
const STAT_LABEL = { agi: 'Agility', str: 'Strength', int: 'Intellect', spi: 'Spirit', sta: 'Stamina' };
const AURA_STAT = ['str', 'agi', 'sta', 'int', 'spi'];
const RES_NAMES = ['holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'];
const NPC_VENDOR = 4, NPC_REPAIR = 16384;
/* how much each class values a stat (for the green "upgrade" arrows) */
const WEIGHTS = {
  1: { str: 2, agi: 1.2, sta: 1.5, int: 0, spi: 0.1, ap: 1, crit: 15, hit: 15, armor: 0.08, dps: 10, def: 1, dodge: 10, parry: 10, block: 5 },
  2: { str: 2, agi: 0.8, sta: 1.4, int: 1, spi: 0.5, ap: 1, crit: 12, hit: 12, armor: 0.07, dps: 9, sd: 0.8, heal: 0.4 },
  3: { str: 0.5, agi: 2, sta: 1.2, int: 0.6, spi: 0.3, ap: 1, crit: 14, hit: 14, armor: 0.05, dps: 9 },
  4: { str: 1, agi: 2, sta: 1.2, int: 0, spi: 0.1, ap: 1, crit: 15, hit: 15, armor: 0.05, dps: 10 },
  5: { str: 0, agi: 0, sta: 1, int: 1.5, spi: 1.2, sd: 0.8, heal: 0.8, armor: 0.02, dps: 1 },
  7: { str: 1.2, agi: 1, sta: 1.2, int: 1.2, spi: 0.6, ap: 0.8, crit: 10, sd: 0.8, armor: 0.05, dps: 8 },
  8: { str: 0, agi: 0, sta: 1, int: 1.6, spi: 0.8, sd: 1, armor: 0.02, dps: 1 },
  9: { str: 0, agi: 0, sta: 1.4, int: 1.4, spi: 0.6, sd: 1, armor: 0.02, dps: 1 },
  11: { str: 1.5, agi: 1.5, sta: 1.3, int: 1, spi: 0.8, ap: 1, sd: 0.6, heal: 0.4, armor: 0.06, dps: 5 },
};
const CRIT_RATIO = { 1: 20, 2: 20, 3: 53, 4: 29, 5: 20, 7: 20, 8: 20, 9: 20, 11: 20 };
const DODGE_RATIO = { 1: 20, 2: 20, 3: 26.5, 4: 14.5, 5: 20, 7: 20, 8: 20, 9: 20, 11: 20 };

function rtc(c) { return rt(c); }
function itemRow(id) { return G.d.items.items[id] || null; }
function lootRow(id) { return G.d.loot.items[id] || null; }
function propOf(inst) { return inst && inst.rp ? G.d.items.random_props[inst.rp] || null : null; }
function itemName(id, inst) { const r = itemRow(id); const l = lootRow(id); const base = r ? r.n : l ? l[0] : 'Item ' + id; const p = propOf(inst); return p ? base + ' ' + p.n : base; }
function itemQuality(id) { const r = itemRow(id); if (r) return r.q || 0; const l = lootRow(id); return l ? l[1] : 1; }
function itemSell(id) {
  const r = itemRow(id); if (r && r.sp != null) { const k = buyCount(id); return k > 1 && vendorSold(id) ? Math.min(r.sp, Math.floor(itemBuy(id) / k / 4)) : r.sp; }
  const l = lootRow(id); return l ? l[2] || 0 : 0;
}
/* items some vendor sells (bought in tens they would sell back for more than they cost: the vendor pays a quarter of a piece) */
function vendorSold(id) {
  if (!G.vendSold) { G.vendSold = new Set(); const V = G.d.vendorItems || {}; for (const e in V) for (const x of V[e] || []) G.vendSold.add(typeof x === 'number' ? x : x.id != null ? x.id : x[0]); }
  return G.vendSold.has(id);
}
function itemBuy(id) { const r = itemRow(id); return r && r.bp ? r.bp : Math.max(1, itemSell(id) * 4); }
/* consumables (food, drink, potions ...) come in a stack of 10 for the vendor price */
/* crafting supplies (vials, spices, thread, salt, flux, dyes, reagents) too: 10 for the vendor price */
function buyCount(id) { const r = itemRow(id); return r && (r.c === 0 || ((r.c === 7 || r.c === 5) && (r.q || 0) <= 1)) ? Math.min(10, itemStack(id) || 1) : r && r.c === 6 ? itemStack(id) : 1; }
/* what one piece costs at a vendor */
function unitBuy(id) { return itemBuy(id) / Math.max(1, buyCount(id)); }
/* bigger stacks than 1.12 had: potions and elixirs 20, ores, bars, cloth, leather and hides 50 */
const STACK_50 = /^(Runecloth|Felcloth|Mooncloth)$| Ore$|^Thorium Ore$| Bar$|^(Linen|Wool|Silk|Mageweave|Runecloth|Felcloth|Mooncloth) Cloth$|^Bolt of |Leather$| Hide$|^Light Hide$|^Heavy Hide$|^Thick Hide$|^Rugged Hide$|^Medium Hide$/;
function itemStack(id) {
  const r = itemRow(id);
  if (r && r.n) {
    if (r.c === 7 && STACK_50.test(r.n) && !/Belt|Pants|Gloves|Boots|Vest|Bracers/.test(r.n)) return 50;
    if (r.c === 0 && /Potion|Elixir/.test(r.n)) return Math.max(20, r.sk || 1);
  }
  if (r && r.sk) return r.sk; const l = lootRow(id); return (l && l[5]) || 1;
}
function itemIcon(id) { const r = itemRow(id); return r && r.ic ? '../icons/' + r.ic.toLowerCase() + '.jpg' : ''; }
function maxDur(id) { const r = itemRow(id); return r && r.du ? r.du : 0; }
function money(cp) { cp = Math.floor(cp || 0); const g = Math.floor(cp / 10000), s = Math.floor(cp % 10000 / 100), k = cp % 100; return (g ? g + 'g ' : '') + (s || g ? s + 's ' : '') + k + 'c'; }
function moneyHtml(cp) {
  cp = Math.floor(cp || 0); const g = Math.floor(cp / 10000), s = Math.floor(cp % 10000 / 100), k = cp % 100; let h = '';
  if (g) h += g + '<i class="coin g"></i> '; if (g || s) h += s + '<i class="coin s"></i> '; h += k + '<i class="coin c"></i>'; return h;
}

/* ----------------------------------------------------------- instances */
function makeInst(id, n, rollSuffix) {
  const o = { id, n: n || 1 }; const r = itemRow(id);
  if (r && r.du) o.dur = r.du;
  if (rollSuffix && r && r.rp && G.d.items.random_tmpl[r.rp]) {
    const t = G.d.items.random_tmpl[r.rp]; let tot = 0; for (const x of t) tot += x[1];
    let roll = Math.random() * tot; for (const [pid, ch] of t) { roll -= ch; if (roll <= 0) { o.rp = pid; break; } }
    if (!o.rp) o.rp = t[t.length - 1][0];
  }
  return o;
}
function normInst(x) { if (x == null) return null; if (typeof x === 'number') return makeInst(x, 1); return x; }
function bagCapacity(c) { let n = BACKPACK; for (const b of c.bagSlots || []) if (b) n += (itemRow(b.id) || {}).cs || 0; return n; }
function bagCount(c, id) { let n = 0; for (const s of c.bags) if (s.id === id) n += s.n; return n; }
function bagFree(c) { return bagCapacity(c) - c.bags.length; }
/* add n of an item (optionally a prepared instance); returns true when everything fitted */
function addItem(c, id, n, inst) {
  n = n || 1; const st = itemStack(id);
  if (inst) { if (c.bags.length >= bagCapacity(c)) { rt(c).bagFull = true; return false; } c.bags.push(inst); return true; }
  if (st > 1) for (const s of c.bags) { if (s.id === id && s.n < st) { const k = Math.min(st - s.n, n); s.n += k; n -= k; if (!n) return true; } }
  while (n > 0) {
    if (c.bags.length >= bagCapacity(c)) { rt(c).bagFull = true; return false; }
    const k = Math.min(st, n); const o = makeInst(id, k, true); c.bags.push(o); n -= k;
  }
  return true;
}
function removeItem(c, id, n) {
  for (let i = c.bags.length - 1; i >= 0 && n > 0; i--) {
    const s = c.bags[i]; if (s.id !== id) continue;
    const k = Math.min(s.n, n); s.n -= k; n -= k; if (!s.n) c.bags.splice(i, 1);
  }
  if (bagFree(c) > 0) rt(c).bagFull = false;
}
function questWants(c, id) {
  if (G.q && G.q.startBy[id]) return true;
  for (const qid in c.quests) { const q = G.q.byId[qid]; if (q && (q.start_item === id || q.objectives.some((o) => o.type === 'Collect' && o.id === id))) return true; }
  return false;
}
function isJunk(c, id) {
  if (typeof HEARTHSTONE !== 'undefined' && id === HEARTHSTONE) return false;
  if (id >= 9000000) return false;                                 // enchanting scrolls (professions.js)
  if (questWants(c, id)) return false;
  if (c.prof && profKeeps(c, id)) return false;
  if (typeof petKeeps === 'function' && petKeeps(c, id)) return false;            // soul shards, the pet's food
  if (itemQuality(id) === 0) return true;
  const r = itemRow(id); const l = lootRow(id);
  const cls = r ? r.c : l ? l[3] : -1, sub = r ? r.s : l ? l[4] : -1;
  if (cls === 15 && sub === 0 && itemQuality(id) <= 1 && !(r && r.sl && r.sl.length)) return true;
  // white (or grey) gear that is no upgrade, when the player allows it
  if (cset(c, 'sellWhiteGear') && r && r.sl && r.sl.length && (r.q || 0) <= 1 && !(r.c === 1) && !upgradeFor(c, { id, n: 1 })) return true;
  // while leveling automatically: everything a player would vendor (no upgrade, not for quests, not food or potions)
  if (G.state.settings.sellAll !== false && c.order && (c.order.type === 'leveling' || (c.order.resume && c.order.resume.type === 'leveling')) && r) {
    if (useInfo(id) && (useInfo(id).kind === 'food' || useInfo(id).kind === 'potion' || useInfo(id).kind === 'drink')) return false;
    if (typeof consKeep === 'function' && consKeep(c, id)) return false;
    if (r.c === 6 && c.cls === 3) return false;                       // arrows and bullets
    if (r.c === 1) { if (!r.cs || r.bf) return true; const eq = c.bagSlots.filter(Boolean).map((b) => (itemRow(b.id) || {}).cs || 0); return eq.length >= 4 && r.cs <= Math.min(...eq); }
    if (r.sl && r.sl.length) return !upgradeFor(c, { id, n: 1 }) && !((r.rl || 0) > c.level && (r.q || 0) >= 2);
    if (r.c === 12 || r.c === 7 || r.c === 9 || r.c === 5 || r.c === 15 || r.c === 0 || r.c === 13) return true;
  }
  return false;
}
function junkCount(c) { let n = 0; for (const s of c.bags) if (isJunk(c, s.id)) n++; return n; }
/* the bags are full: sell at a vendor when auto-sell is on, otherwise stop. */
function bagsFull(c, o) {
  const r = rt(c);
  if (c.prof && !junkCount(c) && (o.type === 'leveling' || o.type === 'patrol' || o.type === 'grind' || o.type === 'questing')) { r.sellMats = true; if (junkCount(c)) log('Bags are full - selling gathered materials too.'); }
  if (cset(c, 'autoSellJunk') && junkCount(c) && !o.noSell) {
    const v = nearestVendor(c);
    if (v) {
      log('Bags are full - going to ' + v.name + ' to sell junk.');
      c.order = { type: 'vendor', label: v.name, vx: v.x, vy: v.y, e: v.e, auto: true, resume: o }; r.mv = null; r.tgt = null; renderOrder(); return true;
    }
  }
  // leveling on its own: no vendor to reach - throw away the cheapest junk to keep going
  if (o.type === 'leveling' || (o.resume && o.resume.type === 'leveling')) {
    const junk = c.bags.map((x, i) => ({ x, i })).filter((q) => isJunk(c, q.x.id)).sort((a, b) => itemSell(a.x.id) * a.x.n - itemSell(b.x.id) * b.x.n);
    if (junk.length) { const k = Math.max(1, Math.ceil(junk.length / 2)); for (const q of junk.slice(0, k).sort((a, b) => b.i - a.i)) c.bags.splice(q.i, 1); r.bagFull = false; log('No vendor in reach - threw away ' + k + ' junk item' + (k > 1 ? 's' : '') + '.'); if (c.order !== o) c.order = o; o.noSell = false; return true; }
  }
  log('Bags are full - ' + c.name + ' stops.'); c.order = null; r.mv = null; r.tgt = null; renderOrder(); save(); return true;
}

/* ----------------------------------------------------------- effects of gear */
function spellRow(id) { return G.d.spells.spells[id] || null; }
/* add one aura [type, misc, value] to a stat block */
function applyAura(s, au, mi, v) {
  switch (au) {
    case 29: if (mi === -1) { for (const k of AURA_STAT) s[k] += v; } else if (AURA_STAT[mi]) s[AURA_STAT[mi]] += v; break;
    case 99: s.ap += v; break;
    case 124: s.rap += v; break;
    case 52: s.crit += v; break;
    case 54: s.hit += v; break;
    case 49: s.dodge += v; break;
    case 47: s.parry += v; break;
    case 51: s.block += v; break;
    case 158: s.blockValue += v; break;
    case 30: if (mi === 95) s.def += v; break;
    case 22: if ((mi || 0) & 1) s.armorBonus += v; for (let i = 0; i < 6; i++) if ((mi || 0) & (2 << i)) s.res[RES_NAMES[i]] += v; break;
    case 13: s.sd += v; break;
    case 135: s.heal += v; break;
    case 85: s.mp5 += v; break;
    case 161: s.hp5 += v; break;
    case 34: s.hpBonus += v; break;
    case 102: case 131: s.apVs.push([mi, v]); break;
    case 71: s.scrit += v; break;
    case 87: s.dmgTaken *= 1 + v / 100; break;
    case 79: s.dmgDone *= 1 + v / 100; break;
    case 55: s.shit += v; break;
    case 9001: s.wBonus += v; break;           // sharpening stone / weightstone (weapon damage)
    case 9002: (s.schoolPct = s.schoolPct || []).push([mi, v]); break;          // more damage of one school (Demonic Sacrifice)
    default: return false;
  }
  return true;
}
function spellAuras(id) {
  const sp = spellRow(id); if (!sp) return [];
  const out = []; for (const e of sp.ef || []) if (e.t === 6 || e.t === 35) out.push([e.au, e.mi, e.lo]); return out;
}
function equipSpells(it) { return (it.fx || []).filter((f) => f.trigger === 1); }

/* ----------------------------------------------------------- character stats */
function dirty(c) { const r = rt(c); r.statVer = (r.statVer || 0) + 1; }
function classAp(cls, L, s) {
  if (cls === 1 || cls === 2 || cls === 7) return s.str * 2 + L * 3 - 20;
  if (cls === 3 || cls === 4) return s.str + s.agi + L * 2 - 20;
  if (cls === 11) return s.str * 2 - 20;
  return s.str - 10;
}
function canDualWield(c) { return (c.cls === 1 && c.level >= 20) || (c.cls === 3 && c.level >= 20) || (c.cls === 4 && c.level >= 10); }
function canParry(c) { return c.cls === 1 || c.cls === 2 || c.cls === 3 || c.cls === 4; }
function isBroken(inst) { return inst && maxDur(inst.id) > 0 && inst.dur <= 0; }
function weaponInfo(inst) {
  const it = inst && !isBroken(inst) ? itemRow(inst.id) : null;
  if (!it || !it.dm || it.c !== 2) return null;
  const d = it.dm[0]; let lo = 0, hi = 0; for (const x of it.dm) { lo += x[0]; hi += x[1]; }
  const ed = inst.ench && inst.ench.dmg ? inst.ench.dmg : 0;
  return { min: lo + ed, max: hi + ed, speed: (it.dl || 2000) / 1000, name: it.n, school: d[2] || 0, it, inst };
}
function charStats(c) {
  const r = rt(c);
  if (r.statCache && r.statCache.v === r.statVer && r.statCache.L === c.level && r.statCache.b === (r.buffs ? r.buffs.length : 0)) return r.statCache.s;
  const b = baseStats(c);
  const s = { str: b.str, agi: b.agi, sta: b.sta, int: b.int, spi: b.spi, ap: 0, rap: 0, crit: 0, hit: 0, dodge: 0, parry: 0, block: 0, blockValue: 0,
    def: c.level * 5, armorItems: 0, armorBonus: 0, res: { holy: 0, fire: 0, nature: 0, frost: 0, shadow: 0, arcane: 0 }, sd: 0, heal: 0, mp5: 0, hp5: 0,
    hpBonus: 0, manaBonus: 0, apVs: [], scrit: 0, shit: 0, procs: [], unknown: [], dmgDone: 1, dmgTaken: 1, wBonus: 0 };
  for (const slot in c.equip) {
    const inst = c.equip[slot]; if (!inst || isBroken(inst)) continue;
    const it = itemRow(inst.id); if (!it) continue;
    s.armorItems += it.ar || 0;
    if (it.bl && +slot === 16) s.blockValue += it.bl;
    for (const [t, v] of (it.st || [])) { if (STAT_KEY[t]) s[STAT_KEY[t]] += v; else if (t === 1) s.hpBonus += v; else if (t === 0) s.manaBonus += v; }
    if (it.res) for (const k in it.res) s.res[k] += it.res[k];
    if (inst.ench) { const e = inst.ench; for (const [k, v] of e.st || []) s[k] += v; s.hpBonus += e.hp || 0; s.manaBonus += e.mana || 0; s.armorBonus += e.armor || 0; if (e.res) for (const k in s.res) s.res[k] += e.res; }
    for (const f of it.fx || []) {
      if (f.trigger === 1) { for (const [au, mi, v] of spellAuras(f.id)) if (!applyAura(s, au, mi, v)) s.unknown.push(f.id); }
      else if (f.trigger === 2) s.procs.push({ spell: f.id, ppm: f.ppm || 0, chance: f.chance || 0, slot: +slot });
    }
    const p = propOf(inst);
    if (p) {
      for (const [t, v] of p.st || []) if (STAT_KEY[t]) s[STAT_KEY[t]] += v;
      for (const [au, mi, v] of p.eq || []) if (au !== 29) applyAura(s, au, mi, v);
      for (const [et, amt, sp] of p.fx || []) { if (et === 1 && sp) s.procs.push({ spell: sp, ppm: 0, chance: 0, slot: +slot }); if (et === 4) s.armorBonus += 0; }
    }
  }
  for (const bf of r.buffs || []) if (bf.until > G.gameTime) for (const [au, mi, v] of bf.auras) applyAura(s, au, mi, v);
  const stance = c.cls === 1 && c.cfg ? c.cfg.stance : null;
  if (stance === 'd') { s.dmgDone *= 0.9; s.dmgTaken *= 0.9; } else if (stance === 'z') { s.crit += 3; s.dmgTaken *= 1.1; }
  // derived numbers
  if (c.form === 'bear') { s.armorItems *= c.known && c.known['Dire Bear Form'] ? 4.6 : 2.8; s.sta = Math.round(s.sta * (c.known && c.known['Dire Bear Form'] ? 1.25 : 1.1)); }
  s.armor = Math.max(0, s.armorItems + s.armorBonus + s.agi * 2);
  s.maxHp = b.maxHp + (s.sta - b.sta) * 10 + s.hpBonus;
  s.maxMana = b.power ? b.power + Math.max(0, s.int - 20) * 15 + Math.min(20, s.int) + s.manaBonus : 0;
  s.ap = Math.max(0, classAp(c.cls, c.level, s) + s.ap + (c.form === 'cat' ? c.level * 2 + s.agi : c.form === 'bear' ? c.level * 3 : 0));
  s.rap = Math.max(0, (c.cls === 3 ? s.agi * 2 + c.level * 2 - 10 : c.cls === 1 || c.cls === 4 ? s.agi + c.level - 10 : 0) + s.rap);
  s.crit += 5 + s.agi / (CRIT_RATIO[c.cls] || 20);
  s.dodge += (c.cls === 4 ? 0 : 0.75) + s.agi / (DODGE_RATIO[c.cls] || 20) + (s.def - c.level * 5) * 0.04;
  s.parry += canParry(c) ? 5 + (s.def - c.level * 5) * 0.04 : 0;
  const off = c.equip[16] && itemRow(c.equip[16].id);
  s.hasShield = !!(off && off.c === 4 && off.s === 6 && !isBroken(c.equip[16]));
  if (s.hasShield) { s.block += 5 + (s.def - c.level * 5) * 0.04; s.blockValue += Math.floor(s.str / 20); } else { s.block = 0; s.blockValue = 0; }
  s.mh = (c.form && typeof formWeapon === 'function' && formWeapon(c)) || weaponInfo(c.equip[15]) || { min: 1, max: 2, speed: 2.0, name: 'Fists', school: 0 };
  if (s.wBonus && !c.form && c.equip[15]) s.mh = Object.assign({}, s.mh, { min: s.mh.min + s.wBonus, max: s.mh.max + s.wBonus });
  const oh = weaponInfo(c.equip[16]); s.oh = oh && canDualWield(c) && !c.form ? oh : null;
  s.mhDps = ((s.mh.min + s.mh.max) / 2 + s.ap / 14 * s.mh.speed) / s.mh.speed;
  s.ohDps = s.oh ? ((s.oh.min + s.oh.max) / 2 + s.ap / 14 * s.oh.speed) * 0.5 / s.oh.speed : 0;
  if (typeof talentStats === 'function') { const a0 = s.armorItems; talentStats(c, s); s.armor += s.armorItems - a0; if (s.hasShield) s.block += s.shieldSpec || 0; }
  if (c.cls !== 1 && typeof classTalentStats === 'function') {
    const k0 = { str: s.str, agi: s.agi, sta: s.sta, int: s.int, ap: s.ap };
    classTalentStats(c, s);
    // stat changes from talents feed into the derived numbers
    s.maxHp += (s.sta - k0.sta) * 10; if (s.maxMana) s.maxMana += (s.int - k0.int) * 15;
    s.crit += (s.agi - k0.agi) / (CRIT_RATIO[c.cls] || 20); s.armor += (s.agi - k0.agi) * 2 + (s.armorPct ? s.armorItems * s.armorPct / 100 : 0);
    s.mhDps = ((s.mh.min + s.mh.max) / 2 + s.ap / 14 * s.mh.speed) / s.mh.speed;
  }
  s.ohDps = s.oh ? ((s.oh.min + s.oh.max) / 2 + s.ap / 14 * s.oh.speed) * (s.ohMult || 0.5) / s.oh.speed : 0;
  s.armorReduction = (lvl) => Math.min(0.75, s.armor / (s.armor + 400 + 85 * lvl));
  r.statCache = { v: r.statVer, L: c.level, b: r.buffs ? r.buffs.length : 0, s };
  return s;
}
/* a rough single number for comparing two items for this character */
function itemScore(c, inst) {
  const it = itemRow(inst.id); if (!it) return 0; const w = WEIGHTS[c.cls] || WEIGHTS[1]; let sc = 0;
  for (const [t, v] of it.st || []) if (STAT_KEY[t]) sc += (w[STAT_KEY[t]] || 0) * v;
  const p = propOf(inst); if (p) for (const [t, v] of p.st || []) if (STAT_KEY[t]) sc += (w[STAT_KEY[t]] || 0) * v;
  sc += (it.ar || 0) * (w.armor || 0);
  if (it.dps) sc += it.dps * (w.dps || 0);
  for (const f of equipSpells(it)) for (const [au, mi, v] of spellAuras(f.id)) {
    const k = { 99: 'ap', 52: 'crit', 54: 'hit', 49: 'dodge', 47: 'parry', 51: 'block', 13: 'sd', 135: 'heal' }[au];
    if (au === 29 && AURA_STAT[mi]) sc += (w[AURA_STAT[mi]] || 0) * v; else if (k) sc += (w[k] || 0) * v;
  }
  return sc;
}
/* optional: put on upgrades by itself (off by default - equipping is the player's job) */
function autoEquip(c) {
  if (!cset(c, 'autoEquip')) return;
  if (rt(c).threats && rt(c).threats.length) { rt(c).equipLater = true; return; }   // after the fight
  rt(c).equipLater = false;
  // bigger bags: into an empty bag slot, or instead of the smallest one
  for (let k = c.bags.length - 1; k >= 0; k--) {
    const b = c.bags[k]; const it = itemRow(b.id); if (!it || it.c !== 1 || !it.cs || it.bf) continue;
    const free = c.bagSlots.findIndex((x) => !x);
    if (free >= 0) { c.bags.splice(k, 1); c.bagSlots[free] = b; log('Equipped bag ' + itemName(b.id) + ' (+' + it.cs + ' slots).'); continue; }
    let si = -1, sc = Infinity; c.bagSlots.forEach((x, i) => { const cs = (itemRow(x.id) || {}).cs || 0; if (cs < sc) { sc = cs; si = i; } });
    if (si >= 0 && it.cs > sc) { const old = c.bagSlots[si]; c.bags.splice(k, 1); c.bagSlots[si] = b; c.bags.push(old); log('Swapped ' + itemName(old.id) + ' for the bigger ' + itemName(b.id) + '.'); }
  }
  for (let k = c.bags.length - 1; k >= 0; k--) { const s = c.bags[k]; const it = itemRow(s.id); if (it && it.sl && it.sl.length && it.c !== 1 && upgradeFor(c, s)) equipFromBag(c, k); }
}
function slotScore(c, inst, slot) { const it = itemRow(inst.id); const v = itemScore(c, inst); return slot === 16 && it && it.c === 2 ? v * 0.5 : v; }
/* how much better the character gets by equipping inst where pickSlot would put it (2H replaces the off hand too) */
function equipDelta(c, inst) {
  const it = itemRow(inst.id); const slot = pickSlot(c, it); let out = 0;
  const cur = c.equip[slot]; if (cur) out += slotScore(c, cur, slot); else out -= 1;
  if (slot === 15 && it.t === 17 && c.equip[16]) out += slotScore(c, c.equip[16], 16);
  if (slot === 16) { const mh = c.equip[15] && itemRow(c.equip[15].id); if (mh && mh.t === 17) out += slotScore(c, c.equip[15], 15); }
  return slotScore(c, inst, slot) - out;
}
function upgradeFor(c, inst) {
  const it = itemRow(inst.id); if (!it || !it.sl || !it.sl.length || canEquip(c, inst.id)) return false;
  if (it.sl.includes(17) && !(c.cls === 3 && it.s !== 19 && it.s !== 16) && !(it.s === 19 && (c.cls === 5 || c.cls === 8 || c.cls === 9))) return false;   // ranged slot: hunters shoot, priests / mages / warlocks use wands
  const d = equipDelta(c, inst); return d > 0.5 + Math.abs(itemScore(c, inst)) * 0.02;
}

/* ----------------------------------------------------------------- equipping */
function canEquip(c, id) {
  const it = itemRow(id); if (!it || !it.sl || !it.sl.length) return 'not equipment';
  if ((it.rl || 0) > c.level) return 'requires level ' + it.rl;
  if (it.rq && it.rq.classes && !it.rq.classes.includes(c.cls)) return 'not for your class';
  if (it.rq && it.rq.races && !it.rq.races.includes(c.race)) return 'not for your race';
  if (it.rf && typeof repItemOk === 'function' && G.d.rep && !repItemOk(c, id)) return 'requires ' + repItemReq(id);
  if (it.rq && it.rq.skill) return null;
  const pf = G.d.items.proficiency[c.cls]; if (!pf) return null;
  if (it.c === 4 && it.s !== 0 && pf.armor && !pf.armor.includes(it.s) && !(it.t === 16)) return 'cannot use ' + (ARMOR_SUB[it.s] || 'this armor');
  if (it.c === 4 && it.s === 3 && c.level < (pf.mail_at || 1)) return 'mail requires level ' + pf.mail_at;
  if (it.c === 4 && it.s === 4 && (!pf.plate_at || c.level < pf.plate_at)) return pf.plate_at ? 'plate requires level ' + pf.plate_at : 'cannot wear plate';
  if (it.c === 2 && pf.weapons && !pf.weapons.includes(it.s)) return 'cannot use ' + (WEAPON_SUB[it.s] || 'this weapon');
  if (it.t === 22 && !canDualWield(c)) return 'needs Dual Wield';
  return null;
}
function pickSlot(c, it) {
  let sl = it.sl.slice();
  if (it.t === 13 && !canDualWield(c)) sl = [15];
  if (sl.length === 1) return sl[0];
  const free = sl.find((x) => !c.equip[x]); if (free != null) return free;
  // replace the weaker one
  let best = sl[0], bv = Infinity; for (const x of sl) { const v = itemScore(c, c.equip[x]); if (v < bv) { bv = v; best = x; } } return best;
}
function equipFromBag(c, idx, forceSlot) {
  const inst = c.bags[idx]; if (!inst) return;
  const it = itemRow(inst.id);
  if (it && it.c === 1 && it.cs) return equipBag(c, idx);
  const why = canEquip(c, inst.id); if (why) { log('Cannot equip ' + itemName(inst.id, inst) + ': ' + why + '.'); return; }
  if (rt(c).threats && rt(c).threats.length && it.c === 4) { log('Cannot change armor while fighting.'); return; }
  const slot = forceSlot != null ? forceSlot : pickSlot(c, it);
  const back = [];
  if (c.equip[slot]) back.push(c.equip[slot]);
  if (slot === 15 && it.t === 17 && c.equip[16]) back.push(c.equip[16]);
  if (slot === 16) { const mh = c.equip[15] && itemRow(c.equip[15].id); if (mh && mh.t === 17) back.push(c.equip[15]); }
  if (back.length - 1 > bagFree(c)) { log('Not enough bag space.'); return; }
  c.bags.splice(idx, 1);
  for (const b of back) { for (const k in c.equip) if (c.equip[k] === b) delete c.equip[k]; c.bags.push(b); }
  c.equip[slot] = inst;
  if (it.bo === 2) inst.bound = 1;
  dirty(c); const st = charStats(c); if (c.hp > st.maxHp) c.hp = st.maxHp;
  log('Equipped ' + itemName(inst.id, inst) + '.'); save(); refreshGear();
}
function unequipSlot(c, slot) {
  const inst = c.equip[slot]; if (!inst) return;
  if (bagFree(c) <= 0) { log('Bags are full.'); return; }
  delete c.equip[slot]; c.bags.push(inst); dirty(c); const st = charStats(c); if (c.hp > st.maxHp) c.hp = st.maxHp; save(); refreshGear();
}
function equipBag(c, idx) {
  const inst = c.bags[idx]; const free = c.bagSlots.findIndex((x) => !x);
  if (free < 0) { log('All four bag slots are used - take a bag off first.'); return; }
  c.bags.splice(idx, 1); c.bagSlots[free] = inst; log('Equipped bag ' + itemName(inst.id) + ' (+' + itemRow(inst.id).cs + ' slots).'); save(); refreshGear();
}
function unequipBag(c, i) {
  const inst = c.bagSlots[i]; if (!inst) return; const cs = (itemRow(inst.id) || {}).cs || 0;
  if (c.bags.length + 1 > bagCapacity(c) - cs) { log('Empty some bag space first.'); return; }
  c.bagSlots[i] = null; c.bags.push(inst); save(); refreshGear();
}
function destroyItem(c, idx) { const s = c.bags[idx]; if (!s) return; if (!confirm('Destroy ' + (s.n > 1 ? s.n + ' x ' : '') + itemName(s.id, s) + '?')) return; c.bags.splice(idx, 1); rt(c).bagFull = false; save(); refreshGear(); }

/* ---------------------------------------------------------------- durability */
function durabilityLoss(c, pct) {
  let broke = [];
  for (const k in c.equip) { const it = c.equip[k]; const m = maxDur(it.id); if (!m) continue; const before = it.dur; it.dur = Math.max(0, it.dur - Math.ceil(m * pct)); if (before > 0 && it.dur === 0) broke.push(itemName(it.id, it)); }
  if (broke.length) log('Broken (gives no stats until repaired): ' + broke.join(', ') + '.');
  dirty(c);
}
function worstDurability(c) { let w = 1; for (const k in c.equip) { const m = maxDur(c.equip[k].id); if (m) w = Math.min(w, c.equip[k].dur / m); } return w; }
function durabilityPct(c) { let a = 0, b = 0; for (const k in c.equip) { const m = maxDur(c.equip[k].id); if (m) { a += c.equip[k].dur; b += m; } } return b ? a / b : 1; }
const Q_REPAIR = [0.5, 1, 1.2, 1.5, 2, 2.5, 2.5];
/* v: the vendor who repairs (a reputation discount from Friendly on) */
function repairCost(c, v) {
  let cost = 0;
  for (const k in c.equip) { const it = c.equip[k]; const r = itemRow(it.id); const m = maxDur(it.id); if (!m || it.dur >= m) continue; const per = Math.max(1, Math.round((r.il || 1) * (r.il || 1) * Q_REPAIR[r.q || 0] / 100)); cost += (m - it.dur) * per; }
  const d = v && typeof repDiscount === 'function' ? repDiscount(c, v.e) : 0;
  return d ? Math.floor(cost * (1 - d)) : cost;
}
function repairAll(c, v) {
  v = v || vendorNear(c, 15); const cost = repairCost(c, v); if (!cost) return;
  if (c.gold < cost) { log('Not enough money to repair (' + money(cost) + ').'); return; }
  c.gold -= cost; for (const k in c.equip) { const m = maxDur(c.equip[k].id); if (m) c.equip[k].dur = m; }
  dirty(c); log('Repaired all gear for ' + money(cost) + '.'); save(); refreshGear();
}

/* ---------------------------------------------------------------- consumables */
function useInfo(id) {
  const it = itemRow(id); if (!it || !it.fx) return null;
  for (const f of it.fx) {
    if ((f.trigger || 0) !== 0) continue; const sp = spellRow(f.id); if (!sp) continue;
    for (const e of sp.ef || []) {
      if (e.t === 10) return { kind: 'potion', lo: e.lo, hi: e.hi, cd: (f.catcd || f.cd || 120000) / 1000, cat: f.cat, sp, combat: true };
      if (e.t === 6 && e.au === 84) { const amp = (e.amp || 3000) / 1000; return { kind: 'food', tick: e.lo, every: amp, dur: (sp.dur || 18000) / 1000, sp, combat: false }; }
      if (e.t === 6 && e.au === 20) { const amp = (e.amp || 3000) / 1000; return { kind: 'food', pct: e.lo, every: amp, dur: (sp.dur || 18000) / 1000, sp, combat: false }; }
      if (e.t === 6 && e.au === 85 && sp.n && /drink/i.test(sp.n)) return { kind: 'drink', sp };
      if (e.t === 6 && e.au === 24 && /drink/i.test(sp.n || '')) return { kind: 'drink', sp };
    }
    return { kind: 'other', sp };
  }
  return null;
}
function useItem(c, idx, auto) {
  const inst = c.bags[idx]; if (!inst) return false;
  if (inst.id === HEARTHSTONE) { const ok = hearthUse(c, auto); if (ok && !auto && SH.open) closeSheet(); return ok; }
  const u = useInfo(inst.id); const r = rt(c);
  if (!u) { if (!auto) log(itemName(inst.id) + ' cannot be used.'); return false; }
  const inCombat = r.threats && r.threats.length;
  if (u.kind === 'potion') {
    if ((r.potionCd || 0) > G.gameTime) { if (!auto) log('Potions are on cooldown.'); return false; }
    const s = charStats(c); const v = Math.floor(u.lo + Math.random() * (u.hi - u.lo + 1));
    c.hp = Math.min(s.maxHp, c.hp + v); r.potionCd = G.gameTime + u.cd; fx(c.pos.x, c.pos.y, '+' + v, '#5ee07a');
    log('Used ' + itemName(inst.id) + ' (+' + v + ' health).');
  } else if (u.kind === 'food') {
    if (inCombat) { if (!auto) log('Cannot eat in combat.'); return false; }
    r.eating = { tick: u.tick || 0, pct: u.pct || 0, every: u.every, left: u.dur, t: 0 }; r.resting = true;
    log('Eating ' + itemName(inst.id) + '.');
  } else if (u.kind === 'drink') {
    if (inCombat) return false; log('Drinking ' + itemName(inst.id) + '.'); r.resting = true;
    if (typeof drinkValue === 'function') r.drinking = { tick: drinkValue(inst.id) / 9, left: 18 };
  } else if (typeof consInfo === 'function' && consInfo(inst.id)) return useConsumable(c, idx, auto ? 'rule' : undefined);
  else { if (!auto) log(itemName(inst.id) + ': ' + (u.sp ? u.sp.n : 'nothing happens') + ' (not simulated yet).'); return false; }
  inst.n--; if (inst.n <= 0) c.bags.splice(idx, 1);
  save(); refreshGear(); return true;
}
function eatStep(c, dt) {
  const r = rt(c); const e = r.eating; if (!e) return;
  if (r.threats && r.threats.length) { r.eating = null; return; }
  e.t += dt; e.left -= dt;
  while (e.t >= e.every) { e.t -= e.every; const s = charStats(c); const v = e.tick || Math.round(s.maxHp * e.pct / 100); c.hp = Math.min(s.maxHp, c.hp + v); }
  if (e.left <= 0 || c.hp >= charStats(c).maxHp) r.eating = null;
}
/* food and water a mage conjured: eaten and drunk before anything else (they are free and vanish anyway) */
function isConjured(id) { const it = itemRow(id); return !!(it && it.n && /^Conjured /.test(it.n)); }
function autoEat(c) {
  if (rt(c).eating) return;
  let best = -1, bv = 0;
  c.bags.forEach((s, i) => { const u = useInfo(s.id); const it = itemRow(s.id); if (u && u.kind === 'food' && (!it.rl || it.rl <= c.level)) { const v = (u.tick || 0) * u.dur / u.every + (isConjured(s.id) ? 1e7 : 0); if (v > bv) { bv = v; best = i; } } });
  if (best >= 0) useItem(c, best, true);
}
function autoPotion(c) {
  const at = c.cfg ? c.cfg.potionAt : 30; if (!at) return; const r = rt(c);
  if ((r.potionCd || 0) > G.gameTime) return; const s = charStats(c); if (c.hp > s.maxHp * at * masteryLate(c) / 100) return;
  let best = -1, bv = 0;
  c.bags.forEach((x, i) => { const u = useInfo(x.id); const it = itemRow(x.id); if (u && u.kind === 'potion' && (!it.rl || it.rl <= c.level) && u.hi > bv) { bv = u.hi; best = i; } });
  if (best >= 0) useItem(c, best, true);
}

/* --------------------------------------------------------------------- vendors */
function vendorList() {
  if (G.vend) return G.vend;
  G.vend = []; const vi = G.d.vendorItems || {};
  const old = {}; for (const v of G.d.vendors || []) old[v.entry] = v;
  for (const e in G.d.hostility.creatures) {
    const h = G.d.hostility.creatures[e];
    if (!(h[9] & NPC_VENDOR) && !vi[e] && !old[e]) continue;
    for (const s of G.spawnMap.get(+e) || []) G.vend.push({ name: (G.mobIdx[e] || [0, 'Vendor'])[1], map: s[0], x: s[1], y: s[2], e: +e, repair: !!(h[9] & NPC_REPAIR) || !!(old[e] && old[e].repair) });
  }
  return G.vend;
}
function vendorItems(e) {
  const vi = G.d.vendorItems && G.d.vendorItems[e]; if (vi) return vi.map(([id, mc]) => ({ id, stock: mc }));
  const v = (G.d.vendors || []).find((x) => x.entry === e); return v ? v.items.map((x) => ({ id: x.item, stock: x.stock, price: x.price })) : [];
}
function vendorsOnMap(mapId) { return vendorList().filter((v) => v.map === mapId); }
/* a vendor next to creatures far above the character's level is not an option */
function vendorSafe(c, v) {
  const r = rt(c); r.vsafe = r.vsafe || {}; const k = v.e + ':' + Math.round(v.x) + ':' + c.level;
  if (k in r.vsafe) return r.vsafe[k];
  let ok = true; const W = ensureWorld(v.map);
  mobsNear(W, v.x, v.y, 50, (m) => { if (ok && m.st === 'alive' && !m.civ && behOf(m, c) === 'A' && dangerous(m, c) && Math.hypot(m.hx - v.x, m.hy - v.y) < aggroRadius(m, c) + 20) ok = false; });
  return (r.vsafe[k] = ok);
}
function nearestVendor(c, needRepair) {
  const list = [];
  for (const v of vendorsOnMap(c.pos.map)) { if (needRepair && !v.repair) continue; const b = behOf({ e: v.e }, c); if (b === 'A') continue; list.push([Math.hypot(v.x - c.pos.x, v.y - c.pos.y), v]); }
  list.sort((a, b) => a[0] - b[0]);
  const bad = rt(c).badVendor || {};
  for (const [, v] of list.slice(0, 40)) if (!(bad[v.e] > G.gameTime) && vendorSafe(c, v)) return v;
  for (const [, v] of list) if (!(bad[v.e] > G.gameTime)) return v;
  return null;
}
function vendorNear(c, range) { const v = nearestVendor(c); return v && Math.hypot(v.x - c.pos.x, v.y - c.pos.y) <= (range || 8) ? v : null; }
function sellIndex(c, idx) {
  const v = vendorNear(c); if (!v) { log('No vendor in reach.'); return; }
  const s = c.bags[idx]; if (!s) return; const p = itemSell(s.id) * s.n;
  if (!p) { log(itemName(s.id, s) + ' cannot be sold.'); return; }
  c.bags.splice(idx, 1); c.gold += p; rt(c).bagFull = false; (rt(c).buyback = rt(c).buyback || []).unshift(s); rt(c).buyback.length = Math.min(12, rt(c).buyback.length);
  log('Sold ' + itemName(s.id, s) + (s.n > 1 ? ' x' + s.n : '') + ' for ' + money(p) + '.'); save(); refreshGear();
}
function buyItem(c, id) {
  const v = vendorNear(c); if (!v) { log('No vendor in reach.'); return; }
  if (!repItemOk(c, id)) { log(itemName(id) + ' requires ' + repItemReq(id) + '.'); return; }
  const price = vendorPrice(c, id, v.e); if (c.gold < price) { log('Not enough money.'); return; }
  const n = buyCount(id);
  if (!addItem(c, id, n)) { log('Bags are full.'); return; }
  c.gold -= price; log('Bought ' + (n > 1 ? n + ' x ' : '') + itemName(id) + ' for ' + money(price) + '.'); save(); refreshGear();
}
function sellJunk(c) {
  let total = 0, n = 0;
  for (let i = c.bags.length - 1; i >= 0; i--) { const s = c.bags[i]; if (!isJunk(c, s.id)) continue; total += itemSell(s.id) * s.n; n += s.n; c.bags.splice(i, 1); }
  // too much food: keep the 3 best stacks of food and of potions
  for (const kind of ['food', 'potion']) {
    const idx = c.bags.map((x, i) => ({ x, i, u: useInfo(x.id) })).filter((o) => o.u && o.u.kind === kind && !questWants(c, o.x.id)).sort((a, b) => ((b.u.hi || b.u.tick * b.u.dur || 0) - (a.u.hi || a.u.tick * a.u.dur || 0)));
    for (const o of idx.slice(3).sort((a, b) => b.i - a.i)) { total += itemSell(o.x.id) * o.x.n; n += o.x.n; c.bags.splice(o.i, 1); }
  }
  if (n) { c.gold += total; log('Sold ' + n + ' junk item' + (n > 1 ? 's' : '') + ' for ' + money(total) + '.'); fx(c.pos.x, c.pos.y, '+' + money(total), '#ffd866'); }
  rt(c).bagFull = false; save(); refreshGear(); return n;
}
function autoSellNearVendor(c) {
  if (!cset(c, 'autoSellJunk')) return;
  const r = rt(c); if (G.gameTime - (r.lastSell || -99) < 20) return;
  const v = vendorNear(c, 15); if (!v) return;
  r.lastSell = G.gameTime;
  if (junkCount(c)) sellJunk(c);
  if (cset(c, 'autoRepair') && v.repair && repairCost(c)) repairAll(c);
  autoBuyBags(c, v); autoBuyGear(c, v); autoBuyFood(c, v);
}
/* buy the biggest bag this vendor sells into an empty bag slot, keeping some money (player-like) */
/* keep some food: buy a stack of the best food this vendor sells when less than 10 are left */
/* hunters: arrows or bullets for the equipped bow / gun (a quiver's worth) */
function ammoKind(c) { const w = c.equip[17] && itemRow(c.equip[17].id); return w ? (w.s === 3 ? 3 : w.s === 2 || w.s === 18 ? 2 : 0) : 0; }
function ammoCount(c) { const k = ammoKind(c); let n = 0; for (const x of c.bags) { const it = itemRow(x.id); if (it && it.c === 6 && it.s === k) n += x.n; } return n; }
function autoBuyAmmo(c, v) {
  const k = ammoKind(c); if (!k || ammoCount(c) >= 400) return;
  let best = null;
  for (const x of vendorItems(v.e)) { const it = itemRow(x.id); if (!it || it.c !== 6 || it.s !== k || (it.rl || 0) > c.level || !repItemOk(c, x.id)) continue; const val = it.dps || it.rl || 1; if (!best || val > best.val) best = { id: x.id, val, price: vendorPrice(c, x.id, v.e) }; }
  if (!best) return;
  const per = itemStack(best.id); const stacks = Math.min(3, Math.floor(c.gold * 0.2 / Math.max(1, best.price)));
  if (stacks < 1 || bagFree(c) < stacks) return;
  if (addItem(c, best.id, per * stacks)) { c.gold -= stacks * best.price; log('Bought ' + per * stacks + ' x ' + itemName(best.id) + '.'); }
}
function autoBuyFood(c, v, kind) {
  if (!v || G.state.settings.autoBuyFood === false) return;
  if (!kind) { autoBuyFood(c, v, 'food'); if (typeof usesMana === 'function' && usesMana(c) && c.cls !== 1) autoBuyFood(c, v, 'drink'); if (c.cls === 3) { autoBuyAmmo(c, v); if (typeof autoBuyPetFood === 'function') autoBuyPetFood(c, v); } return; }
  let have = 0; for (const x of c.bags) { const u = useInfo(x.id); if (u && u.kind === kind) have += x.n; }
  if (have >= 10) return;
  let best = null;
  for (const x of vendorItems(v.e)) {
    const it = itemRow(x.id); const u = useInfo(x.id); if (!it || !u || u.kind !== kind || (it.rl || 0) > c.level || !repItemOk(c, x.id)) continue;
    if (kind === 'food' && !u.tick) continue;
    const val = kind === 'food' ? u.tick * u.dur / u.every : drinkValue(x.id); if (!best || val > best.val) best = { id: x.id, val, price: vendorPrice(c, x.id, v.e) };
  }
  if (!best) return;
  const per = buyCount(best.id); const stacks = Math.min(2, Math.floor(c.gold * 0.15 / Math.max(1, best.price))); if (stacks < 1 || bagFree(c) <= 0) return;
  if (addItem(c, best.id, per * stacks)) { c.gold -= stacks * best.price; log('Bought ' + per * stacks + ' x ' + itemName(best.id) + ' for ' + money(stacks * best.price) + '.'); }
}
/* buy equipment upgrades a vendor sells, spending at most a third of the money (while leveling automatically) */
function autoBuyGear(c, v) {
  if (!v || !cset(c, 'autoEquip') || !c.order || !(c.order.type === 'leveling' || (c.order.resume && c.order.resume.type === 'leveling'))) return;
  for (const x of vendorItems(v.e)) {
    const it = itemRow(x.id); if (!it || !it.sl || !it.sl.length || it.c === 1) continue;
    if (!repItemOk(c, x.id)) continue;
    const price = vendorPrice(c, x.id, v.e); if (price > c.gold / 3 || bagFree(c) <= 0) continue;
    const inst = makeInst(x.id, 1); if (!upgradeFor(c, inst)) continue;
    c.gold -= price; c.bags.push(inst); log('Bought ' + itemName(x.id) + ' for ' + money(price) + ' (an upgrade).');
    autoEquip(c);
  }
}
function autoBuyBags(c, v) {
  if (!cset(c, 'autoBuyBags') || !v) return;
  for (let k = 0; k < 4; k++) {
    const free = c.bagSlots.findIndex((x) => !x); if (free < 0) return;
    let best = null;
    for (const x of vendorItems(v.e)) { const it = itemRow(x.id); if (!it || it.c !== 1 || !it.cs || it.bf || !repItemOk(c, x.id)) continue; const price = vendorPrice(c, x.id, v.e); if (c.gold < price + 100) continue; if (!best || it.cs > best.cs || (it.cs === best.cs && price < best.price)) best = { id: x.id, cs: it.cs, price }; }
    if (!best) return;
    c.gold -= best.price; c.bagSlots[free] = makeInst(best.id, 1); log('Bought and equipped ' + itemName(best.id) + ' (+' + best.cs + ' slots) for ' + money(best.price) + '.');
    rt(c).bagFull = false;
  }
  save(); refreshGear();
}
function orderVendor(c, v, auto) {
  v = v || nearestVendor(c); if (!v) { log('No friendly vendor known on this map.'); return; }
  c.order = { type: 'vendor', label: v.name, vx: v.x, vy: v.y, e: v.e, auto: !!auto }; log('Order: go to ' + v.name + '.'); save(); renderOrder();
}
function orderRepair(c) { const v = nearestVendor(c, true); if (!v) { log('No repair vendor known on this map.'); return; } orderVendor(c, v, true); c.order.repair = true; }
function updateVendor(c, o, dt) {
  o.t0 = o.t0 || G.gameTime;
  if (G.gameTime - o.t0 > 600) {     // 10 minutes and still not there: try another vendor
    const r = rt(c); r.badVendor = r.badVendor || {}; r.badVendor[o.e] = G.gameTime + 3600; log('Cannot get to ' + o.label + ' - trying another vendor.');
    const res = o.resume; c.order = res || null; if (res) { res.noSell = false; bagsFull(c, res); } renderOrder(); return;
  }
  const ok = goTo(c, o.vx, o.vy, 3);
  if (rt(c).blocked) {
    rt(c).blocked = false; log('Route to ' + o.label + ' is blocked.');
    const r = rt(c); r.badVendor = r.badVendor || {}; r.badVendor[o.e] = G.gameTime + 3600;
    c.order = o.resume || null; if (o.resume && (r.bagFull || bagFree(c) <= 0)) bagsFull(c, o.resume);
    renderOrder(); return;
  }
  if (!ok) return;
  if (o.auto || cset(c, 'autoSellJunk')) sellJunk(c);
  const vv = vendorList().find((x) => x.e === o.e);
  if ((o.repair || cset(c, 'autoRepair')) && repairCost(c)) { if (vv && vv.repair) repairAll(c); }
  autoBuyBags(c, vv); autoBuyGear(c, vv); autoBuyFood(c, vv);
  log('At ' + o.label + '.');
  c.order = o.resume || null; if (o.resume) { o.resume.wait = 0; o.resume.noSell = junkCount(c) === 0 && bagFree(c) <= 0; }
  renderOrder(); if (!o.resume && !G.headless && isActive(c)) openSheet('vendor');
}

/* --------------------------------------------------------------------- tooltip */
function auraText(au, mi, v) {
  switch (au) {
    case 99: return 'Equip: +' + v + ' Attack Power.';
    case 124: return 'Equip: +' + v + ' ranged Attack Power.';
    case 52: return 'Equip: Improves your chance to get a critical strike by ' + v + '%.';
    case 54: return 'Equip: Improves your chance to hit by ' + v + '%.';
    case 49: return 'Equip: Increases your chance to dodge an attack by ' + v + '%.';
    case 47: return 'Equip: Increases your chance to parry an attack by ' + v + '%.';
    case 51: return 'Equip: Increases your chance to block attacks with a shield by ' + v + '%.';
    case 158: return 'Equip: Increases the block value of your shield by ' + v + '.';
    case 30: return mi === 95 ? 'Equip: Increased Defense +' + v + '.' : 'Equip: Increased skill +' + v + '.';
    case 13: return 'Equip: Increases damage done by magical spells and effects by up to ' + v + '.';
    case 135: return 'Equip: Increases healing done by spells and effects by up to ' + v + '.';
    case 85: return 'Equip: Restores ' + v + ' mana per 5 sec.';
    case 161: return 'Equip: Restores ' + v + ' health per 5 sec.';
    case 71: return 'Equip: Improves your chance to get a critical strike with spells by ' + v + '%.';
    case 55: return 'Equip: Improves your chance to hit with spells by ' + v + '%.';
    case 102: case 131: return 'Equip: +' + v + ' Attack Power when fighting certain creatures.';
    case 22: return (mi & 1) ? 'Equip: +' + v + ' Armor.' : 'Equip: +' + v + ' resistance.';
    case 29: return 'Equip: +' + v + ' ' + (mi === -1 ? 'all stats' : STAT_LABEL[AURA_STAT[mi]] || 'stat') + '.';
    default: return null;
  }
}
function spellLine(prefix, id) {
  const sp = spellRow(id); if (!sp) return prefix + 'spell ' + id;
  if (prefix === 'Equip: ') { const t = spellAuras(id).map(([a, m, v]) => auraText(a, m, v)).filter(Boolean); if (t.length) return t.join('<br>'); }
  if (sp.desc) return prefix + sp.desc;
  for (const e of sp.ef || []) {
    if (e.t === 10) return prefix + 'Restores ' + e.lo + (e.hi > e.lo ? ' to ' + e.hi : '') + ' health.';
    if (e.t === 6 && e.au === 84) return prefix + 'Restores ' + Math.round(e.lo * (sp.dur || 18000) / (e.amp || 3000)) + ' health over ' + Math.round((sp.dur || 18000) / 1000) + ' sec. Must remain seated while eating.';
    if (e.t === 2) return prefix + 'Deals ' + e.lo + (e.hi > e.lo ? ' to ' + e.hi : '') + ' damage.';
  }
  return prefix + sp.n + (sp.r ? ' (' + sp.r + ')' : '');
}
function tooltipHtml(c, inst, opts) {
  const id = inst.id; const it = itemRow(id); const l = lootRow(id);
  const q = itemQuality(id); let h = '<div class="tt-name" style="color:' + QUALITY_COLORS[q] + '">' + esc(itemName(id, inst)) + '</div>';
  if (!it) { h += '<div class="muted">Sell price: ' + moneyHtml(itemSell(id)) + '</div>'; return h; }
  if (it.bo) h += '<div>' + (inst.bound ? 'Soulbound' : G.d.items.meta.bonding[it.bo]) + '</div>';
  if (it.mc === 1) h += '<div>Unique</div>';
  if (inst.ench) h += '<div style="color:#1eff00">' + esc(inst.ench.n) + '</div>';
  const inv = G.d.items.meta.inventory[it.t] || ''; const sub = it.c === 2 ? WEAPON_SUB[it.s] : it.c === 4 ? ARMOR_SUB[it.s] : '';
  if (inv || sub) h += '<div class="tt-row"><span>' + esc(inv) + '</span><span>' + esc(sub || '') + '</span></div>';
  if (it.dm) {
    const d = it.dm[0]; h += '<div class="tt-row"><span>' + Math.round(d[0]) + ' - ' + Math.round(d[1]) + ' Damage</span><span>Speed ' + ((it.dl || 2000) / 1000).toFixed(2) + '</span></div>';
    for (const x of it.dm.slice(1)) h += '<div>+' + Math.round(x[0]) + ' - ' + Math.round(x[1]) + ' ' + G.d.items.meta.schools[x[2]] + ' Damage</div>';
    if (it.dps) h += '<div>(' + it.dps.toFixed(1) + ' damage per second)</div>';
  }
  if (it.ar) h += '<div>' + it.ar + ' Armor</div>';
  if (it.bl) h += '<div>' + it.bl + ' Block</div>';
  for (const [t, v] of it.st || []) if (STAT_KEY[t] || t <= 1) h += '<div>' + (v > 0 ? '+' : '') + v + ' ' + (STAT_LABEL[STAT_KEY[t]] || (t === 1 ? 'Health' : 'Mana')) + '</div>';
  const p = propOf(inst); if (p) for (const [t, v] of p.st || []) if (STAT_KEY[t]) h += '<div>+' + v + ' ' + STAT_LABEL[STAT_KEY[t]] + '</div>';
  if (it.res) for (const k in it.res) h += '<div>+' + it.res[k] + ' ' + k[0].toUpperCase() + k.slice(1) + ' Resistance</div>';
  if (it.cs) h += '<div>' + it.cs + ' Slot ' + (it.bf ? 'Special ' : '') + 'Bag</div>';
  const md = maxDur(id); if (md) h += '<div' + (inst.dur === 0 ? ' style="color:#ff3b30"' : '') + '>Durability ' + (inst.dur != null ? inst.dur : md) + ' / ' + md + '</div>';
  if (it.rl > 1) h += '<div' + (it.rl > c.level ? ' style="color:#ff3b30"' : '') + '>Requires Level ' + it.rl + '</div>';
  if (typeof repTipLine === 'function' && G.d.rep) h += repTipLine(c, id);
  const why = it.sl && it.sl.length ? canEquip(c, id) : null; if (why && why.indexOf('level') < 0 && why.indexOf('requires ') !== 0) h += '<div style="color:#ff3b30">' + esc(why[0].toUpperCase() + why.slice(1)) + '</div>';
  for (const f of it.fx || []) {
    const tr = f.trigger || 0;
    h += '<div class="tt-green">' + spellLine(tr === 1 ? 'Equip: ' : tr === 2 ? 'Chance on hit: ' : 'Use: ', f.id) + '</div>';
  }
  if (p) for (const [au, mi, v] of p.eq || []) if (au !== 29) { const t = auraText(au, mi, v); if (t) h += '<div class="tt-green">' + t + '</div>'; }
  if (it.ds) h += '<div class="tt-desc">"' + esc(it.ds) + '"</div>';
  if (it.il) h += '<div class="muted small">Item level ' + it.il + '</div>';
  if (typeof recipeTipLine === 'function') h += recipeTipLine(c, inst.id);
  if (typeof hearthTipLine === 'function') h += hearthTipLine(c, inst.id);
  if (it.scroll && typeof scrollTipLine === 'function') h += scrollTipLine(c, inst.id);
  if (typeof ahTipLine === 'function' && !(opts && opts.noAh)) h += ahTipLine(c, inst);
  const sp = itemSell(id); h += sp ? '<div class="small">Sell price: ' + moneyHtml(sp * (inst.n || 1)) + '</div>' : '<div class="small muted">No sell price</div>';
  if (opts && opts.price) h += '<div class="small">Buy price: ' + moneyHtml(opts.price) + '</div>';
  return h;
}
