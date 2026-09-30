# UpShift

A minimalist, low-poly manual car sim that runs in the browser. Sit in the cockpit and drive a mountain touge, finding the clutch bite point by feel (controller rumble).

You score for driving well, not fast: clean, rev-matched shifts build a combo, heel-toe downshifts earn a bonus, and stalls, grinds, money shifts and rail hits cost points. The skill score becomes creds at the finish line.

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
| Restart run | Options | R |
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
- `src/sim/chassis.ts`: steering and cornering. A bicycle model with Pacejka-style tyres, weight transfer, a friction circle shared with braking and drive, ABS/EBD and a handbrake.
- `src/track/touge.ts`: the procedural mountain road (seeded, tested to never cross itself); `scenery.ts` builds terrain, rails and trees around it; `collide.ts` keeps the car between the rails.
- `src/game/scoring.ts`: the skill score. Grades each gear change on rev match, jerk, clutch wear and speed; `progress.ts` stores creds in the browser.
- `src/haptics.ts`: controller rumble. It follows the energy dissipated in the slipping clutch, so the bite point, lugging and stalls come out of the physics.
- `src/audio.ts`: synthesized engine sound driven by rpm and load.
- `src/cockpit.ts`: the interior, gauges and camera.
