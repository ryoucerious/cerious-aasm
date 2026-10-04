import { ErrorHandler } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GeneralTabComponent } from './general-tab.component';

describe('GeneralTabComponent', () => {
  let component: GeneralTabComponent;
  let fixture: ComponentFixture<GeneralTabComponent>;
  let errors: unknown[];
  let commits: { key: string; value: unknown }[];

  beforeEach(async () => {
    errors = [];
    await TestBed.configureTestingModule({
      imports: [GeneralTabComponent],
      providers: [{ provide: ErrorHandler, useValue: { handleError: (error: unknown) => errors.push(error) } }]
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
});
