import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ElementRef, SimpleChange } from '@angular/core';
import { ServerStateComponent } from './server-state.component';

describe('ServerStateComponent', () => {
  let component: ServerStateComponent;
  let fixture: ComponentFixture<ServerStateComponent>;

  /** A detached log container of the given content height with a 100 px viewport, scrolled to the top. */
  const container = (scrollHeight: number): HTMLElement => {
    const element = document.createElement('div');
    const lastLine = element.appendChild(document.createElement('div'));
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight });
    Object.defineProperty(element, 'clientHeight', { value: 100 });
    spyOn(element, 'scrollTo');
    spyOn(lastLine, 'scrollIntoView');
    component.logContainer = new ElementRef(element);
    return element;
  };

  const show = (logs: string[], previous: string[]) => {
    component.logs = logs;
    component.ngOnChanges({ logs: new SimpleChange(previous, logs, previous.length === 0) });
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServerStateComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(ServerStateComponent);
    component = fixture.componentInstance;
    component.serverInstance = { message: undefined };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('always shows its output, with no header to fold it away', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.console-log-container')).toBeTruthy();
    expect(el.querySelector('.collapsible-header')).toBeNull();
  });

  it('shows the server message in place of the default description', () => {
    expect(component.serverMessage).toBeNull();
    component.serverInstance = { message: 'Downloading mods' };
    expect(component.serverMessage).toBe('Downloading mods');
  });

  it('should handle ngOnChanges and auto-scroll logs', fakeAsync(() => {
    const element = container(200);
    show(['a', 'b'], []);
    tick(50);
    expect(element.scrollTo).toHaveBeenCalledWith(0, 200);
    expect(element.lastElementChild!.scrollIntoView).toHaveBeenCalled();
  }));

  it('should not auto-scroll if user is not near bottom', fakeAsync(() => {
    const element = container(1000);
    show(['a', 'b', 'c'], ['a', 'b']);
    tick(50);
    expect(element.scrollTo).not.toHaveBeenCalled();
  }));

  it('keeps following the output once the buffer is full', fakeAsync(() => {
    const element = container(200);
    const full = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
    show(full, []);
    tick(50);
    (element.scrollTo as jasmine.Spy).calls.reset();

    show([...full.slice(1), 'line 1000'], full);
    tick(50);

    expect(element.scrollTo).toHaveBeenCalled();
  }));

  it('does not scroll again for the same output', fakeAsync(() => {
    const element = container(200);
    show(['a', 'b'], []);
    tick(50);
    (element.scrollTo as jasmine.Spy).calls.reset();

    show(['a', 'b'], ['a', 'b']);
    tick(50);

    expect(element.scrollTo).not.toHaveBeenCalled();
  }));
});
