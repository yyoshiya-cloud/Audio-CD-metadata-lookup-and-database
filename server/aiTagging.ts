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

export interface CDTagAnalysisResult {
  id: string;
  genre: string;
  subGenre?: string;
  mood: string;
  era: string;
  suggestedTags: string[];
  reasoning?: string;
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
      trackListSample: (cd.tracks || []).slice(0, 8).map((t) => t.title).join(', '),
      existingGenre: cd.genre || '',
      existingTags: cd.existingTags || [],
    }));

    const prompt = `
You are an expert Japanese and international music archivist, record store curator, and discographer.
Analyze the following CD albums to classify their musical genre, mood/atmosphere, release era/decade, and produce 3 to 5 concise, standardized Japanese tags for music collection management.

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
4. "era": Era/decade classification (e.g., "70年代", "80年代", "90年代", "2000年代", "2010年代", "2020年代", "昭和歌謡", "平成初期", "令和").
5. "suggestedTags": Array of 3 to 5 concise Japanese tags. Examples: ["J-POP", "90年代", "ミリオンセラー", "切ない", "名盤"], ["シティポップ", "80年代", "爽やか", "ドライブ"], ["アニソン", "2000年代", "熱い", "主題歌"].
6. "reasoning": A 1-sentence Japanese summary describing the musical sound and features.

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
      "reasoning": "..."
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

        allResults.push({
          id: cd.id,
          genre: 'J-POP / 邦楽',
          mood: 'ポップ・メロディアス',
          era: era || '邦楽',
          suggestedTags: [era, 'J-POP', '邦楽'].filter(Boolean),
          reasoning: 'AI通信フォールバックによる簡易判定',
        });
      });
    }
  }

  return allResults;
}
