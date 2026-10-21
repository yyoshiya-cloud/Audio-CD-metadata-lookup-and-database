/**
 * 各APIのリクエスト検証スキーマ（server/validate.ts の簡易スキーマ）。
 * 型・長さ・件数の上限をここで一括管理する。
 */
import { v } from './validate.js';

export const MAX_BATCH_ITEMS = 50;

const MAX_IMAGE_CHARS = 20_000_000; // base64 / data URL（約15MBの画像）
const text = (max: number) => v.optional(v.string({ max, allowEmpty: true, trim: false }));

/** POST /api/search */
export const searchBodySchema = v.object({
  catalogNumber: text(200),
  catno: text(200),
  title: text(200),
  artist: text(200),
  trackTitle: text(200),
  barcode: text(200),
  freeText: text(200),
  sources: v.optional(v.array(v.string({ max: 30 }), { max: 12 })),
  apiKeys: v.optional(v.limitedJSON(8_000)),
});

/** POST /api/ocr */
export const ocrBodySchema = v.object({
  imageBase64: v.string({ min: 1, max: MAX_IMAGE_CHARS, trim: false }),
  mimeType: v.optional(v.string({ max: 100 })),
});

/** POST /api/lookup-vinyl-release */
export const vinylLookupBodySchema = v.object({
  items: v.array(
    v.object({
      id: v.optional(v.string({ max: 200, allowEmpty: true })),
      title: text(500),
      artist: text(500),
      catalogNumber: text(200),
      releaseDate: text(100),
      discogsToken: text(500),
    }),
    { min: 1, max: MAX_BATCH_ITEMS }
  ),
  discogsToken: text(500),
});

/** POST /api/upscale-jacket */
export const upscaleBodySchema = v.object({
  imageBase64: v.string({ min: 1, max: MAX_IMAGE_CHARS, trim: false }),
  title: text(500),
  artist: text(500),
  catalogNumber: text(200),
});

const cdList = v.array(v.anyObject(500_000), { min: 1, max: MAX_BATCH_ITEMS });

/** POST /api/ai-analyze-tags */
export const aiAnalyzeTagsBodySchema = v.object({
  cds: cdList,
  options: v.optional(v.limitedJSON(4_000)),
});

/** POST /api/ai-backfill-metadata */
export const aiBackfillBodySchema = v.object({ cds: cdList });

/** GET /api/image-proxy （クエリ文字列） */
export const imageProxyQuerySchema = v.object({
  url: v.string({ min: 1, max: 2048 }),
});

/** POST /api/image-base64 */
export const imageBase64BodySchema = v.object({
  url: v.string({ min: 1, max: MAX_IMAGE_CHARS }),
});

/** GET /api/itunes/tracks （クエリ文字列） */
export const itunesTracksQuerySchema = v.object({
  collectionId: v.string({ min: 1, max: 20 }),
});
