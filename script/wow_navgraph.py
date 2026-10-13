# -*- coding: utf-8 -*-
"""
Walking routes between towns and zones, taken from the playerbot navigation graph
(ai_playerbot_travelnode, _link, _path). Those paths were generated on the real
navigation meshes (mmaps), so they already go AROUND walls, mountains and buildings.

Writes  C:\\wow excel\\wow_navgraph.xlsx
        C:\\wow excel\\gamedata\\navgraph.json
        C:\\wow excel\\gamedata\\nav.js        (A* over the graph + nearest-node helper)

navgraph.json
  nodes   [[id, name, map, x, y, z], ...]
  links   [[from, to, type, distance, swimDistance, extraCost, objectEntry, pathIndex], ...]
          type: 1 walk, 2 portal, 3 transport (boat/zeppelin/elevator), 4 flight path
          pathIndex -> paths[]  (-1 = no polyline, move straight / use the object)
  paths   [[x, y, z, x, y, z, ...], ...]       simplified polylines (max error ~1.5 yards)
  stats   counts and connected components

Use with nav.js:
  const nav = makeNav(data);   nav.nearest(map, x, y)  -> node id
  nav.route(fromNode, toNode, {types:[1,3]})  -> {cost, nodes:[...], points:[[x,y,z],...]}

Run:  py wow_navgraph.py
Needs wow_common.py, wow_util.py (same folder).
"""
import os
from collections import defaultdict

from wow_util import *   # noqa

OUTPUT = os.path.join(OUT_FOLDER, "wow_navgraph.xlsx")
SIMPLIFY = 1.5
LINK_TYPES = {0: "none", 1: "walk", 2: "portal", 3: "transport", 4: "flight path"}


def pick(cols, *names):
    for n in names:
        if n.lower() in cols:
            return cols[n.lower()]
    return None


def main():
    conn = connect()
    cur = conn.cursor()
    for t in ("ai_playerbot_travelnode", "ai_playerbot_travelnode_link", "ai_playerbot_travelnode_path"):
        if not table_exists(cur, t):
            raise RuntimeError("table %s not found in the database" % t)
    nc = columns(cur, "ai_playerbot_travelnode")
    cur.execute("SELECT * FROM ai_playerbot_travelnode")
    nodes = {}
    for r in cur.fetchall():
        nodes[g(r, nc, "id")] = [g(r, nc, "id"), g(r, nc, "name", "") or "", g(r, nc, "map_id"),
                                 round(float(g(r, nc, "x")), 1), round(float(g(r, nc, "y")), 1),
                                 round(float(g(r, nc, "z")), 1)]
    log("Nodes: %d" % len(nodes))

    lc = columns(cur, "ai_playerbot_travelnode_link")
    cur.execute("SELECT * FROM ai_playerbot_travelnode_link")
    links = []
    for r in cur.fetchall():
        links.append([g(r, lc, "node_id"), g(r, lc, "to_node_id"), g(r, lc, "type"),
                      round(float(g(r, lc, "distance")), 1), round(float(g(r, lc, "swim_distance")), 1),
                      round(float(g(r, lc, "extra_cost")), 1), g(r, lc, "object"), -1])
    log("Links: %d" % len(links))

    pc = columns(cur, "ai_playerbot_travelnode_path")
    a_ = pick(pc, "node_id", "from_node_id", "nodeid")
    b_ = pick(pc, "to_node_id", "tonodeid")
    n_ = pick(pc, "nr", "point_id", "idx", "seq")
    x_, y_, z_ = pick(pc, "x"), pick(pc, "y"), pick(pc, "z")
    order = (" ORDER BY `%s`, `%s`, `%s`" % (a_, b_, n_)) if n_ else (" ORDER BY `%s`, `%s`" % (a_, b_))
    cur.execute("SELECT `%s` a, `%s` b, `%s` x, `%s` y, `%s` z FROM ai_playerbot_travelnode_path%s"
                % (a_, b_, x_, y_, z_, order))
    raw = defaultdict(list)
    n_pts = 0
    for r in cur.fetchall():
        raw[(r["a"], r["b"])].append((float(r["x"]), float(r["y"]), float(r["z"])))
        n_pts += 1
    log("Path points: %d in %d paths" % (n_pts, len(raw)))

    paths = []
    kept = 0
    for L in links:
        pts = raw.get((L[0], L[1]))
        if pts and L[2] in (1, 3, 2, 0):
            sp = simplify(pts, SIMPLIFY)
            flat = []
            for x, y, z in sp:
                flat += [round(x, 1), round(y, 1), round(z, 1)]
            L[7] = len(paths)
            paths.append(flat)
            kept += len(sp)
    log("Simplified path points: %d (from %d)" % (kept, n_pts))

    # connected components (undirected, per walkable graph)
    parent = {n: n for n in nodes}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for L in links:
        if L[0] in parent and L[1] in parent:
            parent[find(L[0])] = find(L[1])
    comps = defaultdict(list)
    for n in nodes:
        comps[find(n)].append(n)
    big = sorted(comps.values(), key=len, reverse=True)
    stats = {"nodes": len(nodes), "links": len(links), "path_points": n_pts, "kept_points": kept,
             "components": len(big), "largest_components": [len(c) for c in big[:8]],
             "by_type": {LINK_TYPES.get(t, str(t)): sum(1 for L in links if L[2] == t)
                         for t in sorted(set(L[2] for L in links))}}
    log("Stats: %s" % stats)
    save_json("navgraph", {"nodes": list(nodes.values()), "links": links, "paths": paths, "stats": stats})
    save_text("nav.js", NAV_JS)

    book = BigBook(OUTPUT)
    ws = book.sheet("Nodes", ["Id", "Name", "Map", "X", "Y", "Z", "Component size"], [7, 34, 5, 11, 11, 9, 11])
    for n in nodes.values():
        ws.append(n + [len(comps[find(n[0])])])
    ws = book.sheet("Links", ["From", "From name", "To", "To name", "Type", "Distance", "Swim", "Extra", "Object"],
                    [7, 28, 7, 28, 11, 10, 8, 8, 9])
    for L in links:
        ws.append([L[0], nodes.get(L[0], [0, ""])[1], L[1], nodes.get(L[1], [0, ""])[1],
                   LINK_TYPES.get(L[2], L[2]), L[3], L[4], L[5], L[6] or ""])
    book.save()
    conn.close()
    log("Done.")


NAV_JS = r"""// nav.js - routing over navgraph.json
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
"""

if __name__ == "__main__":
    run(main)
