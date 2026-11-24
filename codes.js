// codes.js - redeem codes for the /readem page.
//
// Every code is a file (or folder) inside the codes/ folder - see
// codes/README.md. The code a player types is the file/folder name
// (not case-sensitive), or the "code" field inside the json.
//
//   codes/WELCOME.json            { "coins": 50 }
//   codes/NINJA2026/code.json     { "costume": "ninja", "maxUses": 100 }
//
// Who already used which code is remembered in data/codes.json, so one
// player can use a code only once, and "maxUses" limits it for everybody.

const fs = require("fs");
const path = require("path");
const db = require("./db");
const { getCostumeById, getAnimationById } = require("./catalog");

const CODES_DIR = path.join(__dirname, "codes");
const DATA_DIR = path.join(__dirname, "data");
const USED_FILE = path.join(DATA_DIR, "codes.json");

function readJson(file) {
  // strip a BOM (Windows Notepad adds one) before parsing
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function loadUsed() {
  try {
    const data = readJson(USED_FILE);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveUsed(used) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USED_FILE, JSON.stringify(used, null, 2), "utf8");
}

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();

// All codes found in codes/ -> [{ key, code, meta }]
function listCodes() {
  if (!fs.existsSync(CODES_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(CODES_DIR, { withFileTypes: true })) {
    let file = null;
    let name = null;
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      file = path.join(CODES_DIR, entry.name);
      name = entry.name.slice(0, -5);
    } else if (entry.isDirectory()) {
      const f = path.join(CODES_DIR, entry.name, "code.json");
      if (fs.existsSync(f)) {
        file = f;
        name = entry.name;
      }
    }
    if (!file) continue;
    try {
      const meta = readJson(file);
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
      const code = String(meta.code || name);
      out.push({ key: norm(code), code, meta });
    } catch {
      // broken json - ignore this code instead of crashing the page
    }
  }
  return out;
}

function asList(...values) {
  const out = [];
  for (const v of values) {
    if (Array.isArray(v)) out.push(...v);
    else if (v !== undefined && v !== null && v !== "") out.push(v);
  }
  return out.map(String);
}

// Failed-attempt limiter (in memory): 10 wrong codes per 10 minutes per
// player, so nobody can brute-force the codes folder.
const attempts = new Map();
const MAX_FAILS = 10;
const WINDOW_MS = 10 * 60 * 1000;

function tooManyFails(userId) {
  const now = Date.now();
  const list = (attempts.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(userId, list);
  return list.length >= MAX_FAILS;
}
function noteFail(userId) {
  const list = attempts.get(userId) || [];
  list.push(Date.now());
  attempts.set(userId, list);
}

// Returns { ok: true, message } or { ok: false, error, message }.
function redeem(userId, input) {
  const typed = norm(input);
  if (!typed) return { ok: false, error: "empty", message: "Type a code first." };
  if (tooManyFails(userId)) {
    return { ok: false, error: "slow_down", message: "Too many wrong codes. Try again in a few minutes." };
  }

  const found = listCodes().find((c) => c.key === typed);
  if (!found || found.meta.disabled === true) {
    noteFail(userId);
    return { ok: false, error: "invalid", message: "That code doesn't exist." };
  }
  const meta = found.meta;

  if (meta.expires) {
    const until = typeof meta.expires === "number" ? meta.expires : Date.parse(meta.expires);
    if (!Number.isNaN(until) && Date.now() > until) {
      return { ok: false, error: "expired", message: "That code has expired." };
    }
  }

  const used = loadUsed();
  const usedBy = Array.isArray(used[found.key]) ? used[found.key] : [];
  if (usedBy.includes(userId)) {
    return { ok: false, error: "already_used", message: "You already used this code." };
  }
  const maxUses = Number(meta.maxUses) || 0; // 0 / missing = unlimited
  if (maxUses > 0 && usedBy.length >= maxUses) {
    return { ok: false, error: "used_up", message: "This code has no uses left." };
  }

  const user = db.findById(userId);
  if (!user) return { ok: false, error: "no_user", message: "Account not found." };

  const coins = Math.floor(Number(meta.coins) || 0);
  const costumeIds = asList(meta.costume, meta.costumes).filter((id) => getCostumeById(id));
  const animIds = asList(meta.animation, meta.animations).filter((id) => getAnimationById(id));

  const newCostumes = costumeIds.filter((id) => !user.ownedCostumes.includes(id));
  const newAnims = animIds.filter((id) => !user.ownedAnimations.includes(id));

  // Nothing to give (everything already owned and no coins) - don't burn the code.
  if (coins <= 0 && newCostumes.length === 0 && newAnims.length === 0) {
    return { ok: false, error: "nothing_new", message: "You already have everything this code gives." };
  }

  const got = [];
  if (coins > 0) {
    db.addCoins(userId, coins);
    got.push(`${coins} coins`);
  }
  for (const id of newCostumes) {
    db.addCostume(userId, id);
    got.push(getCostumeById(id).name || id);
  }
  for (const id of newAnims) {
    db.addAnimation(userId, id);
    got.push(getAnimationById(id).name || id);
  }

  usedBy.push(userId);
  used[found.key] = usedBy;
  saveUsed(used);

  return { ok: true, message: "Code accepted! You got: " + got.join(", ") + "." };
}

module.exports = { listCodes, redeem };
