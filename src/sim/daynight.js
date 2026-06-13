// The MAP's daytime world: sun + sky light (L_MAP only) and the day-night
// cycle. The ×1/×4/×8 button is one scene-time multiplier: it scales BOTH
// object motion (mapClock: animals, water, clouds, dust, birds, grass wind)
// AND the sun (dayClock), so at ×4 the day races 4× faster right along with
// the herds. The ROOM lives on real time and its own lamps: completely
// isolated from this module.
import * as THREE from "three";
import { clamp, smoothstep } from "../core/utils.js";
import { WORLD_W, WORLD_D, L_MAP, params } from "../core/config.js";
import { scene } from "../core/context.js";
import { controls } from "../camera/mapcam.js";

export const sunOffset = new THREE.Vector3();
let mapHemi = null; // hemisphere light for the map, driven by day-night

// The ×1/×4/×8 button is a single SCENE-TIME multiplier: it scales the
// whole table together — objects AND the sun. ×1 is the normal pace, ×4 is
// exactly 4×, ×8 exactly 8×. Two clocks exist only because objects and the
// sun have different ×1 baselines (object speed vs. day length), but both
// carry the same speedMul, so the time-of-day races forward at ×4/×8 just
// like the animals do.
//
//   · OBJECT MOTION (animals, clouds, dust, birds, grass wind): speed =
//     motionX1 × button. ×1 = motionX1, ×4 = 4×, ×8 = 8×.
//   · DAY-NIGHT CYCLE (the sun): a full day lasts dayRealSeconds / button
//     real-seconds. ×1 = dayRealSeconds, ×4 = ¼ of that, ×8 = ⅛.
export const dayNight = {
  // phase ∈ [0,1): 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight.
  phase: Number(params.get("t0") ?? 0.46), // start near sunset for the warm study grade
  // A full sunrise→sunset→night cycle lasts this many REAL seconds AT ×1.
  // ×4/×8 divide it (sun runs 4×/8× faster). This is the normal-day length.
  dayRealSeconds: Math.max(20, Number(params.get("day") || 360)),
  auto: params.get("day") !== "0",
  // ×1 baseline for OBJECT motion. ×1 = this, ×4 = 4×, ×8 = 8×.
  motionX1: Math.max(0.1, Number(params.get("motion") || 3)),
  speedMul: 1, // the ×1 / ×4 / ×8 button — scales objects AND the sun
};

// Object-motion stream (scales with the button).
export const mapClock = { elapsed: 0, delta: 0 };
// Sun stream: also scales with the button, but off the fixed ×1 day length.
export const dayClock = { delta: 0 };
export function advanceMapClock(realDelta) {
  mapClock.delta = realDelta * dayNight.motionX1 * dayNight.speedMul;
  mapClock.elapsed += mapClock.delta;
  dayClock.delta = realDelta * dayNight.speedMul; // sun races with the button too
  return mapClock.delta;
}

// Per-frame sample of the cycle, read by the dashboard to mirror the
// real lighting on the sun-orb dial (sky tint, sun colour, glow).
export const dayNightSample = {
  ang: 0,
  el: 0,
  day: 0,
  horizon: 0,
  sunColorHex: "#fff3da",
};

// Light colours for the current time, reused each frame (no per-frame alloc).
const __sunColor = new THREE.Color();
const __hemiSky = new THREE.Color();
const __hemiGround = new THREE.Color();
// Palette keyframes.
// DAY = the aerial-photo look: near-WHITE sun blazing over pale-gold
// straw, bright sky fill — never a dim amber wash.
// NIGHT = the game-industry convention (GTA et al.): never pitch black,
// a MID-BLUE ambient ("70–80% night") with a cool moon key — clearly
// night, still readable.
export const DN = {
  sunWarm: new THREE.Color(0xff7a36),
  sunWhite: new THREE.Color(0xfdfbf6),
  hemiSkyDay: new THREE.Color(0xf6f9ff),
  hemiSkyNight: new THREE.Color(0x42609a),
  hemiGroundDay: new THREE.Color(0xe0d2bc),
  hemiGroundNight: new THREE.Color(0x2a3452),
  hemiWarm: new THREE.Color(0xffb878),
  // Orb-dashboard palette: the widget's sky/ground mirror the real cycle.
  orbSkyNight: new THREE.Color(0x0a1024),
  orbSkyDay: new THREE.Color(0x8aa6c8),
  orbSkyGlow: new THREE.Color(0xc56a2c),
  orbEarthDay: new THREE.Color(0xb59265),
  orbEarthNight: new THREE.Color(0x241a12),
};

export function addLighting() {
  // --- MAP world: full daytime light, layer L_MAP only ---
  // High-noon sky: bright, slightly blue zenith over warm ground.
  const hemi = new THREE.HemisphereLight(0xf6f9ff, 0xe0d2bc, 4.6);
  hemi.layers.set(L_MAP);
  scene.add(hemi);
  mapHemi = hemi; // day-night cycle drives its colour + intensity

  // Noon sun: nearly overhead, white-hot, short crisp shadows.
  const s = new THREE.DirectionalLight(0xfdfbf6, 7.2);
  sunOffset.set(60, 520, 45);
  s.position.copy(sunOffset);
  s.castShadow = true;
  s.shadow.mapSize.set(2048, 2048);
  s.shadow.camera.left = -240;
  s.shadow.camera.right = 240;
  s.shadow.camera.top = 200;
  s.shadow.camera.bottom = -200;
  s.shadow.camera.near = 1;
  s.shadow.camera.far = 720;
  s.shadow.bias = -0.00025;
  s.layers.set(L_MAP);
  s.target.layers.set(L_MAP);
  scene.add(s);
  scene.add(s.target);
  return s;
}

export const sun = addLighting();

// MOONLIGHT: a cool blue key opposite the sun — the game-night look. It
// gives the night plain shape and a clear blue cast instead of brown murk.
// No shadows (too dim to matter, and the shadow pass is the expensive
// part). L_MAP only: the room's own lamps never see it.
export const moonOffset = new THREE.Vector3();
export const moon = new THREE.DirectionalLight(0x5184e4, 0);
moon.layers.set(L_MAP);
moon.target.layers.set(L_MAP);
scene.add(moon);
scene.add(moon.target);

export function getMapHemi() {
  return mapHemi;
}

// Move the sun (and its shadow frustum) to track the focus point so
// shadows stay crisp anywhere you roam across the big map.
export function updateSunFollow() {
  // Clamp the key light to the table so the map keeps crisp shadows
  // even when the camera roams off into the room (free-fly).
  const tx = clamp(controls.target.x, -WORLD_W * 0.5, WORLD_W * 0.5);
  const tz = clamp(controls.target.z, -WORLD_D * 0.5, WORLD_D * 0.5);
  sun.target.position.set(tx, 0, tz);
  sun.position.set(tx + sunOffset.x, sunOffset.y, tz + sunOffset.z);
  sun.target.updateMatrixWorld();
  // The moon tracks the same focus from the opposite side of the sky.
  moon.target.position.set(tx, 0, tz);
  moon.position.set(tx + moonOffset.x, moonOffset.y, tz + moonOffset.z);
  moon.target.updateMatrixWorld();
}

// Advance the day-night cycle and re-grade the MAP world for the time of
// day: the sun arcs E→W and sinks below the horizon at night, its colour
// warms at dawn/dusk and whitens at noon, the sky-light dims to a cool
// moonlit floor after dark. The study room is a separate lighting world
// and stays put. The cycle runs on dayClock, which carries the speed
// button: a full day lasts dayRealSeconds at ×1, ¼ of that at ×4, ⅛ at ×8.
export function updateDayNight() {
  if (dayNight.auto) {
    dayNight.phase = (dayNight.phase + dayClock.delta / dayNight.dayRealSeconds) % 1;
    if (dayNight.phase < 0) dayNight.phase += 1;
  }
  const ph = dayNight.phase;
  const ang = ph * Math.PI * 2; // 0 dawn · π/2 noon · π dusk · 3π/2 midnight
  const el = Math.sin(ang); // sun elevation, [-1,1]
  const day = Math.max(0, el); // 0 at/under the horizon, 1 at noon

  // Sun arc: east (+x) at dawn → overhead → west (−x) at dusk; a fixed
  // lateral offset keeps shadows from falling dead-straight.
  sunOffset.set(Math.cos(ang) * 380, Math.max(el, -0.25) * 520, 120);

  // Sun colour warms near the horizon, whitens high in the sky.
  const warmMix = smoothstep(0.1, 0.55, el);
  __sunColor.copy(DN.sunWarm).lerp(DN.sunWhite, warmMix);
  sun.color.copy(__sunColor);
  sun.intensity = day * 7.2;
  // No point casting (or paying for) shadows once the sun is down.
  sun.castShadow = el > 0.06;

  // Cool blue moonlight: opposite the sun, fading in as the sun sets.
  const nightT = smoothstep(0.04, 0.4, -el);
  moonOffset.set(-Math.cos(ang) * 380, Math.max(-el, 0.12) * 520, -120);
  moon.intensity = nightT * 3.8;

  // Sky light: mid-blue floor at night (game-night, never black),
  // bright by day, with an amber push at the horizon for golden hour.
  const horizon = clamp(1 - Math.abs(el) / 0.22, 0, 1) * (el > -0.05 ? 1 : 0);
  __hemiSky.copy(DN.hemiSkyNight).lerp(DN.hemiSkyDay, day).lerp(DN.hemiWarm, horizon * 0.5);
  __hemiGround.copy(DN.hemiGroundNight).lerp(DN.hemiGroundDay, day);
  mapHemi.color.copy(__hemiSky);
  mapHemi.groundColor.copy(__hemiGround);
  mapHemi.intensity = 2.0 + day * 2.6;

  // Background stays the warm study haze at every hour — the diorama
  // always lives inside its room; only the MAP's lighting follows the
  // clock.

  // Publish the sample the dashboard mirrors onto the sun-orb dial.
  dayNightSample.ang = ang;
  dayNightSample.el = el;
  dayNightSample.day = day;
  dayNightSample.horizon = horizon;
  dayNightSample.sunColorHex = "#" + __sunColor.getHexString();
}
