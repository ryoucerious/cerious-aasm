import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { FirewallService } from './firewall.service';

/** Every page a selected server has. These are the route segments under /server/. */
export type ServerTabId =
  | 'console' | 'players'
  | 'general' | 'rates' | 'structures' | 'stats' | 'misc' | 'cluster'
  | 'ini-GameUserSettings' | 'ini-Game' | 'ini-Engine'
  | 'mods' | 'arkapi' | 'whitelist' | 'automation' | 'broadcasts' | 'discord' | 'firewall' | 'backup';

export interface ServerTabDef {
  id: ServerTabId;
  label: string;
  icon: string;
  /** 'overview' items are always shown; 'config' and 'ini' swap with Expert Mode; 'features' are always shown. */
  group: 'overview' | 'config' | 'ini' | 'features';
  linuxOnly?: boolean;
}

export const SERVER_TABS: ServerTabDef[] = [
  { id: 'console',    label: 'Console',            icon: 'terminal',      group: 'overview' },
  { id: 'players',    label: 'Players',            icon: 'group',         group: 'overview' },
  { id: 'general',    label: 'General',            icon: 'tune',          group: 'config' },
  { id: 'rates',      label: 'Rates',              icon: 'speed',         group: 'config' },
  { id: 'structures', label: 'Structures',         icon: 'home',          group: 'config' },
  { id: 'stats',      label: 'Stat Multipliers',   icon: 'bar_chart',     group: 'config' },
  { id: 'misc',       label: 'Miscellaneous',      icon: 'settings',      group: 'config' },
  { id: 'cluster',    label: 'Cluster',            icon: 'group_work',    group: 'config' },
  { id: 'ini-GameUserSettings', label: 'GameUserSettings.ini', icon: 'code', group: 'ini' },
  { id: 'ini-Game',   label: 'Game.ini',           icon: 'code',          group: 'ini' },
  { id: 'ini-Engine', label: 'Engine.ini',         icon: 'code',          group: 'ini' },
  { id: 'mods',       label: 'Mods',               icon: 'extension',     group: 'features' },
  { id: 'arkapi',     label: 'ArkApi',             icon: 'api',           group: 'features' },
  { id: 'whitelist',  label: 'Whitelist',          icon: 'people',        group: 'features' },
  { id: 'automation', label: 'Automation',         icon: 'schedule',      group: 'features' },
  { id: 'broadcasts', label: 'Broadcasts',         icon: 'campaign',      group: 'features' },
  { id: 'discord',    label: 'Discord',            icon: 'chat',          group: 'features' },
  { id: 'firewall',   label: 'Firewall',           icon: 'security',      group: 'features', linuxOnly: true },
  { id: 'backup',     label: 'Backup',             icon: 'backup',        group: 'features' }
];

export const DEFAULT_SERVER_TAB: ServerTabId = 'console';

/**
 * Shared state for navigating a server's pages from the sidebar.
 *
 * The tabs used to live inside the server page, so "which tab" and "expert mode" were plain
 * component fields. Now the sidebar renders them and the page reads them from the URL, so the
 * bits both sides need (expert mode, which tab was last open, whether Linux-only pages apply)
 * are held here where either can reach them without the two being coupled.
 */
@Injectable({ providedIn: 'root' })
export class ServerNavService {
  private readonly expertModeSubject = new BehaviorSubject<boolean>(false);
  private readonly isLinuxSubject = new BehaviorSubject<boolean>(false);
  private lastTabValue: ServerTabId = DEFAULT_SERVER_TAB;
  private platformChecked = false;

  constructor(private firewallService: FirewallService) {}

  get expertMode(): boolean {
    return this.expertModeSubject.value;
  }

  get expertMode$(): Observable<boolean> {
    return this.expertModeSubject.asObservable();
  }

  setExpertMode(enabled: boolean): void {
    if (this.expertModeSubject.value !== enabled) {
      this.expertModeSubject.next(enabled);
    }
  }

  get isLinux$(): Observable<boolean> {
    this.ensurePlatformChecked();
    return this.isLinuxSubject.asObservable();
  }

  get isLinux(): boolean {
    this.ensurePlatformChecked();
    return this.isLinuxSubject.value;
  }

  /** The tab most recently shown, so selecting another server lands on the same page. */
  get lastTab(): ServerTabId {
    return this.lastTabValue;
  }

  rememberTab(tab: ServerTabId): void {
    this.lastTabValue = tab;
  }

  isValidTab(value: string | null | undefined): value is ServerTabId {
    return !!value && SERVER_TABS.some(tab => tab.id === value);
  }

  find(id: ServerTabId): ServerTabDef | undefined {
    return SERVER_TABS.find(tab => tab.id === id);
  }

  isConfigTab(id: ServerTabId): boolean {
    const group = this.find(id)?.group;
    return group === 'config' || group === 'ini';
  }

  /**
   * Tabs to show for the current mode. Expert mode swaps the managed configuration pages for
   * the raw INI editors; Firewall only appears on Linux hosts.
   */
  visibleTabs(expertMode = this.expertMode, isLinux = this.isLinux): ServerTabDef[] {
    return SERVER_TABS.filter(tab => {
      if (tab.linuxOnly && !isLinux) return false;
      if (tab.group === 'config') return !expertMode;
      if (tab.group === 'ini') return expertMode;
      return true;
    });
  }

  private ensurePlatformChecked(): void {
    if (this.platformChecked) return;
    this.platformChecked = true;
    try {
      this.firewallService.checkFirewallStatus().subscribe({
        next: status => this.isLinuxSubject.next(status?.platform === 'linux'),
        error: () => this.isLinuxSubject.next(false)
      });
    } catch {
      this.isLinuxSubject.next(false);
    }
  }
}
