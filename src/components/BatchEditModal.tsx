import React, { useState, useMemo, useEffect } from 'react';
import { CDMetadata } from '../types/cd';
import { normalizeTagList, normalizeSingleTag, normalizeCDTagsAndGenre } from '../lib/tagNormalizer';
import { loadTagPresetsDB, saveTagPresetsDB, DEFAULT_TAG_PRESETS } from '../lib/db';
import {
  X,
  Tag,
  FileText,
  CheckCircle2,
  Plus,
  Trash2,
  RefreshCw,
  Disc,
  Loader2,
  Sparkles,
} from 'lucide-react';

interface BatchEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCDs: CDMetadata[];
  allCDs: CDMetadata[];
  onBatchUpdateCDs: (updatedCDs: CDMetadata[]) => Promise<void>;
}

type TagEditMode = 'add' | 'remove' | 'replace' | 'keep';
type NotesEditMode = 'keep' | 'append' | 'overwrite' | 'clear';

export const BatchEditModal: React.FC<BatchEditModalProps> = ({
  isOpen,
  onClose,
  selectedCDs,
  allCDs,
  onBatchUpdateCDs,
}) => {
  const [tagMode, setTagMode] = useState<TagEditMode>('add');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [customPresets, setCustomPresets] = useState<string[]>(DEFAULT_TAG_PRESETS);

  const [updateGenreToo, setUpdateGenreToo] = useState(false);
  const [genreValue, setGenreValue] = useState('');

  const [notesMode, setNotesMode] = useState<NotesEditMode>('keep');
  const [notesInput, setNotesInput] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadTagPresetsDB().then((loaded) => setCustomPresets(loaded));
    }
  }, [isOpen]);

  // Collect existing tags across selected CDs and across the entire library
  const existingTagsInSelected = useMemo(() => {
    const map = new Map<string, number>();
    selectedCDs.forEach((cd) => {
      const norms = normalizeTagList(cd.tags || [], { preserveCustomName: true });
      norms.forEach((t) => {
        map.set(t, (map.get(t) || 0) + 1);
      });
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [selectedCDs]);

  const allAvailableQuickTags = useMemo(() => {
    const set = new Set<string>(customPresets);
    allCDs.forEach((cd) => {
      normalizeTagList(cd.tags || [], { preserveCustomName: true }).forEach((t) => set.add(t));
    });
    return Array.from(set);
  }, [allCDs, customPresets]);

  if (!isOpen || selectedCDs.length === 0) return null;

  const toggleTagSelection = (rawTag: string) => {
    const norm = normalizeSingleTag(rawTag, { preserveCustomName: true });
    if (!norm) return;
    setSelectedTags((prev) =>
      prev.includes(norm) ? prev.filter((t) => t !== norm) : [...prev, norm]
    );
  };

  const handleAddCustomTags = () => {
    if (!customTagInput.trim()) return;
    const parsed = normalizeTagList(
      customTagInput
        .split(/[,、]/)
        .map((t) => t.trim())
        .filter(Boolean),
      { preserveCustomName: true }
    );
    if (parsed.length === 0) return;

    const nextPresets = Array.from(new Set([...parsed, ...customPresets]));
    setCustomPresets(nextPresets);
    saveTagPresetsDB(nextPresets);

    setSelectedTags((prev) => {
      const next = [...prev];
      parsed.forEach((t) => {
        if (!next.includes(t)) next.push(t);
      });
      return next;
    });
    setCustomTagInput('');
  };

  const handleQuickDeleteExistingTag = async (tagToRemove: string) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const normRemove = normalizeSingleTag(tagToRemove, { preserveCustomName: true });
      const updatedList: CDMetadata[] = selectedCDs.map((cd) => {
        const currentTags = normalizeTagList(cd.tags || [], { preserveCustomName: true });
        const nextTags = currentTags.filter((t) => t !== normRemove);
        let nextGenre = cd.genre ? normalizeSingleTag(cd.genre, { preserveCustomName: true }) : cd.genre;
        if (nextGenre === normRemove) {
          nextGenre =
            nextTags.find((t) => !/^(19\d0|20\d0|[56789]0)年代$/.test(t) && t !== '邦楽') ||
            nextTags[0] ||
            '';
        }
        return normalizeCDTagsAndGenre(
          {
            ...cd,
            tags: nextTags,
            genre: nextGenre,
            updatedAt: new Date().toISOString(),
          },
          { preserveUserTags: true }
        );
      });

      await onBatchUpdateCDs(updatedList);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExecuteBatchEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    // Also include any unconfirmed customTagInput if user typed and didn't press '+'
    const pendingCustom = customTagInput.trim()
      ? normalizeTagList(
          customTagInput
            .split(/[,、]/)
            .map((t) => t.trim())
            .filter(Boolean),
          { preserveCustomName: true }
        )
      : [];
    const targetTags = normalizeTagList([...selectedTags, ...pendingCustom], { preserveCustomName: true });

    if (pendingCustom.length > 0) {
      const nextPresets = Array.from(new Set([...pendingCustom, ...customPresets]));
      setCustomPresets(nextPresets);
      saveTagPresetsDB(nextPresets);
    }

    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString();

      const updatedCDs: CDMetadata[] = selectedCDs.map((cd) => {
        const currentTags = normalizeTagList(cd.tags || [], { preserveCustomName: true });
        let nextTags = [...currentTags];

        if (tagMode === 'add' && targetTags.length > 0) {
          nextTags = normalizeTagList([...currentTags, ...targetTags], { preserveCustomName: true });
        } else if (tagMode === 'remove' && targetTags.length > 0) {
          const removeSet = new Set(targetTags);
          nextTags = currentTags.filter((t) => !removeSet.has(t));
        } else if (tagMode === 'replace') {
          nextTags = [...targetTags];
        }

        // Sync genre if needed
        let nextGenre = cd.genre ? normalizeSingleTag(cd.genre, { preserveCustomName: true }) : cd.genre;
        if (updateGenreToo) {
          nextGenre = genreValue.trim() ? normalizeSingleTag(genreValue.trim(), { preserveCustomName: true }) : '';
          if (nextGenre && !nextTags.includes(nextGenre)) {
            nextTags = normalizeTagList([nextGenre, ...nextTags], { preserveCustomName: true });
          }
        } else if (tagMode === 'remove' && nextGenre && targetTags.includes(nextGenre)) {
          nextGenre =
            nextTags.find((t) => !/^(19\d0|20\d0|[56789]0)年代$/.test(t) && t !== '邦楽') ||
            nextTags[0] ||
            '';
        } else if (tagMode === 'replace') {
          nextGenre =
            nextTags.find((t) => !/^(19\d0|20\d0|[56789]0)年代$/.test(t) && t !== '邦楽') ||
            nextTags[0] ||
            nextGenre;
        }

        // Notes handling
        let nextNotes = cd.notes || '';
        const trimmedNotes = notesInput.trim();
        if (notesMode === 'append' && trimmedNotes) {
          nextNotes = nextNotes ? `${nextNotes}\n${trimmedNotes}` : trimmedNotes;
        } else if (notesMode === 'overwrite') {
          nextNotes = trimmedNotes;
        } else if (notesMode === 'clear') {
          nextNotes = '';
        }

        return normalizeCDTagsAndGenre(
          {
            ...cd,
            tags: nextTags,
            genre: nextGenre,
            notes: nextNotes,
            updatedAt: nowIso,
          },
          { preserveUserTags: true }
        );
      });

      await onBatchUpdateCDs(updatedCDs);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const canSubmit =
    (tagMode !== 'keep' && (selectedTags.length > 0 || customTagInput.trim().length > 0 || tagMode === 'replace')) ||
    updateGenreToo ||
    (notesMode !== 'keep' && (notesMode !== 'append' || notesInput.trim().length > 0));

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/90 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 my-auto">
        {/* Header */}
        <div className="bg-slate-950/90 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>選択CDのタグ・備考 一括編集</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-600 text-white font-mono">
                  {selectedCDs.length} 件選択中
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                選択した複数のCDに対して、タグ（アイドル、J-Pop等）・ジャンル・備考をまとめて追加・削除・更新します
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

        <form onSubmit={handleExecuteBatchEdit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Selected CDs Preview Strip */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            <div className="text-[11px] font-bold text-slate-400 mb-2 flex items-center justify-between">
              <span>編集対象のCD ({selectedCDs.length}枚)</span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {selectedCDs.slice(0, 12).map((cd) => (
                <div
                  key={cd.id}
                  className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 flex-shrink-0 max-w-[180px]"
                  title={`${cd.title} / ${cd.artist}`}
                >
                  {cd.coverUrl ? (
                    <img
                      src={cd.coverUrl}
                      alt={cd.title}
                      className="w-6 h-6 rounded object-cover flex-shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Disc className="w-5 h-5 text-slate-600 flex-shrink-0" />
                  )}
                  <div className="truncate text-[11px]">
                    <div className="font-bold text-slate-200 truncate">{cd.title}</div>
                    <div className="text-[10px] text-slate-400 truncate">{cd.artist}</div>
                  </div>
                </div>
              ))}
              {selectedCDs.length > 12 && (
                <span className="text-xs text-slate-400 font-mono px-2 flex-shrink-0">
                  他 +{selectedCDs.length - 12} 枚
                </span>
              )}
            </div>
          </div>

          {/* Current Tags on Selected CDs (One-click removal or selection) */}
          {existingTagsInSelected.length > 0 && (
            <div className="bg-slate-800/40 border border-slate-700/70 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>選択中のCDに現在付いているタグ（✕で選択CDから即削除）</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {existingTagsInSelected.map(([tag, count]) => (
                  <div
                    key={tag}
                    className="inline-flex items-center gap-1.5 bg-slate-900 border border-purple-500/40 text-purple-200 px-2.5 py-1 rounded-lg text-xs"
                  >
                    <span>#{tag}</span>
                    <span className="text-[10px] font-mono bg-purple-950/90 text-purple-300 px-1.5 py-0.2 rounded-full">
                      {count}枚
                    </span>
                    <button
                      type="button"
                      onClick={() => handleQuickDeleteExistingTag(tag)}
                      disabled={isSaving}
                      className="text-slate-400 hover:text-rose-400 ml-0.5 transition-colors cursor-pointer"
                      title={`選択したCDから「#${tag}」タグを一括削除`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 1: Tag Batch Operation */}
          <div className="space-y-3 bg-slate-800/30 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-indigo-400" />
                <span>1. タグの一括操作</span>
              </label>

              {/* Mode Selector */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setTagMode('add')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                    tagMode === 'add'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  タグを追加
                </button>
                <button
                  type="button"
                  onClick={() => setTagMode('remove')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                    tagMode === 'remove'
                      ? 'bg-rose-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Trash2 className="w-3 h-3" />
                  タグを削除
                </button>
                <button
                  type="button"
                  onClick={() => setTagMode('replace')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                    tagMode === 'replace'
                      ? 'bg-amber-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <RefreshCw className="w-3 h-3" />
                  すべて置換
                </button>
                <button
                  type="button"
                  onClick={() => setTagMode('keep')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    tagMode === 'keep'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  変更しない
                </button>
              </div>
            </div>

            {tagMode !== 'keep' && (
              <div className="space-y-3 pt-1">
                {/* Preset & Quick Select Chips */}
                <div>
                  <p className="text-[11px] text-slate-400 mb-2">
                    {tagMode === 'add' && 'クリックして追加するタグを選択（複数選択可）：'}
                    {tagMode === 'remove' && 'クリックして選択CDから削除するタグを選択（複数選択可）：'}
                    {tagMode === 'replace' && '既存のタグを消去し、ここで選択したタグのみに置き換えます：'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                    {allAvailableQuickTags.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTagSelection(tag)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                            isSelected
                              ? tagMode === 'remove'
                                ? 'bg-rose-600 text-white border-rose-400 shadow-sm'
                                : 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Tag Input */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomTags();
                      }
                    }}
                    placeholder="自由入力でタグを追加（カンマ区切りで複数可: 例 アイドル, J-Pop, 1980年代）"
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomTags}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-colors cursor-pointer"
                  >
                    候補に追加
                  </button>
                </div>

                {/* Selected Target Tags Preview */}
                {selectedTags.length > 0 && (
                  <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-bold text-slate-400 mr-1">
                        {tagMode === 'add' ? '追加するタグ:' : tagMode === 'remove' ? '削除するタグ:' : '置換後のタグ:'}
                      </span>
                      {selectedTags.map((tag) => (
                        <span
                          key={tag}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold ${
                            tagMode === 'remove'
                              ? 'bg-rose-950 text-rose-300 border border-rose-500/40'
                              : 'bg-indigo-950 text-indigo-200 border border-indigo-500/40'
                          }`}
                        >
                          #{tag}
                          <button
                            type="button"
                            onClick={() => toggleTagSelection(tag)}
                            className="hover:text-white ml-0.5 cursor-pointer"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedTags([])}
                      className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                    >
                      クリア
                    </button>
                  </div>
                )}

                {/* Optional Main Genre Field Sync */}
                <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={updateGenreToo}
                      onChange={(e) => setUpdateGenreToo(e.target.checked)}
                      className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>メインジャンル（genre項目）も一括指定する</span>
                  </label>
                  {updateGenreToo && (
                    <input
                      type="text"
                      value={genreValue}
                      onChange={(e) => setGenreValue(e.target.value)}
                      placeholder="例: J-Pop, アイドル, シティポップ..."
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Notes Batch Operation */}
          <div className="space-y-3 bg-slate-800/30 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>2. 備考（メモ）の一括編集</span>
              </label>

              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setNotesMode('keep')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    notesMode === 'keep'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  変更しない
                </button>
                <button
                  type="button"
                  onClick={() => setNotesMode('append')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    notesMode === 'append'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  末尾に追記
                </button>
                <button
                  type="button"
                  onClick={() => setNotesMode('overwrite')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    notesMode === 'overwrite'
                      ? 'bg-amber-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  上書き
                </button>
                <button
                  type="button"
                  onClick={() => setNotesMode('clear')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    notesMode === 'clear'
                      ? 'bg-rose-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  備考を消去
                </button>
              </div>
            </div>

            {(notesMode === 'append' || notesMode === 'overwrite') && (
              <div className="pt-1">
                <textarea
                  rows={3}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder={
                    notesMode === 'append'
                      ? '選択したCDの既存の備考の末尾に追記するテキストを入力（例: 棚番号A-2保管 / 初回限定盤）...'
                      : '選択したCDの備考を上書きするテキストを入力...'
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}

            {notesMode === 'clear' && (
              <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-xl p-2.5">
                選択された {selectedCDs.length} 件のCDの備考（メモ）をすべて空に消去します。
              </p>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={!canSubmit || isSaving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/60 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              <span>{selectedCDs.length} 件のCDに一括適用する</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
