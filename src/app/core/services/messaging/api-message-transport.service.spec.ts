import { ApiMessageTransport } from './api-message-transport.service';
import { ApiService } from '../api.service';
import { WebSocketService } from '../web-socket.service';
import { of, Subject } from 'rxjs';

describe('ApiMessageTransport', () => {
  let transport: ApiMessageTransport;
  let apiMock: jasmine.SpyObj<ApiService>;
  let wsMock: jasmine.SpyObj<WebSocketService>;

  beforeEach(() => {
    apiMock = jasmine.createSpyObj('ApiService', ['post']);
    wsMock = jasmine.createSpyObj('WebSocketService', ['sendMessage', 'receiveMessage']);
    apiMock.post.and.returnValue(of({}));
    wsMock.sendMessage.and.callFake(() => {});
    wsMock.receiveMessage.and.returnValue(new Subject<any>());
    transport = new ApiMessageTransport(apiMock, wsMock);
  });

  it('should be created', () => {
    expect(transport).toBeTruthy();
  });

  it('should send message via WebSocket if available', (done) => {
    const obs = transport.sendMessage('chan', { foo: 'bar' });
    expect(wsMock.sendMessage).toHaveBeenCalledWith('chan', { foo: 'bar' });
    obs.subscribe({ complete: () => done() });
  });

  it('should send message via API if WebSocket not available', (done) => {
    const wsNull = null as any;
    transport = new ApiMessageTransport(apiMock, wsNull);
    const obs = transport.sendMessage('chan', { foo: 'bar' });
    expect(apiMock.post).toHaveBeenCalledWith('/api/message', { channel: 'chan', payload: { foo: 'bar' } });
    obs.subscribe(() => done());
  });

  it('should receive message via WebSocket', () => {
    transport.receiveMessage('chan');
    expect(wsMock.receiveMessage).toHaveBeenCalledWith('chan');
  });
});
