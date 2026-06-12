// Shared material "tokens": one PBR loader and a handful of cached,
// reusable materials. Every tree, room surface and prop calls these
// instead of building its own copies — change a texture here, the whole
// scene follows (and caches keep the GPU upload count flat).
import * as THREE from "three";

export function material(color, roughness) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
  });
}

// Loads a Poly Haven PBR texture set (sRGB diffuse + GL normal +
// optional roughness), tiled rx × ry. Textures stream in async.
let _roomTexLoader;
export function pbrTex(file, rx, ry, srgb) {
  _roomTexLoader = _roomTexLoader || new THREE.TextureLoader();
  const t = _roomTexLoader.load("assets/polyhaven/room/" + file);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 16;
  return t;
}

export function pbrMaterial(base, rx, ry, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: pbrTex(base + (opts.diffSuffix || "_diff_2k.jpg"), rx, ry, true),
    normalMap: pbrTex(base + "_nor_gl_2k.jpg", rx, ry, false),
    roughness: opts.roughness ?? 0.8,
    metalness: 0,
  });
  if (opts.rough) {
    mat.roughnessMap = pbrTex(base + "_rough_2k.jpg", rx, ry, false);
    mat.roughness = 1;
  }
  if (mat.normalMap) {
    const n = opts.normalScale ?? 1.15;
    mat.normalScale.set(n, n);
  }
  mat.envMapIntensity = opts.envMapIntensity ?? 0.55;
  return mat;
}

// Shared photo-textured materials for procedural trees: real pine
// bark on trunks, real dense-leaf photo on canopies. Cached so all
// trees share two materials (mergeVegetation groups by color).
let _barkCache;
export function treeBarkMat(tint = 0xffffff) {
  _barkCache = _barkCache || {};
  if (!_barkCache[tint]) {
    const m = new THREE.MeshStandardMaterial({
      map: pbrTex("pine_bark_diff_2k.jpg", 1.5, 1.5, true),
      normalMap: pbrTex("pine_bark_nor_gl_2k.jpg", 1.5, 1.5, false),
      roughness: 0.95,
      color: tint,
    });
    _barkCache[tint] = m;
  }
  return _barkCache[tint];
}

let _canopyCache;
let _brightLeafTex;
function brightLeafTexture() {
  // forest_leaves_03 is a DARK wet-forest-floor photo; brighten it
  // once on a canvas so canopies read sunlit instead of charred.
  if (_brightLeafTex) return _brightLeafTex;
  const tex = new THREE.Texture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  new THREE.ImageLoader().load(
    "assets/polyhaven/room/forest_leaves_03_diff_2k.jpg",
    (img) => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height);
      const a = px.data;
      for (let i = 0; i < a.length; i += 4) {
        a[i] = Math.min(255, a[i] * 2.5);
        a[i + 1] = Math.min(255, a[i + 1] * 2.4);
        a[i + 2] = Math.min(255, a[i + 2] * 1.9);
      }
      ctx.putImageData(px, 0, 0);
      tex.image = c;
      tex.needsUpdate = true;
    },
  );
  _brightLeafTex = tex;
  return tex;
}

export function treeCanopyMat(tint) {
  _canopyCache = _canopyCache || {};
  if (!_canopyCache[tint]) {
    _canopyCache[tint] = new THREE.MeshStandardMaterial({
      map: brightLeafTexture(),
      normalMap: pbrTex("forest_leaves_03_nor_gl_2k.jpg", 2, 2, false),
      roughness: 0.95,
      color: tint,
    });
  }
  return _canopyCache[tint];
}
