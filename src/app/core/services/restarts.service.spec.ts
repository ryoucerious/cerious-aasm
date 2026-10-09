import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { RestartsService } from './restarts.service';
import { MessagingService } from './messaging/messaging.service';
import { NotificationService } from './notification.service';

describe('RestartsService', () => {
  let events: Subject<unknown>;
  let sendMessage: jasmine.Spy;
  let notification: jasmine.SpyObj<NotificationService>;
  let replies: Record<string, unknown>;

  function create(): RestartsService {
    events = new Subject();
    replies = { 'get-pending-restarts': { pending: [{ instanceId: 'a', dueAt: 5_000, all: false }] } };
    sendMessage = jasmine.createSpy('sendMessage').and.callFake((channel: string) =>
      channel in replies ? (replies[channel] instanceof Error ? throwError(() => replies[channel]) : of(replies[channel])) : of({ success: true }));
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info', 'warning']);
    TestBed.configureTestingModule({
      providers: [
        RestartsService,
        { provide: MessagingService, useValue: { sendMessage, receiveMessage: () => events.asObservable() } },
        { provide: NotificationService, useValue: notification }
      ]
    });
    return TestBed.inject(RestartsService);
  }

  it('knows the restarts already counting down', () => {
    const restarts = create();

    expect(sendMessage).toHaveBeenCalledWith('get-pending-restarts', {});
    expect(restarts.dueAt('a')).toBe(5_000);
    expect(restarts.dueAt('b')).toBeNull();
  });

  it('follows countdowns as they start and end, here or on another machine', () => {
    const restarts = create();
    const heard = jasmine.createSpy('changed');
    restarts.changed$.subscribe(heard);
    heard.calls.reset();

    events.next({ instanceId: 'b', dueAt: 9_000, all: true });
    expect(restarts.dueAt('b')).toBe(9_000);
    expect(restarts.restartingAllAt()).toBe(9_000);

    events.next({ instanceId: 'b', dueAt: null, all: true });
    expect(restarts.dueAt('b')).toBeNull();
    expect(restarts.restartingAllAt()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('restarts a server with the minutes of warning, or now', () => {
    const restarts = create();

    restarts.restart({ id: 'a', name: 'Island' }, 5);
    restarts.restart({ id: 'a', name: 'Island' }, 0);

    expect(sendMessage).toHaveBeenCalledWith('restart-server-instance', { id: 'a', warningMinutes: 5 }, jasmine.any(Object));
    expect(sendMessage).toHaveBeenCalledWith('restart-server-instance', { id: 'a', warningMinutes: 0 }, jasmine.any(Object));
  });

  it('says why a restart was refused', () => {
    const restarts = create();
    replies['restart-server-instance'] = { success: false, error: 'The hosting node is not available.' };

    restarts.restart({ id: 'a', name: 'Island' }, 5);

    expect(notification.error).toHaveBeenCalledWith('The hosting node is not available.', 'Server Control');
  });

  it('cancels a server\'s restart, and a restart of all', () => {
    const restarts = create();

    restarts.cancel({ id: 'a', name: 'Island' });
    restarts.cancelAll();

    expect(sendMessage).toHaveBeenCalledWith('cancel-server-restart', { id: 'a' });
    expect(sendMessage).toHaveBeenCalledWith('cancel-restart-all', {});
  });

  it('restarts every server with the minutes of warning', () => {
    const restarts = create();

    restarts.restartAll(15);

    expect(sendMessage).toHaveBeenCalledWith('restart-all-instances', { warningMinutes: 15 }, jasmine.any(Object));
  });
});
