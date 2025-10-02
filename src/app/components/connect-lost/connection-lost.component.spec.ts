import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConnectionLostComponent } from './connection-lost.component';

describe('ConnectionLostComponent', () => {
  let component: ConnectionLostComponent;
  let fixture: ComponentFixture<ConnectionLostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectionLostComponent],
      providers: [
        { provide: Function, useValue: () => {} }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ConnectionLostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call reloadFn when reload is called', () => {
    const reloadSpy = jasmine.createSpy('reload');
    component.reloadFn = reloadSpy;
    component.reload();
    expect(reloadSpy).toHaveBeenCalled();
  });
});
