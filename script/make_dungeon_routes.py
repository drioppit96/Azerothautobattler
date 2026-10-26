"""make_dungeon_routes.py - the way groups take through every dungeon and raid, as the guides describe it:
the bosses in the guides' order (icy-veins, warcrafttavern, almarsguides), the way between them along the spots where
creatures and objects stand (stairs and ramps included). Runs follow these lines (a little to either side); there are
no walls.

Writes gamedata/dungeon_routes.json: {"<map>": [{"name", "path": [[x, y, z], ...], "stops": [[boss, index], ...]}]}
(hand-drawn dungeons: one route per "tier" - the tank's knowledge of the place decides which one a run takes)

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


# hand-drawn routes (waypoints clicked on the map in the game): the start everyone takes, then one way on for each
# level of the tank's knowledge of the place - "fast" (knows it: the short way), "mid" (more or less: around the
# loop, more packs), "slow" (does not: room by room, everything, walking back where it is a dead end). The run picks
# the way by the tank's knowledge when it goes in (pullplan.js), and only that one is drawn.
# Points are [x, y] (the height comes from the creatures standing near) or [x, y, z].
RFC_JERGOSH_ON = [[-373.4, 207.2], [-388.1, 259.8, -4.8], [-388.6, 241.9, -4.8], [-400.4, 216.2, -1.0], [-408.6, 179.4, 6.7], [-396.3, 150.8, 7.8], [-384.9, 146.0, 7.8]]
HAND_ROUTES = {
    43: {
        "name": "Wailing Caverns",
        "bosses": ["Lord Cobrahn", "Kresh", "Lord Pythas", "Skum", "Lord Serpentis", "Verdan the Everliving"],
        # the usual way (icy-veins, warcrafttavern, almarsguides): up into the river cavern, Lady Anacondra on the top
        # level, west along the river to Lord Cobrahn, jump down and swim back east past Kresh, east through the caves
        # to Lord Pythas and on to Skum, back to Lord Serpentis and Verdan the Everliving, then the jump into the
        # river and back to the entrance. Worked out on the walls of maps_dungeon/walls/WailingCaverns1.png
        # (shortest ways over the cave floor, between the places in this order).
        "common": [],
        "tier_bosses": {"fast": ["Lord Cobrahn", "Kresh", "Lord Pythas", "Lord Serpentis", "Verdan the Everliving"]},
        "tiers": {
            # knows it: the bosses that matter, Skum (optional, out of the way) left alone
            "fast": [[-157.8, 132.5], [-137.2, 130.6], [-116.7, 149.3], [-111.1, 169.9], [-90.5, 190.4], [-70.0, 207.2], [-49.4, 211.0], [-30.7, 231.5], [-30.7, 252.1], [-51.3, 272.7], [-55.0, 293.2], [-60.6, 313.8], [-73.7, 334.4], [-70.0, 354.9], [-73.7, 375.5], [-83.0, 396.0], [-103.6, 414.7], [-124.2, 414.7], [-144.7, 414.7], [-135.4, 414.7], [-114.8, 414.7], [-94.3, 407.3], [-75.6, 386.7], [-70.0, 366.1], [-73.7, 345.6], [-70.0, 325.0], [-51.3, 304.4], [-30.7, 283.9], [-25.1, 263.3], [-25.1, 242.8], [-25.1, 222.2], [-25.1, 201.6], [-25.1, 181.1], [-25.1, 160.5], [-27.0, 140.0], [-45.7, 119.4], [-53.1, 98.8], [-58.7, 78.3], [-70.0, 57.7], [-90.5, 37.1], [-111.1, 16.6], [-131.6, -4.0], [-152.2, -24.5], [-157.8, -45.1], [-167.2, -65.7], [-167.2, -86.2], [-146.6, -103.0], [-126.0, -103.0], [-105.5, -118.0], [-84.9, -129.2], [-64.3, -146.0], [-43.8, -166.6], [-23.2, -187.2], [-2.7, -207.7], [17.9, -228.3], [34.7, -241.4], [14.2, -224.5], [-6.4, -204.0], [-27.0, -183.4], [-47.5, -162.9], [-68.1, -142.3], [-88.6, -129.2], [-109.2, -114.3], [-129.8, -103.0], [-150.3, -103.0], [-165.3, -82.5], [-161.5, -61.9], [-141.0, -48.8], [-122.3, -33.9], [-112.9, -13.3], [-105.5, 7.2], [-84.9, 27.8], [-77.4, 48.4], [-62.5, 68.9], [-55.0, 89.5], [-47.5, 110.0], [-41.9, 130.6], [-41.9, 151.2], [-41.9, 171.7], [-51.3, 192.3], [-71.8, 199.8], [-92.4, 186.7], [-111.1, 166.1], [-120.4, 145.6], [-141.0, 130.6], [-157.8, 132.5]],
            # more or less: the whole usual route with Skum
            "mid": [[-157.8, 132.5], [-137.2, 130.6], [-116.7, 149.3], [-111.1, 169.9], [-90.5, 190.4], [-70.0, 207.2], [-49.4, 211.0], [-30.7, 231.5], [-30.7, 252.1], [-51.3, 272.7], [-55.0, 293.2], [-60.6, 313.8], [-73.7, 334.4], [-70.0, 354.9], [-73.7, 375.5], [-83.0, 396.0], [-103.6, 414.7], [-124.2, 414.7], [-144.7, 414.7], [-135.4, 414.7], [-114.8, 414.7], [-94.3, 407.3], [-75.6, 386.7], [-70.0, 366.1], [-73.7, 345.6], [-70.0, 325.0], [-51.3, 304.4], [-30.7, 283.9], [-25.1, 263.3], [-25.1, 242.8], [-25.1, 222.2], [-25.1, 201.6], [-25.1, 181.1], [-25.1, 160.5], [-27.0, 140.0], [-45.7, 119.4], [-53.1, 98.8], [-58.7, 78.3], [-70.0, 57.7], [-90.5, 37.1], [-111.1, 16.6], [-131.6, -4.0], [-152.2, -24.5], [-157.8, -45.1], [-167.2, -65.7], [-167.2, -86.2], [-146.6, -103.0], [-126.0, -103.0], [-105.5, -118.0], [-84.9, -129.2], [-64.3, -146.0], [-43.8, -166.6], [-23.2, -187.2], [-2.7, -207.7], [17.9, -228.3], [34.7, -243.2], [14.2, -243.2], [-6.4, -250.7], [-27.0, -252.6], [-47.5, -252.6], [-68.1, -252.6], [-88.6, -258.2], [-109.2, -260.1], [-129.8, -239.5], [-150.3, -228.3], [-170.9, -228.3], [-191.5, -248.8], [-212.0, -269.4], [-232.6, -290.0], [-253.1, -299.3], [-273.7, -310.5], [-271.8, -308.7], [-251.3, -299.3], [-230.7, -286.2], [-210.1, -265.7], [-189.6, -245.1], [-169.0, -224.5], [-148.5, -204.0], [-141.0, -183.4], [-126.0, -162.9], [-114.8, -159.1], [-109.2, -153.5], [-109.2, -133.0], [-116.7, -112.4], [-137.2, -103.0], [-157.8, -95.6], [-165.3, -75.0], [-154.1, -54.4], [-133.5, -47.0], [-118.6, -26.4], [-112.9, -5.8], [-98.0, 14.7], [-81.2, 35.3], [-70.0, 55.8], [-60.6, 76.4], [-53.1, 97.0], [-45.7, 117.5], [-41.9, 138.1], [-41.9, 158.6], [-41.9, 179.2], [-58.7, 199.8], [-79.3, 199.8], [-99.9, 179.2], [-111.1, 158.6], [-127.9, 138.1], [-148.5, 130.6], [-157.8, 132.5]],
            # does not: the whole western loop before Cobrahn, the Faerie Dragon's ring, the eastern caves and the
            # southern cave as well
            "slow": [[-157.8, 132.5], [-137.2, 130.6], [-116.7, 149.3], [-111.1, 169.9], [-90.5, 190.4], [-70.0, 207.2], [-49.4, 211.0], [-30.7, 231.5], [-30.7, 252.1], [-51.3, 272.7], [-55.0, 293.2], [-60.6, 313.8], [-73.7, 334.4], [-70.0, 354.9], [-70.0, 375.5], [-58.7, 396.0], [-38.2, 399.8], [-17.6, 399.8], [2.9, 399.8], [23.5, 399.8], [42.2, 390.4], [44.1, 407.3], [44.1, 422.2], [42.2, 424.1], [40.3, 425.9], [21.6, 446.5], [21.6, 467.1], [6.7, 457.7], [-13.9, 444.6], [-34.4, 424.1], [-55.0, 420.3], [-75.6, 420.3], [-96.1, 420.3], [-116.7, 420.3], [-137.2, 414.7], [-142.9, 414.7], [-122.3, 414.7], [-101.7, 414.7], [-81.2, 394.2], [-71.8, 373.6], [-70.0, 353.0], [-73.7, 332.5], [-58.7, 311.9], [-38.2, 291.4], [-25.1, 270.8], [-25.1, 250.2], [-25.1, 229.7], [-25.1, 209.1], [-25.1, 188.6], [-25.1, 168.0], [-25.1, 147.4], [-38.2, 126.9], [-49.4, 106.3], [-56.9, 85.7], [-62.5, 65.2], [-83.0, 44.6], [-103.6, 24.1], [-124.2, 3.5], [-144.7, -17.1], [-157.8, -37.6], [-165.3, -58.2], [-167.2, -78.7], [-154.1, -99.3], [-133.5, -103.0], [-112.9, -110.5], [-92.4, -127.3], [-71.8, -127.3], [-51.3, -123.6], [-30.7, -103.0], [-10.1, -84.4], [4.8, -73.1], [8.6, -60.1], [8.6, -61.9], [4.8, -73.1], [-15.7, -91.8], [-25.1, -112.4], [-10.1, -131.1], [10.4, -142.3], [29.1, -161.0], [25.4, -181.6], [19.8, -202.1], [19.8, -222.7], [34.7, -241.4], [14.2, -224.5], [-6.4, -204.0], [-27.0, -183.4], [-47.5, -162.9], [-68.1, -142.3], [-88.6, -131.1], [-99.9, -140.4], [-112.9, -161.0], [-133.5, -170.3], [-142.9, -190.9], [-154.1, -211.5], [-174.6, -232.0], [-195.2, -252.6], [-206.4, -273.1], [-206.4, -293.7], [-206.4, -314.3], [-208.3, -318.0], [-228.8, -306.8], [-249.4, -306.8], [-270.0, -308.7], [-275.6, -303.1], [-266.2, -282.5], [-271.8, -261.9], [-279.3, -241.4], [-273.7, -220.8], [-270.0, -200.2], [-284.9, -179.7], [-305.5, -159.1], [-326.0, -142.3], [-339.1, -134.8], [-339.1, -114.3], [-339.1, -93.7], [-339.1, -73.1], [-326.0, -52.6], [-305.5, -32.0], [-284.9, -15.2], [-264.4, -15.2], [-243.8, -15.2], [-223.2, -15.2], [-202.7, -15.2], [-182.1, -15.2], [-161.5, -15.2], [-141.0, -15.2], [-120.4, -22.7], [-112.9, -5.8], [-98.0, 14.7], [-81.2, 35.3], [-70.0, 55.8], [-60.6, 76.4], [-53.1, 97.0], [-45.7, 117.5], [-41.9, 138.1], [-41.9, 158.6], [-41.9, 179.2], [-58.7, 199.8], [-79.3, 199.8], [-99.9, 179.2], [-111.1, 158.6], [-127.9, 138.1], [-148.5, 130.6], [-157.8, 132.5]],
        },
    },
    389: {
        "name": "Ragefire Chasm",
        "bosses": ["Oggleflint", "Taragaman the Hungerer", "Jergosh the Invoker", "Bazzalan"],
        # waypoints 1-15: down the troggs' corridor to its end, back up the other one past Oggleflint, through the
        # elementals' cave to the Searing Blade loop
        "common": [[0.8, -8.2, -15.5], [0.6, -24.7], [-16.5, -53.0], [-74.4, -38.5], [-130.6, -34.5], [-220.9, -37.0], [-275.6, -56.3], [-296.5, -50.9],
                   [-304.0, -12.0], [-284.3, 9.5], [-222.0, 10.1], [-156.9, 12.8, -40.0], [-122.7, 8.1, -30.0], [-98.8, 36.5], [-118.7, 70.1], [-199.4, 77.0]],
        "tiers": {
            # waypoints 15-21: through the middle of the loop past Taragaman, straight on to Jergosh
            "fast": [[-231.7, 91.9], [-271.9, 99.3], [-245.7, 159.0], [-293.1, 143.8], [-298.1, 215.3], [-354.5, 206.1]] + RFC_JERGOSH_ON,
            # around the right side of the loop, up the middle road to Taragaman, out along the left road and down
            "mid": [[-231.7, 91.9], [-271.9, 99.3], [-293.1, 143.8], [-283.7, 148.2], [-263.5, 150.5], [-245.7, 159.0], [-233.8, 192.0], [-228.3, 210.6],
                    [-280.1, 215.4], [-298.1, 215.3], [-312.9, 223.4], [-333.5, 217.0], [-354.5, 206.1]] + RFC_JERGOSH_ON,
            # every room: the right side, the middle road up to the top, the left side, the whole lake to Jergosh and
            # back, then the high ledge all the way round to Bazzalan
            "slow": [[-202.5, 99.0], [-231.7, 91.9], [-263.4, 98.4], [-271.9, 99.3], [-293.1, 143.8], [-283.7, 148.2], [-263.5, 150.5], [-245.7, 159.0],
                     [-220.0, 157.0], [-199.1, 155.1], [-185.6, 156.7], [-233.8, 192.0], [-228.3, 210.6], [-280.1, 215.4], [-298.0, 200.3], [-298.1, 215.3],
                     [-312.9, 223.4], [-333.5, 217.0], [-343.4, 210.8], [-354.5, 206.1], [-365.1, 177.7], [-373.4, 207.2], [-343.4, 210.8], [-312.9, 223.4],
                     [-298.1, 215.3], [-301.0, 251.0, -13.0], [-297.3, 253.9, -13.9], [-320.4, 252.1, -11.5], [-342.3, 256.4, -8.0], [-371.3, 256.4, -4.9],
                     [-388.1, 259.8, -4.8], [-388.6, 241.9, -4.8], [-400.4, 216.2, -1.0], [-408.6, 179.4, 6.7], [-396.3, 150.8, 7.8], [-384.9, 146.0, 7.8]],
        },
    },
}


def hand_routes(d, P):
    """the hand-drawn routes of a dungeon, one per tier: [{name, tier, path, stops, jumps}]"""
    h = HAND_ROUTES.get(d["map"])
    if not h:
        return []
    A = np.array(P, float)

    def with_z(pts):
        out = []
        prev = None
        for q in pts:
            if len(q) > 2:
                out.append([q[0], q[1], q[2]]); prev = q[2]; continue
            dd = np.hypot(A[:, 0] - q[0], A[:, 1] - q[1])
            near = np.nonzero(dd < 25)[0]
            if not len(near):
                near = np.array([int(np.argmin(dd))])
            score = dd[near] * 0.5 + (np.abs(A[near, 2] - prev) if prev is not None else 0)
            z = float(A[near[int(np.argmin(score))], 2])
            out.append([q[0], q[1], z]); prev = z
        return out
    rs = []
    for tier, tail in h["tiers"].items():
        path = with_z(h["common"] + tail)
        stops = []
        for bn in h.get("tier_bosses", {}).get(tier, h["bosses"]):
            b = next((x for x in d["bosses"] if x["n"] == bn), None)
            if not b:
                continue
            k = min(range(len(path)), key=lambda i: math.hypot(path[i][0] - b["x"], path[i][1] - b["y"]) + abs(path[i][2] - (b.get("z") or 0)))
            stops.append([bn, k])
        rs.append({"name": h["name"], "tier": tier, "path": [[round(p[0], 1), round(p[1], 1), round(p[2], 1)] for p in path], "stops": stops, "jumps": []})
    return rs


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
        P = spots_of(d, spawns, objects)
        rs = hand_routes(d, P) or make_routes(d, P)
        if rs:
            out[str(d["map"])] = rs
        print("%-28s %s" % (d["name"], ", ".join("%s%s: %d bosses, %d yd" % (r["name"], " (" + r["tier"] + ")" if r.get("tier") else "", len(r["stops"]),
              sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(r["path"], r["path"][1:]))) for r in rs)))
    with open(os.path.join(ROOT, "gamedata", "dungeon_routes.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("gamedata/dungeon_routes.json written")


if __name__ == "__main__":
    main()
