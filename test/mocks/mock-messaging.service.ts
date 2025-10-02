export class MockMessagingService {
  receiveMessage = () => ({ subscribe: () => {} });
  sendMessage = () => ({ subscribe: () => {} });
}
