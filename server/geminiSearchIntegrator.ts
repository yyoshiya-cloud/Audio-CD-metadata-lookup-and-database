import { GoogleGenAI } from '@google/genai';
import { SearchQuery, SearchResultCandidate, CDMetadata, TrackInfo } from '../src/types/cd.js';
import { generateContentWithFallback } from './geminiFallback.js';
import { artistSimilarity, catnoBase, titleSimilarity } from './searchUtils.js';

// Gemini 検証に使う全体の待ち時間上限。超えたら決定的な判定結果をそのまま返す。
const GEMINI_OVERALL_TIMEOUT_MS = 8000;

interface GeminiVerificationOutput {
  verifiedCandidates: {
    candidateIndex: number;
    isExactMatch: boolean;
    exactMatchTypes: ('catalogNumber' | 'title' | 'barcode')[];
    verifiedTitle: string;
    verifiedArtist: string;
    verifiedCatalogNumber: string;
    verifiedBarcode?: string;
    verifiedLabel?: string;
    verifiedReleaseDate?: string;
    verifiedTracks?: { trackNumber: number; title: string; duration?: string }[];
    confidenceScore: number;
    verificationSummary: string;
  }[];
}

/**
 * Consolidate and verify search results from multiple APIs using Gemini 3.8 Flash
 */
export async function verifyAndConsolidateWithGemini(
  candidates: SearchResultCandidate[],
  query: SearchQuery
): Promise<SearchResultCandidate[]> {
  if (!candidates || candidates.length === 0) return [];

  // Check if GEMINI_API_KEY is available
  if (!process.env.GEMINI_API_KEY) {
    return applyDeterministicVerification(candidates, query);
  }

  try {
    const ai = new GoogleGenAI();
    // Only analyze top 5 candidates to keep latency low
    const candidatesToVerify = candidates.slice(0, 5);

    const promptData = {
      userQuery: {
        catalogNumber: query.catalogNumber || '',
        title: query.title || '',
        artist: query.artist || '',
        trackTitle: query.trackTitle || '',
        barcode: query.barcode || '',
        freeText: query.freeText || '',
      },
      candidates: candidatesToVerify.map((c, idx) => ({
        index: idx,
        catalogNumber: c.cd.catalogNumber,
        barcode: c.cd.barcode,
        title: c.cd.title,
        artist: c.cd.artist,
        label: c.cd.label,
        releaseDate: c.cd.releaseDate,
        sourcesMatched: c.sourcesMatched,
        rawSources: c.cd.rawSources,
        trackCount: c.cd.tracks.length,
        tracksSample: c.cd.tracks.slice(0, 10).map((t) => `${t.trackNumber}. ${t.title} (${t.duration || ''})`),
      })),
    };

    const systemInstruction = `あなたは音楽CDのメタデータ（タイトル、歌手、規格品番、JAN/EANバーコード、収録曲）を照合・精査する専門家です。
複数のAPI（国会図書館NDL、MusicBrainz、iTunes、楽天ブックス、Spotify、Discogs）から取得されたCD候補データを統合・検証し、重複排除および正規化を行います。

【最重要検証ルール】
1. ユーザーの検索クエリ（型番・規格品番、JAN/EANコード、タイトル）と候補データの「完全一致」を最優先で判定してください。
   - JANコード・バーコード（数字13桁または8桁）が完全一致する場合は isExactMatch: true, exactMatchTypes に "barcode" を設定してください。
   - 規格品番のハイフン・空白の差異（例: "VICL-60001" と "VICL 60001" や "VICL60001"）は完全一致とみなします。
   - タイトル・歌手名の表記揺れ（全角半角、カタカナ/英字、(Remastered)などの不要な付加情報）を正規化し、正式な国内盤タイトルとして整理してください。
2. 異なるAPI（例: NDL/楽天のJAN・型番とiTunesのジャケット・曲情報）が同一のCDアルバムを指しているかを厳密に検証してください。
   - 同一アルバムであれば、最も公式かつ正確なタイトル、アーティスト、規格品番、JANコード、レーベル、発売日を採用してください。
3. ユーザーの入力した型番・JANと異なる無関係な作品には isExactMatch: false を設定し、信頼度(confidenceScore)を下げてください。
4. 候補データに存在しない値（型番・JAN・発売日・レーベル等）を推測で作り出してはいけません。不明な場合は候補データの値をそのまま返してください。
5. verificationSummary には、どのAPIの情報をどう照合・検証したかを日本語で簡潔に1文で記載してください。
   （例: "楽天・MusicBrainzのJANコード(4562109401813)とiTunesの高画質ジャケットおよび収録曲を完全照合・検証完了"）

必ずJSON形式で以下のプロパティを含むオブジェクトを返してください:
{
  "verifiedCandidates": [
    {
      "candidateIndex": number,
      "isExactMatch": boolean,
      "exactMatchTypes": ["catalogNumber" | "title" | "barcode"],
      "verifiedTitle": string,
      "verifiedArtist": string,
      "verifiedCatalogNumber": string,
      "verifiedBarcode": string,
      "verifiedLabel": string,
      "verifiedReleaseDate": string,
      "confidenceScore": number (0-100),
      "verificationSummary": string
    }
  ]
}`;

    // 注意: AbortController は generateContentWithFallback に渡されないため機能しない。
    // 全体の待ち時間は Promise.race で制限し、モデル単位のタイムアウトは timeoutMs で指定する。
    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    const overallTimeout = new Promise<never>((_, reject) => {
      overallTimer = setTimeout(() => reject(new Error('Gemini verification timed out')), GEMINI_OVERALL_TIMEOUT_MS);
    });

    const response = await Promise.race([generateContentWithFallback(ai, {
      contents: [
        {
          role: 'user',
          parts: [
            { text: `次のCD検索クエリと候補データを照合・検証し、統合結果をJSONで出力してください:\n\n${JSON.stringify(promptData, null, 2)}` }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
      preferredModel: 'gemini-flash-latest',
      timeoutMs: 7000,
    }), overallTimeout]).finally(() => {
      if (overallTimer) clearTimeout(overallTimer);
    });

    const responseText = response.text;
    if (!responseText) {
      return applyDeterministicVerification(candidates, query);
    }

    const parsed: GeminiVerificationOutput = JSON.parse(responseText);
    const verifiedMap = new Map<number, GeminiVerificationOutput['verifiedCandidates'][0]>();
    (parsed.verifiedCandidates || []).forEach((vc) => {
      verifiedMap.set(vc.candidateIndex, vc);
    });

    // AI の出力は「表記の整理」と「要約」にのみ使い、決定的な照合結果は上書きしない。
    //  - 一致判定 (isExactMatch / exactMatchTypes) は検索ロジック側の判定を維持
    //  - 信頼度は AI が下げることはできる(最大10点)が、決定的スコアを超えて上げられない
    //  - タイトル/アーティスト/型番は、候補データの値と実質同一の場合のみ採用
    //  - 発売日/レーベルは、いずれかのソースが実際に返した値の場合のみ採用
    const finalCandidates = candidates.map((cand, idx) => {
      const base = applyDeterministicVerification([cand], query)[0];
      const aiData = verifiedMap.get(idx);
      if (!aiData) return base;

      const raws = Object.values(cand.cd.rawSources || {});
      const sameText = (a?: string, b?: string) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

      const title =
        aiData.verifiedTitle &&
        [cand.cd.title, ...raws.map((r) => r?.title)].some((t) => t && titleSimilarity(aiData.verifiedTitle, t) >= 0.9)
          ? aiData.verifiedTitle
          : cand.cd.title;
      const artist =
        aiData.verifiedArtist &&
        [cand.cd.artist, ...raws.map((r) => r?.artist)].some((t) => t && artistSimilarity(aiData.verifiedArtist, t) >= 0.8)
          ? aiData.verifiedArtist
          : cand.cd.artist;
      const catalogNumber =
        aiData.verifiedCatalogNumber && catnoBase(aiData.verifiedCatalogNumber) === catnoBase(cand.cd.catalogNumber)
          ? aiData.verifiedCatalogNumber
          : cand.cd.catalogNumber;
      const label =
        aiData.verifiedLabel && raws.some((r) => sameText(r?.label, aiData.verifiedLabel))
          ? aiData.verifiedLabel
          : cand.cd.label;
      const releaseDate =
        aiData.verifiedReleaseDate && raws.some((r) => sameText(r?.releaseDate, aiData.verifiedReleaseDate))
          ? aiData.verifiedReleaseDate
          : cand.cd.releaseDate;

      const detScore = base.matchScore;
      const aiScore = Number.isFinite(aiData.confidenceScore) ? aiData.confidenceScore : detScore;
      const upperBound = base.isExactMatch ? detScore : Math.min(detScore, 89);
      const score = Math.round(Math.max(detScore - 10, Math.min(aiScore, upperBound)));

      const updatedCD: CDMetadata = {
        ...base.cd,
        title,
        artist,
        catalogNumber,
        label,
        releaseDate,
        confidenceScore: score,
        verifiedByAI: true,
        aiVerificationSummary: aiData.verificationSummary || base.aiVerificationSummary,
      };

      return {
        ...base,
        cd: updatedCD,
        matchScore: score,
        verifiedByAI: true,
        aiVerificationSummary: aiData.verificationSummary || base.aiVerificationSummary,
      };
    });

    // Sort by isExactMatch first, then matchScore descending
    finalCandidates.sort((a, b) => {
      if (a.isExactMatch && !b.isExactMatch) return -1;
      if (!a.isExactMatch && b.isExactMatch) return 1;
      return b.matchScore - a.matchScore;
    });

    return finalCandidates;
  } catch {
    return applyDeterministicVerification(candidates, query);
  }
}

/**
 * 決定的な検証結果の整理（Gemini が使えない場合のフォールバックも兼ねる）。
 * 一致判定とスコアは searchMerge.ts の結果をそのまま使い、説明文だけを付与する。
 */
export function applyDeterministicVerification(
  candidates: SearchResultCandidate[],
  query: SearchQuery
): SearchResultCandidate[] {
  const trackQ = query.trackTitle || '';

  return candidates.map((cand) => {
    const types = cand.exactMatchTypes || [];
    const catMatch = types.includes('catalogNumber');
    const barcodeMatch = types.includes('barcode');
    const titleOrTrackMatch = types.includes('title');

    const matchedTrackObj = trackQ
      ? (cand.cd.tracks || []).find((tr) => tr.title && titleSimilarity(tr.title, trackQ) >= 0.95)
      : undefined;

    let summary = '';
    if (barcodeMatch && catMatch) {
      summary = `JANコード(${cand.cd.barcode})および型番(${cand.cd.catalogNumber})が完全一致`;
    } else if (barcodeMatch) {
      summary = `JANコード(${cand.cd.barcode})が完全一致（${cand.sourcesMatched.join('・')}）`;
    } else if (catMatch && cand.sourcesMatched.length > 1) {
      summary = `型番(${cand.cd.catalogNumber})で${cand.sourcesMatched.join('・')}のデータを一致照合済み`;
    } else if (catMatch) {
      summary = `規格品番(${cand.cd.catalogNumber})が完全一致`;
    } else if (matchedTrackObj) {
      summary = `収録曲「${matchedTrackObj.title}」(Tr.${matchedTrackObj.trackNumber}) を含むアルバムとして一致`;
    } else if (titleOrTrackMatch) {
      summary = `タイトル「${cand.cd.title}」が検索クエリと一致`;
    }

    const updatedCD: CDMetadata = {
      ...cand.cd,
      aiVerificationSummary: summary || cand.cd.aiVerificationSummary,
    };

    return {
      ...cand,
      cd: updatedCD,
      aiVerificationSummary: summary || cand.aiVerificationSummary,
    };
  }).sort((a, b) => {
    if (a.isExactMatch && !b.isExactMatch) return -1;
    if (!a.isExactMatch && b.isExactMatch) return 1;
    return b.matchScore - a.matchScore;
  });
}
