import { IpcMessageTransport } from './ipc-message-transport.service';
import { IpcService } from '../ipc.service';
import { of } from 'rxjs';

describe('IpcMessageTransport', () => {
  let transport: IpcMessageTransport;
  let ipcMock: jasmine.SpyObj<IpcService>;

  beforeEach(() => {
    ipcMock = jasmine.createSpyObj('IpcService', ['invoke', 'on', 'removeListener']);
    ipcMock.invoke.and.returnValue(Promise.resolve('result'));
    transport = new IpcMessageTransport(ipcMock);
  });

  it('should be created', () => {
    expect(transport).toBeTruthy();
  });

  it('should send message via IPC', (done) => {
    transport.sendMessage('chan', { foo: 'bar' }).subscribe(res => {
      expect(ipcMock.invoke).toHaveBeenCalledWith('message', { channel: 'chan', payload: { foo: 'bar' } });
      expect(res).toBe('result');
      done();
    });
  });

  it('should receive message via IPC', (done) => {
    let received: any;
    const listener = (_event: any, data: any) => {
      received = data;
    };
    ipcMock.on.and.callFake((channel: string, listener: (...args: any[]) => void) => {
      setTimeout(() => listener(null, 'data'), 0);
    });
    ipcMock.removeListener.and.callFake((channel: string, listener: (...args: any[]) => void) => {});
    const sub = transport.receiveMessage('chan').subscribe(data => {
      expect(data).toBe('data');
      sub.unsubscribe();
      expect(ipcMock.removeListener).toHaveBeenCalled();
      done();
    });
  });
});
