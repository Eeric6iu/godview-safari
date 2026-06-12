// Boot orchestration + the frame loop. The create* calls below run in
// the EXACT order of the pre-refactor build — they all draw from one
// seeded rng stream, so order = world layout. Don't reorder casually.
import * as THREE from "three";
import { L_MAP, L_ROOM, isRigCloseup } from "./core/config.js?v=34";
import {
  clock, scene, camera, renderer, setLayerDeep,
  roomObjects, tableObjects, windUniforms,
} from "./core/context.js?v=34";
import { createTerrain } from "./world/terrain.js?v=34";
import {
  createRealGrass, createGrassCards, createReeds, createShrubsAndTrees,
  createAcaciaGrove, createSafariLandmarks, createRealNature, createPalePatches,
} from "./world/vegetation.js?v=34";
import {
  createClouds, createDustHaze, createWater, createBirds, createDustSystem,
  updateClouds, updateDustHaze, updateWater, updateBirds, updateDust,
} from "./world/environment.js?v=34";
import {
  animals, herds, loadAnimalModelAssets, generateHerds,
  writeRuntimeReport, updateAnimals,
} from "./animals/animals.js?v=34";
import { createRoomAndTable, addRoomLighting } from "./room/room.js?v=34";
import {
  mapCam, fly, controls, drag,
  enterFreeFly, exitFreeFly, resetMapCamera,
  updateMapCamera, updateRoam, tunePixelRatio,
  getDistanceQuality, targetPixelRatioForQuality, zoomAt, maxTiltFor,
} from "./camera/mapcam.js?v=34";
import {
  sun, dayNight, mapClock, advanceMapClock, dayNightSample,
  updateDayNight, updateSunFollow, getMapHemi,
} from "./sim/daynight.js?v=34";
import { updateDashboard } from "./ui/dashboard.js?v=34";

// ---- World construction (order = rng stream = layout; keep it) ----
const terrain = createTerrain();
scene.add(terrain);
await createRoomAndTable();
createClouds();
createDustHaze();

await createWater();
const realGrassMeshes = await createRealGrass();
createGrassCards();
createReeds();
createShrubsAndTrees();
createAcaciaGrove();
createSafariLandmarks();
await createRealNature();
createPalePatches();
const birds = createBirds();

await loadAnimalModelAssets();
generateHerds();
createDustSystem();
writeRuntimeReport();

// Room lighting + assign every object to its lighting world. Anything
// not tagged as a room/table object is map content → daytime layer.
addRoomLighting();
const roomSet = new Set([...roomObjects, ...tableObjects]);
for (const child of scene.children) {
  if (child.isLight) continue;
  if (roomSet.has(child)) continue; // already L_ROOM
  setLayerDeep(child, L_MAP);
}
// The camera sees both worlds.
camera.layers.enable(L_MAP);
camera.layers.enable(L_ROOM);

document.body.classList.add("ready");
document.body.dataset.ready = "true";
window.__safariHerdDemoReady = true;
console.info("[godview-safari] build v34 — normal x1 object speed with longer day cycle");
window.__dbg = {
  renderer, scene, camera, controls, mapCam, fly,
  enterFreeFly, exitFreeFly, updateMapCamera,
  getDistanceQuality, targetPixelRatioForQuality,
  THREE, sun, terrain, birds, herds, animals, animate,
  roomObjects, tableObjects,
  dayNight, dayNightSample, mapClock, updateDayNight, updateSunFollow,
  updateAnimals, updateDashboard, zoomAt, maxTiltFor,
  mapHemi: () => getMapHemi(),
};

let frameIndex = 0;
let roomShown = true;
let pageVisible = true;
document.addEventListener("visibilitychange", () => {
  pageVisible = !document.hidden;
});

animate();

function animate() {
  const rawDelta = clock.getDelta();
  if (!pageVisible) {
    requestAnimationFrame(animate);
    return;
  }

  const delta = Math.min(rawDelta, 0.035);
  const elapsed = clock.elapsedTime; // REAL time — drives the room only
  frameIndex += 1;

  // ---- MAP time ----
  // One clock for everything on the table: the accelerator (×1/×4/×8)
  // scales this delta, so animals, water, clouds, dust, birds, grass
  // wind and the sun all speed up TOGETHER. The room (fireplace flicker,
  // lamps) keeps real time below — fully isolated.
  const mapDelta = advanceMapClock(delta);
  const mapElapsed = mapClock.elapsed;

  updateRoam(delta); // camera input — real time, never accelerated
  updateAnimals(mapElapsed, mapDelta);
  const quality = getDistanceQuality();
  const secondaryEvery = quality === "near" ? 1 : 2;
  const backgroundEvery = quality === "near" ? 1 : quality === "mid" ? 2 : 3;
  if (frameIndex % secondaryEvery === 0) updateDust(mapElapsed);
  if (frameIndex % secondaryEvery === 0) updateBirds(mapElapsed, mapDelta * secondaryEvery);
  if (frameIndex % secondaryEvery === 0) updateWater(mapDelta * secondaryEvery);
  if (frameIndex % backgroundEvery === 0) updateClouds(mapElapsed, mapDelta * backgroundEvery);
  if (frameIndex % backgroundEvery === 0) updateDustHaze(mapDelta * backgroundEvery);
  for (const u of windUniforms) u.value = mapElapsed;
  // Fireplace ember flicker — ROOM world, real time (never accelerated).
  {
    const f = 0.72 + Math.sin(elapsed * 9.1) * 0.1 + Math.sin(elapsed * 23.7) * 0.08;
    if (window.__fireGlow) window.__fireGlow.material.color.setRGB(f, 0.46 * f, 0.15 * f);
    if (window.__firePoint) window.__firePoint.intensity = 11 + f * 6;
    if (window.__fireSpot) window.__fireSpot.intensity = 118 + f * 48;
  }

  updateMapCamera(delta); // camera easing — real time
  updateDayNight(); // sun cycle — own fixed real-time clock, not the button
  updateSunFollow();
  updateDashboard();

  // LOD: grass cards and photoscanned clumps are invisible from far away —
  // hide them to save GPU fill-rate when the map is at arm's length or more.
  const wantGrass = fly.on || mapCam.dist < 480;
  if (window.__grassCards && window.__grassCards.visible !== wantGrass)
    window.__grassCards.visible = wantGrass;
  const wantRealGrass = fly.on || mapCam.dist < 680;
  for (const m of realGrassMeshes) {
    if (m.visible !== wantRealGrass) m.visible = wantRealGrass;
  }
  // Room lazy-load: diving into the map, the study contributes nothing
  // but fill-rate — hide walls/furniture below dist 480, restore above
  // 600 (hysteresis). The TABLE always stays; the warm haze backdrop
  // keeps the rim reading as "dim study", never a void.
  const wantRoom = fly.on || mapCam.dist > (roomShown ? 480 : 600);
  if (wantRoom !== roomShown) {
    roomShown = wantRoom;
    for (const o of roomObjects) o.visible = wantRoom;
  }

  // ---- Two-pass render: REAL lighting isolation ----
  // three.js culls LIGHTS against the CAMERA's layer mask (not per
  // object), so a single pass let the map's daylight spill onto the
  // study — measured: the room fell to 2% brightness at map-midnight.
  // Pass 1 renders the ROOM with the camera masked to L_ROOM (only the
  // lamps/fireplace survive the light cull); pass 2 renders the MAP
  // masked to L_MAP (only sun/moon/sky survive), sharing the depth
  // buffer so occlusion stays correct. Map transparents (clouds, dust)
  // draw last and blend over the room correctly. The room is now
  // mathematically incapable of seeing map time.
  camera.layers.set(L_ROOM);
  renderer.autoClear = true; // pass 1 clears color+depth, paints the haze bg
  // The study is lamp-lit ONLY: the global IBL is a neutral-white studio
  // and smears pale reflections across the parquet/panels (the "white
  // floor band"). Material envMapIntensity proved unreliable against
  // scene.environment in this three build, so the env is removed at the
  // PASS level — deterministic, and the map pass below keeps its IBL.
  const envSave = scene.environment;
  scene.environment = null;
  renderer.render(scene, camera);
  scene.environment = envSave;
  camera.layers.set(L_MAP);
  renderer.autoClear = false; // pass 2 composites on top
  const bg = scene.background;
  scene.background = null; // don't wipe pass 1
  renderer.render(scene, camera);
  scene.background = bg;
  // Restore the full mask for raycasts and any external reads.
  camera.layers.enable(0);
  camera.layers.enable(L_MAP);
  camera.layers.enable(L_ROOM);

  tunePixelRatio();
  requestAnimationFrame(animate);
}
