import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NgIf, NgForOf } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { WebSocketService } from './core/services/web-socket.service';
import { IpcService } from './core/services/ipc.service';
import { ServerLifecycleService } from './core/services/server-lifecycle.service';
import { NotificationService } from './core/services/notification.service';
import { ThemeService } from './core/services/theme.service';
import { ActivityService } from './core/services/activity.service';
import { LiveServersService } from './core/services/live-servers.service';
import { ServerInstance } from './core/models/server-instance.model';
import { ConnectionLostComponent } from './components/connect-lost/connection-lost.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ModalComponent } from './components/modal/modal.component';
import { TopbarComponent } from './components/topbar/topbar.component';
import { SettingsPageComponent } from './pages/settings/settings.component';
import { TooltipHostComponent } from './components/tooltip/tooltip-host.component';

export type ExitAction = 'shutdown' | 'exit' | 'cancel';

/** How long the web UI waits for its first connection before showing "Connection Lost". */
const FIRST_CONNECT_GRACE_MS = 5000;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SidebarComponent, TopbarComponent, ConnectionLostComponent, NgIf, NgForOf, ModalComponent, SettingsPageComponent, TooltipHostComponent],
  templateUrl: './app.html'
})
export class App implements OnInit, OnDestroy {
  showExitModal = false;
  shuttingDown = false;
  runningServers: ServerInstance[] = [];
  selectedServer: ServerInstance | null = null;
  connectionLost = false;
  connecting = true;
  readonly isElectron: boolean;
  isLoginPage = false;
  isMobile = false;
  isMobileMenuOpen = false;
  private connectionSub: Subscription | null = null;
  private unauthorizedSub: Subscription | null = null;
  private stopListeningForClose: (() => void) | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | undefined;
  private everConnected = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private ws: WebSocketService,
    private ipc: IpcService,
    private serverLifecycle: ServerLifecycleService,
    private router: Router,
    // Eagerly instantiate NotificationService for global notifications
    _notification: NotificationService,
    // Eagerly instantiate ThemeService so the theme applies and keeps following the OS
    // even on screens that never inject it (e.g. the login page)
    _theme: ThemeService,
    // Eagerly instantiate the roster and activity feed so events are recorded from the
    // moment the app connects, not only while the dashboard is open
    _liveServers: LiveServersService,
    _activity: ActivityService
  ) {
    this.isElectron = ipc.isElectron;
    this.detectMobile();
    window.addEventListener('resize', this.onWindowResize);
  }

  ngOnInit(): void {
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.isLoginPage = event.url === '/login';
        this.cdr.detectChanges();
      }
    });
    this.isLoginPage = this.router.url === '/login';

    if (this.isElectron) {
      this.stopListeningForClose = this.ipc.on('app-close-request', () => this.onCloseRequested());
      return;
    }

    // The desktop app has no connection to lose; only the web UI shows these screens.
    this.connectTimeout = setTimeout(() => {
      if (!this.everConnected) {
        this.connecting = false;
        this.connectionLost = true;
        this.cdr.markForCheck();
      }
    }, FIRST_CONNECT_GRACE_MS);

    // A socket refused for want of a sign-in is not a lost connection: send the user to
    // the login page instead of leaving them on the "Connection Lost" screen.
    this.unauthorizedSub = this.ws.unauthorized$.subscribe(() => {
      clearTimeout(this.connectTimeout);
      this.connecting = false;
      this.connectionLost = false;
      this.cdr.markForCheck();
      this.router.navigate(['/login']);
    });

    this.connectionSub = this.ws.connected$.subscribe(connected => {
      if (connected) {
        if (!this.everConnected) {
          this.everConnected = true;
          this.connecting = false;
          clearTimeout(this.connectTimeout);
        }
        this.connectionLost = false;
      } else if (this.everConnected) {
        this.connectionLost = true;
      }
      this.cdr.markForCheck();
    });
  }

  /** The main process holds the window open until it gets an app-close-response. */
  async onExitModalClose(action: ExitAction): Promise<void> {
    if (!this.isElectron || this.shuttingDown) return;

    if (action === 'shutdown') {
      this.shuttingDown = true;
      await this.serverLifecycle.shutdownAllServers()
        .catch(error => console.error('[app] Stopping servers before exit failed:', error));
    }

    this.ipc.send('app-close-response', { action });
    this.showExitModal = false;
    this.shuttingDown = false;
  }

  ngOnDestroy(): void {
    this.connectionSub?.unsubscribe();
    this.unauthorizedSub?.unsubscribe();
    this.stopListeningForClose?.();
    clearTimeout(this.connectTimeout);
    window.removeEventListener('resize', this.onWindowResize);
  }

  onServerSelected(server: ServerInstance) {
    this.selectedServer = server;
    if (this.isMobile) {
      this.isMobileMenuOpen = false;
      this.cdr.detectChanges();
    }
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
    this.cdr.detectChanges();
  }

  closeMobileMenu(): void {
    if (this.isMobileMenuOpen) {
      this.isMobileMenuOpen = false;
      this.cdr.detectChanges();
    }
  }

  private onCloseRequested(): void {
    // Main repeats an unanswered request. During a shutdown the servers still stopping no longer
    // count as running, so answering again would let main exit while they save.
    if (this.shuttingDown || this.showExitModal) return;
    this.runningServers = this.serverLifecycle.runningServers();
    if (this.runningServers.length > 0) {
      this.showExitModal = true;
    } else {
      this.ipc.send('app-close-response', { action: 'exit' });
    }
  }

  private detectMobile(): void {
    this.isMobile = window.innerWidth <= 860;
  }

  private onWindowResize = (): void => {
    const wasMobile = this.isMobile;
    this.detectMobile();
    if (wasMobile && !this.isMobile) {
      this.isMobileMenuOpen = false;
    }
    this.cdr.detectChanges();
  };
}
