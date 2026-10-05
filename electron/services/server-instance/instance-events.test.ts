jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));
jest.mock('./server-management.service', () => ({ serverManagementService: { getAllInstances: jest.fn() } }));
jest.mock('./server-monitoring.service', () => ({
  serverMonitoringService: {
    startMemoryPolling: jest.fn((id: string, callback: (id: string, memory: number) => void) => callback(id, 100)),
    startPlayerPolling: jest.fn((id: string, callback: (id: string, count: number) => void) => callback(id, 5)),
    startCpuPolling: jest.fn((id: string, callback: (id: string, cpu: number) => void) => callback(id, 12.5)),
    stopMemoryPolling: jest.fn(),
    stopPlayerPolling: jest.fn(),
    stopCpuPolling: jest.fn()
  }
}));
jest.mock('../rcon.service', () => ({ rconService: { connectRcon: jest.fn() } }));

import { getStandardEventCallbacks } from './instance-events';
import { messagingService } from '../messaging.service';
import { serverManagementService } from './server-management.service';
import { serverMonitoringService } from './server-monitoring.service';
import { rconService } from '../rcon.service';

const mockMessaging = jest.mocked(messagingService);
const mockManagement = jest.mocked(serverManagementService);
const mockMonitoring = jest.mocked(serverMonitoringService);

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('getStandardEventCallbacks', () => {
  const instances = [{ id: 'a1', name: 'Alpha' }];

  beforeEach(() => {
    mockManagement.getAllInstances.mockResolvedValue({ instances });
  });

  it('broadcasts log lines', () => {
    getStandardEventCallbacks('a1').onLog('line');

    expect(mockMessaging.sendToAll).toHaveBeenCalledWith('server-instance-log', { log: 'line', instanceId: 'a1' });
  });

  it('broadcasts the state and the refreshed list, and polls while running', async () => {
    getStandardEventCallbacks('a1').onState('running');
    await flush();

    expect(mockMessaging.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'running', instanceId: 'a1' });
    expect(mockMessaging.sendToAll).toHaveBeenCalledWith('server-instances', instances);
    expect(mockMessaging.sendToAll).toHaveBeenCalledWith('server-instance-memory', { instanceId: 'a1', memory: 100 });
    expect(mockMessaging.sendToAll).toHaveBeenCalledWith('server-instance-players', { instanceId: 'a1', players: 5, count: 5 });
    expect(mockMessaging.sendToAll).toHaveBeenCalledWith('server-instance-cpu', { instanceId: 'a1', cpu: 12.5 });
  });

  // The process service connects RCON when the server is up. A second connect from here used to
  // wait on that one and never answer, so no client learned RCON had connected.
  it('does not open an RCON connection of its own', async () => {
    jest.useFakeTimers();
    getStandardEventCallbacks('a1').onState('running');
    jest.advanceTimersByTime(5000);
    await flush();
    jest.useRealTimers();

    expect(rconService.connectRcon).not.toHaveBeenCalled();
    expect(mockMessaging.sendToAll).not.toHaveBeenCalledWith('rcon-status', expect.anything());
  });

  it.each(['stopped', 'crashed'])('stops polling and refreshes the list when %s', async state => {
    getStandardEventCallbacks('a1').onState(state);
    await flush();

    expect(mockMonitoring.stopMemoryPolling).toHaveBeenCalledWith('a1');
    expect(mockMonitoring.stopPlayerPolling).toHaveBeenCalledWith('a1');
    expect(mockMonitoring.stopCpuPolling).toHaveBeenCalledWith('a1');
    expect(mockMessaging.sendToAll).toHaveBeenCalledWith('server-instances', instances);
  });

  it('leaves the list alone for passing states', async () => {
    getStandardEventCallbacks('a1').onState('stopping');
    await flush();

    expect(mockManagement.getAllInstances).not.toHaveBeenCalled();
  });

  it('does not broadcast an empty list after a failed read', async () => {
    mockManagement.getAllInstances.mockResolvedValue({ instances: [] });

    getStandardEventCallbacks('a1').onState('stopped');
    await flush();

    expect(mockMessaging.sendToAll).not.toHaveBeenCalledWith('server-instances', expect.anything());
  });
});
