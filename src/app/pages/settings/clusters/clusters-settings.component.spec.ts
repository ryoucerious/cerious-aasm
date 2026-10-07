import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, NEVER, of } from 'rxjs';
import { ClustersSettingsComponent } from './clusters-settings.component';
import { ClusterOption, ClustersService } from '../../../core/services/clusters.service';
import { MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { LiveServersService } from '../../../core/services/live-servers.service';
import { MeshNodesService } from '../../../core/services/mesh-nodes.service';
import { ServerInstance } from '../../../core/models/server-instance.model';
import { MockNotificationService } from '../../../../../test/mocks/mock-notification.service';

describe('ClustersSettingsComponent', () => {
  let fixture: ComponentFixture<ClustersSettingsComponent>;
  let page: HTMLElement;
  let notification: MockNotificationService;
  let succeeded: jasmine.Spy;
  let failed: jasmine.Spy;
  let clusters$: BehaviorSubject<ClusterOption[]>;
  let servers$: BehaviorSubject<ServerInstance[]>;
  let clustersService: jasmine.SpyObj<Pick<ClustersService, 'create' | 'rename' | 'remove' | 'refresh' | 'setUploadNotices'>>;
  let meshStatus: unknown;
  let canManage: boolean;

  const islands: ClusterOption = { clusterId: 'c1', name: 'Islands', arkClusterId: 'Islands', managed: true };
  const wilds: ClusterOption = { clusterId: 'c2', name: 'Wilds', arkClusterId: 'WildsCluster', managed: true };
  const standalone = { enabled: false, degraded: false, nodeId: 'n1', nodes: [] };
  const sync = (files: number, extra: Record<string, unknown> = {}) =>
    ({ files, pendingSend: 0, pendingReceive: 0, conflicts: 0, lastSyncAt: 1, error: null, ...extra });

  beforeEach(() => {
    notification = new MockNotificationService();
    succeeded = spyOn(notification, 'success');
    failed = spyOn(notification, 'error');
    clusters$ = new BehaviorSubject<ClusterOption[]>([islands, wilds]);
    servers$ = new BehaviorSubject<ServerInstance[]>([]);
    clustersService = jasmine.createSpyObj('ClustersService', ['create', 'rename', 'remove', 'refresh', 'setUploadNotices']);
    meshStatus = standalone;
    canManage = true;
  });

  async function open(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ClustersSettingsComponent],
      providers: [
        { provide: ClustersService, useValue: Object.assign(clustersService, { clusters$: clusters$.asObservable() }) },
        { provide: MessagingService, useValue: { sendMessage: () => of(meshStatus), receiveMessage: () => NEVER } },
        { provide: NotificationService, useValue: notification },
        { provide: AuthService, useValue: { can: (permission: string) => permission !== 'clusters.manage' || canManage } },
        { provide: LiveServersService, useValue: { servers$: servers$.asObservable() } },
        { provide: MeshNodesService, useValue: { nameOf: (nodeId: string) => ({ n1: 'Desk', n2: 'Basement' } as Record<string, string>)[nodeId] || '' } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ClustersSettingsComponent);
    fixture.detectChanges();
    page = fixture.nativeElement as HTMLElement;
  }

  function cardOf(name: string): HTMLElement {
    const card = Array.from(page.querySelectorAll<HTMLElement>('.cluster-card')).find(item => item.querySelector('.cluster-name')?.textContent?.trim() === name);
    if (!card) throw new Error(`No card for ${name}`);
    return card;
  }

  function button(scope: HTMLElement, label: string): HTMLButtonElement | undefined {
    return Array.from(scope.querySelectorAll('button')).find(item => item.textContent?.trim() === label);
  }

  function type(selector: string, value: string): void {
    const input = page.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lists each cluster with the ID ARK is given, and the servers in it', async () => {
    servers$.next([
      { id: 's1', name: 'The Isle', clusterRef: 'c1' },
      { id: 's2', name: 'Ragnarok', clusterRef: 'c1' },
      { id: 's3', name: 'Lonely', clusterRef: null }
    ] as ServerInstance[]);
    await open();

    expect(cardOf('Islands').textContent).toContain('Islands');
    expect(cardOf('Wilds').textContent).toContain('WildsCluster');
    expect(cardOf('Islands').textContent).toContain('The Isle');
    expect(cardOf('Islands').textContent).toContain('Ragnarok');
    expect(cardOf('Islands').textContent).not.toContain('Lonely');
    expect(cardOf('Wilds').textContent).toContain('No servers yet');
  });

  it('says how to start when there are no clusters', async () => {
    clusters$.next([]);
    await open();

    expect(page.textContent).toContain('No clusters yet');
  });

  it('creates a cluster, and empties the form for the next one', async () => {
    clustersService.create.and.returnValue(of({ success: true, cluster: islands }));
    await open();

    type('#cluster-create-name', 'Islands');
    type('#cluster-create-id', 'Islands');
    await settle();
    button(page, 'Create cluster')!.click();
    await settle();

    expect(clustersService.create).toHaveBeenCalledWith('Islands', 'Islands');
    expect(succeeded).toHaveBeenCalled();
    expect(page.querySelector<HTMLInputElement>('#cluster-create-name')!.value).toBe('');
  });

  it('suggests an ID from the name until one is typed', async () => {
    await open();

    type('#cluster-create-name', 'My PvP Cluster!');
    await settle();

    expect(page.querySelector<HTMLInputElement>('#cluster-create-id')!.value).toBe('MyPvPCluster');
  });

  it('says why a cluster could not be made', async () => {
    clustersService.create.and.returnValue(of({ success: false, error: 'Another cluster already uses the ID Islands.' }));
    await open();

    type('#cluster-create-name', 'Again');
    type('#cluster-create-id', 'Islands');
    await settle();
    button(page, 'Create cluster')!.click();
    await settle();

    expect(failed).toHaveBeenCalledWith('Another cluster already uses the ID Islands.');
    expect(page.querySelector<HTMLInputElement>('#cluster-create-name')!.value).toBe('Again');
  });

  it('renames a cluster', async () => {
    clustersService.rename.and.returnValue(of({ success: true }));
    await open();

    button(cardOf('Islands'), 'Rename')!.click();
    await settle();
    const input = page.querySelector<HTMLInputElement>('.cluster-rename-input')!;
    input.value = 'Isles';
    input.dispatchEvent(new Event('input'));
    button(page, 'Save')!.click();
    await settle();

    expect(clustersService.rename).toHaveBeenCalledWith('c1', 'Isles');
    expect(page.querySelector('.cluster-rename-input')).toBeNull();
  });

  it('asks before removing a cluster, saying what happens to its servers and files', async () => {
    clustersService.remove.and.returnValue(of({ success: true }));
    servers$.next([{ id: 's1', name: 'The Isle', clusterRef: 'c1' }] as ServerInstance[]);
    await open();

    button(cardOf('Islands'), 'Remove')!.click();
    await settle();
    expect(clustersService.remove).not.toHaveBeenCalled();
    expect(page.querySelector('.modal-confirmation')?.textContent).toContain('1 server');
    expect(page.querySelector('.modal-confirmation')?.textContent).toContain('transfer files');

    button(page.querySelector('.action-group-modal')!, 'Remove')!.click();
    await settle();

    expect(clustersService.remove).toHaveBeenCalledWith('c1');
  });

  it('offers no changes to a role that cannot manage clusters', async () => {
    canManage = false;
    await open();

    expect(button(page, 'Create cluster')).toBeUndefined();
    expect(button(cardOf('Islands'), 'Rename')).toBeUndefined();
    expect(button(cardOf('Islands'), 'Remove')).toBeUndefined();
  });

  describe('in a mesh', () => {
    const node = (nodeId: string, name: string, clusterSync: Record<string, unknown>, connected = true) =>
      ({ nodeId, name, status: 'active', maintenance: false, connected, clusterSync });

    it('says the app keeps the files on every machine, with no shared folder', async () => {
      meshStatus = { enabled: true, degraded: false, nodeId: 'n1', nodes: [node('n1', 'Desk', {})] };
      await open();

      expect(page.textContent).toContain('every machine in the mesh');
    });

    it('shows each server\'s machine', async () => {
      meshStatus = { enabled: true, degraded: false, nodeId: 'n1', nodes: [node('n1', 'Desk', {}), node('n2', 'Basement', {})] };
      servers$.next([{ id: 's2', name: 'Ragnarok', clusterRef: 'c1', nodeId: 'n2' }] as ServerInstance[]);
      await open();

      expect(cardOf('Islands').textContent).toContain('Ragnarok');
      expect(cardOf('Islands').textContent).toContain('Basement');
    });

    it('shows how each machine\'s copy of a cluster stands', async () => {
      meshStatus = {
        enabled: true, degraded: false, nodeId: 'n1',
        nodes: [
          node('n1', 'Desk', { c1: sync(3) }),
          node('n2', 'Basement', { c1: sync(2, { pendingReceive: 1, conflicts: 1 }) }),
          node('n3', 'Cloud', { c1: sync(0, { error: 'Not enough disk space.' }) }),
          node('n4', 'Laptop', {}, false)
        ]
      };
      await open();

      const rows = Array.from(cardOf('Islands').querySelectorAll('.cluster-sync-row')).map(row => row.textContent?.replace(/\s+/g, ' ').trim());
      expect(rows).toEqual([
        jasmine.stringMatching(/Desk.*Up to date.*3 files/),
        jasmine.stringMatching(/Basement.*Receiving 1.*1 set aside/),
        jasmine.stringMatching(/Cloud.*Not enough disk space\./),
        jasmine.stringMatching(/Laptop.*Unreachable/)
      ]);
    });

    it('tells a cluster\'s players when their upload is ready everywhere, unless turned off', async () => {
      clustersService.setUploadNotices.and.returnValue(of({ success: true }));
      meshStatus = { enabled: true, degraded: false, nodeId: 'n1', nodes: [node('n1', 'Desk', {})] };
      await open();
      const toggle = cardOf('Islands').querySelector<HTMLInputElement>('.cluster-notify-toggle')!;
      expect(toggle.checked).toBeTrue();

      toggle.click();
      await settle();

      expect(clustersService.setUploadNotices).toHaveBeenCalledWith('c1', false);
    });

    it('shows a cluster where it is turned off', async () => {
      clusters$.next([{ ...islands, notifyUploads: false }]);
      meshStatus = { enabled: true, degraded: false, nodeId: 'n1', nodes: [node('n1', 'Desk', {})] };
      await open();

      expect(cardOf('Islands').querySelector<HTMLInputElement>('.cluster-notify-toggle')!.checked).toBeFalse();
    });

    it('holds changes while the mesh is degraded', async () => {
      meshStatus = { enabled: true, degraded: true, nodeId: 'n1', nodes: [node('n1', 'Desk', {})] };
      await open();

      expect(button(page, 'Create cluster')!.disabled).toBeTrue();
      expect(button(cardOf('Islands'), 'Rename')!.disabled).toBeTrue();
      expect(button(cardOf('Islands'), 'Remove')!.disabled).toBeTrue();
    });
  });

  it('shows no machine rows on a machine on its own, nor upload notices, which only a mesh needs', async () => {
    await open();

    expect(page.querySelector('.cluster-sync-row')).toBeNull();
    expect(page.querySelector('.cluster-notify-toggle')).toBeNull();
    expect(page.textContent).toContain('servers on this machine');
  });
});
