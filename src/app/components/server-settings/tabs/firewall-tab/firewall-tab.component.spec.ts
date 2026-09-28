import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirewallTabComponent } from './firewall-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { FirewallStatus } from '../../../../core/services/firewall.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('FirewallTabComponent', () => {
  let component: FirewallTabComponent;
  let fixture: ComponentFixture<FirewallTabComponent>;

  const dockerStatus = (mode: 'published' | 'host'): FirewallStatus => ({
    enabled: true,
    platform: 'linux',
    docker: {
      mode,
      gamePorts: { start: 7777, end: 7900 },
      queryPorts: { start: 27015, end: 27030 },
      rconPorts: { start: 27020, end: 27050 },
      webPort: 3000
    }
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent || '';
  const render = (status: FirewallStatus | null, serverInstance: any) => {
    component.firewallStatus = status;
    component.serverInstance = serverInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FirewallTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(FirewallTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should accept serverInstance input', () => {
    component.serverInstance = { gamePort: 7777 };
    expect(component.serverInstance.gamePort).toBe(7777);
  });

  it('shows the Linux firewall commands outside Docker', () => {
    render({ enabled: true, platform: 'linux' }, { gamePort: 7777, rconPort: 27020 });
    expect(text()).toContain('sudo ufw allow 7777/udp');
    expect(text()).not.toContain('Published by Docker');
  });

  describe('in Docker with published ports', () => {
    it('lists the published ranges instead of commands that do nothing in a container', () => {
      render(dockerStatus('published'), { gamePort: 7777, queryPort: 27015, rconPort: 27020 });
      expect(text()).toContain('Published by Docker');
      expect(text()).toContain('7777–7900');
      expect(text()).toContain('27015–27030');
      expect(text()).toContain('27020–27050');
      expect(text()).not.toContain('sudo firewall-cmd');
      expect(text()).not.toContain('sudo iptables');
    });

    it('checks every port this server uses, including the peer port', () => {
      render(dockerStatus('published'), { gamePort: 7777, queryPort: 27015, rconPort: 27020 });
      expect(component.portChecks.map(c => [c.label, c.port, c.ok])).toEqual([
        ['Game', 7777, true],
        ['Peer', 7778, true],
        ['Query', 27015, true],
        ['RCON', 27020, true]
      ]);
      expect(component.portsOutOfRange).toBe(0);
    });

    it('flags ports outside the published ranges', () => {
      // 7900 is the last game port, so the peer port (7901) falls outside.
      render(dockerStatus('published'), { gamePort: '7900', queryPort: 27040, rconPort: 27020 });
      const bad = component.portChecks.filter(c => !c.ok).map(c => c.label);
      expect(bad).toEqual(['Peer', 'Query']);
      expect(component.portsOutOfRange).toBe(2);
      expect(text()).toContain('outside the published range');
      expect(text()).toContain('Peer: 7901');
    });
  });

  describe('in Docker with host networking', () => {
    it('keeps the host firewall commands and says where to run them', () => {
      render(dockerStatus('host'), { gamePort: 7777, rconPort: 27020 });
      expect(text()).toContain('Host Networking');
      expect(text()).toContain('sudo ufw allow 7777/udp');
      expect(text()).toContain('on the Docker host');
      expect(text()).not.toContain('Published by Docker');
    });
  });
});
