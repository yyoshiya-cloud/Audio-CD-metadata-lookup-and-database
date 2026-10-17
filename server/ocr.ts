import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback } from './geminiFallback.js';

export interface OCRResult {
  catalogNumber?: string;
  title?: string;
  artist?: string;
  barcode?: string;
  label?: string;
  releaseDate?: string;
  rawText?: string;
}

/**
 * Perform AI OCR on CD Spine or Jacket photo using Gemini 2.5 Flash
 */
export async function processCDImageOCR(imageBase64: string, mimeType: string = 'image/jpeg'): Promise<OCRResult> {
  try {
    const ai = new GoogleGenAI(); // automatically reads process.env.GEMINI_API_KEY
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const prompt = `
You are an expert Japanese CD cataloguer and music metadata classifier.
Analyze this photo of a CD spine, obi strip (帯), front cover, or back cover.

Extract the following metadata if visible:
1. Catalog Number / 型番 (e.g. "SRCL-1234", "VICL-60001", "TOCT-24001", "ESCB 2000", "KICS-1000", "TFCC-88077")
2. Album / CD Title (CDタイトル)
3. Artist / Singer / Band Name (歌手・アーティスト名)
4. JAN / Barcode code (バーコード番号, 12-13 digits starting with 49, 45, etc.)
5. Record Label / Publisher (レーベル・レコード会社名)
6. Release Date (発売日, YYYY-MM-DD or YYYY)

Return ONLY a strict valid JSON object in this format with no code markdown backticks:
{
  "catalogNumber": "extracted catalog number or empty string",
  "title": "extracted title or empty string",
  "artist": "extracted artist or empty string",
  "barcode": "extracted barcode or empty string",
  "label": "extracted label or empty string",
  "releaseDate": "extracted release date or empty string"
}
`;

    const response = await generateContentWithFallback(ai, {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: cleanBase64,
                mimeType,
              },
            },
          ],
        },
      ],
      preferredModel: 'gemini-flash-latest',
    });

    const text = response.text || '';
    const cleanJsonText = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(cleanJsonText);
      return {
        catalogNumber: parsed.catalogNumber ? String(parsed.catalogNumber).trim().toUpperCase() : undefined,
        title: parsed.title || undefined,
        artist: parsed.artist || undefined,
        barcode: parsed.barcode || undefined,
        label: parsed.label || undefined,
        releaseDate: parsed.releaseDate || undefined,
        rawText: text,
      };
    } catch {
      return { rawText: text };
    }
  } catch (err: any) {
    console.error('Error running Gemini OCR:', err);
    throw new Error(`AI OCR解析エラー: ${err.message || '画像の解析に失敗しました。'}`);
  }
}
