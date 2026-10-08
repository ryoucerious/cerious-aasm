import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Subject, isObservable, of, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { MeshSettingsComponent } from './mesh-settings.component';
import { MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { MockNotificationService } from '../../../../../test/mocks/mock-notification.service';
import { BusyService } from '../../../core/services/busy.service';

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
    sendMessage = jasmine.createSpy('sendMessage').and.callFake((channel: string) => {
      const reply = channel in replies ? replies[channel] : channel === 'rename-mesh-node' ? renameReply : status;
      return isObservable(reply) ? reply : of(reply);
    });
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

  /** The card at this index, in the order the cards are shown. */
  const cardAt = (page: HTMLElement, index: number) => page.querySelectorAll<HTMLElement>('.mesh-node-card')[index];

  /** Opens the ⋯ menu on a card, as a click on it does; left open when it already is. */
  function openMenu(page: HTMLElement, index: number): void {
    if (cardAt(page, index).querySelector('.mesh-node-menu')) return;
    cardAt(page, index).querySelector<HTMLButtonElement>('.mesh-node-more')!.click();
    fixture.detectChanges();
  }

  /** A menu item's words, without its icon's. */
  const itemLabel = (item: Element) => Array.from(item.childNodes)
    .filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim();

  /** The item with these words in a card's ⋯ menu, which is opened first; undefined when it has none. */
  function menuItem(page: HTMLElement, index: number, label: string): HTMLButtonElement | undefined {
    openMenu(page, index);
    return Array.from(cardAt(page, index).querySelectorAll<HTMLButtonElement>('.mesh-node-menu button')).find(item => itemLabel(item) === label);
  }

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
      menuItem(page, index, 'Rename')!.click();
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

      menuItem(page, 1, 'Rename')!.click();
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

      expect(menuItem(page, 1, 'Rename')).toBeUndefined();
      expect(card(page, 1).querySelector('.mesh-node-menu')).withContext('the menu opened').not.toBeNull();
    });
  });

  // The cards had grown a row of seven controls. Occasional changes moved into a ⋯ menu.
  describe('a machine\'s menu', () => {
    const node = (nodeId: string, name: string, extra: Record<string, unknown> = {}) =>
      ({ nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected: true, ...extra });
    const inMesh = (nodes: unknown[]) => ({ ...standalone, enabled: true, meshName: 'Mesh', voterCount: nodes.length, nodes });
    const cardLabels = (page: HTMLElement, index: number) =>
      Array.from(cardAt(page, index).querySelectorAll('button')).map(button => button.textContent?.trim());

    it('holds Rename, Change address, and Remove last in red', async () => {
      const page = await open(inMesh([node('n1', 'PC 1'), node('n2', 'Docker 1')]));

      expect(cardLabels(page, 1)).not.toContain('Rename');
      expect(cardLabels(page, 1)).not.toContain('Remove');
      openMenu(page, 1);

      const items = Array.from(cardAt(page, 1).querySelectorAll<HTMLButtonElement>('.mesh-node-menu button'));
      expect(items.map(itemLabel)).toEqual(['Rename', 'Change address', 'Remove']);
      expect(items[2].classList).toContain('danger');
      expect(menuItem(page, 0, 'Leave')).withContext('this machine leaves rather than being removed').toBeDefined();
    });

    it('opens on one card at a time, and closes on a click elsewhere, on Escape, and once an item is chosen', async () => {
      const page = await open(inMesh([node('n1', 'PC 1'), node('n2', 'Docker 1')]));
      const menus = () => page.querySelectorAll('.mesh-node-menu').length;

      openMenu(page, 0);
      openMenu(page, 1);
      expect(menus()).toBe(1);
      expect(cardAt(page, 1).querySelector('.mesh-node-menu')).not.toBeNull();

      document.body.click();
      fixture.detectChanges();
      expect(menus()).toBe(0);

      openMenu(page, 1);
      cardAt(page, 1).querySelector<HTMLButtonElement>('.mesh-node-more')!.click();
      fixture.detectChanges();
      expect(menus()).withContext('⋯ again closes it').toBe(0);

      openMenu(page, 1);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(menus()).toBe(0);

      menuItem(page, 1, 'Rename')!.click();
      fixture.detectChanges();
      expect(menus()).toBe(0);
      expect(cardAt(page, 1).querySelector('.mesh-node-rename-input')).not.toBeNull();
    });

    // Its address is checked from every machine, so one that cannot be reached cannot take a new one.
    it('says why Change address waits for a machine that cannot be reached', async () => {
      const page = await open(inMesh([node('n1', 'PC 1'), node('n2', 'asa-1', { connected: false }), node('n3', 'Docker 1')]));

      expect(menuItem(page, 1, 'Change address')!.disabled).toBeTrue();
      expect(cardAt(page, 1).querySelector('.mesh-node-menu-note')?.textContent?.trim()).toBe('Change address waits until asa-1 can be reached.');
    });

    // Connected or Unreachable said nothing about since when.
    it('says when each other machine was last heard from', async () => {
      const hour = 3600_000;
      const page = await open(inMesh([
        node('n1', 'PC 1', { lastContactAt: Date.now() }),
        node('n2', 'asa-1', { connected: false, lastContactAt: Date.now() - 3 * hour }),
        node('n3', 'Docker 1', { lastContactAt: Date.now() - 5_000 }),
        node('n4', 's001', { connected: false, lastContactAt: null })
      ]));
      const contact = (index: number) => cardAt(page, index).querySelector('.mesh-node-contact')?.textContent?.trim();

      expect(contact(0)).withContext('this machine').toBeUndefined();
      expect(contact(1)).toBe('Last contact 3 hours ago');
      expect(contact(2)).toBe('Last contact just now');
      expect(contact(3)).toBe('Never heard from');
    });

    // A machine's record holds '0' from its enrollment until its first heartbeat is written.
    it('says a machine has not reported its version yet, rather than Version 0', async () => {
      const page = await open(inMesh([node('n1', 'PC 1'), node('n2', 'asa-1', { version: '0', connected: false })]));

      expect(cardAt(page, 0).textContent).toContain('Version 1.2.2');
      expect(cardAt(page, 1).textContent).toContain('Version not reported yet');
      expect(cardAt(page, 1).textContent).not.toContain('Version 0');
    });
  });

  // A join URL retyped by hand lost a digit; a token was reused on a second machine.
  describe('adding a machine', () => {
    const member = { ...standalone, enabled: true, meshName: 'Mesh', advertise: { host: 'ark.example.com', peerPort: 4747, raftPort: 4002 }, nodes: [] };
    const button = (page: HTMLElement, label: string) => Array.from(page.querySelectorAll('button')).find(item => item.textContent?.trim().includes(label));

    async function settle(): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('gives the address and the token to copy whole, and says a token is for one machine', async () => {
      const page = await open(member);
      replies['create-enrollment-token'] = { success: true, token: 'secret.fingerprint', expiresAt: new Date(2026, 9, 6, 14, 5).getTime() };
      const copied = spyOn(navigator.clipboard, 'writeText').and.resolveTo();

      button(page, 'Enrollment token')!.click();
      await settle();
      button(page, 'Copy address')!.click();
      button(page, 'Copy token')!.click();

      expect(page.textContent).toContain('https://ark.example.com:4747');
      expect(page.textContent).toContain('secret.fingerprint');
      expect(page.textContent).toContain('one machine');
      expect(copied).toHaveBeenCalledWith('https://ark.example.com:4747');
      expect(copied).toHaveBeenCalledWith('secret.fingerprint');
    });

    it('can join again after a join that failed', async () => {
      const page = await open(standalone);
      // As from the app: a while later, not inside the click.
      replies['join-mesh'] = timer(10).pipe(map(() => ({ success: false, error: 'This token expired: a token lasts 15 minutes. Make a new one on a member.' })));
      // The status asked for afterwards brings nothing to draw the page again with.
      replies['get-mesh-status'] = null;

      button(page, 'Join mesh')!.click();
      await settle();

      expect(button(page, 'Join mesh')!.disabled).toBeFalse();
    });

    // Germany's rqlited could not run; the join failed halfway.
    it('says why this machine cannot create or join a mesh, and offers neither', async () => {
      const page = await open({ ...standalone, blocker: 'rqlited at /opt/aasm/rqlited is not executable. Run: chmod +x "/opt/aasm/rqlited"' });

      expect(page.textContent).toContain('chmod +x');
      expect(button(page, 'Join mesh')!.disabled).toBeTrue();
      expect(button(page, 'Create mesh')!.disabled).toBeTrue();
    });
  });

  // "Update ARK Server fires blind": no word before it started, nothing while it ran.
  describe('updating ARK on a machine', () => {
    const node = (nodeId: string, name: string, extra: Record<string, unknown> = {}) =>
      ({ nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected: true, ...extra });
    const inMesh = (nodes: unknown[]) => ({ ...standalone, enabled: true, meshName: 'Mesh', nodes });
    const updateButtons = (page: HTMLElement) => Array.from(page.querySelectorAll<HTMLButtonElement>('.mesh-node-card button'))
      .filter(button => button.textContent?.trim() === 'Update ARK');

    const progress: Array<[Record<string, unknown>, string]> = [
      [{ phase: 'copying', message: '', percent: 25, at: 1 }, 'Updating ARK: copying the install 25%, servers still up'],
      [{ phase: 'downloading', message: '', percent: 40, at: 1 }, 'Updating ARK: downloading 40%, servers still up'],
      [{ phase: 'warning', message: '', minutesLeft: 12, at: 1 }, 'Updating ARK: warning players, 12 min left'],
      [{ phase: 'updating', message: '', percent: 40, at: 1 }, 'Updating ARK: downloading 40%'],
      [{ phase: 'configuring', message: '', at: 1 }, 'Updating ARK: putting the new files in place'],
      [{ phase: 'complete', message: 'ARK is already up to date (build 12345). No server was restarted.', at: 1 },
        'ARK is already up to date (build 12345). No server was restarted.'],
      [{ phase: 'starting', message: '', at: 1 }, 'Updating ARK: starting servers'],
      [{ phase: 'error', message: 'SteamCMD Update Failed', at: 1 }, 'ARK update failed: SteamCMD Update Failed']
    ];
    for (const [arkUpdate, text] of progress) {
      it(`shows how it is going: ${text}`, async () => {
        const page = await open(inMesh([node('n1', 'Dallas01', { arkUpdate })]));

        expect(page.querySelector('.mesh-node-card')?.textContent).toContain(text);
      });
    }

    it('asks first, saying what happens to that machine\'s players', async () => {
      const page = await open(inMesh([node('n1', 'Dallas01')]));
      replies['mesh-node-update'] = { success: true, message: 'Players on that machine are warned for 15 minutes.' };

      updateButtons(page)[0].click();
      fixture.detectChanges();
      expect(sendMessage).not.toHaveBeenCalledWith('mesh-node-update', jasmine.anything());
      expect(page.querySelector('.modal-confirmation')?.textContent).toContain('downloads while its servers keep running');
      expect(page.querySelector('.modal-confirmation')?.textContent).toContain('warned');

      Array.from(page.querySelectorAll<HTMLButtonElement>('.action-group-modal button')).find(button => button.textContent?.trim() === 'Update ARK')!.click();
      fixture.detectChanges();

      expect(sendMessage).toHaveBeenCalledWith('mesh-node-update', { nodeId: 'n1', kind: 'ark' });
    });

    // The app restarts to update, which takes that machine's servers down with it.
    it('asks before updating the app, saying it restarts and that machine\'s servers stop', async () => {
      const page = await open(inMesh([node('n1', 'Dallas01')]));
      replies['mesh-node-update'] = { success: true, message: 'App update started.' };

      Array.from(page.querySelectorAll<HTMLButtonElement>('.mesh-node-card button')).find(button => button.textContent?.trim() === 'Update app')!.click();
      fixture.detectChanges();
      expect(sendMessage).not.toHaveBeenCalledWith('mesh-node-update', jasmine.anything());
      expect(page.querySelector('.modal-confirmation')?.textContent).toContain('Update the app on Dallas01?');
      expect(page.querySelector('.modal-confirmation')?.textContent).toContain('restarts');
      expect(page.querySelector('.modal-confirmation')?.textContent).toContain('servers running there stop');

      Array.from(page.querySelectorAll<HTMLButtonElement>('.action-group-modal button')).find(button => button.textContent?.trim() === 'Update app')!.click();
      fixture.detectChanges();

      expect(sendMessage).toHaveBeenCalledWith('mesh-node-update', { nodeId: 'n1', kind: 'app' });
    });

    // Sized to its text, the Update ARK question stretched across the whole window.
    it('asks in a dialog narrow enough to read', async () => {
      const page = await open(inMesh([node('n1', 'Dallas01')]));
      const width = () => page.querySelector<HTMLElement>('.modal')?.style.maxWidth;

      updateButtons(page)[0].click();
      fixture.detectChanges();
      expect(width()).toBe('520px');

      Array.from(page.querySelectorAll<HTMLButtonElement>('.action-group-modal button')).find(button => button.textContent?.trim() === 'Cancel')!.click();
      fixture.detectChanges();
      Array.from(page.querySelectorAll<HTMLButtonElement>('.mesh-node-card button')).find(button => button.textContent?.trim() === 'Update app')!.click();
      fixture.detectChanges();
      expect(width()).toBe('520px');
    });

    /** The card's button with this label, in the order the cards are shown. */
    const cardButton = (page: HTMLElement, index: number, label: string) =>
      Array.from(page.querySelectorAll<HTMLElement>('.mesh-node-card')[index].querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent?.trim() === label)!;

    // The request goes to the machine itself, so one that cannot be reached cannot take it.
    it('does not offer to update a machine that cannot be reached', async () => {
      const page = await open(inMesh([node('n1', 'PC 1'), node('n2', 'asa-1', { connected: false })]));

      expect(cardButton(page, 1, 'Update ARK').disabled).toBeTrue();
      expect(cardButton(page, 1, 'Update app').disabled).toBeTrue();
      expect(cardButton(page, 1, 'Update ARK').title).toBe('asa-1 cannot be reached.');
      expect(cardButton(page, 0, 'Update ARK').disabled).toBeFalse();
    });

    // Without quorum another machine cannot be told to update; this one can update itself.
    it('updates only this machine while the mesh has no quorum', async () => {
      const page = await open({ ...inMesh([node('n1', 'PC 1'), node('n2', 'Docker 1')]), degraded: true });

      expect(cardButton(page, 0, 'Update ARK').disabled).toBeFalse();
      expect(cardButton(page, 0, 'Update app').disabled).toBeFalse();
      expect(cardButton(page, 1, 'Update ARK').disabled).toBeTrue();
      expect(cardButton(page, 1, 'Update app').title).toBe('Updating another machine waits until enough machines can be reached.');
    });

    it('updates one machine at a time', async () => {
      const page = await open(inMesh([node('n1', 'PC 1'), node('n2', 'Dallas01', { arkUpdate: { phase: 'updating', message: '', at: 1 } })]));

      expect(updateButtons(page).every(button => button.disabled)).toBeTrue();
    });
  });

  // "Why can I not rename my own machines?" The banner said changes wait for quorum, not what that meant.
  describe('without quorum', () => {
    const node = (nodeId: string, name: string, connected = true) =>
      ({ nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected });
    const degraded = {
      ...standalone, enabled: true, degraded: true, meshName: 'Mesh', voterCount: 4,
      nodes: [node('n1', 'Docker 1'), node('n2', 'PC 1'), node('n3', 'asa-1', false), node('n4', 's001', false)]
    };

    it('says how many machines it can reach, and how many changes need', async () => {
      const page = await open(degraded);

      expect(page.querySelector('.mesh-degraded')?.textContent).toContain('2 of 4 machines can be reached, and changes to the mesh need 3');
    });

    it('says why each change is unavailable', async () => {
      const page = await open(degraded);
      const note = (index: number) => cardAt(page, index).querySelector('.mesh-node-menu-note')?.textContent?.trim();

      expect(cardAt(page, 0).querySelector<HTMLElement>('.mesh-node-skip')!.title).toBe('Waits until 3 of the 4 machines can be reached.');
      expect(menuItem(page, 1, 'Rename')!.disabled).toBeTrue();
      expect(note(1)).toBe('Rename, Change address and Remove wait until 3 of the 4 machines can be reached.');
      // This machine can still leave anyway, so only the other two wait.
      openMenu(page, 0);
      expect(note(0)).toBe('Rename and Change address wait until 3 of the 4 machines can be reached.');
    });

    it('points to the menu for forcing out a machine that is gone for good', async () => {
      const page = await open(degraded);

      expect(page.querySelector('.mesh-degraded')?.textContent).toContain('can be forced out from the ⋯ menu on its card');
    });
  });

  // Without quorum the mesh cannot agree to remove anyone; the machines that can be reached force the gone ones out.
  describe('forcing out machines that cannot be reached', () => {
    const node = (nodeId: string, name: string, connected = true) =>
      ({ nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected });
    const degraded = (extra: unknown[] = []) => ({
      ...standalone, enabled: true, degraded: true, meshName: 'Mesh', voterCount: 4 + extra.length,
      nodes: [node('n1', 'Docker 1'), node('n2', 'PC 1'), node('n3', 'asa-1', false), node('n4', 's001', false), ...extra]
    });
    const cardButton = menuItem;
    const modalButton = (page: HTMLElement, label: string) =>
      Array.from(page.querySelectorAll<HTMLButtonElement>('.action-group-modal button')).find(button => button.textContent?.trim() === label)!;
    const ticks = (page: HTMLElement) => Array.from(page.querySelectorAll<HTMLInputElement>('.mesh-force-remove-choice input'));

    it('is offered on a machine that cannot be reached, and Leave anyway on this one', async () => {
      const page = await open(degraded());

      expect(cardButton(page, 0, 'Leave anyway')?.disabled).toBeFalse();
      expect(cardButton(page, 1, 'Remove')?.disabled).toBeTrue();
      expect(cardButton(page, 2, 'Force remove')?.disabled).toBeFalse();
      expect(cardButton(page, 3, 'Force remove')?.disabled).toBeFalse();
    });

    it('is not offered while the mesh can agree: Remove does it', async () => {
      const page = await open({ ...degraded(), degraded: false });

      expect(cardButton(page, 2, 'Force remove')).toBeUndefined();
      expect(cardButton(page, 2, 'Remove')?.disabled).toBeFalse();
    });

    it('ticks the machine asked about, says enough remain, and forces out the ones ticked', async () => {
      const page = await open(degraded());
      replies['force-remove-mesh-nodes'] = { success: true };

      cardButton(page, 2, 'Force remove')!.click();
      fixture.detectChanges();

      expect(ticks(page).map(tick => tick.checked)).toEqual([true, false]);
      expect(page.querySelector('.mesh-force-remove-plan')?.textContent).toContain('Leaves 3 machines, 2 of which can be reached; they need 2.');
      expect(page.querySelector('.modal-confirmation')?.textContent).toContain('gone for good');

      modalButton(page, 'Force remove').click();

      expect(sendMessage).toHaveBeenCalledWith('force-remove-mesh-nodes', { nodeIds: ['n3'] }, jasmine.anything());
    });

    it('will not force out too few for the rest to agree', async () => {
      const page = await open(degraded([node('n5', 'old box', false)]));

      cardButton(page, 2, 'Force remove')!.click();
      fixture.detectChanges();

      expect(page.querySelector('.mesh-force-remove-plan')?.textContent).toContain('Still too few');
      expect(modalButton(page, 'Force remove').disabled).toBeTrue();

      ticks(page)[1].click();
      fixture.detectChanges();
      expect(modalButton(page, 'Force remove').disabled).toBeFalse();
    });

    it('leaves without the others, once asked', async () => {
      const page = await open(degraded());
      replies['leave-mesh-anyway'] = { success: true };

      cardButton(page, 0, 'Leave anyway')!.click();
      fixture.detectChanges();
      expect(page.querySelector('.modal-confirmation')?.textContent).toContain('still count this machine');
      expect(page.querySelector<HTMLElement>('.modal')?.style.maxWidth).toBe('520px');
      modalButton(page, 'Leave anyway').click();

      expect(sendMessage).toHaveBeenCalledWith('leave-mesh-anyway', {});
    });

    // Beside the banner it went on showing the mesh it was no longer in: a warning, and the others as Unreachable.
    it('shows only that it was removed, not the mesh it is no longer in', async () => {
      const page = await open({ ...degraded(), removedFromMesh: true, warning: 'A mesh of fewer than 3 voting nodes cannot elect a new leader.' });

      expect(page.querySelector('.mesh-removed')).not.toBeNull();
      expect(page.querySelectorAll('.mesh-node-card').length).toBe(0);
      expect(page.textContent).not.toContain('cannot elect a new leader');
      expect(page.textContent).not.toContain('Check reachability');
    });

    // Forced out while it was away: the others refuse it, and it says so.
    it('says when the others removed this machine, and offers to leave', async () => {
      const page = await open({ ...degraded(), removedFromMesh: true });
      replies['leave-mesh-anyway'] = { success: true };

      expect(page.querySelector('.mesh-removed')?.textContent).toContain('The other machines removed this one from the mesh');
      page.querySelector<HTMLButtonElement>('.mesh-removed button')!.click();
      fixture.detectChanges();
      modalButton(page, 'Leave anyway').click();

      expect(sendMessage).toHaveBeenCalledWith('leave-mesh-anyway', {});
    });
  });

  // A removal or a move of the database could take a minute, and the page went on taking clicks.
  describe('while a change to the mesh is under way', () => {
    const node = (nodeId: string, name: string, connected = true) =>
      ({ nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected, address: { host: '10.0.0.' + nodeId.slice(1), peerPort: 4747, raftPort: 4002 } });
    const inMesh = (degraded = false) => ({
      ...standalone, enabled: true, degraded, meshName: 'Mesh', voterCount: 3,
      nodes: [node('n1', 'PC 1'), node('n2', 'Docker 1'), node('n3', 'asa-1', !degraded)]
    });
    /** What the app's overlay shows, or undefined while nothing is under way. */
    const working = () => TestBed.inject(BusyService).message ?? undefined;
    const modalButton = (page: HTMLElement, label: string) =>
      Array.from(page.querySelectorAll<HTMLButtonElement>('.action-group-modal button')).find(button => button.textContent?.trim() === label)!;

    it('covers the page with a spinner while a machine is removed, until the mesh answers', async () => {
      const reply = new Subject<unknown>();
      replies['remove-mesh-node'] = reply;
      const page = await open(inMesh());

      menuItem(page, 1, 'Remove')!.click();
      fixture.detectChanges();
      expect(working()).toContain('Removing Docker 1');

      reply.next({ success: true });
      fixture.detectChanges();
      expect(working()).toBeUndefined();
    });

    it('says why a removal was refused, and lets go', async () => {
      replies['remove-mesh-node'] = { success: false, error: 'Changes to the mesh need 2 of the 3 machines.' };
      const error = spyOn(notification as unknown as { error(message: string): void }, 'error');
      const page = await open(inMesh());

      menuItem(page, 1, 'Remove')!.click();
      fixture.detectChanges();

      expect(error).toHaveBeenCalledWith('Changes to the mesh need 2 of the 3 machines.');
      expect(working()).toBeUndefined();
    });

    it('shows it while this machine leaves, with the others or without them', async () => {
      replies['remove-mesh-node'] = NEVER;
      replies['leave-mesh-anyway'] = NEVER;
      const page = await open(inMesh());

      menuItem(page, 0, 'Leave')!.click();
      fixture.detectChanges();
      modalButton(page, 'Leave').click();
      fixture.detectChanges();
      expect(working()).toContain('Leaving the mesh');
    });

    it('shows it while machines that cannot be reached are forced out', async () => {
      replies['force-remove-mesh-nodes'] = NEVER;
      const page = await open({ ...inMesh(true), nodes: [node('n1', 'PC 1'), node('n2', 'Docker 1'), node('n3', 'asa-1', false)] });

      menuItem(page, 2, 'Force remove')!.click();
      fixture.detectChanges();
      modalButton(page, 'Force remove').click();
      fixture.detectChanges();

      expect(working()).toContain('Forcing out asa-1');
    });

    it('shows it while every machine checks a new address', async () => {
      replies['set-mesh-node-address'] = NEVER;
      const page = await open(inMesh());

      menuItem(page, 0, 'Change address')!.click();
      fixture.detectChanges();
      Array.from(page.querySelectorAll<HTMLButtonElement>('.mesh-address-actions button')).find(button => button.textContent?.includes('Save address'))!.click();
      fixture.detectChanges();

      expect(working()).toContain('Checking every machine can reach PC 1');
    });

  });

  // "Drain" read like "pull every server onto this PC". It only keeps new servers off a machine.
  describe('keeping new servers off a machine', () => {
    const node = (nodeId: string, name: string, extra: Record<string, unknown> = {}) =>
      ({ nodeId, name, status: 'alive', maintenance: false, version: '1.2.2', connected: true, ...extra });
    const buttons = (page: HTMLElement) => Array.from(page.querySelectorAll('.mesh-node-card button')).map(button => button.textContent?.trim());
    const toggle = (page: HTMLElement) => page.querySelector<HTMLInputElement>('.mesh-node-card .mesh-node-skip input')!;

    it('is a switch that says what it does', async () => {
      const page = await open({ ...standalone, enabled: true, meshName: 'Mesh', nodes: [node('n1', 'PC 1')] });

      expect(page.querySelector('.mesh-node-skip')?.textContent?.trim()).toBe('Skip new servers');
      expect(toggle(page).checked).toBeFalse();
      expect(buttons(page)).not.toContain('Skip new servers');
      expect(buttons(page)).not.toContain('Drain');
    });

    it('switches it on and off', async () => {
      const page = await open({ ...standalone, enabled: true, meshName: 'Mesh', nodes: [node('n1', 'PC 1')] });

      toggle(page).click();

      expect(sendMessage).toHaveBeenCalledWith('set-node-maintenance', { nodeId: 'n1', maintenance: true });
    });

    it('still shows whether a machine skipping new servers is reachable', async () => {
      const page = await open({ ...standalone, enabled: true, meshName: 'Mesh', nodes: [node('n1', 'PC 1', { maintenance: true, status: 'maintenance', connected: false })] });

      const card = page.querySelector('.mesh-node-card')!;
      expect(card.querySelector('.mesh-node-pill')?.textContent?.trim()).toBe('Unreachable');
      expect(toggle(page).checked).toBeTrue();
    });

    it('cannot be switched by someone who cannot manage machines', async () => {
      canManageNodes = false;

      const page = await open({ ...standalone, enabled: true, meshName: 'Mesh', nodes: [node('n1', 'PC 1')] });

      expect(toggle(page).disabled).toBeTrue();
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
      menuItem(page, 1, 'Rename')!.click();
      fixture.detectChanges();
      const input = page.querySelector<HTMLInputElement>('.mesh-node-rename-input')!;
      input.focus();

      refreshed();

      expect(page.querySelector('.mesh-node-rename-input')).toBe(input);
      expect(document.activeElement).toBe(input);
    });

    it('keeps the address box', async () => {
      const page = await open(inMesh);
      menuItem(page, 0, 'Change address')!.click();
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

      menuItem(page, 0, 'Change address')!.click();
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

      menuItem(page, 0, 'Change address')!.click();
      await settle();

      expect(page.querySelector<HTMLInputElement>('.mesh-address-host')!.value).toBe('192.168.1.155');
      expect(page.querySelector<HTMLInputElement>('.mesh-address-raft')!.value).toBe('4002');
    });

    it('says why an address was not taken, and keeps it open to fix', async () => {
      const page = await open(inMesh);
      const error = spyOn(notification as unknown as { error(message: string): void }, 'error');
      replies['set-mesh-node-address'] = { success: false, error: 'Docker 1 could not reach this machine at mesh.example.org:14747 (Timed out.).' };

      menuItem(page, 0, 'Change address')!.click();
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

      expect(menuItem(page, 0, 'Change address')).toBeUndefined();
      expect(cardAt(page, 0).querySelector('.mesh-node-menu')).withContext('the menu opened').not.toBeNull();
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

      // The mesh's accounts replace this machine's; its own admin password signs in under a new name.
      it('says which name this machine\'s admin password now signs in as', async () => {
        const page = await open(alone);
        const joined = { ...alone, enabled: true, meshName: 'Mesh' };
        replies['join-mesh'] = { success: true, status: { ...joined, machineAdmin: 'admin2-germany01-asa-1' } };
        replies['get-mesh-status'] = joined;
        const success = spyOn(notification as unknown as { success(message: string): void }, 'success');

        button(page, 'Join mesh')!.click();
        await settle();

        expect(success).toHaveBeenCalledWith('Joined the mesh. This machine\'s admin password now signs in as admin2-germany01-asa-1.');
        expect(page.querySelector('.mesh-joined-as')?.textContent).toContain('admin2-germany01-asa-1');
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
