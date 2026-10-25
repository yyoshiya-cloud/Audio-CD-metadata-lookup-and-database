import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { performAggregatedSearch } from './server/search.js';
import { fetchITunesTracks } from './server/itunes.js';
import { processCDImageOCR } from './server/ocr.js';
import { analyzeCDTagsWithGemini } from './server/aiTagging.js';
import { backfillCDMetadataWithGemini } from './server/aiBackfill.js';
import { upscaleJacketImage } from './server/upscaleImage.js';
import { lookupVinylReleaseDates } from './server/vinylLookup.js';
import {
  fetchSafeExternalImage,
  createRateLimiter,
  securityHeadersMiddleware,
} from './server/security.js';
import { ImageCache } from './server/imageCache.js';
import { Schema, validate } from './server/validate.js';
import { errorMessage } from './server/apiTypes.js';
import { getConfigStatus } from './server/configStatus.js';
import { generateReadingsWithGemini } from './server/aiReadings.js';
import {
  aiAnalyzeTagsBodySchema,
  aiBackfillBodySchema,
  aiReadingsBodySchema,
  imageBase64BodySchema,
  imageProxyQuerySchema,
  itunesTracksQuerySchema,
  ocrBodySchema,
  searchBodySchema,
  upscaleBodySchema,
  vinylLookupBodySchema,
} from './server/schemas.js';
import type { SearchQuery } from './src/types/cd.js';
import { createLogger } from './src/lib/logger.js';

const log = createLogger('server', { timestamp: true });

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// 1. Apply global HTTP security headers
app.use(securityHeadersMiddleware);

// 2. Scoped JSON body parsers: 15MB only for image OCR / upscaling routes, 2MB default for all others
const largeImageJsonParser = express.json({ limit: '15mb' });
const defaultJsonParser = express.json({ limit: '2mb' });

app.use((req, res, next) => {
  if (req.path === '/api/ocr' || req.path === '/api/upscale-jacket') {
    return largeImageJsonParser(req, res, next);
  }
  return defaultJsonParser(req, res, next);
});

// 3. Rate limiters per endpoint category
const aiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 25,
  message: 'AI分析APIのリクエスト回数が上限（1分あたり25回）に達しました。少し待ってから再試行してください。',
});

const searchRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 60,
  message: '検索APIのリクエスト回数が上限（1分あたり60回）に達しました。少し待ってから再試行してください。',
});

const imageProxyRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 240,
  message: '画像プロキシのリクエスト回数が上限に達しました。しばらく待ってから再試行してください。',
});

// ジャケット画像プロキシ用のメモリキャッシュ
const coverImageCache = new ImageCache();

/** リクエストの入力を検証する。不正なら 400 を返して null を返す */
function readInput<T>(schema: Schema<T>, input: unknown, res: express.Response, asText = false): T | null {
  const result = validate(schema, input ?? {});
  if (result.ok) return result.data;
  if (asText) res.status(400).send(result.error);
  else res.status(400).json({ error: result.error });
  return null;
}

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Aggregated Search API across MusicBrainz, Discogs, iTunes, and NDL
// サーバーの環境変数で設定済みのAPIキーの有無（真偽値のみ。値は返さない）
app.get('/api/config-status', searchRateLimiter, (_req, res) => {
  res.json(getConfigStatus());
});

app.post('/api/search', searchRateLimiter, async (req, res) => {
  try {
    const body = readInput(searchBodySchema, req.body, res);
    if (!body) return;
    const effectiveCatno = body.catalogNumber || body.catno;

    if (!effectiveCatno && !body.title && !body.artist && !body.trackTitle && !body.barcode && !body.freeText) {
      return res.status(400).json({ error: '検索条件（型番、タイトル、歌手名、曲名、バーコード等）を入力してください。' });
    }

    const result = await performAggregatedSearch({
      catalogNumber: effectiveCatno,
      title: body.title,
      artist: body.artist,
      trackTitle: body.trackTitle,
      barcode: body.barcode,
      freeText: body.freeText,
      sources: body.sources as SearchQuery['sources'],
      apiKeys: body.apiKeys as SearchQuery['apiKeys'],
    });

    res.json(result);
  } catch (err: unknown) {
    log.error('Error handling /api/search:', err);
    res.status(500).json({ error: errorMessage(err) || 'メタデータ検索中にエラーが発生しました。' });
  }
});

// Fetch iTunes tracks on demand
app.get('/api/itunes/tracks', searchRateLimiter, async (req, res) => {
  try {
    const query = readInput(itunesTracksQuerySchema, req.query, res);
    if (!query) return;
    const collectionId = /^\d+$/.test(query.collectionId) ? parseInt(query.collectionId, 10) : 0;
    if (!collectionId) {
      return res.status(400).json({ error: 'collectionId は数字で指定してください。' });
    }

    const tracks = await fetchITunesTracks(collectionId);
    res.json({ tracks });
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessage(err) || 'iTunesトラック取得エラー' });
  }
});

// Gemini AI CD Spine / Jacket Photo OCR API
app.post('/api/ocr', aiRateLimiter, async (req, res) => {
  try {
    const body = readInput(ocrBodySchema, req.body, res);
    if (!body) return;

    const ocrResult = await processCDImageOCR(body.imageBase64, body.mimeType || 'image/jpeg');
    res.json(ocrResult);
  } catch (err: unknown) {
    log.error('Error in /api/ocr:', err);
    res.status(500).json({ error: errorMessage(err) || 'AI画像解析中にエラーが発生しました。' });
  }
});

// Server-side API to lookup same-title LP / EP vinyl record release dates via MusicBrainz, Discogs, NDL, and Gemini
app.post('/api/lookup-vinyl-release', aiRateLimiter, async (req, res) => {
  try {
    const body = readInput(vinylLookupBodySchema, req.body, res);
    if (!body) return;

    const queries = body.items.map((item) => ({
      id: item.id,
      title: item.title || '',
      artist: item.artist || '',
      catalogNumber: item.catalogNumber || '',
      cdReleaseDate: item.releaseDate || '',
      discogsToken: body.discogsToken || item.discogsToken,
    }));

    const results = await lookupVinylReleaseDates(queries);
    res.json({ results });
  } catch (err: unknown) {
    log.error('Error in /api/lookup-vinyl-release:', err);
    res.status(500).json({ error: errorMessage(err) || 'LP/EPレコード発売日の取得中にエラーが発生しました。' });
  }
});

// Server-side Gemini AI Cover Art Upscaling & Enhancement
app.post('/api/upscale-jacket', aiRateLimiter, async (req, res) => {
  try {
    const body = readInput(upscaleBodySchema, req.body, res);
    if (!body) return;

    const result = await upscaleJacketImage(body.imageBase64, body.title, body.artist, body.catalogNumber);
    return res.status(200).json(result);
  } catch {
    log.info('Handled /api/upscale-jacket fallback.');
    return res.status(200).json({
      error: 'Gemini API利用制限のため、キャンバス高画質化フィルターを代替適用します。',
      isQuotaError: true,
    });
  }
});

// Server-side Gemini AI Auto-Tagging and Music Analysis
app.post('/api/ai-analyze-tags', aiRateLimiter, async (req, res) => {
  try {
    const body = readInput(aiAnalyzeTagsBodySchema, req.body, res);
    if (!body) return;

    const results = await analyzeCDTagsWithGemini(
      body.cds as unknown as Parameters<typeof analyzeCDTagsWithGemini>[0],
      body.options as Parameters<typeof analyzeCDTagsWithGemini>[1]
    );
    res.json({ results });
  } catch (err: unknown) {
    log.error('Error in /api/ai-analyze-tags:', err);
    res.status(500).json({ error: errorMessage(err) || 'AIタグ分析中にエラーが発生しました。' });
  }
});

// Server-side Gemini AI Auto-Backfill for missing CD metadata
app.post('/api/ai-backfill-metadata', aiRateLimiter, async (req, res) => {
  try {
    const body = readInput(aiBackfillBodySchema, req.body, res);
    if (!body) return;

    const results = await backfillCDMetadataWithGemini(body.cds as unknown as Parameters<typeof backfillCDMetadataWithGemini>[0]);
    res.json({ results });
  } catch (err: unknown) {
    log.error('Error in /api/ai-backfill-metadata:', err);
    res.status(500).json({ error: errorMessage(err) || 'Gemini APIによる自動補完処理に失敗しました' });
  }
});

// Gemini AI でタイトル・歌手名の読み仮名（ひらがな）を推定する（五十音順の並べ替え用）
app.post('/api/ai-readings', aiRateLimiter, async (req, res) => {
  try {
    const body = readInput(aiReadingsBodySchema, req.body, res);
    if (!body) return;

    const results = await generateReadingsWithGemini(body.items);
    res.json({ results });
  } catch (err: unknown) {
    log.error('Error in /api/ai-readings:', err);
    res.status(500).json({ error: errorMessage(err) || '読み仮名の生成に失敗しました' });
  }
});

// Server-side Image Proxy for external CDNs (Discogs, Cover Art Archive, Rakuten, etc.) with SSRF & SVG protection
app.get('/api/image-proxy', imageProxyRateLimiter, async (req, res) => {
  try {
    const query = readInput(imageProxyQuerySchema, req.query, res, true);
    if (!query) return;
    const imageUrl = query.url;

    // キャッシュ・同時リクエストの集約付き。ジャケット用途なので上限サイズ・待ち時間は短めにする
    const { buffer, mimeType } = await coverImageCache.getOrFetch(imageUrl, () =>
      fetchSafeExternalImage(imageUrl, { maxBytes: 5 * 1024 * 1024, timeoutMs: 8000 })
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
    );
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800, immutable');
    res.send(buffer);
  } catch (err: unknown) {
    res.status(400).send(errorMessage(err) || '画像プロキシ処理中にエラーが発生しました。');
  }
});

// Server-side Image to Base64 Data URL converter for external image links with SSRF & SVG protection
app.post('/api/image-base64', imageProxyRateLimiter, async (req, res) => {
  try {
    const body = readInput(imageBase64BodySchema, req.body, res);
    if (!body) return;
    const trimmedUrl = body.url.trim();
    if (trimmedUrl.startsWith('data:image/')) {
      const lowerData = trimmedUrl.slice(0, 64).toLowerCase();
      if (lowerData.includes('svg') || lowerData.includes('xml') || lowerData.includes('html')) {
        return res.status(400).json({ error: 'セキュリティ保護のため、SVG形式のデータURLは許可されていません。' });
      }
      return res.json({ dataUrl: trimmedUrl });
    }

    const { buffer, mimeType } = await fetchSafeExternalImage(trimmedUrl);
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    res.json({ dataUrl, mimeType });
  } catch (err: unknown) {
    res.status(400).json({ error: errorMessage(err) || '画像のBASE64変換中にエラーが発生しました。' });
  }
});

// Catch-all for any unmatched /api/* routes so they always return valid JSON instead of HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Setup Vite Dev Middleware or Static Production server
async function startServer() {
  const candidates = [
    path.resolve(__dirname, 'dist'),
    path.resolve(__dirname, '..', 'dist'),
    path.resolve(process.cwd(), 'dist'),
  ];
  const findDistDir = () =>
    candidates.find((d) => fs.existsSync(path.join(d, 'index.html'))) || candidates[0];

  const isDevMode =
    process.env.VITE_DEV_SERVER === 'true' ||
    process.env.NODE_ENV === 'development' ||
    !fs.existsSync(path.join(findDistDir(), 'index.html'));

  if (isDevMode) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: [
          'audio-cd-metadata-lookup-and-database.onrender.com',
          '.onrender.com',
          '.run.app',
        ],
      },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api')) {
        return next();
      }
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distDir = findDistDir();
    app.use(express.static(distDir));
    app.use('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      const currentDistDir = findDistDir();
      const indexHtmlPath = path.resolve(currentDistDir, 'index.html');
      if (fs.existsSync(indexHtmlPath)) {
        res.sendFile(indexHtmlPath);
      } else {
        const rootIndexHtml = path.resolve(__dirname, 'index.html');
        res.sendFile(rootIndexHtml);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    log.info(`CD Catalog App server listening on port ${PORT}`);
  });
}

startServer();
