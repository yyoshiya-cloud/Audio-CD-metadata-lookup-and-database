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

export type TagEvidenceItem = AITagEvidenceItem;

export interface AITagAnalysisMetadata {
  genre?: string;
  subGenre?: string;
  mood?: string;
  era?: string;
  reasoning?: string;
  tagEvidence?: AITagEvidenceItem[];
  ruleAdjustments?: string[];
  analyzedAt?: string;
}

export type SubImageType = 'back' | 'obi' | 'disc' | 'booklet' | 'other';

export interface CDSubImage {
  id: string;
  type: SubImageType;
  label: string;
  imageUrl: string; // Base64 or URL
}

export interface CustomSetlistItem {
  id: string; // unique item id in the setlist
  cdId: string;
  cdTitle: string;
  cdArtist: string;
  catalogNumber?: string;
  coverUrl?: string;
  trackNumber: number;
  trackTitle: string;
  duration?: string;
}

export interface CustomSetlist {
  id: string;
  name: string;
  description?: string;
  targetMinutes?: number; // e.g., 46, 60, 74, 80, 90 (Cassette / MD / CD-R capacity)
  items: CustomSetlistItem[];
  createdAt: string;
  updatedAt: string;
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
  subImages?: CDSubImage[]; // Additional images: Back cover (裏ジャケ), Obi (帯), Disc (盤面), Booklet (歌詞カード)
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
  key:
    | keyof CDMetadata
    | 'trackListText'
    | 'index'
    | 'backCoverUrl'
    | 'obiUrl'
    | 'discUrl'
    | 'bookletUrl'
    | 'otherSubImagesUrl';
  label: string;
  enabled: boolean;
}
