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

Instructions:
1. "genre": The primary music genre in Japanese (e.g., "J-POP", "シティポップ", "ロック", "アニメソング", "ジャズ", "昭和歌謡", "フォーク", "R&B", "ヒップホップ", "アイドル", "クラシック", "ハードロック", "ニューミュージック", "エレクトロニック").
2. "subGenre": Sub-genre or musical style if applicable (e.g., "ガールズポップ", "青春パンク", "AOR", "メロコア", "渋谷系", "テクノポップ").
3. "mood": Atmosphere & emotional feel keywords in Japanese (e.g., "爽快・疾走感", "切ない・哀愁", "メロウ・チル", "エモーショナル", "リラックス・夜", "ダンサブル", "重厚・ダーク").
4. "era": Era/decade classification derived strictly from "effectiveReleaseDateForEraTag" ("vinylRecordReleaseDate" when present, otherwise "cdReleaseDate") (e.g., "60年代", "70年代", "80年代", "90年代", "2000年代", "2010年代", "2020年代").
5. "suggestedTags": Array of 3 to 5 concise Japanese tags. When Include Era/Decade is Yes and "requiredEraTag" is non-empty, "suggestedTags" MUST include that exact "requiredEraTag" (derived from LP/EP release date when present) and MUST NOT include a conflicting decade tag from the CD reissue date.
6. "reasoning": A clear 1-2 sentence Japanese explanation summarizing the overall musical characteristics and why these tags fit this album (mentioning the LP/EP original release date when present).
7. "tagEvidence": An array corresponding to each tag in "suggestedTags", explaining the concrete basis (根拠):
   - "tag": The exact tag string.
   - "category": One of "genre" | "mood" | "era" | "style".
   - "evidence": Specific Japanese explanation of why this tag was chosen (e.g., if both CD and LP/EP dates exist: "CD発売日(2005-09-21)とLP/EP発売日(1982-05-21)の両方があるため、LP/EP発売年月日(1982-05-21)を優先して80年代と判定").
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
        // Post-process each result to deterministically enforce the LP/EP release date era rule
        for (const item of parsed.results as CDTagAnalysisResult[]) {
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

        const suggested = [era, cd.genre || 'J-POP', '邦楽'].filter(Boolean);
        allResults.push({
          id: cd.id,
          genre: cd.genre || 'J-POP / 邦楽',
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
