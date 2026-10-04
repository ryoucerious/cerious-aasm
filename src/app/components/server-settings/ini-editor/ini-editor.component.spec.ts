import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { IniEditorComponent } from './ini-editor.component';
import { MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';

describe('IniEditorComponent', () => {
  let fixture: ComponentFixture<IniEditorComponent>;
  let component: IniEditorComponent;
  let notification: jasmine.SpyObj<NotificationService>;
  let loads: { payload: { instanceId: string; filename: string }; reply: Subject<unknown> }[];
  let saves: { instanceId: string; filename: string; content: string }[];
  let confirmSpy: jasmine.Spy;

  beforeEach(async () => {
    confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    loads = [];
    saves = [];
    notification = jasmine.createSpyObj<NotificationService>('NotificationService', ['success', 'error', 'info', 'warning']);
    const sendMessage = (channel: string, payload: any) => {
      if (channel === 'get-ini-file') {
        const reply = new Subject<unknown>();
        loads.push({ payload, reply });
        return reply;
      }
      saves.push(payload);
      return of({ success: true });
    };
    await TestBed.configureTestingModule({
      imports: [IniEditorComponent],
      providers: [
        { provide: MessagingService, useValue: { sendMessage } },
        { provide: NotificationService, useValue: notification }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(IniEditorComponent);
    component = fixture.componentInstance;
  });

  const open = (instanceId: string, filename: string) => {
    fixture.componentRef.setInput('instanceId', instanceId);
    fixture.componentRef.setInput('filename', filename);
    fixture.detectChanges();
  };
  const answer = (index: number, content: string) => {
    loads[index].reply.next({ success: true, content });
    loads[index].reply.complete();
    fixture.detectChanges();
  };

  it('loads the file it is given', () => {
    open('A', 'Game.ini');
    expect(loads.map(load => load.payload)).toEqual([{ instanceId: 'A', filename: 'Game.ini' }]);
    expect(component.loading).toBeTrue();
    answer(0, '[ServerSettings]');
    expect(component.content).toBe('[ServerSettings]');
    expect(component.loading).toBeFalse();
    expect(component.dirty).toBeFalse();
  });

  it('does not reload for the same server and file', () => {
    open('A', 'Game.ini');
    answer(0, 'text');
    component.content = 'edited';
    open('A', 'Game.ini');
    expect(loads.length).toBe(1);
    expect(component.content).toBe('edited');
  });

  it('drops the reply for a file the user has left', () => {
    open('A', 'Game.ini');
    open('A', 'Engine.ini');
    answer(1, 'engine');
    answer(0, 'game');
    expect(component.content).toBe('engine');
  });

  it('drops the reply for a server the user has left', () => {
    open('A', 'Game.ini');
    open('B', 'Game.ini');
    answer(0, 'server A');
    expect(component.content).toBe('');
    answer(1, 'server B');
    expect(component.content).toBe('server B');
  });

  describe('after a load that failed', () => {
    const saveButton = () => (fixture.nativeElement as HTMLElement).querySelector('button[title="Save to disk"]') as HTMLButtonElement;

    it('does not write the empty editor over the file when the request failed', () => {
      open('A', 'Game.ini');
      loads[0].reply.error(new Error('Timeout has occurred'));
      fixture.detectChanges();
      component.content = 'typed after the failure';
      component.save();
      fixture.detectChanges();
      expect(saves).toEqual([]);
      expect(saveButton().disabled).toBeTrue();
    });

    it('does not write the empty editor over the file when the backend refused', () => {
      open('A', 'Game.ini');
      loads[0].reply.next({ success: false, error: 'Access denied' });
      loads[0].reply.complete();
      fixture.detectChanges();
      component.save();
      expect(saves).toEqual([]);
      expect(saveButton().disabled).toBeTrue();
    });

    it('can load the file again', () => {
      open('A', 'Game.ini');
      loads[0].reply.error(new Error('Timeout has occurred'));
      component.reload();
      answer(1, 'text');
      expect(component.content).toBe('text');
      expect(saveButton().disabled).toBeFalse();
    });
  });

  describe('with unsaved edits', () => {
    beforeEach(() => {
      open('A', 'Game.ini');
      answer(0, 'original');
      component.content = 'edited';
    });

    it('offers to save them before opening another file', () => {
      confirmSpy.and.returnValue(true);
      open('A', 'Engine.ini');
      expect(confirmSpy).toHaveBeenCalled();
      expect(saves).toEqual([{ instanceId: 'A', filename: 'Game.ini', content: 'edited' }]);
      expect(loads[1].payload).toEqual({ instanceId: 'A', filename: 'Engine.ini' });
    });

    it('discards them when the user declines', () => {
      open('B', 'Game.ini');
      expect(confirmSpy).toHaveBeenCalled();
      expect(saves).toEqual([]);
      expect(component.content).toBe('');
    });

    it('offers to save them when the editor closes', () => {
      confirmSpy.and.returnValue(true);
      fixture.destroy();
      expect(saves).toEqual([{ instanceId: 'A', filename: 'Game.ini', content: 'edited' }]);
    });

    it('asks before a reload throws them away', () => {
      component.reload();
      expect(confirmSpy).toHaveBeenCalled();
      expect(loads.length).toBe(1);
      expect(component.content).toBe('edited');
    });

    it('is clean again once saved', () => {
      component.save();
      expect(saves).toEqual([{ instanceId: 'A', filename: 'Game.ini', content: 'edited' }]);
      expect(component.dirty).toBeFalse();
      expect(component.saving).toBeFalse();
    });
  });

  it('reloads without asking when nothing was edited', () => {
    open('A', 'Game.ini');
    answer(0, 'text');
    component.reload();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(loads.length).toBe(2);
  });

  it('reports a file that could not be read', () => {
    open('A', 'Game.ini');
    loads[0].reply.error(new Error('Timeout has occurred'));
    expect(notification.error).toHaveBeenCalledWith('Failed to load INI file.', 'Expert Mode');
    expect(component.loading).toBeFalse();
  });

  it('reports a save that failed', () => {
    open('A', 'Game.ini');
    answer(0, 'text');
    TestBed.inject(MessagingService).sendMessage = (() => throwError(() => new Error('denied'))) as any;
    component.save();
    expect(notification.error).toHaveBeenCalledWith('Failed to save INI file.', 'Expert Mode');
    expect(component.saving).toBeFalse();
  });
});
