import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { ArkUpdateService, stopSteamCmdQuery } from './ark-update.service';
import type { MessagingService } from './messaging.service';
import { getCurrentInstalledVersion, installArkServer } from '../utils/ark/ark-install.utils';
import { acquireInstallLock, InstallCancelledError, INSTALL_IN_PROGRESS, isInstallLocked, releaseInstallLock } from '../utils/installer.utils';
import { getPlatform } from '../utils/platform.utils';
import { isSteamCmdInstalled } from '../utils/steamcmd.utils';
import { loadGlobalConfig, type GlobalConfig } from '../utils/global-config.utils';
import { serverLifecycleService } from './server-instance/server-lifecycle.service';
import { serverManagementService } from './server-instance/server-management.service';
import { serverProcessService } from './server-instance/server-process.service';
import { serverInstanceService } from './server-instance/server-instance.service';
import { getStandardEventCallbacks } from './server-instance/instance-events';
import { rconService } from './rcon.service';
import { areServerFilesUpdating } from '../utils/ark/ark-server/ark-server-state.utils';
import * as stagingUtils from '../utils/ark/ark-update-staging.utils';
import type { InstanceConfig } from '../types/server-instance.types';

jest.mock('../utils/ark/ark-install.utils', () => ({
  getCurrentInstalledVersion: jest.fn(),
  installArkServer: jest.fn()
}));
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({ ARK_APP_ID: '2430930', getArkServerDir: jest.fn(() => '/ark') }));
jest.mock('../utils/ark/ark-update-staging.utils', () => ({
  stagingDirFor: jest.fn((dir: string) => `${dir}-update`),
  listGameFiles: jest.fn(async () => new Map()),
  freeBytes: jest.fn(() => 1e12),
  roomForStaging: jest.fn(),
  seedStaging: jest.fn(),
  changesBetween: jest.fn(),
  putInPlace: jest.fn(),
  removeStaging: jest.fn()
}));
jest.mock('../utils/installer.utils', () => ({
  ...jest.requireActual('../utils/installer.utils'),
  acquireInstallLock: jest.fn(),
  releaseInstallLock: jest.fn(),
  isInstallLocked: jest.fn()
}));
jest.mock('../utils/steamcmd.utils', () => ({
  isSteamCmdInstalled: jest.fn(),
  getSteamCmdDir: jest.fn(() => '/steamcmd'),
  getSteamCmdExecutable: jest.fn(() => '/steamcmd/steamcmd.sh')
}));
jest.mock('../utils/global-config.utils', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../utils/platform.utils', () => ({ getPlatform: jest.fn() }));
jest.mock('./server-instance/server-lifecycle.service', () => ({
  serverLifecycleService: { stopServerInstance: jest.fn() }
}));
jest.mock('./server-instance/server-management.service', () => ({
  serverManagementService: { getAllInstances: jest.fn(), prepareInstanceConfiguration: jest.fn() }
}));
jest.mock('./server-instance/server-process.service', () => ({
  serverProcessService: {
    getNormalizedInstanceState: jest.fn(),
    hasActiveProcess: jest.fn(),
    getServerProcess: jest.fn(),
    forceKillServerProcess: jest.fn()
  }
}));
jest.mock('./server-instance/server-instance.service', () => ({
  serverInstanceService: { startServerInstance: jest.fn() }
}));
jest.mock('./server-instance/instance-events', () => ({ getStandardEventCallbacks: jest.fn() }));
jest.mock('./rcon.service', () => ({ rconService: { executeRconCommand: jest.fn() } }));

const mockInstalledVersion = jest.mocked(getCurrentInstalledVersion);
const mockInstall = jest.mocked(installArkServer);
const mockAcquire = jest.mocked(acquireInstallLock);
const mockRelease = jest.mocked(releaseInstallLock);
const mockLocked = jest.mocked(isInstallLocked);
const mockConfig = jest.mocked(loadGlobalConfig);
const mockLifecycle = jest.mocked(serverLifecycleService);
const mockManagement = jest.mocked(serverManagementService);
const mockProcess = jest.mocked(serverProcessService);
const mockStart = jest.mocked(serverInstanceService.startServerInstance);
const mockSpawn = jest.mocked(spawn);
const mockStaging = jest.mocked(stagingUtils);
/** What the download changed, as the staging utils report it. */
const CHANGES = { changed: ['ShooterGame/Content/Paks/game.pak', 'steamapps/appmanifest_2430930.acf'], removed: [] };

type PrivateApi = {
  getLatestServerVersion(): Promise<string | null>;
  installedBuildId: string | null;
  latestBuildId: string | null;
  updateScheduled: boolean;
  lastUpdateAttemptTime: number;
};

const APP_INFO = `
"2430930"
{
  "depots"
  {
    "branches"
    {
      "public"
      {
        "buildid"   "19934105"
      }
      "betatest"
      {
        "buildid"   "20000000"
      }
    }
  }
}`;

function fakeSteamCmd() {
  const child = Object.assign(new EventEmitter(), {
    pid: 4321,
    stdout: Object.assign(new EventEmitter(), { destroy: jest.fn() }),
    stderr: Object.assign(new EventEmitter(), { destroy: jest.fn() }),
    kill: jest.fn()
  });
  mockSpawn.mockReturnValueOnce(child as unknown as ChildProcess);
  return child;
}

function config(values: Partial<GlobalConfig>): GlobalConfig {
  return values as GlobalConfig;
}

function instance(id: string): InstanceConfig {
  return { id, name: id };
}

describe('ArkUpdateService', () => {
  let messaging: { sendToAll: jest.Mock };
  let service: ArkUpdateService;
  let internals: PrivateApi;

  function statuses(): string[] {
    return messaging.sendToAll.mock.calls
      .filter(([channel]) => channel === 'cluster-update-status')
      .map(([, data]) => data.status);
  }

  beforeEach(() => {
    messaging = { sendToAll: jest.fn() };
    service = new ArkUpdateService(messaging as unknown as MessagingService);
    internals = service as unknown as PrivateApi;

    mockInstalledVersion.mockReset().mockResolvedValue('12345');
    mockInstall.mockReset().mockImplementation(done => done(null));
    mockAcquire.mockReset().mockReturnValue(true);
    mockRelease.mockReset();
    mockLocked.mockReset().mockReturnValue(false);
    jest.mocked(isSteamCmdInstalled).mockReset().mockReturnValue(true);
    mockConfig.mockReset().mockReturnValue(config({ serverStartDelaySeconds: 0 }));
    mockLifecycle.stopServerInstance.mockReset().mockResolvedValue({ success: true });
    mockManagement.getAllInstances.mockReset().mockResolvedValue({ instances: [] });
    mockManagement.prepareInstanceConfiguration.mockReset().mockResolvedValue(undefined);
    mockProcess.getNormalizedInstanceState.mockReset().mockReturnValue('stopped');
    mockProcess.hasActiveProcess.mockReset().mockReturnValue(false);
    mockProcess.getServerProcess.mockReset().mockReturnValue(null);
    mockProcess.forceKillServerProcess.mockReset().mockResolvedValue(undefined);
    mockStart.mockReset().mockResolvedValue({ started: true, instanceId: 'x' });
    jest.mocked(getStandardEventCallbacks).mockReset().mockReturnValue({ onLog: jest.fn(), onState: jest.fn() });
    jest.mocked(rconService.executeRconCommand).mockReset().mockResolvedValue({ success: true, instanceId: 'x' });
    mockSpawn.mockReset();
    jest.mocked(getPlatform).mockReturnValue('windows');
    mockStaging.listGameFiles.mockReset().mockResolvedValue(new Map());
    mockStaging.roomForStaging.mockReset().mockReturnValue({ enough: true, needed: 1, free: 2 });
    mockStaging.seedStaging.mockReset().mockResolvedValue([]);
    mockStaging.changesBetween.mockReset().mockReturnValue(CHANGES);
    mockStaging.putInPlace.mockReset().mockResolvedValue(undefined);
    mockStaging.removeStaging.mockReset().mockResolvedValue(undefined);
  });

  describe('initialize', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('reads the installed build, then polls now and every 15 minutes', async () => {
      const poll = jest.spyOn(service, 'pollAndNotify').mockResolvedValue(null);

      await service.initialize();
      expect(internals.installedBuildId).toBe('12345');
      expect(poll).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(15 * 60 * 1000);
      expect(poll).toHaveBeenCalledTimes(2);
    });

    it('starts only one poll when called twice', async () => {
      const poll = jest.spyOn(service, 'pollAndNotify').mockResolvedValue(null);

      await service.initialize();
      await service.initialize();
      jest.advanceTimersByTime(15 * 60 * 1000);

      expect(poll).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(1);
    });

    it('logs a poll that fails instead of leaving the rejection unhandled', async () => {
      jest.spyOn(service, 'pollAndNotify').mockRejectedValue(new Error('boom'));

      await service.initialize();
      await Promise.resolve();

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ark-update]'), expect.any(Error));
    });
  });

  describe('checkForUpdate', () => {
    it('reports a newer build', async () => {
      jest.spyOn(internals, 'getLatestServerVersion').mockResolvedValue('12346');

      await expect(service.checkForUpdate()).resolves.toEqual(expect.objectContaining({ success: true, hasUpdate: true, buildId: '12346' }));
    });

    it('reports the same build as up to date', async () => {
      jest.spyOn(internals, 'getLatestServerVersion').mockResolvedValue('12345');

      await expect(service.checkForUpdate()).resolves.toEqual(expect.objectContaining({ success: true, hasUpdate: false }));
    });

    it('reports a failed check', async () => {
      jest.spyOn(internals, 'getLatestServerVersion').mockRejectedValue(new Error('fail'));

      await expect(service.checkForUpdate()).resolves.toEqual(expect.objectContaining({ success: false, hasUpdate: false, error: 'fail' }));
    });

    it('does not run SteamCMD while an install holds the lock', async () => {
      mockAcquire.mockReturnValue(false);

      const result = await service.checkForUpdate();

      expect(result).toEqual(expect.objectContaining({ success: false, error: INSTALL_IN_PROGRESS }));
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('asking Steam for the latest build', () => {
    it('reads the public branch under the install lock', async () => {
      const child = fakeSteamCmd();

      const pending = internals.getLatestServerVersion();
      child.stdout.emit('data', Buffer.from(APP_INFO));
      child.emit('close', 0);

      await expect(pending).resolves.toBe('19934105');
      expect(mockSpawn).toHaveBeenCalledWith(
        '/steamcmd/steamcmd.sh',
        ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', '2430930', '+quit'],
        { cwd: '/steamcmd', detached: false }
      );
      expect(mockAcquire).toHaveBeenCalled();
      expect(mockRelease).toHaveBeenCalled();
    });

    it('answers null when SteamCMD is not installed', async () => {
      jest.mocked(isSteamCmdInstalled).mockReturnValue(false);

      await expect(internals.getLatestServerVersion()).resolves.toBeNull();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('answers null, and releases the lock, when SteamCMD cannot be started', async () => {
      const child = fakeSteamCmd();

      const pending = internals.getLatestServerVersion();
      child.emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }));

      await expect(pending).resolves.toBeNull();
      expect(mockRelease).toHaveBeenCalled();
    });

    describe('when SteamCMD hangs', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('stops it after two minutes', async () => {
        const child = fakeSteamCmd();
        child.kill.mockImplementation(() => child.emit('close', null));

        const pending = internals.getLatestServerVersion();
        jest.advanceTimersByTime(2 * 60 * 1000);

        expect(child.kill).toHaveBeenCalled();
        await expect(pending).resolves.toBeNull();
        expect(mockRelease).toHaveBeenCalled();
      });

      // On Linux steamcmd.sh runs the real SteamCMD as a child that keeps the pipes open, so
      // stopping the script ends neither the pipes nor the process.
      it('lets go even when stopping SteamCMD produces no events', async () => {
        const child = fakeSteamCmd();

        const pending = internals.getLatestServerVersion();
        jest.advanceTimersByTime(2 * 60 * 1000);

        await expect(pending).resolves.toBeNull();
        expect(child.kill).toHaveBeenCalled();
        expect(child.stdout.destroy).toHaveBeenCalled();
        expect(child.stderr.destroy).toHaveBeenCalled();
        expect(mockRelease).toHaveBeenCalled();
      });

      it('stops the whole process group on Linux', async () => {
        jest.mocked(getPlatform).mockReturnValue('linux');
        const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
        const child = fakeSteamCmd();

        const pending = internals.getLatestServerVersion();
        jest.advanceTimersByTime(2 * 60 * 1000);
        await pending;

        expect(mockSpawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), { cwd: '/steamcmd', detached: true });
        expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL');
        expect(child.kill).not.toHaveBeenCalled();
      });

      it('falls back to stopping SteamCMD itself when the group cannot be signalled', async () => {
        jest.mocked(getPlatform).mockReturnValue('linux');
        jest.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); });
        const child = fakeSteamCmd();

        const pending = internals.getLatestServerVersion();
        jest.advanceTimersByTime(2 * 60 * 1000);
        await pending;

        expect(child.kill).toHaveBeenCalled();
      });

      it('reads what SteamCMD printed when it exits but its pipes stay open', async () => {
        const child = fakeSteamCmd();

        const pending = internals.getLatestServerVersion();
        child.stdout.emit('data', Buffer.from(APP_INFO));
        child.emit('exit', 0);
        jest.advanceTimersByTime(1000);

        await expect(pending).resolves.toBe('19934105');
        expect(jest.getTimerCount()).toBe(0);
      });

      // Whatever still holds the pipes is part of that SteamCMD run; it must not outlive the lock.
      it('stops what is left of the run when the pipes stay open after exit', async () => {
        jest.mocked(getPlatform).mockReturnValue('linux');
        const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
        const child = fakeSteamCmd();

        const pending = internals.getLatestServerVersion();
        child.emit('exit', 0);
        jest.advanceTimersByTime(999);
        expect(kill).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        await pending;

        expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL');
        expect(kill.mock.invocationCallOrder[0]).toBeLessThan(mockRelease.mock.invocationCallOrder[0]);
      });

      it('stops nothing when the pipes close after exit', async () => {
        jest.mocked(getPlatform).mockReturnValue('linux');
        const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
        const child = fakeSteamCmd();

        const pending = internals.getLatestServerVersion();
        child.emit('exit', 0);
        child.emit('close', 0);
        await pending;
        jest.advanceTimersByTime(2 * 60 * 1000);

        expect(kill).not.toHaveBeenCalled();
        expect(child.kill).not.toHaveBeenCalled();
      });

      it('leaves no timer behind once SteamCMD answers', async () => {
        const child = fakeSteamCmd();

        const pending = internals.getLatestServerVersion();
        child.emit('close', 0);
        await pending;

        expect(jest.getTimerCount()).toBe(0);
      });
    });
  });

  describe('stopSteamCmdQuery', () => {
    // Called at app exit: the query runs in a process group of its own, which would outlive the app.
    it('stops a running build check and lets it finish', async () => {
      jest.mocked(getPlatform).mockReturnValue('linux');
      const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
      fakeSteamCmd();

      const pending = internals.getLatestServerVersion();
      stopSteamCmdQuery();

      await expect(pending).resolves.toBeNull();
      expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('does nothing when no build check is running', async () => {
      const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
      const child = fakeSteamCmd();
      const pending = internals.getLatestServerVersion();
      child.emit('close', 0);
      await pending;

      expect(() => stopSteamCmdQuery()).not.toThrow();
      expect(kill).not.toHaveBeenCalled();
      expect(child.kill).not.toHaveBeenCalled();
    });
  });

  describe('pollAndNotify', () => {
    it('broadcasts what the poll found', async () => {
      internals.installedBuildId = '12345';
      jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');
      mockConfig.mockReturnValue(config({}));

      await service.pollAndNotify();

      expect(messaging.sendToAll).toHaveBeenCalledWith('ark-update-status', { hasUpdate: true, buildId: '12346' });
      expect(messaging.sendToAll).toHaveBeenCalledWith('ark-update-available', { current: '12345', latest: '12346', autoUpdate: false });
    });

    it('skips the poll while an install holds the lock', async () => {
      mockLocked.mockReturnValue(true);
      const poll = jest.spyOn(service, 'pollArkServerUpdates');

      await expect(service.pollAndNotify()).resolves.toBeNull();

      expect(poll).not.toHaveBeenCalled();
      expect(messaging.sendToAll).not.toHaveBeenCalled();
    });

    it('skips the poll while an update is scheduled', async () => {
      internals.updateScheduled = true;
      const poll = jest.spyOn(service, 'pollArkServerUpdates');

      await service.pollAndNotify();

      expect(poll).not.toHaveBeenCalled();
    });

    it('does not schedule an auto-update during the cooldown', async () => {
      mockConfig.mockReturnValue(config({ autoUpdateArkServer: true, updateWarningMinutes: 5 }));
      internals.installedBuildId = '12345';
      internals.lastUpdateAttemptTime = Date.now();
      jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');
      const update = jest.spyOn(service, 'performClusterUpdate').mockResolvedValue();

      await service.pollAndNotify();

      expect(update).not.toHaveBeenCalled();
      expect(messaging.sendToAll).toHaveBeenCalledWith('ark-update-available', expect.objectContaining({ latest: '12346' }));
    });

    // The same update as one asked for by hand: it downloads first, then warns.
    it('starts an auto-update once the cooldown has passed', async () => {
      mockConfig.mockReturnValue(config({ autoUpdateArkServer: true, updateWarningMinutes: 5 }));
      internals.lastUpdateAttemptTime = Date.now() - 2 * 60 * 60 * 1000;
      jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');
      const update = jest.spyOn(service, 'performClusterUpdate').mockResolvedValue();

      await service.pollAndNotify();

      expect(update).toHaveBeenCalledWith();
      expect(internals.updateScheduled).toBe(true);
    });
  });

  describe('pollArkServerUpdates', () => {
    it('reports a new build', async () => {
      jest.spyOn(internals, 'getLatestServerVersion').mockResolvedValue('12346');

      await expect(service.pollArkServerUpdates()).resolves.toBe('12346');
    });

    it('reports nothing when the build is current', async () => {
      jest.spyOn(internals, 'getLatestServerVersion').mockResolvedValue('12345');

      await expect(service.pollArkServerUpdates()).resolves.toBeNull();
    });

    it('re-reads the installed build on every poll', async () => {
      mockInstalledVersion.mockResolvedValueOnce('old-build').mockResolvedValueOnce('new-build');
      jest.spyOn(internals, 'getLatestServerVersion').mockResolvedValue('new-build');

      await expect(service.pollArkServerUpdates()).resolves.toBe('new-build');
      await expect(service.pollArkServerUpdates()).resolves.toBeNull();
    });
  });

  describe('refreshInstalledBuild', () => {
    // An install from the settings page goes through the installer, not performClusterUpdate,
    // so the service only learns about the new build by re-reading it.
    it('clears a stale update flag once the latest build is installed', async () => {
      mockInstalledVersion.mockResolvedValueOnce('old-build');
      jest.spyOn(internals, 'getLatestServerVersion').mockResolvedValue('new-build');
      await service.pollArkServerUpdates();
      expect(service.getStatus().updateAvailable).toBe(true);

      mockInstalledVersion.mockResolvedValueOnce('new-build');
      const status = await service.refreshInstalledBuild();

      expect(status).toEqual(expect.objectContaining({ installedBuildId: 'new-build', latestBuildId: 'new-build', updateAvailable: false }));
      expect(messaging.sendToAll).toHaveBeenCalledWith('ark-update-status', { hasUpdate: false, buildId: null });
    });

    it('does not re-announce an update that is still pending', async () => {
      mockInstalledVersion.mockResolvedValue('old-build');
      jest.spyOn(internals, 'getLatestServerVersion').mockResolvedValue('new-build');
      await service.pollArkServerUpdates();

      const status = await service.refreshInstalledBuild();

      expect(status.updateAvailable).toBe(true);
      expect(messaging.sendToAll).not.toHaveBeenCalled();
    });

    it('does not report an update before Steam has been polled', async () => {
      const status = await service.refreshInstalledBuild();

      expect(status).toEqual(expect.objectContaining({ installedBuildId: '12345', latestBuildId: null, updateAvailable: false }));
    });
  });

  // The update downloads into a copy of the install while the servers keep running. Only once the
  // new build is there are players warned, the servers stopped and the changed files moved in.
  describe('an update', () => {
    const STAGING = '/ark-update';
    let installed: string;
    let staged: string;
    let running: Set<string>;
    let events: string[];
    let startedAt: number;

    const minutesIn = () => Math.round((Date.now() - startedAt) / 60_000);

    beforeEach(() => {
      jest.useFakeTimers();
      startedAt = Date.now();
      installed = '12345';
      staged = '12346';
      running = new Set(['a']);
      events = [];
      mockConfig.mockReturnValue(config({ serverStartDelaySeconds: 0, updateWarningMinutes: 5 }));
      mockInstalledVersion.mockImplementation(async dir => (dir === STAGING ? staged : installed));
      mockManagement.getAllInstances.mockResolvedValue({ instances: [instance('a'), instance('b')] });
      mockProcess.getNormalizedInstanceState.mockImplementation(id => (running.has(id) ? 'running' : 'stopped'));
      mockLifecycle.stopServerInstance.mockImplementation(async id => {
        events.push(`stop ${id} @${minutesIn()}`);
        running.delete(id);
        return { success: true };
      });
      mockManagement.prepareInstanceConfiguration.mockImplementation(async id => { events.push(`prepare ${id}`); });
      mockStart.mockImplementation(async id => {
        events.push(`start ${id}`);
        return { started: true, instanceId: id };
      });
      mockInstall.mockImplementation((done, _onProgress, _signal, dir) => {
        events.push(`steamcmd ${dir ?? '(install)'}`);
        done(null);
      });
      jest.mocked(rconService.executeRconCommand).mockImplementation(async (id, command) => {
        events.push(`warn ${id} @${minutesIn()}: ${command}`);
        return { success: true, instanceId: id };
      });
      mockStaging.seedStaging.mockImplementation(async () => {
        events.push('copy install');
        return [];
      });
      mockStaging.putInPlace.mockImplementation(async () => {
        events.push('put in place');
        installed = staged;
      });
      mockStaging.removeStaging.mockImplementation(async () => { events.push('remove copy'); });
    });

    afterEach(() => {
      service.stop();
      jest.useRealTimers();
    });

    /** Runs an update through its warning, and the moment after the stop for the delays between starts. */
    async function update(minutes = 5): Promise<void> {
      const pending = service.performClusterUpdate();
      await jest.advanceTimersByTimeAsync(minutes * 60_000 + 1000);
      await pending;
    }

    it('downloads while the servers run, then warns, stops, puts the new files in place and starts them again', async () => {
      await update();

      expect(events).toEqual([
        'copy install',
        `steamcmd ${STAGING}`,
        'warn a @0: Broadcast Server will restart for an update in 5 minutes!',
        'warn a @1: Broadcast Server will restart for an update in 4 minutes!',
        'warn a @2: Broadcast Server will restart for an update in 3 minutes!',
        'warn a @3: Broadcast Server will restart for an update in 2 minutes!',
        'warn a @4: Broadcast Server will restart for an update in 1 minute!',
        'warn a @5: Broadcast Server restarting for an update now!',
        'stop a @5',
        'put in place',
        'prepare a',
        'prepare b',
        // Removing the copy can take a while; the servers do not wait for it.
        'start a',
        'remove copy'
      ]);
      expect(mockStaging.seedStaging).toHaveBeenCalledWith('/ark', STAGING, expect.any(Function));
      expect(mockStaging.putInPlace).toHaveBeenCalledWith(STAGING, '/ark', CHANGES);
      expect(statuses()).toEqual(['copying', 'downloading', 'stopping', 'configuring', 'configuring', 'starting', 'complete']);
      expect(service.progress()).toMatchObject({ phase: 'complete', message: 'ARK updated to build 12346.' });
    });

    it('counts the warning down on the same marks as a scheduled restart', async () => {
      mockConfig.mockReturnValue(config({ serverStartDelaySeconds: 0, updateWarningMinutes: 15 }));

      await update(15);

      expect(events.filter(event => event.startsWith('warn')).map(event => event.split(':')[0]))
        .toEqual(['warn a @0', 'warn a @5', 'warn a @10', 'warn a @11', 'warn a @12', 'warn a @13', 'warn a @14', 'warn a @15']);
      expect(events).toContain('stop a @15');
    });

    it('warns whoever is running at each mark, and stops servers started since the download began', async () => {
      const pending = service.performClusterUpdate();
      await jest.advanceTimersByTimeAsync(2 * 60_000);
      running.add('b');
      await jest.advanceTimersByTimeAsync(3 * 60_000 + 1000);
      await pending;

      expect(events).toContain('warn b @3: Broadcast Server will restart for an update in 2 minutes!');
      expect(events).not.toContain('warn b @0: Broadcast Server will restart for an update in 5 minutes!');
      expect(events.filter(event => event.startsWith('stop'))).toEqual(['stop a @5', 'stop b @5']);
      expect(events.filter(event => event.startsWith('start'))).toEqual(['start a', 'start b']);
    });

    it('warns nobody and puts the files in place at once when no server is running', async () => {
      running.clear();

      await service.performClusterUpdate();

      expect(events).toEqual(['copy install', `steamcmd ${STAGING}`, 'put in place', 'prepare a', 'prepare b', 'remove copy']);
      expect(statuses()).toContain('complete');
    });

    it('refuses server starts from the stop until the instances are prepared', async () => {
      const seen: Array<[string, boolean]> = [];
      mockInstall.mockImplementation((done, _onProgress, _signal, dir) => {
        seen.push([`steamcmd ${dir}`, areServerFilesUpdating()]);
        done(null);
      });
      mockLifecycle.stopServerInstance.mockImplementation(async id => {
        seen.push(['stop', areServerFilesUpdating()]);
        running.delete(id);
        return { success: true };
      });
      mockStaging.putInPlace.mockImplementation(async () => { seen.push(['put in place', areServerFilesUpdating()]); });
      mockManagement.prepareInstanceConfiguration.mockImplementation(async () => { seen.push(['prepare', areServerFilesUpdating()]); });
      mockStart.mockImplementation(async id => {
        seen.push(['start', areServerFilesUpdating()]);
        return { started: true, instanceId: id };
      });

      await update();

      expect(seen).toEqual([
        [`steamcmd ${STAGING}`, false], ['stop', true], ['put in place', true], ['prepare', true], ['prepare', true], ['start', false]
      ]);
    });

    describe('when the download does not bring a new build', () => {
      it('stops nobody when SteamCMD fails', async () => {
        mockInstall.mockImplementation(done => done(new Error('Failed to download.')));

        await update();

        expect(events).toEqual(['copy install', 'remove copy']);
        expect(statuses()).toEqual(['copying', 'downloading', 'error']);
        expect(service.progress()).toMatchObject({ phase: 'error', message: 'SteamCMD could not download the update: Failed to download. No server was stopped.' });
        expect(mockRelease).toHaveBeenCalledTimes(1);
      });

      it('starts nobody when the update fails before anyone was stopped', async () => {
        mockStaging.listGameFiles.mockRejectedValue(new Error('EIO'));

        await update();

        expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
        expect(mockStart).not.toHaveBeenCalled();
        expect(statuses()).toEqual(['error']);
        expect(mockRelease).toHaveBeenCalledTimes(1);
      });

      it('stops nobody when the copy of the install cannot be made', async () => {
        mockStaging.seedStaging.mockRejectedValue(new Error('EACCES'));

        await update();

        expect(mockInstall).not.toHaveBeenCalled();
        expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
        expect(mockStaging.removeStaging).toHaveBeenCalledWith(STAGING);
        expect(service.progress()).toMatchObject({ phase: 'error' });
      });

      it('stops nobody when the build is the one already installed', async () => {
        staged = installed;

        await update();

        expect(events).toEqual(['copy install', `steamcmd ${STAGING}`, 'remove copy']);
        expect(service.progress()).toMatchObject({ phase: 'complete', message: 'ARK is already up to date (build 12345). No server was restarted.' });
      });

      it('takes Steam\'s build when SteamCMD finds nothing newer though Steam lists it', async () => {
        staged = installed;
        internals.installedBuildId = '12345';
        internals.latestBuildId = '99999';

        await update();

        expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
        expect(internals.installedBuildId).toBe('99999');
        expect(service.progress()).toMatchObject({ phase: 'error' });
      });

      // A SteamCMD that never finishes would otherwise hold the install lock for good.
      it('gives up on the download after two hours', async () => {
        mockInstall.mockImplementation((done, _onProgress, signal) => {
          signal?.addEventListener('abort', () => done(new InstallCancelledError()));
        });

        const pending = service.performClusterUpdate();
        await jest.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
        await pending;

        expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
        expect(service.progress()?.message).toContain('SteamCMD did not finish the download within 120 minutes.');
        expect(mockRelease).toHaveBeenCalled();
      });
    });

    // Refusing would leave the servers on a build new game clients cannot join.
    it('updates in place, as before, when there is no room for the copy', async () => {
      mockStaging.roomForStaging.mockReturnValue({ enough: false, needed: 80e9, free: 10e9 });

      await update();

      expect(events.filter(event => !event.startsWith('warn'))).toEqual(['stop a @5', 'steamcmd /ark', 'prepare a', 'prepare b', 'start a', 'remove copy']);
      expect(mockStaging.seedStaging).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Not enough free disk space'));
    });

    it('repairs the install with SteamCMD when the new files cannot be put in place, then starts the servers', async () => {
      mockStaging.putInPlace.mockRejectedValue(new Error('EBUSY'));

      await update();

      expect(events.filter(event => !event.startsWith('warn'))).toEqual([
        'copy install', `steamcmd ${STAGING}`, 'stop a @5', 'steamcmd /ark', 'prepare a', 'prepare b', 'start a', 'remove copy'
      ]);
      expect(statuses()).toContain('complete');
    });

    it('starts the servers again when the repair fails too', async () => {
      mockStaging.putInPlace.mockRejectedValue(new Error('EBUSY'));
      mockInstall.mockImplementation((done, _onProgress, _signal, dir) => done(dir === STAGING ? null : new Error('Failed to download.')));

      await update();

      expect(mockStart).toHaveBeenCalledWith('a', expect.any(Function), expect.any(Function));
      expect(statuses()).not.toContain('complete');
      // The card adds "ARK update failed:" itself.
      expect(service.progress()).toMatchObject({ phase: 'error', message: 'Failed to download. The servers were started again on the files they had.' });
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    describe('app exit', () => {
      it('during the warning ends the update without stopping anyone', async () => {
        const pending = service.performClusterUpdate();
        await jest.advanceTimersByTimeAsync(2 * 60_000);

        service.stop();
        await jest.advanceTimersByTimeAsync(10 * 60_000);
        await pending;

        expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
        expect(mockStaging.removeStaging).toHaveBeenCalledWith(STAGING);
        expect(mockRelease).toHaveBeenCalledTimes(1);
        expect(internals.updateScheduled).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
      });

      it('during the download stops SteamCMD and stops nobody', async () => {
        mockInstall.mockImplementation((done, _onProgress, signal) => {
          signal?.addEventListener('abort', () => done(new InstallCancelledError()));
        });

        const pending = service.performClusterUpdate();
        await jest.advanceTimersByTimeAsync(1000);
        service.stop();
        await pending;

        expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
        expect(mockStaging.removeStaging).toHaveBeenCalledWith(STAGING);
        // Ended, not failed: nothing to report as an error.
        expect(statuses()).toEqual(['copying', 'downloading']);
      });
    });

    describe('the install lock', () => {
      it('is held from the copy until the copy is removed, then released', async () => {
        mockStaging.seedStaging.mockImplementation(async () => {
          expect(mockAcquire).toHaveBeenCalled();
          return [];
        });
        mockStaging.removeStaging.mockImplementation(async () => {
          expect(mockRelease).not.toHaveBeenCalled();
        });

        await update();

        expect(mockRelease).toHaveBeenCalledTimes(1);
      });

      it('stops nothing while an install holds it', async () => {
        mockAcquire.mockReturnValue(false);

        await update();

        expect(mockStaging.seedStaging).not.toHaveBeenCalled();
        expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
        expect(mockRelease).not.toHaveBeenCalled();
        expect(messaging.sendToAll).toHaveBeenCalledWith('cluster-update-status', { status: 'error', message: INSTALL_IN_PROGRESS });
      });

      it('clears the scheduled flag when it cannot be taken at all', async () => {
        internals.updateScheduled = true;
        mockAcquire.mockImplementation(() => { throw new Error('EACCES'); });

        await expect(service.performClusterUpdate()).resolves.toBeUndefined();

        expect(internals.updateScheduled).toBe(false);
        expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
      });
    });

    it('sets the cooldown on a failed attempt too', async () => {
      mockInstall.mockImplementation(done => done(new Error('Failed to download.')));

      await update();

      expect(internals.lastUpdateAttemptTime).toBeGreaterThan(0);
    });

    it('still starts the servers when stopping them throws', async () => {
      mockProcess.getServerProcess.mockReturnValue({ pid: 1 } as unknown as ChildProcess);
      mockProcess.forceKillServerProcess.mockRejectedValue(new Error('taskkill failed'));

      await update();

      expect(mockStart).toHaveBeenCalledWith('a', expect.any(Function), expect.any(Function));
      expect(mockRelease).toHaveBeenCalled();
      expect(internals.updateScheduled).toBe(false);
    });

    // prepareInstanceConfiguration throws when an instance's save folder cannot be linked; that
    // used to abort the update and leave every server stopped.
    it('carries on past an instance it cannot prepare', async () => {
      mockManagement.prepareInstanceConfiguration.mockImplementation(async id => {
        if (id === 'b') throw new Error('Could not link SavedArks');
      });

      await update();

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ark-update] Could not prepare b'), expect.any(Error));
      expect(mockStart).toHaveBeenCalledWith('a', expect.any(Function), expect.any(Function));
      expect(statuses()).toContain('complete');
    });

    it('carries on starting when one server fails to start', async () => {
      running.add('b');
      mockStart.mockRejectedValueOnce(new Error('boom'));

      await update();

      expect(mockStart).toHaveBeenCalledWith('b', expect.any(Function), expect.any(Function));
    });

    it('force-kills a server that has not stopped after five minutes', async () => {
      mockLifecycle.stopServerInstance.mockReturnValue(new Promise(() => {}));
      mockProcess.getNormalizedInstanceState.mockReturnValue('running');

      const pending = service.performClusterUpdate();
      await jest.advanceTimersByTimeAsync(5 * 60_000 + 5 * 60_000 + 3000);
      await pending;

      expect(mockProcess.forceKillServerProcess).toHaveBeenCalledWith('a');
      expect(mockStaging.putInPlace).toHaveBeenCalled();
    });

    it('waits the configured delay between starts', async () => {
      running.add('b');
      mockConfig.mockReturnValue(config({ serverStartDelaySeconds: 30, updateWarningMinutes: 5 }));

      const pending = service.performClusterUpdate();
      await jest.advanceTimersByTimeAsync(5 * 60_000 + 29_000);
      expect(mockStart).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000);
      await pending;
      expect(mockStart).toHaveBeenCalledTimes(2);
    });

    it('says how far the copy and the download have got', async () => {
      mockStaging.seedStaging.mockImplementation(async (_from, _to, onProgress) => {
        onProgress?.(30);
        return [];
      });
      mockInstall.mockImplementation((done, onProgress) => {
        onProgress?.({ percent: 42, step: 'downloading', message: 'Downloading' });
        done(null);
      });
      const seen: Array<ReturnType<ArkUpdateService['progress']>> = [];
      messaging.sendToAll.mockImplementation(() => { seen.push(service.progress()); });

      await update();

      expect(seen).toContainEqual(expect.objectContaining({ phase: 'copying', percent: 30 }));
      expect(seen).toContainEqual(expect.objectContaining({ phase: 'downloading', percent: 42 }));
    });

    it('leaves no timer behind', async () => {
      await update();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('stop', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('clears the poll', async () => {
      jest.spyOn(service, 'pollAndNotify').mockResolvedValue(null);
      await service.initialize();
      expect(jest.getTimerCount()).toBe(1);

      service.stop();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('never holds the process open with its poll', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      jest.spyOn(service, 'pollAndNotify').mockResolvedValue(null);

      await service.initialize();

      expect(setIntervalSpy.mock.results.map(result => (result.value as NodeJS.Timeout).hasRef())).toEqual([false]);
      service.stop();
    });
  });

  // "Update ARK Server fires blind": it stopped every server at once, with no word to players and
  // nothing to show how it was going.
  describe('an update asked for on a machine', () => {
    it('starts at once, and says how long players will be warned once it is downloaded', async () => {
      mockConfig.mockReturnValue(config({ updateWarningMinutes: 15 }));
      mockManagement.getAllInstances.mockResolvedValue({ instances: [instance('a')] });
      mockProcess.getNormalizedInstanceState.mockReturnValue('running');
      const update = jest.spyOn(service, 'performClusterUpdate').mockResolvedValue();

      await expect(service.requestUpdate()).resolves.toEqual({ success: true, warningMinutes: 15 });

      expect(update).toHaveBeenCalled();
      expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
    });

    it('warns nobody when nothing is running', async () => {
      const update = jest.spyOn(service, 'performClusterUpdate').mockResolvedValue();

      await expect(service.requestUpdate()).resolves.toEqual({ success: true, warningMinutes: 0 });

      expect(update).toHaveBeenCalled();
    });

    it('refuses a second update while one is under way', async () => {
      jest.spyOn(service, 'performClusterUpdate').mockReturnValue(new Promise(() => {}));
      await service.requestUpdate();

      await expect(service.requestUpdate()).resolves.toEqual({ success: false, error: 'An ARK update is already under way on this machine.' });
    });
  });
});
