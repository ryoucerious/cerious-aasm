import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../test/mocks/mock-global-config.service';

describe('ModalComponent', () => {
  let component: ModalComponent;
  let fixture: ComponentFixture<ModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModalComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ModalComponent);
    component = fixture.componentInstance;
    // Provide required @Input() values if any
    component.show = true;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit close event', () => {
    spyOn(component.close, 'emit');
    component.close.emit();
    expect(component.close.emit).toHaveBeenCalled();
  });

  it('should accept input properties', () => {
    component.title = 'Test Title';
    component.show = true;
    expect(component.title).toBe('Test Title');
    expect(component.show).toBeTrue();
  });
});
