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
import { MeshNodesService } from '../../../../core/services/mesh-nodes.service';

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

  it('opens the peer port beside the game port and keeps RCON off the public firewall', () => {
    render({ enabled: true, platform: 'linux' }, { gamePort: '7787', queryPort: 27025, rconPort: 27030 });
    expect(text()).toContain('sudo ufw allow 7788/udp');
    expect(text()).toContain('--add-port=7788/udp');
    expect(text()).toContain('--dport 7788');
    expect(text()).not.toContain('27030/tcp');
    expect(text()).toContain('Forward Peer Port 7788');
    expect(text()).not.toContain('Forward RCON Port');
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

  // Every machine has ranges its servers' ports come from, which its firewall opens once.
  describe('this machine\'s server ports', () => {
    const ranges = { game: { start: 7777, end: 7900 }, query: { start: 27015, end: 27030 }, rcon: { start: 27020, end: 27050 } };
    const windows = (portsOpen: boolean | null): FirewallStatus =>
      ({ enabled: false, platform: 'windows', serverPorts: { ranges, source: 'settings', portsOpen } });

    it('checks the server\'s ports against them outside Docker too', () => {
      render(windows(true), { gamePort: 7967, queryPort: 27015, rconPort: 27020 });

      expect(component.portChecks.filter(c => !c.ok).map(c => [c.label, c.port])).toEqual([['Game', 7967], ['Peer', 7968]]);
      expect(text()).toContain('outside this machine\'s server ports 7777–7900');
    });

    it('on Windows, says Windows Firewall keeps players out and where to open the ports, instead of Linux commands', () => {
      render(windows(false), { gamePort: 7777, queryPort: 27015, rconPort: 27020 });

      expect(text()).toContain('Windows Firewall keeps players out of this machine\'s server ports');
      expect(text()).toContain('Settings → Server ports');
      expect(text()).not.toContain('sudo ufw');
      expect(text()).not.toContain('Linux Firewall Configuration');
    });

    it('on Windows, says when players can get in', () => {
      render(windows(true), { gamePort: 7777, queryPort: 27015, rconPort: 27020 });

      expect(text()).toContain('Windows Firewall lets players reach this machine\'s server ports');
    });
  });

  // The ports are checked against the machine the server runs on, not the one showing the page.
  describe('a server on another machine of the mesh', () => {
    const theirs = { game: { start: 8000, end: 8100 }, query: { start: 28000, end: 28010 }, rcon: { start: 28020, end: 28030 } };

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [FirewallTabComponent],
        providers: [
          { provide: MeshNodesService, useValue: {
            isHere: (nodeId?: string | null) => !nodeId || nodeId === 'here',
            serverPortsOf: (nodeId: string) => (nodeId === 'n2' ? { name: 'asa-1', ranges: theirs, portsOpen: false } : null)
          } }
        ]
      });
      fixture = TestBed.createComponent(FirewallTabComponent);
      component = fixture.componentInstance;
    });

    it('checks its ports against that machine\'s ranges, and says where to open them', () => {
      render({ enabled: true, platform: 'linux', serverPorts: { ranges: dockerStatus('published').docker as never, source: 'settings', portsOpen: null } },
        { nodeId: 'n2', gamePort: 7777, queryPort: 28000, rconPort: 28020 });

      expect(component.portChecks.filter(c => !c.ok).map(c => c.label)).toEqual(['Game', 'Peer']);
      expect(text()).toContain('outside asa-1\'s server ports 8000–8100');
      expect(text()).toContain('Windows Firewall keeps players out of asa-1\'s server ports');
      expect(text()).toContain('Settings → Server ports on asa-1');
      expect(text()).not.toContain('sudo ufw');
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
