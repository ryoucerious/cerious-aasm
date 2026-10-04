import { fakeAsync, tick } from '@angular/core/testing';
import { Subject, TimeoutError, of, throwError } from 'rxjs';
import { BACKUP_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, MessagingService } from './messaging.service';
import { MessageTransport } from './message-transport.interface';

describe('MessagingService', () => {
  let service: MessagingService;
  let transportMock: jasmine.SpyObj<MessageTransport>;
  let replies: Subject<any>;

  const lastRequestId = (): string =>
    (transportMock.sendMessage.calls.mostRecent().args[1] as { requestId: string }).requestId;

  beforeEach(() => {
    replies = new Subject<any>();
    transportMock = jasmine.createSpyObj('MessageTransport', ['sendMessage', 'receiveMessage']);
    transportMock.sendMessage.and.returnValue(of({}));
    transportMock.receiveMessage.and.returnValue(replies);
    service = new MessagingService(transportMock);
  });

  it('sends the payload with a requestId and returns the matching reply', () => {
    let reply: any;
    service.sendMessage('test-channel', { foo: 'bar' }).subscribe(res => reply = res);

    expect(transportMock.sendMessage).toHaveBeenCalledWith(
      'test-channel', { foo: 'bar', requestId: lastRequestId() }, { timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS }
    );
    replies.next({ requestId: 'someone-else', data: 'nope' });
    replies.next({ requestId: lastRequestId(), data: 'baz' });

    expect(reply).toEqual({ requestId: lastRequestId(), data: 'baz' });
  });

  it('tells the transport how long the caller will wait', () => {
    service.sendMessage('create-backup', {}, { timeoutMs: BACKUP_TIMEOUT_MS });
    expect(transportMock.sendMessage.calls.mostRecent().args[2]).toEqual({ timeoutMs: BACKUP_TIMEOUT_MS });
  });

  it('sends even if nobody subscribes', () => {
    service.sendMessage('web-server-status', {});
    expect(transportMock.sendMessage).toHaveBeenCalled();
  });

  it('fails at once when the transport cannot deliver the request', fakeAsync(() => {
    transportMock.sendMessage.and.returnValue(throwError(() => new Error('Not running in Electron')));
    let error: unknown;

    service.sendMessage('chan', {}).subscribe({ error: err => error = err });
    tick(0);

    expect(error).toEqual(new Error('Not running in Electron'));
  }));

  it('times out after 30 seconds by default', fakeAsync(() => {
    let error: unknown;
    service.sendMessage('chan', {}).subscribe({ error: err => error = err });

    tick(DEFAULT_REQUEST_TIMEOUT_MS - 1);
    expect(error).toBeUndefined();
    tick(1);
    expect(error).toBeInstanceOf(TimeoutError);
  }));

  it('waits as long as the caller allows, so a slow backup reports its real result', fakeAsync(() => {
    let reply: any;
    let error: unknown;
    service.sendMessage('create-backup', {}, { timeoutMs: BACKUP_TIMEOUT_MS })
      .subscribe({ next: res => reply = res, error: err => error = err });

    tick(20 * 60_000);
    replies.next({ requestId: lastRequestId(), success: true });

    expect(error).toBeUndefined();
    expect(reply).toEqual(jasmine.objectContaining({ success: true }));
  }));

  it('should receive message', () => {
    service.receiveMessage('notif');
    expect(transportMock.receiveMessage).toHaveBeenCalledWith('notif');
  });

  it('should send notification', () => {
    service.sendNotification('notif', { foo: 'bar' });
    expect(transportMock.sendMessage).toHaveBeenCalledWith('notif', { foo: 'bar' });
  });

  it('gives each request its own id', () => {
    service.sendMessage('a', {});
    const first = lastRequestId();
    service.sendMessage('a', {});
    expect(lastRequestId()).not.toBe(first);
    expect(typeof first).toBe('string');
  });
});
