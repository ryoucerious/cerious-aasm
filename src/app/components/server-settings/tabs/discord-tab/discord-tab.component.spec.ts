import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscordTabComponent } from './discord-tab.component';

describe('DiscordTabComponent', () => {
  let component: DiscordTabComponent;
  let fixture: ComponentFixture<DiscordTabComponent>;

  const serverA = () => ({
    id: 'A',
    discordConfig: {
      enabled: true,
      webhookUrl: 'https://discord.com/api/webhooks/test',
      notifications: {
        serverStart: true,
        serverStop: false,
        serverCrash: true,
        serverUpdate: false,
        serverJoin: true,
        serverLeave: false
      }
    }
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscordTabComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(DiscordTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('serverInstance', serverA());
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form from serverInstance discordConfig', () => {
    expect(component.enabled).toBeTrue();
    expect(component.webhookUrl).toBe('https://discord.com/api/webhooks/test');
    expect(component.notifications.serverStart).toBeTrue();
    expect(component.notifications.serverStop).toBeFalse();
    expect(component.notifications.serverJoin).toBeTrue();
  });

  it('should initialize with defaults when no discordConfig exists', () => {
    const freshFixture = TestBed.createComponent(DiscordTabComponent);
    const freshComponent = freshFixture.componentInstance;
    freshFixture.componentRef.setInput('serverInstance', {});
    freshFixture.detectChanges();
    expect(freshComponent.enabled).toBeFalse();
    expect(freshComponent.webhookUrl).toBe('');
    expect(freshComponent.notifications.serverStart).toBeTrue();
  });

  it('shows the next server\'s settings after a switch', () => {
    fixture.componentRef.setInput('serverInstance', { id: 'B' });
    fixture.detectChanges();
    expect(component.enabled).toBeFalse();
    expect(component.webhookUrl).toBe('');
    expect(component.notifications.serverStop).toBeTrue();
  });

  it('keeps unsaved edits when the same server is updated', () => {
    component.webhookUrl = 'https://discord.com/api/webhooks/typing';
    fixture.componentRef.setInput('serverInstance', serverA());
    fixture.detectChanges();
    expect(component.webhookUrl).toBe('https://discord.com/api/webhooks/typing');
  });

  it('should emit saveSettings on onSaveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.webhookUrl = 'https://discord.com/api/webhooks/new';
    component.enabled = true;
    component.onSaveSettings();
    expect(component.saveSettings.emit).toHaveBeenCalled();
    expect(component.serverInstance?.discordConfig?.webhookUrl).toBe('https://discord.com/api/webhooks/new');
    expect(component.serverInstance?.discordConfig?.enabled).toBeTrue();
  });

  it('should update serverInstance discordConfig with current notification values', () => {
    component.notifications.serverCrash = false;
    component.onSaveSettings();
    expect(component.serverInstance?.discordConfig?.notifications?.serverCrash).toBeFalse();
  });
});
