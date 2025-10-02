import { MessagingService } from './messaging.service';

describe('MessagingService', () => {
  let service: MessagingService;

  beforeEach(() => {
    service = new MessagingService();
  });

  it('setApiProcess sets apiProcess', () => {
    const proc = { send: jest.fn() };
    service.setApiProcess(proc);
    expect((service as any).apiProcess).toBe(proc);
  });

  it('emit proxies to EventEmitter', () => {
    const spy = jest.fn();
    service.on('test', spy);
    service.emit('test', 123);
    expect(spy).toHaveBeenCalledWith(123);
  });

  it('addWebContents adds and removes webContents', () => {
    const wc = { on: jest.fn((event, cb) => { if (event === 'destroyed') cb(); }) };
    service.addWebContents(wc);
    expect(service.getWebContentsList().has(wc)).toBe(false);
  });

  // it('attachWebSocketServer sets wsServer and handles connection', () => {
  //   const httpServer = { setTimeout: jest.fn(), on: jest.fn(), listen: jest.fn() };
  //   const wsServerMock = {
  //     on: jest.fn((event, cb) => {
  //       if (event === 'connection') {
  //         const ws = {
  //           send: jest.fn(),
  //           on: jest.fn()
  //         };
  //         cb(ws);
  //         expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('welcome'));
  //       }
  //     }),
  //     clients: new Set()
  //   };
  //   (service as any).wsServer = wsServerMock;
  //   (service as any).WebSocketServer = jest.fn(() => wsServerMock);
  //   service.attachWebSocketServer(httpServer);
  //   expect(service.getWsServer()).toBe(wsServerMock);
  // });

  it('handleMessage emits and returns response', async () => {
    const spy = jest.fn();
    service.on('foo', spy);
    const resp = await service.handleMessage('foo', { bar: 1 }, 'sender');
    expect(spy).toHaveBeenCalledWith({ bar: 1 }, 'sender');
    expect(resp).toEqual({ status: 'received', channel: 'foo', payload: { bar: 1 } });
  });

  it('sendToOriginator uses sender.send if available', () => {
    const sender = { send: jest.fn() };
    service.sendToOriginator('chan', { foo: 1 }, sender);
    expect(sender.send).toHaveBeenCalledWith('chan', { foo: 1 });
  });
  // Removed duplicate and misplaced code

  it('sendToAllWebSockets sends to all open clients except excluded', () => {
    const client1 = { readyState: 1, _cid: 'a', send: jest.fn() };
    const client2 = { readyState: 1, _cid: 'b', send: jest.fn() };
    (service as any).wsServer = { clients: [client1, client2] };
    service.sendToAllWebSockets('chan', { foo: 1 }, 'a');
    expect(client2.send).toHaveBeenCalledWith(JSON.stringify({ channel: 'chan', data: { foo: 1 } }));
    expect(client1.send).not.toHaveBeenCalled();
  });

  it('sendToAll calls sendToAllRenderers and broadcastToWebClients', () => {
    const spy1 = jest.spyOn(service, 'sendToAllRenderers').mockImplementation(() => {});
    const spy2 = jest.spyOn(service, 'broadcastToWebClients').mockImplementation(() => {});
    service.sendToAll('chan', { foo: 1 });
    expect(spy1).toHaveBeenCalledWith('chan', { foo: 1 });
    expect(spy2).toHaveBeenCalledWith('chan', { foo: 1 });
  });

  it('sendToAllOthers excludes sender from renderers and websockets', () => {
  // Removed duplicate wc1 and wc2 declarations
  const sender = { send: jest.fn(), on: jest.fn() };
  const wc1 = { send: jest.fn(), on: jest.fn() };
  const wc2 = { send: jest.fn(), on: jest.fn() };
  service.addWebContents(wc1);
  service.addWebContents(wc2);
  const spy = jest.spyOn(service, 'sendToAllWebSockets').mockImplementation(() => {});
  const spy2 = jest.spyOn(service, 'broadcastToWebClients').mockImplementation(() => {});
  service.sendToAllOthers('chan', { foo: 1 }, sender);
  expect(wc2.send).toHaveBeenCalledWith('chan', { foo: 1 });
  expect(sender.send).not.toHaveBeenCalled();
  expect(spy).toHaveBeenCalled();
  expect(spy2).toHaveBeenCalled();
  });
});
