import { ApiMessageTransport } from './api-message-transport.service';
import { WebSocketService } from '../web-socket.service';
import { Subject } from 'rxjs';

describe('ApiMessageTransport', () => {
  let transport: ApiMessageTransport;
  let wsMock: jasmine.SpyObj<WebSocketService>;

  beforeEach(() => {
    wsMock = jasmine.createSpyObj('WebSocketService', ['sendMessage', 'receiveMessage']);
    wsMock.receiveMessage.and.returnValue(new Subject<any>());
    transport = new ApiMessageTransport(wsMock);
  });

  it('sends over the WebSocket and completes at once', (done) => {
    const obs = transport.sendMessage('chan', { foo: 'bar' });
    expect(wsMock.sendMessage).toHaveBeenCalledWith('chan', { foo: 'bar' }, undefined);
    obs.subscribe({ complete: () => done() });
  });

  it('tells the WebSocket how long the caller will wait', () => {
    transport.sendMessage('chan', { foo: 'bar' }, { timeoutMs: 5000 });
    expect(wsMock.sendMessage).toHaveBeenCalledWith('chan', { foo: 'bar' }, 5000);
  });

  it('receives over the WebSocket', () => {
    transport.receiveMessage('chan');
    expect(wsMock.receiveMessage).toHaveBeenCalledWith('chan');
  });
});
