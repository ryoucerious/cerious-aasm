export class MockNotificationService {
  subscriptions = [{ unsubscribe: () => {} }];
  success = () => {};
  error = () => {};
  info = () => {};
  warning = () => {};
}
