import type { APICredentials } from '../types/cd';

/**
 * 画面側で同期的にAPIキーが必要な箇所（バッチ処理の途中など）のための、メモリ上のコピー。
 * 保存先（暗号化した IndexedDB）から読み込んだ後に App が更新する。ストレージには書かない。
 */
let cached: APICredentials = {};

export const setCachedApiCredentials = (c: APICredentials): void => {
  cached = { ...c };
};

export const getCachedApiCredentials = (): APICredentials => cached;
