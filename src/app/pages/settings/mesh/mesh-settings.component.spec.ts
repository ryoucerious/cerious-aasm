import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
import { MeshSettingsComponent } from './mesh-settings.component';
import { MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { MockNotificationService } from '../../../../../test/mocks/mock-notification.service';

describe('MeshSettingsComponent', () => {
  let fixture: ComponentFixture<MeshSettingsComponent>;

  async function open(status: unknown): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [MeshSettingsComponent],
      providers: [
        { provide: MessagingService, useValue: { sendMessage: () => of(status), receiveMessage: () => NEVER } },
        { provide: NotificationService, useValue: new MockNotificationService() },
        { provide: AuthService, useValue: { can: () => true, identity: { accountsInUse: true } } }
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
});
