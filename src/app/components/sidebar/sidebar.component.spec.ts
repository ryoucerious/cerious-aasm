import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { SidebarComponent } from './sidebar.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { InjectionToken } from '@angular/core';
import { TOAST_CONFIG, ToastrService } from 'ngx-toastr';
import { NotificationService } from '../../core/services/notification.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../test/mocks/mock-global-config.service';

describe('SidebarComponent', () => {
  it('should subscribe/unsubscribe in ngOnInit/ngOnDestroy', () => {
    const sub = { unsubscribe: jasmine.createSpy() };
    component['serversSub'] = sub as any;
    component['stateSub'] = sub as any;
    component.ngOnDestroy();
    expect(sub.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('should open add modal and focus input on onAddServerClick', (done) => {
    component.serverNameInput = { nativeElement: { focus: jasmine.createSpy() } } as any;
    component.onAddServerClick();
    expect(component.showAddModal).toBeTrue();
    setTimeout(() => {
      expect(component.serverNameInput.nativeElement.focus).toHaveBeenCalled();
      done();
    }, 10);
  });

  it('should clone server and select new instance', () => {
    spyOn(component.selectServer, 'emit');
    spyOn<any>(component, 'closeAdd');
    const notificationService = TestBed.inject(NotificationService);
    spyOn(notificationService, 'warning');
    (component as any).notificationService = notificationService;
    component.serverName = 'CloneServer';
    component.selectedServerToClone = { id: '2', name: 'ToClone' } as any;
    const serverInstanceService = TestBed.inject(ServerInstanceService);
    spyOn(serverInstanceService, 'setActiveServer');
    spyOn(serverInstanceService, 'save').and.returnValue(of({ instance: { id: '3', name: 'CloneServer' }, success: true }));
    (component as any).serverInstanceService = serverInstanceService;
    component['cloneServer']();
    expect(component.selectServer.emit).toHaveBeenCalledWith({ id: '3', name: 'CloneServer' });
    expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith({ id: '3', name: 'CloneServer' });
    expect(component['closeAdd']).toHaveBeenCalled();
  });

  it('should handle importFromBackup error', async () => {
    component.serverName = 'ImportServer';
    component.selectedBackupFile = null;
    spyOn(TestBed.inject(NotificationService), 'error');
    await component['importFromBackup']();
    expect(TestBed.inject(NotificationService).error).toHaveBeenCalled();
  });

  it('should handle fileToBase64', async () => {
    const file = new Blob(['test'], { type: 'application/zip' });
    const fakeFile = new File([file], 'test.zip');
    const result = await component['fileToBase64'](fakeFile);
    expect(typeof result).toBe('string');
  });

  it('should handle onLogoutClick success and error', async () => {
    component.isWebMode = true;
  spyOn(window, 'fetch').and.returnValue(Promise.resolve({ ok: true, status: 200, headers: {}, redirected: false, statusText: '', type: '', url: '', clone: () => {}, body: null, bodyUsed: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), blob: () => Promise.resolve(new Blob()), formData: () => Promise.resolve(new FormData()), json: () => Promise.resolve({}), text: () => Promise.resolve('') } as unknown as Response));
    const router = TestBed.inject(Router) as any;
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    (component as any).router = router;
    await component.onLogoutClick();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);

  (window.fetch as any).and.returnValue(Promise.resolve({ ok: false, status: 500, headers: {}, redirected: false, statusText: '', type: '', url: '', clone: () => {}, body: null, bodyUsed: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), blob: () => Promise.resolve(new Blob()), formData: () => Promise.resolve(new FormData()), json: () => Promise.resolve({}), text: () => Promise.resolve('') } as unknown as Response));
    spyOn(TestBed.inject(NotificationService), 'error');
    await component.onLogoutClick();
    expect(TestBed.inject(NotificationService).error).toHaveBeenCalled();
  });

  it('should handle getServerStatusIcon and getServerStatusClass edge cases', () => {
    expect(component.getServerStatusIcon({ state: 'error' } as any)).toBe('error');
    expect(component.getServerStatusClass({ state: 'error' } as any)).toBe('status-error');
    expect(component.getServerStatusIcon({ state: 'starting' } as any)).toBe('hourglass_empty');
    expect(component.getServerStatusClass({ state: 'starting' } as any)).toBe('status-starting');
    expect(component.getServerStatusIcon({ state: 'stopping' } as any)).toBe('pause_circle_filled');
    expect(component.getServerStatusClass({ state: 'stopping' } as any)).toBe('status-stopping');
    expect(component.getServerStatusIcon({ state: undefined } as any)).toBe('stop_circle');
    expect(component.getServerStatusClass({ state: undefined } as any)).toBe('status-unknown');
  });
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;

  // Mock MessageTransport token (Angular DI)
  const mockMessageTransport = {};
  // Mock MessagingService
  const mockMessagingService = { receiveMessage: () => ({ subscribe: () => {} }) };
  // Mock ServerInstanceService
  const mockServerInstanceService = { getInstances: () => ({ subscribe: () => {} }), messaging: mockMessagingService, setActiveServer: () => {}, save: () => ({ pipe: () => ({ subscribe: () => {} }) }), getDefaultInstanceFromMeta: () => ({ pipe: () => ({ subscribe: () => {} }) }), importServerFromBackup: () => ({ pipe: () => ({ subscribe: () => {} }) }), delete: () => ({ pipe: () => ({ subscribe: () => {} }) }) };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarComponent, HttpClientTestingModule],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: 'MessageTransport', useValue: mockMessageTransport },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: TOAST_CONFIG, useValue: { iconClasses: {} } },
        { provide: ToastrService, useValue: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit selectServer and closeMobileMenu on server click', () => {
    spyOn(component.selectServer, 'emit');
    spyOn(component.closeMobileMenu, 'emit');
    const server = { id: '1', name: 'Test', state: 'stopped' };
    component.onServerClick(server as any);
    expect(component.selectServer.emit).toHaveBeenCalledWith(server);
    expect(component.closeMobileMenu.emit).toHaveBeenCalled();
  });

  it('should not allow editing server name if busy', () => {
    const server = { id: '1', name: 'Test', state: 'running' };
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onServerNameDoubleClick(server as any, event);
    expect(component.editingServerId).toBeNull();
  });

  it('should allow editing server name if not busy', () => {
    const server = { id: '1', name: 'Test', state: 'stopped' };
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onServerNameDoubleClick(server as any, event);
    expect(component.editingServerId).toBe('1');
    expect(component.editingServerName).toBe('Test');
  });

  it('should save server name on Enter key', () => {
    const server = { id: '1', name: 'Test', state: 'stopped' };
    component.editingServerName = 'NewName';
    spyOn<any>(component, 'saveServerName');
    const event = { key: 'Enter' } as any;
    component.onServerNameKeydown(event, server as any);
    expect(component['saveServerName']).toHaveBeenCalledWith(server);
  });

  it('should cancel server name edit on Escape key', () => {
    spyOn<any>(component, 'cancelServerNameEdit');
    const server = { id: '1', name: 'Test', state: 'stopped' };
    const event = { key: 'Escape' } as any;
    component.onServerNameKeydown(event, server as any);
    expect(component['cancelServerNameEdit']).toHaveBeenCalled();
  });

  it('should save server name on blur', () => {
    spyOn<any>(component, 'saveServerName');
    const server = { id: '1', name: 'Test', state: 'stopped' };
    component.onServerNameBlur(server as any);
    expect(component['saveServerName']).toHaveBeenCalledWith(server);
  });

  it('should not save empty or unchanged server name', () => {
    const server = { id: '1', name: 'Test', state: 'stopped' };
    component.editingServerName = '';
    spyOn<any>(component, 'cancelServerNameEdit');
    component['saveServerName'](server as any);
    expect(component['cancelServerNameEdit']).toHaveBeenCalled();
    component.editingServerName = 'Test';
    component['saveServerName'](server as any);
    expect(component['cancelServerNameEdit']).toHaveBeenCalled();
  });

  it('should set import mode and reset fields', () => {
    component.serverName = 'abc';
    component.selectedBackupFile = {} as File;
    component.selectedBackupFilePath = 'path';
    component.selectedServerToClone = { id: '2' } as any;
    component.setImportMode('import');
    expect(component.serverName).toBe('');
    expect(component.selectedBackupFile).toBeNull();
    expect(component.selectedBackupFilePath).toBe('');
    expect(component.selectedServerToClone).toBeNull();
  });

  it('should select backup file and set path', () => {
    component.backupFileInput = { nativeElement: { click: jasmine.createSpy() } } as any;
    component.selectBackupFile();
    expect(component.backupFileInput.nativeElement.click).toHaveBeenCalled();
  });

  it('should return correct canAddServer for each mode', () => {
    component.importMode = 'create';
    component.serverName = 'abc';
    expect(component.canAddServer()).toBeTrue();
    component.importMode = 'import';
    component.serverName = 'abc';
    component.selectedBackupFile = {} as File;
    expect(component.canAddServer()).toBeTrue();
    component.importMode = 'clone';
    component.serverName = 'abc';
    component.selectedServerToClone = { id: '2' } as any;
    expect(component.canAddServer()).toBeTrue();
  });

  it('should get server status icon and class', () => {
    const server = { state: 'running' } as any;
    expect(component.getServerStatusIcon(server)).toBe('play_circle_filled');
    expect(component.getServerStatusClass(server)).toBe('status-running');
    expect(component.getServerStatusIcon({ state: 'unknown' } as any)).toBe('stop_circle');
    expect(component.getServerStatusClass({ state: 'unknown' } as any)).toBe('status-unknown');
  });

  it('should track by server id', () => {
    const server = { id: '123' } as any;
    expect(component.trackByServerId(0, server)).toBe('123');
  });

  it('should emit closeMobileMenu on settings click', () => {
    spyOn(component.closeMobileMenu, 'emit');
  const router = TestBed.inject(Router) as any;
  spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
  (component as any).router = router;
  component.onSettingsClick();
  expect(router.navigate).toHaveBeenCalledWith(['/settings']);
  expect(component.closeMobileMenu.emit).toHaveBeenCalled();
  });

  it('should emit closeAdd on cancel add', () => {
    spyOn<any>(component, 'closeAdd');
    component.onCancelAdd();
    expect(component['closeAdd']).toHaveBeenCalled();
  });

  it('should emit selectServer and setActiveServer on createNewServer', () => {
    spyOn(component.selectServer, 'emit');
    spyOn<any>(component, 'closeAdd');
    const notificationService = TestBed.inject(NotificationService);
    spyOn(notificationService, 'warning');
    (component as any).notificationService = notificationService;
    component.serverName = 'TestServer';
    const serverInstanceService = TestBed.inject(ServerInstanceService);
  spyOn(serverInstanceService, 'setActiveServer');
  spyOn(serverInstanceService, 'getDefaultInstanceFromMeta').and.returnValue(of({}));
  spyOn(serverInstanceService, 'save').and.returnValue(of({ instance: { id: '1', name: 'TestServer' }, success: true }));
  (component as any).serverInstanceService = serverInstanceService;
  component['createNewServer']();
  expect(component.selectServer.emit).toHaveBeenCalledWith({ id: '1', name: 'TestServer' });
  expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith({ id: '1', name: 'TestServer' });
  expect(component['closeAdd']).toHaveBeenCalled();
  });

  it('should not delete server if not stopped', () => {
    const notificationService = TestBed.inject(NotificationService);
    spyOn(notificationService, 'warning');
    (component as any).notificationService = notificationService;
    const server = { id: '1', state: 'running' } as any;
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onDeleteServer(server, event);
    expect(notificationService.warning).toHaveBeenCalled();
    expect(component.showConfirmDeleteModal).toBeFalse();
  });

  it('should show confirm delete modal if server is stopped', () => {
    const server = { id: '1', state: 'stopped' } as any;
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onDeleteServer(server, event);
    expect(component.serverToDelete).toBe(server);
    expect(component.showConfirmDeleteModal).toBeTrue();
  });

  it('should cancel delete', () => {
    component.serverToDelete = { id: '1' } as any;
    component.showConfirmDeleteModal = true;
    component.onCancelDelete();
    expect(component.serverToDelete).toBeNull();
    expect(component.showConfirmDeleteModal).toBeFalse();
  });

  it('should not confirm delete if only one server', () => {
    spyOn<any>(component, 'onCancelDelete');
    component.servers = [{ id: '1', state: 'stopped' } as any];
    component.serverToDelete = { id: '1', state: 'stopped' } as any;
    component.onConfirmDelete();
    expect(component['onCancelDelete']).toHaveBeenCalled();
  });

  it('should not confirm delete if server not stopped', () => {
    const notificationService = TestBed.inject(NotificationService);
    spyOn(notificationService, 'error');
    (component as any).notificationService = notificationService;
    spyOn<any>(component, 'onCancelDelete');
    component.servers = [{ id: '1', state: 'running' } as any, { id: '2', state: 'stopped' } as any];
    component.serverToDelete = { id: '1', state: 'running' } as any;
    component.onConfirmDelete();
    expect(notificationService.error).toHaveBeenCalled();
    expect(component['onCancelDelete']).toHaveBeenCalled();
  });

  it('should confirm delete if server stopped and more than one server', () => {
    component.servers = [{ id: '1', state: 'stopped' } as any, { id: '2', state: 'stopped' } as any];
    component.serverToDelete = { id: '1', state: 'stopped' } as any;
    const serverInstanceService = TestBed.inject(ServerInstanceService);
  spyOn(serverInstanceService, 'delete').and.returnValue(of({}));
  (component as any).serverInstanceService = serverInstanceService;
  component.onConfirmDelete();
  expect(component.serverToDelete).toBeNull();
  expect(component.showConfirmDeleteModal).toBeFalse();
  });
});
