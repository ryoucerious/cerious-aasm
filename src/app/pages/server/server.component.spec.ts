import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ServerComponent } from './server.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { StatMultiplierService } from '../../core/services/stat-multiplier.service';
import { RconManagementService } from '../../core/services/rcon-management.service';
import { ServerStateService } from '../../core/services/server-state.service';
import { AutomationService } from '../../core/services/automation.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerConfigurationService } from '../../core/services/server-configuration.service';
import { BackupUIService } from '../../core/services/backup-ui.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { EventSubscriptionService } from '../../core/services/event-subscription.service';
import { UtilityService } from '../../core/services/utility.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockServerInstanceService } from '../../../../test/mocks/mock-server-instance.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { of, Subscription } from 'rxjs';

describe('ServerComponent', () => {
  let component: ServerComponent;
  let fixture: ComponentFixture<ServerComponent>;
  let mockMessaging: MockMessagingService;
  let mockEventSubscription: jasmine.SpyObj<EventSubscriptionService>;
  let mockServerConfig: jasmine.SpyObj<ServerConfigurationService>;
  let mockServerState: jasmine.SpyObj<ServerStateService>;
  let mockBackupUI: jasmine.SpyObj<BackupUIService>;
  let mockNotification: MockNotificationService;

  beforeEach(async () => {
    mockMessaging = new MockMessagingService();
    mockMessaging.receiveMessage = jasmine.createSpy('receiveMessage').and.returnValue(of(null));
    mockMessaging.sendMessage = jasmine.createSpy('sendMessage').and.returnValue(of(null));

    mockEventSubscription = jasmine.createSpyObj('EventSubscriptionService', [
      'initializeSubscriptions', 'destroySubscriptions'
    ]);
    mockEventSubscription.initializeSubscriptions.and.returnValue(new Subscription());

    mockServerConfig = jasmine.createSpyObj('ServerConfigurationService', [
      'validateServerConfiguration', 'saveServerSettings', 'createDeepCopy',
      'hasServerChanged', 'processModsInput', 'handleCrossplayChange'
    ], {
      crossplayPlatforms: ['Steam', 'Epic']
    });
    mockServerConfig.validateServerConfiguration.and.returnValue({ isValid: true, errors: [], warnings: [] });
    mockServerConfig.saveServerSettings.and.returnValue(of({ success: true }));
    mockServerConfig.createDeepCopy.and.callFake((obj: any) => JSON.parse(JSON.stringify(obj || {})));

    mockServerState = jasmine.createSpyObj('ServerStateService', [
      'getLogsForInstance', 'areSettingsLocked', 'areBackupSettingsLocked'
    ]);
    mockServerState.getLogsForInstance.and.returnValue([]);
    mockServerState.areSettingsLocked.and.returnValue(false);
    mockServerState.areBackupSettingsLocked.and.returnValue(false);

    mockBackupUI = jasmine.createSpyObj('BackupUIService', ['updateBackupName'], {
      currentState: {
        backupScheduleEnabled: false,
        backupFrequency: 'daily',
        backupTime: '03:00',
        backupDayOfWeek: 0,
        maxBackupsToKeep: 5,
        backupList: [],
        showBackupNameModal: false,
        showDeleteBackupModal: false,
        backupName: '',
        backupToDelete: null,
        isCreatingBackup: false
      }
    });

    mockNotification = new MockNotificationService();

    const mockStatMultiplier = jasmine.createSpyObj('StatMultiplierService', ['getMultipliers']);
    const mockRconManagement = jasmine.createSpyObj('RconManagementService', ['getKnownCommands']);
    mockRconManagement.getKnownCommands.and.returnValue([]);
    const mockServerLifecycle = jasmine.createSpyObj('ServerLifecycleService', ['startServer', 'stopServer']);
    const mockUtility = jasmine.createSpyObj('UtilityService', ['isArray', 'getPlatform']);
    mockUtility.isArray.and.callFake((val: any) => Array.isArray(val));
    const mockAutomation = jasmine.createSpyObj('AutomationService', ['getAutomationStatus']);

    await TestBed.configureTestingModule({
      imports: [ServerComponent, FormsModule],
      providers: [
        { provide: MessagingService, useValue: mockMessaging },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: StatMultiplierService, useValue: mockStatMultiplier },
        { provide: RconManagementService, useValue: mockRconManagement },
        { provide: ServerStateService, useValue: mockServerState },
        { provide: ServerConfigurationService, useValue: mockServerConfig },
        { provide: BackupUIService, useValue: mockBackupUI },
        { provide: ServerLifecycleService, useValue: mockServerLifecycle },
        { provide: EventSubscriptionService, useValue: mockEventSubscription },
        { provide: UtilityService, useValue: mockUtility },
        { provide: AutomationService, useValue: mockAutomation },
        { provide: NotificationService, useValue: mockNotification }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ServerComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize event subscriptions on ngOnInit', () => {
    component.ngOnInit();
    expect(mockEventSubscription.initializeSubscriptions).toHaveBeenCalled();
  });

  it('should destroy subscriptions on ngOnDestroy', () => {
    component.ngOnInit();
    component.ngOnDestroy();
    expect(mockEventSubscription.destroySubscriptions).toHaveBeenCalled();
  });

  it('should filter advancedSettingsMeta by tab for generalFields', () => {
    component.advancedSettingsMeta = [
      { key: 'mapName', tab: 'general' },
      { key: 'rate', tab: 'rates' }
    ];
    expect(component.generalFields.length).toBe(1);
    expect(component.generalFields[0].key).toBe('mapName');
  });

  it('should filter advancedSettingsMeta by tab for ratesFields', () => {
    component.advancedSettingsMeta = [
      { key: 'mapName', tab: 'general' },
      { key: 'rate', tab: 'rates' }
    ];
    expect(component.ratesFields.length).toBe(1);
    expect(component.ratesFields[0].key).toBe('rate');
  });

  it('should set map on activeServerInstance', () => {
    component.activeServerInstance = { mapName: 'TheIsland' };
    spyOn(component, 'saveSettings');
    component.setMap('Ragnarok');
    expect(component.activeServerInstance.mapName).toBe('Ragnarok');
    expect(component.saveSettings).toHaveBeenCalled();
  });

  it('should not set map when activeServerInstance is null', () => {
    component.activeServerInstance = null;
    expect(() => component.setMap('Ragnarok')).not.toThrow();
  });

  it('should return map display name from generalFields options', () => {
    component.advancedSettingsMeta = [
      { key: 'mapName', tab: 'general', options: [{ value: 'TheIsland', display: 'The Island' }] }
    ];
    expect(component.getMapDisplayName('TheIsland')).toBe('The Island');
  });

  it('should return raw map name when no option found', () => {
    component.advancedSettingsMeta = [];
    expect(component.getMapDisplayName('CustomMap_WP')).toBe('CustomMap');
  });

  it('should group fields by a property', () => {
    const fields = [
      { key: 'a', group: 'G1' },
      { key: 'b', group: 'G1' },
      { key: 'c', group: 'G2' }
    ];
    const groups = component.groupFields(fields, 'group');
    expect(groups.length).toBe(2);
    expect(groups[0].key).toBe('G1');
    expect(groups[0].value.length).toBe(2);
  });

  it('should delegate isArray to utility service', () => {
    expect(component.isArray([1, 2])).toBeTrue();
    expect(component.isArray('string')).toBeFalse();
  });

  it('should get settingsLocked from serverStateService', () => {
    expect(component.settingsLocked).toBeFalse();
    mockServerState.areSettingsLocked.and.returnValue(true);
    expect(component.settingsLocked).toBeTrue();
  });

  it('should get filteredLogs from serverStateService', () => {
    component.activeServerInstance = { id: 'srv1' };
    mockServerState.getLogsForInstance.and.returnValue(['log1', 'log2']);
    expect(component.filteredLogs.length).toBe(2);
  });

  it('should return empty filteredLogs when no active server', () => {
    component.activeServerInstance = null;
    expect(component.filteredLogs).toEqual([]);
  });

  it('should get knownRconCommands', () => {
    expect(component.knownRconCommands).toEqual([]);
  });

  it('should toggle rconInputFocused', () => {
    component.onRconInputFocus();
    expect(component.rconInputFocused).toBeTrue();
  });

  it('should fill rcon command', () => {
    component.fillRconCommand('listplayers');
    expect(component.rconMessage).toBe('listplayers');
    expect(component.rconInputFocused).toBeFalse();
  });

  it('should get backup state from BackupUIService', () => {
    expect(component.backupScheduleEnabled).toBeFalse();
    expect(component.backupFrequency).toBe('daily');
    expect(component.backupList).toEqual([]);
  });

  it('should validate and save settings', () => {
    component.activeServerInstance = { id: 'srv1', mapName: 'TheIsland' };
    component.originalServerInstance = { id: 'srv1', mapName: 'TheIsland' };
    component.saveSettings();
    expect(mockServerConfig.validateServerConfiguration).toHaveBeenCalled();
    expect(mockServerConfig.saveServerSettings).toHaveBeenCalled();
  });

  it('should not save when no activeServerInstance', () => {
    component.activeServerInstance = null;
    component.saveSettings();
    expect(mockServerConfig.validateServerConfiguration).not.toHaveBeenCalled();
  });

  it('should show validation error and not save on invalid config', () => {
    spyOn(mockNotification, 'error');
    component.activeServerInstance = { id: 'srv1' };
    mockServerConfig.validateServerConfiguration.and.returnValue({ isValid: false, errors: ['Port invalid'], warnings: [] });
    component.saveSettings();
    expect(mockNotification.error).toHaveBeenCalled();
    expect(mockServerConfig.saveServerSettings).not.toHaveBeenCalled();
  });

  it('should default activeTab to general', () => {
    expect(component.activeTab).toBe('general');
  });
});
