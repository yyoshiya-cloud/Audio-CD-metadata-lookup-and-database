import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback } from './geminiFallback.js';
import { createLogger } from '../src/lib/logger.js';
import { ReadingRequestItem, ReadingResult, sanitizeReadingResults } from './readingSanitizer.js';
import { getShirabeReadingsForItems } from './shirabe.js';
import { needsReading } from '../src/lib/readingSort.js';

const log = createLogger('aiReadings', { timestamp: true });

const SYSTEM_INSTRUCTION = `あなたは日本語の読み仮名の専門家です。CDのタイトルと歌手名の「読み」を、ひらがなで答えます。

【ルール】
1. 読みは、五十音順に並べるために使います。ひらがなだけで答え、漢字・カタカナ・英字は使わないでください（長音は「ー」）。
2. 助詞の「は」「へ」は、発音ではなく表記どおりに「は」「へ」と書いてください（例: 「私は」→「わたしは」）。
3. 確信が持てない読み、固有名詞で読みが複数ありうるものは、推測せず空文字 "" にしてください。誤った読みより、空のほうが良いです。
4. 依頼されていない項目（title が無いのに titleReading など）は答えないでください。
5. 与えられた id をそのまま返してください。

出力は次のJSONのみ:
{ "results": [ { "id": "...", "titleReading": "...", "artistReading": "..." } ] }`;

const CHUNK_SIZE = 20;

/** Gemini による純粋な読み推定（フォールバック用） */
export async function generatePureGeminiReadings(items: ReadingRequestItem[]): Promise<ReadingResult[]> {
  if (!items || items.length === 0) return [];
  const ai = new GoogleGenAI(); // GEMINI_API_KEY を環境変数から読む
  const results: ReadingResult[] = [];

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    try {
      const response = await generateContentWithFallback(ai, {
        contents: [
          {
            role: 'user',
            parts: [{ text: `次のタイトル・歌手名の読み仮名を、JSONで返してください:\n\n${JSON.stringify(chunk)}` }],
          },
        ],
        config: { systemInstruction: SYSTEM_INSTRUCTION, responseMimeType: 'application/json', temperature: 0 },
        preferredModel: 'gemini-flash-latest',
      });
      const text = response.text;
      if (text) {
        const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        results.push(...sanitizeReadingResults(JSON.parse(clean), chunk));
      }
    } catch (err) {
      log.warn('Gemini読み仮名の生成に失敗した範囲があります（スキップして続行）', err);
    }
  }
  return results;
}

/**
 * Shirabe 日本語テキスト処理 API (furigana / name-reading) を主軸にして、
 * タイトル・歌手名の読み仮名（ひらがな）を推定する。
 * 未解決の項目があれば Gemini AI をフォールバックとして補完する。
 */
export async function generateReadingsWithGemini(items: ReadingRequestItem[]): Promise<ReadingResult[]> {
  if (!items || items.length === 0) return [];

  // 1. Shirabe 日本語テキスト処理 API で高精度・決定論的に読みを取得
  let shirabeResults: ReadingResult[] = [];
  try {
    shirabeResults = await getShirabeReadingsForItems(items);
  } catch (err) {
    log.warn('Shirabe APIによる読み仮名取得でエラーが発生しました（Geminiへフォールバック）:', err);
  }

  const resultMap = new Map<string, ReadingResult>();
  for (const r of shirabeResults) {
    resultMap.set(r.id, { ...r });
  }

  // 2. 依頼項目に対して未解決（漢字を含むのに読みが空）のアイテムを抽出
  const unfulfilledItems: ReadingRequestItem[] = [];
  for (const item of items) {
    const existing = resultMap.get(item.id);
    const needTitle = item.title && needsReading(item.title) && (!existing || !existing.titleReading);
    const needArtist = item.artist && needsReading(item.artist) && (!existing || !existing.artistReading);

    if (needTitle || needArtist) {
      unfulfilledItems.push({
        id: item.id,
        title: needTitle ? item.title : undefined,
        artist: needArtist ? item.artist : undefined,
      });
    }
  }

  // 3. 未解決の項目があれば Gemini AI で補完
  if (unfulfilledItems.length > 0) {
    try {
      const geminiResults = await generatePureGeminiReadings(unfulfilledItems);
      for (const gr of geminiResults) {
        const current = resultMap.get(gr.id) || { id: gr.id };
        if (!current.titleReading && gr.titleReading) {
          current.titleReading = gr.titleReading;
        }
        if (!current.artistReading && gr.artistReading) {
          current.artistReading = gr.artistReading;
        }
        resultMap.set(gr.id, current);
      }
    } catch (err) {
      log.warn('Geminiフォールバック処理でエラー:', err);
    }
  }

  // 4. sanitizeReadingResults を通して形式チェック
  return sanitizeReadingResults({ results: Array.from(resultMap.values()) }, items);
}
