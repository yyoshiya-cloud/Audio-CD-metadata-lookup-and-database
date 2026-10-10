import assert from 'node:assert';
import {
  normalizeJapaneseSearchText,
  matchesCDSearchQuery,
  getMatchedTracksForQuery,
} from '../src/utils/japaneseSearchNormalizer.ts';
import {
  zenkakuToHankaku,
  toHankakuCode,
  formatToYYYYMMDD,
  formatToHankakuDuration,
} from '../src/utils/formatUtils.ts';
import {
  normalizeCatalogNumber,
  normalizeReleaseDate,
  getJSTISOString,
} from '../src/lib/dateUtils.ts';
import {
  normalizeSingleTag,
  normalizeTagList,
  normalizeCDTagsAndGenre,
  runGenreRulePrecheck,
  applyGenreRuleFilter,
} from '../src/lib/tagNormalizer.ts';
import {
  sanitizeFormulaInjection,
  generateAlbumsCSVContent,
  generateTracksCSVContent,
  generateCombinedCSVContent,
} from '../src/lib/csvExportImport.ts';
import {
  DEFAULT_COLUMN_CONFIG,
  formatCDToRowValues,
  parseSpreadsheetRowsToCDs,
} from '../src/lib/googleSheets.ts';
import { parseJSONToCDs, extractSubImagesFromRawItem } from '../src/lib/jsonExportImport.ts';
import { isPrivateOrReservedIP, validateSafeExternalUrl } from '../server/security.ts';
import type { CDMetadata } from '../src/types/cd.ts';

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

async function runTest(category: string, name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ category, name, passed: true });
    console.log(`✅ [PASS] [${category}] ${name}`);
  } catch (err: any) {
    results.push({
      category,
      name,
      passed: false,
      detail: err?.message || String(err),
    });
    console.error(`❌ [FAIL] [${category}] ${name}: ${err?.message || err}`);
  }
}

async function main() {
  console.log('======================================================');
  console.log('  CD メタデータ DB - 全ロジック・API 自動検証テスト');
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // 1. 日本語検索・正規化・#タグ厳密フィルタリング検証
  // ---------------------------------------------------------------------------
  await runTest('検索・正規化ロジック', '全角英数・カタカナ・ひらがな・旧字体・異体字の正規化', () => {
    const s1 = normalizeJapaneseSearchText('ＺＡＲＤ　負けないで');
    const s2 = normalizeJapaneseSearchText('zard まけないで');
    assert.strictEqual(s1.includes('zard'), true);
    assert.strictEqual(
      normalizeJapaneseSearchText('カタカナ'),
      normalizeJapaneseSearchText('かたかな'),
      'カタカナとひらがなが同一正規化されること'
    );
    assert.strictEqual(
      normalizeJapaneseSearchText('齊藤'),
      normalizeJapaneseSearchText('斉藤'),
      '異体字（齊藤・斉藤）が同一正規化されること'
    );
    assert.strictEqual(
      normalizeJapaneseSearchText('髙橋'),
      normalizeJapaneseSearchText('高橋'),
      '異体字（髙橋・高橋）が同一正規化されること'
    );
  });

  await runTest('検索・正規化ロジック', '#タグ指定検索（#Instrumental 等）で曲名にInstrumentalを含むだけのCDを除外すること', () => {
    const vocalCDWithInstTrack: CDMetadata = {
      id: 'cd-vocal-1',
      title: 'LOVE IS THE MESSAGE',
      artist: 'MISIA',
      catalogNumber: 'BVCS-21001',
      genre: 'R&B',
      tags: ['R&B', 'J-Pop', '1990年代'],
      tracks: [
        { trackNumber: 1, title: 'つつみ込むように…' },
        { trackNumber: 2, title: 'つつみ込むように… (Instrumental Version)' },
      ],
      source: 'musicbrainz',
      createdAt: getJSTISOString(),
      updatedAt: getJSTISOString(),
    };

    const trueInstrumentalCD: CDMetadata = {
      id: 'cd-inst-1',
      title: 'TRUTH',
      artist: 'T-SQUARE',
      catalogNumber: '32DH-617',
      genre: 'フュージョン',
      tags: ['フュージョン', 'Instrumental', '1980年代'],
      tracks: [{ trackNumber: 1, title: 'TRUTH' }],
      source: 'musicbrainz',
      createdAt: getJSTISOString(),
      updatedAt: getJSTISOString(),
    };

    // 1) 通常キーワード検索 "Instrumental" では収録曲名にもヒットする
    assert.strictEqual(
      matchesCDSearchQuery(vocalCDWithInstTrack, 'Instrumental'),
      true,
      '通常のフリーワード検索では曲名にInstrumentalを含むCDにもヒットする'
    );

    // 2) "#Instrumental" 検索（グラフ・タグクリック時）ではタグ/ジャンルのみ対象となり、曲名のみのCDはヒットしない
    assert.strictEqual(
      matchesCDSearchQuery(vocalCDWithInstTrack, '#Instrumental'),
      false,
      '#Instrumental 検索では曲名にInstrumentalが含まれるだけのボーカルCDは除外されること'
    );
    assert.strictEqual(
      matchesCDSearchQuery(trueInstrumentalCD, '#Instrumental'),
      true,
      '#Instrumental 検索で実際にInstrumentalタグを持つCDはヒットすること'
    );

    // 3) getMatchedTracksForQuery でも #タグ のみの場合、収録曲ハイライトが誤発火しないこと
    const matchedTracks = getMatchedTracksForQuery(vocalCDWithInstTrack, '#Instrumental');
    assert.strictEqual(matchedTracks.length, 0, '#タグ検索時はトラック一致バッジを出さないこと');
  });

  // ---------------------------------------------------------------------------
  // 2. 日付・規格品番・フォーマット正規化検証
  // ---------------------------------------------------------------------------
  await runTest('日付・型番正規化', '規格品番の全角→半角・ハイフン統一・大文字変換', () => {
    assert.strictEqual(normalizeCatalogNumber('ｖｉｃｌー６０１２３'), 'VICL-60123');
    assert.strictEqual(normalizeCatalogNumber('  pcca―00123 '), 'PCCA-00123');
    assert.strictEqual(toHankakuCode('ＳＲＣＬ－１２３４'), 'SRCL-1234');
  });

  await runTest('日付・型番正規化', '発売年月日の多様な表記（和暦・8桁数値・スラッシュ・Excelシリアル値）のYYYY-MM-DD変換', () => {
    assert.strictEqual(normalizeReleaseDate('19890421'), '1989-04-21');
    assert.strictEqual(normalizeReleaseDate('昭和63年5月21日'), '1988-05-21');
    assert.strictEqual(normalizeReleaseDate('平成元年1月8日'), '1989-01-08');
    assert.strictEqual(normalizeReleaseDate('令和2年10月5日'), '2020-10-05');
    assert.strictEqual(normalizeReleaseDate('1995/7/1'), '1995-07-01');
    assert.strictEqual(formatToYYYYMMDD('２０２４年１０月５日'), '2024-10-05');
    assert.strictEqual(formatToHankakuDuration('０４：３２'), '04:32');
  });

  // ---------------------------------------------------------------------------
  // 3. ジャンル・タグ正規化および誤判定防止ルール検証
  // ---------------------------------------------------------------------------
  await runTest('AIタグ・ジャンル正規化ルール', '表記ゆれタグの統合と年代タグの正規化', () => {
    assert.strictEqual(normalizeSingleTag('j-pop'), 'J-Pop');
    assert.strictEqual(normalizeSingleTag('J-POP'), 'J-Pop');
    assert.strictEqual(normalizeSingleTag('80年代'), '1980年代');
    assert.strictEqual(normalizeSingleTag("80's"), '1980年代');
    assert.strictEqual(normalizeSingleTag('City Pop', { preserveCustomName: false }), 'シティポップ');

    const list = normalizeTagList(['J-POP / 邦楽', '80s', 'city pop'], { preserveCustomName: false });
    assert.strictEqual(list.includes('J-Pop'), true);
    assert.strictEqual(list.includes('邦楽'), true);
    assert.strictEqual(list.includes('1980年代'), true);
    assert.strictEqual(list.includes('シティポップ'), true);
  });

  await runTest('AIタグ・ジャンル正規化ルール', '1987年以前（J-Pop誕生前）のニューミュージック・シンガーソングライターに対する誤タグ（J-Pop / アイドル）ブロック検証', () => {
    const precheck = runGenreRulePrecheck({
      title: 'PEARL PIERCE',
      artist: '松任谷由実',
      catalogNumber: 'ETP-90175',
      label: 'EXPRESS / 東芝EMI',
      releaseDate: '1982-06-21',
    });

    assert.strictEqual(precheck.effectiveYear, 1982);
    assert.strictEqual(precheck.isPreJPopEra, true);
    const blockedTagNames = precheck.blockedTags.map((b) => b.tag);
    assert.strictEqual(blockedTagNames.includes('アイドル'), true, '松任谷由実にアイドルがブロックされること');
    assert.strictEqual(blockedTagNames.includes('J-Pop'), true, '1982年作品にJ-Popがブロックされること');

    const filtered = applyGenreRuleFilter(
      {
        title: 'PEARL PIERCE',
        artist: '松任谷由実',
        catalogNumber: 'ETP-90175',
        label: 'EXPRESS / 東芝EMI',
        releaseDate: '1982-06-21',
      },
      ['J-Pop', 'アイドル', '1980年代'],
      'J-Pop',
      'アイドル'
    );

    assert.notStrictEqual(filtered.genre, 'J-Pop');
    assert.notStrictEqual(filtered.genre, 'アイドル');
    assert.strictEqual(filtered.suggestedTags.includes('アイドル'), false);
    assert.strictEqual(filtered.suggestedTags.includes('J-Pop'), false);
  });

  await runTest('AIタグ・ジャンル正規化ルール', '正統派アイドル（松田聖子等）ではアイドルタグが正しく維持されること', () => {
    const precheck = runGenreRulePrecheck({
      title: 'ユートピア',
      artist: '松田聖子',
      catalogNumber: '35DH-38',
      label: 'CBS/Sony',
      releaseDate: '1983-06-01',
    });
    assert.strictEqual(precheck.hasPositiveIdolSignal, true);
    const blockedTagNames = precheck.blockedTags.map((b) => b.tag);
    assert.strictEqual(blockedTagNames.includes('アイドル'), false, '松田聖子でアイドルがブロックされないこと');
  });

  // ---------------------------------------------------------------------------
  // 4. コレクション分析（DashboardView）の音楽ジャンル・スタイル抽出ロジック検証
  // ---------------------------------------------------------------------------
  await runTest('コレクション分析（ジャンル集計）', '年代・形態タグ（1980年代・昭和・アルバム等）を除外し、純粋な音楽ジャンル・スタイルタグのみを集計すること', () => {
    const EXCLUDED_GENRE_STYLE_TAGS = new Set([
      '邦楽', '洋楽', 'アルバム', 'フルアルバム', 'ミニアルバム', 'シングル', 'マキシシングル',
      'EP', 'LP', 'CD', '2CD', 'CDシングル', '8cmCD', 'アナログ盤', 'レコード',
      'ベスト盤', 'ベストアルバム', 'ベスト', 'コンピレーション', 'オムニバス',
      'ライブ盤', 'ライブアルバム', 'ボックスセット', '初回限定盤', '通常盤', '企画盤', '廃盤', '名盤',
      '昭和', '平成', '令和', '大正', '明治',
    ]);
    const isPureMusicGenreOrStyleTag = (rawTag: string): boolean => {
      const t = normalizeSingleTag(rawTag, { preserveCustomName: true });
      if (!t || t === '未分類' || t === '不明' || t === 'その他') return false;
      if (EXCLUDED_GENRE_STYLE_TAGS.has(t)) return false;
      if (/^(19\d0|20\d0|[56789]0)年代$/.test(t)) return false;
      if (/^\d{2,4}s$/i.test(t)) return false;
      if (/^(昭和|平成|令和)\d*年代?$/.test(t)) return false;
      if (/^\d{4}年(発売|リリース)?$/.test(t)) return false;
      if (/^(アルバム|シングル|ベスト|コンピレーション|オムニバス|ライブ盤|LP|EP|CD)$/i.test(t)) return false;
      return true;
    };

    assert.strictEqual(isPureMusicGenreOrStyleTag('1980年代'), false);
    assert.strictEqual(isPureMusicGenreOrStyleTag('1990年代'), false);
    assert.strictEqual(isPureMusicGenreOrStyleTag('昭和'), false);
    assert.strictEqual(isPureMusicGenreOrStyleTag('平成'), false);
    assert.strictEqual(isPureMusicGenreOrStyleTag('アルバム'), false);
    assert.strictEqual(isPureMusicGenreOrStyleTag('シングル'), false);
    assert.strictEqual(isPureMusicGenreOrStyleTag('ベスト盤'), false);
    assert.strictEqual(isPureMusicGenreOrStyleTag('邦楽'), false);

    assert.strictEqual(isPureMusicGenreOrStyleTag('シティポップ'), true);
    assert.strictEqual(isPureMusicGenreOrStyleTag('ニューミュージック'), true);
    assert.strictEqual(isPureMusicGenreOrStyleTag('Instrumental'), true);
    assert.strictEqual(isPureMusicGenreOrStyleTag('ロック'), true);
    assert.strictEqual(isPureMusicGenreOrStyleTag('アイドル'), true);
  });

  // ---------------------------------------------------------------------------
  // 5. CSV / JSON エクスポート・インポート・数式インジェクション防御検証
  // ---------------------------------------------------------------------------
  await runTest('データ入出力・セキュリティ', 'CSV数式インジェクション防御（=CMD, +SUM 等の無害化）とCSV生成', () => {
    assert.strictEqual(sanitizeFormulaInjection('=HYPERLINK("http://evil.com")'), '\'=HYPERLINK("http://evil.com")');
    assert.strictEqual(sanitizeFormulaInjection('+1+1'), "'+1+1");
    assert.strictEqual(sanitizeFormulaInjection('通常のタイトル'), '通常のタイトル');

    const sampleCDs: CDMetadata[] = [
      {
        id: 'test-csv-1',
        title: 'A LONG VACATION',
        artist: '大滝詠一',
        catalogNumber: '35DH-1',
        label: 'CBS/Sony',
        releaseDate: '1982-10-01',
        vinylRecordReleaseDate: '1981-03-21',
        vinylRecordFormat: 'LP',
        vinylRecordCatalogNumber: '27AH-1200',
        tags: ['シティポップ', 'ニューミュージック'],
        tracks: [
          { trackNumber: 1, title: '君は天然色', duration: '05:00' },
          { trackNumber: 2, title: 'Velvet Motel', duration: '03:42' },
        ],
        source: 'musicbrainz',
        createdAt: '2026-10-10T00:00:00+09:00',
        updatedAt: '2026-10-10T00:00:00+09:00',
      },
    ];

    const albumsCsv = generateAlbumsCSVContent(sampleCDs);
    const tracksCsv = generateTracksCSVContent(sampleCDs);
    const combinedCsv = generateCombinedCSVContent(sampleCDs);

    assert.strictEqual(albumsCsv.includes('A LONG VACATION'), true);
    assert.strictEqual(albumsCsv.includes('1981-03-21'), true);
    assert.strictEqual(tracksCsv.includes('君は天然色'), true);
    assert.strictEqual(combinedCsv.includes('Velvet Motel'), true);
  });

  await runTest('データ入出力・セキュリティ', 'JSONバックアップのパース・正規化復元テスト', () => {
    const jsonPayload = JSON.stringify({
      app: 'CDCollectionManager',
      version: '1.1.0',
      exportedAt: '2026-10-10T00:00:00Z',
      cds: [
        {
          title: 'RIDE ON TIME',
          artist: '山下達郎',
          catalogNumber: 'ｂｖｃｒ－１００１',
          releaseDate: '1980/09/19',
          tags: ['シティポップ', '1980年代'],
          tracks: [{ trackNumber: 1, title: 'いつか (SOMEDAY)', duration: '05:49' }],
        },
      ],
    });

    const parsed = parseJSONToCDs(jsonPayload);
    assert.strictEqual(parsed.totalAlbums, 1);
    assert.strictEqual(parsed.totalTracks, 1);
    assert.strictEqual(parsed.cds[0].catalogNumber, 'BVCR-1001', 'インポート時に型番が半角大文字に正規化されること');
    assert.strictEqual(parsed.cds[0].releaseDate, '1980-09-19', 'インポート時に日付がYYYY-MM-DDに正規化されること');
  });

  await runTest(
    'データ入出力・セキュリティ',
    '裏ジャケット・帯・盤面・歌詞カード・その他付属画像 (subImages) の全形式（CSV・Googleシート/Excel・JSON）書き出し＆インポート完全往復検証',
    () => {
      const cdWithSubImages: CDMetadata = {
        id: 'test-subimages-1',
        title: 'FOR YOU',
        artist: '山下達郎',
        catalogNumber: 'RAL-8801',
        label: 'AIR / RVC',
        releaseDate: '1982-01-21',
        coverUrl: 'https://example.com/front.jpg',
        subImages: [
          { id: 's1', type: 'back', label: '裏ジャケット (バックインレイ)', imageUrl: 'https://example.com/back.jpg' },
          { id: 's2', type: 'obi', label: '帯 (オビ)', imageUrl: 'https://example.com/obi.jpg' },
          { id: 's3', type: 'disc', label: '盤面 (ディスク・レーベル面)', imageUrl: 'https://example.com/disc.jpg' },
          { id: 's4', type: 'booklet', label: '歌詞カード・ブックレット (1)', imageUrl: 'https://example.com/booklet1.jpg' },
          { id: 's5', type: 'booklet', label: '歌詞カード・ブックレット (2)', imageUrl: 'https://example.com/booklet2.jpg' },
          { id: 's6', type: 'other', label: '初回特典ステッカー', imageUrl: 'https://example.com/sticker.jpg' },
        ],
        tracks: [
          { trackNumber: 1, title: 'SPARKLE', duration: '04:13' },
          { trackNumber: 2, title: 'MUSIC BOOK', duration: '05:08' },
        ],
        source: 'musicbrainz',
        createdAt: '2026-10-10T00:00:00+09:00',
        updatedAt: '2026-10-10T00:00:00+09:00',
      };

      // 1) CSV (アルバム一覧 & 全曲統合) に5種類の付属画像URLがすべて書き出されているか検証
      const albumsCsv = generateAlbumsCSVContent([cdWithSubImages]);
      assert.strictEqual(albumsCsv.includes('裏ジャケット'), true, 'CSVヘッダーに裏ジャケットが含まれること');
      assert.strictEqual(albumsCsv.includes('帯'), true, 'CSVヘッダーに帯が含まれること');
      assert.strictEqual(albumsCsv.includes('盤面'), true, 'CSVヘッダーに盤面が含まれること');
      assert.strictEqual(albumsCsv.includes('歌詞カード・ブックレット'), true, 'CSVヘッダーに歌詞カード・ブックレットが含まれること');
      assert.strictEqual(albumsCsv.includes('その他付属画像'), true, 'CSVヘッダーにその他付属画像が含まれること');
      assert.strictEqual(albumsCsv.includes('https://example.com/back.jpg'), true);
      assert.strictEqual(albumsCsv.includes('https://example.com/obi.jpg'), true);
      assert.strictEqual(albumsCsv.includes('https://example.com/disc.jpg'), true);
      assert.strictEqual(albumsCsv.includes('https://example.com/booklet1.jpg || https://example.com/booklet2.jpg'), true);
      assert.strictEqual(albumsCsv.includes('https://example.com/sticker.jpg'), true);

      // CSVの行をそのまま parseSpreadsheetRowsToCDs に渡した際も5種類すべての付属画像が復元されること
      const csvLines = albumsCsv.replace(/^\uFEFF/, '').split('\r\n');
      const csvHeaders = csvLines[0].split(',');
      const csvRow = csvLines[1].split(',').map((cell) => cell.replace(/^"|"$/g, '').replace(/""/g, '"'));
      const parsedFromCsv = parseSpreadsheetRowsToCDs(csvHeaders, [csvRow]);
      assert.strictEqual(parsedFromCsv.length, 1);
      assert.strictEqual(parsedFromCsv[0].subImages?.length, 6, 'CSVからインポートしたCDでもsubImages全6件が復元されること');

      const combinedCsv = generateCombinedCSVContent([cdWithSubImages]);
      assert.strictEqual(combinedCsv.includes('https://example.com/back.jpg'), true);
      assert.strictEqual(combinedCsv.includes('https://example.com/obi.jpg'), true);
      assert.strictEqual(combinedCsv.includes('https://example.com/disc.jpg'), true);
      assert.strictEqual(combinedCsv.includes('https://example.com/booklet1.jpg || https://example.com/booklet2.jpg'), true);
      assert.strictEqual(combinedCsv.includes('https://example.com/sticker.jpg'), true);

      // 2) Google シート / Excel 行データの書き出しと、parseSpreadsheetRowsToCDs によるインポート復元検証
      const headers = DEFAULT_COLUMN_CONFIG.filter((c) => c.enabled).map((c) => c.label);
      const rowValues = formatCDToRowValues(cdWithSubImages, DEFAULT_COLUMN_CONFIG, { forGoogleSheetsFormula: false });
      const parsedFromSheet = parseSpreadsheetRowsToCDs(headers, [rowValues]);
      assert.strictEqual(parsedFromSheet.length, 1);
      const restoredSheetCD = parsedFromSheet[0];
      assert.strictEqual(Array.isArray(restoredSheetCD.subImages), true, 'シートからインポートしたCDにsubImagesが復元されること');
      assert.strictEqual(restoredSheetCD.subImages?.length, 6, '複数枚のブックレットを含む計6枚の付属画像がすべて復元されること');
      assert.strictEqual(restoredSheetCD.subImages?.find((s) => s.type === 'back')?.imageUrl, 'https://example.com/back.jpg');
      assert.strictEqual(restoredSheetCD.subImages?.find((s) => s.type === 'obi')?.imageUrl, 'https://example.com/obi.jpg');
      assert.strictEqual(restoredSheetCD.subImages?.find((s) => s.type === 'disc')?.imageUrl, 'https://example.com/disc.jpg');
      assert.strictEqual(
        restoredSheetCD.subImages?.filter((s) => s.type === 'booklet').map((s) => s.imageUrl).join(','),
        'https://example.com/booklet1.jpg,https://example.com/booklet2.jpg'
      );
      assert.strictEqual(restoredSheetCD.subImages?.find((s) => s.type === 'other')?.imageUrl, 'https://example.com/sticker.jpg');

      // Google Sheets の =IMAGE("...") 数式形式で書き出されたセルからもURLが正確に抽出・インポートされるか検証
      const rowFormulaValues = formatCDToRowValues(cdWithSubImages, DEFAULT_COLUMN_CONFIG, { forGoogleSheetsFormula: true });
      const parsedFromFormulaSheet = parseSpreadsheetRowsToCDs(headers, [rowFormulaValues]);
      assert.strictEqual(parsedFromFormulaSheet[0].subImages?.find((s) => s.type === 'back')?.imageUrl, 'https://example.com/back.jpg');
      assert.strictEqual(parsedFromFormulaSheet[0].subImages?.find((s) => s.type === 'obi')?.imageUrl, 'https://example.com/obi.jpg');

      // 3) JSON バックアップのエクスポート構造とインポート復元検証
      const jsonStr = JSON.stringify({
        app: 'CDCollectionManager',
        version: '1.0',
        cds: [cdWithSubImages],
      });
      const parsedFromJson = parseJSONToCDs(jsonStr);
      assert.strictEqual(parsedFromJson.cds.length, 1);
      assert.strictEqual(parsedFromJson.cds[0].subImages?.length, 6, 'JSONインポート時にsubImages全6件が保持されること');
      assert.strictEqual(parsedFromJson.cds[0].subImages?.[0].type, 'back');
      assert.strictEqual(parsedFromJson.cds[0].subImages?.[1].type, 'obi');
      assert.strictEqual(parsedFromJson.cds[0].subImages?.[2].type, 'disc');
    }
  );

  // ---------------------------------------------------------------------------
  // 6. SSRF保護・セキュリティ検証
  // ---------------------------------------------------------------------------
  await runTest('サーバーセキュリティ（SSRF防御）', 'プライベートIP・ループバック・クラウドメタデータIPの遮断検証', async () => {
    assert.strictEqual(isPrivateOrReservedIP('127.0.0.1'), true);
    assert.strictEqual(isPrivateOrReservedIP('10.0.0.1'), true);
    assert.strictEqual(isPrivateOrReservedIP('192.168.1.1'), true);
    assert.strictEqual(isPrivateOrReservedIP('169.254.169.254'), true);
    assert.strictEqual(isPrivateOrReservedIP('::1'), true);
    assert.strictEqual(isPrivateOrReservedIP('8.8.8.8'), false);

    let blockedLocalhost = false;
    try {
      await validateSafeExternalUrl('http://localhost:3000/api/health');
    } catch {
      blockedLocalhost = true;
    }
    assert.strictEqual(blockedLocalhost, true, 'localhostへのSSRFアクセスが拒否されること');

    let blockedMetadata = false;
    try {
      await validateSafeExternalUrl('http://169.254.169.254/latest/meta-data/');
    } catch {
      blockedMetadata = true;
    }
    assert.strictEqual(blockedMetadata, true, 'クラウドメタデータIPへのSSRFアクセスが拒否されること');
  });

  // ---------------------------------------------------------------------------
  // 7. バックエンドAPI エンドポイント稼働・バリデーション検証 (Port 3000)
  // ---------------------------------------------------------------------------
  const BASE_URL = 'http://127.0.0.1:3000';

  await runTest('バックエンドAPI検証', 'GET /api/health ヘルスチェックとセキュリティヘッダーの確認', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as any;
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  });

  await runTest('バックエンドAPI検証', 'POST /api/search 空リクエスト時の400バリデーション確認', async () => {
    const res = await fetch(`${BASE_URL}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
    const data = (await res.json()) as any;
    assert.strictEqual(typeof data.error, 'string');
  });

  await runTest('バックエンドAPI検証', 'POST /api/search 実データ検索（iTunes / MusicBrainz / NDL 統合検索）の疎通確認', async () => {
    const res = await fetch(`${BASE_URL}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: '宇多田ヒカル',
        title: 'First Love',
        sources: ['itunes', 'musicbrainz'],
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as any;
    assert.strictEqual(Array.isArray(data.candidates), true, 'candidates配列が返却されること');
    assert.strictEqual(typeof data.sourceResults, 'object', 'sourceResultsオブジェクトが返却されること');
  });

  await runTest('バックエンドAPI検証', 'GET /api/image-proxy 不正URL（SSRF: 127.0.0.1）の遮断確認', async () => {
    const res = await fetch(`${BASE_URL}/api/image-proxy?url=${encodeURIComponent('http://127.0.0.1:3000/api/health')}`);
    assert.strictEqual(res.status, 400);
  });

  await runTest('バックエンドAPI検証', 'POST /api/image-base64 SVGデータURL（XSSリスク）の遮断確認', async () => {
    const res = await fetch(`${BASE_URL}/api/image-base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }),
    });
    assert.strictEqual(res.status, 400);
    const data = (await res.json()) as any;
    assert.strictEqual(data.error.includes('SVG'), true);
  });

  await runTest('バックエンドAPI検証', '未定義の /api/* エンドポイントに対するJSON 404応答確認', async () => {
    const res = await fetch(`${BASE_URL}/api/non-existent-route-check`);
    assert.strictEqual(res.status, 404);
    const data = (await res.json()) as any;
    assert.strictEqual(typeof data.error, 'string');
  });

  // ---------------------------------------------------------------------------
  // サマリー出力
  // ---------------------------------------------------------------------------
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log('\n======================================================');
  console.log(`  テスト完了: 全 ${results.length} 項目中 ${passedCount} 項目成功 / ${failedCount} 項目失敗`);
  console.log('======================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
