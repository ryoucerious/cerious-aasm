import { messagingService } from '../services/messaging.service';
import { platformService } from '../services/platform.service';
import * as platformUtils from '../utils/platform.utils';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/platform.service', () => ({
  platformService: { getConfigPath: jest.fn() }
}));
jest.mock('../utils/platform.utils', () => ({
  sampleCpuTimes: jest.fn(),
  cpuPercentFromSamples: jest.fn(),
  getTotalMemory: jest.fn(),
  getFreeMemory: jest.fn(),
  getDiskUsage: jest.fn()
}));

const mockMessaging = jest.mocked(messagingService);
const utils = jest.mocked(platformUtils);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('host-resources-handler', () => {
  const sender = { send: jest.fn() };
  let handler: Listener;

  beforeAll(() => {
    require('./host-resources-handler');
    handler = mockMessaging.on.mock.calls.find(([channel]) => channel === 'get-host-resources')![1] as Listener;
  });

  beforeEach(() => {
    jest.mocked(platformService.getConfigPath).mockReturnValue('C:/config');
    utils.sampleCpuTimes.mockReturnValue({ idle: 1, total: 2 });
    utils.cpuPercentFromSamples.mockReturnValue(0);
    utils.getTotalMemory.mockReturnValue(10);
    utils.getFreeMemory.mockReturnValue(4);
    utils.getDiskUsage.mockResolvedValue({ total: 10, free: 5 });
  });

  function reply(): Record<string, unknown> {
    return mockMessaging.sendToOriginator.mock.calls[0][1] as Record<string, unknown>;
  }

  it('reports cpu over a short window, memory and disk usage to the requester', async () => {
    utils.sampleCpuTimes.mockReturnValueOnce({ idle: 100, total: 200 }).mockReturnValueOnce({ idle: 150, total: 300 });
    utils.cpuPercentFromSamples.mockReturnValue(50);
    utils.getTotalMemory.mockReturnValue(32_000);
    utils.getFreeMemory.mockReturnValue(12_000);
    utils.getDiskUsage.mockResolvedValue({ total: 1000, free: 400 });

    await handler({ requestId: 'r1' }, sender);

    expect(utils.cpuPercentFromSamples).toHaveBeenCalledWith({ idle: 100, total: 200 }, { idle: 150, total: 300 });
    expect(utils.getDiskUsage).toHaveBeenCalledWith('C:/config');
    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-host-resources', {
      cpuPercent: 50,
      memory: { used: 20_000, total: 32_000 },
      disk: { used: 600, total: 1000 },
      requestId: 'r1'
    }, sender);
  });

  it('reports a null disk when disk usage cannot be read', async () => {
    utils.getDiskUsage.mockResolvedValue(null);

    await handler({ requestId: 'r2' }, sender);

    expect(reply()).toMatchObject({ disk: null, memory: { used: 6, total: 10 } });
  });

  it('still measures a disk when the config path cannot be resolved', async () => {
    jest.mocked(platformService.getConfigPath).mockImplementationOnce(() => { throw new Error('no app'); });

    await handler({ requestId: 'r3' }, sender);

    expect(utils.getDiskUsage).toHaveBeenCalledWith('');
    expect(reply()).toMatchObject({ disk: { used: 5, total: 10 } });
  });

  it('replies { error } without success when sampling throws', async () => {
    utils.sampleCpuTimes.mockImplementation(() => { throw new Error('cpus unavailable'); });

    await handler({ requestId: 'r4' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-host-resources', { error: 'cpus unavailable', requestId: 'r4' }, sender);
  });

  it('answers a request without a payload', async () => {
    await handler(undefined, sender);

    expect(reply()).toMatchObject({ cpuPercent: 0, requestId: undefined });
  });
});
