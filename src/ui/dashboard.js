// The right-side control dashboard: clock pill, sun-orb time dial with
// the ×1/×4/×8 accelerator, tilt slider, zoom, reset and compass. This
// module only WIRES DOM to the camera/day-night state and mirrors that
// state back per frame — all behavior lives in mapcam.js / daynight.js.
import { clamp } from "../core/utils.js?v=35";
import { DEG } from "../core/config.js?v=35";
import {
  mapCam, zoomAt, resetMapCamera, maxTiltFor,
} from "../camera/mapcam.js?v=35";
import { dayNight, dayNightSample, DN } from "../sim/daynight.js?v=35";

// ---- Compass: drag rotates/tilts, plain click animates back to north ----
const compassNeedle = document.getElementById("compassNeedle");
const compassEl = document.getElementById("compass");
const cdrag = { on: false, lastX: 0, lastY: 0, moved: 0 };
compassEl.addEventListener("pointerdown", (e) => {
  cdrag.on = true;
  cdrag.lastX = e.clientX;
  cdrag.lastY = e.clientY;
  cdrag.moved = 0;
  try {
    compassEl.setPointerCapture(e.pointerId);
  } catch {}
  e.preventDefault();
});
compassEl.addEventListener("pointermove", (e) => {
  if (!cdrag.on) return;
  const dx = e.clientX - cdrag.lastX;
  const dy = e.clientY - cdrag.lastY;
  cdrag.lastX = e.clientX;
  cdrag.lastY = e.clientY;
  cdrag.moved += Math.abs(dx) + Math.abs(dy);
  mapCam.goal.heading += dx * 0.012;
  mapCam.goal.tilt -= dy * 0.008;
});
compassEl.addEventListener("pointerup", () => {
  if (cdrag.on && cdrag.moved < 4) {
    // unwind to nearest north so the needle takes the short way around
    mapCam.goal.heading =
      Math.round(mapCam.goal.heading / (Math.PI * 2)) * Math.PI * 2;
  }
  cdrag.on = false;
});

// ---- Zoom +/- and reset ----
document.getElementById("zoomIn").addEventListener("click", () => {
  zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.68);
});
document.getElementById("zoomOut").addEventListener("click", () => {
  zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.47);
});
document.getElementById("resetView").addEventListener("click", resetMapCamera);

// ---- Tilt slider (Apple Maps style): up = top-down, down = oblique ----
// Geometry derives from the element's real height (token-driven), with
// an 8px pad and an 18px knob: travel = height − 34.
const tiltCtlEl = document.getElementById("tiltCtl");
const tiltKnob = document.getElementById("tiltKnob");
const tdrag = { on: false };
function tiltTravel() {
  return Math.max(20, tiltCtlEl.clientHeight - 34);
}
function tiltFromPointer(e) {
  const rect = tiltCtlEl.getBoundingClientRect();
  const travel = tiltTravel();
  const ratio = clamp((e.clientY - rect.top - 17) / travel, 0, 1);
  const t = 3 * DEG + ratio * (maxTiltFor(mapCam.goal.dist) - 3 * DEG);
  // Direct manipulation: both current and goal, zero easing lag.
  mapCam.tilt = mapCam.goal.tilt = t;
  tiltKnob.style.top = (8 + ratio * travel).toFixed(1) + "px";
}
tiltCtlEl.addEventListener("pointerdown", (e) => {
  tdrag.on = true;
  try {
    tiltCtlEl.setPointerCapture(e.pointerId);
  } catch {}
  tiltFromPointer(e);
  e.preventDefault();
});
tiltCtlEl.addEventListener("pointermove", (e) => {
  if (tdrag.on) tiltFromPointer(e);
});
tiltCtlEl.addEventListener("pointerup", () => (tdrag.on = false));
tiltCtlEl.addEventListener("pointercancel", () => (tdrag.on = false));

// ---- Sun-orb time dial ----
// The small ball (sun) orbits the big ball (ground sphere): rises on
// the left, day while above the horizon line, night below. Drag the
// sun to scrub time; tap the dial to cycle the accelerator; the speed
// row sets it directly. The accelerator scales the MAP clock only —
// the room is a separate time world and never speeds up.
const ORB = {
  root: document.getElementById("sunOrb"),
  svg: document.getElementById("orbSvg"),
  sky: document.getElementById("orbSky"),
  earth: document.getElementById("orbEarth"),
  sun: document.getElementById("orbSun"),
  glow: document.getElementById("orbSunGlow"),
  moon: document.getElementById("orbMoon"),
};
const SPEED_BTNS = [
  [1, document.getElementById("spd1")],
  [4, document.getElementById("spd4")],
  [8, document.getElementById("spd8")],
];
for (const [mul, btn] of SPEED_BTNS) {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dayNight.speedMul = mul;
  });
  // The buttons live inside the orb's pointer area — keep presses on
  // them from starting a dial scrub.
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
}

const odrag = { on: false, moved: 0 };
function orbScrub(e) {
  const rect = ORB.svg.getBoundingClientRect();
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = e.clientY - (rect.top + rect.height / 2);
  if (Math.hypot(dx, dy) < 4) return;
  // Sun sits at (50 − 38·cosθ, 50 − 38·sinθ), θ = phase·2π — invert it.
  const a = Math.atan2(-dy, -dx);
  dayNight.phase = ((a / (Math.PI * 2)) % 1 + 1) % 1;
}
ORB.root.addEventListener("pointerdown", (e) => {
  odrag.on = true;
  odrag.moved = 0;
  try {
    ORB.root.setPointerCapture(e.pointerId);
  } catch {}
  e.preventDefault();
});
ORB.root.addEventListener("pointermove", (e) => {
  if (!odrag.on) return;
  odrag.moved += Math.abs(e.movementX ?? 1) + Math.abs(e.movementY ?? 1);
  if (odrag.moved > 4) orbScrub(e);
});
ORB.root.addEventListener("pointerup", () => {
  if (odrag.on && odrag.moved <= 4) {
    // Plain tap on the dial: cycle the time accelerator.
    const idx = SPEED_BTNS.findIndex(([mul]) => mul === dayNight.speedMul);
    dayNight.speedMul = SPEED_BTNS[(idx + 1) % SPEED_BTNS.length][0];
  }
  odrag.on = false;
});
ORB.root.addEventListener("pointercancel", () => (odrag.on = false));

// ---- Time keys: T pauses/resumes the clock, [ and ] scrub by hand ----
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyT" && !e.metaKey && !e.ctrlKey) {
    dayNight.auto = !dayNight.auto;
    return;
  }
  if (e.code === "BracketLeft") {
    dayNight.phase = (dayNight.phase + 0.965) % 1; // step back ~50 min
    return;
  }
  if (e.code === "BracketRight") {
    dayNight.phase = (dayNight.phase + 0.035) % 1; // step forward ~50 min
  }
});

// Scratch colors for the orb tinting (no per-frame alloc).
const __orbSky = DN.orbSkyNight.clone();
const __orbEarth = DN.orbEarthNight.clone();
const dayClockEl = document.getElementById("dayClock");
let lastSpeedMul = 0;

// Per-frame mirror: compass needle, tilt knob, clock text and the
// sun-orb dial all reflect the live camera / day-night state.
export function updateDashboard() {
  // Compass needle tracks the heading.
  if (compassNeedle) {
    compassNeedle.style.transform =
      `rotate(${(-mapCam.heading / DEG).toFixed(1)}deg)`;
  }

  // Tilt knob mirrors the camera unless a finger owns it.
  if (tiltKnob && !tdrag.on) {
    const span = Math.max(maxTiltFor(mapCam.goal.dist) - 3 * DEG, 0.001);
    const ratio = clamp((mapCam.tilt - 3 * DEG) / span, 0, 1);
    tiltKnob.style.top = (8 + ratio * tiltTravel()).toFixed(1) + "px";
  }

  const ph = dayNight.phase;
  const { ang, el, day, horizon, sunColorHex } = dayNightSample;

  // Clock pill: phase 0 = 06:00, 0.25 = 12:00, 0.5 = 18:00, 0.75 = 00:00.
  if (dayClockEl) {
    const hours = (ph * 24 + 6) % 24;
    const hh = Math.floor(hours);
    const mm = Math.floor((hours - hh) * 60);
    const label =
      el > 0.4 ? "Day" : el > 0.04 ? (ph < 0.25 ? "Sunrise" : "Sunset")
        : el > -0.04 ? "Horizon" : "Night";
    const speed = dayNight.speedMul > 1 ? ` ×${dayNight.speedMul}` : "";
    dayClockEl.textContent =
      `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} · ${label}${speed}` +
      (dayNight.auto ? "" : " ⏸");
  }

  // Sun-orb dial mirrors the REAL lighting: the widget sky takes the
  // cycle's sky tone (sunset glow included), the ground ball darkens at
  // night, and the sun ball carries the actual sun colour — bright and
  // glowing above the horizon, a pale dim disc once it has set. The
  // moon rides exactly opposite the sun.
  if (ORB.sun) {
    const sx = 50 - 38 * Math.cos(ang);
    const sy = 50 - 38 * Math.sin(ang);
    ORB.sun.setAttribute("cx", sx.toFixed(2));
    ORB.sun.setAttribute("cy", sy.toFixed(2));
    ORB.glow.setAttribute("cx", sx.toFixed(2));
    ORB.glow.setAttribute("cy", sy.toFixed(2));
    ORB.moon.setAttribute("cx", (100 - sx).toFixed(2));
    ORB.moon.setAttribute("cy", (100 - sy).toFixed(2));
    __orbSky
      .copy(DN.orbSkyNight)
      .lerp(DN.orbSkyDay, smoothstepNum(-0.12, 0.42, el))
      .lerp(DN.orbSkyGlow, horizon * 0.6);
    ORB.sky.setAttribute("fill", "#" + __orbSky.getHexString());
    __orbEarth.copy(DN.orbEarthNight).lerp(DN.orbEarthDay, day);
    ORB.earth.setAttribute("fill", "#" + __orbEarth.getHexString());
    if (el > 0) {
      ORB.sun.setAttribute("fill", sunColorHex);
      ORB.glow.setAttribute("opacity", (0.18 + day * 0.3).toFixed(2));
    } else {
      ORB.sun.setAttribute("fill", "#5a6478");
      ORB.glow.setAttribute("opacity", "0");
    }
  }

  // Speed segmented control: highlight the active multiplier.
  if (dayNight.speedMul !== lastSpeedMul) {
    lastSpeedMul = dayNight.speedMul;
    for (const [mul, btn] of SPEED_BTNS) {
      btn.classList.toggle("active", mul === dayNight.speedMul);
    }
  }
}

// local smoothstep on numbers (utils version is identical; inlined name
// avoids importing into the hot path twice)
function smoothstepNum(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 0.0001), 0, 1);
  return t * t * (3 - 2 * t);
}
