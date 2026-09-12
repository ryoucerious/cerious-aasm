import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/** The sections of the settings drawer, grouped in the rail by area. */
export type SettingsSection =
  | 'server-installation' | 'servers' | 'updates' | 'storage'
  | 'profile' | 'users' | 'web-server'
  | 'appearance' | 'about';

export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'server-installation';

/**
 * Opens and closes the settings drawer from anywhere.
 *
 * Settings used to be a routed page, which meant leaving whatever server you were looking at.
 * As a drawer it overlays the current page, so this small piece of state lives in a service
 * rather than in the URL.
 */
@Injectable({ providedIn: 'root' })
export class SettingsDrawerService {
  private readonly openSubject = new BehaviorSubject<boolean>(false);
  private readonly sectionSubject = new BehaviorSubject<SettingsSection>(DEFAULT_SETTINGS_SECTION);

  get isOpen(): boolean {
    return this.openSubject.value;
  }

  get isOpen$(): Observable<boolean> {
    return this.openSubject.asObservable();
  }

  get section(): SettingsSection {
    return this.sectionSubject.value;
  }

  get section$(): Observable<SettingsSection> {
    return this.sectionSubject.asObservable();
  }

  /** Open the drawer, optionally jumping straight to a section. */
  open(section?: SettingsSection): void {
    if (section) this.sectionSubject.next(section);
    if (!this.openSubject.value) this.openSubject.next(true);
  }

  close(): void {
    if (this.openSubject.value) this.openSubject.next(false);
  }

  toggle(section?: SettingsSection): void {
    this.openSubject.value ? this.close() : this.open(section);
  }

  selectSection(section: SettingsSection): void {
    this.sectionSubject.next(section);
  }
}
