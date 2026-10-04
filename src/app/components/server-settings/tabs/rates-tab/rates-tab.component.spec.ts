import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RatesTabComponent } from './rates-tab.component';

describe('RatesTabComponent', () => {
  let component: RatesTabComponent;
  let fixture: ComponentFixture<RatesTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RatesTabComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(RatesTabComponent);
    component = fixture.componentInstance;
    component.serverInstance = { gamePort: 7777 };
    component.ratesFields = [{ tab: 'rates', key: 'xpMultiplier', label: 'XP Multiplier', type: 'number', description: '' }];
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
    component.onValidateField('xpMultiplier', 2);
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'xpMultiplier', value: 2});
  });

  it('should get fields by category', () => {
    component.ratesFields = [
      { tab: 'rates', key: 'xpMultiplier', label: '', type: 'number', description: '' },
      { tab: 'rates', key: 'tamingSpeedMultiplier', label: '', type: 'number', description: '' }
    ];
    expect(component.getFieldsByCategory('experience').length).toBe(1);
    expect(component.getFieldsByCategory('taming').length).toBe(1);
    expect(component.getFieldsByCategory('unknown').length).toBe(0);
  });

  it('shows validation messages under their fields', () => {
    component.fieldErrors = { xpMultiplier: 'XP Multiplier must be a positive number' };
    component.fieldWarnings = { xpMultiplier: 'XP Multiplier is set to a very high value' };
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.validation-error')?.textContent).toContain('XP Multiplier must be a positive number');
    expect(el.querySelector('.validation-warning')?.textContent).toContain('XP Multiplier is set to a very high value');
  });
});
