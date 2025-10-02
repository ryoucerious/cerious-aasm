import { UtilityService } from './utility.service';

describe('UtilityService', () => {
  let service: UtilityService;

  beforeEach(() => {
    service = new UtilityService();
  });

  it('should return platform as Electron if Electron detected', () => {
    Object.defineProperty(window, 'process', { value: { type: 'renderer' }, configurable: true });
    expect(service.getPlatform()).toBe('Electron');
    delete (window as any).process;
  });

  it('should return platform as Web if Electron not detected', () => {
  Object.defineProperty(window, 'process', { value: undefined, configurable: true });
  Object.defineProperty(window, 'electronAPI', { value: undefined, configurable: true });
  Object.defineProperty(window, 'require', { value: undefined, configurable: true });
  spyOnProperty(navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0');
  // Do not redefine window.location.protocol, just rely on its default value
  expect(service.getPlatform()).toBe('Web');
  delete (window as any).process;
  delete (window as any).electronAPI;
  delete (window as any).require;
  });

  it('should detect arrays', () => {
    expect(service.isArray([1, 2, 3])).toBeTrue();
    expect(service.isArray('not array')).toBeFalse();
  });

  it('should format file sizes', () => {
    expect(service.formatFileSize(0)).toBe('0 B');
    expect(service.formatFileSize(1024)).toBe('1 KB');
    expect(service.formatFileSize(1048576)).toBe('1 MB');
    expect(service.formatFileSize(1073741824)).toBe('1 GB');
  });

  it('should format dates', () => {
    expect(service.getFormattedDate('2025-10-01T00:00:00Z')).toContain('2025');
    expect(service.getFormattedDate(new Date('2025-10-01T00:00:00Z'))).toContain('2025');
    expect(service.getFormattedDate(1633046400)).toContain('2021'); // timestamp in seconds
    expect(service.getFormattedDate(1633046400000)).toContain('2021'); // timestamp in ms
    expect(service.getFormattedDate(undefined)).toBe('Unknown');
    expect(service.getFormattedDate({})).toBe('Invalid Date');
  });
  it('should download file from valid base64 data', () => {
    // Mock DOM methods
  spyOn(document.body, 'appendChild');
  spyOn(document.body, 'removeChild');
  spyOn(window.URL, 'createObjectURL').and.returnValue('blob:url');
  spyOn(window.URL, 'revokeObjectURL');
  const link = document.createElement('a');
  spyOn(document, 'createElement').and.returnValue(link);
  spyOn(link, 'click');
  const result = service.downloadFileFromData(btoa('testdata'), 'test.txt', 'text/plain');
  expect(result.success).toBeTrue();
  });

  it('should return error for invalid base64 data', () => {
    const result = service.downloadFileFromData('!!!notbase64', 'fail.txt', 'text/plain');
    expect(result.success).toBeFalse();
    expect(result.error).toContain('Failed to download backup file');
  });
});
