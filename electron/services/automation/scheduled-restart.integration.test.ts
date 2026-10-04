// The scheduled restart against the real process service: the crash rule lives there (an exit while
// starting or running is a crash), and a restart that ends the server any other way than the
// graceful stop is reported, and restarted, as one.
import { EventEmitter } from 'events';
import { ScheduledRestartService } from './scheduled-restart.service';
import { ServerAutomation } from '../../types/automation.types';

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  kill = jest.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    this.exit(null, signal);
    return true;
  });

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

let mockChild: FakeChild;

jest.mock('child_process', () => ({
  spawn: jest.fn(() => mockChild),
  execFile: jest.fn((_file: string, _args: string[], _options: object, callback: (error: Error | null) => void) => callback(null))
}));
jest.mock('fs', () => ({ mkdirSync: jest.fn(), writeFileSync: jest.fn(), openSync: jest.fn(() => 3), closeSync: jest.fn() }));
jest.mock('../../utils/ark/instance.utils', () => ({
  getInstanceDir: jest.fn((id: string) => `/instances/${id}`),
  getInstance: jest.fn((id: string) => ({ id, name: 'Alpha', rconPort: 27020, rconPassword: 'pw' }))
}));
jest.mock('../../utils/ark/ark-args.utils', () => ({ buildArkServerArgs: jest.fn(() => []) }));
jest.mock('../../utils/ark/ark-server/ark-server-paths.utils', () => ({
  ARK_APP_ID: '2430930',
  resolveServerLaunch: jest.fn(() => ({ executable: 'ArkAscendedServer.exe', cwd: '/instances/a1', usesAsaApiLoader: false })),
  prepareArkServerCommand: jest.fn((executable: string, args: string[]) => ({ command: executable, args })),
  getInstanceAltSaveDirName: jest.fn(() => 'SavedArks'),
  getInstanceLogsDir: jest.fn(() => '/instances/a1/Logs')
}));
jest.mock('../../utils/ark/ark-server/ark-server-logging.utils', () => ({
  snapshotLogFiles: jest.fn(() => new Map()),
  detectAndRegisterLogFile: jest.fn(),
  setupLogTailing: jest.fn(),
  unregisterLogFile: jest.fn(),
  readLogTail: jest.fn(() => [])
}));
jest.mock('../../utils/ark/ark-server/ark-server-cleanup.utils', () => ({
  killInstanceProcesses: jest.fn(),
  cleanupOrphanedArkProcesses: jest.fn(),
  holdStartsUntil: jest.fn(),
  rememberInstanceProcessMarker: jest.fn()
}));
jest.mock('../../utils/platform.utils', () => ({ getPlatform: jest.fn(() => 'windows') }));
jest.mock('../discord.service', () => ({ discordService: { sendNotification: jest.fn() } }));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));
// The server answers DoExit by exiting.
jest.mock('../rcon.service', () => ({
  rconService: {
    executeRconCommand: jest.fn(async (instanceId: string, command: string) => {
      if (command === 'DoExit') setTimeout(() => mockChild.exit(0), 1000);
      return { success: true, response: '', instanceId };
    }),
    getRconStatus: jest.fn((instanceId: string) => ({ success: true, connected: true, instanceId })),
    connectRcon: jest.fn(async (instanceId: string) => ({ success: true, connected: true, instanceId })),
    disconnectRcon: jest.fn(async (instanceId: string) => ({ success: true, connected: false, instanceId })),
    forceDisconnectRcon: jest.fn(async () => undefined),
    reconnectRcon: jest.fn(async () => true)
  }
}));
jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: { startServerInstance: jest.fn(async (instanceId: string) => ({ started: true, instanceId })) }
}));
jest.mock('../server-instance/instance-events', () => ({
  getStandardEventCallbacks: jest.fn(() => ({ onLog: jest.fn(), onState: jest.fn() }))
}));
// Lifecycle's stop is a pass-through to the process service; its own imports are not needed here.
jest.mock('../server-instance/server-lifecycle.service', () => ({
  serverLifecycleService: {
    stopServerInstance: (instanceId: string) =>
      require('../server-instance/server-process.service').serverProcessService.stopServerProcess(instanceId)
  }
}));

import { serverProcessService } from '../server-instance/server-process.service';
import { setInstanceState } from '../../utils/ark/ark-server/ark-server-state.utils';
import { setupLogTailing } from '../../utils/ark/ark-server/ark-server-logging.utils';
import { discordService } from '../discord.service';
import { serverInstanceService } from '../server-instance/server-instance.service';

describe('a scheduled restart of a running server', () => {
  const onState = jest.fn();

  beforeEach(async () => {
    // Monday 29 September 2025, 03:00 host local time.
    jest.useFakeTimers({ now: new Date(2025, 8, 29, 3, 0, 0) });
    mockChild = new FakeChild();
    setInstanceState('a1', 'stopped');

    await serverProcessService.startServerProcess('a1', { id: 'a1', name: 'Alpha' });
    serverProcessService.setupProcessMonitoring('a1', jest.fn(), onState);
    const reportState = jest.mocked(setupLogTailing).mock.calls[0][2]!;
    setInstanceState('a1', 'running');
    reportState('running');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is reported as a stop, not a crash', async () => {
    const automations = new Map<string, ServerAutomation>([['a1', {
      serverId: 'a1',
      settings: {
        autoStartOnAppLaunch: false, autoStartOnBoot: false, crashDetectionEnabled: true, crashDetectionInterval: 60,
        maxRestartAttempts: 3, scheduledRestartEnabled: true, restartFrequency: 'daily', restartTime: '04:00',
        restartDays: [1], restartWarningMinutes: 0
      },
      restartAttempts: 0,
      manuallyStopped: false,
      status: { isMonitoring: false, isScheduled: false }
    }]]);
    const service = new ScheduledRestartService(automations);

    service.scheduleRestart('a1');
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000 + 30 * 1000);
    service.unscheduleRestart('a1');

    expect(mockChild.exitCode).toBe(0);
    expect(onState).toHaveBeenCalledWith('stopped');
    expect(onState).not.toHaveBeenCalledWith('crashed');
    expect(discordService.sendNotification).toHaveBeenCalledWith('a1', 'stop', 'Server has stopped');
    expect(discordService.sendNotification).not.toHaveBeenCalledWith('a1', 'crash', expect.anything());
    expect(serverInstanceService.startServerInstance).toHaveBeenCalledWith('a1', expect.any(Function), expect.any(Function));
  });
});
