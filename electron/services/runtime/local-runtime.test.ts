jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: { startServerInstance: jest.fn() }
}));
jest.mock('../server-instance/server-lifecycle.service', () => ({ serverLifecycleService: {} }));
jest.mock('../server-instance/server-management.service', () => ({
  serverManagementService: { getAllInstances: jest.fn().mockResolvedValue({ instances: [] }) }
}));
jest.mock('../server-instance/server-monitoring.service', () => ({
  serverMonitoringService: {
    startMemoryPolling: jest.fn(), startPlayerPolling: jest.fn(), startCpuPolling: jest.fn(),
    stopMemoryPolling: jest.fn(), stopPlayerPolling: jest.fn(), stopCpuPolling: jest.fn()
  }
}));
jest.mock('../server-instance/server-operations.service', () => ({ serverOperationsService: {} }));
jest.mock('../server-instance/server-process.service', () => ({ serverProcessService: {} }));
jest.mock('../../utils/ark/ark-server/ark-server-state.utils', () => ({ getNormalizedInstanceState: jest.fn() }));
jest.mock('../../utils/ark/instance.utils', () => ({}));
jest.mock('../ark-config.service', () => ({ arkConfigService: {} }));
jest.mock('../rcon.service', () => ({ rconService: {} }));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));

import { serverInstanceService } from '../server-instance/server-instance.service';
import { messagingService } from '../messaging.service';
import { localRuntime } from './local-runtime';

const startServerInstance = serverInstanceService.startServerInstance as jest.Mock;
const sendToAll = messagingService.sendToAll as jest.Mock;

describe('LocalRuntime.start', () => {
  beforeEach(() => {
    startServerInstance.mockResolvedValue({ started: true, instanceId: 's1' });
  });

  it('broadcasts the state and log of a server started without callbacks, as a local start does', async () => {
    await localRuntime.start('s1');

    const [, onLog, onState] = startServerInstance.mock.calls[0];
    onState('running');
    onLog('Server has completed startup');

    expect(sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'running', instanceId: 's1' });
    expect(sendToAll).toHaveBeenCalledWith('server-instance-log', { log: 'Server has completed startup', instanceId: 's1' });
  });

  it('uses the callbacks it is given', async () => {
    const onLog = jest.fn();
    const onState = jest.fn();

    await localRuntime.start('s1', onLog, onState);

    expect(startServerInstance).toHaveBeenCalledWith('s1', onLog, onState);
  });
});
