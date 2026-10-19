'use strict';
/* guild.js - guilds of your characters: found one (free, no charter to sign), name it, pick its heraldry (emblem, emblem
   colour, background, border), invite your other characters, ranks (Guild Master, Officer, Member), and a guild bank of
   200 slots plus money that every member can use at a banker. Also the sorting of bags, bank and guild bank. */

const GUILD_BANK_SLOTS = 200;
const GUILD_RANKS = ['Guild Master', 'Officer', 'Member'];
const EMBLEMS = ['⚔', '☠', '♛', '✦', '☀', '☾', '❖', '✠', '♞', '⚜', '☘', '✪', '⚒', '⚔︎', '❣', '✡', '☯', '❄', '♨', '☸'].filter((x, i, a) => a.indexOf(x) === i);
const GCOLORS = ['#7a1010', '#b01e1e', '#d2691e', '#c9a646', '#e8d48a', '#2e6b2e', '#3fae5a', '#1c4f8a', '#3f7fd8', '#5b2c8a', '#9b4fd6', '#202020', '#5a5a5a', '#d8d8d8', '#6b4a2b', '#0f5b5b'];
const GUI = { tab: 'info', draft: null };

function guilds() { G.state.guilds = G.state.guilds || []; return G.state.guilds; }
function guildOf(c) { return c && c.guildId ? guilds().find((g) => g.id === c.guildId) || null : null; }
function guildRank(g, c) { const m = g && g.members.find((x) => x.id === c.id); return m ? m.rank : -1; }
function guildMembers(g) { return g.members.map((m) => ({ m, c: charById(m.id) })).filter((x) => x.c); }

/* the heraldry as a small shield (SVG) */
function heraldrySvg(h, size) {
  size = size || 48; h = h || {};
  return '<svg class="gherald" width="' + size + '" height="' + Math.round(size * 1.15) + '" viewBox="0 0 40 46"><path d="M4 3h32v18c0 12-8 19-16 22C12 40 4 33 4 21z" fill="' + (h.bg || '#1c4f8a') + '" stroke="' + (h.border || '#c9a646') + '" stroke-width="3"/>' +
    '<text x="20" y="27" text-anchor="middle" font-size="20" fill="' + (h.color || '#e8d48a') + '" style="font-family:Segoe UI Symbol,DejaVu Sans,sans-serif">' + (h.emblem || '⚔') + '</text></svg>';
}

/* ------------------------------------------------------------------ founding and members */
function foundGuild(c, name, her) {
  name = (name || '').trim().replace(/\s+/g, ' ');
  if (guildOf(c)) { log(c.name + ' is already in a guild.'); return false; }
  if (name.length < 3 || name.length > 24 || !/^[A-Za-z' -]+$/.test(name)) { log('A guild name needs 3-24 letters (spaces and \' allowed).'); return false; }
  if (guilds().some((g) => g.name.toLowerCase() === name.toLowerCase())) { log('There is already a guild called ' + name + '.'); return false; }
  const g = { id: 'G' + Date.now().toString(36), name, heraldry: Object.assign({}, her), members: [{ id: c.id, rank: 0 }], bank: { items: [], gold: 0 }, log: [], founded: Date.now() };
  guilds().push(g); c.guildId = g.id;
  guildLog(g, c.name + ' founded the guild.'); log('Founded the guild <' + name + '>.'); save(); return true;
}
function guildLog(g, t) { g.log = (g.log || []).concat([new Date().toLocaleString().replace(/:\d\d$/, '') + ' - ' + t]).slice(-60); }
function guildInvite(g, by, o) {
  if (!o || guildOf(o)) return; if (guildRank(g, by) > 1) { log('Only the Guild Master and officers can invite.'); return; }
  g.members.push({ id: o.id, rank: 2 }); o.guildId = g.id; guildLog(g, by.name + ' invited ' + o.name + '.');
  log(o.name + ' joined <' + g.name + '>.'); withLog(o, () => log('You joined <' + g.name + '>.')); save();
}
function guildRemove(g, by, o) {
  if (o === by) { // leaving
    if (guildRank(g, by) === 0 && g.members.length > 1) { log('Make someone else Guild Master first (or disband the guild).'); return; }
    g.members = g.members.filter((m) => m.id !== o.id); o.guildId = null; guildLog(g, o.name + ' left the guild.'); log('Left <' + g.name + '>.');
    if (!g.members.length) guildDisband(g, true);
    save(); return;
  }
  if (guildRank(g, by) > 1 || guildRank(g, by) >= guildRank(g, o)) { log('You cannot remove ' + o.name + '.'); return; }
  g.members = g.members.filter((m) => m.id !== o.id); o.guildId = null; guildLog(g, by.name + ' removed ' + o.name + '.'); save();
}
function guildSetRank(g, by, o, rank) {
  if (guildRank(g, by) !== 0 || o === by) return;
  const m = g.members.find((x) => x.id === o.id); if (!m) return;
  if (rank === 0) { g.members.find((x) => x.id === by.id).rank = 1; guildLog(g, by.name + ' made ' + o.name + ' Guild Master.'); }
  else guildLog(g, by.name + ' made ' + o.name + ' ' + GUILD_RANKS[rank] + '.');
  m.rank = rank; save();
}
function guildDisband(g, quiet) {
  for (const m of g.members) { const x = charById(m.id); if (x) x.guildId = null; }
  G.state.guilds = guilds().filter((x) => x !== g);
  // what was in the guild bank goes to the Guild Master's mailbox
  const gm = g.members.find((m) => m.rank === 0);
  if (gm && typeof sendMail === 'function') {
    if (g.bank.gold) sendMail(gm.id, { from: '<' + g.name + '>', sub: 'Guild bank money', gold: g.bank.gold, t: G.gameTime });
    for (const inst of g.bank.items) sendMail(gm.id, { from: '<' + g.name + '>', sub: 'Guild bank: ' + itemName(inst.id, inst), inst, t: G.gameTime });
  }
  if (!quiet) log('<' + g.name + '> disbanded.'); save();
}

/* ------------------------------------------------------------------ guild bank (at any banker) */
function gbankFree(g) { return GUILD_BANK_SLOTS - g.bank.items.length; }
function gbankPut(c, idx) {
  const g = guildOf(c); const inst = c.bags[idx]; if (!g || !inst) return false;
  const st = itemStack(inst.id);
  if (st > 1 && !inst.rp) for (const s of g.bank.items) if (s.id === inst.id && s.n < st) { const k = Math.min(st - s.n, inst.n); s.n += k; inst.n -= k; if (!inst.n) break; }
  if (inst.n > 0) { if (gbankFree(g) <= 0) { log('The guild bank is full.'); save(); refreshGear(); return false; } g.bank.items.push(inst); }
  c.bags.splice(idx, 1); rt(c).bagFull = false; guildLog(g, c.name + ' deposited ' + itemName(inst.id, inst) + '.'); save(); refreshGear(); return true;
}
function gbankTake(c, i) {
  const g = guildOf(c); const inst = g && g.bank.items[i]; if (!inst) return;
  const ok = itemStack(inst.id) > 1 && !inst.rp ? addItem(c, inst.id, inst.n) : (bagFree(c) > 0 ? (c.bags.push(inst), true) : false);
  if (!ok) { log('Bags are full.'); return; } g.bank.items.splice(i, 1); guildLog(g, c.name + ' took ' + (inst.n > 1 ? inst.n + ' x ' : '') + itemName(inst.id, inst) + '.'); save(); refreshGear();
}
function gbankMoney(c, v) {
  const g = guildOf(c); if (!g) return; v = Math.round(v);
  if (v > 0) { v = Math.min(v, c.gold); c.gold -= v; g.bank.gold += v; guildLog(g, c.name + ' deposited ' + money(v) + '.'); }
  else if (v < 0) { if (guildRank(g, c) > 1) { log('Only the Guild Master and officers can take money.'); return; } v = Math.min(-v, g.bank.gold); g.bank.gold -= v; c.gold += v; guildLog(g, c.name + ' took ' + money(v) + '.'); }
  save(); refreshGear();
}

/* ------------------------------------------------------------------ sorting (bags, bank, guild bank) */
/* equipment first (by slot, then quality), then consumables, trade goods, recipes, quest items, the rest, junk last;
   within a group by quality and name; stacks of the same item are merged */
function sortKey(c, inst) {
  const it = itemRow(inst.id) || {}; const q = itemQuality(inst.id);
  const junk = q === 0 || (c && isJunk(c, inst.id)) ? 1 : 0;
  const grp = junk ? 9 : it.c === 1 ? 0 : it.sl && it.sl.length ? 1 : it.c === 0 ? 2 : it.c === 6 ? 3 : it.c === 7 || it.c === 5 ? 4 : it.c === 9 ? 5 : it.c === 12 ? 6 : 7;
  return [grp, it.c === 7 || it.c === 5 ? 0 : -q, it.sl && it.sl.length ? it.sl[0] : 0, itemName(inst.id, inst)];
}
function sortItems(c, list) {
  // merge stacks
  const out = [];
  for (const x of list) {
    const st = itemStack(x.id);
    if (st > 1 && !x.rp && x.dur == null) {
      for (const y of out) { if (y.id !== x.id || y.n >= st || y.rp) continue; const k = Math.min(st - y.n, x.n); y.n += k; x.n -= k; if (!x.n) break; }
      if (x.n > 0) out.push(x);
    } else out.push(x);
  }
  out.sort((a, b) => { const A = sortKey(c, a), B = sortKey(c, b); for (let i = 0; i < 4; i++) { if (A[i] < B[i]) return -1; if (A[i] > B[i]) return 1; } return b.n - a.n; });
  list.length = 0; for (const x of out) list.push(x);
}
function sortBags(c) { sortItems(c, c.bags); SH.sel = null; save(); refreshGear(); }
function sortBank(c) { sortItems(c, bankOf(c).items); save(); refreshGear(); }
function sortGuildBank(c) { const g = guildOf(c); if (!g) return; sortItems(c, g.bank.items); guildLog(g, c.name + ' sorted the guild bank.'); save(); refreshGear(); }

/* ------------------------------------------------------------------ the Guild tab */
function guildHtml(c, mode) {
  const g = guildOf(c); GUI.tab = mode || GUI.tab || 'info';
  if (!g && GUI.tab !== 'info') return '<div class="guild"><div class="muted">' + esc(c.name) + ' is not in a guild. Found one or join one in the Guild window (Members).</div></div>';
  if (!g) {
    const d = GUI.draft = GUI.draft || { name: '', her: { emblem: EMBLEMS[0], color: '#e8d48a', bg: '#1c4f8a', border: '#c9a646' } };
    const sw = (k) => '<div class="gsw">' + GCOLORS.map((col) => '<i data-gcol="' + k + ':' + col + '" style="background:' + col + '"' + (d.her[k] === col ? ' class="on"' : '') + '></i>').join('') + '</div>';
    return '<div class="guild"><div class="vhead"><b>Found a guild</b> <span class="muted small">(free - no charter to sign)</span></div>' +
      '<div class="gnew"><div class="gprev">' + heraldrySvg(d.her, 96) + '<div class="gname">&lt;' + esc(d.name || 'Guild name') + '&gt;</div></div><div class="gform">' +
      '<label class="small">Name <input type="text" id="gName" maxlength="24" value="' + esc(d.name) + '" placeholder="3-24 letters"></label>' +
      '<div class="small">Emblem</div><div class="gemb">' + EMBLEMS.map((e) => '<button class="mini' + (d.her.emblem === e ? ' on' : '') + '" data-gemb="' + e + '">' + e + '</button>').join('') + '</div>' +
      '<div class="small">Emblem colour</div>' + sw('color') + '<div class="small">Background</div>' + sw('bg') + '<div class="small">Border</div>' + sw('border') +
      '<p><button class="act" data-gfound="1">Found the guild</button></p></div></div></div>';
  }
  const rk = guildRank(g, c); const mem = guildMembers(g).sort((a, b) => a.m.rank - b.m.rank || b.c.level - a.c.level);
  let h = '<div class="guild"><div class="ghead">' + heraldrySvg(g.heraldry, 56) + '<div><div class="gname">&lt;' + esc(g.name) + '&gt;</div><div class="small muted">' + g.members.length + ' member' + (g.members.length > 1 ? 's' : '') + ' &middot; you: ' + GUILD_RANKS[rk] + '</div></div></div>';
  if (GUI.tab === 'info') {
    h += '<table class="gmem"><tr><th>Name</th><th>Level</th><th>Class</th><th>Rank</th><th></th></tr>';
    for (const { m, c: o } of mem) {
      h += '<tr><td style="color:' + CLASS_COLOR[o.cls] + '">' + esc(o.name) + (o === c ? ' (you)' : '') + '</td><td>' + o.level + '</td><td>' + CLASS_NAMES[o.cls] + '</td><td>' +
        (rk === 0 && o !== c ? '<select data-grank="' + o.id + '">' + GUILD_RANKS.map((t, i) => '<option value="' + i + '"' + (m.rank === i ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' : GUILD_RANKS[m.rank]) + '</td><td>' +
        (o !== c && rk <= 1 && rk < m.rank ? '<button class="mini red" data-gkick="' + o.id + '" title="Remove from the guild">&#10005;</button>' : '') + '</td></tr>';
    }
    h += '</table>';
    const free = G.state.characters.filter((o) => !guildOf(o));
    if (rk <= 1) h += free.length ? '<div class="ginv"><select id="gInv">' + free.map((o) => '<option value="' + o.id + '">' + esc(o.name) + ' (' + o.level + ' ' + CLASS_NAMES[o.cls] + ')</option>').join('') + '</select> <button class="act" data-gdinv="1">Invite</button></div>' : '<div class="small muted">All your characters are in a guild.</div>';
    h += '<p>' + (rk === 0 ? '<button class="mini red" data-gdis="1">Disband the guild</button> ' : '') + (rk !== 0 || g.members.length === 1 ? '<button class="mini" data-gleave="1">Leave the guild</button>' : '') + '</p>';
  } else if (GUI.tab === 'bank') {
    const v = bankerNear(c);
    h += '<div class="vhead">Guild bank <span class="muted small">' + g.bank.items.length + ' / ' + GUILD_BANK_SLOTS + '</span> &middot; ' + moneyHtml(g.bank.gold) + '</div>';
    if (!v) h += '<div class="muted">The guild bank is used at a banker.</div><p><button class="act" data-bkgo="1">Go to the nearest banker</button></p>';
    else {
      h += '<div class="vbtns"><button class="mini" data-gsort="1">Sort</button> <span class="small">Money: <input type="number" min="0" id="gMoney" value="1" style="width:60px"> gold <button class="mini" data-gmon="1">Deposit</button>' + (rk <= 1 ? '<button class="mini" data-gmon="-1">Take</button>' : '') + '</span>' +
        ' <span class="muted small">Click an item in your bags to put it in, one here to take it out.</span></div>';
      h += '<div class="grid gbgrid">'; for (let i = 0; i < GUILD_BANK_SLOTS; i++) { const s = g.bank.items[i]; h += s ? '<div class="slot" data-gb="' + i + '" data-iid="' + s.id + '">' + iconHtml(s) + '</div>' : '<div class="slot empty"></div>'; } h += '</div>';
    }
  } else h += '<div class="glog small">' + ((g.log || []).slice().reverse().map((t) => '<div>' + esc(t) + '</div>').join('') || '<span class="muted">Nothing yet.</span>') + '</div>';
  return h + '</div>';
}
function guildClick(e) {
  if (SH.tab !== 'guild' && SH.tab !== 'glog' && SH.tab !== 'gbank') return false; const c = active(); const t = e.target; let b; const g = guildOf(c);
  if ((b = t.closest('[data-gemb]'))) { GUI.draft.her.emblem = b.dataset.gemb; renderSheet(); return true; }
  if ((b = t.closest('[data-gcol]'))) { const [k, col] = b.dataset.gcol.split(':'); GUI.draft.her[k] = col; renderSheet(); return true; }
  if ((b = t.closest('[data-gfound]'))) { if (foundGuild(c, $('gName').value, GUI.draft.her)) GUI.draft = null; renderSheet(); return true; }
  if ((b = t.closest('[data-gtab]'))) { GUI.tab = b.dataset.gtab; renderSheet(); return true; }
  if (!g) return false;
  if ((b = t.closest('[data-gdinv]'))) { guildInvite(g, c, charById($('gInv').value)); renderSheet(); return true; }
  if ((b = t.closest('[data-gkick]'))) { const o = charById(b.dataset.gkick); if (o && confirm('Remove ' + o.name + ' from the guild?')) guildRemove(g, c, o); renderSheet(); return true; }
  if ((b = t.closest('[data-gleave]'))) { if (confirm('Leave <' + g.name + '>?')) guildRemove(g, c, c); renderSheet(); return true; }
  if ((b = t.closest('[data-gdis]'))) { if (confirm('Disband <' + g.name + '>? The guild bank goes to your mailbox.')) guildDisband(g); renderSheet(); return true; }
  if ((b = t.closest('[data-bkgo]'))) { orderNpc(c, 'bank'); closeSheet(); return true; }
  if (!bankerNear(c)) return false;
  if ((b = t.closest('[data-gsort]'))) { sortGuildBank(c); return true; }
  if ((b = t.closest('[data-gmon]'))) { gbankMoney(c, (+$('gMoney').value || 0) * 10000 * +b.dataset.gmon); return true; }
  if ((b = t.closest('[data-gb]'))) { gbankTake(c, +b.dataset.gb); return true; }
  if (SH.tab === 'gbank' && (b = t.closest('#sheetBags [data-idx]'))) { gbankPut(c, +b.dataset.idx); return true; }
  return false;
}
function guildChange(e) {
  if (SH.tab !== 'guild' && SH.tab !== 'gbank') return false; const t = e.target; const c = active(); const g = guildOf(c);
  if (t.id === 'gName') { GUI.draft.name = t.value; setTimeout(renderSheet, 0); return true; }
  if (t.dataset.grank && g) { guildSetRank(g, c, charById(t.dataset.grank), +t.value); setTimeout(renderSheet, 0); return true; }
  return false;
}
