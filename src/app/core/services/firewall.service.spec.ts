import { FirewallService } from './firewall.service';
import { MessagingService } from './messaging/messaging.service';
import { of } from 'rxjs';

describe('FirewallService', () => {
  let service: FirewallService;
  let messaging: jasmine.SpyObj<MessagingService>;

  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    service = new FirewallService(messaging);
  });

  it('should call messaging.sendMessage for checkFirewallStatus', () => {
    messaging.sendMessage.and.returnValue(of({ enabled: true, platform: 'windows' }));
    service.checkFirewallStatus().subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('check-firewall-enabled', {});
      expect(result.enabled).toBeTrue();
      expect(result.platform).toBe('windows');
    });
  });
});
