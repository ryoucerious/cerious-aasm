import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { ClusterTabComponent } from './cluster-tab.component';
import { ClusterOption, ClustersService } from '../../../../core/services/clusters.service';
import { SettingsDrawerService } from '../../../../core/services/settings-drawer.service';
import { ServerInstance } from '../../../../core/models/server-instance.model';

describe('ClusterTabComponent', () => {
  let component: ClusterTabComponent;
  let fixture: ComponentFixture<ClusterTabComponent>;
  let clusters$: BehaviorSubject<ClusterOption[]>;
  let openSettings: jasmine.Spy;

  const islands: ClusterOption = { clusterId: 'c1', name: 'Islands', arkClusterId: 'Islands', managed: true };
  const wilds: ClusterOption = { clusterId: 'c2', name: 'Wilds', arkClusterId: 'WildsCluster', managed: true };

  beforeEach(async () => {
    clusters$ = new BehaviorSubject<ClusterOption[]>([islands, wilds]);
    openSettings = jasmine.createSpy('open');
    await TestBed.configureTestingModule({
      imports: [ClusterTabComponent],
      providers: [
        { provide: ClustersService, useValue: { clusters$: clusters$.asObservable() } },
        { provide: SettingsDrawerService, useValue: { open: openSettings } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ClusterTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const page = () => fixture.nativeElement as HTMLElement;
  const select = () => page().querySelector<HTMLSelectElement>('#cluster-choice')!;

  async function show(server: Partial<ServerInstance>, inputs: Record<string, unknown> = {}): Promise<void> {
    fixture.componentRef.setInput('serverInstance', server);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function choose(label: string): void {
    const option = Array.from(select().options).find(item => item.textContent?.trim().startsWith(label));
    if (!option) throw new Error(`No option ${label}`);
    select().value = option.value;
    select().dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('offers no cluster, each cluster from Settings → Clusters, and a folder of the server\'s own', async () => {
    await show({});

    expect(Array.from(select().options).map(option => option.textContent?.trim())).toEqual([
      'None', 'Islands (Islands)', 'Wilds (WildsCluster)', 'Own folder (advanced)'
    ]);
  });

  it('shows the cluster a server is in', async () => {
    await show({ clusterRef: 'c2' });

    expect(select().selectedOptions[0].textContent?.trim()).toBe('Wilds (WildsCluster)');
  });

  it('puts the server in the cluster chosen, and saves', async () => {
    const server: Partial<ServerInstance> = {};
    await show(server);
    spyOn(component.saveSettings, 'emit');

    choose('Islands');

    expect(server.clusterRef).toBe('c1');
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('takes a server out of every cluster for None', async () => {
    const server: Partial<ServerInstance> = { clusterId: 'Mine', clusterDirOverride: 'D:/clusters' };
    await show(server);
    spyOn(component.saveSettings, 'emit');

    choose('None');

    expect(server.clusterRef).toBeNull();
    expect(server.clusterId).toBe('');
    expect(server.clusterDirOverride).toBe('');
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  describe('a folder of the server\'s own', () => {
    it('is how a server set up before clusters were in Settings shows', async () => {
      await show({ clusterId: 'Mine' });

      expect(select().selectedOptions[0].textContent?.trim()).toBe('Own folder (advanced)');
      expect(page().textContent).toContain('Cluster Directory Path');
    });

    it('keeps its fields out of the way for a server in a cluster', async () => {
      await show({ clusterRef: 'c1', clusterId: 'Mine' });

      expect(page().textContent).not.toContain('Cluster Directory Path');
    });

    it('shows its fields once chosen', async () => {
      const server: Partial<ServerInstance> = {};
      await show(server);

      choose('Own folder');

      expect(server.clusterRef).toBeNull();
      expect(page().textContent).toContain('Cluster Directory Path');
    });
  });

  it('says the uploads under the server\'s own ID go with it into the cluster', async () => {
    await show({ clusterRef: 'c1', clusterId: 'Mine' });

    expect(page().textContent).toContain('Mine');
    expect(page().textContent).toContain('next start');
  });

  it('says when the server\'s cluster was removed', async () => {
    await show({ clusterRef: 'gone' });

    expect(page().textContent).toContain('was removed');
  });

  it('says the app keeps a mesh cluster\'s files on every machine', async () => {
    await show({ clusterRef: 'c1' });

    expect(page().textContent).toContain('every machine');
  });

  it('leads to Settings → Clusters, where clusters are made', async () => {
    clusters$.next([]);
    await show({});

    Array.from(page().querySelectorAll('button')).find(button => button.textContent?.includes('Manage clusters'))!.click();

    expect(openSettings).toHaveBeenCalledWith('clusters');
  });

  it('cannot be changed while the server is locked', async () => {
    await show({}, { isLocked: true });

    expect(select().disabled).toBeTrue();
  });

  it('should emit validateField on onValidateField', () => {
    spyOn(component.validateField, 'emit');
    component.onValidateField('clusterSetting', 'value');
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'clusterSetting', value: 'value'});
  });

  it('asks the host to test the cluster directory', () => {
    spyOn(component.testConnectivity, 'emit');
    component.testClusterConnectivity();
    expect(component.testConnectivity.emit).toHaveBeenCalled();
  });

  describe('the directory test', () => {
    const testButton = () => Array.from(page().querySelectorAll('button'))
      .find(button => button.textContent?.includes('Test Cluster Directory Connection'));

    it('is offered in the desktop app', async () => {
      await show({ clusterDirOverride: 'D:/ark-cluster' }, { isElectron: true });
      expect(testButton()).toBeTruthy();
    });

    it('is not offered in the web UI, where the backend refuses it', async () => {
      await show({ clusterDirOverride: 'D:/ark-cluster' }, { isElectron: false });
      expect(testButton()).toBeUndefined();
    });
  });

  it('shows validation messages for its fields', async () => {
    await show({ clusterId: 'bad id' }, { fieldErrors: { clusterId: 'Cluster ID contains invalid characters' } });
    expect(page().querySelector('.validation-error')?.textContent).toContain('Cluster ID contains invalid characters');
  });
});
