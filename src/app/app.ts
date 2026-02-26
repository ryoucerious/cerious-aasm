import { ServerInstanceService } from './core/services/server-instance.service';
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NgIf, NgForOf } from '@angular/common';
import { WebSocketService } from './core/services/web-socket.service';
import { ConnectionLostComponent } from './components/connect-lost/connection-lost.component';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { MessagingService } from './core/services/messaging/messaging.service';
import { NotificationService } from './core/services/notification.service';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ModalComponent } from './components/modal/modal.component';
import { ServerInstance } from './core/models/server-instance.model';
import { UtilityService } from './core/services/utility.service';
import { UpdateBannerComponent } from './components/update-banner/update-banner.component';

declare global {
  interface Window {
    require: any;
  }

}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SidebarComponent, ConnectionLostComponent, NgIf, NgForOf, ModalComponent, UpdateBannerComponent],
  templateUrl: './app.html'
})

export class App implements OnInit, OnDestroy {
  showExitModal = false;
  runningServers: ServerInstance[] = [];
  selectedServer: ServerInstance | null = null;
  connectionLost = false;
  connecting = true;
  isElectron = false;
  isWebMode = false;
  isLoginPage = false;
  isMobile = false;
  isMobileMenuOpen = false;
  private wsCheckInterval: any;
  private wsTimeout: any;
  private everConnected = false;

  constructor(
    private messaging: MessagingService,
    private cdr: ChangeDetectorRef,
    private ws: WebSocketService,
    private serverInstanceService: ServerInstanceService,
    private utility: UtilityService,
    private router: Router,
    // Eagerly instantiate NotificationService for global notifications
    _notification: NotificationService
  ) {
    this.detectMobile();
    this.setupResizeListener();
  }
  ngOnInit(): void {
    this.isElectron = !!(window as any).require;
    this.isWebMode = this.utility.getPlatform() === 'Web';
    
    // Track current route to determine if we're on login page
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.isLoginPage = event.url === '/login';
        this.cdr.detectChanges();
      }
    });
    
    // Set initial login page state
    this.isLoginPage = this.router.url === '/login';
  
    
    if (this.isElectron) {
      const electron = (window as any).require('electron');
      electron.ipcRenderer.on('app-close-request', async (_event: any) => {
        // Get running servers
        this.runningServers = await this.serverInstanceService.getInstancesOnce();
        if (this.runningServers.length > 0) {
          this.showExitModal = true;
          this.cdr.detectChanges();
        } else {
          electron.ipcRenderer.send('app-close-response', { action: 'exit' });
        }
      });
    } else {
      // Only show connection lost in browser (not Electron)
      this.wsTimeout = setTimeout(() => {
        if (!this.everConnected) {
          this.connecting = false;
          this.connectionLost = true;
          this.cdr.markForCheck();
        }
      }, 5000);
      this.wsCheckInterval = setInterval(() => {
        if (this.ws['isConnected']) {
          if (!this.everConnected) {
            this.everConnected = true;
            this.connecting = false;
            this.connectionLost = false;
            this.cdr.markForCheck();
            if (this.wsTimeout) clearTimeout(this.wsTimeout);
          } else if (this.connectionLost) {
            this.connectionLost = false;
            this.cdr.markForCheck();
          }
        } else {
          if (this.everConnected && !this.connectionLost) {
            this.connectionLost = true;
            this.cdr.markForCheck();
          }
        }
      }, 1000);
    }
  }
  onExitModalClose(action: 'shutdown' | 'exit' | 'cancel') {
    const electron = (window as any).require?.('electron');
    if (!electron) return;
    if (action === 'shutdown') {
      this.serverInstanceService.shutdownAllServers().then(() => {
        electron.ipcRenderer.send('app-close-response', { action: 'shutdown' });
        this.showExitModal = false;
        this.cdr.detectChanges();
      });
    } else if (action === 'exit') {
      electron.ipcRenderer.send('app-close-response', { action: 'exit' });
      this.showExitModal = false;
      this.cdr.detectChanges();
    } else {
      electron.ipcRenderer.send('app-close-response', { action: 'cancel' });
      this.showExitModal = false;
      this.cdr.detectChanges();
    }
  }



  ngOnDestroy(): void {
    if (this.wsCheckInterval) clearInterval(this.wsCheckInterval);
    if (this.wsTimeout) clearTimeout(this.wsTimeout);
    // Clean up resize listener
    window.removeEventListener('resize', this.onWindowResize);
  }

  onServerSelected(server: ServerInstance) {
    this.selectedServer = server;
    // Close mobile menu when selecting a server
    if (this.isMobile) {
      this.isMobileMenuOpen = false;
      this.cdr.detectChanges();
    }
  }

  // Mobile responsive methods
  private detectMobile(): void {
    this.isMobile = window.innerWidth <= 700;
  }

  private setupResizeListener(): void {
    this.onWindowResize = this.onWindowResize.bind(this);
    window.addEventListener('resize', this.onWindowResize);
  }

  private onWindowResize = (): void => {
    const wasMobile = this.isMobile;
    this.detectMobile();
    
    // If switching from mobile to desktop, close mobile menu
    if (wasMobile && !this.isMobile) {
      this.isMobileMenuOpen = false;
    }
    
    this.cdr.detectChanges();
  };

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

}
