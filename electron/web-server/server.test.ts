import { startWebServer } from './server';
import { initializeAuth } from './auth-config';
import { createApp, getServerPort, startServer } from './server-setup';

jest.mock('./auth-config', () => ({ initializeAuth: jest.fn() }));
jest.mock('./server-setup', () => ({ createApp: jest.fn(), getServerPort: jest.fn(), startServer: jest.fn() }));

describe('startWebServer', () => {
  let exit: jest.SpyInstance;
  let on: jest.SpyInstance;

  beforeEach(() => {
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    on = jest.spyOn(process, 'on').mockImplementation(() => process);
    jest.mocked(initializeAuth).mockResolvedValue(undefined);
    jest.mocked(createApp).mockReturnValue('app' as never);
    jest.mocked(getServerPort).mockReturnValue(3000);
  });

  it('loads the login, then starts listening', async () => {
    await startWebServer();

    expect(jest.mocked(initializeAuth).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(startServer).mock.invocationCallOrder[0]);
    expect(startServer).toHaveBeenCalledWith('app', 3000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits when main goes away, so the port is not held by an orphan', async () => {
    await startWebServer();

    const [, onDisconnect] = on.mock.calls.find(([event]) => event === 'disconnect')!;
    onDisconnect();

    expect(exit).toHaveBeenCalledWith(0);
  });

  it.each([
    ['loading the login', () => jest.mocked(initializeAuth).mockRejectedValue(new Error('boom'))],
    ['starting the server', () => jest.mocked(startServer).mockImplementation(() => { throw new Error('boom'); })]
  ])('exits with an error when %s fails', async (_step, fail) => {
    fail();

    await startWebServer();

    expect(console.error).toHaveBeenCalledWith('[web-server] Failed to start:', expect.any(Error));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
