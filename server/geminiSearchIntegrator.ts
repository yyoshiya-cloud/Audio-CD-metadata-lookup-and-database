import { GoogleGenAI } from '@google/genai';
import { SearchQuery, SearchResultCandidate, CDMetadata, TrackInfo } from '../src/types/cd.js';
import { generateContentWithFallback } from './geminiFallback.js';

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
4. verificationSummary には、どのAPIの情報をどう照合・検証したかを日本語で簡潔に1文で記載してください。
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000); // 7s timeout

    const response = await generateContentWithFallback(ai, {
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
    });

    clearTimeout(timeout);

    const responseText = response.text;
    if (!responseText) {
      return applyDeterministicVerification(candidates, query);
    }

    const parsed: GeminiVerificationOutput = JSON.parse(responseText);
    const verifiedMap = new Map<number, GeminiVerificationOutput['verifiedCandidates'][0]>();
    (parsed.verifiedCandidates || []).forEach((vc) => {
      verifiedMap.set(vc.candidateIndex, vc);
    });

    // Merge AI verified details into candidates
    const finalCandidates = candidates.map((cand, idx) => {
      const aiData = verifiedMap.get(idx);
      if (!aiData) {
        return applyDeterministicVerification([cand], query)[0];
      }

      const updatedCD: CDMetadata = {
        ...cand.cd,
        title: aiData.verifiedTitle || cand.cd.title,
        artist: aiData.verifiedArtist || cand.cd.artist,
        catalogNumber: aiData.verifiedCatalogNumber || cand.cd.catalogNumber,
        label: aiData.verifiedLabel || cand.cd.label,
        releaseDate: aiData.verifiedReleaseDate || cand.cd.releaseDate,
        confidenceScore: aiData.confidenceScore || cand.matchScore,
        verifiedByAI: true,
        aiVerificationSummary: aiData.verificationSummary,
        isExactMatch: aiData.isExactMatch,
        exactMatchTypes: aiData.exactMatchTypes,
      };

      return {
        ...cand,
        cd: updatedCD,
        matchScore: aiData.confidenceScore || cand.matchScore,
        isExactMatch: aiData.isExactMatch,
        exactMatchTypes: aiData.exactMatchTypes,
        verifiedByAI: true,
        aiVerificationSummary: aiData.verificationSummary,
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
 * Deterministic fallback verification if Gemini is unavailable
 */
export function applyDeterministicVerification(
  candidates: SearchResultCandidate[],
  query: SearchQuery
): SearchResultCandidate[] {
  const normQueryCat = normalizeText(query.catalogNumber || (query as any).catno || '');
  const normQueryTitle = normalizeText(query.title || '');
  const normQueryBarcode = query.barcode ? query.barcode.replace(/\D/g, '') : '';

  return candidates.map((cand) => {
    const candCat = normalizeText(cand.cd.catalogNumber || '');
    const candTitle = normalizeText(cand.cd.title || '');
    const candBarcode = cand.cd.barcode ? cand.cd.barcode.replace(/\D/g, '') : '';

    const catMatch = Boolean(normQueryCat && candCat && (candCat === normQueryCat || candCat.includes(normQueryCat) || normQueryCat.includes(candCat)));
    const titleMatch = Boolean(normQueryTitle && candTitle && (candTitle === normQueryTitle || candTitle.includes(normQueryTitle)));
    const barcodeMatch = Boolean(normQueryBarcode && candBarcode && normQueryBarcode === candBarcode);

    const exactMatchTypes: ('catalogNumber' | 'title' | 'barcode')[] = [];
    if (catMatch) exactMatchTypes.push('catalogNumber');
    if (titleMatch) exactMatchTypes.push('title');
    if (barcodeMatch) exactMatchTypes.push('barcode');

    const isExactMatch = exactMatchTypes.length > 0;
    let score = cand.matchScore;
    if (catMatch && titleMatch) score = 100;
    else if (barcodeMatch) score = 100;
    else if (catMatch) score = Math.max(score, 95);

    let summary = '';
    if (barcodeMatch && catMatch) {
      summary = `JANコード(${cand.cd.barcode})および型番(${cand.cd.catalogNumber})が完全一致`;
    } else if (barcodeMatch) {
      summary = `JANコード(${cand.cd.barcode})が完全一致（${cand.sourcesMatched.join('・')}）`;
    } else if (catMatch && cand.sourcesMatched.length > 1) {
      summary = `型番(${cand.cd.catalogNumber})で${cand.sourcesMatched.join('・')}のデータを一致照合済み`;
    } else if (catMatch) {
      summary = `規格品番(${cand.cd.catalogNumber})が完全一致`;
    } else if (titleMatch) {
      summary = `タイトル「${cand.cd.title}」が検索クエリと完全一致`;
    }

    const updatedCD: CDMetadata = {
      ...cand.cd,
      isExactMatch,
      exactMatchTypes,
      confidenceScore: score,
      aiVerificationSummary: summary || cand.cd.aiVerificationSummary,
    };

    return {
      ...cand,
      cd: updatedCD,
      matchScore: score,
      isExactMatch,
      exactMatchTypes,
      aiVerificationSummary: summary,
    };
  }).sort((a, b) => {
    if (a.isExactMatch && !b.isExactMatch) return -1;
    if (!a.isExactMatch && b.isExactMatch) return 1;
    return b.matchScore - a.matchScore;
  });
}

function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .toUpperCase()
    .replace(/[‐－―ー\-\s_]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .trim();
}
