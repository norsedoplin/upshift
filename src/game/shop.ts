// Buying and equipping cars and paints. Pure functions over Progress so they can be tested.

import { CARS, PAINTS, carById, paintById } from '../cars';
import type { Progress } from './progress';

export function ownsPaint(p: Progress, paintId: string) {
  return paintById(paintId).price === 0 || p.ownedPaints.includes(paintId);
}

export function ownsCar(p: Progress, carId: string) {
  return p.ownedCars.includes(carId);
}

export function paintFor(p: Progress, carId: string) {
  const chosen = p.paintByCar[carId];
  if (chosen && ownsPaint(p, chosen)) return paintById(chosen);
  return paintById(carById(carId).defaultPaint);
}

export type ShopResult = 'bought' | 'equipped' | 'too-poor' | 'unknown';

/** Select a car, buying it first if needed and affordable. */
export function chooseCar(p: Progress, carId: string): ShopResult {
  const car = CARS.find((c) => c.id === carId);
  if (!car) return 'unknown';
  if (!ownsCar(p, carId)) {
    if (p.creds < car.price) return 'too-poor';
    p.creds -= car.price;
    p.ownedCars.push(carId);
    p.car = carId;
    return 'bought';
  }
  p.car = carId;
  return 'equipped';
}

/** Put a paint on the current car, buying it first if needed and affordable. */
export function choosePaint(p: Progress, paintId: string): ShopResult {
  const paint = PAINTS.find((x) => x.id === paintId);
  if (!paint) return 'unknown';
  let result: ShopResult = 'equipped';
  if (!ownsPaint(p, paintId)) {
    if (p.creds < paint.price) return 'too-poor';
    p.creds -= paint.price;
    p.ownedPaints.push(paintId);
    result = 'bought';
  }
  p.paintByCar[p.car] = paintId;
  return result;
}
