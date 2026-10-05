import { ErrorHandler, SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GeneralTabComponent } from './general-tab.component';
import { AuthService } from '../../../../core/services/auth.service';
import { PoolDirectoryService } from '../../../../core/services/pool-directory.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { CurrentIdentity } from '../../../../core/models/auth.model';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';

const admin: CurrentIdentity = { user: null, isLocalDesktop: true, isAdmin: true, permissions: [], accountsInUse: true };
const operator = (id: string): CurrentIdentity => ({
  user: { id, username: id, displayName: id, roleId: 'operator', roleName: 'Operator', active: true, ownerUserId: null, permissions: [], createdAt: 0, updatedAt: 0, lastLoginAt: null },
  isLocalDesktop: false, isAdmin: false, permissions: ['servers.view'], accountsInUse: true
});
const viewer: CurrentIdentity = {
  user: { id: 'v1', username: 'v1', displayName: 'v1', roleId: 'viewer', roleName: 'Viewer', active: true, ownerUserId: 'op1', permissions: [], createdAt: 0, updatedAt: 0, lastLoginAt: null },
  isLocalDesktop: false, isAdmin: false, permissions: ['servers.view'], accountsInUse: true
};
let identity: CurrentIdentity = admin;
const assignServerManager = jasmine.createSpy('assignServerManager').and.resolveTo({ success: true });
const setServerOperator = jasmine.createSpy('setServerOperator').and.resolveTo({ success: true });
const directory = {
  changed$: of(undefined),
  operators: [{ id: 'op1', username: 'op1', displayName: 'Ops', roleName: 'Operator', ownerUserId: null }],
  assignees: [
    { id: 'm1', username: 'mia', displayName: '', roleName: 'Server Manager', ownerUserId: 'op1' },
    { id: 'm0', username: 'max', displayName: '', roleName: 'Server Manager', ownerUserId: null }
  ],
  operatorLabel: () => 'Ops',
  assigneeLabel: () => 'Not assigned'
};

describe('GeneralTabComponent', () => {
  let component: GeneralTabComponent;
  let fixture: ComponentFixture<GeneralTabComponent>;
  let errors: unknown[];
  let commits: { key: string; value: unknown }[];

  beforeEach(async () => {
    errors = [];
    identity = admin;
    await TestBed.configureTestingModule({
      imports: [GeneralTabComponent],
      providers: [
        { provide: ErrorHandler, useValue: { handleError: (error: unknown) => errors.push(error) } },
        { provide: AuthService, useValue: { get identity() { return identity; }, assignServerManager, setServerOperator } },
        { provide: PoolDirectoryService, useValue: directory },
        { provide: NotificationService, useClass: MockNotificationService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(GeneralTabComponent);
    component = fixture.componentInstance;
    component.serverInstance = { gamePort: 7777, mapName: 'TheIsland_WP' };
    component.generalFields = [{
      tab: 'general', key: 'mapName', label: 'Server Map', type: 'combo', description: '',
      options: [{ value: 'TheIsland_WP', display: 'The Island' }, { value: 'Ragnarok_WP', display: 'Ragnarok' }]
    }];
    commits = [];
    component.comboCommit.subscribe(commit => commits.push(commit));
    fixture.detectChanges();
  });

  const mapInput = () => (fixture.nativeElement as HTMLElement).querySelector('.custom-dropdown input') as HTMLInputElement;
  const type = (value: string) => {
    const input = mapInput();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows a known map by its display name and a custom map as typed', () => {
    expect(component.comboText(component.generalFields[0])).toBe('The Island');
    component.serverInstance.mapName = 'MyMap_WP';
    expect(component.comboText(component.generalFields[0])).toBe('MyMap_WP');
  });

  it('takes a typed map name without saving it yet', () => {
    type('Ragnarok');
    expect(component.serverInstance.mapName).toBe('Ragnarok_WP');
    type('MyMap_WP');
    expect(component.serverInstance.mapName).toBe('MyMap_WP');
    expect(commits).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('commits the typed map name when the field is left', () => {
    type('MyMap_WP');
    mapInput().dispatchEvent(new Event('blur'));
    expect(commits).toEqual([{ key: 'mapName', value: 'MyMap_WP' }]);
  });

  it('commits a map picked from the list', () => {
    component.dropdownOpen = true;
    fixture.detectChanges();
    const ragnarok = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.dropdown-menu div'))
      .find(option => option.textContent?.trim() === 'Ragnarok') as HTMLElement;
    ragnarok.dispatchEvent(new Event('mousedown'));
    expect(component.serverInstance.mapName).toBe('Ragnarok_WP');
    expect(commits).toEqual([{ key: 'mapName', value: 'Ragnarok_WP' }]);
  });

  it('commits a picked map once, although the field then loses focus', () => {
    component.dropdownOpen = true;
    fixture.detectChanges();
    const ragnarok = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.dropdown-menu div'))
      .find(option => option.textContent?.trim() === 'Ragnarok') as HTMLElement;
    ragnarok.dispatchEvent(new Event('mousedown'));
    mapInput().dispatchEvent(new Event('blur'));
    expect(commits).toEqual([{ key: 'mapName', value: 'Ragnarok_WP' }]);

    type('MyMap_WP');
    mapInput().dispatchEvent(new Event('blur'));
    expect(commits).toEqual([{ key: 'mapName', value: 'Ragnarok_WP' }, { key: 'mapName', value: 'MyMap_WP' }]);
  });

  it('commits a value on the next server although it matches what was committed on the previous one', () => {
    fixture.componentRef.setInput('serverInstance', { id: 'A', mapName: 'TheIsland_WP' });
    fixture.detectChanges();
    type('MyMap_WP');
    mapInput().dispatchEvent(new Event('blur'));

    fixture.componentRef.setInput('serverInstance', { id: 'B', mapName: 'TheIsland_WP' });
    fixture.detectChanges();
    type('MyMap_WP');
    mapInput().dispatchEvent(new Event('blur'));

    expect(commits).toEqual([{ key: 'mapName', value: 'MyMap_WP' }, { key: 'mapName', value: 'MyMap_WP' }]);
  });

  it('shows validation messages under their fields', () => {
    component.fieldErrors = { mapName: 'Server Map cannot be empty', gamePort: 'Game Port must be a valid integer' };
    fixture.detectChanges();
    const messages = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.validation-error'))
      .map(element => element.textContent?.trim());
    expect(messages).toEqual(['Server Map cannot be empty', 'Game Port must be a valid integer']);
  });
  describe('ownership', () => {
    // Inputs arrive through bindings in the app, which is what fires ngOnChanges.
    const setServer = (server: Record<string, unknown>) => {
      component.serverInstance = server;
      component.ngOnChanges({ serverInstance: new SimpleChange(null, server, false) });
      fixture.detectChanges();
    };
    const dropdowns = () => (fixture.nativeElement as HTMLElement).querySelectorAll('.ownership-section app-dropdown').length;
    const statics = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.ownership-section .form-control-static')).map(el => el.textContent?.trim());

    it('lets an admin choose both the pool and the assignee', () => {
      setServer({ id: 's1', operatorUserId: 'op1', managerUserId: null });

      expect(dropdowns()).toBe(2);
      expect(component.operatorOptions.map(option => option.label)).toEqual(['Admin pool', 'Ops (op1)']);
      expect(component.assigneeOptions.map(option => option.value)).toEqual(['', 'm1']);
    });

    it('lets the pool\'s operator choose only the assignee', () => {
      identity = operator('op1');
      setServer({ id: 's1', operatorUserId: 'op1', managerUserId: null });

      expect(dropdowns()).toBe(1);
      expect(statics()).toEqual(['Ops']);
    });

    it('shows a viewer the labels only', () => {
      identity = viewer;
      setServer({ id: 's1', operatorUserId: 'op1', managerUserId: 'm1' });

      expect(dropdowns()).toBe(0);
      expect(statics()).toEqual(['Ops', 'Not assigned']);
    });

    it('assigns and moves through the auth service', async () => {
      setServer({ id: 's1', operatorUserId: 'op1', managerUserId: null });

      await component.onAssigneeChange('m1');
      await component.onOperatorChange('');

      expect(assignServerManager).toHaveBeenCalledWith('s1', 'm1');
      expect(setServerOperator).toHaveBeenCalledWith('s1', null);
    });
  });
});
