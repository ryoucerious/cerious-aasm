import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServerStateComponent } from './server-state.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../test/mocks/mock-global-config.service';

describe('ServerStateComponent', () => {
  it('should handle ngOnChanges and auto-scroll logs', (done) => {
    // Setup logContainer mock
    const nativeElement = {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 200,
      lastElementChild: { scrollIntoView: jasmine.createSpy() },
      scrollTo: jasmine.createSpy()
    };
    component.logContainer = { nativeElement } as any;
    component.logs = ['a', 'b'];
  component.ngOnChanges({ logs: { currentValue: ['a', 'b'], previousValue: [], firstChange: true, isFirstChange: () => true } });
    setTimeout(() => {
      expect(nativeElement.scrollTo).toHaveBeenCalledWith(0, nativeElement.scrollHeight);
      expect(nativeElement.lastElementChild.scrollIntoView).toHaveBeenCalled();
      done();
    }, 60);
  });

  it('should not auto-scroll if user is not near bottom', (done) => {
    const nativeElement = {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
      lastElementChild: { scrollIntoView: jasmine.createSpy() },
      scrollTo: jasmine.createSpy()
    };
    component.logContainer = { nativeElement } as any;
    component.logs = ['a', 'b', 'c'];
  component.ngOnChanges({ logs: { currentValue: ['a', 'b', 'c'], previousValue: ['a', 'b'], firstChange: false, isFirstChange: () => false } });
    setTimeout(() => {
      expect(nativeElement.scrollTo).not.toHaveBeenCalled();
      done();
    }, 60);
  });

  it('should handle statusClasses for all states', () => {
    const states = ['running', 'stopped', 'starting', 'stopping', 'error', undefined];
    const expected = ['status-running', 'status-stopped', 'status-starting', 'status-stopping', 'status-error', 'status-unknown'];
    states.forEach((state, i) => {
      component.serverInstance = { state };
      const classes = component.statusClasses;
      expect(classes[expected[i]]).toBeTrue();
    });
  });

  it('should handle edge cases for computed properties', () => {
    component.serverInstance = undefined;
    expect(component.statusText).toBe('Unknown');
    expect(component.currentPlayers).toBe(0);
    expect(component.maxPlayers).toBe(70);
    expect(component.serverMessage).toBeNull();
    expect(component.memoryUsage).toBeUndefined();
  });

  it('should handle canStart/canStop/canForceStop for unknown/error', () => {
    component.serverInstance = { state: undefined };
    expect(component.canStart).toBeTrue();
    component.serverInstance = { state: 'error' };
    expect(component.canStart).toBeTrue();
  component.serverInstance = { state: 'Unknown' };
  expect(component.canStart).toBeTrue();
  });
  let component: ServerStateComponent;
  let fixture: ComponentFixture<ServerStateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServerStateComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ServerStateComponent);
    component = fixture.componentInstance;
    // Provide required @Input() values
    component.serverInstance = { state: 'running', gamePort: 7777 };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit visibilityToggled on toggleVisibility', () => {
    spyOn(component.visibilityToggled, 'emit');
    component.isVisible = true;
    component.toggleVisibility();
    expect(component.isVisible).toBeFalse();
    expect(component.visibilityToggled.emit).toHaveBeenCalledWith(false);
  });

  it('should emit startServer on onStartServer', () => {
    spyOn(component.startServer, 'emit');
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onStartServer(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.startServer.emit).toHaveBeenCalled();
  });

  it('should emit stopServer on onStopServer', () => {
    spyOn(component.stopServer, 'emit');
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onStopServer(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.stopServer.emit).toHaveBeenCalled();
  });

  it('should emit forceStopServer on onForceStopServer', () => {
    spyOn(component.forceStopServer, 'emit');
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onForceStopServer(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.forceStopServer.emit).toHaveBeenCalled();
  });

  it('should compute statusText and statusClasses', () => {
    component.serverInstance = { state: 'running' };
    expect(component.statusText).toBe('Running');
    expect(component.statusClasses['status-running']).toBeTrue();
    component.serverInstance = { state: 'stopped' };
    expect(component.statusText).toBe('Stopped');
    expect(component.statusClasses['status-stopped']).toBeTrue();
  });

  it('should compute currentPlayers and maxPlayers', () => {
    component.serverInstance = { players: 5, maxPlayers: 100 };
    expect(component.currentPlayers).toBe(5);
    expect(component.maxPlayers).toBe(100);
  });

  it('should compute serverMessage and memoryUsage', () => {
    component.serverInstance = { message: 'msg', memory: 123456 };
    expect(component.serverMessage).toBe('msg');
    expect(component.memoryUsage).toBe('123,456');
  });

  it('should compute canStart, canStop, canForceStop', () => {
    component.serverInstance = { state: 'stopped' };
    expect(component.canStart).toBeTrue();
    component.serverInstance = { state: 'running' };
    expect(component.canStop).toBeTrue();
    component.serverInstance = { state: 'starting' };
    expect(component.canForceStop).toBeTrue();
  });
});
