import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout } from './lib/firebase';
import { getAllCDs, saveCD, saveMultipleCDs, deleteMultipleCDs, getTrashedCDs, restoreCDs, purgeCDs, purgeExpiredTrash, importCDs, loadApiCredentialsDB, saveApiCredentialsDB, initPersistentStorage, loadAppInfoConfigDB, saveAppInfoConfigDB, DEFAULT_APP_INFO_CONFIG, AppInfoConfig } from './lib/db';
import { CDMetadata, SearchQuery, SearchResponse, APICredentials } from './types/cd';
import { getJSTISOString } from './lib/dateUtils';
import { Header } from './components/Header';
import { SearchPanel } from './components/SearchPanel';
import { SearchResults } from './components/SearchResults';
import { enabledSourcesLabel, isSourceEnabled } from './config/sources';
import { CDDetailModal } from './components/CDDetailModal';
import { CDDatabaseTable } from './components/CDDatabaseTable';
import { DataExchangeModal } from './components/DataExchangeModal';
import { BackupSettingsModal } from './components/BackupSettingsModal';
import { TrashModal } from './components/TrashModal';
import { TRASH_RETENTION_DAYS } from './lib/trash';
import { listMissingReadings, type ReadingTarget } from './lib/readingSort';
import { useAutoBackup } from './hooks/useAutoBackup';
import { useToast } from './hooks/useToast';
import { useServerConfigStatus } from './hooks/useServerConfigStatus';
import { useDisplaySettings } from './hooks/useDisplaySettings';
import { useSearchPreviewMode } from './hooks/useSearchPreviewMode';
import { getBackupSettings } from './lib/autoBackup';
import { CDSpineScanner } from './components/CDSpineScanner';
import { APISettingsModal } from './components/APISettingsModal';
import { AITaggingModal } from './components/AITaggingModal';
import { AppInfoModal } from './components/AppInfoModal';
import { AdminModeModal } from './components/AdminModeModal';
import { DashboardView } from './components/DashboardView';
import { DuplicateCheckView } from './components/DuplicateCheckView';
import { JacketGalleryView } from './components/JacketGalleryView';
import { PDFCatalogModal } from './components/PDFCatalogModal';
import { TagManagerModal } from './components/TagManagerModal';
import { TrackSearchAndSetlistView } from './components/TrackSearchAndSetlistView';
import { CDInlinePreviewCard } from './components/CDInlinePreviewCard';
import { CheckCircle2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { createLogger } from './lib/logger';
import { convertImageUrlToBase64 } from './utils/imageEnhancer';
import { BatchProcessingModal, BatchProcessingState } from './components/BatchProcessingModal';
import { lookupVinylReleasesBatch } from './utils/formatUtils';

const log = createLogger('App');

export default function App() {
  const [user, setUser] = useState<User | null>(null);

  // API Keys state
  // APIキーは暗号化して IndexedDB に保存している。起動後に loadApiCredentialsDB で復号して読み込む
  const [apiCredentials, setApiCredentials] = useState<APICredentials>({});

  // CD Database State
  const [savedCDs, setSavedCDs] = useState<CDMetadata[]>([]);
  
  // Navigation State
  const [activeTab, setActiveTab] = useState<'search' | 'database' | 'gallery' | 'tracks' | 'dashboard' | 'duplicates'>('search');
  const [librarySearchFilter, setLibrarySearchFilter] = useState<string>('');

  // Duplicate groups calculation
  const duplicateGroupsCount = React.useMemo(() => {
    const map = new Map<string, number>();
    savedCDs.forEach((cd) => {
      const cleanCat = cd.catalogNumber ? cd.catalogNumber.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
      const cleanTitle = cd.title ? cd.title.toLowerCase().replace(/[‐－―ー\-\s_]/g, '') : '';
      const cleanArtist = cd.artist ? cd.artist.toLowerCase().replace(/[‐－―ー\-\s_]/g, '') : '';
      const key = cleanCat ? `cat:${cleanCat}` : (cleanTitle && cleanArtist ? `ta:${cleanTitle}_${cleanArtist}` : '');
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    let count = 0;
    map.forEach((val) => { if (val >= 2) count++; });
    return count;
  }, [savedCDs]);

  // Search State
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);

  // Modal States
  const [selectedCDForModal, setSelectedCDForModal] = useState<CDMetadata | null>(null);
  const [modalCDList, setModalCDList] = useState<CDMetadata[]>([]);

  // 検索結果の詳細表示方式（モーダル表示 ⇄ スプリット表示）と右プレビューのCD
  const { searchPreviewMode, splitPreviewCD, setSplitPreviewCD, togglePreviewMode, resetForNewSearch } = useSearchPreviewMode({
    candidates: searchResponse?.candidates?.map((c) => c.cd) || [],
    selectedCDForModal,
  });
  const [trashedCDs, setTrashedCDs] = useState<CDMetadata[]>([]);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isBackupSettingsOpen, setIsBackupSettingsOpen] = useState(false);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [isLibraryLoaded, setIsLibraryLoaded] = useState(false);
  const [isDataExchangeOpen, setIsDataExchangeOpen] = useState(false);
  const [dataExchangeMode, setDataExchangeMode] = useState<'export' | 'import'>('export');
  const [itemsToExport, setItemsToExport] = useState<CDMetadata[]>([]);
  const [isOCRModalOpen, setIsOCRModalOpen] = useState(false);
  const [isAPISettingsOpen, setIsAPISettingsOpen] = useState(false);
  const [isAITaggingOpen, setIsAITaggingOpen] = useState(false);
  const [isAppInfoOpen, setIsAppInfoOpen] = useState(false);
  const [aiTaggingSelectedCDs, setAiTaggingSelectedCDs] = useState<CDMetadata[]>([]);
  const [isPDFCatalogOpen, setIsPDFCatalogOpen] = useState(false);
  const [pdfCatalogSelectedCDs, setPdfCatalogSelectedCDs] = useState<CDMetadata[]>([]);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isAdminModeOpen, setIsAdminModeOpen] = useState(false);

  const [batchProcessingState, setBatchProcessingState] = useState<BatchProcessingState>({
    isOpen: false,
    type: 'vinyl',
    title: '',
    subtitle: '',
    current: 0,
    total: 0,
  });

  // Toast Notification / 表示設定（テーマ・ヘッダー・検索パネル）
  const { toast, showToast, dismissToast } = useToast();
  const serverConfig = useServerConfigStatus();
  const {
    isDarkMode,
    toggleTheme,
    isCompactHeader,
    toggleCompactHeader,
    isSearchPanelCollapsed,
    toggleSearchPanelCollapse,
  } = useDisplaySettings(showToast);

  // Load Auth state and Dexie IndexedDB on mount
  useEffect(() => {
    (async () => {
      await initPersistentStorage();
      await loadLocalLibrary();
      setIsLibraryLoaded(true);
      // 保持期間を過ぎたゴミ箱のCDを完全に削除してから、ゴミ箱の件数を読み込む
      try {
        await purgeExpiredTrash();
      } catch (err) {
        log.warn('ゴミ箱の自動整理に失敗しました', err);
      }
      await loadTrash();
      try {
        setBackupEnabled(getBackupSettings().enabled);
      } catch {
        // localStorage が使えない環境
      }
      const creds = await loadApiCredentialsDB();
      setApiCredentials(creds);

      initAuth(
        (u) => setUser(u),
        () => setUser(null)
      );
    })();
  }, []);

  const loadTrash = async () => {
    try {
      setTrashedCDs(await getTrashedCDs());
    } catch (err) {
      log.error('Failed to load trash:', err);
    }
  };

  const loadLocalLibrary = async () => {
    try {
      const cds = await getAllCDs();
      setSavedCDs(cds);
    } catch (err) {
      log.error('Failed to load local DB:', err);
    }
  };

  // JSON自動バックアップ（有効なとき、条件を満たすとバックグラウンドで保存する）
  useAutoBackup(savedCDs, isLibraryLoaded, (notice) => showToast(notice.message));

  const handleLogin = async () => {
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        showToast('Googleアカウントでログインしました');
        return res;
      }
    } catch (err: any) {
      log.error('Login error:', err);
      if (err?.code === 'auth/unauthorized-domain' || err?.message?.includes('unauthorized-domain')) {
        showToast('ログイン不可: ドメインが未承認です。アプリ情報ヘルプの解決手順をご確認ください。');
        setIsAppInfoOpen(true);
      } else {
        showToast(`ログインに失敗しました: ${err.message || ''}`);
      }
    }
    return null;
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    showToast('Googleアカウントからログアウトしました（ローカルDBのデータはそのまま保持されています）');
  };

  const handleSaveApiCredentials = async (updated: APICredentials) => {
    setApiCredentials(updated);
    const saved = await saveApiCredentialsDB(updated);
    showToast(
      saved
        ? 'API設定を暗号化してローカルデータベース（IndexedDB）に保存しました'
        : 'API設定を暗号化して保存できませんでした（この画面を開いている間だけ有効です）。HTTPS またはlocalhost で開いているか確認してください'
    );
  };

  // 1. LP/EP発売日API一括取得処理
  // 既にLP/EP発売日が登録されている場合はスキップする
  const handleBatchLookupVinylReleaseDates = async (targetItems: CDMetadata[]) => {
    if (targetItems.length === 0 || batchProcessingState.isOpen) return;

    const unrecordedCDs = targetItems.filter(
      (c) => !c.vinylRecordReleaseDate || c.vinylRecordReleaseDate.trim() === ''
    );
    const skippedCount = targetItems.length - unrecordedCDs.length;

    if (unrecordedCDs.length === 0) {
      showToast('対象のCDには既にすべてLP/EP発売日が登録されているため、処理をスキップしました');
      return;
    }

    setBatchProcessingState({
      isOpen: true,
      type: 'vinyl',
      title: 'LP/EP発売日API一括取得中',
      subtitle: `${unrecordedCDs.length}件のCDの同タイトルアナログ盤（LP/EP）情報をAPI検索しています...`,
      current: 0,
      total: unrecordedCDs.length,
      currentTitle: unrecordedCDs[0]?.title,
      currentArtist: unrecordedCDs[0]?.artist,
      detail: skippedCount > 0 ? `※ 登録済の${skippedCount}件は自動スキップされました` : undefined,
    });

    try {
      const targetMap = new Map(unrecordedCDs.map((c) => [c.id, c]));
      const results = await lookupVinylReleasesBatch(
        unrecordedCDs.map((c) => ({
          id: c.id,
          title: c.title,
          artist: c.artist,
          catalogNumber: c.catalogNumber,
          releaseDate: c.releaseDate,
        })),
        (current, total) => {
          const currentItem = unrecordedCDs[Math.min(current, unrecordedCDs.length - 1)];
          setBatchProcessingState((prev) => ({
            ...prev,
            current,
            total,
            currentTitle: currentItem?.title,
            currentArtist: currentItem?.artist,
          }));
        }
      );

      const updatedAt = getJSTISOString();
      const updatedCDs: CDMetadata[] = [];
      results.forEach((r) => {
        if (r && r.found && r.vinylRecordReleaseDate) {
          const orig = targetMap.get(r.id);
          if (orig) {
            updatedCDs.push({
              ...orig,
              vinylRecordReleaseDate: r.vinylRecordReleaseDate,
              vinylRecordFormat: r.vinylRecordFormat || orig.vinylRecordFormat || 'LP',
              vinylRecordCatalogNumber: r.vinylRecordCatalogNumber || orig.vinylRecordCatalogNumber,
              updatedAt,
            });
          }
        }
      });

      if (updatedCDs.length > 0) {
        await saveMultipleCDs(updatedCDs);
        await loadLocalLibrary();
        showToast(`${updatedCDs.length} 件のLP/EP発売日をAPIから取得・登録しました！${skippedCount > 0 ? `（${skippedCount}件スキップ）` : ''}`);
      } else {
        showToast(`対象${unrecordedCDs.length}件について、新たに取得できる同タイトルLP/EP発売日は見つかりませんでした${skippedCount > 0 ? `（${skippedCount}件スキップ済）` : ''}`);
      }
    } catch (err) {
      log.error('Batch vinyl lookup failed', err);
      showToast(err instanceof Error ? err.message : 'LP/EP発売日の一括取得に失敗しました');
    } finally {
      setBatchProcessingState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // 2. タイトル・歌手名の読み仮名生成処理
  // 既にアルバムタイトル、歌手・アーティスト名の両方の読み仮名が登録されている場合はスキップする
  const [isGeneratingReadings, setIsGeneratingReadings] = useState(false);
  const handleGenerateReadings = async (ids?: string[]) => {
    const targets = listMissingReadings(savedCDs, ids);
    const targetSet = ids && ids.length > 0 ? new Set(ids) : null;
    const totalConsidered = targetSet ? savedCDs.filter((c) => targetSet.has(c.id)).length : savedCDs.length;
    const skippedCount = totalConsidered - targets.length;

    if (targets.length === 0) {
      showToast('対象のCDには既にすべて読み仮名が登録されているため、処理をスキップしました');
      return;
    }

    setIsGeneratingReadings(true);
    setBatchProcessingState({
      isOpen: true,
      type: 'reading',
      title: '読み仮名一括生成中',
      subtitle: 'Shirabe API（日本語テキスト処理）でタイトル・歌手名の読み仮名を推定しています...',
      current: 0,
      total: targets.length,
      currentTitle: targets[0]?.title,
      currentArtist: targets[0]?.artist,
      detail: skippedCount > 0 ? `※ 登録済の${skippedCount}件は自動スキップされました` : undefined,
    });

    try {
      const CHUNK = 20;
      const generated = new Map<string, { titleReading?: string; artistReading?: string }>();
      for (let i = 0; i < targets.length; i += CHUNK) {
        const chunk: ReadingTarget[] = targets.slice(i, i + CHUNK);
        const processedCount = Math.min(i + CHUNK, targets.length);
        const currentTarget = chunk[0];
        setBatchProcessingState((prev) => ({
          ...prev,
          current: processedCount,
          total: targets.length,
          currentTitle: currentTarget?.title,
          currentArtist: currentTarget?.artist,
        }));

        const res = await fetch('/api/ai-readings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `読み仮名の生成に失敗しました（HTTP ${res.status}）`);
        }
        const data: { results?: { id: string; titleReading?: string; artistReading?: string }[] } = await res.json();
        for (const r of data.results || []) generated.set(r.id, r);
      }

      const updatedAt = getJSTISOString();
      const toSave = savedCDs.flatMap((cd) => {
        const g = generated.get(cd.id);
        if (!g) return [];
        const next = {
          ...cd,
          titleReading: cd.titleReading || g.titleReading,
          artistReading: cd.artistReading || g.artistReading,
        };
        const changed = next.titleReading !== cd.titleReading || next.artistReading !== cd.artistReading;
        return changed ? [{ ...next, updatedAt }] : [];
      });
      if (toSave.length > 0) {
        await saveMultipleCDs(toSave);
        await loadLocalLibrary();
      }
      showToast(
        toSave.length > 0
          ? `${toSave.length}件の読み仮名を生成・登録しました！${skippedCount > 0 ? `（${skippedCount}件スキップ）` : ''}`
          : `読み仮名を推定できませんでした${skippedCount > 0 ? `（${skippedCount}件スキップ）` : ''}`
      );
    } catch (err) {
      log.error('読み仮名の生成に失敗', err);
      showToast(err instanceof Error ? err.message : '読み仮名の生成に失敗しました');
    } finally {
      setIsGeneratingReadings(false);
      setBatchProcessingState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // アルバムタイトル・アーティスト名をそのままよみがなに一括コピー（補完）するハンドラー
  const handleBatchCopyReadingsFromTitles = async (ids?: string[]) => {
    const targetSet = ids && ids.length > 0 ? new Set(ids) : null;
    const targets = savedCDs.filter((cd) => {
      if (targetSet && !targetSet.has(cd.id)) return false;
      return !cd.titleReading || !cd.artistReading;
    });

    if (targets.length === 0) {
      showToast('対象のCDには既にすべて読み仮名が登録されているため、処理をスキップしました');
      return;
    }

    setBatchProcessingState({
      isOpen: true,
      type: 'reading',
      title: 'タイトルからよみがなを一括コピー中',
      subtitle: '未登録のタイトル・アーティスト名をよみがなに一括コピーしています...',
      current: 0,
      total: targets.length,
      currentTitle: targets[0]?.title,
      currentArtist: targets[0]?.artist,
    });

    try {
      const updatedAt = getJSTISOString();
      const updatedCDs: CDMetadata[] = [];

      for (let i = 0; i < targets.length; i++) {
        const cd = targets[i];
        setBatchProcessingState((prev) => ({
          ...prev,
          current: i + 1,
          total: targets.length,
          currentTitle: cd.title,
          currentArtist: cd.artist,
        }));

        const newTitleReading = cd.titleReading || cd.title || '';
        const newArtistReading = cd.artistReading || cd.artist || '';

        if (newTitleReading !== cd.titleReading || newArtistReading !== cd.artistReading) {
          updatedCDs.push({
            ...cd,
            titleReading: newTitleReading,
            artistReading: newArtistReading,
            updatedAt,
          });
        }
      }

      if (updatedCDs.length > 0) {
        await saveMultipleCDs(updatedCDs);
        await loadLocalLibrary();
        showToast(`${updatedCDs.length}件のタイトル・アーティスト名をよみがなに一括コピー・登録しました！`);
      } else {
        showToast('新しくコピーする対象はありませんでした');
      }
    } catch (err) {
      log.error('読み仮名の一括コピーに失敗', err);
      showToast(err instanceof Error ? err.message : '読み仮名の一括コピーに失敗しました');
    } finally {
      setBatchProcessingState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // 3. ジャケット写真のURLをBase64に一括変換してオフライン保存するハンドラー
  // 既にジャケット画像がBASE64形式に変換されている場合はスキップする
  const [isConvertingBase64, setIsConvertingBase64] = useState(false);
  const handleBatchConvertToBase64 = async (ids?: string[]) => {
    const only = ids && ids.length > 0 ? new Set(ids) : null;
    const candidates = savedCDs.filter((cd) => (only ? only.has(cd.id) : true));

    const targets = candidates.filter((cd) => {
      const hasUrlCover = cd.coverUrl && cd.coverUrl.trim().startsWith('http');
      const hasUrlSub = (cd.subImages || []).some((s) => s && s.imageUrl && s.imageUrl.trim().startsWith('http'));
      return hasUrlCover || hasUrlSub;
    });

    const skippedCount = candidates.length - targets.length;

    if (targets.length === 0) {
      showToast('対象のCDは既にすべてBase64形式に変換済み（または画像なし）のため、処理をスキップしました');
      return;
    }

    setIsConvertingBase64(true);
    setBatchProcessingState({
      isOpen: true,
      type: 'base64',
      title: 'ジャケット画像Base64一括変換中',
      subtitle: 'ジャケット画像URLをBase64データ形式に変換してIndexedDBへオフライン保存しています...',
      current: 0,
      total: targets.length,
      currentTitle: targets[0]?.title,
      currentArtist: targets[0]?.artist,
      detail: skippedCount > 0 ? `※ 変換済みの${skippedCount}件は自動スキップされました` : undefined,
    });

    try {
      let convertedCount = 0;
      const updatedAt = getJSTISOString();
      const updatedCDs: CDMetadata[] = [];

      for (let i = 0; i < targets.length; i++) {
        const cd = targets[i];
        setBatchProcessingState((prev) => ({
          ...prev,
          current: i + 1,
          total: targets.length,
          currentTitle: cd.title,
          currentArtist: cd.artist,
        }));

        let newCoverUrl = cd.coverUrl;
        let coverChanged = false;
        if (cd.coverUrl && cd.coverUrl.trim().startsWith('http')) {
          const b64 = await convertImageUrlToBase64(cd.coverUrl);
          if (b64 && b64.startsWith('data:image/')) {
            newCoverUrl = b64;
            coverChanged = true;
          }
        }

        let newSubImages = cd.subImages;
        let subChanged = false;
        if (cd.subImages && cd.subImages.length > 0) {
          newSubImages = await Promise.all(
            cd.subImages.map(async (sub) => {
              if (sub && sub.imageUrl && sub.imageUrl.trim().startsWith('http')) {
                const b64Sub = await convertImageUrlToBase64(sub.imageUrl, 750, 0.84);
                if (b64Sub && b64Sub.startsWith('data:image/')) {
                  subChanged = true;
                  return { ...sub, imageUrl: b64Sub };
                }
              }
              return sub;
            })
          );
        }

        if (coverChanged || subChanged) {
          updatedCDs.push({
            ...cd,
            coverUrl: newCoverUrl,
            subImages: newSubImages,
            updatedAt,
          });
          convertedCount++;
        }
      }

      if (updatedCDs.length > 0) {
        await saveMultipleCDs(updatedCDs);
        await loadLocalLibrary();
      }

      showToast(`${convertedCount}件のジャケット画像をBase64形式に変換・オフライン保存しました！${skippedCount > 0 ? `（${skippedCount}件スキップ）` : ''}`);
    } catch (err) {
      log.error('Base64一括変換に失敗', err);
      showToast(err instanceof Error ? err.message : 'Base64一括変換に失敗しました');
    } finally {
      setIsConvertingBase64(false);
      setBatchProcessingState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // ブラウザに保存したAPIキーをすべて削除する（サーバーの環境変数のキーは影響を受けない）
  const handleClearStoredApiKeys = async () => {
    setApiCredentials({});
    await saveApiCredentialsDB({});
    showToast('ブラウザに保存したAPIキーを削除しました');
  };

  // Perform multi-source aggregated search
  const handlePerformSearch = async (query: SearchQuery, retryCount = 0) => {
    setIsLoadingSearch(true);
    setSearchResponse(null);
    if (retryCount === 0) {
      // 検索の最初は常にモーダル表示（スプリットのプレビューも閉じる）
      resetForNewSearch();
    }

    const fullQuery: SearchQuery = {
      ...query,
      apiKeys: {
        ...apiCredentials,
        ...query.apiKeys,
      },
    };

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullQuery),
      });

      if (!res.ok) {
        let errMessage = '検索処理でエラーが発生しました。';
        try {
          const errData = await res.json();
          errMessage = errData.error || errMessage;
        } catch {}
        throw new Error(errMessage);
      }

      const data: SearchResponse = await res.json();
      setSearchResponse(data);
      setSplitPreviewCD(null);
      setIsLoadingSearch(false);
    } catch (err: any) {
      log.error('Search failure:', err);
      if ((err.message === 'Failed to fetch' || err.message?.includes('fetch') || err.message?.includes('NetworkError')) && retryCount < 1) {
        setTimeout(() => handlePerformSearch(query, retryCount + 1), 1200);
        return;
      }
      showToast(`検索エラー: ${err.message || '通信エラー'}`);
      setIsLoadingSearch(false);
    }
  };

  // Save single CD to DB
  const handleSaveCDToDB = async (cd: CDMetadata): Promise<CDMetadata> => {
    const saved = await saveCD(cd);
    await loadLocalLibrary();
    showToast(`「${saved.title}」をライブラリに保存しました`);
    return saved;
  };

  const handleOpenManualAdd = () => {
    const newCD: CDMetadata = {
      id: `manual_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      catalogNumber: '',
      title: '新規CDアルバム',
      artist: 'アーティスト名',
      label: '',
      releaseDate: new Date().toISOString().slice(0, 10),
      barcode: '',
      coverUrl: '',
      tracks: [
        { trackNumber: 1, title: 'トラック 1' },
      ],
      notes: '手動登録データ',
      source: 'gemini',
      createdAt: getJSTISOString(),
      updatedAt: getJSTISOString(),
    };
    setSelectedCDForModal(newCD);
  };

  // Delete CD from DB
  // CDをゴミ箱に移す（完全には削除しない）。トーストの「元に戻す」で取り消せる
  const moveToTrash = async (ids: string[], label: string) => {
    await deleteMultipleCDs(ids);
    await loadLocalLibrary();
    await loadTrash();
    showToast(`${label}をゴミ箱に移しました（${TRASH_RETENTION_DAYS}日間は元に戻せます）`, {
      durationMs: 10000,
      action: {
        label: '元に戻す',
        onClick: async () => {
          await restoreCDs(ids);
          await loadLocalLibrary();
          await loadTrash();
          showToast(`${label}を元に戻しました`);
        },
      },
    });
  };

  const handleDeleteCD = async (id: string) => {
    const title = savedCDs.find((c) => c.id === id)?.title;
    await moveToTrash([id], title ? `「${title}」` : 'CD');
  };

  // Batch Delete
  const handleBatchDelete = async (ids: string[]) => {
    await moveToTrash(ids, `${ids.length} 件のCD`);
  };

  // ゴミ箱からの操作
  const handleRestoreFromTrash = async (ids: string[]) => {
    await restoreCDs(ids);
    await loadLocalLibrary();
    await loadTrash();
    showToast(`${ids.length} 件のCDを元に戻しました`);
  };

  const handlePurgeFromTrash = async (ids: string[]) => {
    await purgeCDs(ids);
    await loadTrash();
    showToast(`${ids.length} 件のCDを完全に削除しました`);
  };

  // 書き出し・読み込みモーダルを開く
  const handleOpenDataExchange = (mode: 'import' | 'export', items: CDMetadata[] = []) => {
    setDataExchangeMode(mode);
    setItemsToExport(mode === 'export' ? items : []);
    setIsDataExchangeOpen(true);
  };


  // Open AI Tagging Modal
  const handleOpenAITagging = (selected: CDMetadata[]) => {
    setAiTaggingSelectedCDs(selected);
    setIsAITaggingOpen(true);
  };

  // Open PDF Catalog / Analog Sleeve Export Modal
  const handleOpenPDFCatalog = (selected: CDMetadata[]) => {
    setPdfCatalogSelectedCDs(selected);
    setIsPDFCatalogOpen(true);
  };

  // Apply Batch CD Updates / AI Tags to Library
  const handleApplyBatchAITags = async (
    updatedCDs: CDMetadata[],
    onProgress?: (completed: number, total: number) => void
  ) => {
    await saveMultipleCDs(updatedCDs, onProgress);
    await loadLocalLibrary();
    showToast(`${updatedCDs.length} 件のCDデータを正常に保存・更新しました`);
  };

  // Merge single duplicate CD group
  const handleMergeGroup = async (primaryCD: CDMetadata, duplicateIdsToDelete: string[]) => {
    await saveCD(primaryCD);
    if (duplicateIdsToDelete.length > 0) {
      await deleteMultipleCDs(duplicateIdsToDelete);
    }
    await loadLocalLibrary();
    await loadTrash();
    showToast(`「${primaryCD.title}」の重複レコードを統合・名寄せしました（統合された側はゴミ箱に移動）`);
  };

  // Merge all duplicate CD groups
  const handleMergeAllGroups = async (mergeActions: { primaryCD: CDMetadata; duplicateIdsToDelete: string[] }[]) => {
    const allPrimaryCDs = mergeActions.map((a) => a.primaryCD);
    const allDeleteIds = mergeActions.flatMap((a) => a.duplicateIdsToDelete);

    await saveMultipleCDs(allPrimaryCDs);
    if (allDeleteIds.length > 0) {
      await deleteMultipleCDs(allDeleteIds);
    }
    await loadLocalLibrary();
    await loadTrash();
    showToast(`${mergeActions.length} グループの重複CDを一括統合・クリーンアップしました（統合された側はゴミ箱に移動）`);
  };

  // handleOpenImportModal removed; use handleOpenDataExchange instead


  // JSON / Excel / CSV から読み込んだCDをライブラリへ反映（既存と一致するものは統合）
  const handleImportCDs = async (importedCDs: CDMetadata[]) => {
    const existingMapById = new Map<string, CDMetadata>();
    const existingMapByCat = new Map<string, CDMetadata>();
    const existingMapByTitleArtist = new Map<string, CDMetadata>();
    savedCDs.forEach((c) => {
      if (c.id) existingMapById.set(c.id, c);
      if (c.catalogNumber) existingMapByCat.set(c.catalogNumber.trim().toUpperCase(), c);
      if (c.title && c.artist) {
        existingMapByTitleArtist.set(`${c.title.trim()}_${c.artist.trim()}`.toLowerCase(), c);
      }
    });

    const toSaveMap = new Map<string, CDMetadata>();
    importedCDs.forEach((imported) => {
      let existingMatch: CDMetadata | undefined;
      if (imported.id && existingMapById.has(imported.id)) {
        existingMatch = existingMapById.get(imported.id);
      }
      if (!existingMatch && imported.catalogNumber) {
        existingMatch = existingMapByCat.get(imported.catalogNumber.trim().toUpperCase());
      }
      if (!existingMatch && imported.title && imported.artist) {
        existingMatch = existingMapByTitleArtist.get(`${imported.title.trim()}_${imported.artist.trim()}`.toLowerCase());
      }

      if (existingMatch) {
        const mergedSubImages = (() => {
          const incoming = Array.isArray(imported.subImages) ? imported.subImages : [];
          const existing = Array.isArray(existingMatch.subImages) ? existingMatch.subImages : [];
          if (incoming.length === 0) return existing.length > 0 ? existing : undefined;
          if (existing.length === 0) return incoming;
          const combined = [...incoming];
          const seen = new Set(incoming.map((s) => `${s.type}::${s.imageUrl}`));
          existing.forEach((s) => {
            const key = `${s.type}::${s.imageUrl}`;
            if (!seen.has(key)) {
              seen.add(key);
              combined.push(s);
            }
          });
          return combined;
        })();

        const mergedRecord: CDMetadata = {
          ...existingMatch,
          ...imported,
          id: existingMatch.id,
          tracks: imported.tracks && imported.tracks.length > 0 ? imported.tracks : existingMatch.tracks,
          tags: imported.tags && imported.tags.length > 0 ? imported.tags : existingMatch.tags,
          coverUrl: imported.coverUrl || existingMatch.coverUrl,
          subImages: mergedSubImages,
          label: imported.label || existingMatch.label,
          releaseDate: imported.releaseDate || existingMatch.releaseDate,
          vinylRecordReleaseDate: imported.vinylRecordReleaseDate || existingMatch.vinylRecordReleaseDate,
          vinylRecordFormat: imported.vinylRecordFormat || existingMatch.vinylRecordFormat,
          vinylRecordCatalogNumber: imported.vinylRecordCatalogNumber || existingMatch.vinylRecordCatalogNumber,
          barcode: imported.barcode || existingMatch.barcode,
          notes: imported.notes || existingMatch.notes,
          updatedAt: getJSTISOString(),
        };
        toSaveMap.set(mergedRecord.id, mergedRecord);
        if (mergedRecord.catalogNumber) existingMapByCat.set(mergedRecord.catalogNumber.trim().toUpperCase(), mergedRecord);
        if (mergedRecord.title && mergedRecord.artist) {
          existingMapByTitleArtist.set(`${mergedRecord.title.trim()}_${mergedRecord.artist.trim()}`.toLowerCase(), mergedRecord);
        }
      } else {
        const newRecord: CDMetadata = {
          ...imported,
          updatedAt: imported.updatedAt || getJSTISOString(),
        };
        toSaveMap.set(newRecord.id, newRecord);
        if (newRecord.catalogNumber) existingMapByCat.set(newRecord.catalogNumber.trim().toUpperCase(), newRecord);
        if (newRecord.title && newRecord.artist) {
          existingMapByTitleArtist.set(`${newRecord.title.trim()}_${newRecord.artist.trim()}`.toLowerCase(), newRecord);
        }
      }
    });

    const toSave = Array.from(toSaveMap.values());
    await importCDs(toSave);
    await loadLocalLibrary();
    showToast(`${toSave.length} 件のCDデータをインポート・反映しました`);
  };

  const savedCDIds = savedCDs.map((c) => c.id);

  const configuredApiKeysCount = React.useMemo(() => {
    let count = 0;
    if (isSourceEnabled('spotify') && (apiCredentials.spotifyClientId || apiCredentials.spotifyClientSecret)) count += 1;
    if (apiCredentials.discogsToken) count += 1;
    if (isSourceEnabled('rakuten') && apiCredentials.rakutenAppId) count += 1;
    if (apiCredentials.musicbrainzEmail) count += 1;
    if (apiCredentials.yahooAppId) count += 1;
    return count;
  }, [apiCredentials]);

  // Navigation for CD Detail Modal
  const currentModalIndex = selectedCDForModal && modalCDList.length > 0
    ? modalCDList.findIndex((c) => c.id === selectedCDForModal.id)
    : -1;

  const hasPrevCD = currentModalIndex > 0;
  const hasNextCD = currentModalIndex >= 0 && currentModalIndex < modalCDList.length - 1;

  const handleNavigatePrevCD = () => {
    if (hasPrevCD) {
      setSelectedCDForModal(modalCDList[currentModalIndex - 1]);
    }
  };

  const handleNavigateNextCD = () => {
    if (hasNextCD) {
      setSelectedCDForModal(modalCDList[currentModalIndex + 1]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      
      {/* Top Header Navigation */}
      <Header
        user={user}
        totalCDsCount={savedCDs.length}
        configuredApiKeysCount={configuredApiKeysCount}
        duplicateCount={duplicateGroupsCount}
        onOpenAPISettings={() => setIsAPISettingsOpen(true)}
        onOpenAppInfo={() => setIsAppInfoOpen(true)}
        onOpenAdminMode={() => setIsAdminModeOpen(true)}
        onOpenTagManager={() => setIsTagManagerOpen(true)}
        onLogin={handleLogin}
        onLogout={handleLogout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        isCompactHeader={isCompactHeader}
        onToggleCompactHeader={toggleCompactHeader}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-[1800px] w-full mx-auto px-3 sm:px-6 py-3">
        
        {/* Toast Banner */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 bg-indigo-600 text-white px-4 py-3 rounded-xl shadow-2xl border border-indigo-400 flex items-center gap-3 animate-in slide-in-from-bottom-5 duration-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-300 flex-shrink-0" />
            <span className="text-xs font-bold">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismissToast();
                }}
                className="ml-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30 border border-white/30 cursor-pointer flex-shrink-0"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}

        {/* TAB 1: WEB SEARCH & METADATA AGGREGATION (Item 1 & Item 4: Collapsible Search Panel & Split Preview Mode) */}
        {activeTab === 'search' && (
          <div className="flex flex-col lg:flex-row gap-5 items-start">
            {/* Left Pane: Search Controls & Input Fields (Collapsible) */}
            {isSearchPanelCollapsed ? (
              <div className="w-full lg:w-14 flex-shrink-0 lg:sticky lg:top-[76px]">
                {/* Desktop Slim Collapsed Rail */}
                <div className="hidden lg:flex flex-col items-center py-4 px-2 bg-slate-800/90 border border-slate-700/80 rounded-2xl shadow-xl space-y-4">
                  <button
                    type="button"
                    onClick={() => toggleSearchPanelCollapse(false)}
                    className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/40 transition-all cursor-pointer"
                    title="検索条件パネルを展開する"
                  >
                    <PanelLeftOpen className="w-4 h-4" />
                  </button>
                  <span
                    className="text-[11px] font-bold text-slate-400 tracking-wider cursor-pointer hover:text-white select-none py-2"
                    style={{ writingMode: 'vertical-rl' }}
                    onClick={() => toggleSearchPanelCollapse(false)}
                  >
                    検索条件パネルを展開
                  </span>
                </div>

                {/* Mobile / Tablet Collapsed Banner */}
                <div className="lg:hidden bg-slate-800/90 border border-slate-700/80 rounded-xl p-3 flex items-center justify-between shadow-md mb-2">
                  <span className="text-xs font-bold text-slate-300">検索条件パネルが折りたたまれています</span>
                  <button
                    type="button"
                    onClick={() => toggleSearchPanelCollapse(false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold shadow cursor-pointer"
                  >
                    <PanelLeftOpen className="w-3.5 h-3.5" />
                    <span>検索パネルを開く</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full lg:w-[420px] xl:w-[450px] flex-shrink-0 space-y-4 lg:sticky lg:top-[76px]">
                <SearchPanel
                  onSearch={handlePerformSearch}
                  isLoading={isLoadingSearch}
                  onOpenOCRModal={() => setIsOCRModalOpen(true)}
                  onClear={() => {
                    setSearchResponse(null);
                    setSplitPreviewCD(null);
                  }}
                  onToggleCollapse={() => toggleSearchPanelCollapse(true)}
                  isCollapsed={false}
                />
              </div>
            )}

            {/* Center Pane: Search Results Output */}
            <div className="flex-1 min-w-0 w-full space-y-4">
              <SearchResults
                searchResponse={searchResponse}
                isLoading={isLoadingSearch}
                onSelectCD={(cd, list) => {
                  if (searchPreviewMode === 'inline') {
                    setSplitPreviewCD(cd);
                  } else {
                    setSelectedCDForModal(cd);
                    setModalCDList(list && list.length > 0 ? list : [cd]);
                  }
                }}
                onSaveToDB={handleSaveCDToDB}
                savedCDIds={savedCDIds}
                onClearResults={() => {
                  setSearchResponse(null);
                  setSplitPreviewCD(null);
                }}
                onManualAdd={handleOpenManualAdd}
                previewCDId={splitPreviewCD?.id}
                previewMode={searchPreviewMode}
                onTogglePreviewMode={togglePreviewMode}
              />
            </div>

            {/* Right Pane: Split CD Preview (Item 4) */}
            {searchPreviewMode === 'inline' && splitPreviewCD && (
              <div className="w-full lg:w-[380px] xl:w-[420px] 2xl:w-[450px] flex-shrink-0 lg:sticky lg:top-[76px] space-y-4">
                <CDInlinePreviewCard
                  cd={splitPreviewCD}
                  isSaved={savedCDIds.includes(splitPreviewCD.id)}
                  onSaveToDB={handleSaveCDToDB}
                  onOpenFullDetail={(cd) => {
                    setSelectedCDForModal(cd);
                    setModalCDList(
                      searchResponse?.candidates?.map((c) => c.cd) || [cd]
                    );
                  }}
                  // 右上の✕: 詳細モーダルは開かず、モーダル表示（一覧のみ）に戻す
                  onClose={() => togglePreviewMode('modal')}
                />
              </div>
            )}
          </div>
        )}

        {/* TAB 2: REGISTERED CD LIBRARY DATABASE */}
        {activeTab === 'database' && (
          <CDDatabaseTable
            cds={savedCDs}
            onSelectCD={(cd, list) => {
              setSelectedCDForModal(cd);
              setModalCDList(list && list.length > 0 ? list : savedCDs);
            }}
            onDeleteCD={handleDeleteCD}
            onBatchDeleteCDs={handleBatchDelete}
            onOpenDataExchange={handleOpenDataExchange}
            onOpenBackupSettings={() => setIsBackupSettingsOpen(true)}
            onOpenTrash={() => setIsTrashOpen(true)}
            onGenerateReadings={handleGenerateReadings}
            isGeneratingReadings={isGeneratingReadings}
            trashCount={trashedCDs.length}
            backupEnabled={backupEnabled}
            onOpenManualAdd={handleOpenManualAdd}
            onOpenAITagging={handleOpenAITagging}
            onOpenPDFCatalog={handleOpenPDFCatalog}
            onBatchUpdateCDs={handleApplyBatchAITags}
            onLookupVinylReleaseDates={handleBatchLookupVinylReleaseDates}
            onCopyReadingsFromTitles={handleBatchCopyReadingsFromTitles}
            onConvertToBase64={handleBatchConvertToBase64}
            isConvertingBase64={isConvertingBase64}
            isBatchProcessing={batchProcessingState.isOpen}
            initialSearchKeyword={librarySearchFilter}
          />
        )}

        {/* TAB 3: JACKET GALLERY CARD VIEW */}
        {activeTab === 'gallery' && (
          <JacketGalleryView
            cds={savedCDs}
            onSelectCD={(cd, list) => {
              setSelectedCDForModal(cd);
              setModalCDList(list || savedCDs);
            }}
            onSaveCD={async (cd) => {
              await handleSaveCDToDB(cd);
            }}
            onBatchUpdateCDs={handleApplyBatchAITags}
            onNavigateToSpreadsheet={() => setActiveTab('database')}
            onOpenPDFCatalog={handleOpenPDFCatalog}
            onOpenTagManager={() => setIsTagManagerOpen(true)}
            onShowToast={showToast}
          />
        )}

        {/* TAB 3.5: CROSS-CD TRACK SEARCH & CUSTOM SETLIST BUILDER */}
        {activeTab === 'tracks' && (
          <TrackSearchAndSetlistView
            cds={savedCDs}
            onSelectCD={(cd, list) => {
              setSelectedCDForModal(cd);
              setModalCDList(list || savedCDs);
            }}
            onBatchUpdateCDs={handleApplyBatchAITags}
            onShowToast={showToast}
          />
        )}

        {/* TAB 4: COLLECTION ANALYTICS DASHBOARD */}
        {activeTab === 'dashboard' && (
          <DashboardView
            cds={savedCDs}
            onNavigateToLibrary={(filterKeyword) => {
              setLibrarySearchFilter(filterKeyword || '');
              setActiveTab('database');
            }}
            onOpenAITagging={handleOpenAITagging}
            onApplyBatchCDUpdate={handleApplyBatchAITags}
          />
        )}

        {/* TAB 4: DUPLICATE CHECK & MERGE PROPOSAL */}
        {activeTab === 'duplicates' && (
          <DuplicateCheckView
            cds={savedCDs}
            onMergeGroup={handleMergeGroup}
            onMergeAllGroups={handleMergeAllGroups}
            onNavigateToLibrary={() => setActiveTab('database')}
          />
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 py-3 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© CD メタデータ検索＆データベース - ローカル保存・JSONバックアップ</p>
          <p className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
            <span>APIs: {enabledSourcesLabel(' • ')} • Gemini AI</span>
          </p>
        </div>
      </footer>

      {/* CD Detail & Tracklist Modal */}
      {selectedCDForModal && (
        <CDDetailModal
          cd={selectedCDForModal}
          onClose={() => {
            setSelectedCDForModal(null);
            setModalCDList([]);
          }}
          onSaveCD={async (updatedCD) => {
            const saved = await handleSaveCDToDB(updatedCD);
            setModalCDList((prev) => prev.map((c) => (c.id === saved.id || c.id === updatedCD.id ? saved : c)));
            // 閉じる操作の自動保存が完了した後に、閉じたはずのモーダルが再び開かないようにする
            setSelectedCDForModal((prev) => (prev && prev.id === updatedCD.id ? saved : prev));
          }}
          onOpenPDFCatalog={(singleCD) => {
            handleOpenPDFCatalog([singleCD]);
          }}
          onOpenTagManager={() => setIsTagManagerOpen(true)}
          isSaved={savedCDIds.includes(selectedCDForModal.id)}
          currentIndex={currentModalIndex >= 0 ? currentModalIndex : undefined}
          totalCount={modalCDList.length > 0 ? modalCDList.length : undefined}
          onNavigatePrev={hasPrevCD ? handleNavigatePrevCD : undefined}
          onNavigateNext={hasNextCD ? handleNavigateNextCD : undefined}
        />
      )}

      {/* Printable CD Catalog / Analog Jacket PDF Studio Modal */}
      {isPDFCatalogOpen && (
        <PDFCatalogModal
          allCDs={savedCDs.length > 0 ? savedCDs : pdfCatalogSelectedCDs}
          initialSelectedCDs={pdfCatalogSelectedCDs}
          onClose={() => setIsPDFCatalogOpen(false)}
        />
      )}

      {/* ゴミ箱（削除の取り消し） */}
      {isTrashOpen && (
        <TrashModal
          trashedCDs={trashedCDs}
          onClose={() => setIsTrashOpen(false)}
          onRestore={handleRestoreFromTrash}
          onPurge={handlePurgeFromTrash}
        />
      )}

      {/* JSON自動バックアップの設定・復元 */}
      {isBackupSettingsOpen && (
        <BackupSettingsModal
          cds={savedCDs}
          onClose={() => {
            setIsBackupSettingsOpen(false);
            try {
              setBackupEnabled(getBackupSettings().enabled);
            } catch {
              // localStorage が使えない環境
            }
          }}
          onRestoreCDs={handleImportCDs}
        />
      )}

      {/* データの書き出し・読み込み（JSON / Excel / CSV） */}
      {isDataExchangeOpen && (
        <DataExchangeModal
          itemsToExport={itemsToExport}
          allCDs={savedCDs}
          initialMode={dataExchangeMode}
          onClose={() => setIsDataExchangeOpen(false)}
          onImportCDs={handleImportCDs}
        />
      )}

      {/* AI CD Spine OCR Modal */}
      {isOCRModalOpen && (
        <CDSpineScanner
          onClose={() => setIsOCRModalOpen(false)}
          onOCRSuccess={(ocrQuery) => {
            setActiveTab('search');
            handlePerformSearch(ocrQuery);
          }}
        />
      )}

      {/* API Key Registration Settings Modal */}
      {isAPISettingsOpen && (
        <APISettingsModal
          credentials={apiCredentials}
          onSaveCredentials={handleSaveApiCredentials}
          onClose={() => setIsAPISettingsOpen(false)}
          serverConfig={serverConfig}
          onClearStoredKeys={handleClearStoredApiKeys}
        />
      )}

      {/* Gemini AI Auto-Tagging Modal */}
      {isAITaggingOpen && (
        <AITaggingModal
          allCDs={savedCDs}
          selectedCDs={aiTaggingSelectedCDs}
          onClose={() => setIsAITaggingOpen(false)}
          onApplyBatchTags={handleApplyBatchAITags}
          onBatchProcessingStateChange={setBatchProcessingState}
        />
      )}

      {/* App Info Modal */}
      {isAppInfoOpen && (
        <AppInfoModal
          onClose={() => setIsAppInfoOpen(false)}
        />
      )}

      {/* Admin Mode Modal (Triggered by 3 left-clicks on "CD メタデータ DB") */}
      <AdminModeModal
        isOpen={isAdminModeOpen}
        onClose={() => setIsAdminModeOpen(false)}
        onOpenAppInfo={() => setIsAppInfoOpen(true)}
      />

      {/* Tag Name Add / Rename / Manager Modal */}
      <TagManagerModal
        isOpen={isTagManagerOpen}
        onClose={() => setIsTagManagerOpen(false)}
        allCDs={savedCDs}
        onBatchUpdateCDs={async (updatedCDs) => {
          await handleApplyBatchAITags(updatedCDs);
          if (selectedCDForModal) {
            const match = updatedCDs.find((c) => c.id === selectedCDForModal.id);
            if (match) {
              setSelectedCDForModal(match);
            }
          }
        }}
      />

      {/* 画面全体ブロック型 一括処理・AI処理プログレスモーダル */}
      <BatchProcessingModal state={batchProcessingState} />

    </div>
  );
}
