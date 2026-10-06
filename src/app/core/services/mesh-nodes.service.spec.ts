import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { MeshNodesService } from './mesh-nodes.service';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

describe('MeshNodesService', () => {
  let channels: Record<string, Subject<unknown>>;
  let reply: unknown;
  let sendMessage: jasmine.Spy;
  let connected$: BehaviorSubject<boolean>;

  const inMesh = { enabled: true, nodes: [{ nodeId: 'n1', name: 'Jareds-PC' }, { nodeId: 'n2', name: 'Basement Box' }] };

  function create(isElectron = true): MeshNodesService {
    channels = {};
    connected$ = new BehaviorSubject(false);
    sendMessage = jasmine.createSpy('sendMessage').and.callFake(() => of(reply));
    TestBed.configureTestingModule({
      providers: [
        MeshNodesService,
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
    return TestBed.inject(MeshNodesService);
  }

  it('names the machine each server runs on', () => {
    reply = inMesh;
    const nodes = create();

    expect(nodes.nameOf('n2')).toBe('Basement Box');
    expect(nodes.nameOf('unknown')).toBe('');
    expect(nodes.nameOf(undefined)).toBe('');
  });

  it('names nothing outside a mesh', () => {
    reply = { enabled: false, nodes: [] };

    expect(create().nameOf('n1')).toBe('');
  });

  it('follows renames and a machine leaving the mesh, and says when they happen', () => {
    reply = inMesh;
    const nodes = create();
    const heard = jasmine.createSpy('changed');
    nodes.changed$.subscribe(heard);
    heard.calls.reset();

    channels['mesh-status'].next({ enabled: true, nodes: [{ nodeId: 'n1', name: 'Desk' }] });

    expect(nodes.nameOf('n1')).toBe('Desk');
    expect(nodes.nameOf('n2')).toBe('');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('asks the web server once its socket is up, when a request can be answered', () => {
    reply = inMesh;
    const nodes = create(false);
    expect(sendMessage).not.toHaveBeenCalled();

    connected$.next(true);

    expect(nodes.nameOf('n1')).toBe('Jareds-PC');
  });

  it('asks again after a sign-in', () => {
    reply = { enabled: false };
    const nodes = create();
    reply = inMesh;

    channels['mesh-auth-changed'].next({});

    expect(nodes.nameOf('n1')).toBe('Jareds-PC');
  });
});
