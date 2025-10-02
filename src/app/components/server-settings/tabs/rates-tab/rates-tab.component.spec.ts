import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RatesTabComponent } from './rates-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('RatesTabComponent', () => {
  let component: RatesTabComponent;
  let fixture: ComponentFixture<RatesTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RatesTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(RatesTabComponent);
    component = fixture.componentInstance;
    // Provide required @Input() values
    component.serverInstance = { gamePort: 7777 };
    component.ratesFields = [{ key: 'xpMultiplier', label: 'XP Multiplier', type: 'number', description: '', category: 'experience' }];
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
    component.onValidateField('xpMultiplier', 2);
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'xpMultiplier', value: 2});
  });

  it('should get fields by category', () => {
    component.ratesFields = [
      { key: 'xpMultiplier', category: 'experience', label: '', type: 'number', description: '' },
      { key: 'tamingSpeedMultiplier', category: 'taming', label: '', type: 'number', description: '' }
    ];
    expect(component.getFieldsByCategory('experience').length).toBe(1);
    expect(component.getFieldsByCategory('taming').length).toBe(1);
    expect(component.getFieldsByCategory('unknown').length).toBe(0);
  });
});
