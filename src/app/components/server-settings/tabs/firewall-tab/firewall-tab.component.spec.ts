import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirewallTabComponent } from './firewall-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('FirewallTabComponent', () => {
  let component: FirewallTabComponent;
  let fixture: ComponentFixture<FirewallTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FirewallTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(FirewallTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should accept serverInstance input', () => {
    component.serverInstance = { gamePort: 7777 };
    expect(component.serverInstance.gamePort).toBe(7777);
  });
});
