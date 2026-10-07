import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CDMetadata, ExportColumnConfig, SpreadsheetInfo } from '../types/cd';
import { 
  DEFAULT_COLUMN_CONFIG, 
  ALBUM_SHEET_NAME,
  TRACKLIST_SHEET_NAME,
  createNewSpreadsheet, 
  exportCDsToSpreadsheet,
  listUserSpreadsheets,
  readSpreadsheetValues,
  parseSpreadsheetRowsToCDs,
  extractSpreadsheetId,
  getKnownSpreadsheets,
  saveKnownSpreadsheet,
  getPrimarySpreadsheet,
  savePrimarySpreadsheet,
  deleteSpreadsheetFromDrive
} from '../lib/googleSheets';
import { exportCDsToExcel, parseExcelFileToCDs } from '../lib/excelExportImport';
import { exportCDsToJSON, parseJSONToCDs } from '../lib/jsonExportImport';
import { 
  exportCDAlbumsCSV, 
  exportCDTracksCSV, 
  exportBothCSVs, 
  exportCDCombinedDetailedCSV, 
  parseMultipleCSVFilesToCDs 
} from '../lib/csvExportImport';
import { formatJSTShort, formatJSTTimestampCompact } from '../lib/dateUtils';
import { 
  X, 
  FileSpreadsheet, 
  Plus, 
  Check, 
  RefreshCw, 
  LogIn, 
  AlertCircle, 
  Download, 
  Upload, 
  ExternalLink, 
  Disc, 
  CheckCircle2,
  Trash2,
  AlertTriangle,
  Clock,
  Layers,
  FileCode,
  FileUp,
  FileDown,
  Sparkles,
  Database,
  Files,
  FolderDown,
  Music,
  Code,
  Copy,
  FileJson
} from 'lucide-react';
import { User } from 'firebase/auth';

interface GoogleSheetsModalProps {
  user: User | null;
  accessToken: string | null;
  itemsToExport: CDMetadata[];
  allCDs?: CDMetadata[];
  initialMode?: 'export' | 'import';
  onClose: () => void;
  onLogin: () => Promise<{ user: User; accessToken: string } | null>;
  onMarkSynced: (ids: string[]) => void;
  onImportCDs?: (importedCDs: CDMetadata[]) => Promise<void>;
}

export const GoogleSheetsModal: React.FC<GoogleSheetsModalProps> = ({
  user,
  accessToken,
  itemsToExport: initialItemsToExport,
  allCDs,
  initialMode = 'export',
  onClose,
  onLogin,
  onMarkSynced,
  onImportCDs,
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>(initialMode);
  const [exportTargetType, setExportTargetType] = useState<'sheets' | 'excel' | 'csv' | 'json'>('sheets');
  const [importSourceType, setImportSourceType] = useState<'sheets' | 'excel' | 'csv' | 'json'>('sheets');
  const [exportScope, setExportScope] = useState<'all' | 'subset'>(() =>
    allCDs && initialItemsToExport.length > 0 && initialItemsToExport.length < allCDs.length ? 'subset' : 'all'
  );

  const itemsToExport = useMemo(() => {
    if (exportScope === 'all' && allCDs && allCDs.length > 0) {
      return allCDs;
    }
    return initialItemsToExport.length > 0 ? initialItemsToExport : (allCDs || []);
  }, [exportScope, allCDs, initialItemsToExport]);

  // JSON Export & Import State
  const [jsonFileName, setJsonFileName] = useState(() => `CDコレクション_backup_${formatJSTTimestampCompact()}`);
  const [jsonPrettyPrint, setJsonPrettyPrint] = useState(true);
  const [jsonExportSuccess, setJsonExportSuccess] = useState(false);
  const [jsonCopySuccess, setJsonCopySuccess] = useState(false);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const [jsonTextInput, setJsonTextInput] = useState('');
  const [jsonImportFile, setJsonImportFile] = useState<File | null>(null);
  const [isParsingJSON, setIsParsingJSON] = useState(false);
  const [jsonParsedInfo, setJsonParsedInfo] = useState<{
    cds: CDMetadata[];
    totalAlbums: number;
    totalTracks: number;
    exportedAt?: string;
  } | null>(null);

  // CSV Export & Import State
  const [csvExportOption, setCsvExportOption] = useState<'both' | 'albums' | 'tracks' | 'combined'>('both');
  const [csvExportSuccess, setCsvExportSuccess] = useState(false);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const csvAlbumSlotRef = useRef<HTMLInputElement>(null);
  const csvTrackSlotRef = useRef<HTMLInputElement>(null);
  const [csvAlbumFile, setCsvAlbumFile] = useState<File | null>(null);
  const [csvTrackFile, setCsvTrackFile] = useState<File | null>(null);
  const [isParsingCSV, setIsParsingCSV] = useState(false);
  const [csvParsedInfo, setCsvParsedInfo] = useState<{
    cds: CDMetadata[];
    totalAlbums: number;
    totalTracks: number;
    fileNames: string[];
  } | null>(null);

  // Excel Export State
  const [excelFileName, setExcelFileName] = useState(`CDコレクション_${new Date().toISOString().slice(0, 10)}`);
  const [excelExportResult, setExcelExportResult] = useState<{ fileName: string; count: number; totalTracks: number } | null>(null);

  // Excel Import State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [excelImportFile, setExcelImportFile] = useState<File | null>(null);
  const [excelParsedInfo, setExcelParsedInfo] = useState<{
    cds: CDMetadata[];
    sheetNames: string[];
    totalAlbums: number;
    totalTracks: number;
    fileName: string;
  } | null>(null);

  // Primary linked spreadsheet state (1回目に作成したシート)
  const [primarySpreadsheet, setPrimarySpreadsheet] = useState<SpreadsheetInfo | null>(() => getPrimarySpreadsheet());

  // Google Sheets Export State
  const [exportDestinationMode, setExportDestinationMode] = useState<'update' | 'append' | 'new' | 'existing'>(() => {
    const primary = getPrimarySpreadsheet();
    return primary ? 'update' : 'new';
  });
  const [newSheetTitle, setNewSheetTitle] = useState(`CDカタログ_${new Date().toISOString().slice(0, 10)}`);
  const [selectedExportSheetId, setSelectedExportSheetId] = useState<string>('');
  const [customExportSheetUrl, setCustomExportSheetUrl] = useState<string>('');
  const [customExportSheetName, setCustomExportSheetName] = useState<string>(ALBUM_SHEET_NAME);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ url: string; count: number; totalTracksAdded?: number } | null>(null);

  // Google Sheets Import State
  const [userSheetsList, setUserSheetsList] = useState<SpreadsheetInfo[]>(() => getKnownSpreadsheets());
  const [isLoadingSheetsList, setIsLoadingSheetsList] = useState(false);
  const [collapseDuplicates, setCollapseDuplicates] = useState(true);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [customSheetUrl, setCustomSheetUrl] = useState<string>('');
  const [customSheetName, setCustomSheetName] = useState<string>('');
  const [isReadingSheet, setIsReadingSheet] = useState(false);
  const [parsedImportCDs, setParsedImportCDs] = useState<CDMetadata[] | null>(null);
  const [importSourceTitle, setImportSourceTitle] = useState<string>('');
  const [isSyncingToLibrary, setIsSyncingToLibrary] = useState(false);
  const [importResult, setImportResult] = useState<{ count: number; title: string } | null>(null);

  // Duplicate files cleanup state
  const [showConfirmCleanModal, setShowConfirmCleanModal] = useState(false);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
  const [cleanSuccessMessage, setCleanSuccessMessage] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load user spreadsheets on mount or when token becomes available
  useEffect(() => {
    const local = getKnownSpreadsheets();
    if (local.length > 0) {
      setUserSheetsList(local);
      if (!selectedSheetId) setSelectedSheetId(local[0].spreadsheetId);
      if (!selectedExportSheetId) setSelectedExportSheetId(local[0].spreadsheetId);
    }

    if (accessToken && user) {
      loadDriveSpreadsheets(accessToken);
    }
  }, [accessToken, user]);

  const loadDriveSpreadsheets = async (token: string) => {
    setIsLoadingSheetsList(true);
    try {
      const sheets = await listUserSpreadsheets(token);
      setUserSheetsList(sheets);
      if (sheets.length > 0) {
        if (!selectedSheetId) setSelectedSheetId(sheets[0].spreadsheetId);
        if (!selectedExportSheetId) setSelectedExportSheetId(sheets[0].spreadsheetId);
      }
    } catch (e) {
      console.warn('Could not list spreadsheets from Drive:', e);
    } finally {
      setIsLoadingSheetsList(false);
    }
  };

  // Group sheets by title to detect and collapse duplicates
  const groupedByTitle = useMemo(() => {
    const map = new Map<string, SpreadsheetInfo[]>();
    userSheetsList.forEach((s) => {
      const key = (s.title || '無題のスプレッドシート').trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [userSheetsList]);

  // Count older duplicate files that can be cleaned up
  const duplicateOlderFilesCount = useMemo(() => {
    let count = 0;
    groupedByTitle.forEach((items) => {
      if (items.length > 1) {
        count += items.length - 1;
      }
    });
    return count;
  }, [groupedByTitle]);

  // Collapsed list with 1 entry per title (keeping the latest)
  const collapsedSheetsList = useMemo(() => {
    const result: (SpreadsheetInfo & { duplicateCount: number })[] = [];
    groupedByTitle.forEach((items) => {
      const latest = items[0];
      result.push({
        ...latest,
        duplicateCount: items.length,
      });
    });
    return result;
  }, [groupedByTitle]);

  // Does the export title already exist in userSheetsList?
  const existingSheetWithSameName = useMemo(() => {
    return userSheetsList.find((s) => s.title?.trim() === newSheetTitle.trim());
  }, [userSheetsList, newSheetTitle]);

  // Clean duplicate older files from Google Drive
  const handleExecuteCleanDuplicates = async () => {
    let activeToken = accessToken;
    if (!activeToken) {
      const loginRes = await onLogin();
      activeToken = loginRes?.accessToken || null;
      if (!activeToken) {
        setErrorMessage('削除にはGoogleアカウント認証が必要です。');
        return;
      }
    }

    setIsCleaningDuplicates(true);
    setShowConfirmCleanModal(false);
    setErrorMessage(null);
    setCleanSuccessMessage(null);

    try {
      let deletedCount = 0;
      for (const [, items] of groupedByTitle.entries()) {
        if (items.length > 1) {
          const olderItems = items.slice(1);
          for (const oldItem of olderItems) {
            try {
              await deleteSpreadsheetFromDrive(activeToken, oldItem.spreadsheetId);
              deletedCount++;
            } catch (e) {
              console.warn('Failed to delete duplicate file from Drive:', oldItem.spreadsheetId, e);
            }
          }
        }
      }

      await loadDriveSpreadsheets(activeToken);
      setCleanSuccessMessage(`同名の古い重複スプレッドシート ${deletedCount} 件をGoogle Driveから削除・整理しました。最新のファイルのみ保持されています。`);
    } catch (err: any) {
      console.error('Clean error:', err);
      setErrorMessage(err.message || '重複ファイルの削除中にエラーが発生しました。');
    } finally {
      setIsCleaningDuplicates(false);
    }
  };

  // Execute JSON Export
  const handleExecuteJSONExport = () => {
    if (itemsToExport.length === 0) {
      setErrorMessage('書き出すCDレコードがありません。');
      return;
    }
    setErrorMessage(null);
    try {
      exportCDsToJSON(itemsToExport, jsonFileName, jsonPrettyPrint);
      setJsonExportSuccess(true);
      onMarkSynced(itemsToExport.map((i) => i.id));
      setTimeout(() => setJsonExportSuccess(false), 4500);
    } catch (err: any) {
      console.error('JSON Export error:', err);
      setErrorMessage(err.message || 'JSONファイルの書き出しに失敗しました。');
    }
  };

  const handleCopyJSONToClipboard = () => {
    if (itemsToExport.length === 0) {
      setErrorMessage('書き出すCDレコードがありません。');
      return;
    }
    try {
      const normalizedCds = itemsToExport.map((cd) => ({
        ...cd,
        vinylRecordReleaseDate: cd.vinylRecordReleaseDate || '',
        vinylRecordFormat: cd.vinylRecordFormat || '',
        vinylRecordCatalogNumber: cd.vinylRecordCatalogNumber || '',
      }));
      const payload = {
        app: 'CDCollectionManager',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        count: normalizedCds.length,
        cds: normalizedCds,
      };
      const jsonStr = jsonPrettyPrint ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
      navigator.clipboard.writeText(jsonStr);
      setJsonCopySuccess(true);
      setTimeout(() => setJsonCopySuccess(false), 3000);
    } catch (err: any) {
      console.error('Clipboard copy error:', err);
      setErrorMessage('クリップボードへのコピーに失敗しました。');
    }
  };

  // Process JSON File or Text for Import
  const handleProcessJSONInput = async (sourceText?: string, file?: File) => {
    setIsParsingJSON(true);
    setErrorMessage(null);
    setJsonParsedInfo(null);
    setImportResult(null);

    try {
      let textToParse = sourceText || '';
      if (file) {
        textToParse = await file.text();
        setJsonImportFile(file);
      }
      if (!textToParse.trim()) {
        throw new Error('解析するJSONテキストまたはファイルを選択してください。');
      }

      const res = parseJSONToCDs(textToParse);
      setJsonParsedInfo({
        cds: res.cds,
        totalAlbums: res.totalAlbums,
        totalTracks: res.totalTracks,
        exportedAt: res.exportedAt,
      });
    } catch (err: any) {
      console.error('JSON parse error:', err);
      setErrorMessage(err.message || 'JSONデータの解析に失敗しました。');
    } finally {
      setIsParsingJSON(false);
    }
  };

  const handleExecuteJSONSyncToLibrary = async () => {
    if (!jsonParsedInfo || jsonParsedInfo.cds.length === 0) return;

    setIsSyncingToLibrary(true);
    setErrorMessage(null);

    try {
      if (onImportCDs) {
        await onImportCDs(jsonParsedInfo.cds);
      }
      setImportResult({
        count: jsonParsedInfo.totalAlbums,
        title: `JSONデータ (全${jsonParsedInfo.totalAlbums}件)`,
      });
      setJsonParsedInfo(null);
      setJsonTextInput('');
      setJsonImportFile(null);
    } catch (err: any) {
      console.error('JSON Sync error:', err);
      setErrorMessage(err.message || 'ライブラリへの反映中にエラーが発生しました。');
    } finally {
      setIsSyncingToLibrary(false);
    }
  };

  // Execute CSV Export
  const handleExecuteCSVExport = () => {
    if (itemsToExport.length === 0) {
      setErrorMessage('書き出すCDレコードがありません。');
      return;
    }
    setErrorMessage(null);
    try {
      if (csvExportOption === 'both') {
        exportBothCSVs(itemsToExport);
      } else if (csvExportOption === 'albums') {
        exportCDAlbumsCSV(itemsToExport);
      } else if (csvExportOption === 'tracks') {
        exportCDTracksCSV(itemsToExport);
      } else if (csvExportOption === 'combined') {
        exportCDCombinedDetailedCSV(itemsToExport);
      }
      setCsvExportSuccess(true);
      onMarkSynced(itemsToExport.map((i) => i.id));
      setTimeout(() => setCsvExportSuccess(false), 4500);
    } catch (err: any) {
      console.error('CSV Export error:', err);
      setErrorMessage(err.message || 'CSVファイルの書き出しに失敗しました。');
    }
  };

  // Process CSV Files for Import
  const handleProcessCSVFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsParsingCSV(true);
    setErrorMessage(null);
    setCsvParsedInfo(null);
    setImportResult(null);

    try {
      const res = await parseMultipleCSVFilesToCDs(fileArray);
      if (res.cds.length === 0) {
        throw new Error('CSVファイルから有効なCDデータを読み取れませんでした。');
      }
      setCsvParsedInfo({
        cds: res.cds,
        totalAlbums: res.totalAlbums,
        totalTracks: res.totalTracks,
        fileNames: res.fileNames,
      });
    } catch (err: any) {
      console.error('CSV parse error:', err);
      setErrorMessage(err.message || 'CSVファイルの解析に失敗しました。');
    } finally {
      setIsParsingCSV(false);
    }
  };

  const handleExecuteCSVSyncToLibrary = async () => {
    if (!csvParsedInfo || csvParsedInfo.cds.length === 0) return;

    setIsSyncingToLibrary(true);
    setErrorMessage(null);

    try {
      if (onImportCDs) {
        await onImportCDs(csvParsedInfo.cds);
      }
      setImportResult({
        count: csvParsedInfo.totalAlbums,
        title: csvParsedInfo.fileNames.join(' ＋ '),
      });
      setCsvParsedInfo(null);
      setCsvAlbumFile(null);
      setCsvTrackFile(null);
    } catch (err: any) {
      console.error('CSV Sync error:', err);
      setErrorMessage(err.message || 'ライブラリへの反映中にエラーが発生しました。');
    } finally {
      setIsSyncingToLibrary(false);
    }
  };

  // Execute Excel Export
  const handleExecuteExcelExport = () => {
    if (itemsToExport.length === 0) {
      setErrorMessage('書き出すCDレコードがありません。');
      return;
    }
    setErrorMessage(null);
    try {
      const result = exportCDsToExcel(itemsToExport, excelFileName, DEFAULT_COLUMN_CONFIG);
      setExcelExportResult(result);
      onMarkSynced(itemsToExport.map((i) => i.id));
    } catch (err: any) {
      console.error('Excel Export error:', err);
      setErrorMessage(err.message || 'Excelファイルの書き出しに失敗しました。');
    }
  };

  // Handle Excel / Multiple CSV Files Drop / Selection
  const handleExcelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    processExcelOrCSVFiles(Array.from(e.target.files));
  };

  const handleExcelDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processExcelOrCSVFiles(Array.from(e.dataTransfer.files));
    }
  };

  const processExcelOrCSVFiles = async (files: File[]) => {
    setIsParsingExcel(true);
    setErrorMessage(null);
    setExcelImportFile(files[0]);
    setExcelParsedInfo(null);
    setImportResult(null);

    try {
      if (files.length === 1 && (files[0].name.endsWith('.xlsx') || files[0].name.endsWith('.xls'))) {
        const parsed = await parseExcelFileToCDs(files[0]);
        if (parsed.cds.length === 0) {
          throw new Error('Excelファイルから有効なCDデータを読み取れませんでした。');
        }
        setExcelParsedInfo(parsed);
      } else {
        const parsed = await parseMultipleCSVFilesToCDs(files);
        if (parsed.cds.length === 0) {
          throw new Error('CSVファイルから有効なCDデータを読み取れませんでした。');
        }
        setExcelParsedInfo({
          cds: parsed.cds,
          sheetNames: parsed.fileNames,
          totalAlbums: parsed.totalAlbums,
          totalTracks: parsed.totalTracks,
          fileName: files.map((f) => f.name).join(' ＋ '),
        });
      }
    } catch (err: any) {
      console.error('File parse error:', err);
      setErrorMessage(err.message || 'ファイルの解析に失敗しました。');
    } finally {
      setIsParsingExcel(false);
    }
  };

  // Sync Excel parsed CDs to library
  const handleExecuteExcelSyncToLibrary = async () => {
    if (!excelParsedInfo || excelParsedInfo.cds.length === 0) return;

    setIsSyncingToLibrary(true);
    setErrorMessage(null);

    try {
      if (onImportCDs) {
        await onImportCDs(excelParsedInfo.cds);
      }
      setImportResult({ count: excelParsedInfo.cds.length, title: excelParsedInfo.fileName });
      setExcelParsedInfo(null);
      setExcelImportFile(null);
    } catch (err: any) {
      console.error('Sync error:', err);
      setErrorMessage(err.message || 'ライブラリへの同期中にエラーが発生しました。');
    } finally {
      setIsSyncingToLibrary(false);
    }
  };

  // Execute Google Sheets Export
  const handleExecuteExport = async () => {
    let activeToken = accessToken;

    if (!activeToken) {
      const loginRes = await onLogin();
      activeToken = loginRes?.accessToken || null;
      if (!activeToken) {
        setErrorMessage('書き出しにはGoogleアカウント認証が必要です。');
        return;
      }
    }

    if (itemsToExport.length === 0) {
      setErrorMessage('書き出すCDレコードがありません。');
      return;
    }

    setIsExporting(true);
    setErrorMessage(null);
    setExportResult(null);

    try {
      let targetSpreadsheetId = '';
      let targetSheetName = ALBUM_SHEET_NAME;
      let targetTitle = '';
      const isAppendMode = exportDestinationMode === 'append';

      if (exportDestinationMode === 'update' || exportDestinationMode === 'append') {
        const primary = primarySpreadsheet || getPrimarySpreadsheet();
        if (!primary) {
          throw new Error('1回目に作成した連携スプレッドシートが見つかりません。新規作成を選択してください。');
        }
        targetSpreadsheetId = primary.spreadsheetId;
        targetSheetName = primary.sheets?.[0]?.title || ALBUM_SHEET_NAME;
        targetTitle = primary.title;
      } else if (exportDestinationMode === 'new') {
        const titleToUse = newSheetTitle.trim() || `CDカタログ_${new Date().toISOString().slice(0, 10)}`;
        const newSheet = await createNewSpreadsheet(activeToken, titleToUse);
        targetSpreadsheetId = newSheet.spreadsheetId;
        targetSheetName = newSheet.sheets[0].title;
        targetTitle = newSheet.title;
      } else {
        const targetIdOrUrl = customExportSheetUrl.trim() || selectedExportSheetId;
        if (!targetIdOrUrl) {
          throw new Error('書き出し先のスプレッドシートを選択するかURLを入力してください。');
        }
        targetSpreadsheetId = extractSpreadsheetId(targetIdOrUrl);
        targetSheetName = customExportSheetName.trim() || ALBUM_SHEET_NAME;
        const matched = userSheetsList.find((s) => s.spreadsheetId === targetSpreadsheetId);
        targetTitle = matched?.title || 'Googleスプレッドシート';
      }

      const result = await exportCDsToSpreadsheet(
        activeToken,
        targetSpreadsheetId,
        targetSheetName,
        itemsToExport,
        DEFAULT_COLUMN_CONFIG,
        isAppendMode ? 'append' : 'overwrite'
      );

      const sheetInfo: SpreadsheetInfo = {
        spreadsheetId: targetSpreadsheetId,
        title: targetTitle || newSheetTitle.trim() || 'CDカタログ',
        spreadsheetUrl: result.spreadsheetUrl,
        sheets: [
          { sheetId: 0, title: targetSheetName },
          { sheetId: 1, title: TRACKLIST_SHEET_NAME },
        ],
        modifiedTime: new Date().toISOString(),
      };

      savePrimarySpreadsheet(sheetInfo);
      setPrimarySpreadsheet(sheetInfo);
      setExportDestinationMode('update');

      await loadDriveSpreadsheets(activeToken);

      setExportResult({
        url: result.spreadsheetUrl,
        count: result.addedCount,
        totalTracksAdded: result.totalTracksAdded,
      });
      onMarkSynced(itemsToExport.map((i) => i.id));
    } catch (err: any) {
      console.error('Export error:', err);
      if (err.message?.includes('401') || err.message?.includes('UNAUTHENTICATED') || err.message?.includes('403')) {
        setErrorMessage('Google認証が期限切れになりました。再ログイン後にもう一度お試しください。');
        await onLogin();
      } else {
        setErrorMessage(err.message || 'Googleスプレッドシートへの出力に失敗しました。');
      }
    } finally {
      setIsExporting(false);
    }
  };

  // Execute Read / Import from Google Sheets
  const handleExecuteReadSheet = async () => {
    let activeToken = accessToken;

    if (!activeToken) {
      const loginRes = await onLogin();
      activeToken = loginRes?.accessToken || null;
      if (!activeToken) {
        setErrorMessage('スプレッドシート読み込みにはGoogleアカウント認証が必要です。');
        return;
      }
    }

    const targetIdOrUrl = customSheetUrl.trim() || selectedSheetId;
    if (!targetIdOrUrl) {
      setErrorMessage('読み込み対象のスプレッドシートを選択するかURLを入力してください。');
      return;
    }

    setIsReadingSheet(true);
    setErrorMessage(null);
    setParsedImportCDs(null);
    setImportResult(null);

    try {
      const { headers, rows, trackHeaders, trackRows, spreadsheetTitle } = await readSpreadsheetValues(
        activeToken,
        targetIdOrUrl,
        customSheetName.trim() || undefined
      );

      if (rows.length === 0) {
        setErrorMessage('スプレッドシートにデータ行が見つかりませんでした。');
        return;
      }

      const cds = parseSpreadsheetRowsToCDs(headers, rows, trackHeaders, trackRows);
      if (cds.length === 0) {
        setErrorMessage('スプレッドシートから有効なCDデータを読み取れませんでした。列名をご確認ください。');
        return;
      }

      setParsedImportCDs(cds);
      setImportSourceTitle(spreadsheetTitle);

      const updatedList = getKnownSpreadsheets();
      setUserSheetsList(updatedList);
    } catch (err: any) {
      console.error('Read spreadsheet error:', err);
      if (err.message?.includes('401') || err.message?.includes('UNAUTHENTICATED') || err.message?.includes('403')) {
        setErrorMessage('Google認証が期限切れになりました。再ログイン後にもう一度お試しください。');
        await onLogin();
      } else {
        setErrorMessage(err.message || 'スプレッドシートの読み込みに失敗しました。URLまたは共有権限をご確認ください。');
      }
    } finally {
      setIsReadingSheet(false);
    }
  };

  // Execute Sync to Local Library from Google Sheets
  const handleExecuteSyncToLibrary = async () => {
    if (!parsedImportCDs || parsedImportCDs.length === 0) return;

    setIsSyncingToLibrary(true);
    setErrorMessage(null);

    try {
      if (onImportCDs) {
        await onImportCDs(parsedImportCDs);
      }
      setImportResult({ count: parsedImportCDs.length, title: importSourceTitle });
      setParsedImportCDs(null);
    } catch (err: any) {
      console.error('Sync error:', err);
      setErrorMessage(err.message || 'ライブラリへの同期中にエラーが発生しました。');
    } finally {
      setIsSyncingToLibrary(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header with Main Tab Switcher */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600/30 to-teal-600/30 border border-emerald-500/40 flex items-center justify-center shadow-inner">
                <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white leading-tight flex items-center gap-2">
                  <span>スプレッドシート & Excel & CSV 連携・同期</span>
                  <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    2シート/2ファイル連携
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Googleスプレッドシート・Excel (.xlsx)・CSV（2ファイル一括出力/取込）の双方向データ同期
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Mode Switcher Tabs (Export vs Import) */}
          <div className="flex items-center gap-2 p-1 bg-slate-950/70 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => { setActiveTab('export'); setErrorMessage(null); setCleanSuccessMessage(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'export'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>書き出し・エクスポート ({itemsToExport.length}件)</span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('import'); setErrorMessage(null); setCleanSuccessMessage(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'import'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>読み込み・インポート・同期</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          
          {/* TAB 1: EXPORT MODE */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              {allCDs && initialItemsToExport.length > 0 && initialItemsToExport.length < allCDs.length && (
                <div className="flex items-center justify-between gap-2 p-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs">
                  <span className="text-slate-300 font-bold">書き出し対象:</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setExportScope('all')}
                      className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                        exportScope === 'all'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      ライブラリ全件 ({allCDs.length}件)
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportScope('subset')}
                      className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                        exportScope === 'subset'
                          ? 'bg-indigo-600 text-white shadow'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      選択中のみ ({initialItemsToExport.length}件)
                    </button>
                  </div>
                </div>
              )}

              {/* Export Target Type Selector (Google Sheets vs Excel File vs CSV) */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2">
                  書き出し先を選択:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setExportTargetType('sheets')}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      exportTargetType === 'sheets'
                        ? 'bg-emerald-950/50 border-emerald-500 text-white ring-1 ring-emerald-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Google シート</p>
                      <p className="text-[10px] text-slate-400 truncate">Drive直接作成・追記</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportTargetType('excel')}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      exportTargetType === 'excel'
                        ? 'bg-teal-950/50 border-teal-500 text-white ring-1 ring-teal-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-teal-600/20 border border-teal-500/40 flex items-center justify-center flex-shrink-0">
                      <FileDown className="w-3.5 h-3.5 text-teal-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Excel (.xlsx)</p>
                      <p className="text-[10px] text-slate-400 truncate">2シート直接出力</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportTargetType('csv')}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      exportTargetType === 'csv'
                        ? 'bg-indigo-950/50 border-indigo-500 text-white ring-1 ring-indigo-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center flex-shrink-0">
                      <Download className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">CSV (.csv)</p>
                      <p className="text-[10px] text-slate-400 truncate">2ファイル一括/統合</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportTargetType('json')}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      exportTargetType === 'json'
                        ? 'bg-amber-950/50 border-amber-500 text-white ring-1 ring-amber-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-amber-600/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
                      <Code className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">JSON バックアップ</p>
                      <p className="text-[10px] text-slate-400 truncate">完全復元・データ交換</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* A. GOOGLE SHEETS EXPORT */}
              {exportTargetType === 'sheets' && (
                <div className="space-y-4 pt-1 animate-in fade-in duration-150">
                  {!user ? (
                    <div className="bg-slate-800/80 border border-slate-700 p-5 rounded-xl text-center space-y-2.5">
                      <LogIn className="w-8 h-8 text-indigo-400 mx-auto" />
                      <h4 className="text-xs font-bold text-white">Googleスプレッドシートへの直接書き込みには認証が必要です</h4>
                      <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                        Googleサインインを行うことで、Google Drive / Sheets へ直接自動書き込みできます。
                      </p>
                      <button
                        onClick={onLogin}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-all cursor-pointer"
                      >
                        Googleでログインして連携
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Destination Mode Selector (Update Primary Sheet vs Append vs New vs Existing) */}
                      <div className="flex flex-col sm:flex-row items-stretch gap-1.5 p-1 bg-slate-950/60 rounded-xl border border-slate-800 text-xs font-bold">
                        {primarySpreadsheet && (
                          <>
                            <button
                              type="button"
                              onClick={() => setExportDestinationMode('update')}
                              className={`flex-1 py-2 px-2.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                exportDestinationMode === 'update'
                                  ? 'bg-emerald-600 text-white shadow-md'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                              }`}
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-amber-300" />
                              <span>1回目に作成したシートを同期・更新</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setExportDestinationMode('append')}
                              className={`py-2 px-2.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                exportDestinationMode === 'append'
                                  ? 'bg-emerald-600 text-white shadow-md'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                              }`}
                            >
                              <Plus className="w-3.5 h-3.5 text-emerald-300" />
                              <span>末尾追記</span>
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setExportDestinationMode('new')}
                          className={`flex-1 py-2 px-2.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            exportDestinationMode === 'new'
                              ? 'bg-emerald-600 text-white shadow-md'
                              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                          }`}
                        >
                          <Plus className="w-3.5 h-3.5 text-emerald-300" />
                          <span>{primarySpreadsheet ? '新規シート作成' : '新規スプレッドシート作成 (初回)'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setExportDestinationMode('existing')}
                          className={`flex-1 py-2 px-2.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            exportDestinationMode === 'existing'
                              ? 'bg-emerald-600 text-white shadow-md'
                              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                          }`}
                        >
                          <Files className="w-3.5 h-3.5 text-slate-300" />
                          <span>別の既存シート</span>
                        </button>
                      </div>

                      {/* Mode A: Update Primary Spreadsheet (1回目に作成したシートを同期・更新) */}
                      {exportDestinationMode === 'update' && primarySpreadsheet && (
                        <div className="space-y-3 p-4 bg-emerald-950/30 rounded-xl border border-emerald-500/30 text-xs shadow-inner">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1">
                                <RefreshCw className="w-3 h-3 text-emerald-400" />
                                1回目に作成した連携シート（自動全同期）
                              </span>
                              <span className="text-[10px] text-slate-400">更新モード</span>
                            </div>
                            <a
                              href={primarySpreadsheet.spreadsheetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-medium text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                            >
                              スプレッドシートを開く
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>

                          <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileSpreadsheet className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="font-bold text-white text-xs truncate">{primarySpreadsheet.title}</p>
                                <p className="text-[10px] text-slate-400 truncate">
                                  ID: {primarySpreadsheet.spreadsheetId}
                                  {primarySpreadsheet.modifiedTime && ` • 最終更新: ${formatJSTShort(primarySpreadsheet.modifiedTime)}`}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 flex items-start gap-2">
                            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                            <span>
                              1回目に作成されたこのシートの内容をクリアし、選択されている <strong>{itemsToExport.length}件</strong> の最新CDデータと全収録曲リストで**完全上書き・同期更新**します。
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Mode A-2: Append to Primary Spreadsheet (末尾追記) */}
                      {exportDestinationMode === 'append' && primarySpreadsheet && (
                        <div className="space-y-3 p-4 bg-slate-900/80 rounded-xl border border-slate-700/80 text-xs shadow-inner">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold flex items-center gap-1">
                                <Plus className="w-3 h-3 text-emerald-400" />
                                1回目に作成した連携シート (追記モード)
                              </span>
                            </div>
                            <a
                              href={primarySpreadsheet.spreadsheetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-medium text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                            >
                              スプレッドシートを開く
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>

                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileSpreadsheet className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="font-bold text-white text-xs truncate">{primarySpreadsheet.title}</p>
                                <p className="text-[10px] text-slate-400 truncate">ID: {primarySpreadsheet.spreadsheetId}</p>
                              </div>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 flex items-start gap-2">
                            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                            <span>
                              既存のデータを削除せず、シートの末尾に今回選んだ <strong>{itemsToExport.length}件</strong> のCDを新規行として追加書き込みします。
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Mode B: New Spreadsheet */}
                      {exportDestinationMode === 'new' && (
                        <div className="space-y-3 p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-xs font-bold text-slate-200">
                                新規スプレッドシートのタイトル:
                              </label>
                              <span className="text-[10px] text-emerald-400 font-medium">
                                💡 作成後は2回目以降の自動追記先になります
                              </span>
                            </div>
                            <input
                              type="text"
                              value={newSheetTitle}
                              onChange={(e) => setNewSheetTitle(e.target.value)}
                              placeholder="CDカタログ_YYYY-MM-DD"
                              className="w-full bg-slate-800/90 border border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs text-white font-medium"
                            />
                          </div>

                          {existingSheetWithSameName && (
                            <div className="bg-amber-950/40 border border-amber-600/40 p-2.5 rounded-xl flex items-center justify-between gap-2 text-[11px] text-amber-200">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                <span className="truncate">同名「{newSheetTitle}」が既にDriveに存在します</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const now = new Date();
                                  const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
                                  setNewSheetTitle(`${newSheetTitle}_${timeStr}`);
                                }}
                                className="px-2 py-0.5 rounded bg-amber-900/60 hover:bg-amber-800 text-amber-100 font-bold border border-amber-500/40 whitespace-nowrap cursor-pointer text-[10px]"
                              >
                                時刻をつけて別名にする
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Mode: Append to Existing Spreadsheet */}
                      {exportDestinationMode === 'existing' && (
                        <div className="space-y-3 p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
                          <div>
                            <label className="block text-xs font-bold text-slate-200 mb-1">
                              書き込み先スプレッドシートを選択:
                            </label>
                            <select
                              value={selectedExportSheetId}
                              onChange={(e) => {
                                setSelectedExportSheetId(e.target.value);
                                setCustomExportSheetUrl('');
                              }}
                              className="w-full bg-slate-800/90 border border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs text-white font-medium cursor-pointer"
                            >
                              <option value="">-- スプレッドシートを選択 --</option>
                              {collapsedSheetsList.map((s) => (
                                <option key={s.spreadsheetId} value={s.spreadsheetId}>
                                  📄 {s.title} {s.modifiedTime ? `(更新: ${formatJSTShort(s.modifiedTime)})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-bold text-slate-300 mb-1">
                              または スプレッドシートのURL / ID:
                            </label>
                            <input
                              type="text"
                              value={customExportSheetUrl}
                              onChange={(e) => {
                                setCustomExportSheetUrl(e.target.value);
                                if (e.target.value) setSelectedExportSheetId('');
                              }}
                              placeholder="https://docs.google.com/spreadsheets/d/xxxxxx/edit..."
                              className="w-full bg-slate-800/90 border border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs text-white font-mono"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-xs font-bold text-slate-300">
                                アルバムシート名（タブ名）:
                              </label>
                              <span className="text-[10px] text-slate-400">
                                ※存在しない場合は自動作成されます
                              </span>
                            </div>
                            <input
                              type="text"
                              value={customExportSheetName}
                              onChange={(e) => setCustomExportSheetName(e.target.value)}
                              placeholder="CDアルバム一覧"
                              className="w-full bg-slate-800/90 border border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs text-white font-medium"
                            />
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* B. EXCEL EXPORT */}
              {exportTargetType === 'excel' && (
                <div className="space-y-3 p-4 bg-slate-950/60 rounded-xl border border-slate-800 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-xs font-bold text-slate-200 mb-1">
                      Excel ファイル名:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={excelFileName}
                        onChange={(e) => setExcelFileName(e.target.value)}
                        placeholder="CDコレクション_YYYY-MM-DD"
                        className="flex-1 bg-slate-800/90 border border-slate-700 focus:border-teal-500 rounded-xl py-2 px-3 text-xs text-white font-medium"
                      />
                      <span className="text-xs font-mono text-slate-400 font-bold">.xlsx</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 space-y-1.5 text-xs text-slate-300">
                    <p className="font-bold text-teal-300 flex items-center gap-1.5">
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Excel出力の構成（2シート構造）</span>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      • <strong>シート1「CDアルバム一覧」:</strong> 型番、タイトル、歌手、レーベル、発売年月日、同タイトルLP/EP発売年月日、アナログ盤種別、LP/EP規格品番、JANコード、仕様、メモ等<br />
                      • <strong>シート2「収録曲リスト」:</strong> 型番キー紐付け、曲順、曲名、演奏時間、試聴URL等
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleExecuteExcelExport}
                    disabled={itemsToExport.length === 0}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 active:scale-98 text-white shadow-lg shadow-teal-900/40 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Excel (.xlsx) ファイルに書き出し ({itemsToExport.length}件)</span>
                  </button>

                  {excelExportResult && (
                    <div className="bg-teal-950/80 border border-teal-500/50 p-3 rounded-xl flex items-center gap-2 text-teal-200 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-teal-400 flex-shrink-0" />
                      <span>
                        「{excelExportResult.fileName}」（アルバム {excelExportResult.count} 枚 / 収録曲 {excelExportResult.totalTracks} 曲）を正常に書き出しました！
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* C. CSV EXPORT */}
              {exportTargetType === 'csv' && (
                <div className="space-y-3 p-4 bg-slate-950/60 rounded-xl border border-indigo-500/40 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Download className="w-4 h-4 text-indigo-400" />
                      CSV出力形式を選択:
                    </span>
                    <span className="text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded-full font-bold">
                      UTF-8 BOM付き (Excel文字化け防止)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div
                      onClick={() => setCsvExportOption('both')}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        csvExportOption === 'both'
                          ? 'bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500/50 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                          <Files className="w-3.5 h-3.5 text-indigo-400" />
                          2つのCSVを一括出力（推奨）
                        </span>
                        {csvExportOption === 'both' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        「アルバム一覧.csv」と「収録曲詳細.csv」の2ファイルを一度にダウンロード
                      </p>
                    </div>

                    <div
                      onClick={() => setCsvExportOption('albums')}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        csvExportOption === 'albums'
                          ? 'bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500/50 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Disc className="w-3.5 h-3.5 text-slate-400" />
                          CDアルバム一覧のみ
                        </span>
                        {csvExportOption === 'albums' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        型番、タイトル、歌手、レーベル、CD発売日、LP/EP発売年月日、アナログ盤種別、LP/EP規格品番、JANコード等を出力
                      </p>
                    </div>

                    <div
                      onClick={() => setCsvExportOption('tracks')}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        csvExportOption === 'tracks'
                          ? 'bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500/50 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Music className="w-3.5 h-3.5 text-slate-400" />
                          収録曲詳細リストのみ
                        </span>
                        {csvExportOption === 'tracks' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        全曲のトラック詳細（型番、タイトル、曲順、曲名、演奏時間）を1曲1行で出力
                      </p>
                    </div>

                    <div
                      onClick={() => setCsvExportOption('combined')}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        csvExportOption === 'combined'
                          ? 'bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500/50 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />
                          全曲統合詳細 (1行1曲)
                        </span>
                        {csvExportOption === 'combined' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        1つのファイルに全アルバム情報と全収録曲を1曲1行形式で結合
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleExecuteCSVExport}
                    disabled={itemsToExport.length === 0}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white shadow-lg shadow-indigo-900/40 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    <FolderDown className="w-4 h-4" />
                    <span>
                      {csvExportOption === 'both'
                        ? `2つのCSVファイル（アルバム＋収録曲）を一括ダウンロード (${itemsToExport.length}件)`
                        : `選択した形式でCSVダウンロード (${itemsToExport.length}件)`}
                    </span>
                  </button>

                  {csvExportSuccess && (
                    <div className="bg-emerald-950/80 border border-emerald-500/50 p-3 rounded-xl flex items-center gap-2 text-emerald-200 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>CSVファイルのダウンロードを開始しました！</span>
                    </div>
                  )}
                </div>
              )}

              {/* D. JSON EXPORT */}
              {exportTargetType === 'json' && (
                <div className="space-y-3.5 p-4 bg-slate-950/60 rounded-xl border border-amber-500/40 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-xs font-bold text-slate-200 mb-1">
                      JSON バックアップファイル名:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={jsonFileName}
                        onChange={(e) => setJsonFileName(e.target.value)}
                        placeholder="CDコレクション_backup_YYYYMMDDHHMMSS"
                        className="flex-1 bg-slate-800/90 border border-slate-700 focus:border-amber-500 rounded-xl py-2 px-3 text-xs text-white font-medium"
                      />
                      <span className="text-xs font-mono text-slate-400 font-bold">.json</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-slate-900 rounded-xl border border-slate-800 text-xs">
                    <label className="flex items-center gap-2 text-slate-300 font-bold cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={jsonPrettyPrint}
                        onChange={(e) => setJsonPrettyPrint(e.target.checked)}
                        className="rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
                      />
                      <span>インデント整形（読みやすい改行入りJSON）</span>
                    </label>
                    <span className="text-[10px] text-slate-400">OFFにすると改行なし軽量データ</span>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 space-y-1.5 text-xs text-slate-300">
                    <p className="font-bold text-amber-300 flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5" />
                      <span>JSON構造化バックアップの特徴</span>
                    </p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      • アルバムメタデータ、LP/EP発売年月日・アナログ盤種別・LP/EP規格品番、全収録曲リスト、JANバーコード、ジャケット画像、メモ、登録日時を<strong>100%欠損なく完全保持</strong><br />
                      • 別端末や本アプリの「JSONインポート」から一発で完全復元・データ交換可能
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleExecuteJSONExport}
                      disabled={itemsToExport.length === 0}
                      className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 active:scale-98 text-white shadow-lg shadow-amber-900/40 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>JSONファイルを保存 ({itemsToExport.length}件)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyJSONToClipboard}
                      disabled={itemsToExport.length === 0}
                      className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 active:scale-98 text-slate-200 border border-slate-700 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      <Copy className="w-4 h-4 text-amber-400" />
                      <span>クリップボードにコピー</span>
                    </button>
                  </div>

                  {jsonExportSuccess && (
                    <div className="bg-emerald-950/80 border border-emerald-500/50 p-3 rounded-xl flex items-center gap-2 text-emerald-200 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>JSONファイルのダウンロードを開始しました！</span>
                    </div>
                  )}

                  {jsonCopySuccess && (
                    <div className="bg-emerald-950/80 border border-emerald-500/50 p-3 rounded-xl flex items-center gap-2 text-emerald-200 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>JSONテキストをクリップボードにコピーしました！</span>
                    </div>
                  )}
                </div>
              )}

              {/* 2-Sheet Structure Details */}
              <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>2シート連携仕様（型番キー自動リレーション）</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <p className="font-bold text-slate-200 flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                      <span>シート1「CDアルバム一覧」</span>
                    </p>
                    <p className="text-slate-400">
                      型番（主キー）、アルバム名、歌手、CD発売日、LP/EP発売年月日、アナログ盤種別、LP/EP規格品番、JANコード、ジャケット画像、メモ等
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <p className="font-bold text-slate-200 flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                      <span>シート2「収録曲リスト」</span>
                    </p>
                    <p className="text-slate-400">
                      型番（外部キー紐付け）、曲順、曲名、演奏時間（分:秒）、試聴URL等
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: IMPORT MODE */}
          {activeTab === 'import' && (
            <div className="space-y-4">
              
              {/* Import Source Type Selector (Google Sheets vs Excel File vs CSV vs JSON) */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2">
                  読み込み元を選択:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setImportSourceType('sheets')}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      importSourceType === 'sheets'
                        ? 'bg-emerald-950/50 border-emerald-500 text-white ring-1 ring-emerald-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Google シート</p>
                      <p className="text-[10px] text-slate-400 truncate">Drive/URL直接読込</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportSourceType('excel')}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      importSourceType === 'excel'
                        ? 'bg-teal-950/50 border-teal-500 text-white ring-1 ring-teal-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-teal-600/20 border border-teal-500/40 flex items-center justify-center flex-shrink-0">
                      <FileUp className="w-3.5 h-3.5 text-teal-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Excel (.xlsx)</p>
                      <p className="text-[10px] text-slate-400 truncate">ファイルドロップ</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportSourceType('csv')}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      importSourceType === 'csv'
                        ? 'bg-indigo-950/50 border-indigo-500 text-white ring-1 ring-indigo-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center flex-shrink-0">
                      <Upload className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">CSV (.csv)</p>
                      <p className="text-[10px] text-slate-400 truncate">2ファイル同時突合</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportSourceType('json')}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      importSourceType === 'json'
                        ? 'bg-amber-950/50 border-amber-500 text-white ring-1 ring-amber-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-amber-600/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
                      <Code className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">JSON 復元</p>
                      <p className="text-[10px] text-slate-400 truncate">ファイル/直貼り読込</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* A. GOOGLE SHEETS IMPORT */}
              {importSourceType === 'sheets' && (
                <div className="space-y-4 pt-1 animate-in fade-in duration-150">
                  {!user ? (
                    <div className="bg-slate-800/80 border border-slate-700 p-5 rounded-xl text-center space-y-2.5">
                      <LogIn className="w-8 h-8 text-indigo-400 mx-auto" />
                      <h4 className="text-xs font-bold text-white">Googleスプレッドシートの直接読込には認証が必要です</h4>
                      <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                        Googleサインインを行うことで、Drive内のスプレッドシートから直接コレクションを取り込めます。
                      </p>
                      <button
                        onClick={onLogin}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow transition-all cursor-pointer"
                      >
                        Googleでログイン
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Clean Success Banner */}
                      {cleanSuccessMessage && (
                        <div className="bg-emerald-950/80 border border-emerald-500/50 p-3 rounded-xl flex items-center gap-2 text-emerald-200 text-xs">
                          <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          <span>{cleanSuccessMessage}</span>
                        </div>
                      )}

                      {/* Drive Spreadsheet Select Dropdown */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-bold text-slate-200 flex items-center gap-1.5">
                            <span>Google Drive内のスプレッドシートを選択:</span>
                            {collapseDuplicates && duplicateOlderFilesCount > 0 && (
                              <span className="text-[10px] text-teal-400 bg-teal-950 px-1.5 py-0.5 rounded border border-teal-800 font-mono">
                                重複統合済 (最新のみ)
                              </span>
                            )}
                          </label>
                          <button
                            type="button"
                            onClick={() => accessToken && loadDriveSpreadsheets(accessToken)}
                            disabled={isLoadingSheetsList}
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium cursor-pointer"
                          >
                            <RefreshCw className={`w-3 h-3 ${isLoadingSheetsList ? 'animate-spin' : ''}`} />
                            <span>{isLoadingSheetsList ? 'Drive読込中...' : 'リスト更新'}</span>
                          </button>
                        </div>

                        <div className="relative">
                          <select
                            value={selectedSheetId}
                            onChange={(e) => {
                              setSelectedSheetId(e.target.value);
                              if (e.target.value) setCustomSheetUrl('');
                            }}
                            className="w-full bg-slate-800/90 border border-slate-700 focus:border-emerald-500 rounded-xl py-2.5 px-3.5 text-xs text-white shadow-inner font-medium cursor-pointer"
                          >
                            <option value="">
                              {userSheetsList.length > 0 
                                ? '▼ スプレッドシートを選択してください' 
                                : '-- スプレッドシートを選択 または 下にURLを入力 --'}
                            </option>
                            {collapseDuplicates ? (
                              collapsedSheetsList.map((s) => (
                                <option key={s.spreadsheetId} value={s.spreadsheetId}>
                                  📄 {s.title} {s.modifiedTime ? `(更新: ${formatJSTShort(s.modifiedTime)})` : ''} {s.duplicateCount > 1 ? `[他${s.duplicateCount - 1}件重複]` : ''}
                                </option>
                              ))
                            ) : (
                              userSheetsList.map((s, idx) => {
                                const isLatest = idx === 0 || userSheetsList.findIndex((x) => x.title === s.title) === idx;
                                return (
                                  <option key={s.spreadsheetId} value={s.spreadsheetId}>
                                    📄 {s.title} {isLatest ? '[最新]' : '[旧]'} {s.modifiedTime ? `(${formatJSTShort(s.modifiedTime)})` : ''}
                                  </option>
                                );
                              })
                            )}
                          </select>
                        </div>

                        {/* Deduplication Controls & Clean Button */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
                          <label className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={collapseDuplicates}
                              onChange={(e) => setCollapseDuplicates(e.target.checked)}
                              className="rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                            />
                            <span>同名ファイルを統合（最新のみ表示）</span>
                          </label>

                          {duplicateOlderFilesCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowConfirmCleanModal(true)}
                              disabled={isCleaningDuplicates}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-600/40 text-rose-300 font-bold transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3 text-rose-400" />
                              <span>古い重複ファイル({duplicateOlderFilesCount}件)を削除・整理</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* URL / ID Input */}
                      <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-300">
                          または スプレッドシートのURL / IDを直接入力:
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={customSheetUrl}
                            onChange={(e) => {
                              setCustomSheetUrl(e.target.value);
                              if (e.target.value) setSelectedSheetId('');
                            }}
                            placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit..."
                            className="w-full bg-slate-800/90 border border-slate-700 focus:border-emerald-500 rounded-xl py-2.5 px-3.5 text-xs text-white shadow-inner font-mono pr-12"
                          />
                          {customSheetUrl && (
                            <button
                              type="button"
                              onClick={() => setCustomSheetUrl('')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded cursor-pointer"
                            >
                              クリア
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Prominent Read button */}
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={handleExecuteReadSheet}
                          disabled={isReadingSheet || (!selectedSheetId && !customSheetUrl.trim())}
                          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white shadow-lg shadow-emerald-900/40 disabled:opacity-50 transition-all cursor-pointer"
                        >
                          {isReadingSheet ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>スプレッドシートからデータを解析読込中...</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4" />
                              <span>スプレッドシート直接読み込みを実行</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Parsed Preview Area */}
                      {parsedImportCDs && (
                        <div className="bg-slate-950 border border-emerald-500/50 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              <span className="text-xs font-bold text-emerald-300">
                                「{importSourceTitle}」から {parsedImportCDs.length} 枚（計 {parsedImportCDs.reduce((sum, cd) => sum + (cd.tracks?.length || 0), 0)} 曲の収録曲連携）を読み込みました
                              </span>
                            </div>
                          </div>

                          <div className="max-h-44 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg text-xs">
                            {parsedImportCDs.slice(0, 8).map((cd, idx) => (
                              <div key={idx} className="p-2 flex items-center justify-between gap-2 hover:bg-slate-900">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Disc className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                                  <div className="min-w-0">
                                    <p className="font-bold text-white truncate">{cd.title}</p>
                                    <p className="text-slate-400 truncate text-[11px]">
                                      {cd.artist}
                                      {cd.releaseDate ? ` (CD: ${cd.releaseDate})` : ''}
                                      {cd.vinylRecordReleaseDate
                                        ? ` • ${cd.vinylRecordFormat || 'LP/EP'}: ${cd.vinylRecordReleaseDate}${cd.vinylRecordCatalogNumber ? ` [${cd.vinylRecordCatalogNumber}]` : ''}`
                                        : ''}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className="text-[10px] text-teal-400 bg-teal-950/80 px-1.5 py-0.5 rounded border border-teal-800 font-mono">
                                    {cd.tracks?.length || 0} 曲
                                  </span>
                                  <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-800">
                                    {cd.catalogNumber || '型番なし'}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {parsedImportCDs.length > 8 && (
                              <div className="p-2 text-center text-[11px] text-slate-500 bg-slate-900/50 font-medium">
                                ...他 {parsedImportCDs.length - 8} 件
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={handleExecuteSyncToLibrary}
                            disabled={isSyncingToLibrary}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white shadow-lg shadow-emerald-900/40 disabled:opacity-50 transition-all cursor-pointer"
                          >
                            {isSyncingToLibrary ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>ライブラリデータベースに同期中...</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-4 h-4" />
                                <span>読み込んだ {parsedImportCDs.length} 件をライブラリに同期・登録する</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* B. EXCEL FILE IMPORT */}
              {importSourceType === 'excel' && (
                <div className="space-y-4 pt-1 animate-in fade-in duration-150">
                  {/* Dropzone */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleExcelDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-teal-600/50 hover:border-teal-400 bg-slate-950/60 hover:bg-slate-900/80 p-6 rounded-2xl text-center space-y-3 cursor-pointer transition-all"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => {
                        handleExcelFileSelect(e);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <div className="w-12 h-12 rounded-2xl bg-teal-600/20 border border-teal-500/40 flex items-center justify-center mx-auto text-teal-400">
                      <FileUp className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">
                        Excel または 2つのCSVファイル（アルバム一覧＋収録曲リスト）をドラッグ＆ドロップ
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        または クリックしてファイルを選択（複数選択可）
                      </p>
                    </div>
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-teal-950 text-teal-300 border border-teal-800 font-medium">
                      2シート構成（Excel）または 2つのCSVファイル（アルバム＋収録曲）の自動紐付け対応
                    </span>
                  </div>

                  {isParsingExcel && (
                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-center text-xs text-teal-300 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
                      <span>Excelファイルを高速解析中...</span>
                    </div>
                  )}

                  {/* Excel Parsed Live Preview */}
                  {excelParsedInfo && (
                    <div className="bg-slate-950 border border-teal-500/50 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-teal-400" />
                          <span className="text-xs font-bold text-teal-300">
                            「{excelParsedInfo.fileName}」から {excelParsedInfo.totalAlbums} 枚（収録曲 {excelParsedInfo.totalTracks} 曲）を検出
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          検出シート: {excelParsedInfo.sheetNames.join(', ')}
                        </span>
                      </div>

                      <div className="max-h-44 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg text-xs">
                        {excelParsedInfo.cds.slice(0, 8).map((cd, idx) => (
                          <div key={idx} className="p-2 flex items-center justify-between gap-2 hover:bg-slate-900">
                            <div className="flex items-center gap-2 min-w-0">
                              <Disc className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="font-bold text-white truncate">{cd.title}</p>
                                <p className="text-slate-400 truncate text-[11px]">
                                  {cd.artist}
                                  {cd.releaseDate ? ` (CD: ${cd.releaseDate})` : ''}
                                  {cd.vinylRecordReleaseDate
                                    ? ` • ${cd.vinylRecordFormat || 'LP/EP'}: ${cd.vinylRecordReleaseDate}${cd.vinylRecordCatalogNumber ? ` [${cd.vinylRecordCatalogNumber}]` : ''}`
                                    : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-teal-400 bg-teal-950/80 px-1.5 py-0.5 rounded border border-teal-800 font-mono">
                                {cd.tracks?.length || 0} 曲
                              </span>
                              <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-800">
                                {cd.catalogNumber || '型番なし'}
                              </span>
                            </div>
                          </div>
                        ))}
                        {excelParsedInfo.cds.length > 8 && (
                          <div className="p-2 text-center text-[11px] text-slate-500 bg-slate-900/50 font-medium">
                            ...他 {excelParsedInfo.cds.length - 8} 件
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleExecuteExcelSyncToLibrary}
                        disabled={isSyncingToLibrary}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 active:scale-98 text-white shadow-lg shadow-teal-900/40 disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {isSyncingToLibrary ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>ライブラリデータベースに同期中...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Excelから読み込んだ {excelParsedInfo.totalAlbums} 件をライブラリに一括登録する</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* C. CSV IMPORT */}
              {importSourceType === 'csv' && (
                <div className="space-y-4 pt-1 animate-in fade-in duration-150">
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-indigo-500/30 text-xs text-slate-300">
                    <p className="font-bold text-indigo-300 flex items-center gap-1.5 mb-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>2つのCSVファイル（アルバム一覧 ＋ 収録曲詳細）の自動突合取込</span>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      「型番（規格品番）」または「CDタイトル」をキーとして自動的にアルバムと収録曲リストを結合し、データベースに反映します。
                    </p>
                  </div>

                  {/* Dropzone */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleProcessCSVFiles(e.dataTransfer.files);
                      }
                    }}
                    onClick={() => csvFileInputRef.current?.click()}
                    className="border-2 border-dashed border-indigo-600/50 hover:border-indigo-400 bg-slate-950/60 hover:bg-slate-900/80 p-6 rounded-2xl text-center space-y-3 cursor-pointer transition-all"
                  >
                    <input
                      ref={csvFileInputRef}
                      type="file"
                      multiple
                      accept=".csv"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleProcessCSVFiles(e.target.files);
                        }
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center mx-auto text-indigo-400">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">
                        2つのCSVファイル（アルバム一覧 ＋ 収録曲詳細）をここにドロップ
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        または クリックしてファイルを複数選択 (Shift / Ctrlキー)
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                      <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700">
                        ファイル1: CDアルバム一覧.csv
                      </span>
                      <span className="text-slate-500 text-xs">+</span>
                      <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300 border border-slate-700">
                        ファイル2: 収録曲詳細.csv
                      </span>
                    </div>
                  </div>

                  {/* Individual 2-File Slots */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div
                      onClick={() => csvAlbumSlotRef.current?.click()}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        csvAlbumFile
                          ? 'bg-indigo-950/50 border-indigo-500/80 text-indigo-200'
                          : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <input
                        ref={csvAlbumSlotRef}
                        type="file"
                        accept=".csv"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setCsvAlbumFile(f);
                          handleProcessCSVFiles([f, csvTrackFile].filter(Boolean) as File[]);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-white flex items-center gap-1.5">
                          <Disc className="w-3.5 h-3.5 text-indigo-400" />
                          ファイル①: アルバム一覧CSV
                        </span>
                        {csvAlbumFile && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate">
                        {csvAlbumFile ? csvAlbumFile.name : 'クリックして個別に指定'}
                      </p>
                    </div>

                    <div
                      onClick={() => csvTrackSlotRef.current?.click()}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        csvTrackFile
                          ? 'bg-indigo-950/50 border-indigo-500/80 text-indigo-200'
                          : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <input
                        ref={csvTrackSlotRef}
                        type="file"
                        accept=".csv"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setCsvTrackFile(f);
                          handleProcessCSVFiles([csvAlbumFile, f].filter(Boolean) as File[]);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-white flex items-center gap-1.5">
                          <Music className="w-3.5 h-3.5 text-indigo-400" />
                          ファイル②: 収録曲詳細CSV
                        </span>
                        {csvTrackFile && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate">
                        {csvTrackFile ? csvTrackFile.name : 'クリックして個別に指定'}
                      </p>
                    </div>
                  </div>

                  {isParsingCSV && (
                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-center text-xs text-indigo-300 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                      <span>CSVファイルを解析・突合しています...</span>
                    </div>
                  )}

                  {/* CSV Parsed Preview */}
                  {csvParsedInfo && (
                    <div className="bg-slate-950 border border-indigo-500/50 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-xs font-bold text-indigo-300">
                            {csvParsedInfo.totalAlbums} 枚のCDアルバム（計 {csvParsedInfo.totalTracks} 曲の収録曲を突合）
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          {csvParsedInfo.fileNames.join(' ＋ ')}
                        </span>
                      </div>

                      <div className="max-h-44 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg text-xs">
                        {csvParsedInfo.cds.slice(0, 8).map((cd, idx) => (
                          <div key={idx} className="p-2 flex items-center justify-between gap-2 hover:bg-slate-900">
                            <div className="flex items-center gap-2 min-w-0">
                              <Disc className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="font-bold text-white truncate">{cd.title}</p>
                                <p className="text-slate-400 truncate text-[11px]">
                                  {cd.artist}
                                  {cd.releaseDate ? ` (CD: ${cd.releaseDate})` : ''}
                                  {cd.vinylRecordReleaseDate
                                    ? ` • ${cd.vinylRecordFormat || 'LP/EP'}: ${cd.vinylRecordReleaseDate}${cd.vinylRecordCatalogNumber ? ` [${cd.vinylRecordCatalogNumber}]` : ''}`
                                    : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800 font-mono font-bold">
                                {cd.tracks?.length || 0} 曲
                              </span>
                              <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-800">
                                {cd.catalogNumber || '型番なし'}
                              </span>
                            </div>
                          </div>
                        ))}
                        {csvParsedInfo.cds.length > 8 && (
                          <div className="p-2 text-center text-[11px] text-slate-500 bg-slate-900/50">
                            ...他 {csvParsedInfo.cds.length - 8} 件
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleExecuteCSVSyncToLibrary}
                        disabled={isSyncingToLibrary}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white shadow-lg shadow-indigo-900/40 disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {isSyncingToLibrary ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>ライブラリデータベースに同期中...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>CSVから読み込んだ {csvParsedInfo.totalAlbums} 件（全 {csvParsedInfo.totalTracks} 曲）をライブラリに登録・反映する</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* D. JSON IMPORT */}
              {importSourceType === 'json' && (
                <div className="space-y-4 pt-1 animate-in fade-in duration-150">
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-amber-500/30 text-xs text-slate-300 space-y-1">
                    <p className="font-bold text-amber-300 flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5 text-amber-400" />
                      <span>JSONデータのファイル選択またはテキスト直貼り復元</span>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      バックアップされた `.json` ファイルをドロップするか、JSON文字列を直接テキストエリアに貼り付けて一元取り込み・復元できます。
                    </p>
                  </div>

                  {/* Dropzone for JSON file */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleProcessJSONInput(undefined, file);
                    }}
                    onClick={() => jsonFileInputRef.current?.click()}
                    className="border-2 border-dashed border-amber-600/50 hover:border-amber-400 bg-slate-950/60 hover:bg-slate-900/80 p-5 rounded-2xl text-center space-y-2 cursor-pointer transition-all"
                  >
                    <input
                      ref={jsonFileInputRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleProcessJSONInput(undefined, file);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-500/40 flex items-center justify-center mx-auto text-amber-400">
                      <FileJson className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">
                        {jsonImportFile ? `選択中: ${jsonImportFile.name}` : 'JSONバックアップファイルをここにドロップ'}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        または クリックしてファイルを選択 (.json)
                      </p>
                    </div>
                  </div>

                  {/* OR Textarea for Raw JSON */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-slate-300">
                        または JSONテキストを直接貼り付け:
                      </label>
                      {jsonTextInput && (
                        <button
                          type="button"
                          onClick={() => setJsonTextInput('')}
                          className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 bg-slate-800 rounded cursor-pointer"
                        >
                          クリア
                        </button>
                      )}
                    </div>
                    <textarea
                      value={jsonTextInput}
                      onChange={(e) => setJsonTextInput(e.target.value)}
                      placeholder='{\n  "cds": [\n    { "title": "...", "artist": "...", "tracks": [...] }\n  ]\n}'
                      rows={4}
                      className="w-full bg-slate-800/90 border border-slate-700 focus:border-amber-500 rounded-xl py-2 px-3 text-xs text-white font-mono placeholder:text-slate-600"
                    />
                    <button
                      type="button"
                      onClick={() => handleProcessJSONInput(jsonTextInput)}
                      disabled={!jsonTextInput.trim() || isParsingJSON}
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 active:scale-98 text-white shadow-md disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Code className="w-3.5 h-3.5" />
                      <span>貼り付けたJSONテキストを解析</span>
                    </button>
                  </div>

                  {isParsingJSON && (
                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-center text-xs text-amber-300 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                      <span>JSON構文を解析・検証しています...</span>
                    </div>
                  )}

                  {/* JSON Parsed Preview */}
                  {jsonParsedInfo && (
                    <div className="bg-slate-950 border border-amber-500/50 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-xs font-bold text-amber-300">
                            {jsonParsedInfo.totalAlbums} 枚のCDアルバム（計 {jsonParsedInfo.totalTracks} 曲の収録曲）を検出
                          </span>
                        </div>
                        {jsonParsedInfo.exportedAt && (
                          <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                            バックアップ日時: {formatJSTShort(jsonParsedInfo.exportedAt)}
                          </span>
                        )}
                      </div>

                      <div className="max-h-44 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg text-xs">
                        {jsonParsedInfo.cds.slice(0, 8).map((cd, idx) => (
                          <div key={idx} className="p-2 flex items-center justify-between gap-2 hover:bg-slate-900">
                            <div className="flex items-center gap-2 min-w-0">
                              <Disc className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="font-bold text-white truncate">{cd.title}</p>
                                <p className="text-slate-400 truncate text-[11px]">
                                  {cd.artist}
                                  {cd.releaseDate ? ` (CD: ${cd.releaseDate})` : ''}
                                  {cd.vinylRecordReleaseDate
                                    ? ` • ${cd.vinylRecordFormat || 'LP/EP'}: ${cd.vinylRecordReleaseDate}${cd.vinylRecordCatalogNumber ? ` [${cd.vinylRecordCatalogNumber}]` : ''}`
                                    : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800 font-mono font-bold">
                                {cd.tracks?.length || 0} 曲
                              </span>
                              <span className="text-[10px] font-mono text-amber-300 bg-amber-950 px-1.5 py-0.5 rounded border border-amber-800">
                                {cd.catalogNumber || '型番なし'}
                              </span>
                            </div>
                          </div>
                        ))}
                        {jsonParsedInfo.cds.length > 8 && (
                          <div className="p-2 text-center text-[11px] text-slate-500 bg-slate-900/50">
                            ...他 {jsonParsedInfo.cds.length - 8} 件
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleExecuteJSONSyncToLibrary}
                        disabled={isSyncingToLibrary}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 active:scale-98 text-white shadow-lg shadow-amber-900/40 disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {isSyncingToLibrary ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>ライブラリデータベースに同期中...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>JSONから解析した {jsonParsedInfo.totalAlbums} 件をライブラリに一括登録・復元する</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Import Success Message */}
              {importResult && (
                <div className="bg-emerald-950/80 border border-emerald-500/50 p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>「{importResult.title}」から {importResult.count} 件のCDデータをライブラリに正常に登録・同期しました！</span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    登録済みライブラリ一覧に即座に反映されました。
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Export Success Result Banner for Google Sheets */}
          {exportResult && activeTab === 'export' && exportTargetType === 'sheets' && (
            <div className="bg-emerald-950/80 border border-emerald-500/50 p-4 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>スプレッドシートに {exportResult.count} 枚のアルバムと {exportResult.totalTracksAdded || 0} 曲の収録曲を正常に出力しました！</span>
              </div>
              <div className="text-[11px] text-slate-300 space-y-1 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 font-mono">
                <p className="text-emerald-300 font-bold flex items-center gap-1.5">
                  <span>📁 シート1「CDアルバム一覧」:</span>
                  <span className="text-slate-300">{exportResult.count} 枚のアルバムマスター</span>
                </p>
                <p className="text-teal-300 font-bold flex items-center gap-1.5">
                  <span>🎵 シート2「収録曲リスト」:</span>
                  <span className="text-slate-300">{exportResult.totalTracksAdded || 0} 曲のトラック明細（型番キー紐付け・曲順・曲名・時間）</span>
                </p>
              </div>
              <a
                href={exportResult.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Googleスプレッドシートを開く ➔</span>
              </a>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="bg-rose-950/80 border border-rose-500/50 p-3 rounded-xl flex items-center gap-2 text-rose-200 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 cursor-pointer"
          >
            閉じる
          </button>

          {activeTab === 'export' && exportTargetType === 'sheets' && (
            <button
              onClick={handleExecuteExport}
              disabled={isExporting || itemsToExport.length === 0}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 disabled:opacity-50 transition-all cursor-pointer"
            >
              {isExporting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Google Sheets API書き込み中...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>スプレッドシートへ書き出し実行</span>
                </>
              )}
            </button>
          )}
        </div>

      </div>

      {/* Confirmation Modal for Cleaning Duplicate Files */}
      {showConfirmCleanModal && (
        <div className="fixed inset-0 z-60 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-600/50 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-600/20 border border-rose-500/40 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">重複スプレッドシートの削除・整理</h3>
                <p className="text-xs text-slate-400">Google Driveの古い重複ファイルを削除します</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 p-3 rounded-xl border border-slate-800">
              同名で作成された古いスプレッドシート（計 <strong>{duplicateOlderFilesCount} 件</strong>）をGoogle Driveから削除します。<br />
              <strong className="text-emerald-400">※ 各タイトルの最新1件はそのまま保持されます。</strong><br />
              この操作を実行してもよろしいですか？
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmCleanModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleExecuteCleanDuplicates}
                disabled={isCleaningDuplicates}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/40 cursor-pointer"
              >
                {isCleaningDuplicates ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>削除中...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>重複 {duplicateOlderFilesCount}件 を削除実行</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
