// catalog.js - reads the games/ and costumes/ folders and turns them into
// plain item lists for the Games and Marketplace pages.
//
// Layout on disk:
//   games/<game-id>/game.json           { "name": "...", "description": "..." }
//   costumes/<costume-id>/costume.json  { "name": "...", "description": "...", "price": 0 }
//
// A folder with no metadata file is skipped, so you can safely drop in
// work-in-progress folders. An empty (or missing) games/costumes folder
// just means an empty list - the pages handle that gracefully.

const fs = require("fs");
const path = require("path");

function readItems(rootDir, metaFileName) {
  if (!fs.existsSync(rootDir)) return [];

  const items = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const metaPath = path.join(rootDir, entry.name, metaFileName);
    if (!fs.existsSync(metaPath)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      // `folder` is always the real subfolder name, even if `id` was
      // overridden in the metadata file - callers that need to find the
      // actual files on disk (e.g. places) use this instead of `id`.
      items.push({ id: entry.name, ...meta, folder: entry.name });
    } catch {
      // Ignore folders with broken/unreadable metadata instead of crashing
      // the whole page.
    }
  }
  return items;
}

const GAME_ICON_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

// Finds the icon file for a game inside a directory: either <id>.<ext>
// (the "<name>.png next to <name>.exe" style) or icon.<ext>. Returns the
// file name (not the full path) or null.
function findGameIconFile(dir, id) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  for (const ext of GAME_ICON_EXTENSIONS) {
    const byName = lower.get(String(id).toLowerCase() + ext);
    if (byName) return byName;
  }
  for (const ext of GAME_ICON_EXTENSIONS) {
    const byIcon = lower.get("icon" + ext);
    if (byIcon) return byIcon;
  }
  return null;
}

// Reads the "who made this game" text: game.json's "author" field wins;
// otherwise a <id>.txt / author.txt / game.txt file sitting next to the
// game. Empty string when there's nothing.
function readGameAuthor(dir, id, meta) {
  if (meta && typeof meta.author === "string" && meta.author.trim()) {
    return meta.author.trim();
  }
  for (const name of [String(id) + ".txt", "author.txt", "game.txt"]) {
    try {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) {
        const text = fs.readFileSync(file, "utf8").trim();
        if (text) return text;
      }
    } catch {
      // unreadable file - just try the next one
    }
  }
  return "";
}

function listGames() {
  const gamesDir = path.join(__dirname, "games");
  const fromFolders = readItems(gamesDir, "game.json").map((game) => {
    const dir = path.join(gamesDir, game.folder);
    const iconFile = findGameIconFile(dir, game.id);
    return {
      ...game,
      author: readGameAuthor(dir, game.id, game),
      iconFile, // file name inside games/<folder>/, or null
    };
  });

  // Convenience: a .jrna (or an old-style .exe) dropped directly in games/
  // (no subfolder, no game.json) also shows up, using its filename as both
  // id and name. Put a <name>.png next to it for the icon and a <name>.txt
  // for the "who made this game" text - both are picked up automatically.
  let fromExeFiles = [];
  if (fs.existsSync(gamesDir)) {
    for (const entry of fs.readdirSync(gamesDir, { withFileTypes: true })) {
      const lowerName = entry.name.toLowerCase();
      if (!entry.isFile() || !(lowerName.endsWith(".jrna") || lowerName.endsWith(".exe"))) continue;
      const id = path.parse(entry.name).name; // strip the extension
      fromExeFiles.push({
        id,
        name: id,
        description: "",
        folder: null,
        author: readGameAuthor(gamesDir, id, null),
        iconFile: findGameIconFile(gamesDir, id), // file directly in games/
      });
    }
  }

  return [...fromFolders, ...fromExeFiles];
}

function getGameById(id) {
  return listGames().find((g) => String(g.id) === String(id));
}

// "Off sale" items: drop an ofsale.json (or offsale.json) file into the item's
// folder and it is no longer sold - the Marketplace shows "Offsale" instead of
// the price and nobody can buy it any more. Players who ALREADY own it keep it
// and can still wear it. (Setting "offsale": true inside costume.json /
// animation.json does the same.) The file's content doesn't matter, it can
// even be empty.
const OFFSALE_FILES = ["ofsale.json", "offsale.json"];
function markOffsale(rootDir, items) {
  return items.map((item) => {
    let off = item.offsale === true;
    if (!off && item.folder) {
      const dir = path.join(rootDir, item.folder);
      off = OFFSALE_FILES.some((f) => fs.existsSync(path.join(dir, f)));
    }
    return off ? { ...item, offsale: true } : item;
  });
}

// 2D clothes: a costume.json with "shirt": { "texture": "shirt.png" } is a
// classic 585x559 shirt template that is wrapped around the torso and arms.
// The website and the game get a ready URL + the face rectangles (layout) so
// they can map it - see GODOT-DEEP-LINK.md.
let shirtLayoutCache = null;
function shirtLayout() {
  if (!shirtLayoutCache) {
    try {
      shirtLayoutCache = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "shirt-layout.json"), "utf8"));
    } catch {
      shirtLayoutCache = null;
    }
  }
  return shirtLayoutCache;
}

function decorateShirt(costume) {
  if (!costume || !costume.shirt || typeof costume.shirt !== "object") return costume;
  const file = String(costume.shirt.texture || "shirt.png");
  const exists = fs.existsSync(path.join(__dirname, "costumes", costume.folder, path.basename(file)));
  if (!exists) return { ...costume, shirt: null };
  return {
    ...costume,
    shirt: {
      texture: path.basename(file),
      url: "/costume-texture/" + encodeURIComponent(costume.folder),
      layout: shirtLayout(),
    },
  };
}

function listCostumes() {
  const root = path.join(__dirname, "costumes");
  return markOffsale(root, readItems(root, "costume.json")).map(decorateShirt);
}

// clothingwaiting/<id>/ - shirts made on /clothing/create that an admin has
// not published yet. Same layout as costumes/<id>/ (costume.json + shirt.png
// + icon.png), so publishing = moving the folder.
function listWaitingClothes() {
  const root = path.join(__dirname, "clothingwaiting");
  return readItems(root, "costume.json").filter(
    (c) => c.shirt && fs.existsSync(path.join(root, c.folder, "shirt.png"))
  );
}

// animations/<anim-id>/animation.json - emote/social animations the game
// plays on a key press (e.g. T). Same folder+metadata pattern as costumes:
// the whole file is passed through to the game, including the `tracks`
// keyframe data, so adding a new animation = dropping a new folder here.
function listAnimations() {
  const root = path.join(__dirname, "animations");
  return markOffsale(root, readItems(root, "animation.json"));
}

// places/<place-id>/place.json + the actual level file sitting next to it.
// See places/README.md - unlike games/costumes, places are served over a
// public (no-login) API because builders://place?id=... links are meant to
// be opened/shared directly.
function listPlaces() {
  return readItems(path.join(__dirname, "places"), "place.json");
}

function getPlaceById(id) {
  return listPlaces().find((p) => String(p.id) === String(id));
}

function getCostumeById(id) {
  return listCostumes().find((c) => String(c.id) === String(id));
}

function getAnimationById(id) {
  return listAnimations().find((a) => String(a.id) === String(id));
}

// emojis/emojis.json - the only emoji a player may pick in Settings.
function listEmojis() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "emojis", "emojis.json"), "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.emojis;
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// events/<event-name>/ - a link + a picture. Link can be in event.json
// ({"url": "...", "name": "..."}), link.txt / url.txt (first line), or a
// Windows .url shortcut. Picture = any image file in the folder.
const EVENT_IMG_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
function listEvents() {
  const root = path.join(__dirname, "events");
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }

    let url = "";
    let name = entry.name;
    const readText = (f) => fs.readFileSync(path.join(dir, f), "utf8");
    try {
      if (files.includes("event.json")) {
        const meta = JSON.parse(readText("event.json"));
        url = String(meta.url || meta.link || "").trim();
        if (meta.name) name = String(meta.name);
      }
      if (!url) {
        const txt = files.find((f) => /^(link|url)\.txt$/i.test(f));
        if (txt) url = readText(txt).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
      }
      if (!url) {
        const shortcut = files.find((f) => /\.url$/i.test(f));
        if (shortcut) {
          const m = readText(shortcut).match(/^URL=(.+)$/im);
          if (m) url = m[1].trim();
        }
      }
    } catch { /* broken file - skip below */ }
    if (!/^https?:\/\//i.test(url)) continue; // only real web links

    const images = files.filter((f) => EVENT_IMG_EXT.includes(path.extname(f).toLowerCase()));
    if (images.length === 0) continue;
    const preferred = images.find((f) => /^(photo|image|banner|icon)\./i.test(f)) || images.sort()[0];
    out.push({ id: entry.name, name, url, image: preferred });
  }
  return out;
}

// gameswaiting/<id>/ - games sent from the Create page, not published yet.
// Returns [{ id, name, description, author, submittedAt, file }]. Never
// touches or deletes anything.
const GAME_FILE_EXTENSIONS = [".jrna", ".exe"];
function listWaitingGames() {
  const root = path.join(__dirname, "gameswaiting");
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    const file = files.find((f) => GAME_FILE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    if (!file) continue;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, "game.json"), "utf8")); } catch { /* no/broken game.json - use defaults */ }
    out.push({
      id: entry.name,
      name: meta.name || entry.name,
      description: meta.description || "",
      author: meta.author || readGameAuthor(dir, entry.name, null),
      submittedAt: meta.submittedAt || "",
      file,
    });
  }
  return out;
}

module.exports = { listWaitingClothes, listWaitingGames, listEmojis, listEvents, listGames, getGameById, listCostumes, listAnimations, listPlaces, getPlaceById, getCostumeById, getAnimationById };
