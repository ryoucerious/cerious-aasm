import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginModalComponent } from './login-modal.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../test/mocks/mock-global-config.service';

describe('LoginModalComponent', () => {
  let component: LoginModalComponent;
  let fixture: ComponentFixture<LoginModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginModalComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(LoginModalComponent);
    component = fixture.componentInstance;
    // Provide required @Input() values
    component.show = true;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit loginAttempt on valid login', () => {
    spyOn(component.loginAttempt, 'emit');
    component.username = 'user';
    component.password = 'pass';
    component.onLogin();
    expect(component.loginAttempt.emit).toHaveBeenCalledWith({ username: 'user', password: 'pass' });
    expect(component.isLoading).toBeTrue();
    expect(component.errorMessage).toBe('');
  });

  it('should set errorMessage if username or password is missing', () => {
    component.username = '';
    component.password = '';
    component.onLogin();
    expect(component.errorMessage).toBe('Please enter both username and password');
    expect(component.isLoading).toBeFalse();
  });

  it('should show error and reset loading', () => {
    component.isLoading = true;
    component.showError('fail');
    expect(component.errorMessage).toBe('fail');
    expect(component.isLoading).toBeFalse();
  });

  it('should reset all fields', () => {
    component.username = 'u';
    component.password = 'p';
    component.errorMessage = 'err';
    component.isLoading = true;
    component.reset();
    expect(component.username).toBe('');
    expect(component.password).toBe('');
    expect(component.errorMessage).toBe('');
    expect(component.isLoading).toBeFalse();
  });
});
