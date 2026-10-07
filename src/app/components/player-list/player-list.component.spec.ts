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

    mockMessaging.sendMessage.and.returnValue(of({ success: true, players: [] }));

    fixture = TestBed.createComponent(PlayerListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('serverInstance', { id: 'test-1', state: 'Running' });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should request the player list over messaging on init', () => {
    expect(mockMessaging.sendMessage).toHaveBeenCalledWith('get-online-players', { id: 'test-1' });
  });

  it('should populate players on successful response', () => {
    mockMessaging.sendMessage.and.returnValue(of({
      success: true,
      players: [{ name: 'Player1', steamId: '123' }, { name: 'Player2', steamId: '456' }]
    }));
    component.refreshPlayers();
    expect(component.players.length).toBe(2);
    expect(component.players[0].name).toBe('Player1');
    expect(component.lastUpdated).toBeTruthy();
    expect(component.error).toBeNull();
  });

  it('should set error on failed response', () => {
    mockMessaging.sendMessage.and.returnValue(of({ success: false, error: 'RCON timeout' }));
    component.refreshPlayers();
    expect(component.error).toBe('RCON timeout');
    expect(component.players.length).toBe(0);
  });

  it('should set error on exception', () => {
    spyOn(console, 'error');
    mockMessaging.sendMessage.and.returnValue(throwError(() => new Error('transport error')));
    component.refreshPlayers();
    expect(component.error).toBe('Communication error.');
    expect(component.loading).toBeFalse();
    expect(console.error).toHaveBeenCalledWith('[player-list] Could not fetch the player list:', jasmine.any(Error));
  });

  it('should clear players and set error when the server is offline', () => {
    component.serverInstance = { id: 'test-1', state: 'Stopped' };
    component.refreshPlayers();
    expect(component.players.length).toBe(0);
    expect(component.error).toBe('Server is offline.');
    expect(component.isOnline).toBeFalse();
  });

  it('should clear players when serverInstance is null', () => {
    component.serverInstance = null;
    component.refreshPlayers();
    expect(component.players.length).toBe(0);
    expect(component.error).toBe('Server is offline.');
  });

  it('should set loading true during refresh and false after', () => {
    const response$ = new Subject<unknown>();
    mockMessaging.sendMessage.and.returnValue(response$.asObservable());

    component.refreshPlayers();
    expect(component.loading).toBeTrue();

    response$.next({ success: true, players: [] });
    expect(component.loading).toBeFalse();
  });

  it('should handle response with missing players array', () => {
    mockMessaging.sendMessage.and.returnValue(of({ success: true }));
    component.refreshPlayers();
    expect(component.players).toEqual([]);
  });

  it('should use fallback error message when response has no error field', () => {
    mockMessaging.sendMessage.and.returnValue(of({ success: false }));
    component.refreshPlayers();
    expect(component.error).toBe('Failed to retrieve player list.');
  });

  describe('when the user switches servers', () => {
    let replies: Record<string, Subject<unknown>>;

    beforeEach(() => {
      replies = {};
      mockMessaging.sendMessage.and.callFake(((channel: string, payload: { id: string }) =>
        replies[payload.id] = new Subject<unknown>()) as any);
    });

    it('asks for the new server\'s players and ignores the old server\'s reply', () => {
      component.refreshPlayers();
      fixture.componentRef.setInput('serverInstance', { id: 'test-2', state: 'Running' });
      fixture.detectChanges();

      replies['test-1'].next({ success: true, players: [{ name: 'Old', steamId: '1' }] });
      expect(component.players).toEqual([]);
      expect(component.loading).toBeTrue();

      replies['test-2'].next({ success: true, players: [{ name: 'New', steamId: '2' }] });
      expect(component.players.map(player => player.name)).toEqual(['New']);
    });

    it('does not ask again when the same server arrives as a new object', () => {
      mockMessaging.sendMessage.calls.reset();
      fixture.componentRef.setInput('serverInstance', { id: 'test-1', state: 'Running' });
      fixture.detectChanges();
      expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ASA names players by EOS ID, 32 hex characters; an older machine in a mesh sends it as steamId.
  it('shows each player\'s whole ID, however the machine hosting the server sends it', () => {
    mockMessaging.sendMessage.and.returnValue(of({
      success: true,
      players: [{ name: 'Jared', playerId: '0002a1b2c3d4e5f60718293a4b5c6d7e' }, { name: 'Old', steamId: '00029f8e7d6c5b4a39281706f5e4d3c2' }]
    }));

    component.refreshPlayers();
    fixture.detectChanges();

    const ids = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.player-id')).map(cell => cell.textContent?.trim());
    expect(ids).toEqual(['0002a1b2c3d4e5f60718293a4b5c6d7e', '00029f8e7d6c5b4a39281706f5e4d3c2']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Player ID');
  });

  describe('copying a player ID', () => {
    it('uses the Clipboard API where the page has one', async () => {
      spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());
      spyOn(mockNotification, 'success');
      await component.copyPlayerId('12345');
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('12345');
      expect(mockNotification.success as jasmine.Spy).toHaveBeenCalledWith('Player ID copied to clipboard');
    });

    // The web UI served over plain HTTP on a LAN is not a secure context, so it has no navigator.clipboard.
    it('still copies on a page without the Clipboard API', async () => {
      spyOnProperty(navigator, 'clipboard').and.returnValue(undefined as unknown as Clipboard);
      let copied = '';
      spyOn(document, 'execCommand').and.callFake((command: string) => {
        copied = command === 'copy' ? (document.activeElement as HTMLTextAreaElement).value : '';
        return true;
      });
      spyOn(mockNotification, 'success');
      const textareas = document.querySelectorAll('textarea').length;

      await component.copyPlayerId('76561198000000000');

      expect(copied).toBe('76561198000000000');
      expect(document.querySelectorAll('textarea').length).toBe(textareas);
      expect(mockNotification.success as jasmine.Spy).toHaveBeenCalledWith('Player ID copied to clipboard');
    });

    it('says so when the copy is refused', async () => {
      spyOn(console, 'error');
      spyOnProperty(navigator, 'clipboard').and.returnValue(undefined as unknown as Clipboard);
      spyOn(document, 'execCommand').and.returnValue(false);
      spyOn(mockNotification, 'success');
      spyOn(mockNotification, 'error');

      await component.copyPlayerId('123');

      expect(mockNotification.success).not.toHaveBeenCalled();
      expect(mockNotification.error).toHaveBeenCalled();
    });
  });
});
