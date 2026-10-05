import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StructuresTabComponent } from './structures-tab.component';

describe('StructuresTabComponent', () => {
  let component: StructuresTabComponent;
  let fixture: ComponentFixture<StructuresTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StructuresTabComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(StructuresTabComponent);
    component = fixture.componentInstance;
    component.serverInstance = { gamePort: 7777 };
    component.structuresFields = [{ tab: 'structures', key: 'structureDamageMultiplier', label: 'Structure Damage', type: 'number', description: '' }];
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit saveSettings on onSaveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.onSaveSettings();
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('should emit validateField on onValidateField', () => {
    spyOn(component.validateField, 'emit');
    component.onValidateField('structureDamageMultiplier', 100);
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'structureDamageMultiplier', value: 100});
  });

  it('shows the PvE decay settings with the other damage and decay settings', () => {
    component.structuresFields = [
      { tab: 'structures', key: 'pveStructureDecayPeriodMultiplier', label: 'PvE Structure Decay Period Multiplier', type: 'number' },
      { tab: 'structures', key: 'pveStructureDecayDelay', label: 'PvE Structure Decay Delay', type: 'number' }
    ];
    expect(component.getFieldsByCategory('damage').map(field => field.key))
      .toEqual(['pveStructureDecayPeriodMultiplier', 'pveStructureDecayDelay']);
  });

  it('shows validation messages under their fields', () => {
    component.fieldErrors = { structureDamageMultiplier: 'Structure Damage must be a positive number' };
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.validation-error')?.textContent)
      .toContain('Structure Damage must be a positive number');
  });
});
