import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
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
import { AuthService } from '../../core/services/auth.service';
import { MeshNodesService } from '../../core/services/mesh-nodes.service';
import { SaveInstanceResult } from '../../core/models/server-instance.model';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockServerInstanceService } from '../../../../test/mocks/mock-server-instance.service';
import { Subject, Subscription, of, throwError } from 'rxjs';
import { LiveServersService } from '../../core/services/live-servers.service';

describe('ServerComponent', () => {
  let component: ServerComponent;
  let fixture: ComponentFixture<ServerComponent>;
  let mockMessaging: MockMessagingService;
  let mockEventSubscription: jasmine.SpyObj<EventSubscriptionService>;
  let mockServerConfig: jasmine.SpyObj<ServerConfigurationService>;
  let mockServerState: jasmine.SpyObj<ServerStateService>;
  let mockBackupUI: jasmine.SpyObj<BackupUIService>;
  let mockRconManagement: jasmine.SpyObj<RconManagementService>;
  let mockNotification: jasmine.SpyObj<NotificationService>;
  /** Permissions the stubbed identity lacks; empty means an admin. */
  let denied: Set<string>;
  /** Where the mesh says a server could move to, and the server it was last asked about. */
  let moveDestinations: Array<{ nodeId: string; name: string }>;
  let destinationsAskedFor: unknown;

  beforeEach(async () => {
    denied = new Set();
    moveDestinations = [];
    destinationsAskedFor = null;
    mockMessaging = new MockMessagingService();
    mockMessaging.receiveMessage = jasmine.createSpy('receiveMessage').and.returnValue(of(null));
    mockMessaging.sendMessage = jasmine.createSpy('sendMessage').and.returnValue(of(null));

    mockEventSubscription = jasmine.createSpyObj('EventSubscriptionService', [
      'initializeSubscriptions', 'destroySubscriptions'
    ]);
    mockEventSubscription.initializeSubscriptions.and.returnValue(new Subscription());

    mockServerConfig = jasmine.createSpyObj('ServerConfigurationService', [
      'validateServerConfiguration', 'saveServerSettings', 'createDeepCopy', 'toggleMultiOption'
    ]);
    mockServerConfig.validateServerConfiguration.and.returnValue({ isValid: true, errors: [], warnings: [] });
    mockServerConfig.saveServerSettings.and.returnValue(of({ success: true }));
    mockServerConfig.createDeepCopy.and.callFake((obj: any) => JSON.parse(JSON.stringify(obj || {})));

    mockServerState = jasmine.createSpyObj('ServerStateService', [
      'getLogsForInstance', 'areSettingsLocked', 'mapServerState'
    ]);
    mockServerState.getLogsForInstance.and.returnValue([]);
    mockServerState.areSettingsLocked.and.returnValue(false);

    mockBackupUI = jasmine.createSpyObj('BackupUIService', ['updateBackupName', 'hideBackupNameModal', 'restoreBackup'], {
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

    mockNotification = jasmine.createSpyObj<NotificationService>('NotificationService', ['success', 'error', 'info', 'warning']);

    mockRconManagement = jasmine.createSpyObj('RconManagementService', ['getKnownCommands', 'sendRconCommand']);
    mockRconManagement.getKnownCommands.and.returnValue([]);
    const mockServerLifecycle = jasmine.createSpyObj('ServerLifecycleService', ['startServer', 'stopServer', 'forceStopServer']);

    await TestBed.configureTestingModule({
      imports: [ServerComponent, FormsModule],
      providers: [
        { provide: MessagingService, useValue: mockMessaging },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: StatMultiplierService, useValue: { statList: ['Health', 'Stamina'] } },
        { provide: RconManagementService, useValue: mockRconManagement },
        { provide: ServerStateService, useValue: mockServerState },
        { provide: ServerConfigurationService, useValue: mockServerConfig },
        { provide: BackupUIService, useValue: mockBackupUI },
        { provide: ServerLifecycleService, useValue: mockServerLifecycle },
        { provide: EventSubscriptionService, useValue: mockEventSubscription },
        { provide: AutomationService, useValue: jasmine.createSpyObj('AutomationService', ['configureAutoStart']) },
        { provide: NotificationService, useValue: mockNotification },
        { provide: AuthService, useValue: { can: (permission: string) => !denied.has(permission) } },
        {
          provide: MeshNodesService,
          useValue: {
            changed$: of(undefined),
            destinationsFor: (server: unknown) => { destinationsAskedFor = server; return moveDestinations; }
          }
        }
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
      { key: 'mapName', tab: 'general', label: 'Map', type: 'combo' },
      { key: 'rate', tab: 'rates', label: 'Rate', type: 'number' }
    ];
    expect(component.generalFields.length).toBe(1);
    expect(component.generalFields[0].key).toBe('mapName');
  });

  it('should filter advancedSettingsMeta by tab for ratesFields', () => {
    component.advancedSettingsMeta = [
      { key: 'mapName', tab: 'general', label: 'Map', type: 'combo' },
      { key: 'rate', tab: 'rates', label: 'Rate', type: 'number' }
    ];
    expect(component.ratesFields.length).toBe(1);
    expect(component.ratesFields[0].key).toBe('rate');
  });

  it('should get settingsLocked from serverStateService', () => {
    expect(component.settingsLocked).toBeFalse();
    mockServerState.areSettingsLocked.and.returnValue(true);
    expect(component.settingsLocked).toBeTrue();
  });

  it('should get filteredLogs from serverStateService', () => {
    component.activeServerInstance = { id: 'srv1', name: 'One' };
    mockServerState.getLogsForInstance.and.returnValue(['log1', 'log2']);
    expect(component.filteredLogs.length).toBe(2);
  });

  it('hands the console the same empty list while there is no output', () => {
    expect(component.filteredLogs).toEqual([]);
    expect(component.filteredLogs).toBe(component.filteredLogs);
    component.activeServerInstance = { id: 'srv1', name: 'One' };
    mockServerState.getLogsForInstance.and.callFake(() => []);
    expect(component.filteredLogs).toBe(component.filteredLogs);
  });

  it('should get knownRconCommands', () => {
    expect(component.knownRconCommands).toEqual([]);
  });

  // Escape and the backdrop dismiss the dialog; like its Cancel button, they wait for the backup.
  it('keeps the backup name dialog open while the backup is being created', () => {
    const state = mockBackupUI.currentState as { isCreatingBackup: boolean };
    state.isCreatingBackup = true;
    component.onBackupNameCancel();
    expect(mockBackupUI.hideBackupNameModal).not.toHaveBeenCalled();

    state.isCreatingBackup = false;
    component.onBackupNameCancel();
    expect(mockBackupUI.hideBackupNameModal).toHaveBeenCalled();
  });

  it('should get backup state from BackupUIService', () => {
    expect(component.backupScheduleEnabled).toBeFalse();
    expect(component.backupFrequency).toBe('daily');
    expect(component.backupList).toEqual([]);
  });

  describe('restoring a backup', () => {
    const backup = { id: 'bid', instanceId: 'srv1', name: 'backup1', createdAt: new Date(), size: 1, type: 'manual', filePath: '/b.zip' } as const;

    ['stopped', 'crashed', 'error', 'Crashed', ''].forEach(state => {
      it(`goes ahead when the server state is "${state}"`, () => {
        component.activeServerInstance = { id: 'srv1', name: 'One', state };
        component.restoreBackup(backup);
        expect(mockBackupUI.restoreBackup).toHaveBeenCalledOnceWith('srv1', backup);
        expect(mockNotification.warning).not.toHaveBeenCalled();
      });
    });

    ['running', 'starting', 'stopping', 'queued'].forEach(state => {
      it(`warns and waits while the server is ${state}`, () => {
        component.activeServerInstance = { id: 'srv1', name: 'One', state };
        component.restoreBackup(backup);
        expect(mockBackupUI.restoreBackup).not.toHaveBeenCalled();
        expect(mockNotification.warning).toHaveBeenCalledWith('Stop the server before restoring a backup.', 'Backup');
      });
    });
  });

  describe('saving', () => {
    it('should validate and save settings', () => {
      component.activeServerInstance = { id: 'srv1', name: 'One', mapName: 'TheIsland' };
      component.originalServerInstance = { id: 'srv1', name: 'One', mapName: 'TheIsland' };
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
      component.activeServerInstance = { id: 'srv1', name: 'One' };
      mockServerConfig.validateServerConfiguration.and.returnValue({ isValid: false, errors: ['Port invalid'], warnings: [] });
      component.saveSettings();
      expect(mockNotification.error).toHaveBeenCalledWith('Port invalid', 'Configuration Validation Failed');
      expect(mockServerConfig.saveServerSettings).not.toHaveBeenCalled();
    });

    it('remembers what it sent, not what the page holds when the reply comes', () => {
      const reply = new Subject<SaveInstanceResult>();
      mockServerConfig.saveServerSettings.and.returnValue(reply);
      component.activeServerInstance = { id: 'srv1', name: 'One', maxPlayers: 10 };
      component.originalServerInstance = { id: 'srv1', name: 'One', maxPlayers: 5 };

      component.saveSettings();
      component.activeServerInstance.maxPlayers = 20;
      reply.next({ success: true });

      expect(mockServerConfig.saveServerSettings.calls.mostRecent().args[0]).toEqual({ id: 'srv1', name: 'One', maxPlayers: 10 });
      expect(component.originalServerInstance?.maxPlayers).toBe(10);
    });

    it('ignores the reply once the user has moved to another server', () => {
      const reply = new Subject<SaveInstanceResult>();
      mockServerConfig.saveServerSettings.and.returnValue(reply);
      component.activeServerInstance = { id: 'srv1', name: 'One', maxPlayers: 10 };
      component.originalServerInstance = { id: 'srv1', name: 'One', maxPlayers: 5 };

      component.saveSettings();
      component.activeServerInstance = { id: 'srv2', name: 'Two', maxPlayers: 2 };
      component.originalServerInstance = { id: 'srv2', name: 'Two', maxPlayers: 1 };
      reply.next({ success: true });

      expect(component.originalServerInstance).toEqual({ id: 'srv2', name: 'Two', maxPlayers: 1 });
    });

    it('reports a save the backend refused', () => {
      mockServerConfig.saveServerSettings.and.returnValue(of({ success: false, error: 'Disk full' }));
      component.activeServerInstance = { id: 'srv1', name: 'One', maxPlayers: 10 };
      component.originalServerInstance = { id: 'srv1', name: 'One', maxPlayers: 5 };
      component.saveSettings();
      expect(mockNotification.error).toHaveBeenCalledWith('Disk full', 'Save Failed');
      expect(component.originalServerInstance?.maxPlayers).toBe(5);
    });

    it('reports a save that never reached the backend', () => {
      spyOn(console, 'error');
      mockServerConfig.saveServerSettings.and.returnValue(throwError(() => new Error('Timeout has occurred')));
      component.activeServerInstance = { id: 'srv1', name: 'One', maxPlayers: 10 };
      component.originalServerInstance = { id: 'srv1', name: 'One', maxPlayers: 5 };
      component.saveSettings();
      expect(mockNotification.error).toHaveBeenCalledWith('Failed to save server configuration.', 'Save Failed');
    });
  });

  describe('RCON', () => {
    it('shows the server\'s answer', () => {
      mockRconManagement.sendRconCommand.and.returnValue(of({ response: '2 players' }));
      component.activeServerInstance = { id: 'srv1', name: 'One' };
      component.sendRconMessage('ListPlayers');
      expect(mockRconManagement.sendRconCommand).toHaveBeenCalledWith('srv1', 'ListPlayers');
      expect(component.rconLastResponse).toBe('2 players');
    });

    it('reports a command that could not be sent', () => {
      spyOn(console, 'error');
      mockRconManagement.sendRconCommand.and.returnValue(throwError(() => new Error('RCON not connected')));
      component.activeServerInstance = { id: 'srv1', name: 'One' };
      component.sendRconMessage('ListPlayers');
      expect(mockNotification.error).toHaveBeenCalled();
    });

    it('forgets the last answer when another server is selected', () => {
      mockRconManagement.sendRconCommand.and.returnValue(of({ response: '2 players' }));
      component.activeServerInstance = { id: 'srv1', name: 'One' };
      component.sendRconMessage('ListPlayers');
      component.activeServerInstance = { id: 'srv1', name: 'One', maxPlayers: 10 };
      expect(component.rconLastResponse).toBe('2 players');
      component.activeServerInstance = { id: 'srv2', name: 'Two' };
      expect(component.rconLastResponse).toBe('');
    });

    it('sends nothing without a server or a command', () => {
      component.activeServerInstance = { id: 'srv1', name: 'One' };
      component.sendRconMessage('  ');
      component.activeServerInstance = null;
      component.sendRconMessage('ListPlayers');
      expect(mockRconManagement.sendRconCommand).not.toHaveBeenCalled();
    });
  });

  describe('mods', () => {
    beforeEach(() => {
      component.activeServerInstance = { id: 'srv1', name: 'One', mods: ['1'], enabledMods: ['1'], modSettings: { '1': { _name: 'One', Speed: '2' } } };
      component.loadModList();
    });

    it('builds the rows from the server\'s mods, names and enabled list', () => {
      expect(component.modList).toEqual([{ id: '1', name: 'One', enabled: true, settings: { Speed: '2' } }]);
    });

    it('treats every mod of an older config as enabled', () => {
      component.activeServerInstance = { id: 'srv1', name: 'One', mods: ['1', '2'] };
      component.loadModList();
      expect(component.modList.map(mod => [mod.id, mod.name, mod.enabled])).toEqual([['1', 'Mod 1', true], ['2', 'Mod 2', true]]);
    });

    it('adds a mod to the list, the enabled list and the names, and says so once', () => {
      component.onAddMod({ id: '2', name: 'Two' });
      expect(component.activeServerInstance?.mods).toEqual(['1', '2']);
      expect(component.activeServerInstance?.enabledMods).toEqual(['1', '2']);
      expect(component.activeServerInstance?.modSettings?.['2']).toEqual({ _name: 'Two' });
      expect(component.modList.map(mod => mod.id)).toEqual(['1', '2']);
      expect(mockNotification.success).toHaveBeenCalledTimes(1);
      expect(mockServerConfig.saveServerSettings).toHaveBeenCalled();
    });

    it('removes a mod, with its name and settings', () => {
      component.onRemoveMod(component.modList[0]);
      expect(component.activeServerInstance?.mods).toEqual([]);
      expect(component.activeServerInstance?.enabledMods).toEqual([]);
      expect(component.activeServerInstance?.modSettings).toEqual({});
      expect(component.modList).toEqual([]);
    });

    it('disables a mod', () => {
      const mod = component.modList[0];
      mod.enabled = false;
      component.onToggleMod(mod);
      expect(component.activeServerInstance?.enabledMods).toEqual([]);
    });

    it('keeps the mod\'s name when its settings change', () => {
      component.onUpdateModSettings({ mod: component.modList[0], settings: { Speed: '5' } });
      expect(component.activeServerInstance?.modSettings?.['1']).toEqual({ Speed: '5', _name: 'One' });
      expect(component.modList[0].settings).toEqual({ Speed: '5' });
    });

    it('changes nothing while the settings are locked', () => {
      mockServerState.areSettingsLocked.and.returnValue(true);
      const mod = component.modList[0];

      component.onAddMod({ id: '2', name: 'Two' });
      component.onRemoveMod(mod);
      component.onUpdateModSettings({ mod, settings: {} });
      mod.enabled = false;
      component.onToggleMod(mod);

      expect(component.activeServerInstance?.mods).toEqual(['1']);
      expect(component.activeServerInstance?.enabledMods).toEqual(['1']);
      expect(component.activeServerInstance?.modSettings?.['1']).toEqual({ _name: 'One', Speed: '2' });
      expect(mod.enabled).toBeTrue();
      expect(mockServerConfig.saveServerSettings).not.toHaveBeenCalled();
      expect(mockNotification.warning).toHaveBeenCalled();
    });

    it('rebuilds the rows after an import or copy, then saves', () => {
      component.activeServerInstance!.mods = ['5'];
      component.activeServerInstance!.enabledMods = ['5'];
      component.onConfigApplied();
      expect(component.modList.map(mod => mod.id)).toEqual(['5']);
      expect(mockServerConfig.saveServerSettings).toHaveBeenCalled();
    });
  });

  it('should default activeTab to the console', () => {
    expect(component.activeTab).toBe('console');
    expect(component.isSettingsTab).toBeFalse();
    expect(component.pageTitle).toBe('Console');
  });

  it('should navigate when a child requests another tab', () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    component.onTabChanged('rates');
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'rates']);
    component.onTabChanged('not-a-tab');
    expect(router.navigate).toHaveBeenCalledTimes(1);
    component.goToDashboard();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  describe('opening the server directory', () => {
    beforeEach(() => {
      component.activeServerInstance = { id: 'srv1', name: 'One' };
    });

    it('asks the backend to open it', () => {
      component.openServerDirectory();
      expect(mockMessaging.sendMessage as jasmine.Spy).toHaveBeenCalledWith('open-directory', { id: 'srv1' });
      expect(mockNotification.error).not.toHaveBeenCalled();
    });

    it('says why the backend could not open it', () => {
      (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(of({ success: false, error: 'Server directory not found' }));
      component.openServerDirectory();
      expect(mockNotification.error).toHaveBeenCalledWith('Server directory not found', 'Server');
    });

    it('reports a refusal that gives no reason', () => {
      (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(of({ success: false }));
      component.openServerDirectory();
      expect(mockNotification.error).toHaveBeenCalledWith('Could not open the server directory.', 'Server');
    });

    it('reports a request that failed', () => {
      spyOn(console, 'error');
      (mockMessaging.sendMessage as jasmine.Spy).and.returnValue(throwError(() => new Error('Timeout has occurred')));
      component.openServerDirectory();
      expect(mockNotification.error).toHaveBeenCalledWith('Could not open the server directory.', 'Server');
    });
  });

  it('should treat configuration pages as settings tabs', () => {
    component.activeTab = 'general';
    expect(component.isSettingsTab).toBeTrue();
    expect(component.pageTitle).toBe('General');
    component.activeTab = 'players';
    expect(component.isSettingsTab).toBeFalse();
  });
  describe('RCON permission', () => {
    it('offers the RCON panel only to a role that may use RCON', () => {
      expect(component.canUseRcon).toBeTrue();
      denied = new Set(['rcon.use']);
      expect(component.canUseRcon).toBeFalse();
    });

    it('offers no RCON panel for a server whose machine cannot be reached', () => {
      component.activeServerInstance = { id: 'srv1', name: 'One', state: 'unreachable' } as any;

      expect(component.canUseRcon).toBeFalse();
    });

    // The page's own copy follows state events; a machine that went quiet sends none.
    it('goes by the live list, which knows when the machine went quiet', () => {
      component.activeServerInstance = { id: 'srv1', name: 'One', state: 'Running' } as any;
      spyOn(TestBed.inject(LiveServersService), 'find').and.returnValue({ id: 'srv1', name: 'One', state: 'unreachable' } as any);

      expect(component.unreachable).toBeTrue();
      expect(component.canUseRcon).toBeFalse();
      expect(component.settingsLocked).toBeTrue();
    });
  });

  describe('moving the server', () => {
    beforeEach(() => {
      component.activeServerInstance = { id: 'isle', name: 'The Isle', nodeId: 'desk' } as any;
    });

    it('offers Move when the user may move servers and another machine can take it', () => {
      moveDestinations = [{ nodeId: 'box', name: 'Basement Box' }];
      expect(component.canMoveServer).toBeTrue();
      expect(destinationsAskedFor).toEqual({ nodeId: 'desk' });

      denied = new Set(['servers.move']);
      expect(component.canMoveServer).toBeFalse();

      denied = new Set();
      moveDestinations = [];
      expect(component.canMoveServer).toBeFalse();
    });

    it('opens the move dialog for the server shown, and closes it', () => {
      component.openMove();
      expect(component.movingServer).toEqual(jasmine.objectContaining({ id: 'isle', name: 'The Isle' }));

      component.closeMove();

      expect(component.movingServer).toBeNull();
    });
  });
});
