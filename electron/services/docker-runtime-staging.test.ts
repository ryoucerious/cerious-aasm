jest.unmock('fs');
jest.unmock('path');
jest.unmock('child_process');
jest.unmock('crypto');
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import axios from 'axios';
import { createHash } from 'crypto';
import { getDefaultInstallDir } from '../utils/platform.utils';
import { fetchLatestRelease } from '../utils/github-release.utils';
import { stageDockerRuntimeUpdate } from './docker-runtime-update';
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../utils/platform.utils', () => ({ isRunningInDocker: () => true, getDefaultInstallDir: jest.fn() }));
jest.mock('../utils/github-release.utils', () => ({ ...jest.requireActual('../utils/github-release.utils'), fetchLatestRelease: jest.fn() }));

describe('Runtime archive staging with real tar and filesystem', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-runtime-test-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(root);
    fs.mkdirSync(path.join(root, 'source/electron'), { recursive: true });
    fs.mkdirSync(path.join(root, 'source/dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'source/package.json'), JSON.stringify({ version: '9.0.0' }));
    fs.writeFileSync(path.join(root, 'source/electron/main.js'), '// app');
    fs.writeFileSync(path.join(root, 'source/dist/index.html'), '<p>updated</p>');
    const archive = path.join(root, 'release.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', path.join(root, 'source'), 'package.json', 'electron', 'dist']);
    const data = fs.readFileSync(archive);
    jest.mocked(fetchLatestRelease).mockResolvedValue({ tag_name: 'v9.0.0', assets: [{ name: 'cerious-aasm-runtime.tar.gz', browser_download_url: 'https://example.test/runtime', size: data.length, digest: 'sha256:' + createHash('sha256').update(data).digest('hex') }] } as any);
    jest.mocked(axios.get).mockImplementation(async () => ({ data: fs.createReadStream(archive) }) as any);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it('downloads, checks the digest, extracts and stages the release', async () => {
    const progress = jest.fn();
    await expect(stageDockerRuntimeUpdate('1.3.0', progress)).resolves.toEqual({ version: '9.0.0' });
    expect(fs.readFileSync(path.join(root, 'runtime/electron/main.js'), 'utf8')).toBe('// app');
    expect(fs.readFileSync(path.join(root, 'runtime/dist/index.html'), 'utf8')).toBe('<p>updated</p>');
    expect(fs.existsSync(path.join(root, 'runtime.staging'))).toBe(false);
    expect(progress).toHaveBeenCalled();
  });
  it('refuses a mismatched release before replacing an existing runtime', async () => {
    const release = await fetchLatestRelease();
    jest.mocked(fetchLatestRelease).mockResolvedValue({ ...release, tag_name: 'v10.0.0' } as any);
    fs.mkdirSync(path.join(root, 'runtime'));
    fs.writeFileSync(path.join(root, 'runtime/package.json'), '{"version":"8.0.0"}');
    await expect(stageDockerRuntimeUpdate('1.3.0')).rejects.toThrow('does not match');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'runtime/package.json'), 'utf8')).version).toBe('8.0.0');
    expect(fs.existsSync(path.join(root, 'runtime.staging'))).toBe(false);
  });
});
