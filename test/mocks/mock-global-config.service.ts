export class MockGlobalConfigService {
  loadConfig = () => Promise.resolve({ authenticationEnabled: false });
}
