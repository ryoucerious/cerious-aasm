import { ArkUpdateService } from './ark-update.service';
import { MessagingService } from './messaging/messaging.service';
describe('ArkUpdateService', () => {
  let service: ArkUpdateService;
  let messaging: jasmine.SpyObj<MessagingService>;
  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    service = new ArkUpdateService(messaging);
  });
  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  it('should call messaging.sendMessage with correct arguments and return observable', () => {
    const obs = {} as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.checkForUpdate();
    expect(messaging.sendMessage).toHaveBeenCalledWith('check-ark-update', {});
    expect(result).toBe(obs);
  });
});
