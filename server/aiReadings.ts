import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback } from './geminiFallback.js';
import { createLogger } from '../src/lib/logger.js';
import { ReadingRequestItem, ReadingResult, sanitizeReadingResults } from './readingSanitizer.js';

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

/** Gemini でタイトル・歌手名の読み（ひらがな）を推定する。結果は sanitizeReadingResults で検証済み */
export async function generateReadingsWithGemini(items: ReadingRequestItem[]): Promise<ReadingResult[]> {
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
      log.warn('読み仮名の生成に失敗した範囲があります（スキップして続行）', err);
    }
  }
  return results;
}
