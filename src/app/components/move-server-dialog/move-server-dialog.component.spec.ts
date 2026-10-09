import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MoveServerDialogComponent } from './move-server-dialog.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { MeshNodesService, MoveDestination } from '../../core/services/mesh-nodes.service';
import { ServerInstance } from '../../core/models/server-instance.model';

describe('MoveServerDialogComponent', () => {
  let fixture: ComponentFixture<MoveServerDialogComponent>;
  let component: MoveServerDialogComponent;
  let sendMessage: jasmine.Spy;
  let reply$: Subject<unknown>;
  let progress$: Subject<unknown>;
  let destinations: MoveDestination[];
  let notification: { success: jasmine.Spy; error: jasmine.Spy; warning: jasmine.Spy };

  const isle = { id: 'isle', name: 'The Isle', state: 'stopped', nodeId: 'desk' } as ServerInstance;

  beforeEach(async () => {
    destinations = [{ nodeId: 'box', name: 'Basement Box' }, { nodeId: 'lab', name: 'Lab' }];
    reply$ = new Subject<unknown>();
    progress$ = new Subject<unknown>();
    sendMessage = jasmine.createSpy('sendMessage').and.returnValue(reply$);
    notification = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error'), warning: jasmine.createSpy('warning') };
    await TestBed.configureTestingModule({
      imports: [MoveServerDialogComponent],
      providers: [
        { provide: MessagingService, useValue: { sendMessage, receiveMessage: (channel: string) => (channel === 'server-move-progress' ? progress$ : new Subject()) } },
        { provide: NotificationService, useValue: notification },
        { provide: MeshNodesService, useValue: { destinationsFor: () => destinations } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(MoveServerDialogComponent);
    component = fixture.componentInstance;
  });

  function open(server: ServerInstance = isle): HTMLElement {
    fixture.componentRef.setInput('server', server);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function confirmButton(page: HTMLElement): HTMLButtonElement {
    return page.querySelector<HTMLButtonElement>('.move-dialog-confirm')!;
  }

  function choose(nodeId: string): void {
    component.destinationId = nodeId;
    fixture.detectChanges();
  }

  it('stays closed until it is given a server', () => {
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.move-dialog')).toBeNull();
  });

  it('offers the machines that can take the server, and waits for a choice', () => {
    const page = open();

    expect(component.destinationOptions).toEqual([{ value: 'box', label: 'Basement Box' }, { value: 'lab', label: 'Lab' }]);
    expect(confirmButton(page).disabled).toBeTrue();
  });

  it('chooses the only machine there is', () => {
    destinations = [{ nodeId: 'box', name: 'Basement Box' }];

    const page = open();

    expect(component.destinationId).toBe('box');
    expect(confirmButton(page).disabled).toBeFalse();
  });

  it('moves the server, allowing an hour for a large world, and closes once it has arrived', () => {
    const page = open();
    const closed = spyOn(component.closed, 'emit');
    choose('lab');

    confirmButton(page).click();
    fixture.detectChanges();

    expect(sendMessage).toHaveBeenCalledWith('move-server', { serverId: 'isle', nodeId: 'lab' }, { timeoutMs: 60 * 60_000 });
    expect(page.querySelector('.move-dialog-progress')?.textContent).toContain('Copying The Isle to Lab');
    expect(confirmButton(page).disabled).toBeTrue();

    reply$.next({ success: true });
    fixture.detectChanges();

    expect(notification.success).toHaveBeenCalledWith('The Isle is now on Lab. It arrived stopped.');
    expect(closed).toHaveBeenCalled();
  });

  it('cannot be closed while the files are being copied', () => {
    const page = open();
    const closed = spyOn(component.closed, 'emit');
    choose('lab');
    confirmButton(page).click();

    component.cancel();

    expect(closed).not.toHaveBeenCalled();
  });

  it('says why a move was refused, and stays open to try again', () => {
    const page = open();
    const closed = spyOn(component.closed, 'emit');
    choose('lab');
    confirmButton(page).click();

    reply$.next({ success: false, error: 'Stop the server before moving it.' });
    fixture.detectChanges();

    expect(page.querySelector('.move-dialog-error')?.textContent).toContain('Stop the server before moving it.');
    expect(closed).not.toHaveBeenCalled();
    expect(confirmButton(page).disabled).toBeFalse();
  });

  it('passes on a warning from a move that finished', () => {
    const page = open();
    choose('lab');
    confirmButton(page).click();

    reply$.next({ success: true, detail: { warning: 'The server moved, but its old files here could not be set aside: busy' } });

    expect(notification.warning).toHaveBeenCalledWith('The server moved, but its old files here could not be set aside: busy');
  });

  it('says when no other machine can take the server', () => {
    destinations = [];

    const page = open();

    expect(page.textContent).toContain('No other machine can take it right now');
    expect(confirmButton(page).disabled).toBeTrue();
  });

  describe('while the files are on their way', () => {
    const GB = 1024 ** 3;

    function moving(): HTMLElement {
      const page = open();
      choose('lab');
      confirmButton(page).click();
      fixture.detectChanges();
      return page;
    }

    function report(update: Record<string, unknown>): void {
      progress$.next({ instanceId: 'isle', destinationName: 'Lab', bytesDone: 0, bytesTotal: 0, resumedBytes: 0, ...update });
      fixture.detectChanges();
    }

    it('says what it is doing before the copy starts and after it ends', () => {
      const page = moving();
      const status = () => page.querySelector('.move-dialog-progress')?.textContent?.replace(/\s+/g, ' ').trim();

      report({ phase: 'preparing' });
      expect(status()).toContain('Preparing The Isle\'s files');
      report({ phase: 'checking' });
      expect(status()).toContain('Checking what Lab already has');
      report({ phase: 'verifying' });
      expect(status()).toContain('Checking the copy on Lab');
    });

    it('shows how far the copy has got', () => {
      const page = moving();

      report({ phase: 'copying', bytesDone: 1.8 * GB, bytesTotal: 2.3 * GB });

      expect(page.querySelector('.move-dialog-progress')?.textContent).toContain('1.8 GB of 2.3 GB (78%)');
      expect((page.querySelector('.move-dialog-meter .meter-fill') as HTMLElement).style.width).toBe('78%');
      expect(page.querySelector('.move-dialog-resumed')).toBeNull();
    });

    it('says how much an earlier attempt had already sent', () => {
      const page = moving();

      report({ phase: 'copying', bytesDone: 1.2 * GB, bytesTotal: 2.3 * GB, resumedBytes: 1.2 * GB });

      expect(page.querySelector('.move-dialog-resumed')?.textContent).toContain('Carrying on: 1.2 GB was already on Lab.');
    });

    it('ignores how far another server\'s move has got', () => {
      const page = moving();

      progress$.next({ instanceId: 'other', phase: 'copying', bytesDone: GB, bytesTotal: 2 * GB, resumedBytes: 0 });
      fixture.detectChanges();

      expect(page.querySelector('.move-dialog-meter')).toBeNull();
    });

    it('says a move that failed part way can be carried on', () => {
      const page = moving();
      report({ phase: 'copying', bytesDone: GB, bytesTotal: 2 * GB });

      reply$.next({ success: false, error: 'socket hang up' });
      fixture.detectChanges();

      expect(page.querySelector('.move-dialog-hint')?.textContent).toContain('Move again to carry on from where this attempt stopped.');
    });

    it('does not offer to carry on a move that was refused before anything was sent', () => {
      const page = moving();

      reply$.next({ success: false, error: 'Stop the server before moving it.' });
      fixture.detectChanges();

      expect(page.querySelector('.move-dialog-hint')).toBeNull();
    });
  });
});
