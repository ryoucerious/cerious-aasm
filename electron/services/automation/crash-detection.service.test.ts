import { CrashDetectionService } from './crash-detection.service';
import { ServerAutomation } from '../../types/automation.types';

jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: {
    getStandardEventCallbacks: jest.fn(() => ({ onLog: jest.fn(), onState: jest.fn() })),
    startServerInstance: jest.fn()
  }
}));
jest.mock('../server-instance/server-lifecycle.service');
jest.mock('../../utils/ark/instance.utils', () => ({
  getInstance: jest.fn(),
  saveInstance: jest.fn()
}));
jest.mock('../server-instance/server-process.service', () => ({
  serverProcessService: {
    getInstanceState: jest.fn(),
    getServerProcess: jest.fn(),
    setInstanceState: jest.fn()
  }
}));

const { serverInstanceService } = require('../server-instance/server-instance.service');
const { serverProcessService } = require('../server-instance/server-process.service');
const { getInstance, saveInstance } = require('../../utils/ark/instance.utils');

function makeAutomation(overrides: Partial<ServerAutomation['settings']> = {}) {
  return {
    serverId: 'id',
    settings: {
      autoStartOnAppLaunch: false,
      autoStartOnBoot: false,
      crashDetectionEnabled: true,
      crashDetectionInterval: 10,
      maxRestartAttempts: 2,
      scheduledRestartEnabled: false,
      restartFrequency: (overrides.restartFrequency ?? 'daily') as 'daily' | 'weekly' | 'custom',
      restartTime: '04:00',
      restartDays: [0],
      restartWarningMinutes: 15,
      ...overrides
    },
    restartAttempts: 0,
    manuallyStopped: false,
    status: { isMonitoring: false, isScheduled: false }
  };
}

describe('CrashDetectionService', () => {
  let automations: Map<string, ServerAutomation>;
  let service: CrashDetectionService;

  beforeEach(() => {
    automations = new Map();
    service = new CrashDetectionService(automations);
    jest.clearAllMocks();
    automations.clear();
  });

  it('should start and stop crash detection', () => {
    automations.set('id', makeAutomation());
    service.startCrashDetection('id');
    expect(automations.get('id')!.status.isMonitoring).toBe(true);
    service.stopCrashDetection('id');
    expect(automations.get('id')!.status.isMonitoring).toBe(false);
  });

  it('should not start crash detection if automation missing', () => {
    service.startCrashDetection('missing');
    expect(automations.size).toBe(0);
  });

  it('should not stop crash detection if automation missing', () => {
    expect(() => service.stopCrashDetection('missing')).not.toThrow();
  });

  it('should detect crash and restart server', async () => {
    automations.set('id', makeAutomation());
    serverProcessService.getInstanceState.mockReturnValue('running');
    serverProcessService.getServerProcess.mockReturnValue(undefined);
    getInstance.mockReturnValue({});
    await service['checkForCrash']('id');
    expect(serverInstanceService.startServerInstance).toHaveBeenCalled();
    expect(automations.get('id')!.restartAttempts).toBe(1);
    expect(saveInstance).toHaveBeenCalled();
  });

  it('should not restart if manually stopped', async () => {
    const auto = makeAutomation();
    auto.manuallyStopped = true;
    automations.set('id', auto);
    serverProcessService.getInstanceState.mockReturnValue('running');
    serverProcessService.getServerProcess.mockReturnValue(undefined);
    await service['checkForCrash']('id');
    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    expect(automations.get('id')!.manuallyStopped).toBe(false);
  });

  it('should stop monitoring after max restart attempts', async () => {
    const auto = makeAutomation();
    auto.restartAttempts = 2;
    automations.set('id', auto);
    serverProcessService.getInstanceState.mockReturnValue('running');
    serverProcessService.getServerProcess.mockReturnValue(undefined);
    await service['checkForCrash']('id');
    expect(automations.get('id')!.status.isMonitoring).toBe(false);
    expect(serverProcessService.setInstanceState).toHaveBeenCalledWith('id', 'stopped');
  });

  it('should reset restartAttempts if server running and process exists', async () => {
    const auto = makeAutomation();
    auto.restartAttempts = 2;
    automations.set('id', auto);
    serverProcessService.getInstanceState.mockReturnValue('running');
    serverProcessService.getServerProcess.mockReturnValue({});
    getInstance.mockReturnValue({});
    await service['checkForCrash']('id');
    expect(automations.get('id')!.restartAttempts).toBe(0);
    expect(saveInstance).toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    automations.set('id', makeAutomation());
    serverProcessService.getInstanceState.mockImplementation(() => { throw new Error('fail'); });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await service['checkForCrash']('id');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
