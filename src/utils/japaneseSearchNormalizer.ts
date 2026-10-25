import { CDMetadata, TrackInfo } from '../types/cd';

/**
 * Common Japanese song/album title orthographic variant rules (表記揺れ正規化辞書)
 * Maps frequently interchangeable Kanji / Okurigana / Kana forms in Japanese music metadata
 * so searching either form ("走ってください" or "走って下さい", "ひとり" or "独り", etc.) matches all variants.
 */
const JAPANESE_ORTHOGRAPHIC_SYNONYMS: [RegExp, string][] = [
  // Auxiliary verbs / expressions (補助動詞・連語の漢字/ひらがな表記揺れ)
  [/下さい/g, 'ください'],
  [/頂戴/g, 'ちょうだい'],
  [/頂き/g, 'いただき'],
  [/頂く/g, 'いただく'],
  [/致します/g, 'いたします'],
  [/致し/g, 'いたし'],
  [/出来/g, 'でき'],
  [/欲しい/g, 'ほしい'],
  [/欲しく/g, 'ほしく'],
  [/貰う/g, 'もらう'],
  [/貰い/g, 'もらい'],
  [/貰っ/g, 'もらっ'],
  [/呉れ/g, 'くれ'],
  [/上げ/g, 'あげ'],
  [/見たい/g, 'みたい'],
  [/見る/g, 'みる'],
  [/見て/g, 'みて'],
  [/見た/g, 'みた'],
  [/行く/g, 'いく'],
  [/行け/g, 'いけ'],
  [/行こ/g, 'いこ'],
  [/行っ/g, 'いっ'],
  [/来る/g, 'くる'],
  [/来て/g, 'きて'],
  [/来た/g, 'きた'],
  [/来ない/g, 'こない'],
  [/仕舞う/g, 'しまう'],
  [/仕舞っ/g, 'しまっ'],
  [/仕舞い/g, 'しまい'],

  // Pronouns & common nouns / adverbs in J-Pop / Folk / Kayokyoku titles
  [/私/g, 'わたし'],
  [/僕/g, 'ぼく'],
  [/君/g, 'きみ'],
  [/貴方/g, 'あなた'],
  [/貴女/g, 'あなた'],
  [/彼/g, 'かれ'],
  [/彼女/g, 'かのじょ'],
  [/誰/g, 'だれ'],
  [/何処/g, 'どこ'],
  [/何時/g, 'いつ'],
  [/何故/g, 'なぜ'],
  [/一人/g, 'ひとり'],
  [/独り/g, 'ひとり'],
  [/二人/g, 'ふたり'],
  [/２人/g, 'ふたり'],
  [/2人/g, 'ふたり'],
  [/涙/g, 'なみだ'],
  [/泪/g, 'なみだ'],
  [/季節/g, 'きせつ'],
  [/時代/g, 'じだい'],
  [/手紙/g, 'てがみ'],
  [/写真/g, 'しゃしん'],
  [/約束/g, 'やくそく'],
  [/言葉/g, 'ことば'],
  [/言の葉/g, 'ことのは'],
  [/心/g, 'こころ'],
  [/想い出/g, 'おもいで'],
  [/思い出/g, 'おもいで'],
  [/想い/g, 'おもい'],
  [/思い/g, 'おもい'],
  [/逢い/g, 'あい'],
  [/会い/g, 'あい'],
  [/逢う/g, 'あう'],
  [/会う/g, 'あう'],
  [/逢え/g, 'あえ'],
  [/会え/g, 'あえ'],
  [/逢った/g, 'あった'],
  [/会った/g, 'あった'],
  [/聴こえ/g, 'きこえ'],
  [/聞こえ/g, 'きこえ'],
  [/聴く/g, 'きく'],
  [/聞く/g, 'きく'],
  [/聴い/g, 'きい'],
  [/聞い/g, 'きい'],
  [/唄/g, 'うた'],
  [/歌/g, 'うた'],
  [/詩/g, 'うた'],
  [/街/g, 'まち'],
  [/町/g, 'まち'],
  [/空/g, 'そら'],
  [/宙/g, 'そら'],
  [/風/g, 'かぜ'],
  [/雨/g, 'あめ'],
  [/雪/g, 'ゆき'],
  [/海/g, 'うみ'],
  [/星/g, 'ほし'],
  [/夜/g, 'よる'],
  [/朝/g, 'あさ'],
  [/春/g, 'はる'],
  [/夏/g, 'なつ'],
  [/秋/g, 'あき'],
  [/冬/g, 'ふゆ'],
  [/花/g, 'はな'],
  [/華/g, 'はな'],
  [/桜/g, 'さくら'],
  [/櫻/g, 'さくら'],
  [/夢/g, 'ゆめ'],
  [/愛/g, 'あい'],
  [/恋/g, 'こい'],
  [/旅/g, 'たび'],
  [/道/g, 'みち'],
  [/路/g, 'みち'],
  [/坂/g, 'さか'],
  [/駅/g, 'えき'],
  [/翼/g, 'つばさ'],
  [/光/g, 'ひかり'],
  [/影/g, 'かげ'],
  [/陰/g, 'かげ'],
  [/声/g, 'こえ'],
  [/瞳/g, 'ひとみ'],
  [/指/g, 'ゆび'],
  [/胸/g, 'むね'],
  [/頬/g, 'ほほ'],
  [/卒業/g, 'そつぎょう'],
  [/青春/g, 'せいしゅん'],
  [/初恋/g, 'はつこい'],
  [/失恋/g, 'しつれん'],
  [/元気/g, 'げんき'],
  [/笑顔/g, 'えがお'],
  [/明日/g, 'あした'],
  [/昨日/g, 'きのう'],
  [/今日/g, 'きょう'],
  [/今夜/g, 'こんや'],
  [/毎日/g, 'まいにち'],
  [/本当/g, 'ほんとう'],
  [/素敵/g, 'すてき'],
  [/不思議/g, 'ふしぎ'],
  [/大切/g, 'たいせつ'],
  [/優し/g, 'やさし'],
  [/悲し/g, 'かなし'],
  [/哀し/g, 'かなし'],
  [/淋し/g, 'さびし'],
  [/寂し/g, 'さびし'],
  [/愛し/g, 'いとし'],
  [/懐かし/g, 'なつかし'],
  [/眩し/g, 'まぶし'],
  [/切な/g, 'せつな'],
  [/刹那/g, 'せつな'],

  // Common verbs & okurigana variants
  [/走って/g, 'はしって'],
  [/走る/g, 'はしる'],
  [/走り/g, 'はしり'],
  [/歩いて/g, 'あるいて'],
  [/歩く/g, 'あるく'],
  [/歩き/g, 'あるき'],
  [/泣いて/g, 'ないて'],
  [/泣く/g, 'なく'],
  [/泣き/g, 'なき'],
  [/笑って/g, 'わらって'],
  [/笑う/g, 'わらう'],
  [/笑い/g, 'わらい'],
  [/踊る/g, 'おどる'],
  [/踊り/g, 'おどり'],
  [/踊っ/g, 'おどっ'],
  [/眠る/g, 'ねむる'],
  [/眠り/g, 'ねむり'],
  [/眠っ/g, 'ねむっ'],
  [/揺れ/g, 'ゆれ'],
  [/揺ら/g, 'ゆら'],
  [/忘れ/g, 'わすれ'],
  [/信じ/g, 'しんじ'],
  [/待っ/g, 'まっ'],
  [/待つ/g, 'まつ'],
  [/待ち/g, 'まち'],
  [/帰る/g, 'かえる'],
  [/帰り/g, 'かえり'],
  [/帰っ/g, 'かえっ'],
  [/還る/g, 'かえる'],
  [/還り/g, 'かえり'],
  [/振り返/g, 'ふりかえ'],
  [/振り向/g, 'ふりむ'],
  [/抱きしめ/g, 'だきしめ'],
  [/抱き締/g, 'だきしめ'],

  // Old/Variant Kanji (旧字体・異体字)
  [/邊/g, '辺'],
  [/邉/g, '辺'],
  [/齋/g, '斎'],
  [/齊/g, '斉'],
  [/渡邊/g, '渡辺'],
  [/渡邉/g, '渡辺'],
  [/廣/g, '広'],
  [/澤/g, '沢'],
  [/濱/g, '浜'],
  [/濵/g, '浜'],
  [/高/g, '高'],
  [/髙/g, '高'],
  [/崎/g, '崎'],
  [/﨑/g, '崎'],
  [/國/g, '国'],
  [/學/g, '学'],
  [/體/g, '体'],
  [/聲/g, '声'],
  [/戀/g, '恋'],
  [/靜/g, '静'],
  [/眞/g, '真'],
  [/遙/g, '遥'],
  [/遼/g, '遥'],
];

/**
 * Basic normalization: NFKC, lowercase, Katakana -> Hiragana, strip punctuation/spaces
 */
export function normalizeBasicSearchText(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .normalize('NFKC')
    .toLowerCase()
    // Katakana to Hiragana
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    // Remove spaces, brackets, wave dashes, punctuation
    .replace(/[\s　\-‐－―ー〜~()（）\[\]「」『』【】〈〉《》・,、.。!！?？'"”’&:：;；/／\\]/g, '')
    .trim();
}

/**
 * Deep Japanese orthographic normalization (表記揺れ吸収):
 * Converts interchangeable Kanji/Kana (e.g. "走って下さい" <-> "走ってください", "想い出" <-> "思い出")
 * into a unified canonical string so both forms match each other reliably.
 */
export function normalizeJapaneseSearchText(str?: string | null): string {
  if (!str) return '';
  let s = String(str).normalize('NFKC');
  for (const [pattern, replacement] of JAPANESE_ORTHOGRAPHIC_SYNONYMS) {
    s = s.replace(pattern, replacement);
  }
  return normalizeBasicSearchText(s);
}

/**
 * Checks if `targetText` matches a single `queryToken` using:
 * 1. Direct case-insensitive substring match
 * 2. Basic NFKC + Hiragana/Katakana + symbol-stripped match
 * 3. Deep Japanese orthographic variant (表記揺れ: 下さい/ください, 逢いたい/会いたい, etc.) match
 */
export function matchesSearchToken(targetText: string | undefined | null, queryToken: string): boolean {
  if (!targetText) return false;
  const rawToken = queryToken.trim().replace(/^#+/, '');
  if (!rawToken) return true;

  const lowerTarget = targetText.toLowerCase();
  const lowerToken = rawToken.toLowerCase();
  if (lowerTarget.includes(lowerToken)) return true;

  const basicTarget = normalizeBasicSearchText(targetText);
  const basicToken = normalizeBasicSearchText(rawToken);
  if (basicToken && basicTarget.includes(basicToken)) return true;

  const orthoTarget = normalizeJapaneseSearchText(targetText);
  const orthoToken = normalizeJapaneseSearchText(rawToken);
  if (orthoToken && orthoTarget.includes(orthoToken)) return true;

  return false;
}

/**
 * Checks if a CDMetadata record matches the given search query string (supports space-separated AND tokens).
 * - If a token starts with `#` (e.g., `#Instrumental`, `#J-Pop`), it strictly matches ONLY against `cd.tags` and `cd.genre`
 *   so that track titles like "〜 (Instrumental Version)" do not cause false positives when filtering by tag/genre.
 * - Normal tokens search across all metadata fields including `cd.tracks` (track titles & track artists) and `cd.notes`.
 */
export function matchesCDSearchQuery(cd: CDMetadata, searchQuery: string): boolean {
  const trimmed = searchQuery.trim();
  if (!trimmed) return true;

  const tokens = trimmed
    .split(/[\s　]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return true;

  const searchableFields: string[] = [
    cd.title || '',
    cd.artist || '',
    cd.catalogNumber || '',
    cd.vinylRecordCatalogNumber || '',
    cd.label || '',
    cd.barcode || '',
    cd.notes || '',
    cd.genre || '',
    ...(cd.tags || []),
    ...(cd.tracks || []).map((tr) => `${tr.title || ''} ${tr.artist || ''}`),
  ];

  const combinedText = searchableFields.join(' ');

  return tokens.every((tok) => {
    if (tok.startsWith('#')) {
      const tagName = tok.replace(/^#+/, '').trim();
      if (!tagName) return true;
      const lowerTag = tagName.toLowerCase();
      const basicTag = normalizeBasicSearchText(tagName);

      // Check cd.tags for exact or normalized tag match
      const hasMatchingTag = (cd.tags || []).some((t) => {
        const cleanT = t.trim().replace(/^#+/, '');
        if (!cleanT) return false;
        if (cleanT.toLowerCase() === lowerTag) return true;
        if (basicTag && normalizeBasicSearchText(cleanT) === basicTag) return true;
        return false;
      });
      if (hasMatchingTag) return true;

      // Also check cd.genre (in case the genre comes from cd.genre)
      if (cd.genre) {
        const genreParts = cd.genre.split(/\s*[/／,、]\s*/);
        const hasMatchingGenre = genreParts.some((g) => {
          const cleanG = g.trim();
          if (!cleanG) return false;
          if (cleanG.toLowerCase() === lowerTag) return true;
          if (basicTag && normalizeBasicSearchText(cleanG) === basicTag) return true;
          return false;
        });
        if (hasMatchingGenre) return true;
      }

      return false;
    }

    return matchesSearchToken(combinedText, tok);
  });
}

/**
 * Returns all tracks on a CD that match the given search query (useful for highlighting matched tracks in UI).
 * Ignores `#tag` tokens since tag filters target album tags rather than track titles.
 */
export function getMatchedTracksForQuery(cd: CDMetadata, searchQuery: string): TrackInfo[] {
  const trimmed = searchQuery.trim();
  if (!trimmed || !cd.tracks || cd.tracks.length === 0) return [];

  const tokens = trimmed
    .split(/[\s　]+/)
    .map((t) => t.trim())
    .filter((t) => Boolean(t) && !t.startsWith('#'));
  if (tokens.length === 0) return [];

  return cd.tracks.filter((tr) => {
    if (!tr || !tr.title) return false;
    return tokens.every((tok) => matchesSearchToken(tr.title, tok));
  });
}
