import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { ClusterOption, ClustersService } from './clusters.service';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

describe('ClustersService', () => {
  let channels: Record<string, Subject<unknown>>;
  let replies: Record<string, unknown>;
  let sendMessage: jasmine.Spy;
  let connected$: BehaviorSubject<boolean>;

  const islands: ClusterOption = { clusterId: 'c1', name: 'Islands', arkClusterId: 'Islands' };
  const wilds: ClusterOption = { clusterId: 'c2', name: 'Wilds', arkClusterId: 'Wilds' };

  function create(isElectron = true): ClustersService {
    channels = {};
    connected$ = new BehaviorSubject(false);
    sendMessage = jasmine.createSpy('sendMessage').and.callFake((channel: string) => of(replies[channel]));
    TestBed.configureTestingModule({
      providers: [
        ClustersService,
        {
          provide: MessagingService,
          useValue: {
            sendMessage,
            receiveMessage: (channel: string) => (channels[channel] = channels[channel] || new Subject<unknown>()).asObservable()
          }
        },
        { provide: WebSocketService, useValue: { connected$ } },
        { provide: IpcService, useValue: { isElectron } }
      ]
    });
    return TestBed.inject(ClustersService);
  }

  beforeEach(() => {
    replies = { 'get-clusters': { success: true, clusters: [islands] } };
  });

  it('lists the clusters a server can join, by name', () => {
    const clusters = create();

    expect(clusters.clusters).toEqual([islands]);
    expect(clusters.nameOf('c1')).toBe('Islands');
    expect(clusters.nameOf('gone')).toBe('');
    expect(clusters.nameOf(null)).toBe('');
  });

  // A request before the web UI's socket is up is dropped.
  it('asks in the web UI once its socket is up', () => {
    const clusters = create(false);
    expect(sendMessage).not.toHaveBeenCalled();

    connected$.next(true);

    expect(clusters.clusters).toEqual([islands]);
  });

  it('asks again when the clusters change, here or on another machine', () => {
    const clusters = create();
    replies['get-clusters'] = { success: true, clusters: [islands, wilds] };

    channels['clusters-changed'].next({});

    expect(clusters.clusters).toEqual([islands, wilds]);
  });

  it('asks again when this machine joins or leaves a mesh, which then holds the clusters', () => {
    const clusters = create();
    channels['mesh-status'].next({ enabled: false });
    replies['get-clusters'] = { success: true, clusters: [wilds] };
    sendMessage.calls.reset();

    channels['mesh-status'].next({ enabled: false });
    expect(sendMessage).not.toHaveBeenCalled();
    channels['mesh-status'].next({ enabled: true });

    expect(clusters.clusters).toEqual([wilds]);
  });

  it('keeps the list it has when asking fails', () => {
    const clusters = create();
    replies['get-clusters'] = { success: false, error: 'Your role cannot see clusters.' };

    channels['clusters-changed'].next({});

    expect(clusters.clusters).toEqual([islands]);
  });

  it('creates, renames and removes clusters, passing on what the app answers', () => {
    const clusters = create();
    replies['create-cluster'] = { success: true, cluster: islands };
    replies['rename-cluster'] = { success: false, error: 'That cluster was not found.' };
    replies['delete-cluster'] = { success: true };
    const answers: unknown[] = [];

    clusters.create('Islands', 'Islands').subscribe(answer => answers.push(answer));
    clusters.rename('c1', 'Isles').subscribe(answer => answers.push(answer));
    clusters.remove('c1').subscribe(answer => answers.push(answer));

    expect(sendMessage).toHaveBeenCalledWith('create-cluster', { name: 'Islands', arkClusterId: 'Islands' });
    expect(sendMessage).toHaveBeenCalledWith('rename-cluster', { clusterId: 'c1', name: 'Isles' });
    expect(sendMessage).toHaveBeenCalledWith('delete-cluster', { clusterId: 'c1' });
    expect(answers).toEqual([{ success: true, cluster: islands }, { success: false, error: 'That cluster was not found.' }, { success: true }]);
  });
});
