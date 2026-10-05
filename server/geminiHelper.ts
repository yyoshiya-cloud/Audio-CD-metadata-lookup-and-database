import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback } from './geminiFallback.js';

/**
 * Call Gemini API with automatic fallback to alternative model versions upon encountering API limits, rate limits (429), or quota exhaustion.
 */
export async function callGeminiWithFallback(
  params: {
    contents: any;
    config?: any;
  },
  preferredModel = 'gemini-flash-latest'
): Promise<string> {
  const ai = new GoogleGenAI();
  const response = await generateContentWithFallback(ai, {
    contents: params.contents,
    config: params.config,
    preferredModel,
  });

  return response?.text || '';
}
