// Run:  npm run setup   (or double-click setup.bat)
// Asks you to PASTE your PayPal Client ID and Secret, checks them with PayPal
// (it works out by itself whether they are Sandbox or Live keys) and writes
// them into the .env file for you. Nothing to type by hand = no typos.
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DIR = __dirname;
const ENV_FILE = path.join(DIR, ".env");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
// line queue: works even if several lines are pasted at once
const waiting = [];
const buffered = [];
rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : buffered.push(line)));
const ask = (q) => {
  process.stdout.write(q);
  return new Promise((r) => (buffered.length ? r(buffered.shift()) : waiting.push(r)));
};
const clean = (s) => String(s).replace(/[\s"'\u200B\uFEFF]/g, ""); // spaces, quotes, invisible chars

const TEMPLATE = `# ---- PayPal ----------------------------------------------------------
PAYPAL_CLIENT_ID=
PAYPAL_SECRET=

# ---- Where reports (/help) are sent -----------------------------------
REPORT_TO=you@example.com

# ---- E-mail sender (Hotmail needs an APP PASSWORD) --------------------
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=PASTE_APP_PASSWORD_HERE

# ---- Site ---------------------------------------------------------------
# Public address of the site. Leave empty when testing on localhost.
BASE_URL=
SESSION_SECRET=builders-change-me-to-long-random-text-8472
`;

async function works(mode, id, secret) {
  const base = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  try {
    const r = await fetch(base + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    return r.ok ? "yes" : "no";
  } catch {
    return "offline";
  }
}

function setKey(text, key, value) {
  const re = new RegExp("^" + key + "=.*$", "m");
  return re.test(text) ? text.replace(re, key + "=" + value) : text.replace(/\s*$/, "\n") + key + "=" + value + "\n";
}

(async () => {
  console.log("\n=== PayPal setup ===");
  console.log("On developer.paypal.com open your app and use the COPY buttons (two squares).\n");
  const id = clean(await ask("Paste Client ID and press Enter: "));
  const secret = clean(await ask("Paste Secret key and press Enter: "));
  if (id.length < 20 || secret.length < 20) {
    console.log("\nThose look too short. Copy them with the copy buttons and try again.\n");
    return rl.close();
  }

  console.log("\nChecking the keys with PayPal ...");
  const live = await works("live", id, secret);
  if (live !== "yes") {
    const sb = live === "no" ? await works("sandbox", id, secret) : "offline";
    console.log("");
    if (sb === "yes") {
      console.log("These are TEST keys (from the Sandbox tab). They cannot take real money.");
      console.log("On developer.paypal.com switch the toggle at the top to LIVE, create an app");
      console.log("there and use ITS Client ID and Secret.\n");
    } else if (live === "offline") {
      console.log("Can't reach PayPal - check your internet and try again.\n");
    } else {
      console.log("PayPal rejected these keys. Copy them again with the copy buttons");
      console.log("(Client ID and Secret must be from the same LIVE app).\n");
    }
    return rl.close();
  }
  console.log("Keys are OK (real money).");

  let text = TEMPLATE;
  for (const name of [".env", ".env.txt"]) {
    try { text = fs.readFileSync(path.join(DIR, name), "utf8").replace(/^\uFEFF/, ""); break; } catch {}
  }
  text = setKey(text, "PAYPAL_CLIENT_ID", id);
  text = setKey(text, "PAYPAL_SECRET", secret);
  fs.writeFileSync(ENV_FILE, text, "utf8");

  console.log("\nSaved to: " + ENV_FILE);
  console.log("Now restart the site (close it and run start.bat again).\n");
  rl.close();
})();
