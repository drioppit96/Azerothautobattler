// spellmath.js - helpers for spells.json
// const SM = makeSpellMath(data);   data = parsed spells.json
// SM.value(spell, effectIndex, casterLevel)      -> [lo, hi]   (value range at that caster level)
// SM.direct(spell, ctx, rng)                     -> rolled direct damage/heal (ctx: {level, power})
// SM.tick(spell, ctx, rng)                       -> rolled damage/heal of ONE periodic tick
// SM.cost(spell, baseMana)                       -> resource cost
// SM.castTime(spell, hasteMods)                  -> ms (spell mods can be applied by the caller)
function makeSpellMath(data) {
  const S = data.spells;
  function value(sp, i, level) {
    const e = sp.ef[i]; let lo = e.lo, hi = e.hi;
    if (e.ppl && level > (sp.bl || 0)) {
      const lv = sp.ml ? Math.min(level, sp.ml) : level;
      const add = Math.trunc((lv - (sp.bl || 0)) * e.ppl);
      lo += add; hi += add;
    }
    return [lo, hi];
  }
  function roll(range, rng) {
    const r = rng ? rng() : Math.random();
    return Math.floor(range[0] + r * (range[1] - range[0] + 1));
  }
  function direct(sp, ctx, rng) {
    const s = sp.s; if (!s || !s.direct) return 0;
    let idx = sp.ef.findIndex(e => e.t === 2 || e.t === 10 || e.t === 67 || e.t === 9 || e.t === 7);
    const rg = idx >= 0 ? value(sp, idx, ctx.level) : s.direct;
    let v = roll(rg, rng);
    if (s.cd_direct && ctx.power) v += Math.floor(ctx.power * s.cd_direct);
    return v;
  }
  function tick(sp, ctx, rng) {
    const s = sp.s; if (!s || !s.dot) return 0;
    const idx = sp.ef.findIndex(e => e.au === 3 || e.au === 8 || e.au === 89);
    const rg = idx >= 0 ? value(sp, idx, ctx.level) : s.dot.tick;
    let v = roll(rg, rng);
    if (s.cd_dot && ctx.power) v += Math.floor(ctx.power * s.cd_dot / Math.max(1, s.dot.ticks));
    return v;
  }
  function cost(sp, baseMana) {
    if (!sp.pw) return 0;
    return Math.floor(sp.pw[1] + (sp.pw[2] ? baseMana * sp.pw[2] / 100 : 0));
  }
  function castTime(sp, haste) { return Math.max(0, (sp.cast || 0) * (haste || 1)); }
  function modValue(sp, e) { return e; }
  return { value, direct, tick, cost, castTime, spells: S };
}
