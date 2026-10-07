import { jsPDF } from 'jspdf';
import { CDMetadata } from '../types/cd';
import { formatJSTTimestampCompact } from './dateUtils';
import { convertImageUrlToBase64 } from '../utils/imageEnhancer';

export type PDFLayoutMode = 'vinyl_sleeve' | 'catalog_grid' | 'obi_card';
export type PDFColorTheme = 'classic_ivory' | 'dark_studio' | 'pure_white';

export interface PDFCatalogOptions {
  layout: PDFLayoutMode;
  theme: PDFColorTheme;
  catalogTitle: string;
  catalogSubtitle: string;
  showTracklist: boolean;
  showBarcodeAndMeta: boolean;
  showVinylDiscGraphic: boolean;
  showObiStrip: boolean;
  itemsPerPage?: number; // For catalog_grid: 6 or 8; for vinyl_sleeve: 1 or 2; for obi_card: 4
}

interface ThemePalette {
  pageBg: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentBg: string;
  obiBg: string;
  obiText: string;
  obiAccent: string;
  divider: string;
  trackRowAlt: string;
}

const THEME_PALETTES: Record<PDFColorTheme, ThemePalette> = {
  classic_ivory: {
    pageBg: '#F7F4EC',
    cardBg: '#FFFDF8',
    cardBorder: '#D5CFC0',
    textPrimary: '#1C1917',
    textSecondary: '#44403C',
    textMuted: '#78716C',
    accent: '#991B1B',
    accentBg: '#FEF2F2',
    obiBg: '#1C1917',
    obiText: '#FAF8F5',
    obiAccent: '#DC2626',
    divider: '#E7E2D8',
    trackRowAlt: '#F3EFE6',
  },
  dark_studio: {
    pageBg: '#0F172A',
    cardBg: '#1E293B',
    cardBorder: '#334155',
    textPrimary: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textMuted: '#94A3B8',
    accent: '#818CF8',
    accentBg: '#1E1B4B',
    obiBg: '#312E81',
    obiText: '#FFFFFF',
    obiAccent: '#F59E0B',
    divider: '#334155',
    trackRowAlt: '#162032',
  },
  pure_white: {
    pageBg: '#FFFFFF',
    cardBg: '#FFFFFF',
    cardBorder: '#CBD5E1',
    textPrimary: '#0F172A',
    textSecondary: '#334155',
    textMuted: '#64748B',
    accent: '#2563EB',
    accentBg: '#EFF6FF',
    obiBg: '#0F172A',
    obiText: '#FFFFFF',
    obiAccent: '#3B82F6',
    divider: '#E2E8F0',
    trackRowAlt: '#F8FAFC',
  },
};

const FONT_STACK = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif';
const SERIF_STACK = '"Hiragino Mincho ProN", "Yu Mincho", "MS PMincho", "Noto Serif JP", serif';
const MONO_STACK = '"JetBrains Mono", "Consolas", "Courier New", monospace';

// A4 Portrait at 200 DPI: 1654 x 2339 px
const PAGE_WIDTH = 1654;
const PAGE_HEIGHT = 2339;

/**
 * Load an HTMLImageElement from a Base64 Data URL or external URL safely
 */
async function loadImageSafe(coverUrl?: string): Promise<HTMLImageElement | null> {
  if (!coverUrl || !coverUrl.trim()) return null;
  let targetSrc = coverUrl.trim();

  if (!targetSrc.startsWith('data:image/')) {
    try {
      const converted = await convertImageUrlToBase64(targetSrc, 700, 0.88);
      if (converted && converted.startsWith('data:image/')) {
        targetSrc = converted;
      }
    } catch {}
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = targetSrc;
  });
}

/**
 * Helper to draw rounded rectangle
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Truncate text with ellipsis to fit within maxWidth
 */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

/**
 * Draw realistic vinyl record disc peeking out from the right of the jacket
 */
function drawVinylDisc(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  accentColor: string,
  coverImg: HTMLImageElement | null
) {
  ctx.save();

  // Drop shadow for vinyl
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 6;

  // Main black vinyl body
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#111113';
  ctx.fill();
  ctx.restore();

  // Specular sheen highlight (conic/diagonal light reflection)
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - 2, 0, Math.PI * 2);
  ctx.clip();

  const grad = ctx.createLinearGradient(
    centerX - radius,
    centerY - radius,
    centerX + radius,
    centerY + radius
  );
  grad.addColorStop(0, 'rgba(255,255,255,0.02)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.03)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  grad.addColorStop(0.58, 'rgba(255,255,255,0.03)');
  grad.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.fillStyle = grad;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

  // Concentric micro-grooves
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1.2;
  for (let r = radius * 0.38; r < radius * 0.95; r += radius * 0.055) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center label
  const labelRadius = radius * 0.33;
  ctx.beginPath();
  ctx.arc(centerX, centerY, labelRadius, 0, Math.PI * 2);
  ctx.fillStyle = accentColor;
  ctx.fill();

  if (coverImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, labelRadius - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(
      coverImg,
      centerX - labelRadius,
      centerY - labelRadius,
      labelRadius * 2,
      labelRadius * 2
    );
    ctx.restore();
  }

  // Gold/white ring on center label
  ctx.beginPath();
  ctx.arc(centerX, centerY, labelRadius * 0.82, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Center spindle hole
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = '#F7F4EC';
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw square album jacket with subtle paper sleeve texture, spine shadow, and optional Japanese Obi strip
 */
function drawJacketWithSleeve(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  cd: CDMetadata,
  coverImg: HTMLImageElement | null,
  palette: ThemePalette,
  options: PDFCatalogOptions
) {
  // Optional peeking vinyl disc on right side
  if (options.showVinylDiscGraphic) {
    const discRadius = size * 0.46;
    drawVinylDisc(
      ctx,
      x + size * 0.76,
      y + size * 0.5,
      discRadius,
      palette.accent,
      coverImg
    );
  }

  // Outer jacket shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.32)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 8;
  drawRoundedRect(ctx, x, y, size, size, 6);
  ctx.fillStyle = '#18181B';
  ctx.fill();
  ctx.restore();

  // Clip jacket square
  ctx.save();
  drawRoundedRect(ctx, x, y, size, size, 6);
  ctx.clip();

  if (coverImg) {
    ctx.drawImage(coverImg, x, y, size, size);
  } else {
    // Classic analog placeholder jacket
    const bgGrad = ctx.createLinearGradient(x, y, x + size, y + size);
    bgGrad.addColorStop(0, '#1E293B');
    bgGrad.addColorStop(1, '#0F172A');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(x, y, size, size);

    drawVinylDisc(ctx, x + size / 2, y + size / 2, size * 0.36, palette.accent, null);

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `bold ${Math.round(size * 0.055)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(
      fitText(ctx, cd.title || 'NO JACKET IMAGE', size * 0.8),
      x + size / 2,
      y + size * 0.88
    );
    ctx.textAlign = 'left';
  }

  // Japanese Analog OBI Strip (帯) on left side of jacket
  if (options.showObiStrip) {
    const obiWidth = Math.round(size * 0.17);
    const obiX = x + Math.round(size * 0.04);

    // Obi background
    ctx.fillStyle = palette.obiBg;
    ctx.fillRect(obiX, y, obiWidth, size);

    // Top accent cap on Obi
    const capH = Math.round(size * 0.14);
    ctx.fillStyle = palette.obiAccent;
    ctx.fillRect(obiX, y, obiWidth, capH);

    // STEREO / 33⅓ RPM text in top cap
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.max(10, Math.round(obiWidth * 0.21))}px ${MONO_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText('STEREO', obiX + obiWidth / 2, y + capH * 0.45);
    ctx.font = `bold ${Math.max(9, Math.round(obiWidth * 0.17))}px ${MONO_STACK}`;
    ctx.fillText('CD / LP', obiX + obiWidth / 2, y + capH * 0.78);

    // Catalog Number horizontal bar in Obi
    ctx.fillStyle = palette.obiText;
    ctx.font = `bold ${Math.max(9, Math.round(obiWidth * 0.16))}px ${MONO_STACK}`;
    const catShort = (cd.catalogNumber || 'COLLECTION').slice(0, 10);
    ctx.fillText(catShort, obiX + obiWidth / 2, y + size * 0.94);

    // Vertical-style Japanese title characters down the center of the Obi strip
    const verticalChars = (cd.title || '').replace(/\s+/g, '').slice(0, 9).split('');
    const charSize = Math.max(11, Math.round(obiWidth * 0.34));
    ctx.font = `bold ${charSize}px ${SERIF_STACK}`;
    ctx.fillStyle = palette.obiText;
    const startY = y + capH + charSize * 1.25;
    const availH = size - capH - size * 0.14;
    const stepY = Math.min(charSize * 1.22, availH / Math.max(1, verticalChars.length));

    verticalChars.forEach((ch, idx) => {
      const drawCh = ch === 'ー' || ch === '-' ? '｜' : ch;
      ctx.fillText(drawCh, obiX + obiWidth / 2, startY + idx * stepY);
    });

    // Side gold/white thin rules on Obi
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(obiX + 2, y + 2, obiWidth - 4, size - 4);
    ctx.textAlign = 'left';
  }

  // Subtle paper sleeve spine crease & ring-wear sheen overlay
  const creaseGrad = ctx.createLinearGradient(x, y, x + size * 0.06, y);
  creaseGrad.addColorStop(0, 'rgba(0,0,0,0.35)');
  creaseGrad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  creaseGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = creaseGrad;
  ctx.fillRect(x, y, size * 0.06, size);

  // Subtle outer frame border
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

  ctx.restore();
}

/**
 * Draw Page Header & Footer on A4 Canvas
 */
function drawPageHeaderAndFooter(
  ctx: CanvasRenderingContext2D,
  pageNumber: number,
  totalPages: number,
  totalCDs: number,
  palette: ThemePalette,
  options: PDFCatalogOptions
) {
  const marginX = 76;

  // Page Background
  ctx.fillStyle = palette.pageBg;
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  // Header Top Accent Line
  ctx.fillStyle = palette.accent;
  ctx.fillRect(marginX, 52, PAGE_WIDTH - marginX * 2, 5);

  // Header Title (Left)
  ctx.fillStyle = palette.textPrimary;
  ctx.font = `bold 34px ${SERIF_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText(options.catalogTitle || 'CD COLLECTION ARCHIVE CATALOG', marginX, 102);

  // Header Subtitle
  ctx.fillStyle = palette.textMuted;
  ctx.font = `600 18px ${FONT_STACK}`;
  ctx.fillText(
    options.catalogSubtitle || `収録アルバム全 ${totalCDs} 枚 ・ アナログジャケット風アーカイブカタログ`,
    marginX,
    132
  );

  // Header Right Stamp Badge
  ctx.textAlign = 'right';
  ctx.fillStyle = palette.accent;
  ctx.font = `bold 18px ${MONO_STACK}`;
  ctx.fillText('HIGH-FIDELITY DISC ARCHIVE', PAGE_WIDTH - marginX, 95);

  ctx.fillStyle = palette.textMuted;
  ctx.font = `500 16px ${MONO_STACK}`;
  const dateStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  ctx.fillText(`ISSUED: ${dateStr}  |  TOTAL: ${totalCDs} DISCS`, PAGE_WIDTH - marginX, 125);

  // Header Bottom Divider
  ctx.strokeStyle = palette.cardBorder;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(marginX, 150);
  ctx.lineTo(PAGE_WIDTH - marginX, 150);
  ctx.stroke();

  // Footer Divider
  const footerY = PAGE_HEIGHT - 74;
  ctx.strokeStyle = palette.cardBorder;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(marginX, footerY);
  ctx.lineTo(PAGE_WIDTH - marginX, footerY);
  ctx.stroke();

  // Footer Left
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.textMuted;
  ctx.font = `500 16px ${FONT_STACK}`;
  ctx.fillText('CD メタデータ検索＆データベース — 印刷用アナログジャケット風カタログ', marginX, footerY + 32);

  // Footer Right (Page Number)
  ctx.textAlign = 'right';
  ctx.fillStyle = palette.textPrimary;
  ctx.font = `bold 18px ${MONO_STACK}`;
  ctx.fillText(`PAGE ${pageNumber} / ${totalPages}`, PAGE_WIDTH - marginX, footerY + 32);
  ctx.textAlign = 'left';
}

/**
 * MODE 1: Vinyl Sleeve & Liner Notes Layout (2 Albums per A4 Page)
 * Large analog jacket + vinyl disc + full liner notes + 2-column tracklist
 */
function renderVinylSleevePage(
  ctx: CanvasRenderingContext2D,
  pageItems: { cd: CDMetadata; img: HTMLImageElement | null; globalIndex: number }[],
  palette: ThemePalette,
  options: PDFCatalogOptions
) {
  const marginX = 76;
  const startY = 178;
  const contentWidth = PAGE_WIDTH - marginX * 2;
  const cardHeight = 1015;
  const cardGap = 36;

  pageItems.forEach(({ cd, img, globalIndex }, idx) => {
    const cardY = startY + idx * (cardHeight + cardGap);

    // Card Container
    ctx.save();
    drawRoundedRect(ctx, marginX, cardY, contentWidth, cardHeight, 16);
    ctx.fillStyle = palette.cardBg;
    ctx.fill();
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Top-left Archive Index Ribbon
    ctx.fillStyle = palette.accent;
    drawRoundedRect(ctx, marginX + 28, cardY + 24, 150, 38, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 20px ${MONO_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(`ARCHIVE #${String(globalIndex).padStart(3, '0')}`, marginX + 103, cardY + 50);
    ctx.textAlign = 'left';

    // Catalog Number & Barcode Header on Right
    ctx.fillStyle = palette.accent;
    ctx.font = `bold 24px ${MONO_STACK}`;
    ctx.fillText(cd.catalogNumber || 'CAT.NO UNSET', marginX + 196, cardY + 51);

    if (options.showBarcodeAndMeta) {
      ctx.textAlign = 'right';
      ctx.fillStyle = palette.textMuted;
      ctx.font = `600 18px ${MONO_STACK}`;
      const metaParts: string[] = [];
      if (cd.releaseDate) metaParts.push(`RELEASE: ${cd.releaseDate}`);
      if (cd.barcode) metaParts.push(`JAN: ${cd.barcode}`);
      if (cd.format) metaParts.push(`FMT: ${cd.format}`);
      ctx.fillText(metaParts.join('   |   '), marginX + contentWidth - 32, cardY + 50);
      ctx.textAlign = 'left';
    }

    // Horizontal rule inside card
    ctx.strokeStyle = palette.divider;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX + 28, cardY + 76);
    ctx.lineTo(marginX + contentWidth - 28, cardY + 76);
    ctx.stroke();

    // Left Column: Analog Jacket & Peeking Vinyl
    const jacketSize = 420;
    const jacketX = marginX + 34;
    const jacketY = cardY + 102;
    drawJacketWithSleeve(ctx, jacketX, jacketY, jacketSize, cd, img, palette, options);

    // Under Jacket: Spec Sheet Box (Analog Liner Note style)
    const specBoxY = jacketY + jacketSize + 24;
    const specBoxW = options.showVinylDiscGraphic ? jacketSize + 100 : jacketSize;
    const specBoxH = cardY + cardHeight - specBoxY - 26;

    drawRoundedRect(ctx, jacketX, specBoxY, specBoxW, specBoxH, 10);
    ctx.fillStyle = palette.trackRowAlt;
    ctx.fill();
    ctx.strokeStyle = palette.divider;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = palette.accent;
    ctx.font = `bold 17px ${MONO_STACK}`;
    ctx.fillText('■ SPECIFICATION / LINER NOTES', jacketX + 18, specBoxY + 30);

    const specs = [
      { label: '規格品番 (CAT NO.)', value: cd.catalogNumber || '-' },
      { label: 'レーベル (LABEL)', value: cd.label || '-' },
      { label: '発売日 (RELEASE)', value: cd.releaseDate || '-' },
      { label: 'JAN / EAN コード', value: cd.barcode || '-' },
      { label: 'ジャンル / タグ', value: [cd.genre, ...(cd.tags || [])].filter(Boolean).join(', ') || '-' },
    ];

    specs.forEach((sp, sIdx) => {
      const rowY = specBoxY + 64 + sIdx * 42;
      ctx.fillStyle = palette.textMuted;
      ctx.font = `bold 15px ${FONT_STACK}`;
      ctx.fillText(sp.label, jacketX + 18, rowY);

      ctx.fillStyle = palette.textPrimary;
      ctx.font = `600 16px ${FONT_STACK}`;
      ctx.fillText(fitText(ctx, sp.value, specBoxW - 205), jacketX + 190, rowY);
    });

    if (cd.notes) {
      const noteY = specBoxY + 64 + specs.length * 42 + 8;
      if (noteY < specBoxY + specBoxH - 16) {
        ctx.fillStyle = palette.textSecondary;
        ctx.font = `italic 15px ${FONT_STACK}`;
        ctx.fillText(fitText(ctx, `Memo: ${cd.notes}`, specBoxW - 36), jacketX + 18, noteY);
      }
    }

    // Right Column: Title, Artist & Complete Tracklist
    const rightX = jacketX + (options.showVinylDiscGraphic ? jacketSize + 130 : jacketSize + 40);
    const rightW = marginX + contentWidth - rightX - 32;

    // Album Title
    ctx.fillStyle = palette.textPrimary;
    ctx.font = `bold 32px ${SERIF_STACK}`;
    ctx.fillText(fitText(ctx, cd.title || 'Untitled Album', rightW), rightX, cardY + 128);

    // Artist Name
    ctx.fillStyle = palette.textSecondary;
    ctx.font = `bold 23px ${FONT_STACK}`;
    ctx.fillText(fitText(ctx, cd.artist || 'Unknown Artist', rightW), rightX, cardY + 166);

    // Label & Track Count Pill
    ctx.fillStyle = palette.accent;
    ctx.font = `bold 16px ${MONO_STACK}`;
    const trackCount = cd.tracks ? cd.tracks.length : 0;
    ctx.fillText(
      `LABEL: ${cd.label || 'INDEPENDENT'}   •   TOTAL TRACKS: ${trackCount} TRACKS`,
      rightX,
      cardY + 198
    );

    // Divider before Tracklist
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rightX, cardY + 214);
    ctx.lineTo(rightX + rightW, cardY + 214);
    ctx.stroke();

    // Tracklist Section
    if (options.showTracklist) {
      const tracks = cd.tracks || [];
      const trackStartY = cardY + 246;
      const availTrackH = cardY + cardHeight - trackStartY - 24;

      if (tracks.length === 0) {
        ctx.fillStyle = palette.textMuted;
        ctx.font = `italic 18px ${FONT_STACK}`;
        ctx.fillText('収録曲データ未登録', rightX, trackStartY + 30);
      } else {
        // Use 1 column if <= 12 tracks, 2 columns if > 12 tracks (up to 32 tracks displayed cleanly)
        const useTwoCols = tracks.length > 12;
        const maxRowsPerCol = useTwoCols ? 16 : 12;
        const maxDisplayTracks = useTwoCols ? 32 : 12;
        const colW = useTwoCols ? (rightW - 24) / 2 : rightW;
        const rowH = Math.min(44, Math.floor(availTrackH / Math.min(maxRowsPerCol, Math.ceil(tracks.length / (useTwoCols ? 2 : 1)))));

        tracks.slice(0, maxDisplayTracks).forEach((tr, tIdx) => {
          const colIdx = useTwoCols ? Math.floor(tIdx / maxRowsPerCol) : 0;
          const rowIdx = useTwoCols ? tIdx % maxRowsPerCol : tIdx;
          const tx = rightX + colIdx * (colW + 24);
          const ty = trackStartY + rowIdx * rowH;

          if (rowIdx % 2 === 0) {
            drawRoundedRect(ctx, tx, ty - rowH * 0.68, colW, rowH - 4, 5);
            ctx.fillStyle = palette.trackRowAlt;
            ctx.fill();
          }

          // Track Number
          const numStr = String(tr.trackNumber || tIdx + 1).padStart(2, '0') + '.';
          ctx.fillStyle = palette.accent;
          ctx.font = `bold ${useTwoCols ? 15 : 17}px ${MONO_STACK}`;
          ctx.fillText(numStr, tx + 10, ty);

          // Duration on right of column
          const durStr = tr.duration || '';
          let durWidth = 0;
          if (durStr) {
            ctx.fillStyle = palette.textMuted;
            ctx.font = `500 ${useTwoCols ? 14 : 16}px ${MONO_STACK}`;
            durWidth = ctx.measureText(durStr).width + 16;
            ctx.textAlign = 'right';
            ctx.fillText(durStr, tx + colW - 10, ty);
            ctx.textAlign = 'left';
          }

          // Track Title
          ctx.fillStyle = palette.textPrimary;
          ctx.font = `500 ${useTwoCols ? 15 : 17}px ${FONT_STACK}`;
          const maxTitleW = colW - 55 - durWidth;
          ctx.fillText(fitText(ctx, tr.title, maxTitleW), tx + 48, ty);
        });

        if (tracks.length > maxDisplayTracks) {
          ctx.fillStyle = palette.textMuted;
          ctx.font = `italic 15px ${FONT_STACK}`;
          ctx.fillText(
            `+ 他 ${tracks.length - maxDisplayTracks} 曲収録 (全 ${tracks.length} 曲)`,
            rightX,
            cardY + cardHeight - 16
          );
        }
      }
    }

    ctx.restore();
  });
}

/**
 * MODE 2: Analog Jacket Grid Catalog (6 Albums per A4 Page: 2 cols x 3 rows)
 */
function renderCatalogGridPage(
  ctx: CanvasRenderingContext2D,
  pageItems: { cd: CDMetadata; img: HTMLImageElement | null; globalIndex: number }[],
  palette: ThemePalette,
  options: PDFCatalogOptions
) {
  const marginX = 76;
  const startY = 176;
  const contentWidth = PAGE_WIDTH - marginX * 2;
  const cols = 2;
  const rows = 3;
  const gapX = 32;
  const gapY = 28;
  const cardW = Math.floor((contentWidth - gapX) / cols);
  const cardH = Math.floor((PAGE_HEIGHT - startY - 96 - gapY * (rows - 1)) / rows);

  pageItems.forEach(({ cd, img, globalIndex }, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const cardX = marginX + col * (cardW + gapX);
    const cardY = startY + row * (cardH + gapY);

    ctx.save();
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 14);
    ctx.fillStyle = palette.cardBg;
    ctx.fill();
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top Section of Card: Jacket on Left + Primary Meta on Right
    const jacketSize = 250;
    const jX = cardX + 22;
    const jY = cardY + 22;

    drawJacketWithSleeve(ctx, jX, jY, jacketSize, cd, img, palette, {
      ...options,
      showVinylDiscGraphic: options.showVinylDiscGraphic,
    });

    const infoX = jX + (options.showVinylDiscGraphic ? jacketSize + 74 : jacketSize + 24);
    const infoW = cardX + cardW - infoX - 20;

    // Index + Catalog Number Badge
    ctx.fillStyle = palette.accent;
    ctx.font = `bold 17px ${MONO_STACK}`;
    ctx.fillText(
      fitText(ctx, `#${String(globalIndex).padStart(3, '0')}  ${cd.catalogNumber || 'NO CAT.NO'}`, infoW),
      infoX,
      jY + 26
    );

    // Title (up to 2 lines or fitted)
    ctx.fillStyle = palette.textPrimary;
    ctx.font = `bold 22px ${SERIF_STACK}`;
    ctx.fillText(fitText(ctx, cd.title || 'Untitled', infoW), infoX, jY + 64);

    // Artist
    ctx.fillStyle = palette.textSecondary;
    ctx.font = `bold 18px ${FONT_STACK}`;
    ctx.fillText(fitText(ctx, cd.artist || 'Unknown Artist', infoW), infoX, jY + 98);

    // Metadata list
    ctx.fillStyle = palette.textMuted;
    ctx.font = `500 15px ${FONT_STACK}`;
    const metaLines = [
      `レーベル: ${cd.label || '-'}`,
      `発売日: ${cd.releaseDate || '-'}`,
      `JAN: ${cd.barcode || '-'}`,
      `収録曲数: ${cd.tracks ? cd.tracks.length : 0} 曲`,
    ];
    metaLines.forEach((line, mIdx) => {
      ctx.fillText(fitText(ctx, line, infoW), infoX, jY + 136 + mIdx * 28);
    });

    // Tags
    if (cd.tags && cd.tags.length > 0) {
      ctx.fillStyle = palette.accent;
      ctx.font = `600 14px ${FONT_STACK}`;
      ctx.fillText(
        fitText(ctx, cd.tags.map((t) => `#${t}`).join('  '), infoW),
        infoX,
        jY + 250
      );
    }

    // Bottom Section of Card: Tracklist Preview (2 columns)
    const dividerY = jY + jacketSize + 18;
    ctx.strokeStyle = palette.divider;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cardX + 20, dividerY);
    ctx.lineTo(cardX + cardW - 20, dividerY);
    ctx.stroke();

    if (options.showTracklist) {
      const tracks = cd.tracks || [];
      const tStartY = dividerY + 28;
      const innerW = cardW - 44;
      const colW = (innerW - 20) / 2;
      const maxTracks = 16; // 8 rows x 2 cols

      if (tracks.length === 0) {
        ctx.fillStyle = palette.textMuted;
        ctx.font = `italic 15px ${FONT_STACK}`;
        ctx.fillText('収録曲リスト未登録', cardX + 24, tStartY + 10);
      } else {
        tracks.slice(0, maxTracks).forEach((tr, tIdx) => {
          const tCol = Math.floor(tIdx / 8);
          const tRow = tIdx % 8;
          const tx = cardX + 22 + tCol * (colW + 20);
          const ty = tStartY + tRow * 38;

          if (tRow % 2 === 0) {
            drawRoundedRect(ctx, tx, ty - 24, colW, 33, 4);
            ctx.fillStyle = palette.trackRowAlt;
            ctx.fill();
          }

          ctx.fillStyle = palette.accent;
          ctx.font = `bold 14px ${MONO_STACK}`;
          ctx.fillText(`${String(tr.trackNumber || tIdx + 1).padStart(2, '0')}.`, tx + 6, ty);

          const dur = tr.duration || '';
          let durW = 0;
          if (dur) {
            ctx.fillStyle = palette.textMuted;
            ctx.font = `500 13px ${MONO_STACK}`;
            durW = ctx.measureText(dur).width + 10;
            ctx.textAlign = 'right';
            ctx.fillText(dur, tx + colW - 6, ty);
            ctx.textAlign = 'left';
          }

          ctx.fillStyle = palette.textPrimary;
          ctx.font = `500 14px ${FONT_STACK}`;
          ctx.fillText(fitText(ctx, tr.title, colW - 42 - durW), tx + 38, ty);
        });

        if (tracks.length > maxTracks) {
          ctx.fillStyle = palette.textMuted;
          ctx.font = `italic 13px ${FONT_STACK}`;
          ctx.textAlign = 'right';
          ctx.fillText(
            `...他 ${tracks.length - maxTracks} 曲 (全 ${tracks.length} 曲)`,
            cardX + cardW - 22,
            cardY + cardH - 12
          );
          ctx.textAlign = 'left';
        }
      }
    }

    ctx.restore();
  });
}

/**
 * MODE 3: Cut-out CD Case Insert / Japanese Obi Archival Card (4 Cards per A4 Page: 2x2)
 * Designed for physical CD/vinyl shelf indexing or jewel-case insert cards with crop marks
 */
function renderObiInsertCardPage(
  ctx: CanvasRenderingContext2D,
  pageItems: { cd: CDMetadata; img: HTMLImageElement | null; globalIndex: number }[],
  palette: ThemePalette,
  options: PDFCatalogOptions
) {
  const marginX = 90;
  const startY = 190;
  const contentWidth = PAGE_WIDTH - marginX * 2;
  const cols = 2;
  const rows = 2;
  const gapX = 56;
  const gapY = 56;
  const cardW = Math.floor((contentWidth - gapX) / cols);
  const cardH = Math.floor((PAGE_HEIGHT - startY - 110 - gapY) / rows);

  pageItems.forEach(({ cd, img, globalIndex }, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const cardX = marginX + col * (cardW + gapX);
    const cardY = startY + row * (cardH + gapY);

    ctx.save();

    // Crop marks (トンボ) around each card for physical cutting
    ctx.strokeStyle = palette.textMuted;
    ctx.lineWidth = 1.5;
    const cropLen = 16;
    // Top-left crop mark
    ctx.beginPath();
    ctx.moveTo(cardX - cropLen, cardY);
    ctx.lineTo(cardX - 4, cardY);
    ctx.moveTo(cardX, cardY - cropLen);
    ctx.lineTo(cardX, cardY - 4);
    // Top-right crop mark
    ctx.moveTo(cardX + cardW + 4, cardY);
    ctx.lineTo(cardX + cardW + cropLen, cardY);
    ctx.moveTo(cardX + cardW, cardY - cropLen);
    ctx.lineTo(cardX + cardW, cardY - 4);
    // Bottom-left crop mark
    ctx.moveTo(cardX - cropLen, cardY + cardH);
    ctx.lineTo(cardX - 4, cardY + cardH);
    ctx.moveTo(cardX, cardY + cardH + 4);
    ctx.lineTo(cardX, cardY + cardH + cropLen);
    // Bottom-right crop mark
    ctx.moveTo(cardX + cardW + 4, cardY + cardH);
    ctx.lineTo(cardX + cardW + cropLen, cardY + cardH);
    ctx.moveTo(cardX + cardW, cardY + cardH + 4);
    ctx.lineTo(cardX + cardW, cardY + cardH + cropLen);
    ctx.stroke();

    // Card Body
    ctx.fillStyle = palette.cardBg;
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(cardX, cardY, cardW, cardH);

    // Left Japanese Analog Obi Spine Strip (Full height of card)
    const obiStripW = 115;
    ctx.fillStyle = palette.obiBg;
    ctx.fillRect(cardX, cardY, obiStripW, cardH);

    // Top Red/Accent Cap on Obi
    ctx.fillStyle = palette.obiAccent;
    ctx.fillRect(cardX, cardY, obiStripW, 110);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 20px ${MONO_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText('STEREO', cardX + obiStripW / 2, cardY + 42);
    ctx.font = `bold 15px ${MONO_STACK}`;
    ctx.fillText(`#${String(globalIndex).padStart(3, '0')}`, cardX + obiStripW / 2, cardY + 72);
    ctx.font = `500 13px ${MONO_STACK}`;
    ctx.fillText('33⅓ / CD', cardX + obiStripW / 2, cardY + 96);

    // Vertical Japanese Title on Obi
    const vChars = (cd.title || '').replace(/\s+/g, '').slice(0, 14).split('');
    const vCharSize = 26;
    ctx.font = `bold ${vCharSize}px ${SERIF_STACK}`;
    ctx.fillStyle = palette.obiText;
    const vStartY = cardY + 150;
    const vStep = Math.min(34, (cardH - 260) / Math.max(1, vChars.length));
    vChars.forEach((ch, cIdx) => {
      const drawCh = ch === 'ー' || ch === '-' ? '｜' : ch;
      ctx.fillText(drawCh, cardX + obiStripW / 2, vStartY + cIdx * vStep);
    });

    // Bottom Catalog Number on Obi
    ctx.fillStyle = palette.obiAccent;
    ctx.fillRect(cardX + 10, cardY + cardH - 92, obiStripW - 20, 74);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 14px ${MONO_STACK}`;
    const catParts = (cd.catalogNumber || 'CAT-NO').split('-');
    ctx.fillText(catParts[0] || '', cardX + obiStripW / 2, cardY + cardH - 58);
    if (catParts[1]) {
      ctx.fillText(catParts.slice(1).join('-'), cardX + obiStripW / 2, cardY + cardH - 34);
    }
    ctx.textAlign = 'left';

    // Main Right Content Area of Insert Card
    const mainX = cardX + obiStripW + 24;
    const mainW = cardW - obiStripW - 48;

    // Large Square Jacket Cover
    const jacketSize = 360;
    const jacketX = mainX + (options.showVinylDiscGraphic ? 10 : Math.floor((mainW - jacketSize) / 2));
    const jacketY = cardY + 26;

    drawJacketWithSleeve(ctx, jacketX, jacketY, jacketSize, cd, img, palette, {
      ...options,
      showObiStrip: false, // Already has full card Obi strip on the left
    });

    // Title & Artist below Jacket
    const textTopY = jacketY + jacketSize + 38;
    ctx.fillStyle = palette.textPrimary;
    ctx.font = `bold 24px ${SERIF_STACK}`;
    ctx.fillText(fitText(ctx, cd.title || 'Untitled', mainW), mainX, textTopY);

    ctx.fillStyle = palette.textSecondary;
    ctx.font = `bold 18px ${FONT_STACK}`;
    ctx.fillText(fitText(ctx, cd.artist || 'Unknown Artist', mainW), mainX, textTopY + 32);

    ctx.fillStyle = palette.textMuted;
    ctx.font = `600 14px ${MONO_STACK}`;
    ctx.fillText(
      fitText(
        ctx,
        `${cd.catalogNumber || '-'}  |  ${cd.label || '-'}  |  ${cd.releaseDate || '-'}`,
        mainW
      ),
      mainX,
      textTopY + 60
    );

    // Divider
    ctx.strokeStyle = palette.divider;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mainX, textTopY + 76);
    ctx.lineTo(mainX + mainW, textTopY + 76);
    ctx.stroke();

    // Tracklist on Insert Card
    if (options.showTracklist) {
      const tracks = cd.tracks || [];
      const trStartY = textTopY + 104;
      const maxTracks = 14;
      const colW = (mainW - 16) / 2;

      tracks.slice(0, maxTracks).forEach((tr, tIdx) => {
        const tCol = Math.floor(tIdx / 7);
        const tRow = tIdx % 7;
        const tx = mainX + tCol * (colW + 16);
        const ty = trStartY + tRow * 36;

        ctx.fillStyle = palette.accent;
        ctx.font = `bold 13px ${MONO_STACK}`;
        ctx.fillText(`${String(tr.trackNumber || tIdx + 1).padStart(2, '0')}.`, tx, ty);

        ctx.fillStyle = palette.textPrimary;
        ctx.font = `500 13.5px ${FONT_STACK}`;
        ctx.fillText(fitText(ctx, tr.title, colW - 34), tx + 30, ty);
      });

      if (tracks.length > maxTracks) {
        ctx.fillStyle = palette.textMuted;
        ctx.font = `italic 12px ${FONT_STACK}`;
        ctx.fillText(
          `+ 他 ${tracks.length - maxTracks} 曲 (全 ${tracks.length} 曲)`,
          mainX,
          cardY + cardH - 16
        );
      }
    }

    ctx.restore();
  });
}

/**
 * Render a single A4 page canvas for preview or PDF compilation
 */
export async function renderCatalogPageToCanvas(
  cds: CDMetadata[],
  pageIndex: number,
  totalPages: number,
  totalCDsCount: number,
  itemsPerPage: number,
  options: PDFCatalogOptions
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const palette = THEME_PALETTES[options.theme] || THEME_PALETTES.classic_ivory;

  drawPageHeaderAndFooter(
    ctx,
    pageIndex + 1,
    totalPages,
    totalCDsCount,
    palette,
    options
  );

  const pageSlice = cds.slice(pageIndex * itemsPerPage, (pageIndex + 1) * itemsPerPage);
  const loadedItems = await Promise.all(
    pageSlice.map(async (cd, idx) => ({
      cd,
      img: await loadImageSafe(cd.coverUrl),
      globalIndex: pageIndex * itemsPerPage + idx + 1,
    }))
  );

  if (options.layout === 'vinyl_sleeve') {
    renderVinylSleevePage(ctx, loadedItems, palette, options);
  } else if (options.layout === 'catalog_grid') {
    renderCatalogGridPage(ctx, loadedItems, palette, options);
  } else {
    renderObiInsertCardPage(ctx, loadedItems, palette, options);
  }

  return canvas;
}

/**
 * Generate and download complete multi-page A4 PDF catalog
 */
export async function generateCDCatalogPDF(
  cds: CDMetadata[],
  options: PDFCatalogOptions,
  onProgress?: (currentPage: number, totalPages: number) => void
): Promise<string> {
  if (cds.length === 0) {
    throw new Error('出力対象のCDがありません。');
  }

  const itemsPerPage =
    options.layout === 'vinyl_sleeve'
      ? 2
      : options.layout === 'catalog_grid'
      ? 6
      : 4;

  const totalPages = Math.ceil(cds.length / itemsPerPage);

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  for (let p = 0; p < totalPages; p++) {
    if (onProgress) {
      onProgress(p + 1, totalPages);
    }

    const pageCanvas = await renderCatalogPageToCanvas(
      cds,
      p,
      totalPages,
      cds.length,
      itemsPerPage,
      options
    );

    const pageDataUrl = pageCanvas.toDataURL('image/jpeg', 0.92);

    if (p > 0) {
      pdf.addPage('a4', 'portrait');
    }

    // A4 size is 210mm x 297mm
    pdf.addImage(pageDataUrl, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

    // Yield briefly to keep UI responsive
    await new Promise((r) => setTimeout(r, 40));
  }

  const timestamp = formatJSTTimestampCompact();
  const layoutSuffix =
    options.layout === 'vinyl_sleeve'
      ? 'LPライナー風'
      : options.layout === 'catalog_grid'
      ? 'ジャケット一覧'
      : '帯付インデックス';
  const fileName = `CDカタログ_${layoutSuffix}_${timestamp}.pdf`;

  pdf.save(fileName);
  return fileName;
}
