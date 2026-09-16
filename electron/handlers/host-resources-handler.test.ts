import { jest } from '@jest/globals';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
  },
}));

jest.mock('../services/platform.service', () => ({
  platformService: {
    getConfigPath: jest.fn(() => 'C:/config'),
  },
}));

jest.mock('../utils/platform.utils', () => ({
  sampleCpuTimes: jest.fn(),
  cpuPercentFromSamples: jest.fn(),
  getTotalMemory: jest.fn(),
  getFreeMemory: jest.fn(),
  getDiskUsage: jest.fn(),
}));

import { messagingService } from '../services/messaging.service';
import { platformService } from '../services/platform.service';
import * as platformUtils from '../utils/platform.utils';

const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;
const utils = platformUtils as jest.Mocked<typeof platformUtils>;

describe('host-resources-handler', () => {
  let handler: (payload: any, sender: any) => Promise<void>;
  const sender = { id: 'sender-1' };

  beforeAll(() => {
    require('./host-resources-handler');
    handler = (mockMessaging.on as jest.Mock).mock.calls.find(call => call[0] === 'get-host-resources')?.[1] as any;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('registers the get-host-resources channel', () => {
    expect(handler).toBeDefined();
  });

  it('reports cpu, memory and disk usage to the originator', async () => {
    utils.sampleCpuTimes
      .mockReturnValueOnce({ idle: 100, total: 200 })
      .mockReturnValueOnce({ idle: 150, total: 300 });
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

  it('returns a null disk entry when disk usage cannot be read', async () => {
    utils.sampleCpuTimes.mockReturnValue({ idle: 1, total: 2 });
    utils.cpuPercentFromSamples.mockReturnValue(0);
    utils.getTotalMemory.mockReturnValue(10);
    utils.getFreeMemory.mockReturnValue(4);
    utils.getDiskUsage.mockResolvedValue(null);

    await handler({ requestId: 'r2' }, sender);

    const payload = (mockMessaging.sendToOriginator as jest.Mock).mock.calls[0][1] as any;
    expect(payload.disk).toBeNull();
    expect(payload.memory).toEqual({ used: 6, total: 10 });
  });

  it('still measures disk when the config path cannot be resolved', async () => {
    (platformService.getConfigPath as jest.Mock).mockImplementationOnce(() => { throw new Error('no app'); });
    utils.sampleCpuTimes.mockReturnValue({ idle: 1, total: 2 });
    utils.cpuPercentFromSamples.mockReturnValue(0);
    utils.getTotalMemory.mockReturnValue(10);
    utils.getFreeMemory.mockReturnValue(4);
    utils.getDiskUsage.mockResolvedValue({ total: 10, free: 5 });

    await handler({ requestId: 'r3' }, sender);

    expect(utils.getDiskUsage).toHaveBeenCalledWith('');
    expect((mockMessaging.sendToOriginator as jest.Mock).mock.calls[0][1]).toMatchObject({ disk: { used: 5, total: 10 } });
  });

  it('sends an error payload when sampling throws', async () => {
    utils.sampleCpuTimes.mockImplementation(() => { throw new Error('cpus unavailable'); });

    await handler({ requestId: 'r4' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-host-resources', {
      error: 'cpus unavailable',
      requestId: 'r4'
    }, sender);
  });
});
