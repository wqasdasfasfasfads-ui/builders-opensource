// clothing-editor.js - paint a classic 585x559 shirt template in the browser,
// see it on the 3D character live, and send it to the server.
const W = 585;
const H = 559;

const draw = document.getElementById("cloth-draw");
const guide = document.getElementById("cloth-guide");
const ctx = draw.getContext("2d", { willReadFrequently: true });
const gctx = guide.getContext("2d");
const colorInput = document.getElementById("cloth-color");
const sizeInput = document.getElementById("cloth-size");
const msg = document.getElementById("cloth-msg");
const preview = document.getElementById("cloth-preview");

let layout = null;
let tool = "pencil";
const undoStack = [];

function say(text, kind) {
  msg.textContent = text || "";
  msg.className = "cloth-msg " + (kind === "error" ? "error" : kind === "ok" ? "success" : "hint");
}

// ---- live 3D preview ------------------------------------------------------
let refreshQueued = false;
function refreshPreview() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    if (preview && preview.__avatar3d) preview.__avatar3d.refreshShirt();
  });
}
if (preview && preview.__avatar3d) preview.__avatar3d.setShirt(draw);

// ---- guide lines ----------------------------------------------------------
const LABELS = {
  top: "top", bottom: "bottom", front: "front", back: "back", left: "left", right: "right",
};
function drawGuide() {
  gctx.clearRect(0, 0, W, H);
  if (!layout || !document.getElementById("cloth-guide-toggle").checked) return;
  const parts = { torso: "body", rightArm: "right arm", leftArm: "left arm" };
  gctx.font = "10px sans-serif";
  gctx.textAlign = "center";
  gctx.textBaseline = "middle";
  for (const part of Object.keys(parts)) {
    for (const face of Object.keys(layout[part])) {
      const [x, y, w, h] = layout[part][face];
      gctx.strokeStyle = "rgba(0,0,0,0.55)";
      gctx.lineWidth = 1;
      gctx.setLineDash([4, 3]);
      gctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      gctx.setLineDash([]);
      const label = (part === "torso" ? "" : parts[part] + " ") + LABELS[face];
      gctx.fillStyle = "rgba(255,255,255,0.8)";
      gctx.fillText(label, x + w / 2 + 0.5, y + h / 2 + 0.5);
      gctx.fillStyle = "rgba(0,0,0,0.85)";
      gctx.fillText(label, x + w / 2, y + h / 2);
    }
  }
}
document.getElementById("cloth-guide-toggle").addEventListener("change", drawGuide);

// ---- undo -----------------------------------------------------------------
function pushUndo() {
  undoStack.push(ctx.getImageData(0, 0, W, H));
  if (undoStack.length > 25) undoStack.shift();
}
document.getElementById("cloth-undo").addEventListener("click", () => {
  const snap = undoStack.pop();
  if (!snap) return;
  ctx.putImageData(snap, 0, 0);
  refreshPreview();
});

// ---- drawing --------------------------------------------------------------
function pos(e) {
  const r = draw.getBoundingClientRect();
  return { x: Math.floor(((e.clientX - r.left) / r.width) * W), y: Math.floor(((e.clientY - r.top) / r.height) * H) };
}

function stamp(x, y) {
  const s = Number(sizeInput.value) || 1;
  const o = Math.floor(s / 2);
  if (tool === "eraser") ctx.clearRect(x - o, y - o, s, s);
  else {
    ctx.fillStyle = colorInput.value;
    ctx.fillRect(x - o, y - o, s, s);
  }
}

function line(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let i = 0; i <= steps; i++) stamp(Math.round(a.x + (dx * i) / steps), Math.round(a.y + (dy * i) / steps));
}

function faceAt(p) {
  if (!layout) return null;
  for (const part of ["torso", "rightArm", "leftArm"]) {
    for (const face of Object.keys(layout[part])) {
      const [x, y, w, h] = layout[part][face];
      if (p.x >= x && p.x < x + w && p.y >= y && p.y < y + h) return layout[part][face];
    }
  }
  return null;
}

let last = null;
draw.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const p = pos(e);
  if (tool === "fill") {
    const r = faceAt(p);
    if (!r) return say("Click inside one of the boxes to fill it.", "error");
    pushUndo();
    ctx.fillStyle = colorInput.value;
    ctx.fillRect(r[0], r[1], r[2], r[3]);
    refreshPreview();
    return;
  }
  pushUndo();
  draw.setPointerCapture(e.pointerId);
  last = p;
  stamp(p.x, p.y);
  refreshPreview();
});
draw.addEventListener("pointermove", (e) => {
  if (!last) return;
  const p = pos(e);
  line(last, p);
  last = p;
  refreshPreview();
});
const endStroke = () => { last = null; };
draw.addEventListener("pointerup", endStroke);
draw.addEventListener("pointercancel", endStroke);

document.querySelectorAll("[data-tool]").forEach((b) => {
  b.addEventListener("click", () => {
    tool = b.dataset.tool;
    document.querySelectorAll("[data-tool]").forEach((o) => {
      o.classList.toggle("tool-on", o === b);
      o.classList.toggle("play-btn--secondary", o !== b);
    });
  });
});

// ---- presets --------------------------------------------------------------
function fillRect(r) {
  ctx.fillRect(r[0], r[1], r[2], r[3]);
}
function preset(longSleeves) {
  if (!layout) return;
  pushUndo();
  ctx.fillStyle = colorInput.value;
  Object.values(layout.torso).forEach(fillRect);
  for (const arm of [layout.rightArm, layout.leftArm]) {
    fillRect(arm.top);
    for (const face of ["front", "back", "left", "right"]) {
      const r = arm[face];
      fillRect(longSleeves ? r : [r[0], r[1], r[2], 52]);
    }
    if (longSleeves) fillRect(arm.bottom);
  }
  refreshPreview();
}
document.getElementById("preset-tee").addEventListener("click", () => preset(false));
document.getElementById("preset-long").addEventListener("click", () => preset(true));
document.getElementById("cloth-clear").addEventListener("click", () => {
  pushUndo();
  ctx.clearRect(0, 0, W, H);
  refreshPreview();
});

// ---- open / save PNG ------------------------------------------------------
document.getElementById("cloth-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    pushUndo();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H); // exactly 585x559 stays 1:1, other sizes are stretched to fit
    URL.revokeObjectURL(url);
    say(img.width === W && img.height === H ? "Picture opened." : `Picture was ${img.width}x${img.height} and was stretched to ${W}x${H}.`, "ok");
    refreshPreview();
  };
  img.onerror = () => { URL.revokeObjectURL(url); say("That file could not be opened as a picture.", "error"); };
  img.src = url;
});
document.getElementById("cloth-download").addEventListener("click", (e) => {
  e.currentTarget.href = draw.toDataURL("image/png");
});

// ---- marketplace icon (front view, like the little avatar icons) ----------
function makeIcon() {
  let colors = {};
  try { colors = JSON.parse(preview.dataset.colors || "{}"); } catch (e) {}
  const c = Object.assign({ head: "#f5cd30", torso: "#0d69ac", arms: "#f5cd30", legs: "#a2c429" }, colors);
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#11141a";
  g.fillRect(0, 0, S, S);
  const k = 0.45;
  const tw = 128 * k, th = 128 * k, aw = 64 * k;
  const tx = (S - tw) / 2, ty = 38;
  g.fillStyle = c.legs;
  g.fillRect(tx + 1, ty + th, tw / 2 - 1, 30);
  g.fillRect(tx + tw / 2, ty + th, tw / 2 - 1, 30);
  g.fillStyle = c.arms;
  g.fillRect(tx - aw, ty, aw, th);
  g.fillRect(tx + tw, ty, aw, th);
  g.fillStyle = c.torso;
  g.fillRect(tx, ty, tw, th);
  g.fillStyle = c.head;
  g.fillRect(S / 2 - 15, 6, 30, 30);
  if (layout) {
    const dr = (r, dx, dy, dw, dh) => g.drawImage(draw, r[0], r[1], r[2], r[3], dx, dy, dw, dh);
    dr(layout.rightArm.front, tx - aw, ty, aw, th);
    dr(layout.leftArm.front, tx + tw, ty, aw, th);
    dr(layout.torso.front, tx, ty, tw, th);
  }
  return cv.toDataURL("image/png");
}

// ---- send -----------------------------------------------------------------
function isEmpty() {
  const d = ctx.getImageData(0, 0, W, H).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
}

// The server accepts a shirt PNG only under ~900 KB. A busy photo can be
// bigger, so if needed the colors are reduced a little (looks the same).
function pngForUpload() {
  let url = draw.toDataURL("image/png");
  const LIMIT = 820 * 1024; // bytes, with a safety margin
  const bytes = (u) => Math.floor((u.length - 22) * 0.75);
  if (bytes(url) <= LIMIT) return url;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  for (const drop of [2, 3, 4, 5]) {
    const id = ctx.getImageData(0, 0, W, H);
    const d = id.data;
    const mask = 255 << drop & 255;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] & mask; d[i + 1] = d[i + 1] & mask; d[i + 2] = d[i + 2] & mask;
    }
    g.putImageData(id, 0, 0);
    url = cv.toDataURL("image/png");
    if (bytes(url) <= LIMIT) break;
  }
  return url;
}

const createBtn = document.getElementById("cloth-create");
createBtn.addEventListener("click", async () => {
  const name = document.getElementById("cloth-name").value.trim();
  if (name.length < 3) return say("Give the T-shirt a name (at least 3 characters).", "error");
  if (isEmpty()) return say("The picture is empty - paint something first.", "error");
  createBtn.disabled = true;
  say("Sending...");
  try {
    const res = await fetch("/api/clothing/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: document.getElementById("cloth-desc").value,
        price: Number(document.getElementById("cloth-price").value) || 0,
        image: pngForUpload(),
        icon: makeIcon(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong.");
    if (data.published) {
      msg.className = "cloth-msg success";
      msg.innerHTML = 'Done! It is in the <a href="/marketplace">Marketplace</a> and in your inventory - wear it in <a href="/avatar">Avatar</a>.';
    } else {
      say("Sent! An admin will check it. When it is published it appears in the Marketplace and in your inventory.", "ok");
    }
  } catch (err) {
    say(err.message, "error");
  } finally {
    createBtn.disabled = false;
  }
});

// ---- photo -> 3D T-shirt --------------------------------------------------
// Insert any photo: it is placed on the shirt template (front print, back,
// whole front or stretched over everything) on top of a base shirt color.
const photoEls = {
  file: document.getElementById("photo-file"),
  name: document.getElementById("photo-name"),
  color: document.getElementById("photo-shirt-color"),
  sleeves: document.getElementById("photo-sleeves"),
  place: document.getElementById("photo-place"),
  scale: document.getElementById("photo-scale"),
  y: document.getElementById("photo-y"),
  x: document.getElementById("photo-x"),
  rot: document.getElementById("photo-rot"),
  flip: document.getElementById("photo-flip"),
  nobg: document.getElementById("photo-nobg"),
};
let photoImg = null;

// Removes the WHITE BACKGROUND around the picture: only white that is connected
// to the picture's edge is made transparent, so white parts inside stay.
let cutoutCache = null; // { img, canvas }
function cutout(img) {
  if (cutoutCache && cutoutCache.img === img) return cutoutCache.canvas;
  const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  const near = (i) => d[i + 3] < 10 || Math.min(d[i], d[i + 1], d[i + 2]) >= 225;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const n = y * w + x;
    if (!seen[n] && near(n * 4)) { seen[n] = 1; stack.push(n); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const n = stack.pop();
    const x = n % w, y = (n - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  for (let n = 0; n < seen.length; n++) if (seen[n]) d[n * 4 + 3] = 0;
  // soften the edge: pixels touching removed background become half see-through
  const edge = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const n = y * w + x;
    if (!seen[n] && (seen[n - 1] || seen[n + 1] || seen[n - w] || seen[n + w])) edge.push(n);
  }
  for (const n of edge) d[n * 4 + 3] = 140;
  g.putImageData(id, 0, 0);
  cutoutCache = { img, canvas: cv };
  return cv;
}

// True when the 4 corners of the picture are (almost) white = it has a white background.
function hasWhiteCorners(img) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 8;
  const g = cv.getContext("2d", { willReadFrequently: true });
  const pts = [[0, 0], [img.naturalWidth - 1, 0], [0, img.naturalHeight - 1], [img.naturalWidth - 1, img.naturalHeight - 1]];
  return pts.every(([x, y]) => {
    g.clearRect(0, 0, 8, 8);
    g.drawImage(img, Math.max(0, x - 2), Math.max(0, y - 2), 3, 3, 0, 0, 3, 3);
    const p = g.getImageData(1, 1, 1, 1).data;
    return p[3] < 10 || Math.min(p[0], p[1], p[2]) >= 235;
  });
}

function photoSource() {
  return photoEls.nobg.checked ? cutout(photoImg) : photoImg;
}

function placePhoto(src, rect, mode) {
  const [x, y, w, h] = rect;
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;
  if (mode === "stretch") {
    ctx.drawImage(src, x, y, w, h);
    return;
  }
  const k = (Number(photoEls.scale.value) || 70) / 100;
  // "contain": whole photo inside the box, scaled by the Size slider.
  // "cover": photo fills the box (Size 70 = exactly fills), bigger/smaller with the slider.
  const fit = mode === "cover" ? Math.max(w / sw, h / sh) * (k / 0.7) : Math.min(w / sw, h / sh) * k;
  const dw = sw * fit;
  const dh = sh * fit;
  const cx = x + w / 2 + (Number(photoEls.x.value) / 100) * w * 0.5;
  const cy = y + h / 2 + (Number(photoEls.y.value) / 100) * h * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h); // never paint outside the box
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate((Number(photoEls.rot.value) * Math.PI) / 180);
  if (photoEls.flip.checked) ctx.scale(-1, 1);
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function applyPhoto(withUndo) {
  if (!photoImg) return;
  if (!layout) return say("The template is still loading, try again in a second.", "error");
  if (withUndo) pushUndo();
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // 1) base shirt
  ctx.fillStyle = photoEls.color.value;
  Object.values(layout.torso).forEach(fillRect);
  const long = photoEls.sleeves.value === "long";
  for (const arm of [layout.rightArm, layout.leftArm]) {
    fillRect(arm.top);
    for (const face of ["front", "back", "left", "right"]) {
      const r = arm[face];
      fillRect(long ? r : [r[0], r[1], r[2], 52]);
    }
    if (long) fillRect(arm.bottom);
  }

  // 2) the photo
  const src = photoSource();
  const place = photoEls.place.value;
  if (place === "all") {
    placePhoto(src, [0, 0, W, H], "stretch");
  } else {
    const mode = place === "front-full" ? "cover" : "contain";
    if (place === "chest" || place === "front-full" || place === "both") placePhoto(src, layout.torso.front, mode);
    if (place === "back" || place === "both") placePhoto(src, layout.torso.back, mode);
  }
  refreshPreview();
}

photoEls.file.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    photoImg = img;
    cutoutCache = null;
    photoEls.nobg.checked = hasWhiteCorners(img); // white background -> removed automatically
    photoEls.name.textContent = file.name;
    const nameInput = document.getElementById("cloth-name");
    if (!nameInput.value.trim()) nameInput.value = file.name.replace(/\.[^.]+$/, "").slice(0, 30);
    applyPhoto(true);
    say("Photo placed on the T-shirt. Rotate the 3D preview, change the settings, then press Create.", "ok");
  };
  img.onerror = () => { URL.revokeObjectURL(url); say("That file could not be opened as a picture.", "error"); };
  img.src = url;
});
for (const el of [photoEls.color, photoEls.sleeves, photoEls.place, photoEls.scale, photoEls.y, photoEls.x, photoEls.rot, photoEls.flip, photoEls.nobg]) {
  el.addEventListener("input", () => applyPhoto(false));
}

document.getElementById("photo-reset").addEventListener("click", () => {
  photoEls.scale.value = 70; photoEls.x.value = 0; photoEls.y.value = 0; photoEls.rot.value = 0;
  photoEls.flip.checked = false;
  applyPhoto(false);
});

// Drag the photo with the mouse on the template (inside the front / back box).
let photoDrag = null;
draw.addEventListener("pointerdown", (e) => {
  if (!photoImg || !layout || photoEls.place.value === "all") return;
  const p = pos(e);
  const hit = ["front", "back"].map((f) => layout.torso[f]).find((r) => p.x >= r[0] && p.x < r[0] + r[2] && p.y >= r[1] && p.y < r[1] + r[3]);
  if (!hit) return;
  e.stopImmediatePropagation(); // do not paint with the pencil
  e.preventDefault();
  draw.setPointerCapture(e.pointerId);
  photoDrag = { p, x: Number(photoEls.x.value), y: Number(photoEls.y.value), w: hit[2], h: hit[3] };
}, true);
draw.addEventListener("pointermove", (e) => {
  if (!photoDrag) return;
  e.stopImmediatePropagation();
  const p = pos(e);
  const clamp = (v) => Math.max(-100, Math.min(100, Math.round(v)));
  photoEls.x.value = clamp(photoDrag.x + ((p.x - photoDrag.p.x) / (photoDrag.w * 0.5)) * 100);
  photoEls.y.value = clamp(photoDrag.y + ((p.y - photoDrag.p.y) / (photoDrag.h * 0.5)) * 100);
  applyPhoto(false);
}, true);
const endPhotoDrag = () => { photoDrag = null; };
draw.addEventListener("pointerup", endPhotoDrag);
draw.addEventListener("pointercancel", endPhotoDrag);

// ---- 3D view buttons (front / left / back / right) ----
document.querySelectorAll("[data-view]").forEach((b) => {
  b.addEventListener("click", () => {
    if (preview && preview.__avatar3d && preview.__avatar3d.rotateTo) preview.__avatar3d.rotateTo(Number(b.dataset.view));
  });
});

// ---- start ----------------------------------------------------------------
fetch("/shirt-layout.json")
  .then((r) => r.json())
  .then((l) => { layout = l; drawGuide(); })
  .catch(() => say("Could not load the template layout.", "error"));
