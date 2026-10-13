# -*- coding: utf-8 -*-
"""
Flight paths (fast travel) for the auto-battler.

Writes  C:\\wow excel\\wow_taxi.xlsx
        C:\\wow excel\\gamedata\\taxi.json
        C:\\wow excel\\gamedata\\taxi.js       (Dijkstra route finder)

taxi.json
  nodes   {id: {n: name, map, x, y, z, side: "Alliance"|"Horde"|"Both"|"", npcs: [[entry, name, factionTemplate]],
                npcDist: distance (yards) from the flight master to the node}}
  edges   [{id, from, to, cost (copper), len (yards), secs (flight time), pts: [[x, y, z], ...]}]
  speed   flight speed used for 'secs' (yards per second)
A node is "discovered" in the real game by talking to its flight master; the game can start with the
home town node known and unlock the rest when the character visits the flight master (npcs list gives
the position through creature spawns: see spawns.json).

Run:  py wow_taxi.py
Needs wow_common.py, wow_util.py and the DBCs TaxiNodes, TaxiPath, TaxiPathNode (extract_dbc_multi.py).
"""
import math
import os
from collections import defaultdict

from wow_util import *   # noqa

OUTPUT = os.path.join(OUT_FOLDER, "wow_taxi.xlsx")
TAXI_SPEED = 32.0           # yards per second of the taxi mounts


def load_nodes():
    d = load_dbc("TaxiNodes")
    if not d:
        raise RuntimeError("TaxiNodes.dbc missing - run extract_dbc_multi.py")
    # name column: first text column after the coordinates
    nidx = 5
    for i in range(2, d.fc):
        good = sum(1 for r in d.rows[:200] if len(d.s(r[i])) >= 3)
        if good >= 0.6 * min(len(d.rows), 200):
            nidx = i
            break
    nodes = {}
    for r in d.rows:
        nodes[r[0]] = {"n": d.s(r[nidx]), "map": r[1], "x": round(flt(r[2]), 2), "y": round(flt(r[3]), 2),
                       "z": round(flt(r[4]), 2), "side": "", "npcs": [], "npcDist": None}
    return nodes


def load_paths():
    d = load_dbc("TaxiPath")
    if not d:
        raise RuntimeError("TaxiPath.dbc missing - run extract_dbc_multi.py")
    paths = {r[0]: {"id": r[0], "from": r[1], "to": r[2], "cost": r[3]} for r in d.rows}
    d = load_dbc("TaxiPathNode")
    pts = defaultdict(list)
    if d:
        for r in d.rows:
            # id, path, index, map, x, y, z, ...
            pts[r[1]].append((r[2], r[3], round(flt(r[4]), 2), round(flt(r[5]), 2), round(flt(r[6]), 2)))
    for pid, lst in pts.items():
        lst.sort()
        if pid in paths:
            paths[pid]["pts"] = lst
    return paths


def main():
    nodes = load_nodes()
    paths = load_paths()
    log("Taxi nodes: %d, paths: %d" % (len(nodes), len(paths)))
    conn = connect()
    cur = conn.cursor()
    groups = load_faction_groups()

    # flight masters -> nearest node on the same map
    tc = columns(cur, "creature_template")
    cur.execute("SELECT * FROM creature_template")
    fm = {}
    for r in cur.fetchall():
        if g(r, tc, "npcflags") & 8:
            fm[g(r, tc, "entry")] = (g(r, tc, "name", ""), g(r, tc, "faction"))
    log("Flight master templates: %d" % len(fm))
    sp = creature_spawns(cur, set(fm))
    by_node = defaultdict(list)
    far = 0
    for entry, lst in sp.items():
        nm, fac = fm[entry]
        side = side_from_template(fac, groups)
        for mp, x, y in lst:
            best, bd = None, 1e18
            for nid, n in nodes.items():
                if n["map"] != mp:
                    continue
                dd = (n["x"] - x) ** 2 + (n["y"] - y) ** 2
                if dd < bd:
                    best, bd = nid, dd
            if best is not None:
                dist = math.sqrt(bd)
                by_node[best].append((entry, nm, fac, side, dist))
    for nid, lst in by_node.items():
        n = nodes[nid]
        seen = set()
        for entry, nm, fac, side, dist in sorted(lst, key=lambda t: t[4]):
            if entry in seen:
                continue
            seen.add(entry)
            n["npcs"].append([entry, nm, fac])
        n["npcDist"] = round(min(t[4] for t in lst), 1)
        sides = set(t[3] for t in lst if t[3])
        n["side"] = "Both" if len(sides) > 1 else (sides.pop() if sides else "")
        if n["npcDist"] > 60:
            far += 1
    log("Nodes with a flight master: %d (of which %d further than 60 yd away: check them)" % (len(by_node), far))

    edges = []
    for pid, p in sorted(paths.items()):
        pts = p.get("pts", [])
        # a path can cross a map change (teleport): only count points on the first map
        pl = [(x, y, z) for _, mp, x, y, z in pts]
        length = 0.0
        for a, b in zip(pl, pl[1:]):
            length += math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2)
        if not pl and p["from"] in nodes and p["to"] in nodes:
            a, b = nodes[p["from"]], nodes[p["to"]]
            length = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
        edges.append({"id": pid, "from": p["from"], "to": p["to"], "cost": p["cost"], "len": round(length, 1),
                      "secs": round(length / TAXI_SPEED, 1), "pts": [list(q) for q in simplify(pl, 3.0)]})
    usable = [e for e in edges if e["from"] in nodes and e["to"] in nodes]
    save_json("taxi", {"nodes": {str(k): v for k, v in nodes.items()}, "edges": usable, "speed": TAXI_SPEED})
    save_text("taxi.js", TAXI_JS)

    book = BigBook(OUTPUT)
    ws = book.sheet("Nodes", ["Id", "Name", "Map", "X", "Y", "Z", "Side", "Flight master", "Master Id",
                              "Distance to master"], [6, 30, 5, 10, 10, 8, 10, 28, 9, 10])
    for nid, n in sorted(nodes.items()):
        ws.append([nid, n["n"], n["map"], n["x"], n["y"], n["z"], n["side"],
                   ", ".join(x[1] for x in n["npcs"][:3]), ", ".join(str(x[0]) for x in n["npcs"][:3]),
                   n["npcDist"] if n["npcDist"] is not None else ""])
    ws = book.sheet("Paths", ["Path", "From", "To", "Cost", "Length (yd)", "Time (s)"], [7, 30, 30, 11, 11, 9])
    for e in usable:
        ws.append([e["id"], nodes[e["from"]]["n"], nodes[e["to"]]["n"], money(e["cost"]), e["len"], e["secs"]])
    book.save()
    conn.close()
    log("Done.")


TAXI_JS = r"""// taxi.js - flight path routing over taxi.json
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
"""

if __name__ == "__main__":
    run(main)
