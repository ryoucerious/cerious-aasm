import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AutomationTabComponent } from './automation-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('AutomationTabComponent', () => {
  let component: AutomationTabComponent;
  let fixture: ComponentFixture<AutomationTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutomationTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(AutomationTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit saveAutoStartSettings', () => {
    spyOn(component.saveAutoStartSettings, 'emit');
    component.onSaveAutoStartSettings();
    expect(component.saveAutoStartSettings.emit).toHaveBeenCalled();
  });

  it('should emit saveCrashDetectionSettings', () => {
    spyOn(component.saveCrashDetectionSettings, 'emit');
    component.onSaveCrashDetectionSettings();
    expect(component.saveCrashDetectionSettings.emit).toHaveBeenCalled();
  });

  it('should emit saveScheduledRestartSettings', () => {
    spyOn(component.saveScheduledRestartSettings, 'emit');
    component.onSaveScheduledRestartSettings();
    expect(component.saveScheduledRestartSettings.emit).toHaveBeenCalled();
  });

  it('should emit validateField', () => {
    spyOn(component.validateField, 'emit');
    component.onValidateField('autoStart', true);
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'autoStart', value: true});
  });

  it('should emit restartDayToggle', () => {
    spyOn(component.restartDayToggle, 'emit');
    component.onRestartDayToggle(2, { target: { checked: true } });
    expect(component.restartDayToggle.emit).toHaveBeenCalledWith({dayIndex: 2, event: { target: { checked: true } }});
  });

  it('should emit restartFrequencySelect', () => {
    spyOn(component.restartFrequencySelect, 'emit');
    component.onRestartFrequencySelect('daily');
    expect(component.restartFrequencySelect.emit).toHaveBeenCalledWith('daily');
  });

  it('should emit toggleRestartFrequencyDropdown', () => {
    spyOn(component.toggleRestartFrequencyDropdown, 'emit');
    component.onToggleRestartFrequencyDropdown();
    expect(component.toggleRestartFrequencyDropdown.emit).toHaveBeenCalled();
  });

  it('should get auto start status', () => {
    component.serverInstance = { autoStartOnAppLaunch: true, autoStartOnBoot: false };
    expect(component.getAutoStartStatus()).toBe('App Launch');
    component.serverInstance = { autoStartOnAppLaunch: true, autoStartOnBoot: true };
    expect(component.getAutoStartStatus()).toBe('App Launch + Boot');
    component.serverInstance = { autoStartOnAppLaunch: false, autoStartOnBoot: true };
    expect(component.getAutoStartStatus()).toBe('System Boot');
    component.serverInstance = { autoStartOnAppLaunch: false, autoStartOnBoot: false };
    expect(component.getAutoStartStatus()).toBe('Disabled');
  });

  it('should get scheduled restart status', () => {
    component.serverInstance = { scheduledRestartEnabled: true, restartFrequency: 'daily', restartTime: '03:00', restartDays: [0, 1] };
    expect(component.getScheduledRestartStatus()).toContain('Daily');
    component.serverInstance.restartFrequency = 'weekly';
    expect(component.getScheduledRestartStatus()).toContain('Weekly');
    component.serverInstance.restartFrequency = 'custom';
    expect(component.getScheduledRestartStatus()).toContain('at');
    component.serverInstance.scheduledRestartEnabled = false;
    expect(component.getScheduledRestartStatus()).toBe('Disabled');
  });

  it('should get selected days text', () => {
    component.serverInstance = { restartDays: [0, 2, 4] };
    expect((component as any).getSelectedDaysText()).toContain('Sunday');
    component.serverInstance = { restartDays: [] };
    expect((component as any).getSelectedDaysText()).toBe('No days selected');
  });

  it('should check restart day selected', () => {
    component.serverInstance = { restartDays: [1, 3] };
    expect(component.isRestartDaySelected(1)).toBeTrue();
    expect(component.isRestartDaySelected(2)).toBeFalse();
  });

  it('should get restart frequency options and display name', () => {
    expect(component.getRestartFrequencyOptions().length).toBe(3);
    expect(component.getRestartFrequencyDisplayName('daily')).toBe('Daily');
    expect(component.getRestartFrequencyDisplayName('none')).toBe('No Restart');
    expect(component.getRestartFrequencyDisplayName('other')).toBe('other');
  });

  it('should return false for hasFieldError and hasFieldWarning', () => {
    expect(component.hasFieldError('autoStart')).toBeFalse();
    expect(component.hasFieldWarning('autoStart')).toBeFalse();
  });

  it('should return empty string for getFieldError and getFieldWarning', () => {
    expect(component.getFieldError('autoStart')).toBe('');
    expect(component.getFieldWarning('autoStart')).toBe('');
  });
});
