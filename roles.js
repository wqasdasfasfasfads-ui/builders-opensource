// roles.js - who is an admin / forumadmin. Reads admins/admins.json on every
// call (tiny file), so edits apply without restarting the site.
//
//   { "SomeNick": { "admin": true, "forumadmin": false }, "<user id>": {...} }

const fs = require("fs");
const path = require("path");

const ROLES_FILE = path.join(__dirname, "admins", "admins.json");
const NONE = Object.freeze({ admin: false, forumadmin: false });

// JSON.parse is strict: a single trailing comma (a very common edit
// mistake) used to make the WHOLE file unreadable, silently turning
// every admin into a regular player. Clean the usual slip-ups
// (// comments and trailing commas) before parsing so one typo can't
// take the admin panel down for everyone.
function parseLenientJson(text) {
  const cleaned = text
    .replace(/^\s*\/\/.*$/gm, "") // whole-line // comments
    .replace(/,(\s*[}\]])/g, "$1"); // trailing commas: {"a":1,} -> {"a":1}
  return JSON.parse(cleaned);
}

function loadRoleTable() {
  try {
    const raw = parseLenientJson(fs.readFileSync(ROLES_FILE, "utf8"));
    const table = new Map();
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith("_")) continue; // comments / help text
      const v = value === true ? { admin: true } : value || {};
      table.set(key.toLowerCase(), {
        admin: v.admin === true,
        forumadmin: v.forumadmin === true,
      });
    }
    return table;
  } catch (err) {
    console.warn("[roles] could not read admins/admins.json - nobody is an admin:", err.message);
    return new Map(); // missing or broken file = nobody is an admin
  }
}

// { admin, forumadmin } for a user record (matched by user id or nickname).
function rolesFor(user) {
  if (!user) return NONE;
  const table = loadRoleTable();
  const byId = table.get(String(user.id).toLowerCase());
  const byName = table.get(String(user.username).toLowerCase());
  return {
    admin: !!((byId && byId.admin) || (byName && byName.admin)),
    forumadmin: !!((byId && byId.forumadmin) || (byName && byName.forumadmin)),
  };
}

module.exports = { rolesFor };
