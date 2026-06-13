// All vegetation: photoscanned grass + nature models, painted grass
// cards, reeds, procedural shrubs/acacias/baobabs/termite mounds. Every
// placement queries the shared terrain functions and the one seeded rng;
// shapes consume the shared tree materials from core/materials.js.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WORLD_W, WORLD_D, M_UNIT, LAKES } from "../core/config.js";
import { rng, scene, applyWindSway } from "../core/context.js";
import { material, treeBarkMat, treeCanopyMat } from "../core/materials.js";
import { terrainHeight, lushFactor, isUnderwater } from "./terrain.js";

// Photoscanned grass clumps (Poly Haven "Grass Medium 01", CC0).
// Variants are instanced per spatial cell so off-screen cells get
// frustum-culled, and tinted dry-gold to match the savanna.
export async function createRealGrass() {
  const meshes = [];
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(
      "assets/polyhaven/grass_medium_01_1k.gltf",
    );
  } catch {
    return meshes; // assets missing — cards still cover the ground
  }

  const variants = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.index) return;
    const tris = o.geometry.index.count / 3;
    if (tris < 250 || tris > 1600) return;
    // Bake the source transform, re-root the clump on its base center.
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(
      -(bb.min.x + bb.max.x) / 2,
      -bb.min.y,
      -(bb.min.z + bb.max.z) / 2,
    );
    // Normalize footprint to ~1 unit so instance scales mean meters.
    const span = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 0.01);
    geo.scale(1 / span, 1 / span, 1 / span);
    variants.push(geo);
  });
  if (variants.length === 0) return meshes;
  const picks = variants.slice(0, 4);

  let srcMap = null;
  gltf.scene.traverse((o) => {
    if (o.isMesh && o.material?.map && !srcMap) srcMap = o.material.map;
  });
  if (!srcMap?.image) return meshes;

  // The 1k glTF ships a JPG baseColor although the material says
  // alphaMode BLEND — the alpha channel is simply lost, so the black
  // atlas padding renders as solid black clumps. Rebuild the texture:
  // luma-key the black background to transparent and grade the green
  // photo blades toward dry savanna gold in the same pass.
  const img = srcMap.image;
  const kc = document.createElement("canvas");
  kc.width = img.width;
  kc.height = img.height;
  const kctx = kc.getContext("2d");
  kctx.drawImage(img, 0, 0);
  const px = kctx.getImageData(0, 0, kc.width, kc.height);
  const a = px.data;
  for (let i = 0; i < a.length; i += 4) {
    const lum = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
    if (lum < 30) {
      a[i + 3] = 0;
      // keep RGB warm so mipmaps don't bleed black halos
      a[i] = 205;
      a[i + 1] = 172;
      a[i + 2] = 104;
    } else {
      a[i] = Math.min(255, a[i] * 1.85);
      a[i + 1] = Math.min(255, a[i + 1] * 1.42);
      a[i + 2] = Math.min(255, a[i + 2] * 0.8);
    }
  }
  kctx.putImageData(px, 0, 0);
  const keyedMap = new THREE.CanvasTexture(kc);
  keyedMap.colorSpace = THREE.SRGBColorSpace;
  keyedMap.flipY = false; // match glTF UV convention

  // Per-instance tint comes from instanceColor (setColorAt), which
  // three enables automatically — vertexColors:true here would read
  // a missing geometry color attribute as black.
  const grassMat = new THREE.MeshStandardMaterial({
    map: keyedMap,
    alphaTest: 0.45,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  applyWindSway(grassMat, 0.05);

  const dry = new THREE.Color(0xffffff);
  const green = new THREE.Color(0xa6c47e);
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();

  const CELLS_X = 4;
  const CELLS_Z = 3;
  const TOTAL = 2880; // ~80% of the old 3600 (plant declutter)
  const perCell = Math.ceil(TOTAL / (CELLS_X * CELLS_Z * picks.length));
  for (let cx = 0; cx < CELLS_X; cx++) {
    for (let cz = 0; cz < CELLS_Z; cz++) {
      const x0 = (cx / CELLS_X - 0.5) * WORLD_W;
      const z0 = (cz / CELLS_Z - 0.5) * WORLD_D;
      const cw = WORLD_W / CELLS_X;
      const cd = WORLD_D / CELLS_Z;
      for (const geo of picks) {
        const mesh = new THREE.InstancedMesh(geo, grassMat, perCell);
        mesh.receiveShadow = true;
        let placed = 0;
        for (let i = 0; i < perCell * 3 && placed < perCell; i++) {
          const x = x0 + rng() * cw;
          const z = z0 + rng() * cd;
          const h = terrainHeight(x, z);
          if (isUnderwater(x, z, h)) continue;
          const lush = lushFactor(x, z);
          // Denser, larger, greener near water; sparse on dry plain.
          if (lush < 0.08 && rng() > 0.55) continue;
          const s = (1.4 + rng() * 1.8) * (1 + lush * 0.8);
          dummy.position.set(x, h - 0.04, z);
          dummy.rotation.set(0, rng() * Math.PI * 2, 0);
          dummy.scale.set(s, s * (0.85 + rng() * 0.5), s);
          dummy.updateMatrix();
          mesh.setMatrixAt(placed, dummy.matrix);
          color.copy(dry).lerp(green, Math.min(1, lush * 1.1));
          mesh.setColorAt(placed, color);
          placed++;
        }
        mesh.count = placed;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        scene.add(mesh);
        meshes.push(mesh);
      }
    }
  }
  return meshes;
}

// Mass ground cover: crossed alpha cards with painted dry blades.
// Far cheaper than mesh clumps, fills the plain out to the edges.
export function createGrassCards() {
  const tex = createGrassBladeTexture();
  const single = new THREE.PlaneGeometry(1, 1);
  single.translate(0, 0.5, 0);
  const crossed = mergeCrossPlanes(single);
  const cardMat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  applyWindSway(cardMat, 0.07);
  const count = 7200; // plant declutter pass: ~80% of the old 9000
  const mesh = new THREE.InstancedMesh(crossed, cardMat, count);
  mesh.receiveShadow = true;

  const dry = new THREE.Color(0xe2c684);
  const green = new THREE.Color(0xa8bc6a);
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < count * 2 && placed < count; i++) {
    const x = (rng() - 0.5) * WORLD_W * 0.99;
    const z = (rng() - 0.5) * WORLD_D * 0.99;
    const h = terrainHeight(x, z);
    if (isUnderwater(x, z, h)) continue;
    const lush = lushFactor(x, z);
    // Savanna grass ≈ 0.5–1.2 m; trimmed so tufts read as knee-height
    // against the now-larger animals, then × M_UNIT for shared scale.
    const s = (0.45 + rng() * 0.6 + lush * 0.4) * M_UNIT;
    dummy.position.set(x, h - 0.03, z);
    dummy.rotation.set(0, rng() * Math.PI, 0);
    dummy.scale.set(s, s * (0.7 + rng() * 0.7), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    color.copy(dry).lerp(green, Math.min(1, lush * 1.1));
    mesh.setColorAt(placed, color);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  window.__grassCards = mesh;
}

function mergeCrossPlanes(plane) {
  const a = plane;
  const b = plane.clone().rotateY(Math.PI / 2);
  const merged = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  let offset = 0;
  for (const g of [a, b]) {
    const p = g.attributes.position.array;
    const u = g.attributes.uv.array;
    const ix = g.index.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < u.length; i++) uv.push(u[i]);
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + offset);
    offset += g.attributes.position.count;
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  merged.setIndex(idx);
  merged.computeVertexNormals();
  return merged;
}

// Painted tuft of dry blades with alpha — reads as real grass from
// a few meters up, unlike solid low-poly cones.
function createGrassBladeTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Pre-fill RGB with grass color at alpha 0 ("copy" writes RGB even
  // at zero alpha). Without this, transparent texels are black and
  // mipmapping bleeds dark halos around every blade.
  ctx.globalCompositeOperation = "copy";
  ctx.fillStyle = "rgba(208, 178, 108, 0)";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
  const baseX = size / 2;
  for (let i = 0; i < 90; i++) {
    const rootX = baseX + (rng() - 0.5) * size * 0.7;
    const lean = (rng() - 0.5) * size * 0.55;
    const height = size * (0.45 + rng() * 0.5);
    const w = 1 + rng() * 2.2;
    const shade = 150 + rng() * 105;
    ctx.strokeStyle = `rgba(${shade}, ${shade * 0.86}, ${shade * 0.5}, ${0.75 + rng() * 0.25})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(rootX, size);
    ctx.quadraticCurveTo(
      rootX + lean * 0.3,
      size - height * 0.6,
      rootX + lean,
      size - height,
    );
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Reed clumps right at the shoreline of each lake — tall thin grass
// cards, same painted-blade look as the ground cover.
export function createReeds() {
  const single = new THREE.PlaneGeometry(0.8, 2.6);
  single.translate(0, 1.3, 0);
  const geometry = mergeCrossPlanes(single);
  const reedMat = new THREE.MeshStandardMaterial({
    map: createGrassBladeTexture(),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    color: 0x7d8c42,
    roughness: 1,
  });
  applyWindSway(reedMat, 0.045);
  const count = 1760; // ~80% of the old 2200 (plant declutter)
  const mesh = new THREE.InstancedMesh(geometry, reedMat, count);
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 60) {
    guard++;
    const lake = LAKES[Math.floor(rng() * LAKES.length)];
    const ang = rng() * Math.PI * 2;
    const rad = lake.r * (0.96 + rng() * 0.16);
    const x = lake.x + Math.cos(ang) * rad;
    const z = lake.z + Math.sin(ang) * rad;
    const h = terrainHeight(x, z);
    // Only place on the wet fringe, not deep water nor dry land.
    if (h < lake.waterY - 0.6 || h > lake.waterY + 0.9) continue;
    // Reeds ≈ 1–2.5 m: shorter than before so they fringe the shore
    // instead of walling it off with tall dark spikes.
    const s = 0.5 + rng() * 0.45;
    dummy.position.set(x, Math.max(h, lake.waterY) - 0.05, z);
    dummy.rotation.set(
      (rng() - 0.5) * 0.22,
      rng() * Math.PI * 2,
      (rng() - 0.5) * 0.22,
    );
    dummy.scale.set(s, s * (1.0 + rng() * 0.5), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

// Real photoscanned flora & rocks (Poly Haven, CC0): each model is
// instanced once per source mesh, so 70 bushes still cost only a few
// draw calls. Placement rules mirror the old procedural scatter.
export async function createRealNature() {
  const DEFS = [
    // [file, count, targetH range in METRES (× M_UNIT below), placement, fitMode, sink, split]
    // Plant counts cut to ~80% per the declutter pass; rocks kept.
    ["quiver_tree_02_1k.gltf", 18, [4.0, 7.0], "anywhere", "y", 0.02], // real quiver tree 4–7 m (was a wrong 13–22)
    ["searsia_burchellii_1k.gltf", 64, [2.0, 4.0], "anywhere", "y", 0.04], // searsia shrub 2–4 m
    ["shrub_03_1k.gltf", 64, [1.2, 2.6], "lush-biased", "y", 0.04], // low bush 1.2–2.6 m
    ["dead_tree_trunk_1k.gltf", 14, [4.0, 7.0], "anywhere", "max", 0.18], // dead trunk 4–7 m
    // kopje boulder GROUP: split into single rocks, placed in clusters
    // so every stone grounds on its own terrain height — a group
    // placed as one unit floats on any slope.
    ["namaqualand_boulders_01_1k.gltf", 9, [3.0, 7.0], "anywhere", "y", 0.16, "cluster"], // kopje boulders 3–7 m
    ["namaqualand_boulder_02_1k.gltf", 26, [1.0, 2.8], "anywhere", "y", 0.14], // scattered rocks 1–2.8 m
  ];
  for (const [file, count, hRange, place, fitMode, sink = 0, split] of DEFS) {
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync("assets/polyhaven/nature/" + file);
    } catch {
      continue; // offline — skip this species
    }
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    // Normalize the whole model so `scale` means world-units height.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const norm =
      1 /
      Math.max(
        fitMode === "max" ? Math.max(size.x, size.y, size.z) : size.y,
        0.001,
      );
    const baseY = box.min.y;
    const cx0 = (box.min.x + box.max.x) / 2;
    const cz0 = (box.min.z + box.max.z) / 2;
    const sinkWorld = sink * size.y; // model units -> world via *scale

    if (split === "cluster") {
      // Each mesh becomes an independent rock; instances are grouped
      // around cluster centres, every stone grounded individually.
      const centers = [];
      let cg = 0;
      while (centers.length < count && cg++ < count * 30) {
        const x = (rng() - 0.5) * WORLD_W * 0.9;
        const z = (rng() - 0.5) * WORLD_D * 0.88;
        if (isUnderwater(x, z, terrainHeight(x, z))) continue;
        centers.push([x, z]);
      }
      const rocks = [];
      model.traverse((o) => {
        if (o.isMesh) rocks.push(o);
      });
      const dummy2 = new THREE.Object3D();
      for (const rock of rocks) {
        const g = rock.geometry.clone().applyMatrix4(rock.matrixWorld);
        g.computeBoundingBox();
        const rb = g.boundingBox;
        g.translate(
          -(rb.min.x + rb.max.x) / 2,
          -rb.min.y,
          -(rb.min.z + rb.max.z) / 2,
        );
        const rh = Math.max(rb.max.y - rb.min.y, 0.001);
        const perRock = 2; // each rock model appears ~2x per cluster set
        const im = new THREE.InstancedMesh(g, rock.material, centers.length * perRock);
        im.castShadow = true;
        im.receiveShadow = true;
        let k = 0;
        for (const [ccx, ccz] of centers) {
          for (let r = 0; r < perRock; r++) {
            const px = ccx + (rng() - 0.5) * 16;
            const pz = ccz + (rng() - 0.5) * 14;
            const ph = terrainHeight(px, pz);
            const sWorld = ((hRange[0] + rng() * (hRange[1] - hRange[0])) * M_UNIT) / rh;
            dummy2.position.set(px, ph - sWorld * rh * sink, pz);
            dummy2.rotation.set(0, rng() * Math.PI * 2, 0);
            dummy2.scale.setScalar(sWorld);
            dummy2.updateMatrix();
            im.setMatrixAt(k++, dummy2.matrix);
          }
        }
        im.count = k;
        im.instanceMatrix.needsUpdate = true;
        scene.add(im);
      }
      continue;
    }

    // Generate placements.
    const placements = [];
    let guard = 0;
    while (placements.length < count && guard++ < count * 30) {
      const x = (rng() - 0.5) * WORLD_W * 0.96;
      const z = (rng() - 0.5) * WORLD_D * 0.93;
      const h = terrainHeight(x, z);
      if (isUnderwater(x, z, h)) continue;
      const lush = lushFactor(x, z);
      if (place === "lush-biased" && lush < 0.05 && rng() > 0.4) continue;
      const s = (hRange[0] + rng() * (hRange[1] - hRange[0])) * M_UNIT * norm;
      const rot = rng() * Math.PI * 2;
      placements.push({ x, z, h, s, rot });
    }

    // One InstancedMesh per source mesh, transforms composed with the
    // mesh's own matrix inside the model.
    const dummy = new THREE.Object3D();
    const place3 = new THREE.Matrix4();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, placements.length);
      im.castShadow = true;
      im.receiveShadow = true;
      placements.forEach((p, i) => {
        dummy.position.set(p.x, p.h - p.s * sinkWorld, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(p.s);
        dummy.updateMatrix();
        // shift model so its base center sits at the placement point
        place3
          .makeTranslation(-cx0, -baseY, -cz0)
          .premultiply(dummy.matrix);
        im.setMatrixAt(i, place3.clone().multiply(o.matrixWorld));
      });
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
    });
  }
}

export function createShrubsAndTrees() {
  const groups = [];
  // Procedural shrubs reduced — the photoscanned searsia/shrub_03 now
  // carry most of the bush coverage.
  for (let i = 0; i < 88; i++) {
    const x = (rng() - 0.5) * WORLD_W * 0.96;
    const z = (rng() - 0.5) * WORLD_D * 0.94;
    const h = terrainHeight(x, z);
    if (isUnderwater(x, z, h)) continue;
    const lush = lushFactor(x, z);
    const green = rng() > 0.5 - lush * 0.4;
    // Real bush ≈ 1–2.5 m: base range trimmed (was way oversized), then
    // × M_UNIT so it shares the savanna scale with everything else.
    const scale = (0.55 + rng() * 0.95 + lush * 0.5) * M_UNIT;
    groups.push(createShrub(x, z, scale, green));
  }
  mergeVegetation(groups);
}

// Thousands of tiny shrub/tree meshes are a draw-call bottleneck.
// Bake them into one merged mesh per material color — the herds and
// grass stay live, the static vegetation becomes a handful of calls.
function mergeVegetation(groups) {
  const buckets = new Map();
  for (const group of groups) {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.color.getHex();
      if (!buckets.has(key)) {
        buckets.set(key, { material: o.material, geos: [] });
      }
      buckets.get(key).geos.push(
        o.geometry.clone().applyMatrix4(o.matrixWorld),
      );
    });
  }
  for (const { material: mat, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// Iconic flat-topped acacia trees scattered across the plain.
export function createAcaciaGrove() {
  const groups = [];
  for (let i = 0; i < 76; i++) {
    const x = (rng() - 0.5) * WORLD_W * 0.95;
    const z = (rng() - 0.5) * WORLD_D * 0.9;
    const h = terrainHeight(x, z);
    if (isUnderwater(x, z, h)) continue;
    // Acacia ≈ 8–12 m: the existing geometry is already ~1 unit/metre,
    // so just × M_UNIT to ride the shared savanna scale.
    groups.push(createAcacia(x, z, h, (0.9 + rng() * 1.4 + lushFactor(x, z) * 0.6) * M_UNIT));
  }
  mergeVegetation(groups);
}

function createAcacia(x, z, h, scale) {
  const root = new THREE.Group();
  root.position.set(x, h, z);
  const barkMat = treeBarkMat();
  const trunkH = 3.0 * scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16 * scale, 0.34 * scale, trunkH, 7),
    barkMat,
  );
  trunk.position.y = trunkH * 0.5;
  trunk.castShadow = true;
  root.add(trunk);

  // A couple of upward branches feeding the umbrella canopy.
  for (let i = 0; i < 3; i++) {
    const br = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05 * scale, 0.12 * scale, 1.6 * scale, 5),
      barkMat,
    );
    br.position.y = trunkH * 0.86;
    br.rotation.z = (rng() - 0.5) * 0.7;
    br.rotation.x = (rng() - 0.5) * 0.7;
    br.castShadow = true;
    root.add(br);
  }

  const canopyMat = treeCanopyMat(0xd2e094);
  const canopyY = trunkH + 0.5 * scale;
  const blobs = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.0, 0),
      canopyMat,
    );
    const a = (i / blobs) * Math.PI * 2 + rng() * 0.6;
    const rad = (0.6 + rng() * 1.5) * scale;
    blob.position.set(
      Math.cos(a) * rad,
      canopyY + (rng() - 0.5) * 0.5 * scale,
      Math.sin(a) * rad,
    );
    blob.scale.set(
      (1.7 + rng() * 1.0) * scale,
      (0.55 + rng() * 0.25) * scale,
      (1.7 + rng() * 1.0) * scale,
    );
    blob.castShadow = true;
    blob.receiveShadow = true;
    root.add(blob);
  }
  return root;
}

// Signature savanna landmarks the reference ecosystems all have:
// solitary baobabs and termite mounds, merged into static meshes.
export function createSafariLandmarks() {
  const groups = [];

  for (let i = 0; i < 7; i++) {
    const x = (rng() - 0.5) * WORLD_W * 0.9;
    const z = (rng() - 0.5) * WORLD_D * 0.86;
    const h = terrainHeight(x, z);
    if (isUnderwater(x, z, h)) continue;
    // Baobab ≈ 12–18 m, already ~1 unit/metre → × M_UNIT.
    groups.push(createBaobab(x, z, h, (1.1 + rng() * 0.9) * M_UNIT));
  }

  for (let i = 0; i < 50; i++) {
    const x = (rng() - 0.5) * WORLD_W * 0.94;
    const z = (rng() - 0.5) * WORLD_D * 0.92;
    const h = terrainHeight(x, z);
    if (isUnderwater(x, z, h)) continue;
    // Termite mound ≈ 2–6 m (geology, not a plant → count kept) × M_UNIT.
    groups.push(createTermiteMound(x, z, h, (0.7 + rng() * 1.6) * M_UNIT));
  }

  // (kopjes now come from photoscanned namaqualand boulders)

  mergeVegetation(groups);
}

function createBaobab(x, z, h, scale) {
  const root = new THREE.Group();
  root.position.set(x, h, z);
  const barkMat = treeBarkMat(0xb59a7c);
  const trunkH = 7 * scale;
  // Massive bottle trunk — the baobab silhouette.
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9 * scale, 1.6 * scale, trunkH, 9),
    barkMat,
  );
  trunk.position.y = trunkH * 0.5;
  trunk.castShadow = true;
  root.add(trunk);
  // Stubby root-like crown branches.
  for (let i = 0; i < 7; i++) {
    const br = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1 * scale, 0.3 * scale, 2.6 * scale, 6),
      barkMat,
    );
    const a = (i / 7) * Math.PI * 2 + rng() * 0.5;
    br.position.set(
      Math.cos(a) * 0.9 * scale,
      trunkH + 0.9 * scale,
      Math.sin(a) * 0.9 * scale,
    );
    br.rotation.z = (rng() - 0.5) * 1.3;
    br.rotation.x = (rng() - 0.5) * 1.3;
    br.castShadow = true;
    root.add(br);
  }
  // Sparse dry-season canopy puffs.
  const leafMat = treeCanopyMat(0xdcca96);
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), leafMat);
    puff.position.set(
      (rng() - 0.5) * 3.4 * scale,
      trunkH + (1.6 + rng() * 1.2) * scale,
      (rng() - 0.5) * 3.4 * scale,
    );
    puff.scale.set(1.6 * scale, 0.55 * scale, 1.6 * scale);
    puff.castShadow = true;
    root.add(puff);
  }
  return root;
}

function createTermiteMound(x, z, h, scale) {
  const root = new THREE.Group();
  root.position.set(x, h, z);
  const mat = material(0x9b7950, 1);
  const spires = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < spires; i++) {
    const sh = (1.6 + rng() * 2.4) * scale;
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry((0.5 + rng() * 0.4) * scale, sh, 7),
      mat,
    );
    spire.position.set(
      (rng() - 0.5) * 0.9 * scale,
      sh * 0.5 - 0.1,
      (rng() - 0.5) * 0.9 * scale,
    );
    spire.rotation.z = (rng() - 0.5) * 0.18;
    spire.castShadow = true;
    root.add(spire);
  }
  return root;
}

function createShrub(x, z, scale, green) {
  const root = new THREE.Group();
  root.position.set(x, terrainHeight(x, z), z);
  const trunkMat = treeBarkMat();
  const leafMat = treeCanopyMat(green ? 0xc8da8c : 0xdcc492);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.0, 6), trunkMat);
  trunk.position.y = 0.45 * scale;
  trunk.scale.setScalar(scale);
  trunk.castShadow = true;
  root.add(trunk);

  const leafGeo = new THREE.DodecahedronGeometry(0.8, 0);
  const blobs = 3 + Math.floor(rng() * 5);
  for (let i = 0; i < blobs; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(
      (rng() - 0.5) * 0.9 * scale,
      (0.9 + rng() * 0.75) * scale,
      (rng() - 0.5) * 0.9 * scale,
    );
    leaf.scale.setScalar((0.55 + rng() * 0.55) * scale);
    leaf.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    root.add(leaf);
  }
  return root;
}

// Pale trampled patches — bright sandy openings in the grass cover.
export function createPalePatches() {
  const patchMat = new THREE.MeshBasicMaterial({
    color: 0xe6dec7,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const geo = new THREE.CircleGeometry(1, 24);
  for (let i = 0; i < 90; i++) {
    const x = (rng() - 0.5) * WORLD_W * 0.94;
    const z = (rng() - 0.5) * WORLD_D * 0.9;
    const h = terrainHeight(x, z);
    if (isUnderwater(x, z, h)) continue;
    const mesh = new THREE.Mesh(geo, patchMat);
    mesh.position.set(x, h + 0.02, z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rng() * Math.PI;
    mesh.scale.set(3 + rng() * 9, 1 + rng() * 3.5, 1);
    scene.add(mesh);
  }
}
