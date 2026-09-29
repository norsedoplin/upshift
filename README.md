# UpShift

A minimalist, low-poly manual car sim that runs in the browser. Sit in the cockpit, find the clutch bite point by feel (controller rumble), and shift through the gears.

**Play:** https://norsedoplin.github.io/upshift/ (Chrome or Edge recommended for controller rumble)

## Controls

| Action | DualSense / Xbox | Keyboard |
|---|---|---|
| Clutch | L2 / LT | Space (hold Shift to let it out slowly) |
| Gas | R2 / RT | W |
| Brake | Right stick down | S |
| Steer | Left stick | A / D |
| Shift up / down | R1 / L1 | E / Q |
| Ignition | △ / Y | I |
| Handbrake | ✕ / A | X |
| Reset | Options | R |
| Debug overlay | D-pad up | ` |

## Development

```sh
npm install
npm run dev     # local dev server
npm test        # drivetrain simulation tests
npm run build   # production build into dist/
```

Pushing to `main` builds and deploys to GitHub Pages automatically.

## How it works

- `src/sim/car.ts`: the drivetrain. Engine torque curve and idle controller, a friction clutch with a slip/lock state, gearbox, and the car's longitudinal motion, stepped at 1000 Hz.
- `src/haptics.ts`: controller rumble. It follows the energy dissipated in the slipping clutch, so the bite point, lugging and stalls come out of the physics.
- `src/audio.ts`: synthesized engine sound driven by rpm and load.
- `src/world.ts`: low-poly terrain, road with a hill, and the cockpit.
