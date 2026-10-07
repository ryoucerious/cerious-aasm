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

  it('offers no button at all while its machine cannot be reached', () => {
    fixture.componentRef.setInput('server', { ...component.server, state: 'unreachable', gamePort: 7777 });
    component.canMove = true;
    fixture.detectChanges();

    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter(button => !button.disabled).map(button => button.textContent?.trim())).toEqual([]);
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

  // The icon font comes from Google Fonts. Until it loads, or where it is blocked, each icon is
  // its ligature word ("schedule"), which took the value's room and cut "3d 14h" to "3d…".
  it('shows every stat whole on the narrowest card', () => {
    const host = fixture.nativeElement as HTMLElement;
    host.style.display = 'block';
    host.style.width = '300px';
    component.hostMemoryTotalBytes = 128 * 1024 ** 3;
    fixture.detectChanges();

    const cut = Array.from(host.querySelectorAll<HTMLElement>('.server-stat-value, .server-stat-label'))
      .filter(text => text.scrollWidth > text.clientWidth)
      .map(text => text.textContent?.trim());

    expect(cut).toEqual([]);
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

  describe('moving to another machine', () => {
    function menuItems(): string[] {
      component.toggleMenu({ stopPropagation: () => {} } as any);
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();
      return Array.from(fixture.nativeElement.querySelectorAll('.card-menu-item') as NodeListOf<HTMLElement>)
        .map(item => item.textContent?.trim() || '');
    }

    it('is offered for a server that is off, when it may be moved', () => {
      component.server = { ...component.server, state: 'stopped' } as any;
      component.canMove = true;
      spyOn(component.move, 'emit');

      expect(menuItems()).toContain('drive_file_move Move to…');
      (Array.from(fixture.nativeElement.querySelectorAll('.card-menu-item') as NodeListOf<HTMLButtonElement>)
        .find(item => item.textContent?.includes('Move to'))!).click();

      expect(component.move.emit).toHaveBeenCalledWith(component.server);
      expect(component.menuOpen).toBeFalse();
    });

    it('is not offered while the server is running or busy', () => {
      component.canMove = true;
      for (const state of ['running', 'starting', 'stopping', 'queued']) {
        component.server = { ...component.server, state } as any;
        component.menuOpen = false;
        expect(menuItems().some(item => item.includes('Move to'))).withContext(state).toBeFalse();
      }
    });

    it('is not offered when the server may not be moved, or there is nowhere to move it', () => {
      component.server = { ...component.server, state: 'stopped' } as any;
      component.canMove = false;

      expect(menuItems().some(item => item.includes('Move to'))).toBeFalse();
    });
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
  describe('join address', () => {
    it('is the host the panel was opened on plus the game port', () => {
      spyOn(component as any, 'pageHostname').and.returnValue('ark.example.org');
      component.server = { ...component.server, gamePort: 7787 } as any;
      expect(component.connectAddress).toBe('ark.example.org:7787');
    });

    // In a mesh the server can run on another machine than the one this page came from.
    it('is the address of the machine hosting the server, when the page says which', () => {
      spyOn(component as any, 'pageHostname').and.returnValue('localhost');
      component.server = { ...component.server, gamePort: 7787 } as any;
      component.joinHost = '192.168.1.155';
      expect(component.connectAddress).toBe('192.168.1.155:7787');
    });

    it('falls back to the MultiHome address when the panel runs on localhost', () => {
      spyOn(component as any, 'pageHostname').and.returnValue('localhost');
      component.server = { ...component.server, gamePort: 7777, multiHome: '203.0.113.5' } as any;
      expect(component.connectAddress).toBe('203.0.113.5:7777');
    });

    it('shows localhost and the game port when that is the only host known', () => {
      spyOn(component as any, 'pageHostname').and.returnValue('127.0.0.1');
      component.server = { ...component.server, gamePort: 7777 } as any;
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();
      expect(component.connectAddress).toBe('127.0.0.1:7777');
      const button = fixture.nativeElement.querySelector('.server-card-address .server-card-copy') as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(button.textContent?.trim()).toBe('content_copy');
      expect(button.getAttribute('data-tooltip')).toBe('Copy');
      expect(fixture.nativeElement.querySelector('.server-card-actions .server-card-copy')).toBeNull();
      expect(fixture.nativeElement.querySelector('.server-card-details')?.textContent).toContain('127.0.0.1:7777');
    });

    it('copies the address and shows it as copied', async () => {
      spyOn(component as any, 'pageHostname').and.returnValue('ark.example.org');
      component.server = { ...component.server, gamePort: 7777 } as any;
      const writeText = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      await component.onCopyAddress({ stopPropagation() {} } as any);
      expect(writeText).toHaveBeenCalledWith('ark.example.org:7777');
      expect(component.copied).toBeTrue();
    });
  });
  describe('hero labels and menu', () => {
    it('shows the session name when it matches the server name', () => {
      component.server = { ...component.server, sessionName: 'Aberration' } as any;
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.server-card-details-main')?.textContent).toContain('Aberration');
    });

    it('puts the operator, assignee and join address with the session name', () => {
      spyOn(component as any, 'pageHostname').and.returnValue('ark.example.org');
      component.server = { ...component.server, gamePort: 7777, operatorUserId: 'op1', managerUserId: 'm1', sessionName: 'Official Island' } as any;
      component.operatorLabel = 'Ops';
      component.assigneeLabel = 'Server Manager · mia';
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const details = el.querySelector('.server-card-details') as HTMLElement;
      expect(el.querySelector('.server-card-hero .server-card-details')).toBeNull();
      expect(details.querySelector('.server-card-details-main')?.textContent).toContain('Official Island');
      expect(details.querySelector('.server-card-details-main')?.textContent).toContain('Ops');
      expect(details.querySelector('.server-card-details-main')?.textContent).toContain('Server Manager · mia');
      expect(details.querySelector('.server-card-address')?.textContent).toContain('ark.example.org:7777');
    });

    it('keeps the same space above the stats when a server has no operator or assignee', () => {
      spyOn(component as any, 'pageHostname').and.returnValue('ark.example.org');
      component.server = { ...component.server, gamePort: 7777, operatorUserId: 'op1', managerUserId: 'm1', sessionName: 'Official Island' } as any;
      component.operatorLabel = 'Ops';
      component.assigneeLabel = 'Server Manager · mia';
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();
      const assigned = (fixture.nativeElement.querySelector('.server-card-details') as HTMLElement).offsetHeight;

      component.server = { ...component.server, operatorUserId: null, managerUserId: null, sessionName: component.server.name } as any;
      component.operatorLabel = '';
      component.assigneeLabel = '';
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();
      const unassigned = (fixture.nativeElement.querySelector('.server-card-details') as HTMLElement).offsetHeight;

      expect(unassigned).toBe(assigned);
    });

    it('hides Admin and Not assigned, and still shows the join address with the session lines', () => {
      spyOn(component as any, 'pageHostname').and.returnValue('ark.example.org');
      component.server = { ...component.server, gamePort: 7777 } as any;
      component.operatorLabel = 'Admin';
      component.assigneeLabel = 'Not assigned';
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const details = el.querySelector('.server-card-details') as HTMLElement;
      expect(details.textContent).not.toContain('Admin');
      expect(details.textContent).not.toContain('Not assigned');
      expect(details.textContent).toContain('ark.example.org:7777');
    });

    it('hides Configure and Backups when the role lacks them', () => {
      component.canConfigure = false;
      component.canBackups = false;
      component.menuOpen = true;
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();

      const items = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.card-menu-item')).map(el => el.textContent?.trim() || '');
      expect(items.some(text => text.includes('Configure'))).toBeFalse();
      expect(items.some(text => text.includes('Backups'))).toBeFalse();
      expect(items.length).toBeGreaterThan(0);
    });
  });
});
