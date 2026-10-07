import { GoogleGenAI } from '@google/genai';

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

// Track models that hit quota/rate-limit so we skip them immediately until cooldown expires
const modelCooldownUntil = new Map<string, number>();

export function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${ms}ms) calling ${label}`));
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function generateContentWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
    preferredModel?: string;
    timeoutMs?: number;
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

  const perModelTimeout = params.timeoutMs || 14000;
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        }),
        perModelTimeout,
        model
      );
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
        errStr.includes('timeout') ||
        errStr.includes('service unavailable');

      if (isRateLimit) {
        // Cooldown this model for 15 minutes if quota is exhausted or timing out
        modelCooldownUntil.set(model, Date.now() + 15 * 60 * 1000);
      }
      // Continue to the next model in the fallback chain
    }
  }

  throw lastError || new Error('All Gemini model versions failed due to API rate limits or network errors.');
}
