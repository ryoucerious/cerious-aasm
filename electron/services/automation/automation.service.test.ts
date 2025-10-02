import { AutomationService } from './automation.service';
import { ServerAutomation } from '../../types/automation.types';

jest.mock('./automation-config.service');
jest.mock('./automation-status.service');
jest.mock('./crash-detection.service');
jest.mock('./scheduled-restart.service');
jest.mock('./automation-instances.service');
jest.mock('../../utils/ark/instance.utils', () => ({
  getAllInstances: jest.fn()
}));
jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: {
    getStandardEventCallbacks: jest.fn(() => ({ onLog: jest.fn(), onState: jest.fn() })),
    startServerInstance: jest.fn()
  }
}));

const { getAllInstances } = require('../../utils/ark/instance.utils');

const { serverInstanceService } = require('../server-instance/server-instance.service');

function makeAutomation(overrides: Partial<ServerAutomation['settings']> = {}) {
  return {
    serverId: 'id',
    settings: {
      autoStartOnAppLaunch: false,
      autoStartOnBoot: false,
      crashDetectionEnabled: false,
      crashDetectionInterval: 60000,
      maxRestartAttempts: 3,
      scheduledRestartEnabled: false,
      restartFrequency: (overrides.restartFrequency ?? 'daily') as 'daily' | 'weekly' | 'custom',
      restartTime: '04:00',
      restartDays: [0],
      restartWarningMinutes: 15,
      ...overrides,
    },
    restartAttempts: 0,
    manuallyStopped: false,
    status: { isMonitoring: false, isScheduled: false }
  };
}

describe('AutomationService', () => {
  let service: AutomationService;

  beforeEach(() => {
    (getAllInstances as jest.Mock).mockResolvedValue([]);
    service = new AutomationService();
    jest.clearAllMocks();
    service['automations'].clear();
  });

  it('should delegate configureAutostart and manage crash/restart', async () => {
    service['automations'].set('id', makeAutomation({ crashDetectionEnabled: true, scheduledRestartEnabled: true }));
    const spyCrashStart = service['crashDetectionService'].startCrashDetection = jest.fn();
    const spyRestart = service['scheduledRestartService'].scheduleRestart = jest.fn();
    const spyCrashStop = service['crashDetectionService'].stopCrashDetection = jest.fn();
    const spyRestartStop = service['scheduledRestartService'].unscheduleRestart = jest.fn();
  service['configService'].configureAutostart = jest.fn(async () => ({ success: true }));
  await service.configureAutostart('id', true, true);
    expect(spyCrashStart).toHaveBeenCalledWith('id');
    expect(spyRestart).toHaveBeenCalledWith('id');
    service['automations'].get('id')!.settings.crashDetectionEnabled = false;
    service['automations'].get('id')!.settings.scheduledRestartEnabled = false;
  service['configService'].configureAutostart = jest.fn(async () => ({ success: true }));
  await service.configureAutostart('id', true, true);
    expect(spyCrashStop).toHaveBeenCalledWith('id');
    expect(spyRestartStop).toHaveBeenCalledWith('id');
  });

  it('should delegate configureCrashDetection', async () => {
    const spyStart = service['crashDetectionService'].startCrashDetection = jest.fn();
    const spyStop = service['crashDetectionService'].stopCrashDetection = jest.fn();
  service['configService'].configureCrashDetection = jest.fn(async () => ({ success: true }));
  await service.configureCrashDetection('id', true, 100, 2);
    expect(spyStart).toHaveBeenCalledWith('id');
  service['configService'].configureCrashDetection = jest.fn(async () => ({ success: true }));
  await service.configureCrashDetection('id', false, 100, 2);
    expect(spyStop).toHaveBeenCalledWith('id');
  });

  it('should delegate configureScheduledRestart', async () => {
    const spySchedule = service['scheduledRestartService'].scheduleRestart = jest.fn();
    const spyUnschedule = service['scheduledRestartService'].unscheduleRestart = jest.fn();
  service['configService'].configureScheduledRestart = jest.fn(async () => ({ success: true }));
  await service.configureScheduledRestart('id', true, 'daily', '02:00', [0], 5);
    expect(spySchedule).toHaveBeenCalledWith('id');
  service['configService'].configureScheduledRestart = jest.fn(async () => ({ success: true }));
  await service.configureScheduledRestart('id', false, 'daily', '02:00', [0], 5);
    expect(spyUnschedule).toHaveBeenCalledWith('id');
  });

  it('should delegate getAutostartInstanceIds', () => {
    const spy = service['statusService'].getAutostartInstanceIds = jest.fn(() => ['id']);
    expect(service.getAutostartInstanceIds()).toEqual(['id']);
    expect(spy).toHaveBeenCalled();
  });

  it('should delegate getAutomationStatus', async () => {
  const spy = service['statusService'].getAutomationStatus = jest.fn(async () => ({ success: true }));
  const result = await service.getAutomationStatus('id');
  expect(result.success).toBe(true);
  expect(spy).toHaveBeenCalled();
  });

  it('should delegate setManuallyStopped', () => {
    const spy = service['statusService'].setManuallyStopped = jest.fn();
    service.setManuallyStopped('id', true);
    expect(spy).toHaveBeenCalledWith('id', true);
  });

  it('should handleAutoStartOnAppLaunch and start servers', async () => {
    service['automations'].set('id', makeAutomation({ autoStartOnAppLaunch: true }));
  jest.useFakeTimers();
  await service.handleAutoStartOnAppLaunch();
  jest.advanceTimersByTime(4000);
  jest.runAllTimers();
  expect(serverInstanceService.getStandardEventCallbacks).toHaveBeenCalledWith('id');
  expect(serverInstanceService.startServerInstance).toHaveBeenCalled();
  });

  it('should initializeAutomation and start crash/restart', () => {
    const spyCrash = service['crashDetectionService'].startCrashDetection = jest.fn();
    const spyRestart = service['scheduledRestartService'].scheduleRestart = jest.fn();
    service['automations'].set('id', makeAutomation({ crashDetectionEnabled: true, scheduledRestartEnabled: true }));
    service.initializeAutomation();
    expect(spyCrash).toHaveBeenCalledWith('id');
    expect(spyRestart).toHaveBeenCalledWith('id');
  });

  it('should cleanup and stop crash/restart', () => {
    const spyCrash = service['crashDetectionService'].stopCrashDetection = jest.fn();
    const spyRestart = service['scheduledRestartService'].unscheduleRestart = jest.fn();
    service['automations'].set('id', makeAutomation());
    service.cleanup();
    expect(spyCrash).toHaveBeenCalledWith('id');
    expect(spyRestart).toHaveBeenCalledWith('id');
  });
});
