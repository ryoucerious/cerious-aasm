import axios from 'axios';

const LATEST_RELEASE_API = 'https://api.github.com/repos/ryoucerious/cerious-aasm/releases/latest';
export const LATEST_RELEASE_PAGE = 'https://github.com/ryoucerious/cerious-aasm/releases/latest';
export const UPDATER_USER_AGENT = 'cerious-aasm-updater';

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  /** "sha256:<hex>". Only in API responses from mid-2025 on. */
  digest?: string | null;
}

export interface GitHubRelease {
  tag_name: string;
  body?: string | null;
  published_at?: string | null;
  assets: GitHubReleaseAsset[];
}

/** The latest published release of the app, or null when GitHub cannot be reached. */
export async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const response = await axios.get<GitHubRelease>(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': UPDATER_USER_AGENT },
      timeout: 15000
    });
    return response.data ?? null;
  } catch (error) {
    // The message only: an axios error carries the whole request, headers included.
    console.error('[github-release] Could not fetch the latest release:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

function parseVersion(version: string): { core: number[]; preRelease: string } {
  const [core, ...preRelease] = version.replace(/^v/, '').split('-');
  return { core: core.split('.').map(part => Number(part) || 0), preRelease: preRelease.join('-') };
}

/** True when `remote` is newer than `current`. A leading "v" is ignored; 1.0.0 is newer than 1.0.0-beta.1. */
export function isNewerVersion(remote: string, current: string): boolean {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  for (let i = 0; i < Math.max(r.core.length, c.core.length); i++) {
    const difference = (r.core[i] ?? 0) - (c.core[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }

  if (!r.preRelease || !c.preRelease) {
    return !r.preRelease && !!c.preRelease;
  }
  return r.preRelease.localeCompare(c.preRelease, undefined, { numeric: true, sensitivity: 'base' }) > 0;
}
