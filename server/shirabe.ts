import { createLogger } from '../src/lib/logger.js';
import {
  isValidReading,
  normalizeReading,
  katakanaToHiragana,
  needsReading,
} from '../src/lib/readingSort.js';
import type { ReadingRequestItem, ReadingResult } from './readingSanitizer.js';

const log = createLogger('shirabe', { timestamp: true });

const SHIRABE_BASE_URL = 'https://shirabe.dev';

interface ShirabeFuriganaToken {
  surface: string;
  reading: string;
}

interface ShirabeFuriganaResponse {
  text: string;
  tokens: ShirabeFuriganaToken[];
  error?: { code: string; message: string };
}

interface ShirabeNameReadingResponse {
  name: string;
  family?: string;
  given?: string;
  family_reading?: string;
  given_reading?: string;
  reading?: string;
  candidates?: string[];
  confidence?: number;
  warning?: string;
  matched_by?: string;
  error?: { code: string; message: string };
}

/** 共通のShirabe APIリクエストヘッダー（APIキーがあれば付与、無ければ無料枠として匿名アクセス） */
function getShirabeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'audio-cd-metadata-lookup/1.1.2 (https://github.com/aistudio)',
  };
  if (process.env.SHIRABE_API_KEY) {
    headers['X-API-Key'] = process.env.SHIRABE_API_KEY;
  }
  return headers;
}

/**
 * Shirabe 日本語テキスト処理 API (POST /api/v1/text/furigana) を利用して、
 * タイトルや文字列全体のふりがな（ひらがな）を取得する。
 */
export async function fetchShirabeFurigana(text: string): Promise<string | undefined> {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${SHIRABE_BASE_URL}/api/v1/text/furigana`, {
      method: 'POST',
      headers: getShirabeHeaders(),
      body: JSON.stringify({
        text: trimmed,
        options: { kana: 'hiragana' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      log.warn(`Shirabe furigana API returned ${res.status}:`, errBody);
      return undefined;
    }

    const data = (await res.json()) as ShirabeFuriganaResponse;
    if (!data.tokens || !Array.isArray(data.tokens) || data.tokens.length === 0) {
      return undefined;
    }

    // 各トークンの読みをひらがなに統一して連結する
    const rawReading = data.tokens
      .map((t) => katakanaToHiragana(t.reading || t.surface))
      .join('');

    const normalized = normalizeReading(rawReading);
    return isValidReading(normalized) ? normalized : undefined;
  } catch (err) {
    log.warn(`Shirabe furigana request failed for "${trimmed}":`, err);
    return undefined;
  }
}

/**
 * Shirabe 日本語テキスト処理 API (POST /api/v1/text/name-reading) を利用して、
 * 日本人名（姓・名）の読み推定を取得する。
 */
export async function fetchShirabeNameReading(name: string): Promise<string | undefined> {
  const trimmed = name.trim();
  if (!trimmed) return undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${SHIRABE_BASE_URL}/api/v1/text/name-reading`, {
      method: 'POST',
      headers: getShirabeHeaders(),
      body: JSON.stringify({
        name: trimmed,
        options: { kana: 'hiragana' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return undefined;
    }

    const data = (await res.json()) as ShirabeNameReadingResponse;
    // 信頼度が高く、推定読みがある場合
    if (data.reading && data.confidence && data.confidence >= 0.6) {
      const normalized = normalizeReading(data.reading);
      if (isValidReading(normalized)) {
        return normalized;
      }
    }
    return undefined;
  } catch (err) {
    log.warn(`Shirabe name-reading request failed for "${trimmed}":`, err);
    return undefined;
  }
}

/**
 * アルバムタイトルのよみがなを取得する（Shirabe furigana API）
 */
export async function getShirabeTitleReading(title?: string): Promise<string | undefined> {
  if (!title || !title.trim()) return undefined;
  return fetchShirabeFurigana(title);
}

/**
 * 歌手・アーティスト名のよみがなを取得する。
 * 日本人の個人名と思われる形式の場合は name-reading API をまず試し、
 * ユニット名や合致しない場合は furigana API で形態素分解して読みを取得する。
 */
export async function getShirabeArtistReading(artist?: string): Promise<string | undefined> {
  if (!artist || !artist.trim()) return undefined;
  const trimmed = artist.trim();

  // 典型的な日本人の姓名形式（漢字・かな 2〜6文字程度、英字や記号を含まない）なら name-reading を試す
  const isPersonNameCandidate = /^[\u3400-\u9fff\u3040-\u309f]{2,6}$/.test(trimmed);
  if (isPersonNameCandidate) {
    const nameReading = await fetchShirabeNameReading(trimmed);
    if (nameReading) {
      return nameReading;
    }
  }

  // それ以外（グループ名、英数混在、複合名、または name-reading で信頼度が低かった場合）は furigana API を利用
  return fetchShirabeFurigana(trimmed);
}

/**
 * 複数アイテムのタイトル・アーティストの読み仮名を Shirabe API で取得する。
 * 同時実行数を制御しながら順次リクエストする。
 */
export async function getShirabeReadingsForItems(
  items: ReadingRequestItem[],
  concurrency = 5
): Promise<ReadingResult[]> {
  if (!items || items.length === 0) return [];

  const results: ReadingResult[] = [];

  // 同時実行制御
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        let titleReading: string | undefined;
        let artistReading: string | undefined;

        if (item.title && item.title.trim()) {
          titleReading = await getShirabeTitleReading(item.title);
        }
        if (item.artist && item.artist.trim()) {
          artistReading = await getShirabeArtistReading(item.artist);
        }

        if (titleReading || artistReading) {
          return {
            id: item.id,
            titleReading,
            artistReading,
          };
        }
        return null;
      })
    );

    for (const r of chunkResults) {
      if (r) results.push(r);
    }
  }

  return results;
}
