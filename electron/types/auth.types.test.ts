import { ALL_PERMISSIONS, BUILT_IN_ROLES, PERMISSION_DESCRIPTIONS, PERMISSIONS, ROLE_IDS, isAssignableRole } from './auth.types';

describe('auth.types', () => {
  it('describes every permission, including the six account permissions', () => {
    expect(PERMISSIONS.ACCOUNTS_ATTENDANTS_DELETE).toBe('accounts.attendants.delete');
    for (const permission of ALL_PERMISSIONS) expect(PERMISSION_DESCRIPTIONS[permission].group).toBeTruthy();
    expect(ALL_PERMISSIONS.filter(p => p.startsWith('accounts.'))).toHaveLength(6);
  });

  it('defines the attendant role with view, control and player viewing', () => {
    const attendant = BUILT_IN_ROLES.find(role => role.id === ROLE_IDS.ATTENDANT)!;
    expect(attendant.permissions).toEqual([
      PERMISSIONS.SERVERS_VIEW, PERMISSIONS.SERVERS_CONTROL, PERMISSIONS.PLAYERS_VIEW
    ]);
    expect(attendant.permissions).not.toContain(PERMISSIONS.PLAYERS_MANAGE);
  });

  it('gives the operator the pool permissions and the server manager none of them', () => {
    const operator = BUILT_IN_ROLES.find(role => role.id === ROLE_IDS.OPERATOR)!;
    const manager = BUILT_IN_ROLES.find(role => role.id === ROLE_IDS.SERVER_MANAGER)!;
    expect(operator.permissions).toEqual(expect.arrayContaining([
      PERMISSIONS.SERVERS_CREATE, PERMISSIONS.SERVERS_DELETE, PERMISSIONS.ACCOUNTS_VIEWERS_DELETE
    ]));
    expect(manager.permissions).not.toContain(PERMISSIONS.SERVERS_CREATE);
    expect(manager.permissions).not.toContain(PERMISSIONS.SETTINGS_VIEW);
  });

  it('treats server managers and attendants as assignable', () => {
    expect(isAssignableRole('server-manager')).toBe(true);
    expect(isAssignableRole('attendant')).toBe(true);
    expect(isAssignableRole('viewer')).toBe(false);
    expect(isAssignableRole(undefined)).toBe(false);
  });
});
