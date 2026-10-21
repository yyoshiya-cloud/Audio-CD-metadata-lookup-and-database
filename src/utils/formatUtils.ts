import { getCachedApiCredentials } from '../lib/credentialsCache';
/**
 * Format, validation & shared helper utilities for CD Metadata fields
 */
import {
  validateDateInput,
  validateTrackDuration,
  isLeapYear,
  getMaxDaysInMonth,
  checkCalendarYMD,
} from '../lib/dateUtils';

export {
  validateDateInput,
  validateTrackDuration,
  isLeapYear,
  getMaxDaysInMonth,
  checkCalendarYMD,
};

/**
 * Convert full-width alphanumeric & symbols to half-width
 */
export const zenkakuToHankaku = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[ー—―－−–]/g, '-')
    .replace(/／/g, '/')
    .replace(/：/g, ':')
    .replace(/　/g, ' ')
    .trim();
};

/**
 * Convert full-width ASCII range (！-～) and quotes/tilde to half-width ASCII
 */
export const toHalfWidthAscii = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/”/g, '"')
    .replace(/’/g, "'")
    .replace(/〜|～/g, '~');
};

/**
 * Filter string strictly to half-width ASCII characters (A-Z, a-z, 0-9, -, /, :, .)
 */
export const toHankakuCode = (str: string): string => {
  const converted = zenkakuToHankaku(str);
  return converted.replace(/[^\x20-\x7E]/g, '');
};

/**
 * Auto-convert various valid date representations into YYYY-MM-DD (or YYYY-MM / YYYY) format.
 * Rejects impossible months (>12) and impossible days (e.g. non-leap Feb 29, Apr 31, >31) by returning ''.
 */
export const formatToYYYYMMDD = (str: string): string => {
  if (!str) return '';
  const res = validateDateInput(str);
  return res.valid ? res.normalized : '';
};

/**
 * Format track duration input while typing to half-width characters (digits, colons)
 */
export const formatToHankakuDuration = (str: string): string => {
  if (!str) return '';
  const converted = zenkakuToHankaku(str);
  return converted.replace(/[^0-9:sS分秒]/g, '');
};

/**
 * Normalize and validate track duration into MM:SS.
 * Rejects impossible minutes (> 60) and impossible seconds (>= 60) by returning ''.
 */
export const formatTrackDuration = (val: string): string => {
  if (!val) return '';
  const res = validateTrackDuration(val);
  return res.valid ? res.normalized : '';
};

export interface VinylLookupInputItem {
  id: string;
  title: string;
  artist: string;
  catalogNumber?: string;
  releaseDate?: string;
}

export interface VinylLookupServerResult {
  id: string;
  found: boolean;
  vinylRecordReleaseDate?: string;
  vinylRecordFormat?: string;
  vinylRecordCatalogNumber?: string;
  candidates?: {
    releaseDate: string;
    format: string;
    catalogNumber?: string;
    label?: string;
    source: string;
  }[];
}

/**
 * Shared helper for looking up same-title LP/EP vinyl release dates in batches via /api/lookup-vinyl-release
 */
export async function lookupVinylReleasesBatch(
  items: VinylLookupInputItem[],
  onProgress?: (current: number, total: number) => void
): Promise<VinylLookupServerResult[]> {
  if (!items || items.length === 0) return [];

  // APIキーは暗号化して保存しており、起動時に復号したものをメモリ上のキャッシュから使う
  const discogsToken = getCachedApiCredentials().discogsToken || '';

  const allResults: VinylLookupServerResult[] = [];
  const CHUNK_SIZE = 5;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const res = await fetch('/api/lookup-vinyl-release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: chunk,
        discogsToken,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results)) {
        allResults.push(...data.results);
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + chunk.length, items.length), items.length);
    }
  }

  return allResults;
}

