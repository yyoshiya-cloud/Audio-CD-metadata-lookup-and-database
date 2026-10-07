import { createGeminiClient, generateContentWithFallback } from './geminiFallback.js';

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
  tracks?: { trackNumber: number; title: string }[];
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
  if (y >= 1950 && y < 1960) return '50年代';
  if (y >= 1960 && y < 1970) return '60年代';
  if (y >= 1970 && y < 1980) return '70年代';
  if (y >= 1980 && y < 1990) return '80年代';
  if (y >= 1990 && y < 2000) return '90年代';
  if (y >= 2000 && y < 2010) return '2000年代';
  if (y >= 2010 && y < 2020) return '2010年代';
  if (y >= 2020) return '2020年代';
  return '';
}

const DECADE_TAG_REGEX = /^(19\d0|20\d0|[56789]0)年代$/;

const SERVER_TAG_CANONICAL_MAP: Record<string, string> = {
  'j-pop': 'J-POP',
  'jpop': 'J-POP',
  'j pop': 'J-POP',
  'j-pop / 邦楽': 'J-POP',
  'j-pop/邦楽': 'J-POP',
  '邦楽 / j-pop': 'J-POP',
  'ポップス': 'J-POP',
  'ポップ': 'J-POP',
  'pop': 'J-POP',
  'pops': 'J-POP',
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
  const decade19xx = t.match(/^19([56789]0)年代$/);
  if (decade19xx) return `${decade19xx[1]}年代`;
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
      for (const sub of ['J-POP', '邦楽']) {
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

      return {
        id: cd.id,
        title: cd.title,
        artist: cd.artist,
        catalogNumber: cd.catalogNumber || '',
        label: cd.label || '',
        cdReleaseDate: cd.releaseDate || '',
        vinylRecordReleaseDate: cd.vinylRecordReleaseDate || '',
        vinylRecordFormat: cd.vinylRecordFormat || '',
        effectiveReleaseDateForEraTag: effectiveDateForEra,
        effectiveDateSourceForEraTag: effectiveDateSource,
        requiredEraTag: deriveEraTagFromDate(effectiveDateForEra),
        trackListSample: (cd.tracks || []).slice(0, 10).map((t) => t.title).join(', '),
        existingGenre: cd.genre || '',
        existingTags: cd.existingTags || [],
        notes: cd.notes || '',
      };
    });

    const prompt = `
You are an expert Japanese and international music archivist, record store curator, and discographer.
Analyze the following CD albums to classify their musical genre, mood/atmosphere, release era/decade, and produce 3 to 5 concise, standardized Japanese tags for music collection management.
Crucially, you must explicitly provide the objective/analytical BASIS (根拠) for why each tag was selected based on the input metadata.

CRITICAL ERA TAG RULE (年代タグ生成の最優先ルール):
- If an album has BOTH "cdReleaseDate" (CD発売年月日) and "vinylRecordReleaseDate" (同タイトルLP/EP発売年月日) — or whenever "vinylRecordReleaseDate" is present — you MUST generate the era/decade tag ("era" and the decade tag inside "suggestedTags") from "vinylRecordReleaseDate" (i.e. "effectiveReleaseDateForEraTag" / "requiredEraTag"), NOT from "cdReleaseDate".
- For example, if a CD reissue was released in 2005 ("cdReleaseDate": "2005-09-21") but its original LP/EP record was released in 1982 ("vinylRecordReleaseDate": "1982-05-21"), the era tag MUST be "80年代" (derived from the LP/EP release date 1982-05-21), and its "tagEvidence" must state that the era tag was generated from the LP/EP release date ("LP/EP発売年月日") because both CD and LP/EP dates exist.
- Only use "cdReleaseDate" for the era tag when "vinylRecordReleaseDate" is empty.

Options requested:
- Include Musical Genre/Sub-genre: ${options.includeGenre !== false ? 'Yes' : 'No'}
- Include Mood/Atmosphere (雰囲気): ${options.includeMood !== false ? 'Yes' : 'No'}
- Include Era/Decade (リリース年代): ${options.includeEra !== false ? 'Yes' : 'No'}
- Maximum tags per album: ${options.maxTagsPerCD || 5}

CDs to analyze:
${JSON.stringify(simplifiedChunk, null, 2)}

Instructions & STRICT TAG UNIFICATION RULES (表記ゆれ防止・タグ統一ルール):
1. NEVER use English/Romaji spelling variants or slash-combined tags. Always use these unified Japanese canonical tags:
   - Use "J-POP" (NEVER "J-Pop", "Jpop", or "J-POP / 邦楽")
   - Use "邦楽" or "洋楽" as separate single tags (NEVER combine with "/" like "J-POP / 邦楽")
   - Use "アイドル" (NEVER "Aidol" or "Idol")
   - Use "アニソン" (NEVER "Anime", "アニメ", or "アニメソング")
   - Use "CMソング" (NEVER "CM-Song" or "CM曲")
   - Use "シンガーソングライター", "ニューミュージック", "フォーク", "シティポップ", "昭和歌謡", "ロック", "ハードロック", "パンク", "ジャズ", "フュージョン", "クラシック", "R&B", "ヒップホップ", "テクノポップ", "AOR", "バラード", "アコースティック", "サウンドトラック", "ベスト盤", "ライブ盤", "お笑い・バラエティ"
   - Era tags MUST be strictly one of: "50年代", "60年代", "70年代", "80年代", "90年代", "2000年代", "2010年代", "2020年代" (NEVER "1980年代" or "80s").
2. "genre": The primary music genre using ONLY a single unified canonical name from rule 1 (e.g., "J-POP", "ニューミュージック", "シティポップ", "ロック", "アニソン", "ジャズ", "昭和歌謡", "フォーク", "R&B", "ヒップホップ", "アイドル", "クラシック").
3. "subGenre": Sub-genre or musical style using unified Japanese terms (e.g., "シンガーソングライター", "バラード", "アコースティック", "AOR", "テクノポップ", "ベスト盤", "ライブ盤").
4. "mood": Atmosphere & emotional feel keywords in Japanese (e.g., "爽快・疾走感", "切ない・哀愁", "メロウ・チル", "エモーショナル", "叙情的・優しさ", "ダンサブル").
5. "era": Era/decade classification derived strictly from "effectiveReleaseDateForEraTag" ("vinylRecordReleaseDate" when present, otherwise "cdReleaseDate").
6. "suggestedTags": Array of 3 to 5 concise, unified Japanese tags following Rule 1. When Include Era/Decade is Yes and "requiredEraTag" is non-empty, "suggestedTags" MUST include that exact "requiredEraTag" and MUST NOT include a conflicting decade tag.
7. "reasoning": A clear 1-2 sentence Japanese explanation summarizing the overall musical characteristics and why these tags fit this album (mentioning the LP/EP original release date when present).
8. "tagEvidence": An array corresponding to each tag in "suggestedTags", explaining the concrete basis (根拠):
   - "tag": The exact unified tag string matching "suggestedTags".
   - "category": One of "genre" | "mood" | "era" | "style".
   - "evidence": Specific Japanese explanation of why this tag was chosen.
   - "sourceFields": Array of input fields used as evidence in Japanese (e.g., ["LP/EP発売年月日"], ["アーティスト名", "収録曲リスト"], ["CD発売年月日"], ["規格品番・レーベル", "タイトル"]).

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
          "sourceFields": ["アーティスト名", "収録曲リスト"]
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
        // Post-process each result to deterministically enforce unified tags and the LP/EP release date era rule
        for (const item of parsed.results as CDTagAnalysisResult[]) {
          item.genre = normalizeServerTag(item.genre) || 'J-POP';
          if (item.subGenre) {
            item.subGenre = normalizeServerTag(item.subGenre);
          }
          item.suggestedTags = normalizeServerTagList(item.suggestedTags);
          if (Array.isArray(item.tagEvidence)) {
            const seenEv = new Set<string>();
            item.tagEvidence = item.tagEvidence
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

          const origCd = chunk.find((c) => c.id === item.id);
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
      // Fallback: generate deterministic tags prioritizing vinylRecordReleaseDate over releaseDate
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

        const canonicalGenre = normalizeServerTag(cd.genre) || 'J-POP';
        const suggested = normalizeServerTagList([era, canonicalGenre, '邦楽'].filter(Boolean));
        allResults.push({
          id: cd.id,
          genre: canonicalGenre,
          mood: 'ポップ・メロディアス',
          era: era || '邦楽',
          suggestedTags: suggested,
          reasoning: `アーティスト「${cd.artist}」・タイトル「${cd.title}」${
            hasVinyl
              ? `・同タイトルLP/EP発売日(${cd.vinylRecordReleaseDate}${hasCd ? ` ※CD発売日:${cd.releaseDate}より優先` : ''})`
              : hasCd
              ? `・CD発売日(${cd.releaseDate})`
              : ''
          }のメタデータに基づく自動分類`,
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
            {
              tag: cd.genre || 'J-POP',
              category: 'genre' as const,
              evidence: `アーティスト「${cd.artist}」およびレーベル（${cd.label || '国内盤規格'}）の傾向から判定`,
              sourceFields: ['アーティスト名', 'レーベル'],
            },
          ],
        });
      });
    }
  }

  return allResults;
}
