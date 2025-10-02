import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RconControlComponent } from './rcon-control.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../test/mocks/mock-global-config.service';

describe('RconControlComponent', () => {
  let component: RconControlComponent;
  let fixture: ComponentFixture<RconControlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RconControlComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(RconControlComponent);
    component = fixture.componentInstance;
    // Provide required @Input() values
    component.rconConnected = true;
    component.serverState = 'running';
    component.knownCommands = ['say', 'kick'];
    component.lastResponse = 'OK';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit sendMessage on onSendMessage', () => {
    spyOn(component.sendMessage, 'emit');
    component.rconMessage = 'hello';
    component.onSendMessage();
    expect(component.sendMessage.emit).toHaveBeenCalledWith('hello');
    expect(component.rconMessage).toBe('');
  });

  it('should not emit sendMessage if rconMessage is empty', () => {
    spyOn(component.sendMessage, 'emit');
    component.rconMessage = '   ';
    component.onSendMessage();
    expect(component.sendMessage.emit).not.toHaveBeenCalled();
  });

  it('should emit inputFocus on onInputFocus', () => {
    spyOn(component.inputFocus, 'emit');
    component.onInputFocus();
    expect(component.inputFocus.emit).toHaveBeenCalled();
    expect(component.inputFocused).toBeTrue();
  });

  it('should emit inputBlur on onInputBlur', () => {
    spyOn(component.inputBlur, 'emit');
    component.inputFocused = true;
    jasmine.clock().install();
    component.onInputBlur();
    expect(component.inputBlur.emit).toHaveBeenCalled();
    jasmine.clock().tick(151);
    expect(component.inputFocused).toBeFalse();
    jasmine.clock().uninstall();
  });

  it('should fill command and emit commandFill', () => {
    spyOn(component.commandFill, 'emit');
    component.fillCommand('say');
    expect(component.rconMessage).toBe('say');
    expect(component.inputFocused).toBeFalse();
    expect(component.commandFill.emit).toHaveBeenCalledWith('say');
  });
});
