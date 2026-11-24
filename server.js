// server.js - the whole website: register, login, the Games/Marketplace/
// Settings pages, and the API that the Godot game talks to (see site_login.gd).
//
// Run it:
//   npm install
//   npm start
// Then open http://localhost:5173

const envInfo = require("./envloader"); // loads .env (SMTP + PayPal settings) before anything reads process.env
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const { avatarSvg } = require("./avatar");
const { parseClothesPngDataUrl, slugify, handleGameUpload, beginChunkedUpload, handlePhotoPart, handleGameChunk, finishChunkedUpload, cancelChunkedUpload, parsePngDataUrl, parseJpegDataUrl } = require("./uploads");
const forum = require("./forum");
const payments = require("./payments");
const { sendMail, mailConfigured } = require("./mailer");
const { rolesFor } = require("./roles");
const { listWaitingClothes, listWaitingGames, listEmojis, listEvents, listGames, getGameById, listCostumes, listAnimations, listPlaces, getPlaceById, getCostumeById, getAnimationById } = require("./catalog");
const votes = require("./votes");
const codes = require("./codes");

// The costumes a player is wearing right now (full costume objects).
function equippedCostumesOf(user) {
  return (user.equippedCostumes || []).map(getCostumeById).filter(Boolean);
}

// Several worn costumes -> one "look". Colors are merged PART BY PART:
// each costume only overrides the body parts it actually defines, the rest
// falls back to the player's own base colors (baseColors). So a pants-only
// costume ({"colors": {"legs": ...}}) keeps the player's head/torso/arms
// instead of blanking them out. Hat blocks from every item that has a hat.
function mergeCostumes(list, baseColors) {
  if (!list.length) return null;
  const colors = Object.assign({}, baseColors || {});
  const blocks = [];
  for (const c of list) {
    if (c.colors) Object.assign(colors, c.colors);
    if (c.hat && Array.isArray(c.hat.blocks)) blocks.push(...c.hat.blocks);
  }
  const last = list[list.length - 1];
  // 2D shirt: the last worn item that has one wins (one shirt at a time).
  let shirt = null;
  for (const c of list) if (c.shirt && c.shirt.url) shirt = c.shirt;
  return {
    ...last,
    id: list.map((c) => c.id).join("+"),
    name: list.map((c) => c.name).join(" + "),
    colors,
    hat: blocks.length ? { blocks } : null,
    shirt,
  };
}

// One shared payload builder: website pages and the game API both use it,
// so the game always sees the same "account with skins" data.
function gameProfilePayload(user) {
  const owned = (user.ownedCostumes || []).map(getCostumeById).filter(Boolean);
  const ownedAnims = (user.ownedAnimations || []).map(getAnimationById).filter(Boolean);
  const equippedList = equippedCostumesOf(user);
  return {
    ok: true,
    username: user.username,
    coins: user.coins,          // site currency balance, shown/spent in the game shop
    super: db.isSuper(user),    // Pluse subscription active?
    super_until: user.superUntil || null,
    discount_percent: db.isSuper(user) ? db.SUPER_DISCOUNT_PERCENT : 0, // apply to shop prices in the game
    colors: user.colors,
    owned_costumes: owned,
    owned_animations: ownedAnims,
    // up to 3 worn costumes (in the order they were put on)
    equipped_costumes: equippedList,
    // one combined costume for older game builds that only know one slot:
    // colors of the last item that has colors + the hat blocks of all items
    equipped_costume: mergeCostumes(equippedList, user.colors),
  };
}


const app = express();
const PORT = process.env.PORT || 5173;
// Cross-origin access for the game client. A browser blocks every reply that
// carries no Access-Control-Allow-Origin header, and the Godot Web export is
// served from a different origin than this server, so without this the game
// reports the site as unreachable even while it is answering. The game sends a
// bearer token rather than a cookie, so the caller's origin is reflected back.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", origin ? origin : "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  next();
});


app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
// 1mb: profile icons arrive as small PNG data URLs. The forum post route
// (pictures) has its own bigger limit further down, so it is skipped here.
const smallJson = express.json({ limit: "1mb" });
// /api/clothing/create has its own bigger limit (a 585x559 PNG as a data URL).
const bigJson = express.json({ limit: "2mb" });
app.use((req, res, next) => {
  if (req.path === "/forum/post") return next();
  if (req.path === "/api/clothing/create") return bigJson(req, res, next);
  return smallJson(req, res, next);
});
// Asset version: changes on every start, so browsers/proxies never keep an old style.css.
app.locals.assetV = Date.now();
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res) { res.setHeader("Cache-Control", "no-cache"); },
}));

// ---------------------------------------------------------------------------
// Side ad banners (112x451, one on each side of the page). Drop image files
// straight into ads/ (see ads/README.md) - no config needed. Empty folder =
// the banners just don't render, nothing breaks.
// ---------------------------------------------------------------------------

const ADS_DIR = path.join(__dirname, "ads");
const AD_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
app.use("/ads", express.static(ADS_DIR));

function listAdImages() {
  try {
    return fs
      .readdirSync(ADS_DIR)
      .filter((name) => AD_EXTENSIONS.includes(path.extname(name).toLowerCase()));
  } catch {
    return [];
  }
}

// Picked fresh on every request - independently for each side, so with more
// than one image the two banners don't always match.
function pickAd(images) {
  if (images.length === 0) return null;
  return images[Math.floor(Math.random() * images.length)];
}

app.use((req, res, next) => {
  const images = listAdImages();
  res.locals.adLeft = pickAd(images);
  res.locals.adRight = pickAd(images);
  next();
});

// Available in every .ejs view without passing it through res.render() each
// time - used for the small player-color icon in the corner nav menu.
app.locals.avatarSvg = avatarSvg;

// Player picture: the custom icon from Settings if they uploaded one,
// otherwise the colored character icon. `p` is a user (or friend row) with
// id / hasAvatar / avatarVersion / colors.
function avatarHtml(p, size) {
  if (p && p.hasAvatar) {
    return `<img src="/players/${encodeURIComponent(p.id)}/avatar.png?v=${p.avatarVersion || 0}" width="${size}" height="${size}" alt="" class="custom-avatar" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block">`;
  }
  return avatarSvg(p ? p.colors : null, size);
}
app.locals.avatarHtml = avatarHtml;
app.locals.priceFor = db.priceFor; // price after the Pluse -10% (see db.js)

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
app.locals.fmtDate = fmtDate;

// ?saved=... / ?error=... messages (used by the Settings page)
app.use((req, res, next) => {
  res.locals.query = req.query || {};
  res.locals.emojiList = listEmojis(); // allowed emoji (emojis/emojis.json)
  next();
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret-before-real-use",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.findById(req.session.userId) || null;
}

// Shared nickname validation for /register, /settings/profile and the
// game's rename API - keeps all three in sync instead of checking length
// (or emoji) differently in three places.
function usernameError(username) {
  if (username.length < 3 || username.length > 20) {
    return "Nickname must be 3 to 20 characters.";
  }
  // \p{Extended_Pictographic} matches emoji (including modifiers/ZWJ
  // sequences built from them, flags, etc.) without flagging normal
  // accented letters or symbols.
  if (/\p{Extended_Pictographic}/u.test(username)) {
    return "Nickname can't contain emoji.";
  }
  return null;
}

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

function requireLoginApi(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false, error: "not_logged_in" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Bans + roles. Runs on every request: a banned player is logged out right
// away (and can't log in again until the ban ends). `roles` ({ admin,
// forumadmin }, from admins/admins.json) is available in every view.
// ---------------------------------------------------------------------------

const NO_ROLES = { admin: false, forumadmin: false };

function banMessage(ban) {
  const when = ban.until === null ? "permanently" : "until " + fmtDate(ban.until);
  return `You are banned ${when}.` + (ban.reason ? ` Reason: ${ban.reason}` : "");
}

app.use((req, res, next) => {
  res.locals.roles = NO_ROLES;
  res.locals.flash = null;
  res.locals.superMessage = null;
  res.locals.paypalReady = payments.configured();
  res.locals.superCape = getCostumeById(db.SUPER_COSTUME_ID) || null; // shown on the preview character in the Pluse window
  res.locals.superInfo = {
    usd: payments.SUPER.price,
    days: payments.SUPER.days,
    coinPrice: payments.SUPER.coinPrice,
    coinDays: payments.SUPER.coinDays,
    dailyBonus: db.SUPER_DAILY_BONUS_AMOUNT,
    discount: db.SUPER_DISCOUNT_PERCENT,
  };
  if (!req.session.userId) return next();

  const u = db.findById(req.session.userId);
  if (!u) {
    delete req.session.userId;
    return next();
  }

  const ban = db.activeBan(u);
  if (ban) {
    return req.session.destroy(() => {
      if (req.path.startsWith("/api/")) {
        return res.status(403).json({ ok: false, error: "banned", message: banMessage(ban) });
      }
      res.status(403).render("banned", { user: null, active: null, message: banMessage(ban) });
    });
  }

  res.locals.roles = rolesFor(u);
  // one-time message set by the previous request (see req.session.flash)
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  // one-time Pluse message (bought / not enough coins / ...)
  res.locals.superMessage = req.session.superMsg || null;
  delete req.session.superMsg;
  next();
});

// Hands out the free 20-coin daily bonus (see db.claimDailyBonus) the first
// time a logged-in user loads any website page each day. `dailyBonusMessage`
// ends up in res.locals, so every .ejs view can read it directly without
// each route having to remember to pass it along.
app.use((req, res, next) => {
  res.locals.dailyBonusMessage = null;
  if (req.session.userId) {
    const result = db.claimDailyBonus(req.session.userId);
    if (result && result.claimed) {
      res.locals.dailyBonusMessage = `+${result.amount} coins - daily bonus!`;
    }
  }
  next();
});

// ---------------------------------------------------------------------------
// Website pages
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.render("home", { user: currentUser(req), active: "home" });
});

app.get("/register", (req, res) => {
  if (req.session.userId) return res.redirect("/games");
  res.render("register", { error: null, user: null, active: "register" });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// "YYYY-MM-DD" -> true only for a real calendar date that is not in the future.
function validBirthDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  return y >= 1900 && dt.getTime() <= Date.now();
}

app.post("/register", async (req, res) => {
  const username = (req.body.username || "").trim();
  const email = (req.body.email || "").trim();
  const birthDate = (req.body.birthDate || "").trim();
  const password = req.body.password || "";

  const renderError = (error) =>
    res.render("register", {
      error,
      user: null,
      active: "register",
      form: { username, email, birthDate },
    });

  const nicknameError = usernameError(username);
  if (nicknameError) {
    return renderError(nicknameError);
  }
  if (!EMAIL_RE.test(email) || email.length > 120) {
    return renderError("Please enter a valid email address.");
  }
  if (!validBirthDate(birthDate)) {
    return renderError("Please enter a valid date of birth.");
  }
  if (password.length < 6) {
    return renderError("Password must be at least 6 characters.");
  }
  if (db.findByUsername(username)) {
    return renderError("That nickname is already taken.");
  }
  if (db.findByEmail(email)) {
    return renderError("That email is already used by another account.");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.createUser({ id: crypto.randomUUID(), username, passwordHash, email, birthDate });
  req.session.userId = user.id;
  res.redirect("/games");
});

app.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/games");
  res.render("login", { error: null, user: null, active: "login" });
});

app.post("/login", async (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";
  const user = db.findByUsername(username);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.render("login", { error: "Invalid nickname or password.", user: null, active: "login" });
  }

  const ban = db.activeBan(user);
  if (ban) {
    return res.render("login", { error: banMessage(ban), user: null, active: "login" });
  }

  req.session.userId = user.id;
  res.redirect("/games");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// Old bookmarks/links to the previous dashboard just land on the new page.
app.get("/dashboard", requireLogin, (req, res) => res.redirect("/games"));

// Static info pages (footer links on the auth pages). Content lives here
// in plain text - edit it directly, no DB or files involved.
const INFO_PAGES = {
  about: {
    title: "About Builders",
    sections: [
      {
        heading: "What is Builders?",
        paragraphs: [
          "Builders is a small community gaming platform: one account, a marketplace with costumes and animations, and a desktop game that connects to your profile.",
          "Create an account, customize your character, and jump into the game straight from the website.",
        ],
      },
    ],
  },
  rules: {
    title: "Community Rules",
    sections: [
      {
        heading: "Be respectful",
        paragraphs: [
          "Treat other players the way you want to be treated. No harassment, hate speech, slurs, or personal attacks - in the game, on the site, or anywhere else in the community.",
        ],
      },
      {
        heading: "No cheating or exploits",
        paragraphs: [
          "Don't use exploits, cheats, or modified clients. Don't try to break into other people's accounts. Report bugs instead of abusing them.",
        ],
      },
      {
        heading: "Keep it appropriate",
        paragraphs: [
          "Usernames and in-game behavior must stay family-friendly. No NSFW content, no shock content, no spam.",
        ],
      },
      {
        heading: "One account per person",
        paragraphs: [
          "Don't create multiple accounts to farm daily bonuses or evade bans. Bans apply to the person, not just the account.",
        ],
      },
      {
        heading: "Consequences",
        paragraphs: [
          "Breaking the rules can lead to a warning, a temporary suspension, or a permanent ban, depending on severity and repeat offenses.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    sections: [
      {
        heading: "The service",
        paragraphs: [
          "Builders is provided as-is. We may update, change, or discontinue parts of the service at any time.",
          "Accounts, coins, costumes and animations are virtual items with no real-world value and cannot be exchanged for money.",
        ],
      },
      {
        heading: "Your account",
        paragraphs: [
          "You are responsible for everything that happens on your account. Don't share your password with anyone - nobody from the Builders team will ever ask for it.",
          "We may suspend or delete accounts that break the Community Rules or these Terms.",
        ],
      },
      {
        heading: "Content",
        paragraphs: [
          "By uploading or creating content in Builders you allow us to use, display, and distribute it as part of the service.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    sections: [
      {
        heading: "What we store",
        paragraphs: [
          "We store your nickname, a hash of your password (never the password itself), your character colors, your inventory, and your coin balance.",
          "Game sessions use temporary tokens so the desktop game can load your profile.",
        ],
      },
      {
        heading: "What we don't do",
        paragraphs: [
          "We don't sell your data, we don't send it to third parties for advertising, and we never see your password.",
        ],
      },
      {
        heading: "Cookies",
        paragraphs: [
          "We use a single session cookie to keep you logged in on the website. Nothing tracks you across other sites.",
        ],
      },
    ],
  },
  help: {
    title: "Help",
    sections: [
      {
        heading: "How do I play?",
        paragraphs: [
          "Register or log in, then open the Games page and press Play on any game. If your browser asks to open builders links - allow it.",
        ],
      },
      {
        heading: "The game says my code is invalid",
        paragraphs: [
          "Login codes expire after 2 minutes and work once. Just press Play again on the Games page to get a fresh one.",
        ],
      },
      {
        heading: "How do I get coins?",
        paragraphs: [
          "You get 20 free coins every 24 hours just by opening any page while logged in. Costumes and animations are bought with coins on the Marketplace.",
        ],
      },
      {
        heading: "I forgot my password",
        paragraphs: [
          "There is no automatic reset yet - contact the project admin and they can set a new password for your account.",
        ],
      },
    ],
  },
};

app.get("/:page(about|rules|terms|privacy)", (req, res) => {
  const page = INFO_PAGES[req.params.page];
  res.render("info", { title: page.title, sections: page.sections, user: currentUser(req) });
});

// ---------------------------------------------------------------------------
// /help - report form. Not linked in the top bar (only in the footer / by URL).
// Every report is saved to data/reports.json and e-mailed to REPORT_TO.
// Sending needs SMTP settings in environment variables - see README.
// ---------------------------------------------------------------------------

const REPORT_TO = process.env.REPORT_TO || "you@example.com";
const REPORTS_FILE = path.join(__dirname, "data", "reports.json");
const REPORT_TOPICS = [
  "Bug or technical problem",
  "I can't log in / account problem",
  "Report a player",
  "Coins / purchases problem",
  "Game problem",
  "Something else",
];
const reportHits = new Map(); // ip -> [timestamps], simple spam protection

function renderHelp(res, req, extra) {
  res.render("help", Object.assign({
    user: currentUser(req),
    active: null,
    topics: REPORT_TOPICS,
    faq: INFO_PAGES.help.sections,
    error: null,
    sent: false,
    form: { email: "", username: "", topic: "", description: "" },
  }, extra));
}

function saveReport(report) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8")); } catch {}
  if (!Array.isArray(list)) list = [];
  list.push(report);
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2), "utf8");
}

async function mailReport(report) {
  if (!mailConfigured()) {
    console.warn("[help] SMTP_USER / SMTP_PASS not set in .env - report saved to data/reports.json but NOT emailed.");
    return false;
  }
  await sendMail({
    replyTo: report.email, // press Reply to answer the player
    subject: `[Builders report] ${report.topic} - ${report.username}`,
    text:
      `New report from the Builders website\n\n` +
      `Email: ${report.email}\n` +
      `Nickname: ${report.username}\n` +
      `What happened: ${report.topic}\n` +
      `Sent: ${new Date(report.at).toISOString()}\n\n` +
      `Description:\n${report.description}\n`,
  });
  console.log("[help] report emailed to " + (process.env.REPORT_TO || "you@example.com"));
  return true;
}

app.get("/help", (req, res) => renderHelp(res, req, {}));

app.post("/help", async (req, res) => {
  const form = {
    email: String(req.body.email || "").trim(),
    username: String(req.body.username || "").trim(),
    topic: String(req.body.topic || "").trim(),
    description: String(req.body.description || "").trim(),
  };
  const fail = (error) => renderHelp(res, req, { error, form });

  if (!EMAIL_RE.test(form.email) || form.email.length > 120) return fail("Please enter a valid email address.");
  if (form.username.length < 1 || form.username.length > 40) return fail("Please enter your nickname.");
  if (!REPORT_TOPICS.includes(form.topic)) return fail("Please choose what happened.");
  if (form.description.length < 10) return fail("Please describe the problem (at least 10 characters).");
  if (form.description.length > 3000) return fail("The description is too long (max 3000 characters).");

  const now = Date.now();
  const hits = (reportHits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 3) return fail("Too many reports. Please wait a few minutes and try again.");
  hits.push(now);
  reportHits.set(req.ip, hits);

  const report = { id: crypto.randomUUID(), at: now, ...form };
  try { saveReport(report); } catch (e) { console.error("[help] could not save report:", e.message); }
  try {
    await mailReport(report);
  } catch (e) {
    console.error("[help] email failed:", e.message);
  }
  renderHelp(res, req, { sent: true });
});

// ---------------------------------------------------------------------------
// Buy coins with PayPal (/coins). Packages live in payments.js.
// Orders are remembered in data/payments.json so a refresh / double click can
// never give coins twice.
// ---------------------------------------------------------------------------

const PAYMENTS_FILE = path.join(__dirname, "data", "payments.json");

function loadPayments() {
  try {
    const list = JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function savePayments(list) {
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(list, null, 2), "utf8");
}
function updatePayment(orderId, patch) {
  const list = loadPayments();
  const rec = list.find((p) => p.orderId === orderId);
  if (rec) Object.assign(rec, patch);
  savePayments(list);
  return rec;
}
function siteBase(req) {
  const fromEnv = (process.env.BASE_URL || "").replace(/\/+$/, "");
  return fromEnv || req.protocol + "://" + req.get("host");
}

app.get("/coins", requireLogin, (req, res) => {
  res.render("coins", {
    user: currentUser(req),
    active: "coins",
    packages: payments.PACKAGES,
    configured: payments.configured(),
    status: String(req.query.status || ""),
  });
});

// ---------------------------------------------------------------------------
// Pluse subscription (the ⚡Pluse button in the top bar opens the mini GUI)
//   - $5 / 30 days through PayPal (same safe flow as coins)
//   - 4000 coins / 7 days
// Buying again while Pluse is active adds the time after the current end.
// ---------------------------------------------------------------------------

// Send the player back to the page they came from (same site only).
function backPath(req) {
  try {
    const u = new URL(req.get("Referer") || "", siteBase(req));
    if (u.host === req.get("host") && !u.pathname.startsWith("/super") && !u.pathname.startsWith("/coins/")) {
      return u.pathname + u.search;
    }
  } catch {}
  return "/marketplace";
}

app.post("/super/buy-coins", requireLogin, (req, res) => {
  const { coinPrice, coinDays } = payments.SUPER;
  if (!db.spendCoins(req.session.userId, coinPrice)) {
    req.session.superMsg = "Not enough coins for Pluse - you need " + coinPrice + ".";
    return res.redirect(backPath(req));
  }
  const u = db.grantSuper(req.session.userId, coinDays);
  console.log(`[super] user ${req.session.userId} bought Pluse for ${coinPrice} coins (+${coinDays} days)`);
  req.session.superMsg = "⚡ Pluse is active until " + fmtDate(u.superUntil) + "!";
  res.redirect(backPath(req));
});

app.post("/super/buy-paypal", requireLogin, async (req, res) => {
  const plan = payments.SUPER_PLAN;
  if (!payments.configured()) {
    req.session.superMsg = "PayPal is not set up yet.";
    return res.redirect(backPath(req));
  }
  try {
    const base = siteBase(req);
    const order = await payments.createOrder(plan, req.session.userId, base + "/coins/success", base + "/coins/cancel");
    const list = loadPayments();
    list.push({
      orderId: order.orderId,
      userId: req.session.userId,
      kind: "super",
      packageId: plan.id,
      coins: 0,
      days: plan.days,
      price: plan.price,
      status: "created",
      createdAt: Date.now(),
    });
    savePayments(list);
    res.redirect(order.approveUrl);
  } catch (e) {
    console.error("[super] create order failed:", e.message);
    req.session.superMsg = "Something went wrong with PayPal. You were not charged.";
    res.redirect(backPath(req));
  }
});

app.post("/coins/buy/:id", requireLogin, async (req, res) => {
  const pkg = payments.getPackage(req.params.id);
  if (!pkg || !payments.configured()) return res.redirect("/coins?status=error");
  try {
    const base = siteBase(req);
    const order = await payments.createOrder(pkg, req.session.userId, base + "/coins/success", base + "/coins/cancel");
    const list = loadPayments();
    list.push({
      orderId: order.orderId,
      userId: req.session.userId,
      packageId: pkg.id,
      coins: pkg.coins,
      price: pkg.price,
      status: "created",
      createdAt: Date.now(),
    });
    savePayments(list);
    res.redirect(order.approveUrl);
  } catch (e) {
    console.error("[coins] create order failed:", e.message);
    res.redirect("/coins?status=error");
  }
});

// PayPal sends the buyer back here with ?token=<orderId> after they approve.
app.get("/coins/success", requireLogin, async (req, res) => {
  const orderId = String(req.query.token || "");
  const rec = loadPayments().find((p) => p.orderId === orderId);
  if (!rec || rec.userId !== req.session.userId) return res.redirect("/coins?status=error");
  if (rec.status === "completed") return res.redirect("/coins?status=success");
  if (rec.status === "processing") return res.redirect("/coins?status=error");

  updatePayment(orderId, { status: "processing" }); // blocks a double capture
  const isSuperOrder = rec.kind === "super";
  const pkg = isSuperOrder ? payments.getSuperPlan(rec.packageId) : payments.getPackage(rec.packageId);
  try {
    const paid = pkg && (await payments.captureOrder(orderId, pkg));
    if (!paid) {
      updatePayment(orderId, { status: "created" });
      return res.redirect("/coins?status=failed");
    }
    updatePayment(orderId, { status: "completed", completedAt: Date.now() });
    if (isSuperOrder) {
      const u = db.grantSuper(rec.userId, pkg.days);
      console.log(`[super] +${pkg.days} days Pluse for user ${rec.userId} ($${pkg.price}, order ${orderId})`);
      req.session.superMsg = "⚡ Pluse is active until " + fmtDate(u.superUntil) + "! Thank you!";
      return res.redirect("/marketplace");
    }
    db.addCoins(rec.userId, pkg.coins);
    console.log(`[coins] +${pkg.coins} coins for user ${rec.userId} ($${pkg.price}, order ${orderId})`);
    res.redirect("/coins?status=success");
  } catch (e) {
    console.error("[coins] capture failed:", e.message);
    updatePayment(orderId, { status: "created" });
    res.redirect("/coins?status=error");
  }
});

app.get("/coins/cancel", requireLogin, (req, res) => res.redirect("/coins?status=cancelled"));

// Event pictures (events/<event>/<picture>) - only the picture file that
// listEvents() picked, so nothing else from that folder can be downloaded.
app.get("/events/img/:id", requireLogin, (req, res) => {
  const ev = listEvents().find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).end();
  res.sendFile(path.join(__dirname, "events", ev.id, ev.image));
});

app.get("/games", requireLogin, (req, res) => {
  const user = currentUser(req);
  const games = listGames().map((g) => ({ ...g, votes: votes.getVotes(g.id, user.id) }));
  res.render("games", {
    user,
    events: listEvents(),
    games,
    active: "games",
    friends: friendsPayload(user),
  });
});

// Game icons are served by the site itself: the <name>.png (or icon.png)
// sitting next to the game - either inside games/<folder>/ or directly in
// games/ next to a loose <name>.exe. No separate files host needed.
app.get("/games/icon/:id", requireLogin, (req, res) => {
  const game = getGameById(req.params.id);
  if (!game || !game.iconFile) return res.status(404).end();
  const dir = game.folder
    ? path.join(__dirname, "games", game.folder)
    : path.join(__dirname, "games");
  res.sendFile(path.join(dir, game.iconFile));
});

// Each game has its own page: big icon, description, who made it, and
// likes/dislikes. Clicking a game's icon on the Games page opens this.
app.get("/games/:id", requireLogin, (req, res) => {
  const game = getGameById(req.params.id);
  if (!game) {
    return res.status(404).render("info", {
      title: "Game not found",
      sections: [{ heading: "No such game", paragraphs: ["This game doesn't exist (anymore)."] }],
      user: currentUser(req),
      active: "games",
    });
  }
  const user = currentUser(req);
  res.render("game", {
    user,
    active: "games",
    game,
    votes: votes.getVotes(game.id, user.id),
    flash: res.locals.flash,
  });
});

// Like / dislike a game. One vote per player: same button again = take the
// vote back, other button = switch. Then back to the game's page.
app.post("/games/:id/vote", requireLogin, (req, res) => {
  const game = getGameById(req.params.id);
  if (!game) return res.redirect("/games");
  votes.vote(game.id, req.session.userId, req.body.vote);
  res.redirect("/games/" + encodeURIComponent(game.id));
});

// Marketplace search: case-insensitive match on name / description / id.
// Every word in the query must match somewhere ("red hoodie" finds "red-hoodie").
function filterBySearch(items, q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const hay = [item.name, item.description, item.id]
      .map((v) => String(v || "").toLowerCase().replace(/[-_]+/g, " "))
      .join(" ");
    return words.every((w) => hay.includes(w.replace(/[-_]+/g, " ")));
  });
}

app.get("/marketplace", requireLogin, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  res.render("marketplace", {
    user: currentUser(req),
    costumes: filterBySearch(listCostumes(), q),
    animations: filterBySearch(listAnimations(), q),
    active: "marketplace",
    buyError: req.query.error || null,
    maxEquipped: db.MAX_EQUIPPED,
    q,
  });
});

app.post("/marketplace/buy/:id", requireLogin, (req, res) => {
  const costume = getCostumeById(req.params.id);
  if (!costume) return res.redirect("/marketplace");

  const user = currentUser(req);
  if (user.ownedCostumes.includes(costume.id)) return res.redirect("/marketplace");
  if (costume.offsale) return res.redirect("/marketplace?error=offsale");

  const price = db.priceFor(user, costume.price || 0); // Pluse: -10%
  if (price > 0 && !db.spendCoins(req.session.userId, price)) {
    return res.redirect("/marketplace?error=not_enough_coins");
  }

  db.addCostume(req.session.userId, costume.id);
  res.redirect("/marketplace");
});

// `from` (a hidden field on the form) sends the player back to whichever
// page they equipped from - Marketplace or Avatar - instead of always
// jumping to Marketplace.
// Animations work like costumes but with no "equip" - they're emotes the
// game plays on demand (T menu), so buying just adds them to the inventory.
app.post("/marketplace/buy-animation/:id", requireLogin, (req, res) => {
  const animation = getAnimationById(req.params.id);
  if (!animation) return res.redirect("/marketplace");

  const user = currentUser(req);
  if (user.ownedAnimations.includes(animation.id)) return res.redirect("/marketplace");
  if (animation.offsale) return res.redirect("/marketplace?error=offsale");

  const price = db.priceFor(user, animation.price || 0); // Pluse: -10%
  if (price > 0 && !db.spendCoins(req.session.userId, price)) {
    return res.redirect("/marketplace?error=not_enough_coins");
  }

  db.addAnimation(req.session.userId, animation.id);
  res.redirect("/marketplace");
});

app.post("/marketplace/equip/:id", requireLogin, (req, res) => {
  const costume = getCostumeById(req.params.id);
  let failed = false;
  if (costume && !db.equipCostume(req.session.userId, costume.id)) failed = true;
  const base = req.body.from === "avatar" ? "/avatar" : "/marketplace";
  res.redirect(failed ? base + "?error=slots_full" : base);
});

// Take off one costume (costume id in the URL) and keep the others...
app.post("/marketplace/unequip/:id", requireLogin, (req, res) => {
  db.unequipCostume(req.session.userId, req.params.id);
  res.redirect(req.body.from === "avatar" ? "/avatar" : "/marketplace");
});

// ...or everything at once.
app.post("/marketplace/unequip", requireLogin, (req, res) => {
  db.equipCostume(req.session.userId, null);
  res.redirect(req.body.from === "avatar" ? "/avatar" : "/marketplace");
});

// ---------------------------------------------------------------------------
// Marketplace item icons: a small picture of what the costume looks like.
// There's no upload button on the website - to set a custom icon, drop an
// icon.png (or .jpg/.jpeg/.webp/.gif) file straight into that costume's
// folder next to its costume.json (see costumes/README.md). Price works
// the same way: it's just the "price" field in costume.json. Without a
// custom icon file, one is drawn automatically from the costume's colors.
// ---------------------------------------------------------------------------

const ICON_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

function costumeIconPath(costume) {
  if (!costume || !costume.folder) return null;
  const dir = path.join(__dirname, "costumes", costume.folder);
  for (const ext of ICON_EXTENSIONS) {
    const file = path.join(dir, "icon" + ext);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

app.get("/marketplace/icon/:id", requireLogin, (req, res) => {
  const costume = getCostumeById(req.params.id);
  if (!costume) return res.status(404).end();

  // Shirts: draw the same round icon as the other costumes, with the shirt
  // picture on the torso and arms (so it looks like the rest of the shop).
  if (costume.shirt && costume.shirt.layout) {
    try {
      const png = fs.readFileSync(path.join(__dirname, "costumes", costume.folder, "shirt.png"));
      const shirt = { dataUrl: "data:image/png;base64," + png.toString("base64"), layout: costume.shirt.layout };
      res.setHeader("Cache-Control", "no-cache");
      return res.type("image/svg+xml").send(avatarSvg(costume.colors, 96, shirt));
    } catch (e) { /* fall through to the normal icon */ }
  }

  const customIcon = costumeIconPath(costume);
  if (customIcon) return res.sendFile(customIcon);

  // No custom icon file - draw one from the costume's colors on the fly.
  res.type("image/svg+xml").send(avatarSvg(costume.colors, 96));
});

// ---------------------------------------------------------------------------
// /readem - type a code from the codes/ folder (see codes/README.md) and get
// its reward (coins / costumes / animations). Also reachable as /redeem.
// ---------------------------------------------------------------------------
app.get("/redeem", requireLogin, (req, res) => res.redirect("/readem"));

app.get("/readem", requireLogin, (req, res) => {
  res.render("readem", { user: currentUser(req), active: "readem", result: res.locals.flash });
});

app.post("/readem", requireLogin, (req, res) => {
  const result = codes.redeem(req.session.userId, req.body && req.body.code);
  req.session.flash = { type: result.ok ? "success" : "error", text: result.message };
  res.redirect("/readem");
});

app.get("/avatar", requireLogin, (req, res) => {
  const user = currentUser(req);
  const owned = (user.ownedCostumes || []).map(getCostumeById).filter(Boolean);
  res.render("avatar", {
    user,
    active: "avatar",
    owned,
    equippedList: equippedCostumesOf(user),
    equippedCostume: mergeCostumes(equippedCostumesOf(user), user.colors),
    maxEquipped: db.MAX_EQUIPPED,
    slotsFull: req.query.error === "slots_full",
    defaultColors: DEFAULT_AVATAR_COLORS,
    colorPrice: db.priceFor(user, COLOR_PRICE), // Pluse: -10%
    colorStatus: ["saved", "not_enough_coins", "unchanged"].includes(req.query.colors) ? req.query.colors : null,
  });
});

// Choosing your own body colors costs COLOR_PRICE Coins per save.
const COLOR_PRICE = 10;
const DEFAULT_AVATAR_COLORS = { head: "#f5cd30", torso: "#0d69ac", arms: "#f5cd30", legs: "#a2c429" };

// A hex color straight from an <input type="color"> (#rrggbb). Falls back
// to whatever the user already had if the submitted value isn't valid, so a
// tampered/missing field can't corrupt their saved colors.
function normalizeHexColor(value, fallback) {
  const v = String(value == null ? "" : value).trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

// Lets the player set their own avatar look (head/torso/arms/legs colors).
// This is the base look used whenever no costume is equipped - the same
// "colors" the game itself draws the character with.
app.post("/avatar/colors", requireLogin, (req, res) => {
  const user = currentUser(req);
  const current = Object.assign({}, DEFAULT_AVATAR_COLORS, user.colors || {});
  const next = {
    head: normalizeHexColor(req.body.head, current.head),
    torso: normalizeHexColor(req.body.torso, current.torso),
    arms: normalizeHexColor(req.body.arms, current.arms),
    legs: normalizeHexColor(req.body.legs, current.legs),
  };
  const changed = Object.keys(next).some((k) => next[k].toLowerCase() !== String(current[k]).toLowerCase());
  if (!changed) return res.redirect("/avatar?colors=unchanged"); // nothing to pay for
  const price = db.priceFor(user, COLOR_PRICE);
  if (price > 0 && !db.spendCoins(req.session.userId, price)) {
    return res.redirect("/avatar?colors=not_enough_coins");
  }
  db.updateColors(req.session.userId, next);
  res.redirect("/avatar?colors=saved");
});

// ---------------------------------------------------------------------------
// 2D clothes (T-shirts) - make a classic 585x559 shirt template in the
// browser (or upload one), it is wrapped around the torso + arms of the 3D
// character. Admins publish at once; everybody else's shirts wait in
// clothingwaiting/ until an admin presses Publish on /admin.
// ---------------------------------------------------------------------------

const CLOTHES_WAITING_DIR = path.join(__dirname, "clothingwaiting");
const CLOTHES_REJECTED_DIR = path.join(__dirname, "clothingrejected");
const SHIRT_W = 585;
const SHIRT_H = 559;
const MAX_WAITING_CLOTHES_PER_USER = 10;

app.get("/clothing/create", requireAdmin, (req, res) => { // admins only
  const me = currentUser(req);
  res.render("clothing-create", { user: me, active: "marketplace" });
});

app.post("/api/clothing/create", requireLoginApi, (req, res) => {
  if (!res.locals.roles || !res.locals.roles.admin) {
    return res.status(403).json({ ok: false, error: "Only admins can make T-shirts." });
  }
  const me = currentUser(req);
  const body = req.body || {};
  const fail = (status, error) => res.status(status).json({ ok: false, error });

  const name = String(body.name || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 30);
  if (name.length < 3) return fail(400, "Give the T-shirt a name (3 to 30 characters).");
  const description = String(body.description || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
  let price = Math.floor(Number(body.price));
  if (!Number.isFinite(price) || price < 0) price = 0;
  if (price > 10000) price = 10000;

  const texture = parseClothesPngDataUrl(body.image, SHIRT_W, SHIRT_H);
  if (!texture) return fail(400, `The picture must be a PNG of exactly ${SHIRT_W}x${SHIRT_H} pixels (the shirt template), under 900 KB.`);
  const icon = body.icon ? parsePngDataUrl(body.icon) : null; // small marketplace preview (optional)

  const isAdmin = !!res.locals.roles.admin;
  const targetRoot = isAdmin ? path.join(__dirname, "costumes") : CLOTHES_WAITING_DIR;

  if (!isAdmin) {
    const mine = listWaitingClothes().filter((c) => c.authorId === me.id).length;
    if (mine >= MAX_WAITING_CLOTHES_PER_USER) {
      return fail(429, "You already have " + MAX_WAITING_CLOTHES_PER_USER + " shirts waiting for review. Wait until an admin checks them.");
    }
  }

  const base = "shirt-" + slugify(name).replace(/^game$/, "tee");
  let id = base;
  for (let i = 2; fs.existsSync(path.join(__dirname, "costumes", id)) || fs.existsSync(path.join(CLOTHES_WAITING_DIR, id)) || fs.existsSync(path.join(CLOTHES_REJECTED_DIR, id)); i++) {
    id = `${base}-${i}`;
  }

  try {
    const dir = path.join(targetRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "shirt.png"), texture);
    if (icon) fs.writeFileSync(path.join(dir, "icon.png"), icon);
    fs.writeFileSync(
      path.join(dir, "costume.json"),
      JSON.stringify(
        {
          name,
          description: description || "A T-shirt made by " + me.username + ".",
          price,
          author: me.username,
          authorId: me.id,
          createdAt: new Date().toISOString(),
          shirt: { texture: "shirt.png" },
        },
        null,
        2
      ),
      "utf8"
    );
    if (isAdmin) db.addCostume(me.id, id); // the creator gets their own shirt
  } catch (err) {
    return fail(500, "Could not save the shirt: " + err.message);
  }

  res.json({ ok: true, id, published: isAdmin });
});

// The shirt picture of a published costume. Public on purpose: the game
// downloads it with a plain GET (no cookie) and it is only a clothes texture.
app.get("/costume-texture/:id", (req, res) => {
  const costume = getCostumeById(req.params.id);
  if (!costume || !costume.shirt) return res.status(404).end();
  const file = path.join(__dirname, "costumes", costume.folder, "shirt.png");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("image/png").sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// Browsing places still requires login, same as Games/Marketplace - it's
// only *opening* a builders://place link (the API routes below) that's public.
app.get("/places", requireLogin, (req, res) => {
  res.render("places", {
    user: currentUser(req),
    places: listPlaces(),
    active: "places",
  });
});

app.get("/settings", requireLogin, (req, res) => {
  res.render("settings", {
    user: currentUser(req),
    active: "settings",
    profileError: null,
    profileSuccess: null,
    passwordError: null,
    passwordSuccess: null,
  });
});

app.post("/settings/profile", requireLogin, (req, res) => {
  const username = (req.body.username || "").trim();
  const render = (profileError, profileSuccess) =>
    res.render("settings", {
      user: currentUser(req),
      active: "settings",
      profileError,
      profileSuccess,
      passwordError: null,
      passwordSuccess: null,
    });

  const nicknameError = usernameError(username);
  if (nicknameError) {
    return render(nicknameError, null);
  }
  const existing = db.findByUsername(username);
  if (existing && existing.id !== req.session.userId) {
    return render("That nickname is already taken.", null);
  }

  db.updateUsername(req.session.userId, username);
  render(null, "Nickname updated.");
});

app.post("/settings/password", requireLogin, async (req, res) => {
  const currentPassword = req.body.currentPassword || "";
  const newPassword = req.body.newPassword || "";
  const confirmPassword = req.body.confirmPassword || "";
  const user = currentUser(req);

  const render = (passwordError, passwordSuccess) =>
    res.render("settings", {
      user: currentUser(req),
      active: "settings",
      profileError: null,
      profileSuccess: null,
      passwordError,
      passwordSuccess,
    });

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return render("Current password is incorrect.", null);
  }
  if (newPassword.length < 6) {
    return render("New password must be at least 6 characters.", null);
  }
  if (newPassword !== confirmPassword) {
    return render("Passwords do not match.", null);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  db.updatePasswordHash(req.session.userId, passwordHash);
  render(null, "Password updated.");
});

// ---------------------------------------------------------------------------
// Friends + multiplayer presence
// ---------------------------------------------------------------------------

const PRESENCE_ONLINE_MS = 2 * 60 * 1000; // no report for 2 min = offline

// The room code the site puts into the builders:// link. The game just reads
// it - same code = same world.
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

// Friend rows for the website: nickname, avatar colors, live status.
function friendsPayload(user) {
  return (user.friends || [])
    .map((fid) => db.findById(fid))
    .filter(Boolean)
    .map((f) => {
      const p = f.presence;
      const online = p && Date.now() - p.updated_at < PRESENCE_ONLINE_MS;
      return {
        id: f.id,
        username: f.username,
        colors: f.colors,
        hasAvatar: f.hasAvatar,
        avatarVersion: f.avatarVersion,
        emoji: f.emoji || "",
        isSuper: db.isSuper(f),
        avatar_html: avatarHtml(f, 32),
        online: !!online,
        game_id: online ? p.game_id : null,
        room: online ? p.room : null,
      };
    });
}

app.post("/friends/remove", requireLogin, (req, res) => {
  db.removeFriend(req.session.userId, req.body.friendId);
  res.redirect("/games");
});

// JSON for the live friends refresh on the Home page (polled from JS).
app.get("/api/friends", requireLoginApi, (req, res) => {
  const user = db.findById(req.session.userId);
  res.json({ ok: true, friends: friendsPayload(user) });
});

// The game reports { game_id, room } with its session token; an empty
// body (or missing fields) clears the status (menu / quit).
app.post("/api/game/presence", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = gameSessions.get(token);
  if (!userId) return res.status(401).json({ ok: false, error: "invalid_session" });

  const { game_id, room } = req.body || {};
  if (!game_id || !room) {
    db.setPresence(userId, null);
  } else {
    db.setPresence(userId, {
      game_id: String(game_id),
      room: String(room).slice(0, 16),
    });
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Players list, player profiles, custom icons
// ---------------------------------------------------------------------------

const AVATAR_DIR = path.join(__dirname, "data", "avatars");
const DESCRIPTION_MAX = 300;

// Everybody's icon (needs a login, like the rest of the site).
app.get("/players/:id/avatar.png", requireLogin, (req, res) => {
  const target = db.findById(req.params.id);
  if (!target || !target.hasAvatar) return res.status(404).end();
  const file = path.join(AVATAR_DIR, `${target.id}.png`);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set("Cache-Control", "private, max-age=3600"); // ?v= in the URL busts this
  res.sendFile(file);
});

// Same status logic as friendsPayload (no report for 2 min = offline).
function playerRow(p) {
  const pr = p.presence;
  const online = !!(pr && Date.now() - pr.updated_at < PRESENCE_ONLINE_MS);
  return {
    id: p.id,
    username: p.username,
    colors: p.colors,
    hasAvatar: p.hasAvatar,
    avatarVersion: p.avatarVersion,
    description: p.description || "",
    emoji: p.emoji || "",
    isSuper: db.isSuper(p),
    online,
    game_id: online ? pr.game_id : null,
  };
}

// Click the nickname in the top bar -> this list.
app.get("/players", requireLogin, (req, res) => {
  const players = db
    .loadUsers()
    .map(playerRow)
    .sort((a, b) => b.online - a.online || a.username.localeCompare(b.username));
  res.render("players", { user: currentUser(req), players, active: "players" });
});

// Click a player's icon -> their profile.
app.get("/profile/:id", requireLogin, (req, res) => {
  const me = currentUser(req);
  const target = db.findById(req.params.id);
  if (!target) return res.status(404).render("info", {
    title: "Player not found",
    sections: [{ heading: "Nobody here", paragraphs: ["There is no player with this id."] }],
    user: me,
  });
  const equipped = mergeCostumes(equippedCostumesOf(target), target.colors);
  res.render("profile", {
    user: me,
    profile: playerRow(target),
    isMe: target.id === me.id,
    active: target.id === me.id ? "profile" : "players",
    lookColors: equipped ? equipped.colors : target.colors,
  });
});

app.get("/profile", requireLogin, (req, res) => res.redirect("/profile/" + req.session.userId));

// Settings: set own icon. The browser shrinks the picture to a small PNG
// and sends it as JSON { image: "data:image/png;base64,..." }.
app.post("/settings/avatar", requireLoginApi, express.json({ limit: "1mb" }), (req, res) => {
  const png = parsePngDataUrl(req.body && req.body.image);
  if (!png) return res.status(400).json({ ok: false, error: "That picture can't be used. Try another image." });
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  fs.writeFileSync(path.join(AVATAR_DIR, `${req.session.userId}.png`), png);
  const user = db.setHasAvatar(req.session.userId, true);
  res.json({ ok: true, url: `/players/${user.id}/avatar.png?v=${user.avatarVersion}` });
});

app.post("/settings/avatar/remove", requireLogin, (req, res) => {
  try {
    fs.rmSync(path.join(AVATAR_DIR, `${req.session.userId}.png`), { force: true });
  } catch {
    /* already gone */
  }
  db.setHasAvatar(req.session.userId, false);
  res.redirect("/settings?saved=icon-removed");
});

// Settings: the "about me" text shown on the profile page.
app.post("/settings/description", requireLogin, (req, res) => {
  const text = String(req.body.description || "").replace(/\r\n/g, "\n").trim().slice(0, DESCRIPTION_MAX);
  db.updateDescription(req.session.userId, text);
  res.redirect("/settings?saved=description");
});

// Settings: one emoji shown next to the nickname everywhere. Players can
// only pick from emojis/emojis.json - typing their own is not possible.
// Empty value = no emoji.
app.post("/settings/emoji", requireLogin, (req, res) => {
  const value = String(req.body.emoji || "").trim();
  if (value !== "" && !listEmojis().includes(value)) {
    return res.redirect("/settings?saved=emoji-bad");
  }
  db.updateEmoji(req.session.userId, value);
  res.redirect("/settings?saved=emoji");
});

// ---------------------------------------------------------------------------
// Create: send a game (.jrna + photo) to the gameswaiting/ folder
// ---------------------------------------------------------------------------

const WAITING_DIR = path.join(__dirname, "gameswaiting");

app.get("/create", requireLogin, (req, res) => {
  res.render("create", { user: currentUser(req), active: "create" });
});

// Body is [photo][.jrna] streamed as one request (see uploads.js).
app.post("/api/create", requireLoginApi, (req, res) => {
  handleGameUpload(req, WAITING_DIR, currentUser(req), (status, body) => {
    res.status(status).json(body);
  });
});

// Chunked upload used by the Create page (works behind proxies with upload limits
// request limit): begin -> photo -> chunk (many) -> finish.
const sendJson = (res) => (status, body) => res.status(status).json(body);
app.post("/api/create/begin", requireLoginApi, (req, res) => {
  const r = beginChunkedUpload(WAITING_DIR, currentUser(req), req.body);
  res.status(r.status).json(r.body);
});
app.post("/api/create/photo", requireLoginApi, (req, res) => handlePhotoPart(req, currentUser(req), sendJson(res)));
app.post("/api/create/chunk", requireLoginApi, (req, res) => handleGameChunk(req, currentUser(req), sendJson(res)));
app.post("/api/create/finish", requireLoginApi, (req, res) =>
  finishChunkedUpload(WAITING_DIR, currentUser(req), String((req.body && req.body.uploadId) || ""), sendJson(res)));
app.post("/api/create/cancel", requireLoginApi, (req, res) => {
  cancelChunkedUpload(currentUser(req), String((req.body && req.body.uploadId) || ""));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin: ban / unban players (only players with "admin": true in
// admins/admins.json - see admins/README.md)
// ---------------------------------------------------------------------------

const BAN_UNIT_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };
const MAX_BAN_MS = 10 * 365 * BAN_UNIT_MS.days;

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  if (!res.locals.roles.admin) {
    return res.status(403).render("info", {
      title: "No access",
      sections: [{ heading: "Admins only", paragraphs: ["This page is only for admins."] }],
      user: currentUser(req),
    });
  }
  next();
}

app.get("/admin", requireAdmin, (req, res) => {
  const players = db
    .loadUsers()
    .map((u) => ({
      id: u.id,
      username: u.username,
      emoji: u.emoji || "",
      colors: u.colors,
      hasAvatar: u.hasAvatar,
      avatarVersion: u.avatarVersion,
      ban: db.activeBan(u),
      isSuper: db.isSuper(u),
      isAdmin: rolesFor(u).admin,
    }))
    .sort((a, b) => !!b.ban - !!a.ban || a.username.localeCompare(b.username));
  res.render("admin", { user: currentUser(req), active: "admin", players, waitingGames: listWaitingGames(), waitingClothes: listWaitingClothes() });
});

// Publish a game that is waiting in gameswaiting/: the folder is MOVED into
// games/ (nothing is deleted). Old-style .exe files are renamed to .jrna and
// a missing game.json is created so the game shows up on the Games page.
app.post("/admin/games/publish/:id", requireAdmin, (req, res) => {
  const back = (type, text) => {
    req.session.flash = { type, text };
    res.redirect("/admin");
  };
  const id = String(req.params.id || "");
  const waiting = listWaitingGames().find((g) => g.id === id);
  if (!waiting) return back("error", "That game is not waiting any more.");

  const from = path.join(WAITING_DIR, waiting.id);
  const to = path.join(__dirname, "games", waiting.id);
  if (fs.existsSync(to)) return back("error", `games/${waiting.id} already exists - rename the waiting folder first.`);

  try {
    fs.mkdirSync(path.join(__dirname, "games"), { recursive: true });
    fs.renameSync(from, to);
  } catch (err) {
    // renameSync can fail across drives - copy instead, the waiting folder stays untouched
    try {
      fs.cpSync(from, to, { recursive: true, errorOnExist: true });
    } catch (err2) {
      return back("error", "Could not publish: " + err2.message);
    }
  }

  try {
    // old .exe submission -> .jrna
    if (/\.exe$/i.test(waiting.file)) {
      const base = waiting.file.slice(0, -4);
      if (!fs.existsSync(path.join(to, base + ".jrna"))) {
        fs.renameSync(path.join(to, waiting.file), path.join(to, base + ".jrna"));
      }
    }
    const metaPath = path.join(to, "game.json");
    if (!fs.existsSync(metaPath)) {
      const files = fs.readdirSync(to);
      const icon = files.find((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)) || "";
      fs.writeFileSync(
        metaPath,
        JSON.stringify({ name: waiting.name, description: "", id: waiting.id, icon, submittedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
    }
  } catch (err) {
    return back("error", "Game moved, but finishing it failed: " + err.message);
  }
  back("success", `"${waiting.name}" is published.`);
});

// Preview picture of a shirt that is still waiting (admins only).
app.get("/admin/clothing/texture/:id", requireAdmin, (req, res) => {
  const c = listWaitingClothes().find((x) => x.id === String(req.params.id));
  if (!c) return res.status(404).end();
  res.type("image/png").sendFile(path.join(CLOTHES_WAITING_DIR, c.folder, "shirt.png"));
});

app.get("/admin/clothing/icon/:id", requireAdmin, (req, res) => {
  const c = listWaitingClothes().find((x) => x.id === String(req.params.id));
  if (!c) return res.status(404).end();
  const icon = path.join(CLOTHES_WAITING_DIR, c.folder, "icon.png");
  if (fs.existsSync(icon)) return res.type("image/png").sendFile(icon);
  res.type("image/png").sendFile(path.join(CLOTHES_WAITING_DIR, c.folder, "shirt.png"));
});

// Publish a waiting shirt: the folder is MOVED into costumes/ and the
// creator gets the shirt in their inventory. The admin can set the price.
app.post("/admin/clothing/publish/:id", requireAdmin, (req, res) => {
  const back = (type, text) => {
    req.session.flash = { type, text };
    res.redirect("/admin");
  };
  const c = listWaitingClothes().find((x) => x.id === String(req.params.id || ""));
  if (!c) return back("error", "That shirt is not waiting any more.");
  const from = path.join(CLOTHES_WAITING_DIR, c.folder);
  const to = path.join(__dirname, "costumes", c.folder);
  if (fs.existsSync(to)) return back("error", `costumes/${c.folder} already exists - rename the waiting folder first.`);
  try {
    // let the admin change the price before it goes on sale
    const metaPath = path.join(from, "costume.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    let price = Math.floor(Number(req.body && req.body.price));
    if (Number.isFinite(price) && price >= 0) meta.price = Math.min(price, 10000);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
    fs.mkdirSync(path.join(__dirname, "costumes"), { recursive: true });
    try {
      fs.renameSync(from, to);
    } catch {
      fs.cpSync(from, to, { recursive: true, errorOnExist: true }); // other drive - the waiting copy stays
    }
    if (c.authorId && db.findById(c.authorId)) db.addCostume(c.authorId, c.folder);
  } catch (err) {
    return back("error", "Could not publish: " + err.message);
  }
  back("success", `"${c.name}" is published.`);
});

// Reject: nothing is deleted - the folder moves to clothingrejected/.
app.post("/admin/clothing/reject/:id", requireAdmin, (req, res) => {
  const back = (type, text) => {
    req.session.flash = { type, text };
    res.redirect("/admin");
  };
  const c = listWaitingClothes().find((x) => x.id === String(req.params.id || ""));
  if (!c) return back("error", "That shirt is not waiting any more.");
  try {
    fs.mkdirSync(CLOTHES_REJECTED_DIR, { recursive: true });
    fs.renameSync(path.join(CLOTHES_WAITING_DIR, c.folder), path.join(CLOTHES_REJECTED_DIR, c.folder));
  } catch (err) {
    return back("error", "Could not reject: " + err.message);
  }
  back("success", `"${c.name}" was rejected (moved to clothingrejected/).`);
});

app.post("/admin/ban/:id", requireAdmin, (req, res) => {
  const me = currentUser(req);
  const target = db.findById(req.params.id);
  const back = (type, text) => {
    req.session.flash = { type, text };
    res.redirect("/admin");
  };

  if (!target) return back("error", "Player not found.");
  if (target.id === me.id) return back("error", "You can't ban yourself.");
  if (rolesFor(target).admin) return back("error", "You can't ban another admin.");

  let until = null; // null = forever
  let label = "forever";
  if (req.body.unit !== "forever") {
    const mult = BAN_UNIT_MS[req.body.unit];
    const amount = Math.floor(Number(req.body.amount));
    if (!mult || !Number.isFinite(amount) || amount < 1) {
      return back("error", "Enter how long (a number of minutes, hours or days).");
    }
    if (amount * mult > MAX_BAN_MS) return back("error", "That ban is too long (max 10 years). Use \"forever\" instead.");
    until = Date.now() + amount * mult;
    label = `for ${amount} ${req.body.unit}`;
  }

  const reason = String(req.body.reason || "").trim().slice(0, 200);
  db.banUser(target.id, until, reason, me.id);

  // kick them out of the game too: their game session tokens stop working
  gameSessions.deleteForUser(target.id);
  back("success", `${target.username} was banned ${label}.`);
});

app.post("/admin/unban/:id", requireAdmin, (req, res) => {
  const target = db.findById(req.params.id);
  if (target) {
    db.unbanUser(target.id);
    req.session.flash = { type: "success", text: `${target.username} was unbanned.` };
  }
  res.redirect("/admin");
});

// ---------------------------------------------------------------------------
// Forum: players post, others comment. Players with "forumadmin": true in
// admins/admins.json can delete posts and comments.
// ---------------------------------------------------------------------------

const lastAction = new Map(); // "userId:kind" -> timestamp (spam guard)
function tooFast(userId, kind, ms) {
  const key = userId + ":" + kind;
  if (Date.now() - (lastAction.get(key) || 0) < ms) return true;
  lastAction.set(key, Date.now());
  return false;
}

function authorView(usersById, id, withRoles) {
  const u = usersById.get(id);
  if (!u) return { id, username: "[deleted]", emoji: "", isSuper: false, hasAvatar: false, avatarVersion: 0, colors: null, roles: NO_ROLES };
  return {
    id: u.id,
    username: u.username,
    emoji: u.emoji || "",
    isSuper: db.isSuper(u),
    hasAvatar: u.hasAvatar,
    avatarVersion: u.avatarVersion,
    colors: u.colors,
    roles: withRoles ? rolesFor(u) : NO_ROLES,
  };
}

app.get("/forum", requireLogin, (req, res) => {
  const users = new Map(db.loadUsers().map((u) => [u.id, u]));
  const posts = forum.listPosts().slice(0, 200).map((p) => ({
    id: p.id,
    title: p.title,
    preview: p.body.length > 160 ? p.body.slice(0, 160) + "..." : p.body,
    createdAt: p.createdAt,
    commentCount: p.comments.length,
    hasImage: !!p.imageExt,
    author: authorView(users, p.authorId, false),
  }));
  res.render("forum", { user: currentUser(req), active: "forum", posts });
});

// New post. Sent by the page's JS as JSON: { title, body, image? } where
// image is a JPEG data URL (the browser shrinks it first).
app.post("/forum/post", requireLoginApi, express.json({ limit: "3mb" }), (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  const body = String(b.body || "").replace(/\r\n/g, "\n").trim();
  const fail = (status, error) => res.status(status).json({ ok: false, error });

  if (title.length < 3 || title.length > 100) return fail(400, "Title must be 3 to 100 characters.");
  if (body.length > 5000) return fail(400, "The text is too long (max 5000 characters).");
  let image = null;
  if (b.image) {
    image = parseJpegDataUrl(b.image);
    if (!image) return fail(400, "That picture can't be used. Try another one.");
  }
  if (!body && !image) return fail(400, "Write something or add a picture.");
  if (tooFast(req.session.userId, "post", 30 * 1000)) return fail(429, "Slow down - you can post once every 30 seconds.");

  const post = forum.createPost({ authorId: req.session.userId, title, body, image });
  res.json({ ok: true, id: post.id });
});

app.get("/forum/:id([a-f0-9]{12})", requireLogin, (req, res) => {
  const post = forum.getPost(req.params.id);
  if (!post) return res.redirect("/forum");
  const users = new Map(db.loadUsers().map((u) => [u.id, u]));
  res.render("forum-post", {
    user: currentUser(req),
    active: "forum",
    post,
    author: authorView(users, post.authorId, true),
    comments: post.comments.map((c) => ({ ...c, author: authorView(users, c.authorId, true) })),
    canModerate: res.locals.roles.forumadmin,
  });
});

app.get("/forum/:id([a-f0-9]{12})/image", requireLogin, (req, res) => {
  const file = forum.imagePath(forum.getPost(req.params.id));
  if (!file) return res.status(404).end();
  res.sendFile(file);
});

app.post("/forum/:id([a-f0-9]{12})/comment", requireLogin, (req, res) => {
  const post = forum.getPost(req.params.id);
  if (!post) return res.redirect("/forum");
  const body = String(req.body.body || "").replace(/\r\n/g, "\n").trim();
  const back = () => res.redirect(`/forum/${post.id}#comments`);

  if (body.length < 1 || body.length > 1000) {
    req.session.flash = { type: "error", text: "A comment must be 1 to 1000 characters." };
    return back();
  }
  if (tooFast(req.session.userId, "comment", 10 * 1000)) {
    req.session.flash = { type: "error", text: "Slow down - one comment every 10 seconds." };
    return back();
  }
  forum.addComment(post.id, { authorId: req.session.userId, body });
  back();
});

function requireForumAdmin(req, res, next) {
  if (!res.locals.roles.forumadmin) return res.status(403).send("Forum admins only.");
  next();
}

app.post("/forum/:id([a-f0-9]{12})/delete", requireLogin, requireForumAdmin, (req, res) => {
  forum.deletePost(req.params.id);
  res.redirect("/forum");
});

app.post("/forum/:id([a-f0-9]{12})/comment/:cid([a-f0-9]{12})/delete", requireLogin, requireForumAdmin, (req, res) => {
  forum.deleteComment(req.params.id, req.params.cid);
  res.redirect(`/forum/${req.params.id}#comments`);
});

// Alias so "/home" also opens the (renamed) Games page.
app.get("/home", requireLogin, (req, res) => res.redirect("/games"));

// ---------------------------------------------------------------------------
// API for the Godot game (matches site_login.gd from earlier)
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const pendingCodes = new Map(); // code -> { userId, expiresAt }

// Game session tokens survive a site restart (so a player who logged in once
// with their account stays logged in in the game). Stored hashed in
// data/game_sessions.json, valid for 30 days. Same get/set/delete API as a
// Map keyed by the raw token.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSIONS_FILE = path.join(__dirname, "data", "game_sessions.json");
const sha256 = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const gameSessions = {
  map: new Map(), // sha256(token) -> { userId, createdAt }
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8").replace(/^\uFEFF/, ""));
      for (const [h, v] of Object.entries(raw)) if (v && v.userId) this.map.set(h, v);
    } catch { /* no file yet */ }
  },
  save() {
    try {
      fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(this.map)), "utf8");
    } catch (e) { console.error("could not save game sessions:", e.message); }
  },
  get(token) {
    if (!token) return undefined;
    const h = sha256(token);
    const v = this.map.get(h);
    if (!v) return undefined;
    if (Date.now() - v.createdAt > SESSION_TTL_MS) { this.map.delete(h); this.save(); return undefined; }
    return v.userId;
  },
  set(token, userId) { this.map.set(sha256(token), { userId, createdAt: Date.now() }); this.save(); },
  delete(token) { if (this.map.delete(sha256(token))) this.save(); },
  deleteForUser(userId) {
    let changed = false;
    for (const [h, v] of this.map) if (v.userId === userId) { this.map.delete(h); changed = true; }
    if (changed) this.save();
  },
};
gameSessions.load();

function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

// Called from the WEBSITE (the "Get code" button on the Settings page).
app.post("/api/create-login-code", requireLoginApi, (req, res) => {
  const code = generateCode();
  pendingCodes.set(code, {
    userId: req.session.userId,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  res.json({ ok: true, code, expires_in_seconds: CODE_TTL_MS / 1000 });
});

// Failed password attempts from the game (in memory): 10 per 10 minutes for
// each nickname and for each IP, so nobody can brute-force passwords here.
const loginFails = new Map(); // key -> [timestamps]
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
function loginBlocked(keys) {
  const now = Date.now();
  return keys.some((k) => {
    const list = (loginFails.get(k) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
    loginFails.set(k, list);
    return list.length >= LOGIN_MAX_FAILS;
  });
}
function noteLoginFail(keys) {
  for (const k of keys) loginFails.set(k, [...(loginFails.get(k) || []), Date.now()]);
}

// Called from the GAME. Three ways to log in:
//   { "username": "...", "password": "..." }  - the account itself (recommended:
//                                               the player types it once in the game)
//   { "code": "123456" }                      - old one-time code from the website
// Both return { ok, username, colors, ..., session_token }. The game saves
// session_token on disk and next time just calls GET /api/profile with it
// (Authorization: Bearer <token>) - no code and no password needed again.
app.post("/api/game-login", async (req, res) => {
  const { code, username, password } = req.body || {};
  let user = null;

  if (username !== undefined || password !== undefined) {
    const name = String(username || "").trim();
    const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
    const keys = ["u:" + name.toLowerCase(), "ip:" + ip];
    if (!name || typeof password !== "string" || !password) {
      return res.status(400).json({ ok: false, error: "missing_credentials" });
    }
    if (loginBlocked(keys)) {
      return res.status(429).json({ ok: false, error: "too_many_attempts" });
    }
    const found = db.findByUsername(name);
    if (!found || !(await bcrypt.compare(password, found.passwordHash))) {
      noteLoginFail(keys);
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }
    user = found;
  } else {
    const entry = code ? pendingCodes.get(String(code)) : null;
    if (!entry || entry.expiresAt < Date.now()) {
      return res.status(400).json({ ok: false, error: "invalid_or_expired_code" });
    }
    pendingCodes.delete(String(code)); // one-time use
    user = db.findById(entry.userId);
    if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });
  }

  if (db.activeBan(user)) {
    return res.status(403).json({ ok: false, error: "banned", message: banMessage(db.activeBan(user)) });
  }

  const token = crypto.randomBytes(32).toString("hex");
  gameSessions.set(token, user.id);

  res.json({
    ...gameProfilePayload(user),
    session_token: token,
  });
});

// The game's "Log out" button: forgets the saved session on the server too.
app.post("/api/game-logout", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  gameSessions.delete(token);
  res.json({ ok: true });
});

// Optional: the game can refresh the profile later with the session token.
app.get("/api/profile", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = gameSessions.get(token);
  if (!userId) return res.status(401).json({ ok: false, error: "invalid_session" });

  const user = db.findById(userId);
  if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });
  res.json(gameProfilePayload(user));
});

// The game can change its nickname using the session token (in-game rename).
app.post("/api/game/username", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = gameSessions.get(token);
  if (!userId) return res.status(401).json({ ok: false, error: "invalid_session" });

  const username = String((req.body && req.body.username) || "").trim();
  const nicknameError = usernameError(username);
  if (nicknameError) {
    return res.status(400).json({ ok: false, error: "invalid_username" });
  }
  const existing = db.findByUsername(username);
  if (existing && existing.id !== userId) {
    return res.status(409).json({ ok: false, error: "username_taken" });
  }
  const user = db.updateUsername(userId, username);
  res.json(gameProfilePayload(user));
});

// The game can equip/unequip a costume using its session token.
app.post("/api/game/equip-costume", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = gameSessions.get(token);
  if (!userId) return res.status(401).json({ ok: false, error: "invalid_session" });

  // costume_id: null = take everything off; an id = put it on (max 3 at
  // once). Extra: { "costume_id": "...", "unequip": true } takes off just that one.
  const costumeId = req.body && req.body.costume_id !== undefined ? req.body.costume_id : null;
  if (costumeId !== null && !getCostumeById(costumeId)) {
    return res.status(404).json({ ok: false, error: "costume_not_found" });
  }
  let user;
  if (costumeId !== null && req.body.unequip === true) {
    user = db.unequipCostume(userId, costumeId);
    if (!user) return res.status(400).json({ ok: false, error: "not_owned" });
  } else {
    user = db.equipCostume(userId, costumeId);
    if (!user) {
      const me = db.findById(userId);
      const full = me && costumeId !== null && me.ownedCostumes.includes(costumeId);
      return res.status(400).json({ ok: false, error: full ? "slots_full" : "not_owned" });
    }
  }

  res.json(gameProfilePayload(user));
});

// ---------------------------------------------------------------------------
// In-game shop: buy costumes/animations with SITE COINS from inside the
// game. Same Bearer session token as /api/profile - the game logged in
// via /api/game-login, so it never sees the browser cookie. Prices always
// come from catalog.js (the costumes//animations folders), never the game.
// ---------------------------------------------------------------------------

// The game's coin balance (for the shop UI header).
app.get("/api/game/coins", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = gameSessions.get(token);
  if (!userId) return res.status(401).json({ ok: false, error: "invalid_session" });

  const user = db.findById(userId);
  if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });
  res.json({ ok: true, coins: user.coins });
});

// Everything on sale right now. Public: no token needed, prices must be
// identical in the browser marketplace and in the game.
app.get("/api/game/shop", (req, res) => {
  res.json({ ok: true, costumes: listCostumes(), animations: listAnimations() });
});

// Buy a costume with coins. Body: { "costume_id": "ninja" }
app.post("/api/game/buy-costume", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = gameSessions.get(token);
  if (!userId) return res.status(401).json({ ok: false, error: "invalid_session" });

  const costume = getCostumeById((req.body && req.body.costume_id) || "");
  if (!costume) return res.status(404).json({ ok: false, error: "costume_not_found" });

  const user = db.findById(userId);
  if (user.ownedCostumes.includes(costume.id)) {
    return res.status(400).json({ ok: false, error: "already_owned" });
  }
  if (costume.offsale) return res.status(400).json({ ok: false, error: "offsale" });

  const price = db.priceFor(user, costume.price || 0); // Pluse: -10%
  if (price > 0 && !db.spendCoins(userId, price)) {
    return res.status(400).json({ ok: false, error: "not_enough_coins", coins: user.coins });
  }

  db.addCostume(userId, costume.id);
  res.json(gameProfilePayload(db.findById(userId)));
});

// Buy an animation with coins. Body: { "animation_id": "dance" }
app.post("/api/game/buy-animation", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = gameSessions.get(token);
  if (!userId) return res.status(401).json({ ok: false, error: "invalid_session" });

  const animation = getAnimationById((req.body && req.body.animation_id) || "");
  if (!animation) return res.status(404).json({ ok: false, error: "animation_not_found" });

  const user = db.findById(userId);
  if (user.ownedAnimations.includes(animation.id)) {
    return res.status(400).json({ ok: false, error: "already_owned" });
  }
  if (animation.offsale) return res.status(400).json({ ok: false, error: "offsale" });

  const price = db.priceFor(user, animation.price || 0); // Pluse: -10%
  if (price > 0 && !db.spendCoins(userId, price)) {
    return res.status(400).json({ ok: false, error: "not_enough_coins", coins: user.coins });
  }

  db.addAnimation(userId, animation.id);
  res.json(gameProfilePayload(db.findById(userId)));
});

// ---------------------------------------------------------------------------
// Public place API (matches builders://place?id=... - see places/README.md
// and GODOT-DEEP-LINK.md). Deliberately NOT behind requireLoginApi: anyone
// who has a place's id can fetch it, no code/session needed.
// ---------------------------------------------------------------------------

app.get("/api/places/:id", (req, res) => {
  const place = getPlaceById(req.params.id);
  if (!place) return res.status(404).json({ ok: false, error: "not_found" });
  res.json({
    ok: true,
    id: place.id,
    name: place.name,
    description: place.description,
    file: place.file,
  });
});

app.get("/api/places/:id/file", (req, res) => {
  const place = getPlaceById(req.params.id);
  if (!place || !place.file) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const filePath = path.join(__dirname, "places", place.folder, place.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "file_missing" });
  }

  res.download(filePath, place.file);
});

if (envInfo.found) {
  console.log("[env] settings loaded from " + envInfo.ENV_PATH);
  if (envInfo.usedName !== ".env") {
    console.log("[env] WARNING: the file is called '" + envInfo.usedName + "' - rename it to exactly .env (turn on 'File name extensions' in Explorer's View menu)");
  }
} else {
  console.log("[env] settings file NOT FOUND in: " + envInfo.DIR);
  console.log("[env] files in that folder with 'env' in the name: " + (envInfo.similarFiles().join(", ") || "(none)"));
}
console.log("[env] PayPal: " + (payments.configured() ? "OK (real money)" : "NOT set up") +
  " | E-mail: " + (mailConfigured() ? "OK" : "NOT set up") +
  " | BASE_URL: " + (process.env.BASE_URL || "(empty)"));

// ---------------------------------------------------------------------------
// Multiplayer: 5 servers per game, 100 servers for all games, hosted right
// here (WebSocket on the same port, path /mp). See multiplayer.js.
// ---------------------------------------------------------------------------
const multiplayer = require("./multiplayer");

// The 5 servers of a game with live player counts (site + game both use it).
app.get("/api/servers/:gameId", (req, res) => {
  if (!getGameById(req.params.gameId)) return res.status(404).json({ ok: false, error: "unknown_game" });
  const list = multiplayer.listServers(req.params.gameId);
  if (!list) return res.status(503).json({ ok: false, error: "no_server_slots" });
  res.json({ ok: true, game_id: req.params.gameId, max_players: multiplayer.MAX_PLAYERS, servers: list });
});

app.get("/api/servers", (req, res) => res.json({ ok: true, ...multiplayer.stats() }));

const httpServer = app.listen(PORT, () => {
  console.log(`Builders site running: http://localhost:${PORT}`);
  console.log(`Multiplayer: ws://localhost:${PORT}/mp  (${multiplayer.SERVERS_PER_GAME} servers/game, ${multiplayer.MAX_TOTAL_SERVERS} total)`);
});
multiplayer.attach(httpServer, {
  userFromToken: (token) => {
    const uid = gameSessions.get(token);
    return uid ? db.findById(uid) : null;
  },
  profileOf: (user) => {
    const p = gameProfilePayload(user);
    return { username: p.username, colors: (p.equipped_costume && p.equipped_costume.colors) || p.colors };
  },
  gameExists: (id) => !!getGameById(id),
});

// ---------------------------------------------------------------------------
// Games files host on http://localhost:4000 - serves the games/ folder as
// plain files (e.g. http://localhost:4000/test-level/test-level.exe), so
// the desktop launcher can download game builds straight from the site.
// This replaces the old start_games_host.bat + builders_launcher.py combo -
// it starts automatically together with the site, no extra window needed.
// Browsing to http://localhost:4000/ shows a directory listing ("dir") of
// the games folder and its subfolders.
// ---------------------------------------------------------------------------

const GAMES_PORT = process.env.GAMES_PORT || 4000;
const GAMES_DIR = path.join(__dirname, "games");

const gamesHost = express();

// Directory listing for the games dir and any subfolder (that's the "dir"
// view). Plain files are handled by express.static below.
function dirListingHtml(dir, requestPath) {
  const rows = dirListingEntries(dir)
    .map((e) => {
      const suffix = e.dir ? "/" : "";
      const href = encodeURIComponent(e.name) + suffix;
      return `<li><a href="${href}">${e.name}${suffix}</a></li>`;
    })
    .join("");
  const up = requestPath !== "/" ? '<li><a href="../">../</a></li>' : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>games${requestPath}</title>
<style>body{font-family:sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem}li{margin:.25rem 0}</style>
</head><body>
<h1>games${requestPath}</h1>
<ul>${up}${rows}</ul>
</body></html>`;
}

function dirListingEntries(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => b.isDirectory() - a.isDirectory() || a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, dir: e.isDirectory() }));
}

gamesHost.use((req, res, next) => {
  // Block path traversal, then show a listing if the URL points at a folder.
  const target = path.normalize(path.join(GAMES_DIR, decodeURIComponent(req.path)));
  if (!target.startsWith(GAMES_DIR)) return res.status(403).end();
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    try {
      // The desktop launcher asks for the machine-readable version
      // (?json=1) so it can discover which .exe files live here.
      const wantsJson =
        req.query.json === "1" || (req.headers.accept || "").includes("application/json");
      if (wantsJson) {
        return res.json({
          path: req.path.endsWith("/") ? req.path : req.path + "/",
          entries: dirListingEntries(target),
        });
      }
      return res.type("html").send(dirListingHtml(target, req.path.endsWith("/") ? req.path : req.path + "/"));
    } catch {
      return res.status(500).end();
    }
  }
  next();
});

gamesHost.use(express.static(GAMES_DIR, { index: false, dotfiles: "ignore" }));

gamesHost.listen(GAMES_PORT, () => {
  console.log(`Games dir host running: http://localhost:${GAMES_PORT}`);
});
