import * as fs from 'fs';

/** A monitor's work area, or a window's bounds, in screen coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the window was left and how large, and whether it was maximized. No x/y: centred. */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

interface WindowSizes {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/** The window as Electron gives it: only what saving its state needs. */
interface TrackedWindow {
  on(event: 'resize' | 'move' | 'close', listener: () => void): unknown;
  isMaximized(): boolean;
  /** Its bounds when not maximized, so a maximized window comes back to the size it had. */
  getNormalBounds(): Rect;
  isDestroyed(): boolean;
}

/** How long a move or resize has to settle before it is written: dragging fires these constantly. */
const SAVE_DELAY_MS = 500;
/** How much of the window's top must be on a monitor to grab it there: its title bar. */
const GRAB_WIDTH = 100;
const GRAB_HEIGHT = 30;

/**
 * The window as it was left, kept to the monitors connected now: a place on none of them is
 * dropped, so it opens centred rather than out of sight; the size stays within the smallest it
 * allows and the largest monitor. Nothing saved, or nothing readable: the default size, centred.
 */
export function readWindowState(file: string, monitors: Rect[], sizes: WindowSizes): WindowState {
  const fallback: WindowState = { width: sizes.width, height: sizes.height, maximized: false };
  let saved: Partial<WindowState>;
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
  if (!isNumber(saved.width) || !isNumber(saved.height)) return fallback;

  const largestWidth = Math.max(sizes.minWidth, ...monitors.map(monitor => monitor.width));
  const largestHeight = Math.max(sizes.minHeight, ...monitors.map(monitor => monitor.height));
  const width = Math.round(Math.min(Math.max(saved.width, sizes.minWidth), largestWidth));
  const height = Math.round(Math.min(Math.max(saved.height, sizes.minHeight), largestHeight));
  const state: WindowState = { width, height, maximized: saved.maximized === true };

  if (isNumber(saved.x) && isNumber(saved.y) && monitors.some(monitor => canGrab({ x: saved.x!, y: saved.y!, width, height }, monitor))) {
    return { x: Math.round(saved.x), y: Math.round(saved.y), ...state };
  }
  return state;
}

/** Writes the window's state shortly after each move or resize settles, and at once on close. */
export function trackWindowState(win: TrackedWindow, file: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    writeWindowState(file, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized: win.isMaximized() });
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('close', save);
}

function writeWindowState(file: string, state: WindowState): void {
  try {
    fs.writeFileSync(file, JSON.stringify(state));
  } catch (error) {
    // Not worth more than a line: the window still works, it just opens at the default next time.
    console.warn('[window-state] Could not save the window size:', error);
  }
}

function canGrab(window: Rect, monitor: Rect): boolean {
  const left = Math.max(window.x, monitor.x);
  const right = Math.min(window.x + window.width, monitor.x + monitor.width);
  const top = Math.max(window.y, monitor.y);
  const bottom = Math.min(window.y + GRAB_HEIGHT, monitor.y + monitor.height);
  return right - left >= GRAB_WIDTH && bottom - top >= GRAB_HEIGHT;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
