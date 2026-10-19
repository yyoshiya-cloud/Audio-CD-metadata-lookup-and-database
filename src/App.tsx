import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout } from './lib/firebase';
import { getAllCDs, saveCD, saveMultipleCDs, deleteCD, deleteMultipleCDs, importCDs, loadApiCredentialsDB, saveApiCredentialsDB, initPersistentStorage, loadAppInfoConfigDB, saveAppInfoConfigDB, DEFAULT_APP_INFO_CONFIG, AppInfoConfig } from './lib/db';
import { CDMetadata, SearchQuery, SearchResponse, APICredentials } from './types/cd';
import { getJSTISOString } from './lib/dateUtils';
import { Header } from './components/Header';
import { SearchPanel } from './components/SearchPanel';
import { SearchResults } from './components/SearchResults';
import { resolvePreviewToggle } from './utils/searchPreviewMode';
import { enabledSourcesLabel, isSourceEnabled } from './config/sources';
import { CDDetailModal } from './components/CDDetailModal';
import { CDDatabaseTable } from './components/CDDatabaseTable';
import { DataExchangeModal } from './components/DataExchangeModal';
import { BackupSettingsModal } from './components/BackupSettingsModal';
import { useAutoBackup } from './hooks/useAutoBackup';
import { getBackupSettings } from './lib/autoBackup';
import { CDSpineScanner } from './components/CDSpineScanner';
import { BatchImportModal } from './components/BatchImportModal';
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);

  // API Keys state
  const [apiCredentials, setApiCredentials] = useState<APICredentials>(() => {
    try {
      const saved = localStorage.getItem('cd_api_credentials');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

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

  // 1. Search Panel Collapsed State (Item 1)
  const [isSearchPanelCollapsed, setIsSearchPanelCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cd_search_panel_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleSearchPanelCollapse = (collapsed?: boolean) => {
    setIsSearchPanelCollapsed((prev) => {
      const next = typeof collapsed === 'boolean' ? collapsed : !prev;
      try {
        localStorage.setItem('cd_search_panel_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // 4. Split Preview Mode & Current Preview CD (Item 4)
  // 検索結果の詳細表示方式。検索を始めるたびに 'modal' から始める（保存はしない）
  const [searchPreviewMode, setSearchPreviewMode] = useState<'inline' | 'modal'>('modal');

  // 直近にフォーカスした（モーダルまたはスプリットで表示した）アルバムのID
  const lastViewedCDIdRef = useRef<string | null>(null);

  /**
   * 詳細表示方式の切替（モーダル表示 ⇄ スプリット表示）。
   * ここでは CD メタデータ詳細モーダルを開閉しない。詳細モーダルは、結果のクリックや
   * プレビューの「詳細を開く」など明示的な操作でのみ開く。
   * - 'modal'  : 右のプレビューを閉じて一覧のみのモーダル表示に戻す
   * - 'inline' : フォーカス中のアルバム（開いているモーダル > プレビュー中 > 直近 > 先頭）を右に表示
   */
  const handleToggleSearchPreviewMode = (mode: 'inline' | 'modal') => {
    const candidates = searchResponse?.candidates?.map((c) => c.cd) || [];
    const result = resolvePreviewToggle(mode, {
      candidateIds: candidates.map((c) => c.id),
      modalId: selectedCDForModal?.id,
      splitId: splitPreviewCD?.id,
      lastViewedId: lastViewedCDIdRef.current,
    });
    setSearchPreviewMode(result.mode);
    setSplitPreviewCD(candidates.find((c) => c.id === result.splitPreviewId) || null);
  };

  const [splitPreviewCD, setSplitPreviewCD] = useState<CDMetadata | null>(null);

  // Modal States
  const [selectedCDForModal, setSelectedCDForModal] = useState<CDMetadata | null>(null);
  const [modalCDList, setModalCDList] = useState<CDMetadata[]>([]);
  useEffect(() => {
    if (selectedCDForModal) lastViewedCDIdRef.current = selectedCDForModal.id;
  }, [selectedCDForModal]);
  useEffect(() => {
    if (splitPreviewCD) lastViewedCDIdRef.current = splitPreviewCD.id;
  }, [splitPreviewCD]);
  const [isBackupSettingsOpen, setIsBackupSettingsOpen] = useState(false);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [isLibraryLoaded, setIsLibraryLoaded] = useState(false);
  const [isDataExchangeOpen, setIsDataExchangeOpen] = useState(false);
  const [dataExchangeMode, setDataExchangeMode] = useState<'export' | 'import'>('export');
  const [itemsToExport, setItemsToExport] = useState<CDMetadata[]>([]);
  const [isOCRModalOpen, setIsOCRModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isAPISettingsOpen, setIsAPISettingsOpen] = useState(false);
  const [isAITaggingOpen, setIsAITaggingOpen] = useState(false);
  const [isAppInfoOpen, setIsAppInfoOpen] = useState(false);
  const [aiTaggingSelectedCDs, setAiTaggingSelectedCDs] = useState<CDMetadata[]>([]);
  const [isPDFCatalogOpen, setIsPDFCatalogOpen] = useState(false);
  const [pdfCatalogSelectedCDs, setPdfCatalogSelectedCDs] = useState<CDMetadata[]>([]);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isAdminModeOpen, setIsAdminModeOpen] = useState(false);
  const [appInfoConfig, setAppInfoConfig] = useState<AppInfoConfig>(DEFAULT_APP_INFO_CONFIG);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Theme & Compact Header States
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('cd_app_theme');
      return stored !== 'light';
    } catch {
      return true;
    }
  });

  const [isCompactHeader, setIsCompactHeader] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cd_header_compact') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      if (!isDarkMode) {
        document.documentElement.classList.add('light-theme');
        localStorage.setItem('cd_app_theme', 'light');
      } else {
        document.documentElement.classList.remove('light-theme');
        localStorage.setItem('cd_app_theme', 'dark');
      }
    } catch {}
  }, [isDarkMode]);

  useEffect(() => {
    try {
      if (isCompactHeader) {
        document.documentElement.classList.add('compact-header');
        localStorage.setItem('cd_header_compact', 'true');
      } else {
        document.documentElement.classList.remove('compact-header');
        localStorage.setItem('cd_header_compact', 'false');
      }
    } catch {}
  }, [isCompactHeader]);

  const handleToggleTheme = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      setToastMessage(next ? '🌙 ダークモードに切り替えました' : '🌤️ おとなしいライトモード（低刺激・ソフトトーン）に切り替えました');
      setTimeout(() => setToastMessage(null), 2500);
      return next;
    });
  };

  const handleToggleCompactHeader = () => {
    setIsCompactHeader((prev) => {
      const next = !prev;
      setToastMessage(next ? 'ヘッダーをコンパクト表示にしました' : 'ヘッダーを標準サイズに戻しました');
      setTimeout(() => setToastMessage(null), 2500);
      return next;
    });
  };

  // Load Auth state and Dexie IndexedDB on mount
  useEffect(() => {
    (async () => {
      await initPersistentStorage();
      await loadLocalLibrary();
      setIsLibraryLoaded(true);
      try {
        setBackupEnabled(getBackupSettings().enabled);
      } catch {
        // localStorage が使えない環境
      }
      const creds = await loadApiCredentialsDB();
      setApiCredentials(creds);
      const loadedAppInfo = await loadAppInfoConfigDB();
      setAppInfoConfig(loadedAppInfo);

      initAuth(
        (u) => setUser(u),
        () => setUser(null)
      );
    })();
  }, []);

  const loadLocalLibrary = async () => {
    try {
      const cds = await getAllCDs();
      setSavedCDs(cds);
    } catch (err) {
      console.error('Failed to load local DB:', err);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
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
      console.error('Login error:', err);
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
    await saveApiCredentialsDB(updated);
    showToast('API設定をローカルデータベース（IndexedDB）に保存しました');
  };

  // Perform multi-source aggregated search
  const handlePerformSearch = async (query: SearchQuery, retryCount = 0) => {
    setIsLoadingSearch(true);
    setSearchResponse(null);
    if (retryCount === 0) {
      // 検索の最初は常にモーダル表示（スプリットのプレビューも閉じる）
      setSearchPreviewMode('modal');
      setSplitPreviewCD(null);
      lastViewedCDIdRef.current = null;
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
      console.error('Search failure:', err);
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

  // Save multiple CDs from batch process
  const handleBatchCDsComplete = async (cds: CDMetadata[]) => {
    await importCDs(cds);
    await loadLocalLibrary();
    showToast(`${cds.length} 件のCDをライブラリに保存・同期しました`);
  };

  // Delete CD from DB
  const handleDeleteCD = async (id: string) => {
    await deleteCD(id);
    await loadLocalLibrary();
    showToast('CDを削除しました');
  };

  // Batch Delete
  const handleBatchDelete = async (ids: string[]) => {
    await deleteMultipleCDs(ids);
    await loadLocalLibrary();
    showToast(`${ids.length} 件のCDを削除しました`);
  };

  // 書き出し（JSON / Excel / CSV）モーダルを開く
  const handleOpenExportModalForItems = (items: CDMetadata[]) => {
    setDataExchangeMode('export');
    setItemsToExport(items);
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
    showToast(`「${primaryCD.title}」の重複レコードを統合・名寄せしました`);
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
    showToast(`${mergeActions.length} グループの重複CDを一括統合・クリーンアップしました`);
  };

  // 読み込み（バックアップからの復元など）モーダルを開く
  const handleOpenImportModal = () => {
    setDataExchangeMode('import');
    setItemsToExport([]);
    setIsDataExchangeOpen(true);
  };

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
        onToggleTheme={handleToggleTheme}
        isCompactHeader={isCompactHeader}
        onToggleCompactHeader={handleToggleCompactHeader}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-[1800px] w-full mx-auto px-3 sm:px-6 py-3">
        
        {/* Toast Banner */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 bg-indigo-600 text-white px-4 py-3 rounded-xl shadow-2xl border border-indigo-400 flex items-center gap-2 animate-in slide-in-from-bottom-5 duration-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-300" />
            <span className="text-xs font-bold">{toastMessage}</span>
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
                    onClick={() => handleToggleSearchPanelCollapse(false)}
                    className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/40 transition-all cursor-pointer"
                    title="検索条件パネルを展開する"
                  >
                    <PanelLeftOpen className="w-4 h-4" />
                  </button>
                  <span
                    className="text-[11px] font-bold text-slate-400 tracking-wider cursor-pointer hover:text-white select-none py-2"
                    style={{ writingMode: 'vertical-rl' }}
                    onClick={() => handleToggleSearchPanelCollapse(false)}
                  >
                    検索条件パネルを展開
                  </span>
                </div>

                {/* Mobile / Tablet Collapsed Banner */}
                <div className="lg:hidden bg-slate-800/90 border border-slate-700/80 rounded-xl p-3 flex items-center justify-between shadow-md mb-2">
                  <span className="text-xs font-bold text-slate-300">検索条件パネルが折りたたまれています</span>
                  <button
                    type="button"
                    onClick={() => handleToggleSearchPanelCollapse(false)}
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
                  onToggleCollapse={() => handleToggleSearchPanelCollapse(true)}
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
                onTogglePreviewMode={handleToggleSearchPreviewMode}
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
                  onClose={() => handleToggleSearchPreviewMode('modal')}
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
            onOpenExportModal={handleOpenExportModalForItems}
            onOpenImportModal={handleOpenImportModal}
            onOpenBackupSettings={() => setIsBackupSettingsOpen(true)}
            backupEnabled={backupEnabled}
            onOpenManualAdd={handleOpenManualAdd}
            onOpenBatchModal={() => setIsBatchModalOpen(true)}
            onOpenAITagging={handleOpenAITagging}
            onOpenPDFCatalog={handleOpenPDFCatalog}
            onBatchUpdateCDs={handleApplyBatchAITags}
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

      {/* Batch Import Modal */}
      {isBatchModalOpen && (
        <BatchImportModal
          onClose={() => setIsBatchModalOpen(false)}
          onBatchFetchComplete={handleBatchCDsComplete}
        />
      )}

      {/* API Key Registration Settings Modal */}
      {isAPISettingsOpen && (
        <APISettingsModal
          credentials={apiCredentials}
          onSaveCredentials={handleSaveApiCredentials}
          onClose={() => setIsAPISettingsOpen(false)}
        />
      )}

      {/* Gemini AI Auto-Tagging Modal */}
      {isAITaggingOpen && (
        <AITaggingModal
          allCDs={savedCDs}
          selectedCDs={aiTaggingSelectedCDs}
          onClose={() => setIsAITaggingOpen(false)}
          onApplyBatchTags={handleApplyBatchAITags}
        />
      )}

      {/* App Info Modal */}
      {isAppInfoOpen && (
        <AppInfoModal
          appInfoConfig={appInfoConfig}
          onClose={() => setIsAppInfoOpen(false)}
        />
      )}

      {/* Admin Mode Modal (Triggered by 3 left-clicks on "CD メタデータ DB") */}
      <AdminModeModal
        isOpen={isAdminModeOpen}
        config={appInfoConfig}
        onSaveConfig={async (newCfg) => {
          const saved = await saveAppInfoConfigDB(newCfg);
          setAppInfoConfig(saved);
          showToast(`アプリ情報を更新しました (Version ${saved.version} / 最終更新日: ${saved.lastUpdated})`);
        }}
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

    </div>
  );
}
