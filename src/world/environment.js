// Atmosphere & ambient life: waterholes, volumetric cumulus, wind-blown
// dust sheets, bird flocks and the per-herd dust trails. All of these
// animate from the MAP clock, so the time accelerator drives them too.
import * as THREE from "three";
import { clamp } from "../core/utils.js?v=35";
import { WORLD_W, WORLD_D, LAKES, lakeRadiusAt, L_MAP } from "../core/config.js?v=35";
import { rng, scene, setLayerDeep } from "../core/context.js?v=35";
import { terrainHeight } from "./terrain.js?v=35";
import { mapCam, fly } from "../camera/mapcam.js?v=35";
import { herds } from "../animals/animals.js?v=35";

let clouds = [];
let dustHaze = [];
let waterBodies = [];
let birds = [];
let dustSystem = [];

// Drifting cumulus billboards between the high camera and the ground.
export function createClouds() {
  // VOLUMETRIC cumulus, not flat smears. Each cloud is a CLUSTER of
  // overlapping billboards at varied depth/size; that parallax plus a
  // shaded, dense puff texture reads as a thick 3-D cloud. Real cumulus
  // proportion: wide flattish base, billowing rounded top — so puffs
  // sit wide-and-low at the base and smaller-and-higher toward the top.
  // The whole cluster is one Group so it drifts and wraps as a unit
  // (moving sprites individually would tear the cloud at the wrap edge).
  // On L_MAP so the room's warm lamps never tint them.
  clouds = [];
  const texture = createCloudTexture();
  for (let i = 0; i < 9; i++) {
    const group = new THREE.Group();
    group.position.set(
      (rng() - 0.5) * WORLD_W * 0.78,
      62 + rng() * 48, // cloud base height above the map
      (rng() - 0.5) * WORLD_D * 0.78,
    );
    // Kept compact and translucent: clouds must read as diorama weather
    // floating over the table at EVERY zoom — never as screen-filling
    // fog when the default camera sits just above the deck.
    const cloudW = 60 + rng() * 65;
    const maxOpacity = 0.48 + rng() * 0.2;
    const drift = 2.4 + rng() * 3.6;
    const puffs = [];
    const n = 6 + Math.floor(rng() * 3);
    for (let p = 0; p < n; p++) {
      const t = p / n; // 0 = base, 1 = top
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        rotation: rng() * Math.PI * 2,
      });
      const spr = new THREE.Sprite(mat);
      const pw = cloudW * (0.52 + rng() * 0.55) * (1 - t * 0.42); // narrower up top
      spr.scale.set(pw, pw * (0.66 + rng() * 0.2), 1);
      spr.position.set(
        (rng() - 0.5) * cloudW * 0.95,
        t * cloudW * 0.34 + (rng() - 0.5) * 7, // billow upward → thickness
        (rng() - 0.5) * cloudW * 0.62,
      );
      spr.userData.maxOpacity = maxOpacity * (0.72 + rng() * 0.4);
      spr.layers.set(L_MAP);
      group.add(spr);
      puffs.push(spr);
    }
    setLayerDeep(group, L_MAP);
    scene.add(group);
    clouds.push({ group, puffs, drift });
  }
  return clouds;
}

function createCloudTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Dense cauliflower puff: many overlapping blobs packed into a dome,
  // sunlit bright-white at the top, cooler/greyer toward the base
  // (self-shadow) — that vertical shade is what gives a flat billboard a
  // sense of THICKNESS. Higher alpha than before so it reads solid.
  for (let i = 0; i < 96; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.pow(rng(), 0.5);
    const x = size / 2 + Math.cos(a) * rr * size * 0.34;
    const y = size * 0.46 + Math.sin(a) * rr * size * 0.27;
    const r = size * (0.07 + rng() * 0.12);
    const shade = 1 - (y / size) * 0.42; // top brighter, base darker
    const cr = Math.round(255 * shade);
    const cg = Math.round(253 * shade);
    const cb = Math.round(250 * shade);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const alpha = 0.15 + rng() * 0.17;
    g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${alpha})`);
    g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Low wind-blown dust sheets skimming the plain — the hazy sand drift
// you see in real aerial safari footage.
export function createDustHaze() {
  dustHaze = [];
  const texture = createCloudTexture();
  for (let i = 0; i < 18; i++) {
    const mat = new THREE.SpriteMaterial({
      map: texture,
      color: 0xe0bd84,
      transparent: true,
      opacity: 0.1 + rng() * 0.13,
      depthWrite: false,
      rotation: rng() * Math.PI,
    });
    const sprite = new THREE.Sprite(mat);
    // Diorama-scaled drifting sand streaks — small relative to the map
    // so they read as wind-blown dust, not big fog patches.
    const sx = 95 + rng() * 150;
    sprite.scale.set(sx, sx * (0.18 + rng() * 0.1), 1);
    sprite.position.set(
      (rng() - 0.5) * WORLD_W * 0.92,
      6 + rng() * 22,
      (rng() - 0.5) * WORLD_D * 0.96,
    );
    sprite.userData.baseOpacity = mat.opacity;
    sprite.userData.speed = 11 + rng() * 16;
    scene.add(sprite);
    dustHaze.push(sprite);
  }
  return dustHaze;
}

export function updateDustHaze(delta) {
  const roomViewFade = 1 - clamp(((fly.on ? 0 : mapCam.dist) - 680) / 520, 0, 1);
  for (const sheet of dustHaze) {
    sheet.material.opacity = sheet.userData.baseOpacity * roomViewFade;
    sheet.visible = roomViewFade > 0.015;
    // Wind blows roughly west→east with slight meander.
    sheet.position.x += sheet.userData.speed * delta;
    sheet.position.z += sheet.userData.speed * delta * 0.18;
    if (sheet.position.x > WORLD_W * 0.47) {
      sheet.position.x = -WORLD_W * 0.47;
      sheet.position.z = (rng() - 0.5) * WORLD_D * 0.9;
    }
  }
}

export function updateClouds(elapsed, delta) {
  // The clouds belong to the diorama at EVERY zoom level — they may only
  // hide when the camera dives UNDER the cloud deck (close zoom), never
  // when pulling back to the room view.
  const effectiveDist = fly.on ? 999 : mapCam.dist;
  const t = clamp((effectiveDist - 80) / 100, 0, 1);
  const fade = t * t * (3 - 2 * t);
  for (const cloud of clouds) {
    for (const puff of cloud.puffs) {
      puff.material.opacity = puff.userData.maxOpacity * fade;
    }
    if (fade <= 0.001) continue;
    // Drift the whole cluster as a unit so it never tears at the wrap.
    cloud.group.position.x += cloud.drift * delta;
    if (cloud.group.position.x > WORLD_W * 0.62) {
      cloud.group.position.x = -WORLD_W * 0.62;
    }
  }
}

export async function createWater() {
  waterBodies = [];
  const loader = new THREE.TextureLoader();
  // Must finish loading before clone(): cloning an unloaded texture
  // leaves the clone's image empty forever -> black water.
  let normals = null;
  try {
    normals = await loader.loadAsync(
      "https://unpkg.com/three@0.165.0/examples/textures/waternormals.jpg",
    );
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  } catch {
    // Offline: fall back to flat water without ripples.
  }

  for (const lake of LAKES) {
    // Surface sized to the carved basin so water never spills onto land.
    const ripple = normals ? normals.clone() : null;
    if (ripple) {
      ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;
      ripple.needsUpdate = true;
    }
    const tiles = Math.max(4, Math.round(lake.r / 18));
    if (ripple) ripple.repeat.set(tiles, tiles);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x29606f,
      roughness: 0.3,
      metalness: 0.0,
      transparent: true,
      opacity: 0.93,
      normalMap: ripple,
      normalScale: new THREE.Vector2(1.7, 1.7),
    });
    // Warp the rim vertices to the same irregular shoreline the
    // terrain basin uses. CircleGeometry lies in the XY plane before
    // rotation, so the wobble angle must match the post-rotation
    // world angle: rotateX(-90°) maps local +y to world -z.
    const geo = new THREE.CircleGeometry(lake.r, 96);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vr = Math.hypot(vx, vy);
      if (vr < 1e-4) continue;
      const worldAngle = Math.atan2(-vy, vx);
      const scale = (lakeRadiusAt(lake, worldAngle) * 0.985) / lake.r;
      pos.setXY(i, vx * scale, vy * scale);
    }
    pos.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(lake.x, lake.waterY, lake.z);
    mesh.receiveShadow = true;
    scene.add(mesh);

    waterBodies.push({ mesh, normals: ripple });
  }
  return waterBodies;
}

export function updateWater(delta) {
  for (const body of waterBodies) {
    if (!body.normals) continue;
    body.normals.offset.x += delta * 0.018;
    body.normals.offset.y += delta * 0.011;
  }
}

// ---- Birds: loose flocks circling and drifting above the plain ----
export function createBirds() {
  birds = [];
  const flockCount = 11;
  for (let f = 0; f < flockCount; f++) {
    // Spread across the entire map, not bunched in one quadrant.
    const cx = (rng() - 0.5) * WORLD_W * 0.96;
    const cz = (rng() - 0.5) * WORLD_D * 0.96;
    const flock = {
      center: new THREE.Vector3(cx, 0, cz),
      drift: new THREE.Vector3((rng() - 0.5) * 14, 0, (rng() - 0.5) * 14),
      altitude: 26 + rng() * 70,
      radius: 20 + rng() * 46,
      angle: rng() * Math.PI * 2,
      angSpeed: 0.18 + rng() * 0.16,
      birds: [],
    };
    const n = 6 + Math.floor(rng() * 9);
    for (let i = 0; i < n; i++) {
      const bird = makeBird(0.9 + rng() * 0.7);
      // Merge: makeBird already stores wing references in userData.
      Object.assign(bird.userData, {
        offA: rng() * Math.PI * 2,
        offR: 0.4 + rng() * 0.9,
        offY: (rng() - 0.5) * 12,
        flap: 8 + rng() * 4,
        phase: rng() * Math.PI * 2,
      });
      flock.birds.push(bird);
      scene.add(bird);
    }
    birds.push(flock);
  }
  return birds;
}

function makeBird(scale) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a2620,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), mat);
  body.scale.set(0.7, 0.6, 1.7);
  group.add(body);

  const wingGeo = new THREE.BufferGeometry();
  // Triangle wing extending along +x.
  wingGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, -0.18, 1.7, 0, -0.05, 1.7, 0, 0.5],
      3,
    ),
  );
  wingGeo.computeVertexNormals();

  const left = new THREE.Group();
  const leftWing = new THREE.Mesh(wingGeo, mat);
  leftWing.castShadow = false;
  left.add(leftWing);
  group.add(left);

  const right = new THREE.Group();
  const rightWing = new THREE.Mesh(wingGeo, mat);
  rightWing.scale.x = -1;
  right.add(rightWing);
  group.add(right);

  group.scale.setScalar(scale);
  group.userData = {};
  group.userData.left = left;
  group.userData.right = right;
  return group;
}

export function updateBirds(elapsed, delta) {
  for (const flock of birds) {
    flock.angle += flock.angSpeed * delta;
    // Drift the whole flock across the plain, wrapping at the edges.
    flock.center.x += flock.drift.x * delta;
    flock.center.z += flock.drift.z * delta;
    if (flock.center.x > WORLD_W * 0.5) flock.center.x = -WORLD_W * 0.5;
    if (flock.center.x < -WORLD_W * 0.5) flock.center.x = WORLD_W * 0.5;
    if (flock.center.z > WORLD_D * 0.5) flock.center.z = -WORLD_D * 0.5;
    if (flock.center.z < -WORLD_D * 0.5) flock.center.z = WORLD_D * 0.5;

    const groundY = terrainHeight(flock.center.x, flock.center.z);
    for (const bird of flock.birds) {
      const u = bird.userData;
      const a = flock.angle + u.offA;
      const r = flock.radius * u.offR;
      const x = flock.center.x + Math.cos(a) * r;
      const z = flock.center.z + Math.sin(a) * r;
      const y =
        groundY + flock.altitude + u.offY +
        Math.sin(elapsed * 0.8 + u.phase) * 3.5;
      // Face along the tangent of the circular path.
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      bird.position.set(x, y, z);
      bird.rotation.y = Math.atan2(tx, tz);
      bird.rotation.z = Math.sin(elapsed * 1.2 + u.phase) * 0.12;
      const flap = Math.sin(elapsed * u.flap + u.phase) * 0.6;
      u.left.rotation.z = flap;
      u.right.rotation.z = -flap;
    }
  }
}

// ---- Per-herd dust trails ----
export function createDustSystem() {
  const texture = createDustTexture();
  dustSystem = [];
  for (const herd of herds) {
    const count = herd.type === "elephant" ? 90 : herd.count * 2;
    const positions = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      seeds.push({
        along: -rng() * Math.max(14, herd.spread[0] * 0.65),
        side: (rng() - 0.5) * (herd.spread[1] * 1.9 + 6),
        height: 0.2 + rng() * 1.2,
        phase: rng() * Math.PI * 2,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      map: texture,
      color: 0xd4b178,
      size: herd.type === "elephant" ? 6.4 : 4.2,
      transparent: true,
      opacity: herd.type === "elephant" ? 0.32 : 0.24,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const points = new THREE.Points(geometry, mat);
    points.frustumCulled = false;
    scene.add(points);
    dustSystem.push({ herd, points, positions, seeds });
  }
  return dustSystem;
}

function createDustTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255, 239, 202, 0.48)");
  g.addColorStop(0.42, "rgba(214, 181, 124, 0.24)");
  g.addColorStop(1, "rgba(214, 181, 124, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function updateDust(elapsed) {
  for (const group of dustSystem) {
    const { herd, positions, seeds, points } = group;
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const drift = Math.sin(elapsed * 0.6 + seed.phase) * 1.5;
      const spread = 1 + Math.sin(elapsed * 0.32 + seed.phase) * 0.18;
      const x =
        herd.dustAnchor.x -
        herd.direction.x * Math.abs(seed.along) * spread +
        herd.side.x * (seed.side + drift);
      const z =
        herd.dustAnchor.z -
        herd.direction.z * Math.abs(seed.along) * spread +
        herd.side.z * (seed.side + drift);
      const y = terrainHeight(x, z) + seed.height + Math.sin(elapsed + seed.phase) * 0.15;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    points.geometry.attributes.position.needsUpdate = true;
  }
}
