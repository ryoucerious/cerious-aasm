import { NotificationService } from './notification.service';
import { MessagingService } from './messaging/messaging.service';
import { ToastrService } from 'ngx-toastr';
import { Subject } from 'rxjs';

describe('NotificationService', () => {
  let service: NotificationService;
  let messagingMock: jasmine.SpyObj<MessagingService>;
  let toastrMock: jasmine.SpyObj<ToastrService>;
  let notificationSubject: Subject<any>;

  beforeEach(() => {
    notificationSubject = new Subject<any>();
    messagingMock = jasmine.createSpyObj('MessagingService', ['receiveMessage']);
    toastrMock = jasmine.createSpyObj('ToastrService', ['success', 'error', 'info', 'warning']);
    messagingMock.receiveMessage.and.returnValue(notificationSubject);
    service = new NotificationService(messagingMock, toastrMock);
  });

  it('should call toastr.success', () => {
    service.success('msg', 'title', 1234);
    expect(toastrMock.success).toHaveBeenCalledWith('msg', 'title', { timeOut: 1234 });
  });

  it('should call toastr.error', () => {
    service.error('msg', 'title', 2345);
    expect(toastrMock.error).toHaveBeenCalledWith('msg', 'title', { timeOut: 2345 });
  });

  it('should call toastr.info', () => {
    service.info('msg', 'title', 3456);
    expect(toastrMock.info).toHaveBeenCalledWith('msg', 'title', { timeOut: 3456 });
  });

  it('should call toastr.warning', () => {
    service.warning('msg', 'title', 4567);
    expect(toastrMock.warning).toHaveBeenCalledWith('msg', 'title', { timeOut: 4567 });
  });

  it('defaults to three seconds', () => {
    service.success('msg');
    expect(toastrMock.success).toHaveBeenCalledWith('msg', undefined, { timeOut: 3000 });
  });

  it('should handle notification messages from backend', () => {
    notificationSubject.next({ type: 'success', message: 'ok' });
    expect(toastrMock.success).toHaveBeenCalledWith('ok', undefined, { timeOut: 3000 });
    notificationSubject.next({ type: 'error', message: 'fail' });
    expect(toastrMock.error).toHaveBeenCalledWith('fail', undefined, { timeOut: 3000 });
    notificationSubject.next({ type: 'info', message: 'info' });
    expect(toastrMock.info).toHaveBeenCalledWith('info', undefined, { timeOut: 3000 });
    notificationSubject.next({ type: 'warning', message: 'warn' });
    expect(toastrMock.warning).toHaveBeenCalledWith('warn', undefined, { timeOut: 3000 });
    notificationSubject.next({ type: 'other', message: 'other' });
    expect(toastrMock.info).toHaveBeenCalledWith('other', undefined, { timeOut: 3000 });
  });

  it('ignores notifications without a type or message', () => {
    notificationSubject.next({ type: 'error' });
    notificationSubject.next({ message: 'no type' });
    notificationSubject.next(null);
    expect(toastrMock.error).not.toHaveBeenCalled();
    expect(toastrMock.info).not.toHaveBeenCalled();
  });

  it('should clean up subscriptions on destroy', () => {
    service.ngOnDestroy();
    expect(notificationSubject.observed).toBeFalse();
  });
});
