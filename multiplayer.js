// multiplayer.js - game servers that live INSIDE the site process.
//
//  * 100 servers in total for ALL games (MAX_TOTAL_SERVERS).
//  * Every game gets 5 servers (SERVERS_PER_GAME), created the first time
//    the game is asked for. 100 / 5 = 20 games can have servers.
//  * A server = a room of up to MAX_PLAYERS players. Everybody on the same
//    (game, server) sees each other (positions, nickname, colors).
//  * Transport: plain WebSocket on the same port as the site (path /mp), so
//    no extra program and no extra port - it starts together with `npm start`.
//    No npm packages needed (tiny RFC6455 implementation below).
//
// Godot connects to:  ws://<site host>:<port>/mp   (wss:// behind https)
// Protocol: see SUMMER_AI_TASK.md.

const crypto = require("crypto");

const SERVERS_PER_GAME = Number(process.env.SERVERS_PER_GAME || 5);
const MAX_TOTAL_SERVERS = Number(process.env.MAX_TOTAL_SERVERS || 100);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS_PER_SERVER || 20);
const MAX_MSG_BYTES = 8 * 1024;
const MSG_PER_SEC = 40; // per player, anti-flood

// gameId -> [ { n: 1..5, players: Map(id -> player) } x5 ]
const games = new Map();
let totalServers = 0;

function serversFor(gameId) {
  gameId = String(gameId || "").slice(0, 64);
  if (!gameId) return null;
  let list = games.get(gameId);
  if (list) return list;
  if (totalServers + SERVERS_PER_GAME > MAX_TOTAL_SERVERS) return null; // all 100 are taken
  list = [];
  for (let n = 1; n <= SERVERS_PER_GAME; n++) list.push({ n, players: new Map() });
  games.set(gameId, list);
  totalServers += SERVERS_PER_GAME;
  return list;
}

// For the site / launcher: the 5 servers of a game with live counts.
function listServers(gameId) {
  const list = serversFor(gameId);
  if (!list) return null;
  return list.map((s) => ({
    server: s.n,
    room: "S" + s.n,
    players: s.players.size,
    max: MAX_PLAYERS,
    full: s.players.size >= MAX_PLAYERS,
  }));
}

function stats() {
  let online = 0;
  for (const list of games.values()) for (const s of list) online += s.players.size;
  return { games: games.size, servers: totalServers, max_servers: MAX_TOTAL_SERVERS, online };
}

// ---------------------------------------------------------------------------
// Minimal WebSocket (text frames only)
// ---------------------------------------------------------------------------

function frame(str) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

function send(sock, obj) {
  if (sock.destroyed || !sock.writable) return;
  // drop state updates for clients that can't keep up (keeps memory flat)
  if (sock.writableLength > 256 * 1024 && obj.t === "state") return;
  sock.write(frame(JSON.stringify(obj)));
}

// Calls onText(string) for every complete text message.
function makeParser(sock, onText, onClose) {
  let buf = Buffer.alloc(0);
  let fragments = [];
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 64 * 1024) return sock.destroy();
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MSG_BYTES) return sock.destroy();
      if (!masked) return sock.destroy(); // clients must mask
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);

      if (op === 0x8) { onClose(); return sock.end(Buffer.from([0x88, 0x00])); }
      if (op === 0x9) { // ping -> pong
        const pong = Buffer.concat([Buffer.from([0x8a, data.length]), data]);
        if (data.length < 126) sock.write(pong);
        continue;
      }
      if (op === 0x1 || op === 0x0) {
        fragments.push(data);
        if (fin) { const text = Buffer.concat(fragments).toString("utf8"); fragments = []; onText(text); }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Attach to the site's HTTP server.
//   ctx.userFromToken(token) -> user | null     (game session token)
//   ctx.profileOf(user)      -> { username, colors, ... }
//   ctx.gameExists(gameId)   -> boolean
// ---------------------------------------------------------------------------

function attach(httpServer, ctx) {
  let nextId = 1;

  httpServer.on("upgrade", (req, sock) => {
    if (!req.url.startsWith("/mp")) return sock.destroy();
    const key = req.headers["sec-websocket-key"];
    if (!key || String(req.headers.upgrade).toLowerCase() !== "websocket") return sock.destroy();

    const accept = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
    );
    sock.setNoDelay(true);

    let me = null; // { id, name, colors, server, sock }
    let tokens = MSG_PER_SEC, lastRefill = Date.now();

    const leave = () => {
      if (!me) return;
      me.server.players.delete(me.id);
      for (const p of me.server.players.values()) send(p.sock, { t: "left", id: me.id });
      me = null;
    };

    const onText = (text) => {
      const now = Date.now();
      tokens = Math.min(MSG_PER_SEC, tokens + ((now - lastRefill) / 1000) * MSG_PER_SEC);
      lastRefill = now;
      if (tokens < 1) return;
      tokens -= 1;

      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (!m || typeof m !== "object") return;

      // ---- first message: join -------------------------------------------
      if (!me) {
        if (m.t !== "join") return send(sock, { t: "error", error: "join_first" });
        const user = ctx.userFromToken(String(m.token || ""));
        if (!user) { send(sock, { t: "error", error: "invalid_session" }); return sock.end(); }
        const gameId = String(m.game || "");
        if (!ctx.gameExists(gameId)) { send(sock, { t: "error", error: "unknown_game" }); return sock.end(); }
        const list = serversFor(gameId);
        if (!list) { send(sock, { t: "error", error: "no_server_slots" }); return sock.end(); }
        const n = Math.max(1, Math.min(SERVERS_PER_GAME, parseInt(m.server, 10) || 1));
        const server = list[n - 1];
        if (server.players.size >= MAX_PLAYERS) { send(sock, { t: "error", error: "server_full" }); return sock.end(); }
        // same account twice in one server -> kick the old connection
        for (const p of server.players.values()) {
          if (p.userId === user.id) { send(p.sock, { t: "error", error: "logged_in_elsewhere" }); p.sock.end(); }
        }
        const prof = ctx.profileOf(user);
        me = { id: nextId++, userId: user.id, name: prof.username, colors: prof.colors, server, sock, state: null };
        server.players.set(me.id, me);
        send(sock, {
          t: "welcome", id: me.id, game: gameId, server: n, room: "S" + n,
          players: [...server.players.values()].filter((p) => p !== me)
            .map((p) => ({ id: p.id, name: p.name, colors: p.colors, state: p.state })),
        });
        for (const p of server.players.values())
          if (p !== me) send(p.sock, { t: "joined", id: me.id, name: me.name, colors: me.colors });
        return;
      }

      // ---- in the server --------------------------------------------------
      if (m.t === "state") {
        // position / rotation / anything small the game wants to sync
        const s = {};
        for (const k of ["x", "y", "z", "rx", "ry", "rz", "vx", "vy", "vz"]) {
          const v = Number(m[k]);
          if (Number.isFinite(v)) s[k] = Math.round(v * 1000) / 1000;
        }
        if (typeof m.anim === "string") s.anim = m.anim.slice(0, 32);
        me.state = s;
        for (const p of me.server.players.values())
          if (p !== me) send(p.sock, { t: "state", id: me.id, ...s });
      } else if (m.t === "chat") {
        const msg = String(m.text || "").slice(0, 200);
        if (!msg) return;
        for (const p of me.server.players.values()) send(p.sock, { t: "chat", id: me.id, name: me.name, text: msg });
      } else if (m.t === "event") {
        // free-form game event (shoot, open door, ...) relayed to the others
        const data = JSON.stringify(m.data === undefined ? null : m.data);
        if (data.length > 2000) return;
        for (const p of me.server.players.values())
          if (p !== me) send(p.sock, { t: "event", id: me.id, name: String(m.name || "").slice(0, 32), data: m.data });
      } else if (m.t === "ping") {
        send(sock, { t: "pong", c: m.c });
      }
    };

    const onClose = () => leave();
    sock.on("data", makeParser(sock, onText, onClose));
    sock.on("close", onClose);
    sock.on("error", onClose);
    sock.setTimeout(60 * 1000, () => sock.destroy()); // dead connection = 60s of silence
  });
}

module.exports = { attach, listServers, stats, SERVERS_PER_GAME, MAX_TOTAL_SERVERS, MAX_PLAYERS };
