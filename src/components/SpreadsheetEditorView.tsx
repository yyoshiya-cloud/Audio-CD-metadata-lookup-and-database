import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CDMetadata, TrackInfo } from '../types/cd';
import { toHankakuCode, formatToYYYYMMDD, formatToHankakuDuration } from '../utils/formatUtils';
import { convertImageUrlToBase64 } from '../utils/imageEnhancer';
import { matchesCDSearchQuery } from '../utils/japaneseSearchNormalizer';
import {
  Save,
  RotateCcw,
  Plus,
  Trash2,
  ClipboardPaste,
  Search,
  CheckCircle2,
  AlertCircle,
  Music,
  Disc,
  ChevronDown,
  ChevronUp,
  X,
  FileSpreadsheet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  ImageOff,
  AlertTriangle,
  ShieldAlert,
  Link2,
} from 'lucide-react';

interface SpreadsheetEditorViewProps {
  cds: CDMetadata[];
  onBatchUpdateCDs: (
    updatedCDs: CDMetadata[],
    onProgress?: (completed: number, total: number) => void
  ) => Promise<void>;
  onBatchDeleteCDs?: (ids: string[]) => void;
  onClose?: () => void;
  onSelectCD?: (cd: CDMetadata, currentList?: CDMetadata[]) => void;
}

type SortableField = keyof CDMetadata | 'trackCount' | 'tagsStr';

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  title: 280,
  artist: 220,
  label: 160,
  releaseDate: 130,
  vinylRecordReleaseDate: 145,
  barcode: 150,
  format: 120,
  genre: 130,
  tags: 180,
  notes: 200,
  trackCount: 120,
};

export const SpreadsheetEditorView: React.FC<SpreadsheetEditorViewProps> = ({
  cds,
  onBatchUpdateCDs,
  onBatchDeleteCDs,
  onClose,
  onSelectCD,
}) => {
  // Working copy of data for spreadsheet editing
  const [gridRows, setGridRows] = useState<CDMetadata[]>(() => {
    return cds.map((cd) => ({
      ...cd,
      tags: cd.tags ? [...cd.tags] : [],
      tracks: cd.tracks ? cd.tracks.map((t) => ({ ...t })) : [],
      subImages: cd.subImages ? cd.subImages.map((s) => ({ ...s })) : undefined,
    }));
  });

  // Track explicitly edited row IDs by user interaction
  const [editedRowIds, setEditedRowIds] = useState<Set<string>>(new Set());

  // Sync gridRows when external cds prop updates, preserving uncommitted edited rows
  useEffect(() => {
    setGridRows((prevGrid) => {
      const prevMap = new Map(prevGrid.map((r) => [r.id, r]));
      return cds.map((cd) => {
        if (editedRowIds.has(cd.id)) {
          return prevMap.get(cd.id) || cd;
        }
        return {
          ...cd,
          tags: cd.tags ? [...cd.tags] : [],
          tracks: cd.tracks ? cd.tracks.map((t) => ({ ...t })) : [],
          subImages: cd.subImages ? cd.subImages.map((s) => ({ ...s })) : undefined,
        };
      });
    });
  }, [cds]);

  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [expandedTracksRowId, setExpandedTracksRowId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ current: number; total: number } | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pasteRawText, setPasteRawText] = useState('');

  // Column Resizing State
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_COLUMN_WIDTHS);

  // Sorting State
  const [sortField, setSortField] = useState<SortableField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Delete confirmation state
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  // Batch LP/EP Vinyl Release Date API Lookup state
  const [isLookingUpVinyl, setIsLookingUpVinyl] = useState(false);
  const [vinylLookupProgress, setVinylLookupProgress] = useState<{ current: number; total: number } | null>(null);

  const handleBatchLookupVinylInGrid = async () => {
    const targetRows =
      selectedRowIds.length > 0
        ? gridRows.filter((r) => selectedRowIds.includes(r.id))
        : gridRows;
    if (targetRows.length === 0 || isLookingUpVinyl || isSaving) return;

    setIsLookingUpVinyl(true);
    setVinylLookupProgress({ current: 0, total: targetRows.length });
    setErrorMessage(null);

    try {
      let discogsToken = '';
      try {
        const credsRaw = localStorage.getItem('cd_api_credentials');
        if (credsRaw) {
          const creds = JSON.parse(credsRaw);
          discogsToken = creds.discogsToken || '';
        }
      } catch {}

      const foundMap = new Map<string, { releaseDate: string; format?: string; catalogNumber?: string }>();
      const CHUNK_SIZE = 5;

      for (let i = 0; i < targetRows.length; i += CHUNK_SIZE) {
        const chunk = targetRows.slice(i, i + CHUNK_SIZE);
        const res = await fetch('/api/lookup-vinyl-release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: chunk.map((c) => ({
              id: c.id,
              title: c.title,
              artist: c.artist,
              catalogNumber: c.catalogNumber,
              releaseDate: c.releaseDate,
            })),
            discogsToken,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const list = data.results || [];
          list.forEach((r: any) => {
            if (r && r.found && r.vinylRecordReleaseDate) {
              foundMap.set(r.id, {
                releaseDate: r.vinylRecordReleaseDate,
                format: r.vinylRecordFormat,
                catalogNumber: r.vinylRecordCatalogNumber,
              });
            }
          });
        }

        setVinylLookupProgress({
          current: Math.min(i + chunk.length, targetRows.length),
          total: targetRows.length,
        });
      }

      if (foundMap.size > 0) {
        setGridRows((prev) =>
          prev.map((row) => {
            const hit = foundMap.get(row.id);
            if (!hit) return row;
            return {
              ...row,
              vinylRecordReleaseDate: hit.releaseDate,
              vinylRecordFormat: hit.format || row.vinylRecordFormat || 'LP',
              vinylRecordCatalogNumber: hit.catalogNumber || row.vinylRecordCatalogNumber,
            };
          })
        );
        setEditedRowIds((prev) => {
          const next = new Set(prev);
          foundMap.forEach((_, id) => next.add(id));
          return next;
        });
        setSaveSuccessMessage(
          `${foundMap.size} 件の同タイトルLP/EPレコード発売日をAPIから取得してセルに反映しました。「一括保存」を押すとDBに保存されます。`
        );
      } else {
        setErrorMessage('対象のCDについて、同タイトルのLP/EPレコード発売日は見つかりませんでした。');
      }
    } catch {
      setErrorMessage('LP/EPレコード発売日のAPI取得中にエラーが発生しました。');
    } finally {
      setIsLookingUpVinyl(false);
      setVinylLookupProgress(null);
    }
  };

  // Image URL Verification State
  const [isCheckingImages, setIsCheckingImages] = useState(false);
  const [isConvertingBase64, setIsConvertingBase64] = useState(false);
  const [imageVerificationProgress, setImageVerificationProgress] = useState<{ current: number; total: number } | null>(null);
  const [brokenImageRowIds, setBrokenImageRowIds] = useState<Set<string>>(new Set());
  const [brokenImageReasons, setBrokenImageReasons] = useState<Map<string, string>>(new Map());
  const [imageCheckResult, setImageCheckResult] = useState<{ total: number; validCount: number; brokenCount: number; emptyCount: number } | null>(null);
  const [filterOnlyBrokenImages, setFilterOnlyBrokenImages] = useState(false);

  // Count rows with external http/https image links
  const externalLinkRows = useMemo(() => {
    return gridRows.filter(
      (r) =>
        r.coverUrl &&
        r.coverUrl.trim() !== '' &&
        !r.coverUrl.trim().startsWith('data:image/') &&
        (r.coverUrl.trim().startsWith('http://') || r.coverUrl.trim().startsWith('https://'))
    );
  }, [gridRows]);

  // Convert all external image links in gridRows to Base64 and mark them edited
  const handleConvertAllLinksToBase64 = async () => {
    if (externalLinkRows.length === 0 || isConvertingBase64) return;

    setIsConvertingBase64(true);
    setImageVerificationProgress({ current: 0, total: externalLinkRows.length });

    try {
      const convertedMap = new Map<string, string>();
      const newlyEditedIds: string[] = [];
      let completed = 0;
      const CONCURRENCY = 4;

      for (let i = 0; i < externalLinkRows.length; i += CONCURRENCY) {
        const chunk = externalLinkRows.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (row) => {
            if (!row.coverUrl) return;
            const base64 = await convertImageUrlToBase64(row.coverUrl);
            if (base64 && base64.startsWith('data:image/')) {
              convertedMap.set(row.id, base64);
              newlyEditedIds.push(row.id);
            }
            completed++;
            setImageVerificationProgress({ current: completed, total: externalLinkRows.length });
          })
        );
      }

      if (convertedMap.size > 0) {
        setGridRows((prev) =>
          prev.map((row) => {
            const newCover = convertedMap.get(row.id);
            return newCover ? { ...row, coverUrl: newCover } : row;
          })
        );
        setEditedRowIds((prev) => {
          const next = new Set(prev);
          newlyEditedIds.forEach((id) => next.add(id));
          return next;
        });
        setSaveSuccessMessage(`${convertedMap.size} 件のジャケット画像リンクをBASE64形式に変換しました。「一括保存」を押すとDBに保存されます。`);
      } else {
        setErrorMessage('BASE64に変換できる有効な外部画像リンクが見つかりませんでした。');
      }
    } catch {
      setErrorMessage('画像のBASE64一括変換中にエラーが発生しました。');
    } finally {
      setIsConvertingBase64(false);
      setImageVerificationProgress(null);
    }
  };

  // Helper to test if image URL is accessible
  const checkImageAccessibility = (url: string, timeoutMs = 3500): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!url || !url.trim()) {
        resolve(false);
        return;
      }
      const trimmed = url.trim();
      if (trimmed.startsWith('data:image/')) {
        resolve(true);
        return;
      }

      let settled = false;
      const img = new Image();
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, timeoutMs);

      img.onload = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(img.width > 0 && img.height > 0);
        }
      };

      img.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          // Try fallback via proxy
          const proxyImg = new Image();
          const proxyTimer = setTimeout(() => resolve(false), 2500);
          proxyImg.onload = () => {
            clearTimeout(proxyTimer);
            resolve(proxyImg.width > 0);
          };
          proxyImg.onerror = () => {
            clearTimeout(proxyTimer);
            resolve(false);
          };
          proxyImg.src = `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
        }
      };

      img.src = trimmed;
    });
  };

  // Run batch verification across all grid rows
  const handleVerifyImageUrls = async () => {
    if (isCheckingImages || gridRows.length === 0) return;

    setIsCheckingImages(true);
    setImageVerificationProgress({ current: 0, total: gridRows.length });

    const newBrokenSet = new Set<string>();
    const newReasonsMap = new Map<string, string>();
    let validCount = 0;
    let brokenCount = 0;
    let emptyCount = 0;

    const concurrency = 5;
    let completed = 0;

    for (let i = 0; i < gridRows.length; i += concurrency) {
      const chunk = gridRows.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (row) => {
          if (!row.coverUrl || !row.coverUrl.trim()) {
            emptyCount++;
            brokenCount++;
            newBrokenSet.add(row.id);
            newReasonsMap.set(row.id, '画像URL未設定');
          } else {
            const isValid = await checkImageAccessibility(row.coverUrl);
            if (isValid) {
              validCount++;
            } else {
              brokenCount++;
              newBrokenSet.add(row.id);
              newReasonsMap.set(row.id, '画像URLにアクセスできません (404/リンク切れ)');
            }
          }
          completed++;
          setImageVerificationProgress({ current: completed, total: gridRows.length });
        })
      );
    }

    setBrokenImageRowIds(newBrokenSet);
    setBrokenImageReasons(newReasonsMap);
    setImageCheckResult({
      total: gridRows.length,
      validCount,
      brokenCount,
      emptyCount,
    });
    setIsCheckingImages(false);
    setImageVerificationProgress(null);
  };

  // Handle column header click for sorting
  const handleColumnSort = (field: SortableField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortField(null);
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Drag-to-resize column width handler
  const handleStartResize = (colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = columnWidths[colKey] || DEFAULT_COLUMN_WIDTHS[colKey] || 150;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const minWidth = colKey === 'format' || colKey === 'trackCount' ? 80 : 100;
      const newWidth = Math.max(minWidth, startWidth + delta);
      setColumnWidths((prev) => ({
        ...prev,
        [colKey]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Handle cell changes
  const handleCellChange = (
    rowId: string,
    field: keyof CDMetadata | 'tagsStr',
    value: string
  ) => {
    let processedValue = value;

    // Enforce half-width input for catalogNumber and barcode
    if (field === 'catalogNumber' || field === 'barcode') {
      processedValue = toHankakuCode(value);
    } else if (field === 'releaseDate' || field === 'vinylRecordReleaseDate') {
      const halfWidth = toHankakuCode(value);
      const digits = halfWidth.replace(/\D/g, '');
      if (digits.length === 8 || digits.length === 6) {
        processedValue = formatToYYYYMMDD(digits);
      } else {
        processedValue = halfWidth;
      }
    }

    setGridRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;

        if (field === 'tagsStr') {
          const splitTags = processedValue
            .split(/[,、]/)
            .map((t) => t.trim().replace(/^#/, ''))
            .filter(Boolean);
          const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;
          const nextGenre =
            splitTags.length === 0
              ? ''
              : row.genre && splitTags.includes(row.genre)
              ? row.genre
              : splitTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || splitTags[0] || '';
          return {
            ...row,
            tags: splitTags,
            genre: nextGenre,
          };
        }

        if (field === 'genre') {
          const trimmedGenre = processedValue.trim().replace(/^#/, '');
          const currentTags = Array.isArray(row.tags) ? [...row.tags] : [];
          let nextTags = currentTags;
          if (!trimmedGenre) {
            if (row.genre && currentTags.includes(row.genre)) {
              nextTags = currentTags.filter((t) => t !== row.genre);
            }
          } else if (!currentTags.includes(trimmedGenre)) {
            if (row.genre && currentTags.includes(row.genre)) {
              nextTags = currentTags.map((t) => (t === row.genre ? trimmedGenre : t));
            } else {
              nextTags = [trimmedGenre, ...currentTags];
            }
          }
          return {
            ...row,
            genre: trimmedGenre,
            tags: nextTags,
          };
        }

        return {
          ...row,
          [field]: processedValue,
        };
      })
    );
    setEditedRowIds((prev) => new Set(prev).add(rowId));
  };

  // Checkbox Selection
  const toggleSelectAll = (visibleRows: CDMetadata[]) => {
    if (selectedRowIds.length === visibleRows.length && visibleRows.length > 0) {
      setSelectedRowIds([]);
    } else {
      setSelectedRowIds(visibleRows.map((r) => r.id));
    }
  };

  const toggleSelectRow = (rowId: string) => {
    setSelectedRowIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]
    );
  };

  // Delete selected rows
  const handleConfirmBatchDelete = () => {
    if (selectedRowIds.length === 0) return;

    // Call external batch delete for items that exist in the persistent database
    if (onBatchDeleteCDs) {
      const existingCDIds = new Set(cds.map((c) => c.id));
      const persistedIdsToDelete = selectedRowIds.filter((id) => existingCDIds.has(id));
      if (persistedIdsToDelete.length > 0) {
        onBatchDeleteCDs(persistedIdsToDelete);
      }
    }

    // Remove from local gridRows & editedRowIds
    setGridRows((prev) => prev.filter((r) => !selectedRowIds.includes(r.id)));
    setEditedRowIds((prev) => {
      const next = new Set(prev);
      selectedRowIds.forEach((id) => next.delete(id));
      return next;
    });
    setSelectedRowIds([]);
    setIsDeleteConfirmOpen(false);
    setSaveSuccessMessage(`${selectedRowIds.length} 件のレコードを削除しました`);
    setTimeout(() => setSaveSuccessMessage(null), 3000);
  };

  // Helper to sanitize cell values so unknown / placeholder texts display as blank
  const getDisplayValue = (val: string | undefined | null): string => {
    if (!val) return '';
    const trimmed = val.trim();
    if (
      trimmed === 'Unknown Title' ||
      trimmed === 'Unknown Artist' ||
      trimmed === 'タイトル未設定' ||
      trimmed === 'アーティスト未設定' ||
      trimmed === '新規アルバム'
    ) {
      return '';
    }
    return val;
  };

  // Add blank row
  const handleAddBlankRow = () => {
    const newId = `cd-manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newCD: CDMetadata = {
      id: newId,
      catalogNumber: '',
      title: '',
      artist: '',
      label: '',
      releaseDate: '',
      barcode: '',
      format: '',
      genre: '',
      coverUrl: '',
      tracks: [],
      tags: [],
      notes: '',
      source: 'gemini',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setGridRows((prev) => [newCD, ...prev]);
    setEditedRowIds((prev) => new Set(prev).add(newId));
  };

  // Discard all changes
  const handleDiscardChanges = () => {
    if (editedRowIds.size > 0 && !window.confirm(`${editedRowIds.size} 件の未保存の変更があります。すべて破棄して元に戻しますか？`)) {
      return;
    }
    setGridRows(
      cds.map((cd) => ({
        ...cd,
        tags: cd.tags ? [...cd.tags] : [],
        tracks: cd.tracks ? cd.tracks.map((t) => ({ ...t })) : [],
      }))
    );
    setEditedRowIds(new Set());
    setSelectedRowIds([]);
    setSaveSuccessMessage(null);
    setErrorMessage(null);
  };

  // Save all changes
  const handleSaveAll = async () => {
    if (editedRowIds.size === 0 || isSaving) return;

    setIsSaving(true);
    setErrorMessage(null);
    setSaveSuccessMessage(null);

    const modifiedCDs = gridRows.filter((r) => editedRowIds.has(r.id)).map((r) => ({
      ...r,
      updatedAt: new Date().toISOString(),
    }));

    setSaveProgress({ current: 0, total: modifiedCDs.length });

    try {
      await onBatchUpdateCDs(modifiedCDs, (completed, total) => {
        setSaveProgress({ current: completed, total });
      });
      
      setEditedRowIds(new Set());
      setSaveSuccessMessage(`${modifiedCDs.length} 件のCDデータを正常にローカルDB (IndexedDB) へ一括保存しました`);
      setTimeout(() => setSaveSuccessMessage(null), 4000);
    } catch (err: any) {
      console.error('Batch update error:', err);
      setErrorMessage(err.message || 'データの一括保存に失敗しました');
    } finally {
      setIsSaving(false);
      setSaveProgress(null);
    }
  };

  // Tracklist edits for expanded row
  const handleTrackChange = (
    cdId: string,
    trackIndex: number,
    field: keyof TrackInfo,
    value: string
  ) => {
    setGridRows((prev) =>
      prev.map((row) => {
        if (row.id !== cdId) return row;
        const nextTracks = [...(row.tracks || [])];
        if (!nextTracks[trackIndex]) return row;

        if (field === 'trackNumber') {
          nextTracks[trackIndex] = {
            ...nextTracks[trackIndex],
            trackNumber: parseInt(value, 10) || trackIndex + 1,
          };
        } else {
          nextTracks[trackIndex] = {
            ...nextTracks[trackIndex],
            [field]: value,
          };
        }

        return {
          ...row,
          tracks: nextTracks,
        };
      })
    );
    setEditedRowIds((prev) => new Set(prev).add(cdId));
  };

  // Paste TSV / CSV Data from Excel / Google Sheets
  const handleApplyPasteText = () => {
    if (!pasteRawText.trim()) return;

    const lines = pasteRawText.trim().split(/\r?\n/);
    if (lines.length === 0) return;

    const firstLine = lines[0];
    const isTSV = firstLine.includes('\t');
    const delimiter = isTSV ? '\t' : ',';

    const newParsedCDs: CDMetadata[] = [];

    lines.forEach((line, idx) => {
      const parts = line.split(delimiter).map((p) => p.trim().replace(/^["']|["']$/g, ''));
      if (parts.length === 0 || parts.every((p) => !p)) return;

      const catno = toHankakuCode(parts[0] || '');
      const title = parts[1] || '';
      const artist = parts[2] || '';
      const label = parts[3] || '';
      const releaseDate = formatToYYYYMMDD(parts[4] || '');
      const barcode = toHankakuCode(parts[5] || '');
      const format = parts[6] || '';
      const genre = parts[7] || '';
      const notes = parts[8] || '';

      const newId = `cd-paste-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`;
      newParsedCDs.push({
        id: newId,
        catalogNumber: catno,
        title,
        artist,
        label,
        releaseDate,
        barcode,
        format,
        genre,
        notes,
        coverUrl: '',
        tracks: [],
        tags: [],
        source: 'gemini',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    if (newParsedCDs.length > 0) {
      setGridRows((prev) => [...newParsedCDs, ...prev]);
      setEditedRowIds((prev) => {
        const next = new Set(prev);
        newParsedCDs.forEach((c) => next.add(c.id));
        return next;
      });
      setIsPasteModalOpen(false);
      setPasteRawText('');
      setSaveSuccessMessage(`${newParsedCDs.length} 行のデータをスプレッドシートに挿入しました。「一括保存」を押して保存してください。`);
    }
  };

  // Filter & Sort rows for display
  const displayRows = useMemo(() => {
    let result = [...gridRows];

    // Filter by broken images if enabled
    if (filterOnlyBrokenImages) {
      result = result.filter((r) => brokenImageRowIds.has(r.id));
    }

    // Filter by keyword (supports Japanese orthographic normalization such as 走ってください / 走って下さい)
    if (searchKeyword.trim()) {
      result = result.filter((r) => matchesCDSearchQuery(r, searchKeyword));
    }

    // Sort by field
    if (sortField) {
      result.sort((a, b) => {
        let valA: any = '';
        let valB: any = '';

        if (sortField === 'trackCount') {
          valA = a.tracks ? a.tracks.length : 0;
          valB = b.tracks ? b.tracks.length : 0;
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        } else if (sortField === 'tagsStr') {
          valA = (a.tags || []).join(', ').toLowerCase();
          valB = (b.tags || []).join(', ').toLowerCase();
        } else {
          valA = (a[sortField as keyof CDMetadata] || '').toString().toLowerCase();
          valB = (b[sortField as keyof CDMetadata] || '').toString().toLowerCase();
        }

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [gridRows, searchKeyword, sortField, sortDirection, filterOnlyBrokenImages, brokenImageRowIds]);

  // Helper to render sortable header with resize handle
  const renderSortableHeader = (
    field: SortableField,
    label: string,
    colKey: string,
    isResizable: boolean = true,
    textColor: string = 'text-slate-300'
  ) => {
    const isCurrentSort = sortField === field;
    const width = columnWidths[colKey] || DEFAULT_COLUMN_WIDTHS[colKey] || 150;

    return (
      <th
        style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
        className={`py-2.5 px-2.5 bg-slate-950 select-none relative group ${textColor}`}
      >
        <div
          onClick={() => handleColumnSort(field)}
          className="flex items-center justify-between gap-1 cursor-pointer hover:text-white transition-colors"
          title="クリックして正順/逆順ソート"
        >
          <span className="truncate">{label}</span>
          <span className="flex-shrink-0 text-slate-500 group-hover:text-slate-300">
            {isCurrentSort ? (
              sortDirection === 'asc' ? (
                <ArrowUp className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" />
              )
            ) : (
              <ArrowUpDown className="w-3 h-3 opacity-40 group-hover:opacity-100" />
            )}
          </span>
        </div>

        {/* Column Resize Handle */}
        {isResizable && (
          <div
            onMouseDown={(e) => handleStartResize(colKey, e)}
            className="absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-500/80 active:bg-emerald-500 z-10 transition-colors"
            title="ドラッグして列幅を調整"
          />
        )}
      </th>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-105px)] space-y-2 animate-in fade-in duration-200">
      
      {/* 1. Top Toolbar */}
      <div className="bg-slate-800/90 rounded-2xl border border-slate-700/80 px-3.5 py-2 shadow-xl flex flex-col md:flex-row items-center justify-between gap-2.5 flex-shrink-0">
        
        {/* Left: Title, Counter & Search */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto flex-1">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <FileSpreadsheet className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5 leading-none">
                <span>スプレッドシート形式エディタ</span>
                <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                  全 {gridRows.length} 行
                </span>
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-none">
                各項目名クリックでソート／境界ドラッグで列幅調整／画像クリックで詳細表示
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="表内を検索..."
              className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl py-1 pl-8 pr-7 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            {searchKeyword && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="absolute right-2 top-1.5 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Right: Actions (Batch Delete, Add Row, Paste, Save, Undo, Close) */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          
          {/* Batch Delete Button for Selected Rows */}
          {selectedRowIds.length > 0 && (
            <button
              type="button"
              onClick={() => setIsDeleteConfirmOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-600/50 shadow-md transition-all cursor-pointer animate-in fade-in"
              title="チェックしたレコードを一括削除"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-300" />
              <span>選択分を削除 ({selectedRowIds.length}件)</span>
            </button>
          )}

          {/* Dirty Counter Badge */}
          {editedRowIds.size > 0 && (
            <span className="text-[11px] font-bold text-amber-300 bg-amber-950/80 px-2.5 py-1 rounded-xl border border-amber-500/40 flex items-center gap-1.5 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>未保存: {editedRowIds.size} 件</span>
            </span>
          )}

          {/* Batch Lookup LP/EP Vinyl Release Date Button */}
          <button
            type="button"
            onClick={handleBatchLookupVinylInGrid}
            disabled={isLookingUpVinyl || isSaving || gridRows.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-500/40 transition-all cursor-pointer disabled:opacity-50"
            title="同タイトルのLP・EPレコード発売年月日をAPI（MusicBrainz・Discogs・NDL・Gemini）から一括取得します"
          >
            {isLookingUpVinyl ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <Disc className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>
              {isLookingUpVinyl
                ? `LP/EP取得中... (${vinylLookupProgress?.current || 0}/${vinylLookupProgress?.total || 0})`
                : selectedRowIds.length > 0
                ? `LP/EP発売日API取得 (${selectedRowIds.length}件)`
                : 'LP/EP発売日API取得'}
            </span>
          </button>

          {/* Convert External Image Links to Base64 Button */}
          {externalLinkRows.length > 0 && (
            <button
              type="button"
              onClick={handleConvertAllLinksToBase64}
              disabled={isConvertingBase64 || isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer disabled:opacity-50"
              title="外部URLリンクのジャケット画像をすべて取得してBASE64形式に変換します"
            >
              {isConvertingBase64 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              ) : (
                <Link2 className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>
                {isConvertingBase64
                  ? `BASE64化中... (${imageVerificationProgress?.current || 0}/${imageVerificationProgress?.total || 0})`
                  : `画像BASE64化 (${externalLinkRows.length}件)`}
              </span>
            </button>
          )}

          {/* Image Link Verification Button */}
          <button
            type="button"
            onClick={handleVerifyImageUrls}
            disabled={isCheckingImages || gridRows.length === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              isCheckingImages
                ? 'bg-amber-950/80 text-amber-200 border-amber-500/50 cursor-wait'
                : brokenImageRowIds.size > 0
                ? 'bg-rose-950/80 hover:bg-rose-900 text-rose-200 border-rose-500/50 shadow-md'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600'
            }`}
            title="すべてのCDジャケット画像URLのアクセス可能性・リンク切れを検証"
          >
            {isCheckingImages ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <ImageOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>
              {isCheckingImages
                ? `画像検証中... (${imageVerificationProgress?.current || 0}/${imageVerificationProgress?.total || 0})`
                : brokenImageRowIds.size > 0
                ? `リンク切れ: ${brokenImageRowIds.size}件`
                : '画像リンク検証'}
            </span>
          </button>

          {/* Add Row Button */}
          <button
            type="button"
            onClick={handleAddBlankRow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors cursor-pointer"
            title="末尾に空のCDレコード行を1行追加"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>空行追加</span>
          </button>

          {/* Excel Paste Button */}
          <button
            type="button"
            onClick={() => setIsPasteModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors cursor-pointer"
            title="ExcelやGoogleスプレッドシートからコピーしたデータを貼り付け"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-indigo-400" />
            <span>Excel貼付</span>
          </button>

          {/* Discard / Undo Button */}
          {editedRowIds.size > 0 && (
            <button
              type="button"
              onClick={handleDiscardChanges}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-rose-950/80 text-rose-300 border border-slate-700 hover:border-rose-600/50 transition-colors cursor-pointer"
              title="編集内容をすべて元に戻す"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>破棄</span>
            </button>
          )}

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={editedRowIds.size === 0 || isSaving}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold transition-all shadow-lg border ${
              isSaving
                ? 'bg-emerald-800/80 text-emerald-200 border-emerald-500/50 cursor-wait'
                : editedRowIds.size > 0
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40 border-emerald-400/40 cursor-pointer animate-pulse'
                : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
            }`}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-300" />
            ) : (
              <Save className="w-3.5 h-3.5 stroke-[2.5]" />
            )}
            <span>
              {isSaving
                ? saveProgress
                  ? `一括保存中... (${saveProgress.current}/${saveProgress.total}件)`
                  : '一括保存中...'
                : `一括保存 (${editedRowIds.size}件)`}
            </span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="通常テーブル表示に戻る"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

      </div>

      {/* Notifications & Progress Banner */}
      {imageCheckResult && !isCheckingImages && (
        <div className="bg-slate-900/90 border border-slate-700/80 p-3.5 rounded-xl flex items-center justify-between gap-3 text-xs flex-wrap shadow-md animate-in fade-in">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4.5 h-4.5 text-amber-400 flex-shrink-0" />
            <span className="text-slate-200 font-medium">
              画像検証完了: 全 {imageCheckResult.total} 件中、
              <span className="font-bold text-emerald-400 font-mono ml-1">{imageCheckResult.validCount} 件正常</span>、
              <span className={`font-bold font-mono ml-1 ${imageCheckResult.brokenCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                {imageCheckResult.brokenCount} 件の警告検出
              </span>
              （リンク切れ: {imageCheckResult.brokenCount - imageCheckResult.emptyCount}件 / URL未設定: {imageCheckResult.emptyCount}件）
            </span>
          </div>

          <div className="flex items-center gap-2">
            {imageCheckResult.brokenCount > 0 && (
              <button
                type="button"
                onClick={() => setFilterOnlyBrokenImages(!filterOnlyBrokenImages)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filterOnlyBrokenImages
                    ? 'bg-rose-600 text-white shadow-md'
                    : 'bg-rose-950/80 text-rose-300 border border-rose-500/40 hover:bg-rose-900'
                }`}
              >
                {filterOnlyBrokenImages ? 'すべての行を表示' : '⚠️ 警告・リンク切れのみ絞り込み'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setImageCheckResult(null);
                setFilterOnlyBrokenImages(false);
              }}
              className="text-slate-400 hover:text-white px-2 py-0.5 cursor-pointer font-bold"
              title="通知を閉じる"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {isSaving && (
        <div className="bg-indigo-950/90 border border-indigo-500/50 rounded-xl p-3.5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center flex-shrink-0">
              <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
            </div>
            <div>
              <p className="text-xs font-bold text-white flex items-center gap-2">
                <span>ローカルデータベース (Dexie.js / IndexedDB) へ一括保存中...</span>
              </p>
              <p className="text-[11px] text-indigo-300">
                外部リンクのジャケット画像のBASE64変換およびIndexedDBへの高速書き込みを実行しています。画面を閉じずにお待ちください。
              </p>
            </div>
          </div>
          {saveProgress && saveProgress.total > 0 && (
            <div className="text-right flex-shrink-0 min-w-[150px] w-full sm:w-auto">
              <span className="text-xs font-mono font-bold text-emerald-400">
                {saveProgress.current} / {saveProgress.total} 件 完了 ({Math.round((saveProgress.current / saveProgress.total) * 100)}%)
              </span>
              <div className="w-full sm:w-36 bg-slate-900 h-2 rounded-full mt-1 overflow-hidden border border-slate-700">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${Math.round((saveProgress.current / saveProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {saveSuccessMessage && !isSaving && (
        <div className="bg-emerald-950/80 border border-emerald-500/50 p-2.5 px-4 rounded-xl text-emerald-200 text-xs flex items-center justify-between gap-2 shadow-md animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{saveSuccessMessage}</span>
          </div>
          <button onClick={() => setSaveSuccessMessage(null)} className="text-emerald-400 hover:text-white text-xs">✕</button>
        </div>
      )}

      {errorMessage && (
        <div className="bg-rose-950/80 border border-rose-500/50 p-2.5 px-4 rounded-xl text-rose-200 text-xs flex items-center justify-between gap-2 shadow-md animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* 2. Interactive Spreadsheet Grid Container */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-700/80 shadow-2xl flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
          <table className="text-left text-xs text-slate-300 border-collapse">
            
            {/* Spreadsheet Sticky Header */}
            <thead className="sticky top-0 z-20 bg-slate-950 text-slate-300 text-[11px] font-bold tracking-wider border-b-2 border-slate-700 select-none shadow-md">
              <tr className="divide-x divide-slate-800">
                {/* 1. Checkbox Column (Fixed 36px, Sticky left-0) */}
                <th className="sticky left-0 z-30 py-2.5 px-2 w-9 min-w-[36px] max-w-[36px] text-center bg-slate-950 border-r border-slate-800">
                  <input
                    type="checkbox"
                    checked={selectedRowIds.length === displayRows.length && displayRows.length > 0}
                    onChange={() => toggleSelectAll(displayRows)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-0 cursor-pointer"
                    title="すべて選択/解除"
                  />
                </th>

                {/* 2. Row Number (#) (Fixed 40px, Sticky left-36px) */}
                <th className="sticky left-[36px] z-30 py-2.5 px-1.5 w-10 min-w-[40px] max-w-[40px] text-center bg-slate-950 text-slate-400 font-mono border-r border-slate-800">
                  #
                </th>

                {/* 3. Jacket Image (Fixed 56px, Sticky left-76px with shadow) */}
                <th className="sticky left-[76px] z-30 py-2.5 px-2 w-14 min-w-[56px] max-w-[56px] text-center bg-slate-950 border-r-2 border-slate-700/80 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.6)]">
                  画像
                </th>

                {/* 4. Track Count (Moved to right of Jacket Image) */}
                {renderSortableHeader('trackCount', 'トラック数', 'trackCount', true, 'text-center')}

                {/* 5. Catalog Number (Fixed 140px, non-resizable) */}
                <th
                  onClick={() => handleColumnSort('catalogNumber')}
                  className="py-2.5 px-2.5 w-36 min-w-[144px] max-w-[144px] bg-slate-950 text-indigo-300 cursor-pointer hover:text-white transition-colors"
                  title="クリックして型番順でソート"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>型番 (規格品番)</span>
                    <span className="text-slate-500">
                      {sortField === 'catalogNumber' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </span>
                  </div>
                </th>

                {/* 6-13. Resizable Columns with Sortable Headers */}
                {renderSortableHeader('title', 'CD / アルバムタイトル', 'title', true, 'text-white')}
                {renderSortableHeader('artist', '歌手 / アーティスト', 'artist', true, 'text-slate-200')}
                {renderSortableHeader('label', 'レーベル / 発売元', 'label', true)}
                {renderSortableHeader('releaseDate', 'CD発売年月日', 'releaseDate', true)}
                {renderSortableHeader('vinylRecordReleaseDate', 'LP/EP発売年月日', 'vinylRecordReleaseDate', true, 'text-amber-300')}
                {renderSortableHeader('barcode', 'JANコード', 'barcode', true)}
                {renderSortableHeader('format', 'フォーマット', 'format', true)}
                {renderSortableHeader('genre', 'ジャンル', 'genre', true)}
                {renderSortableHeader('tagsStr', 'タグ (カンマ区切り)', 'tags', true)}
                {renderSortableHeader('notes', '備考 / メモ', 'notes', true)}
              </tr>
            </thead>

            {/* Spreadsheet Table Rows */}
            <tbody className="divide-y divide-slate-800 font-sans">
              {displayRows.map((row, rowIdx) => {
                const isDirty = editedRowIds.has(row.id);
                const isSelected = selectedRowIds.includes(row.id);
                const isExpanded = expandedTracksRowId === row.id;
                const trackCount = row.tracks ? row.tracks.length : 0;
                const tagsStr = (row.tags || []).join(', ');
                const isEven = rowIdx % 2 === 0;

                const rowBgClass = isSelected
                  ? 'bg-indigo-900/80 hover:bg-indigo-900/95 border-y-2 border-indigo-500/80 shadow-[inset_0_0_12px_rgba(99,102,241,0.25)] text-indigo-100 font-medium'
                  : isDirty
                  ? 'bg-emerald-950/60 hover:bg-emerald-900/60 border-y border-emerald-500/50'
                  : isEven
                  ? 'bg-slate-900/90 hover:bg-slate-800/80'
                  : 'bg-slate-950/95 hover:bg-slate-800/80';

                const fixedCellBgClass = isSelected
                  ? 'bg-indigo-900/90 text-indigo-200'
                  : isDirty
                  ? 'bg-emerald-950/80 text-emerald-300'
                  : isEven
                  ? 'bg-slate-900/90 text-slate-400'
                  : 'bg-slate-950/95 text-slate-400';

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`divide-x divide-slate-800/80 transition-colors ${rowBgClass}`}
                    >
                      {/* Checkbox Cell (Sticky left-0) */}
                      <td className={`sticky left-0 z-10 py-1 px-2 text-center transition-colors ${fixedCellBgClass}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(row.id)}
                          className="rounded border-slate-700 text-indigo-500 focus:ring-0 cursor-pointer"
                        />
                      </td>

                      {/* Row Index & Dirty Dot (Sticky left-36px) */}
                      <td className={`sticky left-[36px] z-10 py-1 px-1.5 text-center font-mono text-[11px] relative transition-colors ${fixedCellBgClass}`}>
                        {isDirty && (
                          <span
                            className="absolute left-0.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse"
                            title="未保存の編集あり"
                          />
                        )}
                        <span className={isSelected ? 'text-indigo-200 font-bold' : ''}>{rowIdx + 1}</span>
                      </td>

                      {/* Jacket Thumbnail (Sticky left-76px with right drop shadow) */}
                      <td className={`sticky left-[76px] z-10 py-0.5 px-1 text-center transition-colors ${fixedCellBgClass} border-r-2 border-slate-800/90 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.6)]`}>
                        <div
                          onClick={() => onSelectCD && onSelectCD(row, gridRows)}
                          className={`w-8 h-8 rounded-lg bg-slate-950 overflow-hidden mx-auto border flex items-center justify-center relative group cursor-pointer hover:scale-105 transition-all shadow-sm ${
                            brokenImageRowIds.has(row.id)
                              ? 'border-rose-500/80 ring-2 ring-rose-500/50'
                              : 'border-slate-800 hover:border-indigo-400'
                          }`}
                          title={brokenImageRowIds.has(row.id) ? (brokenImageReasons.get(row.id) || '画像URLリンク切れ・アクセス不可') : 'クリックしてCDメタデータ詳細・編集画面を開く'}
                        >
                          {row.coverUrl ? (
                            <img
                              src={row.coverUrl}
                              alt={row.title}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={() => {
                                if (!brokenImageRowIds.has(row.id)) {
                                  setBrokenImageRowIds((prev) => new Set(prev).add(row.id));
                                  setBrokenImageReasons((prev) => new Map(prev).set(row.id, '画像読み込みエラー (404/アクセス不可)'));
                                }
                              }}
                            />
                          ) : (
                            <Disc className="w-4 h-4 text-slate-600 group-hover:text-indigo-400" />
                          )}

                          {/* Warning Alert Badge for Broken Image */}
                          {brokenImageRowIds.has(row.id) && (
                            <span
                              className="absolute -top-1 -right-1 bg-rose-600 text-white rounded-full p-0.5 shadow-lg animate-bounce"
                              title={brokenImageReasons.get(row.id) || '画像URLリンク切れ・未設定'}
                            >
                              <AlertTriangle className="w-2.5 h-2.5 text-white" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Track Count & Expand Button (Moved to right of Jacket) */}
                      <td className="py-0.5 px-2 text-center" style={{ width: `${columnWidths.trackCount || DEFAULT_COLUMN_WIDTHS.trackCount}px` }}>
                        <button
                          type="button"
                          onClick={() => setExpandedTracksRowId(isExpanded ? null : row.id)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                            trackCount > 0
                              ? 'bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-500/30'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700'
                          }`}
                          title="トラックリストを表形式で編集"
                        >
                          <Music className="w-3 h-3 text-indigo-400" />
                          <span>{trackCount} 曲</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </td>

                      {/* Catalog Number Input (Fixed width) */}
                      <td className="p-0">
                        <input
                          type="text"
                          inputMode="url"
                          value={getDisplayValue(row.catalogNumber)}
                          onChange={(e) => handleCellChange(row.id, 'catalogNumber', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs font-mono text-indigo-300 font-bold focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors uppercase"
                          style={{ imeMode: 'disabled' }}
                          title="型番 (半角入力のみ)"
                        />
                      </td>

                      {/* Title Input (Resizable width) */}
                      <td className="p-0" style={{ width: `${columnWidths.title || DEFAULT_COLUMN_WIDTHS.title}px` }}>
                        <input
                          type="text"
                          value={getDisplayValue(row.title)}
                          onChange={(e) => handleCellChange(row.id, 'title', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs font-bold text-white focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                        />
                      </td>

                      {/* Artist Input */}
                      <td className="p-0" style={{ width: `${columnWidths.artist || DEFAULT_COLUMN_WIDTHS.artist}px` }}>
                        <input
                          type="text"
                          value={getDisplayValue(row.artist)}
                          onChange={(e) => handleCellChange(row.id, 'artist', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs text-slate-200 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                        />
                      </td>

                      {/* Label Input */}
                      <td className="p-0" style={{ width: `${columnWidths.label || DEFAULT_COLUMN_WIDTHS.label}px` }}>
                        <input
                          type="text"
                          value={getDisplayValue(row.label)}
                          onChange={(e) => handleCellChange(row.id, 'label', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs text-slate-300 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                        />
                      </td>

                      {/* Release Date Input */}
                      <td className="p-0" style={{ width: `${columnWidths.releaseDate || DEFAULT_COLUMN_WIDTHS.releaseDate}px` }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={getDisplayValue(row.releaseDate)}
                          onChange={(e) => handleCellChange(row.id, 'releaseDate', e.target.value)}
                          onBlur={(e) => {
                            if (e.target.value) {
                              const formatted = formatToYYYYMMDD(e.target.value);
                              if (formatted !== row.releaseDate) {
                                handleCellChange(row.id, 'releaseDate', formatted);
                              }
                            }
                          }}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs font-mono text-slate-300 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                          style={{ imeMode: 'disabled' }}
                          title="CD発売年月日 (半角数字のみ YYYY-MM-DD)"
                        />
                      </td>

                      {/* Same-Title LP/EP Vinyl Release Date Input */}
                      <td className="p-0" style={{ width: `${columnWidths.vinylRecordReleaseDate || DEFAULT_COLUMN_WIDTHS.vinylRecordReleaseDate}px` }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={getDisplayValue(row.vinylRecordReleaseDate)}
                          onChange={(e) => handleCellChange(row.id, 'vinylRecordReleaseDate', e.target.value)}
                          onBlur={(e) => {
                            if (e.target.value) {
                              const formatted = formatToYYYYMMDD(e.target.value);
                              if (formatted !== row.vinylRecordReleaseDate) {
                                handleCellChange(row.id, 'vinylRecordReleaseDate', formatted);
                              }
                            }
                          }}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs font-mono text-amber-300 font-bold focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 rounded transition-colors"
                          style={{ imeMode: 'disabled' }}
                          title="同タイトルのLP・EPレコード発売年月日 (半角数字のみ YYYY-MM-DD)"
                        />
                      </td>

                      {/* Barcode (JAN) Input */}
                      <td className="p-0" style={{ width: `${columnWidths.barcode || DEFAULT_COLUMN_WIDTHS.barcode}px` }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={getDisplayValue(row.barcode)}
                          onChange={(e) => handleCellChange(row.id, 'barcode', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs font-mono text-slate-300 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                          style={{ imeMode: 'disabled' }}
                          title="JANコード (半角数字のみ)"
                        />
                      </td>

                      {/* Format Input */}
                      <td className="p-0" style={{ width: `${columnWidths.format || DEFAULT_COLUMN_WIDTHS.format}px` }}>
                        <input
                          type="text"
                          value={getDisplayValue(row.format)}
                          onChange={(e) => handleCellChange(row.id, 'format', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs text-slate-300 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                        />
                      </td>

                      {/* Genre Input */}
                      <td className="p-0" style={{ width: `${columnWidths.genre || DEFAULT_COLUMN_WIDTHS.genre}px` }}>
                        <input
                          type="text"
                          value={getDisplayValue(row.genre)}
                          onChange={(e) => handleCellChange(row.id, 'genre', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs text-slate-300 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                        />
                      </td>

                      {/* Tags Input */}
                      <td className="p-0" style={{ width: `${columnWidths.tags || DEFAULT_COLUMN_WIDTHS.tags}px` }}>
                        <input
                          type="text"
                          value={tagsStr}
                          onChange={(e) => handleCellChange(row.id, 'tagsStr', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs text-purple-300 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                        />
                      </td>

                      {/* Notes Input */}
                      <td className="p-0" style={{ width: `${columnWidths.notes || DEFAULT_COLUMN_WIDTHS.notes}px` }}>
                        <input
                          type="text"
                          value={getDisplayValue(row.notes)}
                          onChange={(e) => handleCellChange(row.id, 'notes', e.target.value)}
                          placeholder=""
                          className="w-full h-full bg-transparent px-2.5 py-1.5 text-xs text-slate-400 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded transition-colors"
                        />
                      </td>
                    </tr>

                    {/* Sub Tracklist Spreadsheet Drawer */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={14} className="p-0 bg-slate-950 border-y-2 border-indigo-500/40">
                          <div className="p-3.5 space-y-2.5 max-w-4xl">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Music className="w-4 h-4 text-indigo-400" />
                                <h4 className="text-xs font-bold text-white">
                                  「{row.title}」の収録曲リスト表（{trackCount}曲）
                                </h4>
                              </div>
                            </div>

                            {row.tracks && row.tracks.length > 0 ? (
                              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                                    <tr>
                                      <th className="py-1.5 px-2 w-16 text-center">曲順</th>
                                      <th className="py-1.5 px-3">曲名 (トラックタイトル)</th>
                                      <th className="py-1.5 px-3 w-32">演奏時間</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/60">
                                    {row.tracks.map((tr, tIdx) => (
                                      <tr key={tIdx} className="hover:bg-slate-800/40">
                                        <td className="p-0">
                                          <input
                                            type="number"
                                            value={tr.trackNumber || tIdx + 1}
                                            onChange={(e) => handleTrackChange(row.id, tIdx, 'trackNumber', e.target.value)}
                                            className="w-full bg-transparent py-1.5 px-2 text-center font-mono text-xs text-indigo-300 focus:bg-slate-800 focus:outline-none"
                                          />
                                        </td>
                                        <td className="p-0">
                                          <input
                                            type="text"
                                            value={tr.title}
                                            onChange={(e) => handleTrackChange(row.id, tIdx, 'title', e.target.value)}
                                            placeholder=""
                                            className="w-full bg-transparent py-1.5 px-3 text-xs text-white font-medium focus:bg-slate-800 focus:outline-none"
                                          />
                                        </td>
                                        <td className="p-0">
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={tr.duration || ''}
                                            onChange={(e) => handleTrackChange(row.id, tIdx, 'duration', formatToHankakuDuration(e.target.value))}
                                            placeholder=""
                                            className="w-full bg-transparent py-1.5 px-3 font-mono text-xs text-slate-300 focus:bg-slate-800 focus:outline-none"
                                            style={{ imeMode: 'disabled' }}
                                            title="演奏時間 (半角のみ)"
                                          />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500 italic py-2">
                                収録曲がまだ登録されていません。
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">選択したレコードの削除</h3>
                <p className="text-xs text-slate-400">この操作は取り消せません</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              チェックした <strong className="text-rose-400 font-bold">{selectedRowIds.length} 件</strong> のCDレコードを表から削除します。よろしいですか？
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchDelete}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow"
              >
                削除を実行する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Excel / TSV Direct Paste Modal */}
      {isPasteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ClipboardPaste className="w-4 h-4 text-emerald-400" />
                <span>Excel・スプレッドシートからデータ一括貼り付け</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              ExcelやGoogleスプレッドシートでセル範囲をコピー（Ctrl+C）し、下のテキストエリアに貼り付け（Ctrl+V）てください。
            </p>

            <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1">
              <p className="font-bold text-indigo-300">推奨列の並び順（タブ区切り/カンマ区切り）:</p>
              <p className="font-mono text-[10px] text-slate-400">
                型番 [Tab] タイトル [Tab] アーティスト [Tab] レーベル [Tab] 発売日 [Tab] JANコード [Tab] 仕様
              </p>
            </div>

            <textarea
              rows={6}
              value={pasteRawText}
              onChange={(e) => setPasteRawText(e.target.value)}
              placeholder="ここにコピーしたデータを貼り付け (Ctrl+V)..."
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl p-3 text-xs text-white font-mono placeholder-slate-600"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleApplyPasteText}
                disabled={!pasteRawText.trim()}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow disabled:opacity-40"
              >
                スプレッドシートに挿入反映
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
