# -*- coding: utf-8 -*-
"""
Mob map: every creature spawn plotted on the explored zone / continent maps.

Writes   C:\\wow excel\\mobmap.html            <- open this in your browser
         C:\\wow excel\\gamedata\\mobmap_data.js   (the data, loaded by the html)

In the viewer: pick a map, search a mob by name, filter by level / rank / role / type,
colour by level, rank or type, hover for details, click a dot to show only that mob,
"Save PNG" exports the current picture.

Needs wow_common.py next to it, the DBC files (WorldMapArea, AreaTable) and the map PNGs
from extract_maps.py (C:\\wow excel\\maps).   Run:  py wow_mobmap.py
"""
import json
import os
import re
import struct

from wow_common import *   # noqa

MAPS_DIR = os.path.join(OUT_FOLDER, "maps")
DATA_JS = os.path.join(OUT_FOLDER, "gamedata", "mobmap_data.js")
HTML = os.path.join(OUT_FOLDER, "mobmap.html")
CONTINENTS = {"Azeroth": "Eastern Kingdoms", "Kalimdor": "Kalimdor"}


def safe(name):
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "unnamed"


def f32(v):
    return struct.unpack("<f", struct.pack("<I", v))[0]


def load_maps():
    """[{name, file, map, top, bottom, left, right}]  (world coordinate bounds of each map picture)"""
    wma = load_dbc("WorldMapArea")
    at = load_dbc("AreaTable")
    if not wma:
        raise RuntimeError("WorldMapArea.dbc missing - run extract_dbc_multi.py")
    areas = {}
    if at:
        idx = at.find_field(12, "Elwynn Forest")
        areas = {r[0]: at.s(r[idx if idx is not None else 11]) for r in at.rows}
    votes = {}
    for r in wma.rows:
        for i in range(1, wma.fc):
            t = wma.s(r[i])
            if t and re.match(r"^[A-Za-z0-9_' ]+$", t):
                votes[i] = votes.get(i, 0) + 1
    dir_idx = max(votes, key=votes.get) if votes else 3
    out = []
    for r in wma.rows:
        folder = wma.s(r[dir_idx])
        if r[2] == 0:
            name = CONTINENTS.get(folder)
            if not name:
                continue
        else:
            name = areas.get(r[2]) or folder
        file_ = os.path.join(MAPS_DIR, safe(name) + ".png")
        if not os.path.exists(file_):
            log("  (no picture for %s - skipped)" % name)
            continue
        # bounds: y-left, y-right, x-top, x-bottom  (world y runs east->west, x south->north)
        yl, yr, xt, xb = (f32(r[4 + k]) for k in range(4))
        out.append({"name": name, "file": "maps/" + safe(name) + ".png", "map": r[1], "area": r[2],
                    "yl": yl, "yr": yr, "xt": xt, "xb": xb, "cont": r[2] == 0})
    out.sort(key=lambda m: (not m["cont"], m["map"], m["name"]))
    return out


def main():
    log("Connecting to database ...")
    conn = connect()
    cur = conn.cursor()
    maps = load_maps()
    log("  maps with pictures: %d" % len(maps))
    mids = sorted(set(m["map"] for m in maps))
    tc = columns(cur, "creature_template")
    cur.execute("SELECT * FROM creature_template")
    tpl = {g(r, tc, "entry"): r for r in cur.fetchall()}
    spawns = {}
    cur.execute("SELECT id, map, position_x x, position_y y FROM creature WHERE id <> 0")
    for r in cur.fetchall():
        spawns.setdefault(r["id"], []).append((r["map"], r["x"], r["y"]))
    if table_exists(cur, "creature_spawn_entry"):
        cur.execute("SELECT s.entry id, c.map, c.position_x x, c.position_y y FROM creature_spawn_entry s "
                    "JOIN creature c ON c.guid = s.guid")
        for r in cur.fetchall():
            spawns.setdefault(r["id"], []).append((r["map"], r["x"], r["y"]))
    mobs = []
    for entry, sp in spawns.items():
        t = tpl.get(entry)
        if not t:
            continue
        sp = [s for s in sp if s[0] in mids]
        if not sp:
            continue
        flat = []
        for mp, x, y in sp:
            flat += [mp, round(float(x), 1), round(float(y), 1)]
        mobs.append([entry, g(t, tc, "name", ""), g(t, tc, "minlevel"), g(t, tc, "maxlevel"), g(t, tc, "rank"),
                     g(t, tc, "creaturetype"), g(t, tc, "npcflags"), g(t, tc, "family"), flat])
    mobs.sort(key=lambda m: m[1])
    log("  creatures with spawns on those maps: %d" % len(mobs))
    objs = []
    try:
        cur.execute("SELECT entry, name, type FROM gameobject_template WHERE type IN (3, 25)")
        gt = {r["entry"]: r for r in cur.fetchall()}
        gsp = {}
        cur.execute("SELECT id, map, position_x x, position_y y FROM gameobject")
        for r in cur.fetchall():
            gsp.setdefault(r["id"], []).append((r["map"], r["x"], r["y"]))
        for e, sp in gsp.items():
            t = gt.get(e)
            sp = [s for s in sp if s[0] in mids]
            if t and sp:
                flat = []
                for mp, x, y in sp:
                    flat += [mp, round(float(x), 1), round(float(y), 1)]
                objs.append([e, t["name"], t["type"], flat])
        objs.sort(key=lambda o: o[1])
        log("  objects (nodes, chests, fishing): %d" % len(objs))
    except Exception as exc:
        log("  (objects skipped: %s)" % exc)
    grave = []
    try:
        ws = columns(cur, "world_safe_locs")

        def fc(*c):
            for k in c:
                if k in ws:
                    return ws[k]
            for k, v in ws.items():
                if c[-1] in k:
                    return v
        idc, mc, xc, yc, nc = fc("id"), fc("map", "mapid"), fc("loc_x", "x", "positionx"), \
            fc("loc_y", "y", "positiony"), fc("name", "comment")
        cur.execute("SELECT * FROM world_safe_locs")
        for r in cur.fetchall():
            if r[mc] in mids:
                grave.append([r[idc], (r[nc] if nc else "") or "Graveyard", r[mc], round(float(r[xc]), 1), round(float(r[yc]), 1)])
        log("  graveyards: %d" % len(grave))
    except Exception as exc:
        log("  (graveyards skipped: %s)" % exc)
    conn.close()
    try:
        os.makedirs(os.path.dirname(DATA_JS))
    except OSError:
        pass
    with open(DATA_JS, "w") as f:
        f.write("const DATA=" + json.dumps({"maps": maps, "mobs": mobs, "objects": objs, "graveyards": grave},
                                           separators=(",", ":")) + ";")
    with open(HTML, "w", encoding="utf-8") as f:
        f.write(PAGE)
    log("Done.  Open  %s  in your browser." % HTML)


PAGE = r"""<!doctype html><html><head><meta charset="utf-8"><title>WoW Classic mob map</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#10131a;color:#ddd;font:13px Segoe UI,Arial,sans-serif;display:flex;height:100vh}
#side{width:300px;padding:10px;overflow:auto;background:#161b27;border-right:1px solid #2c3550;flex:none}
#main{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;position:relative}
h1{font-size:16px;margin:0 0 8px}label{display:block;margin:8px 0 2px;color:#9ab}select,input[type=text],input[type=number]{width:100%;background:#0e1118;color:#ddd;border:1px solid #3a4560;padding:5px;border-radius:3px}
input[type=number]{width:70px}.row{display:flex;gap:8px;align-items:center}.chk label{display:inline-block;margin:3px 10px 0 0;color:#ddd}
button{background:#2a3550;color:#ddd;border:1px solid #46567c;padding:6px 10px;border-radius:3px;cursor:pointer;margin:4px 4px 0 0}button:hover{background:#3a4a70}
#list{margin-top:8px;max-height:260px;overflow:auto;border:1px solid #2c3550;border-radius:3px}#list div{padding:3px 6px;cursor:pointer;border-bottom:1px solid #1d2438}#list div:hover{background:#25304a}
#list small{color:#8a9}#cv{max-width:100%;max-height:100%;border:1px solid #2c3550;cursor:crosshair}
#tip{position:fixed;display:none;background:#0a0c12ee;border:1px solid #888;border-radius:4px;padding:6px 8px;pointer-events:none;z-index:9;font-size:12px}
#stat{margin:8px 0;color:#9ab}.leg span{display:inline-block;width:10px;height:10px;border-radius:5px;margin:0 3px 0 8px}
</style></head><body>
<div id="side"><h1>Mob map</h1>
<label>Map</label><select id="map"></select>
<label>Search name</label><input type="text" id="q" placeholder="e.g. boar, Hogger, Defias">
<div class="row"><div><label>Level from</label><input type="number" id="lmin" value="1" min="1" max="63"></div><div><label>to</label><input type="number" id="lmax" value="63" min="1" max="63"></div></div>
<label>Show</label><select id="role"><option value="combat">Hostile creatures</option><option value="all">Everything</option><option value="critter">Critters</option><option value="2">Quest givers</option><option value="4">Vendors</option><option value="16">Trainers</option><option value="8">Flight masters</option><option value="128">Innkeepers</option><option value="256">Bankers</option><option value="4096">Auctioneers</option><option value="2048">Battlemasters</option><option value="8192">Stable masters</option><option value="16384">Repairs</option></select>
<div class="chk"><label><input type="checkbox" class="rk" value="0" checked> Normal</label><label><input type="checkbox" class="rk" value="1" checked> Elite</label><label><input type="checkbox" class="rk" value="2" checked> Rare elite</label><label><input type="checkbox" class="rk" value="3" checked> Boss</label><label><input type="checkbox" class="rk" value="4" checked> Rare</label></div>
<div class="chk"><label><input type="checkbox" id="obj"> Nodes / chests / fishing</label><label><input type="checkbox" id="gy" checked> Graveyards</label></div>
<label>Colour by</label><select id="col"><option value="level">Level</option><option value="rank">Rank</option><option value="type">Creature type</option></select>
<label>Dot size</label><input type="range" id="size" min="1" max="8" value="3" style="width:100%">
<div><button id="reset">Show all</button><button id="png">Save PNG</button></div>
<div id="stat"></div><div class="leg" id="leg"></div><div id="list"></div></div>
<div id="main"><canvas id="cv"></canvas></div><div id="tip"></div>
<script src="gamedata/mobmap_data.js"></script>
<script>
const TYPES={0:"-",1:"Beast",2:"Dragonkin",3:"Demon",4:"Elemental",5:"Giant",6:"Undead",7:"Humanoid",8:"Critter",9:"Mechanical",10:"Other",11:"Totem"};
const TCOL={1:"#c8a060",2:"#c060ff",3:"#ff4060",4:"#60c0ff",5:"#e08040",6:"#90e090",7:"#f0f0f0",8:"#aaaaaa",9:"#c0c0a0",10:"#808080",11:"#a0a0ff",0:"#808080"};
const RK=["Normal","Elite","Rare Elite","Boss","Rare"],RCOL=["#e8e8e8","#ffd040","#60b0ff","#ff3030","#b0b0ff"];
const $=id=>document.getElementById(id),cv=$("cv"),cx=cv.getContext("2d");
let img=new Image(),cur=null,pts=[],objpts=[],gypts=[],focus=-1,vis=[];
DATA.maps.forEach((m,i)=>{const o=document.createElement("option");o.value=i;o.textContent=(m.cont?"* ":"")+m.name;$("map").appendChild(o)});
function lvlColor(l){const h=Math.max(0,Math.min(120,120-(l-1)*120/59));return"hsl("+h+",90%,55%)"}
function build(){cur=DATA.maps[+$("map").value];img=new Image();img.onload=()=>{cv.width=img.width;cv.height=img.height;draw()};img.src=cur.file;
 const uv=(x,y)=>[(cur.yl-y)/(cur.yl-cur.yr),(cur.xt-x)/(cur.xt-cur.xb)];
 pts=[];DATA.mobs.forEach((m,i)=>{const f=m[8];for(let k=0;k<f.length;k+=3){if(f[k]!==cur.map)continue;const p=uv(f[k+1],f[k+2]);if(p[0]<0||p[0]>1||p[1]<0||p[1]>1)continue;pts.push([i,p[0],p[1],f[k+1],f[k+2]])}});
 objpts=[];DATA.objects.forEach((o,i)=>{const f=o[3];for(let k=0;k<f.length;k+=3){if(f[k]!==cur.map)continue;const p=uv(f[k+1],f[k+2]);if(p[0]<0||p[0]>1||p[1]<0||p[1]>1)continue;objpts.push([i,p[0],p[1]])}});
 gypts=[];DATA.graveyards.forEach((g,i)=>{if(g[2]!==cur.map)return;const p=uv(g[3],g[4]);if(p[0]<0||p[0]>1||p[1]<0||p[1]>1)return;gypts.push([i,p[0],p[1]])});
 focus=-1;refreshList();}
function pass(m){const lo=+$("lmin").value,hi=+$("lmax").value;if(m[3]<lo||m[2]>hi)return false;
 if(!document.querySelector('.rk[value="'+m[4]+'"]').checked)return false;
 const r=$("role").value,fl=m[6],t=m[5];
 if(r==="combat"){if((fl&~1)!==0||t===8||t===11)return false}else if(r==="critter"){if(t!==8)return false}else if(r!=="all"){if(!(fl&+r))return false}
 const q=$("q").value.trim().toLowerCase();if(q&&m[1].toLowerCase().indexOf(q)<0)return false;return true}
function color(m){const c=$("col").value;if(c==="level")return lvlColor((m[2]+m[3])/2);if(c==="rank")return RCOL[m[4]]||"#fff";return TCOL[m[5]]||"#888"}
function legend(){const c=$("col").value;let h="";if(c==="level")for(const l of[1,10,20,30,40,50,60])h+='<span style="background:'+lvlColor(l)+'"></span>'+l;
 else if(c==="rank")RK.forEach((r,i)=>h+='<span style="background:'+RCOL[i]+'"></span>'+r);else for(const t in TYPES)if(t>0)h+='<span style="background:'+TCOL[t]+'"></span>'+TYPES[t];$("leg").innerHTML=h}
function draw(){if(!cur||!img.width)return;cx.drawImage(img,0,0);cx.fillStyle="rgba(0,0,0,.25)";cx.fillRect(0,0,cv.width,cv.height);
 const sz=+$("size").value,W=cv.width,H=cv.height;vis=[];let n=0;const ok={};
 for(const p of pts){const m=DATA.mobs[p[0]];if(ok[p[0]]===undefined)ok[p[0]]=pass(m);if(!ok[p[0]])continue;if(focus>=0&&p[0]!==focus)continue;
  cx.fillStyle=color(m);cx.beginPath();cx.arc(p[1]*W,p[2]*H,sz,0,6.283);cx.fill();cx.strokeStyle="rgba(0,0,0,.6)";cx.lineWidth=.8;cx.stroke();vis.push(p);n++}
 if($("obj").checked){const q=$("q").value.trim().toLowerCase();for(const p of objpts){const o=DATA.objects[p[0]];if(q&&o[1].toLowerCase().indexOf(q)<0)continue;
  cx.fillStyle=o[2]===25?"#40e0ff":"#ffe000";cx.fillRect(p[1]*W-sz,p[2]*H-sz,sz*2,sz*2);cx.strokeStyle="#000";cx.strokeRect(p[1]*W-sz,p[2]*H-sz,sz*2,sz*2)}}
 if($("gy").checked)for(const p of gypts){cx.fillStyle="#fff";cx.font="bold "+(10+sz*2)+"px sans-serif";cx.fillText("\u271D",p[1]*W-6,p[2]*H+5)}
 $("stat").textContent=n+" spawn points shown"+(focus>=0?" (single mob)":"");legend()}
function refreshList(){const cnt={};for(const p of pts)cnt[p[0]]=(cnt[p[0]]||0)+1;const rows=[];
 for(const i in cnt){const m=DATA.mobs[i];if(pass(m))rows.push([m,i,cnt[i]])}rows.sort((a,b)=>a[0][1]<b[0][1]?-1:1);
 $("list").innerHTML="";rows.slice(0,200).forEach(r=>{const d=document.createElement("div");const m=r[0];
  d.innerHTML=m[1]+' <small>lvl '+(m[2]===m[3]?m[2]:m[2]+"-"+m[3])+' x'+r[2]+'</small>';d.onclick=()=>{focus=+r[1];draw()};$("list").appendChild(d)});
 if(rows.length>200){const d=document.createElement("div");d.innerHTML="<small>... "+(rows.length-200)+" more - narrow the search</small>";$("list").appendChild(d)}draw()}
["q","lmin","lmax","role","obj","gy","col","size"].forEach(id=>$(id).addEventListener("input",()=>{if(id==="size"||id==="col"||id==="obj"||id==="gy")draw();else{focus=-1;refreshList()}}));
document.querySelectorAll(".rk").forEach(e=>e.onchange=()=>{focus=-1;refreshList()});$("map").onchange=build;
$("reset").onclick=()=>{focus=-1;$("q").value="";draw();refreshList()};
$("png").onclick=()=>{const a=document.createElement("a");a.download=(cur?cur.name:"map")+"_mobs.png";a.href=cv.toDataURL("image/png");a.click()};
cv.addEventListener("mousemove",e=>{const r=cv.getBoundingClientRect(),sx=cv.width/r.width,x=(e.clientX-r.left)*sx,y=(e.clientY-r.top)*sx,W=cv.width,H=cv.height;
 let best=null,bd=(8*sx)**2;for(const p of vis){const dx=p[1]*W-x,dy=p[2]*H-y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=p}}
 const t=$("tip");if(!best){t.style.display="none";return}const m=DATA.mobs[best[0]];
 t.innerHTML="<b>"+m[1]+"</b><br>Level "+(m[2]===m[3]?m[2]:m[2]+"-"+m[3])+" "+RK[m[4]]+" "+(TYPES[m[5]]||"")+"<br>x "+best[3]+"  y "+best[4];
 t.style.display="block";t.style.left=Math.min(e.clientX+14,innerWidth-200)+"px";t.style.top=e.clientY+14+"px"});
cv.addEventListener("mouseleave",()=>$("tip").style.display="none");
cv.addEventListener("click",e=>{const t=$("tip");if(t.style.display==="block"){const r=cv.getBoundingClientRect(),sx=cv.width/r.width,x=(e.clientX-r.left)*sx,y=(e.clientY-r.top)*sx;
 let best=null,bd=(8*sx)**2;for(const p of vis){const dx=p[1]*cv.width-x,dy=p[2]*cv.height-y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=p}}if(best){focus=best[0];draw()}}});
build();
</script></body></html>"""


if __name__ == "__main__":
    run(main)
