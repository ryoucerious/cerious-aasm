import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { PoolDirectoryService } from './pool-directory.service';
import { AuthService } from './auth.service';
import { MessagingService } from './messaging/messaging.service';
import { CurrentIdentity, PoolLabel } from '../models/auth.model';

describe('PoolDirectoryService', () => {
  let identity$: BehaviorSubject<CurrentIdentity>;
  let channels: Record<string, Subject<unknown>>;
  let listPoolLabels: jasmine.Spy;
  let labels: { operators: PoolLabel[]; assignees: PoolLabel[] };

  const admin: CurrentIdentity = { user: null, isLocalDesktop: true, isAdmin: true, permissions: [], accountsInUse: true };
  const signedOut: CurrentIdentity = { user: null, isLocalDesktop: false, isAdmin: false, permissions: [], accountsInUse: true };

  function create(): PoolDirectoryService {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { identity$: identity$.asObservable(), get identity() { return identity$.value; }, listPoolLabels } },
        { provide: MessagingService, useValue: { receiveMessage: (channel: string) => channels[channel] ??= new Subject<unknown>() } }
      ]
    });
    return TestBed.inject(PoolDirectoryService);
  }

  beforeEach(() => {
    identity$ = new BehaviorSubject<CurrentIdentity>(admin);
    channels = {};
    labels = {
      operators: [{ id: 'op1', username: 'ops', displayName: 'Ops Team', roleName: 'Operator' }],
      assignees: [
        { id: 'm1', username: 'mia', displayName: 'mia', roleName: 'Server Manager' },
        { id: 't1', username: 'tom', displayName: '', roleName: 'Attendant' }
      ]
    };
    listPoolLabels = jasmine.createSpy('listPoolLabels').and.callFake(() => Promise.resolve(labels));
  });

  it('labels a server by its operator and assignee, with the role', async () => {
    const directory = create();
    await directory.reload();

    expect(directory.operatorLabel({ operatorUserId: 'op1' })).toBe('Ops Team (ops)');
    expect(directory.assigneeLabel({ managerUserId: 'm1' })).toBe('Server Manager · mia');
    expect(directory.assigneeLabel({ managerUserId: 't1' })).toBe('Attendant · tom');
  });

  it('names the admin pool and an unassigned server, and falls back for ids it does not know', async () => {
    const directory = create();
    await directory.reload();

    expect(directory.operatorLabel({ operatorUserId: null })).toBe('Admin');
    expect(directory.operatorLabel(undefined)).toBe('Admin');
    expect(directory.assigneeLabel({ managerUserId: null })).toBe('Not assigned');
    expect(directory.operatorLabel({ operatorUserId: 'ghost' })).toBe('Operator');
    expect(directory.assigneeLabel({ managerUserId: 'ghost' })).toBe('Not assigned');
  });

  it('reloads when the identity changes, when accounts change and when the server list changes', async () => {
    create();
    await Promise.resolve();
    expect(listPoolLabels).toHaveBeenCalledTimes(1);

    channels['users-changed'].next({});
    channels['server-instances'].next([]);
    identity$.next({ ...admin });
    await Promise.resolve();

    expect(listPoolLabels).toHaveBeenCalledTimes(4);
  });

  it('asks nothing while nobody is signed in, and clears what it knew', async () => {
    const directory = create();
    await Promise.resolve();
    identity$.next(signedOut);
    await Promise.resolve();

    expect(listPoolLabels).toHaveBeenCalledTimes(1);
    expect(directory.operatorLabel({ operatorUserId: 'op1' })).toBe('Operator');
  });
});
