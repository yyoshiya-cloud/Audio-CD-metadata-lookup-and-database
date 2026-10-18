/**
 * 検索ロジックの検証スクリプト（外部APIには接続しない）。
 * 実行: npm run verify:search
 */
import assert from 'node:assert/strict';
import type { CDMetadata } from '../src/types/cd.ts';
import {
  artistSimilarity,
  barcodeKey,
  catnoBase,
  catnoCompatible,
  catnoVariants,
  cleanTitleForMatching,
  cqlQuote,
  decodeXmlEntities,
  luceneQuote,
  normalizeCatNo,
  normalizeSearchQuery,
  spotifyQuote,
  titleSimilarity,
} from '../server/searchUtils.ts';
import { mergeCDCandidates, pickAnchorItem } from '../server/searchMerge.ts';
import { buildNDLQuery, parseNDLXmlResponse } from '../server/ndl.ts';
import { describeSpotifyHttpError, searchSpotify } from '../server/spotify.ts';
import { cleanDiscogsArtist, mapDiscogsResult, pickDiscogsBarcode } from '../server/discogs.ts';
import { buildReleaseQueries, pickLabelInfo } from '../server/musicbrainz.ts';
import { ImageCache } from '../server/imageCache.ts';
import { resolvePreviewToggle } from '../src/utils/searchPreviewMode.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  ✗ ${name}\n      ${e.message}`);
  }
}

function cd(p: Partial<CDMetadata> & { source: CDMetadata['source'] }): CDMetadata {
  return {
    id: `${p.source}-${Math.random()}`,
    catalogNumber: '',
    title: 'Unknown Title',
    artist: 'Unknown Artist',
    tracks: [],
    createdAt: '',
    updatedAt: '',
    ...p,
  } as CDMetadata;
}

console.log('入力の正規化');
test('全角の型番・ダッシュを正規化', () => {
  assert.equal(normalizeCatNo('ＳＲＣＬ－１２３４'), 'SRCL1234');
  assert.equal(normalizeCatNo('srcl‐1234'), 'SRCL1234');
  assert.equal(normalizeCatNo('SRCLー1234'), 'SRCL1234');
});
test('複数枚組表記は先頭を基準にする', () => {
  assert.equal(catnoBase('WPCL-10001/2'), 'WPCL10001');
  assert.equal(catnoBase('ESCL-5000〜1'), 'ESCL5000');
  assert.ok(catnoCompatible('WPCL-10001/2', 'WPCL10001'));
  assert.ok(!catnoCompatible('SRCL-1234', 'SRCL-12345'));
  assert.ok(catnoCompatible('', 'SRCL-1234'));
});
test('型番のバリエーション生成', () => {
  assert.deepEqual(catnoVariants('SRCL1234'), ['SRCL1234', 'SRCL-1234']);
  assert.deepEqual(catnoVariants('srcl 1234'), ['srcl 1234', 'SRCL-1234', 'SRCL1234']);
});
test('バーコード: 全角数字・UPC/EANの先頭ゼロ差・不正桁数', () => {
  assert.equal(barcodeKey('４９８８００９０１２３４５'), '4988009012345'.replace(/^0+/, ''));
  assert.equal(barcodeKey('012345678905'), barcodeKey('0012345678905'));
  assert.equal(barcodeKey('12345'), '');
});
test('検索クエリの正規化（全角・長さ制限・型）', () => {
  const q = normalizeSearchQuery({
    catalogNumber: 'ｓｒｃｌ－１２３４',
    barcode: '４９８８-００９０-１２３４５',
    title: '　Ａｂｃ　　Ｄｅｆ ',
    artist: 123 as any,
    freeText: 'x'.repeat(500),
  });
  assert.equal(q.catalogNumber, 'SRCL-1234');
  assert.equal(q.barcode, '4988009012345');
  assert.equal(q.title, 'Abc Def');
  assert.equal(q.artist, '');
  assert.equal(q.freeText.length, 200);
});

console.log('エスケープ');
test('Lucene / CQL / Spotify の引用符エスケープ', () => {
  assert.equal(luceneQuote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(cqlQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(spotifyQuote('a "b" c'), '"a b c"');
});
test('XML文字参照のデコード', () => {
  assert.equal(decodeXmlEntities('R&amp;B &lt;best&gt; &#x30A2;&#12354;'), 'R&B <best> アあ');
});

console.log('類似度');
test('タイトル: 版情報・配信接尾辞・全角半角・カナを吸収', () => {
  assert.equal(cleanTitleForMatching('First Love (2014 Remaster)'), cleanTitleForMatching('FIRST LOVE'));
  assert.equal(cleanTitleForMatching('Ｆｉｒｓｔ　Ｌｏｖｅ - Single'), cleanTitleForMatching('first love'));
  assert.equal(cleanTitleForMatching('ありがとう'), cleanTitleForMatching('アリガトウ'));
  assert.equal(cleanTitleForMatching('♪'), '♪'); // 記号のみのタイトルは空にしない
});
test('タイトル: 短い包含は別作品として扱う', () => {
  assert.ok(titleSimilarity('Best', 'Best Hits') < 0.9);
  assert.ok(titleSimilarity('Fate/Zero', 'Fate Zero') >= 0.99);
});
test('アーティスト: feat. 表記・1文字名', () => {
  assert.ok(artistSimilarity('Utada Hikaru feat. X', 'Utada Hikaru') >= 0.8);
  assert.equal(artistSimilarity('嵐', '嵐ベスト'), 0);
  assert.ok(artistSimilarity('Various Artists', 'オムニバス') > 0);
});

console.log('結合・スコアリング');
test('型番検索: 型番なしの別ソースも同一CDに統合され、型番一致のみが exact', () => {
  const items = [
    cd({ source: 'musicbrainz', catalogNumber: 'SRCL-1234', title: 'First Love', artist: '宇多田ヒカル', barcode: '4988009012345' }),
    cd({ source: 'ndl', title: 'First Love', artist: '宇多田ヒカル' }),
    cd({ source: 'itunes', title: 'First Love', artist: '宇多田ヒカル', coverUrl: 'http://img/600' }),
    cd({ source: 'itunes', title: 'Distance', artist: '宇多田ヒカル' }), // 同アーティストの別アルバム
  ];
  const r = mergeCDCandidates(items, { catalogNumber: 'SRCL-1234' }, { identifierOnly: true });
  assert.equal(r.length, 1, `候補数: ${r.length}`);
  assert.deepEqual([...r[0].sourcesMatched].sort(), ['itunes', 'musicbrainz', 'ndl']);
  assert.ok(r[0].exactMatchTypes?.includes('catalogNumber'));
  assert.ok(r[0].matchScore >= 95);
  assert.equal(r[0].cd.coverUrl, 'http://img/600');
  assert.equal(r[0].cd.barcode, '4988009012345');
});
test('型番を返さないソースだけの候補は、検索型番を補っても exact にならない', () => {
  const items = [cd({ source: 'ndl', title: '何かの本', artist: '誰か' })];
  const r = mergeCDCandidates(items, { catalogNumber: 'SRCL-1234' });
  assert.equal(r.length, 1);
  assert.equal(r[0].isExactMatch, false);
  assert.equal(r[0].cd.catalogNumber, 'SRCL-1234'); // 表示・保存用には補う
});
test('型番が異なる同名盤（通常盤/限定盤）は統合しない', () => {
  const items = [
    cd({ source: 'musicbrainz', catalogNumber: 'AVCD-1111', title: 'Album', artist: 'Band' }),
    cd({ source: 'discogs', catalogNumber: 'AVCD-1111B', title: 'Album', artist: 'Band' }),
  ];
  const r = mergeCDCandidates(items, { title: 'Album' });
  assert.equal(r.length, 2);
});
test('JANが異なる同名盤は統合しない / 同一JANは統合する', () => {
  const diff = mergeCDCandidates(
    [
      cd({ source: 'musicbrainz', title: 'Album', artist: 'Band', barcode: '4988009012345' }),
      cd({ source: 'rakuten', title: 'Album', artist: 'Band', barcode: '4988009099999' }),
    ],
    { title: 'Album' }
  );
  assert.equal(diff.length, 2);
  const same = mergeCDCandidates(
    [
      cd({ source: 'musicbrainz', title: 'Album', artist: 'Band', barcode: '4988009012345' }),
      cd({ source: 'rakuten', title: 'Totally Different Name', artist: 'X', barcode: '4988009012345' }),
    ],
    { barcode: '4988009012345' }
  );
  assert.equal(same.length, 1);
  assert.ok(same[0].exactMatchTypes?.includes('barcode'));
  assert.equal(same[0].matchScore, 100);
});
test('短いタイトルの部分一致で別作品を統合しない', () => {
  const r = mergeCDCandidates(
    [
      cd({ source: 'musicbrainz', title: 'Best', artist: 'Band' }),
      cd({ source: 'itunes', title: 'Best Hits Collection', artist: 'Band' }),
    ],
    { title: 'Best' }
  );
  assert.equal(r.length, 2);
});
test('プレースホルダ ("Unknown Artist") を採用しない', () => {
  const r = mergeCDCandidates(
    [
      cd({ source: 'ndl', title: 'Album', artist: 'Unknown Artist', barcode: '4988009012345' }),
      cd({ source: 'musicbrainz', title: 'Album', artist: 'Band', barcode: '4988009012345' }),
    ],
    { barcode: '4988009012345' }
  );
  assert.equal(r[0].cd.artist, 'Band');
});
test('配信サービスの copyright はレーベルとして採用しない / 年月日を優先', () => {
  const r = mergeCDCandidates(
    [
      cd({ source: 'discogs', catalogNumber: 'SRCL-1', title: 'A', artist: 'B', releaseDate: '1999' }),
      cd({ source: 'musicbrainz', catalogNumber: 'SRCL-1', title: 'A', artist: 'B', releaseDate: '1999-03-10', label: 'Sony' }),
      cd({ source: 'itunes', catalogNumber: '', title: 'A', artist: 'B', label: '℗ 2019 Sony Music', releaseDate: '2019-01-01' }),
    ],
    { catalogNumber: 'SRCL-1' }
  );
  assert.equal(r[0].cd.label, 'Sony');
  assert.equal(r[0].cd.releaseDate, '1999-03-10');
});
test('キーワード検索: タイトル+アーティスト完全一致が部分一致より上位', () => {
  const r = mergeCDCandidates(
    [
      cd({ source: 'itunes', title: 'First Love (Live Tour Special Edition Box)', artist: '別のアーティスト' }),
      cd({ source: 'musicbrainz', catalogNumber: 'TOCT-1', title: 'First Love', artist: '宇多田ヒカル' }),
    ],
    { title: 'First Love', artist: '宇多田ヒカル' }
  );
  assert.equal(r[0].cd.artist, '宇多田ヒカル');
  assert.ok(r[0].isExactMatch);
  assert.ok(r[0].matchScore > r[r.length - 1].matchScore);
});
test('曲名検索: 収録曲に一致するアルバムが exact', () => {
  const r = mergeCDCandidates(
    [
      cd({
        source: 'musicbrainz',
        title: 'Album',
        artist: 'Band',
        tracks: [
          { trackNumber: 1, title: 'Intro' },
          { trackNumber: 2, title: 'Automatic' },
        ],
      }),
    ],
    { trackTitle: 'Automatic' }
  );
  assert.ok(r[0].isExactMatch);
});
test('基準レコード選択: 型番一致を優先', () => {
  const a = cd({ source: 'ndl', title: 'Wrong', artist: 'X', catalogNumber: 'AAAA-1' });
  const b = cd({ source: 'musicbrainz', title: 'Right', artist: 'Y', catalogNumber: 'SRCL-1234' });
  assert.equal(pickAnchorItem([a, b], 'SRCL1234', '')?.title, 'Right');
  assert.equal(pickAnchorItem([cd({ source: 'ndl' })], 'SRCL1234', ''), undefined);
});

console.log('ソース別パーサ');
test('NDL: 実体参照のデコード・型番/JANの厳密抽出・スラッシュ入りタイトル', () => {
  const xml = `<searchRetrieveResponse><records><record><recordData>
    <dc:title>Fate/Zero R&amp;B Collection</dc:title>
    <dc:creator>山田, 太郎</dc:creator>
    <dc:identifier>JP21234567</dc:identifier>
    <dc:identifier>SRCL-1234</dc:identifier>
    <dc:identifier>4988009012345</dc:identifier>
    <dcterms:issued>2001.3</dcterms:issued>
  </recordData></record></records></searchRetrieveResponse>`;
  const [r] = parseNDLXmlResponse(xml);
  assert.equal(r.title, 'Fate/Zero R&B Collection');
  assert.equal(r.catalogNumber, 'SRCL-1234');
  assert.equal(r.barcode, '4988009012345');
});
test('NDL: 録音資料(mediatype = audio)に絞り込む / 索引は anywhere / = の前後に空白', () => {
  const q = buildNDLQuery({ title: 'Original Love', artist: 'Sandy "S"' });
  assert.equal(q, 'title = "Original Love" AND creator = "Sandy \\"S\\"" AND mediatype = audio');
  assert.ok(!/\bany\s*=/.test(buildNDLQuery({ freeText: 'x' })));
  assert.equal(buildNDLQuery({ freeText: 'さくら' }), 'anywhere = "さくら" AND mediatype = audio');
  const cat = buildNDLQuery({ catno: 'SRCL1234' });
  assert.ok(cat.startsWith('(anywhere = "SRCL1234" OR title = "SRCL1234" OR anywhere = "SRCL-1234"'));
  assert.ok(cat.endsWith(' AND mediatype = audio'));
  const both = buildNDLQuery({ catno: 'SRCL-1234', barcode: '4988009012345' });
  assert.ok(both.includes('isbn = "4988009012345"') && both.endsWith(' AND mediatype = audio'));
  assert.equal(buildNDLQuery({}), '');
});
test('NDL: 型番が無いレコードに検索型番を付けない', () => {
  const xml = `<recordData><dc:title>本のタイトル</dc:title><dc:identifier>JP20000001</dc:identifier></recordData>`;
  const [r] = parseNDLXmlResponse(xml);
  assert.equal(r.catalogNumber, '');
});
test('NDL: XMLエスケープされた recordData も解析できる', () => {
  const xml = `<recordData>&lt;rdf:RDF&gt;&lt;dc:title&gt;Escaped Title&lt;/dc:title&gt;&lt;/rdf:RDF&gt;</recordData>`;
  assert.equal(parseNDLXmlResponse(xml)[0]?.title, 'Escaped Title');
});
test('Discogs: アーティスト接尾辞・バーコード選別・型番none', () => {
  assert.equal(cleanDiscogsArtist('Mr.Children (2)'), 'Mr.Children');
  assert.equal(pickDiscogsBarcode(['SRCL 1234 A1', '4 988009 012345']), '4988009012345');
  const r = mapDiscogsResult({ id: 1, title: 'Band (3) - Album - Deluxe', catno: 'none', year: 2000 });
  assert.equal(r.artist, 'Band');
  assert.equal(r.title, 'Album - Deluxe');
  assert.equal(r.catalogNumber, '');
});
test('MusicBrainz: クエリのエスケープ・型番バリエーション・段階的緩和', () => {
  const q = buildReleaseQueries({ title: 'He said "hi"', artist: 'A\\B' });
  assert.equal(q.length, 2);
  assert.ok(q[0].includes('release:"He said \\"hi\\""'));
  assert.ok(q[0].includes('artist:"A\\\\B"'));
  assert.equal(q[1], 'release:"He said \\"hi\\""');
  assert.equal(buildReleaseQueries({ catno: 'SRCL1234' })[0], 'catno:"SRCL1234" OR catno:"SRCL-1234"');
  assert.deepEqual(buildReleaseQueries({ barcode: '4988009012345' }), ['barcode:4988009012345']);
});
test('MusicBrainz: 複数 label-info から検索型番に一致するものを採用', () => {
  const li = [
    { label: { name: 'Other' }, 'catalog-number': 'ZZZZ-1' },
    { label: { name: 'Sony' }, 'catalog-number': 'SRCL-1234' },
  ];
  assert.deepEqual(pickLabelInfo(li, 'SRCL1234'), { label: 'Sony', catalogNumber: 'SRCL-1234' });
  assert.deepEqual(pickLabelInfo([], 'SRCL1234'), { label: '', catalogNumber: '' });
});



console.log('Spotify');
test('Spotify: HTTPエラーの説明（403はPremium要件、429は待機時間）', () => {
  assert.ok(describeSpotifyHttpError(403).includes('Premium'));
  assert.ok(describeSpotifyHttpError(429, '30').includes('30秒後'));
  assert.ok(describeSpotifyHttpError(401).includes('401'));
  assert.ok(describeSpotifyHttpError(500).includes('500'));
});

console.log('検索結果の表示切替');
test('スプリット→モーダル表示: プレビューを閉じるだけ（詳細モーダルを開く指示を返さない）', () => {
  const r = resolvePreviewToggle('modal', { candidateIds: ['a', 'b'], splitId: 'b', lastViewedId: 'b' });
  assert.deepEqual(r, { mode: 'modal', splitPreviewId: null });
});
test('モーダル→スプリット表示: フォーカス中のアルバムを右に表示', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(resolvePreviewToggle('inline', { candidateIds: ids, lastViewedId: 'c' }).splitPreviewId, 'c');
  assert.equal(resolvePreviewToggle('inline', { candidateIds: ids, modalId: 'b', lastViewedId: 'c' }).splitPreviewId, 'b');
  assert.equal(resolvePreviewToggle('inline', { candidateIds: ids }).splitPreviewId, 'a');
  assert.equal(resolvePreviewToggle('inline', { candidateIds: ids, lastViewedId: 'zzz' }).splitPreviewId, 'a');
  assert.equal(resolvePreviewToggle('inline', { candidateIds: [] }).splitPreviewId, null);
});

console.log('ジャケット画像');
test('ジャケット候補は優先順（iTunes→…→Discogs→MusicBrainz）で重複なく並ぶ', () => {
  const r = mergeCDCandidates(
    [
      cd({ source: 'musicbrainz', catalogNumber: 'SRCL-1', title: 'A', artist: 'B', coverUrl: 'http://caa/mb' }),
      cd({ source: 'discogs', catalogNumber: 'SRCL-1', title: 'A', artist: 'B', coverUrl: 'http://discogs/d' }),
      cd({ source: 'itunes', title: 'A', artist: 'B', coverUrl: 'http://itunes/i' }),
      cd({ source: 'rakuten', title: 'A', artist: 'B', coverUrl: 'http://itunes/i' }), // 重複URL
    ],
    { catalogNumber: 'SRCL-1' }
  );
  assert.deepEqual(r[0].cd.coverCandidates, ['http://itunes/i', 'http://discogs/d', 'http://caa/mb']);
  assert.equal(r[0].cd.coverUrl, 'http://itunes/i');
});
test('MusicBrainz だけの候補でも coverUrl が空ならジャケット候補は空', () => {
  const r = mergeCDCandidates([cd({ source: 'musicbrainz', catalogNumber: 'X-1', title: 'A', artist: 'B', coverUrl: '' })], { catalogNumber: 'X-1' });
  assert.deepEqual(r[0].cd.coverCandidates, []);
  assert.equal(r[0].cd.coverUrl, '');
});

console.log('画像キャッシュ');
const img = (n: number) => ({ buffer: Buffer.alloc(n, 1), mimeType: 'image/jpeg' });
async function asyncTests() {
  // 認証情報が無いときは、空配列で黙らず理由つきのエラーになる
  const savedId = process.env.SPOTIFY_CLIENT_ID;
  const savedSecret = process.env.SPOTIFY_CLIENT_SECRET;
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  await assert.rejects(() => searchSpotify({ artist: '伊藤つかさ' }), /未設定/);
  if (savedId) process.env.SPOTIFY_CLIENT_ID = savedId;
  if (savedSecret) process.env.SPOTIFY_CLIENT_SECRET = savedSecret;

  let calls = 0;
  const cache = new ImageCache(1024, 512, 1000, 500, () => clock);
  let clock = 0;
  const slow = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return img(100);
  };
  // 同時リクエストは1回の取得にまとめられる
  const [a, b] = await Promise.all([cache.getOrFetch('u1', slow), cache.getOrFetch('u1', slow)]);
  assert.equal(calls, 1);
  assert.equal(a.buffer.byteLength, b.buffer.byteLength);
  // 2回目以降はキャッシュから
  await cache.getOrFetch('u1', slow);
  assert.equal(calls, 1);
  // 期限切れで再取得
  clock = 1001;
  await cache.getOrFetch('u1', slow);
  assert.equal(calls, 2);
  // 失敗は短時間キャッシュされ、同じエラーが返る（再取得しない）
  let failCalls = 0;
  const fail = async () => {
    failCalls++;
    throw new Error('HTTP 404');
  };
  await assert.rejects(() => cache.getOrFetch('bad', fail), /404/);
  await assert.rejects(() => cache.getOrFetch('bad', fail), /404/);
  assert.equal(failCalls, 1);
  clock += 501; // 失敗キャッシュの期限後は再試行
  await assert.rejects(() => cache.getOrFetch('bad', fail), /404/);
  assert.equal(failCalls, 2);
  // 容量超過で古いものから削除（合計1024バイト）
  for (let i = 0; i < 12; i++) await cache.getOrFetch(`k${i}`, async () => img(100));
  assert.ok(cache.size <= 11, `size=${cache.size}`);
  // 1件あたりの上限超過はキャッシュしない
  let big = 0;
  await cache.getOrFetch('big', async () => (big++, img(600)));
  await cache.getOrFetch('big', async () => (big++, img(600)));
  assert.equal(big, 2);
}

await asyncTests().then(
  () => { passed++; console.log('  ✓ ImageCache: 集約・キャッシュ・期限・失敗記憶・容量・サイズ上限'); },
  (e: any) => { failed++; console.error(`  ✗ ImageCache\n      ${e.message}`); }
);

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed > 0 ? 1 : 0);
