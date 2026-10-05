import { shell } from 'electron';
import * as https from 'https';
import { validateURL } from '../utils/validation.utils';
import { onRequest } from './handler.utils';

const CURSEFORGE_ARK_URL = 'https://www.curseforge.com/ark-survival-ascended';

const CURSE_BASE = 'api.curseforge.com';
const ARK_GAME_ID = 83374; // ARK: Survival Ascended

interface CurseForgeMod {
  id: number;
  name: string;
  summary: string;
  downloadCount: number;
  logo?: { thumbnailUrl?: string };
  screenshots?: { thumbnailUrl?: string }[];
  links?: { websiteUrl?: string };
  authors?: { name: string }[];
  categories?: { name: string }[];
  dateModified?: string;
  dateReleased?: string;
  latestFiles?: { id: number; displayName: string; modId?: number }[];
}

function cfGet<T>(apiKey: string, urlPath: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: CURSE_BASE,
      path: urlPath,
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'Cerious-AASM',
      },
    };
    https.get(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;

        // Parsed regardless of status so an API error message can be surfaced.
        let parsed: unknown = null;
        let parseError: string | null = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parseError = data.slice(0, 300);
        }

        if (status === 401) {
          return reject(new Error('CurseForge API key is invalid or expired (401). Check your key in Settings > General.'));
        }
        if (status === 403) {
          return reject(new Error(
            'ARK: Survival Ascended is a restricted game on the CurseForge API - ' +
            'third-party developer keys cannot access it (403). ' +
            'You can browse and copy mod IDs directly from the CurseForge website instead.'
          ));
        }
        if (status === 429) {
          return reject(new Error('CurseForge rate limit exceeded (429). Please wait a moment and try again.'));
        }
        if (status < 200 || status >= 300) {
          const body = parsed as { message?: string; error?: string } | null;
          const detail = body?.message || body?.error || parseError || `HTTP ${status}`;
          return reject(new Error(`CurseForge API error: ${detail}`));
        }

        if (parseError !== null) {
          return reject(new Error(`Failed to parse CurseForge response (HTTP ${status}): ${parseError}`));
        }

        resolve(parsed as T);
      });
    }).on('error', reject);
  });
}

function toModSummary(mod: CurseForgeMod) {
  return {
    id: mod.id,
    name: mod.name,
    summary: mod.summary,
    downloadCount: mod.downloadCount,
    thumbUrl: mod.logo?.thumbnailUrl || '',
    screenshotUrl: (mod.screenshots || [])[0]?.thumbnailUrl || mod.logo?.thumbnailUrl || '',
    websiteUrl: mod.links?.websiteUrl || '',
    authors: (mod.authors || []).map(author => author.name).join(', '),
    categories: (mod.categories || []).map(category => category.name).slice(0, 3),
    dateUpdated: mod.dateModified || mod.dateReleased || '',
  };
}

onRequest('curseforge-search-mods', async payload => {
  const { query, apiKey = '', pageSize = 20, index = 0, sortField = 2, categoryId } = payload;
  if (!apiKey) {
    return {
      success: false,
      error: 'No CurseForge API key configured. This build may not have been packaged with the required key.',
    };
  }

  let urlPath =
    `/v1/mods/search?gameId=${ARK_GAME_ID}&searchFilter=${encodeURIComponent(query || '')}` +
    `&pageSize=${pageSize}&index=${index}&sortField=${sortField}&sortOrder=desc`;
  if (categoryId) {
    urlPath += `&categoryId=${categoryId}`;
  }

  const json = await cfGet<{ data?: CurseForgeMod[]; pagination: unknown }>(apiKey, urlPath);
  const mods = (json.data || []).map(mod => ({
    ...toModSummary(mod),
    latestFiles: (mod.latestFiles || []).slice(0, 1).map(file => ({
      id: file.id,
      displayName: file.displayName,
      modId: String(file.modId || mod.id),
    })),
  }));
  return { success: true, mods, pagination: json.pagination };
});

onRequest('curseforge-get-mod', async payload => {
  const { modId, apiKey } = payload;
  if (!apiKey) {
    return { success: false, error: 'CurseForge API key not configured.' };
  }
  const json = await cfGet<{ data: CurseForgeMod }>(apiKey, `/v1/mods/${modId}`);
  return { success: true, mod: toModSummary(json.data) };
});

// Only https: shell.openExternal also runs file:, UNC paths and custom protocol handlers, any of
// which can start a program.
onRequest('curseforge-open-website', async payload => {
  const url = payload.url || CURSEFORGE_ARK_URL;
  if (typeof url !== 'string' || !validateURL(url) || new URL(url).protocol !== 'https:') {
    return { success: false, error: 'Only https links can be opened.' };
  }
  await shell.openExternal(url);
  return { success: true };
});
