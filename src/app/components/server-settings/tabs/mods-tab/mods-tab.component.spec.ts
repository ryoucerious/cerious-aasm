import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModsTabComponent } from './mods-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('ModsTabComponent', () => {
  let component: ModsTabComponent;
  let fixture: ComponentFixture<ModsTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModsTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ModsTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit addMod on onAddMod', () => {
    spyOn(component.addMod, 'emit');
    component.newModId = '123';
    component.newModName = 'TestMod';
    component.onAddMod();
    expect(component.addMod.emit).toHaveBeenCalledWith({ id: '123', name: 'TestMod' });
  });

  it('should not emit addMod if fields are empty', () => {
    spyOn(component.addMod, 'emit');
    component.newModId = '';
    component.newModName = '';
    component.onAddMod();
    expect(component.addMod.emit).not.toHaveBeenCalled();
  });

  it('should emit removeMod', () => {
    spyOn(component.removeMod, 'emit');
    const mod = { id: '1' };
    component.onRemoveMod(mod);
    expect(component.removeMod.emit).toHaveBeenCalledWith(mod);
  });

  it('should emit toggleMod', () => {
    spyOn(component.toggleMod, 'emit');
    const mod = { id: '2' };
    component.onToggleMod(mod);
    expect(component.toggleMod.emit).toHaveBeenCalledWith(mod);
  });

  it('should emit updateModSettings on saveModSettings', () => {
    spyOn(component.updateModSettings, 'emit');
    component.selectedMod = { id: '3', settings: { a: 1 } };
    component.modSettings = { a: 2 };
    component.saveModSettings();
    expect(component.updateModSettings.emit).toHaveBeenCalledWith({ mod: { id: '3', settings: { a: 1 } }, settings: { a: 2 } });
  });

  it('should open and close modals', () => {
    component.openAddModModal();
    expect(component.showAddModModal).toBeTrue();
    component.openSettingsModal({ id: '4', settings: { b: 2 } });
    expect(component.showSettingsModal).toBeTrue();
    component.closeModal();
    expect(component.showAddModModal).toBeFalse();
    expect(component.showSettingsModal).toBeFalse();
  });

  it('should handle setting key change', () => {
    component.modSettings = { old: 'val' };
    component.onSettingKeyChange('old', 'new');
    expect(component.modSettings['new']).toBe('val');
    expect(component.modSettings['old']).toBeUndefined();
  });

  it('should start, finish, and cancel editing key', () => {
    component.startEditingKey('key');
    expect(component.editingKey).toBe('key');
    expect(component.tempKeyValue).toBe('key');
    component.modSettings = { key: 'val' };
    component.tempKeyValue = 'newKey';
    component.finishEditingKey('key');
    expect(component.editingKey).toBeNull();
    expect(component.tempKeyValue).toBe('');
    component.startEditingKey('another');
    component.cancelEditingKey();
    expect(component.editingKey).toBeNull();
    expect(component.tempKeyValue).toBe('');
  });

  it('should add and remove settings', () => {
    component.modSettings = {};
    component.addSetting();
    expect(Object.keys(component.modSettings).length).toBe(1);
    component.removeSetting('Setting1');
    expect(component.modSettings['Setting1']).toBeUndefined();
  });

  it('should track by mod id and setting', () => {
    const mod = { id: 'abc' };
    expect(component.trackByModId(0, mod)).toBe('abc');
    expect(component.trackByModId(1, null)).toBe(1);
    expect(component.trackBySetting(0, 'setting')).toBe('setting');
  });

  it('should get object keys', () => {
    expect(component.objectKeys({ a: 1, b: 2 })).toEqual(['a', 'b']);
    expect(component.objectKeys(null)).toEqual([]);
  });
});
