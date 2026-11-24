// envloader.js - reads the settings file next to server.js (KEY=VALUE per
// line) into process.env, so passwords/keys don't have to be typed in a
// terminal. Real environment variables win over the file. No package needed.
//
// It looks for ".env" first, and also for the common Windows mistakes
// (".env.txt", "env.txt", "env") so a hidden .txt extension doesn't break it.
const fs = require("fs");
const path = require("path");

const CANDIDATES = [".env", ".env.txt", "env.txt", "env", ".env.example.txt"].filter(
  (n) => n !== ".env.example.txt"
);
let ENV_PATH = path.join(__dirname, ".env");
let found = false;
let usedName = "";

for (const name of CANDIDATES) {
  const full = path.join(__dirname, name);
  let text;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch {
    continue;
  }
  found = true;
  usedName = name;
  ENV_PATH = full;
  text = text.replace(/^\uFEFF/, ""); // Notepad can add an invisible BOM at the start
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  break;
}

// What is in the folder that looks like a settings file (for the error message)
function similarFiles() {
  try {
    return fs.readdirSync(__dirname).filter((n) => /env/i.test(n));
  } catch {
    return [];
  }
}

module.exports = { ENV_PATH, found, usedName, similarFiles, DIR: __dirname };
