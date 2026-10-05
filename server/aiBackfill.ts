import { GoogleGenAI } from '@google/genai';
import { CDMetadata, TrackInfo } from '../src/types/cd.js';
import { generateContentWithFallback } from './geminiFallback.js';

export interface BackfillCDResult {
  id: string;
  artist?: string;
  releaseDate?: string;
  label?: string;
  catalogNumber?: string;
  genre?: string;
  tracks?: TrackInfo[];
  backfilledFields: string[];
  backfillSummary: string;
}

/**
 * Auto-fill missing CD metadata (artist, release date, label, catalog number, tracks, genre)
 * using Gemini 3.8 Flash based on online official music catalog information.
 */
export async function backfillCDMetadataWithGemini(
  cds: CDMetadata[]
): Promise<BackfillCDResult[]> {
  if (!cds || cds.length === 0) return [];

  const ai = new GoogleGenAI(); // Reads GEMINI_API_KEY from env
  const CHUNK_SIZE = 6;
  const results: BackfillCDResult[] = [];

  for (let i = 0; i < cds.length; i += CHUNK_SIZE) {
    const chunk = cds.slice(i, i + CHUNK_SIZE);

    const promptData = chunk.map((cd) => ({
      id: cd.id,
      title: cd.title,
      currentArtist: cd.artist || '',
      currentCatalogNumber: cd.catalogNumber || '',
      currentLabel: cd.label || '',
      currentReleaseDate: cd.releaseDate || '',
      currentGenre: cd.genre || '',
      currentTrackCount: cd.tracks ? cd.tracks.length : 0,
      existingTracksSample: (cd.tracks || []).slice(0, 5).map((t) => t.title).join(', '),
      notes: cd.notes || '',
    }));

    const systemInstruction = `あなたはCDメタデータ（アーティスト名、発売日、レーベル、規格品番、収録曲など）をオンラインの公的音楽データベース知識（国会図書館NDL、MusicBrainz、Discogs、iTunes Japan等）から特定・補完する専門AIです。

与えられたCD情報のうち、空欄・「Unknown」「未設定」「アーティスト未登録」などの欠損箇所について、正しい情報を補完してください。

【補完ルール】
1. タイトル、型番、既存トラックの手がかりから、正確な国内盤公式のアーティスト名（日本語/正式表記）、発売日(YYYY-MM-DD)、レーベル名(レコード会社)、規格品番(例: VICL-60001)、ジャンルを補完してください。
2. もしトラックリスト(tracks)が0曲の場合、主要な収録曲リスト(trackNumber, title, duration)を推測・補完してください（最大20曲）。
3. 既に正しい情報が入っている項目は変更せず、そのまま保持してください。
4. backfilledFields に今回補完した項目のリスト（例: ["artist", "releaseDate", "label"]）を指定してください。
5. backfillSummary に補完結果の簡潔な日本語要約（例: "公式ディスコグラフィよりアーティスト(サザンオールスターズ)および発売年月日(1998-06-25)を補完完了"）を記載してください。

出力は必ず以下のJSON形式にしてください:
{
  "results": [
    {
      "id": "CDのID",
      "artist": "補完後または既存のアーティスト名",
      "releaseDate": "補完後または既存の発売日 (YYYY-MM-DD または YYYY-MM または YYYY)",
      "label": "補完後または既存のレーベル/発売元",
      "catalogNumber": "補完後または既存の規格品番",
      "genre": "補完後または既存のジャンル",
      "tracks": [
        { "trackNumber": 1, "title": "曲名", "duration": "03:45" }
      ],
      "backfilledFields": ["artist", "releaseDate"],
      "backfillSummary": "補完内容の要約"
    }
  ]
}`;

    try {
      const response = await generateContentWithFallback(ai, {
        contents: [
          {
            role: 'user',
            parts: [
              { text: `以下の欠損があるCDメタデータリストをオンライン公的情報から調査し、空欄項目を補完してJSONで返してください:\n\n${JSON.stringify(promptData, null, 2)}` }
            ]
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
        preferredModel: 'gemini-flash-latest',
      });

      const responseText = response.text;
      if (responseText) {
        const cleanJson = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(cleanJson);
        if (parsed.results && Array.isArray(parsed.results)) {
          results.push(...parsed.results);
        }
      }
    } catch (err) {
      console.warn('Error in Gemini backfill chunk (using existing data fallback):', err);
      chunk.forEach((cd) => {
        results.push({
          id: cd.id,
          artist: cd.artist,
          releaseDate: cd.releaseDate,
          label: cd.label,
          catalogNumber: cd.catalogNumber,
          genre: cd.genre,
          tracks: cd.tracks,
          backfilledFields: [],
          backfillSummary: 'API制限またはネットワークエラーのため、既存データを維持しました。',
        });
      });
    }
  }

  return results;
}
