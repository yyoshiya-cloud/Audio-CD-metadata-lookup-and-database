import { isValidReading, normalizeReading } from '../src/lib/readingSort.js';

export interface ReadingRequestItem {
  id: string;
  title?: string;
  artist?: string;
}

export interface ReadingResult {
  id: string;
  titleReading?: string;
  artistReading?: string;
}

/**
 * AIの応答を検証して整える（純粋関数）。
 * - 依頼していないIDは捨てる
 * - 読みはひらがな等に整形し、漢字が混じるなど読みとして不適切なものは捨てる（AIが読みの代わりに漢字を返す、など）
 * - 依頼していない項目（タイトルだけ頼んだのに歌手名の読み、など）は採用しない
 */
export function sanitizeReadingResults(raw: unknown, requested: ReadingRequestItem[]): ReadingResult[] {
  const byId = new Map(requested.map((r) => [r.id, r]));
  const list = (raw as { results?: unknown })?.results;
  if (!Array.isArray(list)) return [];
  const out: ReadingResult[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const e = entry as { id?: unknown; titleReading?: unknown; artistReading?: unknown };
    const id = typeof e?.id === 'string' ? e.id : '';
    const req = byId.get(id);
    if (!req || seen.has(id)) continue;
    const pick = (value: unknown, wanted?: string): string | undefined => {
      if (!wanted || typeof value !== 'string') return undefined;
      const r = normalizeReading(value);
      return isValidReading(r) ? r : undefined;
    };
    const titleReading = pick(e.titleReading, req.title);
    const artistReading = pick(e.artistReading, req.artist);
    if (titleReading || artistReading) {
      seen.add(id);
      out.push({ id, titleReading, artistReading });
    }
  }
  return out;
}
