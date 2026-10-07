import {
  accountPermission,
  filterInstancesForUser,
  holdsAccountPermission,
  instanceVisibleTo,
  isPoolOwnerIdentity,
  isPoolRole,
  machineScopeRefusal,
  visibleInstanceIds,
  type PoolInstance
} from './pool-access';

const admin = { id: 'a1', roleId: 'admin', ownerUserId: null };
const op1 = { id: 'op1', roleId: 'operator', ownerUserId: null };
const viewerOfOp1 = { id: 'v1', roleId: 'viewer', ownerUserId: 'op1' };
const viewerOfAdmin = { id: 'v0', roleId: 'viewer', ownerUserId: null };
const manager = { id: 'm1', roleId: 'server-manager', ownerUserId: 'op1' };
const attendant = { id: 't1', roleId: 'attendant', ownerUserId: null };
const custom = { id: 'c1', roleId: 'auditors', ownerUserId: null };
const machineAdmin = { id: 'ma1', roleId: 'machine-admin', ownerUserId: null, machineNodeId: 'n1' };

const inOp1 = { id: 's1', operatorUserId: 'op1', managerUserId: 'm1' };
const inOp1Unassigned = { id: 's2', operatorUserId: 'op1', managerUserId: null };
const inAdminPool = { id: 's3', operatorUserId: null, managerUserId: 't1' };
const legacy: { id: string } & PoolInstance = { id: 's4' };

describe('pool-access', () => {
  describe('isPoolRole and accountPermission', () => {
    it('counts server managers, attendants and viewers as pool roles', () => {
      expect(isPoolRole('server-manager')).toBe(true);
      expect(isPoolRole('attendant')).toBe(true);
      expect(isPoolRole('viewer')).toBe(true);
      expect(isPoolRole('operator')).toBe(false);
      expect(isPoolRole('admin')).toBe(false);
    });

    it('maps each pool role to its create and delete permission', () => {
      expect(accountPermission('viewer', 'delete')).toBe('accounts.viewers.delete');
      expect(accountPermission('server-manager', 'create')).toBe('accounts.managers.create');
      expect(accountPermission('attendant', 'create')).toBe('accounts.attendants.create');
      expect(accountPermission('operator', 'create')).toBeNull();
      expect(accountPermission(undefined, 'delete')).toBeNull();
    });

    it('checks whether a permission list holds the account permission', () => {
      expect(holdsAccountPermission(['accounts.viewers.create'], 'viewer', 'create')).toBe(true);
      expect(holdsAccountPermission(['accounts.viewers.create'], 'viewer', 'delete')).toBe(false);
      expect(holdsAccountPermission(['users.manage'], 'viewer', 'create')).toBe(false);
    });

    it('recognises a pool owner by any account permission', () => {
      expect(isPoolOwnerIdentity(['servers.view', 'accounts.attendants.delete'])).toBe(true);
      expect(isPoolOwnerIdentity(['servers.view', 'users.manage'])).toBe(false);
    });
  });

  describe('instanceVisibleTo', () => {
    it('shows an operator only the servers in their pool', () => {
      expect(instanceVisibleTo(op1, inOp1)).toBe(true);
      expect(instanceVisibleTo(op1, inOp1Unassigned)).toBe(true);
      expect(instanceVisibleTo(op1, inAdminPool)).toBe(false);
      expect(instanceVisibleTo(op1, legacy)).toBe(false);
    });

    it('shows a viewer the whole pool of their owner', () => {
      expect(instanceVisibleTo(viewerOfOp1, inOp1Unassigned)).toBe(true);
      expect(instanceVisibleTo(viewerOfOp1, inAdminPool)).toBe(false);
      expect(instanceVisibleTo(viewerOfAdmin, inAdminPool)).toBe(true);
      expect(instanceVisibleTo(viewerOfAdmin, legacy)).toBe(true);
      expect(instanceVisibleTo(viewerOfAdmin, inOp1)).toBe(false);
    });

    it('shows a server manager or attendant only the servers assigned to them', () => {
      expect(instanceVisibleTo(manager, inOp1)).toBe(true);
      expect(instanceVisibleTo(manager, inOp1Unassigned)).toBe(false);
      expect(instanceVisibleTo(attendant, inAdminPool)).toBe(true);
      expect(instanceVisibleTo(attendant, inOp1)).toBe(false);
    });

    it('hides a server from an assignee whose pool it has left', () => {
      // A config can say "assigned to m1" while the server sits in another pool; the assignment
      // must not widen what m1 sees.
      expect(instanceVisibleTo(manager, { operatorUserId: null, managerUserId: 'm1' })).toBe(false);
      expect(instanceVisibleTo(manager, { operatorUserId: 'op2', managerUserId: 'm1' })).toBe(false);
    });

    it('keeps a role the app does not know inside the admin pool', () => {
      expect(instanceVisibleTo(custom, inAdminPool)).toBe(true);
      expect(instanceVisibleTo(custom, legacy)).toBe(true);
      expect(instanceVisibleTo(custom, inOp1)).toBe(false);
    });

    // Above the operators: one machine's admin keeps an eye on the whole mesh.
    it('shows a machine admin every server, in every pool', () => {
      expect(instanceVisibleTo(machineAdmin, inOp1)).toBe(true);
      expect(instanceVisibleTo(machineAdmin, inAdminPool)).toBe(true);
      expect(instanceVisibleTo(machineAdmin, legacy)).toBe(true);
    });

    it('shows nothing to nobody', () => {
      expect(instanceVisibleTo(null, inAdminPool)).toBe(false);
      expect(instanceVisibleTo(op1, null)).toBe(false);
    });
  });

  describe('machineScopeRefusal', () => {
    it('lets a machine admin act on the servers of its own machine only', () => {
      expect(machineScopeRefusal(machineAdmin, 'n1')).toBeNull();
      expect(machineScopeRefusal(machineAdmin, 'n2')).toBe('That server is on another machine. A machine admin changes only the servers on its own machine.');
    });

    it('never narrows anyone else', () => {
      expect(machineScopeRefusal(op1, 'n2')).toBeNull();
      expect(machineScopeRefusal(admin, 'n2')).toBeNull();
    });

    it('refuses a machine admin with no machine', () => {
      expect(machineScopeRefusal({ ...machineAdmin, machineNodeId: null }, 'n1')).not.toBeNull();
    });
  });

  describe('filterInstancesForUser and visibleInstanceIds', () => {
    const all = [inOp1, inOp1Unassigned, inAdminPool, legacy];

    it('returns everything for an admin and nothing for nobody', () => {
      expect(filterInstancesForUser(admin, all)).toBe(all);
      expect(filterInstancesForUser(null, all)).toEqual([]);
      expect(visibleInstanceIds(admin, all)).toBeNull();
    });

    it('narrows the list to what the user may see', () => {
      expect(filterInstancesForUser(op1, all).map(i => i.id)).toEqual(['s1', 's2']);
      expect([...visibleInstanceIds(manager, all)!]).toEqual(['s1']);
      expect([...visibleInstanceIds(null, all)!]).toEqual([]);
    });
  });
});
