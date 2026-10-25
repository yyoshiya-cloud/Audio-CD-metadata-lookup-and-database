/**
 * 外部APIの応答の型（実際に使う項目だけ）と、エラーの扱いの共通関数。
 * 以前は応答を any のまま扱っていたため、項目名の取り違えに気づきにくかった。
 */

// ---- Spotify ----
export interface SpotifyArtist {
  name: string;
}
export interface SpotifyAlbumItem {
  id: string;
  name?: string;
  artists?: SpotifyArtist[];
  release_date?: string;
  images?: { url: string; width?: number; height?: number }[];
}
export interface SpotifyTrackItem {
  name?: string;
  track_number?: number;
  duration_ms?: number;
  preview_url?: string | null;
  artists?: SpotifyArtist[];
  album?: SpotifyAlbumItem;
}
export interface SpotifySearchResponse {
  albums?: { items?: SpotifyAlbumItem[] };
  tracks?: { items?: SpotifyTrackItem[] };
}

// ---- MusicBrainz ----
export interface MusicBrainzArtistCredit {
  name?: string;
  joinphrase?: string;
  artist?: { name?: string };
}
export interface MusicBrainzLabelInfo {
  'catalog-number'?: string;
  label?: { name?: string };
}
export interface MusicBrainzRelease {
  id: string;
  title?: string;
  date?: string;
  country?: string;
  barcode?: string;
  'artist-credit'?: MusicBrainzArtistCredit[];
  'label-info'?: MusicBrainzLabelInfo[];
  media?: { format?: string }[];
}

export interface MusicBrainzRecording {
  title?: string;
  length?: number;
  'artist-credit'?: MusicBrainzArtistCredit[];
  releases?: MusicBrainzRelease[];
}
export interface MusicBrainzTrack {
  title?: string;
  length?: number;
  recording?: { title?: string; length?: number };
}
export interface MusicBrainzReleaseDetail {
  media?: { tracks?: MusicBrainzTrack[] }[];
  'cover-art-archive'?: { front?: boolean };
}

// ---- Discogs ----
export interface DiscogsSearchResult {
  id: number | string;
  title?: string;
  catno?: string;
  year?: number | string;
  label?: string[] | string;
  barcode?: string[] | string;
  country?: string;
  format?: string[] | string;
  cover_image?: string;
  thumb?: string;
}

// ---- iTunes ----
export interface ITunesResult {
  wrapperType?: string;
  collectionId?: number;
  collectionName?: string;
  collectionCensoredName?: string;
  collectionArtistName?: string;
  artistName?: string;
  trackName?: string;
  trackNumber?: number;
  trackTimeMillis?: number;
  previewUrl?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  copyright?: string;
  country?: string;
}

// ---- エラー ----
/** 例外から表示用のメッセージを取り出す（Error 以外が投げられても落ちない） */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** fetch のタイムアウト（AbortController による中断）か */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}
