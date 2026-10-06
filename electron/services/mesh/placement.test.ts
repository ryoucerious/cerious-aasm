import { moveServer, type MoveHooks } from './placement';

/** Records each step; `fail` makes the named step throw. */
function hooks(options: { running?: boolean; received?: string; fail?: keyof MoveHooks } = {}) {
  const steps: string[] = [];
  const step = <T>(name: keyof MoveHooks, value: T) => async (...args: unknown[]): Promise<T> => {
    steps.push(args.length ? `${name}:${args.join(',')}` : name);
    if (options.fail === name) throw new Error(`${name} failed`);
    return value;
  };
  const moveHooks: MoveHooks = {
    isRunning: () => options.running ?? true,
    saveWorld: step('saveWorld', undefined),
    stop: step('stop', undefined),
    checkpoint: step('checkpoint', { checksum: 'abc' }),
    transfer: step('transfer', options.received ?? 'abc'),
    commitPlacement: step('commitPlacement', undefined),
    release: step('release', undefined),
    restart: step('restart', undefined)
  };
  return { steps, moveHooks };
}

describe('moveServer', () => {
  it('saves and stops the server, sends it, commits the placement, then releases the copy here', async () => {
    const { steps, moveHooks } = hooks();

    const result = await moveServer('s1', 'A', 'B', moveHooks);

    expect(result).toEqual({ success: true });
    expect(steps).toEqual(['saveWorld:s1', 'stop:s1', 'checkpoint:s1', 'transfer:s1,abc', 'commitPlacement:s1,B,true', 'release:s1']);
  });

  it('moves a stopped server without saving, stopping or starting it', async () => {
    const { steps, moveHooks } = hooks({ running: false });

    await moveServer('s1', 'A', 'B', moveHooks);

    expect(steps).toEqual(['checkpoint:s1', 'transfer:s1,abc', 'commitPlacement:s1,B,false', 'release:s1']);
  });

  it('keeps the placement and restarts the server here when the destination checksum differs', async () => {
    const { steps, moveHooks } = hooks({ received: 'other' });

    const result = await moveServer('s1', 'A', 'B', moveHooks);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/checksum/);
    expect(steps).not.toContain('commitPlacement:s1,B,true');
    expect(steps[steps.length - 1]).toBe('restart:s1');
  });

  it('does not restart a server that was stopped before a failed move', async () => {
    const { steps, moveHooks } = hooks({ running: false, fail: 'transfer' });

    await moveServer('s1', 'A', 'B', moveHooks);

    expect(steps).not.toContain('restart:s1');
  });

  it('restarts the server here when the placement cannot be committed', async () => {
    const { steps, moveHooks } = hooks({ fail: 'commitPlacement' });

    const result = await moveServer('s1', 'A', 'B', moveHooks);

    expect(result.success).toBe(false);
    expect(steps[steps.length - 1]).toBe('restart:s1');
  });

  it('reports success once committed even if the copy here cannot be released', async () => {
    const { steps, moveHooks } = hooks({ fail: 'release' });

    const result = await moveServer('s1', 'A', 'B', moveHooks);

    expect(result.success).toBe(true);
    expect(result.warning).toMatch(/release failed/);
    expect(steps).not.toContain('restart:s1');
  });

  it('refuses a move to the node the server is already on', async () => {
    const { steps, moveHooks } = hooks();

    const result = await moveServer('s1', 'A', 'A', moveHooks);

    expect(result.success).toBe(false);
    expect(steps).toEqual([]);
  });
});
