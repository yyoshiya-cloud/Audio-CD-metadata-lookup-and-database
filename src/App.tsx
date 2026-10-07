import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, getAccessToken } from './lib/firebase';
import { getAllCDs, saveCD, saveMultipleCDs, deleteCD, deleteMultipleCDs, markCDsAsSynced, importCDs, loadApiCredentialsDB, saveApiCredentialsDB, initPersistentStorage } from './lib/db';
import { CDMetadata, SearchQuery, SearchResponse, APICredentials } from './types/cd';
import { getJSTISOString } from './lib/dateUtils';
import { Header } from './components/Header';
import { SearchPanel } from './components/SearchPanel';
import { SearchResults } from './components/SearchResults';
import { CDDetailModal } from './components/CDDetailModal';
import { CDDatabaseTable } from './components/CDDatabaseTable';
import { GoogleSheetsModal } from './components/GoogleSheetsModal';
import { CDSpineScanner } from './components/CDSpineScanner';
import { BatchImportModal } from './components/BatchImportModal';
import { APISettingsModal } from './components/APISettingsModal';
import { AITaggingModal } from './components/AITaggingModal';
import { AppInfoModal } from './components/AppInfoModal';
import { DashboardView } from './components/DashboardView';
import { DuplicateCheckView } from './components/DuplicateCheckView';
import { JacketGalleryView } from './components/JacketGalleryView';
import { CheckCircle2 } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

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
  const [activeTab, setActiveTab] = useState<'search' | 'database' | 'gallery' | 'dashboard' | 'duplicates'>('search');
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
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState(false);
  const [sheetsModalMode, setSheetsModalMode] = useState<'export' | 'import'>('export');
  const [itemsToExport, setItemsToExport] = useState<CDMetadata[]>([]);
  const [isOCRModalOpen, setIsOCRModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isAPISettingsOpen, setIsAPISettingsOpen] = useState(false);
  const [isAITaggingOpen, setIsAITaggingOpen] = useState(false);
  const [isAppInfoOpen, setIsAppInfoOpen] = useState(false);
  const [aiTaggingSelectedCDs, setAiTaggingSelectedCDs] = useState<CDMetadata[]>([]);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load Auth state (strictly for Google Sheets OAuth) and Dexie IndexedDB on mount
  useEffect(() => {
    (async () => {
      await initPersistentStorage();
      await loadLocalLibrary();
      const creds = await loadApiCredentialsDB();
      setApiCredentials(creds);

      initAuth(
        async (u, token) => {
          setUser(u);
          const tok = token || (await getAccessToken());
          setAccessToken(tok);
        },
        async () => {
          setUser(null);
          setAccessToken(null);
        }
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

  const handleLogin = async () => {
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setAccessToken(res.accessToken);
        showToast('Googleアカウントでログインしました（Googleスプレッドシート連携が利用可能です）');
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
    setAccessToken(null);
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
  const handleSaveCDToDB = async (cd: CDMetadata) => {
    await saveCD(cd);
    await loadLocalLibrary();
    showToast(`「${cd.title}」をライブラリに保存しました`);
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

  // Open Sheets Modal for export
  const handleOpenSheetsModalForItems = (items: CDMetadata[]) => {
    setSheetsModalMode('export');
    setItemsToExport(items);
    setIsSheetsModalOpen(true);
  };

  // Open AI Tagging Modal
  const handleOpenAITagging = (selected: CDMetadata[]) => {
    setAiTaggingSelectedCDs(selected);
    setIsAITaggingOpen(true);
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

  // Open Sheets Modal for import
  const handleOpenImportSheetsModal = () => {
    setSheetsModalMode('import');
    setItemsToExport([]);
    setIsSheetsModalOpen(true);
  };

  // Import CDs from Sheets / Excel / CSV / JSON into library
  const handleImportCDsFromSheets = async (importedCDs: CDMetadata[]) => {
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
        const mergedRecord: CDMetadata = {
          ...existingMatch,
          ...imported,
          id: existingMatch.id,
          tracks: imported.tracks && imported.tracks.length > 0 ? imported.tracks : existingMatch.tracks,
          tags: imported.tags && imported.tags.length > 0 ? imported.tags : existingMatch.tags,
          coverUrl: imported.coverUrl || existingMatch.coverUrl,
          label: imported.label || existingMatch.label,
          releaseDate: imported.releaseDate || existingMatch.releaseDate,
          barcode: imported.barcode || existingMatch.barcode,
          notes: imported.notes || existingMatch.notes,
          syncedToSheets: true,
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
          syncedToSheets: true,
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

  // Mark items as synced
  const handleMarkSynced = async (ids: string[]) => {
    await markCDsAsSynced(ids);
    await loadLocalLibrary();
    showToast('スプレッドシート連携ステータスを更新しました');
  };

  const savedCDIds = savedCDs.map((c) => c.id);

  const configuredApiKeysCount = React.useMemo(() => {
    let count = 0;
    if (apiCredentials.spotifyClientId || apiCredentials.spotifyClientSecret) count += 1;
    if (apiCredentials.discogsToken) count += 1;
    if (apiCredentials.rakutenAppId) count += 1;
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
        onLogin={handleLogin}
        onLogout={handleLogout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-[1800px] w-full mx-auto px-3 sm:px-6 py-6">
        
        {/* Toast Banner */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 bg-indigo-600 text-white px-4 py-3 rounded-xl shadow-2xl border border-indigo-400 flex items-center gap-2 animate-in slide-in-from-bottom-5 duration-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-300" />
            <span className="text-xs font-bold">{toastMessage}</span>
          </div>
        )}

        {/* TAB 1: WEB SEARCH & METADATA AGGREGATION (2-Column Layout: Left Search Pane, Right Results Pane) */}
        {activeTab === 'search' && (
          <div className="grid grid-cols-1 lg:grid-cols-[430px_1fr] xl:grid-cols-[450px_1fr] gap-6 items-start">
            {/* Left Pane: Search Controls & Input Fields */}
            <div className="space-y-4 lg:sticky lg:top-[56px]">
              <SearchPanel
                onSearch={handlePerformSearch}
                isLoading={isLoadingSearch}
                onOpenOCRModal={() => setIsOCRModalOpen(true)}
                onClear={() => setSearchResponse(null)}
              />
            </div>

            {/* Right Pane: Search Results Output */}
            <div className="min-w-0">
              <SearchResults
                searchResponse={searchResponse}
                isLoading={isLoadingSearch}
                onSelectCD={(cd, list) => {
                  setSelectedCDForModal(cd);
                  setModalCDList(list && list.length > 0 ? list : [cd]);
                }}
                onSaveToDB={handleSaveCDToDB}
                savedCDIds={savedCDIds}
                onClearResults={() => setSearchResponse(null)}
                onManualAdd={handleOpenManualAdd}
              />
            </div>
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
            onOpenExportSheetsModal={handleOpenSheetsModalForItems}
            onOpenImportSheetsModal={handleOpenImportSheetsModal}
            onOpenManualAdd={handleOpenManualAdd}
            onOpenBatchModal={() => setIsBatchModalOpen(true)}
            onOpenAITagging={handleOpenAITagging}
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
            onSaveCD={handleSaveCDToDB}
            onBatchUpdateCDs={handleApplyBatchAITags}
            onNavigateToSpreadsheet={() => setActiveTab('database')}
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
      <footer className="border-t border-slate-800 bg-slate-950 py-6 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© CD メタデータ検索＆データベース - Googleスプレッドシート連携システム</p>
          <p className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
            <span>APIs: MusicBrainz • Discogs • iTunes • NDL • Spotify • 楽天ブックス • Gemini AI</span>
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
            await handleSaveCDToDB(updatedCD);
            setModalCDList((prev) => prev.map((c) => (c.id === updatedCD.id ? updatedCD : c)));
            setSelectedCDForModal(updatedCD);
          }}
          isSaved={savedCDIds.includes(selectedCDForModal.id)}
          currentIndex={currentModalIndex >= 0 ? currentModalIndex : undefined}
          totalCount={modalCDList.length > 0 ? modalCDList.length : undefined}
          onNavigatePrev={hasPrevCD ? handleNavigatePrevCD : undefined}
          onNavigateNext={hasNextCD ? handleNavigateNextCD : undefined}
        />
      )}

      {/* Google Sheets Export / Import Modal */}
      {isSheetsModalOpen && (
        <GoogleSheetsModal
          user={user}
          accessToken={accessToken}
          itemsToExport={itemsToExport}
          initialMode={sheetsModalMode}
          onClose={() => setIsSheetsModalOpen(false)}
          onLogin={handleLogin}
          onMarkSynced={handleMarkSynced}
          onImportCDs={handleImportCDsFromSheets}
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
          onClose={() => setIsAppInfoOpen(false)}
        />
      )}

    </div>
  );
}
