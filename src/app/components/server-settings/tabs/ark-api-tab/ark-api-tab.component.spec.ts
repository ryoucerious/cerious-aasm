import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ArkApiTabComponent } from './ark-api-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { of, throwError } from 'rxjs';

describe('ArkApiTabComponent', () => {
  let component: ArkApiTabComponent;
  let fixture: ComponentFixture<ArkApiTabComponent>;
  let mockMessaging: MockMessagingService;
  let mockNotification: MockNotificationService;

  beforeEach(async () => {
    mockMessaging = new MockMessagingService();
    mockMessaging.sendMessage = jasmine.createSpy('sendMessage').and.returnValue(of({ plugins: [] }));
    mockNotification = new MockNotificationService();
    spyOn(mockNotification, 'success');
    spyOn(mockNotification, 'error');
    spyOn(mockNotification, 'info');

    await TestBed.configureTestingModule({
      imports: [ArkApiTabComponent],
      providers: [
        { provide: MessagingService, useValue: mockMessaging },
        { provide: NotificationService, useValue: mockNotification }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();
    fixture = TestBed.createComponent(ArkApiTabComponent);
    component = fixture.componentInstance;
    component.serverInstance = { id: 'test-server-1' };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load plugins on init', () => {
    (expect(mockMessaging.sendMessage) as any).toHaveBeenCalledWith('list-ark-api-plugins', { instanceId: 'test-server-1' });
  });

  it('should set plugins from response', () => {
    const plugins = [{ name: 'TestPlugin', version: '1.0', author: 'Me', description: '', folderName: 'test', hasPluginJson: true }];
    (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(of({ plugins }));
    component.loadPlugins();
    expect(component.plugins.length).toBe(1);
    expect(component.plugins[0].name).toBe('TestPlugin');
    expect(component.loading).toBeFalse();
  });

  it('should handle loadPlugins error', () => {
    (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(throwError(() => new Error('fail')));
    component.loadPlugins();
    expect(component.loading).toBeFalse();
    expect(mockNotification.error).toHaveBeenCalled();
  });

  it('should not load plugins when serverInstance has no id', () => {
    component.serverInstance = {};
    (mockMessaging.sendMessage as jasmine.Spy).calls.reset();
    component.loadPlugins();
    expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
  });

  it('should check latest AsaApi version', () => {
    (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(of({ success: true, version: '2.0', downloadUrl: 'http://dl' }));
    component.checkLatestAsaApi();
    expect(component.latestVersion).toBe('2.0');
    expect(component.latestDownloadUrl).toBe('http://dl');
    expect(component.checkingLatest).toBeFalse();
    expect(mockNotification.info).toHaveBeenCalled();
  });

  it('should handle checkLatestAsaApi failure response', () => {
    (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(of({ success: false, error: 'not found' }));
    component.checkLatestAsaApi();
    expect(mockNotification.error).toHaveBeenCalled();
    expect(component.checkingLatest).toBeFalse();
  });

  it('should handle checkLatestAsaApi network error', () => {
    (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(throwError(() => new Error('network')));
    component.checkLatestAsaApi();
    expect(component.checkingLatest).toBeFalse();
    expect(mockNotification.error).toHaveBeenCalled();
  });

  it('should install AsaApi and reload plugins on success', () => {
    component.latestDownloadUrl = 'http://dl';
    (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(of({ success: true }));
    component.installAsaApi();
    expect(component.installing).toBeFalse();
    expect(mockNotification.success).toHaveBeenCalled();
  });

  it('should not install AsaApi without download URL', () => {
    component.latestDownloadUrl = '';
    (mockMessaging.sendMessage as jasmine.Spy).calls.reset();
    component.installAsaApi();
    expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
  });

  it('should install plugin from URL', () => {
    component.pluginInstallUrl = 'http://plugin.zip';
    (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(of({ success: true }));
    component.installPluginFromUrl();
    expect(component.installingFromUrl).toBeFalse();
    expect(mockNotification.success).toHaveBeenCalled();
    expect(component.pluginInstallUrl).toBe('');
  });

  it('should not install plugin from empty URL', () => {
    component.pluginInstallUrl = '   ';
    (mockMessaging.sendMessage as jasmine.Spy).calls.reset();
    component.installPluginFromUrl();
    expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
  });

  it('should confirm remove and do remove', () => {
    const plugin = { name: 'P', version: '1', author: 'A', description: '', folderName: 'pfolder', hasPluginJson: true };
    component.confirmRemove(plugin);
    expect(component.showConfirmRemove).toBeTrue();
    expect(component.pluginToRemove).toBe(plugin);

    (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(of({ success: true }));
    component.doRemove();
    expect(component.showConfirmRemove).toBeFalse();
    expect(mockNotification.success).toHaveBeenCalled();
  });

  it('should not doRemove when pluginToRemove is null', () => {
    component.pluginToRemove = null;
    (mockMessaging.sendMessage as jasmine.Spy).calls.reset();
    component.doRemove();
    expect(mockMessaging.sendMessage).not.toHaveBeenCalled();
  });
});
