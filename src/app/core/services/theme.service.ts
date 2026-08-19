import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/** What the user picked. 'system' defers to the OS and keeps following it as it changes. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** What is actually on screen — 'system' is always resolved to one of these. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Storage key. Also read by the inline bootstrap in index.html, which applies the theme
 * before first paint; the two must stay in sync.
 */
export const THEME_STORAGE_KEY = 'cerious-aasm.theme';

/**
 * Owns the light/dark theme.
 *
 * The preference is per device (localStorage) rather than server state: the same headless
 * install is viewed from the desktop app and from any number of browsers, and a display
 * preference belongs to the person looking at the screen, not to the server.
 *
 * Applying a theme means stamping `data-theme` on <html>; every colour in the app is a CSS
 * custom property that resolves off that attribute (see styles/_theme.scss). `data-bs-theme`
 * is set alongside it so Bootstrap 5.3's own components follow along.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly preferenceSubject = new BehaviorSubject<ThemePreference>('system');
  private readonly resolvedSubject = new BehaviorSubject<ResolvedTheme>('dark');

  private mediaQuery: MediaQueryList | null = null;
  private readonly onSystemChange = () => {
    // Only meaningful while following the system; an explicit choice ignores the OS.
    if (this.preferenceSubject.value === 'system') {
      this.apply(this.resolve('system'));
    }
  };

  constructor() {
    this.mediaQuery = this.getMediaQuery();
    const preference = this.readStoredPreference();
    this.preferenceSubject.next(preference);
    this.apply(this.resolve(preference));
    this.watchSystem();
  }

  /** The user's choice, including 'system'. */
  get preference(): ThemePreference {
    return this.preferenceSubject.value;
  }

  /** The user's choice as a stream, for binding a settings control. */
  get preference$(): Observable<ThemePreference> {
    return this.preferenceSubject.asObservable();
  }

  /** The theme actually showing right now, with 'system' already resolved. */
  get resolved(): ResolvedTheme {
    return this.resolvedSubject.value;
  }

  /** The showing theme as a stream, for anything that must react to the real colours. */
  get resolved$(): Observable<ResolvedTheme> {
    return this.resolvedSubject.asObservable();
  }

  /** Record a new preference and apply it immediately. */
  setPreference(preference: ThemePreference): void {
    const next: ThemePreference =
      preference === 'light' || preference === 'dark' || preference === 'system' ? preference : 'system';

    this.preferenceSubject.next(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode, disabled cookies). The theme still applies for
      // this session; it just will not be remembered.
    }
    this.apply(this.resolve(next));
  }

  /**
   * Flip between light and dark. Following the system counts as whichever theme is
   * currently showing, so one toggle always visibly changes something.
   */
  toggle(): void {
    this.setPreference(this.resolved === 'dark' ? 'light' : 'dark');
  }

  /** Stop listening to OS changes. */
  destroy(): void {
    if (!this.mediaQuery) return;
    if (typeof this.mediaQuery.removeEventListener === 'function') {
      this.mediaQuery.removeEventListener('change', this.onSystemChange);
    } else if (typeof (this.mediaQuery as any).removeListener === 'function') {
      (this.mediaQuery as any).removeListener(this.onSystemChange);
    }
  }

  private resolve(preference: ThemePreference): ResolvedTheme {
    if (preference === 'light' || preference === 'dark') {
      return preference;
    }
    // Dark is the app's original look, so it stays the answer when the OS has no opinion
    // or matchMedia is unavailable.
    return this.mediaQuery?.matches ? 'light' : 'dark';
  }

  private apply(theme: ResolvedTheme): void {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (root) {
      root.setAttribute('data-theme', theme);
      root.setAttribute('data-bs-theme', theme);
    }
    if (this.resolvedSubject.value !== theme) {
      this.resolvedSubject.next(theme);
    }
  }

  private readStoredPreference(): ThemePreference {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // Storage unavailable — fall through to the default
    }
    return 'system';
  }

  private getMediaQuery(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return null;
    }
    return window.matchMedia('(prefers-color-scheme: light)');
  }

  private watchSystem(): void {
    if (!this.mediaQuery) return;
    // addEventListener is the modern API; addListener is kept for older WebViews.
    if (typeof this.mediaQuery.addEventListener === 'function') {
      this.mediaQuery.addEventListener('change', this.onSystemChange);
    } else if (typeof (this.mediaQuery as any).addListener === 'function') {
      (this.mediaQuery as any).addListener(this.onSystemChange);
    }
  }
}
