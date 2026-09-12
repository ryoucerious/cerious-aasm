import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ServerNavService, SERVER_TABS } from './server-nav.service';
import { FirewallService } from './firewall.service';

describe('ServerNavService', () => {
  let service: ServerNavService;
  let firewall: jasmine.SpyObj<FirewallService>;

  beforeEach(() => {
    firewall = jasmine.createSpyObj('FirewallService', ['checkFirewallStatus']);
    firewall.checkFirewallStatus.and.returnValue(of({ enabled: true, platform: 'linux' } as any));
    TestBed.configureTestingModule({
      providers: [ServerNavService, { provide: FirewallService, useValue: firewall }]
    });
    service = TestBed.inject(ServerNavService);
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
    expect(service.isConfigTab('general')).toBeTrue();
    expect(service.isConfigTab('ini-Game')).toBeTrue();
    expect(service.isConfigTab('mods')).toBeFalse();
  });

  it('swaps configuration pages for INI pages in expert mode', () => {
    const normal = service.visibleTabs(false, false).map(t => t.id);
    expect(normal).toContain('general');
    expect(normal).not.toContain('ini-Game');
    expect(normal).not.toContain('firewall');

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

  it('lists every tab exactly once', () => {
    const ids = SERVER_TABS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
