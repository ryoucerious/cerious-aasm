import { NotificationService } from './notification.service';
import { MessagingService } from './messaging/messaging.service';
import { ToastService } from './toast.service';
import { Subject } from 'rxjs';

describe('NotificationService', () => {
  let service: NotificationService;
  let messagingMock: jasmine.SpyObj<MessagingService>;
  let toastMock: jasmine.SpyObj<ToastService>;
  let notificationSubject: Subject<any>;

  beforeEach(() => {
    notificationSubject = new Subject<any>();
    messagingMock = jasmine.createSpyObj('MessagingService', ['receiveMessage']);
    toastMock = jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']);
    messagingMock.receiveMessage.and.returnValue(notificationSubject);
    service = new NotificationService(messagingMock, toastMock);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should call toast.success', () => {
    service.success('msg', 'title', 1234);
    expect(toastMock.success).toHaveBeenCalledWith('msg', 'title', 1234);
  });

  it('should call toast.error', () => {
    service.error('msg', 'title', 2345);
    expect(toastMock.error).toHaveBeenCalledWith('msg', 'title', 2345);
  });

  it('should call toast.info', () => {
    service.info('msg', 'title', 3456);
    expect(toastMock.info).toHaveBeenCalledWith('msg', 'title', 3456);
  });

  it('should call toast.warning', () => {
    service.warning('msg', 'title', 4567);
    expect(toastMock.warning).toHaveBeenCalledWith('msg', 'title', 4567);
  });

  it('should handle notification messages from backend', () => {
  notificationSubject.next({ type: 'success', message: 'ok' });
  expect(toastMock.success).toHaveBeenCalledWith('ok', undefined, 3000);
  notificationSubject.next({ type: 'error', message: 'fail' });
  expect(toastMock.error).toHaveBeenCalledWith('fail', undefined, 3000);
  notificationSubject.next({ type: 'info', message: 'info' });
  expect(toastMock.info).toHaveBeenCalledWith('info', undefined, 3000);
  notificationSubject.next({ type: 'warning', message: 'warn' });
  expect(toastMock.warning).toHaveBeenCalledWith('warn', undefined, 3000);
  notificationSubject.next({ type: 'other', message: 'other' });
  expect(toastMock.info).toHaveBeenCalledWith('other', undefined, 3000);
  });

  it('should clean up subscriptions on destroy', () => {
    const sub = { unsubscribe: jasmine.createSpy('unsubscribe') };
    (service as any).subs = [sub];
    service.ngOnDestroy();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});
