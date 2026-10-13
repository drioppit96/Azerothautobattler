// hostility.js - use with hostility.json
// H = hostile, N = neutral, F = friendly
function makeHostility(data) {
  const T = data.templates;
  function reaction(a, b) {            // reaction of template a towards template b
    const A = T[a], B = T[b];
    if (!A || !B) return 'N';
    if (a === b) return 'F';
    if (B[0]) {
      if (A[5].indexOf(B[0]) >= 0) return 'H';
      if (A[6].indexOf(B[0]) >= 0) return 'F';
    }
    if (A[4] & B[2]) return 'H';
    if (A[3] & B[2]) return 'F';
    return 'N';
  }
  function behaviour(entry, raceIndex) {   // raceIndex: 0 = first race in data.races
    const c = data.creatures[entry];
    return c ? c[1][raceIndex] : 'N';      // A / N / F / X
  }
  function aggroRadius(mobLevel, playerLevel, base) {
    const d = Math.max(-25, Math.min(25, playerLevel - mobLevel));
    return Math.max(5, (base || 20) - d);
  }
  return { reaction, behaviour, aggroRadius };
}
