jest.mock('fs', () => ({ existsSync: jest.fn(() => true) }));
jest.mock('../../utils/network.utils', () => ({
  isUdpPortInUse: jest.fn(async () => false),
  isTcpPortInUse: jest.fn(async () => false)
}));
jest.mock('../../utils/ark/ark-server/ark-server-paths.utils', () => ({
  getArkExecutablePath: jest.fn(() => '/ark/ShooterGame/Binaries/Win64/ArkAscendedServer.exe'),
  validateInstanceRuntimeTree: jest.fn(() => ({ valid: true, missing: [], sharedInstallBroken: false }))
}));
jest.mock('../../utils/global-config.utils', () => ({ loadGlobalConfig: jest.fn(() => ({ serverStartDelaySeconds: 60 })) }));
jest.mock('./server-management.service', () => ({
  serverManagementService: { prepareInstanceConfiguration: jest.fn(), getAllInstances: jest.fn() }
}));
jest.mock('./server-process.service', () => ({
  serverProcessService: {
    startServerProcess: jest.fn(),
    setupProcessMonitoring: jest.fn(),
    setInstanceState: jest.fn(),
    getNormalizedInstanceState: jest.fn(),
    hasActiveProcess: jest.fn(),
    stopServerProcess: jest.fn()
  }
}));
jest.mock('./instance-events', () => ({ getStandardEventCallbacks: jest.fn() }));
jest.mock('../../utils/ark/ark-server/ark-server-cleanup.utils', () => ({ waitForProcessSweeps: jest.fn(async () => undefined) }));

import * as fs from 'fs';
import { isTcpPortInUse, isUdpPortInUse } from '../../utils/network.utils';
import { validateInstanceRuntimeTree } from '../../utils/ark/ark-server/ark-server-paths.utils';
import { waitForProcessSweeps } from '../../utils/ark/ark-server/ark-server-cleanup.utils';
import { serverManagementService } from './server-management.service';
import { serverProcessService } from './server-process.service';
import { getStandardEventCallbacks } from './instance-events';
import { serverLifecycleService } from './server-lifecycle.service';
import { SERVER_BEING_MOVED, SERVER_FILES_UPDATING, whileServerFilesUpdate, whileServerMoves } from '../../utils/ark/ark-server/ark-server-state.utils';
import type { InstanceConfig } from '../../types/server-instance.types';

const mockProcess = jest.mocked(serverProcessService);
const mockManagement = jest.mocked(serverManagementService);
const mockUdp = jest.mocked(isUdpPortInUse);
const mockTcp = jest.mocked(isTcpPortInUse);

const instance: InstanceConfig = { id: 'a1', name: 'Alpha', gamePort: '7777', queryPort: '27015', rconPort: '32330' };

describe('ServerLifecycleService', () => {
  beforeEach(() => {
    jest.mocked(fs.existsSync).mockReturnValue(true);
    mockUdp.mockResolvedValue(false);
    mockTcp.mockResolvedValue(false);
    mockProcess.getNormalizedInstanceState.mockReturnValue('stopped');
    mockProcess.hasActiveProcess.mockReturnValue(false);
    mockProcess.startServerProcess.mockResolvedValue({ success: true, instanceId: 'a1' });
    mockManagement.prepareInstanceConfiguration.mockResolvedValue(undefined);
    jest.mocked(validateInstanceRuntimeTree).mockReturnValue({ valid: true, missing: [], sharedInstallBroken: false });
  });

  describe('startServerInstance', () => {
    it('prepares the instance, spawns it and monitors it with the given callbacks', async () => {
      const onLog = jest.fn();
      const onState = jest.fn();

      const result = await serverLifecycleService.startServerInstance('a1', instance, onLog, onState);

      expect(result).toEqual({ success: true, instanceId: 'a1' });
      expect(mockManagement.prepareInstanceConfiguration).toHaveBeenCalledWith('a1', instance);
      expect(mockProcess.startServerProcess).toHaveBeenCalledWith('a1', instance);
      expect(mockProcess.setupProcessMonitoring).toHaveBeenCalledWith('a1', onLog, onState);
    });

    it('refuses an invalid id', async () => {
      await expect(serverLifecycleService.startServerInstance('../x', instance))
        .resolves.toEqual({ success: false, error: 'Invalid instance ID', instanceId: '../x' });
    });

    it('refuses when the ARK server is not installed', async () => {
      jest.mocked(fs.existsSync).mockReturnValue(false);

      await expect(serverLifecycleService.startServerInstance('a1', instance))
        .resolves.toEqual({ success: false, error: 'ARK server is not installed', instanceId: 'a1' });
    });

    it('refuses while SteamCMD is replacing the server files', async () => {
      // A server started then would load half-replaced files.
      const result = await whileServerFilesUpdate(() => serverLifecycleService.startServerInstance('a1', instance));

      expect(result).toEqual({ success: false, error: SERVER_FILES_UPDATING, instanceId: 'a1' });
      expect(mockManagement.prepareInstanceConfiguration).not.toHaveBeenCalled();
      expect(mockProcess.startServerProcess).not.toHaveBeenCalled();
    });

    // Its files are being copied to another machine, which takes it over once they arrive.
    it('refuses to start a server that is being moved, and only that server', async () => {
      const result = await whileServerMoves('a1', () => serverLifecycleService.startServerInstance('a1', instance));

      expect(result).toEqual({ success: false, error: SERVER_BEING_MOVED, instanceId: 'a1' });
      expect(mockProcess.startServerProcess).not.toHaveBeenCalled();
      await expect(whileServerMoves('b2', () => serverLifecycleService.startServerInstance('a1', instance)))
        .resolves.toEqual({ success: true, instanceId: 'a1' });
    });

    it('refuses when a move begins while the ports are being checked', async () => {
      let finishMove: () => void = () => undefined;
      let move: Promise<void> = Promise.resolve();
      mockUdp.mockImplementationOnce(async () => {
        move = whileServerMoves('a1', () => new Promise<void>(resolve => { finishMove = resolve; }));
        return false;
      });

      const result = await serverLifecycleService.startServerInstance('a1', instance);
      finishMove();
      await move;

      expect(result).toEqual({ success: false, error: SERVER_BEING_MOVED, instanceId: 'a1' });
      expect(mockProcess.startServerProcess).not.toHaveBeenCalled();
    });

    it('refuses when an install or update begins while the ports are being checked', async () => {
      let finishUpdate: () => void = () => undefined;
      let update: Promise<void> = Promise.resolve();
      mockUdp.mockImplementationOnce(async () => {
        update = whileServerFilesUpdate(() => new Promise<void>(resolve => { finishUpdate = resolve; }));
        return false;
      });

      const result = await serverLifecycleService.startServerInstance('a1', instance);
      finishUpdate();
      await update;

      expect(result).toEqual({ success: false, error: SERVER_FILES_UPDATING, instanceId: 'a1' });
      expect(mockProcess.startServerProcess).not.toHaveBeenCalled();
      expect(serverLifecycleService.isStartInProgress('a1')).toBe(false);
    });

    it('reports a start as in progress until it has finished', async () => {
      let finishSweep: () => void = () => undefined;
      jest.mocked(waitForProcessSweeps).mockReturnValueOnce(new Promise<void>(resolve => { finishSweep = resolve; }));

      const starting = serverLifecycleService.startServerInstance('a1', instance);
      expect(serverLifecycleService.isStartInProgress('a1')).toBe(true);
      expect(serverLifecycleService.isStartInProgress('b2')).toBe(false);

      finishSweep();
      await starting;
      expect(serverLifecycleService.isStartInProgress('a1')).toBe(false);
    });

    it.each(['running', 'starting'])('refuses an instance that is already %s', async state => {
      mockProcess.getNormalizedInstanceState.mockReturnValue(state);

      await expect(serverLifecycleService.startServerInstance('a1', instance))
        .resolves.toEqual({ success: false, error: 'Instance is already running or starting', instanceId: 'a1' });
    });

    it('refuses an instance whose process is still stopping', async () => {
      mockProcess.getNormalizedInstanceState.mockReturnValue('stopping');
      mockProcess.hasActiveProcess.mockReturnValue(true);

      await expect(serverLifecycleService.startServerInstance('a1', instance))
        .resolves.toEqual({ success: false, error: 'Instance is still stopping', instanceId: 'a1' });
      expect(mockProcess.startServerProcess).not.toHaveBeenCalled();
    });

    // The state only becomes 'starting' once the process spawns, after the port checks and the
    // file preparation; a double click or two web clients used to spawn two servers.
    it('refuses a second start while the first is still in progress', async () => {
      const first = serverLifecycleService.startServerInstance('a1', instance);
      const second = serverLifecycleService.startServerInstance('a1', instance);

      await expect(second).resolves.toEqual({ success: false, error: 'Instance is already running or starting', instanceId: 'a1' });
      await expect(first).resolves.toEqual({ success: true, instanceId: 'a1' });
      expect(mockProcess.startServerProcess).toHaveBeenCalledTimes(1);
    });

    // A leftover sweep is a command-line match: still running after the spawn, it would kill the
    // new process.
    it('waits for a pending leftover sweep before checking ports and spawning', async () => {
      let finishSweep: () => void = () => undefined;
      jest.mocked(waitForProcessSweeps).mockReturnValueOnce(new Promise<void>(resolve => { finishSweep = resolve; }));

      const starting = serverLifecycleService.startServerInstance('a1', instance);
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(waitForProcessSweeps).toHaveBeenCalledWith('a1');
      expect(mockUdp).not.toHaveBeenCalled();
      expect(mockProcess.startServerProcess).not.toHaveBeenCalled();

      finishSweep();
      await expect(starting).resolves.toEqual({ success: true, instanceId: 'a1' });
      expect(mockProcess.startServerProcess).toHaveBeenCalled();
    });

    it('allows a new start once the previous one has finished', async () => {
      mockProcess.startServerProcess.mockResolvedValueOnce({ success: false, error: 'spawn failed', instanceId: 'a1' });
      await serverLifecycleService.startServerInstance('a1', instance);

      await expect(serverLifecycleService.startServerInstance('a1', instance)).resolves.toEqual({ success: true, instanceId: 'a1' });
    });

    describe('port checks', () => {
      // ARK's game and query ports are UDP; a TCP connect never saw a server holding them.
      it('binds the game and query ports over UDP and the RCON port over TCP', async () => {
        await serverLifecycleService.startServerInstance('a1', instance);

        expect(mockUdp).toHaveBeenCalledWith(7777, '0.0.0.0');
        expect(mockTcp).toHaveBeenCalledWith(32330, '0.0.0.0');
        expect(mockUdp).toHaveBeenCalledWith(27015, '0.0.0.0');
      });

      it('checks on the MultiHome address the server will bind', async () => {
        await serverLifecycleService.startServerInstance('a1', { ...instance, multiHome: '10.147.20.5' });

        expect(mockUdp).toHaveBeenCalledWith(7777, '10.147.20.5');
        expect(mockTcp).toHaveBeenCalledWith(32330, '10.147.20.5');
      });

      it('checks the ports ARK falls back to when the config has none', async () => {
        await serverLifecycleService.startServerInstance('a1', { id: 'a1', gamePort: 'abc' });

        expect(mockUdp).toHaveBeenCalledWith(7777, '0.0.0.0');
        expect(mockTcp).toHaveBeenCalledWith(27020, '0.0.0.0');
        expect(mockUdp).toHaveBeenCalledWith(27015, '0.0.0.0');
      });

      it.each([
        ['game', () => mockUdp.mockResolvedValueOnce(true), 'Game port 7777 is already in use'],
        ['RCON', () => mockTcp.mockResolvedValueOnce(true), 'RCON port 32330 is already in use'],
        ['query', () => mockUdp.mockResolvedValueOnce(false).mockResolvedValueOnce(true), 'Query port 27015 (Steam discovery) is already in use']
      ])('refuses when the %s port is taken', async (_label, arrange, error) => {
        arrange();

        await expect(serverLifecycleService.startServerInstance('a1', instance))
          .resolves.toEqual({ success: false, error, instanceId: 'a1' });
        expect(mockProcess.startServerProcess).not.toHaveBeenCalled();
      });
    });

    it('refuses to launch from an incomplete runtime tree', async () => {
      jest.mocked(validateInstanceRuntimeTree).mockReturnValue({ valid: false, missing: ['Engine'], sharedInstallBroken: true });

      const result = await serverLifecycleService.startServerInstance('a1', instance);

      expect(result).toMatchObject({ success: false, instanceId: 'a1' });
      expect(result.error).toContain('The ARK installation is incomplete - missing or empty: Engine.');
      expect(mockProcess.startServerProcess).not.toHaveBeenCalled();
    });

    it('passes on a failed spawn', async () => {
      mockProcess.startServerProcess.mockResolvedValue({ success: false, error: 'Process failed', instanceId: 'a1' });

      await expect(serverLifecycleService.startServerInstance('a1', instance))
        .resolves.toEqual({ success: false, error: 'Process failed', instanceId: 'a1' });
      expect(mockProcess.setupProcessMonitoring).not.toHaveBeenCalled();
    });

    it('marks the instance as errored when preparation throws', async () => {
      mockManagement.prepareInstanceConfiguration.mockRejectedValue(new Error('Could not link the save folder'));

      await expect(serverLifecycleService.startServerInstance('a1', instance))
        .resolves.toEqual({ success: false, error: 'Could not link the save folder', instanceId: 'a1' });
      expect(mockProcess.setInstanceState).toHaveBeenCalledWith('a1', 'error');
    });
  });

  describe('stopServerInstance', () => {
    it('stops the server process', async () => {
      mockProcess.stopServerProcess.mockResolvedValue({ success: true, instanceId: 'a1' });

      await expect(serverLifecycleService.stopServerInstance('a1')).resolves.toEqual({ success: true, instanceId: 'a1' });
      expect(mockProcess.stopServerProcess).toHaveBeenCalledWith('a1');
    });
  });

  describe('startAllInstances', () => {
    const callbacks = { onLog: jest.fn(), onState: jest.fn() };

    beforeEach(() => {
      jest.mocked(getStandardEventCallbacks).mockReturnValue(callbacks);
      mockManagement.getAllInstances.mockResolvedValue({
        instances: [{ id: 'a1' }, { id: 'b2' }, { id: 'c3' }]
      });
      mockProcess.getNormalizedInstanceState.mockImplementation(id => (id === 'b2' ? 'running' : 'queued'));
    });

    it('starts every server that is not up, with the standard callbacks', async () => {
      const result = await serverLifecycleService.startAllInstances(0);

      expect(result).toEqual({ started: ['a1', 'c3'], failed: [] });
      expect(mockProcess.startServerProcess).toHaveBeenCalledTimes(2);
      expect(mockProcess.setupProcessMonitoring).toHaveBeenCalledWith('a1', callbacks.onLog, callbacks.onState);
    });

    // The handler marks them 'queued' up front; one that fails its checks used to stay queued.
    it('limits Start All to the given servers', async () => {
      const result = await serverLifecycleService.startAllInstances(0, ['c3']);

      expect(result).toEqual({ started: ['c3'], failed: [] });
      expect(mockProcess.startServerProcess).toHaveBeenCalledTimes(1);
    });

    it('reports a server that fails to start as stopped again', async () => {
      mockUdp.mockResolvedValueOnce(true);

      const result = await serverLifecycleService.startAllInstances(0);

      expect(result).toEqual({ started: ['c3'], failed: ['a1'] });
      expect(mockProcess.setInstanceState).toHaveBeenCalledWith('a1', 'stopped');
      expect(callbacks.onState).toHaveBeenCalledWith('stopped');
    });
  });

  describe('stopAllInstances', () => {
    it('stops every running or starting server', async () => {
      mockManagement.getAllInstances.mockResolvedValue({ instances: [{ id: 'a1' }, { id: 'b2' }, { id: 'c3' }] });
      mockProcess.getNormalizedInstanceState.mockImplementation(id => ({ a1: 'running', b2: 'stopped', c3: 'starting' }[id] ?? 'stopped'));
      mockProcess.stopServerProcess.mockResolvedValue({ success: true });

      await expect(serverLifecycleService.stopAllInstances()).resolves.toEqual({ stopped: ['a1', 'c3'], failed: [] });
      expect(mockProcess.stopServerProcess).not.toHaveBeenCalledWith('b2');
    });

    it('limits Stop All to the given servers', async () => {
      mockManagement.getAllInstances.mockResolvedValue({ instances: [{ id: 'a1' }, { id: 'b2' }, { id: 'c3' }] });
      mockProcess.getNormalizedInstanceState.mockReturnValue('running');
      mockProcess.stopServerProcess.mockResolvedValue({ success: true });

      await expect(serverLifecycleService.stopAllInstances(['c3'])).resolves.toEqual({ stopped: ['c3'], failed: [] });
      expect(mockProcess.stopServerProcess).toHaveBeenCalledTimes(1);
    });
  });
});
