import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BroadcastsTabComponent } from './broadcasts-tab.component';
import { IpcService } from '../../../../core/services/ipc.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';

describe('BroadcastsTabComponent', () => {
  let component: BroadcastsTabComponent;
  let fixture: ComponentFixture<BroadcastsTabComponent>;
  let mockIpcService: jasmine.SpyObj<IpcService>;

  beforeEach(async () => {
    mockIpcService = jasmine.createSpyObj('IpcService', ['send', 'invoke', 'on']);
    mockIpcService.invoke.and.returnValue(Promise.resolve(null));

    await TestBed.configureTestingModule({
      imports: [BroadcastsTabComponent],
      providers: [
        { provide: IpcService, useValue: mockIpcService },
        { provide: NotificationService, useClass: MockNotificationService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(BroadcastsTabComponent);
    component = fixture.componentInstance;
    component.serverInstance = {
      broadcastConfig: {
        enabled: true,
        messages: [
          { id: 'msg1', message: 'Hello', interval: 30, enabled: true }
        ]
      }
    };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form from serverInstance broadcastConfig', () => {
    expect(component.enabled).toBeTrue();
    expect(component.messages.length).toBe(1);
    expect(component.messages[0].message).toBe('Hello');
    expect(component.messages[0].interval).toBe(30);
  });

  it('should initialize with defaults when no broadcastConfig exists', async () => {
    // Create a fresh component with no broadcastConfig
    const freshFixture = TestBed.createComponent(BroadcastsTabComponent);
    const freshComponent = freshFixture.componentInstance;
    freshComponent.serverInstance = {};
    freshFixture.detectChanges();
    expect(freshComponent.enabled).toBeFalse();
    expect(freshComponent.messages.length).toBe(0);
  });

  it('should add a message and emit saveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    const initialCount = component.messages.length;
    component.addMessage();
    expect(component.messages.length).toBe(initialCount + 1);
    expect(component.messages[component.messages.length - 1].message).toBe('New Announcement');
    expect(component.messages[component.messages.length - 1].interval).toBe(60);
    expect(component.messages[component.messages.length - 1].enabled).toBeTrue();
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('should remove a message and emit saveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.removeMessage(0);
    expect(component.messages.length).toBe(0);
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('should emit saveSettings and update serverInstance on onSaveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.enabled = false;
    component.onSaveSettings();
    expect(component.saveSettings.emit).toHaveBeenCalled();
    expect(component.serverInstance.broadcastConfig.enabled).toBeFalse();
    expect(component.serverInstance.broadcastConfig.messages).toBe(component.messages);
  });

  it('should respect isLocked input', () => {
    expect(component.isLocked).toBeFalse();
    component.isLocked = true;
    expect(component.isLocked).toBeTrue();
  });

  it('should generate unique ids for new messages', () => {
    component.addMessage();
    component.addMessage();
    const ids = component.messages.map(m => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
