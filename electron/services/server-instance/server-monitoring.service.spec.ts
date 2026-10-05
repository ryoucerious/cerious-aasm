jest.mock('../../utils/platform.utils', () => ({
  getProcessMemoryUsage: jest.fn(),
  getProcessCpuSeconds: jest.fn(),
  processCpuPercent: jest.fn(() => 25)
}));
jest.mock('../rcon.service', () => ({ rconService: { executeRconCommand: jest.fn(), connectRcon: jest.fn() } }));
jest.mock('../../utils/rcon.utils', () => ({ isRconConnected: jest.fn(), isRconConnecting: jest.fn() }));
jest.mock('../../utils/ark/ark-server/ark-server-logging.utils', () => ({ getInstanceLogs: jest.fn() }));
jest.mock('../../utils/ark/ark-server/ark-server-state.utils', () => ({ getNormalizedInstanceState: jest.fn() }));
jest.mock('./server-process.service', () => ({ serverProcessService: { getServerProcess: jest.fn() } }));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));

import { ServerMonitoringService } from './server-monitoring.service';
import { getProcessCpuSeconds, getProcessMemoryUsage } from '../../utils/platform.utils';
import { rconService } from '../rcon.service';
import { isRconConnected, isRconConnecting } from '../../utils/rcon.utils';
import { getInstanceLogs } from '../../utils/ark/ark-server/ark-server-logging.utils';
import { getNormalizedInstanceState } from '../../utils/ark/ark-server/ark-server-state.utils';
import { serverProcessService } from './server-process.service';
import { messagingService } from '../messaging.service';

const mockRcon = jest.mocked(rconService);
const mockProcess = jest.mocked(serverProcessService);

function listPlayers(response: string) {
  mockRcon.executeRconCommand.mockResolvedValue({ success: true, response, instanceId: 'a1' });
}

describe('ServerMonitoringService', () => {
  let service: ServerMonitoringService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new ServerMonitoringService();
    jest.mocked(isRconConnected).mockReturnValue(true);
    jest.mocked(isRconConnecting).mockReturnValue(false);
    jest.mocked(getNormalizedInstanceState).mockReturnValue('running');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Runs one polling interval and lets its async body finish. */
  async function tick(ms: number): Promise<void> {
    await jest.advanceTimersByTimeAsync(ms);
  }

  describe('getInstanceLogs', () => {
    it('joins the log lines', () => {
      jest.mocked(getInstanceLogs).mockReturnValue(['line1', 'line2']);

      expect(service.getInstanceLogs('a1', 100)).toEqual({ log: 'line1\nline2', instanceId: 'a1' });
      expect(getInstanceLogs).toHaveBeenCalledWith('a1', 100);
    });

    it('returns an empty log when reading fails', () => {
      jest.mocked(getInstanceLogs).mockImplementation(() => { throw new Error('EBUSY'); });

      expect(service.getInstanceLogs('a1')).toEqual({ log: '', instanceId: 'a1' });
    });
  });

  describe('player polling', () => {
    it('reports the player count every 30 seconds when it changes', async () => {
      const callback = jest.fn();
      listPlayers('There are 5 players connected');

      service.startPlayerPolling('a1', callback);
      await tick(30000);
      await tick(30000);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('a1', 5);
      expect(service.getLatestPlayerCount('a1')).toBe(5);
      expect(service.getPlayerCount('a1')).toEqual({ instanceId: 'a1', players: 5 });
    });

    it('keeps polling after an RCON error', async () => {
      const callback = jest.fn();
      mockRcon.executeRconCommand.mockRejectedValueOnce(new Error('RCON error'));
      listPlayers('There are 2 players connected');

      service.startPlayerPolling('a1', callback);
      await tick(30000);
      await tick(30000);

      expect(callback).toHaveBeenCalledWith('a1', 2);
    });

    it('replaces an earlier poller for the same instance', async () => {
      const first = jest.fn();
      const second = jest.fn();
      listPlayers('There are 2 players connected');

      service.startPlayerPolling('a1', first);
      service.startPlayerPolling('a1', second);
      await tick(30000);

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith('a1', 2);
    });

    // A stopped server used to keep its last count in the instance list, and its next start
    // logged a spurious "N players left".
    it('forgets the last count when polling stops', async () => {
      listPlayers('There are 4 players connected');
      service.startPlayerPolling('a1', jest.fn());
      await tick(30000);

      service.stopPlayerPolling('a1');
      await tick(30000);

      expect(service.getLatestPlayerCount('a1')).toBe(0);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);
    });

    it('reconnects RCON while the server runs and tells every client once it connects', async () => {
      jest.mocked(isRconConnected).mockReturnValue(false);
      mockRcon.connectRcon.mockResolvedValue({ success: true, connected: true, instanceId: 'a1' });

      service.startPlayerPolling('a1', jest.fn());
      await tick(30000);

      expect(mockRcon.connectRcon).toHaveBeenCalledWith('a1');
      expect(messagingService.sendToAll).toHaveBeenCalledWith('rcon-status', { instanceId: 'a1', connected: true });
      expect(mockRcon.executeRconCommand).not.toHaveBeenCalled();
    });

    it('leaves a connect already in progress alone', async () => {
      jest.mocked(isRconConnected).mockReturnValue(false);
      jest.mocked(isRconConnecting).mockReturnValue(true);

      service.startPlayerPolling('a1', jest.fn());
      await tick(30000);

      expect(mockRcon.connectRcon).not.toHaveBeenCalled();
    });
  });

  describe('memory polling', () => {
    it('reports the memory of the tracked process every minute', async () => {
      const callback = jest.fn();
      mockProcess.getServerProcess.mockReturnValue({ pid: 123 } as never);
      jest.mocked(getProcessMemoryUsage).mockResolvedValue(512);

      service.startMemoryPolling('a1', callback);
      await tick(60000);

      expect(callback).toHaveBeenCalledWith('a1', 512);
      expect(getProcessMemoryUsage).toHaveBeenCalledWith(123);
    });

    it('stays quiet without a process or a reading', async () => {
      const callback = jest.fn();
      mockProcess.getServerProcess.mockReturnValueOnce(null).mockReturnValue({ pid: 123 } as never);
      jest.mocked(getProcessMemoryUsage).mockResolvedValue(null);

      service.startMemoryPolling('a1', callback);
      await tick(60000);
      await tick(60000);

      expect(callback).not.toHaveBeenCalled();
    });

    it('stops', async () => {
      const callback = jest.fn();
      mockProcess.getServerProcess.mockReturnValue({ pid: 123 } as never);
      jest.mocked(getProcessMemoryUsage).mockResolvedValue(512);

      service.startMemoryPolling('a1', callback);
      service.stopMemoryPolling('a1');
      await tick(60000);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('CPU polling', () => {
    it('reports a percentage from the second sample on, and forgets it when stopped', async () => {
      const callback = jest.fn();
      mockProcess.getServerProcess.mockReturnValue({ pid: 123 } as never);
      jest.mocked(getProcessCpuSeconds).mockResolvedValueOnce(10).mockResolvedValueOnce(12);

      service.startCpuPolling('a1', callback, 10000);
      await tick(10000);
      expect(callback).not.toHaveBeenCalled();
      await tick(10000);

      expect(callback).toHaveBeenCalledWith('a1', 25);
      expect(service.getLatestCpuPercent('a1')).toBe(25);
      service.stopCpuPolling('a1');
      expect(service.getLatestCpuPercent('a1')).toBeNull();
    });
  });

  describe('getPlayerCountFromRcon', () => {
    it.each([
      ['There are 7 players connected', 7],
      ['There are 3 of a max 10 players connected', 3],
      ['1. PlayerOne\n2. PlayerTwo\n3. PlayerThree\nSome other text', 3],
      ['No Players Connected', 0],
      ['Some unparseable response', 0]
    ])('reads %p as %p', async (response, count) => {
      listPlayers(response);

      await expect(service.getPlayerCountFromRcon('a1')).resolves.toBe(count);
    });

    it('returns null when the command fails', async () => {
      mockRcon.executeRconCommand.mockResolvedValue({ success: false, instanceId: 'a1' });

      await expect(service.getPlayerCountFromRcon('a1')).resolves.toBeNull();
    });
  });
});
