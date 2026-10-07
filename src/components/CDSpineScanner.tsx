import React, { useState, useRef } from 'react';
import { Camera, X, Sparkles, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { SearchQuery } from '../types/cd';

interface CDSpineScannerProps {
  onClose: () => void;
  onOCRSuccess: (ocrQuery: SearchQuery) => void;
}

export const CDSpineScanner: React.FC<CDSpineScannerProps> = ({
  onClose,
  onOCRSuccess,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedData, setExtractedData] = useState<{
    catalogNumber?: string;
    title?: string;
    artist?: string;
    barcode?: string;
    label?: string;
    releaseDate?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('画像ファイル (JPEG, PNG等) を選択してください。');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedImage(reader.result as string);
      setExtractedData(null);
      setErrorMessage(null);
    };
    reader.readAsDataURL(file);
  };

  const handleRunOCR = async () => {
    if (!selectedImage) return;

    setIsAnalyzing(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: selectedImage,
          mimeType: 'image/jpeg',
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'AI解析エラーが発生しました。');
      }

      const data = await response.json();
      setExtractedData(data);
    } catch (err: any) {
      console.error('OCR Error:', err);
      setErrorMessage(err.message || 'AI画像解析に失敗しました。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyAndSearch = () => {
    if (!extractedData) return;

    onOCRSuccess({
      catalogNumber: extractedData.catalogNumber,
      title: extractedData.title,
      artist: extractedData.artist,
      barcode: extractedData.barcode,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                CD背表紙 / 帯 AIスキャナー (Gemini Vision)
              </h2>
              <p className="text-xs text-slate-400">
                CDケースの背表紙・帯・ジャケット写真を撮影・アップロードして文字認識します
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

        {/* Body */}
        <div className="p-6 space-y-5">
          
          {/* File Upload Drop Area */}
          {!selectedImage ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-purple-500 rounded-2xl p-8 text-center cursor-pointer transition-all bg-slate-800/30 hover:bg-slate-800/60 group"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-16 h-16 rounded-full bg-purple-950/80 border border-purple-500/30 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <Camera className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-sm font-bold text-white">画像を選択または撮影</h3>
              <p className="text-xs text-slate-400 mt-1">
                CDの背表紙 (帯) やジャケット表紙の写真をアップロードしてください
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Image Preview */}
              <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 max-h-56 flex items-center justify-center">
                <img src={selectedImage} alt="CD Spine" className="max-h-56 object-contain" />
                <button
                  onClick={() => {
                    setSelectedImage(null);
                    setExtractedData(null);
                  }}
                  className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-900 text-white p-1.5 rounded-lg border border-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!extractedData && (
                <button
                  onClick={handleRunOCR}
                  disabled={isAnalyzing}
                  className="w-full py-3 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2 transition-all"
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Gemini AIが型番・タイトルを抽出中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>画像から文字認識 (OCR) を実行</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Extracted Data Preview */}
          {extractedData && (
            <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-xl space-y-3 animate-in fade-in">
              <h4 className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-400" />
                AI認識結果:
              </h4>

              <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div>
                  <span className="text-slate-400 block text-[10px]">認識された型番:</span>
                  <span className="font-mono font-bold text-indigo-300">
                    {extractedData.catalogNumber || 'なし'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">JANバーコード:</span>
                  <span className="font-mono">{extractedData.barcode || 'なし'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">タイトル:</span>
                  <span className="font-bold text-white truncate block">{extractedData.title || 'なし'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">アーティスト:</span>
                  <span className="font-medium text-slate-200 truncate block">{extractedData.artist || 'なし'}</span>
                </div>
              </div>

              <button
                onClick={handleApplyAndSearch}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md flex items-center justify-center gap-2 transition-all"
              >
                <span>この認識情報でWeb API横断検索を実行</span>
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="bg-rose-950/80 border border-rose-500/50 p-3 rounded-xl flex items-center gap-2 text-rose-200 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-800 bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700"
          >
            閉じる
          </button>
        </div>

      </div>
    </div>
  );
};
