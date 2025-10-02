import { DirectoryService } from './directory.service';
import { MessagingService } from './messaging/messaging.service';
describe('DirectoryService', () => {
  let service: DirectoryService;
  let messaging: jasmine.SpyObj<MessagingService>;
  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    service = new DirectoryService(messaging);
  });
  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  it('should call messaging.sendMessage for openConfigDirectory and return observable', () => {
    const obs = {} as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.openConfigDirectory();
    expect(messaging.sendMessage).toHaveBeenCalledWith('open-config-directory', {});
    expect(result).toBe(obs);
  });
});
