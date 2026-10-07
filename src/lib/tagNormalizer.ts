import { CDMetadata, TagEvidenceItem } from '../types/cd';

/**
 * Canonical tag normalizer to eliminate duplicate/variant tags across the library.
 * Maps English/Romaji/variant tags (e.g., "J-Pop", "J-POP / 邦楽", "Aidol", "Anime", "CM-Song", "1980年代")
 * into unified Japanese standard tags.
 */
const DIRECT_TAG_MAP: Record<string, string> = {
  // J-POP variants
  'j-pop': 'J-POP',
  'jpop': 'J-POP',
  'j pop': 'J-POP',
  'j-pop / 邦楽': 'J-POP',
  'j-pop/邦楽': 'J-POP',
  '邦楽 / j-pop': 'J-POP',
  'japanese pop': 'J-POP',
  'ジャパニーズ・ポップ': 'J-POP',
  'ポップス': 'J-POP',
  'ポップ': 'J-POP',
  'pop': 'J-POP',
  'pops': 'J-POP',

  // Idol variants
  'aidol': 'アイドル',
  'idol': 'アイドル',
  'idol pop': 'アイドル',
  'japanese idol': 'アイドル',
  'アイドル歌謡': 'アイドル',
  '女性アイドル': 'アイドル',
  '男性アイドル': 'アイドル',

  // Anime / Game variants
  'anime': 'アニソン',
  'anison': 'アニソン',
  'anime song': 'アニソン',
  'アニメ': 'アニソン',
  'アニメソング': 'アニソン',
  'アニメーション': 'アニソン',
  'game': 'ゲーム音楽',
  'game music': 'ゲーム音楽',
  'soundtrack': 'サウンドトラック',
  'ost': 'サウンドトラック',
  'サントラ': 'サウンドトラック',

  // CM / Tie-up variants
  'cm-song': 'CMソング',
  'cm song': 'CMソング',
  'cmsong': 'CMソング',
  'cm曲': 'CMソング',
  'cm': 'CMソング',

  // Folk / New Music / Kayokyoku / City Pop
  'new music': 'ニューミュージック',
  'ニュー・ミュージック': 'ニューミュージック',
  'folk': 'フォーク',
  'japanese folk': 'フォーク',
  'フォークソング': 'フォーク',
  'フォーク・ソング': 'フォーク',
  'city pop': 'シティポップ',
  'citypop': 'シティポップ',
  'シティ・ポップ': 'シティポップ',
  'kayokyoku': '昭和歌謡',
  '歌謡曲': '昭和歌謡',
  '昭和歌謡曲': '昭和歌謡',
  'enka': '演歌',

  // Singer-Songwriter
  'ssw': 'シンガーソングライター',
  'singer-songwriter': 'シンガーソングライター',
  'singer songwriter': 'シンガーソングライター',
  'シンガー・ソングライター': 'シンガーソングライター',

  // Rock / Other Genres
  'rock': 'ロック',
  'j-rock': 'ロック',
  'ロック・バンド': 'ロック',
  'hard rock': 'ハードロック',
  'metal': 'ハードロック',
  'heavy metal': 'ハードロック',
  'punk': 'パンク',
  'punk rock': 'パンク',
  'jazz': 'ジャズ',
  'fusion': 'フュージョン',
  'classical': 'クラシック',
  'classic': 'クラシック',
  'r&b': 'R&B',
  'rnb': 'R&B',
  'soul': 'R&B',
  'hip-hop': 'ヒップホップ',
  'hip hop': 'ヒップホップ',
  'rap': 'ヒップホップ',
  'electronic': 'エレクトロニック',
  'techno': 'テクノポップ',
  'techno pop': 'テクノポップ',
  'synth-pop': 'テクノポップ',
  'synthpop': 'テクノポップ',
  'aor': 'AOR',
  'ballad': 'バラード',
  'バラード集': 'バラード',
  'acoustic': 'アコースティック',
  'best': 'ベスト盤',
  'best album': 'ベスト盤',
  'ベスト': 'ベスト盤',
  'ベスト・アルバム': 'ベスト盤',
  'ベストアルバム': 'ベスト盤',
  'live': 'ライブ盤',
  'live album': 'ライブ盤',
  'ライブ': 'ライブ盤',
  'ライブ・アルバム': 'ライブ盤',
  'ライブアルバム': 'ライブ盤',
  'comedy': 'お笑い・バラエティ',
  'お笑い': 'お笑い・バラエティ',
  'バラエティ': 'お笑い・バラエティ',
};

/**
 * Normalize a single tag or genre string to its canonical Japanese representation.
 */
export function normalizeSingleTag(rawTag?: string): string {
  if (!rawTag) return '';
  let t = String(rawTag).trim().replace(/^#+/, '').trim();
  if (!t) return '';

  // Normalize full-width alphanumeric to half-width
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));

  // Normalize decades: "1980年代" -> "80年代", "80s" -> "80年代", "1990s" -> "90年代"
  const decade19xx = t.match(/^19([56789]0)年代$/);
  if (decade19xx) return `${decade19xx[1]}年代`;

  const decadeEn = t.match(/^(?:19)?([56789]0)'?s$/i);
  if (decadeEn) return `${decadeEn[1]}年代`;

  const decade20xxEn = t.match(/^(20[012]0)'?s$/i);
  if (decade20xxEn) return `${decade20xxEn[1]}年代`;

  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  if (DIRECT_TAG_MAP[lower]) {
    return DIRECT_TAG_MAP[lower];
  }

  return t;
}

/**
 * Normalize and deduplicate an array of tags, expanding compound slash tags like "J-POP / 邦楽".
 */
export function normalizeTagList(tags?: string[]): string[] {
  if (!tags || !Array.isArray(tags)) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');

    // First check if the whole string is in DIRECT_TAG_MAP (e.g. "j-pop / 邦楽")
    if (DIRECT_TAG_MAP[lower]) {
      // For "J-POP / 邦楽", include both canonical "J-POP" and "邦楽" cleanly, or canonical mapped tag
      if (lower.includes('j-pop') && lower.includes('邦楽')) {
        for (const sub of ['J-POP', '邦楽']) {
          if (!seen.has(sub)) {
            seen.add(sub);
            result.push(sub);
          }
        }
        continue;
      }
      const mapped = DIRECT_TAG_MAP[lower];
      if (mapped && !seen.has(mapped)) {
        seen.add(mapped);
        result.push(mapped);
      }
      continue;
    }

    // Split compound tags separated by " / " or "・" when they combine distinct genres
    if (trimmed.includes(' / ') || trimmed.includes('／')) {
      const parts = trimmed.split(/\s*[/／]\s*/);
      for (const part of parts) {
        const norm = normalizeSingleTag(part);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          result.push(norm);
        }
      }
      continue;
    }

    const norm = normalizeSingleTag(trimmed);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }

  return result;
}

/**
 * Normalize a CD's genre, tags, and aiTagAnalysis evidence so all tags are unified.
 */
export function normalizeCDTagsAndGenre(cd: CDMetadata): CDMetadata {
  const normalizedGenre = cd.genre ? normalizeSingleTag(cd.genre) : cd.genre;
  const normalizedTags = cd.tags ? normalizeTagList(cd.tags) : cd.tags;

  let normalizedAiAnalysis = cd.aiTagAnalysis;
  if (cd.aiTagAnalysis) {
    const seenEvTags = new Set<string>();
    const normalizedEvidence: TagEvidenceItem[] = [];
    for (const ev of cd.aiTagAnalysis.tagEvidence || []) {
      const normTag = normalizeSingleTag(ev.tag);
      if (normTag && !seenEvTags.has(normTag)) {
        seenEvTags.add(normTag);
        normalizedEvidence.push({
          ...ev,
          tag: normTag,
        });
      }
    }
    normalizedAiAnalysis = {
      ...cd.aiTagAnalysis,
      genre: cd.aiTagAnalysis.genre ? normalizeSingleTag(cd.aiTagAnalysis.genre) : cd.aiTagAnalysis.genre,
      subGenre: cd.aiTagAnalysis.subGenre ? normalizeSingleTag(cd.aiTagAnalysis.subGenre) : cd.aiTagAnalysis.subGenre,
      era: cd.aiTagAnalysis.era ? normalizeSingleTag(cd.aiTagAnalysis.era) : cd.aiTagAnalysis.era,
      tagEvidence: normalizedEvidence,
    };
  }

  return {
    ...cd,
    genre: normalizedGenre,
    tags: normalizedTags,
    aiTagAnalysis: normalizedAiAnalysis,
  };
}
