import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatMultipliersTabComponent, StatMultiplierChange } from './stat-multipliers-tab.component';

describe('StatMultipliersTabComponent', () => {
  let component: StatMultipliersTabComponent;
  let fixture: ComponentFixture<StatMultipliersTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatMultipliersTabComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(StatMultipliersTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit toggleStatSelectorDropdown', () => {
    spyOn(component.toggleStatSelectorDropdown, 'emit');
    component.onToggleStatSelectorDropdown();
    expect(component.toggleStatSelectorDropdown.emit).toHaveBeenCalled();
  });

  it('should emit statSelectorSelect', () => {
    spyOn(component.statSelectorSelect, 'emit');
    component.onStatSelectorSelect(2);
    expect(component.statSelectorSelect.emit).toHaveBeenCalledWith(2);
  });

  it('should emit resetStatToDefaults', () => {
    spyOn(component.resetStatToDefaults, 'emit');
    component.onResetStatToDefaults(3);
    expect(component.resetStatToDefaults.emit).toHaveBeenCalledWith(3);
  });

  it('should emit copyStatToAll', () => {
    spyOn(component.copyStatToAll, 'emit');
    component.onCopyStatToAll(4);
    expect(component.copyStatToAll.emit).toHaveBeenCalledWith(4);
  });

  it('should get stat selector display name', () => {
    component.statList = ['Health', 'Stamina'];
    expect(component.getStatSelectorDisplayName(null)).toBe('Select Stat...');
    expect(component.getStatSelectorDisplayName(0)).toBe('Health');
    expect(component.getStatSelectorDisplayName(1)).toBe('Stamina');
  });

  it('should get stat multiplier', () => {
    expect(component.getStatMultiplier('type', 1)).toBe(1.0);
  });

  describe('multiplier inputs', () => {
    let emitted: StatMultiplierChange[];

    beforeEach(() => {
      component.serverInstance = { perLevelStatsMultiplier_Player: Array(12).fill(1.5) };
      component.statList = ['Health'];
      component.selectedStatIndex = 0;
      emitted = [];
      component.statMultiplierChanged.subscribe(change => emitted.push(change));
      fixture.detectChanges();
    });

    const playerInput = () => (fixture.nativeElement as HTMLElement).querySelector('input[type=number]') as HTMLInputElement;
    const type = (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };

    it('shows the stored value', () => {
      expect(playerInput().value).toBe('1.5');
    });

    it('does not save while typing', () => {
      type(playerInput(), '2');
      expect(emitted).toEqual([]);
    });

    it('saves the value once it is committed', () => {
      const input = playerInput();
      type(input, '2.5');
      input.dispatchEvent(new Event('change'));
      expect(emitted).toEqual([{ type: 'Player', statIndex: 0, value: 2.5 }]);
    });

    it('never saves a cleared or negative value, and shows the stored one again', () => {
      const input = playerInput();
      type(input, '');
      input.dispatchEvent(new Event('change'));
      expect(input.value).toBe('1.5');

      type(input, '-1');
      input.dispatchEvent(new Event('change'));
      expect(input.value).toBe('1.5');

      expect(emitted).toEqual([]);
    });
  });
});
