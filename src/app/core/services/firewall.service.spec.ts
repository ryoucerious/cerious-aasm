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

  it("reads, saves and opens this machine's server ports", () => {
    const ranges = { game: { start: 7777, end: 7900 }, query: { start: 27015, end: 27030 }, rcon: { start: 27020, end: 27050 } };
    messaging.sendMessage.and.returnValue(of({}));

    service.getServerPorts().subscribe();
    service.setServerPorts(ranges).subscribe();
    service.openServerPortsFirewall().subscribe();

    expect(messaging.sendMessage).toHaveBeenCalledWith('get-server-ports', {});
    expect(messaging.sendMessage).toHaveBeenCalledWith('set-server-ports', { ranges });
    // Windows' admin prompt waits for whoever is at the machine.
    expect(messaging.sendMessage).toHaveBeenCalledWith('open-server-ports-firewall', {}, { timeoutMs: 5 * 60_000 });
  });
});
