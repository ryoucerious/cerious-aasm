import { TestBed } from '@angular/core/testing';
import { ThemeService, THEME_STORAGE_KEY } from './theme.service';

describe('ThemeService', () => {
  let listeners: Array<(e: any) => void>;
  let systemPrefersLight: boolean;

  /** Stand-in for matchMedia so the OS preference can be driven from a test. */
  function installMatchMedia() {
    listeners = [];
    spyOn(window, 'matchMedia').and.callFake((query: string) => ({
      // A getter, not a captured value: the service re-reads `matches` when the OS
      // change event fires, so a snapshot would make that path untestable.
      get matches() { return query.includes('light') ? systemPrefersLight : !systemPrefersLight; },
      media: query,
      addEventListener: (_: string, cb: (e: any) => void) => listeners.push(cb),
      removeEventListener: (_: string, cb: (e: any) => void) => {
        listeners = listeners.filter(l => l !== cb);
      },
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false
    } as any));
  }

  const make = () => TestBed.runInInjectionContext(() => new ThemeService());
  const attr = () => document.documentElement.getAttribute('data-theme');

  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    systemPrefersLight = false;
    installMatchMedia();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-bs-theme');
  });

  it('defaults to following the system', () => {
    const service = make();
    expect(service.preference).toBe('system');
  });

  it('resolves to light when the system prefers light', () => {
    systemPrefersLight = true;
    const service = make();
    expect(service.resolved).toBe('light');
    expect(attr()).toBe('light');
  });

  it('resolves to dark when the system prefers dark', () => {
    systemPrefersLight = false;
    const service = make();
    expect(service.resolved).toBe('dark');
    expect(attr()).toBe('dark');
  });

  it('sets data-bs-theme alongside data-theme so Bootstrap follows', () => {
    make().setPreference('light');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
  });

  it('persists an explicit choice', () => {
    make().setPreference('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('restores a stored choice over the system preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    systemPrefersLight = false;           // system says dark, stored choice must win
    const service = make();
    expect(service.preference).toBe('light');
    expect(service.resolved).toBe('light');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    expect(make().preference).toBe('system');
  });

  it('follows the OS while set to system', () => {
    const service = make();
    expect(service.resolved).toBe('dark');

    systemPrefersLight = true;
    listeners.forEach(cb => cb({ matches: true }));

    expect(service.resolved).toBe('light');
  });

  it('stops following the OS once a choice is made', () => {
    const service = make();
    service.setPreference('dark');

    systemPrefersLight = true;
    listeners.forEach(cb => cb({ matches: true }));

    expect(service.resolved).toBe('dark');
  });

  it('toggle flips away from whatever is showing, including under system', () => {
    systemPrefersLight = true;
    const service = make();
    expect(service.resolved).toBe('light');

    service.toggle();

    expect(service.preference).toBe('dark');
    expect(service.resolved).toBe('dark');
  });

  it('emits the resolved theme to subscribers', () => {
    const service = make();
    const seen: string[] = [];
    service.resolved$.subscribe(t => seen.push(t));
    service.setPreference('light');
    expect(seen).toEqual(['dark', 'light']);
  });

  it('still applies the theme when storage is unavailable', () => {
    spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');
    const service = make();
    expect(() => service.setPreference('light')).not.toThrow();
    expect(service.resolved).toBe('light');
    expect(attr()).toBe('light');
  });

  it('unsubscribes from OS changes on destroy', () => {
    const service = make();
    expect(listeners.length).toBe(1);
    service.destroy();
    expect(listeners.length).toBe(0);
  });
});
