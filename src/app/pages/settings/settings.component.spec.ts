import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { SettingsPageComponent } from './settings.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { WebSocketService } from '../../core/services/web-socket.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { IpcService } from '../../core/services/ipc.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { ServerInstance } from '../../core/models/server-instance.model';
import { GlobalConfig } from '../../core/interfaces/global-config.interface';

describe('SettingsPageComponent', () => {
  let component: SettingsPageComponent;
  let fixture: ComponentFixture<SettingsPageComponent>;
  let messaging: { sendMessage: jasmine.Spy; receiveMessage: jasmine.Spy; sendNotification: jasmine.Spy };
  let channels: Record<string, Subject<unknown>>;
  let replies: Record<string, unknown>;
  let notification: jasmine.SpyObj<NotificationService>;
  let config: { config$: Subject<Partial<GlobalConfig>>; savedPorts: number[] };
  let connected$: BehaviorSubject<boolean>;
  let servers$: BehaviorSubject<ServerInstance[]>;
  let ipc: { isElectron: boolean; versions: { node: string; electron: string; chrome: string } | null };

  const sent = (channel: string) => messaging.sendMessage.calls.allArgs().filter(([name]) => name === channel);

  function create(): void {
    fixture = TestBed.createComponent(SettingsPageComponent);
    component = fixture.componentInstance;
  }

  beforeEach(async () => {
    channels = {};
    replies = {};
    messaging = {
      receiveMessage: jasmine.createSpy('receiveMessage').and.callFake((channel: string) => channels[channel] ??= new Subject<unknown>()),
      sendMessage: jasmine.createSpy('sendMessage').and.callFake((channel: string): Observable<unknown> =>
        replies[channel] instanceof Observable ? replies[channel] as Observable<unknown> : of(replies[channel] ?? null)),
      sendNotification: jasmine.createSpy('sendNotification')
    };
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error', 'warning', 'info']);
    config = { config$: new Subject<Partial<GlobalConfig>>(), savedPorts: [] };
    connected$ = new BehaviorSubject(false);
    Object.defineProperty(config, 'webServerPort', { set: (port: number) => config.savedPorts.push(port), get: () => 3000 });
    servers$ = new BehaviorSubject<ServerInstance[]>([]);
    ipc = { isElectron: false, versions: null };

    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent, FormsModule],
      providers: [
        { provide: MessagingService, useValue: messaging },
        { provide: NotificationService, useValue: notification },
        { provide: GlobalConfigService, useValue: config },
        { provide: WebSocketService, useValue: { connected$: connected$.asObservable() } },
        { provide: LiveServersService, useValue: { servers$: servers$.asObservable() } },
        { provide: IpcService, useValue: ipc }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    create();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should detect Web platform', () => {
    expect(component.isElectron).toBeFalse();
  });

  it('should detect Electron platform', () => {
    ipc.isElectron = true;
    create();
    expect(component.isElectron).toBeTrue();
  });

  it('should build tabs without web-server tab in Web mode', () => {
    // Sections say what they change; there is no catch-all "General".
    expect(component.tabs.find(t => t.id === 'web-server')).toBeUndefined();
    expect(component.tabs.find(t => (t.id as string) === 'general')).toBeUndefined();
    for (const id of ['server-installation', 'servers', 'updates', 'storage', 'users', 'appearance', 'about']) {
      expect(component.tabs.find(t => t.id === id)).toBeTruthy();
    }
  });

  it('groups the rail by area, keeping tab order', () => {
    expect(component.tabGroups.map(g => g.name)).toEqual(['Server', 'Access', 'Application']);
    expect(component.tabGroups[0].tabs.map(t => t.id))
      .toEqual(['server-installation', 'servers', 'updates', 'storage', 'clusters']);
  });

  it('should set activeTab on selectTab()', () => {
    component.selectTab('storage');
    expect(component.activeTab).toBe('storage');
  });

  it('should return correct active tab label', () => {
    component.activeTab = 'about';
    expect(component.activeTabLabel).toBe('About');
  });

  it('should return empty string for unknown tab', () => {
    component.activeTab = 'nonexistent';
    expect(component.activeTabLabel).toBe('');
  });

  it('should return an app version', () => {
    expect(component.getAppVersion()).toBeTruthy();
  });

  it('should updateArkUpdateBadge correctly', () => {
    (component as any).updateArkUpdateBadge();
    const tab = component.tabs.find(t => t.id === 'server-installation');
    expect(tab?.showUpdateBadge).toBeTrue();
    expect(notification.info).toHaveBeenCalled();
  });

  it('should clearArkUpdateBadge correctly', () => {
    const tab = component.tabs.find(t => t.id === 'server-installation');
    if (tab) tab.showUpdateBadge = true;
    (component as any).clearArkUpdateBadge();
    expect(tab?.showUpdateBadge).toBeFalse();
  });

  it('should call messaging on onOpenConfigDirectory when Electron', () => {
    ipc.isElectron = true;
    create();
    component.onOpenConfigDirectory();
    expect(messaging.sendMessage).toHaveBeenCalledWith('open-config-directory', {});
  });

  it('says so when the config directory cannot be opened', () => {
    spyOn(console, 'error');
    ipc.isElectron = true;
    create();
    replies['open-config-directory'] = throwError(() => new Error('Timeout has occurred'));

    component.onOpenConfigDirectory();

    expect(notification.error).toHaveBeenCalledWith('Could not open the config directory.', 'Settings');
  });

  it('says why the backend could not open the config directory', () => {
    ipc.isElectron = true;
    create();
    replies['open-config-directory'] = { success: false, error: 'Access is denied' };

    component.onOpenConfigDirectory();

    expect(notification.error).toHaveBeenCalledWith('Access is denied', 'Settings');
  });

  it('reports a refusal to open the config directory that gives no reason', () => {
    ipc.isElectron = true;
    create();
    replies['open-config-directory'] = { success: false };

    component.onOpenConfigDirectory();

    expect(notification.error).toHaveBeenCalledWith('Could not open the config directory.', 'Settings');
  });

  it('stays quiet when the config directory opens', () => {
    ipc.isElectron = true;
    create();
    replies['open-config-directory'] = { configDir: 'C:/config' };

    component.onOpenConfigDirectory();

    expect(notification.error).not.toHaveBeenCalled();
  });

  it('should not call messaging on onOpenConfigDirectory when Web', () => {
    component.onOpenConfigDirectory();
    expect(sent('open-config-directory')).toEqual([]);
  });

  it('should getPlatform from backend when available', () => {
    component.backendPlatform = 'Linux';
    expect(component.getPlatform()).toBe('Linux');
  });

  describe('system information in the desktop app', () => {
    beforeEach(() => {
      ipc.isElectron = true;
      ipc.versions = { node: '20.18.0', electron: '21.4.4', chrome: '106.0' };
      create();
    });

    it('prefers what the backend reports', () => {
      component.backendNodeVersion = '22.0.0';
      component.backendElectronVersion = '33.0.0';
      expect(component.getNodeVersion()).toBe('22.0.0');
      expect(component.getElectronVersion()).toBe('33.0.0');
    });

    it('falls back to the versions the preload bridge exposes', () => {
      expect(component.getNodeVersion()).toBe('20.18.0');
      expect(component.getElectronVersion()).toBe('21.4.4');
    });

    it('shows the config path only as the backend reports it', () => {
      expect(component.getConfigPath()).toBe('Unknown');
      component.backendConfigPath = 'C:\\Users\\me\\AppData\\Roaming\\Cerious AASM';
      expect(component.getConfigPath()).toBe('C:\\Users\\me\\AppData\\Roaming\\Cerious AASM');
    });
  });

  it('asks the folder picker to wait for the user, not for the default request timeout', () => {
    ipc.isElectron = true;
    create();
    replies['select-directory'] = { path: 'D:\\ARK' };
    component.selectServerDataDir();
    expect(sent('select-directory')).toEqual([['select-directory', { title: 'Select Server Data Directory' }, { timeoutMs: 10 * 60_000 }]]);
  });

  it('blocks installs while any server is running, starting, queued or stopping, going by the live roster', () => {
    fixture.detectChanges();
    servers$.next([{ id: 'a', name: 'A', state: 'queued' }]);
    expect(component.hasRunningServers).toBeTrue();
    servers$.next([{ id: 'a', name: 'A', state: 'stopped' }, { id: 'b', name: 'B', state: 'crashed' }]);
    expect(component.hasRunningServers).toBeFalse();
  });

  it('shows the settings once GlobalConfigService knows them, however late', () => {
    fixture.detectChanges();
    expect(component.autoUpdateArkServer).toBeFalse();

    config.config$.next({ webServerPort: 8080, autoUpdateArkServer: true, serverStartDelaySeconds: 30 });

    expect(component.webServerPort).toBe(8080);
    expect(component.autoUpdateArkServer).toBeTrue();
    expect(component.serverStartDelaySeconds).toBe(30);
  });

  it('does not ask for the settings itself, since GlobalConfigService loads them when the connection is up', () => {
    fixture.detectChanges();
    expect(sent('get-global-config')).toEqual([]);
  });

  it('keeps listening for updates before the settings are known', () => {
    fixture.detectChanges();

    channels['ark-update-status'].next({ hasUpdate: true });
    config.config$.next({ webServerPort: 8080 });

    expect(component.tabs.find(t => t.id === 'server-installation')?.showUpdateBadge).toBeTrue();
    expect(component.webServerPort).toBe(8080);
  });

  it('stops listening to settings changes once destroyed', () => {
    fixture.detectChanges();
    fixture.destroy();
    config.config$.next({ webServerPort: 8080 });
    expect(component.webServerPort).toBe(3000);
  });

  describe('backend system information', () => {
    const replyWith = (info: unknown) => { replies['get-system-info'] = info; };

    it('is not asked for in the web UI before the socket is up, since a refused session drops the request', () => {
      fixture.detectChanges();
      expect(sent('get-system-info')).toEqual([]);
    });

    it('is asked for when the socket comes up, and again on each reconnect', () => {
      replyWith({ platform: 'linux' });
      fixture.detectChanges();

      connected$.next(true);
      expect(sent('get-system-info').length).toBe(1);
      expect(component.backendPlatform).toBe('linux');

      connected$.next(false);
      connected$.next(true);
      expect(sent('get-system-info').length).toBe(2);
    });

    it('is asked for at once in the desktop app, which has no socket', () => {
      ipc.isElectron = true;
      create();
      replyWith({ nodeVersion: '22.0.0', configPath: 'C:/config' });

      fixture.detectChanges();

      expect(sent('get-system-info').length).toBe(1);
      expect(component.backendNodeVersion).toBe('22.0.0');
      expect(component.backendConfigPath).toBe('C:/config');
    });

    it('stops asking once destroyed', () => {
      fixture.detectChanges();
      fixture.destroy();

      connected$.next(true);

      expect(sent('get-system-info')).toEqual([]);
    });

    it('says so when the backend does not answer', () => {
      spyOn(console, 'error');
      replyWith(throwError(() => new Error('Timeout has occurred')));
      fixture.detectChanges();

      connected$.next(true);

      expect(console.error).toHaveBeenCalledWith('[settings] Could not get the system info:', new Error('Timeout has occurred'));
    });

  });

  describe('web server port', () => {
    let input: HTMLInputElement;

    beforeEach(async () => {
      ipc.isElectron = true;
      create();
      TestBed.inject(SettingsDrawerService).open('web-server');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      input = fixture.nativeElement.querySelector('input[type=number][min="1024"]');
    });

    function type(value: string): void {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    function commit(): void {
      input.dispatchEvent(new Event('change'));
    }

    it('is saved when the field is committed, not on each keystroke', () => {
      type('8');
      type('80');
      type('808');
      type('8080');
      expect(config.savedPorts).toEqual([]);

      commit();
      expect(config.savedPorts).toEqual([8080]);
      expect(component.webServerPort).toBe(8080);
    });

    it('must be between 1024 and 65535', () => {
      for (const port of ['80', '65536', '3000.5', '']) {
        type(port);
        commit();
        expect(input.value).toBe('3000');
      }
      expect(config.savedPorts).toEqual([]);
      expect(component.webServerPort).toBe(3000);
      expect(notification.warning).toHaveBeenCalled();
    });
  });

  describe('web server', () => {
    beforeEach(() => {
      ipc.isElectron = true;
      create();
    });

    it('reports a start the backend refused', () => {
      replies['start-web-server'] = { success: false, port: 3000, message: 'Port 3000 is in use' };
      component.onStartWebServer();
      expect(component.webServerRunning).toBeFalse();
      expect(notification.success).not.toHaveBeenCalled();
      expect(notification.error).toHaveBeenCalledWith('Port 3000 is in use', 'Web Server');
    });

    it('reports a start that worked', () => {
      replies['start-web-server'] = { success: true, port: 3000, message: 'Started' };
      component.onStartWebServer();
      expect(component.webServerRunning).toBeTrue();
      expect(notification.success).toHaveBeenCalled();
    });

    it('reports a stop the backend could not complete', () => {
      component.webServerRunning = true;
      replies['stop-web-server'] = { success: false, message: 'Error stopping web server: busy' };
      component.onStopWebServer();
      expect(component.webServerRunning).toBeTrue();
      expect(notification.error).toHaveBeenCalledWith('Error stopping web server: busy', 'Web Server');
    });

    it('asks for its status without waiting on a reply, since the status has no request id', () => {
      fixture.detectChanges();
      expect(messaging.sendNotification).toHaveBeenCalledWith('web-server-status', {});
      expect(sent('web-server-status')).toEqual([]);
    });
  });

  describe('installing the ARK server', () => {
    const pressEscape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    it('does not install when the requirements check fails', () => {
      replies['check-install-requirements'] = { success: false, error: 'steamcmd missing' };
      component.onInstallServer();
      expect(sent('install')).toEqual([]);
      expect(notification.error).toHaveBeenCalled();
    });

    describe('while an install is running', () => {
      beforeEach(() => {
        component.showInstallModal = true;
        component.installProgress = { percent: 40, step: 'Downloading', message: '' };
        fixture.detectChanges();
      });

      it('stays open and keeps installing when the dialog is dismissed', () => {
        pressEscape();
        const backdrop = document.querySelector('.modal-backdrop') as HTMLElement;
        backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(sent('cancel-install')).toEqual([]);
        expect(component.showInstallModal).toBeTrue();
      });

      it('cancels it from the Cancel Install button', () => {
        const buttons = Array.from(document.querySelectorAll('.modal .action-group-modal button')) as HTMLButtonElement[];
        buttons.find(button => button.textContent?.includes('Cancel Install'))!.click();

        expect(sent('cancel-install')).toEqual([['cancel-install', { target: 'server' }]]);
        expect(component.showInstallModal).toBeFalse();
      });
    });

    it('only closes the dialog once the install has finished or failed', () => {
      for (const progress of [{ success: true }, { failed: true }]) {
        component.showInstallModal = true;
        component.installProgress = { percent: 100, step: 'Done', message: '', ...progress };
        fixture.detectChanges();

        pressEscape();

        expect(component.showInstallModal).toBeFalse();
      }
      expect(sent('cancel-install')).toEqual([]);
    });

    it('shows a failed install request in the dialog', () => {
      spyOn(console, 'error');
      replies['install'] = throwError(() => new Error('Timeout has occurred'));

      component.onInstallServer();

      expect(component.showInstallModal).toBeTrue();
      expect(component.installProgress?.failed).toBeTrue();
      expect(component.installProgress?.message).toBe('Installation failed. Check server logs for details.');
      expect(notification.error).toHaveBeenCalledWith('Installation failed. Check server logs for details.', 'Installation Failed');
    });

    it('reloads the installation status once an install completes', () => {
      component.onInstallServer();
      messaging.sendMessage.calls.reset();

      channels['install'].next({ data: { step: 'Downloading', phase: 'download', overallPhase: 'Downloading', phasePercent: 40 } });
      expect(sent('get-ark-installation')).toEqual([]);

      channels['install'].next({ data: { step: 'done', phase: 'validation', overallPhase: 'Installation Complete' } });
      expect(component.installProgress?.success).toBeTrue();
      expect(sent('get-ark-installation')).toEqual([['get-ark-installation', {}]]);
    });

    it('should close install modal on onCloseInstall', () => {
      component.showInstallModal = true;
      component.onCloseInstall();
      expect(component.showInstallModal).toBeFalse();
    });

    it('should reset installProgress on onCancelInstall', () => {
      component.installProgress = { percent: 50, step: 'Downloading', message: 'In progress' };
      component.onCancelInstall();
      expect(component.installProgress).toBeNull();
      expect(component.showInstallModal).toBeFalse();
    });
  });

  it('should handle onSudoPasswordCancel', () => {
    component.showSudoPasswordModal = true;
    component.sudoPassword = 'secret';
    component.pendingInstallTarget = 'server';
    component.onSudoPasswordCancel();
    expect(component.showSudoPasswordModal).toBeFalse();
    expect(component.sudoPassword).toBe('');
    expect(component.pendingInstallTarget).toBe('');
  });

  it('should warn when sudo password is empty on confirm', () => {
    component.sudoPassword = '   ';
    component.onSudoPasswordConfirm();
    expect(notification.warning).toHaveBeenCalled();
  });
});
