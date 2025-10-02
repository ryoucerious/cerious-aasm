import { IpcService } from './ipc.service';

describe('IpcService', () => {
  let service: IpcService;
  let ipcRendererMock: any;
  let originalRequire: any;

  beforeEach(() => {
    // Mock window.require and electron.ipcRenderer
    originalRequire = (window as any).require;
    ipcRendererMock = {
      send: jasmine.createSpy('send'),
      invoke: jasmine.createSpy('invoke').and.returnValue(Promise.resolve('result')),
      on: jasmine.createSpy('on'),
      removeListener: jasmine.createSpy('removeListener')
    };
    (window as any).require = () => ({ ipcRenderer: ipcRendererMock });
    service = new IpcService();
  });

  afterEach(() => {
    (window as any).require = originalRequire;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should send message', () => {
    service.send('test', 1, 2);
    expect(ipcRendererMock.send).toHaveBeenCalledWith('test', 1, 2);
  });

  it('should invoke and resolve', async () => {
    const result = await service.invoke('test', 3);
    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('test', 3);
    expect(result).toBe('result');
  });

  it('should call on', () => {
    const listener = jasmine.createSpy('listener');
    service.on('chan', listener);
    expect(ipcRendererMock.on).toHaveBeenCalledWith('chan', listener);
  });

  it('should call removeListener', () => {
    const listener = jasmine.createSpy('listener');
    service.removeListener('chan', listener);
    expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('chan', listener);
  });

  it('should return observable from invoke$', (done) => {
    service.invoke$('chan', 4).subscribe(res => {
      expect(res).toBe('result');
      done();
    });
  });

  it('should not send if not in Electron', () => {
    (service as any).ipcRenderer = null;
    service.send('test');
    // Should not throw or call send
    expect(ipcRendererMock.send).not.toHaveBeenCalled();
  });

  it('should reject invoke if not in Electron', async () => {
    (service as any).ipcRenderer = null;
    await expectAsync(service.invoke('test')).toBeRejectedWith('Not running in Electron');
  });
});
