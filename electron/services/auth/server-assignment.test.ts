import { filterBroadcastForUser, filterInstancesForUser, instanceIdsInPayload, canAssignServerManager } from './server-assignment';
import { ROLE_IDS } from '../../types/auth.types';

const manager = { id: 'user-1', roleId: ROLE_IDS.SERVER_MANAGER, ownerUserId: 'user-2' };
const operator = { id: 'user-2', roleId: ROLE_IDS.OPERATOR, ownerUserId: null };
const servers = [
  { id: 'a', name: 'Calmaria Playthrough', managerUserId: 'user-1', operatorUserId: 'user-2' },
  { id: 'b', name: 'Admin Island', managerUserId: null, operatorUserId: null },
  { id: 'c', name: 'Other group', managerUserId: 'user-9', operatorUserId: 'user-9' }
];

describe('server assignment', () => {
  it('keeps only the operator own group', () => {
    expect(filterInstancesForUser(operator, servers).map(server => server.id)).toEqual(['a']);
  });

  it('keeps only the servers assigned to a server manager', () => {
    expect(filterInstancesForUser(manager, servers).map(server => server.id)).toEqual(['a']);
  });

  it('keeps only the servers assigned to an attendant', () => {
    const attendant = { id: 'user-3', roleId: ROLE_IDS.ATTENDANT, ownerUserId: 'user-2' };
    const assigned = [
      { id: 'a', name: 'Calmaria Playthrough', managerUserId: 'user-1', operatorUserId: 'user-2' },
      { id: 'd', name: 'Island', managerUserId: 'user-3', operatorUserId: 'user-2' }
    ];
    expect(filterInstancesForUser(attendant, assigned).map(server => server.id)).toEqual(['d']);
  });

  it('lets a viewer see only their operator group', () => {
    const viewer = { id: 'user-4', roleId: ROLE_IDS.VIEWER, ownerUserId: 'user-2' };
    expect(filterInstancesForUser(viewer, servers).map(server => server.id)).toEqual(['a']);
  });

  it('lets an admin-pool viewer see only admin-pool servers', () => {
    const viewer = { id: 'user-5', roleId: ROLE_IDS.VIEWER, ownerUserId: null };
    expect(filterInstancesForUser(viewer, servers).map(server => server.id)).toEqual(['b']);
  });

  it('hides an update for a server that belongs to someone else', () => {
    expect(filterBroadcastForUser('server-instance-updated', servers[1], manager)).toBeUndefined();
    expect(filterBroadcastForUser('server-instance-updated', servers[0], manager)).toEqual(servers[0]);
    expect(filterBroadcastForUser('server-instance-updated', servers[2], operator)).toBeUndefined();
  });

  it('filters a broadcast list the same way', () => {
    expect(filterBroadcastForUser('server-instances', servers, manager)).toEqual([servers[0]]);
    expect(filterBroadcastForUser('server-instances', servers, null)).toEqual(servers);
  });

  it('reads instance ids from the payload shapes the handlers use', () => {
    expect(instanceIdsInPayload({ instanceId: 'a', requestId: '1' })).toEqual(['a']);
    expect(instanceIdsInPayload({ instance: { id: 'b' } })).toEqual(['b']);
    expect(instanceIdsInPayload({ orderedIds: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(instanceIdsInPayload({ requestId: '1' })).toEqual([]);
  });

  it('lets an admin or operator assign, and not a server manager', () => {
    expect(canAssignServerManager({ user: null, permissions: [], isAdmin: true, isLocalDesktop: true })).toBe(true);
    expect(canAssignServerManager({
      user: { id: 'op', username: 'op', displayName: 'op', roleId: ROLE_IDS.OPERATOR, roleName: 'Operator', ownerUserId: null, permissions: [], active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null },
      permissions: [],
      isAdmin: false,
      isLocalDesktop: false
    })).toBe(true);
    expect(canAssignServerManager({
      user: { id: 'sm', username: 'sm', displayName: 'sm', roleId: ROLE_IDS.SERVER_MANAGER, roleName: 'Server Manager', ownerUserId: 'op', permissions: [], active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null },
      permissions: [],
      isAdmin: false,
      isLocalDesktop: false
    })).toBe(false);
  });
});
