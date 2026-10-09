import { messagingService } from '../services/messaging.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { getStandardEventCallbacks } from '../services/server-instance/instance-events';
import { serverLifecycleService } from '../services/server-instance/server-lifecycle.service';
import { serverProcessService } from '../services/server-instance/server-process.service';
import { serverMonitoringService } from '../services/server-instance/server-monitoring.service';
import { serverOperationsService } from '../services/server-instance/server-operations.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import { automationService } from '../services/automation/automation.service';
import { arkConfigService } from '../services/ark-config.service';
import { rconService } from '../services/rcon.service';
import { activityLogService } from '../services/activity-log.service';
import { identifySender } from '../services/auth/permission-gate';
import { userDatabaseService } from '../services/auth/user-database.service';
import * as instanceUtils from '../utils/ark/instance.utils';
import { getNormalizedInstanceState } from '../utils/ark/ark-server/ark-server-state.utils';
import { meshService } from '../services/mesh/mesh-service';
import { noteLocalNode } from '../services/mesh/mesh-hooks';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn(), sendToAll: jest.fn(), sendToAllOthers: jest.fn() }
}));
jest.mock('../services/server-instance/server-instance.service', () => ({
  serverInstanceService: {
    forceStopInstance: jest.fn(),
    startServerInstance: jest.fn(),
    importServerFromBackup: jest.fn(),
    broadcastInstances: jest.fn(),
    deleteInstance: jest.fn()
  }
}));
jest.mock('../services/server-instance/instance-events', () => ({ getStandardEventCallbacks: jest.fn() }));
jest.mock('../services/server-instance/server-lifecycle.service', () => ({
  serverLifecycleService: { stopServerInstance: jest.fn(), startAllInstances: jest.fn(), stopAllInstances: jest.fn() }
}));
jest.mock('../services/server-instance/server-process.service', () => ({
  serverProcessService: { getNormalizedInstanceState: jest.fn(), setInstanceState: jest.fn() }
}));
jest.mock('../services/server-instance/server-monitoring.service', () => ({
  serverMonitoringService: { getInstanceLogs: jest.fn(), getPlayerCount: jest.fn(), startPlayerPolling: jest.fn(), stopPlayerPolling: jest.fn() }
}));
jest.mock('../services/server-instance/server-operations.service', () => ({
  serverOperationsService: { connectRcon: jest.fn(), disconnectRcon: jest.fn(), getRconStatus: jest.fn(), executeRconCommand: jest.fn() }
}));
jest.mock('../services/server-instance/server-management.service', () => ({
  serverManagementService: { getAllInstances: jest.fn(), getInstance: jest.fn(), saveInstance: jest.fn(), deleteInstance: jest.fn() }
}));
jest.mock('../services/automation/automation.service', () => ({ automationService: { setManuallyStopped: jest.fn() } }));
jest.mock('../utils/ark/started-config.utils', () => ({ readStartedConfig: jest.fn() }));
jest.mock('../services/backup/backup-copies.service', () => ({ backupCopies: { heldPath: jest.fn(() => null) } }));
import { backupCopies } from '../services/backup/backup-copies.service';
import { readStartedConfig } from '../utils/ark/started-config.utils';
jest.mock('../services/automation/restart-countdown.service', () => ({
  restartCountdowns: { begin: jest.fn(() => 900_000), cancel: jest.fn(() => true), cancelAll: jest.fn(() => ['a']), pending: jest.fn(() => []) }
}));
import { restartCountdowns } from '../services/automation/restart-countdown.service';
jest.mock('../services/ark-config.service', () => ({
  arkConfigService: { readIniFile: jest.fn(), writeIniFile: jest.fn(), parseIniToConfig: jest.fn() }
}));
jest.mock('../services/rcon.service', () => ({ rconService: { getOnlinePlayers: jest.fn() } }));
jest.mock('../services/activity-log.service', () => ({ activityLogService: { record: jest.fn() } }));
jest.mock('../services/auth/permission-gate', () => ({
  identifySender: jest.fn(),
  isDesktopWindow: jest.requireActual('../services/auth/permission-gate').isDesktopWindow
}));
jest.mock('../utils/ark/instance.utils', () => ({ getInstance: jest.fn(), saveInstance: jest.fn() }));
jest.mock('../services/auth/user-database.service', () => ({ userDatabaseService: { getUser: jest.fn() } }));
jest.mock('../utils/ark/ark-server/ark-server-state.utils', () => ({ getNormalizedInstanceState: jest.fn() }));
// A standalone install unless a test says otherwise: every server is local.
jest.mock('../services/mesh/mesh-service', () => ({
  meshService: {
    forwardIfRemote: jest.fn(async () => null),
    noteDesired: jest.fn(async () => undefined),
    withMeshServers: jest.fn(async (instances: unknown[]) => instances),
    remoteInstance: jest.fn(async () => null),
    saveElsewhere: jest.fn(async () => null),
    hostsOf: jest.fn(async (ids: string[]) => ({ local: ids, remote: new Map() })),
    commandHosts: jest.fn(async () => []),
    recordServer: jest.fn(async () => undefined),
    deleteHostedServer: jest.fn(async (_id: string, deleteLocal: () => Promise<unknown>) => deleteLocal()),
    queryRemote: jest.fn(async () => null)
  }
}));

const mockMessaging = jest.mocked(messagingService);
const mockInstance = jest.mocked(serverInstanceService);
const mockLifecycle = jest.mocked(serverLifecycleService);
const mockProcess = jest.mocked(serverProcessService);
const mockMonitoring = jest.mocked(serverMonitoringService);
const mockOperations = jest.mocked(serverOperationsService);
const mockManagement = jest.mocked(serverManagementService);
const mockArkConfig = jest.mocked(arkConfigService);
const mockInstanceUtils = jest.mocked(instanceUtils);
const mockUsers = jest.mocked(userDatabaseService);
const mockMesh = jest.mocked(meshService);

const DESKTOP: ReturnType<typeof identifySender> = { user: null, permissions: [], isAdmin: true, isLocalDesktop: true };
function operatorIdentity(id: string, permissions: string[] = ['servers.view', 'servers.control', 'servers.create', 'servers.configure']): ReturnType<typeof identifySender> {
  return {
    user: { id, username: id, displayName: id, roleId: 'operator', roleName: 'Operator', ownerUserId: null, active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null, permissions: permissions as never },
    permissions: permissions as never, isAdmin: false, isLocalDesktop: false
  };
}

/** Looks after machine n1; sees every server, changes only n1's. */
function machineAdminIdentity(): ReturnType<typeof identifySender> {
  const permissions = ['servers.view', 'servers.control', 'servers.create', 'servers.configure'];
  return {
    user: {
      id: 'ma', username: 'ma', displayName: 'ma', roleId: 'machine-admin', roleName: 'Machine Admin', ownerUserId: null, machineNodeId: 'n1',
      active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null, permissions: permissions as never
    },
    permissions: permissions as never, isAdmin: false, isLocalDesktop: false
  };
}

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

// What the real services throw when a payload field is missing.
const missingField = new TypeError("Cannot read properties of undefined (reading 'includes')");

describe('server-instance-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./server-instance-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    jest.mocked(identifySender).mockReturnValue(DESKTOP);
  });

  function request(channel: string, payload?: unknown): Promise<void> {
    return handlers[channel](payload, sender);
  }

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  function broadcasts(channel: string): unknown[] {
    return mockMessaging.sendToAll.mock.calls.filter(([broadcastChannel]) => broadcastChannel === channel).map(call => call[1]);
  }

  function replyOrder(channel: string): number {
    const index = mockMessaging.sendToOriginator.mock.calls.findIndex(([replyChannel]) => replyChannel === channel);
    return mockMessaging.sendToOriginator.mock.invocationCallOrder[index];
  }

  describe('get-ini-file', () => {
    it('replies with the file', async () => {
      mockArkConfig.readIniFile.mockReturnValue('[ServerSettings]');

      await request('get-ini-file', { instanceId: 'a1', filename: 'Game.ini', requestId: 'r1' });

      expect(mockArkConfig.readIniFile).toHaveBeenCalledWith('a1', 'Game.ini');
      expect(replies('get-ini-file')).toEqual([
        { success: true, content: '[ServerSettings]', instanceId: 'a1', filename: 'Game.ini', requestId: 'r1' }
      ]);
    });

    it('replies with the reason reading fails', async () => {
      mockArkConfig.readIniFile.mockImplementation(() => { throw new Error('Invalid instance ID'); });

      await request('get-ini-file', { instanceId: '../x', filename: 'Game.ini', requestId: 'r1' });

      expect(replies('get-ini-file')).toEqual([{ success: false, error: 'Invalid instance ID', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockArkConfig.readIniFile.mockImplementation(() => { throw missingField; });

      await request('get-ini-file', undefined);

      expect(replies('get-ini-file')).toEqual([{ success: false, error: missingField.message, requestId: undefined }]);
    });
  });

  describe('save-ini-file', () => {
    beforeEach(() => {
      mockArkConfig.writeIniFile.mockReset();
      mockInstanceUtils.getInstance.mockReset();
    });

    it('writes the file and merges its settings into the instance through instance.utils', async () => {
      const saved = { id: 'a1', name: 'Alpha', maxPlayers: 20 };
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha', maxPlayers: 10 });
      mockArkConfig.parseIniToConfig.mockReturnValue({ maxPlayers: 20 });
      mockInstanceUtils.saveInstance.mockResolvedValue(saved);

      await request('save-ini-file', { instanceId: 'a1', filename: 'GameUserSettings.ini', content: 'MaxPlayers=20', requestId: 'r1' });

      expect(mockArkConfig.writeIniFile).toHaveBeenCalledWith('a1', 'GameUserSettings.ini', 'MaxPlayers=20');
      expect(mockArkConfig.parseIniToConfig).toHaveBeenCalledWith('GameUserSettings.ini', 'MaxPlayers=20');
      expect(mockInstanceUtils.saveInstance).toHaveBeenCalledWith(saved);
      expect(broadcasts('server-instance-updated')).toEqual([saved]);
      expect(replies('save-ini-file')).toEqual([{ success: true, instanceId: 'a1', filename: 'GameUserSettings.ini', requestId: 'r1' }]);
    });

    it('leaves an instance without a config alone', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(null);

      await request('save-ini-file', { instanceId: 'a1', filename: 'Game.ini', content: '', requestId: 'r1' });

      expect(mockInstanceUtils.saveInstance).not.toHaveBeenCalled();
      expect(replies('save-ini-file')).toEqual([{ success: true, instanceId: 'a1', filename: 'Game.ini', requestId: 'r1' }]);
    });

    it('still reports the saved file when the merge fails, without logging the config', async () => {
      mockInstanceUtils.getInstance.mockImplementation(() => { throw new SyntaxError('Unexpected token "rconPassword": "hunter2"'); });

      await request('save-ini-file', { instanceId: 'a1', filename: 'Game.ini', content: '', requestId: 'r1' });

      expect(replies('save-ini-file')).toEqual([{ success: true, instanceId: 'a1', filename: 'Game.ini', requestId: 'r1' }]);
      expect(broadcasts('server-instance-updated')).toEqual([]);
      expect(console.warn).toHaveBeenCalled();
      expect(JSON.stringify(jest.mocked(console.warn).mock.calls)).not.toContain('hunter2');
    });

    it('does not broadcast a merge the instance store refused', async () => {
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha' });
      mockArkConfig.parseIniToConfig.mockReturnValue({});
      mockInstanceUtils.saveInstance.mockResolvedValue({ error: 'A server with this name already exists.' });

      await request('save-ini-file', { instanceId: 'a1', filename: 'Game.ini', content: '', requestId: 'r1' });

      expect(broadcasts('server-instance-updated')).toEqual([]);
      expect(replies('save-ini-file')).toEqual([{ success: true, instanceId: 'a1', filename: 'Game.ini', requestId: 'r1' }]);
    });

    it('replies with the reason writing fails and merges nothing', async () => {
      mockArkConfig.writeIniFile.mockImplementation(() => { throw new Error('Invalid filename. Must be a .ini file.'); });

      await request('save-ini-file', { instanceId: 'a1', filename: 'x.txt', content: '', requestId: 'r1' });

      expect(mockInstanceUtils.getInstance).not.toHaveBeenCalled();
      expect(replies('save-ini-file')).toEqual([{ success: false, error: 'Invalid filename. Must be a .ini file.', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockArkConfig.writeIniFile.mockImplementation(() => { throw missingField; });

      await request('save-ini-file', undefined);

      expect(replies('save-ini-file')).toEqual([{ success: false, error: missingField.message, requestId: undefined }]);
    });
  });

  // Players hear the same countdown a scheduled restart gives them, unless it is now.
  describe('restarting with a warning', () => {
    const countdowns = jest.mocked(restartCountdowns);

    beforeEach(() => {
      countdowns.begin.mockClear();
      mockMesh.forwardIfRemote.mockResolvedValue(null);
    });

    it('counts down on a server here, then restarts it', async () => {
      await request('restart-server-instance', { id: 'a', warningMinutes: 15, requestId: 'r1' });

      expect(countdowns.begin).toHaveBeenCalledWith(['a'], 15, false, expect.any(Function));
      expect(replies('restart-server-instance')).toContainEqual({ success: true, instanceId: 'a', dueAt: 900_000, requestId: 'r1' });
      expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
    });

    it('asks the machine hosting the server to count down', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true });

      await request('restart-server-instance', { id: 'a', warningMinutes: 15, requestId: 'r1' });

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('restart', 'a', 'desktop', { warningMinutes: 15 });
      expect(countdowns.begin).not.toHaveBeenCalled();
    });

    it('cancels a server\'s restart here, or on the machine hosting it', async () => {
      await request('cancel-server-restart', { id: 'a', requestId: 'r1' });
      expect(countdowns.cancel).toHaveBeenCalledWith('a');
      expect(replies('cancel-server-restart')).toContainEqual({ success: true, instanceId: 'a', requestId: 'r1' });

      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true });
      await request('cancel-server-restart', { id: 'b', requestId: 'r2' });
      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('cancel-restart', 'b', 'desktop');
    });

    it('lists the restarts counting down here', async () => {
      countdowns.pending.mockReturnValueOnce([{ instanceId: 'a', dueAt: 900_000, all: false }]);

      await request('get-pending-restarts', { requestId: 'r1' });

      expect(replies('get-pending-restarts')).toContainEqual({ pending: [{ instanceId: 'a', dueAt: 900_000, all: false }], requestId: 'r1' });
    });
  });

  // A machine that was lost: its servers come back from the copies another machine kept.
  describe('restore-backup-copy', () => {
    it('makes a new server here from the copy this machine keeps', async () => {
      jest.mocked(backupCopies.heldPath).mockReturnValueOnce('/copies/b1/backup_manual_1.zip');
      mockInstance.importServerFromBackup.mockResolvedValueOnce({ success: true, instance: { id: 'new', name: 'Far again' } } as never);

      await request('restore-backup-copy', { serverId: 'b1', serverName: 'Far again', requestId: 'r1' });

      expect(mockInstance.importServerFromBackup).toHaveBeenCalledWith('Far again', { filePath: '/copies/b1/backup_manual_1.zip' }, true);
      expect(mockMesh.recordServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }));
      expect(replies('restore-backup-copy')).toContainEqual(expect.objectContaining({ success: true, requestId: 'r1' }));
    });

    it('says when this machine keeps no copy of that server', async () => {
      await request('restore-backup-copy', { serverId: 'b1', serverName: 'Far again', requestId: 'r2' });

      expect(replies('restore-backup-copy')).toContainEqual({ success: false, error: 'This machine keeps no copy of that server\'s backups.', requestId: 'r2' });
    });
  });

  // The settings page marks what was saved since the server started.
  describe('get-started-config', () => {
    it('answers with the settings a server here started with', async () => {
      jest.mocked(readStartedConfig).mockReturnValueOnce({ id: 'a', maxPlayers: 70 } as never);

      await request('get-started-config', { id: 'a', requestId: 'r1' });

      expect(replies('get-started-config')).toContainEqual({ config: { id: 'a', maxPlayers: 70 }, requestId: 'r1' });
    });

    it('asks the machine hosting a server on another machine', async () => {
      mockMesh.queryRemote.mockResolvedValueOnce({ config: { id: 'b', maxPlayers: 20 } });

      await request('get-started-config', { id: 'b', requestId: 'r2' });

      expect(mockMesh.queryRemote).toHaveBeenCalledWith('b', 'started-config');
      expect(replies('get-started-config')).toContainEqual({ config: { id: 'b', maxPlayers: 20 }, requestId: 'r2' });
    });
  });

  // Catches mod updates: every running server restarts, each machine its own, in sidebar order.
  describe('restart-all-instances', () => {
    const states: Record<string, string> = { a: 'running', b: 'stopped', c: 'running' };
    const countdowns = jest.mocked(restartCountdowns);

    beforeEach(() => {
      countdowns.begin.mockClear();
      mockManagement.getAllInstances.mockResolvedValue({ instances: Object.keys(states).map(id => ({ id })) });
      mockProcess.getNormalizedInstanceState.mockImplementation(id => states[id]);
      mockLifecycle.stopAllInstances.mockResolvedValue({ stopped: ['a', 'c'], failed: [] });
      mockLifecycle.startAllInstances.mockResolvedValue({ started: ['a', 'c'], failed: [] });
      mockMesh.commandHosts.mockClear();
    });

    it('counts down on the running servers here, and tells every other machine to do the same', async () => {
      mockMesh.hostsOf.mockResolvedValueOnce({ local: ['a', 'b'], remote: new Map([['n2', ['c']]]) });

      await request('restart-all-instances', { warningMinutes: 15, requestId: 'r1' });

      expect(countdowns.begin).toHaveBeenCalledWith(['a'], 15, true, expect.any(Function));
      expect(mockMesh.commandHosts).toHaveBeenCalledWith('restart-all', new Map([['n2', ['c']]]), 'desktop', { warningMinutes: 15 });
      expect(replies('restart-all-instances')).toContainEqual({ success: true, restarting: ['a'], dueAt: 900_000, requestId: 'r1' });
    });

    it('when the time is up, stops them and starts them again in order', async () => {
      await request('restart-all-instances', { warningMinutes: 15, requestId: 'r1' });
      const restart = countdowns.begin.mock.calls[0][3];

      await restart(['a', 'c']);

      expect(mockLifecycle.stopAllInstances).toHaveBeenCalledWith(['a', 'c']);
      expect(mockLifecycle.startAllInstances).toHaveBeenCalledWith(undefined, ['a', 'c']);
      expect(mockLifecycle.stopAllInstances.mock.invocationCallOrder[0]).toBeLessThan(mockLifecycle.startAllInstances.mock.invocationCallOrder[0]);
      expect(mockMesh.noteDesired).toHaveBeenCalledWith('c', 'running');
    });

    it('restarts them at once when there is to be no warning', async () => {
      await request('restart-all-instances', { warningMinutes: 0, requestId: 'r1' });

      expect(countdowns.begin).not.toHaveBeenCalled();
      expect(mockLifecycle.stopAllInstances).toHaveBeenCalledWith(['a', 'c']);
      expect(mockLifecycle.startAllInstances).toHaveBeenCalledWith(undefined, ['a', 'c']);
    });

    it('cancels it here and on the other machines', async () => {
      mockMesh.hostsOf.mockResolvedValueOnce({ local: ['a'], remote: new Map([['n2', ['c']]]) });

      await request('cancel-restart-all', { requestId: 'r1' });

      expect(countdowns.cancelAll).toHaveBeenCalled();
      expect(mockMesh.commandHosts).toHaveBeenCalledWith('cancel-restart-all', new Map([['n2', ['c']]]), 'desktop');
      expect(replies('cancel-restart-all')).toContainEqual({ success: true, cancelled: ['a'], requestId: 'r1' });
    });
  });

  describe('start-all-instances', () => {
    const states: Record<string, string> = { a: 'running', b: 'stopped', c: 'queued', d: 'crashed', e: 'starting' };

    beforeEach(() => {
      mockManagement.getAllInstances.mockResolvedValue({ instances: Object.keys(states).map(id => ({ id })) });
      mockProcess.getNormalizedInstanceState.mockImplementation(id => states[id]);
      mockLifecycle.startAllInstances.mockResolvedValue({ started: [], failed: [] });
    });

    it('queues every server not already up, answers, then starts them', async () => {
      await request('start-all-instances', { requestId: 'r1' });

      expect(mockProcess.setInstanceState.mock.calls).toEqual([['b', 'queued'], ['d', 'queued']]);
      expect(broadcasts('server-instance-state')).toEqual([{ instanceId: 'b', state: 'queued' }, { instanceId: 'd', state: 'queued' }]);
      expect(replies('start-all-instances')).toEqual([{ success: true, starting: ['b', 'd'], requestId: 'r1' }]);
      expect(replyOrder('start-all-instances')).toBeLessThan(mockLifecycle.startAllInstances.mock.invocationCallOrder[0]);
    });

    it('logs a background start that fails after the answer', async () => {
      mockLifecycle.startAllInstances.mockRejectedValue(new Error('spawn failed'));

      await request('start-all-instances', { requestId: 'r1' });

      expect(replies('start-all-instances')).toEqual([{ success: true, starting: ['b', 'd'], requestId: 'r1' }]);
      expect(console.error).toHaveBeenCalledWith('[start-all-instances]', expect.stringContaining('spawn failed'));
    });

    it('replies with the reason listing the servers fails', async () => {
      mockManagement.getAllInstances.mockRejectedValue(new Error('disk gone'));

      await request('start-all-instances', { requestId: 'r1' });

      expect(replies('start-all-instances')).toEqual([{ success: false, error: 'disk gone', requestId: 'r1' }]);
      expect(mockLifecycle.startAllInstances).not.toHaveBeenCalled();
    });

    it('starts servers hosted on other nodes through those nodes', async () => {
      mockMesh.withMeshServers.mockImplementationOnce(async instances => [...instances, { id: 'r1', nodeId: 'n2' }] as never);
      mockMesh.hostsOf.mockResolvedValueOnce({ local: ['a', 'b', 'c', 'd', 'e'], remote: new Map([['n2', ['r1']]]) });

      await request('start-all-instances', { requestId: 'r1' });

      expect(mockMesh.hostsOf).toHaveBeenCalledWith(['a', 'b', 'c', 'd', 'e', 'r1']);
      expect(mockMesh.commandHosts).toHaveBeenCalledWith('start-all', new Map([['n2', ['r1']]]), expect.any(String));
    });

    it('does not start a copy kept here of a server another node hosts', async () => {
      mockMesh.hostsOf.mockResolvedValueOnce({ local: ['a', 'c', 'd', 'e'], remote: new Map([['n2', ['b']]]) });

      await request('start-all-instances', { requestId: 'r1' });

      expect(mockProcess.setInstanceState.mock.calls).toEqual([['d', 'queued']]);
      expect(mockLifecycle.startAllInstances).toHaveBeenCalledWith(undefined, ['a', 'c', 'd', 'e']);
    });

    it('tells the requester when another node could not start its servers', async () => {
      mockMesh.hostsOf.mockResolvedValueOnce({ local: ['a'], remote: new Map([['n2', ['r1']]]) });
      mockMesh.commandHosts.mockResolvedValueOnce([{ nodeId: 'n2', nodeName: 'Box', result: { success: false, error: 'That node could not be reached.' } }]);

      await request('start-all-instances', { requestId: 'r1' });

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'notification', { type: 'error', message: 'Box could not start its servers: That node could not be reached.' }, sender
      );
    });

    it('records the servers that started as meant to be running', async () => {
      mockLifecycle.startAllInstances.mockResolvedValue({ started: ['b'], failed: ['d'] });

      await request('start-all-instances', { requestId: 'r1' });

      expect(mockMesh.noteDesired.mock.calls).toEqual([['b', 'running']]);
    });

    describe('for a machine admin', () => {
      beforeEach(() => jest.mocked(identifySender).mockReturnValue(machineAdminIdentity()));
      afterEach(() => noteLocalNode(null));

      it('starts only the servers on its own machine, from that machine', async () => {
        noteLocalNode('n1');
        mockMesh.hostsOf.mockResolvedValueOnce({ local: ['a', 'b', 'c', 'd', 'e'], remote: new Map([['n2', ['r1']]]) });

        await request('start-all-instances', { requestId: 'r1' });

        expect(mockMesh.commandHosts).toHaveBeenCalledWith('start-all', new Map(), expect.any(String));
        expect(replies('start-all-instances')).toEqual([{ success: true, starting: ['b', 'd'], requestId: 'r1' }]);
      });

      it('starts only the servers on its own machine, from another machine', async () => {
        noteLocalNode('n2');
        mockMesh.hostsOf.mockResolvedValueOnce({ local: ['a', 'b', 'c', 'd', 'e'], remote: new Map([['n1', ['x']], ['n3', ['y']]]) });

        await request('start-all-instances', { requestId: 'r1' });

        expect(mockMesh.commandHosts).toHaveBeenCalledWith('start-all', new Map([['n1', ['x']]]), expect.any(String));
        expect(mockLifecycle.startAllInstances).toHaveBeenCalledWith(undefined, []);
        expect(replies('start-all-instances')).toEqual([{ success: true, starting: [], requestId: 'r1' }]);
      });
    });

    it('answers a request without a payload', async () => {
      await request('start-all-instances', undefined);

      expect(replies('start-all-instances')).toEqual([{ success: true, starting: ['b', 'd'], requestId: undefined }]);
    });
  });

  describe('stop-all-instances', () => {
    const states: Record<string, string> = { a: 'running', b: 'stopped', c: 'starting', d: 'queued' };

    beforeEach(() => {
      mockManagement.getAllInstances.mockResolvedValue({ instances: Object.keys(states).map(id => ({ id })) });
      mockProcess.getNormalizedInstanceState.mockImplementation(id => states[id]);
      mockLifecycle.stopAllInstances.mockResolvedValue({ stopped: [], failed: [] });
    });

    it('marks every running or starting server as stopping, answers, then stops them', async () => {
      await request('stop-all-instances', { requestId: 'r1' });

      expect(broadcasts('server-instance-state')).toEqual([{ instanceId: 'a', state: 'stopping' }, { instanceId: 'c', state: 'stopping' }]);
      expect(replies('stop-all-instances')).toEqual([{ success: true, stopping: ['a', 'c'], requestId: 'r1' }]);
      expect(replyOrder('stop-all-instances')).toBeLessThan(mockLifecycle.stopAllInstances.mock.invocationCallOrder[0]);
    });

    it('replies with the reason listing the servers fails', async () => {
      mockManagement.getAllInstances.mockRejectedValue(new Error('disk gone'));

      await request('stop-all-instances', { requestId: 'r1' });

      expect(replies('stop-all-instances')).toEqual([{ success: false, error: 'disk gone', requestId: 'r1' }]);
      expect(mockLifecycle.stopAllInstances).not.toHaveBeenCalled();
    });

    it('stops servers hosted on other nodes through those nodes', async () => {
      mockMesh.hostsOf.mockResolvedValueOnce({ local: ['a', 'b', 'c', 'd'], remote: new Map([['n2', ['r1']]]) });

      await request('stop-all-instances', { requestId: 'r1' });

      expect(mockMesh.commandHosts).toHaveBeenCalledWith('stop-all', new Map([['n2', ['r1']]]), expect.any(String));
    });

    it('does not stop a copy kept here of a server another node hosts', async () => {
      mockMesh.hostsOf.mockResolvedValueOnce({ local: ['b', 'c', 'd'], remote: new Map([['n2', ['a']]]) });

      await request('stop-all-instances', { requestId: 'r1' });

      expect(broadcasts('server-instance-state')).toEqual([{ instanceId: 'c', state: 'stopping' }]);
      expect(mockLifecycle.stopAllInstances).toHaveBeenCalledWith(['b', 'c', 'd']);
    });

    it('records the servers that stopped as meant to be stopped', async () => {
      mockLifecycle.stopAllInstances.mockResolvedValue({ stopped: ['a'], failed: ['c'] });

      await request('stop-all-instances', { requestId: 'r1' });

      expect(mockMesh.noteDesired.mock.calls).toEqual([['a', 'stopped']]);
    });

    it('answers a request without a payload', async () => {
      await request('stop-all-instances', undefined);

      expect(replies('stop-all-instances')).toEqual([{ success: true, stopping: ['a', 'c'], requestId: undefined }]);
    });
  });

  describe('a server hosted on another node', () => {
    afterEach(() => {
      mockMesh.queryRemote.mockReset().mockImplementation(async () => null);
      mockMesh.forwardIfRemote.mockReset().mockImplementation(async () => null);
    });

    it('reads its state, log, players and RCON status from its host', async () => {
      mockMesh.queryRemote.mockImplementation(async (_id, query) => ({
        state: { state: 'running', instanceId: 'a1' },
        logs: { log: 'Server started', instanceId: 'a1' },
        players: { players: 3, instanceId: 'a1' },
        'rcon-status': { success: true, connected: true, instanceId: 'a1' },
        'online-players': { players: [{ name: 'Ada' }], instanceId: 'a1' },
        ini: { content: '[ServerSettings]', instanceId: 'a1' }
      } as Record<string, unknown>)[query] as never);

      await request('get-server-instance-state', { id: 'a1', requestId: 'r1' });
      await request('get-server-instance-logs', { id: 'a1', maxLines: 200, requestId: 'r2' });
      await request('get-server-instance-players', { id: 'a1', requestId: 'r3' });
      await request('get-rcon-status', { id: 'a1', requestId: 'r4' });
      await request('get-online-players', { id: 'a1', requestId: 'r5' });
      await request('get-ini-file', { instanceId: 'a1', filename: 'GameUserSettings.ini', requestId: 'r6' });

      expect(replies('get-server-instance-state')).toEqual([{ state: 'running', instanceId: 'a1', requestId: 'r1' }]);
      expect(replies('get-server-instance-logs')).toEqual([{ log: 'Server started', instanceId: 'a1', requestId: 'r2' }]);
      expect(replies('get-server-instance-players')).toEqual([{ players: 3, instanceId: 'a1', requestId: 'r3' }]);
      expect(replies('get-rcon-status')).toEqual([{ success: true, connected: true, instanceId: 'a1', requestId: 'r4' }]);
      expect(replies('get-online-players')).toEqual([{ success: true, players: [{ name: 'Ada' }], instanceId: 'a1', requestId: 'r5' }]);
      expect(replies('get-ini-file')).toEqual([{ success: true, content: '[ServerSettings]', instanceId: 'a1', filename: 'GameUserSettings.ini', requestId: 'r6' }]);
      expect(mockMesh.queryRemote).toHaveBeenCalledWith('a1', 'logs', { maxLines: 200 });
      expect(mockMesh.queryRemote).toHaveBeenCalledWith('a1', 'ini', { filename: 'GameUserSettings.ini' });
      expect(mockArkConfig.readIniFile).not.toHaveBeenCalled();
    });

    it('saves an INI file on its host and shows the merged config here', async () => {
      const saved = { id: 'a1', name: 'Alpha', sessionName: 'Merged' };
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { instance: saved } });

      await request('save-ini-file', { instanceId: 'a1', filename: 'GameUserSettings.ini', content: '[x]', requestId: 'r1' });

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('save-ini', 'a1', expect.any(String), { filename: 'GameUserSettings.ini', content: '[x]' });
      expect(mockArkConfig.writeIniFile).not.toHaveBeenCalled();
      expect(replies('save-ini-file')).toEqual([{ success: true, instanceId: 'a1', filename: 'GameUserSettings.ini', requestId: 'r1' }]);
      expect(broadcasts('server-instance-updated')).toEqual([saved]);
    });

    it('passes on an INI save its host refused', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: false, error: 'That node could not be reached.' });

      await request('save-ini-file', { instanceId: 'a1', filename: 'Game.ini', content: '[x]', requestId: 'r1' });

      expect(replies('save-ini-file')).toEqual([{ success: false, error: 'That node could not be reached.', instanceId: 'a1', filename: 'Game.ini', requestId: 'r1' }]);
    });

    it('sends RCON commands to its host and shows the answer', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { response: 'No Players Connected' } });
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: false, error: 'RCON is not connected' });

      await request('rcon-command', { id: 'a1', command: 'ListPlayers', requestId: 'r1' });
      await request('rcon-command', { id: 'a1', command: 'ListPlayers', requestId: 'r2' });

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('rcon', 'a1', expect.any(String), { command: 'ListPlayers' });
      expect(replies('rcon-command')).toEqual([
        { instanceId: 'a1', response: 'No Players Connected', requestId: 'r1' },
        { instanceId: 'a1', response: 'RCON is not connected', requestId: 'r2' }
      ]);
      expect(mockOperations.executeRconCommand).not.toHaveBeenCalled();
    });

    it('connects and disconnects RCON on its host', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { connected: true } });
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { connected: false } });

      await request('connect-rcon', { id: 'a1', requestId: 'r1' });
      await request('disconnect-rcon', { id: 'a1', requestId: 'r2' });

      expect(replies('connect-rcon')).toEqual([{ success: true, connected: true, instanceId: 'a1', requestId: 'r1' }]);
      expect(replies('disconnect-rcon')).toEqual([{ success: true, connected: false, instanceId: 'a1', requestId: 'r2' }]);
      expect(mockOperations.connectRcon).not.toHaveBeenCalled();
      expect(mockOperations.disconnectRcon).not.toHaveBeenCalled();
    });
  });

  describe('restart-server-instance', () => {
    beforeEach(() => {
      jest.mocked(getStandardEventCallbacks).mockReturnValue({ onLog: jest.fn(), onState: jest.fn() });
    });

    it('stops, starts, and records the server as meant to be running', async () => {
      mockLifecycle.stopServerInstance.mockResolvedValue({ success: true, instanceId: 'a1' });
      mockInstance.startServerInstance.mockResolvedValue({ started: true, instanceName: 'Alpha' });

      await request('restart-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockInstance.startServerInstance).toHaveBeenCalledWith('a1', expect.any(Function), expect.any(Function));
      expect(replies('restart-server-instance')).toEqual([{ success: true, instanceId: 'a1', requestId: 'r1' }]);
      expect(mockMesh.noteDesired.mock.calls).toEqual([['a1', 'running']]);
    });

    it('does not start the server when the stop fails', async () => {
      mockLifecycle.stopServerInstance.mockResolvedValue({ success: false, instanceId: 'a1', error: 'RCON timed out' });

      await request('restart-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockInstance.startServerInstance).not.toHaveBeenCalled();
      expect(mockMesh.noteDesired).not.toHaveBeenCalled();
      expect(replies('restart-server-instance')).toEqual([{ success: false, instanceId: 'a1', error: 'RCON timed out', requestId: 'r1' }]);
    });
  });

  describe('force-stop-server-instance', () => {
    it('kills the server, tells everyone, stops polling and marks the stop as manual', async () => {
      const result = { success: true, instanceId: 'a1', instanceName: 'Alpha', shouldNotifyAutomation: true };
      mockInstance.forceStopInstance.mockResolvedValue(result);

      await request('force-stop-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockInstance.forceStopInstance).toHaveBeenCalledWith('a1');
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'a1', connected: false }]);
      expect(broadcasts('server-instance-log')).toEqual([{ log: '[FORCE STOP] Server force stopped', instanceId: 'a1' }]);
      expect(broadcasts('notification')).toEqual([{ type: 'warning', message: 'Alpha force stopped.', instanceId: 'a1' }]);
      expect(mockMonitoring.stopPlayerPolling).toHaveBeenCalledWith('a1');
      expect(automationService.setManuallyStopped).toHaveBeenCalledWith('a1', true);
      expect(replies('force-stop-server-instance')).toEqual([{ ...result, requestId: 'r1' }]);
    });

    it('records a forced stop as meant to be stopped', async () => {
      mockInstance.forceStopInstance.mockResolvedValue({ success: true, instanceId: 'a1', instanceName: 'Alpha', shouldNotifyAutomation: false });

      await request('force-stop-server-instance', { id: 'a1' });

      expect(mockMesh.noteDesired.mock.calls).toEqual([['a1', 'stopped']]);
    });

    it('records nothing when the forced stop fails', async () => {
      mockInstance.forceStopInstance.mockResolvedValue({ success: false, error: 'Invalid instance ID' });

      await request('force-stop-server-instance', { id: '../x' });

      expect(mockMesh.noteDesired).not.toHaveBeenCalled();
    });

    it('leaves automation alone when the service does not ask for it', async () => {
      mockInstance.forceStopInstance.mockResolvedValue({ success: true, instanceId: 'a1', instanceName: 'Alpha', shouldNotifyAutomation: false });

      await request('force-stop-server-instance', { id: 'a1' });

      expect(automationService.setManuallyStopped).not.toHaveBeenCalled();
    });

    it('passes on a failed stop without telling anyone else', async () => {
      mockInstance.forceStopInstance.mockResolvedValue({ success: false, error: 'Invalid instance ID' });

      await request('force-stop-server-instance', { id: '../x', requestId: 'r1' });

      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
      expect(replies('force-stop-server-instance')).toEqual([{ success: false, error: 'Invalid instance ID', requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('System error'), 'System error'],
      ['nothing useful', undefined, 'Failed to force stop server']
    ])('replies a failure when stopping throws %s', async (_label, thrown, error) => {
      mockInstance.forceStopInstance.mockRejectedValue(thrown);

      await request('force-stop-server-instance', { id: 'a1', requestId: 'r1' });

      expect(replies('force-stop-server-instance')).toEqual([{ success: false, error, requestId: 'r1' }]);
      expect(jest.mocked(console.error).mock.calls.map(([tag]) => tag)).toContain('[force-stop-server-instance]');
    });

    it('answers a request without a payload', async () => {
      mockInstance.forceStopInstance.mockResolvedValue({ success: false, error: 'Invalid instance ID' });

      await request('force-stop-server-instance', undefined);

      expect(mockInstance.forceStopInstance).toHaveBeenCalledWith(undefined);
      expect(replies('force-stop-server-instance')).toEqual([{ success: false, error: 'Invalid instance ID', requestId: undefined }]);
    });
  });

  describe('stop-server-instance', () => {
    it('stops the server gracefully, then stops polling, marks the stop as manual and reports RCON down', async () => {
      mockLifecycle.stopServerInstance.mockResolvedValue({ success: true, instanceId: 'a1' });

      await request('stop-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockLifecycle.stopServerInstance).toHaveBeenCalledWith('a1');
      expect(mockMonitoring.stopPlayerPolling).toHaveBeenCalledWith('a1');
      expect(automationService.setManuallyStopped).toHaveBeenCalledWith('a1', true);
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'a1', connected: false }]);
      expect(replies('stop-server-instance')).toEqual([{ success: true, instanceId: 'a1', error: undefined, requestId: 'r1' }]);
    });

    it('passes on a failed stop and changes nothing else', async () => {
      mockLifecycle.stopServerInstance.mockResolvedValue({ success: false, error: 'Server process not found', instanceId: 'a1' });

      await request('stop-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockMonitoring.stopPlayerPolling).not.toHaveBeenCalled();
      expect(automationService.setManuallyStopped).not.toHaveBeenCalled();
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
      expect(replies('stop-server-instance')).toEqual([
        { success: false, instanceId: 'a1', error: 'Server process not found', requestId: 'r1' }
      ]);
    });

    it('refuses an invalid id without stopping anything', async () => {
      await request('stop-server-instance', { id: '../x', requestId: 'r1' });

      expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
      expect(replies('stop-server-instance')).toEqual([{ success: false, instanceId: '../x', error: 'Invalid instance ID', requestId: 'r1' }]);
    });

    it('replies a failure when stopping throws', async () => {
      mockLifecycle.stopServerInstance.mockRejectedValue(new Error('RCON hung'));

      await request('stop-server-instance', { id: 'a1', requestId: 'r1' });

      expect(replies('stop-server-instance')).toEqual([{ success: false, instanceId: 'a1', error: 'RCON hung', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      await request('stop-server-instance', undefined);

      expect(mockLifecycle.stopServerInstance).not.toHaveBeenCalled();
      expect(replies('stop-server-instance')).toEqual([
        { success: false, instanceId: undefined, error: 'Invalid instance ID', requestId: undefined }
      ]);
    });
  });

  describe('get-server-instance-state', () => {
    it('replies with the state', async () => {
      jest.mocked(getNormalizedInstanceState).mockReturnValue('running');

      await request('get-server-instance-state', { id: 'a1', requestId: 'r1' });

      expect(getNormalizedInstanceState).toHaveBeenCalledWith('a1');
      expect(replies('get-server-instance-state')).toEqual([{ state: 'running', instanceId: 'a1', requestId: 'r1' }]);
    });

    it.each([new Error('State check failed'), 'fail', undefined])('replies "unknown" when reading the state throws %p', async thrown => {
      jest.mocked(getNormalizedInstanceState).mockImplementation(() => { throw thrown; });

      await request('get-server-instance-state', { id: 'a1', requestId: 'r1' });

      expect(replies('get-server-instance-state')).toEqual([{ state: 'unknown', instanceId: 'a1', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      jest.mocked(getNormalizedInstanceState).mockReturnValue('stopped');

      await request('get-server-instance-state', undefined);

      expect(replies('get-server-instance-state')).toEqual([{ state: 'stopped', instanceId: undefined, requestId: undefined }]);
    });
  });

  describe('get-server-instance-logs', () => {
    it('replies with the log to the requester only', async () => {
      mockMonitoring.getInstanceLogs.mockReturnValue({ log: 'Server log line', instanceId: 'a1' });

      await request('get-server-instance-logs', { id: 'a1', maxLines: 100, requestId: 'r1' });

      expect(mockMonitoring.getInstanceLogs).toHaveBeenCalledWith('a1', 100);
      expect(replies('get-server-instance-logs')).toEqual([{ log: 'Server log line', instanceId: 'a1', requestId: 'r1' }]);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });

    it('replies with an empty log when reading fails', async () => {
      mockMonitoring.getInstanceLogs.mockImplementation(() => { throw new Error('Log retrieval failed'); });

      await request('get-server-instance-logs', { id: 'a1', requestId: 'r1' });

      expect(replies('get-server-instance-logs')).toEqual([{ log: '', instanceId: 'a1', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockMonitoring.getInstanceLogs.mockReturnValue({ log: '', instanceId: '' });

      await request('get-server-instance-logs', undefined);

      expect(mockMonitoring.getInstanceLogs).toHaveBeenCalledWith(undefined, undefined);
      expect(replies('get-server-instance-logs')).toEqual([{ log: '', instanceId: '', requestId: undefined }]);
    });
  });

  describe('connect-rcon', () => {
    it('replies, then reports RCON up to everyone and starts counting players', async () => {
      mockOperations.connectRcon.mockResolvedValue({ success: true, connected: true, instanceId: 'a1' });
      mockMonitoring.startPlayerPolling.mockImplementation((id, report) => report(id, 42));

      await request('connect-rcon', { id: 'a1', requestId: 'r1' });

      expect(replies('connect-rcon')).toEqual([{ success: true, connected: true, instanceId: 'a1', error: undefined, requestId: 'r1' }]);
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'a1', connected: true }]);
      expect(broadcasts('server-instance-players')).toEqual([{ instanceId: 'a1', players: 42 }]);
      expect(replyOrder('connect-rcon')).toBeLessThan(mockMessaging.sendToAll.mock.invocationCallOrder[0]);
    });

    it('reports RCON down and counts nothing when it cannot connect', async () => {
      mockOperations.connectRcon.mockResolvedValue({ success: false, connected: false, instanceId: 'a1', error: 'Connection failed' });

      await request('connect-rcon', { id: 'a1', requestId: 'r1' });

      expect(replies('connect-rcon')).toEqual([
        { success: false, connected: false, instanceId: 'a1', error: 'Connection failed', requestId: 'r1' }
      ]);
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'a1', connected: false }]);
      expect(mockMonitoring.startPlayerPolling).not.toHaveBeenCalled();
    });

    it.each([
      ['an Error', new Error('RCON connection error'), 'RCON connection error'],
      ['nothing useful', undefined, 'Failed to connect RCON']
    ])('replies a failure and tells nobody else when connecting throws %s', async (_label, thrown, error) => {
      mockOperations.connectRcon.mockRejectedValue(thrown);

      await request('connect-rcon', { id: 'a1', requestId: 'r1' });

      expect(replies('connect-rcon')).toEqual([{ success: false, connected: false, instanceId: 'a1', error, requestId: 'r1' }]);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });

    it('answers a request without a payload', async () => {
      mockOperations.connectRcon.mockResolvedValue({ success: false, connected: false, instanceId: '', error: 'Invalid instance ID' });

      await request('connect-rcon', undefined);

      expect(mockOperations.connectRcon).toHaveBeenCalledWith(undefined);
      expect(replies('connect-rcon')).toHaveLength(1);
    });
  });

  describe('get-online-players', () => {
    it('replies with the players', async () => {
      const players = [{ name: 'Rex', playerId: '0002a1b2c3d4e5f60718293a4b5c6d7e', steamId: '7656' }];
      jest.mocked(rconService.getOnlinePlayers).mockResolvedValue(players);

      await request('get-online-players', { id: 'a1', requestId: 'r1' });

      expect(replies('get-online-players')).toEqual([{ success: true, instanceId: 'a1', players, requestId: 'r1' }]);
    });

    it('replies with the reason the list is unavailable', async () => {
      jest.mocked(rconService.getOnlinePlayers).mockRejectedValue(new Error('RCON not connected'));

      await request('get-online-players', { id: 'a1', requestId: 'r1' });

      expect(replies('get-online-players')).toEqual([{ success: false, instanceId: 'a1', error: 'RCON not connected', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      jest.mocked(rconService.getOnlinePlayers).mockResolvedValue([]);

      await request('get-online-players', undefined);

      expect(replies('get-online-players')).toEqual([{ success: true, instanceId: undefined, players: [], requestId: undefined }]);
    });
  });

  describe('disconnect-rcon', () => {
    it('replies, then reports RCON down to everyone and stops counting players', async () => {
      mockOperations.disconnectRcon.mockResolvedValue({ success: true, connected: false, instanceId: 'a1' });

      await request('disconnect-rcon', { id: 'a1', requestId: 'r1' });

      expect(replies('disconnect-rcon')).toEqual([{ success: true, connected: false, instanceId: 'a1', requestId: 'r1' }]);
      expect(broadcasts('rcon-status')).toEqual([{ instanceId: 'a1', connected: false }]);
      expect(mockMonitoring.stopPlayerPolling).toHaveBeenCalledWith('a1');
    });

    it('replies a failure without an error and tells nobody else when disconnecting throws', async () => {
      mockOperations.disconnectRcon.mockRejectedValue(new Error('RCON disconnect error'));

      await request('disconnect-rcon', { id: 'a1', requestId: 'r1' });

      expect(replies('disconnect-rcon')).toEqual([{ success: false, connected: false, instanceId: 'a1', requestId: 'r1' }]);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });

    it('answers a request without a payload', async () => {
      mockOperations.disconnectRcon.mockResolvedValue({ success: true, connected: false, instanceId: '' });

      await request('disconnect-rcon', undefined);

      expect(mockOperations.disconnectRcon).toHaveBeenCalledWith(undefined);
      expect(replies('disconnect-rcon')).toHaveLength(1);
    });
  });

  describe('get-rcon-status', () => {
    it('replies with the status', async () => {
      mockOperations.getRconStatus.mockReturnValue({ success: true, connected: true, instanceId: 'a1' });

      await request('get-rcon-status', { id: 'a1', requestId: 'r1' });

      expect(replies('get-rcon-status')).toEqual([{ success: true, connected: true, instanceId: 'a1', requestId: 'r1' }]);
    });

    it('replies disconnected, without an error, when reading the status throws', async () => {
      mockOperations.getRconStatus.mockImplementation(() => { throw new Error('RCON status check failed'); });

      await request('get-rcon-status', { id: 'a1', requestId: 'r1' });

      expect(replies('get-rcon-status')).toEqual([{ success: false, connected: false, instanceId: 'a1', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockOperations.getRconStatus.mockReturnValue({ success: false, connected: false, instanceId: '' });

      await request('get-rcon-status', undefined);

      expect(replies('get-rcon-status')).toEqual([{ success: false, connected: false, instanceId: '', requestId: undefined }]);
    });
  });

  describe('rcon-command', () => {
    it.each([
      ['the response', { success: true, response: 'Player list', instanceId: 'a1' }, 'Player list'],
      ['the error', { success: false, error: 'Not connected', instanceId: 'a1' }, 'Not connected'],
      ['a placeholder', { success: true, instanceId: 'a1' }, 'No response']
    ])('replies with %s in `response`', async (_label, result, response) => {
      mockOperations.executeRconCommand.mockResolvedValue(result);

      await request('rcon-command', { id: 'a1', command: 'listplayers', requestId: 'r1' });

      expect(mockOperations.executeRconCommand).toHaveBeenCalledWith('a1', 'listplayers');
      expect(replies('rcon-command')).toEqual([{ instanceId: 'a1', response, requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('RCON command failed badly'), 'RCON command failed badly'],
      ['nothing useful', undefined, 'RCON command failed']
    ])('puts the failure in `response` when the command throws %s', async (_label, thrown, response) => {
      mockOperations.executeRconCommand.mockRejectedValue(thrown);

      await request('rcon-command', { id: 'a1', command: 'x', requestId: 'r1' });

      expect(replies('rcon-command')).toEqual([{ instanceId: 'a1', response, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockOperations.executeRconCommand.mockResolvedValue({ success: false, error: 'Invalid instance ID', instanceId: '' });

      await request('rcon-command', undefined);

      expect(mockOperations.executeRconCommand).toHaveBeenCalledWith(undefined, undefined);
      expect(replies('rcon-command')).toEqual([{ instanceId: '', response: 'Invalid instance ID', requestId: undefined }]);
    });
  });

  describe('start-server-instance', () => {
    const callbacks = { onLog: jest.fn(), onState: jest.fn() };

    beforeEach(() => {
      jest.mocked(getStandardEventCallbacks).mockReturnValue(callbacks);
    });

    it('clears the old log, starts with the standard callbacks and tells everyone', async () => {
      mockInstance.startServerInstance.mockResolvedValue({ started: true, instanceId: 'a1', instanceName: 'Alpha' });

      await request('start-server-instance', { id: 'a1', requestId: 'r1' });

      expect(broadcasts('clear-server-instance-logs')).toEqual([{ instanceId: 'a1' }]);
      expect(mockInstance.startServerInstance).toHaveBeenCalledWith('a1', callbacks.onLog, callbacks.onState);
      expect(broadcasts('notification')).toEqual([{ type: 'info', message: 'Alpha started.', instanceId: 'a1' }]);
      expect(replies('start-server-instance')).toEqual([{ success: true, instanceId: 'a1', error: undefined, requestId: 'r1' }]);
    });

    it('tells only the requester about a port in use', async () => {
      mockInstance.startServerInstance.mockResolvedValue({ started: false, portError: 'Port 7777 is in use', instanceId: 'a1' });

      await request('start-server-instance', { id: 'a1', requestId: 'r1' });

      expect(broadcasts('notification')).toEqual([]);
      expect(replies('notification')).toEqual([{ type: 'error', message: 'Port 7777 is in use' }]);
      expect(replies('start-server-instance')).toEqual([
        { success: false, instanceId: 'a1', error: 'Port 7777 is in use', requestId: 'r1' }
      ]);
    });

    it.each([
      ['an Error', new Error('spawn failed'), 'spawn failed'],
      ['nothing useful', undefined, 'Failed to start server']
    ])('replies a failure when starting throws %s', async (_label, thrown, error) => {
      mockInstance.startServerInstance.mockRejectedValue(thrown);

      await request('start-server-instance', { id: 'a1', requestId: 'r1' });

      expect(replies('start-server-instance')).toEqual([{ success: false, instanceId: 'a1', error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockInstance.startServerInstance.mockResolvedValue({ started: false, instanceId: '' });

      await request('start-server-instance', undefined);

      expect(mockInstance.startServerInstance).toHaveBeenCalledWith(undefined, callbacks.onLog, callbacks.onState);
      expect(replies('start-server-instance')).toHaveLength(1);
    });
  });

  describe('get-server-instance-players', () => {
    it('replies with the player count', async () => {
      mockMonitoring.getPlayerCount.mockReturnValue({ instanceId: 'a1', players: 5 });

      await request('get-server-instance-players', { id: 'a1', requestId: 'r1' });

      expect(replies('get-server-instance-players')).toEqual([{ instanceId: 'a1', players: 5, requestId: 'r1' }]);
    });

    it('replies zero players when counting fails', async () => {
      mockMonitoring.getPlayerCount.mockImplementation(() => { throw new Error('Player retrieval failed'); });

      await request('get-server-instance-players', { id: 'a1', requestId: 'r1' });

      expect(replies('get-server-instance-players')).toEqual([{ instanceId: 'a1', players: 0, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockMonitoring.getPlayerCount.mockReturnValue({ instanceId: '', players: 0 });

      await request('get-server-instance-players', undefined);

      expect(mockMonitoring.getPlayerCount).toHaveBeenCalledWith(undefined);
      expect(replies('get-server-instance-players')).toEqual([{ instanceId: '', players: 0, requestId: undefined }]);
    });
  });

  describe('get-server-instances', () => {
    const instances = [{ id: 'a1', name: 'Alpha' }];

    it('replies with the list, then sends it to everyone', async () => {
      mockManagement.getAllInstances.mockResolvedValue({ instances });

      await request('get-server-instances', { requestId: 'r1' });

      expect(replies('get-server-instances')).toEqual([{ instances, requestId: 'r1' }]);
      expect(broadcasts('server-instances')).toEqual([instances]);
      expect(replyOrder('get-server-instances')).toBeLessThan(mockMessaging.sendToAll.mock.invocationCallOrder[0]);
    });

    it('replies an empty list and sends nothing else when listing fails', async () => {
      mockManagement.getAllInstances.mockRejectedValue(new Error('Instance retrieval failed'));

      await request('get-server-instances', { requestId: 'r1' });

      expect(replies('get-server-instances')).toEqual([{ instances: [], requestId: 'r1' }]);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });

    it('answers a request without a payload', async () => {
      mockManagement.getAllInstances.mockResolvedValue({ instances });

      await request('get-server-instances', undefined);

      expect(replies('get-server-instances')).toEqual([{ instances, requestId: undefined }]);
    });
  });

  describe('get-server-instance', () => {
    it('replies with the instance', async () => {
      mockManagement.getInstance.mockResolvedValue({ instance: { id: 'a1', name: 'Alpha' } });

      await request('get-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockManagement.getInstance).toHaveBeenCalledWith('a1');
      expect(replies('get-server-instance')).toEqual([{ instance: { id: 'a1', name: 'Alpha' }, requestId: 'r1' }]);
    });

    it('replies null when reading fails', async () => {
      mockManagement.getInstance.mockRejectedValue(new Error('Instance retrieval failed'));

      await request('get-server-instance', { id: 'a1', requestId: 'r1' });

      expect(replies('get-server-instance')).toEqual([{ instance: null, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockManagement.getInstance.mockResolvedValue({ instance: null });

      await request('get-server-instance', undefined);

      expect(mockManagement.getInstance).toHaveBeenCalledWith(undefined);
      expect(replies('get-server-instance')).toEqual([{ instance: null, requestId: undefined }]);
    });
  });

  describe('save-server-instance', () => {
    beforeEach(() => {
      mockInstanceUtils.getInstance.mockReset();
    });

    function notices(): unknown[] {
      return mockMessaging.sendToAllOthers.mock.calls.map(([channel, data, to]) => [channel, data, to]);
    }

    it('replies, then sends the instance and the list to everyone and tells the others', async () => {
      const saved = { id: 'a1', name: 'Alpha' };
      mockInstanceUtils.getInstance.mockReturnValue(null);
      mockManagement.saveInstance.mockResolvedValue({ success: true, instance: saved });

      await request('save-server-instance', { instance: saved, requestId: 'r1' });

      expect(mockManagement.saveInstance).toHaveBeenCalledWith(saved);
      expect(replies('save-server-instance')).toEqual([{ success: true, instance: saved, error: undefined, requestId: 'r1' }]);
      expect(broadcasts('server-instance-updated')).toEqual([saved]);
      expect(mockInstance.broadcastInstances).toHaveBeenCalled();
      expect(notices()).toEqual([['notification', { type: 'info', message: 'Server "Alpha" added.', instanceId: 'a1' }, sender]]);
      expect(replyOrder('save-server-instance')).toBeLessThan(mockMessaging.sendToAll.mock.invocationCallOrder[0]);
    });

    it('places a server a machine admin adds on its own machine', async () => {
      jest.mocked(identifySender).mockReturnValue(machineAdminIdentity());
      mockMesh.saveElsewhere.mockResolvedValueOnce({ success: true, instance: { id: 'a1', name: 'New' } as never });

      await request('save-server-instance', { instance: { name: 'New', nodeId: 'n3' }, requestId: 'r1' });

      expect(mockMesh.saveElsewhere).toHaveBeenCalledWith(expect.objectContaining({ name: 'New', nodeId: 'n1' }), 'ma');
    });

    it('saves a server hosted on another node there and writes nothing here', async () => {
      const saved = { id: 'a1', name: 'New', nodeId: 'n2' };
      mockMesh.remoteInstance.mockResolvedValueOnce({ id: 'a1', name: 'Old', nodeId: 'n2' } as never);
      mockMesh.saveElsewhere.mockResolvedValueOnce({ success: true, instance: saved as never });

      await request('save-server-instance', { instance: { id: 'a1', name: 'New' }, requestId: 'r1' });

      expect(mockMesh.saveElsewhere).toHaveBeenCalledWith({ id: 'a1', name: 'New' }, expect.any(String));
      expect(mockManagement.saveInstance).not.toHaveBeenCalled();
      expect(replies('save-server-instance')).toEqual([{ success: true, instance: saved, requestId: 'r1' }]);
      expect(broadcasts('server-instance-updated')).toEqual([saved]);
      expect(notices()).toEqual([['notification', { type: 'info', message: 'Server renamed from "Old" to "New".', instanceId: 'a1' }, sender]]);
    });

    it('passes on a save another node refused', async () => {
      mockMesh.saveElsewhere.mockResolvedValueOnce({ success: false, error: 'That node could not be reached.' });

      await request('save-server-instance', { instance: { name: 'Fresh', nodeId: 'n2' }, requestId: 'r1' });

      expect(replies('save-server-instance')).toEqual([{ success: false, error: 'That node could not be reached.', requestId: 'r1' }]);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });

    it('checks an edit of a server on another node against the configure permission', async () => {
      jest.mocked(identifySender).mockReturnValue(operatorIdentity('op1', ['servers.view', 'servers.create']));
      mockMesh.remoteInstance.mockResolvedValueOnce({ id: 'a1', name: 'Alpha', nodeId: 'n2', operatorUserId: 'op1' } as never);

      await request('save-server-instance', { instance: { id: 'a1', name: 'Renamed' }, requestId: 'r1' });

      expect(replies('save-server-instance')).toEqual([{ success: false, error: 'Your role cannot change server settings.', requestId: 'r1' }]);
      expect(mockMesh.saveElsewhere).not.toHaveBeenCalled();
    });

    it('does not write the placement into a config saved here', async () => {
      mockManagement.saveInstance.mockResolvedValue({ success: true, instance: { id: 'a1', name: 'Alpha' } });

      await request('save-server-instance', { instance: { id: 'a1', name: 'Alpha', nodeId: 'n1' }, requestId: 'r1' });

      expect(mockManagement.saveInstance).toHaveBeenCalledWith({ id: 'a1', name: 'Alpha' });
    });

    it('still tells the others when sending the list fails', async () => {
      const saved = { id: 'a1', name: 'Alpha' };
      mockInstanceUtils.getInstance.mockReturnValue(null);
      mockManagement.saveInstance.mockResolvedValue({ success: true, instance: saved });
      mockInstance.broadcastInstances.mockRejectedValueOnce(new Error('config.json unreadable'));

      await request('save-server-instance', { instance: saved, requestId: 'r1' });

      expect(broadcasts('server-instance-updated')).toEqual([saved]);
      expect(notices()).toEqual([['notification', { type: 'info', message: 'Server "Alpha" added.', instanceId: 'a1' }, sender]]);
    });

    it.each([
      ['a rename', { id: 'a1', name: 'Old' }, { id: 'a1', name: 'New' }, 'Server renamed from "Old" to "New".'],
      ['an update', { id: 'a1', name: 'Alpha' }, { id: 'a1', name: 'Alpha' }, 'Server "Alpha" updated.'],
      ['an update of a nameless server', { id: 'a1' }, { id: 'a1' }, 'Server "a1" updated.'],
      ['a new nameless server', null, { id: 'a1' }, 'Server "a1" added.'],
      ['a server with neither name nor id', null, {}, 'Server "Unknown" added.']
    ])('describes %s to the others', async (_label, previous, saved, message) => {
      mockInstanceUtils.getInstance.mockReturnValue(previous);
      mockManagement.saveInstance.mockResolvedValue({ success: true, instance: saved });

      await request('save-server-instance', { instance: saved });

      expect(notices()).toEqual([['notification', { type: 'info', message, instanceId: (saved as { id?: string }).id }, sender]]);
    });

    it('passes on a refused save and tells nobody else', async () => {
      mockManagement.saveInstance.mockResolvedValue({ success: false, error: 'A server with this name already exists.' });

      await request('save-server-instance', { instance: { id: 'a1', name: 'Taken' }, requestId: 'r1' });

      expect(replies('save-server-instance')).toEqual([
        { success: false, instance: undefined, error: 'A server with this name already exists.', requestId: 'r1' }
      ]);
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
      expect(mockInstance.broadcastInstances).not.toHaveBeenCalled();
      expect(mockMessaging.sendToAllOthers).not.toHaveBeenCalled();
    });

    it.each([
      ['an Error', new Error('Save failed'), 'Save failed'],
      ['nothing useful', undefined, 'Failed to save server instance']
    ])('replies a failure when saving throws %s', async (_label, thrown, error) => {
      mockManagement.saveInstance.mockRejectedValue(thrown);

      await request('save-server-instance', { instance: { id: 'a1' }, requestId: 'r1' });

      expect(replies('save-server-instance')).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockManagement.saveInstance.mockResolvedValue({ success: false, error: 'Invalid instance data' });

      await request('save-server-instance', undefined);

      expect(mockManagement.saveInstance).toHaveBeenCalledWith(undefined);
      expect(replies('save-server-instance')).toHaveLength(1);
    });
  });

  describe('delete-server-instance', () => {
    it('replies, then sends the list to everyone, records who deleted it and tells the others', async () => {
      jest.mocked(identifySender).mockReturnValue({ user: { username: 'jared' } } as ReturnType<typeof identifySender>);
      mockInstance.deleteInstance.mockResolvedValue({ success: true, id: 'a1' });

      await request('delete-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockInstance.deleteInstance).toHaveBeenCalledWith('a1');
      expect(replies('delete-server-instance')).toEqual([{ success: true, id: 'a1', requestId: 'r1' }]);
      expect(mockInstance.broadcastInstances).toHaveBeenCalled();
      expect(identifySender).toHaveBeenCalledWith(sender);
      expect(activityLogService.record).toHaveBeenCalledWith('info', 'Server deleted', 'a1', 'jared');
      expect(mockMessaging.sendToAllOthers).toHaveBeenCalledWith('notification', { type: 'info', message: 'Server deleted.', instanceId: 'a1' }, sender);
    });

    it('deletes a server hosted on another node through that node, then the copy kept here', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true });
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1' } as never);
      mockInstance.deleteInstance.mockResolvedValue({ success: true, id: 'a1' });

      await request('delete-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('delete', 'a1', expect.any(String));
      expect(mockInstance.deleteInstance).toHaveBeenCalledWith('a1');
      expect(replies('delete-server-instance')).toEqual([{ success: true, id: 'a1', requestId: 'r1' }]);
    });

    it('leaves the files here alone when the hosting node refuses the delete', async () => {
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: false, error: 'That node could not be reached.' });
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1' } as never);

      await request('delete-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockInstance.deleteInstance).not.toHaveBeenCalled();
      expect(mockInstance.broadcastInstances).not.toHaveBeenCalled();
      expect(replies('delete-server-instance')).toEqual([{ success: false, id: 'a1', error: 'That node could not be reached.', requestId: 'r1' }]);
    });

    it('passes on the mesh refusing to delete a server hosted here', async () => {
      mockMesh.deleteHostedServer.mockResolvedValueOnce({ success: false, error: 'Mesh is partitioned.' });

      await request('delete-server-instance', { id: 'a1', requestId: 'r1' });

      expect(mockInstance.deleteInstance).not.toHaveBeenCalled();
      expect(replies('delete-server-instance')).toEqual([{ success: false, id: 'a1', error: 'Mesh is partitioned.', requestId: 'r1' }]);
    });

    it('still tells the others when the activity feed fails', async () => {
      jest.mocked(identifySender).mockReturnValue({ user: null } as ReturnType<typeof identifySender>);
      jest.mocked(activityLogService.record).mockImplementationOnce(() => { throw new Error('database locked'); });
      mockInstance.deleteInstance.mockResolvedValue({ success: true, id: 'a1' });

      await request('delete-server-instance', { id: 'a1', requestId: 'r1' });

      expect(replies('delete-server-instance')).toEqual([{ success: true, id: 'a1', requestId: 'r1' }]);
      expect(mockMessaging.sendToAllOthers).toHaveBeenCalledWith('notification', { type: 'info', message: 'Server deleted.', instanceId: 'a1' }, sender);
    });

    it('passes on a refused delete and tells nobody else', async () => {
      mockInstance.deleteInstance.mockResolvedValue({ success: false, id: 'a1' });

      await request('delete-server-instance', { id: 'a1', requestId: 'r1' });

      expect(replies('delete-server-instance')).toEqual([{ success: false, id: 'a1', requestId: 'r1' }]);
      expect(mockInstance.broadcastInstances).not.toHaveBeenCalled();
      expect(mockMessaging.sendToAllOthers).not.toHaveBeenCalled();
    });

    it.each([new Error('Delete failed'), 'fail', undefined])('replies a failure without an error when deleting throws %p', async thrown => {
      mockInstance.deleteInstance.mockRejectedValue(thrown);

      await request('delete-server-instance', { id: 'a1', requestId: 'r1' });

      expect(replies('delete-server-instance')).toEqual([{ success: false, id: 'a1', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockInstance.deleteInstance.mockResolvedValue({ success: false, id: '' });

      await request('delete-server-instance', undefined);

      expect(mockInstance.deleteInstance).toHaveBeenCalledWith(undefined);
      expect(replies('delete-server-instance')).toEqual([{ success: false, id: '', requestId: undefined }]);
    });
  });

  describe('import-server-from-backup', () => {
    beforeEach(() => {
      jest.mocked(identifySender).mockReturnValue({ user: null, permissions: [], isAdmin: true, isLocalDesktop: true });
    });

    it('replies, then sends the list to everyone', async () => {
      const instance = { id: 'a1', name: 'Imported' };
      mockInstance.importServerFromBackup.mockResolvedValue({ success: true, instance, message: 'Imported' });

      await request('import-server-from-backup', {
        serverName: 'Imported', backupFilePath: 'C:\\b.zip', fileData: 'ZGF0YQ==', fileName: 'b.zip', requestId: 'r1'
      });

      expect(mockInstance.importServerFromBackup).toHaveBeenCalledWith('Imported', { filePath: 'C:\\b.zip', fileData: 'ZGF0YQ==' }, true);
      expect(replies('import-server-from-backup')).toEqual([
        { success: true, instance, message: 'Imported', error: undefined, requestId: 'r1' }
      ]);
      expect(mockInstance.broadcastInstances).toHaveBeenCalled();
    });

    it('passes on a failed import without a broadcast', async () => {
      mockInstance.importServerFromBackup.mockResolvedValue({ success: false, error: 'restore failed' });

      await request('import-server-from-backup', { serverName: 's', requestId: 'r1' });

      expect(replies('import-server-from-backup')).toEqual([
        { success: false, instance: undefined, message: undefined, error: 'restore failed', requestId: 'r1' }
      ]);
      expect(mockInstance.broadcastInstances).not.toHaveBeenCalled();
    });

    it.each([
      ['an Error', new Error('custom import error'), 'custom import error'],
      ['nothing useful', undefined, 'Failed to import server from backup']
    ])('replies a failure when importing throws %s', async (_label, thrown, error) => {
      mockInstance.importServerFromBackup.mockRejectedValue(thrown);

      await request('import-server-from-backup', { serverName: 's', requestId: 'r1' });

      expect(replies('import-server-from-backup')).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockInstance.importServerFromBackup.mockResolvedValue({ success: false, error: 'Server name is required' });

      await request('import-server-from-backup', undefined);

      expect(mockInstance.importServerFromBackup).toHaveBeenCalledWith(undefined, { filePath: undefined, fileData: undefined }, true);
      expect(replies('import-server-from-backup')).toHaveLength(1);
    });

    // With authentication off a web client has the desktop's rights, but the path would still name
    // a file on the host.
    it.each([
      ['a signed-in web client', { type: 'api-process', cid: 'c1', user: { username: 'admin' }, authEnabled: true, send: jest.fn() }],
      ['a web client with authentication off', { type: 'api-process', cid: 'c1', user: null, authEnabled: false, send: jest.fn() }],
      ['a raw socket with authentication off', { _authEnabled: false, readyState: 1, send: jest.fn() }]
    ])('tells the service the request did not come from the desktop window for %s', async (_label, webSender) => {
      mockInstance.importServerFromBackup.mockResolvedValue({ success: false, error: 'desktop only' });

      await handlers['import-server-from-backup']({ serverName: 's', backupFilePath: '/etc/x.zip', requestId: 'r1' }, webSender);

      expect(mockInstance.importServerFromBackup).toHaveBeenCalledWith('s', { filePath: '/etc/x.zip', fileData: undefined }, false);
    });
  });

  describe('reorder-server-instances', () => {
    it('saves each position as the sort order, sends the list to everyone, then replies', async () => {
      const instances = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      mockManagement.getAllInstances.mockResolvedValue({ instances });
      mockManagement.saveInstance.mockResolvedValue({ success: true });

      await request('reorder-server-instances', { orderedIds: ['c', 'gone', 'a'], requestId: 'r1' });

      expect(mockManagement.saveInstance.mock.calls).toEqual([[{ id: 'c', sortOrder: 0 }], [{ id: 'a', sortOrder: 2 }]]);
      expect(mockInstance.broadcastInstances).toHaveBeenCalled();
      expect(replies('reorder-server-instances')).toEqual([{ success: true, requestId: 'r1' }]);
      expect(mockInstance.broadcastInstances.mock.invocationCallOrder[0]).toBeLessThan(replyOrder('reorder-server-instances'));
    });

    it('refuses an order that is not a list', async () => {
      await request('reorder-server-instances', { orderedIds: 'a,b', requestId: 'r1' });

      expect(replies('reorder-server-instances')).toEqual([{ success: false, error: 'orderedIds must be an array', requestId: 'r1' }]);
      expect(mockManagement.saveInstance).not.toHaveBeenCalled();
    });

    it('replies with the requestId when saving the order fails', async () => {
      mockManagement.getAllInstances.mockRejectedValue(new Error('disk gone'));

      await request('reorder-server-instances', { orderedIds: ['a'], requestId: 'r1' });

      expect(replies('reorder-server-instances')).toEqual([{ success: false, error: 'disk gone', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      await request('reorder-server-instances', undefined);

      expect(replies('reorder-server-instances')).toEqual([
        { success: false, error: 'orderedIds must be an array', requestId: undefined }
      ]);
    });
  });
  describe('pools', () => {
    const op1 = operatorIdentity('op1');
    const s1 = { id: 's1', name: 'One', operatorUserId: 'op1', managerUserId: null };
    const s2 = { id: 's2', name: 'Two', operatorUserId: null, managerUserId: null };
    const people: Record<string, unknown> = {
      m1: { id: 'm1', roleId: 'server-manager', ownerUserId: 'op1', active: true },
      m2: { id: 'm2', roleId: 'server-manager', ownerUserId: 'op2', active: true },
      op1: { id: 'op1', roleId: 'operator', ownerUserId: null, active: true },
      op2: { id: 'op2', roleId: 'operator', ownerUserId: null, active: true }
    };

    beforeEach(() => {
      mockUsers.getUser.mockImplementation(id => (people[id] ?? null) as never);
      mockManagement.getAllInstances.mockResolvedValue({ instances: [s1, s2] });
    });

    it('filters get-server-instances for a non-admin', async () => {
      jest.mocked(identifySender).mockReturnValue(op1);

      await request('get-server-instances', { requestId: 'r1' });

      expect(replies('get-server-instances')).toEqual([{ instances: [s1], requestId: 'r1' }]);
      expect(broadcasts('server-instances')).toEqual([[s1, s2]]);
    });

    it('scopes start-all and stop-all to the visible servers', async () => {
      jest.mocked(identifySender).mockReturnValue(op1);
      mockLifecycle.startAllInstances.mockResolvedValue({ started: [], failed: [] });
      mockLifecycle.stopAllInstances.mockResolvedValue({ stopped: [], failed: [] });
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');
      await request('start-all-instances', { requestId: 'r1' });
      expect(replies('start-all-instances')).toEqual([{ success: true, starting: ['s1'], requestId: 'r1' }]);
      expect(mockLifecycle.startAllInstances).toHaveBeenCalledWith(undefined, ['s1']);

      mockProcess.getNormalizedInstanceState.mockReturnValue('running');
      await request('stop-all-instances', { requestId: 'r2' });
      expect(replies('stop-all-instances')).toEqual([{ success: true, stopping: ['s1'], requestId: 'r2' }]);
      expect(mockLifecycle.stopAllInstances).toHaveBeenCalledWith(['s1']);
    });

    it('starts everything for an admin', async () => {
      mockLifecycle.startAllInstances.mockResolvedValue({ started: [], failed: [] });
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');

      await request('start-all-instances', { requestId: 'r1' });

      expect(mockLifecycle.startAllInstances).toHaveBeenCalledWith(undefined, undefined);
    });

    it('refuses a server manager creating without servers.create', async () => {
      jest.mocked(identifySender).mockReturnValue(operatorIdentity('m1', ['servers.view', 'servers.configure']));
      mockInstanceUtils.getInstance.mockReturnValue(null);

      await request('save-server-instance', { instance: { name: 'new' }, requestId: 'r1' });

      expect(replies('save-server-instance')).toEqual([{ success: false, error: 'Only an admin or operator can add a server.', requestId: 'r1' }]);
      expect(mockManagement.saveInstance).not.toHaveBeenCalled();
    });

    it('refuses editing without servers.configure', async () => {
      jest.mocked(identifySender).mockReturnValue(operatorIdentity('op1', ['servers.view', 'servers.create']));
      mockInstanceUtils.getInstance.mockReturnValue(s1 as never);

      await request('save-server-instance', { instance: { ...s1, name: 'renamed' }, requestId: 'r1' });

      expect(replies('save-server-instance')).toEqual([{ success: false, error: 'Your role cannot change server settings.', requestId: 'r1' }]);
    });

    it('puts an operator\'s new server in their pool and tells the others with the id', async () => {
      jest.mocked(identifySender).mockReturnValue(op1);
      mockInstanceUtils.getInstance.mockReturnValue(null);
      mockManagement.saveInstance.mockResolvedValue({ success: true, instance: { id: 's3', name: 'new', operatorUserId: 'op1' } });

      await request('save-server-instance', { instance: { name: 'new' }, requestId: 'r1' });

      expect(mockManagement.saveInstance).toHaveBeenCalledWith({ name: 'new', operatorUserId: 'op1' });
      expect(mockMessaging.sendToAllOthers).toHaveBeenCalledWith('notification', { type: 'info', message: 'Server "new" added.', instanceId: 's3' }, sender);
    });

    it('refuses a save whose assignee is in another pool', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(s1 as never);

      await request('save-server-instance', { instance: { ...s1, managerUserId: 'm2' }, requestId: 'r1' });

      expect(replies('save-server-instance')).toEqual([{ success: false, error: 'That person is not in this server\'s pool.', requestId: 'r1' }]);
      expect(mockManagement.saveInstance).not.toHaveBeenCalled();
    });

    it('assigns a manager and broadcasts the update', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(s1 as never);
      const saved = { ...s1, managerUserId: 'm1' };
      mockInstanceUtils.saveInstance.mockResolvedValue(saved as never);

      await request('assign-server-manager', { instanceId: 's1', managerUserId: 'm1', requestId: 'r1' });

      expect(mockInstanceUtils.saveInstance).toHaveBeenCalledWith(saved);
      expect(replies('assign-server-manager')).toEqual([{ success: true, instance: saved, requestId: 'r1' }]);
      expect(broadcasts('server-instance-updated')).toEqual([saved]);
      expect(mockInstance.broadcastInstances).toHaveBeenCalled();
    });

    it('lets the pool\'s operator assign, and refuses another operator', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(s1 as never);
      mockInstanceUtils.saveInstance.mockResolvedValue({ ...s1, managerUserId: 'm1' } as never);

      jest.mocked(identifySender).mockReturnValue(op1);
      await request('assign-server-manager', { instanceId: 's1', managerUserId: 'm1', requestId: 'r1' });
      expect(replies('assign-server-manager')).toEqual([expect.objectContaining({ success: true })]);

      jest.mocked(identifySender).mockReturnValue(operatorIdentity('op2'));
      await request('assign-server-manager', { instanceId: 's1', managerUserId: 'm2', requestId: 'r2' });
      expect(replies('assign-server-manager')[1]).toEqual({ success: false, error: 'That server is not in your pool.', requestId: 'r2' });
    });

    it('moves a server between pools and clears an assignee from the old pool', async () => {
      mockInstanceUtils.getInstance.mockReturnValue({ ...s1, managerUserId: 'm1' } as never);
      const moved = { ...s1, operatorUserId: 'op2', managerUserId: null };
      mockInstanceUtils.saveInstance.mockResolvedValue(moved as never);

      await request('set-server-operator', { instanceId: 's1', operatorUserId: 'op2', requestId: 'r1' });

      expect(mockInstanceUtils.saveInstance).toHaveBeenCalledWith(moved);
      expect(replies('set-server-operator')).toEqual([{ success: true, instance: moved, requestId: 'r1' }]);
      expect(broadcasts('server-instance-updated')).toEqual([moved]);
    });

    it('refuses set-server-operator from a non-admin and for an unknown server or operator', async () => {
      jest.mocked(identifySender).mockReturnValue(op1);
      mockInstanceUtils.getInstance.mockReturnValue(s1 as never);
      await request('set-server-operator', { instanceId: 's1', operatorUserId: 'op2', requestId: 'r1' });
      expect(replies('set-server-operator')[0]).toEqual({ success: false, error: 'Only an admin can move a server between pools.', requestId: 'r1' });

      jest.mocked(identifySender).mockReturnValue(DESKTOP);
      mockInstanceUtils.getInstance.mockReturnValue(null);
      await request('set-server-operator', { instanceId: 'nope', operatorUserId: 'op2', requestId: 'r2' });
      expect(replies('set-server-operator')[1]).toEqual({ success: false, error: 'That server was not found.', requestId: 'r2' });

      mockInstanceUtils.getInstance.mockReturnValue(s1 as never);
      await request('set-server-operator', { instanceId: 's1', operatorUserId: 'm1', requestId: 'r3' });
      expect(replies('set-server-operator')[2]).toEqual({ success: false, error: 'Choose an active operator for this server.', requestId: 'r3' });
    });

    it('assigns a manager to a server on another node through its host', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(null);
      mockMesh.remoteInstance.mockResolvedValue({ ...s1, nodeId: 'n2' } as never);
      const saved = { ...s1, managerUserId: 'm1' };
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { instance: saved } });

      await request('assign-server-manager', { instanceId: 's1', managerUserId: 'm1', requestId: 'r1' });

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('set-ownership', 's1', expect.any(String), { managerUserId: 'm1' });
      expect(mockInstanceUtils.saveInstance).not.toHaveBeenCalled();
      expect(replies('assign-server-manager')).toEqual([{ success: true, instance: saved, requestId: 'r1' }]);
      expect(broadcasts('server-instance-updated')).toEqual([saved]);
    });

    it('checks the pool of a server on another node before assigning', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(null);
      mockMesh.remoteInstance.mockResolvedValue({ ...s1, nodeId: 'n2' } as never);
      jest.mocked(identifySender).mockReturnValue(operatorIdentity('op2'));

      await request('assign-server-manager', { instanceId: 's1', managerUserId: 'm2', requestId: 'r1' });

      expect(replies('assign-server-manager')).toEqual([{ success: false, error: 'That server is not in your pool.', requestId: 'r1' }]);
      expect(mockMesh.forwardIfRemote).not.toHaveBeenCalled();
    });

    it('moves a server on another node between pools through its host', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(null);
      mockMesh.remoteInstance.mockResolvedValue({ ...s1, nodeId: 'n2', managerUserId: 'm1' } as never);
      const moved = { ...s1, operatorUserId: 'op2', managerUserId: null };
      mockMesh.forwardIfRemote.mockResolvedValueOnce({ success: true, detail: { instance: moved } });

      await request('set-server-operator', { instanceId: 's1', operatorUserId: 'op2', requestId: 'r1' });

      expect(mockMesh.forwardIfRemote).toHaveBeenCalledWith('set-ownership', 's1', expect.any(String), { operatorUserId: 'op2', managerUserId: null });
      expect(replies('set-server-operator')).toEqual([{ success: true, instance: moved, requestId: 'r1' }]);
    });

    it('records an imported server in the mesh', async () => {
      const imported = { id: 'i1', name: 'Imported' };
      mockInstance.importServerFromBackup.mockResolvedValue({ success: true, instance: imported, message: 'Imported' });

      await request('import-server-from-backup', { serverName: 'Imported', fileData: 'ZGF0YQ==', requestId: 'r1' });

      expect(mockMesh.recordServer).toHaveBeenCalledWith(imported);
    });

    it('stamps an imported server with the importer\'s pool', async () => {
      jest.mocked(identifySender).mockReturnValue(op1);
      const imported = { id: 'i1', name: 'Imported' };
      mockInstance.importServerFromBackup.mockResolvedValue({ success: true, instance: imported, message: 'Imported' });
      mockInstanceUtils.saveInstance.mockResolvedValue({ ...imported, operatorUserId: 'op1' } as never);

      await request('import-server-from-backup', { serverName: 'Imported', fileData: 'ZGF0YQ==', requestId: 'r1' });

      expect(mockInstanceUtils.saveInstance).toHaveBeenCalledWith({ ...imported, operatorUserId: 'op1' });
      expect(replies('import-server-from-backup')).toEqual([expect.objectContaining({ success: true, instance: { ...imported, operatorUserId: 'op1' } })]);
    });
  });
});
