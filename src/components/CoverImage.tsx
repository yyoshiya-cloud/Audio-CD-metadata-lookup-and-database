import React, { useEffect, useMemo, useState } from 'react';
import { Disc } from 'lucide-react';
import type { CDMetadata } from '../types/cd';

/** 表示するジャケットURLの一覧（現在のcoverUrlを先頭に、検索で見つかった他ソースのURLを続ける） */
export function coverUrlsOf(cd: Pick<CDMetadata, 'coverUrl' | 'coverCandidates'>): string[] {
  return [cd.coverUrl, ...(cd.coverCandidates || [])].filter((u): u is string => Boolean(u));
}

interface CoverImageProps {
  /** 優先順のURL一覧。読み込めなければ次のURLに切り替える */
  urls: string[];
  alt: string;
  className?: string;
  /** 画面上部の画像は遅延読み込みせず先に取得する */
  eager?: boolean;
  /** 全て失敗したとき/URLが無いときの表示ラベル */
  placeholderLabel?: string;
  iconClassName?: string;
}

const DIRECT_TIMEOUT_MS = 5000; // ブラウザ直接取得: 応答が無いホストで待ち続けない
const PROXY_TIMEOUT_MS = 9000; // サーバー経由（サーバー側の上限8秒より少し長く）

type Attempt = { src: string; viaProxy: boolean };

/**
 * ジャケット画像。
 * 1) 全URLを順にブラウザから直接取得 → 2) 全て失敗したら全URLを順にサーバープロキシ経由で取得
 * → 3) それでも駄目なら「No Artwork」を表示（黒い空白にしない）。
 * 各試行にタイムアウトがあり、読み込み中はアイコンを表示する。
 */
export const CoverImage: React.FC<CoverImageProps> = ({
  urls,
  alt,
  className = 'w-full h-full',
  eager = false,
  placeholderLabel,
  iconClassName = 'w-8 h-8',
}) => {
  const urlsKey = urls.join('\n');
  const attempts = useMemo<Attempt[]>(() => {
    const list: string[] = Array.from(new Set<string>(urls));
    const direct = list.map((src) => ({ src, viaProxy: false }));
    const proxied = list
      .filter((u) => !u.startsWith('data:'))
      .map((u) => ({ src: `/api/image-proxy?url=${encodeURIComponent(u)}`, viaProxy: true }));
    return [...direct, ...proxied];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // URLが変わったら最初からやり直す
  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [urlsKey]);

  const current = attempts[index];

  // 応答が無いまま固まった場合に次の候補へ進める
  useEffect(() => {
    if (!current || loaded) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), current.viaProxy ? PROXY_TIMEOUT_MS : DIRECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [current, loaded]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-slate-900">
      {/* 読み込み中・失敗時の下地 */}
      {!loaded && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center text-slate-600 p-2 text-center ${
            current ? 'animate-pulse' : ''
          }`}
        >
          <Disc className={`${iconClassName} opacity-50`} />
          {!current && placeholderLabel && <span className="text-[10px] mt-1 text-slate-500">{placeholderLabel}</span>}
        </div>
      )}
      {current && (
        <img
          key={current.src}
          src={current.src}
          alt={alt}
          className={`${className} object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          referrerPolicy="no-referrer"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // @ts-ignore fetchPriority は新しめの属性（型定義が古い環境向け）
          fetchPriority={eager ? 'high' : 'auto'}
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((i) => i + 1)}
        />
      )}
    </div>
  );
};
