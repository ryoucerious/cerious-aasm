import { messagingService } from '../services/messaging.service';
import * as https from 'https';

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
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Failed to parse CurseForge response'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Search for mods on CurseForge.
 * Payload: { query, apiKey, pageSize?, index?, requestId }
 */
messagingService.on('curseforge-search-mods', async (payload: any, sender: any) => {
  const { query, apiKey, pageSize = 20, index = 0, requestId } = payload || {};

  if (!apiKey) {
    messagingService.sendToOriginator('curseforge-search-mods', {
      success: false,
      error: 'CurseForge API key is not configured. Add it in Settings.',
      requestId,
    }, sender);
    return;
  }

  try {
    const encoded = encodeURIComponent(query || '');
    const urlPath =
      `/v1/mods/search?gameId=${ARK_GAME_ID}&searchFilter=${encoded}` +
      `&pageSize=${pageSize}&index=${index}&sortField=2&sortOrder=desc`;

    const json = await cfGet(apiKey, urlPath);
    const mods = (json.data || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      summary: m.summary,
      downloadCount: m.downloadCount,
      thumbUrl: m.logo?.thumbnailUrl || '',
      websiteUrl: m.links?.websiteUrl || '',
      authors: (m.authors || []).map((a: any) => a.name).join(', '),
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
        websiteUrl: m.links?.websiteUrl || '',
        authors: (m.authors || []).map((a: any) => a.name).join(', '),
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
