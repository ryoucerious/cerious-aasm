import { MessagingService } from './messaging.service';
import { MessageTransport } from './message-transport.interface';
import { Observable, of, Subject } from 'rxjs';

describe('MessagingService', () => {
  let service: MessagingService;
  let transportMock: jasmine.SpyObj<MessageTransport>;

  beforeEach(() => {
    transportMock = jasmine.createSpyObj('MessageTransport', ['sendMessage', 'receiveMessage']);
    transportMock.sendMessage.and.returnValue(of({}));
    transportMock.receiveMessage.and.returnValue(new Subject<any>());
    service = new MessagingService(transportMock);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should send message and expect response', (done) => {
    const channel = 'test-channel';
    const payload = { foo: 'bar' };
    const responseSubject = new Subject<any>();
    transportMock.receiveMessage.and.returnValue(responseSubject);
    service.sendMessage(channel, payload).subscribe(res => {
      expect(res.data).toBe('baz');
      done();
    });
    // Simulate response with matching requestId
    setTimeout(() => {
      const lastCall = transportMock.sendMessage.calls.mostRecent().args[1];
      responseSubject.next({ requestId: lastCall.requestId, data: 'baz' });
    }, 0);
  });

  it('should receive message', () => {
    const channel = 'notif';
    service.receiveMessage(channel);
    expect(transportMock.receiveMessage).toHaveBeenCalledWith(channel);
  });

  it('should send notification', () => {
    service.sendNotification('notif', { foo: 'bar' });
    expect(transportMock.sendMessage).toHaveBeenCalledWith('notif', { foo: 'bar' });
  });

  it('should generate unique requestId', () => {
    const id1 = (service as any).generateRequestId();
    const id2 = (service as any).generateRequestId();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
  });
});
