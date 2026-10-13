# -*- coding: utf-8 -*-
"""
Extracts the game's user-interface art from the client:
  C:\\wow excel\\ui\\<same folders as in the game>\\*.png   all interface textures (converted from .blp)
  C:\\wow excel\\ui\\composed\\*.png                       frames that are stored in 4 pieces, put together
  C:\\wow excel\\ui\\FrameXML\\*.xml, *.lua                  the game's own UI layout files (exact positions / sizes)
  C:\\wow excel\\ui\\fonts\\*.ttf                           the game fonts
  C:\\wow excel\\ui\\index.html                            a gallery of everything - open it in your browser

Covers: character screen (PaperDoll), talent frame, bags, bank, merchant, quest log, spellbook,
tooltips, buttons, empty slot icons, bag icons, minimap, action bars, unit frames, chat, dialogs ...

Needs wow_common.py + extract_maps.py next to it, and  py -m pip install pillow mpyq
Run:  py extract_ui.py        (resumable - files that already exist are skipped)
"""
import os
import re
import traceback

from wow_common import *   # noqa

UI_DIR = os.path.join(OUT_FOLDER, "ui")

# interface folders to extract completely (lower-case, relative to Interface\)
TEXTURE_FOLDERS = [
    "paperdoll", "paperdollinfoframe", "characterframe", "talentframe", "bankframe", "containerframe",
    "buttons", "tooltips", "dialogframe", "framegeneral", "merchantframe", "questframe", "spellbook",
    "itemtextframe", "minimap", "mainmenubar", "chatframe", "targetingframe", "pvpframe", "friendsframe",
    "lootframe", "tradeframe", "mailframe", "auctionframe", "craftframe", "tradeskillframe",
    "trainerframe", "taxiframe", "gossipframe", "stationery", "worldmap", "raidframe", "petpaperdollframe",
    "petitionframe", "guildframe", "helpframe", "inspectframe", "macroframe", "optionsframe",
    "pvp", "cooldown", "unitpowerbaralt", "castingbar", "raidframe", "timemanager", "addons",
    "common", "calendar", "currencyframe", "scrollbar", "slider", "chatframe", "ctf",
]
# loose files in Interface\Icons that the UI needs
ICON_PATTERN = re.compile(r"^interface\\icons\\(inv_misc_bag_|inv_misc_questionmark|inv_box_|inv_misc_key_0|inv_misc_coin_|"
                          r"spell_nature_wispsplode|ability_dualwield|trade_|inv_misc_note_)", re.I)
FONTS = ["FRIZQT__.TTF", "ARIALN.TTF", "MORPHEUS.TTF", "SKURRI.TTF"]

# used only when the archives do not carry a (listfile)
FALLBACK = r"""
Interface\PaperDoll\UI-Backpack-EmptySlot.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Head.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Neck.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Shoulder.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Chest.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Waist.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Legs.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Feet.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Wrists.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Hands.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Finger.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Trinket.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Chest.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Shirt.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Tabard.blp
Interface\PaperDoll\UI-PaperDoll-Slot-MainHand.blp
Interface\PaperDoll\UI-PaperDoll-Slot-SecondaryHand.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Ranged.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Relic.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Bag.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Reagent.blp
Interface\PaperDoll\UI-PaperDoll-Slot-Ammo.blp
Interface\Buttons\UI-EmptySlot.blp
Interface\Buttons\UI-EmptySlot-Disabled.blp
Interface\Buttons\UI-Quickslot2.blp
Interface\Buttons\UI-Quickslot.blp
Interface\Buttons\UI-Quickslot-Depress.blp
Interface\Buttons\ButtonHilight-Square.blp
Interface\Buttons\UI-ActionButton-Border.blp
Interface\Buttons\UI-Panel-Button-Up.blp
Interface\Buttons\UI-Panel-Button-Down.blp
Interface\Buttons\UI-Panel-Button-Highlight.blp
Interface\Buttons\UI-Panel-MinimizeButton-Up.blp
Interface\Buttons\UI-Panel-CloseButton-Up.blp
Interface\Buttons\UI-Panel-CloseButton-Down.blp
Interface\Buttons\UI-CheckBox-Up.blp
Interface\Buttons\UI-CheckBox-Check.blp
Interface\Buttons\UI-PlusButton-Up.blp
Interface\Buttons\UI-MinusButton-Up.blp
Interface\Buttons\UI-SpellbookIcon-NextPage-Up.blp
Interface\Buttons\UI-SpellbookIcon-PrevPage-Up.blp
Interface\Tooltips\UI-Tooltip-Background.blp
Interface\Tooltips\UI-Tooltip-Border.blp
Interface\DialogFrame\UI-DialogBox-Background.blp
Interface\DialogFrame\UI-DialogBox-Border.blp
Interface\DialogFrame\UI-DialogBox-Header.blp
Interface\ContainerFrame\UI-Bag-1Slot.blp
Interface\ContainerFrame\UI-Bag-2Slot.blp
Interface\ContainerFrame\UI-Bag-4Slot.blp
Interface\ContainerFrame\UI-Bag-8Slot.blp
Interface\ContainerFrame\UI-Bag-12Slot.blp
Interface\ContainerFrame\UI-Bag-16Slot.blp
Interface\ContainerFrame\UI-Bag-20Slot.blp
Interface\ContainerFrame\UI-Bag-24Slot.blp
Interface\ContainerFrame\UI-Bag-28Slot.blp
Interface\ContainerFrame\UI-Bag-32Slot.blp
Interface\ContainerFrame\UI-Backpack-Background.blp
Interface\BankFrame\Bank-Background.blp
Interface\BankFrame\UI-BankFrame-TopLeft.blp
Interface\BankFrame\UI-BankFrame-TopRight.blp
Interface\BankFrame\UI-BankFrame-BotLeft.blp
Interface\BankFrame\UI-BankFrame-BotRight.blp
Interface\PaperDollInfoFrame\UI-Character-General-TopLeft.blp
Interface\PaperDollInfoFrame\UI-Character-General-TopRight.blp
Interface\PaperDollInfoFrame\UI-Character-General-BottomLeft.blp
Interface\PaperDollInfoFrame\UI-Character-General-BottomRight.blp
Interface\PaperDollInfoFrame\UI-Character-CharacterTab-L1.blp
Interface\TalentFrame\UI-TalentFrame-TopLeft.blp
Interface\TalentFrame\UI-TalentFrame-TopRight.blp
Interface\TalentFrame\UI-TalentFrame-BotLeft.blp
Interface\TalentFrame\UI-TalentFrame-BotRight.blp
Interface\TalentFrame\UI-TalentBranches.blp
Interface\TalentFrame\UI-TalentArrows.blp
Interface\TalentFrame\UI-TalentFrame-Border.blp
Interface\Minimap\UI-Minimap-Border.blp
Interface\Minimap\UI-Minimap-Background.blp
"""
FRAMEXML = r"""
Interface\FrameXML\FrameXML.toc
Interface\FrameXML\PaperDollFrame.xml
Interface\FrameXML\PaperDollFrame.lua
Interface\FrameXML\TalentFrame.xml
Interface\FrameXML\TalentFrame.lua
Interface\FrameXML\ContainerFrame.xml
Interface\FrameXML\ContainerFrame.lua
Interface\FrameXML\BankFrame.xml
Interface\FrameXML\BankFrame.lua
Interface\FrameXML\CharacterFrame.xml
Interface\FrameXML\CharacterFrame.lua
Interface\FrameXML\ItemButtonTemplate.xml
Interface\FrameXML\UIPanelTemplates.xml
Interface\FrameXML\UIPanelTemplates.lua
Interface\FrameXML\GameTooltip.xml
Interface\FrameXML\Fonts.xml
Interface\FrameXML\UIParent.lua
Interface\FrameXML\UIParent.xml
Interface\FrameXML\MainMenuBar.xml
Interface\FrameXML\MainMenuBar.lua
Interface\FrameXML\MerchantFrame.xml
Interface\FrameXML\QuestLogFrame.xml
Interface\FrameXML\SpellBookFrame.xml
Interface\FrameXML\TargetFrame.xml
Interface\FrameXML\PlayerFrame.xml
Interface\FrameXML\ActionButtonTemplate.xml
Interface\FrameXML\ChatFrame.xml
Interface\FrameXML\Minimap.xml
Interface\FrameXML\WorldMapFrame.xml
Interface\FrameXML\GlobalStrings.lua
Interface\FrameXML\Localization.lua
"""


def archive_names(arc):
    """names from the archive's (listfile), if it has one"""
    try:
        data = arc.read_file("(listfile)")
    except Exception:
        data = None
    if not data:
        return []
    return [l.strip() for l in data.decode("latin-1", "ignore").replace("\r", "").split("\n") if l.strip()]


def wanted(name):
    low = name.lower().replace("/", "\\")
    if not low.startswith("interface\\"):
        return None
    if low.startswith("interface\\framexml\\"):
        return "text" if low.endswith((".xml", ".lua", ".toc", ".xsd")) else None
    if low.endswith(".blp"):
        rest = low[len("interface\\"):]
        top = rest.split("\\")[0]
        if top in TEXTURE_FOLDERS or ICON_PATTERN.match(low):
            return "blp"
    return None


def read_first(archives, name):
    for _, arc in archives:
        try:
            data = arc.read_file(name)
        except Exception:
            data = None
        if data:
            return data
    return None


def out_path(name, ext=None):
    parts = name.replace("/", "\\").split("\\")
    p = os.path.join(UI_DIR, *parts[1:]) if parts[0].lower() == "interface" else os.path.join(UI_DIR, *parts)
    if ext:
        p = os.path.splitext(p)[0] + ext
    return p


def convert(data, path):
    from PIL import Image
    import io
    im = Image.open(io.BytesIO(data))
    im.load()
    im.convert("RGBA").save(path)
    return im.size


SUFFIXES = [("-topleft", "-topright", "-botleft", "-botright"),
            ("-topleft", "-topright", "-bottomleft", "-bottomright"),
            ("-top-left", "-top-right", "-bottom-left", "-bottom-right")]


def compose_all():
    from PIL import Image
    made = []
    outdir = os.path.join(UI_DIR, "composed")
    try:
        os.makedirs(outdir)
    except OSError:
        pass
    for root, dirs, files in os.walk(UI_DIR):
        if root.startswith(outdir):
            continue
        low = {f.lower(): f for f in files}
        for f in files:
            l = f.lower()
            for tl, tr, bl, br in SUFFIXES:
                if not l.endswith(tl + ".png"):
                    continue
                base = l[:-len(tl + ".png")]
                parts = [low.get(base + s + ".png") for s in (tl, tr, bl, br)]
                if not all(parts):
                    continue
                name = os.path.relpath(root, UI_DIR).replace(os.sep, "_") + "__" + f[:-len(tl + ".png")] + ".png"
                dst = os.path.join(outdir, name)
                try:
                    ims = [Image.open(os.path.join(root, p)).convert("RGBA") for p in parts]
                    w = ims[0].width + ims[1].width
                    h = ims[0].height + ims[2].height
                    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
                    canvas.paste(ims[0], (0, 0))
                    canvas.paste(ims[1], (ims[0].width, 0))
                    canvas.paste(ims[2], (0, ims[0].height))
                    canvas.paste(ims[3], (ims[0].width, ims[0].height))
                    canvas.save(dst)
                    made.append(name)
                except Exception:
                    traceback.print_exc()
    return made


def gallery(files):
    groups = {}
    for p in files:
        rel = os.path.relpath(p, UI_DIR).replace(os.sep, "/")
        groups.setdefault(rel.rsplit("/", 1)[0] if "/" in rel else ".", []).append(rel)
    h = ['<!doctype html><meta charset="utf-8"><title>WoW UI files</title><style>body{background:#1b1b1f;color:#ddd;font:12px Arial;margin:10px}'
         'h2{margin:18px 0 4px;color:#f0c040}.i{display:inline-block;width:150px;margin:4px;vertical-align:top;text-align:center}'
         '.i div{background:#000 repeating-conic-gradient(#333 0 25%,#222 0 50%) 0 0/16px 16px;height:128px;display:flex;align-items:center;justify-content:center}'
         '.i img{max-width:146px;max-height:124px}.i span{word-break:break-all;color:#999;font-size:10px}</style>'
         '<h1>WoW 1.12 interface files (' + str(len(files)) + ')</h1>']
    for g_ in sorted(groups):
        h.append("<h2>%s (%d)</h2>" % (g_, len(groups[g_])))
        for rel in sorted(groups[g_]):
            h.append('<div class="i"><div><img loading="lazy" src="%s"></div><span>%s</span></div>' % (rel, rel.rsplit("/", 1)[-1]))
    with open(os.path.join(UI_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write("\n".join(h))


def main():
    import extract_maps
    try:
        os.makedirs(UI_DIR)
    except OSError:
        pass
    log("Opening game archives ...")
    archives = extract_maps.open_archives()
    # archives that open_archives() skips on purpose, but we need for fonts
    from mpyq import MPQArchive
    fonts_arc = []
    for f in os.listdir(CLIENT_DATA):
        if f.lower() in ("fonts.mpq", "interface.mpq", "misc.mpq"):
            try:
                if f.lower() not in [n.lower() for n, _ in archives]:
                    fonts_arc.append((f, MPQArchive(os.path.join(CLIENT_DATA, f), listfile=False)))
            except Exception as exc:
                log("  could not open %s: %s" % (f, str(exc)[:80]))
    allarc = archives + fonts_arc

    names = {}
    for an, arc in allarc:
        for n in archive_names(arc):
            k = wanted(n)
            if k and n.lower() not in names:
                names[n.lower()] = (n, k)
    log("Files found through the archive file lists: %d" % len(names))
    for block in (FALLBACK, FRAMEXML):
        for n in block.split():
            if n.lower() not in names:
                names[n.lower()] = (n, "text" if n.lower().endswith((".xml", ".lua", ".toc")) else "blp")
    log("Files to extract (with built-in list): %d" % len(names))

    done = fail = skip = 0
    produced = []
    for i, (low, (name, kind)) in enumerate(sorted(names.items()), 1):
        dst = out_path(name, ".png" if kind == "blp" else None)
        if os.path.exists(dst):
            skip += 1
            if kind == "blp":
                produced.append(dst)
            continue
        data = read_first(allarc, name)
        if not data:
            fail += 1
            continue
        try:
            os.makedirs(os.path.dirname(dst))
        except OSError:
            pass
        try:
            if kind == "blp":
                convert(data, dst)
                produced.append(dst)
            else:
                with open(dst, "wb") as f:
                    f.write(data)
            done += 1
        except Exception:
            fail += 1
        if i % 300 == 0:
            log("  %d / %d" % (i, len(names)))
    log("Extracted %d, already there %d, not in the game files %d" % (done, skip, fail))

    log("Fonts ...")
    try:
        os.makedirs(os.path.join(UI_DIR, "fonts"))
    except OSError:
        pass
    for fn in FONTS:
        dst = os.path.join(UI_DIR, "fonts", fn)
        if os.path.exists(dst):
            continue
        data = read_first(allarc, "Fonts\\" + fn)
        if data:
            with open(dst, "wb") as f:
                f.write(data)
            log("  " + fn)
        else:
            log("  (not found: %s)" % fn)

    log("Putting 4-piece frames together ...")
    made = compose_all()
    log("  composed frames: %d" % len(made))
    for n in made[:40]:
        log("    " + n)
    comp = [os.path.join(UI_DIR, "composed", n) for n in made]
    gallery(produced + comp)
    log("Done.  Open  %s  in your browser to see everything." % os.path.join(UI_DIR, "index.html"))


if __name__ == "__main__":
    run(main)
