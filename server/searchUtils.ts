/**
 * 検索・突合用の純粋関数群（外部依存なし）。
 * - 入力の正規化（NFKC / 全角→半角 / ハイフン揺れ）
 * - 型番・バーコードの比較キー生成
 * - タイトル・アーティストの類似度計算
 * - Lucene / CQL のエスケープ
 */

export const PLACEHOLDER_TITLE = 'Unknown Title';
export const PLACEHOLDER_ARTIST = 'Unknown Artist';

export function nfkc(s?: string | null): string {
  return (s ?? '').normalize('NFKC');
}

/** 各種ダッシュ・長音記号を ASCII ハイフンに統一する（型番専用） */
function unifyDashes(s: string): string {
  return s.replace(/[‐‑‒–—―−ーｰ─━－]/g, '-');
}

// ---------------------------------------------------------------------------
// 型番 (規格品番)
// ---------------------------------------------------------------------------

/** 英数字のみの大文字キー。例: "ＳＲＣＬ－１２３４" → "SRCL1234" */
export function normalizeCatNo(str?: string | null): string {
  return nfkc(unifyDashes(nfkc(str))).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * 複数枚組表記 ("WPCL-10001/2", "ESCL-5000~1", "A-1, A-2") の先頭要素だけを
 * 比較キーにする。
 */
export function catnoBase(str?: string | null): string {
  const first = nfkc(str).split(/[\/~〜～,、;；]/)[0] ?? '';
  return normalizeCatNo(first);
}

/** 型番が互換か。どちらかが空なら「不明」なので true */
export function catnoCompatible(a?: string | null, b?: string | null): boolean {
  const x = catnoBase(a);
  const y = catnoBase(b);
  if (!x || !y) return true;
  return x === y;
}

/**
 * 上流APIに投げる型番表記のバリエーション（元表記・ハイフン付き・ハイフンなし）。
 * 例: "SRCL1234" → ["SRCL1234", "SRCL-1234"]
 */
export function catnoVariants(str?: string | null): string[] {
  const original = unifyDashes(nfkc(str)).trim().replace(/\s+/g, ' ');
  const base = catnoBase(str);
  const out: string[] = [];
  const push = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  push(original);
  const m = base.match(/^([A-Z][A-Z0-9]*?[A-Z])(\d{2,})$/);
  if (m) {
    push(`${m[1]}-${m[2]}`);
  }
  push(base);
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// バーコード (JAN / EAN / UPC)
// ---------------------------------------------------------------------------

/** 数字のみ（全角数字も対応） */
export function digitsOnly(str?: string | null): string {
  return nfkc(str).replace(/\D/g, '');
}

/** JAN/EAN/UPC として妥当な桁数 (8 / 12 / 13 / 14) か */
export function isValidBarcodeLength(digits: string): boolean {
  return [8, 12, 13, 14].includes(digits.length);
}

/**
 * 比較用キー。UPC-12 と EAN-13 の先頭ゼロ差を吸収するため、先頭ゼロを除去する。
 * 桁数が不正な場合は空文字（＝バーコードなし扱い）。
 */
export function barcodeKey(str?: string | null): string {
  const d = digitsOnly(str);
  if (!isValidBarcodeLength(d)) return '';
  return d.replace(/^0+/, '');
}

// ---------------------------------------------------------------------------
// テキスト正規化・類似度
// ---------------------------------------------------------------------------

/** カタカナ → ひらがな（比較用） */
function foldKana(s: string): string {
  return s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const EDITION_TAGS =
  '(?:remaster(?:ed)?|re-?master|edition|version|ver\\.?|bonus|deluxe|盤|mix|live|expanded|anniversary|reissue|限定|初回|通常|特典|デラックス|リマスター|紙ジャケ|shm-?cd|blu-?spec|hqcd|uhqcd|sacd|mono|stereo)';

/**
 * タイトル比較用キー。
 * NFKC → 小文字 → 配信サービス接尾辞 (" - Single" / " - EP") 除去 → 版情報の括弧除去
 * → 記号・空白除去 → カタカナをひらがなに統一。
 */
export function cleanTitleForMatching(str?: string | null): string {
  if (!str) return '';
  let s = nfkc(str).toLowerCase().trim();
  s = s.replace(/\s*[-–—]\s*(?:single|ep|e\.p\.|シングル)\s*$/i, '');

  const stripped = s
    .replace(new RegExp(`\\([^)]*${EDITION_TAGS}[^)]*\\)`, 'gi'), '')
    .replace(new RegExp(`\\[[^\\]]*${EDITION_TAGS}[^\\]]*\\]`, 'gi'), '')
    .replace(new RegExp(`【[^】]*${EDITION_TAGS}[^】]*】`, 'gi'), '');

  const compact = (t: string) => foldKana(t.replace(/[\p{P}\p{S}\s]/gu, ''));
  const result = compact(stripped);
  // 記号だけのタイトル（例: "♪"）で空になる場合は、記号を残したまま比較する
  return result || foldKana(s.replace(/\s/g, ''));
}

const VARIOUS_ARTIST_RE = /^(?:various(?:\s+artists?)?|v\.?\s?a\.?|オムニバス|ヴァリアス.*|さまざまなアーティスト|various artist)$/i;

export function isVariousArtists(str?: string | null): boolean {
  const s = nfkc(str).trim();
  return Boolean(s) && VARIOUS_ARTIST_RE.test(s);
}

function compactArtist(s: string): string {
  return foldKana(
    nfkc(s)
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[\p{P}\p{S}\s]/gu, '')
  );
}

/**
 * アーティスト比較用キーの一覧。
 * 全体 + "A, B" / "A & B" / "A feat. B" / "A／B" を分割した各要素。
 */
export function artistKeys(str?: string | null): string[] {
  if (!str) return [];
  const s = nfkc(str);
  const keys = new Set<string>();
  const full = compactArtist(s);
  if (full) keys.add(full);
  s.split(/\s*(?:,|、|&|＆|\/|／|×|\bfeat\.?\b|\bfeaturing\b)\s*/i).forEach((p) => {
    const k = compactArtist(p);
    // 1文字だけの断片は誤一致の原因になるため、全体キー以外では採用しない
    if (k.length >= 2) keys.add(k);
  });
  return Array.from(keys);
}

/** 文字バイグラムの Dice 係数 (0..1)。日本語でも形態素解析なしで使える。 */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) {
    const o = gb.get(g);
    if (o) inter += Math.min(n, o);
  }
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** 比較用キー同士の類似度。包含は「短い方が十分長く、長さ比が高い」場合のみ高評価。 */
function keySimilarity(x: string, y: string, minContainLen: number): number {
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= minContainLen && l.includes(s)) {
    return Math.min(0.95, 0.6 + 0.4 * (s.length / l.length));
  }
  return diceSimilarity(x, y);
}

export function titleSimilarity(a?: string | null, b?: string | null): number {
  return keySimilarity(cleanTitleForMatching(a), cleanTitleForMatching(b), 4);
}

export function artistSimilarity(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  if (isVariousArtists(a) || isVariousArtists(b)) return 0.7; // 不明扱い（弱い一致）
  const ka = artistKeys(a);
  const kb = artistKeys(b);
  let best = 0;
  for (const x of ka) {
    for (const y of kb) {
      // 1〜2文字の名前（例: 嵐）は包含判定を使わず完全一致のみ
      best = Math.max(best, keySimilarity(x, y, 3));
      if (best === 1) return 1;
    }
  }
  return best;
}

export function isPlaceholder(s?: string | null): boolean {
  return !s || s === PLACEHOLDER_TITLE || s === PLACEHOLDER_ARTIST;
}

export function isJapanese(str?: string | null): boolean {
  if (!str) return false;
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str);
}

// ---------------------------------------------------------------------------
// 上流APIクエリ用エスケープ
// ---------------------------------------------------------------------------

/** Lucene のフレーズ検索用に " と \ をエスケープして引用符で囲む */
export function luceneQuote(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&')}"`;
}

/** NDL SRU (CQL) の文字列リテラル用エスケープ */
export function cqlQuote(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&')}"`;
}

/** Spotify の field フィルタ用: 引用符を除去して囲む */
export function spotifyQuote(s: string): string {
  return `"${s.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

/** XMLの文字参照をデコード */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// 検索クエリの正規化
// ---------------------------------------------------------------------------

export interface NormalizableQuery {
  catalogNumber?: string;
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
  sources?: string[];
}

const MAX_FIELD_LENGTH = 200;

function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return nfkc(v).replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_LENGTH);
}

/**
 * 検索条件を正規化する。
 * - 文字列以外は破棄、長さ制限
 * - NFKC（全角英数→半角、全角スペース→半角）
 * - 型番: ダッシュ統一 + 大文字化 / バーコード: 数字のみ
 */
export function normalizeSearchQuery<T extends NormalizableQuery>(q: T): T & {
  catalogNumber: string;
  catno: string;
  barcode: string;
} {
  const rawCat = cleanText(q.catalogNumber || q.catno);
  const catalogNumber = unifyDashes(rawCat).toUpperCase();
  const barcode = digitsOnly(typeof q.barcode === 'string' ? q.barcode : '').slice(0, 14);
  return {
    ...q,
    catalogNumber,
    catno: catalogNumber,
    title: cleanText(q.title),
    artist: cleanText(q.artist),
    trackTitle: cleanText(q.trackTitle),
    freeText: cleanText(q.freeText),
    barcode,
  };
}
