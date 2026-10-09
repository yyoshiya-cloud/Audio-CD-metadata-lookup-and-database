import React, { useState, useMemo, useEffect } from 'react';
import { CDMetadata } from '../types/cd';
import { normalizeSingleTag, normalizeTagList } from '../lib/tagNormalizer';
import { loadTagPresetsDB, saveTagPresetsDB, DEFAULT_TAG_PRESETS } from '../lib/db';
import {
  X,
  Tag,
  Plus,
  Edit3,
  Trash2,
  Check,
  Sparkles,
  Loader2,
  RotateCcw,
} from 'lucide-react';

interface TagManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  allCDs: CDMetadata[];
  onBatchUpdateCDs: (updatedCDs: CDMetadata[]) => Promise<void>;
  onTagPresetsUpdated?: (presets: string[]) => void;
}

export const TagManagerModal: React.FC<TagManagerModalProps> = ({
  isOpen,
  onClose,
  allCDs,
  onBatchUpdateCDs,
  onTagPresetsUpdated,
}) => {
  const [presets, setPresets] = useState<string[]>(DEFAULT_TAG_PRESETS);
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadTagPresetsDB().then((loaded) => setPresets(loaded));
      setEditingTag(null);
      setEditingValue('');
      setStatusMessage(null);
    }
  }, [isOpen]);

  // Count usage of every tag across all CDs + include presets
  const tagStats = useMemo(() => {
    const countMap = new Map<string, number>();
    presets.forEach((p) => {
      const cleaned = normalizeSingleTag(p, { preserveCustomName: true });
      if (cleaned && !countMap.has(cleaned)) {
        countMap.set(cleaned, 0);
      }
    });

    allCDs.forEach((cd) => {
      const cdTags = normalizeTagList(cd.tags || [], { preserveCustomName: true });
      cdTags.forEach((t) => {
        countMap.set(t, (countMap.get(t) || 0) + 1);
      });
    });

    return Array.from(countMap.entries())
      .map(([name, count]) => ({
        name,
        count,
        isPreset: presets.includes(name),
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, 'ja');
      });
  }, [allCDs, presets]);

  if (!isOpen) return null;

  const showTempStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleAddNewTagPreset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = normalizeSingleTag(newTagName, { preserveCustomName: true });
    if (!cleaned) return;

    if (presets.includes(cleaned)) {
      showTempStatus(`タグ「#${cleaned}」は既に登録されています`);
      setNewTagName('');
      return;
    }

    const updatedPresets = [cleaned, ...presets];
    setPresets(updatedPresets);
    await saveTagPresetsDB(updatedPresets);
    if (onTagPresetsUpdated) onTagPresetsUpdated(updatedPresets);
    setNewTagName('');
    showTempStatus(`新しいタグ名称「#${cleaned}」を追加しました！`);
  };

  const handleConfirmRenameTag = async (oldName: string) => {
    const cleanedNew = normalizeSingleTag(editingValue, { preserveCustomName: true });
    if (!cleanedNew || cleanedNew === oldName) {
      setEditingTag(null);
      setEditingValue('');
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Update presets list
      const updatedPresets = Array.from(
        new Set(presets.map((p) => (p === oldName ? cleanedNew : p)))
      );
      if (!updatedPresets.includes(cleanedNew)) {
        updatedPresets.unshift(cleanedNew);
      }
      setPresets(updatedPresets);
      await saveTagPresetsDB(updatedPresets);
      if (onTagPresetsUpdated) onTagPresetsUpdated(updatedPresets);

      // 2. Rename tag across all CDs that use oldName
      const affectedCDs: CDMetadata[] = [];
      const nowIso = new Date().toISOString();

      for (const cd of allCDs) {
        const currentTags = normalizeTagList(cd.tags || [], { preserveCustomName: true });
        const hasTag = currentTags.includes(oldName);
        const hasGenre = cd.genre === oldName;
        const hasAiGenre = cd.aiTagAnalysis?.genre === oldName;
        const hasAiSubGenre = cd.aiTagAnalysis?.subGenre === oldName;
        const hasEvidence = cd.aiTagAnalysis?.tagEvidence?.some((ev) => ev.tag === oldName);

        if (hasTag || hasGenre || hasAiGenre || hasAiSubGenre || hasEvidence) {
          const nextTags = normalizeTagList(
            currentTags.map((t) => (t === oldName ? cleanedNew : t)),
            { preserveCustomName: true }
          );
          const nextGenre = cd.genre === oldName ? cleanedNew : cd.genre;
          const nextAiAnalysis = cd.aiTagAnalysis
            ? {
                ...cd.aiTagAnalysis,
                genre: cd.aiTagAnalysis.genre === oldName ? cleanedNew : cd.aiTagAnalysis.genre,
                subGenre: cd.aiTagAnalysis.subGenre === oldName ? cleanedNew : cd.aiTagAnalysis.subGenre,
                tagEvidence: (cd.aiTagAnalysis.tagEvidence || []).map((ev) =>
                  ev.tag === oldName ? { ...ev, tag: cleanedNew } : ev
                ),
              }
            : undefined;

          affectedCDs.push({
            ...cd,
            tags: nextTags,
            genre: nextGenre,
            aiTagAnalysis: nextAiAnalysis,
            updatedAt: nowIso,
          });
        }
      }

      if (affectedCDs.length > 0) {
        await onBatchUpdateCDs(affectedCDs);
      }

      setEditingTag(null);
      setEditingValue('');
      showTempStatus(
        `タグ名称を「#${oldName}」→「#${cleanedNew}」に変更しました（対象CD: ${affectedCDs.length}件）`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteTagEverywhere = async (tagToDelete: string, count: number) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const updatedPresets = presets.filter((p) => p !== tagToDelete);
      setPresets(updatedPresets);
      await saveTagPresetsDB(updatedPresets);
      if (onTagPresetsUpdated) onTagPresetsUpdated(updatedPresets);

      const affectedCDs: CDMetadata[] = [];
      const nowIso = new Date().toISOString();
      const decadeRegex = /^(19\d0|20\d0|[56789]0)年代$/;

      if (count > 0) {
        for (const cd of allCDs) {
          const currentTags = normalizeTagList(cd.tags || [], { preserveCustomName: true });
          if (currentTags.includes(tagToDelete) || cd.genre === tagToDelete) {
            const nextTags = currentTags.filter((t) => t !== tagToDelete);
            const nextGenre =
              cd.genre === tagToDelete
                ? nextTags.find((t) => !decadeRegex.test(t) && t !== '邦楽') || nextTags[0] || ''
                : cd.genre;
            const nextAiAnalysis = cd.aiTagAnalysis
              ? {
                  ...cd.aiTagAnalysis,
                  genre:
                    cd.aiTagAnalysis.genre === tagToDelete ? nextGenre : cd.aiTagAnalysis.genre,
                  subGenre:
                    cd.aiTagAnalysis.subGenre === tagToDelete
                      ? undefined
                      : cd.aiTagAnalysis.subGenre,
                  tagEvidence: (cd.aiTagAnalysis.tagEvidence || []).filter(
                    (ev) => ev.tag !== tagToDelete
                  ),
                }
              : undefined;

            affectedCDs.push({
              ...cd,
              tags: nextTags,
              genre: nextGenre,
              aiTagAnalysis: nextAiAnalysis,
              updatedAt: nowIso,
            });
          }
        }

        if (affectedCDs.length > 0) {
          await onBatchUpdateCDs(affectedCDs);
        }
      }

      showTempStatus(
        `タグ「#${tagToDelete}」を削除しました（対象CD: ${affectedCDs.length}件）`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetDefaultPresets = async () => {
    const merged = Array.from(new Set([...DEFAULT_TAG_PRESETS, ...presets]));
    setPresets(merged);
    await saveTagPresetsDB(merged);
    if (onTagPresetsUpdated) onTagPresetsUpdated(merged);
    showTempStatus('標準プリセットタグを復元しました');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/90 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 my-auto max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-950/90 border-b border-slate-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>タグ名称の追加・変更・一括管理</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-600 text-white font-mono">
                  全 {tagStats.length} 種
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                新しいタグ名称の登録や、既存タグ名称の一括変更（リネーム）・削除が行えます
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {statusMessage && (
            <div className="bg-emerald-950/90 border border-emerald-500/50 rounded-xl p-3 text-xs text-emerald-200 font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Add New Tag Name Form */}
          <form onSubmit={handleAddNewTagPreset} className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2.5">
            <label className="block text-xs font-bold text-indigo-300 flex items-center justify-between">
              <span>＋ 新しいタグ名称を追加登録（クイック選択候補に追加されます）</span>
              <button
                type="button"
                onClick={handleResetDefaultPresets}
                className="text-[11px] text-slate-400 hover:text-indigo-300 flex items-center gap-1 font-normal cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>標準タグ候補を復元</span>
              </button>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="例: 70年代アイドル, 関西フォーク, 初回限定盤, 紙ジャケ, 和モノ..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!newTagName.trim() || isProcessing}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>タグ名称を追加</span>
              </button>
            </div>
          </form>

          {/* Tag List with Rename & Delete */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">
                登録済みタグ一覧（鉛筆アイコンでタグ名称を変更すると全CDの該当タグが一括更新されます）
              </span>
              {isProcessing && (
                <span className="text-xs text-indigo-300 flex items-center gap-1 font-bold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  DB更新中...
                </span>
              )}
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-xl divide-y divide-slate-800/80 max-h-[380px] overflow-y-auto">
              {tagStats.map((item) => {
                const isEditingThis = editingTag === item.name;
                return (
                  <div
                    key={item.name}
                    className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors"
                  >
                    {isEditingThis ? (
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-xs font-bold text-indigo-400">#</span>
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleConfirmRenameTag(item.name);
                            } else if (e.key === 'Escape') {
                              setEditingTag(null);
                              setEditingValue('');
                            }
                          }}
                          autoFocus
                          className="flex-1 bg-slate-900 border border-indigo-500 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleConfirmRenameTag(item.name)}
                          disabled={isProcessing || !editingValue.trim()}
                          className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>名称変更を適用</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTag(null);
                            setEditingValue('');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="inline-flex items-center gap-1 text-xs font-bold bg-slate-800 text-indigo-200 border border-slate-700 px-2.5 py-1 rounded-full">
                            #{item.name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            使用CD: <strong className="text-white">{item.count}</strong> 件
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTag(item.name);
                              setEditingValue(item.name);
                            }}
                            disabled={isProcessing}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="このタグの名称を変更（該当する全CDのタグ名も自動変更されます）"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>名称変更</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteTagEverywhere(item.name, item.count)}
                            disabled={isProcessing}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 border border-slate-700 transition-colors cursor-pointer"
                            title="このタグを削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-950/90 border-t border-slate-800 px-6 py-3.5 flex items-center justify-end flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 cursor-pointer"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
