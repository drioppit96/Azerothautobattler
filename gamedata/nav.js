// nav.js - routing over navgraph.json
// const nav = makeNav(data);  nav.nearest(map,x,y);  nav.route(a,b,{types:[1,3]})
function makeNav(data) {
  const N = {}; for (const n of data.nodes) N[n[0]] = n;
  const out = {};
  for (const L of data.links) (out[L[0]] = out[L[0]] || []).push(L);
  function nearest(map, x, y) {
    let best = null, bd = Infinity;
    for (const n of data.nodes) {
      if (n[2] !== map) continue;
      const d = (n[3] - x) ** 2 + (n[4] - y) ** 2;
      if (d < bd) { bd = d; best = n[0]; }
    }
    return best;
  }
  function route(a, b, opt) {
    opt = opt || {}; const types = opt.types || [1, 2, 3];
    const goal = N[b]; if (!N[a] || !goal) return null;
    const g = {}, prev = {}, done = {};
    g[a] = 0; const open = [[0, a]];
    while (open.length) {
      open.sort((p, q) => p[0] - q[0]);
      const [, u] = open.shift();
      if (done[u]) continue; done[u] = 1;
      if (u === b) break;
      for (const L of (out[u] || [])) {
        if (types.indexOf(L[2]) < 0) continue;
        const v = L[1], nv = N[v]; if (!nv) continue;
        const w = L[3] + L[4] * 2 + L[5] + 1;
        const ng = g[u] + w;
        if (g[v] === undefined || ng < g[v]) {
          g[v] = ng; prev[v] = L;
          const h = nv[2] === goal[2] ? Math.hypot(nv[3] - goal[3], nv[4] - goal[4]) : 0;
          open.push([ng + h, v]);
        }
      }
    }
    if (g[b] === undefined) return null;
    const links = []; let c = b;
    while (c !== a) { const L = prev[c]; links.unshift(L); c = L[0]; }
    const pts = [], nodes = [a];
    for (const L of links) {
      nodes.push(L[1]);
      if (L[7] >= 0) { const p = data.paths[L[7]]; for (let i = 0; i < p.length; i += 3) pts.push([p[i], p[i + 1], p[i + 2]]); }
      else { const n = N[L[1]]; pts.push([n[3], n[4], n[5]]); }
    }
    return { cost: g[b], nodes, links, points: pts };
  }
  return { nearest, route };
}
