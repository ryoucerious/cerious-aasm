import { InstallService } from './install.service';
import { throwError } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
describe('InstallService', () => {
  let service: InstallService;
  let messaging: jasmine.SpyObj<MessagingService>;
  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    service = new InstallService(messaging);
  });
  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  it('should call install with correct arguments and return observable', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.install('target', { foo: 'bar' });
    expect(messaging.sendMessage).toHaveBeenCalledWith('install', { target: 'target', foo: 'bar' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should call install with only target and return observable', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.install('target');
    expect(messaging.sendMessage).toHaveBeenCalledWith('install', { target: 'target' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from install', (done) => {
  messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.install('target').subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call cancelInstall with correct arguments and return observable', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.cancelInstall('target');
    expect(messaging.sendMessage).toHaveBeenCalledWith('cancel-install', { target: 'target' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from cancelInstall', (done) => {
  messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.cancelInstall('target').subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });
});
