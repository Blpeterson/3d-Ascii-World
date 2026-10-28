# Endless // City

A self-generating 3D ASCII city. The renderer draws every frame as a grid of text characters, while a deterministic procedural generator creates streets, alleys, parks, and buildings around the player forever.

## Play

Run with Node.js (the verified launcher):

```powershell
node server.mjs
```

Or, if Python is installed:

```powershell
python server.py
```

Then open <http://127.0.0.1:8000> if it does not open automatically.

## Controls

- **WASD** — move / drive; in the helicopter W/S flies and A/D yaws
- **Mouse** — look
- **V** — switch first-person / third-person camera
- **Mouse** — natural vertical look with an expanded up/down range
- **Shift** — sprint
- **Space** — jump / handbrake / helicopter collective up
- **Ctrl** — helicopter collective down
- **E** — enter or exit the truck or helicopter
- **Escape** — release the mouse and pause

The world is coordinate-seeded rather than stored, so it has no fixed edge and revisiting a block reconstructs the same buildings.

Driving in first-person includes a windshield frame, live rear-view mirror, instruments, hood, and a steering wheel that follows the front-wheel input. The helicopter has a separate cockpit, rotor/altitude/heading instruments, animated world-space rotors, and can land on generated rooftops. The city is grouped into deterministic multi-block low-rise, mixed, and skyscraper districts.
