import { RconManagementService } from './rcon-management.service';
import { MessagingService } from './messaging/messaging.service';
import { of, Subject } from 'rxjs';

describe('RconManagementService', () => {
  let service: RconManagementService;
  let messagingMock: jasmine.SpyObj<MessagingService>;

  beforeEach(() => {
    messagingMock = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    messagingMock.sendMessage.and.returnValue(of({}));
    messagingMock.receiveMessage.and.returnValue(new Subject<any>());
    service = new RconManagementService(messagingMock);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should send RCON command', () => {
    service.sendRconCommand('id1', 'ListPlayers').subscribe();
    expect(messagingMock.sendMessage).toHaveBeenCalledWith('rcon-command', { id: 'id1', command: 'ListPlayers' });
  });

  it('should throw error if command or serverId is missing', () => {
    expect(() => service.sendRconCommand('', 'ListPlayers')).toThrow();
    expect(() => service.sendRconCommand('id1', '')).toThrow();
  });

  it('should get known commands', () => {
    expect(service.getKnownCommands()).toEqual(service.knownRconCommands);
  });

  it('should validate command', () => {
    expect(service.isValidCommand('ListPlayers')).toBeTrue();
    expect(service.isValidCommand('')).toBeFalse();
    expect(service.isValidCommand('   ')).toBeFalse();
  });

  it('should subscribe to RCON status', () => {
    const obs = service.subscribeToRconStatus();
    expect(messagingMock.receiveMessage).toHaveBeenCalledWith('rcon-status');
    expect(obs).toBeTruthy();
  });
});
