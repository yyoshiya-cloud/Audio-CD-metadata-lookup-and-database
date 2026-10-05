import { GoogleGenAI } from '@google/genai';

const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
];

// Track models that hit quota/rate-limit so we skip them immediately until cooldown expires
const modelCooldownUntil = new Map<string, number>();

export async function generateContentWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
    preferredModel?: string;
  }
): Promise<any> {
  const now = Date.now();
  const baseList = params.preferredModel
    ? [params.preferredModel, ...GEMINI_MODELS.filter((m) => m !== params.preferredModel)]
    : GEMINI_MODELS;

  // Put non-cooldown models first, cooldown models last as a final resort
  const activeModels = baseList.filter((m) => (modelCooldownUntil.get(m) || 0) <= now);
  const cooldownModels = baseList.filter((m) => (modelCooldownUntil.get(m) || 0) > now);
  const modelsToTry = [...activeModels, ...cooldownModels];

  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });
      return response;
    } catch (err: any) {
      lastError = err;
      const errStr = String(err?.message || err).toLowerCase();
      const isRateLimit =
        errStr.includes('429') ||
        errStr.includes('resource_exhausted') ||
        errStr.includes('rate limit') ||
        errStr.includes('quota') ||
        errStr.includes('overloaded') ||
        errStr.includes('503') ||
        errStr.includes('service unavailable');

      if (isRateLimit) {
        // Cooldown this model for 30 minutes if quota is exhausted
        modelCooldownUntil.set(model, Date.now() + 30 * 60 * 1000);
      }
      // Silently continue to the next model in the fallback chain
    }
  }

  throw lastError || new Error('All Gemini model versions failed due to API rate limits or network errors.');
}
