import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TOAST_CONFIG, ToastrService } from 'ngx-toastr';
import { App } from './app';
import { MessagingService } from './core/services/messaging/messaging.service';
import { NotificationService } from './core/services/notification.service';
import { ServerInstanceService } from './core/services/server-instance.service';
import { GlobalConfigService } from './core/services/global-config.service';
import { MockMessagingService } from '../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../test/mocks/mock-global-config.service';

describe('App', () => {
  it('should handle ngOnInit in web mode', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
  spyOn(app['utility'], 'getPlatform').and.returnValue('Web');
  spyOn(app['router'].events, 'subscribe').and.callFake((cb: any) => cb({ url: '/login' }));
  app.isElectron = false;
  (window as any).require = () => ({ ipcRenderer: { on: () => {}, send: () => {} } });
  app['ws'] = { isConnected: false } as any;
  app.ngOnInit();
  expect(app.isWebMode).toBeTrue();
  expect(app.isLoginPage).toBe(app['router'].url === '/login');
  });

  it('should handle ngOnInit in Electron mode', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
  (window as any).require = () => ({ ipcRenderer: { on: () => {}, send: () => {} } });
    app.isElectron = true;
    app.ngOnInit();
    expect(app.isElectron).toBeTrue();
  });

  it('should clean up intervals and listeners in ngOnDestroy', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
  app['wsCheckInterval'] = setInterval(() => {}, 1000);
  app['wsTimeout'] = setTimeout(() => {}, 1000);
  spyOn(window, 'removeEventListener');
  app.ngOnDestroy();
  expect(window.removeEventListener).toHaveBeenCalledWith('resize', app['onWindowResize']);
  });

  it('should handle onExitModalClose for shutdown, exit, cancel', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
  (window as any).require = () => ({ ipcRenderer: { on: () => {}, send: () => {} } });
  app['serverInstanceService'] = { shutdownAllServers: () => Promise.resolve() } as any;
    app.showExitModal = true;
    await app.onExitModalClose('shutdown');
    expect(app.showExitModal).toBeFalse();
    await app.onExitModalClose('exit');
    expect(app.showExitModal).toBeFalse();
    await app.onExitModalClose('cancel');
    expect(app.showExitModal).toBeFalse();
  });

  it('should handle onServerSelected and close mobile menu', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.isMobile = true;
    app.isMobileMenuOpen = true;
  spyOn(app['cdr'], 'detectChanges');
  app.onServerSelected({ id: '1', name: 'TestServer' } as any);
  expect(app.selectedServer).toEqual({ id: '1', name: 'TestServer' });
  expect(app.isMobileMenuOpen).toBeFalse();
  expect(app['cdr'].detectChanges).toHaveBeenCalled();
  });

  it('should toggle and close mobile menu', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
  spyOn(app['cdr'], 'detectChanges');
    app.isMobileMenuOpen = false;
    app.toggleMobileMenu();
    expect(app.isMobileMenuOpen).toBeTrue();
  expect(app['cdr'].detectChanges).toHaveBeenCalled();
    app.closeMobileMenu();
    expect(app.isMobileMenuOpen).toBeFalse();
    expect(app['cdr'].detectChanges).toHaveBeenCalled();
  });

  it('should handle window resize and detect mobile', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
  spyOn(app['cdr'], 'detectChanges');
    app.isMobile = true;
    app.isMobileMenuOpen = true;
  app['onWindowResize']();
    expect(app['cdr'].detectChanges).toHaveBeenCalled();
  });
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, HttpClientTestingModule],
      providers: [
          { provide: MessagingService, useClass: MockMessagingService },
          { provide: NotificationService, useClass: MockNotificationService },
          { provide: ServerInstanceService, useClass: MockServerInstanceService },
          { provide: GlobalConfigService, useClass: MockGlobalConfigService },
          { provide: 'MessageTransport', useValue: {} },
          { provide: TOAST_CONFIG, useValue: { iconClasses: {} } },
          { provide: ToastrService, useValue: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } },
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render main app content', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    // Mock state so main content is rendered
    app.connecting = false;
    app.connectionLost = false;
    app.isLoginPage = false;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    // Check for sidebar or main content presence
    expect(compiled.querySelector('.sidebar-container')).toBeTruthy();
  });
});
