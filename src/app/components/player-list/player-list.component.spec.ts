import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { PlayerListComponent } from './player-list.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';

describe('PlayerListComponent', () => {
  let component: PlayerListComponent;
  let fixture: ComponentFixture<PlayerListComponent>;
  let mockMessaging: jasmine.SpyObj<MessagingService>;
  let mockNotification: MockNotificationService;

  beforeEach(async () => {
    mockMessaging = jasmine.createSpyObj('MessagingService', ['sendMessage']);
    mockNotification = new MockNotificationService();

    await TestBed.configureTestingModule({
      imports: [PlayerListComponent],
      providers: [
        { provide: MessagingService, useValue: mockMessaging },
        { provide: NotificationService, useValue: mockNotification }
      ]
    }).compileComponents();

    // Default: resolve with empty players so ngOnInit doesn't throw
    mockMessaging.sendMessage.and.returnValue(of({ success: true, players: [] }));

    fixture = TestBed.createComponent(PlayerListComponent);
    component = fixture.componentInstance;
    component.serverInstance = { id: 'test-1', state: 'Running' };
    fixture.detectChanges();
  });

  afterEach(() => {
    // Clean up interval subscription
    component.ngOnDestroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should request the player list over messaging on init', () => {
    expect(mockMessaging.sendMessage).toHaveBeenCalledWith('get-online-players', { id: 'test-1' });
  });

  it('should populate players on successful response', async () => {
    mockMessaging.sendMessage.and.returnValue(of({
      success: true,
      players: [{ name: 'Player1', steamId: '123' }, { name: 'Player2', steamId: '456' }]
    }));
    await component.refreshPlayers();
    expect(component.players.length).toBe(2);
    expect(component.players[0].name).toBe('Player1');
    expect(component.lastUpdated).toBeTruthy();
    expect(component.error).toBeNull();
  });

  it('should set error on failed response', async () => {
    mockMessaging.sendMessage.and.returnValue(of({ success: false, error: 'RCON timeout' }));
    await component.refreshPlayers();
    expect(component.error).toBe('RCON timeout');
    expect(component.players.length).toBe(0);
  });

  it('should set error on exception', async () => {
    mockMessaging.sendMessage.and.returnValue(throwError(() => new Error('transport error')));
    await component.refreshPlayers();
    expect(component.error).toBe('Communication error.');
    expect(component.loading).toBeFalse();
  });

  it('should clear players and set error when the server is offline', async () => {
    component.serverInstance = { id: 'test-1', state: 'Stopped' };
    await component.refreshPlayers();
    expect(component.players.length).toBe(0);
    expect(component.error).toBe('Server is offline.');
    expect(component.isOnline).toBeFalse();
  });

  it('should clear players when serverInstance is null', async () => {
    component.serverInstance = null;
    await component.refreshPlayers();
    expect(component.players.length).toBe(0);
    expect(component.error).toBe('Server is offline.');
  });

  it('should set loading true during refresh and false after', async () => {
    const response$ = new Subject<any>();
    mockMessaging.sendMessage.and.returnValue(response$.asObservable());

    component.serverInstance = { id: 'test-1', state: 'Running' };
    const refreshPromise = component.refreshPlayers();
    expect(component.loading).toBeTrue();

    response$.next({ success: true, players: [] });
    await refreshPromise;
    expect(component.loading).toBeFalse();
  });

  it('should handle response with missing players array', async () => {
    mockMessaging.sendMessage.and.returnValue(of({ success: true }));
    await component.refreshPlayers();
    expect(component.players).toEqual([]);
  });

  it('should use fallback error message when response has no error field', async () => {
    mockMessaging.sendMessage.and.returnValue(of({ success: false }));
    await component.refreshPlayers();
    expect(component.error).toBe('Failed to retrieve player list.');
  });

  it('should copy steam ID to clipboard via copySteamId', async () => {
    spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());
    spyOn(mockNotification, 'success');
    await component.copySteamId('12345');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('12345');
  });
});
