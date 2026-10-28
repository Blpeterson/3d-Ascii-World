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

Then open <http://127.0.0.1:8000>. The Node launcher also prints one or more LAN URLs. Anyone on the same network can join by opening that `http://YOUR-IP:8000` address in a browser. Windows may ask you to allow Node.js through the private-network firewall.

Multiplayer uses the Node launcher's built-in WebSocket relay and does not require packages. The Python launcher delegates to Node when available and clearly labels its static fallback otherwise.

## Controls

- **WASD** — move / drive; in the helicopter W/S flies and A/D yaws
- **Mouse** — look
- **V** — switch first-person / third-person camera
- **Mouse** — natural vertical look with an expanded up/down range
- **Double-tap W, then hold** — sprint on foot
- **Shift** — sneak/crouch on foot; descend in the helicopter
- **Space** — jump / handbrake / helicopter collective up
- **Hold C + Mouse** — temporarily free-orbit the third-person truck/helicopter camera
- **E** — enter or exit the truck or helicopter
- **Escape** — release the mouse and pause

The world is coordinate-seeded rather than stored, so it has no fixed edge and revisiting a block reconstructs the same buildings.

Every connected player receives a nearby personal truck and helicopter. Players, shirts, pants, shoes, trucks, and helicopters use a consistent per-player color style and are visible from either camera mode.

Driving in first-person includes a windshield frame, live rear-view mirror, instruments, hood, and a steering wheel that follows the front-wheel input. The helicopter has a separate cockpit, rotor/altitude/heading instruments, animated world-space rotors, and can land on generated rooftops. Roughly 18% of buildings receive a brown exterior ladder: walk into it to climb, or release movement to descend slowly while holding on.

In third person, occupied vehicles use a smooth trailing chase camera. Hold **C** while moving the mouse for free orbit; release it to flow back behind the vehicle. This avoids browser-level Ctrl+W shortcuts while driving forward. Walking and sprinting can leave roof edges; hold **Shift** to sneak, crouch, and gain Minecraft-style ledge protection. Automatic stuck recovery still prevents wall clipping during falls.
