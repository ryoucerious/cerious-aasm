import { ChangeDetectorRef } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import {
  EXIT_SHUTDOWN_CAP_MS, SHUTDOWN_WARNING_MS, STOP_TIMEOUT_MS, ServerLifecycleService, StopServerResult
} from './server-lifecycle.service';
import { MessagingService } from './messaging/messaging.service';
import { RconManagementService } from './rcon-management.service';
import { ServerStateService } from './server-state.service';
import { NotificationService } from './notification.service';
import { LiveServersService } from './live-servers.service';
import { DeleteInstanceResult, ServerInstanceService } from './server-instance.service';
import { ServerInstance } from '../models/server-instance.model';

describe('ServerLifecycleService', () => {
  let service: ServerLifecycleService;
  let messagingMock: jasmine.SpyObj<MessagingService>;
  let rconMock: jasmine.SpyObj<RconManagementService>;
  let stateMock: jasmine.SpyObj<ServerStateService>;
  let notificationMock: jasmine.SpyObj<NotificationService>;
  let instancesMock: jasmine.SpyObj<ServerInstanceService>;
  let cdrMock: jasmine.SpyObj<ChangeDetectorRef>;
  let roster: ServerInstance[];
  let stopReplies: Record<string, Observable<StopServerResult>>;

  const server = (id: string, state: string): ServerInstance => ({ id, name: `Server ${id}`, state });

  beforeEach(() => {
    roster = [];
    stopReplies = {};
    messagingMock = jasmine.createSpyObj('MessagingService', ['sendMessage']);
    messagingMock.sendMessage.and.callFake(((channel: string, payload: { id: string }) =>
      channel === 'stop-server-instance'
        ? stopReplies[payload.id] ?? of({ success: true, instanceId: payload.id })
        : of({})) as any);
    rconMock = jasmine.createSpyObj('RconManagementService', ['sendRconCommand']);
    rconMock.sendRconCommand.and.returnValue(of({}));
    stateMock = jasmine.createSpyObj('ServerStateService', ['clearLogsForInstance']);
    notificationMock = jasmine.createSpyObj('NotificationService', ['info', 'error', 'success', 'warning']);
    instancesMock = jasmine.createSpyObj('ServerInstanceService', ['delete']);
    instancesMock.delete.and.callFake((id: string) => of({ success: true, id }));
    cdrMock = jasmine.createSpyObj('ChangeDetectorRef', ['markForCheck']);
    const liveServers = {
      get servers() { return roster; },
      find: (id: string) => roster.find(s => s.id === id)
    } as LiveServersService;
    service = new ServerLifecycleService(messagingMock, rconMock, stateMock, notificationMock, liveServers, instancesMock);
  });

  const stopCalls = () => messagingMock.sendMessage.calls.allArgs().filter(([channel]) => channel === 'stop-server-instance');

  it('should start server', () => {
    const instance = server('id1', 'crashed');
    service.startServer(instance, cdrMock);
    expect(instance.state).toBeUndefined();
    expect(stateMock.clearLogsForInstance).toHaveBeenCalledWith('id1');
    expect(cdrMock.markForCheck).toHaveBeenCalled();
    expect(messagingMock.sendMessage).toHaveBeenCalledWith('start-server-instance', { id: 'id1' });
  });

  it('should not start server if no id', () => {
    service.startServer({} as ServerInstance, cdrMock);
    expect(messagingMock.sendMessage).not.toHaveBeenCalled();
  });

  it('warns the players, waits five seconds, then asks the backend to stop', fakeAsync(() => {
    let result: StopServerResult | undefined;
    service.stopServer(server('id2', 'running')).then(res => result = res);

    expect(notificationMock.info).toHaveBeenCalledWith('Stopping Server id2...', 'Server Control');
    expect(rconMock.sendRconCommand).toHaveBeenCalledWith('id2', 'ServerChat Server is shutting down in 5 seconds!');
    tick(SHUTDOWN_WARNING_MS - 1);
    expect(stopCalls()).toEqual([]);

    tick(1);
    flushMicrotasks();

    expect(stopCalls()).toEqual([['stop-server-instance', { id: 'id2' }, { timeoutMs: STOP_TIMEOUT_MS }]]);
    expect(result).toEqual({ success: true, instanceId: 'id2' });
  }));

  it('waits out the backend\'s slowest stop, and closing the app never waits longer', () => {
    // SaveWorld, DoExit, the 120 s exit wait, SIGTERM and the kill add up to about 190 s.
    expect(STOP_TIMEOUT_MS).toBeGreaterThanOrEqual(200_000);
    expect(EXIT_SHUTDOWN_CAP_MS).toBeLessThanOrEqual(STOP_TIMEOUT_MS);
  });

  it('leaves saving and DoExit to the backend', fakeAsync(() => {
    service.stopServer(server('id2', 'running'));
    tick(SHUTDOWN_WARNING_MS);
    flushMicrotasks();
    expect(rconMock.sendRconCommand).not.toHaveBeenCalledWith('id2', 'DoExit');
    expect(rconMock.sendRconCommand).toHaveBeenCalledTimes(1);
  }));

  it('still stops when the warning cannot be sent', fakeAsync(() => {
    rconMock.sendRconCommand.and.returnValue(throwError(() => new Error('RCON not connected')));
    service.stopServer(server('id2', 'starting'));
    tick(SHUTDOWN_WARNING_MS);
    flushMicrotasks();
    expect(stopCalls().length).toBe(1);
  }));

  it('reports a stop the backend could not complete', fakeAsync(() => {
    stopReplies['id2'] = of({ success: false, instanceId: 'id2', error: 'Access denied' });
    let result: StopServerResult | undefined;
    service.stopServer(server('id2', 'running')).then(res => result = res);
    tick(SHUTDOWN_WARNING_MS);
    flushMicrotasks();

    expect(result).toEqual({ success: false, instanceId: 'id2', error: 'Access denied' });
    expect(notificationMock.error).toHaveBeenCalledWith('Access denied', 'Server Control');
  }));

  it('resolves with a failure when the backend never answers', fakeAsync(() => {
    stopReplies['id2'] = throwError(() => new Error('Timeout has occurred'));
    let result: StopServerResult | undefined;
    service.stopServer(server('id2', 'running')).then(res => result = res);
    tick(SHUTDOWN_WARNING_MS);
    flushMicrotasks();

    expect(result).toEqual({ success: false, instanceId: 'id2', error: 'Timeout has occurred' });
    expect(notificationMock.error).toHaveBeenCalled();
  }));

  it('reports a start request that failed', () => {
    spyOn(console, 'error');
    messagingMock.sendMessage.and.returnValue(throwError(() => new Error('socket closed')));
    service.startServer(server('id1', 'stopped'), cdrMock);
    expect(console.error).toHaveBeenCalledWith('[server-lifecycle] Could not start id1:', jasmine.any(Error));
    expect(notificationMock.error).toHaveBeenCalledWith('Could not start Server id1', 'Server Control');
  });

  it('should force stop server', () => {
    service.forceStopServer(server('id3', 'running'));
    expect(messagingMock.sendMessage).toHaveBeenCalledWith('force-stop-server-instance', { id: 'id3' });
  });

  it('reports a force stop request that failed', () => {
    spyOn(console, 'error');
    messagingMock.sendMessage.and.returnValue(throwError(() => new Error('socket closed')));
    service.forceStopServer(server('id3', 'running'));
    expect(console.error).toHaveBeenCalledWith('[server-lifecycle] Could not force stop id3:', jasmine.any(Error));
    expect(notificationMock.error).toHaveBeenCalledWith('Could not force stop Server id3', 'Server Control');
  });

  it('counts running and starting servers from the live roster as running', () => {
    roster = [
      server('a', 'running'), server('b', 'starting'), server('c', 'stopped'),
      server('d', 'queued'), server('e', 'stopping'), server('f', 'crashed')
    ];
    expect(service.runningServers().map(s => s.id)).toEqual(['a', 'b']);
  });

  it('stops every running server in parallel on exit', fakeAsync(() => {
    roster = [server('a', 'running'), server('b', 'starting'), server('c', 'stopped')];
    let done = false;
    service.shutdownAllServers().then(() => done = true);

    tick(SHUTDOWN_WARNING_MS);
    flushMicrotasks();

    expect(stopCalls().map(([, payload]) => payload)).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(done).toBeTrue();
  }));

  it('waits for slow stops, then gives up at the cap', fakeAsync(() => {
    roster = [server('a', 'running'), server('b', 'running')];
    const slow = new Subject<StopServerResult>();
    stopReplies['a'] = slow;
    stopReplies['b'] = NEVER;
    let done = false;
    service.shutdownAllServers().then(() => done = true);

    tick(60_000);
    slow.next({ success: true, instanceId: 'a' });
    flushMicrotasks();
    expect(done).toBeFalse();

    tick(EXIT_SHUTDOWN_CAP_MS - 60_000);
    expect(done).toBeTrue();
  }));

  it('finishes the exit even when stops fail', fakeAsync(() => {
    roster = [server('a', 'running')];
    stopReplies['a'] = throwError(() => new Error('boom'));
    let done = false;
    service.shutdownAllServers().then(() => done = true);
    tick(SHUTDOWN_WARNING_MS);
    flushMicrotasks();
    expect(done).toBeTrue();
  }));

  it('finishes at once with nothing running', fakeAsync(() => {
    roster = [server('c', 'stopped')];
    let done = false;
    service.shutdownAllServers().then(() => done = true);
    flushMicrotasks();
    expect(done).toBeTrue();
  }));

  describe('start all and stop all', () => {
    it('asks the backend to start every server and says so', () => {
      roster = [server('a', 'stopped'), server('b', 'running')];
      messagingMock.sendMessage.and.returnValue(of({ success: true }));
      service.startAllServers();
      expect(messagingMock.sendMessage).toHaveBeenCalledWith('start-all-instances', {});
      expect(notificationMock.success).toHaveBeenCalledWith('All servers are starting.', 'Server Control');
    });

    it('asks the backend to stop every server and says so', () => {
      roster = [server('a', 'running'), server('b', 'stopped')];
      messagingMock.sendMessage.and.returnValue(of({ success: true }));
      service.stopAllServers();
      expect(messagingMock.sendMessage).toHaveBeenCalledWith('stop-all-instances', {});
      expect(notificationMock.success).toHaveBeenCalledWith('All servers are stopping.', 'Server Control');
    });

    it('stops servers that are still starting', () => {
      roster = [server('a', 'starting')];
      service.stopAllServers();
      expect(messagingMock.sendMessage).toHaveBeenCalledWith('stop-all-instances', {});
    });

    it('sends nothing when there is nothing to start or stop', () => {
      roster = [];
      service.startAllServers();
      roster = [server('a', 'stopped'), server('b', 'crashed')];
      service.stopAllServers();
      expect(messagingMock.sendMessage).not.toHaveBeenCalled();
      expect(notificationMock.success).not.toHaveBeenCalled();
      expect(notificationMock.info).toHaveBeenCalledWith('No servers are running.', 'Server Control');
    });

    it('reports a refusal from the backend', () => {
      roster = [server('a', 'running')];
      messagingMock.sendMessage.and.returnValue(of({ success: false, error: 'Not allowed' }));
      service.stopAllServers();
      expect(notificationMock.success).not.toHaveBeenCalled();
      expect(notificationMock.error).toHaveBeenCalledWith('Not allowed', 'Server Control');
    });

    it('reports a request that failed', () => {
      spyOn(console, 'error');
      roster = [server('a', 'stopped')];
      messagingMock.sendMessage.and.returnValue(throwError(() => new Error('timeout')));
      service.startAllServers();
      expect(notificationMock.error).toHaveBeenCalledWith('Failed to start all servers.', 'Server Control');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('deleting a server', () => {
    it('allows a stopped server while another remains', () => {
      roster = [server('a', 'stopped'), server('b', 'running')];
      expect(service.checkDeletable(roster[0])).toBeTrue();
      expect(notificationMock.warning).not.toHaveBeenCalled();
    });

    it('keeps the last server', () => {
      roster = [server('a', 'stopped')];
      expect(service.checkDeletable(roster[0])).toBeFalse();
      expect(notificationMock.warning).toHaveBeenCalledWith('At least one server must remain.', 'Cannot Delete Server');
    });

    it('refuses a server that is not stopped, going by its live state', () => {
      roster = [server('a', 'running'), server('b', 'stopped')];
      expect(service.checkDeletable(server('a', 'stopped'))).toBeFalse();
      expect(notificationMock.warning).toHaveBeenCalledWith('Server must be stopped before it can be deleted.', 'Cannot Delete Server');
    });

    it('deletes a server the backend confirms', async () => {
      roster = [server('a', 'stopped'), server('b', 'stopped')];
      await expectAsync(service.deleteServer(roster[0])).toBeResolvedTo(true);
      expect(instancesMock.delete).toHaveBeenCalledWith('a');
    });

    it('checks again before deleting', async () => {
      roster = [server('a', 'starting'), server('b', 'stopped')];
      await expectAsync(service.deleteServer(server('a', 'stopped'))).toBeResolvedTo(false);
      expect(instancesMock.delete).not.toHaveBeenCalled();
    });

    it('reports a delete the backend refused', async () => {
      roster = [server('a', 'stopped'), server('b', 'stopped')];
      instancesMock.delete.and.returnValue(of({ success: false, id: 'a' } as DeleteInstanceResult));
      await expectAsync(service.deleteServer(roster[0])).toBeResolvedTo(false);
      expect(notificationMock.error).toHaveBeenCalledWith('Could not delete Server a', 'Server Control');
    });

    it('reports a delete request that failed', async () => {
      spyOn(console, 'error');
      roster = [server('a', 'stopped'), server('b', 'stopped')];
      instancesMock.delete.and.returnValue(throwError(() => new Error('timeout')));
      await expectAsync(service.deleteServer(roster[0])).toBeResolvedTo(false);
      expect(console.error).toHaveBeenCalledWith('[server-lifecycle] Could not delete a:', jasmine.any(Error));
      expect(notificationMock.error).toHaveBeenCalledWith('Could not delete Server a', 'Server Control');
    });
  });
});
