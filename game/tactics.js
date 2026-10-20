'use strict';
/* tactics.js - tactics like Dragon Age: Origins, with the abilities of World of Warcraft.
   Up to 40 slots, checked from the top every moment of a fight: the first one whose condition is true and whose action
   can be done right now (learned, ready, enough mana / rage / energy, in range, worth it) is done; then the list starts
   over. When nothing fits the character just keeps auto-attacking (or shooting its wand) - the "behavior".
   A slot: a condition about Self, an Ally or an Enemy (who the action goes to) and an action: use an ability, use an
   item (potions, healthstone, bandage), attack that enemy, jump to another slot, or wait.
   Presets: Default (the character's talents and its role in the group pick Tank / Healer / Damage), the three by hand,
   three Custom lists of your own - changing a preset makes it Custom - and the classic list of the "Abilities &
   behaviour" tab. The same presets (complex, with heals, interrupts, crowd control, cooldowns, area attacks, potions)
   are what every character you have not set up plays, and the mercenaries play theirs (mercs.js: mercTactics). */

const TAC_MAX = 40;
const TAC_PRESETS = { auto: 'Default (by talents and role)', dps: 'Damage', tank: 'Tank', heal: 'Healer', c1: 'Custom 1', c2: 'Custom 2', c3: 'Custom 3', classic: 'Classic list (Abilities & behaviour)' };
const TAC_BEHAVIOR = { aggressive: 'Aggressive', balanced: 'Default', safe: 'Cautious' };
/* removes these kinds of harmful effects (DispelType: 1 magic, 2 curse, 3 disease, 4 poison) */
const TAC_DISPELS = { 'Cleanse': [1, 3, 4], 'Purify': [3, 4], 'Dispel Magic': [1], 'Remove Lesser Curse': [2], 'Remove Curse': [2], 'Cure Poison': [4], 'Abolish Poison': [4],
  'Cure Disease': [3], 'Abolish Disease': [3], 'Purge': [] };
const TAC_INTERRUPTS = new Set(['Pummel', 'Shield Bash', 'Kick', 'Earth Shock', 'Counterspell', 'Silence', 'Bash', 'Hammer of Justice', 'Concussion Blow', 'War Stomp', 'Gouge', 'Intimidation']);
/* crowd control: the creature types they work on (pullplan.js CREATURE_TYPE) */
const TAC_CC = { 'Polymorph': [7, 1], 'Sap': [7], 'Shackle Undead': [6], 'Banish': [3, 4], 'Hibernate': [1, 2], 'Fear': [1, 2, 3, 4, 5, 6, 7, 9, 10], 'Seduction': [7], 'Turn Undead': [6], 'Blind': [1, 2, 3, 4, 5, 6, 7, 9, 10],
  'Gouge': [1, 2, 3, 4, 5, 6, 7, 9, 10], 'Scare Beast': [1], 'Freezing Trap': [1, 2, 3, 4, 5, 6, 7, 9, 10], 'Repentance': [7, 2, 5, 3, 6], 'Wyvern Sting': [1, 2, 3, 4, 5, 6, 7, 9, 10] };

/* ------------------------------------------------------------------ conditions
   g: Self / Ally / Enemy; t: the text (X: the number); p: the default number; f(ctx, p): the target or null */
const TAC_CONDS = {
  'self.any': { g: 'Self', t: 'Any', f: (x) => x.self },
  'self.hp<': { g: 'Self', t: 'Health < X%', p: 50, f: (x, p) => x.hpPct < p ? x.self : null },
  'self.hp>': { g: 'Self', t: 'Health > X%', p: 80, f: (x, p) => x.hpPct > p ? x.self : null },
  'self.mp<': { g: 'Self', t: 'Mana or energy < X%', p: 30, f: (x, p) => x.mpPct < p ? x.self : null },
  'self.mp>': { g: 'Self', t: 'Mana or energy > X%', p: 60, f: (x, p) => x.mpPct > p ? x.self : null },
  'self.rage>': { g: 'Self', t: 'Rage at least X', p: 40, f: (x, p) => (x.c.rage || 0) >= p ? x.self : null },
  'self.rage<': { g: 'Self', t: 'Rage < X', p: 15, f: (x, p) => (x.c.rage || 0) < p ? x.self : null },
  'self.cp>': { g: 'Self', t: 'Combo points at least X', p: 5, f: (x, p) => (x.r.cp || 0) >= p && x.r.cpTgt === x.tgt ? x.self : null },
  'self.melee': { g: 'Self', t: 'Being attacked by a melee attack', f: (x) => x.att.some((m) => m.tgt === x.c && inMelee(x.c, m)) ? x.self : null },
  'self.att>': { g: 'Self', t: 'Attacked by at least X enemies', p: 2, f: (x, p) => x.att.filter((m) => m.tgt === x.c).length >= p ? x.self : null },
  'self.sur>': { g: 'Self', t: 'Surrounded by at least X enemies', p: 3, f: (x, p) => x.att.filter((m) => inMelee(x.c, m)).length >= p ? x.self : null },
  'self.nobuff': { g: 'Self', t: 'Without this buff', f: (x) => !x.n || buffLeft(x.c, x.n) <= 3 ? x.self : null },
  'self.disp': { g: 'Self', t: 'Has an effect this ability removes', f: (x) => tacHasDispellable(x, { c: x.c }) ? x.self : null },
  'self.pethp<': { g: 'Self', t: "Pet's health < X%", p: 40, f: (x, p) => petAlive(x.c) && x.c.pet.hp < petStats(x.c).maxhp * p / 100 ? x.self : null },
  'self.nopet': { g: 'Self', t: 'Pet missing or dead', f: (x) => x.c.pet && !petAlive(x.c) ? x.self : null },
  'ally.hp<': { g: 'Ally', t: 'Health < X%', p: 50, f: (x, p) => tacLowest(x, (a) => a.pct * 100 < p) },
  'ally.tank<': { g: 'Ally', t: 'The tank: health < X%', p: 60, f: (x, p) => tacLowest(x, (a) => a.role === 'tank' && a.pct * 100 < p) },
  'ally.mp<': { g: 'Ally', t: 'Mana < X% (the healers first)', p: 25, f: (x, p) => { const l = x.allies.filter((a) => a.mp != null && a.mp * 100 < p).sort((a, b) => (b.role === 'healer') - (a.role === 'healer') || a.mp - b.mp); return l[0] || null; } },
  'ally.hit': { g: 'Ally', t: 'Being attacked (not the tank)', f: (x) => tacLowest(x, (a) => a.role !== 'tank' && a.hit) },
  'ally.nobuff': { g: 'Ally', t: 'Without this buff', f: (x) => tacLowest(x, (a) => !tacHasBuff(x, a, x.n)) },
  'ally.disp': { g: 'Ally', t: 'Has an effect this ability removes', f: (x) => tacLowest(x, (a) => tacHasDispellable(x, a)) },
  'ally.hurt>': { g: 'Ally', t: 'At least X allies below 70% health', p: 3, f: (x, p) => x.allies.filter((a) => a.pct < 0.7).length >= p ? x.self : null },
  'enemy.tgt': { g: 'Enemy', t: 'My target', f: (x) => x.tgt },
  'enemy.hp<': { g: 'Enemy', t: 'Target health < X%', p: 20, f: (x, p) => x.tgt && x.tgt.hp / x.tgt.maxhp * 100 < p ? x.tgt : null },
  'enemy.hp>': { g: 'Enemy', t: 'Target health > X%', p: 60, f: (x, p) => x.tgt && x.tgt.hp / x.tgt.maxhp * 100 > p ? x.tgt : null },
  'enemy.elite': { g: 'Enemy', t: 'Target is elite, rare or a boss', f: (x) => x.tgt && (isTough(x.tgt) || (x.r.mWaste && x.att.length >= 2)) ? x.tgt : null },
  'enemy.boss': { g: 'Enemy', t: 'Target is a boss', f: (x) => x.tgt && x.tgt.rank === 3 ? x.tgt : null },
  'enemy.cast': { g: 'Enemy', t: 'Casting a spell', f: (x) => x.att.find((m) => m.cast && m.cast.total >= 1 && !(m.cast.intBy && m.cast.intBy.o !== x.c)) || null },
  'enemy.flee': { g: 'Enemy', t: 'Fleeing', f: (x) => x.att.find((m) => m.fleeing) || null },
  'enemy.nodeb': { g: 'Enemy', t: 'Target without my debuff', f: (x) => x.tgt && x.tgt.hp / x.tgt.maxhp > 0.25 && !mobAura(x.tgt, x.n) ? x.tgt : null },
  'enemy.nodebAll': { g: 'Enemy', t: 'An attacker without my debuff', f: (x) => x.att.find((m) => m.hp / m.maxhp > 0.25 && inMelee(x.c, m) && !mobAura(m, x.n)) || x.att.find((m) => m.hp / m.maxhp > 0.25 && !mobAura(m, x.n) && x.sp && x.sp.rng && Math.hypot(m.x - x.c.pos.x, m.y - x.c.pos.y) <= x.sp.rng[1]) || null },
  'enemy.stack<': { g: 'Enemy', t: 'Target with fewer than X stacks of it', p: 5, f: (x, p) => { if (!x.tgt) return null; const a = mobAura(x.tgt, x.n); return !a || a.stacks < p || a.until - G.gameTime < 4 ? x.tgt : null; } },
  'enemy.clus>': { g: 'Enemy', t: 'Clustered with at least X enemies', p: 3, f: (x, p) => { const t = x.tgt; if (!t) return null; return x.att.filter((m) => Math.hypot(m.x - t.x, m.y - t.y) <= AOE_RADIUS + 2).length >= p ? t : null; } },
  'enemy.att>': { g: 'Enemy', t: 'At least X enemies fighting us', p: 3, f: (x, p) => x.att.length >= p ? x.tgt || x.att[0] : null },
  'enemy.onally': { g: 'Enemy', t: 'Attacking an ally (not the tank)', f: (x) => x.att.find((m) => tacVictimNotTank(x, m)) || null },
  'enemy.loose': { g: 'Enemy', t: 'An extra attacker to crowd-control', f: (x) => tacLoose(x) },
  'enemy.melee': { g: 'Enemy', t: 'Target in melee range', f: (x) => x.tgt && inMelee(x.c, x.tgt) ? x.tgt : null },
  'enemy.far': { g: 'Enemy', t: 'Target beyond melee range', f: (x) => x.tgt && !inMelee(x.c, x.tgt) ? x.tgt : null },
};
const TAC_COND_ORDER = Object.keys(TAC_CONDS);
/* items as actions */
const TAC_ITEMS = { '#hp': 'Health potion: most powerful', '#hpmin': 'Health potion: least powerful', '#stone': 'Healthstone', '#mp': 'Mana potion: most powerful', '#mpmin': 'Mana potion: least powerful', '#band': 'Bandage', '#bomb': 'Explosive (bomb, dynamite)' };

/* ------------------------------------------------------------------ the evaluation context */
function tacAllies(c) {
  const out = []; const R = typeof raidMembers === 'function' ? raidMembers(c) : { chars: [c], mercs: [] };
  const myRole = tacRole(c);
  for (const o of R.chars) {
    if (o.pos.map !== c.pos.map || rt(o).ghost || o.hp <= 0 || Math.hypot(o.pos.x - c.pos.x, o.pos.y - c.pos.y) > 40) continue;
    const s = charStats(o); out.push({ c: o, self: o === c, x: o.pos.x, y: o.pos.y, pct: o.hp / s.maxHp, mp: usesMana(o) && s.maxMana ? o.mana / s.maxMana : null, role: o === c ? myRole : (typeof grpRole === 'function' && grpRole(o)) || 'dps',
      hit: (rt(c).threats || []).some((m) => m.tgt === o) });
  }
  for (const u of R.mercs) {
    if (u.dead || Math.hypot(u.x - c.pos.x, u.y - c.pos.y) > 40) continue;
    out.push({ merc: u, x: u.x, y: u.y, pct: u.hp / u.maxhp, mp: u.pt === 0 && u.maxmana ? u.mana / u.maxmana : null, role: u.role, hit: (rt(c).threats || []).some((m) => typeof mobVictimKey === 'function' && mobVictimKey(m, c) === u.id) });
  }
  return out;
}
function tacLowest(x, ok) { let b = null; for (const a of x.allies) if (ok(a) && (!b || a.pct - (a.role === 'tank' ? 0.05 : 0) < b.pct - (b.role === 'tank' ? 0.05 : 0))) b = a; return b; }
/* the role this character plays now: its group role, the one the mercenaries leave free, else by its talents (alone: damage) */
function tacRole(c) {
  if (typeof groupOf === 'function' && groupOf(c)) return grpRole(c) || 'dps';
  const p = rt(c).party; if (p && p.length) return !p.some((u) => u.role === 'tank') ? 'tank' : !p.some((u) => u.role === 'healer') ? 'healer' : 'dps';
  return 'solo';
}
function tacVictimNotTank(x, m) {
  const c = x.c; let role = null;
  if (rt(c).party && typeof mobVictimKey === 'function') {
    const k = mobVictimKey(m, c);
    if (k === 'c') role = tacRole(c); else if (k === 'p') role = 'pet'; else { const u = partyUnit(c, k); role = u ? u.role : null; }
  } else if (m.tgt) role = m.tgt === c ? tacRole(c) : (typeof grpRole === 'function' && grpRole(m.tgt)) || 'dps';
  return !!role && role !== 'tank' && role !== 'pet' && role !== 'solo';
}
function tacLoose(x) {
  if (x.att.length < 2) return null; const types = TAC_CC[x.n];
  for (const m of x.att) {
    if (m === x.tgt || m.rank >= 3 || (m.auras || []).some((a) => a.au === 12 && a.until > G.gameTime)) continue;
    if (types && m.info && !types.includes(m.info[5])) continue;
    return m;
  }
  return null;
}
function tacHasBuff(x, a, name) {
  if (a.merc) return !!(typeof mercBuff === 'function' && mercBuff(a.merc, name));
  return (rt(a.c).buffs || []).some((b) => b.name === name && b.until > G.gameTime + 3);
}
function tacHasDispellable(x, a) {
  const types = TAC_DISPELS[x.n]; if (!types || !types.length) return false; const now = G.gameTime;
  const list = a.merc ? a.merc.buffs || [] : rt(a.c).buffs || [];
  return list.some((b) => b.kind === 'debuff' && b.until > now && types.includes(b.disp));
}

/* ------------------------------------------------------------------ the slots */
function tacState(c) { if (!c.cfg.tac) c.cfg.tac = { preset: 'auto', custom: {}, on: true }; return c.cfg.tac; }
function tacActive(c) { const t = c.cfg && c.cfg.tac; return !t || t.preset !== 'classic'; }
/* the slots the character fights with: [{c: condition, p, a: action}] */
function tacSlots(c, preset) {
  const T = tacState(c); const k = preset || T.preset;
  if (/^c\d$/.test(k)) return T.custom[k] || [];
  const role = k === 'auto' ? tacRole(c) : k; const spec = typeof rotationSpec === 'function' ? rotationSpec(c) : '';
  const key = k + '|' + role + '|' + spec + '|' + c.level; const r = rt(c);
  if (!r.tacCache || r.tacCache.key !== key) r.tacCache = { key, slots: tacPreset(c, k === 'auto' ? tacAutoKind(c, role, spec) : k) };
  return r.tacCache.slots;
}
/* the default: the role in the group, else the talents (healing specs heal alone too when it is needed) */
function tacAutoKind(c, role, spec) {
  if (role === 'tank') return 'tank';
  if (role === 'healer') return 'heal';
  return 'dps';
}

/* ------------------------------------------------------------------ in the fight */
function tacFight(c, tgt) {
  const r = rt(c); if (r.cast || masteryHesitating(c)) return;
  if (c.cfg.tac && c.cfg.tac.on === false) return;            // tactics disabled: only the behavior (auto attack)
  const s = charStats(c); const att = attackersOf(c);
  const x = { c, r, tgt, att, self: c, hpPct: c.hp / s.maxHp * 100, mpPct: usesMana(c) && s.maxMana ? c.mana / s.maxMana * 100 : c.cls === 4 || (c.cls === 11 && c.form === 'cat') ? (c.energy || 0) : 100, allies: null };
  const slots = tacSlots(c); let fumbled = false; let wanted = false; let guard = 0;
  for (let i = 0; i < slots.length && guard++ < 120; i++) {
    const sl = slots[i]; if (!sl || sl.off || !sl.a) continue;
    const cd = TAC_CONDS[sl.c]; if (!cd) continue;
    if (cd.g === 'Ally' && !x.allies) x.allies = tacAllies(c);
    // the ability of the slot (its own buff / debuff is what the condition asks about)
    let sp = null; x.n = null; x.sp = null;
    if (sl.a[0] !== '#' && sl.a[0] !== '>') { const u = abilityUsable(c, sl.a); if (!u.ok) { if (c.cls === 11 && c.form && u.why && /not in/.test(u.why) && cd.g !== 'Enemy' && tacHealish(sl.a)) { leaveForm(c); } continue; } sp = u.sp; x.n = sl.a; x.sp = sp; }
    if (cd.g === 'Ally' && !x.allies) x.allies = tacAllies(c);
    const who = cd.f(x, sl.p != null ? sl.p : cd.p); if (!who) continue;
    if (sl.a[0] === '>') { const t = +sl.a.slice(1) - 1; if (t <= i) continue; if (t >= slots.length) break; i = t - 1; continue; }       // jump to tactic N (past the last: stop here)
    if (sl.a === '#wait') return;
    if (sl.a === '#atk') { if (who && who.st && who !== tgt) { r.tgt = who; } return; }
    if (sl.a[0] === '#') { if (tacItem(c, sl.a)) return; continue; }
    if (sp.sc && typeof charSilenced === 'function' && charSilenced(c)) continue;
    const res = tacUse(c, x, sl.a, sp, who, cd.g);
    if (res === 'done') { masteryAfterAction(c); return; }
    if (res === 'queued') continue;
    if (res === 'wait') wanted = true;
    if (res === 'fumble' && !fumbled) { fumbled = true; continue; }
  }
  if (c.cls !== 1 && r.gcdUntil <= G.gameTime) r.noSpell = wanted || !usesMana(c) || c.mana < s.maxMana * 0.1;
}
function tacHealish(n) { return /Heal|Regrowth|Rejuvenation|Touch|Tranquility|Barkskin|Innervate|Remove Curse|Abolish|Cure/.test(n); }
/* use ability n (spell sp) on the condition's subject: 'done' | 'queued' | 'wait' (wanted, not ready) | 'fumble' | null */
function tacUse(c, x, n, sp, who, g) {
  const r = rt(c); const tgt = x.tgt; const now = G.gameTime;
  const ef = sp.ef || [];
  const offensive = ef.some((e) => e.k === 'enemy' || e.k === 'area_enemy');
  const friendly = !offensive && ef.some((e) => e.k === 'friend');
  const area = ef.some((e) => e.k === 'area_enemy');
  // who it goes to
  let mob = null, ally = null;
  if (offensive) mob = g === 'Enemy' ? who : tgt;
  else if (friendly && g === 'Ally') ally = who.self ? null : who;
  if (offensive && !mob && !area) return null;
  // what the game itself asks (windows, combo points, one of a kind) - and is it worth it
  if (!tacWorth(c, x, n, sp, mob, ally, area, g)) return null;
  if (area && !safeForAoe(c)) return null;
  // a stance (warriors): "activate mode" - most of the rage stays behind (Tactical Mastery keeps some)
  if (c.cls === 1 && STANCES[n]) {
    if (c.cfg.stance === STANCES[n] || (r.cd[n] || 0) > now) return null;
    c.cfg.stance = STANCES[n]; c.rage = Math.min(c.rage || 0, 5 * (talentRank(c, 'Tactical Mastery') || 0)); r.cd[n] = now + 1; r.queued = null; dirty(c);
    fx(c.pos.x, c.pos.y, n, '#ffe9a8'); return 'done';
  }
  // next swing (Heroic Strike, Maul, Raptor Strike, Cleave): queued for the next hit
  if ((sp.fl || []).includes('next_swing')) {
    if (r.queued || !inMelee(c, tgt)) return null;
    const [pt, cost] = queuedCost(c, sp, n); if (powerOf(c, pt) < cost || (r.cd[n] || 0) > now) return null;
    r.queued = { name: n, sp }; return 'queued';
  }
  if (!abilityReady(c, n, sp)) return c.cls !== 1 && (r.cd[n] || 0) <= now ? 'wait' : null;
  if (masteryFumble(c)) return 'fumble';
  // range
  const m = mob || (offensive ? tgt : null);
  const melee = sp.rng && sp.rng[1] <= 6;
  if (m) {
    const dm = Math.hypot(m.x - c.pos.x, m.y - c.pos.y);
    if (melee && !inMelee(c, m)) return null;
    if (!area && sp.rng && sp.rng[1] > 6 && dm > sp.rng[1] + 1) return null;
    if (sp.rng && sp.rng[0] >= 5 && dm < sp.rng[0]) return null;
  }
  if (ally && Math.hypot(ally.x - c.pos.x, ally.y - c.pos.y) > 40) return null;
  // dispels: they take one harmful effect off
  if (TAC_DISPELS[n]) {
    const subj = ally || { c, self: true }; return tacDispel(c, n, sp, subj) ? 'done' : null;
  }
  if (c.cls === 1) {
    spendCost(c, sp, n); startCooldown(c, n, sp); applySpell(c, sp, m || tgt);
    if (n === 'Slam') r.swingT = Math.max(r.swingT, 1.5 - 0.1 * talentRank(c, 'Improved Slam')) + charStats(c).mh.speed * 0.5;
    if (n === 'Berserker Rage' && talentRank(c, 'Improved Berserker Rage')) c.rage = Math.min(100, c.rage + 5 * talentRank(c, 'Improved Berserker Rage'));
    if (n === 'Overpower') r.opWindow = 0; if (n === 'Revenge') r.revWindow = 0;
    fx(c.pos.x, c.pos.y, n, '#ffe9a8');
  } else {
    if (FINISHERS[n]) { r.cpUse = r.cp || 0; r.cp = 0; }
    if (ally) {
      const direct = ef.some((e) => e.t === 10);
      if (direct) { r.healOn = ally.merc ? { merc: ally.merc } : ally.c; startCast(c, n, sp, c); }
      else if (ally.merc && n === 'Power Word: Shield') { startCast(c, n, sp, { merc: ally.merc, x: ally.x, y: ally.y }); }
      else startCast(c, n, sp, ally.merc ? { merc: ally.merc, x: ally.x, y: ally.y } : ally.c);
    } else startCast(c, n, sp, offensive ? m || tgt : c);
    r.cpUse = 0; r.noSpell = false;
  }
  if (TAC_INTERRUPTS.has(n) && m && m.cast) tacInterrupt(c, m, n);
  if (TAC_CC[n] && m && m !== tgt) r.ccOn = m;
  return 'done';
}
/* the checks a player makes without thinking: the game's windows (Execute, Overpower, Revenge), combo points, buffs and
   debuffs already there, totems and seals already up, healing someone who is not hurt */
function tacWorth(c, x, n, sp, mob, ally, area, g) {
  const r = rt(c); const tgt = mob || x.tgt; const ef = sp.ef || [];
  if (n === 'Execute' && !(tgt && tgt.hp / tgt.maxhp < 0.2)) return false;
  if (n === 'Overpower' && !(r.opWindow > G.gameTime && r.opTarget && r.opTarget.hp > 0)) return false;
  if (n === 'Revenge' && !(r.revWindow > G.gameTime)) return false;
  if (n === 'Charge' || n === 'Intercept') return false;                // the pull (tryOpener)
  if (n === 'Life Tap' && x.hpPct < 50) return false;
  if (n === 'Hammer of Wrath' && !(tgt && tgt.hp / tgt.maxhp < 0.2)) return false;
  if (FINISHERS[n] && !(r.cp && r.cpTgt === tgt)) return false;
  if (/Form$/.test(n)) { const w = wantedForm(c); return !!w && formSpellName(c, w) === n && c.form !== w; }
  if (/Totem$/.test(n) && ((r.totemDmg && r.totemDmg.name === n && r.totemDmg.until > G.gameTime + 2) || buffLeft(c, n) > 2)) return false;
  if (/^Seal of/.test(n) && (rt(c).buffs || []).some((b) => /^Seal of/.test(b.name) && b.until > G.gameTime + 1)) return false;
  if (TAC_CC[n] && (!mob || mob === x.tgt || (mob.auras || []).some((a) => a.au === 12 && a.until > G.gameTime))) return false;
  if (TAC_CC[n] && mob && mob.info && !TAC_CC[n].includes(mob.info[5])) return false;
  if (TAC_INTERRUPTS.has(n) && g === 'Enemy' && x.c && mob && !mob.cast && /Pummel|Kick|Counterspell|Shield Bash|Silence/.test(n)) return false;
  const selfAura = ef.some((e) => (e.t === 6 || e.t === 35) && e.k !== 'enemy' && e.k !== 'area_enemy' && !ally);
  const enemyAura = ef.some((e) => (e.t === 6 || e.t === 35) && e.k === 'enemy');
  const direct = ef.some((e) => e.t === 2 || e.t === 10);
  const healing = ef.some((e) => e.t === 10 || e.au === 8);
  if (selfAura && !direct && !ally && buffLeft(c, sp.n) > 3) return false;                          // the buff is still up
  if (ally && !healing && !TAC_DISPELS[n] && tacHasBuff(x, ally, sp.n)) return false;
  if (ally && ef.some((e) => e.au === 8) && tacHasBuff(x, ally, sp.n)) return false;                // the heal over time is ticking
  if (healing && !ally && g !== 'Ally' && x.hpPct >= 99) return false;
  if (healing && ally && ally.pct >= 0.99) return false;
  if (enemyAura && !direct && tgt) { const a = mobAura(tgt, sp.n); if (a && a.until - G.gameTime > 2 && !(sp.stack && a.stacks < sp.stack)) return false; }
  if (enemyAura && tgt && tgt.hp / tgt.maxhp < 0.12 && !isTough(tgt) && !direct) return false;      // a damage over time on something about to die
  return true;
}
function tacDispel(c, n, sp, a) {
  const types = TAC_DISPELS[n] || []; const now = G.gameTime;
  const list = a.merc ? a.merc.buffs || [] : rt(a.c || c).buffs || [];
  const b = list.find((x) => x.kind === 'debuff' && x.until > now && types.includes(x.disp)); if (!b) return false;
  spendCost(c, sp, n); startCooldown(c, n, sp);
  b.until = 0; if (!a.merc) { const o = a.c || c; const rr = rt(o); if (rr.cc && rr.cc.until > now && b.name) rr.cc = null; dirty(o); }
  else if (a.merc.stunUntil > now) a.merc.stunUntil = 0;
  const who = a.merc ? a.merc.name : (a.c || c).name;
  fx(a.x || c.pos.x, a.y || c.pos.y, n, '#9fe0ff'); withLog(c, () => log(n + ': ' + b.name + ' removed from ' + who + '.'));
  return true;
}
function tacInterrupt(c, m, n) {
  if (!m.cast) return; m.cast = null; m.sgcd = G.gameTime + 4; fx(m.x, m.y, 'interrupted', '#ffb36b');
}
/* items */
function tacItem(c, k) {
  const r = rt(c); let best = -1, bv = k === '#hpmin' || k === '#mpmin' ? Infinity : -1;
  c.bags.forEach((s, i) => {
    const it = itemRow(s.id); if (!it || (it.rl || 0) > c.level) return;
    if (k === '#hp' || k === '#hpmin' || k === '#stone') {
      const u = useInfo(s.id); if (!u || u.kind !== 'potion') return; const stone = /Healthstone/.test(it.n);
      if ((k === '#stone') !== stone) return;
      const v = u.hi; if (k === '#hpmin' ? v < bv : v > bv) { bv = v; best = i; }
    } else if (typeof consInfo === 'function') {
      const u = consInfo(s.id); if (!u) return;
      if ((k === '#mp' || k === '#mpmin') && u.kind === 'mana' && u.ptype === 0) { const v = u.hi; if (k === '#mpmin' ? v < bv : v > bv) { bv = v; best = i; } }
      if (k === '#band' && u.kind === 'bandage') { const v = u.heal; if (v > bv) { bv = v; best = i; } }
      if (k === '#bomb' && u.kind === 'bomb') { const v = u.hi; if (v > bv) { bv = v; best = i; } }
    }
  });
  if (best < 0) return false;
  if (k === '#hp' || k === '#hpmin') { if ((r.potionCd || 0) > G.gameTime) return false; return useItem(c, best, true) !== false; }
  if (k === '#stone') { r.icd = r.icd || {}; if ((r.icd.stone || 0) > G.gameTime) return false; const s = charStats(c); const u = useInfo(c.bags[best].id); const v = irnd(u.lo, u.hi); c.hp = Math.min(s.maxHp, c.hp + v); r.icd.stone = G.gameTime + 120; fx(c.pos.x, c.pos.y, '+' + v, '#5ee07a'); log('Used ' + itemName(c.bags[best].id) + ' (+' + v + ' health).'); removeItem(c, c.bags[best].id, 1); return true; }
  return useConsumable(c, best, 'tactics') !== false;
}
