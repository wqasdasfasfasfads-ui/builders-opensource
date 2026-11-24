// db.js - a very small file-based user store, good enough for running the
// site locally or on a small VPS. Swap this for a real database (Postgres,
// SQLite, etc.) before running this for a lot of real users.
//
// UPDATED (skins update): every user now also owns a costume inventory
// (ownedCostumes - list of costume ids) and has one equipped skin
// (equippedCostume - costume id or null). Old user files from before this
// update are migrated automatically on load, so nothing is lost.
//
// UPDATED (coins update): every user now also has a `coins` balance and a
// `lastDailyBonus` timestamp, used to hand out a free daily coin bonus
// (see claimDailyBonus below) and to let the Marketplace charge for
// costumes. Old user files are migrated automatically, same as above.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "users.json");

const MAX_EQUIPPED = 9;
const DAILY_BONUS_AMOUNT = 20;
const DAILY_BONUS_INTERVAL_MS = 24 * 60 * 60 * 1000; // once every 24h

// --- Pluse subscription ---------------------------------------------------
// user.superUntil = timestamp (ms) when Pluse ends, or null. While it is in
// the future the player is "Pluse": 100 coins/day instead of 20, the Mega
// Cape (costumes/mega-cape), -10% on every item and a golden nickname.
const SUPER_DAILY_BONUS_AMOUNT = 100;
const SUPER_DISCOUNT_PERCENT = 10;
const SUPER_COSTUME_ID = "mega-cape";
const DAY_MS = 24 * 60 * 60 * 1000;

function isSuper(user) {
  return !!(user && typeof user.superUntil === "number" && user.superUntil > Date.now());
}

// Price after the Pluse discount (rounded, never below 1 for paid items).
function priceFor(user, price) {
  price = Number(price) || 0;
  if (price <= 0 || !isSuper(user)) return price;
  return Math.max(1, Math.round((price * (100 - SUPER_DISCOUNT_PERCENT)) / 100));
}

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");
}

// Make sure a user record has every field this version of the site needs,
// even if the record was created by an older version (migration).
function ensureShape(user) {
  if (!Array.isArray(user.ownedCostumes)) user.ownedCostumes = [];
  // Pluse: the Mega Cape belongs to the player only while Pluse is active.
  if (typeof user.superUntil !== "number" || Number.isNaN(user.superUntil)) user.superUntil = null;
  if (isSuper(user)) {
    if (!user.ownedCostumes.includes(SUPER_COSTUME_ID)) user.ownedCostumes.push(SUPER_COSTUME_ID);
  } else {
    user.ownedCostumes = user.ownedCostumes.filter((c) => c !== SUPER_COSTUME_ID);
  }
  if (!Array.isArray(user.ownedAnimations)) user.ownedAnimations = [];
  if (user.equippedCostume === undefined) user.equippedCostume = null;
  // up to MAX_EQUIPPED costumes worn at once (migrated from the old single slot)
  if (!Array.isArray(user.equippedCostumes)) {
    user.equippedCostumes = user.equippedCostume ? [user.equippedCostume] : [];
  }
  user.equippedCostumes = user.equippedCostumes
    .filter((id, i, a) => user.ownedCostumes.includes(id) && a.indexOf(id) === i)
    .slice(0, MAX_EQUIPPED);
  user.equippedCostume = user.equippedCostumes.length
    ? user.equippedCostumes[user.equippedCostumes.length - 1]
    : null; // kept in sync for older code: the most recently equipped one
  if (!user.colors) {
    user.colors = {
      head: "#f5cd30",
      torso: "#0d69ac",
      arms: "#f5cd30",
      legs: "#a2c429",
    };
  }
  if (typeof user.coins !== "number" || Number.isNaN(user.coins)) user.coins = 0;
  if (user.lastDailyBonus === undefined) user.lastDailyBonus = null;
  // friends + multiplayer presence (friends update)
  if (!Array.isArray(user.friends)) user.friends = [];
  if (user.presence === undefined) user.presence = null;
  // profile (profile update): custom icon + "about me" text
  if (typeof user.hasAvatar !== "boolean") user.hasAvatar = false;
  if (typeof user.avatarVersion !== "number") user.avatarVersion = 0;
  if (typeof user.description !== "string") user.description = "";
  if (typeof user.emoji !== "string") user.emoji = "";
  // ban (admin update): null, or { until: ms timestamp | null (= forever), reason, by, at }
  if (user.ban === undefined) user.ban = null;
  // contact info (email update): old accounts simply have these empty
  if (typeof user.email !== "string") user.email = "";
  if (typeof user.birthDate !== "string") user.birthDate = ""; // YYYY-MM-DD
  return user;
}

function loadUsers() {
  ensureFile();
  try {
    const users = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return Array.isArray(users) ? users.map(ensureShape) : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  ensureFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2), "utf8");
}

function findByUsername(username) {
  return loadUsers().find(
    (u) => u.username.toLowerCase() === String(username).toLowerCase()
  );
}

function findByEmail(email) {
  const e = String(email).trim().toLowerCase();
  if (!e) return undefined;
  return loadUsers().find((u) => (u.email || "").toLowerCase() === e);
}

function findById(id) {
  return loadUsers().find((u) => u.id === id);
}

function createUser({ id, username, passwordHash, email, birthDate }) {
  const users = loadUsers();
  const user = ensureShape({
    id,
    username,
    passwordHash,
    email: email || "",
    birthDate: birthDate || "",
    colors: {
      head: "#f5cd30",
      torso: "#0d69ac",
      arms: "#f5cd30",
      legs: "#a2c429",
    },
    ownedCostumes: [],
    ownedAnimations: [],
    equippedCostume: null,
    coins: 0,
    lastDailyBonus: null,
  });
  users.push(user);
  saveUsers(users);
  return user;
}

function updateColors(id, colors) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  user.colors = { ...user.colors, ...colors };
  saveUsers(users);
  return user;
}

function updateUsername(id, username) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  user.username = username;
  saveUsers(users);
  return user;
}

function updatePasswordHash(id, passwordHash) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  user.passwordHash = passwordHash;
  saveUsers(users);
  return user;
}

// --- Profile: custom icon + description ---------------------------------

function setHasAvatar(id, hasAvatar) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  user.hasAvatar = !!hasAvatar;
  user.avatarVersion = Date.now(); // used as ?v= so browsers reload the icon
  saveUsers(users);
  return user;
}

function updateDescription(id, description) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  user.description = description;
  saveUsers(users);
  return user;
}

function updateEmoji(id, emoji) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  user.emoji = emoji;
  saveUsers(users);
  return user;
}

// --- Bans (admin update) -----------------------------------------------

// The ban if it is still active, otherwise null (expired bans are ignored).
function activeBan(user) {
  const b = user && user.ban;
  if (!b) return null;
  if (b.until !== null && b.until <= Date.now()) return null;
  return b;
}

// untilMs = timestamp when the ban ends, or null for a permanent ban.
function banUser(id, untilMs, reason, byId) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  user.ban = { until: untilMs, reason: reason || "", by: byId, at: Date.now() };
  user.presence = null;
  saveUsers(users);
  return user;
}

function unbanUser(id) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  user.ban = null;
  saveUsers(users);
  return user;
}

// --- Animation inventory (emotes bought on the Marketplace) -------------

// Add an animation to the player's inventory. Returns true if it was
// added, false if they already own it.
function addAnimation(id, animationId) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return false;
  ensureShape(user);
  if (user.ownedAnimations.includes(animationId)) return false;
  user.ownedAnimations.push(animationId);
  saveUsers(users);
  return true;
}

// --- Costume inventory -------------------------------------------------

// Add a costume to the player's inventory. Returns true if it was added,
// false if they already own it.
function addCostume(id, costumeId) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return false;
  ensureShape(user);
  if (user.ownedCostumes.includes(costumeId)) return false;
  user.ownedCostumes.push(costumeId);
  saveUsers(users);
  return true;
}

// Wear a costume (up to 3 at the same time). Only works if the player owns
// it. Returns null if not owned or if all 3 slots are already used.
// Pass costumeId = null to take everything off (back to the custom colors).
function equipCostume(id, costumeId) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  if (costumeId === null) {
    user.equippedCostumes = [];
  } else {
    if (!user.ownedCostumes.includes(costumeId)) return null; // can't equip what you don't own
    if (!user.equippedCostumes.includes(costumeId)) {
      if (user.equippedCostumes.length >= MAX_EQUIPPED) return null; // slots full
      user.equippedCostumes.push(costumeId);
    }
  }
  ensureShape(user);
  saveUsers(users);
  return user;
}

// Take off one costume, keep the others.
function unequipCostume(id, costumeId) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  user.equippedCostumes = user.equippedCostumes.filter((c) => c !== costumeId);
  ensureShape(user);
  saveUsers(users);
  return user;
}

// --- Coins --------------------------------------------------------------

// Gives the user their free 20-coin daily bonus if 24h have passed since
// the last time they claimed it (or if they've never claimed it before).
// Safe to call on every request - it's a no-op if the bonus isn't due yet.
function claimDailyBonus(id) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);

  const now = Date.now();
  const dueForBonus =
    !user.lastDailyBonus || now - user.lastDailyBonus >= DAILY_BONUS_INTERVAL_MS;

  if (!dueForBonus) {
    return { claimed: false, coins: user.coins };
  }

  const amount = isSuper(user) ? SUPER_DAILY_BONUS_AMOUNT : DAILY_BONUS_AMOUNT;
  user.coins += amount;
  user.lastDailyBonus = now;
  saveUsers(users);
  return { claimed: true, amount, coins: user.coins };
}

// Gives (or extends) Pluse by `days` days. If Pluse is still running the new
// time is added after the current end. The Mega Cape is added by ensureShape.
function grantSuper(id, days) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  const base = isSuper(user) ? user.superUntil : Date.now();
  user.superUntil = base + days * DAY_MS;
  ensureShape(user);
  saveUsers(users);
  return user;
}

// Adds coins (used after a PayPal payment was captured).
function addCoins(id, amount) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  user.coins += amount;
  saveUsers(users);
  return user;
}

// Deducts `amount` coins if (and only if) the user can afford it. Returns
// the updated user on success, or null if they don't have enough coins.
function spendCoins(id, amount) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  if (user.coins < amount) return null;
  user.coins -= amount;
  saveUsers(users);
  return user;
}

// --- Friends + presence (multiplayer update) ----------------------------
// Adding a friend is deliberately not exposed anymore (no addFriend here) -
// the site only lets a player remove an existing friend.

function removeFriend(id, friendId) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return false;
  ensureShape(user);
  user.friends = user.friends.filter((f) => f !== friendId);
  saveUsers(users);
  return true;
}

// The game reports which game + room the player is in (or null when they
// leave to menu / quit), so friends on the site can see it and join.
function setPresence(id, presence) {
  const users = loadUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return null;
  ensureShape(user);
  user.presence = presence ? { ...presence, updated_at: Date.now() } : null;
  saveUsers(users);
  return user.presence;
}

module.exports = {
  loadUsers,
  saveUsers,
  findByUsername,
  findByEmail,
  findById,
  createUser,
  updateColors,
  updateUsername,
  updatePasswordHash,
  setHasAvatar,
  updateDescription,
  updateEmoji,
  activeBan,
  banUser,
  unbanUser,
  addCostume,
  addAnimation,
  equipCostume,
  unequipCostume,
  MAX_EQUIPPED,
  claimDailyBonus,
  isSuper,
  priceFor,
  grantSuper,
  SUPER_COSTUME_ID,
  SUPER_DISCOUNT_PERCENT,
  SUPER_DAILY_BONUS_AMOUNT,
  spendCoins,
  addCoins,
  removeFriend,
  setPresence,
};
