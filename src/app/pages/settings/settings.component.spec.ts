import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsPageComponent } from './settings.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { UtilityService } from '../../core/services/utility.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockGlobalConfigService } from '../../../../test/mocks/mock-global-config.service';
import { MockServerInstanceService } from '../../../../test/mocks/mock-server-instance.service';
import { of } from 'rxjs';

describe('SettingsPageComponent', () => {
  let component: SettingsPageComponent;
  let fixture: ComponentFixture<SettingsPageComponent>;
  let mockUtility: jasmine.SpyObj<UtilityService>;
  let mockMessaging: MockMessagingService;

  beforeEach(async () => {
    mockUtility = jasmine.createSpyObj('UtilityService', ['getPlatform']);
    mockUtility.getPlatform.and.returnValue('Web');
    mockMessaging = new MockMessagingService();
    mockMessaging.receiveMessage = jasmine.createSpy('receiveMessage').and.returnValue(of(null));
    mockMessaging.sendMessage = jasmine.createSpy('sendMessage').and.returnValue(of(null));

    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent, FormsModule],
      providers: [
        { provide: MessagingService, useValue: mockMessaging },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: UtilityService, useValue: mockUtility },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should detect Web platform', () => {
    expect(component.isElectron).toBeFalse();
  });

  it('should detect Electron platform', () => {
    // Recreate with Electron
    mockUtility.getPlatform.and.returnValue('Electron');
    const electronFixture = TestBed.createComponent(SettingsPageComponent);
    const electronComponent = electronFixture.componentInstance;
    expect(electronComponent.isElectron).toBeTrue();
  });

  it('should build tabs without web-server tab in Web mode', () => {
    expect(component.tabs.find((t: any) => t.id === 'web-server')).toBeUndefined();
    expect(component.tabs.find((t: any) => t.id === 'general')).toBeTruthy();
    expect(component.tabs.find((t: any) => t.id === 'about')).toBeTruthy();
    expect(component.tabs.find((t: any) => t.id === 'server-installation')).toBeTruthy();
  });

  it('should set activeTab on selectTab()', () => {
    component.selectTab('general');
    expect(component.activeTab).toBe('general');
  });

  it('should return correct active tab label', () => {
    component.activeTab = 'about';
    expect(component.getActiveTabLabel()).toBe('About');
  });

  it('should return empty string for unknown tab', () => {
    component.activeTab = 'nonexistent';
    expect(component.getActiveTabLabel()).toBe('');
  });

  it('should return a build date string', () => {
    const result = component.getBuildDate();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return an app version', () => {
    const version = component.getAppVersion();
    expect(version).toBeTruthy();
  });

  it('should updateArkUpdateBadge correctly', () => {
    const notifService = TestBed.inject(NotificationService);
    spyOn(notifService, 'info');
    (component as any).updateArkUpdateBadge();
    expect(component.arkUpdateAvailable).toBeTrue();
    const tab = component.tabs.find((t: any) => t.id === 'server-installation');
    expect(tab?.showUpdateBadge).toBeTrue();
    expect(notifService.info).toHaveBeenCalled();
  });

  it('should clearArkUpdateBadge correctly', () => {
    component.arkUpdateAvailable = true;
    const tab = component.tabs.find((t: any) => t.id === 'server-installation');
    if (tab) tab.showUpdateBadge = true;
    (component as any).clearArkUpdateBadge();
    expect(component.arkUpdateAvailable).toBeFalse();
    expect(tab?.showUpdateBadge).toBeFalse();
  });

  it('should call messaging on onOpenConfigDirectory when Electron', () => {
    component.isElectron = true;
    component.onOpenConfigDirectory();
    (expect(mockMessaging.sendMessage) as any).toHaveBeenCalledWith('open-config-directory', {});
  });

  it('should not call messaging on onOpenConfigDirectory when Web', () => {
    component.isElectron = false;
    (mockMessaging.sendMessage as jasmine.Spy).calls.reset();
    component.onOpenConfigDirectory();
    (expect(mockMessaging.sendMessage) as any).not.toHaveBeenCalledWith('open-config-directory', {});
  });

  it('should getPlatform from backend when available', () => {
    component.backendPlatform = 'Linux';
    expect(component.getPlatform()).toBe('Linux');
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
    const notifService = TestBed.inject(NotificationService);
    spyOn(notifService, 'warning');
    component.sudoPassword = '   ';
    component.onSudoPasswordConfirm();
    expect(notifService.warning).toHaveBeenCalled();
  });

  it('should unsubscribe all subscriptions on destroy', () => {
    const sub1 = jasmine.createSpyObj('sub1', ['unsubscribe']);
    const sub2 = jasmine.createSpyObj('sub2', ['unsubscribe']);
    component.subscriptions = [sub1, sub2];
    component.ngOnDestroy();
    expect(sub1.unsubscribe).toHaveBeenCalled();
    expect(sub2.unsubscribe).toHaveBeenCalled();
  });
});
