import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ActivityService, ACTIVITY_SEEN_KEY } from './activity.service';
import { MessagingService } from './messaging/messaging.service';

describe('ActivityService', () => {
  let service: ActivityService;
  let channels: Record<string, Subject<any>>;
  let sendMessage: jasmine.Spy;

  const entry = (id: number, message: string, createdAt: number, kind = 'info') =>
    ({ id, kind, message, createdAt, instanceId: null, username: null });

  const configure = (entries: any[] = []) => {
    channels = {};
    sendMessage = jasmine.createSpy('sendMessage').and.callFake((channel: string) => {
      if (channel === 'get-activity') return of({ success: true, entries });
      return of({ success: true });
    });

    TestBed.configureTestingModule({
      providers: [
        ActivityService,
        {
          provide: MessagingService,
          useValue: {
            sendMessage,
            receiveMessage: (channel: string) => {
              channels[channel] = channels[channel] || new Subject<any>();
              return channels[channel].asObservable();
            }
          }
        }
      ]
    });
    service = TestBed.inject(ActivityService);
  };

  beforeEach(() => {
    localStorage.removeItem(ACTIVITY_SEEN_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(ACTIVITY_SEEN_KEY);
  });

  it('loads the feed from the backend on creation', () => {
    configure([entry(2, 'Ragnarok started', 2000, 'start'), entry(1, 'Backup completed', 1000, 'backup')]);
    expect(sendMessage).toHaveBeenCalledWith('get-activity', { limit: 100 });
    expect(service.items.length).toBe(2);
    expect(service.items[0]).toEqual(jasmine.objectContaining({ id: '2', kind: 'start', message: 'Ragnarok started', timestamp: 2000 }));
  });

  it('keeps the previous list when a refresh fails', () => {
    configure([entry(1, 'kept', 1000)]);
    sendMessage.and.returnValue(of({ success: false, error: 'nope' }));
    service.refresh();
    expect(service.items.length).toBe(1);
    expect(service.items[0].message).toBe('kept');
  });

  it('reloads when a live event arrives, collapsing bursts', fakeAsync(() => {
    configure([entry(1, 'first', 1000)]);
    const initialCalls = sendMessage.calls.count();

    channels['server-instance-state'].next({ instanceId: 'a', state: 'running' });
    channels['server-instance-state'].next({ instanceId: 'b', state: 'running' });
    channels['backup-created'].next({ instanceId: 'a' });
    expect(sendMessage.calls.count()).toBe(initialCalls);

    tick(400);
    expect(sendMessage.calls.count()).toBe(initialCalls + 1);
  }));

  it('reloads when the feed is cleared elsewhere', fakeAsync(() => {
    configure();
    const initialCalls = sendMessage.calls.count();
    channels['activity-changed'].next({});
    tick(400);
    expect(sendMessage.calls.count()).toBe(initialCalls + 1);
  }));

  it('tracks unread items against a per-device marker', () => {
    const now = Date.now();
    configure([entry(2, 'new', now + 1000), entry(1, 'old', now - 1000)]);
    expect(service.unreadCount).toBe(2);

    service.markAllSeen();
    expect(service.unreadCount).toBe(1); // the future-dated entry is still ahead of "now"
    expect(localStorage.getItem(ACTIVITY_SEEN_KEY)).toBeTruthy();
  });

  it('asks the backend to clear, then reloads', () => {
    configure([entry(1, 'x', 1000)]);
    service.clear();
    expect(sendMessage).toHaveBeenCalledWith('clear-activity', {});
    expect(sendMessage).toHaveBeenCalledWith('get-activity', { limit: 100 });
  });

  it('tolerates malformed entries', () => {
    configure([{ id: 5 }]);
    expect(service.items.length).toBe(1);
    expect(service.items[0].kind).toBe('info');
    expect(service.items[0].message).toBe('');
    expect(service.items[0].timestamp).toBeGreaterThan(0);
  });

  it('unsubscribes on destroy', () => {
    configure();
    const sub = { unsubscribe: jasmine.createSpy('unsubscribe') };
    (service as any).subs = [sub];
    service.ngOnDestroy();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});
