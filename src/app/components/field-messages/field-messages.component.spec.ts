import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FieldMessagesComponent } from './field-messages.component';

describe('FieldMessagesComponent', () => {
  let fixture: ComponentFixture<FieldMessagesComponent>;

  const text = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FieldMessagesComponent] }).compileComponents();
    fixture = TestBed.createComponent(FieldMessagesComponent);
    fixture.componentRef.setInput('key', 'gamePort');
  });

  it('shows the error and warning for its own field', () => {
    fixture.componentRef.setInput('errors', { gamePort: 'Game Port must be a valid integer', rconPort: 'other' });
    fixture.componentRef.setInput('warnings', { gamePort: 'Port is in use' });
    fixture.detectChanges();

    expect(text('.validation-error')).toBe('Game Port must be a valid integer');
    expect(text('.validation-warning')).toBe('Port is in use');
  });

  it('shows nothing for a field without problems', () => {
    fixture.componentRef.setInput('errors', { rconPort: 'other' });
    fixture.detectChanges();

    expect(text('.validation-error')).toBeNull();
    expect(text('.validation-warning')).toBeNull();
  });
});
