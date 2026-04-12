import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscordTabComponent } from './discord-tab.component';
import { IpcService } from '../../../../core/services/ipc.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';

describe('DiscordTabComponent', () => {
  let component: DiscordTabComponent;
  let fixture: ComponentFixture<DiscordTabComponent>;
  let mockIpcService: jasmine.SpyObj<IpcService>;

  beforeEach(async () => {
    mockIpcService = jasmine.createSpyObj('IpcService', ['send', 'invoke', 'on']);
    mockIpcService.invoke.and.returnValue(Promise.resolve(null));

    await TestBed.configureTestingModule({
      imports: [DiscordTabComponent],
      providers: [
        { provide: IpcService, useValue: mockIpcService },
        { provide: NotificationService, useClass: MockNotificationService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(DiscordTabComponent);
    component = fixture.componentInstance;
    component.serverInstance = {
      discordConfig: {
        enabled: true,
        webhookUrl: 'https://discord.com/api/webhooks/test',
        notifications: {
          serverStart: true,
          serverStop: false,
          serverCrash: true,
          serverUpdate: false,
          serverJoin: true,
          serverLeave: false
        }
      }
    };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form from serverInstance discordConfig', () => {
    expect(component.enabled).toBeTrue();
    expect(component.webhookUrl).toBe('https://discord.com/api/webhooks/test');
    expect(component.notifications.serverStart).toBeTrue();
    expect(component.notifications.serverStop).toBeFalse();
    expect(component.notifications.serverJoin).toBeTrue();
  });

  it('should initialize with defaults when no discordConfig exists', async () => {
    // Create a fresh component with no discordConfig
    const freshFixture = TestBed.createComponent(DiscordTabComponent);
    const freshComponent = freshFixture.componentInstance;
    freshComponent.serverInstance = {};
    freshFixture.detectChanges();
    expect(freshComponent.enabled).toBeFalse();
    expect(freshComponent.webhookUrl).toBe('');
    expect(freshComponent.notifications.serverStart).toBeTrue();
  });

  it('should emit saveSettings on onSaveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.webhookUrl = 'https://discord.com/api/webhooks/new';
    component.enabled = true;
    component.onSaveSettings();
    expect(component.saveSettings.emit).toHaveBeenCalled();
    expect(component.serverInstance.discordConfig.webhookUrl).toBe('https://discord.com/api/webhooks/new');
    expect(component.serverInstance.discordConfig.enabled).toBeTrue();
  });

  it('should update serverInstance discordConfig with current notification values', () => {
    component.notifications.serverCrash = false;
    component.onSaveSettings();
    expect(component.serverInstance.discordConfig.notifications.serverCrash).toBeFalse();
  });

  it('should respect isLocked input', () => {
    expect(component.isLocked).toBeFalse();
    component.isLocked = true;
    expect(component.isLocked).toBeTrue();
  });
});
