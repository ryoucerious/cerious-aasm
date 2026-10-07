import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UsersSettingsComponent } from './users-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MeshNodesService } from '../../../core/services/mesh-nodes.service';
import { CurrentIdentity, Role, User } from '../../../core/models/auth.model';
import { of } from 'rxjs';

describe('UsersSettingsComponent', () => {
  let fixture: ComponentFixture<UsersSettingsComponent>;
  let component: UsersSettingsComponent;
  let auth: jasmine.SpyObj<AuthService>;
  let notification: jasmine.SpyObj<NotificationService>;

  const role: Role = { id: 'viewer', name: 'Viewer', description: '', permissions: ['servers.view'], builtIn: true, createdAt: 0, updatedAt: 0 };
  const operatorRole: Role = { id: 'operator', name: 'Operator', description: '', permissions: ['servers.view', 'accounts.viewers.create'], builtIn: true, createdAt: 0, updatedAt: 0 };
  const managerRole: Role = { id: 'server-manager', name: 'Server Manager', description: '', permissions: ['servers.view', 'servers.control'], builtIn: true, createdAt: 0, updatedAt: 0 };
  const user: User = { id: 'u1', username: 'ann', displayName: '', roleId: 'viewer', active: true, createdAt: 0, updatedAt: 0, lastLoginAt: null };
  const operator: User = { id: 'op', username: 'ops', displayName: 'Ops', roleId: 'operator', active: true, ownerUserId: null, createdAt: 0, updatedAt: 0, lastLoginAt: null };
  const owned: User = { id: 'u2', username: 'bea', displayName: '', roleId: 'viewer', active: true, ownerUserId: 'op', createdAt: 0, updatedAt: 0, lastLoginAt: null };
  const manager: User = { id: 'u3', username: 'mia', displayName: '', roleId: 'server-manager', active: true, ownerUserId: 'op', createdAt: 0, updatedAt: 0, lastLoginAt: null };
  const machineAdminRole: Role = { id: 'machine-admin', name: 'Machine Admin', description: '', permissions: ['servers.view', 'servers.move'], builtIn: true, createdAt: 0, updatedAt: 0 };
  const machineAdmin: User = {
    id: 'ma', username: 'admin2-dallas01', displayName: '', roleId: 'machine-admin', active: true, ownerUserId: null, machineNodeId: 'n2',
    updatesAnyMachine: true, createdAt: 0, updatedAt: 0, lastLoginAt: null
  };
  const roles = [role, operatorRole, managerRole, machineAdminRole];
  const users = [user, operator, owned, manager, machineAdmin];
  const machines = [{ nodeId: 'n1', name: 'Germany01' }, { nodeId: 'n2', name: 'Dallas01' }];

  const admin: CurrentIdentity = { user: null, isLocalDesktop: true, isAdmin: true, permissions: [], accountsInUse: true };
  const poolOwner: CurrentIdentity = {
    user: { ...operator, roleName: 'Operator', permissions: ['servers.view', 'accounts.viewers.create'] },
    isLocalDesktop: false, isAdmin: false, permissions: ['servers.view', 'accounts.viewers.create'], accountsInUse: true
  };
  let identity: CurrentIdentity;

  beforeEach(async () => {
    identity = admin;
    auth = {
      listUsersAndRoles: jasmine.createSpy('listUsersAndRoles').and.resolveTo({ users, roles }),
      listRoles: jasmine.createSpy('listRoles').and.resolveTo({ roles, permissions: [] }),
      updateUser: jasmine.createSpy('updateUser').and.resolveTo({ success: true }),
      createUser: jasmine.createSpy('createUser').and.resolveTo({ success: true }),
      deleteUser: jasmine.createSpy('deleteUser').and.resolveTo({ success: true }),
      can: jasmine.createSpy('can').and.callFake((permission: string) => identity.isAdmin || identity.permissions.includes(permission as never)),
      get identity() { return identity; },
      get currentUser() { return identity.user; }
    } as unknown as jasmine.SpyObj<AuthService>;
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error', 'warning', 'info']);

    await TestBed.configureTestingModule({
      imports: [UsersSettingsComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: NotificationService, useValue: notification },
        {
          provide: MeshNodesService,
          useValue: { changed$: of(undefined), machines: () => machines, nameOf: (id: string) => machines.find(machine => machine.nodeId === id)?.name || '' }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UsersSettingsComponent);
    component = fixture.componentInstance;
    await component.reload();
  });

  describe('editing a user', () => {
    beforeEach(() => component.openEditUser(user));

    it('keeps the password when the field is left blank', async () => {
      expect(component.canSaveUser).toBeTrue();
      await component.saveUser();
      expect(auth.updateUser.calls.mostRecent().args[0].password).toBeUndefined();
    });

    it('holds a new password to the same 8-character minimum as a new account', () => {
      component.form.password = 'short';
      expect(component.canSaveUser).toBeFalse();
      component.form.password = 'long enough';
      expect(component.canSaveUser).toBeTrue();
    });

    it('sends a new password exactly as typed', async () => {
      component.form.password = '  spaced out  ';
      await component.saveUser();
      expect(auth.updateUser.calls.mostRecent().args[0].password).toBe('  spaced out  ');
    });
  });

  it('says so when the accounts cannot be loaded, and stops loading', async () => {
    spyOn(console, 'error');
    auth.listUsersAndRoles.and.rejectWith(new Error('database is locked'));

    await expectAsync(component.reload()).toBeResolved();

    expect(notification.error).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
  });
  // A level above operator: an admin makes one for a mesh machine.
  describe('machine admins', () => {
    it('asks which machine it looks after, and whether it may update every machine', async () => {
      component.openCreateUser();
      component.form = { ...component.form, username: 'ma2', password: 'password1', roleId: 'machine-admin' };

      expect(component.showMachineField).toBeTrue();
      expect(component.machineOptions.map(option => option.label)).toEqual(['Germany01', 'Dallas01']);
      expect(component.canSaveUser).toBeFalse();

      component.form.machineNodeId = 'n1';
      component.form.updatesAnyMachine = true;
      await component.saveUser();

      expect(auth.createUser.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ roleId: 'machine-admin', machineNodeId: 'n1', updatesAnyMachine: true }));
    });

    it('sends no machine for any other role', async () => {
      component.openCreateUser();
      component.form = { ...component.form, username: 'v2', password: 'password1', roleId: 'viewer', machineNodeId: 'n1', updatesAnyMachine: true };

      expect(component.showMachineField).toBeFalse();
      await component.saveUser();

      expect(auth.createUser.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ machineNodeId: null, updatesAnyMachine: false }));
    });

    it('opens one with its machine', () => {
      component.openEditUser(machineAdmin);

      expect(component.form).toEqual(jasmine.objectContaining({ machineNodeId: 'n2', updatesAnyMachine: true }));
    });

    it('shows which machine each looks after', () => {
      expect(component.poolLabel(machineAdmin)).toBe('Dallas01, updates every machine');
      expect(component.poolLabel({ ...machineAdmin, updatesAnyMachine: false })).toBe('Dallas01');
    });

    it('is not offered to anyone but an admin', async () => {
      identity = { ...poolOwner, permissions: ['users.manage', 'servers.view', 'servers.move'] };
      await component.reload();

      component.openCreateUser();

      expect(component.roleOptions.map(option => option.value)).not.toContain('machine-admin');
    });
  });

  describe('pools', () => {
    const text = () => (fixture.nativeElement as HTMLElement).textContent || '';

    it('shows an admin which pool each account is in', async () => {
      // The first change detection runs ngOnInit, which starts its own reload.
      fixture.detectChanges();
      await component.reload();
      fixture.detectChanges();

      const cells = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('td.pool-cell')).map(cell => cell.textContent?.trim());
      expect(cells).toEqual(['Admin pool', 'Operators', 'Ops', 'Ops', 'Dallas01, updates every machine']);
      expect(text()).toContain('Roles');
    });

    it('offers an admin every role and asks for a pool only for a pool role', () => {
      component.openCreateUser();

      expect(component.roleOptions.map(option => option.value)).toEqual(['viewer', 'operator', 'server-manager', 'machine-admin']);
      component.form.roleId = 'viewer';
      expect(component.showOwnerField).toBeTrue();
      component.form.roleId = 'operator';
      expect(component.showOwnerField).toBeFalse();
      expect(component.ownerOptions.map(option => option.label)).toEqual(['Admin pool', 'Ops']);
    });

    it('limits a pool owner to the roles they may create and hides what they may not do', async () => {
      identity = poolOwner;
      // The first change detection runs ngOnInit, which starts its own reload.
      fixture.detectChanges();
      await component.reload();
      fixture.detectChanges();

      component.openCreateUser();
      expect(component.roleOptions.map(option => option.value)).toEqual(['viewer']);
      expect(component.form.roleId).toBe('viewer');
      expect(component.showOwnerField).toBeFalse();
      expect(component.canManageRoles).toBeFalse();
      expect(component.canEditAccount(owned)).toBeTrue();
      expect(component.canDeleteAccount(owned)).toBeFalse();
      expect(component.canEditAccount(manager)).toBeFalse();
      expect(text()).not.toContain('Roles');
    });

    it('sends the pool only when the caller may choose one', async () => {
      component.openCreateUser();
      component.form = { ...component.form, username: 'new', password: 'password1', roleId: 'viewer', ownerUserId: 'op' };
      await component.saveUser();
      expect(auth.createUser.calls.mostRecent().args[0].ownerUserId).toBe('op');

      component.openCreateUser();
      component.form = { ...component.form, username: 'new2', password: 'password1', roleId: 'operator', ownerUserId: 'op' };
      await component.saveUser();
      expect(auth.createUser.calls.mostRecent().args[0].ownerUserId).toBeNull();

      identity = poolOwner;
      component.openCreateUser();
      component.form = { ...component.form, username: 'new3', password: 'password1', roleId: 'viewer', ownerUserId: 'op' };
      await component.saveUser();
      expect('ownerUserId' in auth.createUser.calls.mostRecent().args[0]).toBeFalse();
    });
  });
});
