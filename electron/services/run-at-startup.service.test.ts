jest.unmock('fs');
jest.unmock('path');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { runAtStartupStatus, setRunAtStartup } from './run-at-startup.service';

/** What Windows' startup list holds for the app, as the stand-in for Electron keeps it. */
const mockLoginItem = { openAtLogin: false };

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/repo',
    setLoginItemSettings: jest.fn((settings: { openAtLogin: boolean }) => { mockLoginItem.openAtLogin = settings.openAtLogin; }),
    getLoginItemSettings: jest.fn(() => ({ openAtLogin: mockLoginItem.openAtLogin }))
  }
}));

// The app could only be started by hand after every reboot, servers set to start with it included.
describe('running the app at computer startup', () => {
  const realPlatform = process.platform;
  let configHome: string;

  const onPlatform = (platform: string) => Object.defineProperty(process, 'platform', { value: platform });
  const entry = () => path.join(configHome, 'autostart', 'cerious-aasm.desktop');

  beforeEach(() => {
    mockLoginItem.openAtLogin = false;
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-autostart-'));
    process.env.XDG_CONFIG_HOME = configHome;
    delete process.env.AASM_DOCKER;
    delete process.env.APPIMAGE;
  });

  afterEach(() => {
    onPlatform(realPlatform);
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.AASM_DOCKER;
    delete process.env.APPIMAGE;
    fs.rmSync(configHome, { recursive: true, force: true });
  });

  describe('on Windows', () => {
    beforeEach(() => onPlatform('win32'));

    it('adds the app to Windows\' startup list, and says that it is there', () => {
      expect(runAtStartupStatus()).toEqual({ supported: true, enabled: false });

      expect(setRunAtStartup(true)).toEqual({ supported: true, enabled: true });

      // Run from source, Electron has to be told which app to open.
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: process.execPath, args: ['/repo'] });
      expect(runAtStartupStatus().enabled).toBe(true);
    });

    it('takes it off again', () => {
      setRunAtStartup(true);

      expect(setRunAtStartup(false)).toEqual({ supported: true, enabled: false });
    });
  });

  describe('on Linux', () => {
    const realExecPath = process.execPath;
    beforeEach(() => {
      onPlatform('linux');
      Object.defineProperty(process, 'execPath', { value: '/opt/Cerious AASM/cerious-aasm', configurable: true });
    });
    afterEach(() => Object.defineProperty(process, 'execPath', { value: realExecPath, configurable: true }));

    it('adds a startup entry that opens the app at login, and removes it again', () => {
      expect(runAtStartupStatus()).toEqual({ supported: true, enabled: false });

      expect(setRunAtStartup(true)).toEqual({ supported: true, enabled: true });
      const written = fs.readFileSync(entry(), 'utf8');
      expect(written).toContain('[Desktop Entry]');
      expect(written).toContain('Exec="/opt/Cerious AASM/cerious-aasm" "/repo"');

      expect(setRunAtStartup(false)).toEqual({ supported: true, enabled: false });
      expect(fs.existsSync(entry())).toBe(false);
    });

    // An AppImage is run from its own file, not from the copy it unpacks each time.
    it('opens an AppImage from its own file', () => {
      process.env.APPIMAGE = '/home/ada/Apps/Cerious AASM.AppImage';

      setRunAtStartup(true);

      expect(fs.readFileSync(entry(), 'utf8')).toContain('Exec="/home/ada/Apps/Cerious AASM.AppImage"\n');
    });
  });

  it('is not offered in Docker, where the container starts the app', () => {
    onPlatform('linux');
    process.env.AASM_DOCKER = '1';

    expect(runAtStartupStatus()).toEqual({ supported: false, enabled: false });
    expect(setRunAtStartup(true)).toEqual({ supported: false, enabled: false });
    expect(fs.existsSync(entry())).toBe(false);
  });

  it('is not offered without a window to open, nor on other systems', () => {
    onPlatform('win32');
    expect(runAtStartupStatus({ headless: true }).supported).toBe(false);

    onPlatform('darwin');
    expect(runAtStartupStatus().supported).toBe(false);
  });
});
