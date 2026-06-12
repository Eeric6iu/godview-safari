// Animals: data-driven species specs (real-world metres), herd plans with
// behaviors, glTF loading + skinned-mesh merging, the pseudo-rig vertex
// deformer for models without usable skeletons, and the per-frame herd
// update (driven by the MAP clock, so the time accelerator scales it).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { clamp, lerpAngle, smoothstep, wrapSigned, rotate2D } from "../core/utils.js?v=35";
import {
  WORLD_W, WORLD_D, M_UNIT, ANIMAL_BX, ANIMAL_BZ,
  LAKES, lakeRadiusAt, isRigCloseup,
} from "../core/config.js?v=35";
import { rng, scene, camera } from "../core/context.js?v=35";
import { material } from "../core/materials.js?v=35";
import { terrainHeight } from "../world/terrain.js?v=35";
import { getDistanceQuality } from "../camera/mapcam.js?v=35";

export const animals = [];
export const herds = [];
const modelLoader = new GLTFLoader();
const loadedAnimalModels = new Map();

// ---- Species tokens ----
// One spec per species: model source, true body size in METRES (fitSize ×
// M_UNIT = world units), shadow footprint, rig mode and animation. Every
// animal is built FROM this table — no per-animal one-off code.
export const MODEL_SPECS = {
  // Farm-pack models (zebra/horse/buffalo) have a 100x armature with
  // 0.01x bones — three's skinning flattens them invisible. They run
  // as static meshes with the same pseudo-rig the elephant uses.
  zebra: {
    url: "assets/models/poly-pizza/zebra.glb",
    fitSize: 2.3, // real zebra body length ≈ 2.3 m
    shadowW: 0.92,
    shadowL: 1.38,
    staticDeform: true,
    // Measured: the zebra's body runs along its local Z (z=8.95 ≫ x=2.47),
    // exactly like the deer/horse/elephant which all face correctly with
    // forwardAxis "z+" + yaw 0. The old "x-" / yaw π/2 rotated it 90° →
    // the zebra walked sideways. Match the other Z-body animals.
    forwardAxis: "z+",
    yaw: 0,
    legAmplitude: 0.42,
    deformSpeed: 1.35,
  },
  elephant: {
    url: "assets/models/poly-pizza/elephant.glb",
    fitSize: 6.8, // African elephant body length ≈ 6.5–7 m
    shadowW: 1.36,
    shadowL: 1.9,
    staticDeform: true,
    forwardAxis: "z+",
    legAmplitude: 0.28,
    deformSpeed: 1.05,
  },
  giraffe: {
    url: "assets/models/poly-pizza/giraffe.glb",
    fitSize: 5.3, // giraffe standing height ≈ 5–5.5 m (max axis)
    shadowW: 0.75,
    shadowL: 1.45,
    staticDeform: true,
    forwardAxis: "x+",
    yaw: -Math.PI / 2,
    legAmplitude: 0.34,
    deformSpeed: 1.18,
  },
  deer: {
    url: "assets/models/quaternius/deer.gltf",
    fitSize: 1.9, // red deer / impala-scale body length ≈ 1.9 m
    shadowW: 0.58,
    shadowL: 1.15,
    movingClip: "Gallop",
    actionSpeed: 1.55,
  },
  stag: {
    url: "assets/models/quaternius/stag.gltf",
    fitSize: 2.0, // larger antelope/stag body length ≈ 2 m
    shadowW: 0.62,
    shadowL: 1.22,
    movingClip: "Gallop",
    actionSpeed: 1.42,
  },
  bull: {
    url: "assets/models/quaternius/bull.gltf",
    fitSize: 2.5, // cattle/eland body length ≈ 2.5 m
    shadowW: 0.78,
    shadowL: 1.35,
    movingClip: "Gallop",
    actionSpeed: 1.2,
  },
  // The animals below all come from the same Quaternius "Ultimate
  // Animated Animal Pack" (CC0, official Google Drive) as deer/stag/
  // bull — the pack whose skeletons and Gallop clips work flawlessly.
  horse: {
    url: "assets/models/quaternius/HorseU.gltf",
    fitSize: 2.4, // wild horse body length ≈ 2.4 m
    shadowW: 0.85,
    shadowL: 1.45,
    movingClip: "Gallop",
    actionSpeed: 1.3,
  },
  buffalo: {
    // Bull re-graded dark + scaled up = African buffalo (Big Five).
    url: "assets/models/quaternius/bull.gltf",
    fitSize: 3.0, // African buffalo body length ≈ 3 m
    shadowW: 0.95,
    shadowL: 1.5,
    movingClip: "Gallop",
    actionSpeed: 1.1,
    tint: 0x6b5a48,
  },
  wildebeest: {
    // Ultimate-pack cow re-graded slate-grey = wildebeest, the
    // migration regular in every aerial reference shot.
    url: "assets/models/quaternius/CowU.gltf",
    fitSize: 2.3, // wildebeest body length ≈ 2.3 m
    shadowW: 0.85,
    shadowL: 1.4,
    movingClip: "Gallop",
    actionSpeed: 1.25,
    tint: 0x6e645c,
  },
  donkey: {
    // African wild ass — the donkey works as-is.
    url: "assets/models/quaternius/Donkey.gltf",
    fitSize: 2.0, // African wild ass body length ≈ 2 m
    shadowW: 0.78,
    shadowL: 1.3,
    movingClip: "Gallop",
    actionSpeed: 1.3,
  },
  jackal: {
    // Wolf re-graded sandy = jackal, the predator the scene lacked.
    url: "assets/models/quaternius/Wolf.gltf",
    fitSize: 1.0, // jackal body length ≈ 0.9–1 m
    shadowW: 0.55,
    shadowL: 1.1,
    movingClip: "Gallop",
    actionSpeed: 1.5,
    tint: 0xc7a368,
  },
};

// ---- Herd behavior tokens ----
// Wild herbivores live in TIGHT groups; only a few individuals stray.
// Each species gets several herds with different behaviors:
//   run   — galloping migration across the map (Gallop clip, fast)
//   walk  — slow marching column (Walk clip, ~1/3 speed)
//   graze — loitering on home range, drifting in a slow loop (Walk)
// scale stays 1.0 for every species: real-world size lives in fitSize.
export const HERD_PLANS = [
  // type, speed, scale, plans: [behavior, herds, countLo, countHi]
  { type: "wildebeest", speed: 6.5, scale: 1.0, plans: [["run", 3, 22, 32], ["walk", 2, 18, 26], ["graze", 1, 12, 18]] },
  { type: "deer", speed: 8.0, scale: 1.0, plans: [["run", 2, 18, 26], ["walk", 2, 14, 22], ["graze", 1, 10, 16]] },
  { type: "stag", speed: 7.3, scale: 1.0, plans: [["run", 2, 14, 20], ["walk", 1, 12, 18], ["graze", 1, 10, 14]] },
  { type: "bull", speed: 5.8, scale: 1.0, plans: [["run", 2, 16, 24], ["walk", 2, 14, 20]] },
  { type: "horse", speed: 6.8, scale: 1.0, plans: [["run", 2, 10, 16], ["walk", 1, 8, 14], ["graze", 1, 6, 10]] },
  { type: "buffalo", speed: 5.2, scale: 1.0, plans: [["run", 1, 12, 18], ["walk", 2, 12, 18], ["graze", 2, 8, 14]] },
  { type: "donkey", speed: 6.0, scale: 1.0, plans: [["walk", 1, 6, 10], ["graze", 1, 5, 8]] },
  { type: "jackal", speed: 7.5, scale: 1.0, plans: [["run", 2, 3, 5]] },
  // pseudo-rig species: unchanged, modest counts
  { type: "zebra", speed: 5.9, scale: 1.0, plans: [["run", 2, 12, 18], ["walk", 2, 10, 16]] },
  { type: "elephant", speed: 2.45, scale: 1.0, plans: [["walk", 3, 4, 7]] },
  { type: "giraffe", speed: 3.45, scale: 1.0, plans: [["walk", 3, 3, 6]] },
];
// Tight formations: spread by behavior, not species.
const BEHAVIOR_SPREAD = { run: [85, 20], walk: [65, 18], graze: [42, 16] };
const BEHAVIOR_SPEED = { run: 1.0, walk: 0.32, graze: 0.17 };
const BEHAVIOR_CLIP = { run: null, walk: "Walk", graze: "Walk" };

// Spawn every herd from the plan table (call order = rng stream order).
export function generateHerds() {
  for (const sp of HERD_PLANS) {
    for (const [behavior, nHerds, lo, hi] of sp.plans) {
      for (let g = 0; g < nHerds; g++) {
        let ox = 0;
        let oz = 0;
        for (let attempt = 0; attempt < 30; attempt++) {
          ox = (rng() - 0.5) * WORLD_W * 0.86;
          oz = (rng() - 0.5) * WORLD_D * 0.86;
          if (LAKES.every((l) => Math.hypot(ox - l.x, oz - l.z) > l.r * 2.2)) break;
        }
        const ang = rng() * Math.PI * 2;
        createHerd({
          type: sp.type,
          behavior,
          clipOverride: BEHAVIOR_CLIP[behavior],
          count: lo + Math.floor(rng() * (hi - lo + 1)),
          origin: new THREE.Vector3(ox, 0, oz),
          direction: new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)),
          speed: sp.speed * BEHAVIOR_SPEED[behavior] * (0.92 + rng() * 0.16),
          spread: BEHAVIOR_SPREAD[behavior],
          scale: sp.scale,
        });
      }
    }
  }
}

function createHerd(config) {
  if (isRigCloseup && !["elephant", "giraffe"].includes(config.type)) {
    return;
  }

  if (isRigCloseup) {
    config = {
      ...config,
      count: 4,
      origin:
        config.type === "elephant"
          ? new THREE.Vector3(-9, 0, 5)
          : new THREE.Vector3(8, 0, -4),
      spread: [8, 3.5],
      scale: config.type === "elephant" ? 1.7 : 1.35,
    };
  }

  const dir = config.direction.clone().normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const memberCount = isRigCloseup ? Math.min(config.count, 5) : config.count;
  // The herd's track crosses the WHOLE map: keep only the origin's
  // sideways component, and let travel wrap at the map edges so
  // animals recycle at the rim — never mid-plain.
  const alongOrigin = config.origin.x * dir.x + config.origin.z * dir.z;
  const herd = {
    ...config,
    direction: dir,
    side,
    alongOrigin,
    baseX: config.origin.x - dir.x * alongOrigin,
    baseZ: config.origin.z - dir.z * alongOrigin,
    halfSpan:
      (Math.abs(dir.x) * WORLD_W + Math.abs(dir.z) * WORLD_D) * 0.5 - 12,
    members: [],
    dustAnchor: config.origin.clone(),
  };
  herds.push(herd);

  for (let i = 0; i < memberCount; i++) {
    const animal = createAnimal(
      config.type,
      config.scale * (0.82 + rng() * 0.34),
      config.clipOverride,
    );
    const lane = (rng() - 0.5) * config.spread[1];
    const along = (rng() - 0.5) * config.spread[0];
    const phase = rng() * 100;
    const pace = 0.84 + rng() * 0.32;
    animal.userData.herd = herd;
    animal.userData.lane = lane;
    animal.userData.along = along;
    animal.userData.phase = phase;
    animal.userData.pace = pace;
    animal.userData.speed = config.speed * pace;
    animal.userData.legSeed = rng() * Math.PI * 2;
    if (animal.userData.action) {
      animal.userData.action.setEffectiveTimeScale(
        animal.userData.baseActionSpeed * (0.82 + pace * 0.32),
      );
    }
    herd.members.push(animal);
    animals.push(animal);
    scene.add(animal);
  }
}

function mergeSkinnedModel(sceneRoot) {
  const meshes = [];
  sceneRoot.traverse((o) => {
    if (o.isSkinnedMesh) meshes.push(o);
  });
  if (meshes.length < 2) return;
  const ref = meshes[0];
  for (const m of meshes) {
    // bail out on anything unusual — original meshes stay untouched
    if (m.material.map) return;
    if (m.skeleton.bones.length !== ref.skeleton.bones.length) return;
    if (!m.matrix.equals(ref.matrix)) return;
  }
  const geos = [];
  for (const m of meshes) {
    const g = m.geometry.clone();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = m.material.color;
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const keep = ["position", "normal", "uv", "skinIndex", "skinWeight", "color"];
    for (const k of Object.keys(g.attributes)) {
      if (!keep.includes(k)) g.deleteAttribute(k);
    }
    if (!g.attributes.uv) {
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  if (!merged) return;
  const sm = new THREE.SkinnedMesh(
    merged,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
  );
  sm.castShadow = true;
  sm.receiveShadow = true;
  sm.position.copy(ref.position);
  sm.rotation.copy(ref.rotation);
  sm.scale.copy(ref.scale);
  ref.parent.add(sm);
  sm.bind(ref.skeleton, ref.bindMatrix);
  for (const m of meshes) m.parent.remove(m);
}

export async function loadAnimalModelAssets() {
  const entries = Object.entries(MODEL_SPECS);
  const results = await Promise.allSettled(
    entries.map(async ([type, spec]) => {
      const gltf = await modelLoader.loadAsync(spec.url);
      const tint = spec.tint ? new THREE.Color(spec.tint) : null;
      // Pseudo-rig types must not render through the skinning path —
      // swap each SkinnedMesh for a plain Mesh of its bind-pose
      // geometry (same transform chain, same material).
      if (spec.staticDeform) {
        const swaps = [];
        gltf.scene.traverse((object) => {
          if (object.isSkinnedMesh) swaps.push(object);
        });
        for (const skinned of swaps) {
          const plain = new THREE.Mesh(skinned.geometry, skinned.material);
          plain.position.copy(skinned.position);
          plain.rotation.copy(skinned.rotation);
          plain.scale.copy(skinned.scale);
          skinned.parent.add(plain);
          skinned.parent.remove(skinned);
        }
      }
      gltf.scene.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const mat of materials) {
          if (!mat) continue;
          mat.roughness = Math.max(mat.roughness ?? 0.82, 0.82);
          // multiply keeps the model's light/dark pattern under the tint
          if (tint && mat.color) mat.color.multiply(tint);
        }
      });
      // Collapse the 7-8 per-part SkinnedMeshes into ONE mesh per
      // animal (their part colors baked into vertex colors, all parts
      // share the single glTF skin). With ~600 animals this cuts the
      // scene's draw calls by ~85%.
      if (!spec.staticDeform) mergeSkinnedModel(gltf.scene);
      loadedAnimalModels.set(type, {
        scene: gltf.scene,
        animations: gltf.animations,
        spec,
      });
    }),
  );

  const report = {
    loaded: [...loadedAnimalModels.entries()].map(([type, asset]) => ({
      type,
      use: asset.spec.staticDeform ? "gltf-pseudo-rig" : "gltf-model",
      clips: asset.animations.map((clip) => clip.name || "unnamed"),
    })),
    failed: results
      .map((result, index) => ({ result, type: entries[index][0] }))
      .filter((item) => item.result.status === "rejected")
      .map((item) => item.type),
  };
  window.__safariModelLoadReport = report;
  document.body.dataset.modelReport = JSON.stringify(report);
}

export function writeRuntimeReport() {
  const byType = {};
  for (const animal of animals) {
    const type = animal.userData.type;
    byType[type] ??= {
      count: 0,
      mode: animal.userData.deformedModel
        ? "gltf-pseudo-rig"
        : animal.userData.loadedModel
          ? "gltf-model"
          : "procedural-rig",
      clip: animal.userData.clipName || null,
      legs: animal.userData.syntheticLegs ?? animal.userData.legs?.length ?? 0,
      dynamicParts: animal.userData.dynamicParts?.map((part) => part.kind) ?? [],
    };
    byType[type].count += 1;
  }
  window.__safariRuntimeReport = byType;
  document.body.dataset.runtimeReport = JSON.stringify(byType);
}

function createAnimal(type, scale, clipOverride) {
  const loadedAnimal = createLoadedAnimal(type, scale, clipOverride);
  if (loadedAnimal) return loadedAnimal;

  const root = new THREE.Group();
  root.userData.type = type;
  root.userData.scale = scale;
  root.userData.legs = [];
  root.userData.dynamicParts = [];

  const palette = {
    zebra: { body: 0xdbd2bd, dark: 0x363432, leg: 0xd9d1c2 },
    elephant: { body: 0x6f6861, dark: 0x4f4b47, leg: 0x67615b },
    giraffe: { body: 0xc39555, dark: 0x67462b, leg: 0xbd8848 },
    antelope: { body: 0xb0733d, dark: 0x4d3324, leg: 0x8b5d34 },
    wildebeest: { body: 0x403a31, dark: 0x28251f, leg: 0x343029 },
    deer: { body: 0xb0733d, dark: 0x4d3324, leg: 0x8b5d34 },
    stag: { body: 0x9b6839, dark: 0x3f2c20, leg: 0x76502f },
    bull: { body: 0x403a31, dark: 0x28251f, leg: 0x343029 },
    horse: { body: 0x76533d, dark: 0x31261f, leg: 0x684934 },
    cow: { body: 0x7b6654, dark: 0x2f2a25, leg: 0x665748 },
    buffalo: { body: 0x564a3e, dark: 0x2a2520, leg: 0x493f36 },
    donkey: { body: 0x8f8478, dark: 0x3d362e, leg: 0x7a7065 },
    jackal: { body: 0xb39058, dark: 0x4f3d26, leg: 0x97743f },
    llama: { body: 0xc39863, dark: 0x6b4c31, leg: 0xaa7d4e },
  }[type];

  const dimensions = {
    zebra: [0.88, 0.52, 1.42, 0.9],
    elephant: [1.3, 0.82, 1.86, 0.78],
    giraffe: [0.76, 0.5, 1.28, 1.65],
    antelope: [0.48, 0.36, 0.96, 0.72],
    wildebeest: [0.58, 0.42, 1.08, 0.68],
    deer: [0.48, 0.36, 0.96, 0.72],
    stag: [0.52, 0.4, 1.02, 0.78],
    bull: [0.7, 0.48, 1.2, 0.66],
    horse: [0.72, 0.48, 1.28, 0.78],
    cow: [0.72, 0.52, 1.22, 0.66],
    buffalo: [0.78, 0.54, 1.28, 0.66],
    donkey: [0.6, 0.46, 1.1, 0.72],
    jackal: [0.4, 0.32, 0.85, 0.55],
    llama: [0.5, 0.42, 0.98, 0.9],
  }[type];

  const [bodyW, bodyH, bodyL, legH] = dimensions;
  const bodyY = legH + bodyH * 0.45;

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 10, 8),
    material(palette.body, 0.92),
  );
  body.position.y = bodyY;
  body.scale.set(bodyW * scale, bodyH * scale, bodyL * scale);
  body.castShadow = true;
  root.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.33, 9, 7),
    material(palette.body, 0.92),
  );
  head.position.set(0, (legH + bodyH * 0.6) * scale, (bodyL * 0.62) * scale);
  head.scale.set(bodyW * 0.58 * scale, bodyH * 0.58 * scale, bodyW * 0.66 * scale);
  head.castShadow = true;
  root.add(head);
  root.userData.dynamicParts.push({
    object: head,
    kind: "head",
    baseRotation: head.rotation.clone(),
  });

  if (type === "giraffe") {
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11 * scale, 0.16 * scale, 1.55 * scale, 7),
      material(palette.body, 0.92),
    );
    neck.position.set(0, (legH + 1.2) * scale, (bodyL * 0.43) * scale);
    neck.rotation.x = 0.22;
    neck.castShadow = true;
    root.add(neck);
    root.userData.dynamicParts.push({
      object: neck,
      kind: "neck",
      baseRotation: neck.rotation.clone(),
    });
    head.position.y = (legH + 2.0) * scale;
    head.position.z = (bodyL * 0.72) * scale;

    addSpots(root, scale, palette.dark, 9, bodyY, bodyW, bodyL);
  }

  if (type === "zebra") {
    addZebraStripes(root, scale, palette.dark, bodyY, bodyW, bodyL);
  }

  if (type === "elephant") {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08 * scale, 0.045 * scale, 0.82 * scale, 7),
      material(palette.dark, 0.96),
    );
    trunk.position.set(0, (legH + 0.3) * scale, (bodyL * 0.86) * scale);
    trunk.rotation.x = -0.34;
    trunk.castShadow = true;
    root.add(trunk);
    root.userData.dynamicParts.push({
      object: trunk,
      kind: "trunk",
      baseRotation: trunk.rotation.clone(),
    });

    const earGeo = new THREE.CircleGeometry(0.28 * scale, 16);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, material(palette.dark, 0.95));
      ear.position.set(side * 0.34 * scale, (legH + 0.62) * scale, bodyL * 0.58 * scale);
      ear.rotation.y = side * Math.PI * 0.46;
      ear.scale.set(0.8, 1.1, 1);
      ear.castShadow = true;
      root.add(ear);
    }
  }

  if (type === "giraffe" || type === "elephant") {
    const tailPivot = new THREE.Group();
    tailPivot.position.set(
      0,
      (legH + bodyH * 0.5) * scale,
      (-bodyL * 0.62) * scale,
    );
    const tailLength = (type === "elephant" ? 0.48 : 0.62) * scale;
    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025 * scale, 0.04 * scale, tailLength, 6),
      material(palette.dark, 1),
    );
    tail.rotation.x = Math.PI * 0.5;
    tail.position.z = -tailLength * 0.5;
    tail.castShadow = true;
    tailPivot.add(tail);

    const tuft = new THREE.Mesh(
      new THREE.SphereGeometry(0.07 * scale, 7, 5),
      material(palette.dark, 1),
    );
    tuft.position.z = -tailLength;
    tuft.scale.set(0.8, 0.8, 1.2);
    tuft.castShadow = true;
    tailPivot.add(tuft);

    root.userData.dynamicParts.push({
      object: tailPivot,
      kind: "tail",
      baseRotation: tailPivot.rotation.clone(),
    });
    root.add(tailPivot);
  }

  if (type === "antelope" || type === "wildebeest") {
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(
        new THREE.ConeGeometry(0.035 * scale, 0.42 * scale, 6),
        material(palette.dark, 1),
      );
      horn.position.set(side * 0.12 * scale, (legH + bodyH * 1.04) * scale, (bodyL * 0.74) * scale);
      horn.rotation.x = -0.52;
      horn.rotation.z = side * 0.22;
      horn.castShadow = true;
      root.add(horn);
    }
  }

  const legGeo = new THREE.BoxGeometry(0.11 * scale, legH * scale, 0.11 * scale);
  legGeo.translate(0, -legH * scale * 0.5, 0);
  const legMat = material(palette.leg, 0.96);
  const legXs = [-bodyW * 0.34, bodyW * 0.34];
  const legZs = [-bodyL * 0.3, bodyL * 0.3];
  for (const x of legXs) {
    for (const z of legZs) {
      const pivot = new THREE.Group();
      pivot.position.set(x * scale, legH * scale, z * scale);
      const isLeft = x < 0;
      const isFront = z > 0;
      pivot.userData.gaitPhase = isLeft === isFront ? 0 : Math.PI;
      pivot.userData.gaitAmplitude =
        type === "elephant" ? 0.3 : type === "giraffe" ? 0.52 : 0.42;
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.castShadow = true;
      pivot.add(leg);
      root.userData.legs.push(pivot);
      root.add(pivot);
    }
  }

  // (fake blob shadows removed — the noon sun casts real ones)
  return root;
}

function createLoadedAnimal(type, scale, clipOverride) {
  const asset = loadedAnimalModels.get(type);
  if (!asset) return null;

  const root = new THREE.Group();
  const visual = new THREE.Group();
  const model = SkeletonUtils.clone(asset.scene);

  root.userData.type = type;
  root.userData.scale = scale;
  root.userData.legs = [];
  root.userData.loadedModel = true;
  root.userData.visual = visual;
  root.userData.dynamicParts = [];

  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const rawBox = new THREE.Box3().setFromObject(model);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const maxAxis = Math.max(rawSize.x, rawSize.y, rawSize.z, 0.001);
  // fitSize is the animal's true real-world size in metres (max axis);
  // × M_UNIT converts to world units so it shares one scale with trees,
  // shrubs and rocks. → correct savanna proportions, not arbitrary fits.
  model.scale.setScalar((asset.spec.fitSize * M_UNIT * scale) / maxAxis);
  model.updateMatrixWorld(true);

  const fittedBox = new THREE.Box3().setFromObject(model);
  const center = fittedBox.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= fittedBox.min.y;

  visual.rotation.y = asset.spec.yaw ?? 0;
  visual.add(model);
  root.add(visual);

  if (asset.spec.staticDeform) {
    root.userData.deformedModel = true;
    root.userData.syntheticLegs = 4;
    root.userData.dynamicParts = [
      { kind: "mesh-legs" },
      { kind: type === "elephant" ? "mesh-trunk" : "mesh-neck" },
      { kind: "mesh-tail" },
    ];
    root.userData.meshDeformers = createStaticMeshDeformers(model, asset.spec);
  } else if (asset.animations.length > 0) {
    const clip = pickMovementClip(
      asset.animations,
      clipOverride ? { movingClip: clipOverride } : asset.spec,
    );
    // Walk clips run at their natural pace, not the Gallop multiplier.
    const clipSpeed = clipOverride ? 1.0 : (asset.spec.actionSpeed ?? 1);
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(clipSpeed);
    action.play();
    root.userData.mixer = mixer;
    root.userData.action = action;
    root.userData.baseActionSpeed = clipSpeed;
    root.userData.clipName = clip.name || "unnamed";
  }

  return root;
}

function pickMovementClip(clips, spec = {}) {
  const preferred = [
    spec.movingClip,
    "Run",
    "Gallop",
    "Walk",
    "WalkSlow",
    "Idle",
  ].filter(Boolean);

  for (const name of preferred) {
    const clip = clips.find((item) =>
      item.name.toLowerCase().includes(name.toLowerCase()),
    );
    if (clip) return clip;
  }

  return clips[0];
}

function createStaticMeshDeformers(model, spec) {
  const deformers = [];
  model.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;

    object.geometry = object.geometry.clone();
    const position = object.geometry.attributes.position;
    const base = new Float32Array(position.array);
    const bounds = canonicalBounds(base, spec.forwardAxis);
    deformers.push({
      mesh: object,
      base,
      bounds,
      forwardAxis: spec.forwardAxis,
      legAmplitude: spec.legAmplitude ?? 0.32,
      deformSpeed: spec.deformSpeed ?? 1,
    });
  });
  return deformers;
}

function updateStaticMeshDeformers(data, walk) {
  const deformers = data.meshDeformers;
  if (!deformers) return;

  for (const deformer of deformers) {
    const position = deformer.mesh.geometry.attributes.position;
    const arr = position.array;
    const base = deformer.base;
    const b = deformer.bounds;
    const height = Math.max(0.001, b.maxY - b.minY);
    const depth = Math.max(0.001, b.maxF - b.minF);
    const width = Math.max(0.001, b.maxS - b.minS);
    const bodyBottom = b.minY + height * 0.48;
    const legTop = b.minY + height * 0.55;
    const frontSplit = b.minF + depth * 0.52;
    const backSplit = b.minF + depth * 0.48;
    const sideMid = (b.minS + b.maxS) * 0.5;

    for (let i = 0; i < base.length; i += 3) {
      const original = readCanonical(base, i, deformer.forwardAxis);
      let f = original.f;
      let s = original.s;
      let y = original.y;

      const lowerInfluence = clamp((legTop - y) / (legTop - b.minY), 0, 1);
      if (lowerInfluence > 0 && y < bodyBottom) {
        const isFront = f >= frontSplit;
        const isLeft = s >= sideMid;
        const gaitPhase = isFront === isLeft ? 0 : Math.PI;
        const legCenterF = isFront
          ? b.minF + depth * 0.72
          : b.minF + depth * 0.28;
        const legCenterS = isLeft
          ? b.minS + width * 0.72
          : b.minS + width * 0.28;
        const legMaskF = 1 - clamp(Math.abs(f - legCenterF) / (depth * 0.28), 0, 1);
        const legMaskS = 1 - clamp(Math.abs(s - legCenterS) / (width * 0.42), 0, 1);
        const legInfluence = lowerInfluence * Math.max(0, legMaskF) * Math.max(0, legMaskS);
        const angle =
          Math.sin(walk * deformer.deformSpeed + gaitPhase) *
          deformer.legAmplitude *
          legInfluence;
        const pivotF = legCenterF;
        const pivotY = b.minY + height * 0.5;
        const rotated = rotate2D(f - pivotF, y - pivotY, angle);
        f = pivotF + rotated.x;
        y = pivotY + rotated.y;
      }

      const frontHigh = smoothstep(b.minF + depth * 0.58, b.maxF, f) *
        smoothstep(b.minY + height * 0.42, b.maxY, y);
      if (frontHigh > 0) {
        const angle =
          Math.sin(walk * 0.32 + data.phase) *
          0.05 *
          frontHigh;
        const pivotF = b.minF + depth * 0.57;
        const pivotY = b.minY + height * 0.58;
        const rotated = rotate2D(f - pivotF, y - pivotY, angle);
        f = pivotF + rotated.x;
        y = pivotY + rotated.y;
        s += Math.sin(walk * 0.24 + data.phase) * width * 0.015 * frontHigh;
      }

      const tail = smoothstep(b.minF + depth * 0.18, b.minF, f) *
        smoothstep(b.minY + height * 0.42, b.maxY, y);
      if (tail > 0) {
        s += Math.sin(walk * 0.5 + data.phase) * width * 0.08 * tail;
      }

      writeCanonical(arr, i, deformer.forwardAxis, f, s, y, original);
    }

    position.needsUpdate = true;
  }
}

function canonicalBounds(array, forwardAxis) {
  const bounds = {
    minF: Infinity,
    maxF: -Infinity,
    minS: Infinity,
    maxS: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };

  for (let i = 0; i < array.length; i += 3) {
    const point = readCanonical(array, i, forwardAxis);
    bounds.minF = Math.min(bounds.minF, point.f);
    bounds.maxF = Math.max(bounds.maxF, point.f);
    bounds.minS = Math.min(bounds.minS, point.s);
    bounds.maxS = Math.max(bounds.maxS, point.s);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }

  return bounds;
}

function readCanonical(array, i, forwardAxis) {
  const x = array[i];
  const y = array[i + 1];
  const z = array[i + 2];
  if (forwardAxis === "x+") return { f: x, s: z, y, x, z };
  if (forwardAxis === "x-") return { f: -x, s: z, y, x, z };
  if (forwardAxis === "z-") return { f: -z, s: x, y, x, z };
  return { f: z, s: x, y, x, z };
}

function writeCanonical(array, i, forwardAxis, f, s, y, original) {
  if (forwardAxis === "x+") {
    array[i] = f;
    array[i + 1] = y;
    array[i + 2] = s;
    return;
  }
  if (forwardAxis === "x-") {
    array[i] = -f;
    array[i + 1] = y;
    array[i + 2] = s;
    return;
  }
  if (forwardAxis === "z-") {
    array[i] = s;
    array[i + 1] = y;
    array[i + 2] = -f;
    return;
  }
  array[i] = s;
  array[i + 1] = y;
  array[i + 2] = f;
}

function addZebraStripes(root, scale, dark, bodyY, bodyW, bodyL) {
  const stripeMat = material(dark, 1);
  for (let i = -3; i <= 3; i++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.9 * scale, 0.035 * scale, 0.055 * scale), stripeMat);
    stripe.position.set(0, bodyY * scale + 0.36 * scale, i * bodyL * 0.12 * scale);
    stripe.rotation.y = (i % 2) * 0.25;
    stripe.castShadow = true;
    root.add(stripe);
  }
}

function addSpots(root, scale, dark, count, bodyY, bodyW, bodyL) {
  const spotGeo = new THREE.CircleGeometry(0.055 * scale, 10);
  const spotMat = material(dark, 1);
  for (let i = 0; i < count; i++) {
    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.position.set(
      (rng() - 0.5) * bodyW * 0.82 * scale,
      bodyY * scale + (0.33 + rng() * 0.05) * scale,
      (rng() - 0.5) * bodyL * 0.84 * scale,
    );
    spot.rotation.x = -Math.PI / 2;
    spot.scale.set(0.9 + rng(), 0.6 + rng() * 0.7, 1);
    root.add(spot);
  }
}

export function updateAnimals(elapsed, delta = 0) {
  const viewQuality = getDistanceQuality();
  const closeMotionDist2 = viewQuality === "near" ? 260000 : 90000;
  for (const herd of herds) {
    let center = new THREE.Vector3();
    for (const animal of herd.members) {
      const data = animal.userData;
      const laneNoise = Math.sin(elapsed * 0.68 + data.phase) * herd.spread[1] * 0.11;
      let x;
      let z;
      if (herd.behavior === "graze") {
        // Grazing herds stay on their home range, drifting around it
        // in a slow loose loop instead of crossing the map.
        const R = herd.spread[0] * 0.45 + Math.abs(data.lane) * 1.3;
        const ang = (elapsed * data.speed) / Math.max(R, 8) + data.phase;
        x = herd.origin.x + Math.cos(ang) * R + Math.sin(data.phase * 3.7) * 5;
        z = herd.origin.z + Math.sin(ang) * R * 0.72 + laneNoise;
      } else {
        const travel =
          elapsed * data.speed + data.phase * 2.5 + data.along + herd.alongOrigin;
        const wrapped = wrapSigned(travel, herd.halfSpan * 2);
        x =
          herd.baseX +
          herd.direction.x * wrapped +
          herd.side.x * (data.lane + laneNoise);
        z =
          herd.baseZ +
          herd.direction.z * wrapped +
          herd.side.z * (data.lane + laneNoise);
      }
      // Detour around waterholes: positions inside a lake slide out to
      // its rim, so herds walk the shoreline instead of wading through.
      for (const lake of LAKES) {
        const dx = x - lake.x;
        const dz = z - lake.z;
        const dist = Math.hypot(dx, dz);
        if (dist > lake.r * 1.35 || dist < 0.001) continue;
        const margin = lakeRadiusAt(lake, Math.atan2(dz, dx)) * 1.08;
        if (dist < margin) {
          x = lake.x + (dx / dist) * margin;
          z = lake.z + (dz / dist) * margin;
        }
      }
      // HARD map boundary: the plain ends at the table frame — nothing
      // may step past it (diagonal tracks near corners, wide lanes and
      // lake detours all used to leak). Clamped animals slide along the
      // rim until their track wraps them back across the plain.
      if (x < -ANIMAL_BX) x = -ANIMAL_BX;
      else if (x > ANIMAL_BX) x = ANIMAL_BX;
      if (z < -ANIMAL_BZ) z = -ANIMAL_BZ;
      else if (z > ANIMAL_BZ) z = ANIMAL_BZ;
      const y = terrainHeight(x, z);
      animal.position.set(x, y + 0.03, z);

      // Face the direction the animal ACTUALLY moved this frame — the
      // lake detour slides positions along the shore, and using the
      // herd's nominal direction there made animals crab-walk
      // sideways. Skip teleport jumps from the path wrap, and smooth
      // the turn so heading changes read as natural steering.
      const mdx = x - (data.lastX ?? x);
      const mdz = z - (data.lastZ ?? z);
      const moved2 = mdx * mdx + mdz * mdz;
      let targetHeading =
        data.heading ?? Math.atan2(herd.direction.x, herd.direction.z);
      if (moved2 > 1e-6 && moved2 < 25) {
        targetHeading = Math.atan2(mdx, mdz);
      }
      data.heading = lerpAngle(
        data.heading ?? targetHeading,
        targetHeading,
        Math.min(1, delta * 6),
      );
      data.lastX = x;
      data.lastZ = z;
      animal.rotation.y =
        data.heading + Math.sin(elapsed * 0.8 + data.phase) * 0.035;
      animal.rotation.z = Math.sin(elapsed * 1.4 + data.phase) * 0.012;

      const walk = elapsed * (3.5 + data.speed * 0.62) + data.legSeed;
      if (data.mixer) {
        // Distance LOD: skeletons far from the camera animate at a
        // reduced rate (delta scaled up to stay in sync). With 300+
        // animals this is the difference between 30 and 60 fps.
        const dist2 = animal.position.distanceToSquared(camera.position);
        const skip =
          dist2 < closeMotionDist2 ? 1 : dist2 > 564000 ? 4 : dist2 > 122500 ? 2 : 1;
        data.mixerTick = (data.mixerTick ?? ((data.phase * 7) | 0)) + 1;
        if (data.mixerTick % skip === 0) {
          data.mixer.update(delta * skip * (0.85 + data.pace * 0.25));
        }
      }
      if (data.meshDeformers) {
        // CPU vertex deform is the hottest path with ~190 pseudo-rig
        // animals: full rate only up close, low rate mid-range, and
        // very low rate beyond 600 units where leg motion is sub-pixel.
        const dist2 = animal.position.distanceToSquared(camera.position);
        // Never fully off — frozen legs read as "sliding sideways"
        // from the air. Far animals just step at a lower rate.
        const deformFps =
          isRigCloseup
            ? 30
            : dist2 < closeMotionDist2
              ? 28
              : dist2 > 360000
                ? 3
                : dist2 > 22500
                  ? 8
                  : 16;
        const deformTick = Math.floor(elapsed * deformFps + data.phase);
        if (data.lastDeformTick !== deformTick) {
          data.lastDeformTick = deformTick;
          updateStaticMeshDeformers(data, walk);
        }
      }
      if (data.visual) {
        data.visual.position.y =
          Math.sin(walk * 0.72) * 0.045 * data.scale;
        data.visual.rotation.x = Math.sin(walk * 0.38) * 0.018;
      }
      if (data.dynamicParts) {
        data.dynamicParts.forEach((part, index) => {
          if (!part.object) return;
          part.object.rotation.copy(part.baseRotation);
          if (part.kind === "head") {
            part.object.rotation.y += Math.sin(walk * 0.31 + index) * 0.055;
            part.object.rotation.x += Math.sin(walk * 0.22 + data.phase) * 0.025;
          }
          if (part.kind === "neck") {
            part.object.rotation.z += Math.sin(walk * 0.24 + data.phase) * 0.025;
          }
          if (part.kind === "trunk") {
            part.object.rotation.x += Math.sin(walk * 0.46 + data.phase) * 0.12;
            part.object.rotation.z += Math.sin(walk * 0.29 + data.phase) * 0.045;
          }
          if (part.kind === "tail") {
            part.object.rotation.y += Math.sin(walk * 0.54 + data.phase) * 0.22;
            part.object.rotation.x += Math.sin(walk * 0.37 + index) * 0.07;
          }
        });
      }
      animal.userData.legs.forEach((leg, index) => {
        const phase = leg.userData.gaitPhase ?? (index % 2 === 0 ? 0 : Math.PI);
        const amplitude = leg.userData.gaitAmplitude ?? 0.42;
        leg.rotation.x = Math.sin(walk + phase) * amplitude;
      });

      center.add(animal.position);
    }
    center.multiplyScalar(1 / herd.members.length);
    herd.dustAnchor.copy(center);
  }
}
