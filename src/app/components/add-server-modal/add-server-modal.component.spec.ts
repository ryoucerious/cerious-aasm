import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AddServerModalComponent } from './add-server-modal.component';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { NotificationService } from '../../core/services/notification.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';

describe('AddServerModalComponent', () => {
  let component: AddServerModalComponent;
  let fixture: ComponentFixture<AddServerModalComponent>;
  let router: jasmine.SpyObj<Router>;
  let serverInstanceService: any;
  let notification: MockNotificationService;

  beforeEach(async () => {
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
        { provide: NotificationService, useValue: notification }
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

  it('clones without carrying the source id', () => {
    component.setImportMode('clone');
    component.serverName = 'Copy';
    component.selectedServerToClone = { id: 'src', name: 'Source', maxPlayers: 20 } as any;
    component.onAddServer();
    const saved = serverInstanceService.save.calls.mostRecent().args[0];
    expect(saved.id).toBeUndefined();
    expect(saved).toEqual(jasmine.objectContaining({ name: 'Copy', sessionName: 'Copy', maxPlayers: 20 }));
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
    spyOn(notification, 'error');
    serverInstanceService.importServerFromBackup.and.returnValue(throwError(() => new Error('bad zip')));
    component.setImportMode('import');
    component.serverName = 'X';
    component.selectedBackupFile = new File(['x'], 'b.zip');
    await component['importFromBackup']();
    expect(notification.error).toHaveBeenCalled();
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

  it('records a selected zip file', () => {
    const file = new File(['x'], 'save.zip');
    component.onBackupFileSelect({ target: { files: [file] } });
    expect(component.selectedBackupFile).toBe(file);
    expect(component.selectedBackupFilePath).toBe('save.zip');
    component.onBackupFileSelect({ target: { files: [new File(['x'], 'notes.txt')] } });
    expect(component.selectedBackupFile).toBe(file);
  });
});
