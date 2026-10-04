import { serverOperationsService } from './server-operations.service';

jest.mock('../../utils/validation.utils');
jest.mock('../../utils/ark/instance.utils');
jest.mock('../rcon.service');
jest.mock('./server-process.service', () => ({
  serverProcessService: {
    getNormalizedInstanceState: jest.fn(() => 'stopped'),
    setInstanceState: jest.fn(),
    isStopInProgress: jest.fn(() => false),
    hasActiveProcess: jest.fn(() => true)
  }
}));
jest.mock('../automation/automation.service', () => ({ automationService: { setManuallyStopped: jest.fn() } }));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));

const { serverProcessService } = jest.requireMock('./server-process.service');
const { automationService } = jest.requireMock('../automation/automation.service');
const { messagingService } = jest.requireMock('../messaging.service');

describe('ServerOperationsService', () => {
  let validateInstanceIdMock: any;
  let instanceUtilsMock: any;
  let rconServiceMock: any;

  beforeEach(() => {
    jest.clearAllMocks();

    validateInstanceIdMock = jest.fn();
    jest.mocked(require('../../utils/validation.utils')).validateInstanceId = validateInstanceIdMock;

    instanceUtilsMock = {
      getInstance: jest.fn()
    };
    jest.mocked(require('../../utils/ark/instance.utils')).getInstance = instanceUtilsMock.getInstance;

    rconServiceMock = {
      connectRcon: jest.fn(),
      disconnectRcon: jest.fn(),
      getRconStatus: jest.fn(),
      executeRconCommand: jest.fn()
    };
    jest.mocked(require('../rcon.service')).rconService = rconServiceMock;
  });

  describe('connectRcon', () => {
    it('should connect RCON successfully', async () => {
      const instanceId = 'instance1';
      const instance = { id: instanceId, name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockReturnValue(instance);
      rconServiceMock.connectRcon.mockResolvedValue({ connected: true });

      const result = await serverOperationsService.connectRcon(instanceId);

      expect(result).toEqual({
        success: true,
        connected: true,
        instanceId
      });
    });

    it('should handle invalid instance ID', async () => {
      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverOperationsService.connectRcon('invalid');

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance ID',
        instanceId: 'invalid',
        connected: false
      });
    });

    it('should handle instance not found', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockReturnValue(null);

      const result = await serverOperationsService.connectRcon('instance1');

      expect(result).toEqual({
        success: false,
        error: 'Instance not found',
        instanceId: 'instance1',
        connected: false
      });
    });

    it('should handle connection failure', async () => {
      const instanceId = 'instance1';
      const instance = { id: instanceId, name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockReturnValue(instance);
      rconServiceMock.connectRcon.mockResolvedValue({ connected: false });

      const result = await serverOperationsService.connectRcon(instanceId);

      expect(result).toEqual({
        success: true,
        connected: false,
        instanceId
      });
    });

    it('should handle exception', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockImplementation(() => { throw new Error('DB error'); });

      const result = await serverOperationsService.connectRcon('instance1');

      expect(result).toEqual({
        success: false,
        error: 'DB error',
        instanceId: 'instance1',
        connected: false
      });
    });
  });

  describe('disconnectRcon', () => {
    it('should disconnect RCON successfully', async () => {
      rconServiceMock.disconnectRcon.mockResolvedValue({});

      const result = await serverOperationsService.disconnectRcon('instance1');

      expect(result).toEqual({
        success: true,
        connected: false,
        instanceId: 'instance1'
      });
    });

    it('should handle exception', async () => {
      rconServiceMock.disconnectRcon.mockRejectedValue(new Error('Disconnect error'));

      const result = await serverOperationsService.disconnectRcon('instance1');

      expect(result).toEqual({
        success: false,
        error: 'Disconnect error',
        instanceId: 'instance1',
        connected: false
      });
    });
  });

  describe('getRconStatus', () => {
    it('should get RCON status successfully', () => {
      rconServiceMock.getRconStatus.mockReturnValue({
        success: true,
        connected: true,
        instanceId: 'instance1'
      });

      const result = serverOperationsService.getRconStatus('instance1');

      expect(result).toEqual({
        success: true,
        connected: true,
        instanceId: 'instance1'
      });
    });

    it('should handle disconnected status', () => {
      rconServiceMock.getRconStatus.mockReturnValue({
        success: false,
        connected: false,
        instanceId: 'instance1'
      });

      const result = serverOperationsService.getRconStatus('instance1');

      expect(result).toEqual({
        success: false,
        connected: false,
        instanceId: 'instance1'
      });
    });
  });

  describe('executeRconCommand', () => {
    // A server shut down from the RCON console used to be reported, and restarted, as crashed.
    describe('a shutdown command', () => {
      beforeEach(() => {
        validateInstanceIdMock.mockReturnValue(true);
        rconServiceMock.getRconStatus.mockReturnValue({ success: true, connected: true, instanceId: 'instance1' });
        rconServiceMock.executeRconCommand.mockResolvedValue({ success: true, response: 'Exiting...' });
        serverProcessService.getNormalizedInstanceState.mockReturnValue('running');
        serverProcessService.isStopInProgress.mockReturnValue(false);
      });

      it.each(['DoExit', '  doexit  ', 'admincheat DoExit', 'cheat quit', 'exit', 'Quit now'])(
        'marks the server as stopping by hand before sending %p', async command => {
          await serverOperationsService.executeRconCommand('instance1', command);

          expect(serverProcessService.setInstanceState).toHaveBeenCalledWith('instance1', 'stopping');
          expect(automationService.setManuallyStopped).toHaveBeenCalledWith('instance1', true);
          expect(messagingService.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'stopping', instanceId: 'instance1' });
          expect(serverProcessService.setInstanceState.mock.invocationCallOrder[0])
            .toBeLessThan(rconServiceMock.executeRconCommand.mock.invocationCallOrder[0]);
        }
      );

      it.each(['SaveWorld', 'exitlevel', 'Broadcast exit soon'])('leaves %p alone', async command => {
        await serverOperationsService.executeRconCommand('instance1', command);

        expect(serverProcessService.setInstanceState).not.toHaveBeenCalled();
      });

      it('leaves a server that is not up alone', async () => {
        serverProcessService.getNormalizedInstanceState.mockReturnValue('stopped');

        await serverOperationsService.executeRconCommand('instance1', 'DoExit');

        expect(serverProcessService.setInstanceState).not.toHaveBeenCalled();
      });

      it('does nothing when RCON is not connected, since the command cannot be sent', async () => {
        rconServiceMock.getRconStatus.mockReturnValue({ success: true, connected: false, instanceId: 'instance1' });

        await serverOperationsService.executeRconCommand('instance1', 'DoExit');

        expect(serverProcessService.setInstanceState).not.toHaveBeenCalled();
        expect(automationService.setManuallyStopped).not.toHaveBeenCalled();
      });

      // Left 'stopping', a server that never got the command would have its next crash taken for a
      // stop, and crash detection would leave it down.
      it.each([
        ['the connection went before it was sent', 'RCON not connected for this instance'],
        ['it timed out queued behind another command', 'RCON command timed out after 30000ms']
      ])('puts the state back when %s', async (_label, error) => {
        serverProcessService.getNormalizedInstanceState.mockReturnValueOnce('running').mockReturnValue('stopping');
        rconServiceMock.executeRconCommand.mockResolvedValue({ success: false, error, notSent: true, instanceId: 'instance1' });

        await expect(serverOperationsService.executeRconCommand('instance1', 'DoExit'))
          .resolves.toEqual({ success: false, error, response: undefined, instanceId: 'instance1' });

        expect(serverProcessService.setInstanceState.mock.calls).toEqual([['instance1', 'stopping'], ['instance1', 'running']]);
        expect(automationService.setManuallyStopped).toHaveBeenLastCalledWith('instance1', false);
        expect(messagingService.sendToAll).toHaveBeenLastCalledWith('server-instance-state', { state: 'running', instanceId: 'instance1' });
      });

      it('restores a server that was still starting to starting', async () => {
        serverProcessService.getNormalizedInstanceState.mockReturnValueOnce('starting').mockReturnValue('stopping');
        rconServiceMock.executeRconCommand.mockResolvedValue({ success: false, error: 'RCON not connected', notSent: true, instanceId: 'instance1' });

        await serverOperationsService.executeRconCommand('instance1', 'DoExit');

        expect(serverProcessService.setInstanceState).toHaveBeenLastCalledWith('instance1', 'starting');
      });

      // DoExit usually "fails" with the connection closing before an answer: the server is exiting.
      it('keeps the mark when the command went out, answered or not', async () => {
        serverProcessService.getNormalizedInstanceState.mockReturnValueOnce('running').mockReturnValue('stopping');
        rconServiceMock.executeRconCommand.mockResolvedValue({ success: false, error: 'RCON connection closed before response', instanceId: 'instance1' });

        await serverOperationsService.executeRconCommand('instance1', 'DoExit');

        expect(serverProcessService.setInstanceState.mock.calls).toEqual([['instance1', 'stopping']]);
        expect(automationService.setManuallyStopped).not.toHaveBeenCalledWith('instance1', false);
      });

      // Put back to running during a real stop, the stop's exit would read as a crash.
      it('leaves the mark to a stop that began while the command waited', async () => {
        serverProcessService.getNormalizedInstanceState.mockReturnValueOnce('running').mockReturnValue('stopping');
        let finish: (result: unknown) => void = () => undefined;
        rconServiceMock.executeRconCommand.mockReturnValue(new Promise(resolve => { finish = resolve; }));

        const pending = serverOperationsService.executeRconCommand('instance1', 'DoExit');
        serverProcessService.isStopInProgress.mockReturnValue(true);
        finish({ success: false, error: 'RCON command timed out after 30000ms', notSent: true, instanceId: 'instance1' });
        await pending;

        expect(serverProcessService.setInstanceState.mock.calls).toEqual([['instance1', 'stopping']]);
        expect(automationService.setManuallyStopped).not.toHaveBeenCalledWith('instance1', false);
      });

      describe('that went out but was ignored', () => {
        beforeEach(() => {
          jest.useFakeTimers();
          serverProcessService.getNormalizedInstanceState.mockReturnValueOnce('running').mockReturnValue('stopping');
          serverProcessService.hasActiveProcess.mockReturnValue(true);
        });

        afterEach(() => {
          jest.useRealTimers();
        });

        // Left 'stopping', the server's next crash would be taken for this stop and not restarted.
        it('puts the state back when the server is still up two minutes later', async () => {
          await serverOperationsService.executeRconCommand('instance1', 'DoExit');

          jest.advanceTimersByTime(2 * 60 * 1000 - 1);
          expect(serverProcessService.setInstanceState.mock.calls).toEqual([['instance1', 'stopping']]);

          jest.advanceTimersByTime(1);
          expect(serverProcessService.setInstanceState.mock.calls).toEqual([['instance1', 'stopping'], ['instance1', 'running']]);
          expect(automationService.setManuallyStopped).toHaveBeenLastCalledWith('instance1', false);
          expect(messagingService.sendToAll).toHaveBeenLastCalledWith('server-instance-state', { state: 'running', instanceId: 'instance1' });
        });

        it('keeps the mark once the server has exited', async () => {
          await serverOperationsService.executeRconCommand('instance1', 'DoExit');
          serverProcessService.hasActiveProcess.mockReturnValue(false);

          jest.advanceTimersByTime(2 * 60 * 1000);

          expect(serverProcessService.setInstanceState.mock.calls).toEqual([['instance1', 'stopping']]);
        });

        it('leaves the mark to a stop that has begun since', async () => {
          await serverOperationsService.executeRconCommand('instance1', 'DoExit');
          serverProcessService.isStopInProgress.mockReturnValue(true);

          jest.advanceTimersByTime(2 * 60 * 1000);

          expect(serverProcessService.setInstanceState.mock.calls).toEqual([['instance1', 'stopping']]);
        });

        it('never holds the process open with its check', async () => {
          const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

          await serverOperationsService.executeRconCommand('instance1', 'DoExit');

          expect(setTimeoutSpy.mock.results.map(result => (result.value as NodeJS.Timeout).hasRef())).toEqual([false]);
          jest.advanceTimersByTime(2 * 60 * 1000);
        });
      });

      it('leaves a state that has moved on since alone', async () => {
        serverProcessService.getNormalizedInstanceState.mockReturnValueOnce('running').mockReturnValue('stopped');
        rconServiceMock.executeRconCommand.mockResolvedValue({ success: false, error: 'RCON not connected', notSent: true, instanceId: 'instance1' });

        await serverOperationsService.executeRconCommand('instance1', 'DoExit');

        expect(serverProcessService.setInstanceState.mock.calls).toEqual([['instance1', 'stopping']]);
      });
    });

    it('should execute RCON command successfully', async () => {
      const instanceId = 'instance1';
      const command = 'ListPlayers';

      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'Player1, Player2'
      });

      const result = await serverOperationsService.executeRconCommand(instanceId, command);

      expect(result).toEqual({
        success: true,
        response: 'Player1, Player2',
        instanceId
      });
    });

    it('should handle invalid instance ID', async () => {
      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverOperationsService.executeRconCommand('invalid', 'command');

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance ID',
        instanceId: 'invalid'
      });
    });

    it('should handle invalid command', async () => {
      validateInstanceIdMock.mockReturnValue(true);

      const result = await serverOperationsService.executeRconCommand('instance1', '');

      expect(result).toEqual({
        success: false,
        error: 'Invalid command',
        instanceId: 'instance1'
      });
    });

    it('should handle null command', async () => {
      validateInstanceIdMock.mockReturnValue(true);

      const result = await serverOperationsService.executeRconCommand('instance1', null as any);

      expect(result).toEqual({
        success: false,
        error: 'Invalid command',
        instanceId: 'instance1'
      });
    });

    it('should handle command execution failure', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: false,
        error: 'Command failed'
      });

      const result = await serverOperationsService.executeRconCommand('instance1', 'InvalidCommand');

      expect(result).toEqual({
        success: false,
        error: 'Command failed',
        instanceId: 'instance1'
      });
    });

    it('should handle exception', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockRejectedValue(new Error('RCON error'));

      const result = await serverOperationsService.executeRconCommand('instance1', 'command');

      expect(result).toEqual({
        success: false,
        error: 'RCON error',
        instanceId: 'instance1'
      });
    });
  });
});
