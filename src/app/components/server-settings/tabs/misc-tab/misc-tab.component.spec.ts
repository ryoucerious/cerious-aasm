import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MiscTabComponent } from './misc-tab.component';

describe('MiscTabComponent', () => {
  let component: MiscTabComponent;
  let fixture: ComponentFixture<MiscTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MiscTabComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(MiscTabComponent);
    component = fixture.componentInstance;
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
    component.onValidateField('miscSetting', true);
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'miscSetting', value: true});
  });

  it('shows validation messages under their fields', () => {
    component.miscFields = [{ tab: 'misc', key: 'maxTamedDinos', label: 'Max Tamed Dinos', type: 'number' }];
    component.fieldErrors = { maxTamedDinos: 'Max Tamed Dinos must be a valid integer' };
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.validation-error')?.textContent)
      .toContain('Max Tamed Dinos must be a valid integer');
  });
});
