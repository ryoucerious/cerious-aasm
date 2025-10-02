import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServerSettingsComponent } from './server-settings.component';
import { FirewallService } from '../../core/services/firewall.service';
import { NotificationService } from '../../core/services/notification.service';
import { UtilityService } from '../../core/services/utility.service';
import { StatMultiplierService } from '../../core/services/stat-multiplier.service';
import { ArkServerValidationService } from '../../core/services/ark-server-validation.service';
import { IpcService } from '../../core/services/ipc.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { ChangeDetectorRef } from '@angular/core';
import { of } from 'rxjs';

describe('ServerSettingsComponent', () => {
  let component: ServerSettingsComponent;
  let fixture: ComponentFixture<ServerSettingsComponent>;

  // Create mock services
  const mockFirewallService = { checkFirewallStatus: () => of(null) };
  const mockUtilityService = { getPlatform: () => 'Web' };
  const mockStatMultiplierService = { getStatMultiplier: () => 1, setStatMultiplier: () => {} };
  const mockValidationService = { validateField: () => ({ isValid: true }) };
  const mockIpcService = {};
  const mockChangeDetectorRef = { markForCheck: () => {}, detectChanges: () => {} };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServerSettingsComponent],
      providers: [
        { provide: FirewallService, useValue: mockFirewallService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: StatMultiplierService, useValue: mockStatMultiplierService },
        { provide: ArkServerValidationService, useValue: mockValidationService },
        { provide: IpcService, useValue: mockIpcService },
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: ChangeDetectorRef, useValue: mockChangeDetectorRef }
      ]
    }).compileComponents();

  fixture = TestBed.createComponent(ServerSettingsComponent);
  component = fixture.componentInstance;
  // Provide required @Input() values
  component.serverInstance = { gamePort: 7777, mapName: 'TheIsland', state: 'running', restartDays: [], scheduledRestartEnabled: false };
  component.generalFields = [{ key: 'mapName', options: [{ value: 'TheIsland', display: 'The Island' }] }];
  component.ratesFields = [];
  component.structuresFields = [];
  component.miscFields = [];
  component.modsFields = [];
  component.statList = ['Health', 'Stamina'];
  fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit toggleVisibility on onToggleVisibility()', () => {
    spyOn(component.toggleVisibility, 'emit');
    component.onToggleVisibility();
    expect(component.toggleVisibility.emit).toHaveBeenCalled();
  });

  it('should emit openDirectory on onOpenDirectory()', () => {
    spyOn(component.openDirectory, 'emit');
    const event = { stopPropagation: () => {} } as any;
    component.onOpenDirectory(event);
    expect(component.openDirectory.emit).toHaveBeenCalled();
  });

  it('should emit tabChanged on onTabChange()', () => {
    spyOn(component.tabChanged, 'emit');
    component.onTabChange('general');
    expect(component.tabChanged.emit).toHaveBeenCalledWith('general');
  });

  it('should emit backupTabClicked on onBackupTabClick()', () => {
    spyOn(component.backupTabClicked, 'emit');
    component.onBackupTabClick();
    expect(component.backupTabClicked.emit).toHaveBeenCalled();
  });

  it('should emit settingsChanged on onSaveSettings()', () => {
    spyOn(component.settingsChanged, 'emit');
    component.onSaveSettings();
    expect(component.settingsChanged.emit).toHaveBeenCalled();
  });

  // Add more tests for other outputs and logic as needed
    it('should emit backupTimeChange on onBackupTimeChange()', () => {
      spyOn(component.backupTimeChange, 'emit');
      const event = { target: { value: '12:00' } } as any;
      component.onBackupTimeChange(event);
      expect(component.backupTimeChange.emit).toHaveBeenCalledWith('12:00');
    });

    it('should emit backupDayOfWeekChange on onBackupDayOfWeekChange()', () => {
      spyOn(component.backupDayOfWeekChange, 'emit');
      const event = { target: { value: '2' } } as any;
      component.onBackupDayOfWeekChange(event);
      expect(component.backupDayOfWeekChange.emit).toHaveBeenCalledWith(2);
    });

    it('should emit maxBackupsToKeepChange on onMaxBackupsToKeepChange()', () => {
      spyOn(component.maxBackupsToKeepChange, 'emit');
      const event = { target: { value: '5' } } as any;
      component.onMaxBackupsToKeepChange(event);
      expect(component.maxBackupsToKeepChange.emit).toHaveBeenCalledWith(5);
    });

    it('should emit restoreBackup on onRestoreBackup()', () => {
      spyOn(component.restoreBackup, 'emit');
      const backup = { id: 1 };
      component.onRestoreBackup(backup);
      expect(component.restoreBackup.emit).toHaveBeenCalledWith(backup);
    });

    it('should emit downloadBackup on onDownloadBackup()', () => {
      spyOn(component.downloadBackup, 'emit');
      const backup = { id: 2 };
      component.onDownloadBackup(backup);
      expect(component.downloadBackup.emit).toHaveBeenCalledWith(backup);
    });

    it('should emit deleteBackup on onDeleteBackup()', () => {
      spyOn(component.deleteBackup, 'emit');
      const backup = { id: 3 };
      component.onDeleteBackup(backup);
      expect(component.deleteBackup.emit).toHaveBeenCalledWith(backup);
    });

    it('should track by backup id', () => {
      const backup = { id: 42 };
      expect(component.trackByBackupId(0, backup)).toBe(42);
      expect(component.trackByBackupId(1, null)).toBe(1);
    });

    it('should format file size correctly', () => {
      expect(component.formatFileSize(0)).toBe('0 Bytes');
      expect(component.formatFileSize(1024)).toBe('1 KB');
      expect(component.formatFileSize(1048576)).toBe('1 MB');
    });

    it('should format date correctly', () => {
      expect(component.getFormattedDate(null)).toBe('Unknown');
      const dateStr = '2023-01-01T12:00:00Z';
      expect(typeof component.getFormattedDate(dateStr)).toBe('string');
    });

    it('should get fields by category', () => {
      component.ratesFields = [
        { key: 'xpMultiplier' },
        { key: 'tamingSpeedMultiplier' },
        { key: 'harvestAmountMultiplier' },
        { key: 'playerCharacterFoodDrainMultiplier' },
        { key: 'dayCycleSpeedScale' }
      ];
      expect(component.getFieldsByCategory('experience').length).toBeGreaterThan(0);
      expect(component.getFieldsByCategory('taming').length).toBeGreaterThan(0);
      expect(component.getFieldsByCategory('harvesting').length).toBeGreaterThan(0);
      expect(component.getFieldsByCategory('stats').length).toBeGreaterThan(0);
      expect(component.getFieldsByCategory('world').length).toBeGreaterThan(0);
    });

    it('should emit automation-related outputs', () => {
      spyOn(component.saveAutomationSettings, 'emit');
      spyOn(component.saveAutoStartSettings, 'emit');
      spyOn(component.saveCrashDetectionSettings, 'emit');
      spyOn(component.saveScheduledRestartSettings, 'emit');
      component.onSaveAutomationSettings();
      expect(component.saveAutomationSettings.emit).toHaveBeenCalled();
      component.onSaveAutoStartSettings();
      expect(component.saveAutoStartSettings.emit).toHaveBeenCalled();
      component.onSaveCrashDetectionSettings();
      expect(component.saveCrashDetectionSettings.emit).toHaveBeenCalled();
      component.onSaveScheduledRestartSettings();
      expect(component.saveScheduledRestartSettings.emit).toHaveBeenCalled();
    });

    it('should handle restart day selection and toggling', () => {
      component.serverInstance.restartDays = [1, 2];
      expect(component.isRestartDaySelected(1)).toBeTrue();
      expect(component.isRestartDaySelected(0)).toBeFalse();
      const event = { target: { checked: true } };
      component.onRestartDayToggle(0, event);
      expect(component.serverInstance.restartDays.includes(0)).toBeTrue();
      event.target.checked = false;
      component.onRestartDayToggle(1, event);
      expect(component.serverInstance.restartDays.includes(1)).toBeFalse();
    });

    it('should get auto start status', () => {
      component.serverInstance.autoStartOnAppLaunch = true;
      component.serverInstance.autoStartOnBoot = false;
      expect(component.getAutoStartStatus()).toBe('App Launch');
      component.serverInstance.autoStartOnBoot = true;
      expect(component.getAutoStartStatus()).toBe('App Launch + Boot');
      component.serverInstance.autoStartOnAppLaunch = false;
      expect(component.getAutoStartStatus()).toBe('System Boot');
      component.serverInstance.autoStartOnBoot = false;
      expect(component.getAutoStartStatus()).toBe('Disabled');
    });

    it('should get scheduled restart status', () => {
      component.serverInstance.scheduledRestartEnabled = true;
      component.serverInstance.restartFrequency = 'daily';
      component.serverInstance.restartTime = '03:00';
      expect(component.getScheduledRestartStatus()).toContain('Daily');
      component.serverInstance.restartFrequency = 'weekly';
      component.serverInstance.restartDays = [0, 1];
      expect(component.getScheduledRestartStatus()).toContain('Weekly');
      component.serverInstance.restartFrequency = 'custom';
      expect(component.getScheduledRestartStatus()).toContain('at');
    });

    it('should validate fields and handle errors/warnings', () => {
    spyOn<any>(component, 'getFieldLabel').and.returnValue('Test Field');
    const validationService = TestBed.inject(ArkServerValidationService);
    const validateFieldSpy = spyOn(validationService, 'validateField');
    validateFieldSpy.and.returnValue({ isValid: false, error: 'Error', warning: 'Warning', field: 'testField' });
    component.serverInstance = {};
    component.fieldErrors = {};
    component.fieldWarnings = {};
    component.validateField('testField', 'value');
    expect(component.fieldErrors['testField']).toBe('Error');
    expect(component.fieldWarnings['testField']).toBe('Warning');
    validateFieldSpy.and.returnValue({ isValid: true, field: 'testField' });
    component.validateField('testField', 'value');
    expect(component.fieldErrors['testField']).toBeUndefined();
    expect(component.fieldWarnings['testField']).toBeUndefined();
    });

    it('should check for field error/warning', () => {
      component.fieldErrors = { testField: 'Error' };
      component.fieldWarnings = { testField: 'Warning' };
      expect(component.hasFieldError('testField')).toBeTrue();
      expect(component.getFieldError('testField')).toBe('Error');
      expect(component.hasFieldWarning('testField')).toBeTrue();
      expect(component.getFieldWarning('testField')).toBe('Warning');
    });

    it('should get field label from definitions', () => {
      component.generalFields = [{ key: 'testField', label: 'Test Label' }];
      expect(component['getFieldLabel']('testField')).toBe('Test Label');
      expect(component['getFieldLabel']('unknownField')).toBe('unknownField');
    });

    it('should call checkFirewallStatus()', () => {
      const firewallService = TestBed.inject(FirewallService);
      // Mock correct FirewallStatus object
    spyOn(firewallService, 'checkFirewallStatus').and.returnValue(of({ enabled: true, platform: 'linux', status: 'active' }));
      // Call via public method
      component['subscriptions'] = [];
      component.checkFirewallStatus();
      expect(firewallService.checkFirewallStatus).toHaveBeenCalled();
    });

    it('should call testClusterConnectivity()', () => {
      const messagingService = TestBed.inject(MessagingService);
      spyOn(messagingService, 'sendMessage').and.returnValue(of({ accessible: true }));
      component.serverInstance.clusterDirOverride = 'C:/cluster';
      // Use spies on NotificationService instance directly
      const notificationService = TestBed.inject(NotificationService);
      spyOn(notificationService, 'info');
      spyOn(notificationService, 'success');
      spyOn(notificationService, 'error');
      // Call via public method
      component.testClusterConnectivity();
      expect(messagingService.sendMessage).toHaveBeenCalled();
      expect(notificationService.info).toHaveBeenCalled();
      expect(notificationService.success).toHaveBeenCalled();
    });
  });
