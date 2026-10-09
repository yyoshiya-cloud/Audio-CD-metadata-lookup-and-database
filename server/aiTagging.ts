import { createGeminiClient, generateContentWithFallback } from './geminiFallback.js';
import { runGenreRulePrecheck, applyGenreRuleFilter } from '../src/lib/genreRuleFilter.js';

export interface CDTagAnalysisInput {
  id: string;
  title: string;
  artist: string;
  catalogNumber?: string;
  label?: string;
  releaseDate?: string;
  vinylRecordReleaseDate?: string;
  vinylRecordFormat?: string;
  vinylRecordCatalogNumber?: string;
  barcode?: string;
  country?: string;
  format?: string;
  tracks?: { trackNumber: number; title: string; duration?: string }[];
  genre?: string;
  existingTags?: string[];
  notes?: string;
}

export interface TagEvidenceItem {
  tag: string;
  category: 'genre' | 'mood' | 'era' | 'style';
  evidence: string;
  sourceFields: string[];
}

export interface CDTagAnalysisResult {
  id: string;
  genre: string;
  subGenre?: string;
  mood: string;
  era: string;
  suggestedTags: string[];
  reasoning?: string;
  tagEvidence?: TagEvidenceItem[];
  ruleAdjustments?: string[];
}

export interface AITaggingOptions {
  includeGenre?: boolean;
  includeMood?: boolean;
  includeEra?: boolean;
  includeTheme?: boolean;
  mergeMode?: 'append' | 'replace';
  maxTagsPerCD?: number;
}

/**
 * Derive standardized Japanese decade/era tag from a YYYY-MM-DD or YYYY string
 */
function deriveEraTagFromDate(dateStr?: string): string {
  if (!dateStr) return '';
  const match = String(dateStr).trim().match(/(\d{4})/);
  if (!match) return '';
  const y = parseInt(match[1], 10);
  if (isNaN(y)) return '';
  if (y >= 1950 && y < 1960) return '1950年代';
  if (y >= 1960 && y < 1970) return '1960年代';
  if (y >= 1970 && y < 1980) return '1970年代';
  if (y >= 1980 && y < 1990) return '1980年代';
  if (y >= 1990 && y < 2000) return '1990年代';
  if (y >= 2000 && y < 2010) return '2000年代';
  if (y >= 2010 && y < 2020) return '2010年代';
  if (y >= 2020) return '2020年代';
  return '';
}

const DECADE_TAG_REGEX = /^(19\d0|20\d0|[56789]0)年代$/;

const SERVER_TAG_CANONICAL_MAP: Record<string, string> = {
  'j-pop': 'J-Pop',
  'jpop': 'J-Pop',
  'j pop': 'J-Pop',
  'j-pop / 邦楽': 'J-Pop',
  'j-pop/邦楽': 'J-Pop',
  '邦楽 / j-pop': 'J-Pop',
  'ポップス': 'J-Pop',
  'ポップ': 'J-Pop',
  'pop': 'J-Pop',
  'pops': 'J-Pop',
  'aidol': 'アイドル',
  'idol': 'アイドル',
  'idol pop': 'アイドル',
  'アイドル歌謡': 'アイドル',
  '女性アイドル': 'アイドル',
  'anime': 'アニソン',
  'anison': 'アニソン',
  'anime song': 'アニソン',
  'アニメ': 'アニソン',
  'アニメソング': 'アニソン',
  'cm-song': 'CMソング',
  'cm song': 'CMソング',
  'cmsong': 'CMソング',
  'cm曲': 'CMソング',
  'new music': 'ニューミュージック',
  'ニュー・ミュージック': 'ニューミュージック',
  'folk': 'フォーク',
  'フォークソング': 'フォーク',
  'city pop': 'シティポップ',
  'citypop': 'シティポップ',
  'シティ・ポップ': 'シティポップ',
  'kayokyoku': '昭和歌謡',
  '歌謡曲': '昭和歌謡',
  'ssw': 'シンガーソングライター',
  'singer-songwriter': 'シンガーソングライター',
  'シンガー・ソングライター': 'シンガーソングライター',
  'rock': 'ロック',
  'j-rock': 'ロック',
  'hard rock': 'ハードロック',
  'jazz': 'ジャズ',
  'classical': 'クラシック',
  'classic': 'クラシック',
  'r&b': 'R&B',
  'hip-hop': 'ヒップホップ',
  'hip hop': 'ヒップホップ',
  'techno': 'テクノポップ',
  'techno pop': 'テクノポップ',
  'synth-pop': 'テクノポップ',
  'ballad': 'バラード',
  'acoustic': 'アコースティック',
  'best': 'ベスト盤',
  'ベスト': 'ベスト盤',
  'ベスト・アルバム': 'ベスト盤',
  'ベストアルバム': 'ベスト盤',
  'live': 'ライブ盤',
  'ライブ': 'ライブ盤',
  'ライブ・アルバム': 'ライブ盤',
  'ライブアルバム': 'ライブ盤',
  'comedy': 'お笑い・バラエティ',
  'お笑い': 'お笑い・バラエティ',
};

function normalizeServerTag(raw?: string): string {
  if (!raw) return '';
  let t = String(raw).trim().replace(/^#+/, '').trim();
  if (!t) return '';
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
  const decade2Digit = t.match(/^([56789]0)年代$/);
  if (decade2Digit) return `19${decade2Digit[1]}年代`;
  const decade19xx = t.match(/^19([56789]0)年代$/);
  if (decade19xx) return `19${decade19xx[1]}年代`;
  const decadeEn = t.match(/^(?:19)?([56789]0)'?s$/i);
  if (decadeEn) return `19${decadeEn[1]}年代`;
  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  if (SERVER_TAG_CANONICAL_MAP[lower]) return SERVER_TAG_CANONICAL_MAP[lower];
  return t;
}

function normalizeServerTagList(tags?: string[]): string[] {
  if (!tags || !Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');
    if (lower.includes('j-pop') && lower.includes('邦楽')) {
      for (const sub of ['J-Pop', '邦楽']) {
        if (!seen.has(sub)) {
          seen.add(sub);
          out.push(sub);
        }
      }
      continue;
    }
    if (trimmed.includes(' / ') || trimmed.includes('／')) {
      for (const part of trimmed.split(/\s*[/／]\s*/)) {
        const norm = normalizeServerTag(part);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          out.push(norm);
        }
      }
      continue;
    }
    const norm = normalizeServerTag(trimmed);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/**
 * Process a batch of CDs using Gemini 3.8 Flash to analyze genre, mood, era, and generate curated tags.
 * Rule: When both CD releaseDate and LP/EP vinylRecordReleaseDate exist (or when vinylRecordReleaseDate is present),
 * the era/decade tag MUST be generated from the LP/EP release date (vinylRecordReleaseDate).
 */
export async function analyzeCDTagsWithGemini(
  cds: CDTagAnalysisInput[],
  options: AITaggingOptions = {}
): Promise<CDTagAnalysisResult[]> {
  if (!cds || cds.length === 0) return [];

  // Limit chunk size to 4 CDs per Gemini call to ensure fast responses well within proxy timeout limits
  const CHUNK_SIZE = 4;
  const allResults: CDTagAnalysisResult[] = [];

  const ai = createGeminiClient();

  for (let i = 0; i < cds.length; i += CHUNK_SIZE) {
    const chunk = cds.slice(i, i + CHUNK_SIZE);

    const simplifiedChunk = chunk.map((cd) => {
      const hasVinylDate = Boolean(cd.vinylRecordReleaseDate && cd.vinylRecordReleaseDate.trim());
      const hasCdDate = Boolean(cd.releaseDate && cd.releaseDate.trim());
      const effectiveDateForEra = hasVinylDate ? cd.vinylRecordReleaseDate!.trim() : (cd.releaseDate || '').trim();
      const effectiveDateSource = hasVinylDate && hasCdDate
        ? 'LP/EP発売年月日 (CD発売年月日よりも優先)'
        : hasVinylDate
        ? 'LP/EP発売年月日'
        : 'CD発売年月日';

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
        genre: cd.genre,
        existingTags: cd.existingTags,
        notes: cd.notes,
      });

      return {
        id: cd.id,
        title: cd.title,
        artist: cd.artist,
        catalogNumber: cd.catalogNumber || '',
        label: cd.label || '',
        barcode: cd.barcode || '',
        country: cd.country || 'JP',
        format: cd.format || 'CD',
        cdReleaseDate: cd.releaseDate || '',
        vinylRecordReleaseDate: cd.vinylRecordReleaseDate || '',
        vinylRecordFormat: cd.vinylRecordFormat || '',
        vinylRecordCatalogNumber: cd.vinylRecordCatalogNumber || '',
        effectiveReleaseDateForEraTag: effectiveDateForEra,
        effectiveDateSourceForEraTag: effectiveDateSource,
        requiredEraTag: deriveEraTagFromDate(effectiveDateForEra),
        trackCount: cd.tracks ? cd.tracks.length : 0,
        trackDurationStats: precheck.trackDurationStats,
        trackListSample: (cd.tracks || [])
          .slice(0, 10)
          .map((t) => (t.duration ? `${t.title} (${t.duration})` : t.title))
          .join(', '),
        existingGenre: cd.genre || '',
        existingTags: cd.existingTags || [],
        notes: cd.notes || '',
        ruleBasedFilterHints: {
          enforcedPrimaryGenre: precheck.enforcedPrimaryGenre || null,
          enforcedTags: precheck.enforcedTags.map((e) => e.tag),
          blockedTags: precheck.blockedTags.map((b) => ({ tag: b.tag, reason: b.reason })),
          isPreJPopEra: precheck.isPreJPopEra,
          isWesternOrigin: precheck.isWesternOrigin,
          hasPositiveIdolSignal: precheck.hasPositiveIdolSignal,
        },
      };
    });

    const prompt = `
You are an expert Japanese and international music archivist, record store curator, and discographer.
Analyze the following CD albums to classify their musical genre, mood/atmosphere, release era/decade, and produce 3 to 5 concise, standardized Japanese tags for music collection management.
Crucially, you must explicitly provide the objective/analytical BASIS (根拠) for why each tag was selected based on the input metadata.

CRITICAL ERA TAG RULE (年代タグ生成の最優先ルール):
- If an album has BOTH "cdReleaseDate" (CD発売年月日) and "vinylRecordReleaseDate" (同タイトルLP/EP発売年月日) — or whenever "vinylRecordReleaseDate" is present — you MUST generate the era/decade tag ("era" and the decade tag inside "suggestedTags") from "vinylRecordReleaseDate" (i.e. "effectiveReleaseDateForEraTag" / "requiredEraTag"), NOT from "cdReleaseDate".
- Only use "cdReleaseDate" for the era tag when "vinylRecordReleaseDate" is empty.

CRITICAL MULTI-METADATA RULE-BASED GENRE FILTER (誤判定防止・多重メタデータ検証ルール):
Do NOT classify genres (especially "アイドル" and "J-Pop") based solely on artist names or cute-sounding song titles! You MUST inspect all metadata fields ("catalogNumber", "label", "vinylRecordReleaseDate", "cdReleaseDate", "vinylRecordFormat", "barcode", "country", "format", "trackDurationStats", "notes", and "ruleBasedFilterHints"):
1. RESPECT "ruleBasedFilterHints.blockedTags": Never output any tag listed in "blockedTags" for that CD.
2. RESPECT "ruleBasedFilterHints.enforcedPrimaryGenre" & "enforcedTags": Include any "enforcedTags" and use "enforcedPrimaryGenre" when provided.
3. STRICT "アイドル" VERIFICATION:
   - NEVER assign "アイドル" to Singer-Songwriters (シンガーソングライター), New Music (ニューミュージック), City Pop (シティポップ), Folk (フォーク), Rock bands (ロック), R&B vocalists, Voice Actor/Anime releases without idol context, Jazz, Classical, or Enka artists.
   - Only assign "アイドル" when corroborated by label (e.g. Johnny's, J Storm, AKS, N46Div, Up-Front, 70s/80s Idol labels), notes, catalog number, or verified idol group/solo idol career.
4. STRICT "J-Pop" VERIFICATION:
   - NEVER assign "J-Pop" to Classical (UCCG/SICC/DG/Decca), Jazz/Fusion (UCCU/TOCJ/Blue Note/Verve), Western Music (洋楽: non-JP barcode/country or UICY/SICP/WPCR international catalog prefix), Soundtracks (劇伴/サントラ), or Enka.
   - For pre-1988 releases ("isPreJPopEra": true, released before the term J-Pop was coined in 1988), prioritize period-accurate genres ("ニューミュージック", "昭和歌謡", "フォーク", "シティポップ", "アイドル", "ロック", "テクノポップ") over "J-Pop".

Options requested:
- Include Musical Genre/Sub-genre: ${options.includeGenre !== false ? 'Yes' : 'No'}
- Include Mood/Atmosphere (雰囲気): ${options.includeMood !== false ? 'Yes' : 'No'}
- Include Era/Decade (リリース年代): ${options.includeEra !== false ? 'Yes' : 'No'}
- Maximum tags per album: ${options.maxTagsPerCD || 5}

CDs to analyze:
${JSON.stringify(simplifiedChunk, null, 2)}

Instructions & STRICT TAG UNIFICATION RULES (表記ゆれ防止・タグ統一ルール):
1. NEVER use English/Romaji spelling variants or slash-combined tags. Always use these unified Japanese canonical tags:
   - Use "J-Pop" (NEVER "J-POP", "Jpop", or "J-POP / 邦楽")
   - Use "邦楽" or "洋楽" as separate single tags (NEVER combine with "/" like "J-Pop / 邦楽")
   - Use "アイドル" (NEVER "Aidol" or "Idol")
   - Use "アニソン" (NEVER "Anime", "アニメ", or "アニメソング")
   - Use "CMソング" (NEVER "CM-Song" or "CM曲")
   - Use "シンガーソングライター", "ニューミュージック", "フォーク", "シティポップ", "昭和歌謡", "演歌", "ロック", "ハードロック", "パンク", "ジャズ", "フュージョン", "クラシック", "R&B", "ヒップホップ", "テクノポップ", "AOR", "バラード", "アコースティック", "サウンドトラック", "ゲーム音楽", "ベスト盤", "ライブ盤", "お笑い・バラエティ"
   - Era tags MUST be strictly one of: "1950年代", "1960年代", "1970年代", "1980年代", "1990年代", "2000年代", "2010年代", "2020年代" (NEVER "70年代", "80年代", "90年代", or "80s").
2. "genre": The primary music genre using ONLY a single unified canonical name from rule 1.
3. "subGenre": Sub-genre or musical style using unified Japanese terms.
4. "mood": Atmosphere & emotional feel keywords in Japanese (e.g., "爽快・疾走感", "切ない・哀愁", "メロウ・チル", "エモーショナル", "叙情的・優しさ", "ダンサブル").
5. "era": Era/decade classification derived strictly from "effectiveReleaseDateForEraTag" ("vinylRecordReleaseDate" when present, otherwise "cdReleaseDate").
6. "suggestedTags": Array of 3 to 5 concise, unified Japanese tags following Rule 1 and the Multi-Metadata Rule-Based Genre Filter.
7. "reasoning": A clear 1-2 sentence Japanese explanation summarizing the overall musical characteristics and citing the metadata used (label, catalog prefix, LP/EP release date, track durations, notes, etc.).
8. "tagEvidence": An array corresponding to each tag in "suggestedTags", explaining the concrete basis (根拠):
   - "tag": The exact unified tag string matching "suggestedTags".
   - "category": One of "genre" | "mood" | "era" | "style".
   - "evidence": Specific Japanese explanation of why this tag was chosen.
   - "sourceFields": Array of input fields used as evidence in Japanese (e.g., ["LP/EP発売年月日"], ["規格品番", "レーベル"], ["収録曲数・演奏時間"], ["タイトル", "備考"], ["アーティスト名", "収録曲リスト"]).

Return ONLY a valid JSON object matching this schema with no markdown backticks:
{
  "results": [
    {
      "id": "cd id string",
      "genre": "...",
      "subGenre": "...",
      "mood": "...",
      "era": "...",
      "suggestedTags": ["tag1", "tag2", "tag3"],
      "reasoning": "...",
      "tagEvidence": [
        {
          "tag": "tag1",
          "category": "genre",
          "evidence": "...",
          "sourceFields": ["規格品番", "レーベル"]
        }
      ]
    }
  ]
}
`;

    try {
      const response = await generateContentWithFallback(ai, {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
        preferredModel: 'gemini-3.8-flash',
        timeoutMs: 13000,
      });

      const text = response.text || '';
      let cleanJson = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const firstBrace = cleanJson.indexOf('{');
      const lastBrace = cleanJson.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
      }
      const parsed = JSON.parse(cleanJson);

      if (parsed && Array.isArray(parsed.results) && parsed.results.length > 0) {
        // Post-process each result to deterministically enforce unified tags, multi-metadata rule filter, and the LP/EP release date era rule
        for (const item of parsed.results as CDTagAnalysisResult[]) {
          const origCd = chunk.find((c) => c.id === item.id);
          const rawNormalizedGenre = normalizeServerTag(item.genre);
          const rawNormalizedSubGenre = item.subGenre ? normalizeServerTag(item.subGenre) : undefined;
          const rawNormalizedTags = normalizeServerTagList(item.suggestedTags);

          let normalizedEvList: TagEvidenceItem[] = [];
          if (Array.isArray(item.tagEvidence)) {
            const seenEv = new Set<string>();
            normalizedEvList = item.tagEvidence
              .map((ev) => ({
                ...ev,
                tag: normalizeServerTag(ev.tag),
              }))
              .filter((ev) => {
                if (!ev.tag || seenEv.has(ev.tag)) return false;
                seenEv.add(ev.tag);
                return true;
              });
          }

          // Run deterministic multi-metadata rule-based genre & false-positive filter
          if (origCd) {
            const ruleFiltered = applyGenreRuleFilter(
              {
                id: origCd.id,
                title: origCd.title,
                artist: origCd.artist,
                catalogNumber: origCd.catalogNumber,
                label: origCd.label,
                releaseDate: origCd.releaseDate,
                vinylRecordReleaseDate: origCd.vinylRecordReleaseDate,
                vinylRecordFormat: origCd.vinylRecordFormat,
                vinylRecordCatalogNumber: origCd.vinylRecordCatalogNumber,
                barcode: origCd.barcode,
                country: origCd.country,
                format: origCd.format,
                tracks: origCd.tracks,
                genre: origCd.genre,
                existingTags: origCd.existingTags,
                notes: origCd.notes,
              },
              rawNormalizedTags,
              rawNormalizedGenre,
              rawNormalizedSubGenre,
              item.reasoning,
              normalizedEvList
            );

            item.genre = ruleFiltered.genre;
            item.subGenre = ruleFiltered.subGenre;
            item.suggestedTags = ruleFiltered.suggestedTags;
            item.tagEvidence = ruleFiltered.tagEvidence;
            item.ruleAdjustments = ruleFiltered.ruleAdjustments;
          } else {
            item.genre = rawNormalizedGenre || 'J-Pop';
            item.subGenre = rawNormalizedSubGenre;
            item.suggestedTags = rawNormalizedTags;
            item.tagEvidence = normalizedEvList;
          }

          if (origCd && options.includeEra !== false) {
            const hasVinyl = Boolean(origCd.vinylRecordReleaseDate && origCd.vinylRecordReleaseDate.trim());
            const hasCd = Boolean(origCd.releaseDate && origCd.releaseDate.trim());
            const effectiveDate = hasVinyl ? origCd.vinylRecordReleaseDate!.trim() : (origCd.releaseDate || '').trim();
            const expectedEra = deriveEraTagFromDate(effectiveDate);

            if (expectedEra) {
              item.era = expectedEra;
              // Replace any wrong decade tag in suggestedTags with expectedEra, or add expectedEra if missing
              const rawTags = Array.isArray(item.suggestedTags) ? item.suggestedTags : [];
              const filteredTags = rawTags.filter((t) => !DECADE_TAG_REGEX.test(t) || t === expectedEra);
              if (!filteredTags.includes(expectedEra)) {
                filteredTags.unshift(expectedEra);
              }
              item.suggestedTags = filteredTags;

              const eraEvidenceText =
                hasVinyl && hasCd
                  ? `CD発売年月日(${origCd.releaseDate})とLP/EP発売年月日(${origCd.vinylRecordReleaseDate})の両方にデータがあるため、LP/EP発売年月日(${origCd.vinylRecordReleaseDate})から「${expectedEra}」タグを生成`
                  : hasVinyl
                  ? `同タイトルのLP/EP発売年月日(${origCd.vinylRecordReleaseDate})から「${expectedEra}」タグを生成`
                  : `CD発売年月日(${origCd.releaseDate})から「${expectedEra}」タグを生成`;

              const eraSourceField = hasVinyl ? 'LP/EP発売年月日' : 'CD発売年月日';

              const existingEvList = Array.isArray(item.tagEvidence) ? item.tagEvidence : [];
              // Remove any outdated decade evidence that doesn't match expectedEra
              const cleanedEvList = existingEvList.filter(
                (ev) => ev.category !== 'era' && !DECADE_TAG_REGEX.test(ev.tag)
              );
              cleanedEvList.unshift({
                tag: expectedEra,
                category: 'era',
                evidence: eraEvidenceText,
                sourceFields: [eraSourceField],
              });
              item.tagEvidence = cleanedEvList;
            }
          }
          allResults.push(item);
        }
      } else {
        throw new Error('Unexpected JSON structure from Gemini');
      }
    } catch (err: any) {
      console.error(`Error in Gemini AI tagging chunk ${i}:`, err);
      // Fallback: generate deterministic tags using multi-metadata rule filter and prioritizing vinylRecordReleaseDate over releaseDate
      chunk.forEach((cd) => {
        const hasVinyl = Boolean(cd.vinylRecordReleaseDate && cd.vinylRecordReleaseDate.trim());
        const hasCd = Boolean(cd.releaseDate && cd.releaseDate.trim());
        const effectiveDate = hasVinyl ? cd.vinylRecordReleaseDate!.trim() : (cd.releaseDate || '').trim();
        const era = options.includeEra !== false ? deriveEraTagFromDate(effectiveDate) : '';

        const eraEvidenceText =
          hasVinyl && hasCd
            ? `CD発売年月日(${cd.releaseDate})とLP/EP発売年月日(${cd.vinylRecordReleaseDate})の両方にデータがあるため、LP/EP発売年月日(${cd.vinylRecordReleaseDate})から「${era}」タグを生成`
            : hasVinyl
            ? `同タイトルのLP/EP発売年月日(${cd.vinylRecordReleaseDate})から「${era}」タグを生成`
            : `CD発売年月日(${cd.releaseDate})から「${era}」タグを生成`;

        const initialGenre = normalizeServerTag(cd.genre);
        const initialTags = normalizeServerTagList(
          [era, initialGenre, ...(cd.existingTags || []), '邦楽'].filter(Boolean)
        );

        const ruleFiltered = applyGenreRuleFilter(
          {
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
            genre: cd.genre,
            existingTags: cd.existingTags,
            notes: cd.notes,
          },
          initialTags,
          initialGenre
        );

        const finalTags = era
          ? [era, ...ruleFiltered.suggestedTags.filter((t) => !DECADE_TAG_REGEX.test(t))]
          : ruleFiltered.suggestedTags;

        allResults.push({
          id: cd.id,
          genre: ruleFiltered.genre,
          subGenre: ruleFiltered.subGenre,
          mood: 'ポップ・メロディアス',
          era: era || (ruleFiltered.suggestedTags.includes('洋楽') ? '洋楽' : '邦楽'),
          suggestedTags: finalTags,
          reasoning: `アーティスト「${cd.artist}」・タイトル「${cd.title}」${
            cd.label ? `・レーベル(${cd.label})` : ''
          }${cd.catalogNumber ? `・規格品番(${cd.catalogNumber})` : ''}${
            hasVinyl
              ? `・同タイトルLP/EP発売日(${cd.vinylRecordReleaseDate}${hasCd ? ` ※CD発売日:${cd.releaseDate}より優先` : ''})`
              : hasCd
              ? `・CD発売日(${cd.releaseDate})`
              : ''
          }の複合メタデータ規則に基づく分類`,
          tagEvidence: [
            ...(era
              ? [
                  {
                    tag: era,
                    category: 'era' as const,
                    evidence: eraEvidenceText,
                    sourceFields: [hasVinyl ? 'LP/EP発売年月日' : 'CD発売年月日'],
                  },
                ]
              : []),
            ...ruleFiltered.tagEvidence.filter((ev) => !DECADE_TAG_REGEX.test(ev.tag)),
          ],
          ruleAdjustments: ruleFiltered.ruleAdjustments,
        });
      });
    }
  }

  return allResults;
}
