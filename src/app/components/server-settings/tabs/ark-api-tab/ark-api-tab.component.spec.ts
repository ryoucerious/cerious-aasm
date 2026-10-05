import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ArkApiTabComponent, PluginInfo } from './ark-api-tab.component';
import { FILE_TRANSFER_TIMEOUT_MS, MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { Subject, of, throwError } from 'rxjs';

describe('ArkApiTabComponent', () => {
  let component: ArkApiTabComponent;
  let fixture: ComponentFixture<ArkApiTabComponent>;
  let sendMessage: jasmine.Spy;
  let mockNotification: MockNotificationService;

  const plugin = (folderName: string): PluginInfo =>
    ({ name: folderName, version: '1.0', author: 'Me', description: '', folderName, hasPluginJson: true });

  beforeEach(async () => {
    sendMessage = jasmine.createSpy('sendMessage').and.returnValue(of({ plugins: [] }));
    mockNotification = new MockNotificationService();
    spyOn(mockNotification, 'success');
    spyOn(mockNotification, 'error');
    spyOn(mockNotification, 'info');

    await TestBed.configureTestingModule({
      imports: [ArkApiTabComponent],
      providers: [
        { provide: MessagingService, useValue: { sendMessage } },
        { provide: NotificationService, useValue: mockNotification }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();
    fixture = TestBed.createComponent(ArkApiTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('serverInstance', { id: 'test-server-1' });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads the plugins and the AsaApi status for the server', () => {
    expect(sendMessage).toHaveBeenCalledWith('list-ark-api-plugins', { instanceId: 'test-server-1' });
    expect(sendMessage).toHaveBeenCalledWith('get-asaapi-status', { instanceId: 'test-server-1' });
  });

  it('should set plugins from response', () => {
    sendMessage.and.returnValue(of({ plugins: [plugin('test')] }));
    component.loadPlugins();
    expect(component.plugins.length).toBe(1);
    expect(component.plugins[0].name).toBe('test');
    expect(component.loading).toBeFalse();
  });

  it('should handle loadPlugins error', () => {
    sendMessage.and.returnValue(throwError(() => new Error('fail')));
    component.loadPlugins();
    expect(component.loading).toBeFalse();
    expect(mockNotification.error).toHaveBeenCalled();
  });

  it('should not load plugins when serverInstance has no id', () => {
    fixture.componentRef.setInput('serverInstance', {});
    sendMessage.calls.reset();
    component.loadPlugins();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  describe('when the user switches servers', () => {
    let replies: Record<string, Subject<unknown>>;

    beforeEach(() => {
      replies = {};
      sendMessage.and.callFake((channel: string, payload: { instanceId?: string }) =>
        replies[`${channel}:${payload.instanceId}`] = new Subject<unknown>());
      fixture.componentRef.setInput('serverInstance', { id: 'A' });
      fixture.detectChanges();
    });

    it('loads the new server\'s plugins and drops the old server\'s late reply', () => {
      component.confirmRemove(plugin('old'));
      fixture.componentRef.setInput('serverInstance', { id: 'B' });
      fixture.detectChanges();

      replies['list-ark-api-plugins:A'].next({ plugins: [plugin('old')] });
      replies['get-asaapi-status:A'].next({ installed: true });

      expect(component.plugins).toEqual([]);
      expect(component.asaApiInstalled).toBeNull();
      expect(component.showConfirmRemove).toBeFalse();
      expect(sendMessage).toHaveBeenCalledWith('list-ark-api-plugins', { instanceId: 'B' });
      expect(component.loading).toBeTrue();

      replies['list-ark-api-plugins:B'].next({ plugins: [plugin('new')] });
      replies['list-ark-api-plugins:B'].complete();
      expect(component.plugins.map(p => p.folderName)).toEqual(['new']);
      expect(component.loading).toBeFalse();
    });

    it('keeps its list when the same server arrives as a new object', () => {
      replies['list-ark-api-plugins:A'].next({ plugins: [plugin('kept')] });
      sendMessage.calls.reset();
      fixture.componentRef.setInput('serverInstance', { id: 'A' });
      fixture.detectChanges();
      expect(sendMessage).not.toHaveBeenCalled();
      expect(component.plugins.map(p => p.folderName)).toEqual(['kept']);
    });

    it('leaves installs started on the previous server out of the new one', () => {
      component.latestDownloadUrl = 'http://dl';
      component.pluginInstallUrl = 'http://plugin.zip';
      component.installAsaApi();
      component.installPluginFromUrl();
      expect(component.installing).toBeTrue();
      expect(component.installingFromUrl).toBeTrue();

      fixture.componentRef.setInput('serverInstance', { id: 'B' });
      fixture.detectChanges();
      expect(component.installing).toBeFalse();
      expect(component.installingFromUrl).toBeFalse();
      expect(component.installingFromZip).toBeFalse();

      sendMessage.calls.reset();
      replies['download-asaapi:A'].next({ success: true });
      replies['install-plugin-from-url:A'].next({ success: false, error: 'Bad zip' });
      expect(mockNotification.success).not.toHaveBeenCalled();
      expect(mockNotification.error).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  it('should check latest AsaApi version', () => {
    sendMessage.and.returnValue(of({ success: true, version: '2.0', downloadUrl: 'http://dl' }));
    component.checkLatestAsaApi();
    expect(component.latestVersion).toBe('2.0');
    expect(component.latestDownloadUrl).toBe('http://dl');
    expect(component.checkingLatest).toBeFalse();
    expect(mockNotification.info).toHaveBeenCalled();
  });

  it('should handle checkLatestAsaApi failure response', () => {
    sendMessage.and.returnValue(of({ success: false, error: 'not found' }));
    component.checkLatestAsaApi();
    expect(mockNotification.error).toHaveBeenCalled();
    expect(component.checkingLatest).toBeFalse();
  });

  it('should handle checkLatestAsaApi network error', () => {
    sendMessage.and.returnValue(throwError(() => new Error('network')));
    component.checkLatestAsaApi();
    expect(component.checkingLatest).toBeFalse();
    expect(mockNotification.error).toHaveBeenCalled();
  });

  it('should install AsaApi and reload plugins on success', () => {
    component.latestDownloadUrl = 'http://dl';
    sendMessage.and.returnValue(of({ success: true }));
    component.installAsaApi();
    expect(component.installing).toBeFalse();
    expect(mockNotification.success).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      'download-asaapi', { instanceId: 'test-server-1', downloadUrl: 'http://dl' }, { timeoutMs: FILE_TRANSFER_TIMEOUT_MS });
  });

  it('should not install AsaApi without download URL', () => {
    component.latestDownloadUrl = '';
    sendMessage.calls.reset();
    component.installAsaApi();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('should install plugin from URL', () => {
    component.pluginInstallUrl = 'http://plugin.zip';
    sendMessage.and.returnValue(of({ success: true }));
    component.installPluginFromUrl();
    expect(sendMessage).toHaveBeenCalledWith(
      'install-plugin-from-url', { instanceId: 'test-server-1', url: 'http://plugin.zip' }, { timeoutMs: FILE_TRANSFER_TIMEOUT_MS });
    expect(component.installingFromUrl).toBeFalse();
    expect(mockNotification.success).toHaveBeenCalled();
    expect(component.pluginInstallUrl).toBe('');
  });

  it('should not install plugin from empty URL', () => {
    component.pluginInstallUrl = '   ';
    sendMessage.calls.reset();
    component.installPluginFromUrl();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('should confirm remove and do remove', () => {
    sendMessage.and.returnValue(of({ plugins: [plugin('pfolder')] }));
    component.loadPlugins();
    component.confirmRemove(component.plugins[0]);
    expect(component.showConfirmRemove).toBeTrue();
    expect(component.pluginToRemove?.folderName).toBe('pfolder');

    sendMessage.and.returnValue(of({ success: true }));
    component.doRemove();
    expect(component.showConfirmRemove).toBeFalse();
    expect(sendMessage).toHaveBeenCalledWith('remove-ark-api-plugin', { instanceId: 'test-server-1', folderName: 'pfolder' });
    expect(mockNotification.success).toHaveBeenCalled();
  });

  it('removes only a plugin the current server lists', () => {
    sendMessage.and.returnValue(of({ plugins: [plugin('kept')] }));
    component.loadPlugins();
    component.confirmRemove(plugin('gone'));
    sendMessage.calls.reset();
    component.doRemove();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(component.showConfirmRemove).toBeFalse();
  });

  it('should not doRemove when pluginToRemove is null', () => {
    component.pluginToRemove = null;
    sendMessage.calls.reset();
    component.doRemove();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
