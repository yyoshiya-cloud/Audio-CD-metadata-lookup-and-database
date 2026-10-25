import React from 'react';
import type { APISource, CDMetadata } from '../../types/cd';

interface SourceComparisonTabProps {
  cd: CDMetadata;
  sourceNames: Record<APISource, string>;
}

/** 「API間比較」タブ: 各APIが返した個別のメタデータを並べて比較する */
export const SourceComparisonTab: React.FC<SourceComparisonTabProps> = ({ cd, sourceNames }) => {
  return (
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          各APIが返した個別のメタデータ項目です。違いを確認できます:
        </p>

        <div className="overflow-x-auto bg-slate-800/50 rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300 min-w-[600px]">
            <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] border-b border-slate-700">
              <tr>
                <th className="py-2.5 px-4 w-32">API</th>
                <th className="py-2.5 px-4">タイトル</th>
                <th className="py-2.5 px-4">アーティスト</th>
                <th className="py-2.5 px-4">型番</th>
                <th className="py-2.5 px-4">発売年/日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {(['musicbrainz', 'discogs', 'itunes', 'ndl', 'spotify', 'rakuten'] as APISource[]).map((src) => {
                const raw = cd.rawSources?.[src];
                return (
                  <tr key={src} className={raw ? 'hover:bg-slate-800/60' : 'opacity-40'}>
                    <td className="py-2.5 px-4 font-semibold text-white">
                      {sourceNames[src]}
                    </td>
                    <td className="py-2.5 px-4">{raw?.title || '-'}</td>
                    <td className="py-2.5 px-4">{raw?.artist || '-'}</td>
                    <td className="py-2.5 px-4 font-mono text-indigo-300">{raw?.catalogNumber || '-'}</td>
                    <td className="py-2.5 px-4">{raw?.releaseDate || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
  );
};
