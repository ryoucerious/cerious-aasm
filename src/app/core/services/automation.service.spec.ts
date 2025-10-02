import { AutomationService } from './automation.service';
import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';

// Mock dependencies if any
class MockDependencyService {
  // Add stubs for any methods used by AutomationService
}

describe('AutomationService', () => {
  let service: AutomationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: 'MessageTransport', useValue: {} },
        AutomationService,
        // { provide: DependencyService, useClass: MockDependencyService }, // Add real dependencies here
      ]
    });
    service = TestBed.inject(AutomationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should call messaging.sendMessage for configureAutoStart', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('ok')) };
    service = new AutomationService(messaging as any);
    const result = service.configureAutoStart('id', { autoStartOnAppLaunch: true, autoStartOnBoot: false });
    expect(messaging.sendMessage).toHaveBeenCalledWith('configure-autostart', { serverId: 'id', autoStartOnAppLaunch: true, autoStartOnBoot: false });
    result.subscribe(val => expect(val).toBe('ok'));
  });

  it('should call messaging.sendMessage for configureCrashDetection', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('ok')) };
    service = new AutomationService(messaging as any);
    const result = service.configureCrashDetection('id', { enabled: true, checkInterval: 60, maxRestartAttempts: 3 });
    expect(messaging.sendMessage).toHaveBeenCalledWith('configure-crash-detection', { serverId: 'id', enabled: true, checkInterval: 60, maxRestartAttempts: 3 });
    result.subscribe(val => expect(val).toBe('ok'));
  });

  it('should call messaging.sendMessage for configureScheduledRestart', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('ok')) };
    service = new AutomationService(messaging as any);
    const result = service.configureScheduledRestart('id', { enabled: true, frequency: 'daily', time: '02:00', days: [1], warningMinutes: 5 });
    expect(messaging.sendMessage).toHaveBeenCalledWith('configure-scheduled-restart', { serverId: 'id', enabled: true, frequency: 'daily', time: '02:00', days: [1], warningMinutes: 5 });
    result.subscribe(val => expect(val).toBe('ok'));
  });

  it('should call messaging.sendMessage for getAutomationStatus', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('status')) };
    service = new AutomationService(messaging as any);
    const result = service.getAutomationStatus('id');
    expect(messaging.sendMessage).toHaveBeenCalledWith('get-automation-status', { serverId: 'id' });
    result.subscribe(val => expect(val).toBe('status'));
  });

  it('should call messaging.sendMessage for startCrashDetection', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('started')) };
    service = new AutomationService(messaging as any);
    const result = service.startCrashDetection('id');
    expect(messaging.sendMessage).toHaveBeenCalledWith('start-crash-detection', { serverId: 'id' });
    result.subscribe(val => expect(val).toBe('started'));
  });

  it('should call messaging.sendMessage for stopCrashDetection', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('stopped')) };
    service = new AutomationService(messaging as any);
    const result = service.stopCrashDetection('id');
    expect(messaging.sendMessage).toHaveBeenCalledWith('stop-crash-detection', { serverId: 'id' });
    result.subscribe(val => expect(val).toBe('stopped'));
  });

  it('should call messaging.sendMessage for toggleScheduledRestart', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('toggled')) };
    service = new AutomationService(messaging as any);
    const result = service.toggleScheduledRestart('id', true);
    expect(messaging.sendMessage).toHaveBeenCalledWith('toggle-scheduled-restart', { serverId: 'id', enabled: true });
    result.subscribe(val => expect(val).toBe('toggled'));
  });

  it('should call messaging.sendMessage for triggerScheduledRestart', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('triggered')) };
    service = new AutomationService(messaging as any);
    const result = service.triggerScheduledRestart('id', 10);
    expect(messaging.sendMessage).toHaveBeenCalledWith('trigger-scheduled-restart', { serverId: 'id', warningMinutes: 10 });
    result.subscribe(val => expect(val).toBe('triggered'));
  });

  it('should call messaging.sendMessage for getAutomationLogs', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of(['log'])) };
    service = new AutomationService(messaging as any);
    const result = service.getAutomationLogs('id', 50);
    expect(messaging.sendMessage).toHaveBeenCalledWith('get-automation-logs', { serverId: 'id', limit: 50 });
    result.subscribe(val => expect(val).toEqual(['log']));
  });

  it('should call messaging.sendMessage for autoStartOnAppLaunch', () => {
    const messaging = { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of('auto')) };
    service = new AutomationService(messaging as any);
    const result = service.autoStartOnAppLaunch();
    expect(messaging.sendMessage).toHaveBeenCalledWith('auto-start-on-app-launch', {});
    result.subscribe(val => expect(val).toBe('auto'));
  });

  it('should validate automation settings and return errors for invalid values', () => {
    service = new AutomationService({ sendMessage: () => of() } as any);
    const instance: any = {
      crashDetectionEnabled: true,
      crashDetectionInterval: 10, // triggers interval error
      maxRestartAttempts: 0.5, // triggers max restart error (non-zero)
      scheduledRestartEnabled: true,
      restartWarningMinutes: 0.5, // triggers warning period error (non-zero)
      restartTime: 'invalid', // triggers time format error
      restartFrequency: 'custom',
      restartDays: [] // triggers custom frequency error
    };
    const result = service.validateAutomationSettings(instance);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain('Crash detection interval must be between 30 and 300 seconds');
  expect(result.errors).toContain('Max restart attempts must be between 1 and 10');
  expect(result.errors).toContain('Restart warning period must be between 1 and 60 minutes');
  expect(result.errors).toContain('Restart time must be in HH:MM format (24-hour)');
  expect(result.errors).toContain('At least one day must be selected for custom restart frequency');
  });

  it('should validate automation settings and return valid for correct values', () => {
    service = new AutomationService({ sendMessage: () => of() } as any);
    const instance: any = {
      crashDetectionEnabled: true,
      crashDetectionInterval: 60, // valid
      maxRestartAttempts: 3, // valid
      scheduledRestartEnabled: true,
      restartWarningMinutes: 5, // valid
      restartTime: '02:00', // valid
      restartFrequency: 'daily', // valid
      restartDays: [1] // valid
    };
    const result = service.validateAutomationSettings(instance);
    expect(result.valid).toBeTrue();
    expect(result.errors.length).toBe(0);
  });

  it('should return default automation settings', () => {
    service = new AutomationService({ sendMessage: () => of() } as any);
    const result = service.getDefaultAutomationSettings();
    expect(result.autoStartOnAppLaunch).toBeFalse();
    expect(result.crashDetectionInterval).toBe(60);
    expect(result.restartFrequency).toBe('daily');
    expect(result.restartTime).toBe('02:00');
    expect(result.restartDays).toEqual([1]);
  });
});
