import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServerCardComponent } from './server-card.component';

describe('ServerCardComponent', () => {
  let component: ServerCardComponent;
  let fixture: ComponentFixture<ServerCardComponent>;
  const now = 1_700_000_000_000;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ServerCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(ServerCardComponent);
    component = fixture.componentInstance;
    component.server = { id: 'a', name: 'Aberration', mapName: 'Aberration_WP', state: 'running', players: 12, maxPlayers: 70, cpu: 8.4, memory: 6348.8, startedAt: now - (3 * 86400 + 14 * 3600) * 1000 } as any;
    component.now = now;
    fixture.detectChanges();
  });

  it('should create and render the name, map and status', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.server-card-name')?.textContent).toContain('Aberration');
    expect(el.querySelector('.server-card-map')?.textContent).toContain('Aberration');
    expect(el.querySelector('.card-status')?.textContent?.trim()).toBe('Online');
  });

  it('formats the headline stats for a running server', () => {
    expect(component.players).toBe('12 / 70');
    expect(component.uptime).toBe('3d 14h');
    expect(component.cpu).toBe('8%');
    expect(component.memory).toBe('6.2 GB');
    component.hostMemoryTotalBytes = 32 * 1024 ** 3;
    expect(component.memoryTotal).toBe('/ 32 GB');
  });

  it('shows dashes and zero players when offline', () => {
    component.server = { ...component.server, state: 'stopped', players: 5 } as any;
    expect(component.status.label).toBe('Offline');
    expect(component.players).toBe('0 / 70');
    expect(component.uptime).toBe('--');
    expect(component.cpu).toBe('--');
    expect(component.canStart).toBeTrue();
    expect(component.canDeleteNow).toBeTrue();
  });

  it('maps transitional states', () => {
    component.server = { ...component.server, state: 'starting' } as any;
    expect(component.status).toEqual({ label: 'Starting', cssClass: 'status-starting' });
    expect(component.isBusy).toBeTrue();
    expect(component.canStart).toBeFalse();
    component.server = { ...component.server, state: 'crashed' } as any;
    expect(component.status.cssClass).toBe('status-error');
    expect(component.canStart).toBeTrue();
  });

  it('emits stop when online and start when startable', () => {
    spyOn(component.start, 'emit');
    spyOn(component.stop, 'emit');
    const event = { stopPropagation: () => {} } as any;
    component.onPrimaryAction(event);
    expect(component.stop.emit).toHaveBeenCalledWith(component.server);
    component.server = { ...component.server, state: 'stopped' } as any;
    component.onPrimaryAction(event);
    expect(component.start.emit).toHaveBeenCalledWith(component.server);
  });

  it('emits console, configure, backups, force stop and remove', () => {
    spyOn(component.openConsole, 'emit');
    spyOn(component.configure, 'emit');
    spyOn(component.openBackups, 'emit');
    spyOn(component.forceStop, 'emit');
    spyOn(component.remove, 'emit');
    component.onConsole({ stopPropagation: () => {} } as any);
    component.onConfigure();
    component.onBackups();
    component.onForceStop();
    component.onRemove();
    expect(component.openConsole.emit).toHaveBeenCalled();
    expect(component.configure.emit).toHaveBeenCalled();
    expect(component.openBackups.emit).toHaveBeenCalled();
    expect(component.forceStop.emit).toHaveBeenCalled();
    expect(component.remove.emit).toHaveBeenCalled();
    expect(component.menuOpen).toBeFalse();
  });

  it('toggles the menu and closes it on outside clicks', () => {
    component.toggleMenu({ stopPropagation: () => {} } as any);
    expect(component.menuOpen).toBeTrue();
    component.onDocumentClick({ target: document.body } as any);
    expect(component.menuOpen).toBeFalse();
  });

  it('places the menu in viewport coordinates, clear of the card', async () => {
    const trigger = fixture.nativeElement.querySelector('[aria-label="More actions"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.card-menu') as HTMLElement;
    expect(menu).withContext('the menu should be in the DOM once open').toBeTruthy();
    // The card hides its overflow for the artwork, so the menu is positioned against the
    // viewport instead of being clipped to the card's edge.
    expect(getComputedStyle(menu).position).toBe('fixed');
    expect(component.menuPosition.left).toBeGreaterThanOrEqual(0);
    expect(component.menuPosition.top).toBeGreaterThanOrEqual(0);
  });

  it('keeps the menu on the button when the page scrolls', () => {
    component.toggleMenu({ stopPropagation: () => {} } as any);
    const placed = { ...component.menuPosition };

    component.menuPosition = { left: -999, top: -999 };
    component.onViewportChange();

    expect(component.menuPosition).toEqual(placed);
  });
});
