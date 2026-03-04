import { messagingService } from '../services/messaging.service';
import { shell } from 'electron';
import * as https from 'https';

const CURSEFORGE_ARK_URL = 'https://www.curseforge.com/ark-survival-ascended';

const CURSE_BASE = 'api.curseforge.com';
const ARK_GAME_ID = 83374; // ARK: Survival Ascended

function cfGet(apiKey: string, urlPath: string): Promise<any> {
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

        // Attempt to parse regardless of status so we can surface API error messages
        let parsed: any = null;
        let parseError: string | null = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parseError = data.slice(0, 300); // include raw body snippet in error
        }

        if (status === 401) {
          return reject(new Error('CurseForge API key is invalid or expired (401). Check your key in Settings → General.'));
        }
        if (status === 403) {
          return reject(new Error(
            'ARK: Survival Ascended is a restricted game on the CurseForge API — ' +
            'third-party developer keys cannot access it (403). ' +
            'You can browse and copy mod IDs directly from the CurseForge website instead.'
          ));
        }
        if (status === 429) {
          return reject(new Error('CurseForge rate limit exceeded (429). Please wait a moment and try again.'));
        }
        if (status < 200 || status >= 300) {
          const detail = parsed?.message || parsed?.error || parseError || `HTTP ${status}`;
          return reject(new Error(`CurseForge API error: ${detail}`));
        }

        if (parseError !== null) {
          return reject(new Error(`Failed to parse CurseForge response (HTTP ${status}): ${parseError}`));
        }

        resolve(parsed);
      });
    }).on('error', reject);
  });
}

/**
 * Search for mods on CurseForge.
 * Payload: { query, apiKey, pageSize?, index?, requestId }
 */
messagingService.on('curseforge-search-mods', async (payload: any, sender: any) => {
  const { query, apiKey = '', pageSize = 20, index = 0, sortField = 2, categoryId, requestId } = payload || {};

  if (!apiKey) {
    messagingService.sendToOriginator('curseforge-search-mods', {
      success: false,
      error: 'No CurseForge API key configured. This build may not have been packaged with the required key.',
      requestId,
    }, sender);
    return;
  }

  try {
    const encoded = encodeURIComponent(query || '');
    let urlPath =
      `/v1/mods/search?gameId=${ARK_GAME_ID}&searchFilter=${encoded}` +
      `&pageSize=${pageSize}&index=${index}&sortField=${sortField}&sortOrder=desc`;
    if (categoryId) {
      urlPath += `&categoryId=${categoryId}`;
    }

    const json = await cfGet(apiKey, urlPath);
    const mods = (json.data || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      summary: m.summary,
      downloadCount: m.downloadCount,
      thumbUrl: m.logo?.thumbnailUrl || '',
      screenshotUrl: (m.screenshots || [])[0]?.thumbnailUrl || m.logo?.thumbnailUrl || '',
      websiteUrl: m.links?.websiteUrl || '',
      authors: (m.authors || []).map((a: any) => a.name).join(', '),
      categories: (m.categories || []).map((c: any) => c.name).slice(0, 3),
      dateUpdated: m.dateModified || m.dateReleased || '',
      latestFiles: (m.latestFiles || []).slice(0, 1).map((f: any) => ({
        id: f.id,
        displayName: f.displayName,
        modId: String(f.modId || m.id),
      })),
    }));
    messagingService.sendToOriginator('curseforge-search-mods', {
      success: true,
      mods,
      pagination: json.pagination,
      requestId,
    }, sender);
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[curseforge-handler] search error:', errorMsg);
    messagingService.sendToOriginator('curseforge-search-mods', {
      success: false,
      error: errorMsg,
      requestId,
    }, sender);
  }
});

/**
 * Get a single mod's details (including ID for ActiveMods).
 * Payload: { modId, apiKey, requestId }
 */
/**
 * Open a URL in the OS default browser.
 * Payload: { url? } — falls back to the CurseForge ARK:SA page.
 */
messagingService.on('curseforge-open-website', async (payload: any, sender: any) => {
  const url = payload?.url || CURSEFORGE_ARK_URL;
  try {
    await shell.openExternal(url);
    messagingService.sendToOriginator('curseforge-open-website', { success: true }, sender);
  } catch (err) {
    messagingService.sendToOriginator('curseforge-open-website', {
      success: false, error: (err as Error).message,
    }, sender);
  }
});

messagingService.on('curseforge-get-mod', async (payload: any, sender: any) => {
  const { modId, apiKey, requestId } = payload || {};

  if (!apiKey) {
    messagingService.sendToOriginator('curseforge-get-mod', {
      success: false, error: 'CurseForge API key not configured.', requestId,
    }, sender);
    return;
  }

  try {
    const json = await cfGet(apiKey, `/v1/mods/${modId}`);
    const m = json.data;
    messagingService.sendToOriginator('curseforge-get-mod', {
      success: true,
      mod: {
        id: m.id,
        name: m.name,
        summary: m.summary,
        downloadCount: m.downloadCount,
        thumbUrl: m.logo?.thumbnailUrl || '',
        screenshotUrl: (m.screenshots || [])[0]?.thumbnailUrl || m.logo?.thumbnailUrl || '',
        websiteUrl: m.links?.websiteUrl || '',
        authors: (m.authors || []).map((a: any) => a.name).join(', '),
        categories: (m.categories || []).map((c: any) => c.name).slice(0, 3),
        dateUpdated: m.dateModified || m.dateReleased || '',
      },
      requestId,
    }, sender);
  } catch (error) {
    const errorMsg = (error as Error).message;
    messagingService.sendToOriginator('curseforge-get-mod', {
      success: false, error: errorMsg, requestId,
    }, sender);
  }
});
