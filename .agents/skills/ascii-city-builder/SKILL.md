---
name: ascii-city-builder
description: Build, extend, debug, or verify the Endless City procedural 3D ASCII game in this workspace. Use for renderer, world generation, movement, driving, camera, UI, and performance changes to this project.
---

# Endless City Builder

Preserve the game's core identity: the visible world is a character-cell buffer rendered on canvas, and city geometry is computed deterministically from world coordinates rather than stored as a finite map.

## Project map

- `game.js`: simulation, deterministic city generator, raycaster, character buffer, cameras, input, driving.
- `index.html` and `style.css`: shell, start screen, and presentation.
- `server.mjs` and `server.py`: dependency-free local launchers.
- `tools/validate.ps1`: fast static validation.

## Working invariants

- Keep launch dependency-free with Node or Python's standard library.
- New world features must derive from stable coordinate hashes so revisited locations do not change.
- Keep neighborhood bands deterministic and at least three city blocks wide. Low-rise, mixed, and skyscraper districts should alter height distributions without breaking the global 4.4-unit minimum.
- Keep generated building height at or above `4.4` world units unless the user explicitly changes the scale contract.
- Keep collision and rendering driven by the same `tileAt` result; visual geometry must not become passable, or invisible geometry solid.
- Camera features should read from `view`; gameplay physics should read and write `player` or `car`.
- Maintain both first- and third-person behavior when adding movement, vehicles, or camera effects.
- The truck and helicopter are separate world-space vehicles. Helicopter landing height must come from `tileAt`, animated rotors remain cuboid geometry, and its first-person cockpit uses helicopter-specific instruments.
- Third-person cameras remain centered on the character head or occupied vehicle target. Keep orbit yaw/pitch separate from actor heading. Use a bounded game-style boom: yaw circles the target, pitch changes camera height without collapsing horizontal distance, and 3D collision is the only reason to shorten the boom.
- Allow the third-person boom to rise into a high overhead view while retaining its target lock and collision shortening.
- Project vertical world positions through `projectWorldHeight`; do not simulate camera pitch by shifting the horizon or screen-space models.
- Keep the camera rectilinear: space columns evenly across the camera plane, derive yaw offsets with `atan`, and derive vertical focal length from horizontal FOV plus character-cell aspect ratio. Even angular spacing produces cylindrical bowing on nearby buildings.
- Preserve tower presence near a straight-up first-person view with the smooth upward-only vertical-FOV expansion. Recompute row ray scales from the active focal length each frame so walls, ground, roofs, and facade sampling remain aligned.
- Sample facade patterns through `unprojectScreenHeight` using absolute world height; linear screen-row interpolation visibly stretches windows and textures under pitch.
- Use camera-basis rays for ground and roof sampling near vertical look angles so screen rays never flip behind the camera.
- Render building walls, layered background walls, and roof surfaces into per-cell scene depth so nearer geometry occludes farther geometry without hiding taller structures above it.
- Preserve the bounded tile cache, precomputed screen-ray tables, per-row pitch calculation, and coarse roof sampling; these prevent procedural hashing and roof DDA from dominating each frame.
- Tune third-person model size with chase distance before changing world geometry, because model dimensions also define collision and spatial relationships.
- Write pixels only in `paint`. World and HUD code should write characters through `put`.

## Workflow

Inspect the relevant functions in `game.js`, make the smallest cohesive change, then run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/validate.ps1
```

For visual or control changes, launch the game and verify pointer lock, both cameras, walking, jumping, car entry/exit, collision, and driving. Treat the validator as a fast gate, not a replacement for play-testing.

If a local test server is started, stop it before finishing the task and verify that its process or listener has ended.
