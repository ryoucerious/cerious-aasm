import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { UpdateBannerComponent, AppUpdateStatus } from './update-banner.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';

describe('UpdateBannerComponent', () => {
  let component: UpdateBannerComponent;
  let fixture: ComponentFixture<UpdateBannerComponent>;
  let mockMessaging: MockMessagingService;
  let updateSubject: Subject<AppUpdateStatus | null>;

  beforeEach(async () => {
    updateSubject = new Subject<AppUpdateStatus | null>();
    mockMessaging = new MockMessagingService();
    mockMessaging.receiveMessage = jasmine.createSpy('receiveMessage').and.returnValue(updateSubject.asObservable());
    mockMessaging.sendMessage = jasmine.createSpy('sendMessage');
    (mockMessaging as any).sendNotification = jasmine.createSpy('sendNotification');

    await TestBed.configureTestingModule({
      imports: [UpdateBannerComponent],
      providers: [
        { provide: MessagingService, useValue: mockMessaging }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UpdateBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should subscribe to app-update-status on init', () => {
    (expect(mockMessaging.receiveMessage) as any).toHaveBeenCalledWith('app-update-status');
  });

  it('should request last known status on init', () => {
    expect((mockMessaging as any).sendNotification).toHaveBeenCalledWith('get-app-update-status', {});
  });

  it('should update updateStatus when a status message arrives', () => {
    const status: AppUpdateStatus = { status: 'available', version: '2.0.0' };
    updateSubject.next(status);
    expect(component.updateStatus).toEqual(status);
  });

  it('should ignore null status messages', () => {
    component.updateStatus = null;
    updateSubject.next(null);
    expect(component.updateStatus).toBeNull();
  });

  it('should un-dismiss when available status arrives', () => {
    component.dismissed = true;
    updateSubject.next({ status: 'available', version: '2.0.0' });
    expect(component.dismissed).toBeFalse();
  });

  it('should un-dismiss when downloading status arrives', () => {
    component.dismissed = true;
    updateSubject.next({ status: 'downloading', percent: 50 });
    expect(component.dismissed).toBeFalse();
  });

  it('should un-dismiss when downloaded status arrives', () => {
    component.dismissed = true;
    updateSubject.next({ status: 'downloaded', version: '2.0.0' });
    expect(component.dismissed).toBeFalse();
  });

  it('should un-dismiss when error status arrives', () => {
    component.dismissed = true;
    updateSubject.next({ status: 'error', error: 'Network error' });
    expect(component.dismissed).toBeFalse();
  });

  it('should NOT un-dismiss for up-to-date or checking status', () => {
    component.dismissed = true;
    updateSubject.next({ status: 'up-to-date' });
    expect(component.dismissed).toBeTrue();

    component.dismissed = true;
    updateSubject.next({ status: 'checking' });
    expect(component.dismissed).toBeTrue();
  });

  it('should set dismissed to true on dismiss()', () => {
    component.dismissed = false;
    component.dismiss();
    expect(component.dismissed).toBeTrue();
  });

  it('should compute downloadPercent correctly', () => {
    component.updateStatus = { status: 'downloading', percent: 73.6 };
    expect(component.downloadPercent).toBe(74);
  });

  it('should return 0 for downloadPercent when no percent available', () => {
    component.updateStatus = null;
    expect(component.downloadPercent).toBe(0);
  });

  it('should send download-app-update on downloadUpdate()', () => {
    component.downloadUpdate();
    expect((mockMessaging as any).sendNotification).toHaveBeenCalledWith('download-app-update', {});
  });

  it('should send download-app-update on retryDownload()', () => {
    component.retryDownload();
    expect((mockMessaging as any).sendNotification).toHaveBeenCalledWith('download-app-update', {});
  });

  it('should send install-app-update on installUpdate()', () => {
    component.installUpdate();
    expect((mockMessaging as any).sendNotification).toHaveBeenCalledWith('install-app-update', {});
  });

  it('should unsubscribe on destroy', () => {
    const subSpy = jasmine.createSpyObj('Subscription', ['unsubscribe']);
    (component as any).sub = subSpy;
    component.ngOnDestroy();
    expect(subSpy.unsubscribe).toHaveBeenCalled();
  });
});
