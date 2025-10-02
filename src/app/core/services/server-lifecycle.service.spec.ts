import { ServerLifecycleService } from './server-lifecycle.service';
import { MessagingService } from './messaging/messaging.service';
import { RconManagementService } from './rcon-management.service';
import { ServerStateService } from './server-state.service';
import { NotificationService } from './notification.service';
import { ChangeDetectorRef } from '@angular/core';
import { of } from 'rxjs';

describe('ServerLifecycleService', () => {
  let service: ServerLifecycleService;
  let messagingMock: jasmine.SpyObj<MessagingService>;
  let rconMock: jasmine.SpyObj<RconManagementService>;
  let stateMock: jasmine.SpyObj<ServerStateService>;
  let notificationMock: jasmine.SpyObj<NotificationService>;
  let cdrMock: jasmine.SpyObj<ChangeDetectorRef>;

  beforeEach(() => {
    messagingMock = jasmine.createSpyObj('MessagingService', ['sendMessage']);
    rconMock = jasmine.createSpyObj('RconManagementService', ['sendRconCommand']);
    stateMock = jasmine.createSpyObj('ServerStateService', ['clearLogsForInstance', 'canStartInstance', 'mapServerState']);
    notificationMock = jasmine.createSpyObj('NotificationService', ['info']);
    cdrMock = jasmine.createSpyObj('ChangeDetectorRef', ['markForCheck']);
    messagingMock.sendMessage.and.returnValue(of({}));
    rconMock.sendRconCommand.and.returnValue(of({}));
    service = new ServerLifecycleService(messagingMock, rconMock, stateMock, notificationMock);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start server', () => {
    const instance = { id: 'id1', logs: [], state: null };
    service.startServer(instance, cdrMock);
    expect(stateMock.clearLogsForInstance).toHaveBeenCalledWith('id1');
    expect(cdrMock.markForCheck).toHaveBeenCalled();
    expect(messagingMock.sendMessage).toHaveBeenCalledWith('start-server-instance', { id: 'id1' });
  });

  it('should not start server if no id', () => {
    service.startServer({}, cdrMock);
    expect(messagingMock.sendMessage).not.toHaveBeenCalled();
  });

  it('should stop server and show notification', (done) => {
    const instance = { id: 'id2', name: 'TestServer' };
    spyOn(window, 'setTimeout').and.callFake((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      if (typeof handler === 'function') handler();
      return 0;
    });
    service.stopServer(instance);
    expect(notificationMock.info).toHaveBeenCalledWith('Stopping server TestServer...', 'Server Control');
    expect(rconMock.sendRconCommand).toHaveBeenCalledWith('id2', 'ServerChat Server is shutting down in 5 seconds!');
    setTimeout(() => {
      expect(rconMock.sendRconCommand).toHaveBeenCalledWith('id2', 'DoExit');
      expect(messagingMock.sendMessage).toHaveBeenCalledWith('stop-server-instance', { id: 'id2' });
      done();
    }, 0);
  });

  it('should force stop server', () => {
    const instance = { id: 'id3' };
    service.forceStopServer(instance);
    expect(messagingMock.sendMessage).toHaveBeenCalledWith('force-stop-server-instance', { id: 'id3' });
  });

  it('should restart server', (done) => {
    const instance = { id: 'id4', logs: [], state: null };
    spyOn(window, 'setTimeout').and.callFake((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      if (typeof handler === 'function') handler();
      return 0;
    });
    spyOn(service, 'startServer').and.callThrough();
    spyOn(service, 'stopServer').and.callThrough();
    service.restartServer(instance, cdrMock);
    expect(service.stopServer).toHaveBeenCalledWith(instance);
    setTimeout(() => {
      expect(service.startServer).toHaveBeenCalledWith(instance, cdrMock);
      done();
    }, 0);
  });

  it('should delegate canStartInstance', () => {
    stateMock.canStartInstance.and.returnValue(true);
    expect(service.canStartInstance('stopped')).toBeTrue();
    expect(stateMock.canStartInstance).toHaveBeenCalledWith('stopped');
  });

  it('should delegate mapServerState', () => {
    stateMock.mapServerState.and.returnValue('Running');
    expect(service.mapServerState('running')).toBe('Running');
    expect(stateMock.mapServerState).toHaveBeenCalledWith('running');
  });
});
