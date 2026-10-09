import { messagingService } from '../services/messaging.service';
import { asPayload, errorMessage, onRequest, RequestContext, RequestOptions, RequestPayload } from './handler.utils';
import { runForwardedRequest, setHostRouter } from '../services/host-routing';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
  },
}));

const mockMessaging = messagingService as unknown as { on: jest.Mock; sendToOriginator: jest.Mock };
const sender = { send: jest.fn() };

type Handler = (payload: RequestPayload, context: RequestContext) => unknown;

function register(handler: Handler, options?: RequestOptions) {
  onRequest('test-channel', handler, options);
  const [channel, listener] = mockMessaging.on.mock.calls[0];
  expect(channel).toBe('test-channel');
  return listener as (payload: unknown, sender: unknown) => Promise<void>;
}

describe('errorMessage', () => {
  it('uses an Error message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('uses a thrown string', () => {
    expect(errorMessage('boom')).toBe('boom');
  });

  it('falls back for anything else', () => {
    expect(errorMessage({ code: 42 })).toBe('Unexpected error');
    expect(errorMessage(undefined, 'Failed to load')).toBe('Failed to load');
    expect(errorMessage(new Error(''), 'Failed to load')).toBe('Failed to load');
  });
});

describe('asPayload', () => {
  it('keeps an object payload', () => {
    const payload = { id: 'a1', requestId: 'r1' };

    expect(asPayload(payload)).toBe(payload);
  });

  it.each([undefined, null, 'id', 42, ['a1']])('reads %p as an empty payload', raw => {
    expect(asPayload(raw)).toEqual({});
  });
});

describe('onRequest', () => {
  beforeEach(() => {
    mockMessaging.sendToOriginator.mockReset();
  });

  it('replies with the handler result and the caller requestId', async () => {
    const listener = register(async payload => ({ success: true, echoed: payload.value }));

    await listener({ value: 3, requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'test-channel', { success: true, echoed: 3, requestId: 'r1' }, sender
    );
  });

  it('passes the sender and requestId in the context', async () => {
    const handler = jest.fn(() => ({ success: true }));
    const listener = register(handler);

    await listener({ requestId: 'r1' }, sender);

    expect(handler).toHaveBeenCalledWith({ requestId: 'r1' }, expect.objectContaining({ sender, requestId: 'r1' }));
  });

  it('replies { success: false, error, requestId } when the handler throws', async () => {
    const listener = register(() => { throw new Error('boom'); });

    await listener({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'test-channel', { success: false, error: 'boom', requestId: 'r1' }, sender
    );
    expect(console.error).toHaveBeenCalledWith('[test-channel]', expect.stringContaining('boom'));
  });

  it('replies with the fallback error for a rejection without a message', async () => {
    const listener = register(() => Promise.reject({}), { fallbackError: 'Failed to load' });

    await listener({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'test-channel', { success: false, error: 'Failed to load', requestId: 'r1' }, sender
    );
  });

  it('shapes the error reply with onError', async () => {
    const listener = register(
      () => { throw new Error('boom'); },
      { onError: (message, payload) => ({ instances: [], id: payload.id, reason: message }) }
    );

    await listener({ id: 'abc', requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'test-channel', { instances: [], id: 'abc', reason: 'boom', requestId: 'r1' }, sender
    );
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'payload'],
    ['an array', ['a', 'b']],
  ])('treats %s payload as {}', async (_label, payload) => {
    const handler = jest.fn(() => ({ success: true }));
    const listener = register(handler);

    await listener(payload, sender);

    expect(handler).toHaveBeenCalledWith({}, expect.objectContaining({ requestId: undefined }));
    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'test-channel', { success: true, requestId: undefined }, sender
    );
  });

  it('sends nothing when the handler returns undefined', async () => {
    const listener = register(() => undefined);

    await listener({ requestId: 'r1' }, sender);

    expect(mockMessaging.sendToOriginator).not.toHaveBeenCalled();
  });

  it('runs afterReply callbacks in order once the reply is sent', async () => {
    const order: string[] = [];
    mockMessaging.sendToOriginator.mockImplementation(() => order.push('reply'));
    const listener = register((_payload, context) => {
      context.afterReply(async () => { order.push('first'); });
      context.afterReply(() => { order.push('second'); });
      return { success: true };
    });

    await listener({ requestId: 'r1' }, sender);

    expect(order).toEqual(['reply', 'first', 'second']);
  });

  it('logs a failing afterReply callback and still runs the rest', async () => {
    const later = jest.fn();
    const listener = register((_payload, context) => {
      context.afterReply(() => { throw new Error('broadcast failed'); });
      context.afterReply(later);
      return { success: true };
    });

    await expect(listener({ requestId: 'r1' }, sender)).resolves.toBeUndefined();

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[test-channel]', expect.stringContaining('broadcast failed'));
  });

  it('logs a reply that cannot be sent and still runs afterReply callbacks', async () => {
    mockMessaging.sendToOriginator.mockImplementation(() => { throw new Error('Object has been destroyed'); });
    const later = jest.fn();
    const listener = register((_payload, context) => {
      context.afterReply(later);
      return { success: true };
    });

    await expect(listener({ requestId: 'r1' }, sender)).resolves.toBeUndefined();

    expect(later).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[test-channel]', expect.stringContaining('Object has been destroyed'));
  });

  it('logs an error reply that cannot be sent', async () => {
    mockMessaging.sendToOriginator.mockImplementation(() => { throw new Error('Object has been destroyed'); });
    const listener = register(() => { throw new Error('boom'); });

    await expect(listener({ requestId: 'r1' }, sender)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith('[test-channel]', expect.stringContaining('Object has been destroyed'));
  });

  it('falls back to the default error reply when onError throws', async () => {
    const listener = register(
      () => { throw new Error('boom'); },
      { onError: () => { throw new Error('bad shape'); } }
    );

    await expect(listener({ requestId: 'r1' }, sender)).resolves.toBeUndefined();

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
      'test-channel', { success: false, error: 'boom', requestId: 'r1' }, sender
    );
    expect(console.error).toHaveBeenCalledWith('[test-channel]', expect.stringContaining('bad shape'));
  });

  it('skips afterReply callbacks when the handler fails', async () => {
    const later = jest.fn();
    const listener = register((_payload, context) => {
      context.afterReply(later);
      throw new Error('boom');
    });

    await listener({ requestId: 'r1' }, sender);

    expect(later).not.toHaveBeenCalled();
  });
});

// A page about a server on another machine of the mesh: the request runs on that machine.
describe('onRequest for a server hosted elsewhere', () => {
  const listenerFor = (channel: string) =>
    mockMessaging.on.mock.calls.filter(([registered]) => registered === channel).at(-1)![1] as (payload: unknown, sender: unknown) => Promise<void>;
  let router: jest.Mock;

  beforeEach(() => {
    mockMessaging.sendToOriginator.mockReset();
    router = jest.fn(async () => null);
    setHostRouter(router);
  });

  afterEach(() => setHostRouter(null));

  it('answers with what the machine hosting the server answered, without running here', async () => {
    const handler = jest.fn(async () => ({ success: true, here: true }));
    onRequest('routed-read', handler, { host: { idKey: 'instanceId', read: true } });
    router.mockResolvedValueOnce({ success: true, there: true });

    await listenerFor('routed-read')({ instanceId: 'far', requestId: 'r1' }, sender);

    expect(router).toHaveBeenCalledWith('routed-read', 'far', { instanceId: 'far' }, true, sender);
    expect(handler).not.toHaveBeenCalled();
    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('routed-read', { success: true, there: true, requestId: 'r1' }, sender);
  });

  it('runs here for a server hosted here', async () => {
    const handler = jest.fn(async () => ({ success: true, here: true }));
    onRequest('routed-write', handler, { host: { idKey: 'serverId' } });

    await listenerFor('routed-write')({ serverId: 'isle', requestId: 'r2' }, sender);

    expect(router).toHaveBeenCalledWith('routed-write', 'isle', { serverId: 'isle' }, false, sender);
    expect(handler).toHaveBeenCalled();
    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('routed-write', { success: true, here: true, requestId: 'r2' }, sender);
  });

  it('says why when the machine hosting the server cannot be asked', async () => {
    onRequest('routed-down', async () => ({ success: true }), { host: { idKey: 'instanceId', read: true }, fallbackError: 'Could not read it' });
    router.mockRejectedValueOnce(new Error('The node hosting that server is not available.'));

    await listenerFor('routed-down')({ instanceId: 'far', requestId: 'r3' }, sender);

    expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('routed-down', {
      success: false, error: 'The node hosting that server is not available.', requestId: 'r3'
    }, sender);
  });

  it('runs a request another machine forwarded, for a channel that allows it', async () => {
    onRequest('forwardable', async payload => ({ success: true, got: payload.instanceId }), { host: { idKey: 'instanceId' } });

    await expect(runForwardedRequest('forwardable', { instanceId: 'isle' }, false)).resolves.toEqual({ success: true, got: 'isle' });
  });

  // Only what each handler opted into: never any channel another machine names.
  it('refuses a channel that did not opt in, and a change sent as a read', async () => {
    onRequest('plain', async () => ({ success: true }));
    onRequest('change-only', async () => ({ success: true }), { host: { idKey: 'instanceId' } });

    await expect(runForwardedRequest('plain', {}, false)).rejects.toThrow('plain cannot be run for another machine.');
    await expect(runForwardedRequest('change-only', { instanceId: 'isle' }, true)).rejects.toThrow('change-only cannot be run for another machine.');
  });
});
