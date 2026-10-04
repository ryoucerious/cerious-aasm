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
import type { InstanceConfig } from '../types/server-instance.types';

jest.mock('../utils/ark/ark-install.utils', () => ({
  getCurrentInstalledVersion: jest.fn(),
  installArkServer: jest.fn()
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

type PrivateApi = {
  getLatestServerVersion(): Promise<string | null>;
  scheduleClusterUpdate(minutes: number): Promise<void>;
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
      const schedule = jest.spyOn(internals, 'scheduleClusterUpdate').mockResolvedValue();

      await service.pollAndNotify();

      expect(schedule).not.toHaveBeenCalled();
      expect(messaging.sendToAll).toHaveBeenCalledWith('ark-update-available', expect.objectContaining({ latest: '12346' }));
    });

    it('schedules an auto-update once the cooldown has passed', async () => {
      mockConfig.mockReturnValue(config({ autoUpdateArkServer: true, updateWarningMinutes: 5 }));
      internals.lastUpdateAttemptTime = Date.now() - 2 * 60 * 60 * 1000;
      jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');
      const schedule = jest.spyOn(internals, 'scheduleClusterUpdate').mockResolvedValue();

      await service.pollAndNotify();

      expect(schedule).toHaveBeenCalledWith(5);
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

  describe('performClusterUpdate', () => {
    it('stops the running servers, updates, prepares every instance and restarts the ones it stopped', async () => {
      mockManagement.getAllInstances.mockResolvedValue({ instances: [instance('a'), instance('b')] });
      mockInstalledVersion.mockResolvedValue('12346');

      await service.performClusterUpdate([instance('a')]);

      expect(mockLifecycle.stopServerInstance).toHaveBeenCalledWith('a');
      expect(mockInstall).toHaveBeenCalled();
      expect(mockManagement.prepareInstanceConfiguration).toHaveBeenCalledWith('a', instance('a'));
      expect(mockManagement.prepareInstanceConfiguration).toHaveBeenCalledWith('b', instance('b'));
      expect(mockStart).toHaveBeenCalledWith('a', expect.any(Function), expect.any(Function));
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(statuses()).toEqual(['stopping', 'updating', 'configuring', 'starting', 'complete']);
    });

    it('refuses server starts from the stop until the instances are prepared, then restarts them', async () => {
      const seen: Array<[string, boolean]> = [];
      mockManagement.getAllInstances.mockResolvedValue({ instances: [instance('a')] });
      mockLifecycle.stopServerInstance.mockImplementation(async () => {
        seen.push(['stop', areServerFilesUpdating()]);
        return { success: true };
      });
      mockInstall.mockImplementation(done => {
        seen.push(['steamcmd', areServerFilesUpdating()]);
        done(null);
      });
      mockManagement.prepareInstanceConfiguration.mockImplementation(async () => {
        seen.push(['prepare', areServerFilesUpdating()]);
      });
      mockStart.mockImplementation(async () => {
        seen.push(['restart', areServerFilesUpdating()]);
        return { started: true, instanceId: 'a' };
      });

      await service.performClusterUpdate([instance('a')]);

      expect(seen).toEqual([['stop', true], ['steamcmd', true], ['prepare', true], ['restart', false]]);
    });

    it('lets the servers start again when SteamCMD fails', async () => {
      mockInstall.mockImplementation(done => done(new Error('Failed to download.')));
      let startsRefused: boolean | undefined;
      mockStart.mockImplementation(async () => {
        startsRefused = areServerFilesUpdating();
        return { started: true, instanceId: 'a' };
      });

      await service.performClusterUpdate([instance('a')]);

      expect(startsRefused).toBe(false);
      expect(areServerFilesUpdating()).toBe(false);
    });

    it('also stops, and restarts, servers started since the update was scheduled', async () => {
      const stoppedIds = new Set<string>();
      const states: Record<string, string> = { warned: 'running', late: 'starting', idle: 'stopped' };
      mockManagement.getAllInstances.mockResolvedValue({ instances: [instance('warned'), instance('late'), instance('idle')] });
      mockProcess.getNormalizedInstanceState.mockImplementation(id => (stoppedIds.has(id) ? 'stopped' : states[id]));
      mockLifecycle.stopServerInstance.mockImplementation(async id => {
        stoppedIds.add(id);
        return { success: true };
      });

      await service.performClusterUpdate([instance('warned')]);

      expect(mockLifecycle.stopServerInstance.mock.calls.map(([id]) => id)).toEqual(['warned', 'late']);
      expect(mockStart.mock.calls.map(([id]) => id)).toEqual(['warned', 'late']);
    });

    it('runs SteamCMD under the install lock and releases it', async () => {
      mockInstall.mockImplementation(done => {
        expect(mockAcquire).toHaveBeenCalled();
        expect(mockRelease).not.toHaveBeenCalled();
        done(null);
      });

      await service.performClusterUpdate([]);

      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('stops nothing while an install holds the lock', async () => {
      mockAcquire.mockReturnValue(false);

      await service.performClusterUpdate([instance('a')]);

      expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
      expect(mockInstall).not.toHaveBeenCalled();
      expect(mockRelease).not.toHaveBeenCalled();
      expect(messaging.sendToAll).toHaveBeenCalledWith('cluster-update-status', { status: 'error', message: INSTALL_IN_PROGRESS });
    });

    it('clears the scheduled flag when the install lock cannot be taken at all', async () => {
      internals.updateScheduled = true;
      mockAcquire.mockImplementation(() => { throw new Error('EACCES'); });

      await expect(service.performClusterUpdate([instance('a')])).resolves.toBeUndefined();

      expect(internals.updateScheduled).toBe(false);
      expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
      expect(mockRelease).not.toHaveBeenCalled();
    });

    it('restarts the servers it stopped when SteamCMD fails', async () => {
      mockInstall.mockImplementation(done => done(new Error('Failed to download.')));

      await service.performClusterUpdate([instance('a'), instance('b')]);

      expect(mockStart).toHaveBeenCalledWith('a', expect.any(Function), expect.any(Function));
      expect(mockStart).toHaveBeenCalledWith('b', expect.any(Function), expect.any(Function));
      expect(mockManagement.prepareInstanceConfiguration).not.toHaveBeenCalled();
      expect(mockRelease).toHaveBeenCalled();
      expect(statuses()).toEqual(['stopping', 'updating', 'error', 'starting']);
    });

    it('sets the cooldown on a failed attempt too', async () => {
      mockInstall.mockImplementation(done => done(new Error('Failed to download.')));

      await service.performClusterUpdate([]);

      expect(internals.lastUpdateAttemptTime).toBeGreaterThan(0);
    });

    it('clears the scheduled flag and still restarts when stopping the servers throws', async () => {
      internals.updateScheduled = true;
      mockProcess.getServerProcess.mockReturnValue({ pid: 1 } as unknown as ChildProcess);
      mockProcess.forceKillServerProcess.mockRejectedValue(new Error('taskkill failed'));

      await expect(service.performClusterUpdate([instance('a')])).resolves.toBeUndefined();

      expect(internals.updateScheduled).toBe(false);
      expect(mockStart).toHaveBeenCalledWith('a', expect.any(Function), expect.any(Function));
      expect(mockRelease).toHaveBeenCalled();
    });

    it('takes Steam\'s build when SteamCMD finds nothing to change', async () => {
      internals.installedBuildId = '12345';
      internals.latestBuildId = '99999';

      await service.performClusterUpdate([]);

      expect(internals.installedBuildId).toBe('99999');
      expect(statuses()).toContain('warning');
    });

    // prepareInstanceConfiguration throws when an instance's save folder cannot be linked; that
    // used to abort the update and leave every server stopped.
    it('carries on past an instance it cannot prepare', async () => {
      mockManagement.getAllInstances.mockResolvedValue({ instances: [instance('broken'), instance('fine')] });
      mockManagement.prepareInstanceConfiguration.mockImplementation(async id => {
        if (id === 'broken') throw new Error('Could not link SavedArks');
      });

      await service.performClusterUpdate([instance('fine')]);

      expect(mockManagement.prepareInstanceConfiguration).toHaveBeenCalledWith('fine', instance('fine'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ark-update] Could not prepare broken'), expect.any(Error));
      expect(mockStart).toHaveBeenCalledWith('fine', expect.any(Function), expect.any(Function));
      expect(statuses()).toContain('complete');
    });

    it('carries on restarting when one server fails to start', async () => {
      mockStart.mockRejectedValueOnce(new Error('boom'));

      await service.performClusterUpdate([instance('a'), instance('b')]);

      expect(mockStart).toHaveBeenCalledWith('b', expect.any(Function), expect.any(Function));
    });

    describe('with fake timers', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('leaves no timer behind once the servers have stopped', async () => {
        await service.performClusterUpdate([instance('a')]);

        expect(jest.getTimerCount()).toBe(0);
      });

      it('force-kills the servers that have not stopped after five minutes', async () => {
        mockLifecycle.stopServerInstance.mockReturnValue(new Promise(() => {}));
        mockProcess.getNormalizedInstanceState.mockReturnValue('stopping');

        const pending = service.performClusterUpdate([instance('a')]);
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
        await jest.advanceTimersByTimeAsync(2000);
        await pending;

        expect(mockProcess.forceKillServerProcess).toHaveBeenCalledWith('a');
        expect(mockInstall).toHaveBeenCalled();
      });

      it('force-kills instances still tracked before SteamCMD, then gives the OS a moment', async () => {
        mockProcess.getNormalizedInstanceState.mockReturnValue('stopping');
        mockProcess.getServerProcess.mockReturnValue({ pid: 1234 } as unknown as ChildProcess);

        const pending = service.performClusterUpdate([instance('stuck-1')]);
        await jest.advanceTimersByTimeAsync(1999);
        expect(mockInstall).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        await pending;

        expect(mockProcess.forceKillServerProcess).toHaveBeenCalledWith('stuck-1');
        expect(mockInstall).toHaveBeenCalled();
      });

      // A SteamCMD that never finishes would otherwise keep every server down.
      it('gives up on SteamCMD after two hours and restarts the servers', async () => {
        mockInstall.mockImplementation((done, _onProgress, signal) => {
          signal?.addEventListener('abort', () => done(new InstallCancelledError()));
        });

        const pending = service.performClusterUpdate([instance('a')]);
        await jest.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - 1);
        expect(mockStart).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        await pending;

        expect(mockStart).toHaveBeenCalledWith('a', expect.any(Function), expect.any(Function));
        expect(statuses()).toContain('error');
        expect(console.error).toHaveBeenCalledWith('[ark-update] Update failed:', expect.objectContaining({
          message: 'SteamCMD did not finish the update within 120 minutes.'
        }));
        expect(mockRelease).toHaveBeenCalled();
      });

      it('leaves no timer behind once SteamCMD has finished', async () => {
        await service.performClusterUpdate([]);

        expect(mockInstall.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
        expect(jest.getTimerCount()).toBe(0);
      });

      it('waits the configured delay between restarts', async () => {
        mockConfig.mockReturnValue(config({ serverStartDelaySeconds: 30 }));

        const pending = service.performClusterUpdate([instance('a'), instance('b')]);
        await jest.advanceTimersByTimeAsync(29 * 1000);
        expect(mockStart).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1000);
        await pending;
        expect(mockStart).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('stop', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('clears the poll and a pending update countdown', async () => {
      jest.spyOn(service, 'pollAndNotify').mockResolvedValue(null);
      const update = jest.spyOn(service, 'performClusterUpdate').mockResolvedValue();
      await service.initialize();
      await internals.scheduleClusterUpdate(5);
      expect(jest.getTimerCount()).toBe(2);

      service.stop();

      expect(jest.getTimerCount()).toBe(0);
      expect(internals.updateScheduled).toBe(false);
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(update).not.toHaveBeenCalled();
    });

    it('never holds the process open with its timers', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      jest.spyOn(service, 'pollAndNotify').mockResolvedValue(null);

      await service.initialize();
      await internals.scheduleClusterUpdate(5);

      expect(setIntervalSpy.mock.results.map(result => (result.value as NodeJS.Timeout).hasRef())).toEqual([false, false]);
      service.stop();
    });
  });

  describe('scheduleClusterUpdate', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('clears the scheduled flag when the running servers cannot be listed', async () => {
      mockManagement.getAllInstances.mockRejectedValue(new Error('boom'));

      await expect(internals.scheduleClusterUpdate(5)).rejects.toThrow('boom');

      expect(internals.updateScheduled).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('warns the running servers each minute, then runs the update', async () => {
      mockManagement.getAllInstances.mockResolvedValue({ instances: [instance('a'), instance('idle')] });
      mockProcess.getNormalizedInstanceState.mockImplementation(id => (id === 'a' ? 'running' : 'stopped'));
      const update = jest.spyOn(service, 'performClusterUpdate').mockResolvedValue();

      await internals.scheduleClusterUpdate(2);
      await jest.advanceTimersByTimeAsync(2 * 60 * 1000);

      expect(rconService.executeRconCommand).toHaveBeenCalledWith('a', 'Broadcast Server will restart for update in 2 minute(s).');
      expect(rconService.executeRconCommand).toHaveBeenCalledWith('a', 'Broadcast Server will restart for update in 1 minute(s).');
      expect(rconService.executeRconCommand).not.toHaveBeenCalledWith('idle', expect.anything());
      expect(update).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(update).toHaveBeenCalledWith([instance('a')]);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
