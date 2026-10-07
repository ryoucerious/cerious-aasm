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

  describe('where a server can move to', () => {
    const member = (nodeId: string, extra: object = {}) => ({ nodeId, name: nodeId.toUpperCase(), status: 'alive', maintenance: false, connected: true, ...extra });

    it('offers the connected members that are not draining, other than the one hosting it', () => {
      reply = {
        enabled: true,
        nodeId: 'here',
        nodes: [
          member('here'), member('box'),
          member('draining', { maintenance: true, status: 'maintenance' }),
          member('down', { connected: false }),
          member('gone', { status: 'removed', connected: false })
        ]
      };
      const nodes = create();

      expect(nodes.destinationsFor({ nodeId: 'here' })).toEqual([{ nodeId: 'box', name: 'BOX' }]);
      expect(nodes.destinationsFor({ nodeId: 'box' })).toEqual([{ nodeId: 'here', name: 'HERE' }]);
    });

    it('treats a server without a node as one on this machine', () => {
      reply = { enabled: true, nodeId: 'here', nodes: [member('here'), member('box')] };

      expect(create().destinationsFor({})).toEqual([{ nodeId: 'box', name: 'BOX' }]);
    });

    it('offers nowhere outside a mesh', () => {
      reply = { enabled: false, nodes: [] };

      expect(create().destinationsFor({ nodeId: 'here' })).toEqual([]);
    });
  });

  // Players need a stable name to connect to, not whatever IP the panel was opened on.
  describe('the host players connect to', () => {
    const member = (nodeId: string, host: string) => ({ nodeId, name: nodeId, status: 'alive', maintenance: false, connected: true, host });

    beforeEach(() => {
      reply = { enabled: true, nodeId: 'here', nodes: [member('here', 'ark.example.com'), member('dallas', 'dallas.example.com')] };
    });

    it('is the address of the machine running the server', () => {
      expect(create().joinHostFor({ nodeId: 'dallas' }, 'panel.example.com')).toBe('dallas.example.com');
    });

    it('is the name the page was opened by, for a server here, when other machines can use that name', () => {
      expect(create().joinHostFor({ nodeId: 'here' }, 'panel.example.com')).toBeNull();
    });

    it('is this machine\'s address, for a server here, from the desktop app or localhost', () => {
      expect(create().joinHostFor({ nodeId: 'here' }, 'localhost')).toBe('ark.example.com');
    });

    it('is not known outside a mesh', () => {
      reply = { enabled: false, nodes: [] };

      expect(create().joinHostFor({}, 'localhost')).toBeNull();
    });
  });

  describe('where a new server can go', () => {
    const member = (nodeId: string, extra: object = {}) => ({ nodeId, name: nodeId.toUpperCase(), status: 'alive', maintenance: false, connected: true, ...extra });

    it('offers each reachable member, saying which skip new servers', () => {
      reply = {
        enabled: true,
        nodeId: 'here',
        nodes: [
          member('here'),
          member('skipping', { maintenance: true, status: 'maintenance' }),
          member('down', { connected: false }),
          member('gone', { status: 'removed', connected: false })
        ]
      };

      expect(create().placementChoices()).toEqual([
        { nodeId: 'here', name: 'HERE', skipping: false },
        { nodeId: 'skipping', name: 'SKIPPING', skipping: true }
      ]);
    });

    it('offers no choice outside a mesh', () => {
      reply = { enabled: false, nodes: [] };

      expect(create().placementChoices()).toEqual([]);
    });
  });

  it('asks again after a sign-in', () => {
    reply = { enabled: false };
    const nodes = create();
    reply = inMesh;

    channels['mesh-auth-changed'].next({});

    expect(nodes.nameOf('n1')).toBe('Jareds-PC');
  });
});
