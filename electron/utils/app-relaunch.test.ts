import * as fs from 'fs';
import { app } from 'electron';
import { spawn } from 'child_process';
import {
  RELAUNCH_ENV,
  SERVICE_RESTART_EXIT_CODE,
  dropBorrowedDisplay,
  handOffLaunchArgs,
  launchArgs,
  launchTarget,
  restartApp,
  resumeAfterUpdate,
  setBeforeRestart,
  systemServiceUnit,
  takeRelaunchRequest
} from './app-relaunch';

jest.mock('fs', () => ({ ...jest.requireActual('fs'), readFileSync: jest.fn(), existsSync: jest.fn() }));
jest.mock('child_process', () => ({ spawn: jest.fn(() => ({ unref: jest.fn() })) }));
jest.mock('electron', () => ({ app: { relaunch: jest.fn(), exit: jest.fn() } }));

describe('app-relaunch', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    jest.mocked(fs.readFileSync).mockReset().mockReturnValue('0::/user.slice/session-2.scope\n');
    jest.mocked(fs.existsSync).mockReset().mockReturnValue(false);
    process.argv = ['/opt/Cerious AASM/cerious-aasm.bin', '--headless', '--port=3000'];
    delete process.env[RELAUNCH_ENV];
    delete process.env.APPIMAGE;
    setBeforeRestart(null);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    process.argv = originalArgv;
    process.env = { ...originalEnv };
  });

  it('keeps the command line and drops the installer flag', () => {
    expect(launchArgs(['app.exe', '--headless', '--updated', '--port=8080'])).toEqual(['--headless', '--port=8080']);
  });

  it('finds the systemd system service this process runs in', () => {
    jest.mocked(fs.readFileSync).mockReturnValue('0::/system.slice/cerious-aasm.service\n');
    expect(systemServiceUnit()).toBe('cerious-aasm.service');

    // A terminal's shell runs in the user's own slice, which restarts nothing.
    jest.mocked(fs.readFileSync).mockReturnValue('0::/user.slice/user-1000.slice/user@1000.service/app.slice/gnome-terminal.service\n');
    expect(systemServiceUnit()).toBeNull();
  });

  it('restarts the AppImage, or the Linux launcher that attaches xvfb-run, rather than the binary', () => {
    expect(launchTarget({ APPIMAGE: '/opt/Cerious.AppImage' }, '/tmp/.mount_x/cerious-aasm.bin')).toBe('/opt/Cerious.AppImage');
    jest.mocked(fs.existsSync).mockReturnValue(true);
    expect(launchTarget({}, '/opt/Cerious AASM/cerious-aasm.bin')).toBe('/opt/Cerious AASM/cerious-aasm');
  });

  it('forgets a display that xvfb-run made, and keeps a real one', () => {
    const borrowed: NodeJS.ProcessEnv = { DISPLAY: ':99', XAUTHORITY: '/tmp/xvfb-run.Ab12Cd/Xauthority' };
    dropBorrowedDisplay(borrowed);
    expect(borrowed).toEqual({});

    const desktop: NodeJS.ProcessEnv = { DISPLAY: ':0', XAUTHORITY: '/home/me/.Xauthority' };
    dropBorrowedDisplay(desktop);
    expect(desktop).toEqual({ DISPLAY: ':0', XAUTHORITY: '/home/me/.Xauthority' });
  });

  it('shuts down, then restarts with the same command line once this process has gone', () => {
    const cleanup = jest.fn();
    setBeforeRestart(cleanup);
    process.env.DISPLAY = ':99';
    process.env.XAUTHORITY = '/tmp/xvfb-run.Ab12Cd/Xauthority';

    restartApp('/opt/Cerious AASM/cerious-aasm');

    expect(cleanup).toHaveBeenCalled();
    expect(app.relaunch).toHaveBeenCalledWith({ execPath: '/opt/Cerious AASM/cerious-aasm', args: ['--headless', '--port=3000'] });
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(process.env.DISPLAY).toBeUndefined();
  });

  it('leaves the restart to systemd when it runs as a system service', () => {
    jest.mocked(fs.readFileSync).mockReturnValue('0::/system.slice/cerious-aasm.service\n');

    restartApp();

    expect(app.relaunch).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(SERVICE_RESTART_EXIT_CODE);
  });

  it('takes a request once and ignores one it did not write', () => {
    handOffLaunchArgs(['--headless']);
    expect(takeRelaunchRequest()).toEqual({ args: ['--headless'] });
    expect(process.env[RELAUNCH_ENV]).toBeUndefined();

    process.env[RELAUNCH_ENV] = JSON.stringify({ args: [1, 2] });
    expect(takeRelaunchRequest()).toBeNull();
  });

  it('starts the app again with the handed-over command line in the process an installer started', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    process.env[RELAUNCH_ENV] = JSON.stringify({ args: ['--headless', '--port=8080'] });

    resumeAfterUpdate();

    expect(spawn).toHaveBeenCalledWith(process.execPath, ['--headless', '--port=8080'], expect.objectContaining({ detached: true, stdio: 'ignore' }));
    const env = (jest.mocked(spawn).mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
    expect(env[RELAUNCH_ENV]).toBeUndefined();
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });
});
