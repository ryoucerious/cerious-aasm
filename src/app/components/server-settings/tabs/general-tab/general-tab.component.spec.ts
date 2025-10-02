import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GeneralTabComponent } from './general-tab.component';

describe('GeneralTabComponent', () => {
  let component: GeneralTabComponent;
  let fixture: ComponentFixture<GeneralTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GeneralTabComponent]
    }).compileComponents();
  fixture = TestBed.createComponent(GeneralTabComponent);
  component = fixture.componentInstance;
  // Provide required @Input() values
  component.serverInstance = { gamePort: 7777, mapName: 'TheIsland' };
  component.generalFields = [{ key: 'mapName', label: 'Map', type: 'dropdown', description: '', options: [{ value: 'TheIsland', display: 'The Island' }] }];
  fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
