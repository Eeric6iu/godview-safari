// World constants and URL-tunable performance config — the single source
// every module reads. No live state here, only configuration.

// ---- World scale (0.7x of the previous build, same herd counts) ----
export const WORLD_W = 1092;
export const WORLD_D = 798;

// ---- Real-world size reference ----
// 1 metre = M_UNIT world units. EVERY natural object (animal, tree,
// shrub, rock, grass) is sized from its true savanna dimension in metres
// × M_UNIT, so the size RELATIONSHIPS match the real world: a 1.4 m-tall
// zebra stays dwarfed by a 10 m acacia, a 5 m quiver tree sits between
// them, etc. Raising M_UNIT makes the whole diorama's contents read
// bigger on the table WITHOUT disturbing those proportions. Sizing every
// object off one metre-based source (not per-object magic scales) is
// what keeps the proportions honest.
export const M_UNIT = 1.5;

// Hard roaming bounds for animals: half a body-length in from the table
// frame, so even the elephant (≈11.5 units long) never pokes past it.
export const ANIMAL_BX = WORLD_W * 0.5 - 8;
export const ANIMAL_BZ = WORLD_D * 0.5 - 8;

// Savanna waterholes. Each carves a basin into the terrain and gets a
// dark, rippling water surface sized to fit that basin.
export const LAKES = [
  { x: -108, z: 72, r: 92, depth: 5.5, base: -3.0 },
  { x: 492, z: -258, r: 60, depth: 4.5, base: -2.2 },
];
for (const lake of LAKES) lake.waterY = lake.base - 0.5;

// Irregular shoreline: per-angle radius wobble shared by the terrain
// basin and the water surface so they always stay in register.
export function lakeRadiusAt(lake, angle) {
  return (
    lake.r *
    (1 +
      0.11 * Math.sin(3 * angle + lake.x * 0.01) +
      0.06 * Math.sin(7 * angle + lake.z * 0.013))
  );
}

export const DEG = Math.PI / 180;

// Render layers: two independent lighting worlds (map vs room) — a light
// only illuminates objects sharing its layer, so they never bleed.
export const L_MAP = 1;
export const L_ROOM = 2;

// Room dimensions, shared by geometry, lighting, and the free-fly cam.
export const ROOM = { FLOOR_Y: -190, RX: 3400, RZ: 2800, CEIL: 1700 };

export const params = new URLSearchParams(window.location.search);
export const isRigCloseup = params.has("rigCloseup");

export const PERF = {
  // Apple Maps / Google Earth model: when far, drop DETAIL (object LOD),
  // not pixels. Pixel ratio is STABLE per zoom tier — it only steps once
  // when you cross a tier boundary, never frame-to-frame. (Re-tuning the
  // pixel ratio per-frame by frame-time is the three.js community's
  // documented anti-pattern: the resolution shimmers / smears.)
  nearPixelRatio: Number(params.get("nearPr") || Math.min(window.devicePixelRatio || 1, 1.75)),
  midPixelRatio: Number(params.get("midPr") || Math.min(window.devicePixelRatio || 1, 1.5)),
  // far = the zoomed-out ROOM view: same tier as mid so the study's PBR
  // materials stay crisp when you pull back to look at it (the map's
  // heavy detail is LOD-hidden out there, so the budget allows it).
  farPixelRatio: Number(params.get("farPr") || Math.min(window.devicePixelRatio || 1, 1.5)),
  minPixelRatio: 0.75,
  nearDist: Number(params.get("nearDist") || 320),
  midDist: Number(params.get("midDist") || 780),
};
