import { of } from 'rxjs';

export class MockMessagingService {
  receiveMessage = () => of(null);
  sendMessage = () => of(null);
  sendNotification = () => {};
}
