import type { CDMetadata } from '../types/cd';

/**
 * ライブラリ内で「データURL（base64）として埋め込まれている画像」が占める容量の目安。
 * 埋め込み画像は、読み込み・JSONバックアップ・メモリのすべてを重くする（約4/3倍の文字列になるため）。
 */
export interface ImageFootprint {
  /** データURLとして埋め込まれた画像の枚数 */
  embeddedCount: number;
  /** 埋め込み画像の文字数（≒ JSONバックアップ・メモリ上のサイズ）。バイト数の目安 */
  embeddedBytes: number;
  /** URL（http など）で参照している画像の枚数 */
  linkedCount: number;
  /** 埋め込み画像を含むCDの数 */
  cdsWithEmbedded: number;
}

const isDataUrl = (u?: string): u is string => typeof u === 'string' && u.startsWith('data:');

export function measureImageFootprint(cds: Pick<CDMetadata, 'coverUrl' | 'subImages'>[]): ImageFootprint {
  const out: ImageFootprint = { embeddedCount: 0, embeddedBytes: 0, linkedCount: 0, cdsWithEmbedded: 0 };
  for (const cd of cds) {
    const urls = [cd.coverUrl, ...(cd.subImages || []).map((s) => s?.imageUrl)];
    let hasEmbedded = false;
    for (const u of urls) {
      if (!u) continue;
      if (isDataUrl(u)) {
        out.embeddedCount++;
        out.embeddedBytes += u.length;
        hasEmbedded = true;
      } else {
        out.linkedCount++;
      }
    }
    if (hasEmbedded) out.cdsWithEmbedded++;
  }
  return out;
}
