import { AutoUpdateService } from './auto-update.service';
import { stageDockerRuntimeUpdate, relaunchInPlace, canApplyInPlace } from './docker-runtime-update';
import { fetchLatestRelease } from '../utils/github-release.utils';
import { messagingService } from './messaging.service';
import { autoUpdater } from 'electron-updater';
jest.mock('../utils/platform.utils', () => ({ isRunningInDocker: () => true }));
jest.mock('./docker-runtime-update', () => ({ ...jest.requireActual('./docker-runtime-update'), stageDockerRuntimeUpdate: jest.fn(), relaunchInPlace: jest.fn(), canApplyInPlace: jest.fn(() => true) }));
jest.mock('../utils/github-release.utils', () => ({ ...jest.requireActual('../utils/github-release.utils'), fetchLatestRelease: jest.fn() }));
jest.mock('./messaging.service', () => ({ messagingService: { sendToAllRenderers: jest.fn(), broadcastToWebClients: jest.fn() } }));
jest.mock('./linux-package-updater.service', () => ({ linuxPackageUpdaterService: {} }));
jest.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: jest.fn(), quitAndInstall: jest.fn() } }));

describe('Docker app updates', () => {
  it('offers an actionable update to browser clients when the release has a runtime', async () => {
    jest.mocked(fetchLatestRelease).mockResolvedValue({ tag_name: 'v99.0.0', assets: [{ name: 'cerious-aasm-runtime.tar.gz' }] } as any);
    const service = new AutoUpdateService();
    await service.checkForUpdates();
    expect(service.getLastStatus()).toMatchObject({ status: 'available', manual: false, inPlace: true });
    expect(messagingService.broadcastToWebClients).toHaveBeenCalledWith('app-update-status', expect.objectContaining({ status: 'available', inPlace: true }));
  });
  it('shows the image-update steps when this image cannot apply an update in place', async () => {
    jest.mocked(fetchLatestRelease).mockResolvedValue({ tag_name: 'v99.0.0', assets: [{ name: 'cerious-aasm-runtime.tar.gz' }] } as any);
    jest.mocked(canApplyInPlace).mockReturnValueOnce(false);
    const service = new AutoUpdateService();
    await service.checkForUpdates();
    expect(service.getLastStatus()).toMatchObject({ status: 'available', manual: true });
  });
  it('downloads once, reports readiness, and relaunches through the container entrypoint', async () => {
    let finish!: (value: { version: string }) => void;
    jest.mocked(stageDockerRuntimeUpdate).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const service = new AutoUpdateService();
    const first = service.downloadUpdate();
    const duplicate = service.downloadUpdate();
    expect(stageDockerRuntimeUpdate).toHaveBeenCalledTimes(1);
    expect(service.isUpdateReady()).toBe(false);
    expect(service.getLastStatus()).toMatchObject({ status: 'downloading', inPlace: true });
    finish({ version: '99.0.0' });
    await Promise.all([first, duplicate]);
    expect(service.isUpdateReady()).toBe(true);
    service.quitAndInstall();
    expect(relaunchInPlace).toHaveBeenCalledTimes(1);
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('reports failed downloads and never relaunches an unprepared update', async () => {
    jest.mocked(stageDockerRuntimeUpdate).mockRejectedValueOnce(new Error('Disk full'));
    const service = new AutoUpdateService();
    await expect(service.downloadUpdate()).rejects.toThrow('Disk full');
    expect(service.getLastStatus()).toMatchObject({ status: 'error', error: 'Disk full', inPlace: true });
    service.quitAndInstall();
    expect(relaunchInPlace).not.toHaveBeenCalled();
    expect(service.isUpdateReady()).toBe(false);
  });
});
