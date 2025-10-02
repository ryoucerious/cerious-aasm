import { ScheduledRestartService } from './scheduled-restart.service';
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
jest.mock('../../utils/rcon.utils', () => ({
  disconnectRcon: jest.fn(),
  sendRconCommand: jest.fn(),
  isRconConnected: jest.fn(),
  connectRcon: jest.fn()
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
const { sendRconCommand, isRconConnected } = require('../../utils/rcon.utils');

// Removed duplicate function declaration
function makeAutomation(
  overrides: Partial<ServerAutomation['settings']> = {},
  nextRestart?: Date
) {
  return {
    serverId: 'id',
    settings: {
      autoStartOnAppLaunch: false,
      autoStartOnBoot: false,
      crashDetectionEnabled: false,
      crashDetectionInterval: 10,
      maxRestartAttempts: 2,
      scheduledRestartEnabled: true,
      restartFrequency: (overrides.restartFrequency ?? 'daily') as 'daily' | 'weekly' | 'custom',
      restartTime: '04:00',
      restartDays: [0],
      restartWarningMinutes: 15,
      ...overrides
    },
    restartAttempts: 0,
    manuallyStopped: false,
    scheduledRestartTimer: undefined,
    status: { isMonitoring: false, isScheduled: false, nextRestart: nextRestart }
  };
}

describe('ScheduledRestartService', () => {
  let automations: Map<string, ServerAutomation>;
  let service: ScheduledRestartService;
  let serverInstanceService: any;
  let serverProcessService: any;
  let getInstance: any;
  let saveInstance: any;
  let sendRconCommand: any;
  let isRconConnected: any;

  beforeEach(() => {
    jest.resetModules();
    automations = new Map();
    jest.mock('../server-instance/server-process.service', () => ({
      serverProcessService: {
        getInstanceState: jest.fn().mockReturnValue('running'),
        getServerProcess: jest.fn().mockReturnValue({ kill: jest.fn() }),
        setInstanceState: jest.fn()
      }
    }));
    jest.mock('../../utils/ark/instance.utils', () => ({
      getInstance: jest.fn().mockReturnValue({}),
      saveInstance: jest.fn()
    }));
    jest.mock('../../utils/rcon.utils', () => ({
      disconnectRcon: jest.fn(),
      sendRconCommand: jest.fn(),
      isRconConnected: jest.fn()
    }));
    jest.mock('../server-instance/server-instance.service', () => ({
      serverInstanceService: {
        getStandardEventCallbacks: jest.fn(() => ({ onLog: jest.fn(), onState: jest.fn() })),
        startServerInstance: jest.fn()
      }
    }));
    jest.clearAllMocks();
    automations.clear();
    // Re-require all dependencies after mocks
    ({ serverInstanceService } = require('../server-instance/server-instance.service'));
    ({ serverProcessService } = require('../server-instance/server-process.service'));
    ({ getInstance, saveInstance } = require('../../utils/ark/instance.utils'));
    ({ sendRconCommand, isRconConnected } = require('../../utils/rcon.utils'));
    // Instantiate service after all mocks
    const { ScheduledRestartService } = require('./scheduled-restart.service');
    service = new ScheduledRestartService(automations);
  });

  it('should schedule and unschedule restart', () => {
    automations.set('id', makeAutomation());
    service.scheduleRestart('id');
    expect(automations.get('id')!.status.isScheduled).toBe(true);
    service.unscheduleRestart('id');
    expect(automations.get('id')!.status.isScheduled).toBe(false);
  });

  it('should not schedule if automation missing', () => {
    service.scheduleRestart('missing');
    expect(automations.size).toBe(0);
  });

  it('should not unschedule if automation missing', () => {
    expect(() => service.unscheduleRestart('missing')).not.toThrow();
  });

  it('should calculate next restart (daily)', () => {
    const now = new Date();
    const settings = makeAutomation().settings;
    const next = service['calculateNextRestart'](settings);
    expect(next instanceof Date).toBe(true);
  });

  it('should calculate next restart (weekly)', () => {
    const settings = makeAutomation({ restartFrequency: 'weekly', restartDays: [1] }).settings;
    const next = service['calculateNextRestart'](settings);
    expect(next instanceof Date).toBe(true);
  });

  it('should execute scheduled restart with RCON', async () => {
      jest.useFakeTimers();
  const automation = makeAutomation({}, new Date(Date.now() + 10000));
  automation.scheduledRestartTimer = {} as any;
  automations.set('id', automation);
    isRconConnected.mockReturnValue(true);
    sendRconCommand.mockResolvedValue('ok');
    serverProcessService.getInstanceState.mockReturnValue('running');
    serverProcessService.getServerProcess.mockReturnValue({ kill: jest.fn() });
    getInstance.mockReturnValue({});
  service.scheduleRestart = jest.fn(); // Prevent recursion
  // Ensure all dependencies are mocked to trigger restart logic
  serverProcessService.getInstanceState.mockReturnValue('running');
  serverProcessService.getServerProcess.mockReturnValue({ kill: jest.fn() });
  isRconConnected.mockReturnValue(true);
  getInstance.mockReturnValue({});
  await service['executeScheduledRestart']('id');
  // Step 1: advance warning timer
  jest.advanceTimersByTime(15 * 60 * 1000);
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  // Step 2: advance save/kill timer
  jest.advanceTimersByTime(2000);
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  // Step 3: advance restart timer
  jest.advanceTimersByTime(5000);
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  expect(sendRconCommand).toHaveBeenCalled();
  expect(serverInstanceService.startServerInstance).toHaveBeenCalled();
  expect(saveInstance).toHaveBeenCalled();
  });

  it('should execute scheduled restart without RCON', async () => {
      jest.useFakeTimers();
  const automation = makeAutomation({}, new Date(Date.now() + 10000));
  automation.scheduledRestartTimer = {} as any;
  automations.set('id', automation);
    isRconConnected.mockReturnValue(false);
    serverProcessService.getInstanceState.mockReturnValue('running');
    serverProcessService.getServerProcess.mockReturnValue({ kill: jest.fn() });
    getInstance.mockReturnValue({});
  service.scheduleRestart = jest.fn(); // Prevent recursion
  serverProcessService.getInstanceState.mockReturnValue('running');
  serverProcessService.getServerProcess.mockReturnValue({ kill: jest.fn() });
  isRconConnected.mockReturnValue(false);
  getInstance.mockReturnValue({});
  await service['executeScheduledRestart']('id');
  // Step 1: advance kill timer
  jest.advanceTimersByTime(2000);
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  // Step 2: advance restart timer
  jest.advanceTimersByTime(5000);
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  expect(serverInstanceService.startServerInstance).toHaveBeenCalled();
  expect(saveInstance).toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    automations.set('id', makeAutomation());
    isRconConnected.mockImplementation(() => { throw new Error('fail'); });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await service['executeScheduledRestart']('id');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
