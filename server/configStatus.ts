import { isConfiguredValue } from './discogsAuth.js';

import type { ConfigStatus } from '../src/types/config.js';

export function getConfigStatus(env: Record<string, string | undefined> = process.env): ConfigStatus {
  return {
    discogs: isConfiguredValue(env.DISCOGS_TOKEN),
    spotify: isConfiguredValue(env.SPOTIFY_CLIENT_ID) && isConfiguredValue(env.SPOTIFY_CLIENT_SECRET),
    rakuten: isConfiguredValue(env.RAKUTEN_APP_ID),
    gemini: isConfiguredValue(env.GEMINI_API_KEY),
    // MB_CONTACT（連絡先）。APP_URL は User-Agent の代替にはなるが、明示的な連絡先ではないため含めない
    musicbrainzContact: isConfiguredValue(env.MB_CONTACT),
  };
}
