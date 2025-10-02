import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClusterTabComponent } from './cluster-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('ClusterTabComponent', () => {
  let component: ClusterTabComponent;
  let fixture: ComponentFixture<ClusterTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClusterTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ClusterTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit validateField on onValidateField', () => {
    spyOn(component.validateField, 'emit');
    component.onValidateField('clusterSetting', 'value');
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'clusterSetting', value: 'value'});
  });

  it('should get storage type label', () => {
    expect(component.getStorageTypeLabel('local')).toBe('Local Directory (Single Machine)');
    expect(component.getStorageTypeLabel('unknown')).toBe('unknown');
  });

  it('should emit validateField for testClusterConnectivity', () => {
    spyOn(component.validateField, 'emit');
    component.testClusterConnectivity();
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'testConnectivity', value: true});
  });

  it('should return false for hasFieldError and hasFieldWarning', () => {
    expect(component.hasFieldError('clusterSetting')).toBeFalse();
    expect(component.hasFieldWarning('clusterSetting')).toBeFalse();
  });

  it('should return empty string for getFieldError and getFieldWarning', () => {
    expect(component.getFieldError('clusterSetting')).toBe('');
    expect(component.getFieldWarning('clusterSetting')).toBe('');
  });
});
