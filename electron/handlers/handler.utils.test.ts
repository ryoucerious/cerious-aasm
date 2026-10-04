import { messagingService } from '../services/messaging.service';
import { asPayload, errorMessage, onRequest, RequestContext, RequestOptions, RequestPayload } from './handler.utils';

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
