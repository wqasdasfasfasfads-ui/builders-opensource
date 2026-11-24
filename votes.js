// votes.js - likes/dislikes for games, stored in data/games.json:
//
//   { "<game id>": { "likes": ["<user id>", ...], "dislikes": ["<user id>", ...] } }
//
// One vote per player per game: pressing the same button again takes the
// vote back, pressing the other one switches it.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const VOTES_FILE = path.join(DATA_DIR, "games.json");

function loadAll() {
  try {
    const raw = JSON.parse(fs.readFileSync(VOTES_FILE, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {}; // missing or broken file = no votes yet
  }
}

function saveAll(all) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(VOTES_FILE, JSON.stringify(all, null, 2), "utf8");
}

function entryFor(all, gameId) {
  const e = all[gameId] || {};
  return {
    likes: Array.isArray(e.likes) ? e.likes.map(String) : [],
    dislikes: Array.isArray(e.dislikes) ? e.dislikes.map(String) : [],
  };
}

// { likes, dislikes, userVote } where userVote is "like" | "dislike" | null.
function getVotes(gameId, userId) {
  const e = entryFor(loadAll(), String(gameId));
  return {
    likes: e.likes.length,
    dislikes: e.dislikes.length,
    userVote: userId
      ? e.likes.includes(String(userId))
        ? "like"
        : e.dislikes.includes(String(userId))
          ? "dislike"
          : null
      : null,
  };
}

// Sets/toggles/switches the player's vote and returns the fresh counts.
function vote(gameId, userId, kind) {
  if (kind !== "like" && kind !== "dislike") return getVotes(gameId, userId);
  const all = loadAll();
  const id = String(gameId);
  const uid = String(userId);
  const e = entryFor(all, id);

  const hadLike = e.likes.includes(uid);
  const hadDislike = e.dislikes.includes(uid);
  e.likes = e.likes.filter((u) => u !== uid);
  e.dislikes = e.dislikes.filter((u) => u !== uid);

  if (kind === "like" && !hadLike) e.likes.push(uid);
  if (kind === "dislike" && !hadDislike) e.dislikes.push(uid);

  all[id] = e;
  saveAll(all);
  return getVotes(gameId, userId);
}

module.exports = { getVotes, vote };
