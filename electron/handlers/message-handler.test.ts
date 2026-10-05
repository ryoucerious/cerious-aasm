import { ipcMain } from 'electron';
import { messagingService } from '../services/messaging.service';

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock('../services/messaging.service', () => ({
  messagingService: { emit: jest.fn() },
}));

type MessageListener = (event: { sender: unknown }, request?: unknown) => unknown;

const mockEmit = jest.mocked(messagingService.emit);

describe('message-handler', () => {
  const event = { sender: { id: 7 } };
  let handleMessage: MessageListener;

  beforeAll(() => {
    require('./message-handler');
    const [channel, listener] = jest.mocked(ipcMain.handle).mock.calls[0];
    expect(channel).toBe('message');
    handleMessage = listener as unknown as MessageListener;
  });

  it('puts the message on the bus with its sender and acknowledges only the channel', async () => {
    // Payloads carry base64 backup uploads and passwords; the acknowledgement must not echo them.
    const payload = { requestId: 'r1', fileData: 'UEsDBBQ=', password: 'secret' };

    const reply = await handleMessage(event, { channel: 'import-server-from-backup', payload });

    expect(mockEmit).toHaveBeenCalledWith('import-server-from-backup', payload, event.sender);
    expect(reply).toEqual({ status: 'received', channel: 'import-server-from-backup' });
  });

  it('refuses a malformed channel without emitting', async () => {
    const reply = await handleMessage(event, { channel: 'get users', payload: {} });

    expect(reply).toEqual({ status: 'error', error: 'Invalid channel format' });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'get-users'])('answers a %p request with an error instead of throwing', async request => {
    const reply = await handleMessage(event, request);

    expect(reply).toEqual({ status: 'error', error: 'Invalid channel' });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('reports a listener that throws instead of rejecting the call', async () => {
    mockEmit.mockImplementationOnce(() => { throw new Error('listener failed'); });

    const reply = await handleMessage(event, { channel: 'get-users' });

    expect(reply).toEqual({ status: 'error', error: 'listener failed' });
    expect(console.error).toHaveBeenCalledWith('[message-handler] Unexpected error:', expect.any(Error));
  });
});
