import { reconcile, type DesiredServer, type ReconcileMemory, type RuntimePort } from './reconciler';

class FakeRuntime implements RuntimePort {
  readonly starts: string[] = [];
  readonly stops: string[] = [];
  readonly states = new Map<string, string>();
  readonly failStart = new Set<string>();

  state(id: string): string {
    return this.states.get(id) || 'stopped';
  }

  async start(id: string): Promise<void> {
    this.starts.push(id);
    if (this.failStart.has(id)) throw new Error('port in use');
    this.states.set(id, 'running');
  }

  async stop(id: string): Promise<void> {
    this.stops.push(id);
    this.states.set(id, 'stopped');
  }

  appliedRevision(): number {
    return 1;
  }

  async applyConfig(): Promise<void> {
    /* config is current in these tests */
  }
}

function row(serverId: string, desiredState: 'running' | 'stopped', nodeId = 'C'): DesiredServer {
  return { serverId, nodeId, desiredState, configRevision: 1 };
}

describe('reconcile', () => {
  it('starts a server that should be running the first time it sees it', async () => {
    const runtime = new FakeRuntime();
    await reconcile('C', [row('s1', 'running')], runtime, new Map());
    expect(runtime.starts).toEqual(['s1']);
  });

  it('never stops a running server the first time it sees it', async () => {
    const runtime = new FakeRuntime();
    runtime.states.set('s1', 'running');
    await reconcile('C', [row('s1', 'stopped')], runtime, new Map());
    expect(runtime.stops).toEqual([]);
  });

  it('leaves alone a start or stop made outside it while desired state is unchanged', async () => {
    const runtime = new FakeRuntime();
    const memory: ReconcileMemory = new Map();
    await reconcile('C', [row('up', 'running'), row('down', 'stopped')], runtime, memory);
    runtime.states.set('up', 'stopped');   // a scheduled restart, an update, a local stop
    runtime.states.set('down', 'running'); // a start that has not been recorded yet

    await reconcile('C', [row('up', 'running'), row('down', 'stopped')], runtime, memory);

    expect(runtime.starts).toEqual(['up']);
    expect(runtime.stops).toEqual([]);
  });

  it('stops a server when its desired state turns to stopped', async () => {
    const runtime = new FakeRuntime();
    const memory: ReconcileMemory = new Map();
    await reconcile('C', [row('s1', 'running')], runtime, memory);

    await reconcile('C', [row('s1', 'stopped')], runtime, memory);

    expect(runtime.stops).toEqual(['s1']);
  });

  it('starts once when desired state turns to running, even if that start fails', async () => {
    const runtime = new FakeRuntime();
    const memory: ReconcileMemory = new Map();
    await reconcile('C', [row('s1', 'stopped')], runtime, memory);
    runtime.failStart.add('s1');

    await reconcile('C', [row('s1', 'running')], runtime, memory);
    await reconcile('C', [row('s1', 'running')], runtime, memory);

    expect(runtime.starts).toEqual(['s1']);
  });

  it('keeps reconciling the other servers when one start throws', async () => {
    const runtime = new FakeRuntime();
    runtime.failStart.add('s1');
    await reconcile('C', [row('s1', 'running'), row('s2', 'running')], runtime, new Map());
    expect(runtime.starts).toEqual(['s1', 's2']);
    expect(runtime.state('s2')).toBe('running');
  });

  it('treats a server placed back on this node as new', async () => {
    const runtime = new FakeRuntime();
    const memory: ReconcileMemory = new Map();
    await reconcile('C', [row('s1', 'running')], runtime, memory);
    await reconcile('C', [row('s1', 'running', 'B')], runtime, memory); // moved away
    runtime.states.set('s1', 'stopped');

    await reconcile('C', [row('s1', 'running')], runtime, memory);      // moved back

    expect(runtime.starts).toEqual(['s1', 's1']);
  });

  it('ignores servers placed on other nodes', async () => {
    const runtime = new FakeRuntime();
    await reconcile('C', [row('s1', 'running', 'B')], runtime, new Map());
    expect(runtime.starts).toEqual([]);
  });
});
