'use strict';
/* charscreen.js - character selection and creation (race, class and gender with the vanilla race / class rules). */

const FACTION_RACES = { Alliance: [1, 3, 4, 7], Horde: [2, 5, 6, 8] };
const CLASS_ICON = { 1: 'inv_sword_27', 2: 'spell_holy_holybolt', 3: 'inv_weapon_bow_08', 4: 'ability_backstab', 5: 'spell_holy_wordfortitude', 7: 'spell_nature_bloodlust', 8: 'spell_frost_frostbolt02', 9: 'spell_shadow_shadowbolt', 11: 'ability_druid_maul' };
const CLASS_COLOR = { 1: '#c79c6e', 2: '#f58cba', 3: '#abd473', 4: '#fff569', 5: '#ffffff', 7: '#0070de', 8: '#69ccf0', 9: '#9482c9', 11: '#ff7d0a' };
const CLASS_TEXT = {
  1: 'Warrior - plate-wearing melee fighter. Builds rage by hitting and being hit. Stances, shouts, Charge.',
  2: 'Paladin - holy warrior in heavy armor. Seals and Judgement in melee, heals itself, auras and blessings.',
  3: 'Hunter - shoots from range with bow or gun (needs arrows / bullets), fights with a pet from level 10.',
  4: 'Rogue - energy and combo points: builds them with Sinister Strike, spends them on Eviscerate and Slice and Dice.',
  5: 'Priest - casts Smite and Shadow Word: Pain from range, shields and heals itself, shoots a wand when low on mana.',
  7: 'Shaman - lightning, shocks and totems, weapon imbues in melee, heals itself.',
  8: 'Mage - Frostbolt and Fireball from range, Frost Nova when they come close, conjures its own food and water.',
  9: 'Warlock - curses and damage over time, summons an Imp and later a Voidwalker that tanks, drains life.',
  11: 'Druid - casts in caster form, shifts into Bear (level 10) and Cat form (level 20) to fight in melee, heals itself.',
};
const RACE_TEXT = {
  1: 'Human (Elwynn Forest)', 2: 'Orc (Durotar)', 3: 'Dwarf (Dun Morogh)', 4: 'Night Elf (Teldrassil)',
  5: 'Undead (Tirisfal Glades)', 6: 'Tauren (Mulgore)', 7: 'Gnome (Dun Morogh)', 8: 'Troll (Durotar)',
};
const NAME_SYL = { a: ['Thra', 'Gor', 'Ka', 'Mor', 'Zul', 'Bra', 'Dre', 'Vol', 'Ash', 'Kel', 'Ul', 'Ro'], b: ['gar', 'nok', 'ric', 'tha', 'gash', 'dor', 'vin', 'jin', 'mar', 'zek', 'lin', 'mok'] };

function raceClassOk(race, cls) { return !!(G.d.races && G.d.races.start && G.d.races.start[race + '_' + cls]); }
function racePortrait(race, gender) { return '../ui/CharacterFrame/TemporaryPortrait-' + (gender ? 'Female' : 'Male') + '-' + (RACE_PORTRAIT[race] || 'Orc') + '.png'; }
function randomName() { const a = NAME_SYL.a, b = NAME_SYL.b; return a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)]; }

/* opens the character screen. first = no character exists yet (creation only). Resolves with a new character. */
function charScreen(first) {
  return new Promise((resolve) => {
    let el = $('charscreen');
    if (!el) { el = document.createElement('div'); el.id = 'charscreen'; document.body.appendChild(el); }
    el.hidden = false;
    const st = { race: 2, cls: 1, gender: 0, name: randomName(), look: null };
    const newLook = () => { st.look = looksReady() ? lookRandom(st.race, st.gender) : null; };
    looksInit().then(() => { if (looksReady() && !st.look) { newLook(); draw(); } });
    let seenVer = LOOK.ver; const watch = setInterval(() => { if (el.hidden) { clearInterval(watch); return; } if (LOOK.ver !== seenVer) { seenVer = LOOK.ver; const p = el.querySelector('.cs-lookpor'); if (p && st.look) { const u = lookPortrait(st.race, st.gender, st.look); if (u) p.innerHTML = '<img src="' + u + '">'; } } }, 120);
    const list = () => {
      if (first || !G.state || !G.state.characters.length) return '';
      return '<div class="cs-list"><h3>Your characters</h3>' + G.state.characters.map((c) =>
        '<div class="cs-char' + (c.id === G.state.activeId ? ' on' : '') + '"><img src="' + charPortrait(c) + '"><div><b style="color:' + CLASS_COLOR[c.cls] + '">' + esc(c.name) + '</b><br>Level ' + c.level + ' ' + RACE_NAMES[c.race] + ' ' + CLASS_NAMES[c.cls] + '</div>' +
        (typeof looksReady === 'function' && looksReady() ? '<button class="mini" data-lookc="' + c.id + '" title="Change the look (skin, face, hair ...)">Appearance</button>' : '') + '<button class="mini" data-play="' + c.id + '">' + (c.id === G.state.activeId ? 'Playing' : 'Play') + '</button><button class="mini red" data-del="' + c.id + '" title="Delete">&#10005;</button></div>').join('') +
        '<div class="muted" style="margin-top:6px">Only the character you play is in the world; the others wait where you left them.</div></div>';
    };
    const draw = () => {
      if (!raceClassOk(st.race, st.cls)) { st.cls = [1, 2, 3, 4, 5, 7, 8, 9, 11].find((k) => raceClassOk(st.race, k)); }
      let h = '<div class="cs-win">' + (first ? '' : '<button class="mini cs-close" data-close="1">&#10005;</button>') + '<h2>' + (first ? 'Create your character' : 'Characters') + '</h2><div class="cs-body">' + list() + '<div class="cs-new">' + (first ? '' : '<h3>New character</h3>');
      h += '<div class="cs-factions">';
      for (const f in FACTION_RACES) {
        h += '<div class="cs-fac ' + f.toLowerCase() + '"><h4>' + f + '</h4><div class="cs-races">';
        for (const rc of FACTION_RACES[f]) h += '<button class="cs-race' + (st.race === rc ? ' on' : '') + '" data-race="' + rc + '" title="' + esc(RACE_TEXT[rc]) + '"><img src="' + racePortrait(rc, st.gender) + '"><span>' + RACE_NAMES[rc] + '</span></button>';
        h += '</div></div>';
      }
      h += '</div><div class="cs-gender"><button class="mini' + (!st.gender ? ' on' : '') + '" data-g="0">Male</button><button class="mini' + (st.gender ? ' on' : '') + '" data-g="1">Female</button><span class="muted">' + esc(RACE_TEXT[st.race]) + '</span></div>';
      h += '<div class="cs-classes">';
      for (const k of [1, 2, 3, 4, 5, 7, 8, 9, 11]) {
        const ok = raceClassOk(st.race, k);
        h += '<button class="cs-class' + (st.cls === k ? ' on' : '') + '" data-cls="' + k + '"' + (ok ? '' : ' disabled title="A ' + RACE_NAMES[st.race] + ' cannot be a ' + CLASS_NAMES[k] + '"') + '><img src="../icons/' + CLASS_ICON[k] + '.jpg"><span style="color:' + (ok ? CLASS_COLOR[k] : '#666') + '">' + CLASS_NAMES[k] + '</span></button>';
      }
      h += '</div><div class="cs-desc">' + esc(CLASS_TEXT[st.cls]) + '</div>';
      if (st.look) {          // the appearance: a big portrait and the choices (looks.js)
        const u = lookPortrait(st.race, st.gender, st.look);
        h += '<div class="cs-look"><div class="cs-lookpor">' + (u ? '<img src="' + u + '">' : '<div class="lk-wait">...</div>') + '</div>' + lookPickerHtml(st.race, st.gender, st.look) + '</div>';
      }
      h += '<div class="cs-name"><input id="csName" maxlength="12" value="' + esc(st.name) + '"><button class="mini" data-rnd="1" title="Random name">&#9860;</button><button class="act" data-create="1">Create ' + esc(RACE_NAMES[st.race] + ' ' + CLASS_NAMES[st.cls]) + '</button></div>';
      h += '</div></div></div>';
      el.innerHTML = h;
      const inp = $('csName'); inp.oninput = () => { st.name = inp.value; };
    };
    el.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
      if (d.race) { st.race = +d.race; newLook(); draw(); }
      else if (d.cls) { st.cls = +d.cls; draw(); }
      else if (d.g != null) { st.gender = +d.g; newLook(); draw(); }
      else if (d.lk && st.look) { const n = lookStep(st.race, st.gender, st.look, d.lk, +d.d); if (n) { st.look = n; draw(); } }
      else if (d.lkrnd && st.look) { st.look = lookRandom(st.race, st.gender) || st.look; draw(); }
      else if (d.rnd) { st.name = randomName(); draw(); }
      else if (d.close) { el.hidden = true; }
      else if (d.lookc) { const c = G.state.characters.find((x) => x.id === d.lookc); if (c) { openAppearance(c); const w = setInterval(() => { const lw = $('lookwin'); if (!lw || lw.hidden) { clearInterval(w); draw(); } }, 300); } }
      else if (d.play) { el.hidden = true; if (d.play !== G.state.activeId) switchCharacter(d.play); }
      else if (d.del) {
        const c = G.state.characters.find((x) => x.id === d.del); if (!c) return;
        if (!confirm('Delete ' + c.name + ' (level ' + c.level + ' ' + CLASS_NAMES[c.cls] + ') for good?')) return;
        { const gc = charById(d.del); const gg = gc && typeof guildOf === 'function' && guildOf(gc); if (gg) { gg.members = gg.members.filter((m) => m.id !== d.del); if (!gg.members.length) G.state.guilds = guilds().filter((x) => x !== gg); else if (!gg.members.some((m) => m.rank === 0)) gg.members[0].rank = 0; } }
        G.state.characters = G.state.characters.filter((x) => x.id !== d.del);
        if (!G.state.characters.length) { G.state.activeId = null; save(); location.reload(); return; }
        if (G.state.activeId === d.del) { G.state.activeId = G.state.characters[0].id; save(); location.reload(); return; }
        save(); draw();
      } else if (d.create) {
        const name = (st.name || '').trim().replace(/[^A-Za-zÀ-ſ]/g, '');
        if (name.length < 2) { alert('The name needs at least 2 letters.'); return; }
        const nm = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        if (G.state && G.state.characters.some((x) => x.name === nm)) { alert('You already have a character called ' + nm + '.'); return; }
        const c = newCharacter(nm, st.race, st.cls, st.gender);
        if (st.look) c.look = st.look;
        if (first) { el.hidden = true; resolve(c); return; }
        save(); G.state.characters.push(c); G.state.activeId = c.id; save(); location.reload();
      }
    };
    draw();
  });
}

/* ------------------------------------------------------------------ the character window (click your portrait) */
/* every character: switch to it, or let it play on its own (Go) while you watch another one; Pause stops it where it is */
function openCharSwitch() {
  let el = $('charswitch');
  if (!el) {
    el = document.createElement('div'); el.id = 'charswitch'; document.body.appendChild(el);
    el.onclick = (e) => {
      if (e.target === el) { el.hidden = true; return; }
      const b = e.target.closest('button'); if (!b) return; const d = b.dataset; const c = d.id && G.state.characters.find((x) => x.id === d.id);
      if (d.close) el.hidden = true;
      else if (d.manage) { el.hidden = true; charScreen(false); }
      else if (d.sw && c) { switchCharacter(c.id); }
      else if (d.go && c) charGo(c);
      else if (d.pause && c) charPause(c);
      else if (d.allgo) for (const x of G.state.characters) if (!x.bg) charGo(x);
      else if (d.allpause) for (const x of G.state.characters) if (x.bg) charPause(x);
      renderCharSwitch(true);
    };
  }
  el.hidden = false; renderCharSwitch(true);
}
function charGo(c) {
  c.bg = true;
  if (!c.order) { G.logCtx = c; orderLeveling(c); G.logCtx = null; }
  G.logCtx = c; log(c.name + ' plays on its own' + (isActive(c) ? ' (also when you switch to another character).' : '.')); G.logCtx = null; save(); renderOrder(); renderQuests();
}
function charPause(c) {
  c.bg = false;
  if (isActive(c)) { stopOrder(c); log(c.name + ' stops.'); }
  else { G.logCtx = c; log('Paused - waits here.'); G.logCtx = null; const r = rt(c); r.mv = null; }
  save(); renderOrder(); renderQuests();
}
function renderCharSwitch(force) {
  const el = $('charswitch'); if (!el || el.hidden) return;
  if (!force && el.querySelector('button:hover')) return;          // not under the mouse pointer: a click would miss
  const me = active(); const running = G.state.characters.filter((c) => c.bg || c === me).length;
  const parts = G.state.characters.map((c) => {
    const on = c === me; const t = c.order ? orderText(c) : null; const r = rt(c);
    const where = (typeof dungeonByMap === 'function' && dungeonByMap(c.pos.map) ? dungeonByMap(c.pos.map).name : zoneNameAt(c.pos)) || 'somewhere';
    const grp = typeof groupOf === 'function' && groupOf(c); const st = on ? (c.bg ? 'Playing - keeps going when you switch' : 'Playing') : grp && liveChars().includes(c) ? 'In the group' + (grp.leader === c.id ? ' (leader)' : '') : c.bg ? (r.ghost ? 'Running (dead - on the way back)' : 'Running on its own') : 'Paused';
    const last = G.logs && G.logs[c.id] && G.logs[c.id][0];
    const xpNeed = (G.d.xp.levels[c.level - 1] || {}).xp_to_next || 0;
    const info = '<b style="color:' + CLASS_COLOR[c.cls] + '">' + esc(c.name) + '</b> <span class="muted">level ' + c.level + ' ' + RACE_NAMES[c.race] + ' ' + CLASS_NAMES[c.cls] + '</span>' +
      (xpNeed ? '<div class="bar xp cw-xp"><i style="width:' + Math.min(100, 100 * c.xp / xpNeed) + '%"></i></div>' : '') +
      '<div class="small"><span class="cw-st' + (c.bg || on ? ' run' : '') + '">' + st + '</span> &middot; ' + esc(where) + ' &middot; ' + moneyHtml(c.gold) + (G.state.settings.showMastery !== false ? ' &middot; skill ' + stars(skillLevel(c)) : '') + '</div>' +
      '<div class="small muted">' + (t ? esc(t.t) + (t.d ? ' - ' + esc(t.d) : '') : 'No order') + '</div>' +
      (last && !on ? '<div class="small muted cw-last">' + fmtTime(last[0]) + ' ' + esc(last[1]) + '</div>' : '');
    const btns = (on ? '<span class="muted small">playing</span>' : '<button class="act" data-sw="1" data-id="' + c.id + '">Switch</button>') +
      (c.bg ? '<button class="mini" data-pause="1" data-id="' + c.id + '">&#10074;&#10074; Pause</button>' : '<button class="mini cw-go" data-go="1" data-id="' + c.id + '" title="' + (c.order ? 'Carry on with: ' + esc(t.t) : 'Level up on its own (auto-quest)') + '">&#9654; Go</button>');
    return { c, on, info, btns };
  });
  const foot = running + ' in the world now; each one running makes the computer work a little more.';
  // the same characters as before: only the texts and buttons change - the portraits stay (no flickering)
  const shape = parts.map((x) => x.c.id + (x.on ? '*' : '') + x.c.race + '_' + (x.c.gender || 0)).join(',');
  if (el._shape === shape && el.querySelector('.cw-win')) {
    const rows = el.querySelectorAll('.cw-row');
    parts.forEach((x, i) => { const row = rows[i]; const a = row.querySelector('.cw-info'), b = row.querySelector('.cw-btns'); if (a._h !== x.info) { a.innerHTML = x.info; a._h = x.info; } if (b._h !== x.btns) { b.innerHTML = x.btns; b._h = x.btns; } });
    const f = el.querySelector('.cw-run'); if (f) f.textContent = foot;
    return;
  }
  el._shape = shape;
  let h = '<div class="cw-win"><button class="mini cs-close" data-close="1">&#10005;</button><h2>Characters</h2>';
  for (const x of parts) h += '<div class="cw-row' + (x.on ? ' on' : '') + '"><img src="' + charPortrait(x.c) + '"><div class="cw-info">' + x.info + '</div><div class="cw-btns">' + x.btns + '</div></div>';
  h += '<div class="cw-foot"><button class="mini" data-allgo="1">&#9654; All go</button><button class="mini" data-allpause="1">&#10074;&#10074; Pause all</button><button class="mini" data-manage="1">New / delete characters</button></div>' +
    '<div class="small muted" style="margin-top:6px">Characters set to Go keep playing - questing and leveling on their own - while you watch another one. Paused ones wait where they are. <span class="cw-run">' + foot + '</span></div></div>';
  el.innerHTML = h;
}
