import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MiscTabComponent } from './misc-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('MiscTabComponent', () => {
  let component: MiscTabComponent;
  let fixture: ComponentFixture<MiscTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MiscTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(MiscTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit saveSettings on onSaveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.onSaveSettings();
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('should emit validateField on onValidateField', () => {
    spyOn(component.validateField, 'emit');
    component.onValidateField('miscSetting', true);
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'miscSetting', value: true});
  });

  it('should return false for hasFieldError and hasFieldWarning', () => {
    expect(component.hasFieldError('miscSetting')).toBeFalse();
    expect(component.hasFieldWarning('miscSetting')).toBeFalse();
  });

  it('should return empty string for getFieldError and getFieldWarning', () => {
    expect(component.getFieldError('miscSetting')).toBe('');
    expect(component.getFieldWarning('miscSetting')).toBe('');
  });
});
