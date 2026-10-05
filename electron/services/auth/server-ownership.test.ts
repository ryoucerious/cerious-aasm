import { applyServerOwnership, assigneeRefusal, canAssignFor, operatorRefusal } from './server-ownership';
import type { SenderIdentity } from './permission-gate';
import type { InstanceConfig } from '../../types/server-instance.types';
import { AuthenticatedUser, BUILT_IN_ROLES, User } from '../../types/auth.types';

function user(id: string, roleId: string, ownerUserId: string | null = null, active = true): User {
  return { id, username: id, displayName: id, roleId, active, ownerUserId, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null };
}

const people: Record<string, User> = {
  op1: user('op1', 'operator'),
  op2: user('op2', 'operator'),
  m1: user('m1', 'server-manager', 'op1'),
  m2: user('m2', 'server-manager', 'op2'),
  t0: user('t0', 'attendant', null),
  v1: user('v1', 'viewer', 'op1'),
  gone: user('gone', 'operator', null, false)
};
const lookup = (id: string) => people[id] ?? null;

function identityOf(id: string | null, permissions: AuthenticatedUser['permissions'] = []): SenderIdentity {
  if (!id) return { user: null, permissions: [], isAdmin: true, isLocalDesktop: true };
  const account = people[id];
  const role = BUILT_IN_ROLES.find(r => r.id === account.roleId);
  return {
    user: { ...account, roleName: account.roleId, permissions: permissions.length ? permissions : role?.permissions ?? [] },
    permissions: permissions.length ? permissions : role?.permissions ?? [],
    isAdmin: account.roleId === 'admin',
    isLocalDesktop: false
  };
}

const admin = identityOf(null);
const inOp1 = { id: 's1', operatorUserId: 'op1', managerUserId: 'm1' } as InstanceConfig;

describe('server-ownership', () => {
  describe('on a new server', () => {
    it('puts an operator\'s server in their pool', () => {
      const instance: Partial<InstanceConfig> = { name: 'new' };

      expect(applyServerOwnership(instance, null, identityOf('op1'), lookup)).toBeNull();
      expect(instance.operatorUserId).toBe('op1');
      expect(instance.managerUserId).toBeUndefined();
    });

    it('lets an admin choose the pool and refuses a non-operator', () => {
      const chosen: Partial<InstanceConfig> = { name: 'new', operatorUserId: 'op2' };
      expect(applyServerOwnership(chosen, null, admin, lookup)).toBeNull();
      expect(chosen.operatorUserId).toBe('op2');

      expect(applyServerOwnership({ operatorUserId: 'm1' }, null, admin, lookup)).toBe('Choose an active operator for this server.');
      expect(applyServerOwnership({ operatorUserId: 'gone' }, null, admin, lookup)).toBe('Choose an active operator for this server.');
    });

    it('leaves the admin pool implicit when an admin names no operator', () => {
      const instance: Partial<InstanceConfig> = { name: 'new' };

      expect(applyServerOwnership(instance, null, admin, lookup)).toBeNull();
      expect('operatorUserId' in instance).toBe(false);
    });

    it('assigns a creating server manager to themselves in their owner\'s pool', () => {
      const instance: Partial<InstanceConfig> = { name: 'new' };

      expect(applyServerOwnership(instance, null, identityOf('m1', ['servers.create']), lookup)).toBeNull();
      expect(instance).toMatchObject({ operatorUserId: 'op1', managerUserId: 'm1' });
    });
  });

  describe('on an existing server', () => {
    it('keeps the stored pool and assignee when a non-admin edits', () => {
      const instance: Partial<InstanceConfig> = { id: 's1', name: 'renamed', operatorUserId: 'op2', managerUserId: 'm2' };

      expect(applyServerOwnership(instance, inOp1, identityOf('m1'), lookup)).toBeNull();
      expect(instance).toMatchObject({ operatorUserId: 'op1', managerUserId: 'm1' });
    });

    it('refuses an operator editing a server in another pool', () => {
      expect(applyServerOwnership({ id: 's1' }, inOp1, identityOf('op2'), lookup)).toBe('That server is not in your pool.');
    });

    it('lets the pool\'s operator change the assignee but not the pool', () => {
      const instance: Partial<InstanceConfig> = { id: 's1', operatorUserId: 'op2', managerUserId: null };

      expect(applyServerOwnership(instance, inOp1, identityOf('op1'), lookup)).toBeNull();
      expect(instance).toMatchObject({ operatorUserId: 'op1', managerUserId: null });
    });

    it('fills in fields the payload leaves out from the stored config', () => {
      const instance: Partial<InstanceConfig> = { id: 's1', name: 'renamed' };

      expect(applyServerOwnership(instance, inOp1, admin, lookup)).toBeNull();
      expect(instance).toMatchObject({ operatorUserId: 'op1', managerUserId: 'm1' });

      const bare: Partial<InstanceConfig> = { id: 's0', name: 'renamed' };
      expect(applyServerOwnership(bare, { id: 's0' } as InstanceConfig, admin, lookup)).toBeNull();
      expect('operatorUserId' in bare).toBe(false);
    });

    it('refuses an assignee from another pool or who cannot be assigned', () => {
      expect(applyServerOwnership({ id: 's1', managerUserId: 'm2' }, inOp1, admin, lookup)).toBe('That person is not in this server\'s pool.');
      expect(applyServerOwnership({ id: 's1', managerUserId: 'v1' }, inOp1, admin, lookup)).toBe('Choose an active server manager or attendant.');
      expect(applyServerOwnership({ id: 's1', managerUserId: 'nobody' }, inOp1, admin, lookup)).toBe('Choose an active server manager or attendant.');
    });

    it('clears an assignee left behind when an admin moves the server to another pool', () => {
      const instance: Partial<InstanceConfig> = { id: 's1', operatorUserId: 'op2' };

      expect(applyServerOwnership(instance, inOp1, admin, lookup)).toBeNull();
      expect(instance).toMatchObject({ operatorUserId: 'op2', managerUserId: null });
    });

    it('keeps an assignee who is in the pool the server moves to', () => {
      const instance: Partial<InstanceConfig> = { id: 's1', operatorUserId: 'op2', managerUserId: 'm2' };

      expect(applyServerOwnership(instance, inOp1, admin, lookup)).toBeNull();
      expect(instance).toMatchObject({ operatorUserId: 'op2', managerUserId: 'm2' });
    });

    it('validates a new assignee against the pool the server is moving to, including the admin pool', () => {
      expect(applyServerOwnership({ id: 's1', operatorUserId: null, managerUserId: 't0' }, inOp1, admin, lookup)).toBeNull();
      expect(applyServerOwnership({ id: 's1', operatorUserId: null, managerUserId: 'm2' }, inOp1, admin, lookup))
        .toBe('That person is not in this server\'s pool.');
      // Re-sending the stored assignee with a pool move is a leftover, not a choice: dropped, not refused.
      const leftover: Partial<InstanceConfig> = { id: 's1', operatorUserId: null, managerUserId: 'm1' };
      expect(applyServerOwnership(leftover, inOp1, admin, lookup)).toBeNull();
      expect(leftover.managerUserId).toBeNull();
    });

    it('keeps a stale assignee id when the caller does not touch it', () => {
      const stale = { id: 's9', operatorUserId: 'op1', managerUserId: 'deleted' } as InstanceConfig;
      const instance: Partial<InstanceConfig> = { id: 's9', name: 'renamed' };

      expect(applyServerOwnership(instance, stale, admin, lookup)).toBeNull();
      expect(instance.managerUserId).toBe('deleted');
    });
  });

  it('answers who may assign and validates operators and assignees on their own', () => {
    expect(canAssignFor(admin, inOp1)).toBe(true);
    expect(canAssignFor(identityOf('op1'), inOp1)).toBe(true);
    expect(canAssignFor(identityOf('op2'), inOp1)).toBe(false);
    expect(canAssignFor(identityOf('m1'), inOp1)).toBe(false);
    expect(operatorRefusal('op1', lookup)).toBeNull();
    expect(assigneeRefusal('t0', null, lookup)).toBeNull();
    expect(assigneeRefusal('t0', 'op1', lookup)).toBe('That person is not in this server\'s pool.');
    expect(assigneeRefusal(null, 'op1', lookup)).toBeNull();
  });
});
