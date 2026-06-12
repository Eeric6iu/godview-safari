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

This is a static site. Run any local static server from the project root:

```bash
python3 -m http.server 3101
```

Then open:

```text
http://localhost:3101
```

For another device on the same Wi-Fi, use the computer's LAN IP:

```text
http://YOUR_LAN_IP:3101
```

## Project Structure

```text
index.html        Page shell, import map, UI controls
styles/           UI styling
src/              Three.js scene, camera, simulation, animals, room
assets/           Models, textures, and environment assets
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
