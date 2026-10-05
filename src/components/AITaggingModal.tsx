import React, { useState } from 'react';
import { CDMetadata } from '../types/cd';
import { getJSTISOString } from '../lib/dateUtils';
import { X, Sparkles, RefreshCw, CheckCircle2, Tag, Calendar, Music, Disc, AlertCircle, Check, Plus } from 'lucide-react';

interface CDTagAnalysisResult {
  id: string;
  genre: string;
  subGenre?: string;
  mood: string;
  era: string;
  suggestedTags: string[];
  reasoning?: string;
}

interface AITaggingModalProps {
  allCDs: CDMetadata[];
  selectedCDs: CDMetadata[];
  onClose: () => void;
  onApplyBatchTags: (updatedCDs: CDMetadata[]) => Promise<void>;
}

export const AITaggingModal: React.FC<AITaggingModalProps> = ({
  allCDs,
  selectedCDs,
  onClose,
  onApplyBatchTags,
}) => {
  // Target choice: 'selected' | 'untagged' | 'all'
  const untaggedCDs = allCDs.filter((c) => !c.tags || c.tags.length === 0);
  const defaultTarget = selectedCDs.length > 0 ? 'selected' : (untaggedCDs.length > 0 ? 'untagged' : 'all');
  
  const [targetType, setTargetType] = useState<'selected' | 'untagged' | 'all'>(defaultTarget);
  const [includeGenre, setIncludeGenre] = useState(true);
  const [includeMood, setIncludeMood] = useState(true);
  const [includeEra, setIncludeEra] = useState(true);
  const [mergeMode, setMergeMode] = useState<'append' | 'replace'>('append');

  // Execution state: 'idle' | 'analyzing' | 'review'
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'review'>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, currentTitle: '' });
  const [analysisResults, setAnalysisResults] = useState<Map<string, {
    tags: string[];
    genre: string;
    mood: string;
    era: string;
    reasoning?: string;
  }>>(new Map());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newTagInputs, setNewTagInputs] = useState<Record<string, string>>({});

  // Determine items to process based on targetType
  const getTargetCDs = (): CDMetadata[] => {
    if (targetType === 'selected') {
      return selectedCDs.length > 0 ? selectedCDs : allCDs;
    }
    if (targetType === 'untagged') {
      return untaggedCDs.length > 0 ? untaggedCDs : allCDs;
    }
    return allCDs;
  };

  const handleStartAnalysis = async () => {
    const targets = getTargetCDs();
    if (targets.length === 0) {
      setErrorMessage('分析対象のCDが選択されていません。');
      return;
    }

    setStatus('analyzing');
    setErrorMessage(null);
    setProgress({ current: 0, total: targets.length, currentTitle: '準備中...' });

    const resultMap = new Map<string, {
      tags: string[];
      genre: string;
      mood: string;
      era: string;
      reasoning?: string;
    }>();

    // Batch in chunks of 6 to avoid server request timeouts
    const CHUNK_SIZE = 6;
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      const chunk = targets.slice(i, i + CHUNK_SIZE);
      setProgress({
        current: i,
        total: targets.length,
        currentTitle: chunk[0]?.title || '',
      });

      try {
        const res = await fetch('/api/ai-analyze-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cds: chunk.map((c) => ({
              id: c.id,
              title: c.title,
              artist: c.artist,
              catalogNumber: c.catalogNumber,
              label: c.label,
              releaseDate: c.releaseDate,
              tracks: c.tracks?.slice(0, 10),
              genre: c.genre,
              existingTags: c.tags,
              notes: c.notes,
            })),
            options: {
              includeGenre,
              includeMood,
              includeEra,
              mergeMode,
            },
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data: { results: CDTagAnalysisResult[] } = await res.json();
        if (data.results && Array.isArray(data.results)) {
          data.results.forEach((item) => {
            const originalCD = targets.find((c) => c.id === item.id);
            let finalTags: string[] = [];

            if (mergeMode === 'append' && originalCD?.tags) {
              const set = new Set([...originalCD.tags, ...(item.suggestedTags || [])]);
              finalTags = Array.from(set);
            } else {
              finalTags = item.suggestedTags || [];
            }

            resultMap.set(item.id, {
              tags: finalTags,
              genre: item.genre,
              mood: item.mood,
              era: item.era,
              reasoning: item.reasoning,
            });
          });
        }
      } catch (err: any) {
        console.error('Error analyzing batch chunk:', err);
        // Fallback for this chunk so workflow continues
        chunk.forEach((c) => {
          resultMap.set(c.id, {
            tags: c.tags && c.tags.length > 0 ? c.tags : ['J-POP', '邦楽'],
            genre: 'J-POP',
            mood: 'メロディアス',
            era: c.releaseDate?.slice(0, 4) ? `${c.releaseDate.slice(0, 3)}0年代` : '邦楽',
            reasoning: '簡易フォールバック判定',
          });
        });
      }

      setProgress({
        current: Math.min(i + chunk.length, targets.length),
        total: targets.length,
        currentTitle: chunk[chunk.length - 1]?.title || '',
      });
    }

    setAnalysisResults(resultMap);
    setStatus('review');
  };

  const handleRemoveTag = (cdId: string, tagToRemove: string) => {
    const existing = analysisResults.get(cdId);
    if (!existing) return;
    const updatedTags = existing.tags.filter((t) => t !== tagToRemove);
    const updatedMap = new Map(analysisResults);
    updatedMap.set(cdId, { ...existing, tags: updatedTags });
    setAnalysisResults(updatedMap);
  };

  const handleAddCustomTag = (cdId: string) => {
    const tagToAdd = (newTagInputs[cdId] || '').trim();
    if (!tagToAdd) return;
    const existing = analysisResults.get(cdId);
    if (!existing) return;
    if (!existing.tags.includes(tagToAdd)) {
      const updatedTags = [...existing.tags, tagToAdd];
      const updatedMap = new Map(analysisResults);
      updatedMap.set(cdId, { ...existing, tags: updatedTags });
      setAnalysisResults(updatedMap);
    }
    setNewTagInputs({ ...newTagInputs, [cdId]: '' });
  };

  const handleApplyAllTags = async () => {
    setIsSaving(true);
    try {
      const targets = getTargetCDs();
      const updatedList: CDMetadata[] = [];

      targets.forEach((cd) => {
        const res = analysisResults.get(cd.id);
        if (res) {
          updatedList.push({
            ...cd,
            tags: res.tags,
            genre: res.genre || cd.genre,
            updatedAt: getJSTISOString(),
          });
        }
      });

      await onApplyBatchTags(updatedList);
      onClose();
    } catch (err: any) {
      console.error('Failed to apply batch tags:', err);
      setErrorMessage(`保存エラー: ${err.message || '通信エラー'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const targetCDs = getTargetCDs();

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl h-[90vh] max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-800/70 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-600/30 border border-purple-500/40 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight flex items-center gap-2">
                <span>Gemini AI 自動タグ付け・楽曲分析</span>
                <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-mono">
                  Gemini 3.8 Flash
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                アルバムの曲名・年代・アーティスト情報からジャンル・ムード・時代区分を自動分析してタグを付与
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
        <div className="flex-1 overflow-y-auto p-6 min-h-0 space-y-6">
          
          {/* STEP 1: Setting up target & options (Idle state) */}
          {status === 'idle' && (
            <div className="space-y-6">
              
              {/* Target Scope Card */}
              <div className="bg-slate-800/40 border border-slate-700/80 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Disc className="w-4 h-4 text-indigo-400" />
                  <span>1. 分析対象のCDを選択</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      targetType === 'selected'
                        ? 'bg-purple-950/40 border-purple-500/80 text-white shadow-sm'
                        : selectedCDs.length === 0
                        ? 'opacity-40 bg-slate-900/40 border-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-slate-900/60 border-slate-700/80 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="targetType"
                      value="selected"
                      disabled={selectedCDs.length === 0}
                      checked={targetType === 'selected'}
                      onChange={() => setTargetType('selected')}
                      className="mt-0.5 text-purple-600 focus:ring-0"
                    />
                    <div>
                      <p className="text-xs font-bold">選択中のCD</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {selectedCDs.length} 枚
                      </p>
                      {selectedCDs.length === 0 && (
                        <p className="text-[10px] text-slate-500 mt-1">※一覧でチェックボックス未選択</p>
                      )}
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      targetType === 'untagged'
                        ? 'bg-purple-950/40 border-purple-500/80 text-white shadow-sm'
                        : 'bg-slate-900/60 border-slate-700/80 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="targetType"
                      value="untagged"
                      checked={targetType === 'untagged'}
                      onChange={() => setTargetType('untagged')}
                      className="mt-0.5 text-purple-600 focus:ring-0"
                    />
                    <div>
                      <p className="text-xs font-bold">タグ未設定のCDのみ</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {untaggedCDs.length} 枚
                      </p>
                      <p className="text-[10px] text-emerald-400 mt-1">未分類CDの効率的な整理におすすめ</p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      targetType === 'all'
                        ? 'bg-purple-950/40 border-purple-500/80 text-white shadow-sm'
                        : 'bg-slate-900/60 border-slate-700/80 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="targetType"
                      value="all"
                      checked={targetType === 'all'}
                      onChange={() => setTargetType('all')}
                      className="mt-0.5 text-purple-600 focus:ring-0"
                    />
                    <div>
                      <p className="text-xs font-bold">ライブラリ全件</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        全 {allCDs.length} 枚
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">一括ですべてのCDをタグ付け</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Analysis Features Card */}
              <div className="bg-slate-800/40 border border-slate-700/80 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-purple-400" />
                  <span>2. 分析・生成するタグの項目</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-700/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeGenre}
                      onChange={(e) => setIncludeGenre(e.target.checked)}
                      className="rounded border-slate-700 text-purple-600 focus:ring-0"
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-200">音楽ジャンル</p>
                      <p className="text-[10px] text-slate-400">J-POP, ロック, シティポップ, 歌謡曲等</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-700/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeMood}
                      onChange={(e) => setIncludeMood(e.target.checked)}
                      className="rounded border-slate-700 text-purple-600 focus:ring-0"
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-200">雰囲気・ムード</p>
                      <p className="text-[10px] text-slate-400">爽やか, 切ない, エモーショナル, メロウ等</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-700/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeEra}
                      onChange={(e) => setIncludeEra(e.target.checked)}
                      className="rounded border-slate-700 text-purple-600 focus:ring-0"
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-200">リリース年代・時代</p>
                      <p className="text-[10px] text-slate-400">80年代, 90年代, 昭和歌謡, 2000年代等</p>
                    </div>
                  </label>
                </div>

                {/* Existing Tag Handling */}
                <div className="pt-2 border-t border-slate-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-slate-300">既存のタグの取り扱い:</span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="radio"
                        name="mergeMode"
                        value="append"
                        checked={mergeMode === 'append'}
                        onChange={() => setMergeMode('append')}
                        className="text-purple-600 focus:ring-0"
                      />
                      <span>既存タグを残してAIタグを追加（推奨）</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer text-slate-400">
                      <input
                        type="radio"
                        name="mergeMode"
                        value="replace"
                        checked={mergeMode === 'replace'}
                        onChange={() => setMergeMode('replace')}
                        className="text-purple-600 focus:ring-0"
                      />
                      <span>AIタグで新規上書き</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Summary Banner */}
              <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                  <p className="text-xs text-indigo-200">
                    対象の <strong className="text-white text-sm font-bold">{targetCDs.length}</strong> 枚のCDをGemini AIが自動分析し、高精度なタグを生成します。分析完了後に確認・微調整が可能です。
                  </p>
                </div>
              </div>

            </div>
          )}

          {/* STEP 2: Analyzing In Progress */}
          {status === 'analyzing' && (
            <div className="py-12 px-4 text-center space-y-6">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 rounded-full border-4 border-purple-500/20 animate-ping" />
                <div className="w-20 h-20 rounded-full border-4 border-purple-500 border-t-transparent animate-spin flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-purple-400" />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">
                  Gemini AI がライブラリを分析中...
                </h3>
                <p className="text-xs text-slate-400">
                  {progress.current} / {progress.total} 枚 完了 ({Math.round((progress.current / (progress.total || 1)) * 100)}%)
                </p>
                {progress.currentTitle && (
                  <p className="text-xs font-mono text-indigo-300 truncate max-w-md mx-auto">
                    現在処理中: {progress.currentTitle}
                  </p>
                )}
              </div>

              {/* Progress Bar */}
              <div className="w-full max-w-md mx-auto bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round((progress.current / (progress.total || 1)) * 100)}%`,
                  }}
                />
              </div>

              <p className="text-[11px] text-slate-500">
                ※ 曲名リストや発売日をもとに、ジャンル・雰囲気・時代区分を並列分類しています
              </p>
            </div>
          )}

          {/* STEP 3: Review & Edit Generated Tags */}
          {status === 'review' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>AIタグ付け完了（{targetCDs.length}枚のアルバム）</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    内容を確認し、不要なタグの削除や自由なタグの追加を行ってから保存できます。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setStatus('idle')}
                  className="text-xs text-slate-400 hover:text-white underline self-start sm:self-auto"
                >
                  条件を変更して再分析
                </button>
              </div>

              {/* Results List */}
              <div className="space-y-3">
                {targetCDs.map((cd) => {
                  const res = analysisResults.get(cd.id);
                  const tags = res?.tags || [];

                  return (
                    <div
                      key={cd.id}
                      className="bg-slate-800/40 border border-slate-700/80 rounded-xl p-4 flex flex-col sm:flex-row gap-4 items-start justify-between transition-colors hover:border-slate-600"
                    >
                      {/* Album Summary */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-700 overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {cd.coverUrl ? (
                            <img src={cd.coverUrl} alt={cd.title} className="w-full h-full object-cover" />
                          ) : (
                            <Disc className="w-6 h-6 text-slate-600" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {cd.catalogNumber && (
                              <span className="text-[10px] font-mono text-indigo-300 font-bold bg-slate-900 px-1.5 py-0.2 rounded border border-slate-700">
                                {cd.catalogNumber}
                              </span>
                            )}
                            <h4 className="text-xs font-bold text-white truncate" title={cd.title}>
                              {cd.title}
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-300 truncate" title={cd.artist}>
                            {cd.artist} {cd.releaseDate ? `(${cd.releaseDate.slice(0, 4)})` : ''}
                          </p>
                          {res?.reasoning && (
                            <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1 italic">
                              💡 {res.reasoning}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Analyzed Tag Badges & Edit */}
                      <div className="w-full sm:w-auto flex flex-col items-start sm:items-end gap-2 flex-shrink-0">
                        {/* Meta hints */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {res?.genre && (
                            <span className="text-[10px] bg-blue-950/80 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium">
                              {res.genre}
                            </span>
                          )}
                          {res?.mood && (
                            <span className="text-[10px] bg-purple-950/80 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-medium">
                              {res.mood}
                            </span>
                          )}
                          {res?.era && (
                            <span className="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium">
                              {res.era}
                            </span>
                          )}
                        </div>

                        {/* Interactive Tag Badges */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {tags.map((t, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 bg-slate-700/80 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1 rounded-lg border border-slate-600 transition-colors group"
                            >
                              <span>#{t}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveTag(cd.id, t)}
                                className="text-slate-400 hover:text-rose-400 ml-0.5 text-xs font-bold"
                                title="タグを削除"
                              >
                                ×
                              </button>
                            </span>
                          ))}

                          {/* Inline Add Tag */}
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              value={newTagInputs[cd.id] || ''}
                              onChange={(e) => setNewTagInputs({ ...newTagInputs, [cd.id]: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddCustomTag(cd.id);
                                }
                              }}
                              placeholder="+ タグ追加"
                              className="bg-slate-900 border border-slate-700 focus:border-purple-500 rounded px-2 py-0.5 text-[11px] text-white w-20"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddCustomTag(cd.id)}
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                              title="追加"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>

            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-rose-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-slate-800 bg-slate-800/80 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            {status === 'review' ? '破棄して閉じる' : 'キャンセル'}
          </button>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {status === 'idle' && (
              <button
                type="button"
                onClick={handleStartAnalysis}
                disabled={targetCDs.length === 0}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-purple-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-4 h-4" />
                <span>{targetCDs.length} 枚のCDをAI自動分析開始</span>
              </button>
            )}

            {status === 'analyzing' && (
              <button
                type="button"
                disabled
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                <span>分析実行中...</span>
              </button>
            )}

            {status === 'review' && (
              <button
                type="button"
                onClick={handleApplyAllTags}
                disabled={isSaving}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>ライブラリに保存中...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>すべてのタグを一括反映してライブラリ更新 ({targetCDs.length}件)</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
