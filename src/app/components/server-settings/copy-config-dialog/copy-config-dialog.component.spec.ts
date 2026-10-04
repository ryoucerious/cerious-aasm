import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CopyConfigDialogComponent } from './copy-config-dialog.component';
import { ServerInstanceService } from '../../../core/services/server-instance.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ServerInstance, ServerInstanceDraft } from '../../../core/models/server-instance.model';

describe('CopyConfigDialogComponent', () => {
  let fixture: ComponentFixture<CopyConfigDialogComponent>;
  let component: CopyConfigDialogComponent;
  let notification: jasmine.SpyObj<NotificationService>;
  let target: ServerInstanceDraft;
  let applied: number;

  const source: ServerInstance = {
    id: 'B',
    name: 'Source',
    mapName: 'Ragnarok_WP',
    mods: ['1', '2'],
    enabledMods: ['2'],
    modSettings: { '1': { _name: 'One' }, '2': { _name: 'Two', Speed: '3' } },
    pveStructureDecayPeriodMultiplier: 2,
    pveStructureDecayDelay: 30,
    structureDamageMultiplier: 1.5
  };

  beforeEach(async () => {
    notification = jasmine.createSpyObj<NotificationService>('NotificationService', ['success', 'error', 'info', 'warning']);
    await TestBed.configureTestingModule({
      imports: [CopyConfigDialogComponent],
      providers: [
        { provide: ServerInstanceService, useValue: { getInstances: () => of([{ id: 'A', name: 'Target' }, source]) } },
        { provide: NotificationService, useValue: notification }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CopyConfigDialogComponent);
    component = fixture.componentInstance;
    target = { id: 'A', name: 'Target', mods: ['9'], enabledMods: ['9'], modSettings: { '9': { _name: 'Nine' } } };
    applied = 0;
    component.applied.subscribe(() => applied++);
    fixture.componentRef.setInput('target', target);
    fixture.componentRef.setInput('show', true);
    fixture.detectChanges();
  });

  const copy = (category: string, from: ServerInstance = source) => {
    component.selectSource(from);
    component.selected[category] = true;
    component.apply();
  };

  it('offers every other server as the source, named with its map', () => {
    expect(component.servers.map(server => server.id)).toEqual(['B']);
    expect(component.serverLabel(source)).toBe('Source (Ragnarok)');
  });

  it('starts over each time it opens', () => {
    component.selectSource(source);
    component.selected['general'] = true;
    fixture.componentRef.setInput('show', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('show', true);
    fixture.detectChanges();
    expect(component.source).toBeNull();
    expect(component.hasAnyCategorySelected).toBeFalse();
  });

  it('copies the whole mod setup: list, enabled mods and names', () => {
    copy('mods');
    expect(target.mods).toEqual(['1', '2']);
    expect(target.enabledMods).toEqual(['2']);
    expect(target.modSettings).toEqual({ '1': { _name: 'One' }, '2': { _name: 'Two', Speed: '3' } });
    expect(applied).toBe(1);
  });

  it('clears the mod setup when the source has no mods', () => {
    copy('mods', { id: 'C', name: 'Empty' });
    expect(target.mods).toEqual([]);
    expect(target.enabledMods).toEqual([]);
    expect(target.modSettings).toEqual({});
  });

  it('treats a source whose mods are not a list as having none', () => {
    copy('mods', { id: 'C', name: 'Odd', mods: '' as unknown as string[] });
    expect(target.mods).toEqual([]);
    expect(target.enabledMods).toEqual([]);
  });

  it('treats every mod of an older config as enabled and unnamed', () => {
    copy('mods', { id: 'C', name: 'Old', mods: ['5'] });
    expect(target.mods).toEqual(['5']);
    expect(target.enabledMods).toEqual(['5']);
    expect(target.modSettings).toEqual({});
  });

  it('copies the PvE decay settings with the structures', () => {
    copy('structures');
    expect(target.pveStructureDecayPeriodMultiplier).toBe(2);
    expect(target.pveStructureDecayDelay).toBe(30);
    expect(target.structureDamageMultiplier).toBe(1.5);
  });

  it('gives the target its own copies', () => {
    copy('mods');
    target.mods!.push('3');
    target.modSettings!['2']['Speed'] = '9';
    expect(source.mods).toEqual(['1', '2']);
    expect(source.modSettings!['2']['Speed']).toBe('3');
  });

  it('says what it copied', () => {
    copy('structures');
    expect(notification.success).toHaveBeenCalledWith('Copied 3 settings from "Source" (Structures)', 'Config Copied');
  });

  it('copies nothing without a category', () => {
    component.selectSource(source);
    component.apply();
    expect(applied).toBe(0);
    expect(notification.warning).toHaveBeenCalled();
    expect(target.mods).toEqual(['9']);
  });
});
