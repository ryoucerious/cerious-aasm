import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { PlayerListComponent } from './player-list.component';
import { IpcService } from '../../core/services/ipc.service';
import { NotificationService } from '../../core/services/notification.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';

describe('PlayerListComponent', () => {
  let component: PlayerListComponent;
  let fixture: ComponentFixture<PlayerListComponent>;
  let mockIpcService: jasmine.SpyObj<IpcService>;
  let mockNotification: MockNotificationService;

  beforeEach(async () => {
    mockIpcService = jasmine.createSpyObj('IpcService', ['invoke']);
    mockNotification = new MockNotificationService();

    await TestBed.configureTestingModule({
      imports: [PlayerListComponent],
      providers: [
        { provide: IpcService, useValue: mockIpcService },
        { provide: NotificationService, useValue: mockNotification }
      ]
    }).compileComponents();

    // Default: resolve with empty players so ngOnInit doesn't throw
    mockIpcService.invoke.and.returnValue(Promise.resolve({ success: true, players: [] }));

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

  it('should call refreshPlayers on init', () => {
    expect(mockIpcService.invoke).toHaveBeenCalledWith('get-online-players', { id: 'test-1' });
  });

  it('should populate players on successful response', async () => {
    mockIpcService.invoke.and.returnValue(Promise.resolve({
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
    mockIpcService.invoke.and.returnValue(Promise.resolve({
      success: false,
      error: 'RCON timeout'
    }));
    await component.refreshPlayers();
    expect(component.error).toBe('RCON timeout');
    expect(component.players.length).toBe(0);
  });

  it('should set error on exception', async () => {
    mockIpcService.invoke.and.returnValue(Promise.reject(new Error('IPC error')));
    await component.refreshPlayers();
    expect(component.error).toBe('Communication error.');
    expect(component.loading).toBeFalse();
  });

  it('should clear players and set error when server is not running', async () => {
    component.serverInstance = { id: 'test-1', state: 'Stopped' };
    await component.refreshPlayers();
    expect(component.players.length).toBe(0);
    expect(component.error).toBe('Server is not running.');
  });

  it('should clear players when serverInstance is null', async () => {
    component.serverInstance = null;
    await component.refreshPlayers();
    expect(component.players.length).toBe(0);
    expect(component.error).toBe('Server is not running.');
  });

  it('should set loading true during refresh and false after', async () => {
    let resolveInvoke: Function;
    mockIpcService.invoke.and.returnValue(new Promise(r => resolveInvoke = r));

    component.serverInstance = { id: 'test-1', state: 'Running' };
    const refreshPromise = component.refreshPlayers();
    expect(component.loading).toBeTrue();

    resolveInvoke!({ success: true, players: [] });
    await refreshPromise;
    expect(component.loading).toBeFalse();
  });

  it('should handle response with missing players array', async () => {
    mockIpcService.invoke.and.returnValue(Promise.resolve({ success: true }));
    await component.refreshPlayers();
    expect(component.players).toEqual([]);
  });

  it('should use fallback error message when response has no error field', async () => {
    mockIpcService.invoke.and.returnValue(Promise.resolve({ success: false }));
    await component.refreshPlayers();
    expect(component.error).toBe('Failed to retrieve player list.');
  });

  it('should copy steam ID to clipboard via copySteamId', async () => {
    spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());
    spyOn(mockNotification, 'success');
    await component.copySteamId('12345');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('12345');
  });

  it('should unsubscribe auto-refresh on destroy', () => {
    expect(component.autoRefreshSub).toBeTruthy();
    const unsubSpy = spyOn(component.autoRefreshSub!, 'unsubscribe');
    component.ngOnDestroy();
    expect(unsubSpy).toHaveBeenCalled();
  });

  it('should handle destroy when autoRefreshSub is null', () => {
    component.autoRefreshSub = null;
    expect(() => component.ngOnDestroy()).not.toThrow();
  });
});
