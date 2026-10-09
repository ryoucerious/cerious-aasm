import { BehaviorSubject, of, throwError } from 'rxjs';
import { ServerNavService, SERVER_TABS } from './server-nav.service';
import { FirewallService } from './firewall.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

describe('ServerNavService', () => {
  let service: ServerNavService;
  let firewall: jasmine.SpyObj<FirewallService>;
  let connected$: BehaviorSubject<boolean>;

  const create = (isElectron = true) => new ServerNavService(
    firewall,
    { connected$ } as unknown as WebSocketService,
    { isElectron } as IpcService
  );

  beforeEach(() => {
    connected$ = new BehaviorSubject(false);
    firewall = jasmine.createSpyObj('FirewallService', ['checkFirewallStatus']);
    firewall.checkFirewallStatus.and.returnValue(of({ enabled: true, platform: 'linux' } as any));
    service = create();
  });

  it('starts with expert mode off and the console remembered', () => {
    expect(service.expertMode).toBeFalse();
    expect(service.lastTab).toBe('console');
  });

  it('toggles expert mode and emits', () => {
    const seen: boolean[] = [];
    service.expertMode$.subscribe(v => seen.push(v));
    service.setExpertMode(true);
    service.setExpertMode(true);
    expect(service.expertMode).toBeTrue();
    expect(seen).toEqual([false, true]);
  });

  it('remembers and validates tabs', () => {
    service.rememberTab('backup');
    expect(service.lastTab).toBe('backup');
    expect(service.isValidTab('mods')).toBeTrue();
    expect(service.isValidTab('nope')).toBeFalse();
    expect(service.isValidTab(null)).toBeFalse();
    expect(service.find('rates')?.label).toBe('Rates');
  });

  it('swaps configuration pages for INI pages in expert mode', () => {
    const normal = service.visibleTabs(false, false).map(t => t.id);
    expect(normal).toContain('general');
    expect(normal).not.toContain('ini-Game');
    // Windows too: the page says whether Windows Firewall lets players in.
    expect(normal).toContain('firewall');

    const expert = service.visibleTabs(true, true).map(t => t.id);
    expect(expert).not.toContain('general');
    expect(expert).toContain('ini-Game');
    expect(expert).toContain('firewall');
    expect(expert).toContain('mods');
  });

  it('detects linux lazily from the firewall status', () => {
    expect(firewall.checkFirewallStatus).not.toHaveBeenCalled();
    let isLinux = false;
    service.isLinux$.subscribe(v => isLinux = v);
    expect(firewall.checkFirewallStatus).toHaveBeenCalledTimes(1);
    expect(isLinux).toBeTrue();
    expect(service.isLinux).toBeTrue();
    expect(firewall.checkFirewallStatus).toHaveBeenCalledTimes(1);
  });

  it('treats a failed platform check as not linux', () => {
    firewall.checkFirewallStatus.and.returnValue(throwError(() => new Error('no')));
    expect(service.isLinux).toBeFalse();
  });

  describe('in the web UI', () => {
    beforeEach(() => {
      service = create(false);
    });

    it('asks nothing before the socket is up, since a refused session drops the request', () => {
      service.isLinux$.subscribe();
      expect(service.isLinux).toBeFalse();
      expect(firewall.checkFirewallStatus).not.toHaveBeenCalled();
    });

    it('asks once when the socket comes up, and again on each reconnect', () => {
      service.isLinux$.subscribe();

      connected$.next(true);
      expect(firewall.checkFirewallStatus).toHaveBeenCalledTimes(1);
      expect(service.isLinux).toBeTrue();

      connected$.next(false);
      connected$.next(true);
      expect(firewall.checkFirewallStatus).toHaveBeenCalledTimes(2);
    });

    it('asks at once when the socket is already up', () => {
      connected$.next(true);
      service.isLinux$.subscribe();
      expect(firewall.checkFirewallStatus).toHaveBeenCalledTimes(1);
    });

    it('does not start asking until the platform is first wanted', () => {
      connected$.next(true);
      expect(firewall.checkFirewallStatus).not.toHaveBeenCalled();
    });

    it('learns the platform on a later connection after a failed check', () => {
      firewall.checkFirewallStatus.and.returnValues(
        throwError(() => new Error('Timeout has occurred')),
        of({ enabled: true, platform: 'linux' } as any)
      );
      service.isLinux$.subscribe();

      connected$.next(true);
      expect(service.isLinux).toBeFalse();

      connected$.next(false);
      connected$.next(true);
      expect(service.isLinux).toBeTrue();
    });

    it('keeps a platform it knows when a later check fails', () => {
      firewall.checkFirewallStatus.and.returnValues(
        of({ enabled: true, platform: 'linux' } as any),
        throwError(() => new Error('Timeout has occurred'))
      );
      service.isLinux$.subscribe();

      connected$.next(true);
      connected$.next(false);
      connected$.next(true);

      expect(service.isLinux).toBeTrue();
    });

    it('stops asking once destroyed', () => {
      service.isLinux$.subscribe();
      service.ngOnDestroy();

      connected$.next(true);

      expect(firewall.checkFirewallStatus).not.toHaveBeenCalled();
    });
  });

  it('lists every tab exactly once', () => {
    const ids = SERVER_TABS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
