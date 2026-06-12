// THREE app singletons: scene, renderer, camera, the shared seeded RNG
// and the wind-sway registry. Created once at import time, imported by
// every module that touches the scene.
import * as THREE from "three";
import { mulberry32 } from "./utils.js?v=34";
import { PERF, isRigCloseup } from "./config.js?v=34";

export const clock = new THREE.Clock();
// ONE seeded stream feeds all procedural generation; the boot sequence in
// main.js calls the create* functions in a fixed order, so the world is
// identical on every load (and identical to the pre-refactor build).
export const rng = mulberry32(20260611);

export const scene = new THREE.Scene();

// Everything tagged onto the room's lighting layer, split in two: the
// room proper (walls/floor/furniture) and the table the map sits in.
export const roomObjects = [];
export const tableObjects = [];

export function setLayerDeep(obj, layer) {
  obj.layers.set(layer);
  for (const c of obj.children) setLayerDeep(c, layer);
}

// Background/fog = warm DIM-ROOM air (not cold black). The study is
// always rendered, so this tone only shows past the room's far walls —
// the table always sits inside its warm room, at every zoom level.
export const HAZE = new THREE.Color(0x120905);
scene.background = HAZE.clone();
scene.fog = new THREE.FogExp2(0x120905, 0.000096);

const container = document.querySelector("#scene");
export const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  depth: true,
  preserveDrawingBuffer: false,
  premultipliedAlpha: false,
  failIfMajorPerformanceCaveat: false,
  powerPreference: "high-performance", // ask for the discrete GPU
  stencil: false,
});

// Mutable pixel-ratio state shared with the zoom-tier tuner in mapcam.js.
export const pixelRatio = {
  active: Math.min(
    window.devicePixelRatio || 1,
    Math.max(PERF.minPixelRatio, isRigCloseup ? PERF.nearPixelRatio : PERF.midPixelRatio),
  ),
};
renderer.setPixelRatio(pixelRatio.active);
document.body.dataset.pixelRatio = pixelRatio.active.toFixed(2);
document.body.dataset.quality = isRigCloseup ? "near" : "mid";
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.66;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = "webgl";
container.appendChild(renderer.domElement);

// NO global IBL. The neutral-white RoomEnvironment was measured adding a
// large CONSTANT light to the map (midnight ground read 84% of noon!),
// flattening the day-night cycle and greying the daylight — and its
// per-material envMapIntensity control is inert against scene.environment
// in this build. The sun/hemisphere/moon rig in sim/daynight.js owns the
// map's light; the study owns its lamps. (The room pass already nulled
// the env — now nothing has it.)

export const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.5,
  7000,
);
camera.position.set(110, 215, 320);

export const canvasEl = renderer.domElement;

// Wind: every swaying material registers its time uniform here; the main
// loop drives them all from the MAP clock (so the accelerator speeds the
// grass up with everything else on the table).
export const windUniforms = [];
export function applyWindSway(material, strength = 0.06) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = { value: 0 };
    windUniforms.push(shader.uniforms.uWindTime);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uWindTime;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float windPhase = instanceMatrix[3][0] * 0.21 + instanceMatrix[3][2] * 0.17;
          float windAmp = transformed.y * ${strength.toFixed(3)};
          transformed.x += (sin(uWindTime * 1.7 + windPhase) + 0.6 * sin(uWindTime * 3.1 + windPhase * 1.7)) * windAmp;
          transformed.z += cos(uWindTime * 1.25 + windPhase) * windAmp * 0.6;
        #endif`,
      );
  };
}
