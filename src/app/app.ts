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
import { AuthService } from './core/services/auth.service';
import { ServerInstance } from './core/models/server-instance.model';
import { ConnectionLostComponent } from './components/connect-lost/connection-lost.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ModalComponent } from './components/modal/modal.component';
import { TopbarComponent } from './components/topbar/topbar.component';
import { SettingsPageComponent } from './pages/settings/settings.component';
import { TooltipHostComponent } from './components/tooltip/tooltip-host.component';
import { BusyOverlayComponent } from './components/busy-overlay/busy-overlay.component';
import { WindowControlsComponent } from './components/window-controls/window-controls.component';
import { BusyService } from './core/services/busy.service';

export type ExitAction = 'shutdown' | 'exit' | 'cancel';

/** How long the web UI waits for its first connection before showing "Connection Lost". */
const FIRST_CONNECT_GRACE_MS = 5000;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SidebarComponent, TopbarComponent, ConnectionLostComponent, NgIf, NgForOf, ModalComponent, SettingsPageComponent, TooltipHostComponent, BusyOverlayComponent, WindowControlsComponent],
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
  private identitySub: Subscription | null = null;
  /** The desktop app has heard who is signed in. */
  private identityKnown = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private ws: WebSocketService,
    private ipc: IpcService,
    private serverLifecycle: ServerLifecycleService,
    private router: Router,
    private auth: AuthService,
    /** While something is under way the app is inert behind the busy overlay. */
    readonly busy: BusyService,
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
      this.identitySub = this.auth.identity$.subscribe(() => {
        this.routeForMeshSignIn();
        this.cdr.markForCheck();
      });
      void this.auth.whenReady().then(() => {
        this.identityKnown = true;
        this.routeForMeshSignIn();
        this.cdr.detectChanges();
      });
      this.stopListeningForClose = this.ipc.on('app-close-request', (_event, request) => this.onCloseRequested(request));
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
      await this.serverLifecycle.shutdownServers(this.runningServers)
        .catch(error => console.error('[app] Stopping servers before exit failed:', error));
    }

    this.ipc.send('app-close-response', { action });
    this.showExitModal = false;
    this.shuttingDown = false;
  }

  ngOnDestroy(): void {
    this.connectionSub?.unsubscribe();
    this.unauthorizedSub?.unsubscribe();
    this.identitySub?.unsubscribe();
    this.stopListeningForClose?.();
    clearTimeout(this.connectTimeout);
    window.removeEventListener('resize', this.onWindowResize);
  }

  /**
   * The app itself, with its sidebar and settings, only once access is confirmed. The desktop
   * waits to hear who is signed in: on a mesh member that is nobody until a mesh account signs
   * in. The web UI waits for its socket, which the server opens only with a session it accepts.
   */
  get showApp(): boolean {
    if (this.isLoginPage) return false;
    if (this.isElectron) return this.identityKnown && !this.auth.needsMeshSignIn;
    return !this.connecting && !this.connectionLost;
  }

  /** Until then, a loading page and nothing else. */
  get showLoading(): boolean {
    if (this.isLoginPage) return false;
    return this.isElectron ? !this.showApp : this.connecting;
  }

  /** A joined mesh has no implicit desktop admin. Leave the shell until someone signs in. */
  private routeForMeshSignIn(): void {
    if (!this.auth.needsMeshSignIn || this.router.url.startsWith('/login')) return;
    void this.router.navigate(['/login']);
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

  /**
   * Main names the servers with a process on this machine. Only those are asked about and
   * stopped: in a mesh the roster lists every machine's servers, and quitting here must not stop
   * servers another machine runs.
   */
  private onCloseRequested(request?: unknown): void {
    // Main repeats an unanswered request. During a shutdown the servers still stopping no longer
    // count as running, so answering again would let main exit while they save.
    if (this.shuttingDown || this.showExitModal) return;
    const runningHere = (request as { runningHere?: unknown } | null | undefined)?.runningHere;
    const ids = Array.isArray(runningHere) ? runningHere.filter((id): id is string => typeof id === 'string') : [];
    this.runningServers = this.serverLifecycle.serversRunningHere(ids);
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
