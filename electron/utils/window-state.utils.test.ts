jest.unmock('fs');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { readWindowState, trackWindowState, WindowState } from './window-state.utils';

// The window opened at 1024x768 every time, wherever and however large it was left.
describe('window state', () => {
  const sizes = { width: 1024, height: 768, minWidth: 940, minHeight: 600 };
  /** One 1920x1080 monitor, its taskbar taking the bottom 40px. */
  const monitors = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-state-'));
    file = path.join(dir, 'window-state.json');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const saved = (state: Partial<WindowState>) => fs.writeFileSync(file, JSON.stringify(state));

  it('opens at the default size, centred, the first time', () => {
    expect(readWindowState(file, monitors, sizes)).toEqual({ width: 1024, height: 768, maximized: false });
  });

  it('opens where and as large as it was left', () => {
    saved({ x: 200, y: 100, width: 1400, height: 900, maximized: false });

    expect(readWindowState(file, monitors, sizes)).toEqual({ x: 200, y: 100, width: 1400, height: 900, maximized: false });
  });

  it('opens maximized when it was left maximized', () => {
    saved({ x: 200, y: 100, width: 1400, height: 900, maximized: true });

    expect(readWindowState(file, monitors, sizes).maximized).toBe(true);
  });

  // Left on a second monitor since unplugged, it would open somewhere nobody can see.
  it('keeps the size but not the place when that place is on no monitor now', () => {
    saved({ x: 2200, y: 100, width: 1400, height: 900, maximized: false });

    expect(readWindowState(file, monitors, sizes)).toEqual({ width: 1400, height: 900, maximized: false });
  });

  it('keeps it between the smallest size it allows and the largest monitor', () => {
    saved({ x: 0, y: 0, width: 300, height: 200, maximized: false });
    expect(readWindowState(file, monitors, sizes)).toEqual(expect.objectContaining({ width: 940, height: 600 }));

    saved({ x: 0, y: 0, width: 5000, height: 3000, maximized: false });
    expect(readWindowState(file, monitors, sizes)).toEqual(expect.objectContaining({ width: 1920, height: 1040 }));
  });

  it('opens at the default size when what was saved cannot be read', () => {
    fs.writeFileSync(file, '{ not json');

    expect(readWindowState(file, monitors, sizes)).toEqual({ width: 1024, height: 768, maximized: false });
  });

  describe('as it is moved, resized and closed', () => {
    /** A stand-in for the BrowserWindow: the events, and the bounds it reports. */
    function fakeWindow(bounds: { x: number; y: number; width: number; height: number }, maximized = false) {
      const win = new EventEmitter() as EventEmitter & Record<string, unknown>;
      win.isMaximized = () => maximized;
      win.getNormalBounds = () => bounds;
      win.isDestroyed = () => false;
      return win;
    }
    const written = () => JSON.parse(fs.readFileSync(file, 'utf8'));

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('saves the size and place shortly after a move or resize settles', () => {
      const win = fakeWindow({ x: 50, y: 60, width: 1200, height: 800 });
      trackWindowState(win as never, file);

      win.emit('resize');
      win.emit('move');
      expect(fs.existsSync(file)).toBe(false);
      jest.advanceTimersByTime(1000);

      expect(written()).toEqual({ x: 50, y: 60, width: 1200, height: 800, maximized: false });
    });

    it('saves at once on close, with the size it has when not maximized', () => {
      const win = fakeWindow({ x: 50, y: 60, width: 1200, height: 800 }, true);
      trackWindowState(win as never, file);

      win.emit('close');

      expect(written()).toEqual({ x: 50, y: 60, width: 1200, height: 800, maximized: true });
    });
  });
});
