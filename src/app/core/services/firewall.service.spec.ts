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
  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  it('should call messaging.sendMessage for checkFirewallStatus', () => {
    const obs = of({ enabled: true, platform: 'windows' });
    messaging.sendMessage.and.returnValue(obs);
    service.checkFirewallStatus().subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('check-firewall-enabled', {});
      expect(result.enabled).toBeTrue();
      expect(result.platform).toBe('windows');
    });
  });

  it('should call messaging.sendMessage for checkAdminPrivileges', () => {
    const obs = of({ success: true, hasAdmin: true });
    messaging.sendMessage.and.returnValue(obs);
    service.checkAdminPrivileges().subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('check-admin-privileges', {});
      expect(result.success).toBeTrue();
      expect(result.hasAdmin).toBeTrue();
    });
  });

  it('should call messaging.sendMessage for createApplicationFirewallRule', () => {
    const obs = of({ success: true, message: 'ok' });
    messaging.sendMessage.and.returnValue(obs);
    service.createApplicationFirewallRule().subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('create-application-firewall-rule', {});
      expect(result.success).toBeTrue();
      expect(result.message).toBe('ok');
    });
  });

  it('should call messaging.sendMessage for setupArkServerFirewall', () => {
    const obs = of({ success: true, platform: 'windows', message: 'ok' });
    messaging.sendMessage.and.returnValue(obs);
    service.setupArkServerFirewall(1, 2, 3, 'srv').subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('setup-ark-server-firewall', { gamePort: 1, queryPort: 2, rconPort: 3, serverName: 'srv' });
      expect(result.success).toBeTrue();
      expect(result.platform).toBe('windows');
    });
  });

  it('should call messaging.sendMessage for setupWebServerFirewall', () => {
    const obs = of({ success: true, platform: 'windows', message: 'ok' });
    messaging.sendMessage.and.returnValue(obs);
    service.setupWebServerFirewall(123).subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('setup-web-server-firewall', { port: 123 });
      expect(result.success).toBeTrue();
      expect(result.platform).toBe('windows');
    });
  });

  it('should call messaging.sendMessage for checkFirewallRule', () => {
    const obs = of({ port: 123, protocol: 'TCP', exists: true });
    messaging.sendMessage.and.returnValue(obs);
    service.checkFirewallRule(123, 'TCP').subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('check-firewall-rule', { port: 123, protocol: 'TCP' });
      expect(result.port).toBe(123);
      expect(result.protocol).toBe('TCP');
      expect(result.exists).toBeTrue();
    });
  });

  it('should call messaging.sendMessage for removeFirewallRule', () => {
    const obs = of({ success: true, message: 'removed' });
    messaging.sendMessage.and.returnValue(obs);
    service.removeFirewallRule(123, 'UDP').subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('remove-firewall-rule', { port: 123, protocol: 'UDP' });
      expect(result.success).toBeTrue();
      expect(result.message).toBe('removed');
    });
  });

  it('should call messaging.sendMessage for getExistingArkRules', () => {
    const obs = of({ success: true, rules: ['rule1'] });
    messaging.sendMessage.and.returnValue(obs);
    service.getExistingArkRules().subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('get-existing-ark-rules', {});
      expect(result.success).toBeTrue();
      expect(result.rules).toContain('rule1');
    });
  });

  it('should call messaging.sendMessage for cleanupArkFirewallRules', () => {
    const obs = of({ success: true, message: 'cleaned' });
    messaging.sendMessage.and.returnValue(obs);
    service.cleanupArkFirewallRules().subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('cleanup-ark-firewall-rules', {});
      expect(result.success).toBeTrue();
      expect(result.message).toBe('cleaned');
    });
  });

  it('should call messaging.sendMessage for getLinuxFirewallInstructions', () => {
    const obs = of({ success: true, instructions: 'cmds', platform: 'linux' });
    messaging.sendMessage.and.returnValue(obs);
    service.getLinuxFirewallInstructions(1, 2, 3).subscribe(result => {
      expect(messaging.sendMessage).toHaveBeenCalledWith('get-linux-firewall-instructions', { gamePort: 1, queryPort: 2, rconPort: 3 });
      expect(result.success).toBeTrue();
      expect(result.instructions).toBe('cmds');
      expect(result.platform).toBe('linux');
    });
  });

});
