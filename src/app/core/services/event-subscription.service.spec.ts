import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule } from "@angular/common/http/testing";
import { EventSubscriptionService } from "./event-subscription.service";
import { MessagingService } from "./messaging/messaging.service";
import { ServerInstanceService } from "./server-instance.service";
import { ServerStateService } from "./server-state.service";
import { ServerConfigurationService } from "./server-configuration.service";
import { RconManagementService } from "./rcon-management.service";
import { NotificationService } from "./notification.service";
import { of, Observable } from "rxjs";

// Mock classes
class MockMessagingService {
  receiveMessage(channel: string) {
    if (channel === 'server-instances') {
      // Always return an array for server-instances
      return of([{ id: 1, memory: 123 }]);
    }
    // For all other channels, return an object
    return of({});
  }
  sendMessage = jasmine.createSpy("sendMessage").and.returnValue(of({}));
}

class MockServerInstanceService {
  getActiveServer = jasmine.createSpy("getActiveServer").and.returnValue(of({ id: 1, players: 0, state: "", memory: 0, crossplay: false, mods: [] }));
  getDefaultInstance = jasmine.createSpy("getDefaultInstance").and.returnValue({ id: 1, crossplay: false, mods: [] });
}

class MockServerStateService {
  logs$ = of();
  mapServerState = jasmine.createSpy("mapServerState").and.callFake((state: any) => state);
  clearLogsForInstance = jasmine.createSpy("clearLogsForInstance");
}

class MockServerConfigurationService {
  initializeServerInstance = jasmine.createSpy("initializeServerInstance").and.callFake((server: any) => ({ ...server, initialized: true }));
  createDeepCopy = jasmine.createSpy("createDeepCopy").and.callFake((obj: any) => JSON.parse(JSON.stringify(obj)));
  modsArrayToString = jasmine.createSpy("modsArrayToString").and.returnValue("");
}

class MockRconManagementService {
  subscribeToRconStatus = jasmine.createSpy("subscribeToRconStatus").and.returnValue(of({}));
}

class MockNotificationService {
  error = jasmine.createSpy("error");
}

describe("EventSubscriptionService", () => {
  let service: EventSubscriptionService;
  let messagingService: MockMessagingService;
  let serverStateService: MockServerStateService;
  let notificationService: MockNotificationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        EventSubscriptionService,
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: ServerStateService, useClass: MockServerStateService },
        { provide: ServerConfigurationService, useClass: MockServerConfigurationService },
        { provide: RconManagementService, useClass: MockRconManagementService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: "MessageTransport", useValue: {} }
      ]
    });
    service = TestBed.inject(EventSubscriptionService);
    messagingService = TestBed.inject(MessagingService) as any;
    serverStateService = TestBed.inject(ServerStateService) as any;
    notificationService = TestBed.inject(NotificationService) as any;
    // Clean up any existing subscriptions from previous tests
    service.destroySubscriptions();
  });

  afterEach(() => {
    service.destroySubscriptions();
  });

  it("should be created", () => {
    expect(service).toBeTruthy();
  });

  it("should handle notification error messages", () => {
    const component: any = { 
      activeServerInstance: { id: 1 },
      originalServerInstance: {},
      modsInput: "",
      rconConnected: false,
      crossplayPlatforms: [],
      advancedSettingsMeta: [], 
      loadBackupSettings: jasmine.createSpy("loadBackupSettings"),
      loadBackupList: jasmine.createSpy("loadBackupList"),
      loadModList: jasmine.createSpy("loadModList"),
      scrollLogsToBottom: jasmine.createSpy("scrollLogsToBottom")
    };
    const cdr: any = { markForCheck: jasmine.createSpy("markForCheck") };
    const serverInstanceService = TestBed.inject(ServerInstanceService) as any;
    serverInstanceService.getActiveServer.and.returnValue(of(null));
    spyOn(messagingService, 'receiveMessage').and.callFake((channel: string) => {
      if (channel === "notification") {
        return of({ type: "error", message: "test error" });
      }
      if (channel === "server-instances") {
        return of([{ id: 1, memory: 123 }]);
      }
      return of({});
    });

    service.initializeSubscriptions(component, cdr);
    expect(notificationService.error).toHaveBeenCalledWith("test error", "Server Start Error");
  });

  it("should handle clear-server-instance-logs event", () => {
  const component: any = { advancedSettingsMeta: [], scrollLogsToBottom: () => {}, loadBackupSettings: () => {}, loadBackupList: () => {} };
    const cdr: any = { markForCheck: jasmine.createSpy("markForCheck") };
    spyOn(messagingService, 'receiveMessage').and.callFake((channel: string) => {
      if (channel === "clear-server-instance-logs") {
        return of({ instanceId: 1 });
      }
      if (channel === "server-instances") {
        return of([{ id: 1, memory: 123 }]);
      }
      return of({});
    });

    service.initializeSubscriptions(component, cdr);
    expect(serverStateService.clearLogsForInstance).toHaveBeenCalledWith(1);
    expect(cdr.markForCheck).toHaveBeenCalled();
  });

  it("should handle rcon status event", () => {
  const component: any = { activeServerInstance: { id: 1 }, rconConnected: false, advancedSettingsMeta: [], scrollLogsToBottom: () => {}, loadBackupSettings: () => {}, loadBackupList: () => {} };
    const cdr: any = { markForCheck: jasmine.createSpy("markForCheck") };
    const rconService = TestBed.inject(RconManagementService) as any;
    rconService.subscribeToRconStatus.and.returnValue(of({ instanceId: 1, connected: true }));

    service.initializeSubscriptions(component, cdr);
    expect(component.rconConnected).toBeTrue();
    expect(cdr.markForCheck).toHaveBeenCalled();
  });

  it("should destroy subscriptions", () => {
    service["subscriptions"] = [{ unsubscribe: jasmine.createSpy("unsubscribe") } as any];
    service.destroySubscriptions();
    expect(service["subscriptions"].length).toBe(0);
  });
});
