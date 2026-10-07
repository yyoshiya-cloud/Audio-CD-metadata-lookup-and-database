export type APISource = 'musicbrainz' | 'discogs' | 'itunes' | 'ndl' | 'spotify' | 'rakuten' | 'vgmdb' | 'yahoo' | 'gemini';

export interface TrackInfo {
  trackNumber: number;
  title: string;
  artist?: string;
  duration?: string; // e.g. "03:45" or "225s"
  previewUrl?: string; // audio sample if available from iTunes
}

export interface AITagEvidenceItem {
  tag: string;
  category: 'genre' | 'mood' | 'era' | 'style';
  evidence: string;
  sourceFields: string[];
}

export interface AITagAnalysisMetadata {
  genre?: string;
  subGenre?: string;
  mood?: string;
  era?: string;
  reasoning?: string;
  tagEvidence?: AITagEvidenceItem[];
  analyzedAt?: string;
}

export interface CDMetadata {
  id: string; // unique ID or hash
  catalogNumber: string; // 型番 (e.g. SRCL-1234, VICL-60001)
  title: string; // CD/Album Title
  artist: string; // Singer / Artist / Composer
  label?: string; // Record Label / Publisher (e.g. Sony Music, Victor, Avex)
  releaseDate?: string; // YYYY-MM-DD or YYYY (CD release date)
  vinylRecordReleaseDate?: string; // YYYY-MM-DD or YYYY (Same-title LP / EP vinyl record release date)
  vinylRecordFormat?: string; // e.g. 'LP', 'EP', 'LP / EP', '12"', '7"'
  vinylRecordCatalogNumber?: string; // Original LP/EP catalog number if available
  barcode?: string; // JAN/EAN code (e.g. 4988001...)
  coverUrl?: string; // High-res artwork URL
  country?: string; // Release country (e.g. JP)
  format?: string; // e.g. CD, 2xCD, SACD, Limited Edition
  genre?: string; // Genre
  tracks: TrackInfo[]; // Track list
  source: APISource; // Primary metadata source
  sourceDetails?: {
    musicbrainzId?: string;
    discogsId?: string;
    itunesCollectionId?: number;
    ndlBibId?: string;
    spotifyId?: string;
    rakutenItemCode?: string;
    vgmdbId?: string;
    yahooItemId?: string;
  };
  rawSources?: Partial<Record<APISource, {
    title?: string;
    artist?: string;
    catalogNumber?: string;
    releaseDate?: string;
    label?: string;
    coverUrl?: string;
    trackCount?: number;
  }>>;
  confidenceScore?: number; // 0 - 100 match confidence
  tags?: string[];
  aiTagAnalysis?: AITagAnalysisMetadata; // Persisted basis/reasoning & evidence from AI auto-tagging
  notes?: string;
  verifiedByAI?: boolean;
  aiVerificationSummary?: string;
  isExactMatch?: boolean;
  exactMatchTypes?: ('catalogNumber' | 'title' | 'barcode')[];
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  syncedToSheets?: boolean;
}

export interface APICredentials {
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  discogsToken?: string;
  rakutenAppId?: string;
  musicbrainzEmail?: string;
  yahooAppId?: string;
}

export interface SearchQuery {
  catalogNumber?: string;
  title?: string;
  artist?: string;
  trackTitle?: string; // 曲名での検索
  barcode?: string;
  freeText?: string;
  sources?: APISource[];
  apiKeys?: APICredentials;
}

export interface SearchResultCandidate {
  cd: CDMetadata;
  sourcesMatched: APISource[];
  matchScore: number;
  isExactMatch?: boolean;
  exactMatchTypes?: ('catalogNumber' | 'title' | 'barcode')[];
  verifiedByAI?: boolean;
  aiVerificationSummary?: string;
}

export interface SearchResponse {
  candidates: SearchResultCandidate[];
  sourceResults: Partial<Record<APISource, {
    count: number;
    items: CDMetadata[];
    error?: string;
  }>>;
  searchedSources?: APISource[];
  searchTimeMs: number;
}

export interface SpreadsheetInfo {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: { sheetId: number; title: string }[];
  modifiedTime?: string;
  createdTime?: string;
}

export interface ExportColumnConfig {
  key: keyof CDMetadata | 'trackListText' | 'index';
  label: string;
  enabled: boolean;
}
