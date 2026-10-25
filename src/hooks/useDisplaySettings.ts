import { useCallback, useEffect, useState } from 'react';
import { settingsStore, STORAGE_KEYS } from '../lib/settingsStore';

/**
 * 画面の表示設定（ダーク/ライトテーマ・コンパクトヘッダー・検索パネルの折りたたみ）。
 * 設定ストアに保存し、起動時に復元する。テーマとヘッダーは <html> のクラスにも反映する。
 * state の更新関数の中で副作用（トースト表示など）を呼ばないよう、現在値から次の値を計算している。
 */
export function useDisplaySettings(showToast: (message: string, durationMs?: number) => void) {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => settingsStore.getString(STORAGE_KEYS.appTheme) !== 'light');
  const [isCompactHeader, setIsCompactHeader] = useState<boolean>(() =>
    settingsStore.getBool(STORAGE_KEYS.headerCompact, false)
  );
  const [isSearchPanelCollapsed, setIsSearchPanelCollapsed] = useState<boolean>(() =>
    settingsStore.getBool(STORAGE_KEYS.searchPanelCollapsed, false)
  );

  useEffect(() => {
    document.documentElement.classList.toggle('light-theme', !isDarkMode);
    settingsStore.setString(STORAGE_KEYS.appTheme, isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    document.documentElement.classList.toggle('compact-header', isCompactHeader);
    settingsStore.setBool(STORAGE_KEYS.headerCompact, isCompactHeader);
  }, [isCompactHeader]);

  const toggleTheme = useCallback(() => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    showToast(next ? '🌙 ダークモードに切り替えました' : '🌤️ おとなしいライトモード（低刺激・ソフトトーン）に切り替えました', 2500);
  }, [isDarkMode, showToast]);

  const toggleCompactHeader = useCallback(() => {
    const next = !isCompactHeader;
    setIsCompactHeader(next);
    showToast(next ? 'ヘッダーをコンパクト表示にしました' : 'ヘッダーを標準サイズに戻しました', 2500);
  }, [isCompactHeader, showToast]);

  /** collapsed を省略すると反転する */
  const toggleSearchPanelCollapse = useCallback(
    (collapsed?: boolean) => {
      const next = typeof collapsed === 'boolean' ? collapsed : !isSearchPanelCollapsed;
      setIsSearchPanelCollapsed(next);
      settingsStore.setBool(STORAGE_KEYS.searchPanelCollapsed, next);
    },
    [isSearchPanelCollapsed]
  );

  return {
    isDarkMode,
    toggleTheme,
    isCompactHeader,
    toggleCompactHeader,
    isSearchPanelCollapsed,
    toggleSearchPanelCollapse,
  };
}
