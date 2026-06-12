// Map camera, built to the published Google/Apple camera specs.
// State is {center, distance(zoom), heading, tilt} — the same four
// parameters as google.maps moveCamera() and Apple's MKMapCamera.
// Direct-manipulation gestures (drag / pinch / twist) write BOTH the
// current and goal values, so the content sticks to the fingers with
// zero easing lag; programmatic moves (buttons, double-click, reset)
// keep the animated goal-chasing.
import * as THREE from "three";
import { clamp, smoothstep } from "../core/utils.js?v=35";
import { WORLD_W, WORLD_D, DEG, ROOM, PERF, isRigCloseup } from "../core/config.js?v=35";
import { camera, canvasEl, renderer, pixelRatio } from "../core/context.js?v=35";
import { terrainHeight } from "../world/terrain.js?v=35";

const DEFAULT_MAP_CAMERA = isRigCloseup
  ? { cx: -8, cz: 4, dist: 44, tilt: 58 * DEG, heading: 0.4 }
  // Default = Safari map view: centered on the tabletop terrain, with a
  // mostly top-down angle. Room furniture is context, not the subject.
  : { cx: 0, cz: 0, dist: 760, heading: 0, tilt: 18 * DEG };
export const mapCam = {
  ...DEFAULT_MAP_CAMERA,
  fy: 0,
  velX: 0,
  velZ: 0,
  goal: { ...DEFAULT_MAP_CAMERA },
};

export function getDistanceQuality() {
  const dist = isRigCloseup ? 0 : mapCam.dist;
  if (dist <= PERF.nearDist) return "near";
  if (dist <= PERF.midDist) return "mid";
  return "far";
}

export function targetPixelRatioForQuality(quality = getDistanceQuality()) {
  const cap =
    quality === "near"
      ? PERF.nearPixelRatio
      : quality === "mid"
        ? PERF.midPixelRatio
        : PERF.farPixelRatio;
  return Math.min(window.devicePixelRatio || 1, Math.max(PERF.minPixelRatio, cap));
}

export const keys = new Set();

export function resetMapCamera() {
  if (fly.on) exitFreeFly();
  keys.clear();
  drag.mode = null;
  mapCam.velX = 0;
  mapCam.velZ = 0;
  Object.assign(mapCam.goal, DEFAULT_MAP_CAMERA);
  document.body.dataset.viewReset = String(Date.now());
}

// Shim so the sun-follow code reads a single look-at point for both the
// map camera and free-fly mode.
export const controls = { target: new THREE.Vector3(mapCam.cx, 0, mapCam.cz) };

export const drag = { mode: null, lastX: 0, lastY: 0, lastT: 0 };
const _ray = new THREE.Raycaster();
const _gp = new THREE.Vector3();
canvasEl.style.cursor = "grab";
canvasEl.addEventListener("contextmenu", (e) => e.preventDefault());

// Ground point under a client coordinate (intersection with the focus
// plane) — used for cursor-anchored zoom, like both map products.
function groundPoint(clientX, clientY) {
  _ray.setFromCamera(
    {
      x: (clientX / window.innerWidth) * 2 - 1,
      y: -(clientY / window.innerHeight) * 2 + 1,
    },
    camera,
  );
  const t = (mapCam.fy - _ray.ray.origin.y) / _ray.ray.direction.y;
  if (!isFinite(t) || t < 0) return null;
  return _gp.copy(_ray.ray.direction).multiplyScalar(t).add(_ray.ray.origin);
}

function worldPerPixel() {
  return (
    (2 * mapCam.dist * Math.tan((camera.fov * DEG) / 2)) /
    window.innerHeight
  );
}

// ---- Free-fly mode (press F): leave the table and roam the room ----
// Drag = mouse-look, WASD = walk, Q/E = down/up, wheel = forward/back.
export const fly = { on: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
export function enterFreeFly() {
  fly.on = true;
  fly.x = camera.position.x;
  fly.y = camera.position.y;
  fly.z = camera.position.z;
  const dir = new THREE.Vector3(mapCam.cx, mapCam.fy, mapCam.cz)
    .sub(camera.position)
    .normalize();
  fly.yaw = Math.atan2(dir.x, dir.z);
  fly.pitch = Math.asin(clamp(dir.y, -1, 1));
  canvasEl.style.cursor = "crosshair";
  setFlyHud(true);
}
export function exitFreeFly() {
  fly.on = false;
  // Hand the look point back to the map camera so it resumes smoothly.
  mapCam.goal.cx = mapCam.cx = clamp(mapCam.cx, -WORLD_W * 0.5, WORLD_W * 0.5);
  mapCam.goal.cz = mapCam.cz = clamp(mapCam.cz, -WORLD_D * 0.5, WORLD_D * 0.5);
  canvasEl.style.cursor = "grab";
  setFlyHud(false);
}
function setFlyHud(on) {
  const el = document.getElementById("flyBadge");
  if (el) el.style.display = on ? "block" : "none";
}

// All active touches/pointers on the canvas. Two fingers = the full
// Apple gesture: pinch zooms, twist rotates, midpoint drag pans — all
// applied DIRECTLY (no easing lag), the content sticks to the fingers.
export const pointers = new Map();
const pinch = { d: 0, ang: 0, mx: 0, my: 0 };

canvasEl.addEventListener("pointerdown", (e) => {
  try {
    canvasEl.setPointerCapture(e.pointerId);
  } catch {
    // synthetic pointers (tests) have no active pointer to capture
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && !fly.on) {
    const [a, b] = [...pointers.values()];
    pinch.d = Math.hypot(b.x - a.x, b.y - a.y);
    pinch.ang = Math.atan2(b.y - a.y, b.x - a.x);
    pinch.mx = (a.x + b.x) / 2;
    pinch.my = (a.y + b.y) / 2;
    drag.mode = "gesture";
    mapCam.velX = 0;
    mapCam.velZ = 0;
    return;
  }
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  drag.lastT = performance.now();
  if (fly.on) {
    drag.mode = "look";
    return;
  }
  // Option(Alt)+drag rotates — MapKit JS's gesture. Right-drag too.
  if (e.button === 2 || (e.button === 0 && e.altKey)) {
    drag.mode = "rotate";
    canvasEl.style.cursor = "move";
  } else if (e.button === 0) {
    drag.mode = "pan";
    mapCam.velX = 0;
    mapCam.velZ = 0;
    canvasEl.style.cursor = "grabbing";
  }
});

// Screen-pixel pan shared by drag and trackpad two-finger scroll.
// The grabbed ground point sticks to the cursor/fingers (1:1).
function panByPixels(dx, dy, sampleVelocityDt) {
  const g = mapCam.goal;
  const wpp = worldPerPixel();
  const hx = Math.sin(mapCam.heading);
  const hz = -Math.cos(mapCam.heading);
  const rx = Math.cos(mapCam.heading);
  const rz = Math.sin(mapCam.heading);
  const mx = -(dx * rx) * wpp + dy * hx * wpp;
  const mz = -(dx * rz) * wpp + dy * hz * wpp;
  g.cx += mx;
  g.cz += mz;
  mapCam.cx += mx;
  mapCam.cz += mz;
  if (sampleVelocityDt) {
    const blend = 0.55;
    mapCam.velX = mapCam.velX * (1 - blend) + (mx / sampleVelocityDt) * blend;
    mapCam.velZ = mapCam.velZ * (1 - blend) + (mz / sampleVelocityDt) * blend;
  }
}

canvasEl.addEventListener("pointermove", (e) => {
  const tracked = pointers.get(e.pointerId);
  if (tracked) {
    tracked.x = e.clientX;
    tracked.y = e.clientY;
  }
  if (drag.mode === "gesture") {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // Pan: the midpoint sticks to the ground under it.
    panByPixels(mx - pinch.mx, my - pinch.my, null);
    // Zoom: finger-distance ratio, anchored at the midpoint, instant.
    if (pinch.d > 8 && d > 8) zoomAt(mx, my, pinch.d / d, true);
    // Rotate: twist angle, the map turns WITH the fingers (clockwise
    // fingers = clockwise map). Instant on both current and goal.
    let da = ang - pinch.ang;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    mapCam.heading -= da;
    mapCam.goal.heading -= da;
    pinch.d = d;
    pinch.ang = ang;
    pinch.mx = mx;
    pinch.my = my;
    return;
  }
  if (!drag.mode) return;
  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  const now = performance.now();
  const dt = Math.max(0.001, (now - drag.lastT) / 1000);
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  drag.lastT = now;

  if (drag.mode === "look") {
    fly.yaw -= dx * 0.0042;
    fly.pitch = clamp(fly.pitch - dy * 0.0042, -1.45, 1.45);
    return;
  }

  const g = mapCam.goal;

  if (drag.mode === "rotate") {
    g.heading += dx * 0.0062;
    g.tilt -= dy * 0.0042;
    return;
  }

  panByPixels(dx, dy, dt);
});

function endDrag() {
  drag.mode = null;
  canvasEl.style.cursor = fly.on ? "crosshair" : "grab";
}
function releasePointer(e) {
  pointers.delete(e.pointerId);
  if (drag.mode === "gesture") {
    if (pointers.size === 1) {
      // One finger lifted: hand off to a plain pan without a jump.
      const [p] = [...pointers.values()];
      drag.mode = "pan";
      drag.lastX = p.x;
      drag.lastY = p.y;
      drag.lastT = performance.now();
    } else if (pointers.size === 0) {
      endDrag();
    }
    return;
  }
  if (pointers.size === 0) endDrag();
}
canvasEl.addEventListener("pointerup", releasePointer);
canvasEl.addEventListener("pointercancel", releasePointer);

// Cursor-anchored fractional zoom (both products' wheel behavior).
// instant=true applies the change to the CURRENT camera too — pinch and
// wheel manipulate the view directly with zero easing lag (the gesture
// IS the animation, like Apple Maps); buttons/dblclick stay animated.
export function zoomAt(clientX, clientY, factor, instant = false) {
  const g = mapCam.goal;
  const base = instant ? mapCam.dist : g.dist;
  const nd = clamp(base * factor, 18, 2600);
  const real = nd / base;
  const p = groundPoint(clientX, clientY);
  if (p) {
    const refX = instant ? mapCam.cx : g.cx;
    const refZ = instant ? mapCam.cz : g.cz;
    g.cx = p.x + (refX - p.x) * real;
    g.cz = p.z + (refZ - p.z) * real;
    if (instant) {
      mapCam.cx = g.cx;
      mapCam.cz = g.cz;
    }
  }
  g.dist = nd;
  if (instant) mapCam.dist = nd;
}

// Apple Maps wheel semantics: a plain scroll (trackpad two-finger
// drag, or mouse wheel) PANS the map; a pinch (which browsers deliver
// as ctrlKey+wheel) ZOOMS toward the pointer. Option+scroll ROTATES —
// Chrome/Edge/Firefox never deliver the trackpad TWIST gesture to web
// pages (GestureEvent is WebKit-only), so this is their stand-in:
// Option + two-finger horizontal = rotate, vertical = tilt. Instant.
canvasEl.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (fly.on) {
      // Dolly forward/back along the look direction.
      const step = -e.deltaY * 1.4;
      fly.x += Math.sin(fly.yaw) * Math.cos(fly.pitch) * step;
      fly.y += Math.sin(fly.pitch) * step;
      fly.z += Math.cos(fly.yaw) * Math.cos(fly.pitch) * step;
      return;
    }
    if (e.altKey) {
      const dh = e.deltaX * 0.0042;
      mapCam.heading += dh;
      mapCam.goal.heading += dh;
      const nt = clamp(
        mapCam.goal.tilt - e.deltaY * 0.003,
        3 * DEG,
        maxTiltFor(mapCam.goal.dist),
      );
      mapCam.tilt = mapCam.goal.tilt = nt;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.011), true);
    } else {
      mapCam.velX = 0;
      mapCam.velZ = 0;
      panByPixels(-e.deltaX, -e.deltaY, null);
    }
  },
  { passive: false },
);

// Apple Maps: double-click zooms in, Option+double-click zooms out.
canvasEl.addEventListener("dblclick", (e) => {
  zoomAt(e.clientX, e.clientY, e.altKey ? 2 : 0.5);
});

// Safari trackpad: two-finger ROTATE and PINCH arrive as GestureEvents
// (no pointer pair, unlike touch screens). e.rotation is in degrees,
// clockwise-positive; e.scale is the pinch ratio since gesturestart.
// The map turns/zooms WITH the fingers — instant, no easing. Skipped
// while a real two-touch pair is active (iOS fires both event paths).
let safariGest = null;
canvasEl.addEventListener("gesturestart", (e) => {
  e.preventDefault();
  if (pointers.size >= 2 || fly.on) return;
  safariGest = { rotation: 0, scale: 1, x: e.clientX, y: e.clientY };
});
canvasEl.addEventListener("gesturechange", (e) => {
  e.preventDefault();
  if (!safariGest || pointers.size >= 2 || fly.on) return;
  const da = (e.rotation - safariGest.rotation) * DEG;
  mapCam.heading -= da;
  mapCam.goal.heading -= da;
  const ds = e.scale / safariGest.scale;
  if (Math.abs(ds - 1) > 0.0005) {
    zoomAt(e.clientX ?? safariGest.x, e.clientY ?? safariGest.y, 1 / ds, true);
  }
  safariGest.rotation = e.rotation;
  safariGest.scale = e.scale;
});
canvasEl.addEventListener("gestureend", (e) => {
  e.preventDefault();
  safariGest = null;
});

const ROAM_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "KeyQ", "KeyE",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "AltLeft", "AltRight", "Space", "ShiftLeft", "ShiftRight",
]);
window.addEventListener("keydown", (e) => {
  // F toggles free-fly room roaming.
  if (e.code === "KeyF" && !e.metaKey && !e.ctrlKey) {
    fly.on ? exitFreeFly() : enterFreeFly();
    return;
  }
  // Apple Maps: Shift-Command-Up Arrow returns to north orientation.
  if (e.shiftKey && e.metaKey && e.code === "ArrowUp") {
    e.preventDefault();
    mapCam.goal.heading =
      Math.round(mapCam.goal.heading / (Math.PI * 2)) * Math.PI * 2;
    return;
  }
  if (ROAM_KEYS.has(e.code)) {
    keys.add(e.code);
    if (e.code.startsWith("Arrow") || e.code.startsWith("Alt") || e.code === "Space") {
      e.preventDefault();
    }
  }
  // +/- zoom steps, like the maps zoom buttons
  if (e.code === "Equal" || e.code === "NumpadAdd") {
    mapCam.goal.dist = clamp(mapCam.goal.dist * 0.68, 18, 2600);
  }
  if (e.code === "Minus" || e.code === "NumpadSubtract") {
    mapCam.goal.dist = clamp(mapCam.goal.dist * 1.47, 18, 2600);
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

// Per-frame integration: fling, clamps, goal-chasing, camera placement.
export function updateMapCamera(delta) {
  if (fly.on) {
    updateFreeFly(delta);
    return;
  }
  const g = mapCam.goal;

  // Fling momentum after a pan release, with exponential decay.
  if (drag.mode !== "pan" && (Math.abs(mapCam.velX) > 0.5 || Math.abs(mapCam.velZ) > 0.5)) {
    g.cx += mapCam.velX * delta;
    g.cz += mapCam.velZ * delta;
    const f = Math.exp(-3.3 * delta);
    mapCam.velX *= f;
    mapCam.velZ *= f;
  }

  // Bounds. Tilt ceiling shrinks as you zoom out, per the spec.
  g.tilt = clamp(g.tilt, 3 * DEG, maxTiltFor(g.dist));
  g.dist = clamp(g.dist, 18, 2600);
  const limX = WORLD_W * 0.9;
  const limZ = WORLD_D * 0.9;
  if (g.cx < -limX || g.cx > limX) mapCam.velX = 0;
  if (g.cz < -limZ || g.cz > limZ) mapCam.velZ = 0;
  g.cx = clamp(g.cx, -limX, limX);
  g.cz = clamp(g.cz, -limZ, limZ);

  // Current chases goal — fractional zoom + animated transitions.
  const panA = drag.mode === "pan" ? 1 : 1 - Math.exp(-9 * delta);
  const rotA = drag.mode === "rotate" ? 1 : 1 - Math.exp(-10 * delta);
  const zoomA = 1 - Math.exp(-7 * delta);
  mapCam.cx += (g.cx - mapCam.cx) * panA;
  mapCam.cz += (g.cz - mapCam.cz) * panA;
  mapCam.dist += (g.dist - mapCam.dist) * zoomA;
  mapCam.tilt += (g.tilt - mapCam.tilt) * rotA;
  mapCam.heading += (g.heading - mapCam.heading) * rotA;

  // Focus plane follows the terrain softly so low zoom hugs the relief.
  mapCam.fy +=
    (terrainHeight(mapCam.cx, mapCam.cz) - mapCam.fy) *
    (1 - Math.exp(-4 * delta));

  const sinT = Math.sin(mapCam.tilt);
  const cosT = Math.cos(mapCam.tilt);
  const vx = Math.sin(mapCam.heading);
  const vz = -Math.cos(mapCam.heading);
  let px = mapCam.cx - vx * mapCam.dist * sinT;
  let pz = mapCam.cz - vz * mapCam.dist * sinT;
  let py = mapCam.fy + mapCam.dist * cosT;
  const minY = terrainHeight(px, pz) + 5;
  if (py < minY) py = minY;
  camera.position.set(px, py, pz);
  camera.lookAt(mapCam.cx, mapCam.fy, mapCam.cz);
  controls.target.set(mapCam.cx, mapCam.fy, mapCam.cz);
}

// Tilt ceiling shrinks as you zoom out, per the Apple camera spec.
export function maxTiltFor(dist) {
  return (78 - smoothstep(900, 2600, dist) * 30) * DEG;
}

// Keyboard roam: move both camera and target across the whole world,
// so the viewpoint is never locked to one spot.
// Keyboard, per the Apple Maps manual: plain arrows pan, Option+left/
// right rotates (Option+up/down extends that to tilt), Q/E zoom.
export function updateRoam(delta) {
  if (isRigCloseup || keys.size === 0) return;
  const g = mapCam.goal;
  const alt = keys.has("AltLeft") || keys.has("AltRight");

  if (alt) {
    if (keys.has("ArrowLeft")) g.heading -= 1.7 * delta;
    if (keys.has("ArrowRight")) g.heading += 1.7 * delta;
    if (keys.has("ArrowUp")) g.tilt += 1.1 * delta;
    if (keys.has("ArrowDown")) g.tilt -= 1.1 * delta;
  }

  const speed = (26 + g.dist * 0.8) * delta;
  const hx = Math.sin(mapCam.heading);
  const hz = -Math.cos(mapCam.heading);
  const rx = Math.cos(mapCam.heading);
  const rz = Math.sin(mapCam.heading);
  let mx = 0;
  let mz = 0;
  if (keys.has("KeyW") || (!alt && keys.has("ArrowUp"))) { mx += hx; mz += hz; }
  if (keys.has("KeyS") || (!alt && keys.has("ArrowDown"))) { mx -= hx; mz -= hz; }
  if (keys.has("KeyD") || (!alt && keys.has("ArrowRight"))) { mx += rx; mz += rz; }
  if (keys.has("KeyA") || (!alt && keys.has("ArrowLeft"))) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  if (len > 0) {
    g.cx += (mx / len) * speed;
    g.cz += (mz / len) * speed;
  }

  if (keys.has("KeyE")) g.dist *= Math.pow(0.42, delta);
  if (keys.has("KeyQ")) g.dist *= Math.pow(2.4, delta);
}

// Free-fly: WASD walk relative to look, Q/E + Space down/up, with the
// camera kept inside the room shell.
const _flyLook = new THREE.Vector3();
function updateFreeFly(delta) {
  const fast = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3.2 : 1;
  const spd = 760 * fast * delta;
  const fwx = Math.sin(fly.yaw);
  const fwz = Math.cos(fly.yaw);
  const rx = Math.cos(fly.yaw);
  const rz = -Math.sin(fly.yaw);
  let mx = 0, my = 0, mz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) { mx += fwx; mz += fwz; }
  if (keys.has("KeyS") || keys.has("ArrowDown")) { mx -= fwx; mz -= fwz; }
  if (keys.has("KeyD") || keys.has("ArrowRight")) { mx += rx; mz += rz; }
  if (keys.has("KeyA") || keys.has("ArrowLeft")) { mx -= rx; mz -= rz; }
  if (keys.has("Space") || keys.has("KeyE")) my += 1;
  if (keys.has("KeyQ")) my -= 1;
  const len = Math.hypot(mx, mz);
  if (len > 0) {
    fly.x += (mx / len) * spd;
    fly.z += (mz / len) * spd;
  }
  fly.y += my * spd;

  // Keep inside the room shell and above the floor.
  const m = 120;
  fly.x = clamp(fly.x, -ROOM.RX + m, ROOM.RX - m);
  fly.z = clamp(fly.z, -ROOM.RZ + m, ROOM.RZ - m);
  fly.y = clamp(fly.y, ROOM.FLOOR_Y + 60, ROOM.CEIL - 80);

  camera.position.set(fly.x, fly.y, fly.z);
  _flyLook.set(
    fly.x + Math.sin(fly.yaw) * Math.cos(fly.pitch),
    fly.y + Math.sin(fly.pitch),
    fly.z + Math.cos(fly.yaw) * Math.cos(fly.pitch),
  );
  camera.lookAt(_flyLook);
  // Keep the map's key-light shadow frustum centred on the table.
  controls.target.set(
    clamp(fly.x, -WORLD_W * 0.5, WORLD_W * 0.5),
    0,
    clamp(fly.z, -WORLD_D * 0.5, WORLD_D * 0.5),
  );
}

// Stable tiered pixel ratio. It steps ONLY when the zoom tier changes
// (a one-time change you trigger by zooming), never frame-to-frame, so
// the far view never shimmers. Detail reduction at distance is handled
// by object LOD in the main loop — the Apple Maps / Google Earth
// approach — not by starving pixels.
export function tunePixelRatio() {
  const quality = getDistanceQuality();
  document.body.dataset.quality = quality;
  setActivePixelRatio(targetPixelRatioForQuality(quality));
}

function setActivePixelRatio(next) {
  if (Math.abs(next - pixelRatio.active) < 0.025) return;
  pixelRatio.active = next;
  renderer.setPixelRatio(pixelRatio.active);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  document.body.dataset.pixelRatio = pixelRatio.active.toFixed(2);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  pixelRatio.active = Math.min(pixelRatio.active, targetPixelRatioForQuality());
  renderer.setPixelRatio(pixelRatio.active);
  renderer.setSize(window.innerWidth, window.innerHeight);
});
