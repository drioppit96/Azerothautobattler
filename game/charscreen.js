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
    const st = { race: 2, cls: 1, gender: 0, name: randomName() };
    const list = () => {
      if (first || !G.state || !G.state.characters.length) return '';
      return '<div class="cs-list"><h3>Your characters</h3>' + G.state.characters.map((c) =>
        '<div class="cs-char' + (c.id === G.state.activeId ? ' on' : '') + '"><img src="' + racePortrait(c.race, c.gender) + '"><div><b style="color:' + CLASS_COLOR[c.cls] + '">' + esc(c.name) + '</b><br>Level ' + c.level + ' ' + RACE_NAMES[c.race] + ' ' + CLASS_NAMES[c.cls] + '</div>' +
        '<button class="mini" data-play="' + c.id + '">' + (c.id === G.state.activeId ? 'Playing' : 'Play') + '</button><button class="mini red" data-del="' + c.id + '" title="Delete">&#10005;</button></div>').join('') +
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
      h += '<div class="cs-name"><input id="csName" maxlength="12" value="' + esc(st.name) + '"><button class="mini" data-rnd="1" title="Random name">&#9860;</button><button class="act" data-create="1">Create ' + esc(RACE_NAMES[st.race] + ' ' + CLASS_NAMES[st.cls]) + '</button></div>';
      h += '</div></div></div>';
      el.innerHTML = h;
      const inp = $('csName'); inp.oninput = () => { st.name = inp.value; };
    };
    el.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
      if (d.race) { st.race = +d.race; draw(); }
      else if (d.cls) { st.cls = +d.cls; draw(); }
      else if (d.g != null) { st.gender = +d.g; draw(); }
      else if (d.rnd) { st.name = randomName(); draw(); }
      else if (d.close) { el.hidden = true; }
      else if (d.play) { if (d.play !== G.state.activeId) { save(); G.state.activeId = d.play; save(); location.reload(); } else el.hidden = true; }
      else if (d.del) {
        const c = G.state.characters.find((x) => x.id === d.del); if (!c) return;
        if (!confirm('Delete ' + c.name + ' (level ' + c.level + ' ' + CLASS_NAMES[c.cls] + ') for good?')) return;
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
        if (first) { el.hidden = true; resolve(c); return; }
        save(); G.state.characters.push(c); G.state.activeId = c.id; save(); location.reload();
      }
    };
    draw();
  });
}
