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
  let destinations: MoveDestination[];
  let notification: { success: jasmine.Spy; error: jasmine.Spy; warning: jasmine.Spy };

  const isle = { id: 'isle', name: 'The Isle', state: 'stopped', nodeId: 'desk' } as ServerInstance;

  beforeEach(async () => {
    destinations = [{ nodeId: 'box', name: 'Basement Box' }, { nodeId: 'lab', name: 'Lab' }];
    reply$ = new Subject<unknown>();
    sendMessage = jasmine.createSpy('sendMessage').and.returnValue(reply$);
    notification = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error'), warning: jasmine.createSpy('warning') };
    await TestBed.configureTestingModule({
      imports: [MoveServerDialogComponent],
      providers: [
        { provide: MessagingService, useValue: { sendMessage } },
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
});
