import { AutomationService } from './automation.service';
import { ServerAutomation } from '../../types/automation.types';

jest.mock('./automation-config.service');
jest.mock('./automation-status.service');
jest.mock('./crash-detection.service');
jest.mock('./scheduled-restart.service');
jest.mock('./automation-instances.service');
jest.mock('../../utils/ark/instance.utils', () => ({
  getAllInstances: jest.fn(),
  getInstance: jest.fn()
}));
jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: { startServerInstance: jest.fn() }
}));
jest.mock('../server-instance/instance-events', () => ({
  getStandardEventCallbacks: jest.fn(() => ({ onLog: jest.fn(), onState: jest.fn() }))
}));
jest.mock('../../utils/global-config.utils', () => ({ loadGlobalConfig: jest.fn(() => ({ serverStartDelaySeconds: 60 })) }));
jest.mock('../scheduler.service', () => ({
  schedulerService: {
    initAllSchedules: jest.fn(() => Promise.resolve()),
    initSchedule: jest.fn(() => Promise.resolve()),
  }
}));

const { getAllInstances, getInstance } = require('../../utils/ark/instance.utils');

const { serverInstanceService } = require('../server-instance/server-instance.service');
const { getStandardEventCallbacks } = require('../server-instance/instance-events');
const { schedulerService } = require('../scheduler.service');

function makeAutomation(overrides: Partial<ServerAutomation['settings']> = {}) {
  return {
    serverId: 'id',
    settings: {
      autoStartOnAppLaunch: false,
      autoStartOnBoot: false,
      crashDetectionEnabled: false,
      crashDetectionInterval: 60,
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
  expect(getStandardEventCallbacks).toHaveBeenCalledWith('id');
  expect(serverInstanceService.startServerInstance).toHaveBeenCalled();
  });

  it('should initializeAutomation and start crash/restart', () => {
    const spyCrash = service['crashDetectionService'].startCrashDetection = jest.fn();
    const spyRestart = service['scheduledRestartService'].scheduleRestart = jest.fn();
    service['automations'].set('id', makeAutomation({ crashDetectionEnabled: true, scheduledRestartEnabled: true }));
    service.initializeAutomation();
    expect(spyCrash).toHaveBeenCalledWith('id');
    expect(spyRestart).toHaveBeenCalledWith('id');
    expect(schedulerService.initAllSchedules).toHaveBeenCalled();
  });

  // A deleted instance's timers used to keep running, and restarting it failed on every run.
  it('forgets a deleted instance, stopping its crash detection and scheduled restart', () => {
    const spyCrash = service['crashDetectionService'].stopCrashDetection = jest.fn();
    const spyRestart = service['scheduledRestartService'].unscheduleRestart = jest.fn();
    service['automations'].set('id', makeAutomation({ crashDetectionEnabled: true, scheduledRestartEnabled: true }));

    service.forgetInstance('id');

    expect(spyCrash).toHaveBeenCalledWith('id');
    expect(spyRestart).toHaveBeenCalledWith('id');
    expect(service['automations'].has('id')).toBe(false);
  });

  describe('restoreInstance', () => {
    it('re-creates a forgotten record from config.json and re-arms what it enables', () => {
      const spyCrash = service['crashDetectionService'].startCrashDetection = jest.fn();
      const spyRestart = service['scheduledRestartService'].scheduleRestart = jest.fn();
      getInstance.mockReturnValue({ id: 'id', crashDetectionEnabled: true, scheduledRestartEnabled: true, restartTime: '05:00' });

      service.restoreInstance('id');

      expect(service['automations'].get('id')!.settings).toMatchObject({ crashDetectionEnabled: true, restartTime: '05:00' });
      expect(spyCrash).toHaveBeenCalledWith('id');
      expect(spyRestart).toHaveBeenCalledWith('id');
    });

    it('does nothing for an instance that is gone', () => {
      getInstance.mockReturnValue(null);

      service.restoreInstance('id');

      expect(service['automations'].has('id')).toBe(false);
    });

    // The id comes from a client. getInstance throws on a bad one, which was logged with a stack
    // and the raw id.
    it.each(['../x', '', 'a b'])('quietly ignores the invalid id %p', serverId => {
      service.restoreInstance(serverId);

      expect(getInstance).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
      expect(service['automations'].has(serverId)).toBe(false);
    });
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
