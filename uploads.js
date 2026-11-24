// uploads.js - file uploads WITHOUT extra npm packages (no multer needed).
//
// 1) Game submissions (/create): the browser sends ONE request whose body is
//    [photo bytes][.jrna bytes], with the metadata in headers. A .jrna can be
//    any type (HTML page or exe) - it is stored exactly as sent. The .jrna is
//    streamed straight to disk (never held in memory), so big games are fine.
//    Result: gameswaiting/<id>/<id>.jrna + <id>.<png|jpg|webp|gif> + game.json
//    - the folder has the same layout as games/<id>/, so approving a game is
//    just moving its folder from gameswaiting/ into games/.
//
// 2) Profile icons: the browser shrinks the picture to a small PNG and sends
//    it as a data URL (see parsePngDataUrl).

const fs = require("fs");
const path = require("path");

const MAX_GAME_BYTES = 1024 * 1024 * 1024; // 1 GB
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_AVATAR_BYTES = 512 * 1024; // 512 KB (after the browser shrinks it)

// Looks at the first bytes of a file to find out what image it really is.
function sniffImage(buf) {
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 6 && (buf.slice(0, 6).toString("latin1") === "GIF87a" || buf.slice(0, 6).toString("latin1") === "GIF89a")) return "gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

// A .jrna can be ANY kind of game file: an HTML page (opened inside the
// launcher's own window) or a Windows program (a renamed .exe, starts with
// "MZ"). Nothing is rejected by content - this only labels it for game.json.
function sniffJrna(buf) {
  return buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a ? "exe" : "html";
}

// "data:image/png;base64,...." -> Buffer (only real PNGs are accepted).
function parsePngDataUrl(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length === 0 || buf.length > MAX_AVATAR_BYTES) return null;
  if (sniffImage(buf) !== "png") return null;
  return buf;
}

// "data:image/jpeg;base64,...." -> { buf, ext } (forum pictures; the browser
// converts whatever the player picked to a JPEG first).
const MAX_FORUM_IMAGE_BYTES = 1536 * 1024;
function parseJpegDataUrl(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length === 0 || buf.length > MAX_FORUM_IMAGE_BYTES) return null;
  if (sniffImage(buf) !== "jpg") return null;
  return { buf, ext: "jpg" };
}

// Clothes: a PNG data URL of an exact size (the 585x559 shirt template).
// Reads width/height straight from the PNG header. Returns a Buffer or null.
const MAX_CLOTHES_BYTES = 900 * 1024;
function parseClothesPngDataUrl(dataUrl, width, height) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 33 || buf.length > MAX_CLOTHES_BYTES) return null;
  if (sniffImage(buf) !== "png") return null;
  if (buf.slice(12, 16).toString("latin1") !== "IHDR") return null;
  if (buf.readUInt32BE(16) !== width || buf.readUInt32BE(20) !== height) return null;
  return buf;
}

// Turns a game title into a safe folder/file name ("My Game!" -> "my-game").
function slugify(text) {
  const s = String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "game";
}

function decodeHeader(value, maxLen) {
  try {
    return decodeURIComponent(String(value || "")).trim().slice(0, maxLen);
  } catch {
    return "";
  }
}

function rmDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* nothing to clean */
  }
}

// Handles POST /api/create. `waitingDir` is the gameswaiting/ folder.
// Calls `respond(status, jsonBody)` exactly once.
function handleGameUpload(req, waitingDir, user, respond) {
  let done = false;
  const finish = (status, body, cleanupDir) => {
    if (done) return;
    done = true;
    if (cleanupDir) rmDir(cleanupDir);
    respond(status, body);
  };

  const name = decodeHeader(req.headers["x-game-name"], 60);
  const description = decodeHeader(req.headers["x-game-desc"], 500);
  const photoSize = parseInt(req.headers["x-photo-size"], 10);
  const totalSize = parseInt(req.headers["content-length"], 10);

  if (name.length < 2) return finish(400, { ok: false, error: "Enter a game name (2-60 characters)." });
  if (!Number.isInteger(photoSize) || photoSize <= 0 || photoSize > MAX_PHOTO_BYTES) {
    return finish(400, { ok: false, error: "The photo is missing or bigger than 5 MB." });
  }
  if (!Number.isInteger(totalSize) || totalSize <= photoSize) {
    return finish(400, { ok: false, error: "The .jrna file is missing." });
  }
  if (totalSize - photoSize > MAX_GAME_BYTES) {
    return finish(413, { ok: false, error: "The .jrna is bigger than 1 GB." });
  }

  // Unique folder: <slug>, then <slug>-2, <slug>-3 ... if it already exists.
  fs.mkdirSync(waitingDir, { recursive: true });
  const base = slugify(name);
  let id = base;
  for (let i = 2; fs.existsSync(path.join(waitingDir, id)); i++) id = `${base}-${i}`;
  const dir = path.join(waitingDir, id);
  fs.mkdirSync(dir);

  const exePath = path.join(dir, `${id}.jrna`);
  const exeStream = fs.createWriteStream(exePath);
  const photoChunks = [];
  let photoGot = 0;
  let exeGot = 0;
  let exeHeaderChecked = false;
  let jrnaKind = "html";
  let failed = false;

  const fail = (status, message) => {
    if (failed) return;
    failed = true;
    req.unpipe();
    req.removeAllListeners("data");
    exeStream.destroy();
    // wait for the file handle to close before deleting (needed on Windows)
    exeStream.once("close", () => finish(status, { ok: false, error: message }, dir));
    // drain the rest of the upload so the browser gets our answer
    req.resume();
  };

  exeStream.on("error", () => fail(500, "Could not save the file on the server."));
  req.on("error", () => fail(400, "Upload interrupted."));
  req.on("aborted", () => fail(400, "Upload interrupted."));

  req.on("data", (chunk) => {
    if (failed) return;

    // first `photoSize` bytes = the photo
    if (photoGot < photoSize) {
      const take = Math.min(photoSize - photoGot, chunk.length);
      photoChunks.push(chunk.slice(0, take));
      photoGot += take;
      chunk = chunk.slice(take);
      if (chunk.length === 0) return;
    }

    // everything after = the .jrna game file
    if (!exeHeaderChecked) {
      jrnaKind = sniffJrna(chunk); // any content is accepted (html or exe)
      exeHeaderChecked = true;
    }
    exeGot += chunk.length;
    if (exeGot > MAX_GAME_BYTES) return fail(413, "The .jrna is bigger than 1 GB.");
    if (!exeStream.write(chunk)) {
      req.pause();
      exeStream.once("drain", () => req.resume());
    }
  });

  req.on("end", () => {
    if (failed) return;
    if (photoGot !== photoSize || exeGot === 0) return fail(400, "The upload was incomplete.");

    const photo = Buffer.concat(photoChunks);
    const ext = sniffImage(photo);
    if (!ext) return fail(400, "The photo must be a PNG, JPG, WEBP or GIF image.");

    exeStream.end(() => {
      try {
        fs.writeFileSync(path.join(dir, `${id}.${ext}`), photo);
        fs.writeFileSync(
          path.join(dir, "game.json"),
          JSON.stringify(
            {
              name,
              description,
              id,
              author: user.username,
              authorId: user.id,
              submittedAt: new Date().toISOString(),
              icon: `${id}.${ext}`,
              type: jrnaKind,
            },
            null,
            2
          ),
          "utf8"
        );
      } catch {
        return finish(500, { ok: false, error: "Could not save the files on the server." }, dir);
      }
      finish(200, { ok: true, id, folder: `gameswaiting/${id}` });
    });
  });
}


// ---------------------------------------------------------------------------
// Chunked game upload (/api/create/begin -> photo -> chunk x N -> finish).
// Needed because some reverse proxies refuse any
// single request bigger than 100 MB (HTTP 413) - so the browser sends the
// .jrna in small pieces and the server glues them together.
// Pieces are written to gameswaiting/.uploads/<uploadId>/ and only moved to
// gameswaiting/<game-id>/ when the upload is complete.
// ---------------------------------------------------------------------------
const crypto = require("crypto");
const CHUNK_SIZE = 20 * 1024 * 1024; // what the browser is told to send
const CHUNK_MAX = 32 * 1024 * 1024; // what the server accepts per request
const chunkSessions = new Map(); // uploadId -> session

function sessionFor(id, user) {
  const s = chunkSessions.get(String(id || ""));
  return s && s.userId === user.id ? s : null;
}

function beginChunkedUpload(waitingDir, user, body) {
  const name = String((body && body.name) || "").trim().slice(0, 60);
  const description = String((body && body.description) || "").trim().slice(0, 500);
  if (name.length < 2) return { status: 400, body: { ok: false, error: "Enter a game name (2-60 characters)." } };
  const uploadId = crypto.randomBytes(12).toString("hex");
  const dir = path.join(waitingDir, ".uploads", uploadId);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return { status: 500, body: { ok: false, error: "Could not save the file on the server." } };
  }
  chunkSessions.set(uploadId, {
    userId: user.id, username: user.username, name, description, dir,
    partPath: path.join(dir, "game.part"), size: 0, kind: "html", photo: null, photoExt: null,
  });
  return { status: 200, body: { ok: true, uploadId, chunkSize: CHUNK_SIZE } };
}

// Reads a small request body (<= max bytes) into one Buffer.
function readBody(req, max, cb) {
  const chunks = [];
  let got = 0;
  let over = false;
  req.on("data", (c) => {
    got += c.length;
    if (got > max) { over = true; chunks.length = 0; return; }
    if (!over) chunks.push(c);
  });
  req.on("error", () => cb(new Error("interrupted")));
  req.on("aborted", () => cb(new Error("interrupted")));
  req.on("end", () => cb(over ? new Error("too_big") : null, Buffer.concat(chunks)));
}

function handlePhotoPart(req, user, respond) {
  const s = sessionFor(req.query.id, user);
  if (!s) return respond(404, { ok: false, error: "Upload not found - start again." });
  readBody(req, MAX_PHOTO_BYTES, (err, buf) => {
    if (err && err.message === "too_big") return respond(400, { ok: false, error: "The photo is missing or bigger than 5 MB." });
    if (err) return respond(400, { ok: false, error: "Upload interrupted." });
    const ext = sniffImage(buf);
    if (!ext) return respond(400, { ok: false, error: "The photo must be a PNG, JPG, WEBP or GIF image." });
    s.photo = buf;
    s.photoExt = ext;
    respond(200, { ok: true });
  });
}

function handleGameChunk(req, user, respond) {
  const s = sessionFor(req.query.id, user);
  if (!s) return respond(404, { ok: false, error: "Upload not found - start again." });
  const offset = parseInt(req.query.offset, 10);
  if (!Number.isInteger(offset) || offset !== s.size) {
    // out of sync (e.g. a retried chunk): tell the browser where we are
    req.resume();
    return respond(409, { ok: false, error: "Chunk out of order.", size: s.size });
  }
  readBody(req, CHUNK_MAX, (err, buf) => {
    if (err && err.message === "too_big") return respond(413, { ok: false, error: "Chunk too big." });
    if (err) return respond(400, { ok: false, error: "Upload interrupted." });
    if (buf.length === 0) return respond(400, { ok: false, error: "Empty chunk." });
    if (s.size === 0) s.kind = sniffJrna(buf); // any content is accepted (html or exe)
    if (s.size + buf.length > MAX_GAME_BYTES) {
      chunkSessions.delete(req.query.id);
      rmDir(s.dir);
      return respond(413, { ok: false, error: "The .jrna is bigger than 1 GB." });
    }
    try {
      fs.appendFileSync(s.partPath, buf);
    } catch {
      return respond(500, { ok: false, error: "Could not save the file on the server." });
    }
    s.size += buf.length;
    respond(200, { ok: true, size: s.size });
  });
}

function finishChunkedUpload(waitingDir, user, uploadId, respond) {
  const s = sessionFor(uploadId, user);
  if (!s) return respond(404, { ok: false, error: "Upload not found - start again." });
  if (!s.photo) return respond(400, { ok: false, error: "The photo is missing." });
  if (s.size < 1) return respond(400, { ok: false, error: "The .jrna file is missing." });

  const base = slugify(s.name);
  let id = base;
  for (let i = 2; fs.existsSync(path.join(waitingDir, id)); i++) id = `${base}-${i}`;
  const dir = path.join(waitingDir, id);
  try {
    fs.mkdirSync(dir);
    fs.renameSync(s.partPath, path.join(dir, `${id}.jrna`));
    fs.writeFileSync(path.join(dir, `${id}.${s.photoExt}`), s.photo);
    fs.writeFileSync(
      path.join(dir, "game.json"),
      JSON.stringify(
        { name: s.name, description: s.description, id, author: s.username, authorId: s.userId,
          submittedAt: new Date().toISOString(), icon: `${id}.${s.photoExt}`, type: s.kind },
        null, 2
      ),
      "utf8"
    );
  } catch {
    rmDir(dir);
    return respond(500, { ok: false, error: "Could not save the files on the server." });
  }
  chunkSessions.delete(uploadId);
  rmDir(s.dir);
  respond(200, { ok: true, id, folder: `gameswaiting/${id}` });
}

function cancelChunkedUpload(user, uploadId) {
  const s = sessionFor(uploadId, user);
  if (!s) return;
  chunkSessions.delete(uploadId);
  rmDir(s.dir);
}

module.exports = { beginChunkedUpload, handlePhotoPart, handleGameChunk, finishChunkedUpload, cancelChunkedUpload, handleGameUpload, parsePngDataUrl, parseClothesPngDataUrl, parseJpegDataUrl, sniffImage, sniffJrna, slugify, MAX_AVATAR_BYTES };
