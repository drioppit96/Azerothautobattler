// taxi.js - flight path routing over taxi.json
// const taxi = makeTaxi(data);  taxi.route(fromNode, toNode, {side:'Alliance', known:Set, by:'cost'|'secs'})
function makeTaxi(data) {
  const out = {};
  for (const e of data.edges) (out[e.from] = out[e.from] || []).push(e);
  function allowed(nodeId, side) {
    const n = data.nodes[nodeId];
    return n && (!side || !n.side || n.side === 'Both' || n.side === side);
  }
  function route(from, to, opt) {
    opt = opt || {}; const by = opt.by || 'cost';
    const dist = {}, prev = {}, done = {};
    dist[from] = 0;
    const open = [from];
    while (open.length) {
      open.sort((a, b) => dist[a] - dist[b]);
      const u = open.shift();
      if (done[u]) continue; done[u] = true;
      if (String(u) === String(to)) break;
      for (const e of (out[u] || [])) {
        if (!allowed(e.to, opt.side)) continue;
        if (opt.known && !opt.known.has(e.to) && String(e.to) !== String(to)) continue;
        const w = (by === 'secs' ? e.secs : e.cost) + 1e-6;
        if (dist[e.to] === undefined || dist[u] + w < dist[e.to]) {
          dist[e.to] = dist[u] + w; prev[e.to] = e; open.push(e.to);
        }
      }
    }
    if (dist[to] === undefined) return null;
    const legs = []; let cur = to;
    while (String(cur) !== String(from)) { const e = prev[cur]; legs.unshift(e); cur = e.from; }
    return { legs, cost: legs.reduce((s, e) => s + e.cost, 0), secs: legs.reduce((s, e) => s + e.secs, 0) };
  }
  return { route, allowed };
}
