'use strict';
/* looks.js - the character's appearance (skin colour, face, hair style, hair colour, facial hair / race feature) and
   the portrait painted from it, like the real game.

   The data comes from script/wow_charlooks.py (../charlooks): every piece of each character model drawn once from
   the portrait camera as "which texel of which texture is here, how lit, how far", plus the client's skin, face,
   hair and beard textures and the tables that say which piece and texture belong to which choice. Here the
   chosen pieces are put together pixel by pixel (the nearest one wins) with the chosen textures.

   c.look = { skin, face, hair, hairColor, facial }  (the client's own variation / colour numbers)
   Without the data (not extracted yet) everything falls back to the old fixed race portraits. */

const LOOK = { data: null, failed: false, img: {}, parts: {}, cache: {}, pending: {}, ver: 0, loading: null };
const LOOK_BASE = '../charlooks/';
/* the name of the 5th choice per race [male, female], like the original character creation */
const LOOK_FEATURE = { 1: ['Facial Hair', 'Piercings'], 2: ['Features', 'Piercings'], 3: ['Facial Hair', 'Piercings'], 4: ['Features', 'Markings'],
  5: ['Features', 'Features'], 6: ['Facial Hair', 'Hair'], 7: ['Facial Hair', 'Earrings'], 8: ['Tusks', 'Features'] };
const LOOK_HAIR = { 6: ['Horn Style', 'Horn Color'] };          // tauren: horns instead of hair

function looksInit() {
  if (LOOK.loading) return LOOK.loading;
  LOOK.loading = fetch(LOOK_BASE + 'looks.json').then((r) => (r.ok ? r.json() : null)).then((d) => { LOOK.data = d && d.races ? d : null; LOOK.failed = !LOOK.data; })
    .catch(() => { LOOK.failed = true; });
  return LOOK.loading;
}
function looksReady() { return !!LOOK.data; }
function lookRace(race, sex) { return LOOK.data && LOOK.data.races[race + '_' + (sex ? 1 : 0)] || null; }
const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);

/* what can be chosen for a race / sex (and, for faces and colours, the rest of the look) */
function lookOptions(race, sex, look) {
  const R = lookRace(race, sex); if (!R) return null; look = look || {};
  const skins = uniq(R.skins.map((x) => x.col));
  const faces = uniq(R.faces.filter((x) => x.col === look.skin).map((x) => x.var)); const facesAll = uniq(R.faces.map((x) => x.var));
  const hair = uniq(R.hair.map((x) => x.var).concat(lookHairRows(R).map((r) => r.var)));
  const hairColors = uniq(R.hair.filter((x) => x.var === look.hair).map((x) => x.col)); const hairColorsAll = uniq(R.hair.map((x) => x.col));
  const facial = uniq(R.facial.map((x) => x.var).concat(lookFacialRows(R).map((r) => r.var)));
  return { skins, faces: faces.length ? faces : facesAll, hair, hairColors: hairColors.length ? hairColors : hairColorsAll, facial };
}
/* CharHairGeosets rows: [ID, race, sex, variation, geoset, bald] */
function lookHairRows(R) { return (R.hairGeosets || []).map((r) => ({ var: r[3], geo: r[4], bald: r[5] })); }
/* CharacterFacialHairStyles rows: [race, sex, variation, geoset x N] (or with an ID first) */
function lookFacialRows(R) {
  return (R.facialStyles || []).map((r) => { const off = r.length >= 9 && r[1] <= 8 && r[2] <= 1 ? 1 : 0; return { var: r[2 + off], geos: r.slice(3 + off) }; });
}
function lookValid(race, sex, look) {
  const o = lookOptions(race, sex, look); if (!o) return look;
  const pick = (v, list) => (list.includes(v) ? v : list[0] || 0);
  const L = Object.assign({}, look);
  L.skin = pick(L.skin, o.skins); const o2 = lookOptions(race, sex, L);
  L.face = pick(L.face, o2.faces); L.hair = pick(L.hair, o2.hair); const o3 = lookOptions(race, sex, L);
  L.hairColor = pick(L.hairColor, o3.hairColors); L.facial = pick(L.facial, o3.facial);
  return L;
}
function lookRandom(race, sex) {
  const r = (a) => a[(Math.random() * a.length) | 0] || 0; let L = {};
  const o = lookOptions(race, sex, L); if (!o) return null;
  L.skin = r(o.skins); const o2 = lookOptions(race, sex, L); L.face = r(o2.faces); L.hair = r(o2.hair);
  const o3 = lookOptions(race, sex, L); L.hairColor = r(o3.hairColors); L.facial = r(o3.facial);
  return lookValid(race, sex, L);
}
function lookKey(race, sex, L) { return race + '_' + (sex ? 1 : 0) + ':' + (L ? [L.skin, L.face, L.hair, L.hairColor, L.facial].join('.') : 'x'); }

/* ------------------------------------------------------------------ loading pictures */
function lookImg(name) {
  if (!name) return Promise.resolve(null);
  if (!LOOK.img[name]) LOOK.img[name] = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = LOOK_BASE + 'tex/' + name; });
  return LOOK.img[name];
}
function lookPixels(im, w, h) {
  const cv = document.createElement('canvas'); cv.width = w || im.width; cv.height = h || im.height; const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(im, 0, 0, cv.width, cv.height); return { w: cv.width, h: cv.height, d: x.getImageData(0, 0, cv.width, cv.height).data };
}
/* one model piece: the pixels it covers with texel, light and depth */
function lookPart(key, file) {
  const k = key + '/' + file;
  if (!LOOK.parts[k]) LOOK.parts[k] = new Promise((res) => {
    const im = new Image(); im.onerror = () => res(null);
    im.onload = () => {
      const S = LOOK.data.size; const P = lookPixels(im, S * 2, S); const d = P.d; const W = S * 2;
      const idx = [], u = [], v = [], z = [], s = [];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const o = (y * W + x) * 4; if (d[o + 3] < 128) continue; const o2 = (y * W + x + S) * 4;
        idx.push(y * S + x); u.push(d[o]); v.push(d[o + 1]); z.push(d[o + 2]); s.push(d[o2] / 255 * 1.2);
      }
      res({ idx: Int32Array.from(idx), u: Uint8Array.from(u), v: Uint8Array.from(v), z: Uint8Array.from(z), s: Float32Array.from(s) });
    };
    im.src = LOOK_BASE + 'parts/' + key + '/' + file;
  });
  return LOOK.parts[k];
}

/* ------------------------------------------------------------------ painting a portrait */
function lookGeosets(R, L) {
  const on = new Set([0]);
  const hr = lookHairRows(R).find((r) => r.var === L.hair);
  const hg = hr ? hr.geo : 1; on.add(hg > 0 ? hg : 1);
  const fr = lookFacialRows(R).find((r) => r.var === L.facial);
  const gs = fr ? fr.geos : [1, 1, 1]; const grp = [1, 3, 2];
  for (let i = 0; i < 3; i++) on.add(grp[i] * 100 + (gs[i] || 1));
  const ids = new Set(R.pieces.map((p) => p.geo));
  on.add(ids.has(702) ? 702 : 701);
  for (const g of ids) if (g >= 400 && g % 100 === 1 && Math.floor(g / 100) !== 7) on.add(g);
  return on;
}
async function lookPaint(race, sex, L) {
  await looksInit(); const R = lookRace(race, sex); if (!R) return null;
  L = lookValid(race, sex, L || {}); const key = race + '_' + (sex ? 1 : 0); const S = LOOK.data.size;
  const skin = R.skins.find((x) => x.col === L.skin) || R.skins[0];
  const face = R.faces.find((x) => x.var === L.face && x.col === L.skin) || R.faces.find((x) => x.var === L.face);
  const hair = R.hair.find((x) => x.var === L.hair && x.col === L.hairColor) || R.hair.find((x) => x.var === L.hair);
  const fac = R.facial.find((x) => x.var === L.facial && x.col === L.hairColor) || R.facial.find((x) => x.var === L.facial);
  // the skin: the base picture with the face, the beard and the scalp painted on their parts of it
  const rg = LOOK.data.regions; const SK = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = SK; const x = cv.getContext('2d', { willReadFrequently: true });
  const lay = async (name, reg) => { const im = await lookImg(name); if (!im) return; if (reg) x.drawImage(im, reg[0], reg[1], reg[2], reg[3]); else x.drawImage(im, 0, 0, SK, SK); };
  if (skin) await lay(skin.base);
  if (face) { await lay(face.lower, rg.faceLower); await lay(face.upper, rg.faceUpper); }
  if (fac) { await lay(fac.lower, rg.faceLower); await lay(fac.upper, rg.faceUpper); }
  if (hair) { await lay(hair.scalpLower, rg.faceLower); await lay(hair.scalpUpper, rg.faceUpper); }
  const tex = { 1: { w: SK, h: SK, d: x.getImageData(0, 0, SK, SK).data } };
  const hi = hair && await lookImg(hair.tex); if (hi) tex[6] = lookPixels(hi);
  const ei = skin && skin.extra && await lookImg(skin.extra); if (ei) tex[8] = lookPixels(ei);
  // the pieces, the nearest one at each pixel
  const on = lookGeosets(R, L); const list = R.pieces.filter((p) => on.has(p.geo) && tex[p.slot]);
  const parts = await Promise.all(list.map((p) => lookPart(key, p.file)));
  const best = new Uint8Array(S * S).fill(255); const has = new Uint8Array(S * S); const out = new Uint8ClampedArray(S * S * 4);
  list.forEach((p, i) => {
    const P = parts[i]; if (!P) return; const T = tex[p.slot]; const kx = T.w / 256, ky = T.h / 256; const alpha = p.blend >= 1;
    for (let j = 0; j < P.idx.length; j++) {
      const q = P.idx[j]; const zz = P.z[j]; if (has[q] && (zz > best[q] || (zz === best[q] && !alpha))) continue;          // hair and beards win a tie with the head under them
      const to = ((((P.v[j] * ky) | 0) * T.w) + ((P.u[j] * kx) | 0)) * 4; if (alpha && T.d[to + 3] < 128) continue;
      const sh = P.s[j]; const o = q * 4;
      out[o] = T.d[to] * sh; out[o + 1] = T.d[to + 1] * sh; out[o + 2] = T.d[to + 2] * sh; out[o + 3] = 255; best[q] = zz; has[q] = 1;
    }
  });
  // on a dark background, made smaller (smooth edges)
  const pc = document.createElement('canvas'); pc.width = pc.height = S; const px = pc.getContext('2d'); px.putImageData(new ImageData(out, S, S), 0, 0);
  const fin = document.createElement('canvas'); fin.width = fin.height = 128; const fx2 = fin.getContext('2d');
  const g = fx2.createRadialGradient(64, 54, 10, 64, 64, 90); g.addColorStop(0, '#2c2a30'); g.addColorStop(1, '#0c0b0e'); fx2.fillStyle = g; fx2.fillRect(0, 0, 128, 128);
  fx2.imageSmoothingEnabled = true; fx2.imageSmoothingQuality = 'high'; fx2.drawImage(pc, 0, 0, 128, 128);
  return fin.toDataURL('image/png');
}
/* the portrait of a look: ready (a picture address) or null while it is painted (LOOK.ver goes up when done) */
function lookPortrait(race, sex, L) {
  if (!looksReady()) { if (!LOOK.failed) looksInit().then(() => { if (looksReady()) LOOK.ver++; }); return null; }
  const k = lookKey(race, sex, L); if (LOOK.cache[k]) return LOOK.cache[k];
  if (!LOOK.pending[k]) LOOK.pending[k] = lookPaint(race, sex, L).then((url) => { if (url) { LOOK.cache[k] = url; LOOK.ver++; } }).catch((e) => console.warn('portrait', e));
  return null;
}
/* the portrait of a character (its own look, or the old race picture) */
function charPortrait(c) {
  if (c && c.look && looksReady()) { const u = lookPortrait(c.race, c.gender, c.look); if (u) return u; }
  else if (c && c.look) lookPortrait(c.race, c.gender, c.look);
  return racePortrait(c.race, c.gender);
}

/* ------------------------------------------------------------------ the pickers (character creation, Appearance) */
function lookLabels(race, sex) {
  const h = LOOK_HAIR[race] || ['Hair Style', 'Hair Color'];
  return [['skin', 'Skin Color'], ['face', 'Face'], ['hair', h[0]], ['hairColor', h[1]], ['facial', (LOOK_FEATURE[race] || ['Features', 'Features'])[sex ? 1 : 0]]];
}
function lookPickerHtml(race, sex, L) {
  const o = lookOptions(race, sex, L); if (!o) return '';
  const lists = { skin: o.skins, face: o.faces, hair: o.hair, hairColor: o.hairColors, facial: o.facial };
  let h = '<div class="lk-pick">';
  for (const [k, label] of lookLabels(race, sex)) {
    const list = lists[k]; const i = Math.max(0, list.indexOf(L[k]));
    h += '<div class="lk-row"><button class="mini lk-arr" data-lk="' + k + '" data-d="-1"' + (list.length < 2 ? ' disabled' : '') + '>&#9664;</button><span class="lk-lbl">' + label +
      ' <span class="muted">' + (i + 1) + '/' + list.length + '</span></span><button class="mini lk-arr" data-lk="' + k + '" data-d="1"' + (list.length < 2 ? ' disabled' : '') + '>&#9654;</button></div>';
  }
  return h + '<button class="mini lk-rnd" data-lkrnd="1">&#9860; Randomize</button></div>';
}
/* a click on an arrow: the next / previous choice; returns the new look (or null) */
function lookStep(race, sex, L, k, d) {
  const o = lookOptions(race, sex, L); if (!o) return null;
  const lists = { skin: o.skins, face: o.faces, hair: o.hair, hairColor: o.hairColors, facial: o.facial }; const list = lists[k]; if (!list || !list.length) return null;
  const i = list.indexOf(L[k]); const n = list[((i < 0 ? 0 : i) + d + list.length) % list.length];
  return lookValid(race, sex, Object.assign({}, L, { [k]: n }));
}
/* the Appearance window (a free barber) for a character */
function openAppearance(c) {
  looksInit().then(() => {
    if (!looksReady()) { log('The character looks are not extracted yet (script/wow_charlooks.py).'); return; }
    let el = $('lookwin'); if (!el) { el = document.createElement('div'); el.id = 'lookwin'; document.body.appendChild(el); }
    let L = lookValid(c.race, c.gender, c.look || lookRandom(c.race, c.gender));
    const draw = () => {
      const url = lookPortrait(c.race, c.gender, L);
      el.innerHTML = '<div class="lk-win"><h3>Appearance - ' + esc(c.name) + '</h3><div class="lk-body"><div class="lk-por">' + (url ? '<img src="' + url + '">' : '<div class="lk-wait">...</div>') + '</div>' +
        lookPickerHtml(c.race, c.gender, L) + '</div><div class="lk-btns"><button class="act" data-lksave="1">Save</button><button class="mini" data-lkclose="1">Cancel</button></div></div>';
    };
    el.hidden = false; draw(); const v0 = { v: LOOK.ver };
    const t = setInterval(() => { if (el.hidden) { clearInterval(t); return; } if (LOOK.ver !== v0.v) { v0.v = LOOK.ver; draw(); } }, 120);
    el.onclick = (e) => {
      if (e.target === el) { el.hidden = true; return; }
      const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
      if (d.lk) { const n = lookStep(c.race, c.gender, L, d.lk, +d.d); if (n) { L = n; draw(); } }
      else if (d.lkrnd) { L = lookRandom(c.race, c.gender) || L; draw(); }
      else if (d.lksave) { c.look = L; save(); el.hidden = true; LOOK.ver++; log(c.name + ' has a new look.'); if (typeof renderChar === 'function') renderChar(); }
      else if (d.lkclose) el.hidden = true;
    };
  });
}
