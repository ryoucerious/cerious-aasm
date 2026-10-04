import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LoginComponent } from './login.component';
import { BehaviorSubject } from 'rxjs';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { WebSocketService } from '../../core/services/web-socket.service';
import { IpcService } from '../../core/services/ipc.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let mockRouter: jasmine.SpyObj<Router>;
  let webSocket: { connected$: BehaviorSubject<boolean>; reconnectNow: jasmine.Spy; whenConnected: jasmine.Spy };

  const sentBody = () => JSON.parse(String(((window.fetch as jasmine.Spy).calls.mostRecent().args[1] as RequestInit).body));

  beforeEach(async () => {
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockRouter.navigate.and.returnValue(Promise.resolve(true));
    webSocket = {
      connected$: new BehaviorSubject(false),
      reconnectNow: jasmine.createSpy('reconnectNow'),
      whenConnected: jasmine.createSpy('whenConnected').and.resolveTo(true)
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent, FormsModule],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: WebSocketService, useValue: webSocket },
        { provide: IpcService, useValue: { isElectron: false } },
        { provide: Router, useValue: mockRouter }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialise with empty fields', () => {
    expect(component.username).toBe('');
    expect(component.password).toBe('');
    expect(component.errorMessage).toBe('');
    expect(component.isLoading).toBeFalse();
  });

  it('should set error when username is empty', async () => {
    component.username = '';
    component.password = 'pass';
    await component.onLogin();
    expect(component.errorMessage).toBe('Please enter your username and password.');
    expect(component.isLoading).toBeFalse();
  });

  it('should set error when password is empty', async () => {
    component.username = 'user';
    component.password = '';
    await component.onLogin();
    expect(component.errorMessage).toBe('Please enter your username and password.');
  });

  it('sends the password exactly as typed, spaces included', async () => {
    component.username = ' admin ';
    component.password = '  pass word  ';
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })));

    await component.onLogin();

    expect(sentBody()).toEqual({ username: 'admin', password: '  pass word  ' });
  });

  it('treats a password of spaces as a password', async () => {
    component.username = 'admin';
    component.password = '   ';
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 401 })));

    await component.onLogin();

    expect(sentBody().password).toBe('   ');
    expect(component.errorMessage).toBe('Incorrect username or password. Please try again.');
  });

  it('should navigate to /dashboard on successful login', async () => {
    component.username = 'admin';
    component.password = 'secret';
    spyOn(window, 'fetch').and.returnValue(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true })
    } as Response));

    await component.onLogin();
    expect(webSocket.reconnectNow).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(component.isLoading).toBeFalse();
  });

  it('should set error on login failure with success: false', async () => {
    component.username = 'admin';
    component.password = 'wrong';
    spyOn(window, 'fetch').and.returnValue(Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: false, error: 'Bad credentials' })
    } as Response));

    await component.onLogin();
    expect(component.errorMessage).toBe('Bad credentials');
    expect(component.isLoading).toBeFalse();
  });

  it('should set error on non-ok HTTP response', async () => {
    component.username = 'admin';
    component.password = 'wrong';
    spyOn(window, 'fetch').and.returnValue(Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Invalid credentials' })
    } as Response));

    await component.onLogin();
    // The wire says "Invalid credentials"; a person is told what to do about it.
    expect(component.errorMessage).toBe('Incorrect username or password. Please try again.');
    expect(component.isLoading).toBeFalse();
  });

  it('should set connection error on fetch exception', async () => {
    component.username = 'admin';
    component.password = 'secret';
    spyOn(window, 'fetch').and.returnValue(Promise.reject(new Error('Network failure')));

    await component.onLogin();
    expect(component.errorMessage).toBe('Unable to reach the server. Please check that it is running and try again.');
    expect(component.isLoading).toBeFalse();
  });

  it('should set isLoading true before fetch', async () => {
    component.username = 'admin';
    component.password = 'secret';
    let capturedLoading = false;
    spyOn(window, 'fetch').and.callFake(() => {
      capturedLoading = component.isLoading;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true })
      } as Response);
    });

    await component.onLogin();
    expect(capturedLoading).toBeTrue();
  });

  it('should call onLogin when Enter key is pressed via onEnterKey', () => {
    spyOn(component, 'onLogin');
    component.onEnterKey({ key: 'Enter' } as KeyboardEvent);
    expect(component.onLogin).toHaveBeenCalled();
  });

  it('should not call onLogin for non-Enter keys via onEnterKey', () => {
    spyOn(component, 'onLogin');
    component.onEnterKey({ key: 'Tab' } as KeyboardEvent);
    expect(component.onLogin).not.toHaveBeenCalled();
  });

  it('should use fallback error message when response has no error field', async () => {
    component.username = 'admin';
    component.password = 'wrong';
    spyOn(window, 'fetch').and.returnValue(Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: false })
    } as Response));

    await component.onLogin();
    expect(component.errorMessage).toBe('Sign-in failed. Please try again.');
  });

  it('should use fallback error for non-ok response without error field', async () => {
    component.username = 'admin';
    component.password = 'wrong';
    spyOn(window, 'fetch').and.returnValue(Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({})
    } as Response));

    await component.onLogin();
    expect(component.errorMessage).toBe('Incorrect username or password. Please try again.');
  });
});
