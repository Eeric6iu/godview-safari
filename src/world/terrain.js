// Terrain: the FBM height field, the lake basins, the splat-blended
// anti-tiling ground shader, and the shared site queries (terrainHeight /
// lushFactor / isUnderwater) that every placement system calls.
import * as THREE from "three";
import { clamp, lerp, smoothstep, fbm } from "../core/utils.js?v=35";
import { WORLD_W, WORLD_D, LAKES, lakeRadiusAt } from "../core/config.js?v=35";
import { rng } from "../core/context.js?v=35";

// ---- Terrain height field ----
// Layered FBM: broad dunes + medium swells + fine bumps + micro ripple,
// then each waterhole flattens its rim and digs a basin below the water.
export function baseTerrain(x, z) {
  const hills = (fbm(x * 0.0042 + 12.2, z * 0.0042 - 7.8) - 0.5) * 26;
  const mid = (fbm(x * 0.017 + 3.1, z * 0.017 + 9.4) - 0.5) * 7.5;
  const fine = (fbm(x * 0.075, z * 0.075) - 0.5) * 1.8;
  const micro = Math.sin(x * 0.21 + z * 0.05) * Math.cos(z * 0.18 - x * 0.04) * 0.35;
  return hills + mid + fine + micro;
}

export function terrainHeight(x, z) {
  let h = baseTerrain(x, z);
  for (const lake of LAKES) {
    const dx = x - lake.x;
    const dz = z - lake.z;
    const d = Math.hypot(dx, dz);
    if (d > lake.r * 2.0) continue;
    const rEff = lakeRadiusAt(lake, Math.atan2(dz, dx));
    const blend = 1 - smoothstep(rEff, rEff * 1.7, d);
    if (blend > 0) h = lerp(h, lake.base, blend);
    if (d < rEff) h -= lake.depth * (1 - d / rEff);
  }
  // Settle the relief to a fixed height at the map rim so the terrain
  // meets the surrounding apron without a visible cliff.
  const ex = Math.max(
    Math.abs(x) / (WORLD_W * 0.5),
    Math.abs(z) / (WORLD_D * 0.5),
  );
  if (ex > 0.88) h = lerp(h, -1.5, smoothstep(0.88, 1.0, Math.min(ex, 1)));
  return h;
}

// 0 in open ground, 1 right at a waterhole — drives grass greening.
export function lushFactor(x, z) {
  let f = 0;
  for (const lake of LAKES) {
    const d = Math.hypot(x - lake.x, z - lake.z);
    f = Math.max(f, smoothstep(lake.r * 2.0, lake.r * 0.95, d));
  }
  return f;
}

export function isUnderwater(x, z, h) {
  for (const lake of LAKES) {
    const d = Math.hypot(x - lake.x, z - lake.z);
    if (d < lake.r * 1.04 && h < lake.waterY + 0.06) return true;
  }
  return false;
}

export function createTerrain() {
  const geometry = new THREE.PlaneGeometry(WORLD_W, WORLD_D, 360, 264);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, terrainHeight(x, z));
  }
  geometry.computeVertexNormals();

  const map = createTerrainTexture();
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  // ---- Real-ground shader, built on the industry anti-tiling kit ----
  // Three photo ground layers (leaf litter / cracked mud / sand) are
  // splat-blended by a procedural control map; each layer is sampled
  // STOCHASTICALLY (a rotated-offset second tap mixed by low-freq
  // noise — Unity's procedural stochastic texturing, simplified);
  // a 2-scale MACRO VARIATION curve modulates brightness (UE's
  // T_Default_MacroVariation recipe); and the whole detail term FADES
  // WITH DISTANCE so far ground shows only the non-repeating macro
  // canvas (UE's depth-fade tiling trick).
  const texLoader = new THREE.TextureLoader();
  const loadDetail = (file) => {
    const t = texLoader.load("assets/polyhaven/" + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const detailDiff = loadDetail("forrest_ground_01_diff_2k.jpg");
  const mudDiff = loadDetail("room/brown_mud_dry_diff_2k.jpg");
  const sandDiff = loadDetail("room/aerial_sand_diff_2k.jpg");
  const splatTex = createSplatMap();
  const detailNor = texLoader.load(
    "assets/polyhaven/forrest_ground_01_nor_gl_2k.jpg",
  );
  detailNor.wrapS = detailNor.wrapT = THREE.RepeatWrapping;
  detailNor.repeat.set(210, 154);

  const material = new THREE.MeshStandardMaterial({
    map,
    // Pale straw grade (calibrated): a saturated orange grade here collapses
    // G/B in linear space and the whole plain turns rust under any light.
    // The aerial-photo gold comes from this near-white warm grade × the
    // canvas texture's own dryness variation.
    color: 0xfaf2e2,
    roughness: 0.97,
    metalness: 0.0,
    normalMap: detailNor,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detailDiff };
    shader.uniforms.mudMap = { value: mudDiff };
    shader.uniforms.sandMap = { value: sandDiff };
    shader.uniforms.splatMap = { value: splatTex };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D detailMap;
        uniform sampler2D mudMap;
        uniform sampler2D sandMap;
        uniform sampler2D splatMap;
        vec3 stochTap(sampler2D t, vec2 uv, float sel) {
          vec3 a = texture2D(t, uv).rgb;
          vec3 b = texture2D(t, vec2(-uv.y, uv.x) * 1.09 + vec2(0.37, 0.71)).rgb;
          return mix(a, b, smoothstep(0.32, 0.68, sel));
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          float viewDist = length(vViewPosition);
          float detailFade = 1.0 - smoothstep(170.0, 760.0, viewDist);
          vec3 detail = vec3(0.40);
          if (detailFade > 0.003) {
            vec4 sp = texture2D(splatMap, vMapUv);
            float sel = texture2D(splatMap, vMapUv * 6.7).b;
            vec2 duv = vMapUv * vec2(210.0, 154.0);
            detail = stochTap(detailMap, duv, sel);
            detail = mix(detail, stochTap(mudMap, duv * 0.85, sel), sp.r);
            detail = mix(detail, stochTap(sandMap, duv * 1.2, sel), sp.g);
            // macro variation: two noise scales multiplied (UE recipe)
            float macro =
              (0.62 + texture2D(splatMap, vMapUv * 3.1).b * 0.76) *
              (0.74 + texture2D(splatMap, vMapUv * 12.7).b * 0.52);
            detail *= macro;
            detail = mix(vec3(0.40), detail, detailFade);
          }
          diffuseColor.rgb *= detail * 1.72;
        }`,
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Splat control map for the ground shader. R = cracked-mud weight
// (dry highlands), G = sand weight (pale flats), B = broadband noise
// reused as the stochastic selector and macro-variation source.
function createSplatMap() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const mud = smoothstep(0.55, 0.78, fbm(u * 9.2 + 31.7, v * 9.2 - 12.4));
      const sand = smoothstep(0.58, 0.8, fbm(u * 6.4 - 8.1, v * 6.4 + 23.9));
      const noise = fbm(u * 18.0 + 4.2, v * 18.0 + 9.1);
      const i = (y * size + x) * 4;
      d[i] = mud * 235;
      d[i + 1] = sand * 235 * (1 - mud); // mud wins overlaps
      d[i + 2] = noise * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createTerrainTexture() {
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n =
        fbm(u * 26.0, v * 26.0) * 0.58 +
        fbm(u * 96.0 + 20.0, v * 96.0) * 0.22 +
        fbm(u * 280.0, v * 280.0 + 4.0) * 0.2;
      const dryness = Math.pow(n, 1.45);
      const i = (y * size + x) * 4;
      data[i] = 172 + dryness * 70;
      data[i + 1] = 144 + dryness * 70;
      data[i + 2] = 94 + dryness * 54;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < 9000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 8 + rng() * 34;
    const angle = rng() * Math.PI;
    ctx.strokeStyle = `rgba(72, 54, 34, ${0.045 + rng() * 0.095})`;
    ctx.lineWidth = 0.55 + rng() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 120; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 12 + rng() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(210, 160, 92, 0.11)");
    g.addColorStop(1, "rgba(210, 160, 92, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.8 + rng()), r * (0.24 + rng() * 0.4), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Green halo of moist vegetation around each waterhole.
  ctx.globalCompositeOperation = "source-over";
  for (const lake of LAKES) {
    const c = worldToCanvas(lake.x, lake.z, size);
    const rad = (lake.r * 2.1 / WORLD_W) * size;
    const g = ctx.createRadialGradient(c.x, c.y, rad * 0.28, c.x, c.y, rad);
    g.addColorStop(0, "rgba(74, 104, 40, 0.85)");
    g.addColorStop(0.55, "rgba(110, 124, 52, 0.5)");
    g.addColorStop(1, "rgba(150, 140, 80, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
    ctx.fill();
    // Water itself reads darker on the map.
    const wr = (lake.r * 0.96 / WORLD_W) * size;
    const wg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, wr);
    wg.addColorStop(0, "rgba(40, 64, 70, 0.55)");
    wg.addColorStop(1, "rgba(60, 80, 70, 0)");
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.arc(c.x, c.y, wr, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTrail(ctx, size, [
    [-720, 228], [-420, 192], [-132, 132], [108, 96], [456, 54],
  ], 22, "rgba(178, 121, 62, 0.24)");
  drawTrail(ctx, size, [
    [540, -492], [312, -336], [72, -216], [-216, -156], [-588, -108],
  ], 18, "rgba(190, 132, 70, 0.24)");
  drawTrail(ctx, size, [
    [-108, 72], [-24, -36], [36, -168], [72, -336], [108, -492],
  ], 16, "rgba(198, 142, 78, 0.22)");

  return new THREE.CanvasTexture(canvas);
}

function drawTrail(ctx, size, worldPoints, width, color) {
  const pts = worldPoints.map(([x, z]) => worldToCanvas(x, z, size));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) * 0.5;
    const midY = (pts[i].y + pts[i + 1].y) * 0.5;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();

  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = "rgba(83, 59, 35, 0.14)";
  ctx.lineWidth = Math.max(1, width * 0.18);
  for (let i = 0; i < 4; i++) {
    ctx.setLineDash([2 + i, 12 + i * 2]);
    ctx.stroke();
  }
  ctx.restore();
}

function worldToCanvas(x, z, size) {
  return {
    x: (x / WORLD_W + 0.5) * size,
    y: (z / WORLD_D + 0.5) * size,
  };
}
