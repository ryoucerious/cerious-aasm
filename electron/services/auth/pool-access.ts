import { PERMISSIONS, Permission, ROLE_IDS } from '../../types/auth.types';

/** Server managers, attendants, and viewers live under an operator. Operators do not. */
export function isPoolRole(roleId: string | null | undefined): boolean {
  return roleId === ROLE_IDS.SERVER_MANAGER || roleId === ROLE_IDS.ATTENDANT || roleId === ROLE_IDS.VIEWER;
}

/**
 * The permission that allows creating or deleting one kind of pool account.
 * Kept separate so an operator can be allowed to add a server manager without
 * also being allowed to delete one, and the same for attendants and viewers.
 * Mirrors accountPermissionFor in src/app/core/models/auth.model.ts.
 */
export function accountPermission(roleId: string | null | undefined, action: 'create' | 'delete'): Permission | null {
  if (roleId === ROLE_IDS.SERVER_MANAGER) {
    return action === 'create' ? PERMISSIONS.ACCOUNTS_MANAGERS_CREATE : PERMISSIONS.ACCOUNTS_MANAGERS_DELETE;
  }
  if (roleId === ROLE_IDS.ATTENDANT) {
    return action === 'create' ? PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE : PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE;
  }
  if (roleId === ROLE_IDS.VIEWER) {
    return action === 'create' ? PERMISSIONS.ACCOUNTS_VIEWERS_CREATE : PERMISSIONS.ACCOUNTS_VIEWERS_DELETE;
  }
  return null;
}

export function holdsAccountPermission(
  permissions: Permission[] | undefined,
  roleId: string | null | undefined,
  action: 'create' | 'delete'
): boolean {
  const required = accountPermission(roleId, action);
  return !!required && !!permissions && permissions.includes(required);
}

/**
 * Which servers this account may see.
 * Admin is not passed here. A role this app does not know stays in the admin pool,
 * so it cannot see an operator's servers.
 */
export function instanceVisibleTo(
  user: { id?: string; roleId?: string; ownerUserId?: string | null } | null | undefined,
  instance: { managerUserId?: string | null; operatorUserId?: string | null } | null | undefined
): boolean {
  if (!user?.id || !instance) return false;
  const serverOperator = instance.operatorUserId || null;
  if (user.roleId === ROLE_IDS.OPERATOR) return serverOperator === user.id;
  if (user.roleId === ROLE_IDS.VIEWER) return serverOperator === (user.ownerUserId || null);
  if (user.roleId === ROLE_IDS.SERVER_MANAGER || user.roleId === ROLE_IDS.ATTENDANT) {
    return instance.managerUserId === user.id;
  }
  return serverOperator === null;
}
