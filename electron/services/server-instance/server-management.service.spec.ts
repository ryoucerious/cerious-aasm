jest.mock('../../utils/ark/instance.utils', () => ({
  getAllInstances: jest.fn(),
  getInstance: jest.fn(),
  saveInstance: jest.fn(),
  deleteInstance: jest.fn(),
  getInstanceDir: jest.fn((id: string) => `/instances/${id}`)
}));
jest.mock('../../utils/crypto.utils', () => ({ generateRandomPassword: jest.fn(() => 'generated_password') }));
jest.mock('../../utils/platform.utils', () => ({ getProcessMemoryUsage: jest.fn() }));
jest.mock('../../utils/ark/ark-server/ark-server-paths.utils', () => ({
  getArkServerDir: jest.fn(() => '/ark'),
  getInstanceRuntimeRoot: jest.fn((id: string) => `/instances/${id}`)
}));
jest.mock('../../utils/ark/ark-server/ark-server-isolation.utils', () => ({
  isInstanceOwnedWin64File: jest.fn(() => false),
  linkInstanceSaveDir: jest.fn(async () => false),
  linkSharedShooterGameSubdirs: jest.fn(async () => []),
  linkSharedWin64Subdirs: jest.fn(async () => [])
}));
jest.mock('../ark-config.service', () => ({ arkConfigService: { writeArkConfigFiles: jest.fn() } }));
jest.mock('../clusters/cluster-import', () => ({ carryClusterData: jest.fn() }));
jest.mock('../backup/backup.service', () => ({
  backupService: {
    importBackupAsNewServer: jest.fn(),
    stopBackupScheduler: jest.fn(),
    startBackupScheduler: jest.fn(async () => ({ success: true })),
    waitForBackupOperations: jest.fn(async () => undefined)
  }
}));
jest.mock('../../utils/server-ports.utils', () => ({
  getServerPortRanges: jest.fn(() => ({
    ranges: { game: { start: 7777, end: 7900 }, query: { start: 27015, end: 27030 }, rcon: { start: 27020, end: 27050 } },
    source: 'settings'
  }))
}));
jest.mock('../scheduler.service', () => ({ schedulerService: { initSchedule: jest.fn(async () => undefined), stopScheduler: jest.fn() } }));
jest.mock('../whitelist.service', () => ({
  whitelistService: { writeWhitelistFile: jest.fn(() => ({ success: true })), copyWhitelistToMainDir: jest.fn(() => ({ success: true })) }
}));
jest.mock('./server-process.service', () => ({
  serverProcessService: {
    getNormalizedInstanceState: jest.fn(),
    getServerProcess: jest.fn(),
    getProcessStartTime: jest.fn(),
    stopServerProcess: jest.fn()
  }
}));
jest.mock('./server-monitoring.service', () => ({
  serverMonitoringService: {
    getLatestPlayerCount: jest.fn(),
    getLatestCpuPercent: jest.fn(),
    stopPlayerPolling: jest.fn(),
    stopMemoryPolling: jest.fn(),
    stopCpuPolling: jest.fn()
  }
}));

import * as fs from 'fs';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { generateRandomPassword } from '../../utils/crypto.utils';
import { getProcessMemoryUsage } from '../../utils/platform.utils';
import { linkInstanceSaveDir } from '../../utils/ark/ark-server/ark-server-isolation.utils';
import { arkConfigService } from '../ark-config.service';
import { carryClusterData } from '../clusters/cluster-import';
import { backupService } from '../backup/backup.service';
import { schedulerService } from '../scheduler.service';
import { whitelistService } from '../whitelist.service';
import { serverProcessService } from './server-process.service';
import { serverMonitoringService } from './server-monitoring.service';
import { serverManagementService } from './server-management.service';
import type { InstanceConfig } from '../../types/server-instance.types';

const mockInstanceUtils = jest.mocked(instanceUtils);
const mockProcess = jest.mocked(serverProcessService);
const mockMonitoring = jest.mocked(serverMonitoringService);

describe('ServerManagementService', () => {
  describe('getAllInstances', () => {
    it('adds the live state, memory, CPU, uptime and players', async () => {
      mockInstanceUtils.getAllInstances.mockResolvedValue([{ id: 'a1', name: 'Alpha' }]);
      mockProcess.getNormalizedInstanceState.mockReturnValue('running');
      mockProcess.getServerProcess.mockReturnValue({ pid: 123 } as never);
      mockProcess.getProcessStartTime.mockReturnValue(1700000000000);
      jest.mocked(getProcessMemoryUsage).mockResolvedValue(512);
      mockMonitoring.getLatestCpuPercent.mockReturnValue(7.5);
      mockMonitoring.getLatestPlayerCount.mockReturnValue(5);

      await expect(serverManagementService.getAllInstances()).resolves.toEqual({
        instances: [{ id: 'a1', name: 'Alpha', state: 'running', memory: 512, cpu: 7.5, startedAt: 1700000000000, players: 5 }]
      });
      expect(getProcessMemoryUsage).toHaveBeenCalledWith(123);
    });

    it('leaves the live figures empty for a stopped server', async () => {
      mockInstanceUtils.getAllInstances.mockResolvedValue([{ id: 'a1', name: 'Alpha' }]);
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');
      mockProcess.getServerProcess.mockReturnValue(null);
      mockMonitoring.getLatestPlayerCount.mockReturnValue(0);

      await expect(serverManagementService.getAllInstances()).resolves.toEqual({
        instances: [{ id: 'a1', name: 'Alpha', state: 'stopped', memory: undefined, cpu: null, startedAt: null, players: 0 }]
      });
    });

    it('returns an empty list when reading fails', async () => {
      mockInstanceUtils.getAllInstances.mockRejectedValue(new Error('EACCES'));

      await expect(serverManagementService.getAllInstances()).resolves.toEqual({ instances: [] });
    });
  });

  describe('getInstance', () => {
    it('returns the instance', async () => {
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha' });

      await expect(serverManagementService.getInstance('a1')).resolves.toEqual({ instance: { id: 'a1', name: 'Alpha' } });
    });

    it('returns null for an empty id or a failed read', async () => {
      mockInstanceUtils.getInstance.mockImplementation(() => { throw new Error('Invalid instance ID format'); });

      await expect(serverManagementService.getInstance('')).resolves.toEqual({ instance: null });
      await expect(serverManagementService.getInstance('../x')).resolves.toEqual({ instance: null });
    });
  });

  describe('saveInstance', () => {
    const saved = { id: 'a1', name: 'Alpha' };

    beforeEach(() => {
      mockInstanceUtils.saveInstance.mockResolvedValue(saved);
      mockInstanceUtils.getInstance.mockReturnValue(null);
    });

    it('saves and resyncs the broadcast schedule', async () => {
      await expect(serverManagementService.saveInstance({ id: 'a1', name: 'Alpha' })).resolves.toEqual({ success: true, instance: saved });
      expect(schedulerService.initSchedule).toHaveBeenCalledWith('a1');
    });

    it.each([
      ['no object', null, 'Invalid instance object'],
      ['a bad id', { id: '../x' }, 'Invalid instance ID'],
      ['a bad name', { id: 'a1', name: 'x'.repeat(101) }, 'Invalid server name'],
      ['a bad port', { id: 'a1', port: 80 }, 'Invalid port number'],
      // The Discord tab saves through here; the URL is posted to from the host.
      ['a webhook URL that is not Discord\'s', { id: 'a1', discordConfig: { enabled: true, webhookUrl: 'http://10.0.0.1/hook' } },
        'The Discord webhook URL must be a Discord webhook link, such as https://discord.com/api/webhooks/...']
    ])('refuses %s', async (_label, instance, error) => {
      await expect(serverManagementService.saveInstance(instance as Partial<InstanceConfig> | null)).resolves.toEqual({ success: false, error });
      expect(mockInstanceUtils.saveInstance).not.toHaveBeenCalled();
    });

    // The ranges are what this machine's firewall opens: a port moved outside them can't be reached.
    describe('ports outside this machine\'s server ports', () => {
      const stored = { id: 'a1', name: 'Alpha', gamePort: 7777, queryPort: 27015, rconPort: 27020 };

      beforeEach(() => mockInstanceUtils.getInstance.mockReturnValue(stored));

      it('refuses a game port moved outside them', async () => {
        await expect(serverManagementService.saveInstance({ ...stored, gamePort: 7967 })).resolves.toEqual({
          success: false,
          error: 'The game port 7967 is outside this machine\'s game ports (7777–7900). Pick one inside them, or widen them in Settings → Server ports.'
        });
        expect(mockInstanceUtils.saveInstance).not.toHaveBeenCalled();
      });

      it('refuses a game port at the top of the range, which pushes the peer port out', async () => {
        await expect(serverManagementService.saveInstance({ ...stored, gamePort: 7900 })).resolves.toEqual({
          success: false,
          error: 'The peer port 7901, always the game port + 1, is outside this machine\'s game ports (7777–7900). Pick one inside them, or widen them in Settings → Server ports.'
        });
      });

      it('refuses query and RCON ports moved outside theirs', async () => {
        await expect(serverManagementService.saveInstance({ ...stored, rconPort: 27100 })).resolves.toEqual(expect.objectContaining({
          error: 'The RCON port 27100 is outside this machine\'s RCON ports (27020–27050). Pick one inside them, or widen them in Settings → Server ports.'
        }));
        await expect(serverManagementService.saveInstance({ ...stored, queryPort: '27100' } as Partial<InstanceConfig>)).resolves.toEqual(expect.objectContaining({
          error: 'The query port 27100 is outside this machine\'s query ports (27015–27030). Pick one inside them, or widen them in Settings → Server ports.'
        }));
      });

      // Servers from before the ranges, or moved since they changed, keep working and saving.
      it('lets a server keep ports it already had outside them', async () => {
        mockInstanceUtils.getInstance.mockReturnValue({ ...stored, gamePort: 7967 });

        await expect(serverManagementService.saveInstance({ ...stored, gamePort: 7967, name: 'Alpha 2', rconPort: 27021 }))
          .resolves.toEqual({ success: true, instance: saved });
      });

      it('leaves a new server to take ports inside them when it is saved', async () => {
        mockInstanceUtils.getInstance.mockReturnValue(null);

        await expect(serverManagementService.saveInstance({ name: 'New', gamePort: 7967 })).resolves.toEqual({ success: true, instance: saved });
      });
    });

    // Refused at send time instead: an old URL must not lock the user out of every other setting.
    it('an unchanged stored invalid URL does not block the save', async () => {
      const discordConfig = { enabled: false, webhookUrl: 'http://10.0.0.1/hook' };
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha', discordConfig });

      await expect(serverManagementService.saveInstance({ id: 'a1', name: 'Renamed', discordConfig }))
        .resolves.toEqual({ success: true, instance: saved });
    });

    it('checks a URL that differs from the stored one', async () => {
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', discordConfig: { enabled: true, webhookUrl: 'http://10.0.0.1/hook' } });

      await expect(serverManagementService.saveInstance({ id: 'a1', discordConfig: { enabled: true, webhookUrl: 'http://10.0.0.2/hook' } }))
        .resolves.toEqual({ success: false, error: 'The Discord webhook URL must be a Discord webhook link, such as https://discord.com/api/webhooks/...' });
    });

    it('passes on a refused save', async () => {
      mockInstanceUtils.saveInstance.mockResolvedValue({ error: 'A server with this name already exists.' });

      await expect(serverManagementService.saveInstance({ id: 'a1', name: 'Taken' }))
        .resolves.toEqual({ success: false, error: 'A server with this name already exists.' });
    });

    it('reports a save that throws', async () => {
      mockInstanceUtils.saveInstance.mockRejectedValue(new Error('EACCES'));

      await expect(serverManagementService.saveInstance({ id: 'a1' })).resolves.toEqual({ success: false, error: 'EACCES' });
    });

    it('writes the whitelist file from the player list', async () => {
      await serverManagementService.saveInstance({
        id: 'a1',
        useExclusiveList: true,
        exclusiveJoinPlayers: [{ playerId: 'p1' }, { playerId: ' ' }, { playerId: 'p2' }]
      });

      expect(whitelistService.writeWhitelistFile).toHaveBeenCalledWith('a1', ['p1', 'p2']);
    });
  });

  describe('deleteInstance', () => {
    beforeEach(() => {
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1' });
      mockInstanceUtils.deleteInstance.mockReturnValue(true);
      jest.mocked(backupService.waitForBackupOperations).mockResolvedValue(undefined);
    });

    // The backup schedule and CPU polling used to outlive the instance: the schedule raised a
    // failed-backup toast on every run, for good.
    it('stops everything that runs on a timer for the instance, then deletes', async () => {
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');

      await expect(serverManagementService.deleteInstance('a1')).resolves.toEqual({ success: true, id: 'a1' });
      expect(mockMonitoring.stopPlayerPolling).toHaveBeenCalledWith('a1');
      expect(mockMonitoring.stopMemoryPolling).toHaveBeenCalledWith('a1');
      expect(mockMonitoring.stopCpuPolling).toHaveBeenCalledWith('a1');
      expect(schedulerService.stopScheduler).toHaveBeenCalledWith('a1');
      expect(backupService.stopBackupScheduler).toHaveBeenCalledWith('a1');
      expect(mockProcess.stopServerProcess).not.toHaveBeenCalled();
    });

    it('stops the schedules before a running server, whose stop can take minutes', async () => {
      mockProcess.getNormalizedInstanceState.mockReturnValue('running');

      await serverManagementService.deleteInstance('a1');

      expect(jest.mocked(backupService.stopBackupScheduler).mock.invocationCallOrder[0])
        .toBeLessThan(mockProcess.stopServerProcess.mock.invocationCallOrder[0]);
    });

    it('stops a running server first', async () => {
      mockProcess.getNormalizedInstanceState.mockReturnValue('running');

      await serverManagementService.deleteInstance('a1');

      expect(mockProcess.stopServerProcess).toHaveBeenCalledWith('a1');
    });

    // A backup still being written reads the directory, and a restore still running rewrites it.
    it('waits for a backup or restore of the instance before removing its directory', async () => {
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');
      let finishBackup: () => void = () => undefined;
      jest.mocked(backupService.waitForBackupOperations).mockReturnValue(new Promise<void>(resolve => { finishBackup = resolve; }));

      const deleting = serverManagementService.deleteInstance('a1');
      await new Promise(resolve => setImmediate(resolve));
      expect(backupService.waitForBackupOperations).toHaveBeenCalledWith('a1');
      expect(mockInstanceUtils.deleteInstance).not.toHaveBeenCalled();

      finishBackup();
      await expect(deleting).resolves.toEqual({ success: true, id: 'a1' });
      expect(mockInstanceUtils.deleteInstance).toHaveBeenCalledWith('a1');
    });

    it('re-arms the schedules it stopped when the delete fails and the instance is still there', async () => {
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');
      mockInstanceUtils.deleteInstance.mockImplementation(() => { throw new Error('EBUSY'); });

      await expect(serverManagementService.deleteInstance('a1')).resolves.toEqual({ success: false, id: 'a1' });

      expect(backupService.startBackupScheduler).toHaveBeenCalledWith('a1');
      expect(schedulerService.initSchedule).toHaveBeenCalledWith('a1');
    });

    it('re-arms nothing when the instance went with the failed delete', async () => {
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');
      mockInstanceUtils.deleteInstance.mockImplementation(() => {
        mockInstanceUtils.getInstance.mockReturnValue(null);
        throw new Error('EBUSY');
      });

      await serverManagementService.deleteInstance('a1');

      expect(backupService.startBackupScheduler).not.toHaveBeenCalled();
    });

    it.each([
      ['an invalid id', '../x', () => undefined],
      ['a missing instance', 'a1', () => mockInstanceUtils.getInstance.mockReturnValue(null)],
      ['a failed delete', 'a1', () => mockInstanceUtils.deleteInstance.mockReturnValue(false)],
      ['a read that throws', 'a1', () => mockInstanceUtils.getInstance.mockImplementation(() => { throw new Error('EACCES'); })]
    ])('reports %s', async (_label, id, arrange) => {
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');
      arrange();

      await expect(serverManagementService.deleteInstance(id)).resolves.toEqual({ success: false, id });
    });
  });

  describe('importFromBackup', () => {
    it('imports the backup as a new server', async () => {
      jest.mocked(backupService.importBackupAsNewServer).mockResolvedValue({ id: 'b2', name: 'Imported' } as never);

      await expect(serverManagementService.importFromBackup('/backups/a.zip', 'Imported'))
        .resolves.toEqual({ success: true, instance: { id: 'b2', name: 'Imported' } });
    });

    it.each([
      ['path', '', 'Imported', 'Invalid backup path'],
      ['name', '/backups/a.zip', '', 'Invalid instance name']
    ])('refuses a missing %s', async (_label, backupPath, name, error) => {
      await expect(serverManagementService.importFromBackup(backupPath, name)).resolves.toEqual({ success: false, error });
    });

    it('reports a failed import', async () => {
      jest.mocked(backupService.importBackupAsNewServer).mockRejectedValueOnce(new Error('Import error'));

      await expect(serverManagementService.importFromBackup('/backups/a.zip', 'Imported'))
        .resolves.toEqual({ success: false, error: 'Import error' });
    });
  });

  describe('prepareInstanceConfiguration', () => {
    beforeEach(() => {
      jest.mocked(fs.existsSync).mockReturnValue(false);
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha' });
      mockInstanceUtils.saveInstance.mockResolvedValue({ id: 'a1', name: 'Alpha', rconPassword: 'generated_password' });
    });

    // Start All passes the list entry, with state, memory and players merged in; writing that
    // object put runtime fields into config.json.
    it('saves a generated RCON password into the stored config, not the live object', async () => {
      const live = { id: 'a1', name: 'Alpha', state: 'running', memory: 512, players: 3 };

      await serverManagementService.prepareInstanceConfiguration('a1', live);

      expect(generateRandomPassword).toHaveBeenCalledWith(16);
      expect(live).toHaveProperty('rconPassword', 'generated_password');
      expect(mockInstanceUtils.saveInstance).toHaveBeenCalledWith({ id: 'a1', name: 'Alpha', rconPassword: 'generated_password' });
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('keeps an existing RCON password', async () => {
      await serverManagementService.prepareInstanceConfiguration('a1', { id: 'a1', rconPassword: 'existing' });

      expect(generateRandomPassword).not.toHaveBeenCalled();
      expect(mockInstanceUtils.saveInstance).not.toHaveBeenCalled();
    });

    it('carries on when the password cannot be saved', async () => {
      mockInstanceUtils.saveInstance.mockRejectedValue(new Error('EACCES'));

      await expect(serverManagementService.prepareInstanceConfiguration('a1', { id: 'a1' })).resolves.toBeUndefined();
      expect(arkConfigService.writeArkConfigFiles).toHaveBeenCalled();
    });

    it('writes the INI files and copies the whitelist', async () => {
      const instance = { id: 'a1', rconPassword: 'pw', useExclusiveList: true };

      await serverManagementService.prepareInstanceConfiguration('a1', instance);

      expect(arkConfigService.writeArkConfigFiles).toHaveBeenCalledWith('/instances/a1', instance, 'a1');
      expect(whitelistService.copyWhitelistToMainDir).toHaveBeenCalledWith('a1');
    });

    it('brings the transfer data the server had under its own cluster ID into the cluster it chose', async () => {
      const instance = { id: 'a1', rconPassword: 'pw', clusterRef: 'c1', clusterId: 'Old' };

      await serverManagementService.prepareInstanceConfiguration('a1', instance);

      expect(carryClusterData).toHaveBeenCalledWith(instance, { instanceDir: '/instances/a1', runtimeRoot: '/instances/a1' });
    });

    // A copied SavedArks takes ARK's writes while backups keep reading the canonical folder.
    it('fails the start when the save folder cannot be linked', async () => {
      jest.mocked(linkInstanceSaveDir).mockRejectedValueOnce(new Error('Could not link SavedArks'));

      await expect(serverManagementService.prepareInstanceConfiguration('a1', { id: 'a1', rconPassword: 'pw' }))
        .rejects.toThrow('Could not link SavedArks');
      expect(linkInstanceSaveDir).toHaveBeenCalledWith('/instances/a1', '/instances/a1');
    });
  });
});
