import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SparklineComponent } from './sparkline.component';

describe('SparklineComponent', () => {
  let component: SparklineComponent;
  let fixture: ComponentFixture<SparklineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SparklineComponent] }).compileComponents();
    fixture = TestBed.createComponent(SparklineComponent);
    component = fixture.componentInstance;
  });

  it('draws a flat baseline when there are no values', () => {
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.line).toContain('M');
    expect(component.area).toContain('Z');
    expect(fixture.nativeElement.querySelectorAll('path').length).toBe(2);
  });

  it('rebuilds paths when values change', () => {
    component.values = [0, 5, 2];
    component.width = 100;
    component.height = 40;
    component.ngOnChanges();
    const first = component.line;
    component.values = [5, 5, 5];
    component.ngOnChanges();
    expect(component.line).not.toBe(first);
    expect(component.gradientId).toMatch(/^spark-/);
  });
});
