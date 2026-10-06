import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServerHeaderComponent } from './server-header.component';

describe('ServerHeaderComponent', () => {
  let component: ServerHeaderComponent;
  let fixture: ComponentFixture<ServerHeaderComponent>;
  const now = 1_700_000_000_000;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ServerHeaderComponent] }).compileComponents();
    fixture = TestBed.createComponent(ServerHeaderComponent);
    component = fixture.componentInstance;
    component.server = { id: 'a', name: 'Ragnarok', mapName: 'Ragnarok_WP', state: 'Running', maxPlayers: 70, gamePort: 7777, queryPort: 27015 } as any;
    component.live = { id: 'a', name: 'Ragnarok', state: 'running', players: 18, memory: 10649.6, cpu: 15, startedAt: now - (86400 + 6 * 3600) * 1000 } as any;
    component.now = now;
    fixture.detectChanges();
  });

  it('should create and render name, map and page title', () => {
    fixture.componentRef.setInput('pageTitle', 'Rates');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.server-header-name')?.textContent).toContain('Ragnarok');
    expect(el.querySelector('.server-header-map')?.textContent).toContain('Ragnarok');
    expect(el.querySelector('.server-header-page')?.textContent).toContain('Rates');
  });

  // A move is occasional: it sits under More actions, away from Start, Stop and Force.
  describe('moving to another machine', () => {
    const page = (): HTMLElement => fixture.nativeElement as HTMLElement;

    function moreButton(): HTMLButtonElement | null {
      fixture.detectChanges();
      return page().querySelector('.server-header-more');
    }

    function moveItem(): HTMLButtonElement | null {
      fixture.detectChanges();
      return page().querySelector('.server-header-menu .server-header-move');
    }

    function stopped(): void {
      fixture.componentRef.setInput('server', { ...component.server, state: 'stopped' });
      fixture.componentRef.setInput('live', { ...component.live, state: 'stopped' });
    }

    it('is under More actions, not beside Start and Stop', () => {
      stopped();
      fixture.componentRef.setInput('canMove', true);
      fixture.detectChanges();

      const controls = Array.from(page().querySelectorAll('.server-header-actions > button')).map(button => button.textContent?.trim());
      expect(controls.some(label => label?.includes('Move'))).toBeFalse();
      expect(moveItem()).toBeNull();

      moreButton()!.click();

      expect(moveItem()?.textContent).toContain('Move to another machine');
    });

    it('moves a server that is off, and closes the menu', () => {
      stopped();
      fixture.componentRef.setInput('canMove', true);
      spyOn(component.moveServer, 'emit');
      moreButton()!.click();

      moveItem()!.click();

      expect(component.moveServer.emit).toHaveBeenCalled();
      expect(moveItem()).toBeNull();
    });

    it('says to stop a running server before moving it', () => {
      fixture.componentRef.setInput('canMove', true);
      spyOn(component.moveServer, 'emit');
      moreButton()!.click();

      moveItem()!.click();

      expect(moveItem()!.disabled).toBeTrue();
      expect(page().querySelector('.server-header-menu')?.textContent).toContain('Stop the server to move it');
      expect(component.moveServer.emit).not.toHaveBeenCalled();
    });

    it('closes on Escape, and on a click anywhere else', () => {
      stopped();
      fixture.componentRef.setInput('canMove', true);

      moreButton()!.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(moveItem()).toBeNull();

      moreButton()!.click();
      document.body.click();
      expect(moveItem()).toBeNull();
    });

    it('is not there when the server may not be moved, or there is nowhere to move it', () => {
      stopped();

      expect(moreButton()).toBeNull();
    });
  });

  it('reads the mapped display state from the page copy', () => {
    expect(component.stateKey).toBe('running');
    expect(component.statusText).toBe('Online');
    expect(component.statusClass).toBe('status-running');
    expect(component.canStop).toBeTrue();
    expect(component.canStart).toBeFalse();
    expect(component.canForceStop).toBeTrue();
  });

  it('formats live stats', () => {
    expect(component.players).toBe('18 / 70');
    expect(component.memory).toBe('10.4 GB');
    expect(component.cpu).toBe('15%');
    expect(component.uptime).toBe('1d 6h');
    expect(component.ports).toBe('Game 7777 · Query 27015');
  });

  it('handles "Preparing to start" and stopped states', () => {
    component.server = { ...component.server, state: 'Preparing to start' } as any;
    expect(component.stateKey).toBe('queued');
    expect(component.statusClass).toBe('status-starting');
    expect(component.canForceStop).toBeTrue();

    component.server = { ...component.server, state: undefined } as any;
    component.live = null;
    expect(component.stateKey).toBe('stopped');
    expect(component.canStart).toBeTrue();
    expect(component.players).toBe('0 / 70');
    expect(component.uptime).toBe('--');
  });

  it('emits the lifecycle events', () => {
    spyOn(component.startServer, 'emit');
    spyOn(component.stopServer, 'emit');
    spyOn(component.forceStopServer, 'emit');
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.server-header-actions .btn:nth-child(2)') as HTMLButtonElement).click();
    (el.querySelector('.server-header-actions .btn:nth-child(3)') as HTMLButtonElement).click();
    expect(component.stopServer.emit).toHaveBeenCalled();
    expect(component.forceStopServer.emit).toHaveBeenCalled();
    component.startServer.emit();
    expect(component.startServer.emit).toHaveBeenCalled();
  });

  it('renders nothing without a server', () => {
    fixture.componentRef.setInput('server', null);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.server-header')).toBeNull();
  });
});
