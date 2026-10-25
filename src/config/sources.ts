import type { APISource } from '../types/cd';

/**
 * 検索で有効にする API ソース（サーバー・画面の両方がこの一覧を参照する）。
 *
 * 現在は Spotify と 楽天ブックス CD検索 を無効化している。
 * 実装コード（server/spotify.ts, server/rakuten.ts, 設定画面の入力欄など）は残してあるので、
 * 再び使うときは下の配列に 'spotify' / 'rakuten' を追加するだけでよい。
 *   例: ['musicbrainz', 'discogs', 'itunes', 'ndl', 'spotify', 'rakuten']
 */
export const ENABLED_SOURCES: APISource[] = ['musicbrainz', 'discogs', 'itunes', 'ndl'];

export const isSourceEnabled = (source: APISource): boolean => ENABLED_SOURCES.includes(source);

/**
 * API名の表示ラベル（画面ごとに別々に定義していたものを一元化）。
 *  - compact: ヘッダーなど最も短い表記   - short: 検索対象の選択ボタン   - full: 結果の見出し・詳細画面
 * 注意: Excel / CSV の「取得元」列の値は、読み込み時の突き合わせに使うデータ形式なので tabularFormat.ts で別に管理する。
 */
export interface SourceLabelSet {
  compact: string;
  short: string;
  full: string;
}

export const SOURCE_LABELS: Record<APISource, SourceLabelSet> = {
  musicbrainz: { compact: 'MusicBrainz', short: 'MusicBrainz', full: 'MusicBrainz' },
  discogs: { compact: 'Discogs', short: 'Discogs', full: 'Discogs' },
  itunes: { compact: 'iTunes', short: 'iTunes', full: 'iTunes Search' },
  ndl: { compact: 'NDL', short: '国会図書館', full: '国立国会図書館 (NDL)' },
  spotify: { compact: 'Spotify', short: 'Spotify', full: 'Spotify API' },
  rakuten: { compact: '楽天ブックス', short: '楽天ブックス', full: '楽天ブックス CD' },
  vgmdb: { compact: 'VGMdb', short: 'VGMdb', full: 'VGMdb' },
  yahoo: { compact: 'Yahoo!', short: 'Yahoo!', full: 'Yahoo! ショッピング' },
  gemini: { compact: 'AI OCR', short: 'AI OCR', full: 'AI OCR (Gemini)' },
};

const labelsOf = (tier: keyof SourceLabelSet): Record<APISource, string> =>
  Object.fromEntries(Object.entries(SOURCE_LABELS).map(([k, v]) => [k, v[tier]])) as Record<APISource, string>;

export const SOURCE_COMPACT_LABELS = labelsOf('compact');
export const SOURCE_SHORT_LABELS = labelsOf('short');
export const SOURCE_FULL_LABELS = labelsOf('full');

/** 例: "MusicBrainz · Discogs · iTunes · NDL" */
export const enabledSourcesLabel = (separator = ' · '): string =>
  ENABLED_SOURCES.map((s) => SOURCE_COMPACT_LABELS[s]).join(separator);
