// The diorama setting: the terrain sits inset in a heavy wooden table
// (frame rails overlap the rim the terrain converges to, sealing the
// joint), standing in a dim wood-panelled study — fireplace, lamps,
// leather chairs, bookcases — so the viewer looks down on the herds
// like a god at a war table. The room is its own LIGHTING world (L_ROOM)
// and its own TIME world: the map's clock/accelerator never touches it.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { WORLD_W, WORLD_D, ROOM, L_ROOM } from "../core/config.js?v=34";
import { scene, setLayerDeep, roomObjects, tableObjects } from "../core/context.js?v=34";
import { material, pbrMaterial } from "../core/materials.js?v=34";

// Loads one of the downloaded Poly Haven furniture models and fits it
// to `targetH` world units tall, resting on y=0 of its group.
async function loadRoomModel(url, targetH) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      // Furniture still casts shadows onto the floor/table, but does not
      // receive the room's many shadow maps. With several warm spotlights
      // plus PBR maps, receiving shadows can exceed WebGL's 16 texture-unit
      // limit and make individual furniture shaders fail.
      o.receiveShadow = false;
      enhanceModelMaterial(o.material);
    }
  });
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = targetH / Math.max(size.y, 0.001);
  model.scale.setScalar(s);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= fitted.min.y;
  return model;
}

function enhanceModelMaterial(materials) {
  for (const mat of Array.isArray(materials) ? materials : [materials]) {
    if (!mat) continue;
    for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"]) {
      if (mat[key]) mat[key].anisotropy = 16;
    }
    if (mat.normalMap && mat.normalScale) mat.normalScale.set(1.12, 1.12);
    // Near-zero grey-IBL on the photoscans too — furniture reads by the
    // warm lamps, not by a white studio reflection.
    mat.envMapIntensity = 0.06;
    if (mat.emissive && (mat.emissiveMap || mat.name?.toLowerCase().includes("light") || mat.name?.toLowerCase().includes("glass"))) {
      mat.emissive.setHex(0xffa34f);
      mat.emissiveIntensity = Math.min(mat.emissiveIntensity || 1.6, 4.2);
    }
    mat.needsUpdate = true;
  }
}

function placeModel(proto, x, y, z, ry, height, extraScale = 1) {
  const g = new THREE.Group();
  const model = proto.clone(true);
  model.scale.multiplyScalar(height * extraScale);
  g.add(model);
  g.position.set(x, y, z);
  g.rotation.y = ry;
  return g;
}

function createTableBase(width, depth, floorY, topY, mat) {
  const g = new THREE.Group();
  const sideH = topY - floorY - 28;
  const sideY = floorY + sideH / 2;
  const sideT = 34;
  const sideInset = 18;
  const parts = [
    new THREE.Mesh(new THREE.BoxGeometry(width + sideT * 2, sideH, sideT), mat),
    new THREE.Mesh(new THREE.BoxGeometry(width + sideT * 2, sideH, sideT), mat),
    new THREE.Mesh(new THREE.BoxGeometry(sideT, sideH, depth), mat),
    new THREE.Mesh(new THREE.BoxGeometry(sideT, sideH, depth), mat),
  ];
  parts[0].position.set(0, sideY, -depth / 2 - sideInset);
  parts[1].position.set(0, sideY, depth / 2 + sideInset);
  parts[2].position.set(-width / 2 - sideInset, sideY, 0);
  parts[3].position.set(width / 2 + sideInset, sideY, 0);
  for (const p of parts) {
    p.castShadow = true;
    p.receiveShadow = true;
    g.add(p);
  }
  // Shallow panel grooves so the base reads like furniture, not a plain box.
  const grooveMat = material(0x0f0a06, 0.85);
  for (const z of [-depth / 2 - sideInset - sideT / 2 - 1, depth / 2 + sideInset + sideT / 2 + 1]) {
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const groove = new THREE.Mesh(new THREE.BoxGeometry(5, sideH * 0.82, 8), grooveMat);
      groove.position.set((i / 5) * width * 0.48, sideY, z);
      g.add(groove);
    }
  }
  return g;
}

export async function createRoomAndTable() {
  // Everything here is tagged onto the L_ROOM render layer so the
  // map's daytime sun never lights it and vice-versa.
  const addRoom = (obj) => {
    setLayerDeep(obj, L_ROOM);
    roomObjects.push(obj);
    scene.add(obj);
  };
  // Same warm-lamp lighting world; tracked separately as "the table".
  const addTable = (obj) => {
    setLayerDeep(obj, L_ROOM);
    tableObjects.push(obj);
    scene.add(obj);
  };

  // Real mahogany (Poly Haven "dark_wood") for the custom rim that seals the terrain edge.
  const woodFrame = pbrMaterial("dark_wood", 7, 0.5, { roughness: 0.42 });
  woodFrame.color.set(0x55371f);
  woodFrame.envMapIntensity = 0.7;
  const { FLOOR_Y, RX, RZ, CEIL } = ROOM;
  const hw = WORLD_W / 2;
  const hd = WORLD_D / 2;
  const [
    chairProto,
    cabinetProto,
    bookshelfProto,
    consoleTableProto,
    wallLampProto,
    pipeLampProto,
    deskLampProto,
  ] = await Promise.all([
    loadRoomModel("assets/polyhaven/room/ArmChair_01_1k.gltf", 1),
    loadRoomModel("assets/polyhaven/room/vintage_cabinet_01_1k.gltf", 1),
    loadRoomModel("assets/polyhaven/room/wooden_bookshelf_worn/wooden_bookshelf_worn_2k.gltf", 1),
    loadRoomModel("assets/polyhaven/room/chinese_console_table/chinese_console_table_2k.gltf", 1),
    loadRoomModel("assets/polyhaven/room/street_lamp_02/street_lamp_02_2k.gltf", 1),
    loadRoomModel("assets/polyhaven/room/industrial_pipe_lamp/industrial_pipe_lamp_1k.gltf", 1),
    loadRoomModel("assets/polyhaven/room/desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf", 1),
  ]);

  // The pale photoscans (worn shelf, vintage cabinet) fought the mahogany
  // study — grade their albedo to dark walnut so the set reads as ONE room.
  // The scan's wear/grain detail survives (color multiplies the texture).
  for (const proto of [bookshelfProto, cabinetProto]) {
    proto.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m?.color) m.color.set(0x6e4a2e);
      }
    });
  }
  chairProto.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m?.color) m.color.set(0xa06e4b);
      if (!m) continue;
      // The room has several warm spot/cookie/shadow lights. Keeping the
      // armchair's packed ARM map plus all those light samplers can exceed
      // WebGL's 16 texture-unit limit on this browser, which makes the chair
      // shader fail and the model disappear. Diffuse + normal keeps the
      // photoscan leather detail while staying inside the shader budget.
      m.aoMap = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
      m.metalness = 0;
      m.roughness = 0.74;
      m.envMapIntensity = 0.12;
      m.needsUpdate = true;
    }
  });

  // --- Table frame: a moulded picture-frame border around the map ---
  const RAIL_W = 64;
  const railTop = 7;
  const railBot = -18;
  const railH = railTop - railBot;
  const railY = (railTop + railBot) / 2;
  const frame = new THREE.Group();
  const railNS = new THREE.BoxGeometry(WORLD_W + RAIL_W * 2, railH, RAIL_W);
  const railEW = new THREE.BoxGeometry(RAIL_W, railH, WORLD_D);
  for (const [geo, x, z] of [
    [railNS, 0, -(hd + RAIL_W / 2)],
    [railNS, 0, hd + RAIL_W / 2],
    [railEW, -(hw + RAIL_W / 2), 0],
    [railEW, hw + RAIL_W / 2, 0],
  ]) {
    const rail = new THREE.Mesh(geo, woodFrame);
    rail.position.set(x, railY, z);
    rail.castShadow = true;
    rail.receiveShadow = true;
    frame.add(rail);
    // thin dark inner lip where frame meets terrain
    const lip = new THREE.Mesh(
      geo === railNS
        ? new THREE.BoxGeometry(WORLD_W + 12, 6, 10)
        : new THREE.BoxGeometry(10, 6, WORLD_D + 12),
      material(0x14110c, 0.7),
    );
    lip.position.set(
      x - Math.sign(x) * (RAIL_W / 2 - 5),
      railTop - 2,
      z - Math.sign(z) * (RAIL_W / 2 - 5),
    );
    lip.castShadow = true;
    lip.receiveShadow = true;
    frame.add(lip);
  }
  addTable(frame);

  // --- Table body: no chair-like props around the sand table ---
  const tableBaseMat = pbrMaterial("dark_wood", 5, 1.4, { roughness: 0.58, envMapIntensity: 0.04 });
  tableBaseMat.color.set(0x4a2e18);
  addTable(createTableBase(WORLD_W + 96, WORLD_D + 96, FLOOR_Y, railBot, tableBaseMat));

  // --- Real herringbone parquet floor (Poly Haven, full PBR) ---
  // Dark parquet, reflections from LAMPS ONLY: envMapIntensity must be 0 —
  // the global IBL is a neutral-white studio, and on a glossy floor it
  // smears a big pale band across the parquet (the "white reflection" bug).
  // With it off, the only speculars left are the warm lamp/fire pools,
  // which is exactly what the reference rooms show.
  // Grade rule learned the hard way: SATURATED dark grades collapse to
  // pure red under warm light (sRGB→linear squares the channel skew), so
  // the grade stays near-neutral warm and the PHOTO texture supplies the
  // hue. Calibrated live: floor reads (115,45,15)-amber in the lamp wash.
  const floorMat = pbrMaterial("herringbone_parquet", 7, 6, { rough: true });
  floorMat.color.set(0x8a7058);
  floorMat.roughnessMap = null;
  floorMat.roughness = 0.58;
  floorMat.envMapIntensity = 0.0;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(RX * 2.4, RZ * 2.4),
    floorMat,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  addRoom(floor);

  // --- Real varnished wood-panel walls (Poly Haven wooden_panels) ---
  const wallH = CEIL - FLOOR_Y;
  for (const [w, x, z, ry] of [
    [RX * 2, 0, -RZ, 0],
    [RX * 2, 0, RZ, Math.PI],
    [RZ * 2, -RX, 0, Math.PI / 2],
    [RZ * 2, RX, 0, -Math.PI / 2],
  ]) {
    const m = pbrMaterial("wooden_panels", w / 1100, wallH / 1100, { roughness: 0.62 });
    // Near-neutral warm grade (hue comes from the photo texture); unlit
    // stretches fall into the reference's gloom, lamp pools reveal grain.
    m.color.set(0x7a5a40);
    // ZERO neutral-grey IBL on the panels — their tone must come from the
    // WARM room lights only, or the whole study drifts charcoal-grey.
    m.envMapIntensity = 0.0;
    if (m.normalScale) m.normalScale.set(1.35, 1.35);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, wallH), m);
    wall.position.set(x, (CEIL + FLOOR_Y) / 2, z);
    wall.rotation.y = ry;
    wall.receiveShadow = true;
    addRoom(wall);
  }
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(RX * 2, RZ * 2),
    material(0x1a140e, 0.95),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = CEIL;
  ceil.receiveShadow = true;
  addRoom(ceil);

  // --- Fireplace on the north wall ---
  addRoom(createFireplace(0, FLOOR_Y, -RZ + 30));

  // --- Framed landscape paintings, deliberately not mirrored ---
  addRoom(createPainting(-330, FLOOR_Y + 880, -RZ + 24, 0, 880, 560));
  addRoom(createPainting(RX - 24, FLOOR_Y + 850, 1320, -Math.PI / 2, 760, 520));

  // --- Real wall lamps (Poly Haven street_lamp_02), used sparingly as study sconces ---
  for (const [x, y, z, ry, h] of [
    [-1360, FLOOR_Y + 720, -RZ + 46, -0.02, 480],
    [RX - 46, FLOOR_Y + 780, 1180, -Math.PI / 2 + 0.08, 500],
    [-RX + 46, FLOOR_Y + 690, -1320, Math.PI / 2 - 0.04, 450],
  ]) {
    addRoom(placeModel(wallLampProto, x, y, z, ry, h));
  }

  // --- Two real leather armchairs, visible but deliberately not mirrored ---
  for (const [cx2, cz2, ry, h] of [
    [-940, -950, 0.72, 680],
    [1040, -690, -0.92, 640],
  ]) {
    addRoom(placeModel(chairProto, cx2, FLOOR_Y, cz2, ry, h));
  }

  // --- Real carved vintage cabinets (Poly Haven vintage_cabinet_01) ---
  for (const [cx2, cz2, ry, h] of [
    [2220, RZ - 310, Math.PI + 0.08, 820],
  ]) {
    addRoom(placeModel(cabinetProto, cx2, FLOOR_Y, cz2, ry, h));
  }

  // --- Real worn wooden bookcases (Poly Haven), offset so the room does not feel staged ---
  for (const [x, z, ry, h] of [
    [RX - 285, 960, -Math.PI / 2 + 0.04, 1450],
    [RX - 330, -1320, -Math.PI / 2 - 0.07, 1280],
    [-RX + 310, -1520, Math.PI / 2 + 0.03, 1180],
  ]) {
    addRoom(placeModel(bookshelfProto, x, FLOOR_Y, z, ry, h));
  }

  // --- Extra real console tables for wall detail and contact shadows ---
  for (const [x, z, ry, h] of [
    [420, RZ - 235, Math.PI + 0.03, 520],
    [-1650, -RZ + 175, -0.08, 470],
  ]) {
    addRoom(placeModel(consoleTableProto, x, FLOOR_Y, z, ry, h));
  }

  // --- Real lamp models on furniture, placed irregularly like a lived-in study ---
  for (const [proto, x, y, z, ry, h] of [
    [pipeLampProto, 470, FLOOR_Y + 520, RZ - 250, Math.PI + 0.65, 190],
    [deskLampProto, -1670, FLOOR_Y + 472, -RZ + 190, -0.5, 300],
    [pipeLampProto, 2220, FLOOR_Y + 820, RZ - 330, Math.PI - 0.35, 170],
  ]) {
    addRoom(placeModel(proto, x, y, z, ry, h));
  }
  for (const [x, y, z, ry, s] of [
    [1050, FLOOR_Y + 840, -RZ + 95, 0, 1.18],
    [RX - 820, FLOOR_Y + 720, -1040, -Math.PI / 2, 1.25],
    [RX - 360, FLOOR_Y + 920, -1240, -Math.PI / 2, 1.15],
    [RX - 230, FLOOR_Y + 1010, 1120, -Math.PI / 2, 1.0],
    [500, FLOOR_Y + 680, RZ - 270, Math.PI, 0.82],
    [-1660, FLOOR_Y + 710, -RZ + 210, 0, 0.9],
  ]) {
    addRoom(createWarmLampGlow(x, y, z, ry, s));
  }
}

function setRoomLightLayer(light) {
  light.layers.set(L_ROOM);
  if (light.target) light.target.layers.set(L_ROOM);
}

// High-quality lamp pool via a SPOTLIGHT COOKIE (three.js core feature:
// SpotLight.map projects this texture through the cone — the film/game
// "gobo" technique). A real lamp's pool is not a flat disc: it has a hot
// core, a long smooth quadratic falloff, a faint filament ring and soft
// edge noise. Painting those into the cookie is what makes the light feel
// PHYSICAL when it lands on the parquet.
let _cookieTex;
function lampCookie() {
  if (_cookieTex) return _cookieTex;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, "rgb(255,255,255)");
  g.addColorStop(0.18, "rgb(236,228,214)");
  g.addColorStop(0.42, "rgb(150,138,120)");
  g.addColorStop(0.62, "rgb(74,66,54)");
  g.addColorStop(0.85, "rgb(20,17,13)");
  g.addColorStop(1.0, "rgb(0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // faint filament ring — the signature of a real shaded bulb
  ctx.strokeStyle = "rgba(255,244,224,0.16)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  // subtle edge break-up so the pool rim never reads as a perfect circle
  for (let i = 0; i < 220; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = S * (0.3 + Math.random() * 0.2);
    ctx.fillStyle = `rgba(255,255,255,${0.012 + Math.random() * 0.03})`;
    ctx.fillRect(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 2.5, 2.5);
  }
  _cookieTex = new THREE.CanvasTexture(c);
  _cookieTex.colorSpace = THREE.SRGBColorSpace;
  return _cookieTex;
}

function enableSoftShadow(light, size = 1024, near = 30, far = 4800) {
  light.castShadow = true;
  light.shadow.mapSize.set(size, size);
  light.shadow.bias = -0.00018;
  light.shadow.normalBias = 0.025;
  light.shadow.camera.near = near;
  light.shadow.camera.far = far;
}

function addRoomSpot(color, intensity, distance, angle, penumbra, decay, pos, target, shadowSize = 1024, cookie = true) {
  const spot = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
  spot.position.set(...pos);
  spot.target.position.set(...target);
  // The projected cookie turns the big shadow-casting washes into believable
  // lamp pools. Keep it off small fill spots: every SpotLight.map consumes a
  // texture sampler in every lit PBR shader, and too many cookies can push
  // real GLTF furniture past WebGL's 16 texture-unit limit.
  if (cookie && shadowSize > 0) spot.map = lampCookie();
  setRoomLightLayer(spot);
  setRoomLightLayer(spot.target);
  if (shadowSize > 0) enableSoftShadow(spot, shadowSize, 40, distance);
  scene.add(spot);
  scene.add(spot.target);
  return spot;
}

function addRoomBulb(color, intensity, distance, decay, pos) {
  const bulb = new THREE.PointLight(color, intensity, distance, decay);
  bulb.position.set(...pos);
  bulb.layers.set(L_ROOM);
  scene.add(bulb);
  return bulb;
}

// The room's own warm lighting. The trick is high contrast: very little
// global light, then warm local lamps and shadow-casting spots. That is
// what makes the dark wood feel expensive instead of flat brown.
export function addRoomLighting() {
  const { FLOOR_Y, RX, RZ } = ROOM;
  // The reference look is NOT a bright room: it is a DARK room carrying
  // strong warm POOLS. A low warm base keeps the shadows from going
  // black-and-grey; everything you actually "see" comes from the lamps,
  // the sconces and the fire below. (The earlier flat wash drowned the
  // pools — that read as "grey".)
  // With the grey IBL banished from the room pass, these two carry the
  // entire base level. Both are warm-WHITE, not deep orange: saturated
  // light × saturated wood collapses to pure red in linear space — the
  // warmth must come from the materials, the light stays gentle.
  // Intensities pixel-calibrated (floor amber ≈115R, walls dark as refs).
  // LOW base wash — this is the whole trick. A flooding ambient flattens
  // every pool and shadow into one amber sheet (the reported bug); the
  // floor's read must come from the cookie spots + their shadows below.
  const fill = new THREE.HemisphereLight(0xffdfba, 0x40281c, 5.5);
  fill.layers.set(L_ROOM);
  scene.add(fill);
  const amb = new THREE.AmbientLight(0xd9b890, 2.6);
  amb.layers.set(L_ROOM);
  scene.add(amb);

  // Big ceiling washes: cookie pools on the floor, REAL shadows — the
  // table blocks the main one and prints its shadow onto the parquet.
  addRoomSpot(
    0xff8c36, 1500, 4200, Math.PI / 4.8, 0.5, 0.55,
    [260, FLOOR_Y + 1320, -RZ + 680],
    [60, FLOOR_Y + 10, -1000],
    2048,
  );
  addRoomSpot(
    0xff7624, 580, 3000, Math.PI / 5.6, 0.55, 0.55,
    [2240, FLOOR_Y + 980, 1420],
    [1700, FLOOR_Y + 10, 320],
    768,
  );
  addRoomSpot(
    0xb85b20, 400, 2400, Math.PI / 6, 0.6, 0.55,
    [-2580, FLOOR_Y + 900, -1280],
    [-2020, FLOOR_Y + 150, -840],
    0,
  );

  for (const [x, y, z, tx, tz, power] of [
    [-1360, FLOOR_Y + 850, -RZ + 190, -1360, -RZ + 960, 260],
    [-RX + 210, FLOOR_Y + 800, -1320, -RX + 920, -1320, 210],
    [RX - 210, FLOOR_Y + 900, 1180, RX - 930, 1180, 280],
  ]) {
    addRoomBulb(0xff7b2c, 10, 980, 0.95, [x, y, z]);
    addRoomSpot(
      0xff7a28, power * 0.78, 1350, Math.PI / 6.3, 0.6, 0.5,
      [x, y, z],
      [tx, FLOOR_Y + 150, tz],
      0,
    );
  }

  for (const [x, y, z, tx, tz, power] of [
    [470, FLOOR_Y + 675, RZ - 260, 260, RZ - 720, 230],
    [-1670, FLOOR_Y + 735, -RZ + 200, -1260, -RZ + 680, 210],
    [2220, FLOOR_Y + 980, RZ - 330, 1850, RZ - 980, 190],
  ]) {
    addRoomBulb(0xff7424, 11, 900, 0.95, [x, y, z]);
    addRoomSpot(
      0xff7424, power * 0.9, 1180, Math.PI / 7.0, 0.65, 0.5,
      [x, y, z],
      [tx, FLOOR_Y + 120, tz],
      0,
    );
  }

  // Fireplace glow as a flickering point light (driven in animate()).
  const fire = new THREE.PointLight(0xff5f1a, 14, 1500, 1.0);
  fire.position.set(0, FLOOR_Y + 170, -2754);
  fire.layers.set(L_ROOM);
  scene.add(fire);
  window.__firePoint = fire;
  window.__fireSpot = addRoomSpot(
    0xff5f1a, 150, 1750, Math.PI / 5.4, 0.6, 0.5,
    [0, FLOOR_Y + 240, -2700],
    [0, FLOOR_Y + 120, -1860],
    512,
  );
}

function createFireplace(x, floorY, z) {
  const g = new THREE.Group();
  const stone = material(0x2a2018, 0.85);
  const surround = new THREE.Mesh(new THREE.BoxGeometry(900, 720, 70), stone);
  surround.position.set(0, 360, 35);
  surround.castShadow = true;
  surround.receiveShadow = true;
  g.add(surround);
  // dark firebox recess
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(520, 440, 60),
    material(0x0a0806, 1),
  );
  box.position.set(0, 250, 56);
  box.receiveShadow = true;
  g.add(box);
  // mantel shelf
  const mantel = new THREE.Mesh(new THREE.BoxGeometry(980, 50, 150), material(0x3a2616, 0.6));
  mantel.position.set(0, 740, 50);
  mantel.castShadow = true;
  mantel.receiveShadow = true;
  g.add(mantel);
  // flickering ember glow plane (driven in animate)
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(440, 360),
    new THREE.MeshBasicMaterial({ color: 0xff8a36, transparent: true, opacity: 0.95 }),
  );
  glow.position.set(0, 230, 78);
  g.add(glow);
  window.__fireGlow = glow;
  // a couple of log shapes
  for (const lx of [-90, 0, 90]) {
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, 300, 7),
      material(0x140a06, 1),
    );
    log.rotation.z = Math.PI / 2;
    log.position.set(lx * 0.6, 110 + Math.abs(lx) * 0.2, 72);
    log.castShadow = true;
    log.receiveShadow = true;
    g.add(log);
  }
  g.position.set(x, floorY, z);
  return g;
}

function createPainting(x, y, z, ry, w, h) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + 70, h + 70, 36),
    new THREE.MeshStandardMaterial({ color: 0x6b4f24, roughness: 0.4, metalness: 0.4 }),
  );
  frame.castShadow = true;
  frame.receiveShadow = true;
  g.add(frame);
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: createLandscapeTexture(), roughness: 0.85 }),
  );
  art.position.z = 20;
  art.receiveShadow = true;
  g.add(art);
  g.position.set(x, y, z);
  g.rotation.y = ry;
  return g;
}

function createWarmLampGlow(x, y, z, ry, scale = 1) {
  const g = new THREE.Group();
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0x8a4a22,
    emissive: 0xff7a24,
    emissiveIntensity: 2.6,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(72 * scale, 112 * scale, 118 * scale, 32, 1, true),
    shadeMat,
  );
  shade.castShadow = false;
  shade.receiveShadow = false;
  g.add(shade);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(22 * scale, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffc18a }),
  );
  bulb.position.y = -8 * scale;
  g.add(bulb);

  // No painted-on halo sphere: the glow you see around the shade must come
  // from REAL light hitting the wall/shelf behind it, so it shades with the
  // surface's normal and texture instead of reading as a flat decal.
  const glow = new THREE.PointLight(0xff8b3a, 9 * scale, 1300 * scale, 1.0);
  glow.position.y = -8 * scale;
  g.add(glow);

  g.position.set(x, y, z);
  g.rotation.y = ry;
  return g;
}

function createLandscapeTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 192;
  const ctx = c.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, 120);
  sky.addColorStop(0, "#8a7b5a");
  sky.addColorStop(1, "#d8c089");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 256, 120);
  ctx.fillStyle = "#3c3322";
  ctx.fillRect(0, 110, 256, 82);
  // a couple of dark trees
  for (const tx of [60, 110, 200]) {
    ctx.fillStyle = "#241d12";
    ctx.beginPath();
    ctx.ellipse(tx, 108, 22, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(tx - 3, 108, 6, 30);
  }
  // varnish darkening at edges
  const v = ctx.createRadialGradient(128, 96, 40, 128, 96, 170);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(10,6,2,0.6)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 256, 192);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
