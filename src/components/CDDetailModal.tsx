import React, { useState, useRef, useEffect } from 'react';
import { CDMetadata, TrackInfo, APISource, AITagAnalysisMetadata } from '../types/cd';
import { getJSTISOString, normalizeCatalogNumber, normalizeReleaseDate } from '../lib/dateUtils';
import { normalizeSingleTag, normalizeTagList } from '../lib/tagNormalizer';
import { toHankakuCode, formatToYYYYMMDD, formatToHankakuDuration } from '../utils/formatUtils';
import { enhanceImageWithCanvas, convertImageUrlToBase64 } from '../utils/imageEnhancer';
import { X, Save, Music, Disc, Info, Layers, Upload, ChevronLeft, ChevronRight, CheckCircle2, Check, Sparkles, Trash2, Loader2, Link2, BookOpen, Tag, ChevronDown, ChevronUp } from 'lucide-react';

interface CDDetailModalProps {
  cd: CDMetadata | null;
  onClose: () => void;
  onSaveCD: (updatedCD: CDMetadata) => void;
  onOpenPDFCatalog?: (cd: CDMetadata) => void;
  isSaved?: boolean;
  currentIndex?: number;
  totalCount?: number;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
}

export const CDDetailModal: React.FC<CDDetailModalProps> = ({
  cd,
  onClose,
  onSaveCD,
  onOpenPDFCatalog,
  isSaved,
  currentIndex,
  totalCount,
  onNavigatePrev,
  onNavigateNext,
}) => {
  if (!cd) return null;

  const [title, setTitle] = useState(cd.title);
  const [artist, setArtist] = useState(cd.artist);
  const [catalogNumber, setCatalogNumber] = useState(cd.catalogNumber);
  const [label, setLabel] = useState(cd.label || '');
  const [releaseDate, setReleaseDate] = useState(cd.releaseDate || '');
  const [vinylRecordReleaseDate, setVinylRecordReleaseDate] = useState(cd.vinylRecordReleaseDate || '');
  const [vinylRecordFormat, setVinylRecordFormat] = useState(cd.vinylRecordFormat || 'LP');
  const [vinylRecordCatalogNumber, setVinylRecordCatalogNumber] = useState(cd.vinylRecordCatalogNumber || '');
  const [isLookingUpVinyl, setIsLookingUpVinyl] = useState(false);
  const [vinylLookupCandidates, setVinylLookupCandidates] = useState<
    { releaseDate: string; format: string; catalogNumber?: string; label?: string; source: string }[]
  >([]);
  const [barcode, setBarcode] = useState(cd.barcode || '');
  const [notes, setNotes] = useState(cd.notes || '');
  const [coverUrl, setCoverUrl] = useState(cd.coverUrl || '');
  const [tagsInput, setTagsInput] = useState((cd.tags || []).join(', '));
  const [genre, setGenre] = useState(cd.genre || '');
  const [aiTagAnalysis, setAiTagAnalysis] = useState<AITagAnalysisMetadata | undefined>(cd.aiTagAnalysis);
  const [isAnalyzingTags, setIsAnalyzingTags] = useState(false);
  const [showTagEvidenceDetails, setShowTagEvidenceDetails] = useState(true);
  const [tracks, setTracks] = useState<TrackInfo[]>(cd.tracks || []);
  const [bulkTrackText, setBulkTrackText] = useState('');
  const [showBulkPasteInput, setShowBulkPasteInput] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'tracks' | 'sourceComparison'>('edit');
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [isSavedState, setIsSavedState] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [isConvertingBase64, setIsConvertingBase64] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synchronize state whenever navigating to a different CD
  useEffect(() => {
    if (cd) {
      setTitle(cd.title || '');
      setArtist(cd.artist || '');
      setCatalogNumber(cd.catalogNumber || '');
      setLabel(cd.label || '');
      setReleaseDate(cd.releaseDate || '');
      setVinylRecordReleaseDate(cd.vinylRecordReleaseDate || '');
      setVinylRecordFormat(cd.vinylRecordFormat || 'LP');
      setVinylRecordCatalogNumber(cd.vinylRecordCatalogNumber || '');
      setVinylLookupCandidates([]);
      setBarcode(cd.barcode || '');
      setNotes(cd.notes || '');
      setCoverUrl(cd.coverUrl || '');
      setTagsInput((cd.tags || []).join(', '));
      setGenre(cd.genre || '');
      setAiTagAnalysis(cd.aiTagAnalysis);
      setTracks(cd.tracks || []);
      setBulkTrackText('');
      setShowBulkPasteInput(false);
    }
  }, [cd?.id, cd]);

  // Keyboard navigation for Left / Right arrow keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // If active inside a text input/textarea, only navigate if Alt or Ctrl is held
      if (isInput && !e.altKey && !e.ctrlKey) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        if (onNavigatePrev) {
          e.preventDefault();
          onNavigatePrev();
        }
      } else if (e.key === 'ArrowRight') {
        if (onNavigateNext) {
          e.preventDefault();
          onNavigateNext();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNavigatePrev, onNavigateNext, onClose]);

  const normalizeToYYYYMMDD = (raw?: string | null): string => {
    if (!raw) return '';
    const cleaned = normalizeReleaseDate(raw);
    if (!cleaned) return String(raw).trim();
    if (/^\d{4}$/.test(cleaned)) {
      return `${cleaned}-01-01`;
    }
    if (/^\d{4}-\d{2}$/.test(cleaned)) {
      return `${cleaned}-01`;
    }
    return cleaned;
  };

  const handleNormalizeTrackDurations = () => {
    setTracks((prev) =>
      prev.map((tr) => ({
        ...tr,
        duration: formatTrackDuration(tr.duration || ''),
      }))
    );
  };

  const handleConvertLinkToBase64 = async () => {
    const trimmed = coverUrl.trim();
    if (!trimmed) {
      setSaveSuccessMessage('変換対象の画像URLを入力してください');
      return;
    }
    if (trimmed.startsWith('data:image/')) {
      setSaveSuccessMessage('すでにBASE64形式（Data URL）に変換済みです');
      setTimeout(() => setSaveSuccessMessage(null), 3000);
      return;
    }

    setIsConvertingBase64(true);
    try {
      const base64DataUrl = await convertImageUrlToBase64(trimmed);
      if (base64DataUrl && base64DataUrl.startsWith('data:image/')) {
        setCoverUrl(base64DataUrl);
        setSaveSuccessMessage('画像リンクからBASE64形式への変換が完了しました！「保存」を押すとDBに永続保存されます。');
        setTimeout(() => setSaveSuccessMessage(null), 4500);
      } else {
        setSaveSuccessMessage('画像の取得・BASE64変換に失敗しました。URLを確認するか直接画像をアップロードしてください。');
        setTimeout(() => setSaveSuccessMessage(null), 4500);
      }
    } catch (err) {
      console.error('Base64 conversion error:', err);
      setSaveSuccessMessage('画像のBASE64変換中にエラーが発生しました');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
    } finally {
      setIsConvertingBase64(false);
    }
  };

  const handleAnalyzeSingleCDTags = async () => {
    if (isAnalyzingTags) return;
    setIsAnalyzingTags(true);
    try {
      const existingTags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await fetch('/api/ai-analyze-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cds: [
            {
              id: cd.id,
              title,
              artist,
              catalogNumber,
              label,
              releaseDate,
              vinylRecordReleaseDate,
              vinylRecordFormat,
              vinylRecordCatalogNumber,
              tracks: tracks.slice(0, 10),
              genre,
              existingTags,
              notes,
            },
          ],
          options: {
            includeGenre: true,
            includeMood: true,
            includeEra: true,
            mergeMode: 'append',
          },
        }),
      });

      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error('AIタグ分析の応答解析に失敗しました');
      }

      if (!res.ok) {
        throw new Error(data.error || 'AIタグ分析に失敗しました');
      }

      const item = data.results?.[0];
      if (item) {
        const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
        const normalizedSuggested = normalizeTagList(item.suggestedTags || []);
        const normalizedExisting = normalizeTagList(existingTags);
        const newDecadeTag = normalizedSuggested.find((t: string) => decadeRegex.test(t));
        const cleanedExisting = newDecadeTag
          ? normalizedExisting.filter((t) => !decadeRegex.test(t) || t === newDecadeTag)
          : normalizedExisting;
        const mergedTags = normalizeTagList([...cleanedExisting, ...normalizedSuggested]);
        setTagsInput(mergedTags.join(', '));
        const unifiedGenre = normalizeSingleTag(item.genre || genre);
        if (unifiedGenre) setGenre(unifiedGenre);

        const newAnalysis: AITagAnalysisMetadata = {
          genre: unifiedGenre,
          subGenre: item.subGenre ? normalizeSingleTag(item.subGenre) : undefined,
          mood: item.mood,
          era: item.era,
          reasoning: item.reasoning,
          tagEvidence: item.tagEvidence,
          analyzedAt: getJSTISOString(),
        };
        setAiTagAnalysis(newAnalysis);
        setShowTagEvidenceDetails(true);
        setSaveSuccessMessage('AIによる自動タグ付けと分類根拠の生成が完了しました！「保存」を押すとDBに永続保存されます。');
        setTimeout(() => setSaveSuccessMessage(null), 4500);
      }
    } catch (err) {
      console.error('Single CD AI tag analysis error:', err);
      setSaveSuccessMessage('AIタグ分析中にエラーが発生しました');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
    } finally {
      setIsAnalyzingTags(false);
    }
  };

  const handleLookupVinylReleaseDate = async () => {
    if (!title.trim()) {
      setSaveSuccessMessage('LP/EPレコードを検索するにはアルバムタイトルを入力してください');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
      return;
    }

    setIsLookingUpVinyl(true);
    setVinylLookupCandidates([]);
    try {
      let discogsToken = '';
      try {
        const credsRaw = localStorage.getItem('cd_api_credentials');
        if (credsRaw) {
          const creds = JSON.parse(credsRaw);
          discogsToken = creds.discogsToken || '';
        }
      } catch {}

      const res = await fetch('/api/lookup-vinyl-release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              id: cd.id,
              title: title.trim(),
              artist: artist.trim(),
              catalogNumber: catalogNumber.trim(),
              releaseDate: releaseDate.trim(),
            },
          ],
          discogsToken,
        }),
      });

      if (!res.ok) {
        throw new Error('LP/EP発売日のAPI検索に失敗しました');
      }

      const data = await res.json();
      const first = data.results?.[0];
      if (first && first.found && first.vinylRecordReleaseDate) {
        setVinylRecordReleaseDate(first.vinylRecordReleaseDate);
        if (first.vinylRecordFormat) {
          setVinylRecordFormat(first.vinylRecordFormat);
        }
        if (first.vinylRecordCatalogNumber) {
          setVinylRecordCatalogNumber(first.vinylRecordCatalogNumber);
        }
        if (Array.isArray(first.candidates) && first.candidates.length > 1) {
          setVinylLookupCandidates(first.candidates);
        }
        setSaveSuccessMessage(
          `同タイトルのLP/EPレコード発売日「${first.vinylRecordReleaseDate}」(${first.vinylRecordFormat || 'LP'}${first.vinylRecordCatalogNumber ? ` / 品番:${first.vinylRecordCatalogNumber}` : ''}) をAPIから取得しました！`
        );
        setTimeout(() => setSaveSuccessMessage(null), 5000);
      } else {
        setSaveSuccessMessage('同タイトルのLP・EPレコード発売日はAPI上で見つかりませんでした（直接入力も可能です）');
        setTimeout(() => setSaveSuccessMessage(null), 4000);
      }
    } catch (err) {
      console.error('Vinyl release date lookup error:', err);
      setSaveSuccessMessage('LP/EPレコード発売日のAPI取得中にエラーが発生しました');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
    } finally {
      setIsLookingUpVinyl(false);
    }
  };

  const handleSaveSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    let finalCoverUrl = coverUrl.trim();
    if (finalCoverUrl && (finalCoverUrl.startsWith('http://') || finalCoverUrl.startsWith('https://'))) {
      setIsConvertingBase64(true);
      try {
        const converted = await convertImageUrlToBase64(finalCoverUrl);
        if (converted && converted.startsWith('data:image/')) {
          finalCoverUrl = converted;
          setCoverUrl(converted);
        }
      } catch {} finally {
        setIsConvertingBase64(false);
      }
    }

    const finalTags = normalizeTagList(tagsInput.split(',').map((t) => t.trim()).filter(Boolean));
    const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
    let finalGenre = genre ? normalizeSingleTag(genre) : (cd.genre ? normalizeSingleTag(cd.genre) : undefined);
    if (finalTags.length > 0 && finalGenre) {
      const genreParts = normalizeTagList([finalGenre]);
      if (!genreParts.some((g) => finalTags.includes(g))) {
        finalGenre = finalTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || finalTags[0];
      }
    } else if (finalTags.length === 0) {
      finalGenre = '';
    }

    const updatedCD: CDMetadata = {
      ...cd,
      title,
      artist,
      catalogNumber: normalizeCatalogNumber(catalogNumber),
      label,
      releaseDate: releaseDate ? normalizeToYYYYMMDD(releaseDate) : undefined,
      vinylRecordReleaseDate: vinylRecordReleaseDate ? normalizeToYYYYMMDD(vinylRecordReleaseDate) : undefined,
      vinylRecordFormat: vinylRecordReleaseDate ? vinylRecordFormat : undefined,
      vinylRecordCatalogNumber: vinylRecordCatalogNumber ? normalizeCatalogNumber(vinylRecordCatalogNumber) : undefined,
      barcode,
      notes,
      genre: finalGenre,
      tracks: tracks.map((tr) => ({
        ...tr,
        duration: formatTrackDuration(tr.duration || ''),
      })),
      coverUrl: finalCoverUrl,
      tags: finalTags,
      aiTagAnalysis: aiTagAnalysis
        ? {
            ...aiTagAnalysis,
            genre: finalGenre || aiTagAnalysis.genre,
            tagEvidence: (aiTagAnalysis.tagEvidence || []).filter((ev) =>
              finalTags.includes(normalizeSingleTag(ev.tag))
            ),
          }
        : undefined,
      updatedAt: getJSTISOString(),
    };
    onSaveCD(updatedCD);
    setIsSavedState(true);
    setSaveSuccessMessage('保存が完了しました！（LP/EPレコード発売日・ジャケット画像・タグ分類根拠を保存済）');
    setTimeout(() => {
      setIsSavedState(false);
      setSaveSuccessMessage(null);
    }, 3000);
  };

  const compressImageFile = (file: File, maxSide = 600, quality = 0.82): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxSide || height > maxSide) {
            if (width > height) {
              height = Math.round((height * maxSide) / width);
              width = maxSide;
            } else {
              width = Math.round((width * maxSide) / height);
              height = maxSide;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(e.target?.result as string);
        img.src = e.target?.result as string;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressedDataUrl = await compressImageFile(file, 600, 0.82);
      if (compressedDataUrl) {
        setCoverUrl(compressedDataUrl);
      }
    } catch (err) {
      console.error('Image compression error:', err);
    }
  };

  const handleUpscaleJacketInModal = async () => {
    if (!coverUrl) {
      setSaveSuccessMessage('アップスケーリング対象の画像URLがありません');
      return;
    }

    setIsUpscaling(true);
    try {
      const res = await fetch('/api/upscale-jacket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: coverUrl,
          title,
          artist,
          catalogNumber,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (data.enhancedImageBase64) {
        setCoverUrl(data.enhancedImageBase64);
        setSaveSuccessMessage('Gemini AIでジャケット画像を1K高画質化しました！「変更内容を保存」を押して保存してください。');
        setTimeout(() => setSaveSuccessMessage(null), 4500);
      } else if (data.isQuotaError || data.error) {
        // Fallback to high-res canvas sharpening
        const canvasEnhanced = await enhanceImageWithCanvas(coverUrl, 1000);
        setCoverUrl(canvasEnhanced);
        setSaveSuccessMessage('超解像キャンバスフィルターで1K高画質化を完了しました！「変更内容を保存」を押して保存してください。');
        setTimeout(() => setSaveSuccessMessage(null), 5000);
      } else {
        throw new Error('高画質化処理に失敗しました');
      }
    } catch (err: any) {
      console.error('Upscale error:', err);
      try {
        const canvasEnhanced = await enhanceImageWithCanvas(coverUrl, 1000);
        setCoverUrl(canvasEnhanced);
        setSaveSuccessMessage('キャンバス高画質化フィルターで1K超解像処理を適用しました。「変更内容を保存」を押してください。');
        setTimeout(() => setSaveSuccessMessage(null), 4500);
      } catch {
        setSaveSuccessMessage('画像高画質化処理に失敗しました。直接画像を再アップロードしてください。');
        setTimeout(() => setSaveSuccessMessage(null), 4500);
      }
    } finally {
      setIsUpscaling(false);
    }
  };

  const handleAddSingleTrack = () => {
    const newTrackNum = tracks.length + 1;
    setTracks([
      ...tracks,
      { trackNumber: newTrackNum, title: `トラック ${newTrackNum}`, duration: '' },
    ]);
  };

  const handleUpdateTrackTitle = (index: number, newTitle: string) => {
    const updated = [...tracks];
    updated[index] = { ...updated[index], title: newTitle };
    setTracks(updated);
  };

  const handleUpdateTrackDuration = (index: number, newDuration: string) => {
    const updated = [...tracks];
    updated[index] = { ...updated[index], duration: newDuration };
    setTracks(updated);
  };

  const handleReleaseDateChange = (val: string) => {
    const halfWidth = toHankakuCode(val);
    const digits = halfWidth.replace(/\D/g, '');
    if (digits.length === 8 || digits.length === 6) {
      setReleaseDate(formatToYYYYMMDD(digits));
      return;
    }
    setReleaseDate(halfWidth);
  };

  const handleReleaseDateBlur = () => {
    if (releaseDate) {
      setReleaseDate(formatToYYYYMMDD(releaseDate));
    }
  };

  const formatTrackDuration = (val: string): string => {
    if (!val) return '';
    let trimmed = val.trim();
    if (!trimmed) return '';

    // Full-width numbers & colons to half-width
    trimmed = trimmed.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    trimmed = trimmed.replace(/：/g, ':');

    // Japanese "3分45秒" or "3分" or "45秒"
    const minSecMatch = trimmed.match(/^(?:(\d+)分)?\s*(?:(\d+)秒)?$/);
    if (minSecMatch && (minSecMatch[1] || minSecMatch[2])) {
      const m = parseInt(minSecMatch[1] || '0', 10);
      const s = parseInt(minSecMatch[2] || '0', 10);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // Colon format: "3:45", "03:45", "1:23:45", "3:5"
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      if (parts.length === 2) {
        const mm = String(parseInt(parts[0], 10) || 0).padStart(2, '0');
        const ss = String(parseInt(parts[1], 10) || 0).padStart(2, '0');
        return `${mm}:${ss}`;
      } else if (parts.length === 3) {
        const hh = parseInt(parts[0], 10) || 0;
        const mm = parseInt(parts[1], 10) || 0;
        const ss = String(parseInt(parts[2], 10) || 0).padStart(2, '0');
        const totalMinutes = hh * 60 + mm;
        return `${String(totalMinutes).padStart(2, '0')}:${ss}`;
      }
      return trimmed;
    }

    // Pure digits e.g. "0100" -> "01:00", "100" -> "01:00", "345" -> "03:45", "1234" -> "12:34"
    const onlyDigits = trimmed.replace(/\D/g, '');
    if (!onlyDigits) return trimmed;

    if (onlyDigits.length === 4) {
      return `${onlyDigits.slice(0, 2)}:${onlyDigits.slice(2, 4)}`;
    } else if (onlyDigits.length === 3) {
      return `0${onlyDigits[0]}:${onlyDigits.slice(1, 3)}`;
    } else if (onlyDigits.length === 1 || onlyDigits.length === 2) {
      return `00:${onlyDigits.padStart(2, '0')}`;
    } else if (onlyDigits.length >= 5) {
      const padded = onlyDigits.padStart(6, '0');
      const hh = parseInt(padded.slice(0, 2), 10);
      const mm = parseInt(padded.slice(2, 4), 10);
      const ss = padded.slice(4, 6);
      return `${String(hh * 60 + mm).padStart(2, '0')}:${ss}`;
    }

    return trimmed;
  };

  const handleRemoveTrack = (index: number) => {
    const updated = tracks.filter((_, i) => i !== index).map((tr, idx) => ({
      ...tr,
      trackNumber: idx + 1,
    }));
    setTracks(updated);
  };

  const handleClearAllTracks = () => {
    setTracks([]);
    setBulkTrackText('');
  };

  const parseBulkTrackLines = (text: string): TrackInfo[] => {
    if (!text.trim()) return [];
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.map((line, idx) => {
      let duration = '';
      let cleanLine = line;

      // Extract duration e.g. (03:45), (0100), [3:45], [0100] or 03:45 / 0100 at end of line
      const durationMatch = cleanLine.match(/[\(\[\s]?(\d{1,2}:\d{2}|\d{3,4})[\)\]\s]?$/);
      if (durationMatch) {
        duration = formatTrackDuration(durationMatch[1]);
        cleanLine = cleanLine.replace(/[\(\[\s]?(\d{1,2}:\d{2}|\d{3,4})[\)\]\s]?$/, '').trim();
      }

      // Remove leading track numbers e.g. "1.", "01", "M-1", "Tr.01", "1 -"
      cleanLine = cleanLine
        .replace(/^(M[-\s]?\d+|Tr\.?\s*\d+|\d{1,3})[\.\s：:-]\s*/i, '')
        .trim();

      return {
        trackNumber: idx + 1,
        title: cleanLine || `トラック ${idx + 1}`,
        duration,
      };
    });
  };

  const handleParseBulkTracks = (mode: 'replace' | 'append') => {
    const parsed = parseBulkTrackLines(bulkTrackText);
    if (parsed.length === 0) return;

    if (mode === 'replace') {
      setTracks(parsed);
    } else {
      const startNum = tracks.length;
      const appended = parsed.map((tr, i) => ({
        ...tr,
        trackNumber: startNum + i + 1,
      }));
      setTracks([...tracks, ...appended]);
    }
    setShowBulkPasteInput(false);
    setBulkTrackText('');
  };

  const handleExportTracksToText = () => {
    const text = tracks
      .map((tr) => `${tr.trackNumber}. ${tr.title}${tr.duration ? ` (${tr.duration})` : ''}`)
      .join('\n');
    setBulkTrackText(text);
    setShowBulkPasteInput(true);
  };

  const toHalfWidthAscii = (str: string): string => {
    return str
      .replace(/[Ａ-Ｚａ-ｚ０-９！-～]/g, (s) =>
        String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
      )
      .replace(/　/g, ' ')
      .replace(/”/g, '"')
      .replace(/’/g, "'")
      .replace(/〜|～/g, '~');
  };

  const handleConvertTracksToHalfWidth = () => {
    setTracks((prev) =>
      prev.map((tr) => ({
        ...tr,
        title: toHalfWidthAscii(tr.title),
      }))
    );
  };

  const handleConvertBulkTextToHalfWidth = () => {
    setBulkTrackText(toHalfWidthAscii(bulkTrackText));
  };

  const sourceNames: Record<APISource, string> = {
    musicbrainz: 'MusicBrainz',
    discogs: 'Discogs',
    itunes: 'iTunes Search',
    ndl: '国立国会図書館 (NDL)',
    spotify: 'Spotify API',
    rakuten: '楽天ブックス CD',
    vgmdb: 'VGMdb',
    yahoo: 'Yahoo! ショッピング',
    gemini: 'AI OCR (Gemini)',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl h-[92vh] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Header (Fixed) */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-800 bg-slate-800/80 flex-shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center flex-shrink-0">
              <Disc className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white leading-tight truncate">
                CD メタデータ詳細
              </h2>
              <p className="text-xs text-slate-400 truncate">
                規格品番: <span className="font-mono text-indigo-300 font-bold">{catalogNumber || '未設定'}</span>
              </p>
            </div>
          </div>

          {/* Center/Right: Navigation Controls & Close */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Prev/Next Navigation Controls */}
            {(onNavigatePrev !== undefined || onNavigateNext !== undefined || totalCount !== undefined) && (
              <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-xl p-1 shadow-inner gap-1">
                <button
                  type="button"
                  onClick={onNavigatePrev}
                  disabled={!onNavigatePrev}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    onNavigatePrev
                      ? 'bg-slate-800 hover:bg-indigo-600 text-white hover:shadow cursor-pointer'
                      : 'text-slate-600 opacity-40 cursor-not-allowed'
                  }`}
                  title="前のCDへ移動 (キーボード: ← または Alt+←)"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">前へ</span>
                </button>

                {totalCount !== undefined && currentIndex !== undefined && (
                  <div className="px-2 py-0.5 text-center min-w-[50px]">
                    <span className="font-mono text-xs font-bold text-indigo-300">
                      {currentIndex + 1}
                    </span>
                    <span className="text-[10px] text-slate-500 mx-1">/</span>
                    <span className="font-mono text-xs text-slate-400">
                      {totalCount}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onNavigateNext}
                  disabled={!onNavigateNext}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    onNavigateNext
                      ? 'bg-slate-800 hover:bg-indigo-600 text-white hover:shadow cursor-pointer'
                      : 'text-slate-600 opacity-40 cursor-not-allowed'
                  }`}
                  title="次のCDへ移動 (キーボード: → または Alt+→)"
                >
                  <span className="hidden sm:inline">次へ</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="閉じる (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Fixed Top Section (Red Box): Cover Artwork + Metadata Summary + Navigation Tabs */}
        <div className="px-6 pt-4 pb-2 flex-shrink-0 border-b border-slate-800 bg-slate-900 space-y-3">
          
          {/* Hero Card */}
          <div className="flex flex-col sm:flex-row gap-4 bg-slate-800/40 p-4 rounded-xl border border-slate-800">
            {/* High Res Jacket Image & Image Change Actions */}
            <div className="flex flex-col gap-1.5 w-full sm:w-36 md:w-40 flex-shrink-0">
              <div className="w-full h-32 sm:h-36 rounded-xl bg-slate-900 overflow-hidden border border-slate-700 shadow-md relative group mx-auto">
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (!target.dataset.triedProxy && coverUrl && !coverUrl.startsWith('data:')) {
                        target.dataset.triedProxy = 'true';
                        target.src = `/api/image-proxy?url=${encodeURIComponent(coverUrl)}`;
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-3 text-center">
                    <Disc className="w-10 h-10 mb-1 opacity-40" />
                    <span className="text-[11px]">No Cover Image</span>
                  </div>
                )}
              </div>

              {/* Action under image */}
              <div className="flex flex-col gap-1 w-full">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-slate-400 hover:text-indigo-300 py-0.5 text-center flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  <span>画像を変更・登録</span>
                </button>

                {coverUrl && !coverUrl.startsWith('data:image/') && (
                  <button
                    type="button"
                    onClick={handleConvertLinkToBase64}
                    disabled={isConvertingBase64}
                    className="text-[11px] text-emerald-300 hover:text-emerald-200 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 rounded-lg py-1 text-center flex items-center justify-center gap-1 transition-all cursor-pointer font-semibold shadow-sm"
                    title="外部リンクのジャケット画像を取得してBASE64形式に変換し、オフラインでも消えないように保存します"
                  >
                    {isConvertingBase64 ? (
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-300" />
                    ) : (
                      <Link2 className="w-3 h-3 text-emerald-300" />
                    )}
                    <span>{isConvertingBase64 ? 'BASE64変換中...' : '🔗 リンクをBASE64化'}</span>
                  </button>
                )}

                {coverUrl && coverUrl.startsWith('data:image/') && (
                  <div className="text-[10px] text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 rounded-lg py-0.5 px-2 text-center flex items-center justify-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>BASE64変換済</span>
                  </div>
                )}

                {coverUrl && (
                  <button
                    type="button"
                    onClick={handleUpscaleJacketInModal}
                    disabled={isUpscaling}
                    className="text-[11px] text-purple-300 hover:text-purple-200 bg-purple-950/80 hover:bg-purple-900 border border-purple-500/40 rounded-lg py-1 text-center flex items-center justify-center gap-1 transition-all cursor-pointer font-semibold shadow-sm"
                    title="Gemini AIで低画質ジャケット画像を1K高画質化・ノイズ除去"
                  >
                    {isUpscaling ? (
                      <Loader2 className="w-3 h-3 animate-spin text-purple-300" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-purple-300" />
                    )}
                    <span>{isUpscaling ? 'AI高画質化中...' : '✨ AI高画質化'}</span>
                  </button>
                )}
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageFileUpload}
                accept="image/*"
                className="hidden"
              />
            </div>

            {/* Album Highlights */}
            <div className="flex-1 flex flex-col justify-between min-w-0 space-y-2">
              <div>
                <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                  <span className="text-[11px] font-mono font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded">
                    型番: {catalogNumber || '未設定'}
                  </span>

                  {cd.isExactMatch && (
                    <span className="text-[10px] font-bold text-amber-300 bg-amber-950/90 border border-amber-500/50 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                      🎯 {cd.exactMatchTypes?.includes('catalogNumber') && cd.exactMatchTypes?.includes('title')
                        ? 'タイトル・型番完全一致'
                        : cd.exactMatchTypes?.includes('catalogNumber')
                        ? '型番完全一致'
                        : 'タイトル完全一致'}
                    </span>
                  )}

                  {cd.verifiedByAI && (
                    <span className="text-[10px] font-bold text-purple-300 bg-purple-950/90 border border-purple-500/40 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                      <Sparkles className="w-2.5 h-2.5 text-purple-300" />
                      Gemini検証済
                    </span>
                  )}
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white truncate" title={title}>
                  {title}
                </h3>
                <p className="text-xs sm:text-sm font-semibold text-slate-300 truncate" title={artist}>
                  {artist}
                </p>

                {cd.aiVerificationSummary && (
                  <div className="bg-purple-950/30 border border-purple-800/40 rounded-lg p-2 text-[11px] text-purple-200 mt-2 flex items-start gap-1.5 leading-snug">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <span>{cd.aiVerificationSummary}</span>
                  </div>
                )}

                {aiTagAnalysis?.reasoning && (
                  <div className="bg-indigo-950/40 border border-indigo-500/40 rounded-lg p-2 text-[11px] text-indigo-200 mt-2 flex items-start gap-1.5 leading-snug">
                    <Tag className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-indigo-300 mr-1">AIタグ分類根拠・音楽的特徴:</span>
                      <span>{aiTagAnalysis.reasoning}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-300 pt-2 border-t border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[10px]">レーベル / 発売元</span>
                  <span className="font-medium text-slate-200 truncate block">{label || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">CD発売年月日</span>
                  <span className="font-medium text-slate-200 font-mono block">{normalizeReleaseDate(releaseDate) || '-'}</span>
                </div>
                <div>
                  <span className="text-amber-300/90 block text-[10px] font-semibold">同タイトルLP/EP発売日</span>
                  <span className="font-bold text-amber-300 font-mono block">
                    {vinylRecordReleaseDate
                      ? `${normalizeReleaseDate(vinylRecordReleaseDate)} (${vinylRecordFormat || 'LP'}${vinylRecordCatalogNumber ? `:${vinylRecordCatalogNumber}` : ''})`
                      : '未設定'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">バーコード (JAN)</span>
                  <span className="font-mono text-slate-200 block">{barcode || '-'}</span>
                </div>
              </div>

              {/* Primary Source Badge */}
              <div className="flex items-center gap-2 pt-0.5 text-xs text-slate-400">
                <span>主要取得ソース:</span>
                <span className="font-semibold text-indigo-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700 text-[11px]">
                  {sourceNames[cd.source] || cd.source}
                </span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs (Order: 1. 情報の直接編集・メモ, 2. トラックリスト, 3. API間比較) */}
          <div className="flex items-center gap-2 pt-1 border-b border-slate-800 pb-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('edit')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'edit'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Info className="w-4 h-4" />
              情報の直接編集・メモ
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tracks')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'tracks'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Music className="w-4 h-4" />
              トラックリスト (収録曲 {tracks.length}曲)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('sourceComparison')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'sourceComparison'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Layers className="w-4 h-4" />
              API間比較 (MusicBrainz/Discogs/iTunes/NDL)
            </button>
          </div>

        </div>

        {/* Content Area */}
        <div className={`flex-1 p-6 min-h-0 ${activeTab === 'tracks' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto space-y-4'}`}>
          
          {/* Tab 1: Direct Editing & Memo */}
          {activeTab === 'edit' && (
            <form onSubmit={handleSaveSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    アルバムタイトル
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    歌手・アーティスト名
                  </label>
                  <input
                    type="text"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-300">
                      型番（規格品番）
                    </label>
                    <span className="text-[10px] text-amber-300 font-medium">
                      半角入力のみ
                    </span>
                  </div>
                  <input
                    type="text"
                    inputMode="url"
                    value={catalogNumber}
                    onChange={(e) => setCatalogNumber(toHankakuCode(e.target.value))}
                    placeholder="半角英数 (例: VICL-60001)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono uppercase focus:border-indigo-500 focus:outline-none"
                    style={{ imeMode: 'disabled' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    レーベル / 発売元
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-300">
                      CD 発売年月日 (YYYY-MM-DD)
                    </label>
                    <span className="text-[10px] text-amber-300 font-medium">
                      半角数字のみ (自動変換)
                    </span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={releaseDate}
                    onChange={(e) => handleReleaseDateChange(e.target.value)}
                    onBlur={handleReleaseDateBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleReleaseDateBlur();
                      }
                    }}
                    placeholder="半角数字 (例: 19891221 → 1989-12-21)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none"
                    style={{ imeMode: 'disabled' }}
                    title="8桁の数字（例: 19891221）で入力すると YYYY-MM-DD に自動変換されます"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-300">
                      JAN/EAN バーコード
                    </label>
                    <span className="text-[10px] text-amber-300 font-medium">
                      半角数字のみ
                    </span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={barcode}
                    onChange={(e) => setBarcode(toHankakuCode(e.target.value))}
                    placeholder="半角数字 (例: 4988001123456)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none"
                    style={{ imeMode: 'disabled' }}
                  />
                </div>
              </div>

              {/* Same-Title LP / EP Vinyl Record Release Date & API Lookup Box */}
              <div className="bg-amber-950/20 border border-amber-500/40 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Disc className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span className="text-xs font-extrabold text-amber-200">
                      同タイトルのLP・EPレコード発売年月日 (アナログ盤情報)
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleLookupVinylReleaseDate}
                    disabled={isLookingUpVinyl}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white border border-amber-400/40 text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                    title="MusicBrainz・Discogs・国立国会図書館(NDL)・Geminiディスコグラフィ知識から同タイトルのLP/EPレコード発売日と規格品番を自動取得します"
                  >
                    {isLookingUpVinyl ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-100" />
                    ) : (
                      <Disc className="w-3.5 h-3.5 text-amber-100" />
                    )}
                    <span>
                      {isLookingUpVinyl
                        ? 'APIでLP/EP発売日を検索中...'
                        : '🔍 APIで同タイトルのLP/EP発売日を取得'}
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-200/90 mb-1">
                      LP / EP 発売年月日 (YYYY-MM-DD)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={vinylRecordReleaseDate}
                      onChange={(e) => {
                        const raw = toHankakuCode(e.target.value);
                        setVinylRecordReleaseDate(raw);
                      }}
                      onBlur={() => {
                        if (vinylRecordReleaseDate.trim()) {
                          setVinylRecordReleaseDate(formatToYYYYMMDD(vinylRecordReleaseDate));
                        }
                      }}
                      placeholder="例: 1982-05-21 (8桁数字自動変換)"
                      className="w-full bg-slate-900 border border-amber-500/40 rounded-lg p-2 text-xs text-amber-200 font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-amber-200/90 mb-1">
                      アナログ盤種別 (LP / EP)
                    </label>
                    <select
                      value={vinylRecordFormat}
                      onChange={(e) => setVinylRecordFormat(e.target.value)}
                      className="w-full bg-slate-900 border border-amber-500/40 rounded-lg p-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                    >
                      <option value="LP">LPレコード (30cm / 12inch アルバム)</option>
                      <option value="EP">EPレコード (17cm / 7inch シングル・EP)</option>
                      <option value="LP / EP">LP / EP 両方あり</option>
                      <option value="12inch">12インチシングル</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-amber-200/90 mb-1">
                      LP / EP 規格品番 (任意)
                    </label>
                    <input
                      type="text"
                      value={vinylRecordCatalogNumber}
                      onChange={(e) => setVinylRecordCatalogNumber(toHankakuCode(e.target.value))}
                      placeholder="例: 28AH-1450 / SV-7210"
                      className="w-full bg-slate-900 border border-amber-500/40 rounded-lg p-2 text-xs text-white font-mono uppercase focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Candidate selection if multiple vinyl editions were returned by API */}
                {vinylLookupCandidates.length > 1 && (
                  <div className="pt-1.5 border-t border-amber-500/20 space-y-1">
                    <span className="block text-[10px] font-bold text-amber-300">
                      検出されたアナログ盤候補（クリックで選択反映）:
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {vinylLookupCandidates.map((cand, cIdx) => (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={() => {
                            setVinylRecordReleaseDate(cand.releaseDate);
                            setVinylRecordFormat(cand.format.startsWith('EP') ? 'EP' : 'LP');
                            if (cand.catalogNumber) setVinylRecordCatalogNumber(cand.catalogNumber);
                          }}
                          className={`text-[10px] font-mono px-2 py-1 rounded-md border transition-all cursor-pointer ${
                            vinylRecordReleaseDate === cand.releaseDate
                              ? 'bg-amber-600 text-white border-amber-300 font-bold'
                              : 'bg-slate-900 text-amber-200 border-amber-500/30 hover:bg-slate-800'
                          }`}
                        >
                          {cand.releaseDate} [{cand.format}] {cand.catalogNumber ? `(${cand.catalogNumber})` : ''} - {cand.source}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between flex-wrap gap-1">
                  <span className="flex items-center gap-2">
                    <span>ジャケット画像 (URLリンク / BASE64データ)</span>
                    {coverUrl.startsWith('data:image/') ? (
                      <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.2 rounded-full">
                        ✓ BASE64変換済 ({Math.round(coverUrl.length / 1024)} KB)
                      </span>
                    ) : coverUrl.trim() ? (
                      <span className="text-[10px] font-medium text-amber-300 bg-amber-950/80 border border-amber-500/40 px-2 py-0.2 rounded-full">
                        外部URLリンク (保存時に自動BASE64化)
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <Upload className="w-3 h-3" />
                    <span>PC/スマホから画像をアップロード (BASE64化)</span>
                  </button>
                </label>
                <div className="flex flex-wrap sm:flex-nowrap gap-2">
                  <input
                    type="text"
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                    placeholder="https://... などの画像URLを入力するとBASE64形式に変換して保存できます"
                    className="flex-1 min-w-[200px] bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none"
                  />
                  {coverUrl && !coverUrl.startsWith('data:image/') && (
                    <button
                      type="button"
                      onClick={handleConvertLinkToBase64}
                      disabled={isConvertingBase64}
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shadow-sm disabled:opacity-50"
                      title="入力された画像リンクから画像を取得し、即座にBASE64形式へ変換します"
                    >
                      {isConvertingBase64 ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                      <span>{isConvertingBase64 ? '変換中...' : 'BASE64に変換'}</span>
                    </button>
                  )}
                  {coverUrl && (
                    <button
                      type="button"
                      onClick={() => setCoverUrl('')}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 border border-slate-700 text-xs transition-colors cursor-pointer whitespace-nowrap"
                      title="クリア"
                    >
                      クリア
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-purple-400" />
                    <span>タグ (カンマ区切り) ＆ AI自動分類根拠</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAnalyzeSingleCDTags}
                    disabled={isAnalyzingTags}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white border border-purple-400/40 text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                    title="このCDのタイトル・歌手・収録曲・発売日・規格品番からAIがタグと分類根拠（ジャンル選定理由・音楽的特徴）を自動生成します"
                  >
                    {isAnalyzingTags ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-200" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                    )}
                    <span>
                      {isAnalyzingTags
                        ? 'AIがタグと根拠を分析中...'
                        : aiTagAnalysis
                        ? '✨ AIタグ＆分類根拠を再分析'
                        : '✨ AIでタグ＆分類根拠を自動生成'}
                    </span>
                  </button>
                </div>

                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="J-POP, 80年代, 初回盤"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />

                {/* Interactive Tag Pills */}
                {tagsInput.trim() && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {tagsInput
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .map((tagItem, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-800 text-indigo-200 border border-slate-700 px-2.5 py-0.5 rounded-full"
                        >
                          <span>#{tagItem}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const nextTags = tagsInput
                                .split(',')
                                .map((t) => t.trim())
                                .filter((t) => t && t !== tagItem);
                              setTagsInput(nextTags.join(', '));
                            }}
                            className="text-slate-400 hover:text-rose-400 ml-0.5 font-bold cursor-pointer"
                            title="このタグを削除"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                  </div>
                )}

                {/* Persisted AI Tag Classification Basis & Musical Characteristics Panel */}
                {aiTagAnalysis && (
                  <div className="bg-slate-950/90 border border-purple-500/40 rounded-xl p-3.5 space-y-3 shadow-inner">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        <span className="text-xs font-extrabold text-purple-200">
                          AIタグ分類根拠（ジャンル選定理由・音楽的特徴の要約）
                        </span>
                      </div>
                      {aiTagAnalysis.analyzedAt && (
                        <span className="text-[10px] font-mono text-slate-400">
                          分析日時: {aiTagAnalysis.analyzedAt.slice(0, 16).replace('T', ' ')}
                        </span>
                      )}
                    </div>

                    {/* Genre / Mood / Era Summary Pills */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {(aiTagAnalysis.genre || genre) && (
                        <span className="text-[11px] bg-blue-950/90 text-blue-300 border border-blue-500/40 px-2.5 py-0.5 rounded-full font-bold">
                          主要ジャンル: {aiTagAnalysis.genre || genre}
                          {aiTagAnalysis.subGenre ? ` / ${aiTagAnalysis.subGenre}` : ''}
                        </span>
                      )}
                      {aiTagAnalysis.mood && (
                        <span className="text-[11px] bg-purple-950/90 text-purple-300 border border-purple-500/40 px-2.5 py-0.5 rounded-full font-bold">
                          雰囲気・ムード: {aiTagAnalysis.mood}
                        </span>
                      )}
                      {aiTagAnalysis.era && (
                        <span className="text-[11px] bg-amber-950/90 text-amber-300 border border-amber-500/40 px-2.5 py-0.5 rounded-full font-bold">
                          時代区分: {aiTagAnalysis.era}
                        </span>
                      )}
                    </div>

                    {/* Musical Characteristics Summary (Reasoning) */}
                    {aiTagAnalysis.reasoning && (
                      <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-lg p-2.5 text-xs text-indigo-100 leading-relaxed">
                        <span className="font-bold text-indigo-300 block mb-0.5 text-[11px]">
                          💡 ジャンル選定理由・音楽的特徴の要約:
                        </span>
                        <p>{aiTagAnalysis.reasoning}</p>
                      </div>
                    )}

                    {/* Per-Tag Evidence Breakdown */}
                    {aiTagAnalysis.tagEvidence && aiTagAnalysis.tagEvidence.length > 0 && (
                      <div className="space-y-2 pt-1 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setShowTagEvidenceDetails((prev) => !prev)}
                          className="flex items-center gap-1.5 text-[11px] font-bold text-purple-300 hover:text-purple-200 cursor-pointer"
                        >
                          {showTagEvidenceDetails ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                          <span>
                            個別タグごとの判定根拠・参照メタデータ ({aiTagAnalysis.tagEvidence.length}件)
                          </span>
                        </button>

                        {showTagEvidenceDetails && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {aiTagAnalysis.tagEvidence.map((ev, idx) => (
                              <div
                                key={idx}
                                className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 text-[11px] space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-extrabold text-white bg-purple-950/90 border border-purple-500/40 px-2 py-0.5 rounded text-[10px]">
                                    #{ev.tag}
                                  </span>
                                  {ev.sourceFields && ev.sourceFields.length > 0 && (
                                    <div className="flex items-center gap-1 flex-wrap justify-end">
                                      {ev.sourceFields.map((sf, sIdx) => (
                                        <span
                                          key={sIdx}
                                          className="text-[9px] font-mono bg-slate-800 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded"
                                        >
                                          参照: {sf}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <p className="text-slate-300 leading-relaxed">{ev.evidence}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  メモ・状態記録
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="盤面状態、帯の有無、コンディション等"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </form>
          )}

          {/* Tab 2: Track List (Only the tracklist table scrolls) */}
          {activeTab === 'tracks' && (
            <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-hidden">
              
              {/* Track Action Header (Fixed above table) */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 flex-shrink-0">
                <span className="text-xs font-bold text-slate-300">
                  収録曲一覧 ({tracks.length}曲) — 1曲ずつ個別編集 または 改行テキストで一括登録
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  {tracks.length > 0 && (
                    <button
                      type="button"
                      onClick={handleNormalizeTrackDurations}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white border border-emerald-400/40 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                      title="全トラックの演奏時間を MM:SS 形式に一括正規化"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                      <span>時間を正規化</span>
                    </button>
                  )}

                  {tracks.length > 0 && (
                    <button
                      type="button"
                      onClick={handleConvertTracksToHalfWidth}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors cursor-pointer"
                      title="曲名に含まれる全角英数・記号（Ａ-Ｚ, ０-９, ！）を半角ASCII文字(A-Z, 0-9, !)に一括変換"
                    >
                      <span>全角英数→半角ASCII一括変換</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (!showBulkPasteInput && tracks.length > 0 && !bulkTrackText) {
                        handleExportTracksToText();
                      } else {
                        setShowBulkPasteInput(!showBulkPasteInput);
                      }
                    }}
                    className="px-3 py-1 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Music className="w-3.5 h-3.5" />
                    <span>曲名を一括登録・テキスト入力</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAddSingleTrack}
                    className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium cursor-pointer"
                  >
                    ＋ 1曲追加
                  </button>

                  {tracks.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllTracks}
                      className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-800 text-rose-200 border border-rose-700/60 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                      title="トラックリストの曲名と時間をすべて削除します"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>全曲削除</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Enhanced Bulk Paste & Mass Edit UI */}
              {showBulkPasteInput && (
                <div className="bg-slate-800/90 p-4 rounded-xl border border-indigo-500/50 space-y-3 shadow-xl flex-shrink-0 max-h-56 overflow-y-auto">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="block text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                      <Music className="w-4 h-4 text-indigo-400" />
                      <span>曲名一括登録（改行区切りで曲名を貼り付け・入力）</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleConvertBulkTextToHalfWidth}
                        disabled={!bulkTrackText.trim()}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-700 hover:bg-indigo-600 text-slate-200 hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
                        title="入力欄の全角英数・全角記号を半角ASCII文字に一括変換"
                      >
                        全角英数→半角ASCII変換
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowBulkPasteInput(false)}
                        className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    各行に曲名を入力してください。「1. 曲名」や「01 曲名 (04:15)」のようなトラック番号・時間表記も自動認識します。
                  </p>

                  <textarea
                    value={bulkTrackText}
                    onChange={(e) => setBulkTrackText(e.target.value)}
                    rows={4}
                    placeholder="1. 曲名1 (03:45)&#10;2. 曲名2 (04:12)&#10;3. 曲名3"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none"
                  />

                  <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                    <span className="text-[11px] text-slate-400 font-mono">
                      検出曲数: {parseBulkTrackLines(bulkTrackText).length} 曲
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!bulkTrackText.trim()}
                        onClick={() => handleParseBulkTracks('append')}
                        className="px-3.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold disabled:opacity-40 border border-slate-600 cursor-pointer"
                      >
                        現在の曲の後に追加
                      </button>

                      <button
                        type="button"
                        disabled={!bulkTrackText.trim()}
                        onClick={() => handleParseBulkTracks('replace')}
                        className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow disabled:opacity-40 cursor-pointer"
                      >
                        全曲置き換え一括登録
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Dedicated Scrollable Track Table (Only this box scrolls) */}
              {tracks.length > 0 ? (
                <div className="flex-1 min-h-0 bg-slate-800/50 rounded-xl border border-slate-800 overflow-y-auto overflow-x-hidden shadow-inner">
                  <table className="w-full text-left text-xs text-slate-300 relative border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-800 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-700 shadow-sm">
                      <tr>
                        <th className="py-2.5 px-3 w-12 text-center bg-slate-800 font-bold">#</th>
                        <th className="py-2.5 px-3 bg-slate-800 font-bold">曲名 (クリックして直接編集)</th>
                        <th className="py-2.5 px-3 w-28 text-center bg-slate-800 font-bold">HH:MM</th>
                        <th className="py-2.5 px-3 w-12 text-center bg-slate-800 font-bold">削除</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {tracks.map((tr, i) => (
                        <tr key={i} className="hover:bg-slate-800/80 transition-colors">
                          <td className="py-2 px-3 text-center font-mono text-slate-400">
                            {tr.trackNumber}
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={tr.title}
                              onChange={(e) => handleUpdateTrackTitle(i, e.target.value)}
                              className="w-full bg-slate-900/80 border border-slate-700/80 focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none"
                            />
                          </td>
                          <td className="py-2 px-3 w-28">
                            <input
                              type="text"
                              inputMode="numeric"
                              data-duration-index={i}
                              value={tr.duration || ''}
                              placeholder="03:45"
                              style={{ imeMode: 'disabled' }}
                              onChange={(e) => {
                                const val = formatToHankakuDuration(e.target.value);
                                if (/^\d{4}$/.test(val)) {
                                  handleUpdateTrackDuration(i, formatTrackDuration(val));
                                } else {
                                  handleUpdateTrackDuration(i, val);
                                }
                              }}
                              onBlur={(e) => {
                                const formatted = formatTrackDuration(e.target.value);
                                handleUpdateTrackDuration(i, formatted);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const formatted = formatTrackDuration((e.target as HTMLInputElement).value || tr.duration || '');
                                  handleUpdateTrackDuration(i, formatted);
                                  const nextInput = document.querySelector<HTMLInputElement>(
                                    `input[data-duration-index="${i + 1}"]`
                                  );
                                  if (nextInput) {
                                    nextInput.focus();
                                    nextInput.select();
                                  } else {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }
                              }}
                              className="w-full bg-slate-900/80 border border-slate-700/80 focus:border-indigo-500 rounded px-2 py-1.5 text-xs text-slate-200 font-mono text-center placeholder-slate-600 focus:outline-none"
                              title="演奏時間（例: 0100 → 01:00, 03:45）"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveTrack(i)}
                              className="p-1 text-slate-500 hover:text-rose-400 transition-colors rounded hover:bg-slate-800 cursor-pointer"
                              title="曲を削除"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center bg-slate-800/30 rounded-xl p-8 text-center text-slate-400 text-xs border border-slate-800 space-y-3">
                  <p>収録曲情報がありません。</p>
                  <button
                    type="button"
                    onClick={() => setShowBulkPasteInput(true)}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs cursor-pointer"
                  >
                    曲名をテキストで一括入力する
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Raw API Sources Comparison */}
          {activeTab === 'sourceComparison' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                各APIが返した個別のメタデータ項目です。違いを確認できます:
              </p>

              <div className="overflow-x-auto bg-slate-800/50 rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-slate-300 min-w-[600px]">
                  <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] border-b border-slate-700">
                    <tr>
                      <th className="py-2.5 px-4 w-32">API</th>
                      <th className="py-2.5 px-4">タイトル</th>
                      <th className="py-2.5 px-4">アーティスト</th>
                      <th className="py-2.5 px-4">型番</th>
                      <th className="py-2.5 px-4">発売年/日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {(['musicbrainz', 'discogs', 'itunes', 'ndl', 'spotify', 'rakuten'] as APISource[]).map((src) => {
                      const raw = cd.rawSources?.[src];
                      return (
                        <tr key={src} className={raw ? 'hover:bg-slate-800/60' : 'opacity-40'}>
                          <td className="py-2.5 px-4 font-semibold text-white">
                            {sourceNames[src]}
                          </td>
                          <td className="py-2.5 px-4">{raw?.title || '-'}</td>
                          <td className="py-2.5 px-4">{raw?.artist || '-'}</td>
                          <td className="py-2.5 px-4 font-mono text-indigo-300">{raw?.catalogNumber || '-'}</td>
                          <td className="py-2.5 px-4">{raw?.releaseDate || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer Actions (Fixed) */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-800 bg-slate-800/70 flex-shrink-0">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer"
            >
              閉じる
            </button>

            {onOpenPDFCatalog && (
              <button
                type="button"
                onClick={() =>
                  onOpenPDFCatalog({
                    ...cd,
                    title,
                    artist,
                    catalogNumber: normalizeCatalogNumber(catalogNumber),
                    label,
                    releaseDate: releaseDate ? normalizeToYYYYMMDD(releaseDate) : undefined,
                    vinylRecordReleaseDate: vinylRecordReleaseDate ? normalizeToYYYYMMDD(vinylRecordReleaseDate) : undefined,
                    vinylRecordFormat: vinylRecordReleaseDate ? vinylRecordFormat : undefined,
                    vinylRecordCatalogNumber: vinylRecordCatalogNumber ? normalizeCatalogNumber(vinylRecordCatalogNumber) : undefined,
                    barcode,
                    notes,
                    tracks,
                    coverUrl,
                    tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
                  })
                }
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white border border-amber-400/40 shadow-md transition-all cursor-pointer"
                title="このCDのアナログジャケット風ライナーノーツやCDケース差し込みカードをPDF出力"
              >
                <BookOpen className="w-3.5 h-3.5 text-amber-100" />
                <span>アナログジャケット風PDF出力</span>
              </button>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 w-full sm:w-auto">
            {saveSuccessMessage && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-300 font-bold bg-emerald-950/80 border border-emerald-500/40 px-3 py-1.5 rounded-xl animate-in fade-in slide-in-from-right-3 duration-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>{saveSuccessMessage}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleSaveSubmit}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-lg transition-all cursor-pointer ${
                isSavedState
                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
              }`}
            >
              {isSavedState ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>保存完了！</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{isSaved ? '変更を上書き保存' : 'ライブラリに追加保存'}</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>

      {/* Floating Side Previous CD Button (Left) */}
      {onNavigatePrev && (
        <button
          type="button"
          onClick={onNavigatePrev}
          className="hidden md:flex fixed left-3 lg:left-8 top-1/2 -translate-y-1/2 z-50 w-11 h-11 rounded-full bg-slate-800/90 hover:bg-indigo-600 border border-slate-700 hover:border-indigo-400 text-slate-200 hover:text-white items-center justify-center shadow-2xl transition-all cursor-pointer group"
          title="前のCDへ移動 (キーボード: ←)"
        >
          <ChevronLeft className="w-6 h-6 group-hover:-translate-x-0.5 transition-transform" />
        </button>
      )}

      {/* Floating Side Next CD Button (Right) */}
      {onNavigateNext && (
        <button
          type="button"
          onClick={onNavigateNext}
          className="hidden md:flex fixed right-3 lg:right-8 top-1/2 -translate-y-1/2 z-50 w-11 h-11 rounded-full bg-slate-800/90 hover:bg-indigo-600 border border-slate-700 hover:border-indigo-400 text-slate-200 hover:text-white items-center justify-center shadow-2xl transition-all cursor-pointer group"
          title="次のCDへ移動 (キーボード: →)"
        >
          <ChevronRight className="w-6 h-6 group-hover:translate-x-0.5 transition-transform" />
        </button>
      )}
    </div>
  );
};
