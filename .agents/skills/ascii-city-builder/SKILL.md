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
- Keep collision and rendering driven by the same `tileAt` result; visual geometry must not become passable, or invisible geometry solid.
- Camera features should read from `view`; gameplay physics should read and write `player` or `car`.
- Maintain both first- and third-person behavior when adding movement, vehicles, or camera effects.
- Write pixels only in `paint`. World and HUD code should write characters through `put`.

## Workflow

Inspect the relevant functions in `game.js`, make the smallest cohesive change, then run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/validate.ps1
```

For visual or control changes, launch the game and verify pointer lock, both cameras, walking, jumping, car entry/exit, collision, and driving. Treat the validator as a fast gate, not a replacement for play-testing.

If a local test server is started, stop it before finishing the task and verify that its process or listener has ended.
