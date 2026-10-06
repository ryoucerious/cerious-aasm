import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
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

  beforeEach(() => {
    canManageNodes = true;
    renameReply = null;
    notification = new MockNotificationService();
  });

  async function open(status: unknown): Promise<HTMLElement> {
    sendMessage = jasmine.createSpy('sendMessage').and.callFake((channel: string) => of(channel === 'rename-mesh-node' ? renameReply : status));
    await TestBed.configureTestingModule({
      imports: [MeshSettingsComponent],
      providers: [
        { provide: MessagingService, useValue: { sendMessage, receiveMessage: () => NEVER } },
        { provide: NotificationService, useValue: notification },
        { provide: AuthService, useValue: { can: (permission: string) => permission !== 'nodes.manage' || canManageNodes, identity: { accountsInUse: true } } }
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
});
