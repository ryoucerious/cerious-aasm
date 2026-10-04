import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UsersSettingsComponent } from './users-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Role, User } from '../../../core/models/auth.model';

describe('UsersSettingsComponent', () => {
  let fixture: ComponentFixture<UsersSettingsComponent>;
  let component: UsersSettingsComponent;
  let auth: jasmine.SpyObj<AuthService>;
  let notification: jasmine.SpyObj<NotificationService>;

  const role: Role = { id: 'viewer', name: 'Viewer', description: '', permissions: [], builtIn: true, createdAt: 0, updatedAt: 0 };
  const user: User = { id: 'u1', username: 'ann', displayName: '', roleId: 'viewer', active: true, createdAt: 0, updatedAt: 0, lastLoginAt: null };

  beforeEach(async () => {
    auth = jasmine.createSpyObj('AuthService', ['listUsersAndRoles', 'listRoles', 'updateUser', 'createUser'], {
      identity: { user: null, isLocalDesktop: true, isAdmin: true, permissions: [], accountsInUse: true },
      currentUser: null
    });
    auth.listUsersAndRoles.and.resolveTo({ users: [user], roles: [role] });
    auth.listRoles.and.resolveTo({ roles: [role], permissions: [] });
    auth.updateUser.and.resolveTo({ success: true });
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error', 'warning', 'info']);

    await TestBed.configureTestingModule({
      imports: [UsersSettingsComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: NotificationService, useValue: notification }
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
});
