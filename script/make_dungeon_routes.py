"""make_dungeon_routes.py - the way groups take through every dungeon and raid, as the guides describe it:
the bosses in the guides' order (icy-veins, warcrafttavern, almarsguides), the way between them along the spots where
creatures and objects stand (stairs and ramps included). Runs follow these lines (a little to either side); there are
no walls.

Writes gamedata/dungeon_routes.json: {"<map>": [{"name", "path": [[x, y, z], ...], "stops": [[boss, index], ...]}]}

    py make_dungeon_routes.py          (numpy, scipy)
"""
import json, math, os
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def spots_of(d, spawns, objects):
    pts = []
    for lst in list(spawns.values()) + list(objects.values()):
        for p in lst:
            if p[0] == d["map"] and p[3] is not None:
                pts.append((p[1], p[2], p[3]))
    for b in d.get("bosses", []):
        pts.append((b["x"], b["y"], b.get("z") or 0))
    for e in d.get("enter", []):
        pts.append((e["x"], e["y"], e.get("z") or 0))
    return pts


# the way groups take through the big dungeons (boss order from the guides: icy-veins, warcrafttavern, almarsguides);
# each route starts at a way in (by name, or the first) and visits the bosses in this order
ROUTES = {
    389: [{"name": "Ragefire Chasm", "bosses": ["Oggleflint", "Taragaman the Hungerer", "Jergosh the Invoker", "Bazzalan"]}],
    36: [{"name": "The Deadmines", "bosses": ["Rhahk'Zor", "Gilnid", "Mr. Smite", "Cookie", "Captain Greenskin", "Edwin VanCleef"]}],
    43: [{"name": "Wailing Caverns", "bosses": ["Kresh", "Lord Pythas", "Lord Cobrahn", "Skum", "Lord Serpentis", "Verdan the Everliving"]}],
    33: [{"name": "Shadowfang Keep", "bosses": ["Rethilgore", "Razorclaw the Butcher", "Baron Silverlaine", "Commander Springvale", "Odo the Blindwatcher",
                                               "Fenrus the Devourer", "Wolf Master Nandos", "Archmage Arugal"]}],
    48: [{"name": "Blackfathom Deeps", "bosses": ["Ghamoo-ra", "Lady Sarevess", "Gelihast", "Lorgus Jett", "Old Serra'kis", "Twilight Lord Kelris", "Aku'mai"]}],
    34: [{"name": "The Stockade", "bosses": ["Targorr the Dread", "Kam Deepfury", "Hamhock", "Dextren Ward", "Bazil Thredd"]}],
    90: [{"name": "Gnomeregan", "enter": "Gnomeregan", "bosses": ["Viscous Fallout", "Electrocutioner 6000", "Crowd Pummeler 9-60", "Mekgineer Thermaplugg"]}],
    47: [{"name": "Razorfen Kraul", "bosses": ["Roogug", "Aggem Thorncurse", "Death Speaker Jargba", "Overlord Ramtusk", "Agathelos the Raging", "Charlga Razorflank"]}],
    189: [{"name": "Scarlet Monastery - Graveyard", "enter": "Scarlet Monastery Graveyard", "bosses": ["Interrogator Vishas", "Bloodmage Thalnos"]},
          {"name": "Scarlet Monastery - Library", "enter": "Scarlet Monastery Library", "bosses": ["Houndmaster Loksey", "Arcanist Doan"]},
          {"name": "Scarlet Monastery - Armory", "enter": "Scarlet Monastery Armory", "bosses": ["Herod"]},
          {"name": "Scarlet Monastery - Cathedral", "enter": "Scarlet Monastery Cathedral", "bosses": ["High Inquisitor Fairbanks", "High Inquisitor Whitemane"]}],
    129: [{"name": "Razorfen Downs", "bosses": ["Mordresh Fire Eye", "Glutton", "Amnennar the Coldbringer"]}],
    70: [{"name": "Uldaman", "enter": "Uldaman", "bosses": ["Revelosh", "Baelog", "Ancient Stone Keeper", "Galgann Firehammer", "Grimlok", "Archaedas"]}],
    209: [{"name": "Zul'Farrak", "bosses": ["Antu'sul", "Theka the Martyr", "Witch Doctor Zum'rah", "Hydromancer Velratha", "Chief Ukorz Sandscalp"]}],
    349: [{"name": "Maraudon - Orange", "enter": "Maraudon Orange", "bosses": ["Noxxion", "Razorlash"]},
          {"name": "Maraudon - Purple and inner", "enter": "Maraudon Purple", "bosses": ["Lord Vyletongue", "Celebras the Cursed", "Landslide", "Tinkerer Gizlock", "Rotgrip", "Princess Theradras"]}],
    409: [{"name": "Molten Core", "bosses": ["Lucifron", "Magmadar", "Gehennas", "Garr", "Shazzrah", "Baron Geddon", "Golemagg the Incinerator", "Sulfuron Harbinger"]}],
    249: [{"name": "Onyxia's Lair", "bosses": ["Onyxia"]}],
    309: [{"name": "Zul'Gurub", "bosses": ["High Priestess Jeklik", "High Priest Venoxis", "High Priestess Mar'li", "Bloodlord Mandokir", "High Priest Thekal", "Jin'do the Hexxer", "Hakkar"]}],
    509: [{"name": "Ruins of Ahn'Qiraj", "bosses": ["Kurinnaxx", "General Rajaxx", "Moam", "Buru the Gorger", "Ayamiss the Hunter", "Ossirian the Unscarred"]}],
    109: [{"name": "Sunken Temple", "bosses": ["Jammal'an the Prophet", "Morphaz", "Hazzas", "Shade of Eranikus"]}],
    230: [{"name": "Blackrock Depths", "bosses": ["High Interrogator Gerstahn", "Lord Roccor", "Houndmaster Grebmar", "Pyromancer Loregrain",
                                                 "Fineous Darkvire", "Lord Incendius", "Warder Stilgiss", "Bael'Gar", "General Angerforge",
                                                 "Golem Lord Argelmach", "Ribbly Screwspigot", "Plugger Spazzring", "Phalanx", "Ambassador Flamelash",
                                                 "Anger'rel", "Magmus", "Emperor Dagran Thaurissan"]}],
    229: [{"name": "Lower Blackrock Spire", "bosses": ["Highlord Omokk", "Shadow Hunter Vosh'gajin", "War Master Voone", "Mother Smolderweb",
                                                      "Quartermaster Zigris", "Halycon", "Overlord Wyrmthalak"]},
          {"name": "Upper Blackrock Spire", "bosses": ["Pyroguard Emberseer", "The Beast", "General Drakkisath"]}],
    429: [{"name": "Dire Maul East", "enter": "Dire Maul East", "bosses": ["Zevrim Thornhoof", "Hydrospawn", "Lethtendris", "Alzzin the Wildshaper"]},
          {"name": "Dire Maul West", "enter": "Dire Maul West", "bosses": ["Tendris Warpwood", "Illyanna Ravenoak", "Magister Kalendris", "Immol'thar", "Prince Tortheldrin"]},
          {"name": "Dire Maul North", "enter": "Dire Maul North", "bosses": ["Guard Mol'dar", "Stomper Kreeg", "Guard Fengus", "Guard Slip'kik", "Captain Kromcrush", "Cho'Rush the Observer", "King Gordok"]}],
    289: [{"name": "Scholomance", "bosses": ["Jandice Barov", "Rattlegore", "Vectus", "Marduk Blackpool", "Ras Frostwhisper", "The Ravenian", "Lord Alexei Barov",
                                            "Lady Illucia Barov", "Instructor Malicia", "Doctor Theolen Krastinov", "Lorekeeper Polkelt"]}],
    329: [{"name": "Stratholme - Live", "enter": "Stratholme - Entering Left Front", "bosses": ["Hearthsinger Forresten", "The Unforgiven", "Malor the Zealous", "Cannon Master Willey", "Archivist Galford"]},
          {"name": "Stratholme - Undead", "enter": "Stratholme - Entering Back Door", "bosses": ["Baroness Anastari", "Maleki the Pallid", "Nerub'enkan", "Magistrate Barthilas", "Baron Rivendare"]}],
    469: [{"name": "Blackwing Lair", "bosses": ["Razorgore the Untamed", "Vaelastrasz the Corrupt", "Broodlord Lashlayer", "Firemaw", "Ebonroc", "Flamegor", "Chromaggus"]}],
    531: [{"name": "Temple of Ahn'Qiraj", "bosses": ["The Prophet Skeram", "Vem", "Battleguard Sartura", "Fankriss the Unyielding", "Viscidus", "Princess Huhuran", "Emperor Vek'nilash", "C'Thun"]}],
    533: [{"name": "Naxxramas", "enter": "Naxxramas (Exit)", "bosses": ["Anub'Rekhan", "Grand Widow Faerlina", "Maexxna", "Noth the Plaguebringer", "Heigan the Unclean", "Loatheb",
                                                                     "Instructor Razuvious", "Gothik the Harvester", "Patchwerk", "Grobbulus", "Gluth", "Thaddius", "Kel'Thuzad"]}],
}
ROUTE_WIDTH = 14          # yards on each side of the route that stay walkable


def spot_graph(pts):
    """creature / object spots as a walking graph: close neighbours (height included), pieces joined at their closest pair"""
    from scipy.spatial import cKDTree
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    P = np.array(pts, float)
    t = cKDTree(P[:, :2])
    rows, cols, ws = [], [], []
    for i, nb in enumerate(t.query_ball_point(P[:, :2], 22)):
        cand = []
        for j in nb:
            if j == i:
                continue
            dd = math.hypot(P[j, 0] - P[i, 0], P[j, 1] - P[i, 1]); dz = abs(P[j, 2] - P[i, 2])
            if dz <= max(4, dd * 0.7):
                cand.append((dd + dz * 1.5, j))
        for w, j in sorted(cand)[:8]:
            rows.append(i); cols.append(j); ws.append(w)
    n = len(P)
    for _ in range(80):
        g = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n))
        nc, lab = connected_components(g, directed=False)
        if nc <= 1:
            break
        main_ = np.bincount(lab).argmax()
        joined = False
        for k in range(nc):
            if k == main_:
                continue
            a = np.nonzero(lab == k)[0]; b = np.nonzero(lab != k)[0]
            tb = cKDTree(P[b, :2]); d_, j_ = tb.query(P[a, :2])
            dz = np.abs(P[a, 2] - P[b[j_], 2]); cost = d_ + dz * 0.8
            i = int(np.argmin(cost))
            if cost[i] < 600:          # far pieces: teleporters (Naxxramas, AQ40)
                rows.append(int(a[i])); cols.append(int(b[j_[i]])); ws.append(float(cost[i]) * 1.5); joined = True
        if not joined:
            break
    from scipy.sparse import csr_matrix
    return csr_matrix((ws + ws, (rows + cols, cols + rows)), shape=(n, n))




def make_routes(d, P):
    from scipy.sparse.csgraph import dijkstra
    plan = ROUTES.get(d["map"])
    if not plan:
        return []
    G = spot_graph(P)
    A = np.array(P, float)

    def nearest(x, y, z):
        dd = np.hypot(A[:, 0] - x, A[:, 1] - y) + np.abs(A[:, 2] - (z if z is not None else A[:, 2])) * 2
        return int(np.argmin(dd))
    out = []
    for r in plan:
        ent = next((e for e in d["enter"] if r.get("enter") and e["name"] == r["enter"]), d["enter"][0])
        cur = nearest(ent["x"], ent["y"], ent.get("z"))
        path, stops, jumps = [cur], [], []
        for bn in r["bosses"]:
            b = next((x for x in d["bosses"] if x["n"] == bn), None)
            if not b:
                print("   no boss", bn)
                continue
            tgt = nearest(b["x"], b["y"], b.get("z"))
            dist, pred = dijkstra(G, indices=cur, return_predecessors=True)
            if not np.isfinite(dist[tgt]):          # a teleporter (Kel'Thuzad's lair): the run jumps there
                print("   teleport to", bn)
                jumps.append(len(path))
                path.append(tgt)
                stops.append([bn, len(path) - 1])
                cur = tgt
                continue
            chain = []
            v = tgt
            while v != cur and v >= 0:
                chain.append(int(v))
                v = pred[v]
            path += chain[::-1]
            stops.append([bn, len(path) - 1])
            cur = tgt
        # thin the line: points 4+ yards apart, and corners kept
        pts = [A[path[0]]]
        keep = {0}
        for k in range(1, len(path)):
            q = A[path[k]]
            is_stop = any(s[1] == k for s in stops)
            if is_stop or k in jumps or k == len(path) - 1 or math.hypot(q[0] - pts[-1][0], q[1] - pts[-1][1]) >= 4 or abs(q[2] - pts[-1][2]) > 3:
                pts.append(q)
                keep.add(k)
        remap = {}
        n = 0
        for k in range(len(path)):
            if k in keep:
                remap[k] = n
                n += 1
        out.append({"name": r["name"], "path": [[round(float(p[0]), 1), round(float(p[1]), 1), round(float(p[2]), 1)] for p in pts],
                    "stops": [[bn, remap[k]] for bn, k in stops], "jumps": [remap[k] for k in jumps]})
    return out


def main():
    dg = json.load(open(os.path.join(ROOT, "gamedata", "dungeons.json"), encoding="utf-8"))["dungeons"]
    spawns = json.load(open(os.path.join(ROOT, "gamedata", "spawns.json"), encoding="utf-8"))["spawns"]
    ob = json.load(open(os.path.join(ROOT, "gamedata", "objects.json"), encoding="utf-8"))
    objects = ob.get("objects", ob)
    out = {}
    for d in dg:
        rs = make_routes(d, spots_of(d, spawns, objects))
        if rs:
            out[str(d["map"])] = rs
        print("%-28s %s" % (d["name"], ", ".join("%s: %d bosses, %d yd" % (r["name"], len(r["stops"]),
              sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(r["path"], r["path"][1:]))) for r in rs)))
    with open(os.path.join(ROOT, "gamedata", "dungeon_routes.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("gamedata/dungeon_routes.json written")


if __name__ == "__main__":
    main()
