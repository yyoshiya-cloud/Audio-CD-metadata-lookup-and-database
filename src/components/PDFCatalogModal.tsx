import React, { useState, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import { CDMetadata } from '../types/cd';
import { convertImageUrlToBase64 } from '../utils/imageEnhancer';
import { matchesCDSearchQuery } from '../utils/japaneseSearchNormalizer';
import {
  X,
  FileDown,
  BookOpen,
  Disc,
  LayoutGrid,
  Sparkles,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  CheckSquare,
  Square,
  Palette,
  FileText,
  Music,
  Scissors,
} from 'lucide-react';

interface PDFCatalogModalProps {
  allCDs: CDMetadata[];
  initialSelectedCDs?: CDMetadata[];
  onClose: () => void;
}

export type PDFTemplateMode = 'catalog_grid' | 'analog_liner' | 'jewel_insert';
export type PDFColorTheme = 'dark_vinyl' | 'classic_ivory' | 'clean_white';
export type CatalogGridColumns = 2 | 3;

interface LoadedImageMap {
  [cdId: string]: HTMLImageElement | null;
}

export const PDFCatalogModal: React.FC<PDFCatalogModalProps> = ({
  allCDs,
  initialSelectedCDs,
  onClose,
}) => {
  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (initialSelectedCDs && initialSelectedCDs.length > 0) {
      return initialSelectedCDs.map((c) => c.id);
    }
    return allCDs.map((c) => c.id);
  });

  const [filterKeyword, setFilterKeyword] = useState('');
  const [templateMode, setTemplateMode] = useState<PDFTemplateMode>('analog_liner');
  const [colorTheme, setColorTheme] = useState<PDFColorTheme>('dark_vinyl');
  const [gridColumns, setGridColumns] = useState<CatalogGridColumns>(2);
  const [catalogTitle, setCatalogTitle] = useState('MY CD ARCHIVE & COLLECTION');
  const [catalogSubtitle, setCatalogSubtitle] = useState('ANALOG SLEEVE & MASTER DISC CATALOG');
  const [includeCoverPage, setIncludeCoverPage] = useState(true);
  const [includeTracklistInGrid, setIncludeTracklistInGrid] = useState(true);
  const [includeBarcodeAndNotes, setIncludeBarcodeAndNotes] = useState(true);
  const [sortOrder, setSortOrder] = useState<'catalogNumber' | 'artist' | 'title' | 'releaseDate'>('artist');

  // Preview pagination state
  const [previewPageIndex, setPreviewPageIndex] = useState(0);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{
    step: string;
    current: number;
    total: number;
  } | null>(null);

  // Filtered list for selection sidebar
  const filteredSelectionCDs = useMemo(() => {
    if (!filterKeyword.trim()) return allCDs;
    return allCDs.filter((c) => matchesCDSearchQuery(c, filterKeyword));
  }, [allCDs, filterKeyword]);

  // Sorted selected CDs for output
  const targetCDs = useMemo(() => {
    const list = allCDs.filter((c) => selectedIds.includes(c.id));
    list.sort((a, b) => {
      const valA = (a[sortOrder] || '').toString().toLowerCase();
      const valB = (b[sortOrder] || '').toString().toLowerCase();
      if (valA < valB) return -1;
      if (valA > valB) return 1;
      return 0;
    });
    return list;
  }, [allCDs, selectedIds, sortOrder]);

  // Calculate virtual pages for live preview
  const previewPages = useMemo(() => {
    const pages: { type: 'cover' | 'content'; items: CDMetadata[]; pageNumber: number }[] = [];
    let pageCounter = 1;

    if (includeCoverPage && targetCDs.length > 0) {
      pages.push({
        type: 'cover',
        items: targetCDs.slice(0, 9),
        pageNumber: pageCounter++,
      });
    }

    const itemsPerPage =
      templateMode === 'analog_liner'
        ? 1
        : templateMode === 'jewel_insert'
        ? 2
        : gridColumns === 2
        ? 4
        : 6;

    for (let i = 0; i < targetCDs.length; i += itemsPerPage) {
      pages.push({
        type: 'content',
        items: targetCDs.slice(i, i + itemsPerPage),
        pageNumber: pageCounter++,
      });
    }

    return pages;
  }, [targetCDs, includeCoverPage, templateMode, gridColumns]);

  // Clamp previewPageIndex when pages change
  const safePreviewIndex = Math.min(previewPageIndex, Math.max(0, previewPages.length - 1));
  const currentPreviewPage = previewPages[safePreviewIndex] || null;

  const toggleSelectCD = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredSelectionCDs.map((c) => c.id);
    const allSelected = filteredIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  // Theme palette helper for Canvas & Preview
  const getThemeColors = (theme: PDFColorTheme) => {
    if (theme === 'dark_vinyl') {
      return {
        bg: '#0f1117',
        cardBg: '#171a24',
        cardBorder: '#2c3246',
        accent: '#d4af37', // Warm gold
        accentSoft: 'rgba(212, 175, 55, 0.16)',
        textPrimary: '#f8fafc',
        textSecondary: '#cbd5e1',
        textMuted: '#64748b',
        grooveBg: '#090a0f',
        grooveLine: '#1e2230',
        obiBg: '#b91c1c',
        obiText: '#ffffff',
      };
    } else if (theme === 'classic_ivory') {
      return {
        bg: '#f7f4eb',
        cardBg: '#EFECE2',
        cardBorder: '#d5cbb8',
        accent: '#8c5828', // Vintage bronze/brown
        accentSoft: 'rgba(140, 88, 40, 0.12)',
        textPrimary: '#1c1917',
        textSecondary: '#44403c',
        textMuted: '#78716c',
        grooveBg: '#18181b',
        grooveLine: '#27272a',
        obiBg: '#7f1d1d',
        obiText: '#fef2f2',
      };
    } else {
      return {
        bg: '#ffffff',
        cardBg: '#f8fafc',
        cardBorder: '#cbd5e1',
        accent: '#3730a3', // Deep indigo
        accentSoft: 'rgba(55, 48, 163, 0.10)',
        textPrimary: '#0f172a',
        textSecondary: '#334155',
        textMuted: '#64748b',
        grooveBg: '#1e293b',
        grooveLine: '#334155',
        obiBg: '#1e1b4b',
        obiText: '#ffffff',
      };
    }
  };

  // Load an image into HTMLImageElement (converting external links to Base64 first if needed)
  const loadCDCoverImage = async (cd: CDMetadata): Promise<HTMLImageElement | null> => {
    if (!cd.coverUrl || !cd.coverUrl.trim()) return null;
    let src = cd.coverUrl.trim();

    if (!src.startsWith('data:image/')) {
      try {
        const b64 = await convertImageUrlToBase64(src);
        if (b64 && b64.startsWith('data:image/')) {
          src = b64;
        } else {
          src = `/api/image-proxy?url=${encodeURIComponent(src)}`;
        }
      } catch {
        src = `/api/image-proxy?url=${encodeURIComponent(src)}`;
      }
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  };

  // Helper: Draw truncated or wrapped text on Canvas 2D
  const drawTruncatedText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number
  ) => {
    if (!text) return;
    if (ctx.measureText(text).width <= maxWidth) {
      ctx.fillText(text, x, y);
      return;
    }
    let truncated = text;
    while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    ctx.fillText(truncated + '…', x, y);
  };

  // Helper: Draw rounded rectangle on Canvas 2D
  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // Helper: Draw Realistic Vinyl Record with Grooves and Center Label
  const drawVinylRecord = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    coverImg: HTMLImageElement | null,
    accentColor: string
  ) => {
    ctx.save();

    // Outer shadow
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 6;
    ctx.shadowOffsetY = 6;

    // Main vinyl disc body
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#111318';
    ctx.fill();
    ctx.restore();

    // Vinyl sheen / subtle gradient
    ctx.save();
    const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    grad.addColorStop(0, 'rgba(255,255,255,0.08)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Concentric grooves
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let r = radius * 0.42; r < radius * 0.94; r += radius * 0.045) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Center label
    const labelRadius = radius * 0.34;
    ctx.beginPath();
    ctx.arc(cx, cy, labelRadius, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();

    if (coverImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, labelRadius - 4, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        coverImg,
        cx - labelRadius,
        cy - labelRadius,
        labelRadius * 2,
        labelRadius * 2
      );
      ctx.restore();
    }

    // Center spindle hole
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = '#0f1117';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  };

  // Render a single A4 page (1240 x 1754 px @ 150 DPI) onto an HTMLCanvasElement
  const renderPageToCanvas = (
    pageInfo: { type: 'cover' | 'content'; items: CDMetadata[]; pageNumber: number },
    totalPages: number,
    loadedImages: LoadedImageMap
  ): HTMLCanvasElement => {
    const W = 1240;
    const H = 1754;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const palette = getThemeColors(colorTheme);
    const fontStack = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Meiryo", sans-serif';
    const monoStack = '"JetBrains Mono", "Courier New", monospace';

    // 1. Page Background
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle outer frame border
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 36, W - 72, H - 72);

    // Inner accent hairline
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.strokeRect(44, 44, W - 88, H - 88);
    ctx.globalAlpha = 1.0;

    // =========================================================================
    // COVER PAGE
    // =========================================================================
    if (pageInfo.type === 'cover') {
      // Top badge
      ctx.fillStyle = palette.accent;
      ctx.font = `bold 18px ${monoStack}`;
      ctx.textAlign = 'center';
      ctx.fillText('OFFICIAL ARCHIVE EDITION • HIGH-FIDELITY DISC CATALOG', W / 2, 140);

      // Main Title
      ctx.fillStyle = palette.textPrimary;
      ctx.font = `900 48px ${fontStack}`;
      drawTruncatedText(ctx, catalogTitle || 'CD COLLECTION CATALOG', W / 2, 215, W - 180);

      // Subtitle
      ctx.fillStyle = palette.textSecondary;
      ctx.font = `600 22px ${fontStack}`;
      drawTruncatedText(ctx, catalogSubtitle || '', W / 2, 265, W - 200);

      // Decorative divider line
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 140, 300);
      ctx.lineTo(W / 2 + 140, 300);
      ctx.stroke();

      // 3x3 Jacket Mosaic Showcase in center
      const mosaicSize = 720;
      const startX = (W - mosaicSize) / 2;
      const startY = 360;
      const cellGap = 18;
      const cellSize = (mosaicSize - cellGap * 2) / 3;

      for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const x = startX + col * (cellSize + cellGap);
        const y = startY + row * (cellSize + cellGap);
        const item = pageInfo.items[i] || targetCDs[i % Math.max(1, targetCDs.length)];
        const img = item ? loadedImages[item.id] : null;

        ctx.save();
        drawRoundedRect(ctx, x, y, cellSize, cellSize, 14);
        ctx.fillStyle = palette.cardBg;
        ctx.fill();
        ctx.clip();

        if (img) {
          ctx.drawImage(img, x, y, cellSize, cellSize);
        } else {
          drawVinylRecord(ctx, x + cellSize / 2, y + cellSize / 2, cellSize * 0.38, null, palette.accent);
        }
        ctx.restore();

        ctx.strokeStyle = palette.cardBorder;
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, x, y, cellSize, cellSize, 14);
        ctx.stroke();
      }

      // Summary statistics box below mosaic
      const statsY = 1160;
      drawRoundedRect(ctx, startX, statsY, mosaicSize, 170, 16);
      ctx.fillStyle = palette.cardBg;
      ctx.fill();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const totalTracks = targetCDs.reduce((acc, c) => acc + (c.tracks ? c.tracks.length : 0), 0);
      const uniqueArtists = new Set(targetCDs.map((c) => c.artist).filter(Boolean)).size;

      const statCols = [
        { label: 'TOTAL ALBUMS', value: `${targetCDs.length} DISCS` },
        { label: 'ARTISTS', value: `${uniqueArtists} ARTISTS` },
        { label: 'TOTAL TRACKS', value: `${totalTracks} TRACKS` },
      ];

      statCols.forEach((st, idx) => {
        const sx = startX + (mosaicSize / 3) * idx + mosaicSize / 6;
        ctx.fillStyle = palette.accent;
        ctx.font = `bold 15px ${monoStack}`;
        ctx.textAlign = 'center';
        ctx.fillText(st.label, sx, statsY + 62);

        ctx.fillStyle = palette.textPrimary;
        ctx.font = `900 32px ${monoStack}`;
        ctx.fillText(st.value, sx, statsY + 115);
      });

      // Footer date
      const todayStr = new Date().toISOString().slice(0, 10);
      ctx.fillStyle = palette.textMuted;
      ctx.font = `500 16px ${monoStack}`;
      ctx.textAlign = 'center';
      ctx.fillText(`GENERATED ON ${todayStr} • LOCAL INDEXEDDB ARCHIVE`, W / 2, H - 90);

      return canvas;
    }

    // =========================================================================
    // PAGE HEADER & FOOTER FOR CONTENT PAGES
    // =========================================================================
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.accent;
    ctx.font = `bold 15px ${monoStack}`;
    ctx.fillText(catalogTitle || 'CD COLLECTION CATALOG', 72, 86);

    ctx.textAlign = 'right';
    ctx.fillStyle = palette.textMuted;
    ctx.font = `600 14px ${monoStack}`;
    const modeLabel =
      templateMode === 'analog_liner'
        ? 'LP ANALOG JACKET & LINER NOTES'
        : templateMode === 'jewel_insert'
        ? '12cm CD JEWEL CASE INSERT'
        : `CD CATALOG (${gridColumns} COLUMNS)`;
    ctx.fillText(`${modeLabel}  |  PAGE ${pageInfo.pageNumber} / ${totalPages}`, W - 72, 86);

    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(72, 104);
    ctx.lineTo(W - 72, 104);
    ctx.stroke();

    // =========================================================================
    // MODE 1: ANALOG LP JACKET & LINER NOTES (1 ALBUM PER PAGE)
    // =========================================================================
    if (templateMode === 'analog_liner') {
      const cd = pageInfo.items[0];
      if (!cd) return canvas;
      const img = loadedImages[cd.id] || null;

      // Top Analog Sleeve Showcase Box
      const sleeveX = 110;
      const sleeveY = 145;
      const sleeveSize = 540;

      // Draw Vinyl Record peeking out to the right of the jacket
      const vinylCenterX = sleeveX + sleeveSize + 150;
      const vinylCenterY = sleeveY + sleeveSize / 2;
      drawVinylRecord(ctx, vinylCenterX, vinylCenterY, sleeveSize * 0.47, img, palette.accent);

      // Jacket Drop Shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetX = 10;
      ctx.shadowOffsetY = 12;
      drawRoundedRect(ctx, sleeveX, sleeveY, sleeveSize, sleeveSize, 10);
      ctx.fillStyle = palette.cardBg;
      ctx.fill();
      ctx.restore();

      // Jacket Artwork
      ctx.save();
      drawRoundedRect(ctx, sleeveX, sleeveY, sleeveSize, sleeveSize, 10);
      ctx.clip();
      if (img) {
        ctx.drawImage(img, sleeveX, sleeveY, sleeveSize, sleeveSize);
      } else {
        ctx.fillStyle = palette.cardBg;
        ctx.fillRect(sleeveX, sleeveY, sleeveSize, sleeveSize);
        drawVinylRecord(ctx, sleeveX + sleeveSize / 2, sleeveY + sleeveSize / 2, 180, null, palette.accent);
      }

      // Japanese OBI Strip (帯) on left side of jacket
      const obiWidth = 78;
      ctx.fillStyle = palette.obiBg;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(sleeveX + 26, sleeveY, obiWidth, sleeveSize);
      ctx.globalAlpha = 1.0;

      // Gold borders on Obi strip
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(sleeveX + 26, sleeveY, obiWidth, sleeveSize);

      // Obi top catalog badge
      ctx.fillStyle = palette.obiText;
      ctx.font = `bold 12px ${monoStack}`;
      ctx.textAlign = 'center';
      drawTruncatedText(ctx, cd.catalogNumber || 'STEREO', sleeveX + 26 + obiWidth / 2, sleeveY + 34, obiWidth - 8);

      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(sleeveX + 34, sleeveY + 48);
      ctx.lineTo(sleeveX + 26 + obiWidth - 8, sleeveY + 48);
      ctx.stroke();

      // Obi vertical-style text (simulated stacked characters or rotated text)
      ctx.save();
      ctx.translate(sleeveX + 26 + obiWidth / 2, sleeveY + sleeveSize / 2 + 10);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = palette.obiText;
      ctx.font = `900 18px ${fontStack}`;
      ctx.textAlign = 'center';
      drawTruncatedText(ctx, `${cd.artist} — ${cd.title}`, 0, 6, sleeveSize - 140);
      ctx.restore();

      ctx.restore();

      // Jacket Frame Border
      ctx.strokeStyle = palette.cardBorder;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, sleeveX, sleeveY, sleeveSize, sleeveSize, 10);
      ctx.stroke();

      // Album Metadata Header Block (Below Jacket)
      const metaY = 735;
      ctx.textAlign = 'left';

      // Catalog Number & Release Date Pill
      ctx.fillStyle = palette.accent;
      ctx.font = `bold 18px ${monoStack}`;
      const catInfo = [
        cd.catalogNumber ? `CAT NO: ${cd.catalogNumber}` : 'CAT NO: N/A',
        cd.releaseDate ? `RELEASE: ${cd.releaseDate}` : '',
        cd.label ? `LABEL: ${cd.label}` : '',
      ]
        .filter(Boolean)
        .join('   •   ');
      drawTruncatedText(ctx, catInfo, 90, metaY, W - 180);

      // Album Title
      ctx.fillStyle = palette.textPrimary;
      ctx.font = `900 38px ${fontStack}`;
      drawTruncatedText(ctx, cd.title || 'Untitled Album', 90, metaY + 52, W - 180);

      // Artist Name
      ctx.fillStyle = palette.textSecondary;
      ctx.font = `700 24px ${fontStack}`;
      drawTruncatedText(ctx, cd.artist || 'Unknown Artist', 90, metaY + 92, W - 180);

      // Genre & Tags
      const tagsList = [cd.genre, ...(cd.tags || [])].filter(Boolean) as string[];
      if (tagsList.length > 0) {
        ctx.fillStyle = palette.textMuted;
        ctx.font = `600 15px ${fontStack}`;
        drawTruncatedText(ctx, `TAGS: ${tagsList.map((t) => `#${t}`).join('  ')}`, 90, metaY + 125, W - 180);
      }

      // Liner Notes & Tracklist Box (2-Column Side-A / Side-B Analog Style)
      const trackBoxY = 890;
      const trackBoxH = 740;
      drawRoundedRect(ctx, 80, trackBoxY, W - 160, trackBoxH, 16);
      ctx.fillStyle = palette.cardBg;
      ctx.fill();
      ctx.strokeStyle = palette.cardBorder;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Tracklist Box Header
      ctx.fillStyle = palette.accent;
      ctx.font = `bold 17px ${monoStack}`;
      ctx.textAlign = 'left';
      const tracks = cd.tracks || [];
      ctx.fillText(`TRACKLISTING / LINER NOTES (${tracks.length} TRACKS)`, 115, trackBoxY + 42);

      if (includeBarcodeAndNotes && cd.barcode) {
        ctx.textAlign = 'right';
        ctx.fillStyle = palette.textMuted;
        ctx.font = `600 15px ${monoStack}`;
        ctx.fillText(`JAN/EAN: ${cd.barcode}`, W - 115, trackBoxY + 42);
      }

      ctx.strokeStyle = palette.cardBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(110, trackBoxY + 60);
      ctx.lineTo(W - 110, trackBoxY + 60);
      ctx.stroke();

      // Render Tracks in 2 Columns (Up to 32 tracks cleanly displayed)
      const colWidth = (W - 260) / 2;
      const leftColX = 115;
      const rightColX = 115 + colWidth + 40;
      const maxRowsPerCol = 15;
      const rowHeight = 36;

      if (tracks.length === 0) {
        ctx.fillStyle = palette.textMuted;
        ctx.font = `500 18px ${fontStack}`;
        ctx.textAlign = 'center';
        ctx.fillText('収録曲データが登録されていません', W / 2, trackBoxY + 220);
      } else {
        const displayTracks = tracks.slice(0, maxRowsPerCol * 2);
        displayTracks.forEach((tr, idx) => {
          const isRightCol = idx >= maxRowsPerCol;
          const rowIndex = isRightCol ? idx - maxRowsPerCol : idx;
          const tx = isRightCol ? rightColX : leftColX;
          const ty = trackBoxY + 102 + rowIndex * rowHeight;

          // Track Number
          ctx.textAlign = 'left';
          ctx.fillStyle = palette.accent;
          ctx.font = `bold 16px ${monoStack}`;
          const numStr = String(tr.trackNumber || idx + 1).padStart(2, '0') + '.';
          ctx.fillText(numStr, tx, ty);

          // Duration on right edge of column
          const durStr = tr.duration || '';
          let titleMaxW = colWidth - 55;
          if (durStr) {
            ctx.textAlign = 'right';
            ctx.fillStyle = palette.textMuted;
            ctx.font = `500 15px ${monoStack}`;
            ctx.fillText(durStr, tx + colWidth, ty);
            titleMaxW -= 65;
          }

          // Track Title
          ctx.textAlign = 'left';
          ctx.fillStyle = palette.textPrimary;
          ctx.font = `600 16px ${fontStack}`;
          drawTruncatedText(ctx, tr.title || `Track ${idx + 1}`, tx + 42, ty, titleMaxW);

          // Subtle dotted line separator
          ctx.strokeStyle = palette.cardBorder;
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.moveTo(tx, ty + 10);
          ctx.lineTo(tx + colWidth, ty + 10);
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        });
      }

      // Notes section at bottom of Track Box if available
      if (includeBarcodeAndNotes && cd.notes) {
        const notesY = trackBoxY + trackBoxH - 48;
        ctx.fillStyle = palette.textSecondary;
        ctx.font = `italic 15px ${fontStack}`;
        ctx.textAlign = 'left';
        drawTruncatedText(ctx, `NOTES: ${cd.notes.replace(/\n/g, ' ')}`, 115, notesY, W - 230);
      }

      return canvas;
    }

    // =========================================================================
    // MODE 2: 12cm CD JEWEL CASE INSERT CARD (2 ALBUMS PER PAGE WITH CROP MARKS)
    // =========================================================================
    if (templateMode === 'jewel_insert') {
      // Standard 12cm x 12cm front booklet + back tracklist panel side-by-side
      const cardH = 680;
      const cardW = 1040;
      const startX = (W - cardW) / 2;

      pageInfo.items.slice(0, 2).forEach((cd, idx) => {
        const startY = 165 + idx * (cardH + 95);
        const img = loadedImages[cd.id] || null;

        // Crop / Cut marks (トンボ・切り取り線)
        ctx.save();
        ctx.strokeStyle = palette.accent;
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(startX, startY, cardW, cardH);
        ctx.restore();

        ctx.fillStyle = palette.textMuted;
        ctx.font = `500 13px ${monoStack}`;
        ctx.textAlign = 'left';
        ctx.fillText('✂ 120mm × 120mm CDジュエルケース見開きカード 切り取り線 (折り目: 中央)', startX, startY - 12);

        // Left Half: Front Jacket Cover (520 x 680 area with square 480x480 artwork + Spine strip)
        const halfW = cardW / 2;
        ctx.fillStyle = palette.cardBg;
        ctx.fillRect(startX + 2, startY + 2, cardW - 4, cardH - 4);

        // Center Fold Line
        ctx.save();
        ctx.strokeStyle = palette.cardBorder;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(startX + halfW, startY);
        ctx.lineTo(startX + halfW, startY + cardH);
        ctx.stroke();
        ctx.restore();

        // Jacket image on Left Panel
        const artSize = 460;
        const artX = startX + (halfW - artSize) / 2;
        const artY = startY + 30;
        if (img) {
          ctx.drawImage(img, artX, artY, artSize, artSize);
        } else {
          drawVinylRecord(ctx, artX + artSize / 2, artY + artSize / 2, 170, null, palette.accent);
        }
        ctx.strokeStyle = palette.cardBorder;
        ctx.lineWidth = 2;
        ctx.strokeRect(artX, artY, artSize, artSize);

        // Front Cover Bottom Typography
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.accent;
        ctx.font = `bold 15px ${monoStack}`;
        drawTruncatedText(ctx, cd.catalogNumber || 'CATALOG ARCHIVE', startX + halfW / 2, artY + artSize + 40, artSize);

        ctx.fillStyle = palette.textPrimary;
        ctx.font = `900 24px ${fontStack}`;
        drawTruncatedText(ctx, cd.title, startX + halfW / 2, artY + artSize + 78, artSize);

        ctx.fillStyle = palette.textSecondary;
        ctx.font = `700 18px ${fontStack}`;
        drawTruncatedText(ctx, cd.artist, startX + halfW / 2, artY + artSize + 112, artSize);

        // Right Half: Back Liner & Tracklist
        const rightX = startX + halfW + 32;
        const rightW = halfW - 64;

        ctx.textAlign = 'left';
        ctx.fillStyle = palette.accent;
        ctx.font = `bold 14px ${monoStack}`;
        drawTruncatedText(
          ctx,
          `${cd.catalogNumber || 'NO-CAT'}  •  ${cd.releaseDate || 'UNKNOWN DATE'}`,
          rightX,
          startY + 46,
          rightW
        );

        ctx.fillStyle = palette.textPrimary;
        ctx.font = `800 20px ${fontStack}`;
        drawTruncatedText(ctx, cd.title, rightX, startY + 80, rightW);

        ctx.fillStyle = palette.textSecondary;
        ctx.font = `600 15px ${fontStack}`;
        drawTruncatedText(ctx, `${cd.artist}${cd.label ? `  [${cd.label}]` : ''}`, rightX, startY + 108, rightW);

        ctx.strokeStyle = palette.cardBorder;
        ctx.beginPath();
        ctx.moveTo(rightX, startY + 126);
        ctx.lineTo(rightX + rightW, startY + 126);
        ctx.stroke();

        // Tracklist on Right Panel
        const tracks = cd.tracks || [];
        const maxTracks = 16;
        tracks.slice(0, maxTracks).forEach((tr, tIdx) => {
          const ty = startY + 158 + tIdx * 30;
          ctx.textAlign = 'left';
          ctx.fillStyle = palette.accent;
          ctx.font = `bold 14px ${monoStack}`;
          ctx.fillText(String(tr.trackNumber || tIdx + 1).padStart(2, '0') + '.', rightX, ty);

          if (tr.duration) {
            ctx.textAlign = 'right';
            ctx.fillStyle = palette.textMuted;
            ctx.font = `500 13px ${monoStack}`;
            ctx.fillText(tr.duration, rightX + rightW, ty);
          }

          ctx.textAlign = 'left';
          ctx.fillStyle = palette.textPrimary;
          ctx.font = `500 14px ${fontStack}`;
          drawTruncatedText(ctx, tr.title, rightX + 34, ty, rightW - (tr.duration ? 90 : 40));
        });

        if (tracks.length > maxTracks) {
          ctx.fillStyle = palette.textMuted;
          ctx.font = `italic 13px ${fontStack}`;
          ctx.fillText(`+ 他 ${tracks.length - maxTracks} 曲収録`, rightX + 34, startY + 158 + maxTracks * 30);
        }
      });

      return canvas;
    }

    // =========================================================================
    // MODE 3: MULTI-COLUMN COLLECTION CATALOG GRID (2x2 = 4 OR 3x2 = 6 PER PAGE)
    // =========================================================================
    const cols = gridColumns;
    const rows = 2;
    const padX = 72;
    const padY = 135;
    const gapX = 28;
    const gapY = 32;
    const availW = W - padX * 2;
    const availH = H - padY - 85;
    const cellW = (availW - gapX * (cols - 1)) / cols;
    const cellH = (availH - gapY * (rows - 1)) / rows;

    pageInfo.items.forEach((cd, idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const x = padX + c * (cellW + gapX);
      const y = padY + r * (cellH + gapY);
      const img = loadedImages[cd.id] || null;

      // Card container
      drawRoundedRect(ctx, x, y, cellW, cellH, 16);
      ctx.fillStyle = palette.cardBg;
      ctx.fill();
      ctx.strokeStyle = palette.cardBorder;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Top Jacket Section inside Card
      const artSize = cols === 2 ? 250 : 195;
      const artX = x + 22;
      const artY = y + 22;

      // Subtle Vinyl Disc peeking out on 2-column mode
      if (cols === 2) {
        drawVinylRecord(ctx, artX + artSize + 36, artY + artSize / 2, artSize * 0.44, img, palette.accent);
      }

      ctx.save();
      drawRoundedRect(ctx, artX, artY, artSize, artSize, 10);
      ctx.clip();
      if (img) {
        ctx.drawImage(img, artX, artY, artSize, artSize);
      } else {
        ctx.fillStyle = palette.bg;
        ctx.fillRect(artX, artY, artSize, artSize);
        drawVinylRecord(ctx, artX + artSize / 2, artY + artSize / 2, artSize * 0.38, null, palette.accent);
      }
      ctx.restore();

      ctx.strokeStyle = palette.cardBorder;
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, artX, artY, artSize, artSize, 10);
      ctx.stroke();

      // Right of Jacket (or below if 3-col): Metadata
      if (cols === 2) {
        const infoX = artX + artSize + 95;
        const infoW = x + cellW - infoX - 20;

        ctx.textAlign = 'left';
        ctx.fillStyle = palette.accent;
        ctx.font = `bold 14px ${monoStack}`;
        drawTruncatedText(ctx, cd.catalogNumber || 'NO CATALOG', infoX, artY + 32, infoW);

        ctx.fillStyle = palette.textMuted;
        ctx.font = `600 13px ${monoStack}`;
        drawTruncatedText(ctx, cd.releaseDate || '-', infoX, artY + 56, infoW);

        if (cd.label) {
          ctx.fillStyle = palette.textSecondary;
          ctx.font = `600 13px ${fontStack}`;
          drawTruncatedText(ctx, cd.label, infoX, artY + 82, infoW);
        }

        const trackCount = cd.tracks ? cd.tracks.length : 0;
        ctx.fillStyle = palette.accent;
        ctx.font = `bold 13px ${monoStack}`;
        ctx.fillText(`♪ ${trackCount} TRACKS`, infoX, artY + 114);
      } else {
        // 3-column badge to the right of smaller jacket
        const infoX = artX + artSize + 16;
        const infoW = x + cellW - infoX - 14;
        ctx.textAlign = 'left';
        ctx.fillStyle = palette.accent;
        ctx.font = `bold 13px ${monoStack}`;
        drawTruncatedText(ctx, cd.catalogNumber || 'NO-CAT', infoX, artY + 30, infoW);

        ctx.fillStyle = palette.textMuted;
        ctx.font = `500 12px ${monoStack}`;
        drawTruncatedText(ctx, cd.releaseDate || '-', infoX, artY + 54, infoW);

        const trackCount = cd.tracks ? cd.tracks.length : 0;
        ctx.fillStyle = palette.textSecondary;
        ctx.font = `bold 12px ${monoStack}`;
        ctx.fillText(`${trackCount} 曲`, infoX, artY + 80);
      }

      // Title & Artist below jacket
      const textY = artY + artSize + 36;
      const textMaxW = cellW - 44;

      ctx.textAlign = 'left';
      ctx.fillStyle = palette.textPrimary;
      ctx.font = `800 ${cols === 2 ? 22 : 18}px ${fontStack}`;
      drawTruncatedText(ctx, cd.title || 'Untitled', x + 22, textY, textMaxW);

      ctx.fillStyle = palette.textSecondary;
      ctx.font = `600 ${cols === 2 ? 16 : 14}px ${fontStack}`;
      drawTruncatedText(ctx, cd.artist || 'Unknown Artist', x + 22, textY + 28, textMaxW);

      // Divider line
      ctx.strokeStyle = palette.cardBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 22, textY + 46);
      ctx.lineTo(x + cellW - 22, textY + 46);
      ctx.stroke();

      // Tracklist preview inside grid card
      if (includeTracklistInGrid) {
        const tracks = cd.tracks || [];
        const maxTr = cols === 2 ? 10 : 8;
        const trStartY = textY + 74;
        const trRowH = cols === 2 ? 26 : 24;

        if (tracks.length === 0) {
          ctx.fillStyle = palette.textMuted;
          ctx.font = `500 13px ${fontStack}`;
          ctx.fillText('収録曲情報なし', x + 22, trStartY);
        } else {
          tracks.slice(0, maxTr).forEach((tr, tIdx) => {
            const ty = trStartY + tIdx * trRowH;
            if (ty > y + cellH - 22) return;

            ctx.textAlign = 'left';
            ctx.fillStyle = palette.accent;
            ctx.font = `bold 13px ${monoStack}`;
            ctx.fillText(String(tr.trackNumber || tIdx + 1).padStart(2, '0') + '.', x + 22, ty);

            if (tr.duration) {
              ctx.textAlign = 'right';
              ctx.fillStyle = palette.textMuted;
              ctx.font = `500 12px ${monoStack}`;
              ctx.fillText(tr.duration, x + cellW - 22, ty);
            }

            ctx.textAlign = 'left';
            ctx.fillStyle = palette.textPrimary;
            ctx.font = `500 13px ${fontStack}`;
            drawTruncatedText(
              ctx,
              tr.title,
              x + 54,
              ty,
              textMaxW - (tr.duration ? 82 : 34)
            );
          });

          if (tracks.length > maxTr) {
            ctx.textAlign = 'right';
            ctx.fillStyle = palette.textMuted;
            ctx.font = `italic 12px ${fontStack}`;
            ctx.fillText(`+ 他 ${tracks.length - maxTr} 曲`, x + cellW - 22, y + cellH - 16);
          }
        }
      }
    });

    return canvas;
  };

  // Main PDF Generation Handler
  const handleGeneratePDF = async () => {
    if (targetCDs.length === 0 || isGenerating) return;
    setIsGenerating(true);

    try {
      // 1. Preload all jacket images (convert external URLs to Base64 automatically)
      const loadedImages: LoadedImageMap = {};
      setGenerationProgress({
        step: 'ジャケット画像を高解像度展開中...',
        current: 0,
        total: targetCDs.length,
      });

      const CONCURRENCY = 4;
      for (let i = 0; i < targetCDs.length; i += CONCURRENCY) {
        const chunk = targetCDs.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (cd) => {
            loadedImages[cd.id] = await loadCDCoverImage(cd);
          })
        );
        setGenerationProgress({
          step: 'ジャケット画像を高解像度展開中...',
          current: Math.min(i + chunk.length, targetCDs.length),
          total: targetCDs.length,
        });
      }

      // 2. Initialize A4 Portrait jsPDF document
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      const totalPages = previewPages.length;

      for (let pIdx = 0; pIdx < totalPages; pIdx++) {
        setGenerationProgress({
          step: `PDFページをレンダリング中 (${pIdx + 1} / ${totalPages} ページ)...`,
          current: pIdx + 1,
          total: totalPages,
        });

        // Allow UI thread to breathe
        await new Promise((r) => setTimeout(r, 30));

        if (pIdx > 0) {
          pdf.addPage('a4', 'portrait');
        }

        const pageCanvas = renderPageToCanvas(previewPages[pIdx], totalPages, loadedImages);
        const pageDataUrl = pageCanvas.toDataURL('image/jpeg', 0.92);
        pdf.addImage(pageDataUrl, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }

      // 3. Save file with timestamp
      const now = new Date();
      const timestamp =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');

      const modePrefix =
        templateMode === 'analog_liner'
          ? 'CDアナログジャケット図鑑'
          : templateMode === 'jewel_insert'
          ? 'CDジュエルケース印刷カード'
          : 'CDコレクションカタログ';

      pdf.save(`${modePrefix}_${timestamp}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const previewTheme = getThemeColors(colorTheme);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-hidden">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-[1550px] h-[93vh] max-h-[93vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/90 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-amber-900/30 ring-1 ring-white/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-white tracking-tight">
                  印刷用CDカタログ / アナログジャケット風 PDF出力スタジオ
                </h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  A4 高解像度・日本語完全対応
                </span>
              </div>
              <p className="text-xs text-slate-400">
                LPレコード帯・ビニール盤面付きライナーノーツ、コレクション図鑑カタログ、12cm CDケース差し込みジャケットカードをPDF出力
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGeneratePDF}
              disabled={isGenerating || targetCDs.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-amber-500 via-orange-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white shadow-lg shadow-amber-950/50 border border-amber-300/40 transition-all cursor-pointer disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{generationProgress?.step || 'PDF生成中...'}</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>PDFを生成してダウンロード ({previewPages.length}ページ)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors cursor-pointer"
              title="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Generation Progress Banner */}
        {isGenerating && generationProgress && (
          <div className="bg-indigo-950/90 border-b border-indigo-500/40 px-6 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-xs font-bold text-indigo-200">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>{generationProgress.step}</span>
            </div>
            <div className="flex items-center gap-3 w-64">
              <div className="flex-1 h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-indigo-500 transition-all duration-200"
                  style={{
                    width: `${Math.round((generationProgress.current / Math.max(1, generationProgress.total)) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-[11px] font-mono text-indigo-300">
                {generationProgress.current}/{generationProgress.total}
              </span>
            </div>
          </div>
        )}

        {/* Main 3-Column Studio Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[360px_1fr_320px] divide-y lg:divide-y-0 lg:divide-x divide-slate-800 overflow-hidden">
          
          {/* LEFT PANEL: Layout & Design Settings */}
          <div className="p-4 overflow-y-auto space-y-5 bg-slate-900/70">
            
            {/* 1. Template Mode Selection */}
            <div className="space-y-2">
              <label className="text-xs font-extrabold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>1. 出力レイアウトモード選択</span>
              </label>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setTemplateMode('analog_liner');
                    setPreviewPageIndex(0);
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                    templateMode === 'analog_liner'
                      ? 'bg-amber-950/40 border-amber-500/70 text-white shadow-md'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <Disc className={`w-5 h-5 mt-0.5 flex-shrink-0 ${templateMode === 'analog_liner' ? 'text-amber-400' : 'text-slate-400'}`} />
                  <div>
                    <div className="text-xs font-extrabold flex items-center gap-1.5">
                      <span>アナログLPジャケット＆ライナーノーツ風</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">1枚/頁</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      大判ジャケット・日本語レコード帯(OBI)・アナログ盤面・全収録曲リストを1ページ1作品で重厚にレイアウト
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTemplateMode('catalog_grid');
                    setPreviewPageIndex(0);
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                    templateMode === 'catalog_grid'
                      ? 'bg-indigo-950/50 border-indigo-500/70 text-white shadow-md'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <LayoutGrid className={`w-5 h-5 mt-0.5 flex-shrink-0 ${templateMode === 'catalog_grid' ? 'text-indigo-400' : 'text-slate-400'}`} />
                  <div>
                    <div className="text-xs font-extrabold flex items-center gap-1.5">
                      <span>印刷用CDコレクションカタログ (図鑑グリッド)</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono">4〜6枚/頁</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      複数枚のCDジャケット・規格品番・発売日・収録曲リストを見やすく一覧化した保存用カタログ
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTemplateMode('jewel_insert');
                    setPreviewPageIndex(0);
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                    templateMode === 'jewel_insert'
                      ? 'bg-emerald-950/40 border-emerald-500/70 text-white shadow-md'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <Scissors className={`w-5 h-5 mt-0.5 flex-shrink-0 ${templateMode === 'jewel_insert' ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <div>
                    <div className="text-xs font-extrabold flex items-center gap-1.5">
                      <span>12cm CDジュエルケース差し込みカード</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">2枚/頁</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      切り取りトンボ線付き。印刷して半分に折ると標準CDケースに収まる表紙＋曲目カード
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* 2. Color Theme Selection */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <label className="text-xs font-extrabold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-indigo-400" />
                <span>2. カラーテーマ (背景・紙質スタイル)</span>
              </label>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'dark_vinyl', label: 'ダーク・ヴァイナル', desc: '黒盤＆ゴールド', swatch: 'bg-slate-950 border-amber-500/60 text-amber-300' },
                  { id: 'classic_ivory', label: 'クラシック生成り紙', desc: 'ヴィンテージ紙質', swatch: 'bg-stone-200 border-amber-800/60 text-stone-900' },
                  { id: 'clean_white', label: 'クリーンホワイト', desc: 'インク節約・印刷向き', swatch: 'bg-white border-indigo-500/60 text-slate-900' },
                ].map((th) => (
                  <button
                    key={th.id}
                    type="button"
                    onClick={() => setColorTheme(th.id as PDFColorTheme)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      colorTheme === th.id
                        ? 'ring-2 ring-indigo-500 border-indigo-400 bg-slate-800'
                        : 'border-slate-800 bg-slate-950/60 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className={`w-full h-5 rounded-md border mb-1.5 flex items-center justify-center text-[9px] font-mono font-bold ${th.swatch}`}>
                      SAMPLE
                    </div>
                    <div className="text-[11px] font-bold text-white truncate">{th.label}</div>
                    <div className="text-[9px] text-slate-400 truncate">{th.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Catalog Title & Options */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <label className="text-xs font-extrabold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span>3. カタログタイトル＆詳細オプション</span>
              </label>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  カタログメインタイトル (表紙・ヘッダー印字)
                </label>
                <input
                  type="text"
                  value={catalogTitle}
                  onChange={(e) => setCatalogTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  placeholder="MY CD ARCHIVE & COLLECTION"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  サブタイトル
                </label>
                <input
                  type="text"
                  value={catalogSubtitle}
                  onChange={(e) => setCatalogSubtitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  placeholder="ANALOG SLEEVE & MASTER DISC CATALOG"
                />
              </div>

              {templateMode === 'catalog_grid' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    1ページあたりの列数 (グリッド密度)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setGridColumns(2)}
                      className={`py-1.5 px-3 rounded-xl text-xs font-bold border cursor-pointer ${
                        gridColumns === 2
                          ? 'bg-indigo-600 text-white border-indigo-400'
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}
                    >
                      2列 (4枚/ページ・大判)
                    </button>
                    <button
                      type="button"
                      onClick={() => setGridColumns(3)}
                      className={`py-1.5 px-3 rounded-xl text-xs font-bold border cursor-pointer ${
                        gridColumns === 3
                          ? 'bg-indigo-600 text-white border-indigo-400'
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}
                    >
                      3列 (6枚/ページ・高密度)
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  CDの並び順 (ソート)
                </label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="artist">アーティスト名順</option>
                  <option value="catalogNumber">規格品番 (型番) 順</option>
                  <option value="title">アルバムタイトル順</option>
                  <option value="releaseDate">発売年月日順</option>
                </select>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeCoverPage}
                    onChange={(e) => {
                      setIncludeCoverPage(e.target.checked);
                      setPreviewPageIndex(0);
                    }}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>モザイクジャケット表紙ページを先頭に追加する</span>
                </label>

                {templateMode === 'catalog_grid' && (
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeTracklistInGrid}
                      onChange={(e) => setIncludeTracklistInGrid(e.target.checked)}
                      className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>カタログ各枠に収録曲リストを印字する</span>
                  </label>
                )}

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeBarcodeAndNotes}
                    onChange={(e) => setIncludeBarcodeAndNotes(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>JANバーコード・備考メモ(ライナーノーツ)を印字する</span>
                </label>
              </div>
            </div>

          </div>

          {/* CENTER PANEL: Live Interactive Page Preview */}
          <div className="p-4 sm:p-6 bg-slate-950 flex flex-col items-center justify-between overflow-y-auto">
            
            {/* Page Navigation Bar */}
            <div className="w-full flex items-center justify-between bg-slate-900/90 border border-slate-800 px-4 py-2 rounded-xl mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-300">ライブプレビュー</span>
                <span className="text-[11px] font-mono text-amber-300 bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded-md">
                  {currentPreviewPage?.type === 'cover' ? '表紙ページ' : `本文ページ`}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewPageIndex((p) => Math.max(0, p - 1))}
                  disabled={safePreviewIndex <= 0}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono font-bold text-white min-w-[80px] text-center">
                  {previewPages.length > 0 ? `${safePreviewIndex + 1} / ${previewPages.length} 頁` : '0 / 0'}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewPageIndex((p) => Math.min(previewPages.length - 1, p + 1))}
                  disabled={safePreviewIndex >= previewPages.length - 1}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Simulated A4 Sheet Preview */}
            {currentPreviewPage ? (
              <div
                className="w-full max-w-[490px] aspect-[1/1.414] rounded-lg shadow-2xl border p-5 flex flex-col justify-between relative overflow-hidden transition-colors duration-200 select-none"
                style={{
                  backgroundColor: previewTheme.bg,
                  borderColor: previewTheme.cardBorder,
                  color: previewTheme.textPrimary,
                }}
              >
                {/* Simulated Page Content */}
                {currentPreviewPage.type === 'cover' ? (
                  <div className="flex-1 flex flex-col items-center justify-between py-4 text-center">
                    <div className="space-y-1.5 w-full">
                      <div className="text-[9px] font-mono tracking-widest font-bold" style={{ color: previewTheme.accent }}>
                        OFFICIAL ARCHIVE EDITION • HIGH-FIDELITY DISC CATALOG
                      </div>
                      <h3 className="text-lg font-black tracking-tight truncate px-4" style={{ color: previewTheme.textPrimary }}>
                        {catalogTitle || 'CD COLLECTION CATALOG'}
                      </h3>
                      <p className="text-[11px] font-semibold truncate px-6" style={{ color: previewTheme.textSecondary }}>
                        {catalogSubtitle}
                      </p>
                    </div>

                    {/* 3x3 Cover Mosaic Preview */}
                    <div className="grid grid-cols-3 gap-2 w-64 h-64 my-2">
                      {Array.from({ length: 9 }).map((_, idx) => {
                        const item =
                          currentPreviewPage.items[idx] ||
                          targetCDs[idx % Math.max(1, targetCDs.length)];
                        return (
                          <div
                            key={idx}
                            className="aspect-square rounded-md overflow-hidden border flex items-center justify-center"
                            style={{
                              backgroundColor: previewTheme.cardBg,
                              borderColor: previewTheme.cardBorder,
                            }}
                          >
                            {item?.coverUrl ? (
                              <img
                                src={item.coverUrl}
                                alt={item.title}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <Disc className="w-6 h-6 opacity-40" style={{ color: previewTheme.accent }} />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Stats Box */}
                    <div
                      className="w-full max-w-[320px] rounded-lg border p-2.5 grid grid-cols-3 gap-2"
                      style={{
                        backgroundColor: previewTheme.cardBg,
                        borderColor: previewTheme.accent,
                      }}
                    >
                      <div>
                        <div className="text-[8px] font-mono font-bold" style={{ color: previewTheme.accent }}>
                          TOTAL ALBUMS
                        </div>
                        <div className="text-xs font-mono font-black">{targetCDs.length} DISCS</div>
                      </div>
                      <div>
                        <div className="text-[8px] font-mono font-bold" style={{ color: previewTheme.accent }}>
                          ARTISTS
                        </div>
                        <div className="text-xs font-mono font-black">
                          {new Set(targetCDs.map((c) => c.artist).filter(Boolean)).size}
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] font-mono font-bold" style={{ color: previewTheme.accent }}>
                          TRACKS
                        </div>
                        <div className="text-xs font-mono font-black">
                          {targetCDs.reduce((a, c) => a + (c.tracks?.length || 0), 0)}
                        </div>
                      </div>
                    </div>

                    <div className="text-[8px] font-mono" style={{ color: previewTheme.textMuted }}>
                      GENERATED ARCHIVE • PAGE 1 / {previewPages.length}
                    </div>
                  </div>
                ) : templateMode === 'analog_liner' ? (
                  /* ANALOG LP JACKET PREVIEW */
                  (() => {
                    const cd = currentPreviewPage.items[0];
                    if (!cd) return null;
                    return (
                      <div className="flex-1 flex flex-col justify-between space-y-3">
                        <div className="flex items-center justify-between text-[8px] font-mono border-b pb-1" style={{ borderColor: previewTheme.cardBorder }}>
                          <span style={{ color: previewTheme.accent }}>{catalogTitle}</span>
                          <span style={{ color: previewTheme.textMuted }}>
                            LP ANALOG SLEEVE | PAGE {currentPreviewPage.pageNumber}/{previewPages.length}
                          </span>
                        </div>

                        {/* Vinyl + Sleeve */}
                        <div className="relative flex items-center justify-start pl-4 py-1">
                          {/* Peeking Vinyl */}
                          <div className="w-40 h-40 rounded-full bg-zinc-950 border-4 border-zinc-800 shadow-xl flex items-center justify-center absolute left-36">
                            <div
                              className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden border"
                              style={{ backgroundColor: previewTheme.accent }}
                            >
                              {cd.coverUrl ? (
                                <img src={cd.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="w-3 h-3 rounded-full bg-black" />
                              )}
                            </div>
                          </div>

                          {/* Square Jacket with Obi */}
                          <div
                            className="w-44 h-44 rounded-md shadow-2xl border relative z-10 overflow-hidden flex items-center justify-center"
                            style={{
                              backgroundColor: previewTheme.cardBg,
                              borderColor: previewTheme.cardBorder,
                            }}
                          >
                            {cd.coverUrl ? (
                              <img src={cd.coverUrl} alt={cd.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <Disc className="w-12 h-12 opacity-40" style={{ color: previewTheme.accent }} />
                            )}
                            {/* Obi Strip */}
                            <div
                              className="absolute left-2.5 top-0 bottom-0 w-7 flex flex-col items-center justify-between py-2 px-0.5 text-center shadow-md border-x"
                              style={{
                                backgroundColor: previewTheme.obiBg,
                                color: previewTheme.obiText,
                                borderColor: previewTheme.accent,
                              }}
                            >
                              <span className="text-[6px] font-mono font-bold truncate w-full">
                                {cd.catalogNumber || 'STEREO'}
                              </span>
                              <span className="text-[7px] font-extrabold writing-vertical-rl tracking-tighter line-clamp-1">
                                {cd.title.slice(0, 12)}
                              </span>
                              <span className="text-[6px] font-mono">LP/CD</span>
                            </div>
                          </div>
                        </div>

                        {/* Metadata */}
                        <div className="space-y-0.5">
                          <div className="text-[9px] font-mono font-bold" style={{ color: previewTheme.accent }}>
                            CAT NO: {cd.catalogNumber || 'N/A'} • RELEASE: {cd.releaseDate || '-'} {cd.label ? `• ${cd.label}` : ''}
                          </div>
                          <div className="text-sm font-black truncate">{cd.title}</div>
                          <div className="text-xs font-bold truncate" style={{ color: previewTheme.textSecondary }}>
                            {cd.artist}
                          </div>
                        </div>

                        {/* Tracklist Box */}
                        <div
                          className="flex-1 rounded-lg border p-2.5 flex flex-col justify-between overflow-hidden"
                          style={{
                            backgroundColor: previewTheme.cardBg,
                            borderColor: previewTheme.cardBorder,
                          }}
                        >
                          <div>
                            <div className="flex items-center justify-between text-[8px] font-mono font-bold border-b pb-1 mb-1.5" style={{ borderColor: previewTheme.cardBorder, color: previewTheme.accent }}>
                              <span>TRACKLISTING ({cd.tracks?.length || 0} TRACKS)</span>
                              {includeBarcodeAndNotes && cd.barcode && <span>JAN: {cd.barcode}</span>}
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px]">
                              {(cd.tracks || []).slice(0, 16).map((tr, i) => (
                                <div key={i} className="flex items-center justify-between truncate border-b border-white/5 pb-0.5">
                                  <span className="truncate">
                                    <strong className="font-mono mr-1" style={{ color: previewTheme.accent }}>
                                      {String(tr.trackNumber || i + 1).padStart(2, '0')}.
                                    </strong>
                                    {tr.title}
                                  </span>
                                  <span className="font-mono text-[8px] ml-1" style={{ color: previewTheme.textMuted }}>
                                    {tr.duration}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {includeBarcodeAndNotes && cd.notes && (
                            <div className="text-[8px] italic truncate pt-1 border-t" style={{ color: previewTheme.textSecondary, borderColor: previewTheme.cardBorder }}>
                              NOTES: {cd.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : templateMode === 'jewel_insert' ? (
                  /* 12cm JEWEL CASE INSERT PREVIEW */
                  <div className="flex-1 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between text-[8px] font-mono border-b pb-1" style={{ borderColor: previewTheme.cardBorder }}>
                      <span style={{ color: previewTheme.accent }}>12cm CD JEWEL CASE INSERT</span>
                      <span style={{ color: previewTheme.textMuted }}>PAGE {currentPreviewPage.pageNumber}/{previewPages.length}</span>
                    </div>

                    <div className="flex-1 flex flex-col justify-around gap-3">
                      {currentPreviewPage.items.slice(0, 2).map((cd) => (
                        <div
                          key={cd.id}
                          className="border border-dashed rounded p-2 grid grid-cols-2 gap-2 h-48"
                          style={{
                            borderColor: previewTheme.accent,
                            backgroundColor: previewTheme.cardBg,
                          }}
                        >
                          {/* Front Panel */}
                          <div className="flex flex-col items-center justify-between border-r border-dashed pr-2 text-center" style={{ borderColor: previewTheme.cardBorder }}>
                            <div className="w-28 h-28 rounded overflow-hidden border flex items-center justify-center" style={{ borderColor: previewTheme.cardBorder }}>
                              {cd.coverUrl ? (
                                <img src={cd.coverUrl} alt={cd.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <Disc className="w-8 h-8 opacity-40" style={{ color: previewTheme.accent }} />
                              )}
                            </div>
                            <div className="w-full">
                              <div className="text-[7px] font-mono font-bold truncate" style={{ color: previewTheme.accent }}>
                                {cd.catalogNumber || 'CATALOG'}
                              </div>
                              <div className="text-[9px] font-extrabold truncate">{cd.title}</div>
                              <div className="text-[8px] truncate" style={{ color: previewTheme.textSecondary }}>
                                {cd.artist}
                              </div>
                            </div>
                          </div>

                          {/* Back Tracklist Panel */}
                          <div className="flex flex-col justify-between pl-1 overflow-hidden">
                            <div>
                              <div className="text-[7px] font-mono font-bold truncate" style={{ color: previewTheme.accent }}>
                                {cd.catalogNumber} • {cd.releaseDate}
                              </div>
                              <div className="text-[9px] font-bold truncate mb-1">{cd.title}</div>
                              <div className="space-y-0.5">
                                {(cd.tracks || []).slice(0, 8).map((tr, idx) => (
                                  <div key={idx} className="flex justify-between text-[7px] truncate">
                                    <span className="truncate">
                                      {String(tr.trackNumber || idx + 1).padStart(2, '0')}. {tr.title}
                                    </span>
                                    <span className="font-mono opacity-60">{tr.duration}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="text-[7px] font-mono opacity-60 text-right">✂ 120×120mm</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* CATALOG GRID PREVIEW */
                  <div className="flex-1 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between text-[8px] font-mono border-b pb-1" style={{ borderColor: previewTheme.cardBorder }}>
                      <span style={{ color: previewTheme.accent }}>{catalogTitle}</span>
                      <span style={{ color: previewTheme.textMuted }}>
                        PAGE {currentPreviewPage.pageNumber}/{previewPages.length}
                      </span>
                    </div>

                    <div className={`flex-1 grid ${gridColumns === 2 ? 'grid-cols-2' : 'grid-cols-3'} grid-rows-2 gap-2.5`}>
                      {currentPreviewPage.items.map((cd) => (
                        <div
                          key={cd.id}
                          className="rounded-lg border p-2 flex flex-col justify-between overflow-hidden"
                          style={{
                            backgroundColor: previewTheme.cardBg,
                            borderColor: previewTheme.cardBorder,
                          }}
                        >
                          <div>
                            <div className="flex items-start gap-2 mb-1.5">
                              <div className="w-14 h-14 rounded overflow-hidden border flex-shrink-0 flex items-center justify-center" style={{ borderColor: previewTheme.cardBorder }}>
                                {cd.coverUrl ? (
                                  <img src={cd.coverUrl} alt={cd.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  <Disc className="w-6 h-6 opacity-40" style={{ color: previewTheme.accent }} />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[7px] font-mono font-bold truncate" style={{ color: previewTheme.accent }}>
                                  {cd.catalogNumber || 'NO-CAT'}
                                </div>
                                <div className="text-[7px] font-mono truncate" style={{ color: previewTheme.textMuted }}>
                                  {cd.releaseDate || '-'}
                                </div>
                                <div className="text-[7px] font-mono mt-1" style={{ color: previewTheme.accent }}>
                                  ♪ {cd.tracks?.length || 0} 曲
                                </div>
                              </div>
                            </div>

                            <div className="text-[9px] font-extrabold truncate">{cd.title}</div>
                            <div className="text-[8px] font-semibold truncate mb-1" style={{ color: previewTheme.textSecondary }}>
                              {cd.artist}
                            </div>

                            {includeTracklistInGrid && (
                              <div className="space-y-0.5 pt-1 border-t" style={{ borderColor: previewTheme.cardBorder }}>
                                {(cd.tracks || []).slice(0, 5).map((tr, i) => (
                                  <div key={i} className="flex justify-between text-[7px] truncate">
                                    <span className="truncate">
                                      {String(tr.trackNumber || i + 1).padStart(2, '0')}. {tr.title}
                                    </span>
                                    <span className="font-mono opacity-60">{tr.duration}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-2">
                <Disc className="w-10 h-10 opacity-40" />
                <p className="text-xs font-bold">出力対象のCDを右側のリストから選択してください</p>
              </div>
            )}

            <p className="text-[11px] text-slate-400 mt-3 text-center">
              ※ 実際のPDFは A4サイズ (1240×1754px 高精細キャンバス描画) で日本語文字化けなしに出力されます
            </p>
          </div>

          {/* RIGHT PANEL: Target CD Selection List */}
          <div className="p-4 flex flex-col min-h-0 bg-slate-900/70">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-extrabold text-slate-200 flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5 text-amber-400" />
                <span>出力対象CDの選択</span>
              </label>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-500/40">
                {selectedIds.length} / {allCDs.length} 件選択中
              </span>
            </div>

            {/* Search & Select All */}
            <div className="space-y-2 mb-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={filterKeyword}
                  onChange={(e) => setFilterKeyword(e.target.value)}
                  placeholder="タイトル・歌手・型番で絞り込み..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAllFiltered}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                  <span>表示中を全選択 / 解除</span>
                </button>
              </div>
            </div>

            {/* Scrollable CD Checklist */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredSelectionCDs.map((cd) => {
                const isChecked = selectedIds.includes(cd.id);
                return (
                  <div
                    key={cd.id}
                    onClick={() => toggleSelectCD(cd.id)}
                    className={`p-2 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${
                      isChecked
                        ? 'bg-indigo-950/50 border-indigo-500/60 text-white'
                        : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:bg-slate-800/40'
                    }`}
                  >
                    {isChecked ? (
                      <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    )}

                    <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-700 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {cd.coverUrl ? (
                        <img src={cd.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <Disc className="w-4 h-4 text-slate-600" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate">{cd.title}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {cd.artist} • <span className="font-mono text-indigo-300">{cd.catalogNumber || '-'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
