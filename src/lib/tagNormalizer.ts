import { CDMetadata, TagEvidenceItem } from '../types/cd';
import { runGenreRulePrecheck, applyGenreRuleFilter } from './genreRuleFilter';

export { runGenreRulePrecheck, applyGenreRuleFilter };

/**
 * Canonical tag normalizer to eliminate duplicate/variant tags across the library.
 * Maps English/Romaji/variant tags (e.g., "J-Pop", "J-POP / 邦楽", "Aidol", "Anime", "CM-Song", "1980年代")
 * into unified Japanese standard tags.
 */
const DIRECT_TAG_MAP: Record<string, string> = {
  // J-Pop variants
  'j-pop': 'J-Pop',
  'jpop': 'J-Pop',
  'j pop': 'J-Pop',
  'j-pop / 邦楽': 'J-Pop',
  'j-pop/邦楽': 'J-Pop',
  '邦楽 / j-pop': 'J-Pop',
  'japanese pop': 'J-Pop',
  'ジャパニーズ・ポップ': 'J-Pop',
  'ポップス': 'J-Pop',
  'ポップ': 'J-Pop',
  'pop': 'J-Pop',
  'pops': 'J-Pop',

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
 * When `preserveCustomName` is true, only fixes full-width alphanumeric and "J-POP"->"J-Pop" / decades,
 * without mapping synonyms (e.g. "ポップス" or "歌謡曲") to a different tag name.
 */
export function normalizeSingleTag(
  rawTag?: string,
  options?: { preserveCustomName?: boolean }
): string {
  if (!rawTag) return '';
  let t = String(rawTag).trim().replace(/^#+/, '').trim();
  if (!t) return '';

  // Normalize full-width alphanumeric to half-width
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));

  // Normalize decades to 4-digit format: "90年代" -> "1990年代", "80年代" -> "1980年代", "70年代" -> "1970年代", "80s" -> "1980年代"
  const decade2Digit = t.match(/^([56789]0)年代$/);
  if (decade2Digit) return `19${decade2Digit[1]}年代`;

  const decade19xx = t.match(/^19([56789]0)年代$/);
  if (decade19xx) return `19${decade19xx[1]}年代`;

  const decadeEn = t.match(/^(?:19)?([56789]0)'?s$/i);
  if (decadeEn) return `19${decadeEn[1]}年代`;

  const decade20xxEn = t.match(/^(20[012]0)'?s$/i);
  if (decade20xxEn) return `${decade20xxEn[1]}年代`;

  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  // Always unify J-POP casing to J-Pop as requested by user
  if (lower === 'j-pop' || lower === 'jpop' || lower === 'j pop') {
    return 'J-Pop';
  }

  if (!options?.preserveCustomName && DIRECT_TAG_MAP[lower]) {
    return DIRECT_TAG_MAP[lower];
  }

  return t;
}

/**
 * Normalize and deduplicate an array of tags, expanding compound slash tags like "J-POP / 邦楽".
 */
export function normalizeTagList(
  tags?: string[],
  options?: { preserveCustomName?: boolean }
): string[] {
  if (!tags || !Array.isArray(tags)) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');

    if (!options?.preserveCustomName && DIRECT_TAG_MAP[lower]) {
      if (lower.includes('j-pop') && lower.includes('邦楽')) {
        for (const sub of ['J-Pop', '邦楽']) {
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

    // Split compound tags separated by " / " or "／" when they combine distinct genres
    if (!options?.preserveCustomName && (trimmed.includes(' / ') || trimmed.includes('／'))) {
      const parts = trimmed.split(/\s*[/／]\s*/);
      for (const part of parts) {
        const norm = normalizeSingleTag(part, options);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          result.push(norm);
        }
      }
      continue;
    }

    const norm = normalizeSingleTag(trimmed, options);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }

  return result;
}

const NON_GENRE_DECADE_REGEX = /^(19\d0|20\d0|[56789]0)年代$/;

/**
 * Normalize a CD's genre, tags, and aiTagAnalysis evidence so all tags are unified,
 * and ensure `genre` does not retain stale/removed tags when `tags` is populated.
 */
export function normalizeCDTagsAndGenre(
  cd: CDMetadata,
  options?: { preserveUserTags?: boolean }
): CDMetadata {
  const preserveCustomName = options?.preserveUserTags ?? true;
  let normalizedTags = cd.tags ? normalizeTagList(cd.tags, { preserveCustomName }) : cd.tags;
  let normalizedGenre = cd.genre ? normalizeSingleTag(cd.genre, { preserveCustomName }) : cd.genre;

  // Only run rule precheck when preserveUserTags is explicitly false (e.g. during AI analysis)
  let hardBlockedTags = new Set<string>();
  if (options?.preserveUserTags === false) {
    const precheck = runGenreRulePrecheck({
      id: cd.id,
      title: cd.title,
      artist: cd.artist,
      catalogNumber: cd.catalogNumber,
      label: cd.label,
      releaseDate: cd.releaseDate,
      vinylRecordReleaseDate: cd.vinylRecordReleaseDate,
      vinylRecordFormat: cd.vinylRecordFormat,
      vinylRecordCatalogNumber: cd.vinylRecordCatalogNumber,
      barcode: cd.barcode,
      country: cd.country,
      format: cd.format,
      tracks: cd.tracks,
      genre: normalizedGenre,
      existingTags: normalizedTags,
      notes: cd.notes,
    });

    hardBlockedTags = new Set(precheck.blockedTags.map((b) => b.tag));

    if (hardBlockedTags.size > 0) {
      if (normalizedTags && normalizedTags.length > 0 && cd.aiTagAnalysis) {
        normalizedTags = normalizedTags.filter((t) => !hardBlockedTags.has(t));
      }
      if (normalizedGenre && hardBlockedTags.has(normalizedGenre)) {
        normalizedGenre =
          (normalizedTags || []).find((t) => !NON_GENRE_DECADE_REGEX.test(t) && t !== '邦楽' && !hardBlockedTags.has(t)) ||
          '';
      }
    }
  }

  // If the CD has an explicit tags array, keep `genre` strictly synchronized with `tags`
  if (Array.isArray(normalizedTags)) {
    if (normalizedTags.length === 0) {
      normalizedGenre = '';
    } else if (normalizedGenre) {
      const genreParts = normalizeTagList([normalizedGenre], { preserveCustomName });
      const isPresentInTags = genreParts.some((g) => normalizedTags!.includes(g));
      if (!isPresentInTags) {
        // Pick the first non-decade tag from normalizedTags, or fallback to first tag
        const primaryTag = normalizedTags.find((t) => !NON_GENRE_DECADE_REGEX.test(t) && t !== '邦楽') || normalizedTags[0];
        normalizedGenre = primaryTag;
      }
    } else {
      const primaryTag = normalizedTags.find((t) => !NON_GENRE_DECADE_REGEX.test(t) && t !== '邦楽') || normalizedTags[0];
      normalizedGenre = primaryTag;
    }
  }

  let normalizedAiAnalysis = cd.aiTagAnalysis;
  if (cd.aiTagAnalysis) {
    const seenEvTags = new Set<string>();
    const normalizedEvidence: TagEvidenceItem[] = [];
    for (const ev of cd.aiTagAnalysis.tagEvidence || []) {
      const normTag = normalizeSingleTag(ev.tag, { preserveCustomName });
      if (normTag && !seenEvTags.has(normTag) && !hardBlockedTags.has(normTag)) {
        // If tags array is defined, only keep evidence for tags that are actually present in normalizedTags
        if (!Array.isArray(normalizedTags) || normalizedTags.includes(normTag)) {
          seenEvTags.add(normTag);
          normalizedEvidence.push({
            ...ev,
            tag: normTag,
          });
        }
      }
    }
    normalizedAiAnalysis = {
      ...cd.aiTagAnalysis,
      genre: Array.isArray(normalizedTags)
        ? normalizedGenre
        : normalizedGenre || (cd.aiTagAnalysis.genre ? normalizeSingleTag(cd.aiTagAnalysis.genre, { preserveCustomName }) : cd.aiTagAnalysis.genre),
      subGenre:
        Array.isArray(normalizedTags) &&
        cd.aiTagAnalysis.subGenre &&
        !normalizedTags.includes(normalizeSingleTag(cd.aiTagAnalysis.subGenre, { preserveCustomName }))
          ? undefined
          : cd.aiTagAnalysis.subGenre
          ? normalizeSingleTag(cd.aiTagAnalysis.subGenre, { preserveCustomName })
          : cd.aiTagAnalysis.subGenre,
      era: cd.aiTagAnalysis.era ? normalizeSingleTag(cd.aiTagAnalysis.era, { preserveCustomName }) : cd.aiTagAnalysis.era,
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
