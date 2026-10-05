import { TestBed } from "@angular/core/testing";
import { EventSubscriptionService } from "./event-subscription.service";
import { MessagingService } from "./messaging/messaging.service";
import { ServerInstanceService } from "./server-instance.service";
import { ServerStateService } from "./server-state.service";
import { ServerConfigurationService } from "./server-configuration.service";
import { RconManagementService } from "./rcon-management.service";
import { FieldDefinitionsService } from "./field-definitions.service";
import { Observable, of, Subject } from "rxjs";

class MockMessagingService {
  channels: Record<string, Subject<any>> = {};
  receiveMessage = jasmine.createSpy("receiveMessage").and.callFake((channel: string): Observable<any> =>
    this.channels[channel] ??= new Subject<any>()
  );
  sendMessage = jasmine.createSpy("sendMessage").and.returnValue(of({}));
}

class MockServerInstanceService {
  getActiveServer = jasmine.createSpy("getActiveServer").and.returnValue(of(null));
}

class MockServerStateService {
  logsChanged$ = new Subject<string>();
  mapServerState = jasmine.createSpy("mapServerState").and.callFake((state: any) => state);
  clearLogsForInstance = jasmine.createSpy("clearLogsForInstance");
}

class MockServerConfigurationService {
  initializeServerInstance = jasmine.createSpy("initializeServerInstance").and.callFake((server: any) => ({ mods: [], ...server }));
  createDeepCopy = jasmine.createSpy("createDeepCopy").and.callFake((obj: any) => JSON.parse(JSON.stringify(obj)));
}

class MockRconManagementService {
  status$ = new Subject<any>();
  subscribeToRconStatus = jasmine.createSpy("subscribeToRconStatus").and.callFake(() => this.status$);
}

describe("EventSubscriptionService", () => {
  let service: EventSubscriptionService;
  let messagingService: MockMessagingService;
  let serverInstanceService: MockServerInstanceService;
  let component: any;
  let cdr: any;

  const pageState = (overrides: Record<string, unknown> = {}) => ({
    advancedSettingsMeta: [],
    activeServerInstance: null,
    originalServerInstance: null,
    rconConnected: false,
    loadBackupSettings: jasmine.createSpy("loadBackupSettings"),
    loadBackupList: jasmine.createSpy("loadBackupList"),
    loadModList: jasmine.createSpy("loadModList"),
    ...overrides
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EventSubscriptionService,
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: ServerStateService, useClass: MockServerStateService },
        { provide: ServerConfigurationService, useClass: MockServerConfigurationService },
        { provide: RconManagementService, useClass: MockRconManagementService },
        { provide: FieldDefinitionsService, useValue: { getFieldDefinitions: () => of([{ key: "xpMultiplier", label: "XP", tab: "rates", type: "number" }]) } }
      ]
    });
    service = TestBed.inject(EventSubscriptionService);
    messagingService = TestBed.inject(MessagingService) as any;
    serverInstanceService = TestBed.inject(ServerInstanceService) as any;
    component = pageState();
    cdr = { markForCheck: jasmine.createSpy("markForCheck") };
  });

  afterEach(() => {
    service.destroySubscriptions();
  });

  it("loads the settings metadata for the page", () => {
    service.initializeSubscriptions(component, cdr);
    expect(component.advancedSettingsMeta).toEqual([jasmine.objectContaining({ key: "xpMultiplier" })]);
  });

  it("should handle clear-server-instance-logs event", () => {
    service.initializeSubscriptions(component, cdr);
    messagingService.channels["clear-server-instance-logs"].next({ instanceId: "1" });
    expect(TestBed.inject(ServerStateService).clearLogsForInstance).toHaveBeenCalledWith("1");
    expect(cdr.markForCheck).toHaveBeenCalled();
  });

  it("should handle rcon status event", () => {
    service.initializeSubscriptions(component, cdr);
    component.activeServerInstance = { id: "1", name: "A" };
    (TestBed.inject(RconManagementService) as any).status$.next({ instanceId: "1", connected: true });
    expect(component.rconConnected).toBeTrue();
    expect(cdr.markForCheck).toHaveBeenCalled();
  });

  it("loads the selected server and asks for its live state", () => {
    serverInstanceService.getActiveServer.and.returnValue(of({ id: "A", name: "Alpha", mods: ["1"] }));
    service.initializeSubscriptions(component, cdr);

    expect(component.activeServerInstance.id).toBe("A");
    expect(component.originalServerInstance).toEqual(component.activeServerInstance);
    expect(component.loadModList).toHaveBeenCalled();
    expect(component.loadBackupSettings).toHaveBeenCalled();
    expect(messagingService.sendMessage).toHaveBeenCalledWith("get-server-instance-state", { id: "A" });
    expect(messagingService.sendMessage).toHaveBeenCalledWith("get-server-instance-players", { id: "A" });
  });

  it("ignores replies that arrive after the user switched to another server", () => {
    const active$ = new Subject<any>();
    const replies: Record<string, Subject<any>> = {};
    serverInstanceService.getActiveServer.and.returnValue(active$);
    messagingService.sendMessage.and.callFake((channel: string) => replies[channel] = new Subject<any>());
    service.initializeSubscriptions(component, cdr);

    active$.next({ id: "A", mods: [] });
    const stateForA = replies["get-server-instance-state"];
    const playersForA = replies["get-server-instance-players"];
    active$.next({ id: "B", mods: [] });
    stateForA.next({ state: "running" });
    playersForA.next({ players: 9 });

    expect(component.activeServerInstance.id).toBe("B");
    expect(component.activeServerInstance.state).not.toBe("running");
    expect(component.activeServerInstance.players).not.toBe(9);
  });

  it("applies live events only to the server on the page", () => {
    service.initializeSubscriptions(component, cdr);
    component.activeServerInstance = { id: "A", name: "Alpha" };

    messagingService.channels["server-instance-state"].next({ instanceId: "B", state: "running" });
    messagingService.channels["server-instance-players"].next({ instanceId: "A", players: 3 });
    messagingService.channels["server-instance-memory"].next({ instanceId: "A", memory: 2048 });

    expect(component.activeServerInstance.state).toBeUndefined();
    expect(component.activeServerInstance.players).toBe(3);
    expect(component.activeServerInstance.memory).toBe(2048);
  });

  it("takes edits from other clients but not their state", () => {
    service.initializeSubscriptions(component, cdr);
    component.activeServerInstance = { id: "A", name: "Alpha", state: "Running" };

    messagingService.channels["server-instance-updated"].next({ id: "A", name: "Renamed", state: "stopped" });

    expect(component.activeServerInstance.name).toBe("Renamed");
    expect(component.activeServerInstance.state).toBe("Running");
    expect(component.originalServerInstance).toEqual(component.activeServerInstance);
  });

  describe("when the page's server is updated", () => {
    const update = (msg: Record<string, unknown>) => messagingService.channels["server-instance-updated"].next(msg);

    beforeEach(() => service.initializeSubscriptions(component, cdr));

    it("keeps fields the user changed since the last save when the save echoes back", () => {
      component.activeServerInstance = { id: "A", name: "Alpha", maxPlayers: 20 };
      component.originalServerInstance = { id: "A", name: "Alpha", maxPlayers: 10 };
      update({ id: "A", name: "Alpha", maxPlayers: 10 });
      expect(component.activeServerInstance.maxPlayers).toBe(20);
      expect(component.originalServerInstance.maxPlayers).toBe(10);
    });

    it("leaves the page alone for its own echo", () => {
      const page = { id: "A", name: "Alpha", mods: [] };
      component.activeServerInstance = page;
      component.originalServerInstance = { ...page };
      component.loadModList.calls.reset();
      update({ id: "A", name: "Alpha", mods: [] });
      expect(component.activeServerInstance).toBe(page);
      expect(component.loadModList).not.toHaveBeenCalled();
    });

    it("takes another client's edit of a field the user has not touched", () => {
      component.activeServerInstance = { id: "A", name: "Alpha", maxPlayers: 20 };
      component.originalServerInstance = { id: "A", name: "Alpha", maxPlayers: 10 };
      update({ id: "A", name: "Renamed", maxPlayers: 10, mods: ["7"] });
      expect(component.activeServerInstance.name).toBe("Renamed");
      expect(component.activeServerInstance.maxPlayers).toBe(20);
      expect(component.activeServerInstance.mods).toEqual(["7"]);
      expect(component.originalServerInstance.name).toBe("Renamed");
      expect(component.originalServerInstance.maxPlayers).toBe(10);
      expect(component.loadModList).toHaveBeenCalled();
    });
  });

  describe("when a server is selected", () => {
    let active$: Subject<any>;

    beforeEach(() => {
      active$ = new Subject<any>();
      serverInstanceService.getActiveServer.and.returnValue(active$);
      service.initializeSubscriptions(component, cdr);
    });

    it("does not reload the page when the same server is announced again", () => {
      active$.next({ id: "A", maxPlayers: 10 });
      component.activeServerInstance.maxPlayers = 20;
      active$.next({ id: "A", maxPlayers: 10, name: "Alpha" });
      expect(component.activeServerInstance.maxPlayers).toBe(20);
      expect(component.loadBackupSettings).toHaveBeenCalledTimes(1);
    });

    it("works on its own copy of the server", () => {
      const selected = { id: "A", crossplay: ["Steam (PC)"], mods: [] };
      active$.next(selected);
      component.activeServerInstance.crossplay.push("Xbox (XSX)");
      expect(selected.crossplay).toEqual(["Steam (PC)"]);
    });

    it("shows no server once none is selected", () => {
      active$.next({ id: "A", mods: [] });
      active$.next(null);
      expect(component.activeServerInstance).toBeNull();
      expect(component.originalServerInstance).toBeNull();
    });
  });

  it("leaves backend notifications to NotificationService", () => {
    service.initializeSubscriptions(component, cdr);
    expect(messagingService.receiveMessage).not.toHaveBeenCalledWith("notification");
  });

  it("should destroy subscriptions", () => {
    service.initializeSubscriptions(component, cdr);
    service.destroySubscriptions();
    expect(Object.values(messagingService.channels).every(channel => !channel.observed)).toBeTrue();
  });
});
