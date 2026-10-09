// A restart asked for from the app, from the request to the server starting again: the real handler,
// countdown and runtime, with only RCON and the server processes faked. The players hear each mark,
// the pages see the restart coming and then gone, and a cancel stops it wherever it has got to.
import { messagingService } from '../services/messaging.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { getStandardEventCallbacks } from '../services/server-instance/instance-events';
import { serverLifecycleService } from '../services/server-instance/server-lifecycle.service';
import { serverProcessService } from '../services/server-instance/server-process.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import { rconService } from '../services/rcon.service';
import { identifySender } from '../services/auth/permission-gate';
import { meshService } from '../services/mesh/mesh-service';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn(), sendToAll: jest.fn(), sendToAllOthers: jest.fn() }
}));
jest.mock('../services/server-instance/server-instance.service', () => ({
  serverInstanceService: { startServerInstance: jest.fn(), broadcastInstances: jest.fn() }
}));
jest.mock('../services/server-instance/instance-events', () => ({ getStandardEventCallbacks: jest.fn() }));
jest.mock('../services/server-instance/server-lifecycle.service', () => ({
  serverLifecycleService: { stopServerInstance: jest.fn(), startAllInstances: jest.fn(), stopAllInstances: jest.fn() }
}));
jest.mock('../services/server-instance/server-process.service', () => ({
  serverProcessService: { getInstanceState: jest.fn(), getNormalizedInstanceState: jest.fn(), setInstanceState: jest.fn() }
}));
jest.mock('../services/server-instance/server-monitoring.service', () => ({ serverMonitoringService: {} }));
jest.mock('../services/server-instance/server-operations.service', () => ({ serverOperationsService: {} }));
jest.mock('../services/server-instance/server-management.service', () => ({ serverManagementService: { getAllInstances: jest.fn() } }));
jest.mock('../services/automation/automation.service', () => ({ automationService: { setManuallyStopped: jest.fn() } }));
jest.mock('../utils/ark/started-config.utils', () => ({ readStartedConfig: jest.fn() }));
jest.mock('../services/backup/backup-copies.service', () => ({ backupCopies: { heldPath: jest.fn(() => null) } }));
jest.mock('../services/ark-config.service', () => ({ arkConfigService: {} }));
jest.mock('../services/rcon.service', () => ({ rconService: { executeRconCommand: jest.fn() } }));
jest.mock('../services/activity-log.service', () => ({ activityLogService: { record: jest.fn() } }));
jest.mock('../services/auth/permission-gate', () => ({
  identifySender: jest.fn(),
  isDesktopWindow: jest.requireActual('../services/auth/permission-gate').isDesktopWindow
}));
jest.mock('../utils/ark/instance.utils', () => ({ getInstance: jest.fn(), saveInstance: jest.fn() }));
jest.mock('../services/auth/user-database.service', () => ({ userDatabaseService: { getUser: jest.fn() } }));
jest.mock('../utils/ark/ark-server/ark-server-state.utils', () => ({ getNormalizedInstanceState: jest.fn() }));
// A standalone install: every server is here.
jest.mock('../services/mesh/mesh-service', () => ({
  meshService: {
    forwardIfRemote: jest.fn(async () => null),
    noteDesired: jest.fn(async () => undefined),
    withMeshServers: jest.fn(async (instances: unknown[]) => instances),
    hostsOf: jest.fn(async (ids: string[]) => ({ local: ids, remote: new Map() })),
    commandHosts: jest.fn(async () => [])
  }
}));

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

const MINUTE = 60_000;
const sender = { send: jest.fn() };
/** The servers' states; a server not named here is stopped. */
const states = new Map<string, string>();
/** What happened, in order: what the players heard, and the stops and starts. */
let events: string[] = [];

describe('restarting from the app', () => {
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./server-instance-handler');
    handlers = Object.fromEntries(jest.mocked(messagingService.on).mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-08T12:00:00Z') });
    jest.clearAllMocks();
    events = [];
    states.clear();
    jest.mocked(identifySender).mockReturnValue({ user: null, permissions: [], isAdmin: true, isLocalDesktop: true });
    jest.mocked(getStandardEventCallbacks).mockReturnValue({ onLog: jest.fn(), onState: jest.fn() });
    jest.mocked(serverProcessService.getInstanceState).mockImplementation(id => states.get(id) || 'stopped');
    jest.mocked(serverProcessService.getNormalizedInstanceState).mockImplementation(id => states.get(id) || 'stopped');
    jest.mocked(rconService.executeRconCommand).mockImplementation(async (id: string, command: string) => {
      events.push(`${id}: ${command.replace(/^broadcast /, '')}`);
      return { success: true, response: '', instanceId: id };
    });
    jest.mocked(serverLifecycleService.stopServerInstance).mockImplementation(async (id: string) => {
      events.push(`stop ${id}`);
      states.set(id, 'stopped');
      return { success: true, instanceId: id };
    });
    jest.mocked(serverInstanceService.startServerInstance).mockImplementation(async (id: string) => {
      events.push(`start ${id}`);
      states.set(id, 'running');
      return { started: true, instanceId: id, instanceName: id };
    });
    jest.mocked(serverLifecycleService.stopAllInstances).mockImplementation(async (ids?: string[]) => {
      events.push(`stop all ${ids?.join(',')}`);
      return { stopped: ids || [], failed: [] };
    });
    jest.mocked(serverLifecycleService.startAllInstances).mockImplementation(async (_order?: unknown, ids?: string[]) => {
      events.push(`start all ${ids?.join(',')}`);
      return { started: ids || [], failed: [] };
    });
  });

  afterEach(() => jest.useRealTimers());

  async function request(channel: string, payload: Record<string, unknown>): Promise<void> {
    await handlers[channel](payload, sender);
    await jest.advanceTimersByTimeAsync(0);
  }

  function replies(channel: string): unknown[] {
    return jest.mocked(messagingService.sendToOriginator).mock.calls.filter(([name]) => name === channel).map(call => call[1]);
  }

  function pendingChanges(): unknown[] {
    return jest.mocked(messagingService.sendToAll).mock.calls.filter(([name]) => name === 'server-restart-pending').map(call => call[1]);
  }

  it('warns the players at each mark, then stops and starts the server', async () => {
    states.set('a', 'running');
    const dueAt = Date.now() + 5 * MINUTE;

    await request('restart-server-instance', { id: 'a', warningMinutes: 5, requestId: 'r1' });

    expect(replies('restart-server-instance')).toEqual([{ success: true, instanceId: 'a', dueAt, requestId: 'r1' }]);
    expect(pendingChanges()).toEqual([{ instanceId: 'a', dueAt, all: false }]);
    expect(events).toEqual(['a: Server will restart in 5 minutes!']);

    await jest.advanceTimersByTimeAsync(4 * MINUTE);
    expect(events).toEqual([
      'a: Server will restart in 5 minutes!', 'a: Server will restart in 4 minutes!', 'a: Server will restart in 3 minutes!',
      'a: Server will restart in 2 minutes!', 'a: Server will restart in 1 minute!'
    ]);
    expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(events.slice(5)).toEqual(['a: Server restarting now!', 'stop a', 'start a']);
    expect(pendingChanges()).toEqual([{ instanceId: 'a', dueAt, all: false }, { instanceId: 'a', dueAt: null, all: false }]);
    expect(meshService.noteDesired).toHaveBeenCalledWith('a', 'running');
  });

  it('stops counting down when cancelled, and tells the players', async () => {
    states.set('a', 'running');
    await request('restart-server-instance', { id: 'a', warningMinutes: 15, requestId: 'r1' });
    await jest.advanceTimersByTimeAsync(5 * MINUTE);

    await request('cancel-server-restart', { id: 'a', requestId: 'r2' });
    await jest.advanceTimersByTimeAsync(20 * MINUTE);

    expect(replies('cancel-server-restart')).toEqual([{ success: true, instanceId: 'a', requestId: 'r2' }]);
    expect(events).toEqual(['a: Server will restart in 15 minutes!', 'a: Server will restart in 10 minutes!', 'a: The restart was cancelled.']);
    expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();
    expect(pendingChanges().at(-1)).toEqual({ instanceId: 'a', dueAt: null, all: false });
  });

  it('skips a server that stopped during the countdown', async () => {
    states.set('a', 'running');
    await request('restart-server-instance', { id: 'a', warningMinutes: 1, requestId: 'r1' });
    states.set('a', 'stopped');

    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(events).toEqual(['a: Server will restart in 1 minute!']);
    expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
  });

  describe('restart all', () => {
    beforeEach(() => {
      jest.mocked(serverManagementService.getAllInstances).mockResolvedValue({
        instances: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
      } as never);
      states.set('a', 'running');
      states.set('b', 'running');
    });

    it('counts down on the running servers only, then stops them all and starts them in order', async () => {
      await request('restart-all-instances', { warningMinutes: 5, requestId: 'r1' });

      expect(replies('restart-all-instances')).toEqual([{ success: true, restarting: ['a', 'b'], dueAt: Date.now() + 5 * MINUTE, requestId: 'r1' }]);
      await jest.advanceTimersByTimeAsync(5 * MINUTE);

      expect(events.filter(event => event.startsWith('c'))).toEqual([]);
      expect(events.filter(event => event.startsWith('a: '))).toHaveLength(6);
      expect(events.slice(-2)).toEqual(['stop all a,b', 'start all a,b']);
      expect(meshService.noteDesired).toHaveBeenCalledWith('b', 'running');
    });

    it('takes over a server\'s own countdown, and a cancel leaves another server\'s own restart', async () => {
      states.set('c', 'running');
      await request('restart-server-instance', { id: 'c', warningMinutes: 15, requestId: 'r0' });
      jest.mocked(serverManagementService.getAllInstances).mockResolvedValue({ instances: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } as never);

      await request('restart-all-instances', { warningMinutes: 5, requestId: 'r1' });
      await request('cancel-restart-all', { requestId: 'r2' });
      await jest.advanceTimersByTimeAsync(15 * MINUTE);

      expect(replies('cancel-restart-all')).toEqual([{ success: true, cancelled: ['a', 'b'], requestId: 'r2' }]);
      expect(serverLifecycleService.stopAllInstances).not.toHaveBeenCalled();
      expect(events.slice(-3)).toEqual(['c: Server restarting now!', 'stop c', 'start c']);
    });
  });
});
