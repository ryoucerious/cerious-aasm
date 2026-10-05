import { AutomationService } from './automation.service';
import { MessagingService } from './messaging/messaging.service';
import { of } from 'rxjs';

describe('AutomationService', () => {
  let service: AutomationService;
  let messaging: jasmine.SpyObj<MessagingService>;

  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage']);
    messaging.sendMessage.and.returnValue(of('ok'));
    service = new AutomationService(messaging);
  });

  it('should call messaging.sendMessage for configureAutoStart', () => {
    const result = service.configureAutoStart('id', { autoStartOnAppLaunch: true, autoStartOnBoot: false });
    expect(messaging.sendMessage).toHaveBeenCalledWith('configure-autostart', { serverId: 'id', autoStartOnAppLaunch: true, autoStartOnBoot: false });
    result.subscribe(val => expect(val).toBe('ok'));
  });

  it('should call messaging.sendMessage for configureCrashDetection', () => {
    const result = service.configureCrashDetection('id', { enabled: true, checkInterval: 60, maxRestartAttempts: 3 });
    expect(messaging.sendMessage).toHaveBeenCalledWith('configure-crash-detection', { serverId: 'id', enabled: true, checkInterval: 60, maxRestartAttempts: 3 });
    result.subscribe(val => expect(val).toBe('ok'));
  });

  it('should call messaging.sendMessage for configureScheduledRestart', () => {
    const result = service.configureScheduledRestart('id', { enabled: true, frequency: 'daily', time: '02:00', days: [1], warningMinutes: 5 });
    expect(messaging.sendMessage).toHaveBeenCalledWith('configure-scheduled-restart', { serverId: 'id', enabled: true, frequency: 'daily', time: '02:00', days: [1], warningMinutes: 5 });
    result.subscribe(val => expect(val).toBe('ok'));
  });
});
