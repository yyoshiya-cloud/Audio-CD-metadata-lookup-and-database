import type { CDMetadata } from '../types/cd';

/**
 * 読み仮名と五十音順の並べ替え（純粋関数）。
 * 漢字・英字のタイトルでも五十音順に並べられるよう、CDごとに「読み」を持てる（titleReading / artistReading）。
 * 読みが無いときは、タイトル・歌手名そのもので並べる（かな・カナは、ひらがなに揃えて比較する）。
 */

/** カタカナをひらがなに変換する（ヴ→ゔ、長音「ー」はそのまま） */
export function katakanaToHiragana(s: string): string {
  return s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 保存用に読みを整える: 全角英数→半角、カタカナ→ひらがな、前後の空白を除去、連続する空白を1つに */
export function normalizeReading(input?: string | null): string {
  return katakanaToHiragana((input ?? '').normalize('NFKC').trim().replace(/\s+/g, ' '));
}

/**
 * 読みとして妥当か。ひらがな・長音・英数字・空白・一部の記号だけで、漢字・カタカナ以外の文字を含まないこと。
 * （AIが読みの代わりに漢字をそのまま返したときなどを弾く）
 */
export function isValidReading(reading: string): boolean {
  const r = normalizeReading(reading);
  return r !== '' && /^[\u3041-\u3096\u30fc\u309d\u309e0-9a-z\s・&'!?.,\-]+$/i.test(r) && /[\u3041-\u3096a-z0-9]/i.test(r);
}

/**
 * 並べ替え用のキー。読みがあれば読みを、なければ元の文字列を使う。
 * 小文字化・全角半角の統一・かなの統一をし、記号と空白、先頭の英語の冠詞（The / A / An）を除く。
 */
export function normalizeSortKey(text?: string | null): string {
  const base = katakanaToHiragana((text ?? '').normalize('NFKC').toLowerCase().trim());
  const key = base.replace(/^(?:the|an?)\s+/, '').replace(/[\p{P}\p{S}\s]/gu, '');
  return key || base; // 記号だけの名前（"♪" など）は、そのまま比較する
}

export const sortKeyForTitle = (cd: Pick<CDMetadata, 'title' | 'titleReading'>): string =>
  normalizeSortKey(cd.titleReading || cd.title);

export const sortKeyForArtist = (cd: Pick<CDMetadata, 'artist' | 'artistReading'>): string =>
  normalizeSortKey(cd.artistReading || cd.artist);

// 日本語の照合順序（五十音順）。濁点・半濁点・大文字小文字の違いは同順位として扱う
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

export const compareSortKeys = (a: string, b: string): number => collator.compare(a, b);

const KANA_ROWS: [string, string][] = [
  ['あ', 'ぁあぃいぅうぇえぉおゔ'],
  ['か', 'かきくけこゕゖ'],
  ['さ', 'さしすせそ'],
  ['た', 'たちつってとっ'],
  ['な', 'なにぬねの'],
  ['は', 'はひふへほ'],
  ['ま', 'まみむめも'],
  ['や', 'ゃやゅゆょよ'],
  ['ら', 'らりるれろ'],
  ['わ', 'ゎわゐゑをん'],
];

/** 見出し（あ・か・さ… / A〜Z / 0-9 / その他）。インデックス表示や区切り用 */
export function groupHeading(sortKey: string): string {
  const first = sortKey.normalize('NFD').replace(/[\u3099\u309a]/g, '').charAt(0);
  if (!first) return 'その他';
  for (const [heading, chars] of KANA_ROWS) if (chars.includes(first)) return heading;
  if (/[a-z]/i.test(first)) return first.toUpperCase();
  if (/[0-9]/.test(first)) return '0-9';
  return 'その他';
}

/** 漢字を含むか（読みが無いと五十音順に並べられない）。かなだけ・英字だけの名前は、読みなしで並べられる */
export const needsReading = (text?: string | null): boolean => /[\u3400-\u9fff々〆ヶ]/.test(text ?? '');

export interface ReadingTarget {
  id: string;
  /** 読みを付けたいタイトル（不要なら undefined） */
  title?: string;
  /** 読みを付けたい歌手名（不要なら undefined） */
  artist?: string;
}

/** 読みが未登録のCD。アルバムタイトル・歌手名ともに読みが既に登録されている場合はスキップする。ids を渡すとその中だけを対象にする */
export function listMissingReadings(
  cds: Pick<CDMetadata, 'id' | 'title' | 'artist' | 'titleReading' | 'artistReading'>[],
  ids?: string[]
): ReadingTarget[] {
  const only = ids && ids.length > 0 ? new Set(ids) : null;
  const targets: ReadingTarget[] = [];
  for (const cd of cds) {
    if (only && !only.has(cd.id)) continue;
    const hasTitleReading = !!cd.titleReading && cd.titleReading.trim().length > 0;
    const hasArtistReading = !!cd.artistReading && cd.artistReading.trim().length > 0;
    // 既にアルバムタイトル・歌手名の読み仮名が両方登録されている場合は処理をスキップ
    if (hasTitleReading && hasArtistReading) continue;

    const title = !hasTitleReading && (needsReading(cd.title) || !!cd.title) ? cd.title : undefined;
    const artist = !hasArtistReading && (needsReading(cd.artist) || !!cd.artist) ? cd.artist : undefined;
    if (title || artist) targets.push({ id: cd.id, title, artist });
  }
  return targets;
}
