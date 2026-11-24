// avatar3d.js - real 3D character preview (blocky body + voxel hats).
// Reads data-colors / data-hat from the element, draws with three.js
// (served from /vendor, no CDN). Drag to rotate, wheel/pinch not needed.
import * as THREE from "/vendor/three.module.js";

const DEFAULT_COLORS = { head: "#f5cd30", torso: "#0d69ac", arms: "#f5cd30", legs: "#a2c429" };

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });
}

// Plain Minecraft-style box. Each face has 4 vertices (default BoxGeometry
// layout) so shirt textures map per face.
const RB_FACE_COUNT = [4, 4, 4, 4, 4, 4]; // +x, -x, +y, -y, +z, -z
function roundBoxGeo(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

function block(w, h, d, color, outline = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat(color));
  mesh.castShadow = true;
  if (outline) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 40),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })
    );
    mesh.add(edges);
  }
  return mesh;
}

// --- 2D clothes (classic 585x559 shirt template, like Roblox) -------------
// The PNG is wrapped around the torso and both arms. Transparent pixels show
// the body color underneath, so short sleeves etc. just work.
let layoutPromise = null;
function loadLayout() {
  if (!layoutPromise) layoutPromise = fetch("/shirt-layout.json").then((r) => r.json());
  return layoutPromise;
}

// BoxGeometry face order -> name in the template.
const FACE_NAMES = ["left", "right", "top", "bottom", "front", "back"]; // +x, -x, +y, -y, +z, -z

function applyFaceUvs(mesh, rects, texW, texH) {
  const uv = mesh.geometry.attributes.uv;
  let o = 0;
  FACE_NAMES.forEach((name, i) => {
    const r = rects[name];
    for (let k = 0; k < RB_FACE_COUNT[i]; k++) {
      const j = o + k;
      const uu = uv.getX(j), vv = uv.getY(j);
      uv.setXY(j, (r[0] + r[2] * uu) / texW, 1 - (r[1] + r[3] * (1 - vv)) / texH);
    }
    o += RB_FACE_COUNT[i];
  });
  uv.needsUpdate = true;
}

// Torso overlay: a slightly bigger rounded box carrying the shirt texture.
function clothesMesh(w, h, d, rects, layout, texture) {
  const pad = 0.04;
  const geo = roundBoxGeo(w + pad, h + pad, d + pad);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.02,
      roughness: 0.7,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  applyFaceUvs(m, rects, layout.width, layout.height);
  return m;
}

// --- classic blocky proportions (Roblox R6 style) ----------------------------
// stud = 0.8 units; head stays 1.1 so hat data lines up.
const ST = 0.8;
const HEAD = 1.1;
const BODY = { w: 2 * ST, h: 2 * ST, d: 1 * ST };
const LIMB = { w: 1 * ST, h: 2 * ST, d: 1 * ST };

// A limb is a Group pivoting at its top (shoulder / hip), so game-style
// rotation of the part still works. The box hangs below the pivot.
function boxLimb(color, drop = 0) {
  const g = new THREE.Group();
  const m = block(LIMB.w, LIMB.h, LIMB.d, color);
  m.position.y = -LIMB.h / 2 + drop;
  g.add(m);
  g.userData.box = m;
  return g;
}

function loadImage(url) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

function makeTexture(source) {
  let tex;
  if (typeof source === "string") {
    tex = new THREE.TextureLoader().load(
      source,
      undefined,
      undefined,
      () => console.warn("Shirt texture could not be loaded:", source)
    );
  } else {
    tex = new THREE.CanvasTexture(source);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  return tex;
}

function buildCharacter(colors, hat) {
  const c = Object.assign({}, DEFAULT_COLORS, colors || {});
  const g = new THREE.Group();

  const legTop = LIMB.h;                       // hip height
  const bodyTop = legTop + BODY.h;             // shoulder height

  const legs = [-1, 1].map((s) => {
    const m = boxLimb(c.legs);
    m.position.set(s * LIMB.w / 2, legTop, 0);
    return m;
  });
  const torso = block(BODY.w, BODY.h, BODY.d, c.torso);
  torso.position.set(0, legTop + BODY.h / 2, 0);
  // arms[0] is x < 0 = the character's RIGHT arm
  const arms = [-1, 1].map((s) => {
    const m = boxLimb(c.arms); // box hangs from the shoulder
    m.position.set(s * (BODY.w / 2 + LIMB.w / 2), bodyTop, 0);
    return m;
  });
  const head = block(HEAD, HEAD, HEAD, c.head);
  head.position.set(0, bodyTop + HEAD / 2, 0);

  // classic smiley face on +Z
  const z = HEAD / 2 + 0.006;
  const dark = new THREE.MeshBasicMaterial({ color: 0x15181d });
  const px = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), dark);
    m.position.set(x, y, z);
    head.add(m);
  };
  px(0.12, 0.2, -0.24, 0.12); px(0.12, 0.2, 0.24, 0.12);       // eyes
  px(0.5, 0.06, 0, -0.2);                                       // smile
  px(0.08, 0.08, -0.29, -0.15); px(0.08, 0.08, 0.29, -0.15);    // smile corners

  // Hat: cubes relative to the head center. Y = up, Z = toward the face.
  if (hat && Array.isArray(hat.blocks)) {
    const hatGroup = new THREE.Group();
    hat.blocks.forEach((b) => {
      if (!b || !Array.isArray(b.pos) || !Array.isArray(b.size)) return;
      const m = block(b.size[0], b.size[1], b.size[2], b.color || "#222222");
      m.position.set(b.pos[0], b.pos[1], b.pos[2]);
      hatGroup.add(m);
    });
    hatGroup.scale.setScalar(HEAD); // head is 1.1 units wide
    head.add(hatGroup);
  }

  g.add(...legs, torso, ...arms, head);

  // Shirt overlay slots (filled by g.userData.setShirt).
  let shirtMeshes = [];
  let shirtTexture = null;
  g.userData.limbs = { armR: arms[0], armL: arms[1], legR: legs[0], legL: legs[1] };
  g.userData.setShirt = async function (source) {
    shirtMeshes.forEach((m) => {
      m.parent && m.parent.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    });
    shirtMeshes = [];
    if (shirtTexture) { shirtTexture.dispose(); shirtTexture = null; }
    if (!source) return;
    const layout = await loadLayout();
    shirtTexture = makeTexture(source);
    const t = clothesMesh(BODY.w, BODY.h, BODY.d, layout.torso, layout, shirtTexture);
    t.position.copy(torso.position);
    shirtMeshes.push(t);
    g.add(t);
    // sleeves: the arm part of the template wrapped around each box arm
    [layout.rightArm, layout.leftArm].forEach((rects, i) => {
      const sm = clothesMesh(LIMB.w, LIMB.h, LIMB.d, rects, layout, shirtTexture);
      sm.position.copy(arms[i].userData.box.position);
      arms[i].add(sm);
      shirtMeshes.push(sm);
    });
  };
  g.userData.refreshShirt = function () {
    if (shirtTexture) shirtTexture.needsUpdate = true;
  };
  return g;
}

function shadowTexture() {
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d");
  const grad = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

function webglOk() {
  try {
    const cv = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (cv.getContext("webgl2") || cv.getContext("webgl")));
  } catch (e) {
    return false;
  }
}

function mount(el) {
  if (el.__avatar3d) return; // already mounted (the script can be loaded by the page AND the Pluse window)
  if (!webglOk()) {
    // keep the SVG fallback that is already inside el, but SAY why there is no 3D
    el.__avatar3d = { setShirt() {}, refreshShirt() {}, rotateTo() {}, setLook() {} };
    const note = document.createElement("p");
    note.className = "hint";
    note.style.cssText = "margin:8px 0 0;text-align:center;color:#e5a000";
    note.textContent = "3D is not available in this browser (WebGL is off). Turn on \"hardware acceleration\" in the browser settings, or try Chrome/Edge/Firefox - clothes are only shown in 3D.";
    el.appendChild(note);
    return;
  }
  let colors = null;
  let hat = null;
  const shirtUrl = el.dataset.shirt || "";
  try { colors = JSON.parse(el.dataset.colors || "null"); } catch (e) {}
  try { hat = JSON.parse(el.dataset.hat || "null"); } catch (e) {}

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 3.4, 12.5);
  camera.lookAt(0, 2.4, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xaab2c4, 1.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(4, 9, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd2ff, 0.5);
  fill.position.set(-6, 3, -4);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  scene.add(floor);

  const pivot = new THREE.Group();
  let character = buildCharacter(colors, hat);
  pivot.add(character);
  if (shirtUrl) character.userData.setShirt(shirtUrl);
  // Small API for pages that want to change the shirt live (clothing editor).
  el.__avatar3d = {
    setShirt: (source) => character.userData.setShirt(source),
    refreshShirt: () => character.userData.refreshShirt(),
    // turn the character to a side: 0 = front, PI = back, +-PI/2 = sides
    // swap the whole look (used by the Marketplace 3D viewer)
    setLook: (c, h, shirt) => {
      pivot.remove(character);
      character = buildCharacter(c, h);
      pivot.add(character);
      if (shirt) character.userData.setShirt(shirt);
    },
    rotateTo: (angle) => { targetRot = angle; idleSince = performance.now() + 4000; },
  };
  pivot.rotation.y = -0.5;
  let targetRot = null;
  scene.add(pivot);

  el.innerHTML = "";
  el.classList.add("avatar-3d--ready");
  el.appendChild(renderer.domElement);

  function resize() {
    const w = el.clientWidth || 300;
    const h = el.clientHeight || 360;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(el);

  // Drag to rotate; slow auto-spin when idle.
  let dragging = false;
  let lastX = 0;
  let idleSince = performance.now();
  renderer.domElement.style.touchAction = "pan-y";
  renderer.domElement.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    pivot.rotation.y += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
    idleSince = performance.now();
  });
  const stop = () => { dragging = false; idleSince = performance.now(); };
  renderer.domElement.addEventListener("pointerup", stop);
  renderer.domElement.addEventListener("pointercancel", stop);

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = true;
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }).observe(el);

  function frame(t) {
    requestAnimationFrame(frame);
    if (!visible) return;
    if (targetRot !== null && !dragging) {
      // shortest way round to the chosen side
      let diff = targetRot - pivot.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) < 0.01) { pivot.rotation.y = targetRot; targetRot = null; }
      else pivot.rotation.y += diff * 0.15;
    } else if (!dragging && !reduce && t - idleSince > 1500) pivot.rotation.y += 0.006;
    if (dragging) targetRot = null;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

document.querySelectorAll("[data-avatar3d]").forEach(mount);
