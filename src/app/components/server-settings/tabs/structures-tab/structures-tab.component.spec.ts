import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StructuresTabComponent } from './structures-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('StructuresTabComponent', () => {
  let component: StructuresTabComponent;
  let fixture: ComponentFixture<StructuresTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StructuresTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(StructuresTabComponent);
    component = fixture.componentInstance;
    // Provide required @Input() values
    component.serverInstance = { gamePort: 7777 };
    component.structuresFields = [{ key: 'structureLimit', label: 'Structure Limit', type: 'number', description: '' }];
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
    component.onValidateField('structureLimit', 100);
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'structureLimit', value: 100});
  });

  it('should return false for hasFieldError and hasFieldWarning', () => {
    expect(component.hasFieldError('structureLimit')).toBeFalse();
    expect(component.hasFieldWarning('structureLimit')).toBeFalse();
  });

  it('should return empty string for getFieldError and getFieldWarning', () => {
    expect(component.getFieldError('structureLimit')).toBe('');
    expect(component.getFieldWarning('structureLimit')).toBe('');
  });
});
