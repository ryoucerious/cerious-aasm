import {
  Component, EventEmitter, Input, Output, ChangeDetectionStrategy, HostListener, ElementRef,
  ViewChild, ChangeDetectorRef
} from '@angular/core';
import { NgIf, NgClass } from '@angular/common';
import { ServerInstance } from '../../core/models/server-instance.model';
import { SparklineComponent } from '../sparkline/sparkline.component';
import { getMapVisual, MapVisual } from '../../core/utils/map-visuals';
import { formatUptime, formatMegabytes, formatBytes, formatPercent } from '../../core/utils/format.utils';
import {
  serverStatusKey, serverStatusLabel, serverStatusClass,
  isOnlineStatus, isBusyStatus, canStartStatus
} from '../../core/utils/server-status';
import { fixedOrigin } from '../../core/utils/floating';

/** Display state for the pill on a card; derived from the backend's lowercase state. */
export interface CardStatus {
  label: string;
  cssClass: string;
}

/**
 * One server on the dashboard: map artwork, status, the four headline stats, a player
 * sparkline and the primary actions. Presentational — every decision is passed in and every
 * action is emitted, so the dashboard owns the data and the lifecycle calls.
 */
@Component({
  selector: 'app-server-card',
  standalone: true,
  imports: [NgIf, NgClass, SparklineComponent],
  templateUrl: './server-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServerCardComponent {
  @Input({ required: true }) server!: ServerInstance;
  @Input() history: number[] = [];
  @Input() now = Date.now();
  @Input() view: 'grid' | 'list' = 'grid';
  @Input() canDelete = true;
  @Input() hostMemoryTotalBytes: number | null = null;

  @Output() start = new EventEmitter<ServerInstance>();
  @Output() stop = new EventEmitter<ServerInstance>();
  @Output() forceStop = new EventEmitter<ServerInstance>();
  @Output() openConsole = new EventEmitter<ServerInstance>();
  @Output() configure = new EventEmitter<ServerInstance>();
  @Output() openBackups = new EventEmitter<ServerInstance>();
  @Output() remove = new EventEmitter<ServerInstance>();

  menuOpen = false;
  /** Where the actions menu sits, in viewport coordinates. */
  menuPosition = { left: 0, top: 0 };

  @ViewChild('menuAnchor') private menuAnchor?: ElementRef<HTMLElement>;
  @ViewChild('menu') private menu?: ElementRef<HTMLElement>;

  constructor(private host: ElementRef<HTMLElement>, private cdr: ChangeDetectorRef) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.menuOpen && !this.host.nativeElement.contains(event.target as Node)) {
      this.menuOpen = false;
    }
  }

  /**
   * The name players see in the server browser, shown only when it differs from the name
   * this app uses — otherwise it is the same word twice.
   */
  get sessionName(): string {
    const session = (this.server?.sessionName || '').trim();
    if (!session) return '';
    return session.toLowerCase() === (this.server?.name || '').trim().toLowerCase() ? '' : session;
  }

  get visual(): MapVisual {
    return getMapVisual(this.server?.mapName);
  }

  get stateKey(): string {
    return serverStatusKey(this.server?.state);
  }

  get isOnline(): boolean {
    return isOnlineStatus(this.server?.state);
  }

  get isBusy(): boolean {
    return isBusyStatus(this.server?.state);
  }

  get canStart(): boolean {
    return canStartStatus(this.server?.state);
  }

  get canDeleteNow(): boolean {
    return this.canDelete && this.stateKey === 'stopped';
  }

  get status(): CardStatus {
    return { label: serverStatusLabel(this.server?.state), cssClass: serverStatusClass(this.server?.state) };
  }

  get players(): string {
    return `${this.isOnline ? (this.server?.players ?? 0) : 0} / ${this.server?.maxPlayers ?? 70}`;
  }

  get uptime(): string {
    return this.isOnline ? formatUptime(this.server?.startedAt, this.now) : '--';
  }

  get cpu(): string {
    return this.isOnline ? formatPercent(this.server?.cpu) : '--';
  }

  get memory(): string {
    return this.isOnline ? formatMegabytes(this.server?.memory) : '--';
  }

  get memoryTotal(): string {
    return this.hostMemoryTotalBytes ? `/ ${formatBytes(this.hostMemoryTotalBytes, 0)}` : '';
  }

  get playerHistory(): number[] {
    return this.history?.length ? this.history : [];
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
    if (!this.menuOpen) return;

    this.positionMenu();
    // Again once it is on the page, when its height is known and it can be flipped.
    requestAnimationFrame(() => {
      this.positionMenu();
      this.cdr.detectChanges();
    });
  }

  /**
   * Place the menu against the viewport rather than the card.
   *
   * The card hides its overflow so the map artwork keeps the rounded corners, which also
   * cut the menu off at the card's edge — the first item was all that showed.
   */
  private positionMenu(): void {
    const anchor = this.menuAnchor?.nativeElement;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const size = this.menu?.nativeElement.getBoundingClientRect();
    const width = size?.width || 170;
    const height = size?.height || 0;
    const gap = 6;

    // Above the button when there is room, which is where it has always opened; below when
    // the card sits near the top of the screen.
    const above = rect.top - gap - height;
    // Relative to whatever a fixed child is positioned against, which is not the viewport
    // when something above the card carries a transform.
    const origin = fixedOrigin(anchor);

    this.menuPosition = {
      left: Math.max(gap, Math.min(rect.right - width, window.innerWidth - width - gap)) - origin.x,
      top: (above >= gap ? above : Math.min(rect.bottom + gap, window.innerHeight - height - gap)) - origin.y
    };
  }

  /** The card moves with the page, so the menu has to follow the button it belongs to. */
  @HostListener('window:resize')
  @HostListener('document:scroll')
  onViewportChange(): void {
    if (!this.menuOpen) return;
    this.positionMenu();
    this.cdr.markForCheck();
  }

  onPrimaryAction(event: Event): void {
    event.stopPropagation();
    if (this.isOnline) this.stop.emit(this.server);
    else if (this.canStart) this.start.emit(this.server);
  }

  onConsole(event: Event): void {
    event.stopPropagation();
    this.openConsole.emit(this.server);
  }

  onConfigure(): void {
    this.menuOpen = false;
    this.configure.emit(this.server);
  }

  onBackups(): void {
    this.menuOpen = false;
    this.openBackups.emit(this.server);
  }

  onForceStop(): void {
    this.menuOpen = false;
    this.forceStop.emit(this.server);
  }

  onRemove(): void {
    this.menuOpen = false;
    this.remove.emit(this.server);
  }
}
