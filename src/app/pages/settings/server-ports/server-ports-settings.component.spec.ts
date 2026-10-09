import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, of } from 'rxjs';
import { ServerPortsSettingsComponent } from './server-ports-settings.component';
import { FirewallService, ServerPortsReply, ServerPortsState, WindowsFirewallStatus } from '../../../core/services/firewall.service';
import { NotificationService } from '../../../core/services/notification.service';
import { IpcService } from '../../../core/services/ipc.service';
import { BusyService } from '../../../core/services/busy.service';

describe('ServerPortsSettingsComponent', () => {
  const ranges = { game: { start: 7777, end: 7900 }, query: { start: 27015, end: 27030 }, rcon: { start: 27020, end: 27050 } };
  const firewall = (extra: Partial<WindowsFirewallStatus> = {}): WindowsFirewallStatus =>
    ({ enabled: true, rules: 'missing', blockedPrograms: [], portsOpen: false, ...extra });
  const windows = (extra: Partial<ServerPortsState> = {}): ServerPortsState =>
    ({ ranges, source: 'settings', platform: 'windows', windowsFirewall: firewall(), linuxCommands: null, outside: [], ...extra });

  let fixture: ComponentFixture<ServerPortsSettingsComponent>;
  let service: jasmine.SpyObj<FirewallService>;
  let notification: jasmine.SpyObj<NotificationService>;
  let ipc: { isElectron: boolean };

  async function open(state: ServerPortsState): Promise<HTMLElement> {
    service.getServerPorts.and.returnValue(of(state));
    fixture = TestBed.createComponent(ServerPortsSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (page: HTMLElement, selector: string) => page.querySelector(selector)?.textContent?.trim().replace(/\s+/g, ' ') ?? null;
  const button = (page: HTMLElement, label: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === label) ?? null;
  const input = (page: HTMLElement, name: string) => page.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

  function type(field: HTMLInputElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    service = jasmine.createSpyObj('FirewallService', ['getServerPorts', 'setServerPorts', 'openServerPortsFirewall']);
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error', 'warning', 'info']);
    ipc = { isElectron: true };
    TestBed.configureTestingModule({
      imports: [ServerPortsSettingsComponent],
      providers: [
        { provide: FirewallService, useValue: service },
        { provide: NotificationService, useValue: notification },
        { provide: IpcService, useValue: ipc }
      ]
    });
  });

  it('shows the ranges new servers take their ports from', async () => {
    const page = await open(windows());

    expect(input(page, 'game-start').value).toBe('7777');
    expect(input(page, 'game-end').value).toBe('7900');
    expect(input(page, 'query-start').value).toBe('27015');
    expect(input(page, 'rcon-end').value).toBe('27050');
  });

  it('saves changed ranges for this machine', async () => {
    const page = await open(windows());
    const saved = { ...ranges, game: { start: 7777, end: 7800 } };
    service.setServerPorts.and.returnValue(of({ success: true, state: windows({ ranges: saved }) }));

    type(input(page, 'game-end'), '7800');
    button(page, 'Save')!.click();

    expect(service.setServerPorts).toHaveBeenCalledWith(saved);
    expect(notification.success).toHaveBeenCalledWith('Server ports saved.');
  });

  it('says why ranges were refused', async () => {
    const page = await open(windows());
    service.setServerPorts.and.returnValue(of({ success: false, error: 'The game ports end before they start.' }));

    type(input(page, 'game-end'), '7000');
    button(page, 'Save')!.click();

    expect(notification.error).toHaveBeenCalledWith('The game ports end before they start.');
  });

  describe('on Windows', () => {
    it('offers to open the ports while Windows Firewall keeps players out', async () => {
      const page = await open(windows());

      expect(text(page, '.server-ports-firewall-status')).toContain('Not open in Windows Firewall yet');
      expect(button(page, 'Open in Windows Firewall')).toBeTruthy();
    });

    it('says they are open, and offers nothing more', async () => {
      const page = await open(windows({ windowsFirewall: firewall({ rules: 'open', portsOpen: true }) }));

      expect(text(page, '.server-ports-firewall-status')).toContain('Open in Windows Firewall');
      expect(button(page, 'Open in Windows Firewall')).toBeNull();
    });

    it('names the servers a cancelled prompt blocks', async () => {
      const page = await open(windows({ windowsFirewall: firewall({ rules: 'open', blockedPrograms: ['c:\\a.exe', 'c:\\b.exe'] }) }));

      expect(text(page, '.server-ports-blocked')).toContain('Windows blocks 2 servers here');
      expect(button(page, 'Open in Windows Firewall')).toBeTruthy();
    });

    // Windows asks for permission on its own screen; nothing else here can be used meanwhile.
    it('opens them with the app covered until Windows answers', async () => {
      const page = await open(windows());
      const reply = new Subject<ServerPortsReply>();
      service.openServerPortsFirewall.and.returnValue(reply as Observable<ServerPortsReply>);
      const busy = TestBed.inject(BusyService);

      button(page, 'Open in Windows Firewall')!.click();
      expect(busy.message).toContain('Answer Windows');

      reply.next({ success: true, state: windows({ windowsFirewall: firewall({ rules: 'open', portsOpen: true }) }) });
      fixture.detectChanges();
      expect(busy.message).toBeNull();
      expect(notification.success).toHaveBeenCalledWith('The server ports are open. Windows won\'t ask about new servers here.');
      expect(button(page, 'Open in Windows Firewall')).toBeNull();
    });

    it('says why they could not be opened', async () => {
      const page = await open(windows());
      service.openServerPortsFirewall.and.returnValue(of({ success: false, error: 'Windows asked for permission and it was not given, so nothing changed.' }));

      button(page, 'Open in Windows Firewall')!.click();

      expect(notification.error).toHaveBeenCalledWith('Windows asked for permission and it was not given, so nothing changed.');
      expect(TestBed.inject(BusyService).message).toBeNull();
    });

    it('leaves opening them to the desktop app on this machine', async () => {
      ipc.isElectron = false;
      const page = await open(windows());

      expect(button(page, 'Open in Windows Firewall')).toBeNull();
      expect(text(page, '.server-ports-firewall')).toContain('from the desktop app on this machine');
    });
  });

  it('on Linux, gives the commands that open the ranges', async () => {
    const page = await open(windows({ platform: 'linux', windowsFirewall: null, linuxCommands: 'sudo ufw allow 7777:7900/udp' }));

    expect(text(page, '.server-ports-linux pre')).toBe('sudo ufw allow 7777:7900/udp');
    expect(page.querySelector('.server-ports-firewall')).toBeNull();
  });

  it('in Docker, points to docker-compose.yml and cannot change them here', async () => {
    const page = await open(windows({ platform: 'linux', source: 'docker', windowsFirewall: null }));

    expect(input(page, 'game-start').disabled).toBeTrue();
    expect(button(page, 'Save')).toBeNull();
    expect(text(page, '.server-ports-docker')).toContain('AASM_GAME_PORTS');
  });

  it('lists the servers whose ports are outside the ranges', async () => {
    const page = await open(windows({
      outside: [{ id: 'b', name: 'Center', ports: [
        { label: 'Game', port: 7967, protocol: 'UDP', range: ranges.game },
        { label: 'Peer', port: 7968, protocol: 'UDP', range: ranges.game }
      ] }]
    }));

    expect(text(page, '.server-ports-outside li')).toBe('Center: game 7967, peer 7968');
  });

  it('shows nothing until it has heard', () => {
    service.getServerPorts.and.returnValue(NEVER);
    fixture = TestBed.createComponent(ServerPortsSettingsComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.server-ports')).toBeNull();
  });
});
