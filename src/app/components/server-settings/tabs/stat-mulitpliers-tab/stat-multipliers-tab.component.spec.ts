import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatMultipliersTabComponent } from './stat-multipliers-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('StatMultipliersTabComponent', () => {
  let component: StatMultipliersTabComponent;
  let fixture: ComponentFixture<StatMultipliersTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatMultipliersTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(StatMultipliersTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit toggleStatSelectorDropdown', () => {
    spyOn(component.toggleStatSelectorDropdown, 'emit');
    component.onToggleStatSelectorDropdown();
    expect(component.toggleStatSelectorDropdown.emit).toHaveBeenCalled();
  });

  it('should emit statSelectorSelect', () => {
    spyOn(component.statSelectorSelect, 'emit');
    component.onStatSelectorSelect(2);
    expect(component.statSelectorSelect.emit).toHaveBeenCalledWith(2);
  });

  it('should emit statMultiplierChanged', () => {
    spyOn(component.statMultiplierChanged, 'emit');
    component.onStatMultiplierChange('type', 1, 2.5);
    expect(component.statMultiplierChanged.emit).toHaveBeenCalledWith({type: 'type', statIndex: 1, value: 2.5});
  });

  it('should emit resetStatToDefaults', () => {
    spyOn(component.resetStatToDefaults, 'emit');
    component.onResetStatToDefaults(3);
    expect(component.resetStatToDefaults.emit).toHaveBeenCalledWith(3);
  });

  it('should emit copyStatToAll', () => {
    spyOn(component.copyStatToAll, 'emit');
    component.onCopyStatToAll(4);
    expect(component.copyStatToAll.emit).toHaveBeenCalledWith(4);
  });

  it('should get stat selector display name', () => {
    component.statList = ['Health', 'Stamina'];
    expect(component.getStatSelectorDisplayName(null)).toBe('Select Stat...');
    expect(component.getStatSelectorDisplayName(0)).toBe('Health');
    expect(component.getStatSelectorDisplayName(1)).toBe('Stamina');
  });

  it('should get stat multiplier', () => {
    expect(component.getStatMultiplier('type', 1)).toBe(1.0);
  });
});
