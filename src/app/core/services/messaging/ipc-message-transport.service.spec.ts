import { IpcMessageTransport } from './ipc-message-transport.service';
import { IpcService } from '../ipc.service';
import type { ElectronListener } from '../../types/electron-api';

describe('IpcMessageTransport', () => {
  let transport: IpcMessageTransport;
  let ipcMock: jasmine.SpyObj<IpcService>;

  beforeEach(() => {
    ipcMock = jasmine.createSpyObj('IpcService', ['invoke', 'on']);
    ipcMock.invoke.and.resolveTo({ status: 'received' });
    transport = new IpcMessageTransport(ipcMock);
  });

  it('sends every message through the generic message channel', (done) => {
    transport.sendMessage('chan', { foo: 'bar' }).subscribe(res => {
      expect(ipcMock.invoke).toHaveBeenCalledWith('message', { channel: 'chan', payload: { foo: 'bar' } });
      expect(res).toEqual({ status: 'received' });
      done();
    });
  });

  it('errors when the main process cannot be reached', (done) => {
    ipcMock.invoke.and.rejectWith(new Error('Not running in Electron'));
    transport.sendMessage('chan', {}).subscribe({
      error: err => {
        expect(err).toEqual(new Error('Not running in Electron'));
        done();
      }
    });
  });

  it('errors when the main process refuses the message, rather than counting it as delivered', (done) => {
    ipcMock.invoke.and.resolveTo({ status: 'error', error: 'Invalid channel format' });
    transport.sendMessage('bad channel', {}).subscribe({
      next: () => fail('a refused message was reported as delivered'),
      error: err => {
        expect(err).toEqual(new Error('Invalid channel format'));
        done();
      }
    });
  });

  it('errors on a refusal that gives no reason', (done) => {
    ipcMock.invoke.and.resolveTo({ status: 'error' });
    transport.sendMessage('chan', {}).subscribe({
      next: () => fail('a refused message was reported as delivered'),
      error: err => {
        expect(err).toEqual(jasmine.any(Error));
        done();
      }
    });
  });

  it('receives events on the channel and stops listening on unsubscribe', () => {
    const unsubscribe = jasmine.createSpy('unsubscribe');
    let listener: ElectronListener | undefined;
    ipcMock.on.and.callFake((_channel, fn) => {
      listener = fn;
      return unsubscribe;
    });
    const received: unknown[] = [];

    const sub = transport.receiveMessage('chan').subscribe(data => received.push(data));
    listener!({}, 'data');
    sub.unsubscribe();

    expect(ipcMock.on).toHaveBeenCalledWith('chan', jasmine.any(Function));
    expect(received).toEqual(['data']);
    expect(unsubscribe).toHaveBeenCalled();
  });
});
