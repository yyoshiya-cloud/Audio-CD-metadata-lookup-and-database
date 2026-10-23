import React, { useState, useRef, useEffect } from 'react';
import { SOURCE_FULL_LABELS } from '../config/sources';
import { normalizeReading } from '../lib/readingSort';
import { SourceComparisonTab } from './detail/SourceComparisonTab';
import { TrackListTab } from './detail/TrackListTab';
import { CDMetadata, TrackInfo, APISource, AITagAnalysisMetadata, CDSubImage, SubImageType } from '../types/cd';
import { getJSTISOString, normalizeCatalogNumber, normalizeReleaseDate } from '../lib/dateUtils';
import { normalizeSingleTag, normalizeTagList, applyGenreRuleFilter } from '../lib/tagNormalizer';
import { loadTagPresetsDB, saveTagPresetsDB, DEFAULT_TAG_PRESETS } from '../lib/db';
import {
  toHankakuCode,
  toHalfWidthAscii,
  formatToYYYYMMDD,
  formatToHankakuDuration,
  formatTrackDuration,
  validateDateInput,
  validateTrackDuration,
  lookupVinylReleasesBatch,
} from '../utils/formatUtils';
import { enhanceImageWithCanvas, convertImageUrlToBase64, compressImageFile } from '../utils/imageEnhancer';
import { X, Save, Music, Disc, Info, Layers, Upload, ChevronLeft, ChevronRight, CheckCircle2, Check, Sparkles, Trash2, Loader2, Link2, BookOpen, Tag, ChevronDown, ChevronUp, ShieldCheck, Plus, Edit3, Images, ZoomIn, Star } from 'lucide-react';
import { createLogger } from '../lib/logger';

const log = createLogger('CDDetailModal');

interface CDDetailModalProps {
  cd: CDMetadata | null;
  onClose: () => void;
  onSaveCD: (updatedCD: CDMetadata) => void;
  onOpenPDFCatalog?: (cd: CDMetadata) => void;
  onOpenTagManager?: () => void;
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
  onOpenTagManager,
  isSaved,
  currentIndex,
  totalCount,
  onNavigatePrev,
  onNavigateNext,
}) => {
  if (!cd) return null;

  const [title, setTitle] = useState(cd.title);
  const [artist, setArtist] = useState(cd.artist);
  // 読み仮名（ひらがな）。五十音順の並べ替えに使う
  const [titleReading, setTitleReading] = useState(cd.titleReading || '');
  const [artistReading, setArtistReading] = useState(cd.artistReading || '');
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
  const [subImages, setSubImages] = useState<CDSubImage[]>(cd.subImages || []);
  const [activeImageSlot, setActiveImageSlot] = useState<'front' | string>('front');
  const [isImageLightboxOpen, setIsImageLightboxOpen] = useState(false);
  const [pendingSubImageType, setPendingSubImageType] = useState<SubImageType>('back');
  const [tagsInput, setTagsInput] = useState((cd.tags || []).join(', '));
  const [genre, setGenre] = useState(cd.genre || '');
  const [rating, setRating] = useState<number>(cd.rating || 0);
  const [aiTagAnalysis, setAiTagAnalysis] = useState<AITagAnalysisMetadata | undefined>(cd.aiTagAnalysis);
  const [isAnalyzingTags, setIsAnalyzingTags] = useState(false);
  const [showTagEvidenceDetails, setShowTagEvidenceDetails] = useState(true);
  const [tagPresets, setTagPresets] = useState<string[]>(DEFAULT_TAG_PRESETS);
  const [newSingleTagInput, setNewSingleTagInput] = useState('');
  const [editingPillIndex, setEditingPillIndex] = useState<number | null>(null);
  const [editingPillValue, setEditingPillValue] = useState('');
  const [tracks, setTracks] = useState<TrackInfo[]>(cd.tracks || []);

  useEffect(() => {
    loadTagPresetsDB().then((loaded) => setTagPresets(loaded));
  }, []);
  const [bulkTrackText, setBulkTrackText] = useState('');
  const [showBulkPasteInput, setShowBulkPasteInput] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'tracks' | 'sourceComparison'>('edit');
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [validationErrorMessage, setValidationErrorMessage] = useState<string | null>(null);
  const [releaseDateError, setReleaseDateError] = useState<string | null>(null);
  const [vinylDateError, setVinylDateError] = useState<string | null>(null);
  const [trackDurationErrors, setTrackDurationErrors] = useState<Record<number, string>>({});
  const [isSavedState, setIsSavedState] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [isConvertingBase64, setIsConvertingBase64] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const subImageFileInputRef = useRef<HTMLInputElement>(null);
  const loadedCdIdRef = useRef<string | null>(cd.id);
  const [isDirty, setIsDirty] = useState(false);

  // Synchronize state only when navigating to a different CD
  useEffect(() => {
    if (cd && cd.id !== loadedCdIdRef.current) {
      loadedCdIdRef.current = cd.id;
      setTitle(cd.title || '');
      setArtist(cd.artist || '');
      setTitleReading(cd.titleReading || '');
      setArtistReading(cd.artistReading || '');
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
      setSubImages(cd.subImages || []);
      setActiveImageSlot('front');
      setIsImageLightboxOpen(false);
      setTagsInput((cd.tags || []).join(', '));
      setGenre(cd.genre || '');
      setRating(cd.rating || 0);
      setAiTagAnalysis(cd.aiTagAnalysis);
      setTracks(cd.tracks || []);
      setBulkTrackText('');
      setShowBulkPasteInput(false);
      setIsDirty(false);
      setValidationErrorMessage(null);
      setReleaseDateError(null);
      setVinylDateError(null);
      setTrackDurationErrors({});
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
          handlePrevWithAutoSave();
        }
      } else if (e.key === 'ArrowRight') {
        if (onNavigateNext) {
          e.preventDefault();
          handleNextWithAutoSave();
        }
      } else if (e.key === 'Escape') {
        if (isImageLightboxOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsImageLightboxOpen(false);
          return;
        }
        handleCloseWithAutoSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNavigatePrev, onNavigateNext, onClose, isImageLightboxOpen, isDirty, isSaved, tagsInput, genre, aiTagAnalysis, title, artist, titleReading, artistReading, catalogNumber, label, releaseDate, vinylRecordReleaseDate, vinylRecordFormat, vinylRecordCatalogNumber, barcode, notes, tracks, coverUrl]);

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
      log.error('Base64 conversion error:', err);
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
              barcode,
              country: cd.country,
              format: cd.format,
              tracks: tracks.slice(0, 12),
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
        const mergedCandidateTags = normalizeTagList([...cleanedExisting, ...normalizedSuggested]);

        const clientRuleFiltered = applyGenreRuleFilter(
          {
            title,
            artist,
            catalogNumber,
            label,
            releaseDate,
            vinylRecordReleaseDate,
            vinylRecordFormat,
            vinylRecordCatalogNumber,
            barcode,
            country: cd.country,
            format: cd.format,
            tracks,
            genre,
            notes,
          },
          mergedCandidateTags,
          normalizeSingleTag(item.genre || genre),
          item.subGenre ? normalizeSingleTag(item.subGenre) : undefined,
          item.reasoning,
          item.tagEvidence || []
        );

        const combinedAdjustments = [...(item.ruleAdjustments || [])];
        for (const adj of clientRuleFiltered.ruleAdjustments) {
          if (!combinedAdjustments.includes(adj)) {
            combinedAdjustments.push(adj);
          }
        }

        const newTagsString = clientRuleFiltered.suggestedTags.join(', ');
        setTagsInput(newTagsString);
        const unifiedGenre = clientRuleFiltered.genre || normalizeSingleTag(item.genre || genre);
        if (unifiedGenre) setGenre(unifiedGenre);

        const newAnalysis: AITagAnalysisMetadata = {
          genre: unifiedGenre,
          subGenre: clientRuleFiltered.subGenre,
          mood: item.mood,
          era: item.era,
          reasoning: item.reasoning,
          tagEvidence: clientRuleFiltered.tagEvidence,
          ruleAdjustments: combinedAdjustments,
          analyzedAt: getJSTISOString(),
        };
        setAiTagAnalysis(newAnalysis);
        setShowTagEvidenceDetails(true);

        const autoSavedCD: CDMetadata = {
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
          genre: unifiedGenre || '',
          tracks: tracks.map((tr) => ({
            ...tr,
            duration: formatTrackDuration(tr.duration || ''),
          })),
          coverUrl,
          tags: clientRuleFiltered.suggestedTags,
          aiTagAnalysis: newAnalysis,
          updatedAt: getJSTISOString(),
        };
        onSaveCD(autoSavedCD);
        setIsSavedState(true);
        setSaveSuccessMessage('AIによる自動タグ付けと複合メタデータ検証が完了し、DBに自動保存しました！');
        setTimeout(() => {
          setIsSavedState(false);
          setSaveSuccessMessage(null);
        }, 4500);
      }
    } catch (err) {
      log.error('Single CD AI tag analysis error:', err);
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
      const results = await lookupVinylReleasesBatch([
        {
          id: cd.id,
          title: title.trim(),
          titleReading: normalizeReading(titleReading) || undefined,
          artistReading: normalizeReading(artistReading) || undefined,
          artist: artist.trim(),
          catalogNumber: catalogNumber.trim(),
          releaseDate: releaseDate.trim(),
        },
      ]);

      const first = results[0];
      if (first && first.found && first.vinylRecordReleaseDate) {
        setVinylRecordReleaseDate(first.vinylRecordReleaseDate);
        setVinylDateError(null);
        if (first.vinylRecordFormat) {
          setVinylRecordFormat(first.vinylRecordFormat);
        }
        if (first.vinylRecordCatalogNumber) {
          setVinylRecordCatalogNumber(first.vinylRecordCatalogNumber);
        }
        if (Array.isArray(first.candidates) && first.candidates.length > 1) {
          setVinylLookupCandidates(first.candidates);
        }
        setIsDirty(true);
        setSaveSuccessMessage(
          `同タイトルのLP/EPレコード発売日「${first.vinylRecordReleaseDate}」(${first.vinylRecordFormat || 'LP'}${first.vinylRecordCatalogNumber ? ` / 品番:${first.vinylRecordCatalogNumber}` : ''}) をAPIから取得しました！`
        );
        setTimeout(() => setSaveSuccessMessage(null), 5000);
      } else {
        setSaveSuccessMessage('同タイトルのLP・EPレコード発売日はAPI上で見つかりませんでした（直接入力も可能です）');
        setTimeout(() => setSaveSuccessMessage(null), 4000);
      }
    } catch (err) {
      log.error('Vinyl release date lookup error:', err);
      setSaveSuccessMessage('LP/EPレコード発売日のAPI取得中にエラーが発生しました');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
    } finally {
      setIsLookingUpVinyl(false);
    }
  };

  const validateAllDateAndTimeInputs = (): string | null => {
    let firstError: string | null = null;

    if (releaseDate.trim()) {
      const relCheck = validateDateInput(releaseDate.trim());
      if (!relCheck.valid) {
        const msg = relCheck.error || 'ありえない日付です';
        setReleaseDateError(msg);
        firstError = `【CD発売年月日エラー】${msg}`;
      } else {
        setReleaseDateError(null);
      }
    } else {
      setReleaseDateError(null);
    }

    if (vinylRecordReleaseDate.trim()) {
      const vinylCheck = validateDateInput(vinylRecordReleaseDate.trim());
      if (!vinylCheck.valid) {
        const msg = vinylCheck.error || 'ありえない日付です';
        setVinylDateError(msg);
        if (!firstError) firstError = `【LP/EP発売年月日エラー】${msg}`;
      } else {
        setVinylDateError(null);
      }
    } else {
      setVinylDateError(null);
    }

    const nextTrackErrors: Record<number, string> = {};
    tracks.forEach((tr, idx) => {
      const rawDur = (tr.duration || '').trim();
      if (rawDur) {
        const durCheck = validateTrackDuration(rawDur);
        if (!durCheck.valid) {
          const msg = durCheck.error || 'ありえない時間です';
          nextTrackErrors[idx] = msg;
          if (!firstError) {
            firstError = `【トラック#${tr.trackNumber || idx + 1} 演奏時間エラー】${msg}`;
          }
        }
      }
    });
    setTrackDurationErrors(nextTrackErrors);

    return firstError;
  };

  const handleSaveSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const validationErr = validateAllDateAndTimeInputs();
    if (validationErr) {
      setValidationErrorMessage(validationErr);
      setTimeout(() => setValidationErrorMessage(null), 5000);
      return;
    }
    setValidationErrorMessage(null);

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

    const finalTags = normalizeTagList(
      tagsInput.split(/[,、]/).map((t) => t.trim()).filter(Boolean),
      { preserveCustomName: true }
    );
    const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
    let finalGenre = genre
      ? normalizeSingleTag(genre, { preserveCustomName: true })
      : cd.genre
      ? normalizeSingleTag(cd.genre, { preserveCustomName: true })
      : undefined;
    if (finalTags.length > 0) {
      if (finalGenre) {
        const genreParts = normalizeTagList([finalGenre], { preserveCustomName: true });
        if (!genreParts.some((g) => finalTags.includes(g))) {
          finalGenre = finalTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || finalTags[0];
        }
      } else {
        finalGenre = finalTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || finalTags[0];
      }
    } else {
      finalGenre = '';
    }

    const updatedAiTagAnalysis: AITagAnalysisMetadata | undefined = aiTagAnalysis
      ? {
          ...aiTagAnalysis,
          genre: finalTags.length > 0 ? (finalGenre || '') : '',
          subGenre:
            aiTagAnalysis.subGenre && finalTags.includes(normalizeSingleTag(aiTagAnalysis.subGenre, { preserveCustomName: true }))
              ? normalizeSingleTag(aiTagAnalysis.subGenre, { preserveCustomName: true })
              : undefined,
          tagEvidence: (aiTagAnalysis.tagEvidence || []).filter((ev) =>
            finalTags.includes(normalizeSingleTag(ev.tag, { preserveCustomName: true }))
          ),
        }
      : undefined;

    setTagsInput(finalTags.join(', '));
    setGenre(finalGenre || '');
    setAiTagAnalysis(updatedAiTagAnalysis);

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
      subImages,
      tags: finalTags,
      aiTagAnalysis: updatedAiTagAnalysis,
      updatedAt: getJSTISOString(),
    };
    onSaveCD(updatedCD);
    setIsDirty(false);
    setIsSavedState(true);
    setSaveSuccessMessage('保存が完了しました！（LP/EPレコード発売日・ジャケット画像・タグ分類根拠を保存済）');
    setTimeout(() => {
      setIsSavedState(false);
      setSaveSuccessMessage(null);
    }, 3000);
  };

  const buildCurrentUpdatedCD = (): CDMetadata => {
    const finalTags = normalizeTagList(
      tagsInput.split(/[,、]/).map((t) => t.trim()).filter(Boolean),
      { preserveCustomName: true }
    );
    const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
    let finalGenre = genre
      ? normalizeSingleTag(genre, { preserveCustomName: true })
      : cd.genre
      ? normalizeSingleTag(cd.genre, { preserveCustomName: true })
      : undefined;
    if (finalTags.length > 0) {
      if (finalGenre) {
        const genreParts = normalizeTagList([finalGenre], { preserveCustomName: true });
        if (!genreParts.some((g) => finalTags.includes(g))) {
          finalGenre = finalTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || finalTags[0];
        }
      } else {
        finalGenre = finalTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || finalTags[0];
      }
    } else {
      finalGenre = '';
    }

    const updatedAiTagAnalysis: AITagAnalysisMetadata | undefined = aiTagAnalysis
      ? {
          ...aiTagAnalysis,
          genre: finalTags.length > 0 ? (finalGenre || '') : '',
          subGenre:
            aiTagAnalysis.subGenre && finalTags.includes(normalizeSingleTag(aiTagAnalysis.subGenre, { preserveCustomName: true }))
              ? normalizeSingleTag(aiTagAnalysis.subGenre, { preserveCustomName: true })
              : undefined,
          tagEvidence: (aiTagAnalysis.tagEvidence || []).filter((ev) =>
            finalTags.includes(normalizeSingleTag(ev.tag, { preserveCustomName: true }))
          ),
        }
      : undefined;

    return {
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
      coverUrl: coverUrl.trim(),
      subImages,
      tags: finalTags,
      rating,
      aiTagAnalysis: updatedAiTagAnalysis,
      updatedAt: getJSTISOString(),
    };
  };

  const handleCloseWithAutoSave = () => {
    if (isSaved && isDirty) {
      const validationErr = validateAllDateAndTimeInputs();
      if (validationErr) {
        setValidationErrorMessage(validationErr);
        setTimeout(() => setValidationErrorMessage(null), 5000);
        return;
      }
      onSaveCD(buildCurrentUpdatedCD());
    }
    onClose();
  };

  const handlePrevWithAutoSave = () => {
    if (!onNavigatePrev) return;
    if (isSaved && isDirty) {
      const validationErr = validateAllDateAndTimeInputs();
      if (validationErr) {
        setValidationErrorMessage(validationErr);
        setTimeout(() => setValidationErrorMessage(null), 5000);
        return;
      }
      onSaveCD(buildCurrentUpdatedCD());
    }
    onNavigatePrev();
  };

  const handleNextWithAutoSave = () => {
    if (!onNavigateNext) return;
    if (isSaved && isDirty) {
      const validationErr = validateAllDateAndTimeInputs();
      if (validationErr) {
        setValidationErrorMessage(validationErr);
        setTimeout(() => setValidationErrorMessage(null), 5000);
        return;
      }
      onSaveCD(buildCurrentUpdatedCD());
    }
    onNavigateNext();
  };

  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressedDataUrl = await compressImageFile(file, 600, 0.82);
      if (compressedDataUrl) {
        setIsDirty(true);
        setCoverUrl(compressedDataUrl);
        setActiveImageSlot('front');
      }
    } catch (err) {
      log.error('Image compression error:', err);
    }
  };

  const SUB_IMAGE_TYPE_LABELS: Record<SubImageType, string> = {
    back: '裏ジャケット',
    obi: '帯 (オビ)',
    disc: '盤面 (ディスク)',
    booklet: '歌詞カード',
    other: 'その他付属',
  };

  const handleSubImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressedDataUrl = await compressImageFile(file, 750, 0.84);
      if (compressedDataUrl) {
        setIsDirty(true);
        const newSub: CDSubImage = {
          id: `subimg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          type: pendingSubImageType,
          label: SUB_IMAGE_TYPE_LABELS[pendingSubImageType],
          imageUrl: compressedDataUrl,
        };
        setSubImages((prev) => [...prev, newSub]);
        setActiveImageSlot(newSub.id);
      }
    } catch (err) {
      log.error('Sub image compression error:', err);
    } finally {
      e.target.value = '';
    }
  };

  const handleRemoveFrontCover = () => {
    setIsDirty(true);
    setCoverUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setSaveSuccessMessage('表ジャケット写真を削除しました（「保存」または画面移動で反映されます）');
    setTimeout(() => setSaveSuccessMessage(null), 3500);
  };

  const handleRemoveSubImage = (subId: string) => {
    setIsDirty(true);
    setSubImages((prev) => prev.filter((item) => item.id !== subId));
    if (activeImageSlot === subId) {
      setActiveImageSlot('front');
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
      log.error('Upscale error:', err);
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
    setIsDirty(true);
    const halfWidth = toHankakuCode(val);
    if (!halfWidth.trim()) {
      setReleaseDate('');
      setReleaseDateError(null);
      return;
    }
    const digits = halfWidth.replace(/\D/g, '');
    if ((digits.length === 8 || digits.length === 6) && /^\d+$/.test(halfWidth)) {
      const check = validateDateInput(digits);
      if (check.valid) {
        setReleaseDate(check.normalized);
        setReleaseDateError(null);
      } else {
        setReleaseDate(halfWidth);
        setReleaseDateError(check.error || 'ありえない日付です');
      }
      return;
    }
    setReleaseDate(halfWidth);
  };

  const handleReleaseDateBlur = () => {
    const trimmed = releaseDate.trim();
    if (!trimmed) {
      setReleaseDateError(null);
      return;
    }
    const check = validateDateInput(trimmed);
    if (check.valid) {
      setReleaseDate(check.normalized);
      setReleaseDateError(null);
    } else {
      setReleaseDateError(check.error || 'ありえない日付です');
    }
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

  const sourceNames: Record<APISource, string> = SOURCE_FULL_LABELS;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl h-[92vh] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Header (Fixed) */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 border-b border-slate-800 bg-slate-800/80 flex-shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center flex-shrink-0">
              <Disc className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white leading-tight truncate">
                CD メタデータ詳細
              </h2>
            </div>
          </div>

          {/* Center/Right: Navigation Controls & Close */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Prev/Next Navigation Controls */}
            {(onNavigatePrev !== undefined || onNavigateNext !== undefined || totalCount !== undefined) && (
              <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-xl p-1 shadow-inner gap-1">
                <button
                  type="button"
                  onClick={handlePrevWithAutoSave}
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
                  onClick={handleNextWithAutoSave}
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
              onClick={handleCloseWithAutoSave}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="閉じる (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Fixed Top Section (Red Box): Cover Artwork + Metadata Summary + Navigation Tabs */}
        <div className="px-6 pt-3 pb-2 flex-shrink-0 border-b border-slate-800 bg-slate-900 space-y-2.5">
          
          {/* Hero Card */}
          <div className="flex flex-col sm:flex-row gap-4 bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
            {/* High Res Jacket Image & Multi-Image Switcher Actions */}
            <div className="flex flex-col gap-1.5 w-full sm:w-44 md:w-48 flex-shrink-0">
              {(() => {
                const activeSub =
                  activeImageSlot !== 'front'
                    ? subImages.find((s) => s.id === activeImageSlot)
                    : undefined;
                const displayImgUrl = activeSub ? activeSub.imageUrl : coverUrl;
                const displayImgLabel = activeSub
                  ? SUB_IMAGE_TYPE_LABELS[activeSub.type] || activeSub.label
                  : '表ジャケット';

                return (
                  <div
                    onClick={() => {
                      if (displayImgUrl) {
                        setIsImageLightboxOpen(true);
                      }
                    }}
                    title={displayImgUrl ? 'クリックしてジャケット写真を拡大表示' : undefined}
                    className={`w-full h-36 sm:h-40 rounded-xl bg-slate-900 overflow-hidden border border-slate-700 shadow-md relative group mx-auto ${
                      displayImgUrl ? 'cursor-zoom-in hover:border-indigo-400 transition-colors' : ''
                    }`}
                  >
                    {displayImgUrl ? (
                      <>
                        <img
                          src={displayImgUrl}
                          alt={`${title} - ${displayImgLabel}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (!target.dataset.triedProxy && displayImgUrl && !displayImgUrl.startsWith('data:')) {
                              target.dataset.triedProxy = 'true';
                              target.src = `/api/image-proxy?url=${encodeURIComponent(displayImgUrl)}`;
                            }
                          }}
                        />
                        <div className="absolute top-1.5 right-1.5 bg-slate-950/80 text-white p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-slate-700 shadow">
                          <ZoomIn className="w-3.5 h-3.5 text-indigo-300" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-3 text-center">
                        <Disc className="w-10 h-10 mb-1 opacity-40" />
                        <span className="text-[11px]">No Cover Image</span>
                      </div>
                    )}
                    <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 pointer-events-none">
                      <span className="text-[9px] font-bold bg-slate-950/90 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                        {displayImgLabel}
                      </span>
                      {activeSub ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSubImage(activeSub.id);
                          }}
                          className="pointer-events-auto text-[9px] bg-rose-950/90 hover:bg-rose-800 text-rose-200 border border-rose-500/50 px-1.5 py-0.5 rounded cursor-pointer font-bold flex items-center gap-0.5 whitespace-nowrap flex-shrink-0"
                          title="このサブ画像を削除"
                        >
                          <Trash2 className="w-2.5 h-2.5 flex-shrink-0" />
                          <span>削除</span>
                        </button>
                      ) : coverUrl ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFrontCover();
                          }}
                          className="pointer-events-auto text-[9px] bg-rose-950/90 hover:bg-rose-800 text-rose-200 border border-rose-500/50 px-1.5 py-0.5 rounded cursor-pointer font-bold flex items-center gap-0.5 whitespace-nowrap flex-shrink-0"
                          title="表ジャケット写真を削除"
                        >
                          <Trash2 className="w-2.5 h-2.5 flex-shrink-0" />
                          <span>削除</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })()}

              {/* Thumbnail Strip for Front + Sub-Images (Back / Obi / Disc / Booklet) */}
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                <button
                  type="button"
                  onClick={() => setActiveImageSlot('front')}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer flex-shrink-0 ${
                    activeImageSlot === 'front'
                      ? 'bg-indigo-600 text-white border-indigo-400'
                      : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  表ジャケ
                </button>
                {subImages.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setActiveImageSlot(sub.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer flex-shrink-0 ${
                      activeImageSlot === sub.id
                        ? 'bg-amber-600 text-white border-amber-400'
                        : 'bg-slate-900 text-amber-300/80 border-amber-500/30 hover:text-amber-200'
                    }`}
                    title={sub.label}
                  >
                    {sub.type === 'back'
                      ? '裏ジャケ'
                      : sub.type === 'obi'
                      ? '帯'
                      : sub.type === 'disc'
                      ? '盤面'
                      : sub.type === 'booklet'
                      ? '歌詞冊子'
                      : '他'}
                  </button>
                ))}
              </div>

              {/* Action under image */}
              <div className="flex flex-col gap-1 w-full">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-slate-400 hover:text-indigo-300 py-0.5 text-center flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  <span>表ジャケを変更・登録</span>
                </button>

                {/* Quick Add Sub-Image (Back / Obi / Disc) */}
                <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-700/80 rounded-lg p-1">
                  <select
                    value={pendingSubImageType}
                    onChange={(e) => setPendingSubImageType(e.target.value as SubImageType)}
                    className="bg-slate-950 text-[10px] text-amber-300 border border-slate-700 rounded px-1 py-0.5 flex-1 focus:outline-none cursor-pointer"
                  >
                    <option value="back">裏ジャケ</option>
                    <option value="obi">帯 (オビ)</option>
                    <option value="disc">盤面</option>
                    <option value="booklet">歌詞冊子</option>
                    <option value="other">その他</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => subImageFileInputRef.current?.click()}
                    className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold flex items-center gap-0.5 cursor-pointer whitespace-nowrap"
                    title="裏面ジャケット・帯・盤面などのサブ画像を追加登録"
                  >
                    <Images className="w-2.5 h-2.5" />
                    <span>＋追加</span>
                  </button>
                </div>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageFileUpload}
                accept="image/*"
                className="hidden"
              />
              <input
                type="file"
                ref={subImageFileInputRef}
                onChange={handleSubImageFileUpload}
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

                  {/* 5-Star Rating Selector */}
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 px-2.5 py-0.5 rounded-full shadow-xs" title="お気に入り度 (1〜5★)">
                    <span className="text-[10px] text-slate-400 font-bold mr-0.5">評価:</span>
                    {[1, 2, 3, 4, 5].map((starVal) => {
                      const isFilled = rating >= starVal;
                      return (
                        <button
                          key={starVal}
                          type="button"
                          onClick={() => {
                            setRating((prev) => (prev === starVal ? 0 : starVal));
                            setIsDirty(true);
                          }}
                          className="hover:scale-125 transition-transform p-0.5 cursor-pointer"
                          title={`${starVal}つ星 (クリックで設定/解除)`}
                        >
                          <Star
                            className={`w-3.5 h-3.5 transition-colors ${
                              isFilled
                                ? 'text-amber-400 fill-amber-400'
                                : 'text-slate-600 hover:text-amber-300'
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>

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

                  {coverUrl && !coverUrl.startsWith('data:image/') && (
                    <button
                      type="button"
                      onClick={handleConvertLinkToBase64}
                      disabled={isConvertingBase64}
                      className="text-[10px] text-emerald-300 hover:text-emerald-200 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 rounded-full px-2 py-0.5 flex items-center gap-1 transition-all cursor-pointer font-bold shadow-sm"
                      title="外部リンクのジャケット画像を取得してBASE64形式に変換し、オフラインでも消えないように保存します"
                    >
                      {isConvertingBase64 ? (
                        <Loader2 className="w-2.5 h-2.5 animate-spin text-emerald-300" />
                      ) : (
                        <Link2 className="w-2.5 h-2.5 text-emerald-300" />
                      )}
                      <span>{isConvertingBase64 ? 'BASE64変換中...' : '🔗 リンクをBASE64化'}</span>
                    </button>
                  )}

                  {coverUrl && coverUrl.startsWith('data:image/') && (
                    <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 rounded-full px-2 py-0.5 flex items-center gap-1 shadow-sm">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                      <span>BASE64変換済</span>
                    </span>
                  )}

                  {coverUrl && (
                    <button
                      type="button"
                      onClick={handleUpscaleJacketInModal}
                      disabled={isUpscaling}
                      className="text-[10px] text-purple-300 hover:text-purple-200 bg-purple-950/80 hover:bg-purple-900 border border-purple-500/40 rounded-full px-2 py-0.5 flex items-center gap-1 transition-all cursor-pointer font-bold shadow-sm"
                      title="Gemini AIで低画質ジャケット画像を1K高画質化・ノイズ除去"
                    >
                      {isUpscaling ? (
                        <Loader2 className="w-2.5 h-2.5 animate-spin text-purple-300" />
                      ) : (
                        <Sparkles className="w-2.5 h-2.5 text-purple-300" />
                      )}
                      <span>{isUpscaling ? 'AI高画質化中...' : '✨ AI高画質化'}</span>
                    </button>
                  )}
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white truncate" title={title}>
                  {title}
                </h3>
                <p className="text-xs sm:text-sm font-semibold text-slate-300 truncate" title={artist}>
                  {artist}
                </p>

                {cd.aiVerificationSummary && (
                  <div className="bg-purple-950/30 border border-purple-800/40 rounded-lg p-2 text-[11px] text-purple-200 mt-1.5 flex items-start gap-1.5 leading-snug">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <span>{cd.aiVerificationSummary}</span>
                  </div>
                )}

                {aiTagAnalysis?.reasoning && (
                  <div className="bg-indigo-950/40 border border-indigo-500/40 rounded-lg p-2 text-[11px] text-indigo-200 mt-1.5 flex items-start gap-1.5 leading-snug">
                    <Tag className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-indigo-300 mr-1">AIタグ分類根拠・音楽的特徴:</span>
                      <span>{aiTagAnalysis.reasoning}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-300">
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

                {/* Primary Source Badge positioned at the bottom row directly to the right of the jacket photo addition controls */}
                <div className="flex items-center gap-2 pt-0.5 text-xs text-slate-400">
                  <span>主要取得ソース:</span>
                  <span className="font-semibold text-indigo-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700 text-[11px]">
                    {sourceNames[cd.source] || cd.source}
                  </span>
                </div>
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
                  <input
                    type="text"
                    value={titleReading}
                    onChange={(e) => setTitleReading(e.target.value)}
                    onBlur={() => setTitleReading(normalizeReading(titleReading))}
                    placeholder="タイトルの読み（ひらがな）例: さかみちのしょうじょ"
                    aria-label="タイトルの読み（ひらがな）"
                    className="mt-1.5 w-full bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
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
                  <input
                    type="text"
                    value={artistReading}
                    onChange={(e) => setArtistReading(e.target.value)}
                    onBlur={() => setArtistReading(normalizeReading(artistReading))}
                    placeholder="歌手名の読み（ひらがな）例: さわだせいこ"
                    aria-label="歌手名の読み（ひらがな）"
                    className="mt-1.5 w-full bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
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
                    className={`w-full bg-slate-900 border rounded-lg p-2.5 text-xs font-mono focus:outline-none ${
                      releaseDateError
                        ? 'border-rose-500 text-rose-200 bg-rose-950/30 focus:border-rose-400'
                        : 'border-slate-700 text-white focus:border-indigo-500'
                    }`}
                    style={{ imeMode: 'disabled' }}
                    title="8桁の数字（例: 19891221）で入力すると YYYY-MM-DD に自動変換されます（うるう年・月別の最大日数チェック付）"
                  />
                  {releaseDateError && (
                    <p className="mt-1 text-[11px] font-bold text-rose-400">{releaseDateError}</p>
                  )}
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
                        setIsDirty(true);
                        const raw = toHankakuCode(e.target.value);
                        if (!raw.trim()) {
                          setVinylRecordReleaseDate('');
                          setVinylDateError(null);
                          return;
                        }
                        if ((raw.length === 8 || raw.length === 6) && /^\d+$/.test(raw)) {
                          const check = validateDateInput(raw);
                          if (check.valid) {
                            setVinylRecordReleaseDate(check.normalized);
                            setVinylDateError(null);
                          } else {
                            setVinylRecordReleaseDate(raw);
                            setVinylDateError(check.error || 'ありえない日付です');
                          }
                          return;
                        }
                        setVinylRecordReleaseDate(raw);
                      }}
                      onBlur={() => {
                        const trimmed = vinylRecordReleaseDate.trim();
                        if (!trimmed) {
                          setVinylDateError(null);
                          return;
                        }
                        const check = validateDateInput(trimmed);
                        if (check.valid) {
                          setVinylRecordReleaseDate(check.normalized);
                          setVinylDateError(null);
                        } else {
                          setVinylDateError(check.error || 'ありえない日付です');
                        }
                      }}
                      placeholder="例: 1982-05-21 (8桁数字自動変換)"
                      className={`w-full bg-slate-900 border rounded-lg p-2 text-xs font-mono focus:outline-none ${
                        vinylDateError
                          ? 'border-rose-500 text-rose-200 bg-rose-950/30 focus:border-rose-400'
                          : 'border-amber-500/40 text-amber-200 focus:border-amber-400'
                      }`}
                    />
                    {vinylDateError && (
                      <p className="mt-1 text-[11px] font-bold text-rose-400">{vinylDateError}</p>
                    )}
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
                    onChange={(e) => {
                      setIsDirty(true);
                      setCoverUrl(e.target.value);
                    }}
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
                      onClick={handleRemoveFrontCover}
                      className="px-3 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 hover:text-rose-100 border border-rose-500/40 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                      title="表ジャケット写真を削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>表ジャケ削除</span>
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
                  <div className="flex items-center gap-2 flex-wrap">
                    {onOpenTagManager && (
                      <button
                        type="button"
                        onClick={onOpenTagManager}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-200 hover:text-white border border-slate-700 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                        title="新しいタグ名称の追加や、既存タグ名称の一括変更（リネーム）・削除を行います"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                        <span>タグ名称管理</span>
                      </button>
                    )}
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
                </div>

                {/* Comma-separated Tag Input + Quick Add New Tag Name */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setTagsInput(nextVal);
                      setIsDirty(true);
                      const parsedTags = normalizeTagList(
                        nextVal.split(/[,、]/).map((t) => t.trim()).filter(Boolean),
                        { preserveCustomName: true }
                      );
                      const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
                      if (parsedTags.length === 0) {
                        setGenre('');
                        setAiTagAnalysis((prev) =>
                          prev ? { ...prev, genre: '', subGenre: undefined } : prev
                        );
                      } else {
                        const nextPrimary =
                          parsedTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || parsedTags[0];
                        if (!genre || !parsedTags.includes(normalizeSingleTag(genre, { preserveCustomName: true }))) {
                          setGenre(nextPrimary);
                        }
                        setAiTagAnalysis((prev) => {
                          if (!prev) return prev;
                          const currentG = prev.genre ? normalizeSingleTag(prev.genre, { preserveCustomName: true }) : '';
                          const updatedG = currentG && parsedTags.includes(currentG) ? currentG : nextPrimary;
                          const updatedSub =
                            prev.subGenre && parsedTags.includes(normalizeSingleTag(prev.subGenre, { preserveCustomName: true }))
                              ? prev.subGenre
                              : undefined;
                          return {
                            ...prev,
                            genre: updatedG,
                            subGenre: updatedSub,
                          };
                        });
                      }
                    }}
                    placeholder="J-Pop, 80年代, 初回盤 (直接入力または下のタグ候補・追加欄から編集)"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />

                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newSingleTagInput}
                      onChange={(e) => setNewSingleTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const cleaned = normalizeSingleTag(newSingleTagInput, { preserveCustomName: true });
                          if (!cleaned) return;
                          const currentTags = normalizeTagList(
                            tagsInput.split(/[,、]/).map((t) => t.trim()).filter(Boolean),
                            { preserveCustomName: true }
                          );
                          const nextTags = currentTags.includes(cleaned)
                            ? currentTags
                            : [...currentTags, cleaned];
                          const nextStr = nextTags.join(', ');
                          setTagsInput(nextStr);
                          setNewSingleTagInput('');
                          setIsDirty(true);
                          if (!tagPresets.includes(cleaned)) {
                            const nextPresets = [cleaned, ...tagPresets];
                            setTagPresets(nextPresets);
                            saveTagPresetsDB(nextPresets);
                          }
                          const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
                          const nextPrimary =
                            nextTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || nextTags[0] || '';
                          if (!genre) setGenre(nextPrimary);
                          setAiTagAnalysis((prev) =>
                            prev ? { ...prev, genre: prev.genre || nextPrimary } : prev
                          );
                        }
                      }}
                      placeholder="新しいタグ名を入力..."
                      className="w-40 sm:w-44 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const cleaned = normalizeSingleTag(newSingleTagInput, { preserveCustomName: true });
                        if (!cleaned) return;
                        const currentTags = normalizeTagList(
                          tagsInput.split(/[,、]/).map((t) => t.trim()).filter(Boolean),
                          { preserveCustomName: true }
                        );
                        const nextTags = currentTags.includes(cleaned)
                          ? currentTags
                          : [...currentTags, cleaned];
                        const nextStr = nextTags.join(', ');
                        setTagsInput(nextStr);
                        setNewSingleTagInput('');
                        setIsDirty(true);
                        if (!tagPresets.includes(cleaned)) {
                          const nextPresets = [cleaned, ...tagPresets];
                          setTagPresets(nextPresets);
                          saveTagPresetsDB(nextPresets);
                        }
                        const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
                        const nextPrimary =
                          nextTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || nextTags[0] || '';
                        if (!genre) setGenre(nextPrimary);
                        setAiTagAnalysis((prev) =>
                          prev ? { ...prev, genre: prev.genre || nextPrimary } : prev
                        );
                      }}
                      disabled={!newSingleTagInput.trim()}
                      className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                      title="新しいタグ名称をこのCDとタグ候補リストに追加"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>タグ追加</span>
                    </button>
                  </div>
                </div>

                {/* Interactive Tag Pills (Click pencil or tag name to rename, × to delete) */}
                {tagsInput.trim() && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {tagsInput
                      .split(/[,、]/)
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .map((tagItem, idx) => {
                        const isEditingPill = editingPillIndex === idx;
                        if (isEditingPill) {
                          return (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 bg-slate-900 border border-indigo-400 px-2 py-0.5 rounded-full"
                            >
                              <span className="text-[11px] text-indigo-400 font-bold">#</span>
                              <input
                                type="text"
                                value={editingPillValue}
                                onChange={(e) => setEditingPillValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const renamed = normalizeSingleTag(editingPillValue, { preserveCustomName: true });
                                    const list = tagsInput
                                      .split(/[,、]/)
                                      .map((t) => t.trim())
                                      .filter(Boolean);
                                    if (renamed) {
                                      list[idx] = renamed;
                                      if (!tagPresets.includes(renamed)) {
                                        const nextPresets = [renamed, ...tagPresets];
                                        setTagPresets(nextPresets);
                                        saveTagPresetsDB(nextPresets);
                                      }
                                    } else {
                                      list.splice(idx, 1);
                                    }
                                    const deduped = normalizeTagList(list, { preserveCustomName: true });
                                    setTagsInput(deduped.join(', '));
                                    setIsDirty(true);
                                    const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
                                    const nextPrimary =
                                      deduped.find((t) => !decadeRegex.test(t) && t !== '邦楽') || deduped[0] || '';
                                    setGenre(nextPrimary);
                                    setAiTagAnalysis((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            genre: prev.genre === tagItem && renamed ? renamed : nextPrimary,
                                            subGenre:
                                              prev.subGenre === tagItem && renamed
                                                ? renamed
                                                : prev.subGenre && deduped.includes(prev.subGenre)
                                                ? prev.subGenre
                                                : undefined,
                                            tagEvidence: (prev.tagEvidence || []).map((ev) =>
                                              ev.tag === tagItem && renamed ? { ...ev, tag: renamed } : ev
                                            ),
                                          }
                                        : prev
                                    );
                                    setEditingPillIndex(null);
                                    setEditingPillValue('');
                                  } else if (e.key === 'Escape') {
                                    setEditingPillIndex(null);
                                    setEditingPillValue('');
                                  }
                                }}
                                autoFocus
                                className="w-24 bg-transparent text-[11px] text-white focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const renamed = normalizeSingleTag(editingPillValue, { preserveCustomName: true });
                                  const list = tagsInput
                                    .split(/[,、]/)
                                    .map((t) => t.trim())
                                    .filter(Boolean);
                                  if (renamed) {
                                    list[idx] = renamed;
                                    if (!tagPresets.includes(renamed)) {
                                      const nextPresets = [renamed, ...tagPresets];
                                      setTagPresets(nextPresets);
                                      saveTagPresetsDB(nextPresets);
                                    }
                                  } else {
                                    list.splice(idx, 1);
                                  }
                                  const deduped = normalizeTagList(list, { preserveCustomName: true });
                                  setTagsInput(deduped.join(', '));
                                  setIsDirty(true);
                                  const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
                                  const nextPrimary =
                                    deduped.find((t) => !decadeRegex.test(t) && t !== '邦楽') || deduped[0] || '';
                                  setGenre(nextPrimary);
                                  setAiTagAnalysis((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          genre: prev.genre === tagItem && renamed ? renamed : nextPrimary,
                                          subGenre:
                                            prev.subGenre === tagItem && renamed
                                              ? renamed
                                              : prev.subGenre && deduped.includes(prev.subGenre)
                                              ? prev.subGenre
                                              : undefined,
                                          tagEvidence: (prev.tagEvidence || []).map((ev) =>
                                            ev.tag === tagItem && renamed ? { ...ev, tag: renamed } : ev
                                          ),
                                        }
                                      : prev
                                  );
                                  setEditingPillIndex(null);
                                  setEditingPillValue('');
                                }}
                                className="text-emerald-400 hover:text-emerald-300 text-[11px] font-bold cursor-pointer"
                                title="変更を確定"
                              >
                                ✓
                              </button>
                            </span>
                          );
                        }

                        return (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-800 text-indigo-200 border border-slate-700 px-2.5 py-0.5 rounded-full group"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPillIndex(idx);
                                setEditingPillValue(tagItem);
                              }}
                              className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                              title="クリックしてこのタグの名称を変更"
                            >
                              <span>#{tagItem}</span>
                              <Edit3 className="w-2.5 h-2.5 text-slate-400 group-hover:text-indigo-300" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const nextTags = tagsInput
                                  .split(/[,、]/)
                                  .map((t) => t.trim())
                                  .filter((t, i) => t && i !== idx);
                                const nextStr = nextTags.join(', ');
                                setTagsInput(nextStr);
                                setIsDirty(true);
                                const normNext = normalizeTagList(nextTags, { preserveCustomName: true });
                                const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
                                const nextPrimary =
                                  normNext.find((t) => !decadeRegex.test(t) && t !== '邦楽') || normNext[0] || '';
                                setGenre(nextPrimary);
                                setAiTagAnalysis((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        genre: nextPrimary,
                                        subGenre:
                                          prev.subGenre && normNext.includes(normalizeSingleTag(prev.subGenre, { preserveCustomName: true }))
                                            ? prev.subGenre
                                            : undefined,
                                        tagEvidence: (prev.tagEvidence || []).filter((ev) =>
                                          normNext.includes(normalizeSingleTag(ev.tag, { preserveCustomName: true }))
                                        ),
                                      }
                                    : prev
                                );
                              }}
                              className="text-slate-400 hover:text-rose-400 ml-0.5 font-bold cursor-pointer"
                              title="このタグを削除"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                  </div>
                )}

                {/* Quick Tag Preset Selector */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>クイックタグ候補（クリックで追加・解除 / タグ名クリックで名称変更可能）:</span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap max-h-20 overflow-y-auto">
                    {tagPresets.map((preset) => {
                      const currentList = tagsInput
                        .split(/[,、]/)
                        .map((t) => t.trim())
                        .filter(Boolean);
                      const isActive = currentList.includes(preset);
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            const nextList = isActive
                              ? currentList.filter((t) => t !== preset)
                              : [...currentList, preset];
                            const deduped = normalizeTagList(nextList, { preserveCustomName: true });
                            setTagsInput(deduped.join(', '));
                            setIsDirty(true);
                            const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
                            const nextPrimary =
                              deduped.find((t) => !decadeRegex.test(t) && t !== '邦楽') || deduped[0] || '';
                            setGenre(nextPrimary);
                            setAiTagAnalysis((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    genre: nextPrimary,
                                    subGenre:
                                      prev.subGenre && deduped.includes(prev.subGenre)
                                        ? prev.subGenre
                                        : undefined,
                                  }
                                : prev
                            );
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                            isActive
                              ? 'bg-indigo-600 text-white border-indigo-400 font-bold'
                              : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-indigo-500/50 hover:text-white'
                          }`}
                        >
                          {isActive ? `✓ #${preset}` : `＋ #${preset}`}
                        </button>
                      );
                    })}
                  </div>
                </div>

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
                      <div className="flex items-center gap-2">
                        {aiTagAnalysis.analyzedAt && (
                          <span className="text-[10px] font-mono text-slate-400">
                            分析日時: {aiTagAnalysis.analyzedAt.slice(0, 16).replace('T', ' ')}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setAiTagAnalysis(undefined);
                            setIsDirty(true);
                          }}
                          className="text-[10px] text-slate-400 hover:text-rose-400 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-rose-500/40 transition-colors cursor-pointer"
                          title="AI自動分類根拠データをクリア"
                        >
                          根拠をクリア
                        </button>
                      </div>
                    </div>

                    {/* Genre / Mood / Era Summary Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="bg-blue-950/50 border border-blue-500/30 rounded-lg px-2.5 py-1.5">
                        <label className="block text-[10px] font-bold text-blue-300 mb-0.5">
                          主要ジャンル
                        </label>
                        <input
                          type="text"
                          value={aiTagAnalysis.genre || genre || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setIsDirty(true);
                            setGenre(val);
                            setAiTagAnalysis((prev) => (prev ? { ...prev, genre: val } : prev));
                          }}
                          placeholder="主要ジャンル..."
                          className="w-full bg-slate-900/90 border border-blue-500/30 focus:border-blue-400 rounded px-2 py-1 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="bg-purple-950/50 border border-purple-500/30 rounded-lg px-2.5 py-1.5">
                        <label className="block text-[10px] font-bold text-purple-300 mb-0.5">
                          雰囲気・ムード
                        </label>
                        <input
                          type="text"
                          value={aiTagAnalysis.mood || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setIsDirty(true);
                            setAiTagAnalysis((prev) => (prev ? { ...prev, mood: val } : prev));
                          }}
                          placeholder="雰囲気・ムード..."
                          className="w-full bg-slate-900/90 border border-purple-500/30 focus:border-purple-400 rounded px-2 py-1 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="bg-amber-950/50 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                        <label className="block text-[10px] font-bold text-amber-300 mb-0.5">
                          時代区分
                        </label>
                        <input
                          type="text"
                          value={aiTagAnalysis.era || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setIsDirty(true);
                            setAiTagAnalysis((prev) => (prev ? { ...prev, era: val } : prev));
                          }}
                          placeholder="1980年代など..."
                          className="w-full bg-slate-900/90 border border-amber-500/30 focus:border-amber-400 rounded px-2 py-1 text-xs text-white focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Musical Characteristics Summary (Reasoning) - Directly Editable */}
                    <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-lg p-2.5 text-xs text-indigo-100 leading-relaxed space-y-1">
                      <span className="font-bold text-indigo-300 block text-[11px]">
                        💡 ジャンル選定理由・音楽的特徴の要約 (直接編集可能):
                      </span>
                      <textarea
                        value={aiTagAnalysis.reasoning || ''}
                        onChange={(e) => {
                          setIsDirty(true);
                          setAiTagAnalysis((prev) =>
                            prev ? { ...prev, reasoning: e.target.value } : prev
                          );
                        }}
                        rows={2}
                        placeholder="ジャンル選定理由・音楽的特徴を入力..."
                        className="w-full bg-slate-900/80 border border-indigo-500/30 focus:border-indigo-400 rounded p-2 text-xs text-indigo-100 focus:outline-none"
                      />
                    </div>

                    {/* Rule-based False Positive Filter Adjustments */}
                    {aiTagAnalysis.ruleAdjustments && aiTagAnalysis.ruleAdjustments.length > 0 && (
                      <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-lg p-2.5 text-xs text-emerald-100 space-y-1">
                        <div className="font-bold text-emerald-300 flex items-center gap-1 text-[11px]">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span>ルールベース誤判定防止フィルター検証済 ({aiTagAnalysis.ruleAdjustments.length}件):</span>
                        </div>
                        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-emerald-100/90">
                          {aiTagAnalysis.ruleAdjustments.map((adj, adjIdx) => (
                            <li key={adjIdx}>{adj}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Per-Tag Evidence Breakdown (Directly Editable) */}
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
                            個別タグごとの判定根拠・参照メタデータ ({aiTagAnalysis.tagEvidence.length}件 / 編集・削除可能)
                          </span>
                        </button>

                        {showTagEvidenceDetails && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {aiTagAnalysis.tagEvidence.map((ev, idx) => (
                              <div
                                key={idx}
                                className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 text-[11px] space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-extrabold text-white bg-purple-950/90 border border-purple-500/40 px-2 py-0.5 rounded text-[10px]">
                                    #{ev.tag}
                                  </span>
                                  <div className="flex items-center gap-1 flex-wrap justify-end">
                                    {ev.sourceFields &&
                                      ev.sourceFields.map((sf, sIdx) => (
                                        <span
                                          key={sIdx}
                                          className="text-[9px] font-mono bg-slate-800 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded"
                                        >
                                          参照: {sf}
                                        </span>
                                      ))}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsDirty(true);
                                        setAiTagAnalysis((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                tagEvidence: (prev.tagEvidence || []).filter((_, i) => i !== idx),
                                              }
                                            : prev
                                        );
                                      }}
                                      className="text-slate-500 hover:text-rose-400 text-[10px] px-1 cursor-pointer"
                                      title="この根拠を削除"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                                <input
                                  type="text"
                                  value={ev.evidence}
                                  onChange={(e) => {
                                    const newEvText = e.target.value;
                                    setIsDirty(true);
                                    setAiTagAnalysis((prev) => {
                                      if (!prev || !prev.tagEvidence) return prev;
                                      const nextEv = [...prev.tagEvidence];
                                      nextEv[idx] = { ...nextEv[idx], evidence: newEvText };
                                      return { ...prev, tagEvidence: nextEv };
                                    });
                                  }}
                                  className="w-full bg-slate-950/80 border border-slate-800 focus:border-purple-500/60 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none"
                                />
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
            <TrackListTab
              tracks={tracks}
              bulkTrackText={bulkTrackText}
              setBulkTrackText={setBulkTrackText}
              showBulkPasteInput={showBulkPasteInput}
              setShowBulkPasteInput={setShowBulkPasteInput}
              trackDurationErrors={trackDurationErrors}
              setTrackDurationErrors={setTrackDurationErrors}
              setIsDirty={setIsDirty}
              parseBulkTrackLines={parseBulkTrackLines}
              onAddTrack={handleAddSingleTrack}
              onUpdateTitle={handleUpdateTrackTitle}
              onUpdateDuration={handleUpdateTrackDuration}
              onRemoveTrack={handleRemoveTrack}
              onClearAll={handleClearAllTracks}
              onParseBulk={handleParseBulkTracks}
              onExportText={handleExportTracksToText}
              onConvertTracksToHalfWidth={handleConvertTracksToHalfWidth}
              onConvertBulkTextToHalfWidth={handleConvertBulkTextToHalfWidth}
              onNormalizeDurations={handleNormalizeTrackDurations}
            />
          )}

          {/* Tab 3: Raw API Sources Comparison */}
          {activeTab === 'sourceComparison' && (
            <SourceComparisonTab cd={cd} sourceNames={sourceNames} />
          )}

        </div>

        {/* Modal Footer Actions (Fixed) */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-800 bg-slate-800/70 flex-shrink-0 relative">
          <div className="flex items-center gap-2 w-full sm:w-auto">
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

          <div className="flex items-center justify-end gap-3 w-full sm:w-auto relative">
            {validationErrorMessage && (
              <div className="absolute bottom-full right-0 mb-3 z-50 max-w-xs sm:max-w-md w-max pointer-events-none animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200">
                <div className="relative flex items-center gap-2 text-xs text-rose-100 font-bold bg-rose-950/95 backdrop-blur-md border border-rose-400/70 px-4 py-2.5 rounded-2xl shadow-2xl shadow-black/70">
                  <Info className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span className="leading-snug">{validationErrorMessage}</span>
                  <div className="absolute -bottom-1.5 right-8 w-3 h-3 bg-rose-950 border-r border-b border-rose-400/70 rotate-45" />
                </div>
              </div>
            )}

            {saveSuccessMessage && !validationErrorMessage && (
              <div className="absolute bottom-full right-0 mb-3 z-50 max-w-xs sm:max-w-md w-max pointer-events-none animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200">
                <div className="relative flex items-center gap-2 text-xs text-emerald-100 font-bold bg-emerald-950/95 backdrop-blur-md border border-emerald-400/60 px-4 py-2.5 rounded-2xl shadow-2xl shadow-black/70">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span className="leading-snug">{saveSuccessMessage}</span>
                  {/* Balloon Speech Pointer Arrow */}
                  <div className="absolute -bottom-1.5 right-8 w-3 h-3 bg-emerald-950 border-r border-b border-emerald-400/60 rotate-45" />
                </div>
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
          onClick={handlePrevWithAutoSave}
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
          onClick={handleNextWithAutoSave}
          className="hidden md:flex fixed right-3 lg:right-8 top-1/2 -translate-y-1/2 z-50 w-11 h-11 rounded-full bg-slate-800/90 hover:bg-indigo-600 border border-slate-700 hover:border-indigo-400 text-slate-200 hover:text-white items-center justify-center shadow-2xl transition-all cursor-pointer group"
          title="次のCDへ移動 (キーボード: →)"
        >
          <ChevronRight className="w-6 h-6 group-hover:translate-x-0.5 transition-transform" />
        </button>
      )}

      {/* Enlarged Jacket Photo Lightbox Overlay */}
      {isImageLightboxOpen && (() => {
        const activeSub =
          activeImageSlot !== 'front'
            ? subImages.find((s) => s.id === activeImageSlot)
            : undefined;
        const lightboxImgUrl = activeSub ? activeSub.imageUrl : coverUrl;
        const lightboxImgLabel = activeSub
          ? SUB_IMAGE_TYPE_LABELS[activeSub.type] || activeSub.label
          : '表ジャケット';

        if (!lightboxImgUrl) return null;

        return (
          <div
            onClick={() => setIsImageLightboxOpen(false)}
            className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-3xl w-full flex flex-col items-center gap-3"
            >
              {/* Top Info & Close Bar */}
              <div className="w-full flex items-center justify-between gap-3 bg-slate-900/90 border border-slate-700/80 px-4 py-2.5 rounded-xl shadow-lg">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2.5 py-0.5 rounded-md whitespace-nowrap">
                    {lightboxImgLabel}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold text-white truncate">
                      {title}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {artist} {catalogNumber ? `(${catalogNumber})` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsImageLightboxOpen(false)}
                  className="p-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors cursor-pointer flex-shrink-0"
                  title="拡大表示を閉じる (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Large Jacket Image */}
              <div
                onClick={() => setIsImageLightboxOpen(false)}
                className="relative bg-slate-950/80 border border-slate-800 rounded-2xl p-2 sm:p-3 shadow-2xl flex items-center justify-center max-h-[72vh] w-full overflow-hidden cursor-zoom-out"
                title="クリックして閉じる"
              >
                <img
                  src={lightboxImgUrl}
                  alt={`${title} - ${lightboxImgLabel}`}
                  className="max-h-[68vh] max-w-full w-auto h-auto object-contain rounded-lg shadow-xl select-none"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.dataset.triedProxy && lightboxImgUrl && !lightboxImgUrl.startsWith('data:')) {
                      target.dataset.triedProxy = 'true';
                      target.src = `/api/image-proxy?url=${encodeURIComponent(lightboxImgUrl)}`;
                    }
                  }}
                />
              </div>

              {/* Switcher Tabs inside Lightbox if multiple images exist */}
              {(coverUrl || subImages.length > 0) && (
                <div className="flex items-center justify-center gap-2 flex-wrap bg-slate-900/90 border border-slate-700/80 px-3.5 py-2 rounded-xl shadow-lg">
                  {coverUrl && (
                    <button
                      type="button"
                      onClick={() => setActiveImageSlot('front')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        activeImageSlot === 'front'
                          ? 'bg-indigo-600 text-white border-indigo-400 shadow'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                      }`}
                    >
                      表ジャケット
                    </button>
                  )}
                  {subImages.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setActiveImageSlot(sub.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        activeImageSlot === sub.id
                          ? 'bg-amber-600 text-white border-amber-400 shadow'
                          : 'bg-slate-800 text-amber-300/90 border-amber-500/30 hover:text-amber-200'
                      }`}
                    >
                      {SUB_IMAGE_TYPE_LABELS[sub.type] || sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
