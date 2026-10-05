import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ModsTabComponent } from './mods-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { ModEntry } from '../../../../core/models/server-instance.model';

describe('ModsTabComponent', () => {
  let component: ModsTabComponent;
  let fixture: ComponentFixture<ModsTabComponent>;
  let notification: MockNotificationService;

  const mod = (id: string, settings: Record<string, string> = {}): ModEntry => ({ id, name: `Mod ${id}`, enabled: true, settings });

  beforeEach(async () => {
    notification = new MockNotificationService();
    await TestBed.configureTestingModule({
      imports: [ModsTabComponent],
      providers: [
        { provide: MessagingService, useValue: { sendMessage: () => of({ success: true, mods: [] }) } },
        { provide: NotificationService, useValue: notification }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ModsTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const button = (label: string) => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
    .find(element => element.textContent?.includes(label)) as HTMLButtonElement;

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

  it('cannot add or browse for mods while settings are locked', () => {
    component.isLocked = true;
    fixture.detectChanges();
    expect(button('Add Mod').disabled).toBeTrue();
    expect(button('Browse CurseForge').disabled).toBeTrue();
  });

  it('adds a mod from CurseForge and leaves the confirmation to the page', () => {
    spyOn(component.addMod, 'emit');
    spyOn(notification, 'success');
    component.addModFromCurseForge({ id: 42, name: 'Structures Plus' });
    expect(component.addMod.emit).toHaveBeenCalledWith({ id: '42', name: 'Structures Plus' });
    expect(notification.success).not.toHaveBeenCalled();
  });

  it('does not add a CurseForge mod that is already listed', () => {
    component.modList = [mod('42')];
    spyOn(component.addMod, 'emit');
    spyOn(notification, 'warning');
    component.addModFromCurseForge({ id: 42, name: 'Structures Plus' });
    expect(component.addMod.emit).not.toHaveBeenCalled();
    expect(notification.warning).toHaveBeenCalled();
  });

  it('should emit removeMod', () => {
    spyOn(component.removeMod, 'emit');
    const entry = mod('1');
    component.onRemoveMod(entry);
    expect(component.removeMod.emit).toHaveBeenCalledWith(entry);
  });

  it('should emit toggleMod', () => {
    spyOn(component.toggleMod, 'emit');
    const entry = mod('2');
    component.onToggleMod(entry);
    expect(component.toggleMod.emit).toHaveBeenCalledWith(entry);
  });

  it('should emit updateModSettings on saveModSettings', () => {
    spyOn(component.updateModSettings, 'emit');
    const entry = mod('3', { a: '1' });
    component.selectedMod = entry;
    component.modSettings = { a: '2' };
    component.saveModSettings();
    expect(component.updateModSettings.emit).toHaveBeenCalledWith({ mod: entry, settings: { a: '2' } });
  });

  it('should open and close modals', () => {
    component.openAddModModal();
    expect(component.showAddModModal).toBeTrue();
    component.openSettingsModal(mod('4', { b: '2' }));
    expect(component.showSettingsModal).toBeTrue();
    expect(component.modSettings).toEqual({ b: '2' });
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
    expect(Object.keys(component.modSettings)).toEqual(['Setting1']);
    component.removeSetting('Setting1');
    expect(component.modSettings['Setting1']).toBeUndefined();
  });

  it('adds a setting under a name no other setting has', () => {
    component.modSettings = { Setting2: 'kept' };
    component.addSetting();
    component.addSetting();
    expect(component.modSettings).toEqual({ Setting2: 'kept', Setting3: '', Setting4: '' });
  });

  it('should track by mod id and setting', () => {
    expect(component.trackByModId(0, mod('abc'))).toBe('abc');
    expect(component.trackBySetting(0, 'setting')).toBe('setting');
  });

  it('should get object keys', () => {
    expect(component.objectKeys({ a: '1', b: '2' })).toEqual(['a', 'b']);
    expect(component.objectKeys(null)).toEqual([]);
  });
});
