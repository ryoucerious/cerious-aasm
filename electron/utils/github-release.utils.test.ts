import axios from 'axios';
import { fetchLatestRelease, isNewerVersion } from './github-release.utils';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

const mockGet = jest.mocked(axios.get);

describe('github-release.utils', () => {
  describe('isNewerVersion', () => {
    it.each([
      ['v1.2.0', '1.1.9', true],
      ['1.10.0', '1.9.0', true],
      ['2', '1.9.9', true],
      ['1.2.0', '1.2.0', false],
      ['v1.2.0', '1.2.0', false],
      ['1.1.9', '1.2.0', false],
      // A release outranks its own pre-releases.
      ['1.2.0', '1.2.0-beta.1', true],
      ['1.2.0-beta.1', '1.2.0', false],
      ['1.2.0-beta.10', '1.2.0-beta.2', true],
      ['1.2.0-beta.2', '1.2.0-beta.10', false],
      ['not-a-version', '1.0.0', false]
    ])('%s is newer than %s: %p', (remote, current, expected) => {
      expect(isNewerVersion(remote, current)).toBe(expected);
    });
  });

  describe('fetchLatestRelease', () => {
    it('asks the GitHub API for the latest release', async () => {
      const release = { tag_name: 'v1.2.0', assets: [] };
      mockGet.mockResolvedValue({ data: release });

      await expect(fetchLatestRelease()).resolves.toBe(release);
      expect(mockGet).toHaveBeenCalledWith(
        'https://api.github.com/repos/ryoucerious/cerious-aasm/releases/latest',
        expect.objectContaining({
          headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'cerious-aasm-updater' },
          timeout: 15000
        })
      );
    });

    it('answers null, logging only the message, when GitHub cannot be reached', async () => {
      const error = Object.assign(new Error('Request failed with status code 403'), { config: { headers: { Authorization: 'secret' } } });
      mockGet.mockRejectedValue(error);

      await expect(fetchLatestRelease()).resolves.toBeNull();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[github-release]'), 'Request failed with status code 403');
    });
  });
});
