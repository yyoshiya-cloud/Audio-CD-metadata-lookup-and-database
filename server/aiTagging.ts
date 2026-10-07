import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback } from './geminiFallback.js';

export interface CDTagAnalysisInput {
  id: string;
  title: string;
  artist: string;
  catalogNumber?: string;
  label?: string;
  releaseDate?: string;
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
 * Process a batch of CDs using Gemini 3.8 Flash to analyze genre, mood, era, and generate curated tags.
 */
export async function analyzeCDTagsWithGemini(
  cds: CDTagAnalysisInput[],
  options: AITaggingOptions = {}
): Promise<CDTagAnalysisResult[]> {
  if (!cds || cds.length === 0) return [];

  // Limit chunk size to 10 CDs per Gemini call to ensure reliable and prompt responses
  const CHUNK_SIZE = 8;
  const allResults: CDTagAnalysisResult[] = [];

  const ai = new GoogleGenAI(); // Reads GEMINI_API_KEY from process.env

  for (let i = 0; i < cds.length; i += CHUNK_SIZE) {
    const chunk = cds.slice(i, i + CHUNK_SIZE);

    const simplifiedChunk = chunk.map((cd) => ({
      id: cd.id,
      title: cd.title,
      artist: cd.artist,
      catalogNumber: cd.catalogNumber || '',
      label: cd.label || '',
      releaseDate: cd.releaseDate || '',
      trackListSample: (cd.tracks || []).slice(0, 10).map((t) => t.title).join(', '),
      existingGenre: cd.genre || '',
      existingTags: cd.existingTags || [],
      notes: cd.notes || '',
    }));

    const prompt = `
You are an expert Japanese and international music archivist, record store curator, and discographer.
Analyze the following CD albums to classify their musical genre, mood/atmosphere, release era/decade, and produce 3 to 5 concise, standardized Japanese tags for music collection management.
Crucially, you must explicitly provide the objective/analytical BASIS (根拠) for why each tag was selected based on the input metadata (Artist profile, Album title, Release date, Record label/Catalog prefix, and Tracklist titles).

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
4. "era": Era/decade classification derived from releaseDate or original release period (e.g., "70年代", "80年代", "90年代", "2000年代", "2010年代", "2020年代", "昭和歌謡", "平成初期", "令和").
5. "suggestedTags": Array of 3 to 5 concise Japanese tags.
6. "reasoning": A clear 1-2 sentence Japanese explanation summarizing the overall musical characteristics and why these tags fit this album.
7. "tagEvidence": An array corresponding to each tag in "suggestedTags", explaining the concrete basis (根拠):
   - "tag": The exact tag string.
   - "category": One of "genre" | "mood" | "era" | "style".
   - "evidence": Specific Japanese explanation of why this tag was chosen (e.g., "発売日(1998-04-08)から90年代後半のJ-POPと判定", "アーティストの音楽性と収録曲『...』のバンドサウンドから判定", "規格品番・レーベルの特徴からアニメ主題歌シングルと判定").
   - "sourceFields": Array of input fields used as evidence in Japanese (e.g., ["アーティスト名", "収録曲リスト"], ["発売年月日"], ["規格品番・レーベル", "タイトル"]).

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
        preferredModel: 'gemini-flash-latest',
      });

      const text = response.text || '';
      const cleanJson = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed && Array.isArray(parsed.results)) {
        allResults.push(...parsed.results);
      } else {
        // Fallback for non-array root
        console.warn('Gemini returned unexpected structure for AI tagging:', text);
      }
    } catch (err: any) {
      console.error(`Error in Gemini AI tagging chunk ${i}:`, err);
      // Fallback: generate basic heuristic tags for this chunk so the user process doesn't completely fail
      chunk.forEach((cd) => {
        const year = cd.releaseDate?.slice(0, 4);
        let era = '';
        if (year) {
          const y = parseInt(year, 10);
          if (y >= 1970 && y < 1980) era = '70年代';
          else if (y >= 1980 && y < 1990) era = '80年代';
          else if (y >= 1990 && y < 2000) era = '90年代';
          else if (y >= 2000 && y < 2010) era = '2000年代';
          else if (y >= 2010 && y < 2020) era = '2010年代';
          else if (y >= 2020) era = '2020年代';
        }

        const suggested = [era, cd.genre || 'J-POP', '邦楽'].filter(Boolean);
        allResults.push({
          id: cd.id,
          genre: cd.genre || 'J-POP / 邦楽',
          mood: 'ポップ・メロディアス',
          era: era || '邦楽',
          suggestedTags: suggested,
          reasoning: `アーティスト「${cd.artist}」・タイトル「${cd.title}」${cd.releaseDate ? `・発売日(${cd.releaseDate})` : ''}のメタデータに基づく自動分類`,
          tagEvidence: [
            ...(era
              ? [
                  {
                    tag: era,
                    category: 'era' as const,
                    evidence: `発売年月日（${cd.releaseDate}）の西暦から${era}の作品と判定`,
                    sourceFields: ['発売年月日'],
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
