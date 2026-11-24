// reset-data.js - wipes ALL accounts and everything tied to them
// (users, avatars, forum posts, likes, game sessions). Stop the server first!
// Run:  node reset-data.js
const fs = require("fs");
const path = require("path");
const D = path.join(__dirname, "data");
fs.mkdirSync(path.join(D, "avatars"), { recursive: true });
fs.writeFileSync(path.join(D, "users.json"), "[]");
fs.writeFileSync(path.join(D, "forum.json"), "[]");
fs.writeFileSync(path.join(D, "games.json"), "{}");
fs.writeFileSync(path.join(D, "game_sessions.json"), "{}");
for (const f of fs.readdirSync(path.join(D, "avatars"))) {
  if (f !== ".gitkeep") fs.rmSync(path.join(D, "avatars", f), { force: true });
}
for (const f of fs.readdirSync(D)) {
  if (f.startsWith("users.json.bak")) fs.rmSync(path.join(D, f), { force: true });
}
console.log("Done: all accounts and account data are deleted.");
