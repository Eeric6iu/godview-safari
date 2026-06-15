# Godview Safari

Godview Safari is a realtime Three.js living diorama: a tabletop safari map viewed from above, surrounded by a dark warm study room.

The scene combines animated animal herds, procedural terrain, PBR room materials, warm interior lighting, day/night controls, and Apple Maps-style camera movement.

## Live Demo

GitHub Pages URL:

```text
https://eeric6iu.github.io/godview-safari/
```

## Features

- Realtime Three.js rendering in the browser
- Animated safari herds with multiple animal species
- Tabletop map inside a dark wood study room
- Warm interior lamps and fireplace-style lighting
- PBR textures for floor, wall panels, leather, wood, and terrain
- Interactive camera controls for pan, zoom, tilt, and rotation
- Day/night simulation with x1, x4, and x8 speed controls
- Responsive browser-based experience with no backend server

## Local Run

Use Vite for local development:

```bash
cd /Users/eeric6iu/Desktop/three-safari-herd-demo
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:3101/
```

`npm install` is only needed once, or after dependencies change.

The dev server is pinned to port `3101`. If that port is already occupied,
Vite fails clearly instead of silently moving to another port.

For another device on the same Wi-Fi:

```bash
npm run dev:lan
```

Then open:

```text
http://YOUR_LAN_IP:3101/
```

Vite is the only supported local server and build tool for this project.

Production build:

```bash
npm run build
```

## Project Structure

```text
index.html        Page shell and Vite entry
styles/           UI styling
src/              Three.js scene, camera, simulation, animals, room
public/assets/    Models, textures, and environment assets
```

## Deployment

The project is designed to run as a static website.

Recommended free deployment path for this version:

```text
GitHub Pages
```

The current asset set is large for a static demo. For a larger production version, move large GLB/BIN/texture files to object storage such as Cloudflare R2 and keep the website shell on Cloudflare Pages or another static host.

## Asset Notes

This repository includes third-party models and texture assets used for the visual prototype. Each asset keeps its original license and attribution requirements from its source.

No project-wide reuse license has been granted yet. Do not assume the code, models, or textures can be reused in another project without checking the asset sources and adding an explicit license.
