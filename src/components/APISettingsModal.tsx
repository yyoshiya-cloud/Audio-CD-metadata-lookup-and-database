import React, { useState } from 'react';
import { isSourceEnabled } from '../config/sources';
import { APICredentials } from '../types/cd';
import type { ConfigStatus } from '../types/config';
import { X, Key, ExternalLink, Check, ShieldCheck, Info, Eye, EyeOff } from 'lucide-react';

interface APISettingsModalProps {
  credentials: APICredentials;
  onSaveCredentials: (updated: APICredentials) => void;
  onClose: () => void;
  /** サーバーの環境変数で設定済みのAPIキーの有無（取得できなければ null） */
  serverConfig?: ConfigStatus | null;
  /** ブラウザに保存したAPIキーをすべて削除する */
  onClearStoredKeys?: () => void;
}

/** 「サーバーの環境変数で設定済み」バッジ */
const ServerConfiguredBadge: React.FC<{ show?: boolean }> = ({ show }) =>
  show ? (
    <span
      className="text-[10px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap"
      title="サーバーの環境変数に設定済みです。ブラウザへの入力は不要です（入力した場合は、入力した値が優先されます）"
    >
      <Check className="w-3 h-3" /> サーバーで設定済み
    </span>
  ) : null;

export const APISettingsModal: React.FC<APISettingsModalProps> = ({
  credentials,
  onSaveCredentials,
  onClose,
  serverConfig,
  onClearStoredKeys,
}) => {
  const storedKeyCount = Object.values(credentials).filter(Boolean).length;
  const [spotifyClientId, setSpotifyClientId] = useState(credentials.spotifyClientId || '');
  const [showSpotifyClientId, setShowSpotifyClientId] = useState(false);
  const [spotifyClientSecret, setSpotifyClientSecret] = useState(credentials.spotifyClientSecret || '');
  const [showSpotifySecret, setShowSpotifySecret] = useState(false);
  const [discogsToken, setDiscogsToken] = useState(credentials.discogsToken || '');
  const [showDiscogsToken, setShowDiscogsToken] = useState(false);
  const [rakutenAppId, setRakutenAppId] = useState(credentials.rakutenAppId || '');
  const [showRakutenAppId, setShowRakutenAppId] = useState(false);
  const [musicbrainzEmail, setMusicbrainzEmail] = useState(credentials.musicbrainzEmail || '');

  const [testStatus, setTestStatus] = useState<Record<string, { loading: boolean; success?: boolean; msg?: string }>>({});

  const handleSave = () => {
    const updated: APICredentials = {
      spotifyClientId: spotifyClientId.trim() || undefined,
      spotifyClientSecret: spotifyClientSecret.trim() || undefined,
      discogsToken: discogsToken.trim() || undefined,
      rakutenAppId: rakutenAppId.trim() || undefined,
      musicbrainzEmail: musicbrainzEmail.trim() || undefined,
    };
    onSaveCredentials(updated);
    onClose();
  };

  const handleTestKey = async (apiName: 'spotify' | 'discogs' | 'rakuten') => {
    setTestStatus((prev) => ({ ...prev, [apiName]: { loading: true } }));

    try {
      if (apiName === 'spotify') {
        if (!spotifyClientId || !spotifyClientSecret) {
          throw new Error('Client IDとClient Secretの両方を入力してください。');
        }
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'First Love',
            sources: ['spotify'],
            apiKeys: { spotifyClientId, spotifyClientSecret },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Spotify APIエラー (HTTP ${res.status})`);
        // 検索APIは常に200を返し、各ソースの失敗は sourceResults.<ソース>.error に入る
        const spotifyResult = data.sourceResults?.spotify;
        if (spotifyResult?.error) throw new Error(spotifyResult.error);
        setTestStatus((prev) => ({ ...prev, spotify: { loading: false, success: true, msg: '認証成功！' } }));
      } else if (apiName === 'discogs') {
        if (!discogsToken.trim() && !serverConfig?.discogs) {
          throw new Error('Personal Access Token (または Key:Secret) を入力してください。');
        }
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogNumber: 'VICL-60001',
            sources: ['discogs'],
            // 未入力でもサーバーの環境変数が設定済みなら、そのキーでテストされる
            apiKeys: discogsToken.trim() ? { discogsToken: discogsToken.trim() } : undefined,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Discogs APIエラー (HTTP ${res.status})`);
        }

        const discogsResult = data.sourceResults?.discogs;
        if (discogsResult?.error) {
          throw new Error(discogsResult.error);
        }

        const count = discogsResult?.count || 0;
        setTestStatus((prev) => ({
          ...prev,
          discogs: {
            loading: false,
            success: true,
            msg: `Discogs認証・通信成功！ (${count > 0 ? `${count}件取得` : '通信OK'})`,
          },
        }));
      } else if (apiName === 'rakuten') {
        const appId = rakutenAppId.trim();
        if (!appId) throw new Error('アプリケーションIDを入力してください。');
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'さくら',
            sources: ['rakuten'],
            apiKeys: { rakutenAppId: appId },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `楽天APIエラー (HTTP ${res.status})`);
        const rakutenResult = data.sourceResults?.rakuten;
        if (rakutenResult?.error) throw new Error(rakutenResult.error);
        setTestStatus((prev) => ({ ...prev, rakuten: { loading: false, success: true, msg: '楽天API通信成功！' } }));
      }
    } catch (err: any) {
      setTestStatus((prev) => ({
        ...prev,
        [apiName]: { loading: false, success: false, msg: err.message || '接続エラー' },
      }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-500/40 flex items-center justify-center">
              <Key className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                API利用登録
              </h2>
              <p className="text-xs text-slate-400">
                各音楽データベースAPIの利用登録キーを設定して、検索の成功率・速度・制限緩和を向上させます
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">

          {/* サーバーの環境変数（推奨の保管方法）とブラウザ保存キーの管理 */}
          <div className="bg-slate-800/60 border border-slate-700/80 p-4 rounded-xl space-y-2.5 text-xs text-slate-300">
            <h4 className="font-bold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              サーバーの環境変数で設定済みのAPIキー（推奨）
            </h4>
            {serverConfig ? (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                {([
                  ['Discogs（DISCOGS_TOKEN）', serverConfig.discogs],
                  ['Gemini AI（GEMINI_API_KEY）', serverConfig.gemini],
                  ['MusicBrainz連絡先（MB_CONTACT）', serverConfig.musicbrainzContact],
                  ...(isSourceEnabled('spotify') ? ([['Spotify', serverConfig.spotify]] as [string, boolean][]) : []),
                  ...(isSourceEnabled('rakuten') ? ([['楽天ブックス', serverConfig.rakuten]] as [string, boolean][]) : []),
                ] as [string, boolean][]).map(([label, ok]) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                    <span className={ok ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
                    <span className={ok ? 'text-emerald-300' : 'text-slate-500'}>{ok ? '設定済み' : '未設定'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-slate-500">サーバーの設定状況を取得できませんでした。</p>
            )}
            <p className="text-[11px] text-slate-400 leading-relaxed">
              サーバーの環境変数（<code className="font-mono">.env</code> またはホスティング先の環境変数）に設定したキーは、ブラウザへの入力なしで使われます。
              下の欄に入力した場合は、入力した値が優先されます。ブラウザに保存したキーは、悪意あるスクリプトが動いた場合に使われる恐れがあるため、公開して運用する場合は環境変数の利用を勧めます。
            </p>
            {onClearStoredKeys && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-slate-400">ブラウザに保存されているAPIキー: {storedKeyCount}件</span>
                <button
                  type="button"
                  disabled={storedKeyCount === 0}
                  onClick={() => {
                    if (window.confirm('ブラウザに保存したAPIキーをすべて削除します。サーバーの環境変数のキーは影響を受けません。よろしいですか？')) {
                      onClearStoredKeys();
                      onClose();
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-rose-900/60 hover:bg-rose-800/70 text-rose-100 border border-rose-700/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  ブラウザ保存のキーをすべて削除
                </button>
              </div>
            )}
          </div>

          <div className="bg-indigo-950/60 border border-indigo-500/30 p-3.5 rounded-xl flex items-start gap-3 text-xs text-indigo-200">
            <Info className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="leading-relaxed space-y-1">
              <p>
                <strong>キー未設定の場合でもパブリックアクセスで検索可能</strong>ですが、ご自身のAPIキーを登録することでレート制限を回避し、より安定・高速に横断検索が実行できます。
              </p>
              <p className="text-emerald-300 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>登録したAPIキーは暗号化してブラウザ内のIndexedDBに保存され、次回起動時も自動で読み込まれます。</span>
              </p>
            </div>
          </div>

          {/* 1. Spotify Web API（無効化中: src/config/sources.ts の ENABLED_SOURCES に 'spotify' を追加すると再表示） */}
          {isSourceEnabled('spotify') && (
            <div className="bg-slate-800/60 border border-slate-700/80 p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <h3 className="text-xs font-bold text-white">Spotify Web API (ストリーミング・高画質ジャケット)</h3>
                <ServerConfiguredBadge show={serverConfig?.spotify} />
                </div>
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 font-medium"
                >
                  キー発行画面 (Dashboard) <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Spotify Client ID
                  </label>
                  <div className="relative">
                    <input
                      type={showSpotifyClientId ? 'text' : 'password'}
                      value={spotifyClientId}
                      onChange={(e) => setSpotifyClientId(e.target.value)}
                      placeholder="32桁のClient ID"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 pr-9 text-xs text-white font-mono focus:border-indigo-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSpotifyClientId(!showSpotifyClientId)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                      title={showSpotifyClientId ? 'IDを隠す' : 'IDを表示する'}
                    >
                      {showSpotifyClientId ? (
                        <EyeOff className="w-4 h-4 text-slate-300" />
                      ) : (
                        <Eye className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Spotify Client Secret
                  </label>
                  <div className="relative">
                    <input
                      type={showSpotifySecret ? 'text' : 'password'}
                      value={spotifyClientSecret}
                      onChange={(e) => setSpotifyClientSecret(e.target.value)}
                      placeholder="32桁のClient Secret"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 pr-9 text-xs text-white font-mono focus:border-indigo-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSpotifySecret(!showSpotifySecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                      title={showSpotifySecret ? 'パスワードを隠す' : 'パスワードを表示する'}
                    >
                      {showSpotifySecret ? (
                        <EyeOff className="w-4 h-4 text-slate-300" />
                      ) : (
                        <Eye className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => handleTestKey('spotify')}
                  className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-200"
                >
                  接続テスト
                </button>
                {testStatus.spotify && (
                  <span className={`text-xs font-bold ${testStatus.spotify.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {testStatus.spotify.loading ? '検証中...' : testStatus.spotify.msg}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 2. Discogs API */}
          <div className="bg-slate-800/60 border border-slate-700/80 p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h3 className="text-xs font-bold text-white">Discogs API (型番・マトリクス・盤面仕様)</h3>
                <ServerConfiguredBadge show={serverConfig?.discogs} />
              </div>
              <a
                href="https://www.discogs.com/settings/developers"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 font-medium"
              >
                Personal Token作成画面 <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-semibold text-slate-300">
                  Discogs Personal Token (または ConsumerKey:Secret)
                </label>
                <span className="text-[10px] text-slate-400">
                  ※Personal Token推奨
                </span>
              </div>
              <div className="relative">
                <input
                  type={showDiscogsToken ? 'text' : 'password'}
                  value={discogsToken}
                  onChange={(e) => setDiscogsToken(e.target.value)}
                  placeholder="Discogs Personal Access Token (または Key:Secret)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 pr-9 text-xs text-white font-mono focus:border-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowDiscogsToken(!showDiscogsToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                  title={showDiscogsToken ? 'トークンを隠す' : 'トークンを表示する'}
                >
                  {showDiscogsToken ? (
                    <EyeOff className="w-4 h-4 text-slate-300" />
                  ) : (
                    <Eye className="w-4 h-4 text-slate-400" />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Discogs開発者画面で「Generate new token」を押して取得した文字列、または <code className="text-indigo-300 font-mono">キー:シークレット</code> を入力できます。
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => handleTestKey('discogs')}
                className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-200"
              >
                接続テスト
              </button>
              {testStatus.discogs && (
                <span className={`text-xs font-bold ${testStatus.discogs.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testStatus.discogs.loading ? '検証中...' : testStatus.discogs.msg}
                </span>
              )}
            </div>
          </div>

          {/* 3. 楽天ブックス CD検索 API（無効化中: ENABLED_SOURCES に 'rakuten' を追加すると再表示） */}
          {isSourceEnabled('rakuten') && (
            <div className="bg-slate-800/60 border border-slate-700/80 p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                  <h3 className="text-xs font-bold text-white">楽天ブックス CD検索 API (JANコード・国内発売元)</h3>
                <ServerConfiguredBadge show={serverConfig?.rakuten} />
                </div>
                <a
                  href="https://webservice.rakuten.co.jp/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 font-medium"
                >
                  楽天デベロッパー登録 <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Rakuten Application ID (アプリID)
                </label>
                <div className="relative">
                  <input
                    type={showRakutenAppId ? 'text' : 'password'}
                    value={rakutenAppId}
                    onChange={(e) => setRakutenAppId(e.target.value)}
                    placeholder="未入力時は内蔵パブリックIDが自動適用されます"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 pr-9 text-xs text-white font-mono focus:border-indigo-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRakutenAppId(!showRakutenAppId)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                    title={showRakutenAppId ? 'アプリIDを隠す' : 'アプリIDを表示する'}
                  >
                    {showRakutenAppId ? (
                      <EyeOff className="w-4 h-4 text-slate-300" />
                    ) : (
                      <Eye className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => handleTestKey('rakuten')}
                  className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-200"
                >
                  接続テスト
                </button>
                {testStatus.rakuten && (
                  <span className={`text-xs font-bold ${testStatus.rakuten.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {testStatus.rakuten.loading ? '検証中...' : testStatus.rakuten.msg}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 4. MusicBrainz, iTunes, NDL Public Info */}
          <div className="bg-slate-800/40 border border-slate-700/60 p-4 rounded-xl space-y-2 text-xs text-slate-300">
            <h4 className="font-bold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              登録不要で無料利用できるAPI:
            </h4>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
              <li><strong>iTunes Search API</strong>: 登録不要・完全オープンアクセス（高精細ジャケット写真）</li>
              <li><strong>国立国会図書館 (NDL) API</strong>: 登録不要・パブリックアクセス（国内CD型番・書誌情報）</li>
              <li><strong>MusicBrainz API</strong>: 登録不要（ユーザーエージェント自動設定済み）</li>
            </ul>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-800 bg-slate-800/50">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>API設定を保存して適用</span>
          </button>
        </div>

      </div>
    </div>
  );
};
