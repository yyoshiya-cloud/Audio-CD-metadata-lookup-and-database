import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { performAggregatedSearch } from './server/search.js';
import { fetchITunesTracks } from './server/itunes.js';
import { processCDImageOCR } from './server/ocr.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '15mb' }));

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Aggregated Search API across MusicBrainz, Discogs, iTunes, and NDL
app.post('/api/search', async (req, res) => {
  try {
    const { catalogNumber, catno, title, artist, trackTitle, barcode, freeText, sources, apiKeys } = req.body || {};
    const effectiveCatno = catalogNumber || catno;
    
    if (!effectiveCatno && !title && !artist && !trackTitle && !barcode && !freeText) {
      return res.status(400).json({ error: '検索条件（型番、タイトル、歌手名、曲名、バーコード等）を入力してください。' });
    }

    const result = await performAggregatedSearch({
      catalogNumber: effectiveCatno,
      title,
      artist,
      trackTitle,
      barcode,
      freeText,
      sources,
      apiKeys,
    });

    res.json(result);
  } catch (err: any) {
    console.error('Error handling /api/search:', err);
    res.status(500).json({ error: err.message || 'メタデータ検索中にエラーが発生しました。' });
  }
});

// Fetch iTunes tracks on demand
app.get('/api/itunes/tracks', async (req, res) => {
  try {
    const collectionId = req.query.collectionId ? parseInt(req.query.collectionId as string, 10) : 0;
    if (!collectionId) {
      return res.status(400).json({ error: 'collectionId is required' });
    }

    const tracks = await fetchITunesTracks(collectionId);
    res.json({ tracks });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'iTunesトラック取得エラー' });
  }
});

// Gemini AI CD Spine / Jacket Photo OCR API
app.post('/api/ocr', async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: '画像データ(imageBase64)が必要です。' });
    }

    const ocrResult = await processCDImageOCR(imageBase64, mimeType || 'image/jpeg');
    res.json(ocrResult);
  } catch (err: any) {
    console.error('Error in /api/ocr:', err);
    res.status(500).json({ error: err.message || 'AI画像解析中にエラーが発生しました。' });
  }
});

import { analyzeCDTagsWithGemini } from './server/aiTagging.js';
import { backfillCDMetadataWithGemini } from './server/aiBackfill.js';
import { upscaleJacketImage } from './server/upscaleImage.js';
import { lookupVinylReleaseDates } from './server/vinylLookup.js';

// Server-side API to lookup same-title LP / EP vinyl record release dates via MusicBrainz, Discogs, NDL, and Gemini
app.post('/api/lookup-vinyl-release', async (req, res) => {
  try {
    const { items, discogsToken } = req.body || {};
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'LP/EP発売日を検索する対象のCD情報(items)が必要です。' });
    }

    const queries = items.map((item: any) => ({
      id: item.id,
      title: item.title || '',
      artist: item.artist || '',
      catalogNumber: item.catalogNumber || '',
      cdReleaseDate: item.releaseDate || '',
      discogsToken: discogsToken || item.discogsToken,
    }));

    const results = await lookupVinylReleaseDates(queries);
    res.json({ results });
  } catch (err: any) {
    console.error('Error in /api/lookup-vinyl-release:', err);
    res.status(500).json({ error: err.message || 'LP/EPレコード発売日の取得中にエラーが発生しました。' });
  }
});

// Server-side Gemini AI Cover Art Upscaling & Enhancement
app.post('/api/upscale-jacket', async (req, res) => {
  try {
    const { imageBase64, title, artist, catalogNumber } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: '画像URLまたは画像データ(imageBase64)が必要です。' });
    }

    const result = await upscaleJacketImage(imageBase64, title, artist, catalogNumber);
    return res.status(200).json(result);
  } catch (err: any) {
    console.log('Handled /api/upscale-jacket fallback.');
    return res.status(200).json({
      error: 'Gemini API利用制限のため、キャンバス高画質化フィルターを代替適用します。',
      isQuotaError: true,
    });
  }
});

// Server-side Gemini AI Auto-Tagging and Music Analysis
app.post('/api/ai-analyze-tags', async (req, res) => {
  try {
    const { cds, options } = req.body || {};
    if (!cds || !Array.isArray(cds) || cds.length === 0) {
      return res.status(400).json({ error: '分析対象のCDリスト(cds)が必要です。' });
    }

    const results = await analyzeCDTagsWithGemini(cds, options);
    res.json({ results });
  } catch (err: any) {
    console.error('Error in /api/ai-analyze-tags:', err);
    res.status(500).json({ error: err.message || 'AIタグ分析中にエラーが発生しました。' });
  }
});

// Server-side Gemini AI Auto-Backfill for missing CD metadata
app.post('/api/ai-backfill-metadata', async (req, res) => {
  try {
    const { cds } = req.body || {};
    if (!cds || !Array.isArray(cds) || cds.length === 0) {
      return res.status(400).json({ error: '補完対象のCDリスト(cds)が必要です。' });
    }

    const results = await backfillCDMetadataWithGemini(cds);
    res.json({ results });
  } catch (err: any) {
    console.error('Error in /api/ai-backfill-metadata:', err);
    res.status(500).json({ error: err.message || 'Gemini APIによる自動補完処理に失敗しました' });
  }
});

// Server-side Image Proxy for external CDNs (Discogs, Cover Art Archive, Rakuten, etc.)
app.get('/api/image-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url as string;
    if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
      return res.status(400).send('有効な画像URLを指定してください。');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': new URL(imageUrl).origin,
      },
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      return res.status(response.status).send(`画像取得エラー: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800, immutable');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    res.status(500).send(err.message || '画像プロキシ処理中にエラーが発生しました。');
  }
});

// Server-side Image to Base64 Data URL converter for external image links
app.post('/api/image-base64', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: '有効な画像URLを指定してください。' });
    }
    const trimmedUrl = url.trim();
    if (trimmedUrl.startsWith('data:image/')) {
      return res.json({ dataUrl: trimmedUrl });
    }
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'http:// または https:// で始まる有効な画像URLを指定してください。' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(trimmedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': new URL(trimmedUrl).origin,
      },
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      return res.status(response.status).json({ error: `画像取得エラー: HTTP ${response.status}` });
    }

    const rawContentType = response.headers.get('content-type') || 'image/jpeg';
    const mimeType = rawContentType.split(';')[0].trim() || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    res.json({ dataUrl, mimeType });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '画像のBASE64変換中にエラーが発生しました。' });
  }
});

// Setup Vite Dev Middleware or Static Production server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api')) {
        return next();
      }
      try {
        const fs = await import('fs');
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distDir = fs.existsSync(path.resolve(__dirname, '..', 'dist'))
      ? path.resolve(__dirname, '..', 'dist')
      : path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CD Catalog App server listening on port ${PORT}`);
  });
}

startServer();
