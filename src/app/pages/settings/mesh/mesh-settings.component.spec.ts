import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Subject, of } from 'rxjs';
import { MeshSettingsComponent } from './mesh-settings.component';
import { MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { MockNotificationService } from '../../../../../test/mocks/mock-notification.service';

describe('MeshSettingsComponent', () => {
  let fixture: ComponentFixture<MeshSettingsComponent>;
  let sendMessage: jasmine.Spy;
  let notification: MockNotificationService;
  let canManageNodes: boolean;
  /** What rename-mesh-node answers. */
  let renameReply: unknown;
  /** What other channels answer, by channel; get-mesh-status answers with the status opened. */
  let replies: Record<string, unknown>;
  /** mesh-status as the backend pushes it: after every heartbeat, with new objects each time. */
  let statusEvents: Subject<unknown>;

  beforeEach(() => {
    canManageNodes = true;
    renameReply = null;
    replies = {};
    statusEvents = new Subject<unknown>();
    notification = new MockNotificationService();
  });

  async function open(status: unknown): Promise<HTMLElement> {
    sendMessage = jasmine.createSpy('sendMessage').and.callFake((channel: string) => of(channel in replies ? replies[channel] : channel === 'rename-mesh-node' ? renameReply : status));
    await TestBed.configureTestingModule({
      imports: [MeshSettingsComponent],
      providers: [
        { provide: MessagingService, useValue: { sendMessage, receiveMessage: (channel: string) => (channel === 'mesh-status' ? statusEvents : NEVER) } },
        { provide: NotificationService, useValue: notification },
        { provide: AuthService, useValue: { can: (permission: string) => permission !== 'nodes.manage' || canManageNodes, identity: { accountsInUse: true }, refresh: async () => undefined } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(MeshSettingsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const standalone = { enabled: false, degraded: false, meshName: null, nodeId: 'n1', nodeName: 'A', voterCount: 0, warning: null, nodes: [] };

  it('offers to create or join a mesh on a standalone install', async () => {
    const page = await open(standalone);

    expect(page.textContent).toContain('This install is standalone');
    expect(page.textContent).toContain('Create a mesh');
    expect(page.textContent).toContain('Join a mesh');
  });

  // Creating or joining here would split this machine from the mesh it is still in.
  it('says a member is reconnecting after a restart, and offers neither', async () => {
    const page = await open({ ...standalone, reconnecting: true, warning: 'This machine is in a mesh and is reconnecting to the other members.' });

    expect(page.textContent).toContain('reconnecting to the other members');
    expect(page.textContent).not.toContain('This install is standalone');
    expect(page.textContent).not.toContain('Create a mesh');
    expect(page.textContent).not.toContain('Join a mesh');
  });

  describe('naming a machine', () => {
    const node = (nodeId: string, name: string) => ({ nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected: true });
    const inMesh = { ...standalone, enabled: true, meshName: 'Mesh', nodes: [node('n1', 'Jareds-PC'), node('n2', 'b3e68346c610')] };

    function card(page: HTMLElement, index: number): HTMLElement {
      return page.querySelectorAll<HTMLElement>('.mesh-node-card')[index];
    }

    function rename(page: HTMLElement, index: number, name: string): void {
      card(page, index).querySelector<HTMLButtonElement>('.mesh-node-rename')!.click();
      fixture.detectChanges();
      const input = card(page, index).querySelector<HTMLInputElement>('.mesh-node-rename-input')!;
      input.value = name;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      card(page, index).querySelector<HTMLButtonElement>('.mesh-node-rename-save')!.click();
      fixture.detectChanges();
    }

    it('renames a machine from its card', async () => {
      const page = await open(inMesh);
      renameReply = { success: true, status: { ...inMesh, nodes: [node('n1', 'Jareds-PC'), node('n2', 'Basement Box')] } };

      rename(page, 1, 'Basement Box');

      expect(sendMessage).toHaveBeenCalledWith('rename-mesh-node', { nodeId: 'n2', name: 'Basement Box' });
      expect(card(page, 1).querySelector('.mesh-node-rename-input')).toBeNull();
      expect(card(page, 1).querySelector('.mesh-node-name')?.textContent).toContain('Basement Box');
    });

    it('starts from the current name', async () => {
      const page = await open(inMesh);

      card(page, 1).querySelector<HTMLButtonElement>('.mesh-node-rename')!.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(card(page, 1).querySelector<HTMLInputElement>('.mesh-node-rename-input')!.value).toBe('b3e68346c610');
    });

    it('says why a name was refused, and keeps it open to fix', async () => {
      const page = await open(inMesh);
      const error = spyOn(notification as unknown as { error(message: string): void }, 'error');
      renameReply = { success: false, error: 'Enter a name for the machine.' };

      rename(page, 1, ' ');

      expect(error).toHaveBeenCalledWith('Enter a name for the machine.');
      expect(card(page, 1).querySelector('.mesh-node-rename-input')).not.toBeNull();
    });

    it('is not offered to someone who cannot manage machines', async () => {
      canManageNodes = false;

      const page = await open(inMesh);

      expect(page.querySelector('.mesh-node-rename')).toBeNull();
    });
  });

  // Each heartbeat brings a new status, with new objects for the same machines. Rebuilding the
  // cards for it took the box being typed in away every few seconds.
  describe('typing while the status refreshes', () => {
    const node = (nodeId: string, name: string) => ({
      nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected: true,
      address: { host: '192.168.1.155', peerPort: 4747, raftPort: 4002 }
    });
    const inMesh = { ...standalone, enabled: true, meshName: 'Mesh', nodes: [node('n1', 'PC 1'), node('n2', 'Docker 1')] };

    function refreshed(): void {
      statusEvents.next(JSON.parse(JSON.stringify(inMesh)));
      fixture.detectChanges();
    }

    it('keeps the name box', async () => {
      const page = await open(inMesh);
      page.querySelectorAll<HTMLButtonElement>('.mesh-node-rename')[1].click();
      fixture.detectChanges();
      const input = page.querySelector<HTMLInputElement>('.mesh-node-rename-input')!;
      input.focus();

      refreshed();

      expect(page.querySelector('.mesh-node-rename-input')).toBe(input);
      expect(document.activeElement).toBe(input);
    });

    it('keeps the address box', async () => {
      const page = await open(inMesh);
      Array.from(page.querySelectorAll<HTMLButtonElement>('.mesh-node-card button')).find(button => button.textContent?.includes('Change address'))!.click();
      fixture.detectChanges();
      const input = page.querySelector<HTMLInputElement>('.mesh-address-host')!;
      input.focus();

      refreshed();

      expect(page.querySelector('.mesh-address-host')).toBe(input);
      expect(document.activeElement).toBe(input);
    });
  });

  describe('the address other machines use', () => {
    const lan = { host: '192.168.1.155', peerPort: 4747, raftPort: 4002 };
    const node = (nodeId: string, name: string, address: unknown) =>
      ({ nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected: true, address });
    const inMesh = { ...standalone, enabled: true, meshName: 'Mesh', advertise: lan, nodes: [node('n1', 'PC 1', lan)] };

    function type(scope: HTMLElement, selector: string, value: string): void {
      const input = scope.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    async function settle(): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function button(scope: Element, label: string): HTMLButtonElement | undefined {
      return Array.from(scope.querySelectorAll('button')).find(item => item.textContent?.trim().includes(label));
    }

    it('shows where each machine is reached', async () => {
      const page = await open(inMesh);

      expect(page.querySelector('.mesh-node-card')?.textContent).toContain('192.168.1.155');
      expect(page.querySelector('.mesh-node-card')?.textContent).toContain('4747');
    });

    it('changes a machine\'s address, waiting for every machine to check it first', async () => {
      const page = await open(inMesh);
      const moved = { host: 'mesh.example.org', peerPort: 14747, raftPort: 14002 };
      replies['set-mesh-node-address'] = { success: true, status: { ...inMesh, nodes: [node('n1', 'PC 1', moved)] } };

      button(page.querySelector('.mesh-node-card')!, 'Change address')!.click();
      await settle();
      type(page, '.mesh-address-host', 'mesh.example.org');
      type(page, '.mesh-address-peer', '14747');
      type(page, '.mesh-address-raft', '14002');
      await settle();
      button(page, 'Save address')!.click();
      await settle();

      expect(sendMessage).toHaveBeenCalledWith('set-mesh-node-address', { nodeId: 'n1', host: 'mesh.example.org', peerPort: 14747, raftPort: 14002 }, jasmine.objectContaining({ timeoutMs: jasmine.any(Number) }));
      expect(page.querySelector('.mesh-address-host')).toBeNull();
      expect(page.querySelector('.mesh-node-card')?.textContent).toContain('mesh.example.org');
    });

    it('starts from the address it has now', async () => {
      const page = await open(inMesh);

      button(page.querySelector('.mesh-node-card')!, 'Change address')!.click();
      await settle();

      expect(page.querySelector<HTMLInputElement>('.mesh-address-host')!.value).toBe('192.168.1.155');
      expect(page.querySelector<HTMLInputElement>('.mesh-address-raft')!.value).toBe('4002');
    });

    it('says why an address was not taken, and keeps it open to fix', async () => {
      const page = await open(inMesh);
      const error = spyOn(notification as unknown as { error(message: string): void }, 'error');
      replies['set-mesh-node-address'] = { success: false, error: 'Docker 1 could not reach this machine at mesh.example.org:14747 (Timed out.).' };

      button(page.querySelector('.mesh-node-card')!, 'Change address')!.click();
      await settle();
      type(page, '.mesh-address-host', 'mesh.example.org');
      await settle();
      button(page, 'Save address')!.click();
      await settle();

      expect(error).toHaveBeenCalledWith('Docker 1 could not reach this machine at mesh.example.org:14747 (Timed out.).');
      expect(page.querySelector('.mesh-address-host')).not.toBeNull();
    });

    it('is not offered to someone who cannot manage machines', async () => {
      canManageNodes = false;

      const page = await open(inMesh);

      expect(button(page, 'Change address')).toBeUndefined();
    });

    describe('when joining', () => {
      const alone = { ...standalone, advertise: lan };

      it('joins at the address this machine has, unless another is typed', async () => {
        const page = await open(alone);
        replies['join-mesh'] = { success: true };

        button(page, 'Join mesh')!.click();
        await settle();

        expect(sendMessage).toHaveBeenCalledWith('join-mesh', { memberUrl: '', token: '' }, jasmine.anything());
        expect(page.textContent).toContain('192.168.1.155');
      });

      it('joins at a public address typed in, for a machine outside the other machines\' network', async () => {
        const page = await open(alone);
        replies['join-mesh'] = { success: true };

        button(page, 'Use another address')!.click();
        await settle();
        type(page, '.mesh-own-address .mesh-address-host', '203.0.113.7');
        await settle();
        button(page, 'Join mesh')!.click();
        await settle();

        expect(sendMessage).toHaveBeenCalledWith('join-mesh', {
          memberUrl: '', token: '', address: { host: '203.0.113.7', peerPort: 4747, raftPort: 4002 }
        }, jasmine.anything());
      });
    });
  });
});
