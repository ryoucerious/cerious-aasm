import { CrashDetectionService } from './crash-detection.service';
import { ServerAutomation } from '../../types/automation.types';
import { whileServerFilesUpdate } from '../../utils/ark/ark-server/ark-server-state.utils';

jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: { startServerInstance: jest.fn() }
}));
jest.mock('../server-instance/instance-events', () => ({
  getStandardEventCallbacks: jest.fn(() => ({ onLog: jest.fn(), onState: jest.fn() }))
}));
jest.mock('../server-instance/server-process.service', () => ({
  serverProcessService: { getInstanceState: jest.fn(), hasActiveProcess: jest.fn() }
}));
jest.mock('../discord.service', () => ({ discordService: { sendNotification: jest.fn() } }));
jest.mock('../../utils/ark/instance.utils', () => ({ getInstance: jest.fn(), saveInstance: jest.fn() }));

const { serverInstanceService } = jest.requireMock('../server-instance/server-instance.service');
const { getStandardEventCallbacks } = jest.requireMock('../server-instance/instance-events');
const { serverProcessService } = jest.requireMock('../server-instance/server-process.service');
const { discordService } = jest.requireMock('../discord.service');
const { getInstance, saveInstance } = jest.requireMock('../../utils/ark/instance.utils');

function makeAutomation(overrides: Partial<ServerAutomation['settings']> = {}): ServerAutomation {
  return {
    serverId: 'id',
    settings: {
      autoStartOnAppLaunch: false,
      autoStartOnBoot: false,
      crashDetectionEnabled: true,
      crashDetectionInterval: 60,
      maxRestartAttempts: 2,
      scheduledRestartEnabled: false,
      restartFrequency: 'daily',
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
    jest.useFakeTimers();
    automations = new Map();
    service = new CrashDetectionService(automations);
    serverInstanceService.startServerInstance.mockResolvedValue({ started: true, instanceId: 'id' });
  });

  afterEach(() => {
    service.stopCrashDetection('id');
    jest.useRealTimers();
  });

  function crashed(): void {
    serverProcessService.getInstanceState.mockReturnValue('crashed');
    serverProcessService.hasActiveProcess.mockReturnValue(false);
  }

  it('starts and stops monitoring', () => {
    automations.set('id', makeAutomation());

    service.startCrashDetection('id');
    expect(automations.get('id')!.status.isMonitoring).toBe(true);
    service.stopCrashDetection('id');
    expect(automations.get('id')!.status.isMonitoring).toBe(false);
  });

  it('waits out a server files update without spending a restart attempt', async () => {
    // The start would be refused anyway; counting it would use up the attempts during a long update.
    automations.set('id', makeAutomation({ crashDetectionInterval: 30, maxRestartAttempts: 1 }));
    crashed();
    service.startCrashDetection('id');

    let finishUpdate: () => void = () => undefined;
    const update = whileServerFilesUpdate(() => new Promise<void>(resolve => { finishUpdate = resolve; }));
    await jest.advanceTimersByTimeAsync(5 * 30000);
    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    expect(automations.get('id')!.restartAttempts).toBe(0);

    finishUpdate();
    await update;
    await jest.advanceTimersByTimeAsync(30000);
    expect(serverInstanceService.startServerInstance).toHaveBeenCalledTimes(1);
  });

  it('ignores an instance without automation settings', () => {
    expect(() => service.startCrashDetection('missing')).not.toThrow();
    expect(() => service.stopCrashDetection('missing')).not.toThrow();
  });

  // The UI sends seconds (30-300); they used to go to setInterval as milliseconds.
  it('checks every crashDetectionInterval seconds', async () => {
    automations.set('id', makeAutomation({ crashDetectionInterval: 30 }));
    crashed();

    service.startCrashDetection('id');
    await jest.advanceTimersByTimeAsync(29999);
    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(serverInstanceService.startServerInstance).toHaveBeenCalledTimes(1);
  });

  it.each([
    [10, 30000],
    [1000, 300000]
  ])('keeps an interval of %p seconds within the 30-300 s the UI allows', async (crashDetectionInterval, expectedMs) => {
    automations.set('id', makeAutomation({ crashDetectionInterval }));
    crashed();

    service.startCrashDetection('id');
    await jest.advanceTimersByTimeAsync(expectedMs - 1);
    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(serverInstanceService.startServerInstance).toHaveBeenCalledTimes(1);
  });

  it.each([0, -5, NaN])('falls back to a minute for an interval of %p', async crashDetectionInterval => {
    automations.set('id', makeAutomation({ crashDetectionInterval }));
    crashed();

    service.startCrashDetection('id');
    await jest.advanceTimersByTimeAsync(59999);
    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(serverInstanceService.startServerInstance).toHaveBeenCalledTimes(1);
  });

  // The old check (running with no process) could never be true: the exit handler updated the
  // state and dropped the process in the same tick, and recorded a crash as 'stopped'.
  it('restarts a server that crashed, with the standard callbacks', async () => {
    automations.set('id', makeAutomation());
    crashed();

    await service['checkForCrash']('id');

    expect(getStandardEventCallbacks).toHaveBeenCalledWith('id');
    expect(serverInstanceService.startServerInstance).toHaveBeenCalledWith('id', expect.any(Function), expect.any(Function));
    expect(automations.get('id')!.restartAttempts).toBe(1);
    expect(discordService.sendNotification).toHaveBeenCalledWith('id', 'crash', 'Attempting an automatic restart after a crash (1/2).');
  });

  it.each(['stopped', 'stopping', 'starting', 'error'])('leaves a %s server alone', async state => {
    automations.set('id', makeAutomation());
    serverProcessService.getInstanceState.mockReturnValue(state);
    serverProcessService.hasActiveProcess.mockReturnValue(false);

    await service['checkForCrash']('id');

    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
  });

  it('does not restart a server that was stopped by hand', async () => {
    const automation = makeAutomation();
    automation.manuallyStopped = true;
    automations.set('id', automation);
    crashed();

    await service['checkForCrash']('id');

    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
  });

  it('gives up after the maximum attempts and leaves the server shown as crashed', async () => {
    const automation = makeAutomation();
    automation.restartAttempts = 2;
    automation.status.isMonitoring = true;
    automations.set('id', automation);
    crashed();

    await service['checkForCrash']('id');

    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    expect(automation.status.isMonitoring).toBe(false);
  });

  it('does not start a second restart while one is in progress', async () => {
    automations.set('id', makeAutomation());
    crashed();
    let finishStart: (value: unknown) => void = () => undefined;
    serverInstanceService.startServerInstance.mockReturnValue(new Promise(resolve => { finishStart = resolve; }));

    const first = service['checkForCrash']('id');
    await service['checkForCrash']('id');
    finishStart({ started: true, instanceId: 'id' });
    await first;

    expect(serverInstanceService.startServerInstance).toHaveBeenCalledTimes(1);
  });

  it('resets the attempt count once the server runs again', async () => {
    const automation = makeAutomation();
    automation.restartAttempts = 2;
    automations.set('id', automation);
    serverProcessService.getInstanceState.mockReturnValue('running');
    serverProcessService.hasActiveProcess.mockReturnValue(true);

    await service['checkForCrash']('id');

    expect(automation.restartAttempts).toBe(0);
  });

  // It used to read config.json and write it back unchanged, which could undo a save the user made
  // in between.
  it('never rewrites the instance config', async () => {
    getInstance.mockReturnValue({ id: 'id', name: 'Alpha' });
    const automation = makeAutomation();
    automation.restartAttempts = 1;
    automations.set('id', automation);

    crashed();
    await service['checkForCrash']('id');
    serverProcessService.getInstanceState.mockReturnValue('running');
    serverProcessService.hasActiveProcess.mockReturnValue(true);
    await service['checkForCrash']('id');

    expect(saveInstance).not.toHaveBeenCalled();
  });

  it('logs a failed check instead of throwing', async () => {
    automations.set('id', makeAutomation());
    serverProcessService.getInstanceState.mockImplementation(() => { throw new Error('fail'); });

    await expect(service['checkForCrash']('id')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
