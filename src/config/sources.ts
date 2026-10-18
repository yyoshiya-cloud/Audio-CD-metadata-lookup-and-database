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

/** 画面表示用の API 名（有効なものだけ） */
const SOURCE_LABELS: Partial<Record<APISource, string>> = {
  musicbrainz: 'MusicBrainz',
  discogs: 'Discogs',
  itunes: 'iTunes',
  ndl: 'NDL',
  spotify: 'Spotify',
  rakuten: '楽天ブックス',
};

/** 例: "MusicBrainz · Discogs · iTunes · NDL" */
export const enabledSourcesLabel = (separator = ' · '): string =>
  ENABLED_SOURCES.map((s) => SOURCE_LABELS[s] ?? s).join(separator);
