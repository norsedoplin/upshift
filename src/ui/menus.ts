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
import { GRAPHICS_QUALITIES, SPEEDO_MODES, saveProgress } from '../game/progress';
import { chooseCar, choosePaint, ownsCar, ownsPaint, paintFor } from '../game/shop';
import type { RunStats } from '../game/scoring';

export type Screen = 'title' | 'main' | 'garage' | 'settings' | 'controls' | 'pause' | 'summary';

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
  private lastSummary: { stats: RunStats; earned: number; best: boolean; time: string } | null = null;
  private status = '';
  private rumbleResult = '';
  private capturing: { action: Action; kind: 'pad' | 'key' } | null = null;
  // Swallow input for one frame after a screen change, so one press can't act twice.
  private settle = false;

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
  }

  get isOpen() {
    return this.screen !== null;
  }

  open(screen: Screen | null) {
    if (screen === 'garage' && this.screen && this.screen !== 'garage' && this.screen !== 'settings') this.garageReturn = this.screen;
    if (screen === 'settings' && this.screen && this.screen !== 'settings' && this.screen !== 'controls') this.settingsReturn = this.screen;
    if (this.capturing) {
      this.capturing = null;
      this.hooks.cancelCapture();
    }
    if (this.screen === 'garage' && screen !== 'garage') this.hooks.preview(null, null);
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
        this.open('settings');
        this.focusOnLabel('Controls');
        break;
      case 'garage':
        this.open(this.garageReturn);
        break;
      case 'summary':
        this.hooks.restart();
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
    el.addEventListener('mouseenter', () => this.setFocus(index));
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
    }
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

  private renderMain(panel: HTMLElement) {
    const car = carById(this.progress.car);
    panel.append(h('h1', 'logo', 'UpShift'), this.credsLine());
    const info = h('p', 'muted', `Driving the ${car.name} · best run ${this.progress.bestScore.toLocaleString()}`);
    panel.append(info);
    const list = h('div', 'menu-list');
    list.append(
      this.button('Drive the touge', 0, () => this.hooks.drive(), 'menu-btn primary'),
      this.button('Garage', 1, () => this.open('garage')),
      this.button('Settings', 2, () => this.open('settings')),
    );
    panel.append(list, this.controlsHint());
  }

  private renderPause(panel: HTMLElement) {
    panel.append(h('h2', undefined, 'Paused'));
    const list = h('div', 'menu-list');
    list.append(
      this.button('Resume', 0, () => this.hooks.resume(), 'menu-btn primary'),
      this.button('Restart run', 1, () => this.hooks.restart()),
      this.button('Garage', 2, () => this.open('garage')),
      this.button('Settings', 3, () => this.open('settings')),
      this.button('Main menu', 4, () => this.hooks.toMenu()),
    );
    panel.append(list, this.controlsHint());
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
      val.innerHTML = `<i>‹</i> ${values[index]} <i>›</i>`;
      el.append(h('span', undefined, label), val);
      // Left/right stop at the ends; ✕ cycles round.
      const step = (d: number, wrap = false) => {
        const next = wrap ? (index + d + values.length) % values.length : Math.max(0, Math.min(values.length - 1, index + d));
        if (next === index) return;
        set(next);
        changed();
      };
      this.add(el, row, 0, { left: () => step(-1), right: () => step(1), confirm: () => step(1, true) });
      list.append(el);
    };
    const pct = [0, 0.25, 0.5, 0.75, 1];
    const pctLabels = ['Off', '25%', '50%', '75%', '100%'];
    const nearest = (v: number) => pct.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(pct[b] - v) ? i : b), 0);
    option('Controller rumble', 0, pctLabels, nearest(st.rumble), (i) => (st.rumble = pct[i]));
    const test = h('div', 'menu-btn setting');
    const result = h('span', 'value', this.rumbleResult || 'Press ✕');
    test.append(h('span', undefined, 'Test rumble'), result);
    this.add(test, 1, 0, {
      confirm: () => {
        result.textContent = '…';
        void this.hooks.testRumble().then((msg) => {
          this.rumbleResult = msg;
          result.textContent = msg;
        });
      },
    });
    list.append(test);
    let row = 2;
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
    option('Volume', row++, pctLabels, nearest(st.volume), (i) => (st.volume = pct[i]));
    option('Speed units', row++, ['km/h', 'mph'], st.units === 'kmh' ? 0 : 1, (i) => (st.units = i === 0 ? 'kmh' : 'mph'));
    const views: Settings['camera'][] = ['cockpit', 'hood', 'chase'];
    option('Camera', row++, ['Cockpit', 'Hood', 'Chase'], views.indexOf(st.camera), (i) => (st.camera = views[i]));
    const fovs = Array.from({ length: 11 }, (_, i) => 50 + i * 5);
    option('Field of view', row++, fovs.map((f) => `${f}°`), Math.max(0, fovs.indexOf(st.fov)), (i) => (st.fov = fovs[i]));
    option('Graphics', row++, ['Low', 'Medium', 'High'], GRAPHICS_QUALITIES.indexOf(st.graphics), (i) => (st.graphics = GRAPHICS_QUALITIES[i]));
    option('On-screen speedo', row++, ['Auto', 'On', 'Off'], SPEEDO_MODES.indexOf(st.speedo), (i) => (st.speedo = SPEEDO_MODES[i]));
    option('Control hints', row++, ['On', 'Off'], st.hints ? 0 : 1, (i) => (st.hints = i === 0));
    list.append(this.button('Controls', row++, () => this.open('controls')));
    list.append(this.button('Back', row++, () => this.back()));
    panel.append(list, this.controlsHint());
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
    back.append(this.button('Back', paintRow + 1, () => this.back()));
    panel.append(back, this.controlsHint());
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
