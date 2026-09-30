// All menus: title, main, garage (shop), settings, pause and the run summary.
// Built from plain DOM, driven by mouse/keyboard or the controller (D-pad/stick, ✕ select, ○ back).

import { CARS, PAINTS, carById, type CarModel } from '../cars';
import type { MenuNav } from '../input';
import {
  ACTIONS,
  ACTION_LABELS,
  assignKey,
  assignPad,
  defaultBindings,
  keysLabel,
  padLabel,
  type Action,
  type PadInput,
} from '../bindings';
import type { Progress, Settings } from '../game/progress';
import { CHASE_DISTS, CHASE_HEIGHTS, GRAPHICS_QUALITIES, MOUSE_TRAVELS, RETRO_LOOKS, SPEEDO_MODES, TIMES_OF_DAY, saveProgress } from '../game/progress';
import { PARTS, clutchWillSlip, fitPart, ownedLevel, peakPower, peakTorque, specFor, tuneFor, tunedSpec, type Tune } from '../game/tuning';
import { MAPS, mapById, mapStats, outlinePath, roadFor } from '../track/maps';
import { chooseCar, choosePaint, ownsCar, ownsPaint, paintFor } from '../game/shop';
import type { RunStats } from '../game/scoring';

const SETTINGS_TABS = ['Controller', 'View', 'Game'] as const;

export type Screen = 'title' | 'main' | 'garage' | 'settings' | 'controls' | 'pause' | 'summary' | 'help' | 'maps' | 'tune';

/** Screens with the navigation bar across the top. */
const NAV_SCREENS: Screen[] = ['main', 'garage', 'settings', 'controls', 'help', 'maps', 'tune'];
const TIME_LABELS = ['Day cycle', 'Morning', 'Noon', 'Sunset', 'Night'];

interface Item {
  el: HTMLElement;
  row: number;
  col: number;
  confirm?: () => void;
  left?: () => void;
  right?: () => void;
  focus?: () => void;
}

export interface MenuHooks {
  start(): void; // first interaction: unlock audio
  drive(): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  carChanged(): void;
  settingsChanged(): void;
  mapChanged(): void; // a different road was picked; the world has to be rebuilt
  preview(car: CarModel | null, paint: string | null): void; // garage showroom
  testRumble(): Promise<string>;
  startCapture(kind: 'pad' | 'key'): void;
  pollCapture(): { pad?: PadInput; key?: string } | 'cancel' | null;
  cancelCapture(): void;
  dualSense(): { supported: boolean; label: string; connect(): Promise<string> };
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

export class Menus {
  screen: Screen | null = 'title';
  private root: HTMLElement;
  private items: Item[] = [];
  private focusIndex = 0;
  private settingsReturn: Screen = 'main';
  private garageReturn: Screen = 'main';
  private controlsReturn: Screen = 'settings';
  private lastSummary: { stats: RunStats; earned: number; best: boolean; time: string } | null = null;
  private status = '';
  private rumbleResult = '';
  private settingsTab = 0;
  private capturing: { action: Action; kind: 'pad' | 'key' } | null = null;
  // Swallow input for one frame after a screen change, so one press can't act twice.
  private settle = false;
  /** Tuning levels being looked at (not bought or fitted yet), per part. */
  private tunePreview: Tune = {};
  // Where the mouse last really was. Redrawing a screen puts new rows under a resting
  // pointer and the browser fires hover events for them; those mustn't steal focus.
  private mouseAt = { x: NaN, y: NaN };
  private mouseMoved = false;

  constructor(
    private progress: Progress,
    private hooks: MenuHooks,
  ) {
    this.root = h('div');
    this.root.id = 'menus';
    document.body.appendChild(this.root);
    this.render();
    const begin = () => {
      if (this.screen === 'title') {
        this.hooks.start();
        this.open('main');
      }
    };
    this.root.addEventListener('click', (e) => {
      if (this.screen === 'title') begin();
      e.stopPropagation();
    });
    window.addEventListener('keydown', (e) => {
      if (this.screen === 'title' && !e.repeat) begin();
    });
    window.addEventListener('mousemove', (e) => {
      if (e.screenX === this.mouseAt.x && e.screenY === this.mouseAt.y) return;
      this.mouseAt = { x: e.screenX, y: e.screenY };
      this.mouseMoved = true;
    }, true); // capture, so this runs before the rows' own handlers
  }

  get isOpen() {
    return this.screen !== null;
  }

  open(screen: Screen | null) {
    if (screen === 'garage' && this.screen && this.screen !== 'garage' && this.screen !== 'settings' && this.screen !== 'tune') this.garageReturn = this.screen;
    if (screen === 'tune') this.tunePreview = {};
    if (screen === 'settings' && this.screen && this.screen !== 'settings' && this.screen !== 'controls') this.settingsReturn = this.screen;
    if (screen === 'controls' && this.screen && this.screen !== 'controls') this.controlsReturn = this.screen;
    if (this.capturing) {
      this.capturing = null;
      this.hooks.cancelCapture();
    }
    const showsCar = (x: Screen | null) => x === 'garage' || x === 'tune';
    if ((this.screen === 'main' || showsCar(this.screen)) && screen !== this.screen && !(showsCar(this.screen) && showsCar(screen))) this.hooks.preview(null, null);
    this.screen = screen;
    this.status = '';
    this.settle = true;
    // In the garage, start on the car you're driving.
    this.focusIndex = screen === 'garage' ? Math.max(0, CARS.findIndex((c) => c.id === this.progress.car)) : 0;
    this.render();
  }

  showSummary(stats: RunStats, earned: number, best: boolean, time: string) {
    this.lastSummary = { stats, earned, best, time };
    this.open('summary');
  }

  /** Per-frame controller/keyboard handling while a menu is open. */
  update(nav: MenuNav) {
    if (!this.screen) return;
    if (this.settle) {
      this.settle = false;
      return;
    }
    if (this.capturing) {
      this.pollCapture();
      return;
    }
    if (this.screen === 'title') {
      if (nav.confirm || nav.pause) {
        this.hooks.start();
        this.open('main');
      }
      return;
    }
    const cur = this.items[this.focusIndex];
    if (nav.up || nav.down) this.move(nav.up ? -1 : 1, 0);
    if (nav.left) cur?.left ? cur.left() : this.move(0, -1);
    if (nav.right) cur?.right ? cur.right() : this.move(0, 1);
    if (nav.confirm) this.items[this.focusIndex]?.confirm?.();
    if (nav.back || (nav.pause && this.screen === 'pause')) this.back();
    if ((nav.tabPrev || nav.tabNext) && this.screen === 'settings') this.switchTab(nav.tabNext ? 1 : -1);
  }

  private switchTab(d: number) {
    this.settingsTab = (this.settingsTab + d + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    this.render();
    // Land on the first setting of the new section rather than the tab strip.
    const first = this.items.findIndex((it) => it.row === 1);
    if (first >= 0) this.setFocus(first);
  }

  back() {
    switch (this.screen) {
      case 'pause':
        this.hooks.resume();
        break;
      case 'settings':
        this.open(this.settingsReturn);
        break;
      case 'controls':
        if (this.controlsReturn !== 'settings') {
          this.open(this.controlsReturn);
          break;
        }
        this.settingsTab = 0;
        this.open('settings');
        this.focusOnLabel('Controls›');
        break;
      case 'garage':
        this.open(this.garageReturn);
        break;
      case 'summary':
        this.hooks.restart();
        break;
      case 'help':
        this.open('main');
        break;
      case 'maps':
        this.open('main');
        break;
      case 'tune':
        this.open('garage');
        break;
      default:
        break;
    }
  }

  private move(dr: number, dc: number) {
    if (!this.items.length) return;
    const cur = this.items[this.focusIndex];
    let best = -1;
    let bestScore = Infinity;
    this.items.forEach((it, i) => {
      if (i === this.focusIndex) return;
      if (dr !== 0) {
        const d = (it.row - cur.row) * dr;
        if (d <= 0) return;
        const score = d * 100 + Math.abs(it.col - cur.col);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      } else if (it.row === cur.row) {
        const d = (it.col - cur.col) * dc;
        if (d <= 0) return;
        if (d < bestScore) {
          bestScore = d;
          best = i;
        }
      }
    });
    if (best >= 0) this.setFocus(best);
  }

  private setFocus(i: number) {
    this.items[this.focusIndex]?.el.classList.remove('focus');
    this.focusIndex = i;
    const it = this.items[i];
    it.el.classList.add('focus');
    it.el.scrollIntoView({ block: 'nearest' });
    it.focus?.();
  }

  private add(el: HTMLElement, row: number, col: number, opts: Omit<Item, 'el' | 'row' | 'col'> = {}) {
    const item: Item = { el, row, col, ...opts };
    const index = this.items.length;
    this.items.push(item);
    el.addEventListener('mousemove', () => {
      // Only a pointer that has actually moved picks the row under it.
      if (!this.mouseMoved || this.focusIndex === index) return;
      this.setFocus(index);
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setFocus(index);
      item.confirm?.();
    });
    return item;
  }

  private button(label: string, row: number, onConfirm: () => void, cls = 'menu-btn') {
    const b = h('button', cls, label);
    this.add(b, row, 0, { confirm: onConfirm });
    return b;
  }

  render() {
    this.mouseMoved = false;
    this.root.innerHTML = '';
    this.items = [];
    this.root.className = this.screen ? `screen-${this.screen}` : 'hidden';
    if (!this.screen) return;
    const panel = h('div', 'menu-panel');
    this.root.appendChild(panel);
    switch (this.screen) {
      case 'title':
        this.renderTitle(panel);
        break;
      case 'main':
        this.renderMain(panel);
        break;
      case 'garage':
        this.renderGarage(panel);
        break;
      case 'settings':
        this.renderSettings(panel);
        break;
      case 'controls':
        this.renderControls(panel);
        break;
      case 'pause':
        this.renderPause(panel);
        break;
      case 'summary':
        this.renderSummary(panel);
        break;
      case 'help':
        this.renderHelp(panel);
        break;
      case 'maps':
        this.renderMaps(panel);
        break;
      case 'tune':
        this.renderTune(panel);
        break;
    }
    // The bar's items go in last so each screen's own items keep their indices.
    if (NAV_SCREENS.includes(this.screen)) this.root.prepend(this.navBar());
    if (this.items.length) this.setFocus(Math.min(this.focusIndex, this.items.length - 1));
  }

  private credsLine() {
    return h('div', 'creds-pill', `◆ ${this.progress.creds.toLocaleString()} creds`);
  }

  private renderTitle(panel: HTMLElement) {
    panel.append(
      h('h1', 'logo', 'UpShift'),
      h('p', 'tag', 'A manual car on a mountain road.'),
      h('p', 'muted', 'Score for driving well, not fast. Clean, rev-matched shifts build your combo; heel-toe downshifts earn bonuses; stalls, grinds and rail hits cost you.'),
      h('p', 'press', 'Click, press a key or ✕ to start'),
      h('p', 'fine', 'Chrome or Edge recommended for controller rumble.'),
    );
  }

  /** Logo, the three main sections, and your creds, across the top of the screen. */
  private navBar() {
    const bar = h('div', 'nav-bar');
    const logo = h('div', 'nav-logo', 'UpShift');
    const tabs = h('div', 'nav-tabs');
    const sections: [string, Screen][] = [
      ['Drive', 'main'],
      ['Garage', 'garage'],
      ['Settings', 'settings'],
    ];
    const active = this.screen === 'controls' ? 'settings' : this.screen === 'help' || this.screen === 'maps' ? 'main' : this.screen === 'tune' ? 'garage' : this.screen;
    sections.forEach(([label, screen], i) => {
      const t = h('div', `menu-btn nav-tab${screen === active ? ' active' : ''}`, label);
      this.add(t, -1, i, { confirm: () => screen !== this.screen && this.open(screen) });
      tabs.append(t);
    });
    const p = this.progress;
    const chip = h('div', 'nav-chip');
    const car = carById(p.car);
    chip.append(h('span', 'chip-car', car.name), h('span', 'chip-best', `Best ${p.bestScore.toLocaleString()}`), h('b', 'chip-creds', `◆ ${p.creds.toLocaleString()}`));
    bar.append(logo, tabs, chip);
    return bar;
  }

  /** A big clickable card: a small label, a title, a line under it and an optional call to action. */
  private tile(cls: string, label: string, title: string, sub: string, row: number, col: number, opts: Omit<Item, 'el' | 'row' | 'col'>, cta?: string) {
    const el = h('div', `menu-btn tile ${cls}`);
    el.append(h('span', 'tile-label', label), h('span', 'tile-title', title), h('span', 'tile-sub', sub));
    if (cta) el.append(h('span', 'tile-cta', cta));
    this.add(el, row, col, opts);
    return el;
  }

  /** The main menu's canvas for the turning car, if it's showing. */
  rideCanvas(): HTMLCanvasElement | null {
    return this.screen === 'main' ? this.root.querySelector<HTMLCanvasElement>('canvas.ride-view') : null;
  }

  private renderMain(panel: HTMLElement) {
    const p = this.progress;
    const st = p.settings;
    const car = carById(p.car);
    const paint = paintFor(p, car.id);
    panel.className = 'menu-hub';
    this.hooks.preview(car, paint.color);

    const grid = h('div', 'hub-grid');
    // Items are added in focus order: the hero first, so it's where the cursor starts.
    const map = mapById(st.map);
    const hero = this.tile('hero', 'Touge run', map.name, map.blurb, 0, 1, { confirm: () => this.hooks.drive() }, "Let's drive  ›");
    hero.prepend(h('div', 'hero-art'));
    const mapTile = this.tile('map', 'Map', 'Pick a road', `${MAPS.length} roads · ${map.name} now`, 0, 2, { confirm: () => this.open('maps') }, 'Choose  ›');
    mapTile.prepend(this.mapOutline(map.id, 'map-art'));

    const ride = h('div', 'menu-btn tile ride');
    ride.append(h('span', 'tile-label', 'Your ride'), h('canvas', 'ride-view'));
    const info = h('div', 'ride-info');
    info.append(h('span', 'tile-title', car.name), h('span', 'tile-sub', `${car.stats.drive} · ${Object.keys(car.spec.gears).length - 1}-speed · ${paint.name}`));
    ride.append(info, h('span', 'tile-cta', 'Customize  ›'));
    const rideItem = this.add(ride, 0, 0, { confirm: () => this.open('garage') });
    const toRide = () => this.setFocus(this.items.indexOf(rideItem));

    const garage = this.tile('garage', 'Garage', 'Cars and paint', `${p.ownedCars.length} of ${CARS.length} cars owned`, 1, 1, { confirm: () => this.open('garage'), left: toRide });
    const ti = TIMES_OF_DAY.indexOf(st.timeOfDay);
    const setTime = (i: number) => {
      st.timeOfDay = TIMES_OF_DAY[(i + TIMES_OF_DAY.length) % TIMES_OF_DAY.length];
      saveProgress(p);
      this.hooks.settingsChanged();
      this.rerenderKeepingFocus();
    };
    const time = this.tile('time', 'Time of day', `‹ ${TIME_LABELS[ti]} ›`, 'Left and right to change', 1, 2, {
      left: () => setTime(ti - 1),
      right: () => setTime(ti + 1),
      confirm: () => setTime(ti + 1),
    });
    const controls = this.tile('controls', 'Controls', 'Buttons and keys', 'Rebind anything', 2, 1, { confirm: () => this.open('controls'), left: toRide });
    const help = this.tile('help', 'Lessons', 'How to drive stick', 'Bite point, rev-matching, heel-toe', 2, 2, { confirm: () => this.open('help') });
    grid.append(ride, hero, mapTile, garage, time, controls, help);

    const foot = h('div', 'hub-foot');
    foot.append(
      h('span', undefined, 'UpShift · a manual car on a mountain road'),
      h('span', undefined, '✕ / Enter select · ○ / Esc back · D-pad or stick to move'),
      h('span', undefined, `${p.runs} run${p.runs === 1 ? '' : 's'} driven`),
    );
    panel.append(grid, foot);
  }

  private renderPause(panel: HTMLElement) {
    panel.className = 'menu-hub pause-hub';
    const grid = h('div', 'hub-grid pause-grid');
    const head = h('div', 'pause-head');
    head.append(h('span', 'tile-label', 'Paused'), h('span', 'pause-car', carById(this.progress.car).name));
    const resume = this.tile('hero', 'Keep going', 'Resume', 'Back on the road where you left it', 0, 0, { confirm: () => this.hooks.resume() }, 'Resume  ›');
    grid.append(
      resume,
      this.tile('restart', 'Run', 'Restart', 'Back to the lot at the start', 1, 0, { confirm: () => this.hooks.restart() }),
      this.tile('garage', 'Garage', 'Cars and paint', 'Swap car or colour', 1, 1, { confirm: () => this.open('garage') }),
      this.tile('controls', 'Settings', 'Settings', 'Controller, view and game', 2, 0, { confirm: () => this.open('settings') }),
      this.tile('help', 'Menu', 'Main menu', 'Leave this run', 2, 1, { confirm: () => this.hooks.toMenu() }),
    );
    panel.append(head, grid, this.controlsHint());
  }

  private renderHelp(panel: HTMLElement) {
    panel.append(h('h2', undefined, 'How to drive stick'));
    const lessons: [string, string][] = [
      ['Pulling away', 'Clutch all the way in, first gear, then let the clutch out slowly. Feel for the rumble (and, on a DualSense, the trigger pushing back): that is the bite point. Add a little gas as it bites.'],
      ['Shifting', 'Clutch in, change gear, clutch out. Lift off the gas while you shift. Smooth, quick changes build your combo.'],
      ['Rev-matching', 'Going down a gear, blip the gas with the clutch in so the revs rise to where the lower gear wants them. A match is a clean shift; a miss jolts the car.'],
      ['Heel-toe', 'Braking into a corner, keep braking while you blip the gas for the downshift. It earns the biggest bonus.'],
      ['Lots', 'The paved pull-offs along the road are for stopping, parking up and watching the sun go down. The clock keeps running, though.'],
      ['What costs points', 'Stalling, grinding a gear, and hitting the rails.'],
    ];
    const list = h('div', 'help-list');
    for (const [title, text] of lessons) {
      const card = h('div', 'help-card');
      card.append(h('b', undefined, title), h('p', undefined, text));
      list.append(card);
    }
    const back = h('div', 'menu-list');
    back.append(this.button('Back', 0, () => this.back()));
    panel.append(list, back);
  }

  /** The road seen from above, start marked in lime and the finish in white. */
  private mapOutline(id: string, cls: string) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', cls);
    const o = outlinePath(roadFor(id), 100);
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', o.d);
    const dot = (p: number[], c: string) => {
      const e = document.createElementNS(svgNS, 'circle');
      e.setAttribute('cx', String(p[0]));
      e.setAttribute('cy', String(p[1]));
      e.setAttribute('r', '3');
      e.setAttribute('class', c);
      return e;
    };
    svg.append(path, dot(o.end, 'finish'), dot(o.start, 'start'));
    return svg;
  }

  private renderMaps(panel: HTMLElement) {
    const st = this.progress.settings;
    panel.append(h('h2', undefined, 'Pick a road'));
    const list = h('div', 'map-list');
    MAPS.forEach((m, i) => {
      const road = roadFor(m.id);
      const s = mapStats(road);
      const here = m.id === st.map;
      const card = h('div', `menu-btn map-card${here ? ' current' : ''}`);
      const text = h('div', 'map-text');
      const best = this.progress.bestByMap[m.id];
      text.append(
        h('b', undefined, m.name),
        h('p', undefined, m.blurb),
        h('span', 'map-stats', `${s.km.toFixed(1)} km · ${Math.abs(Math.round(s.rise))} m ${s.rise > 0 ? 'climb' : 'drop'} · ${s.hairpins} hairpins`),
        h('span', 'map-best', best ? `Best ${best.toLocaleString()}` : 'Not driven yet'),
      );
      card.append(this.mapOutline(m.id, 'map-thumb'), text, h('span', 'map-badge', here ? 'Selected' : 'Pick'));
      this.add(card, Math.floor(i / 2), i % 2, {
        confirm: () => {
          if (here) return this.open('main');
          st.map = m.id;
          saveProgress(this.progress);
          card.querySelector('.map-badge')!.textContent = 'Loading…';
          // Let the label paint before the page reloads.
          setTimeout(() => this.hooks.mapChanged(), 30);
        },
      });
      list.append(card);
    });
    const back = h('div', 'menu-list');
    back.append(this.button('Back', Math.ceil(MAPS.length / 2), () => this.back()));
    panel.append(list, back);
    // Start on the road you're on.
    const cur = MAPS.findIndex((m) => m.id === st.map);
    if (cur >= 0) this.focusIndex = cur;
  }

  private renderSummary(panel: HTMLElement) {
    const s = this.lastSummary;
    if (!s) return;
    panel.append(h('p', 'tag', 'Run complete'), h('h1', 'big-score', s.stats.score.toLocaleString()));
    panel.append(h('p', 'muted', s.best ? 'New personal best' : `Best ${this.progress.bestScore.toLocaleString()}`));
    const earned = h('div', 'earned');
    earned.append(h('span', undefined, 'Creds earned'), h('b', undefined, `+${s.earned}`));
    panel.append(earned);
    const dl = h('dl', 'stats');
    const row = (k: string, v: string) => dl.append(h('dt', undefined, k), h('dd', undefined, v));
    row('Time', s.time);
    row('Gear changes', String(s.stats.shifts));
    row('Clean or perfect', String(s.stats.perfect + s.stats.clean));
    row('Heel-toe', String(s.stats.heelToe));
    row('Best combo', `×${(1 + Math.min(s.stats.bestCombo, 8) * 0.25).toFixed(2)}`);
    row('Stalls', String(s.stats.stalls));
    row('Flow points', (s.stats.flow ?? 0).toLocaleString());
    panel.append(dl);
    const list = h('div', 'menu-list');
    list.append(
      this.button('Run it again', 0, () => this.hooks.restart(), 'menu-btn primary'),
      this.button('Garage', 1, () => this.open('garage')),
      this.button('Main menu', 2, () => this.hooks.toMenu()),
    );
    panel.append(list);
  }

  private renderSettings(panel: HTMLElement) {
    const st = this.progress.settings;
    panel.append(h('h2', undefined, 'Settings'));
    const list = h('div', 'menu-list');
    const changed = () => {
      saveProgress(this.progress);
      this.hooks.settingsChanged();
      this.render();
    };
    const option = (label: string, row: number, values: string[], index: number, set: (i: number) => void) => {
      const el = h('div', 'menu-btn setting');
      const val = h('span', 'value');
      // Left/right stop at the ends; ✕ cycles round.
      const step = (d: number, wrap = false) => {
        const next = wrap ? (index + d + values.length) % values.length : Math.max(0, Math.min(values.length - 1, index + d));
        if (next === index) return;
        set(next);
        changed();
      };
      // The arrows are buttons too, so a mouse can go down as well as up.
      const arrow = (text: string, d: number) => {
        const a = h('i', 'arrow', text);
        a.addEventListener('click', (e) => {
          e.stopPropagation();
          step(d);
        });
        return a;
      };
      val.append(arrow('‹', -1), h('span', 'value-text', values[index]), arrow('›', 1));
      el.append(h('span', undefined, label), val);
      this.add(el, row, 0, { left: () => step(-1), right: () => step(1), confirm: () => step(1, true) });
      list.append(el);
    };
    const pct = [0, 0.25, 0.5, 0.75, 1];
    const pctLabels = ['Off', '25%', '50%', '75%', '100%'];
    const nearest = (v: number) => pct.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(pct[b] - v) ? i : b), 0);

    // Section tabs on row 0; L1/R1 (or Q/E) flip between them from anywhere on the screen.
    const tabs = h('div', 'tab-strip');
    SETTINGS_TABS.forEach((name, i) => {
      const t = h('div', `menu-btn tab${i === this.settingsTab ? ' active' : ''}`, name);
      this.add(t, 0, i, { confirm: () => this.switchTab(i - this.settingsTab) });
      tabs.append(t);
    });
    panel.append(tabs);

    let row = 1;
    const tab = SETTINGS_TABS[this.settingsTab];
    if (tab === 'Controller') {
      option('Controller rumble', row++, pctLabels, nearest(st.rumble), (i) => (st.rumble = pct[i]));
      const test = h('div', 'menu-btn setting');
      const result = h('span', 'value', this.rumbleResult || 'Press ✕');
      test.append(h('span', undefined, 'Test rumble'), result);
      this.add(test, row++, 0, {
        confirm: () => {
          result.textContent = '…';
          void this.hooks.testRumble().then((msg) => {
            this.rumbleResult = msg;
            result.textContent = msg;
          });
        },
      });
      list.append(test);
      const ds = this.hooks.dualSense();
      if (ds.supported) {
        // Chrome often can't rumble a DualSense through the Gamepad API, so offer a direct link.
        const link = h('div', 'menu-btn setting');
        const state = h('span', 'value', ds.label);
        link.append(h('span', undefined, 'DualSense rumble'), state);
        this.add(link, row++, 0, {
          confirm: () => {
            state.textContent = '…';
            void ds.connect().then((msg) => (state.textContent = msg));
          },
        });
        list.append(link);
        option('Clutch trigger feel', row++, ['On', 'Off'], st.clutchFeel ? 0 : 1, (i) => (st.clutchFeel = i === 0));
      }
      option('Mouse clutch', row++, ['Off', 'Short travel', 'Normal travel', 'Long travel'], Math.max(0, MOUSE_TRAVELS.indexOf(st.mouseClutch)), (i) => (st.mouseClutch = MOUSE_TRAVELS[i]));
      const controls = this.button('Controls', row++, () => this.open('controls'), 'menu-btn setting');
      controls.append(h('span', 'value', '›'));
      list.append(controls);
    } else if (tab === 'View') {
      const views: Settings['camera'][] = ['cockpit', 'hood', 'chase'];
      option('Camera', row++, ['Cockpit', 'Hood', 'Chase'], views.indexOf(st.camera), (i) => (st.camera = views[i]));
      const fovs = Array.from({ length: 11 }, (_, i) => 50 + i * 5);
      option('Field of view', row++, fovs.map((f) => `${f}°`), Math.max(0, fovs.indexOf(st.fov)), (i) => (st.fov = fovs[i]));
      option('On-screen speedo', row++, ['Auto', 'On', 'Off'], SPEEDO_MODES.indexOf(st.speedo), (i) => (st.speedo = SPEEDO_MODES[i]));
      option('Speed effects', row++, ['Off', 'Subtle', 'Strong'], st.speedFx ? (st.fxLevel === 1 ? 2 : 1) : 0, (i) => {
        st.speedFx = i > 0;
        if (i > 0) st.fxLevel = i === 2 ? 1 : 0.5;
      });
      option('Chase cam distance', row++, ['Very close', 'Close', 'Medium', 'Far', 'Very far'], Math.max(0, CHASE_DISTS.indexOf(st.chaseDist)), (i) => (st.chaseDist = CHASE_DISTS[i]));
      option('Chase cam height', row++, ['Very low', 'Low', 'Medium', 'High', 'Very high'], Math.max(0, CHASE_HEIGHTS.indexOf(st.chaseHeight)), (i) => (st.chaseHeight = CHASE_HEIGHTS[i]));
      option('Look', row++, ['Normal', 'Street (comic)', '90s VHS tape', '90s 32-bit console'], RETRO_LOOKS.indexOf(st.retro), (i) => (st.retro = RETRO_LOOKS[i]));
      option('Time of day', row++, ['Day cycle', 'Morning', 'Noon', 'Sunset', 'Night'], TIMES_OF_DAY.indexOf(st.timeOfDay), (i) => (st.timeOfDay = TIMES_OF_DAY[i]));
      option('Graphics', row++, ['Low', 'Medium', 'High'], GRAPHICS_QUALITIES.indexOf(st.graphics), (i) => (st.graphics = GRAPHICS_QUALITIES[i]));
    } else {
      option('Volume', row++, pctLabels, nearest(st.volume), (i) => (st.volume = pct[i]));
      option('Speed units', row++, ['km/h', 'mph'], st.units === 'kmh' ? 0 : 1, (i) => (st.units = i === 0 ? 'kmh' : 'mph'));
      option('Control hints', row++, ['On', 'Off'], st.hints ? 0 : 1, (i) => (st.hints = i === 0));
    }
    list.append(this.button('Back', row++, () => this.back()));
    panel.append(list, h('div', 'menu-hint', 'L1 / R1 or Q / E switch section · ✕ / Enter select · ○ / Esc back'));
  }

  private renderGarage(panel: HTMLElement) {
    const p = this.progress;
    panel.append(h('h2', undefined, 'Garage'), this.credsLine());

    const cars = h('div', 'car-list');
    const statsBox = h('div', 'car-stats');
    const showStats = (m: CarModel) => {
      statsBox.innerHTML = '';
      statsBox.append(h('p', 'muted', m.blurb));
      const bar = (label: string, v: number) => {
        const row = h('div', 'stat');
        const track = h('div', 'track');
        const fill = h('div', 'fill');
        fill.style.width = `${v * 100}%`;
        track.append(fill);
        row.append(h('span', undefined, label), track);
        statsBox.append(row);
      };
      bar('Power', m.stats.power);
      bar('Lightness', 1 - m.stats.weight);
      bar('Grip', m.stats.grip);
      statsBox.append(h('div', 'drive-tag', `${m.stats.drive} · ${Object.keys(m.spec.gears).length - 1}-speed`));
    };

    CARS.forEach((m, i) => {
      const el = h('div', 'menu-btn car');
      const owned = ownsCar(p, m.id);
      const badge = p.car === m.id ? 'Driving' : owned ? 'Owned' : `◆ ${m.price.toLocaleString()}`;
      const b = h('span', `badge ${owned ? '' : p.creds >= m.price ? 'buyable' : 'locked'}`, badge);
      el.append(h('span', 'name', m.name), b);
      this.add(el, i, 0, {
        focus: () => {
          showStats(m);
          this.hooks.preview(m, paintFor(p, m.id).color);
        },
        confirm: () => {
          const r = chooseCar(p, m.id);
          this.status =
            r === 'too-poor'
              ? `You need ${(m.price - p.creds).toLocaleString()} more creds for the ${m.name}.`
              : r === 'bought'
                ? `Bought the ${m.name}. Enjoy.`
                : '';
          if (r !== 'too-poor') {
            saveProgress(p);
            this.hooks.carChanged();
          }
          this.rerenderKeepingFocus();
        },
      });
      cars.append(el);
    });
    panel.append(cars, statsBox);

    const current = carById(p.car);
    panel.append(h('div', 'section-label', `Paint for the ${current.name}`));
    const swatches = h('div', 'swatches');
    const paintRow = CARS.length;
    const equipped = paintFor(p, p.car).id;
    PAINTS.forEach((paint, i) => {
      const sw = h('div', 'menu-btn swatch');
      sw.style.setProperty('--swatch', paint.color);
      if (paint.id === equipped) sw.classList.add('equipped');
      if (!ownsPaint(p, paint.id)) sw.classList.add('locked');
      sw.title = paint.name;
      this.add(sw, paintRow, i, {
        focus: () => {
          this.hooks.preview(current, paint.color);
          const owned = ownsPaint(p, paint.id);
          paintInfo.textContent = `${paint.name} · ${owned ? (paint.id === equipped ? 'On your car' : 'Owned') : `◆ ${paint.price}`}`;
        },
        confirm: () => {
          const r = choosePaint(p, paint.id);
          this.status = r === 'too-poor' ? `${paint.name} costs ◆ ${paint.price}. Keep driving.` : r === 'bought' ? `${paint.name} bought and applied.` : '';
          if (r !== 'too-poor') {
            saveProgress(p);
            this.hooks.carChanged();
          }
          this.rerenderKeepingFocus();
        },
      });
      swatches.append(sw);
    });
    const paintInfo = h('div', 'paint-info');
    panel.append(swatches, paintInfo);
    if (this.status) panel.append(h('div', 'status', this.status));
    const back = h('div', 'menu-list');
    const tuneBtn = this.button(`Tune the ${current.name}`, paintRow + 1, () => this.open('tune'), 'menu-btn primary');
    tuneBtn.append(h('span', 'value', `${peakPower(specFor(p, current))} hp  ›`));
    back.append(tuneBtn, this.button('Back', paintRow + 2, () => this.back()));
    panel.append(back, this.controlsHint(), h('div', 'menu-hint', 'Right stick or drag to look around · L2 / R2 or scroll to zoom'));
  }

  /** Tuning: one row per part; left/right to look through the levels, ✕ to buy or fit. */
  private renderTune(panel: HTMLElement) {
    const p = this.progress;
    const model = carById(p.car);
    this.hooks.preview(model, paintFor(p, model.id).color);
    const fitted = tuneFor(p, model.id);
    const looking: Tune = { ...fitted, ...this.tunePreview };
    const now = specFor(p, model);
    const next = tunedSpec(model.spec, looking);
    panel.append(h('h2', undefined, `Tune the ${model.name}`), this.credsLine());

    const figures = h('div', 'tune-figures');
    const fig = (label: string, a: number, b: number, fmt: (x: number) => string, lowerIsBetter = false) => {
      const el = h('div', 'tune-fig');
      el.append(h('span', undefined, label), h('b', undefined, fmt(b)));
      if (fmt(a) !== fmt(b)) el.append(h('i', b > a !== lowerIsBetter ? 'up' : 'down', `${b > a ? '+' : '−'}${fmt(Math.abs(b - a))}`));
      figures.append(el);
    };
    const whole = (unit: string) => (x: number) => `${Math.round(x).toLocaleString()} ${unit}`;
    fig('Power', peakPower(now), peakPower(next), whole('hp'));
    fig('Torque', peakTorque(now), peakTorque(next), whole('Nm'));
    fig('Weight', now.mass, next.mass, whole('kg'), true);
    fig('Boost', now.turbo?.maxBoost ?? 0, next.turbo?.maxBoost ?? 0, (x) => `${x.toFixed(1)} bar`);
    panel.append(figures);

    const info = h('div', 'status', this.status || PARTS[0].blurb);
    const list = h('div', 'menu-list');
    PARTS.forEach((part, row) => {
      const lvl = looking[part.id] ?? 0;
      const owned = ownedLevel(p, model.id, part.id);
      const isFitted = (fitted[part.id] ?? 0) === lvl;
      const el = h('div', 'menu-btn setting tune-row');
      const state = isFitted ? 'Fitted' : lvl <= owned ? 'Owned · ✕ to fit' : `◆ ${part.prices[lvl].toLocaleString()}`;
      const name = part.id === 'turbo' && !model.spec.turbo && lvl === 0 ? 'None' : part.levels[lvl];
      const val = h('span', 'value');
      const step = (d: number) => {
        const n = Math.max(0, Math.min(part.levels.length - 1, lvl + d));
        if (n === lvl) return;
        this.tunePreview = { ...this.tunePreview, [part.id]: n };
        this.rerenderKeepingFocus();
      };
      const arrow = (text: string, d: number) => {
        const a = h('i', 'arrow', text);
        a.addEventListener('click', (e) => {
          e.stopPropagation();
          step(d);
        });
        return a;
      };
      val.append(arrow('‹', -1), h('span', 'value-text', name), arrow('›', 1));
      const label = h('span', 'tune-label');
      label.append(h('b', undefined, part.name), h('small', state === 'Fitted' ? 'fitted' : lvl > owned ? 'price' : '', state));
      el.append(label, val);
      this.add(el, row, 0, {
        focus: () => {
          if (!this.status) info.textContent = part.blurb;
        },
        left: () => step(-1),
        right: () => step(1),
        confirm: () => {
          if (isFitted) return;
          const r = fitPart(p, model.id, part.id, lvl);
          this.status =
            r === 'too-poor'
              ? `You need ${(part.prices[lvl] - p.creds).toLocaleString()} more creds for that.`
              : r === 'bought'
                ? `${part.levels[lvl]} bought and fitted.`
                : `${lvl === 0 ? 'Back to stock' : part.levels[lvl]} fitted.`;
          if (r !== 'too-poor') {
            delete this.tunePreview[part.id];
            saveProgress(p);
            this.hooks.carChanged();
          }
          this.rerenderKeepingFocus();
        },
      });
      list.append(el);
    });
    panel.append(list);
    if (clutchWillSlip(next)) panel.append(h('div', 'status warn', 'This much torque will make the clutch slip. Fit a stronger clutch.'));
    panel.append(info);
    const back = h('div', 'menu-list');
    back.append(this.button('Back to the garage', PARTS.length, () => this.back()));
    panel.append(back, h('div', 'menu-hint', '‹ › to look through parts · ✕ / Enter to buy or fit'));
  }

  private renderControls(panel: HTMLElement) {
    const b = this.progress.settings.bindings;
    panel.append(h('h2', undefined, 'Controls'));
    const table = h('div', 'bind-table');
    const head = h('div', 'bind-row bind-head');
    head.append(h('span', undefined, ''), h('span', undefined, 'Controller'), h('span', undefined, 'Keyboard'));
    table.append(head);
    ACTIONS.forEach((a, row) => {
      const r = h('div', 'bind-row');
      const cell = (kind: 'pad' | 'key', col: number) => {
        const waiting = this.capturing?.action === a && this.capturing.kind === kind;
        const text = waiting ? (kind === 'pad' ? 'Press or move…' : 'Press a key…') : kind === 'pad' ? padLabel(b.pad[a]) : keysLabel(b.keys[a]);
        const el = h('div', `menu-btn bind-cell${waiting ? ' waiting' : ''}`, text);
        this.add(el, row, col, { confirm: () => this.beginCapture(a, kind) });
        return el;
      };
      r.append(h('span', 'bind-label', ACTION_LABELS[a]), cell('pad', 0), cell('key', 1));
      table.append(r);
    });
    const list = h('div', 'menu-list');
    list.append(
      this.button('Reset to defaults', ACTIONS.length, () => {
        this.progress.settings.bindings = defaultBindings();
        this.bindingsChanged();
      }),
      this.button('Back', ACTIONS.length + 1, () => this.back()),
    );
    const note = h('p', 'menu-hint', this.status || 'Select a box, then press the button, move the stick or press the key. Esc cancels.');
    panel.append(table, list, note);
  }

  private beginCapture(action: Action, kind: 'pad' | 'key') {
    this.capturing = { action, kind };
    this.status = '';
    this.hooks.startCapture(kind);
    this.rerenderKeepingFocus();
  }

  private pollCapture() {
    const cap = this.capturing;
    if (!cap) return;
    const got = this.hooks.pollCapture();
    if (!got) return;
    this.capturing = null;
    // A bound controller press shouldn't also act on the menu (captured keys never reach it).
    if (cap.kind === 'pad') this.settle = true;
    if (got !== 'cancel') {
      const b = this.progress.settings.bindings;
      const cleared = got.pad ? assignPad(b, cap.action, got.pad) : got.key ? assignKey(b, cap.action, got.key) : [];
      this.status = cleared.length ? `Moved from ${cleared.map((a) => ACTION_LABELS[a]).join(', ')}, which is now unbound.` : '';
    }
    this.bindingsChanged();
  }

  private bindingsChanged() {
    saveProgress(this.progress);
    this.hooks.settingsChanged();
    this.rerenderKeepingFocus();
  }

  private focusOnLabel(label: string) {
    const i = this.items.findIndex((it) => it.el.textContent === label);
    if (i >= 0) this.setFocus(i);
  }

  private rerenderKeepingFocus() {
    const f = this.focusIndex;
    this.render();
    this.setFocus(Math.min(f, this.items.length - 1));
  }

  private controlsHint() {
    return h('div', 'menu-hint', '✕ / Enter select · ○ / Esc back · D-pad or stick to move');
  }
}
