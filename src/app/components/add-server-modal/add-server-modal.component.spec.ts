import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { AddServerModalComponent } from './add-server-modal.component';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { NotificationService } from '../../core/services/notification.service';
import { IpcService } from '../../core/services/ipc.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';

describe('AddServerModalComponent', () => {
  let component: AddServerModalComponent;
  let fixture: ComponentFixture<AddServerModalComponent>;
  let router: jasmine.SpyObj<Router>;
  let serverInstanceService: any;
  let notification: MockNotificationService;
  let ipc: { isElectron: boolean };

  beforeEach(async () => {
    ipc = { isElectron: false };
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    serverInstanceService = {
      getDefaultInstanceFromMeta: jasmine.createSpy('getDefaultInstanceFromMeta').and.returnValue(of({ maxPlayers: 70 })),
      save: jasmine.createSpy('save').and.returnValue(of({ success: true, instance: { id: 'new', name: 'Fresh' } })),
      importServerFromBackup: jasmine.createSpy('importServerFromBackup').and.returnValue(of({ success: true, instance: { id: 'imp', name: 'Imported' } })),
      setActiveServer: jasmine.createSpy('setActiveServer')
    };
    notification = new MockNotificationService();

    await TestBed.configureTestingModule({
      imports: [AddServerModalComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: ServerInstanceService, useValue: serverInstanceService },
        { provide: NotificationService, useValue: notification },
        { provide: IpcService, useValue: ipc }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AddServerModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('validates each mode', () => {
    component.importMode = 'create';
    expect(component.canAddServer()).toBeFalse();
    component.serverName = 'abc';
    expect(component.canAddServer()).toBeTrue();

    component.setImportMode('import');
    expect(component.serverName).toBe('');
    component.serverName = 'abc';
    expect(component.canAddServer()).toBeFalse();
    component.selectedBackupFilePath = 'C:/backup.zip';
    expect(component.canAddServer()).toBeTrue();

    component.setImportMode('clone');
    component.serverName = 'abc';
    expect(component.canAddServer()).toBeFalse();
    component.selectedServerToClone = { id: '1', name: 'Src' } as any;
    expect(component.canAddServer()).toBeTrue();
  });

  it('creates a server from defaults and lands on its general page', () => {
    spyOn(component.created, 'emit');
    spyOn(component.closed, 'emit');
    component.serverName = 'Fresh';
    component.onAddServer();
    expect(serverInstanceService.save).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'Fresh', sessionName: 'Fresh', maxPlayers: 70 }));
    expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith({ id: 'new', name: 'Fresh' });
    expect(component.created.emit).toHaveBeenCalledWith({ id: 'new', name: 'Fresh' } as any);
    expect(component.closed.emit).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'general']);
  });

  it('places a new server on the chosen node', () => {
    component.placementNodes = [{ nodeId: 'node-1', name: 'Jareds-PC' }];
    component.ngOnChanges({ placementNodes: { currentValue: component.placementNodes } } as any);
    expect(component.placementOptions.map(option => option.label)).toEqual(['Auto-select', 'Jareds-PC']);
    component.serverName = 'Fresh';
    component.selectedNodeId = 'node-1';
    component.onAddServer();
    expect(serverInstanceService.save).toHaveBeenCalledWith(jasmine.objectContaining({ nodeId: 'node-1' }));
  });

  it('clones without carrying the source id', () => {
    component.setImportMode('clone');
    component.serverName = 'Copy';
    component.selectedServerToClone = { id: 'src', name: 'Source', maxPlayers: 20 } as any;
    component.onAddServer();
    const saved = serverInstanceService.save.calls.mostRecent().args[0];
    expect(saved.id).toBeUndefined();
    expect(saved).toEqual(jasmine.objectContaining({ name: 'Copy', sessionName: 'Copy', maxPlayers: 20 }));
  });

  it('clones only the settings, not what the source server is doing', () => {
    component.setImportMode('clone');
    component.serverName = 'Copy';
    component.selectedServerToClone = {
      id: 'src', name: 'Source', maxPlayers: 20, state: 'running', status: 'online', players: 5, cpu: 30, memory: 8000, startedAt: 1
    } as any;
    component.onAddServer();
    const saved = serverInstanceService.save.calls.mostRecent().args[0];
    expect(saved).toEqual({ name: 'Copy', sessionName: 'Copy', maxPlayers: 20 });
  });

  it('frees the dialog when the defaults cannot be loaded', () => {
    spyOn(notification, 'error');
    serverInstanceService.getDefaultInstanceFromMeta.and.returnValue(throwError(() => new Error('404')));
    component.serverName = 'Fresh';
    component.onAddServer();
    expect(notification.error).toHaveBeenCalled();
    expect(component.busy).toBeFalse();
  });

  it('reports a refusal that gives no reason and stays open', () => {
    spyOn(notification, 'warning');
    spyOn(component.closed, 'emit');
    serverInstanceService.save.and.returnValue(of({ success: false }));
    component.serverName = 'Dup';
    component.onAddServer();
    expect(notification.warning).toHaveBeenCalled();
    expect(component.closed.emit).not.toHaveBeenCalled();
    expect(component.busy).toBeFalse();
  });

  it('is not left busy by an empty reply', () => {
    serverInstanceService.save.and.returnValue(of(null));
    component.serverName = 'Fresh';
    component.onAddServer();
    expect(component.busy).toBeFalse();
  });

  it('stays open while a server is being added, as its Cancel button does', () => {
    spyOn(component.closed, 'emit');
    serverInstanceService.save.and.returnValue(NEVER);
    component.serverName = 'Fresh';
    component.onAddServer();
    component.onCancel();
    expect(component.closed.emit).not.toHaveBeenCalled();
    expect(component.busy).toBeTrue();
  });

  it('surfaces a backend validation error and stays open', () => {
    spyOn(notification, 'warning');
    spyOn(component.closed, 'emit');
    serverInstanceService.save.and.returnValue(of({ success: false, error: 'Name taken' }));
    component.serverName = 'Dup';
    component.onAddServer();
    expect((notification.warning as jasmine.Spy).calls.mostRecent().args[0]).toBe('Name taken');
    expect(component.closed.emit).not.toHaveBeenCalled();
    expect(component.busy).toBeFalse();
  });

  it('imports an uploaded backup file in the browser', async () => {
    component.setImportMode('import');
    component.serverName = 'Imported';
    component.selectedBackupFile = new File(['zip-bytes'], 'b.zip');
    await component['importFromBackup']();
    expect(serverInstanceService.importServerFromBackup).toHaveBeenCalledWith('Imported', undefined, jasmine.any(String), 'b.zip');
    expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith({ id: 'imp', name: 'Imported' });
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'general']);
  });

  it('reports import failures', async () => {
    spyOn(console, 'error');
    spyOn(notification, 'error');
    serverInstanceService.importServerFromBackup.and.returnValue(throwError(() => new Error('bad zip')));
    component.setImportMode('import');
    component.serverName = 'X';
    component.selectedBackupFile = new File(['x'], 'b.zip');
    await component['importFromBackup']();
    expect(notification.error).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[add-server-modal] Failed to import backup:', jasmine.any(Error));
    expect(component.busy).toBeFalse();
  });

  it('resets state when reopened and when cancelled', () => {
    spyOn(component.closed, 'emit');
    component.serverName = 'dirty';
    component.importMode = 'clone';
    component.show = true;
    component.ngOnChanges({ show: { currentValue: true, previousValue: false, firstChange: false, isFirstChange: () => false } });
    expect(component.serverName).toBe('');
    expect(component.importMode).toBe('create');
    component.serverName = 'dirty again';
    component.onCancel();
    expect(component.serverName).toBe('');
    expect(component.closed.emit).toHaveBeenCalled();
  });

  function chooseFile(file: File): void {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [file] });
    component.onBackupFileSelect({ target: input } as unknown as Event);
  }

  it('records a selected zip file', () => {
    const file = new File(['x'], 'save.zip');
    chooseFile(file);
    expect(component.selectedBackupFile).toBe(file);
    expect(component.selectedBackupFilePath).toBe('save.zip');
    chooseFile(new File(['x'], 'notes.txt'));
    expect(component.selectedBackupFile).toBe(file);
  });

  it('imports by path in the desktop app, where a chosen file has one', () => {
    ipc.isElectron = true;
    const file = Object.assign(new File(['x'], 'save.zip'), { path: 'C:\\Backups\\save.zip' });
    chooseFile(file);
    expect(component.selectedBackupFilePath).toBe('C:\\Backups\\save.zip');

    component.setImportMode('import');
    component.serverName = 'Imported';
    chooseFile(file);
    component.onAddServer();
    expect(serverInstanceService.importServerFromBackup).toHaveBeenCalledWith('Imported', 'C:\\Backups\\save.zip');
  });

  it('opens the file picker for Browse', () => {
    fixture.componentRef.setInput('show', true);
    fixture.detectChanges();
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.import-mode-selector button')) as HTMLButtonElement[];
    tabs.find(tab => tab.textContent?.includes('Import from Backup'))!.click();
    fixture.detectChanges();
    const picker = fixture.nativeElement.querySelector('input[type=file]') as HTMLInputElement;
    spyOn(picker, 'click');
    component.selectBackupFile();
    expect(picker.click).toHaveBeenCalled();
  });
});
