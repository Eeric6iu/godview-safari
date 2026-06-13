import { defineConfig } from "vite";

// Static Three.js diorama, bundled by Vite.
export default defineConfig(({ command }) => ({
  // base: dev MUST use an absolute "/". Vite's client (HMR/reload) and the
  //   entry-module resolution misbehave under a relative base in SERVE mode
  //   — the symptom is a reload loop that restarts boot before it finishes.
  //   The BUILD keeps a relative "./" base, so the output runs unchanged
  //   from ANY path: the GitHub Pages project subpath (/godview-safari/)
  //   today, a root or custom domain later, with no config edit. Runtime
  //   "assets/…" string paths (GLTFLoader / TextureLoader) resolve against
  //   the document URL, so they ride this relative base automatically.
  base: command === "build" ? "./" : "/",

  // Pre-bundle three AND the addon entry points up front. Otherwise Vite
  // discovers three/addons/* lazily as deep modules import them (GLTFLoader
  // in room/animals/vegetation, SkeletonUtils, BufferGeometryUtils),
  // re-optimizes, and fires a full page reload on each discovery — which
  // kept restarting the boot sequence mid-flight.
  optimizeDeps: {
    include: [
      "three",
      "three/addons/loaders/GLTFLoader.js",
      "three/addons/utils/SkeletonUtils.js",
      "three/addons/utils/BufferGeometryUtils.js",
    ],
  },

  // Assets live in public/ (public/assets/…); Vite copies that tree verbatim
  // into dist/, keeping the .gltf → .bin/texture relative refs intact.
  build: {
    // es2022 = top-level await support. main.js awaits its asset loads at
    // the module top level (await createRoomAndTable(), createWater(), …),
    // which needs a 2022+ target. The older "modules" default includes
    // Safari 14 and would only TOLERATE (not lower) the TLA — silently
    // breaking the whole boot path on those engines.
    target: "es2022",
    // three + the merged geometry bundle to one large chunk; the default
    // 500 kB warning is just noise for a 3D app.
    chunkSizeWarningLimit: 2000,
  },
}));
