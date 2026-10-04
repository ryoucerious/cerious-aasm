import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AutomationTabComponent } from './automation-tab.component';

describe('AutomationTabComponent', () => {
  let component: AutomationTabComponent;
  let fixture: ComponentFixture<AutomationTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutomationTabComponent]
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

  it('emits the toggled restart day and whether it is now selected', () => {
    spyOn(component.restartDayToggle, 'emit');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    component.onRestartDayToggle(2, { target: checkbox } as unknown as Event);
    expect(component.restartDayToggle.emit).toHaveBeenCalledWith({ dayIndex: 2, checked: true });
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

  it('lists the restart days in week order without reordering the saved ones', () => {
    const restartDays = [3, 1];
    component.serverInstance = { scheduledRestartEnabled: true, restartFrequency: 'weekly', restartTime: '03:00', restartDays };
    expect(component.getScheduledRestartStatus()).toBe('Weekly Monday, Wednesday at 03:00');
    expect(restartDays).toEqual([3, 1]);
  });

  it('says so when no restart day is selected', () => {
    component.serverInstance = { scheduledRestartEnabled: true, restartFrequency: 'weekly', restartTime: '03:00', restartDays: [] };
    expect(component.getScheduledRestartStatus()).toBe('Weekly No days selected at 03:00');
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

  it('shows validation messages for its fields', () => {
    component.serverInstance = { crashDetectionEnabled: true };
    component.fieldErrors = { crashDetectionInterval: 'Crash detection interval must be between 30 and 300 seconds' };
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.validation-error')?.textContent)
      .toContain('Crash detection interval must be between 30 and 300 seconds');
  });
});
