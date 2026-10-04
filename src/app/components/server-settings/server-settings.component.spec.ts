import { ComponentFixture, TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { ServerSettingsComponent } from './server-settings.component';
import { FirewallService } from '../../core/services/firewall.service';
import { NotificationService } from '../../core/services/notification.service';
import { IpcService } from '../../core/services/ipc.service';
import { ArkServerValidationService, FieldValidation } from '../../core/services/ark-server-validation.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ConfigImportExportService } from '../../core/services/config-import-export.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';

describe('ServerSettingsComponent', () => {
  let component: ServerSettingsComponent;
  let fixture: ComponentFixture<ServerSettingsComponent>;
  let validateField: jasmine.Spy<(key: string, value: unknown, server?: unknown, label?: string) => FieldValidation>;
  let sendMessage: jasmine.Spy;
  let notification: jasmine.SpyObj<NotificationService>;
  let saves: number;

  beforeEach(async () => {
    validateField = jasmine.createSpy('validateField').and.callFake((key: string, value: unknown) =>
      key === 'mapName' && !value
        ? { field: key, isValid: false, error: 'Server Map cannot be empty' }
        : { field: key, isValid: true });
    sendMessage = jasmine.createSpy('sendMessage').and.returnValue(of({ success: true, content: '' }));
    notification = jasmine.createSpyObj<NotificationService>('NotificationService', ['success', 'error', 'info', 'warning']);

    await TestBed.configureTestingModule({
      imports: [ServerSettingsComponent],
      providers: [
        { provide: FirewallService, useValue: { checkFirewallStatus: () => of(null) } },
        { provide: NotificationService, useValue: notification },
        { provide: IpcService, useValue: { isElectron: false } },
        { provide: ArkServerValidationService, useValue: { validateField } },
        { provide: MessagingService, useValue: { sendMessage, receiveMessage: () => of() } },
        { provide: ServerInstanceService, useValue: { getInstances: () => of([]) } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ServerSettingsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('serverInstance', { id: 'A', mapName: 'TheIsland_WP', restartDays: [] });
    component.generalFields = [{
      tab: 'general', key: 'mapName', label: 'Server Map', type: 'combo', description: '',
      options: [{ value: 'TheIsland_WP', display: 'The Island' }, { value: 'Ragnarok_WP', display: 'Ragnarok' }]
    }];
    component.statList = ['Health', 'Stamina'];
    saves = 0;
    component.settingsChanged.subscribe(() => saves++);
    fixture.detectChanges();
  });

  const showTab = (tab: string) => {
    fixture.componentRef.setInput('activeTab', tab);
    fixture.detectChanges();
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent || '';

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('asks the backend which platform it runs on, for the firewall page', () => {
    const firewall = TestBed.inject(FirewallService);
    spyOn(firewall, 'checkFirewallStatus').and.returnValue(of({ enabled: true, platform: 'linux' }));
    component.checkFirewallStatus();
    expect(component.firewallStatus).toEqual({ enabled: true, platform: 'linux' });
  });

  it('passes the backup page\'s requests on to the server page', () => {
    const emitted: unknown[] = [];
    component.createManualBackup.subscribe(() => emitted.push('create'));
    component.backupTimeChange.subscribe(time => emitted.push(time));
    component.maxBackupsToKeepChange.subscribe(count => emitted.push(count));
    component.backupScheduleEnabled = true;
    showTab('backup');
    const el = fixture.nativeElement as HTMLElement;

    (Array.from(el.querySelectorAll('button')).find(button => button.textContent?.includes('Create Backup Now')) as HTMLButtonElement).click();
    const time = el.querySelector('input[type=time]') as HTMLInputElement;
    time.value = '04:30';
    time.dispatchEvent(new Event('change'));
    const retention = el.querySelector('input[type=number]') as HTMLInputElement;
    retention.value = '12';
    retention.dispatchEvent(new Event('change'));

    expect(emitted).toEqual(['create', '04:30', 12]);
  });

  it('passes the automation page\'s saves on to the server page', () => {
    const saved: string[] = [];
    component.saveAutoStartSettings.subscribe(() => saved.push('auto-start'));
    component.saveCrashDetectionSettings.subscribe(() => saved.push('crash-detection'));
    showTab('automation');
    const toggles = (fixture.nativeElement as HTMLElement).querySelectorAll('input[type=checkbox]');
    toggles[0].dispatchEvent(new Event('change'));
    toggles[1].dispatchEvent(new Event('change'));
    expect(saved).toEqual(['auto-start', 'crash-detection']);
  });

  it('should emit openDirectory on onOpenDirectory()', () => {
    spyOn(component.openDirectory, 'emit');
    const event = jasmine.createSpyObj<Event>('Event', ['stopPropagation']);
    component.onOpenDirectory(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.openDirectory.emit).toHaveBeenCalled();
  });

  it('should emit tabChanged on onTabChange()', () => {
    spyOn(component.tabChanged, 'emit');
    component.onTabChange('general');
    expect(component.tabChanged.emit).toHaveBeenCalledWith('general');
  });

  it('switches between the configuration pages and the INI files with expert mode', () => {
    spyOn(component.tabChanged, 'emit');
    component.toggleExpertMode({ target: { checked: true } } as unknown as Event);
    expect(component.expertMode).toBeTrue();
    expect(component.tabChanged.emit).toHaveBeenCalledWith('ini-GameUserSettings');
    component.toggleExpertMode({ target: { checked: false } } as unknown as Event);
    expect(component.expertMode).toBeFalse();
    expect(component.tabChanged.emit).toHaveBeenCalledWith('general');
  });

  it('turns expert mode on when an INI page is opened directly', () => {
    showTab('ini-Game');
    expect(component.expertMode).toBeTrue();
    expect(component.pageTitle).toBe('Game');
    expect(component.iniFilename).toBe('Game.ini');
    expect(sendMessage).toHaveBeenCalledWith('get-ini-file', { instanceId: 'A', filename: 'Game.ini' });
  });

  it('titles each page', () => {
    showTab('stats');
    expect(component.pageTitle).toBe('Stat Multipliers');
    expect(component.showExpertToggle).toBeTrue();
    showTab('backup');
    expect(component.pageTitle).toBe('Backup');
    expect(component.showExpertToggle).toBeFalse();
  });

  it('shows nothing for the pages hosted elsewhere', () => {
    showTab('players');
    expect(component.isKnownTab).toBeFalse();
    expect((fixture.nativeElement as HTMLElement).querySelector('.settings-panel')).toBeNull();
  });

  describe('validation', () => {
    it('records a field\'s error and warning, and clears them once it is fixed', () => {
      validateField.and.returnValue({ field: 'testField', isValid: false, error: 'Error', warning: 'Warning' });
      expect(component.validateField('testField', 'value')).toBeFalse();
      expect(component.fieldErrors['testField']).toBe('Error');
      expect(component.fieldWarnings['testField']).toBe('Warning');

      validateField.and.returnValue({ field: 'testField', isValid: true });
      expect(component.validateField('testField', 'value')).toBeTrue();
      expect(component.fieldErrors['testField']).toBeUndefined();
      expect(component.fieldWarnings['testField']).toBeUndefined();
    });

    it('passes the field\'s label from the metadata', () => {
      component.ratesFields = [{ tab: 'rates', key: 'xpMultiplier', label: 'XP Multiplier', type: 'number' }];
      component.validateField('xpMultiplier', 2);
      component.validateField('unknownField', 1);
      expect(validateField.calls.argsFor(0)[3]).toBe('XP Multiplier');
      expect(validateField.calls.argsFor(1)[3]).toBe('unknownField');
    });

    it('forgets the messages of the previous server', () => {
      component.fieldErrors = { gamePort: 'Game Port must be a valid integer' };
      fixture.componentRef.setInput('serverInstance', { id: 'B' });
      fixture.detectChanges();
      expect(component.fieldErrors).toEqual({});
    });

    it('shows them on the rates, automation and backup pages', () => {
      component.fieldErrors = { xpMultiplier: 'XP error', crashDetectionInterval: 'Interval error', maxBackupsToKeep: 'Retention error' };
      component.ratesFields = [{ tab: 'rates', key: 'xpMultiplier', label: 'XP', type: 'number' }];
      component.backupScheduleEnabled = true;
      showTab('rates');
      expect(text()).toContain('XP error');
      showTab('automation');
      expect(text()).toContain('Interval error');
      showTab('backup');
      expect(text()).toContain('Retention error');
    });
  });

  describe('the map field', () => {
    const mapInput = () => (fixture.nativeElement as HTMLElement).querySelector('.custom-dropdown input') as HTMLInputElement;

    beforeEach(() => showTab('general'));

    it('does not save while a name is typed', () => {
      const input = mapInput();
      input.value = 'Custom_WP';
      input.dispatchEvent(new Event('input'));
      expect(component.serverInstance.mapName).toBe('Custom_WP');
      expect(saves).toBe(0);
    });

    it('saves a typed name once the field is left', () => {
      const input = mapInput();
      input.value = 'Custom_WP';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      expect(validateField).toHaveBeenCalledWith('mapName', 'Custom_WP', component.serverInstance, 'Server Map');
      expect(saves).toBe(1);
    });

    it('does not save a cleared name and says why', () => {
      const input = mapInput();
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(saves).toBe(0);
      expect(text()).toContain('Server Map cannot be empty');
    });

    it('saves a map picked from the list and closes the list', () => {
      component.dropdownOpen = true;
      fixture.detectChanges();
      const option = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.dropdown-menu div'))
        .find(element => element.textContent?.trim() === 'Ragnarok') as HTMLElement;
      option.dispatchEvent(new Event('mousedown'));
      expect(component.serverInstance.mapName).toBe('Ragnarok_WP');
      expect(component.dropdownOpen).toBeFalse();
      expect(saves).toBe(1);
    });
  });

  it('adds and removes scheduled restart days, then saves them', () => {
    spyOn(component.saveScheduledRestartSettings, 'emit');
    component.serverInstance.restartDays = [1, 2];
    component.onRestartDayToggle(0, true);
    expect(component.serverInstance.restartDays).toEqual([1, 2, 0]);
    component.onRestartDayToggle(1, false);
    expect(component.serverInstance.restartDays).toEqual([2, 0]);
    expect(component.saveScheduledRestartSettings.emit).toHaveBeenCalledTimes(2);
  });

  it('saves a chosen restart frequency', () => {
    spyOn(component.saveScheduledRestartSettings, 'emit');
    component.restartFrequencyDropdownOpen = true;
    component.onRestartFrequencySelect('weekly');
    expect(component.serverInstance.restartFrequency).toBe('weekly');
    expect(component.restartFrequencyDropdownOpen).toBeFalse();
    expect(component.saveScheduledRestartSettings.emit).toHaveBeenCalled();
  });

  it('opens one dropdown at a time and closes it on a second click', () => {
    component.toggleBackupFrequencyDropdown();
    expect(component.backupFrequencyDropdownOpen).toBeTrue();
    component.toggleStatSelectorDropdown();
    expect(component.backupFrequencyDropdownOpen).toBeFalse();
    expect(component.statSelectorDropdownOpen).toBeTrue();
    component.toggleStatSelectorDropdown();
    expect(component.statSelectorDropdownOpen).toBeFalse();
  });

  it('passes the chosen backup frequency and day on', () => {
    spyOn(component.backupFrequencyChange, 'emit');
    spyOn(component.backupDayOfWeekChange, 'emit');
    component.onBackupFrequencySelect('weekly');
    component.onBackupDaySelect(0);
    expect(component.backupFrequencyChange.emit).toHaveBeenCalledWith('weekly');
    expect(component.backupDayOfWeekChange.emit).toHaveBeenCalledWith(0);
  });

  it('reports on the cluster directory test', () => {
    sendMessage.and.returnValue(of({ accessible: true }));
    component.serverInstance.clusterDirOverride = 'C:/cluster';
    component.testClusterConnectivity();
    expect(sendMessage).toHaveBeenCalledWith('test-directory-access', { directoryPath: 'C:/cluster' });
    expect(notification.info).toHaveBeenCalled();
    expect(notification.success).toHaveBeenCalledWith('Successfully connected to: C:/cluster', 'Cluster directory is accessible');
  });

  it('does not test a cluster directory that is not set', () => {
    component.testClusterConnectivity();
    expect(sendMessage).not.toHaveBeenCalledWith('test-directory-access', jasmine.anything());
    expect(notification.error).toHaveBeenCalledWith('No cluster directory configured');
  });

  it('applies an imported configuration and lets the page rebuild from it', async () => {
    const importExport = TestBed.inject(ConfigImportExportService);
    const importFromIniContent = spyOn(importExport, 'importFromIniContent')
      .and.returnValue(of({ success: true, config: { id: 'other', maxPlayers: 20, mods: ['1'] } }));
    const applied = firstValueFrom(component.configApplied);

    const file = new File(['[ServerSettings]'], 'GameUserSettings.ini');
    component.onFileSelected({ target: { files: [file] } } as unknown as Event);
    await applied;

    expect(importFromIniContent).toHaveBeenCalledWith('[ServerSettings]', 'GameUserSettings.ini', 'A');
    expect(component.serverInstance.id).toBe('A');
    expect(component.serverInstance.maxPlayers).toBe(20);
    expect(component.serverInstance.mods).toEqual(['1']);
  });

  describe('while the settings are locked', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('isLocked', true);
      showTab('general');
    });

    const toolbarButton = (label: string) => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.settings-toolbar-actions button'))
      .find(button => button.textContent?.includes(label)) as HTMLButtonElement;

    it('cannot import or copy settings in', () => {
      expect(toolbarButton('Import').disabled).toBeTrue();
      expect(toolbarButton('Copy from').disabled).toBeTrue();
      expect(toolbarButton('Export').disabled).toBeFalse();
    });

    it('ignores an import or copy that is started anyway', () => {
      const fileInput = (fixture.nativeElement as HTMLElement).querySelector('input[type=file]') as HTMLInputElement;
      spyOn(fileInput, 'click');
      component.onImportConfig(new Event('click'));
      component.onOpenCopyConfig(new Event('click'));
      expect(fileInput.click).not.toHaveBeenCalled();
      expect(component.showCopyConfig).toBeFalse();
    });
  });

  it('closes the copy dialog once settings are copied and lets the page rebuild', () => {
    spyOn(component.configApplied, 'emit');
    component.onOpenCopyConfig(new Event('click'));
    expect(component.showCopyConfig).toBeTrue();
    component.onConfigCopied();
    expect(component.showCopyConfig).toBeFalse();
    expect(component.configApplied.emit).toHaveBeenCalled();
  });
});
