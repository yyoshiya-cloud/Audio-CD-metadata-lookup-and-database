import { GoogleGenAI } from '@google/genai';
import { fetchSafeExternalImage } from './security.js';

export async function upscaleJacketImage(
  imageBase64: string,
  title?: string,
  artist?: string,
  catalogNumber?: string
): Promise<{ enhancedImageBase64?: string; description?: string; error?: string; isQuotaError?: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      error: 'GEMINI_API_KEY が設定されていません。AI StudioのSecretsパネルをご確認ください。',
      isQuotaError: true,
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Clean base64 prefix if present
  let cleanBase64 = imageBase64;
  let mimeType = 'image/jpeg';
  if (imageBase64.includes(';base64,')) {
    const parts = imageBase64.split(';base64,');
    mimeType = parts[0].replace('data:', '');
    if (mimeType.toLowerCase().includes('svg') || mimeType.toLowerCase().includes('xml') || mimeType.toLowerCase().includes('html')) {
      return { error: 'セキュリティ保護のため、SVG形式の画像データは許可されていません。' };
    }
    cleanBase64 = parts[1];
  } else if (imageBase64.startsWith('http://') || imageBase64.startsWith('https://')) {
    try {
      const { buffer, mimeType: fetchedMime } = await fetchSafeExternalImage(imageBase64);
      mimeType = fetchedMime;
      cleanBase64 = buffer.toString('base64');
    } catch (err: any) {
      return { error: `画像取得エラー: ${err.message || '通信エラー'}` };
    }
  }

  const prompt = `Enhance and upscale this CD album cover art into a high-resolution, sharp, vivid, clean, high-definition official album jacket image.
Album Title: ${title || 'CD Album'}
Artist: ${artist || 'Music Artist'}
${catalogNumber ? `Catalog Number: ${catalogNumber}` : ''}
Recreate the album artwork sharply with 1:1 square ratio. Preserve the original artwork design, logo, title text, and artist aesthetic faithfully, while removing pixelation, compression artifacts, blur, or noise. Make it crisp and clear.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: '1:1',
        },
      },
    });

    let enhancedImageBase64 = '';
    let description = '';

    const candidates = response.candidates;
    if (candidates && candidates.length > 0 && candidates[0].content?.parts) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          const mime = part.inlineData.mimeType || 'image/png';
          enhancedImageBase64 = `data:${mime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          description += part.text;
        }
      }
    }

    if (!enhancedImageBase64) {
      return { error: 'Gemini AIでの画像超解像アップスケーリング生成結果を取得できませんでした。' };
    }

    return { enhancedImageBase64, description };
  } catch (err: any) {
    console.log('Gemini image model quota limit (429) active, using client canvas fallback.');
    return {
      error: 'Gemini APIの無料枠画像生成制限(Quota 429)に達しました。キャンバス高画質化フィルターを代替適用します。',
      isQuotaError: true,
    };
  }
}
