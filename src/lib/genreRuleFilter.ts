import { AITagEvidenceItem, TrackInfo } from '../types/cd';

export interface GenreRuleFilterInput {
  id?: string;
  title?: string;
  artist?: string;
  catalogNumber?: string;
  label?: string;
  releaseDate?: string;
  vinylRecordReleaseDate?: string;
  vinylRecordFormat?: string;
  vinylRecordCatalogNumber?: string;
  barcode?: string;
  country?: string;
  format?: string;
  genre?: string;
  existingTags?: string[];
  notes?: string;
  tracks?: TrackInfo[];
}

export interface GenreRulePrecheckResult {
  effectiveYear: number | null;
  effectiveDateSource: 'LP/EP発売年月日' | 'CD発売年月日' | '未設定';
  isPreJPopEra: boolean; // <= 1987 (before J-Pop term coined in 1988)
  isEarlyPreJPopEra: boolean; // <= 1985
  isWesternOrigin: boolean;
  enforcedPrimaryGenre?: string;
  enforcedTags: {
    tag: string;
    category: 'genre' | 'mood' | 'era' | 'style';
    evidence: string;
    sourceFields: string[];
  }[];
  blockedTags: {
    tag: string;
    reason: string;
    sourceFields: string[];
  }[];
  hasPositiveIdolSignal: boolean;
  idolSignalReasons: string[];
  trackDurationStats: {
    trackCount: number;
    avgDurationSec: number;
    maxDurationSec: number;
    hasKaraokeOrInstrumentalTracks: boolean;
    isLongFormInstrumentalOrClassicalStructure: boolean;
  };
}

export interface GenreRuleFilterOutput {
  genre: string;
  subGenre?: string;
  suggestedTags: string[];
  tagEvidence: AITagEvidenceItem[];
  ruleAdjustments: string[];
}

// ============================================================================
// 1. CATALOG NUMBER PREFIX RULES (規格品番プレフィックスによる専門ジャンル判定)
// ============================================================================

/** Classical dedicated domestic catalog prefixes (DG, Decca, Philips, Sony Classical, EMI Classics, Denon, Warner Classics, etc.) */
const CLASSICAL_CATALOG_PREFIX_REGEX =
  /^(UCCG|UCCP|UCCB|UCCD|POCG|F35G|F00G|F35L|SICC|SRCR|CSCL|32DC|28DC|TOCE|CC33|CC30|WPCS|BVCC|R32C|COCO|COCQ|33C37|35C37|32CO|VICC|VDC|KICC|K33Y)\b/i;

/** Jazz & Fusion dedicated domestic catalog prefixes (Blue Note, Verve, Impulse, Riverside, Sony Jazz, Victor Jazz, King Jazz, TBM) */
const JAZZ_CATALOG_PREFIX_REGEX =
  /^(UCCU|UCCJ|UCCV|POCJ|J33J|TOCJ|CJ32|SICJ|VRCL|VICJ|VIJ|KICJ|BVCJ|TBM|THCD|EWCD|MZCB)\b/i;

/** Anime / Voice Actor dedicated catalog prefixes (Lantis, King Starchild, FlyingDog, Aniplex, SACRA, Media Factory, Pony Canyon Anime, Columbia Animex) */
const ANIME_CATALOG_PREFIX_REGEX =
  /^(LACA|LACM|LASM|LASA|KICA|KICM|KIDA|KIGS|VTCL|VTZL|SVWC|VVCL|SACX|ZMCZ|ZMCP|PCCG|COCX|COCC|CODC|COBC|EYCA|AVCA|GNCA|GNCV|TKCA-7\d{4})\b/i;

/** Game Music dedicated catalog prefixes (Square Enix, DigiCube, Scitron, Wave Master, Team Entertainment) */
const GAME_CATALOG_PREFIX_REGEX =
  /^(SQEX|SSCX|PCCB|WWCE|KDSD|MJCD|SCDC|KICA-1\d{3})\b/i;

/** Western Music (洋楽) Japanese domestic issue catalog prefixes */
const WESTERN_CATALOG_PREFIX_REGEX =
  /^(UICY|UICP|UICO|UICE|POCP|POCT|MVCM|MVCG|P33P|SICP|ESCA|SRCS|25\s*8P|32\s*8P|WPCR|WMC5|AMCY|32XD|25P2|TOCP|CP32|BVCP|BVCM|R32P|VICP|VICW|ALCB|PCCY)\b/i;

/** Enka / Traditional Kayo catalog prefixes */
const ENKA_CATALOG_PREFIX_REGEX =
  /^(TECE|TECA|CRCN|CRSN|TKCA-9\d{4}|KICM-3\d{4}|COCA-1\d{4}|VICL-3\d{4})\b/i;

// ============================================================================
// 2. RECORD LABEL RULES (レーベル・発売元によるジャンル判定・誤判定抑制)
// ============================================================================

const CLASSICAL_LABEL_REGEX =
  /deutsche\s*grammophon|グラモフォン|decca|デッカ|philips\s*classics|フィリップス・クラシックス|emi\s*classics|sony\s*classical|ソニー・クラシカル|denon\s*classics|日本コロムビア.*denon|naxos|ナクソス|telarc|テラーク|harmonia\s*mundi|ハルモニア・ムンディ|archiv\s*produktion|アルヒーフ|erato|エラート|teldec|テルデック|london\s*records.*classic|fontec|フォンテック|オクタヴィア|octavia\s*records/i;

const JAZZ_LABEL_REGEX =
  /blue\s*note|ブルーノート|verve|ヴァーヴ|impulse!|インパルス|riverside|リバーサイド|prestige|プレスティッジ|\becm\b|three\s*blind\s*mice|スリー・ブラインド・マイス|somethin'?\s*else|サムシン・エルス|paddle\s*wheel|パドルホイール|concord\s*jazz|コンコード|\bcti\b|enja|エンヤ|milestone|マイルストーン|savoy\s*jazz|サヴォイ|venus\s*records|ヴィーナス・レコード|atelier\s*sawano|澤野工房/i;

const FUSION_LABEL_OR_KEYWORD_REGEX =
  /フュージョン|\bfusion\b|t-square|the\s*square|casiopea|カシオペア|高中正義|渡辺香津美|シャカタク|スタッフ|スパイロ・ジャイラ|クルセイダーズ|クロスオーバー|村田陽一|dimension|ディメンション/i;

const ANIME_GAME_LABEL_REGEX =
  /lantis|ランティス|flying\s*dog|flyingdog|フライングドッグ|aniplex|アニプレックス|sacra\s*music|starchild|スターチャイルド|king\s*amusement|media\s*factory|メディアファクトリー|kadokawa.*アニメ|ブシロードミュージック|bushiroad\s*music|square\s*enix|スクウェア・エニックス|nbc\s*universal.*anime|エイベックス・ピクチャーズ|avex\s*pictures|日本コロムビア.*animex|toho\s*animation|東宝アニメーション|バンダイナムコアーツ/i;

/** Folk / New Music / City Pop / Singer-Songwriter / Rock Labels (Strong Negative Signal against uncorroborated 'アイドル') */
const NON_IDOL_MUSICIAN_LABEL_REGEX =
  /\burc\b|アングラ・レコード・クラブ|エレック|elec\s*records|ベルウッド|bellwood|フォーライフ|for\s*life|エキスプレス|express\s*records|東芝emi\s*[/／]\s*express|アルファ|alfa\s*records|ナイアガラ|niagara|moon\s*records|ムーン・レコード|air\s*records|キティ|kitty\s*records|パナム|panam|バーボン|bourbon\s*records|ミディ|\bmidi\b|showboat|ショーボート|トライアド|triad|スピードスター|speedstar|キューン|ki\/oon|トイズファクトリー|toy's\s*factory|cutting\s*edge|b-gram|giza\s*studio|ギザスタジオ|ワーナー.*atlantic|meldac|メルダック/i;

/** Dedicated Idol Labels / Agencies (Positive Signal for 'アイドル') */
const IDOL_DEDICATED_LABEL_REGEX =
  /johnny's|j\s*storm|ジャニーズ|storm\s*labels|starto|ment\s*recording|aks\b|you,\s*be\s*cool|n46div|乃木坂46合同会社|seed\s*&\s*flower|zetima|ゼティマ|up-front|アップフロント|hello!\s*project|ハロー!プロジェクト|t-palette|stardust|スターダスト|nav\s*records|キャニオン.*アイドル|b\.o\.l|わーすた|アソビシステム.*idol|jeki|キングレコード.*akb/i;

// ============================================================================
// 3. ARTIST & METADATA CONTEXT DICTIONARIES (誤判定防止用の代表アーティスト・文脈辞書)
// ============================================================================

/**
 * Well-known Japanese Singer-Songwriters, New Music, City Pop, Folk, Rock, R&B, and Vocalists
 * who are frequently misclassified as "アイドル" (or pre-1988 artists misclassified as "J-Pop")
 * when only track titles or female/solo names are inspected.
 */
const NON_IDOL_ARTIST_PATTERNS: {
  pattern: RegExp;
  primaryGenre: string;
  additionalTags?: string[];
  reason: string;
}[] = [
  // Folk / New Music / Singer-Songwriters (1970s-1980s+)
  {
    pattern: /松任谷由実|荒井由実|yumi\s*matsutoya|yumi\s*arai/i,
    primaryGenre: 'ニューミュージック',
    additionalTags: ['シンガーソングライター', 'シティポップ'],
    reason: '松任谷由実（荒井由実）はニューミュージック／シンガーソングライターの代表格であり、アイドルではないため除外',
  },
  {
    pattern: /中島みゆき|miyuki\s*nakajima/i,
    primaryGenre: 'ニューミュージック',
    additionalTags: ['シンガーソングライター', 'フォーク'],
    reason: '中島みゆきはシンガーソングライター／ニューミュージックであり、アイドルではないため除外',
  },
  {
    pattern: /竹内まりや|mariya\s*takeuchi|山下達郎|tatsuro\s*yamashita|大貫妙子|taeko\s*onuki|吉田美奈子|大滝詠一|大瀧詠一|eiichi\s*ohtaki|細野晴臣|角松敏生|杉山清貴|オメガトライブ|寺尾聰|稲垣潤一|杏里\b|anri\b|菊池桃子.*ラ・ムー|大橋純子|八神純子|尾崎亜美|EPO\b|佐藤博|松原みき/i,
    primaryGenre: 'シティポップ',
    additionalTags: ['ニューミュージック'],
    reason: 'シティポップ／ニューミュージック系のシンガーソングライター・アーティストであり、アイドルではないため除外',
  },
  {
    pattern: /五輪真弓|丸山圭子|渡辺真知子|庄野真代|久保田早紀|谷山浩子|矢野顕子|白鳥英美子|トワ・エ・モワ|赤い鳥|ハイ・ファイ・セット|サーカス|ダ・カーポ|紙ふうせん|あみん|岡村孝子|辛島美登里|平松愛理|古内東子|広瀬香美|沢田知可子|永井真理子|渡辺美里/i,
    primaryGenre: 'ニューミュージック',
    additionalTags: ['シンガーソングライター'],
    reason: 'ニューミュージック／シンガーソングライター・ボーカルグループであり、アイドルではないため除外',
  },
  {
    pattern: /吉田拓郎|井上陽水|泉谷しげる|小椋佳|かぐや姫|南こうせつ|イルカ|風\b|伊勢正三|ガロ\b|GARO\b|アリス\b|谷村新司|さだまさし|グレープ|松山千春|長渕剛|チューリップ|財津和夫|オフコース|小田和正|甲斐バンド|海援隊|ふきのとう|NSP\b|ばんばひろふみ|山崎ハコ|森田童子|中島みゆき|高石ともや|岡林信康|フォーク・クルセダーズ/i,
    primaryGenre: 'フォーク',
    additionalTags: ['ニューミュージック', 'シンガーソングライター'],
    reason: 'フォーク／ニューミュージックのアーティスト・グループであり、アイドルではないため除外',
  },
  {
    pattern: /浜田省吾|佐野元春|尾崎豊|氷室京介|布袋寅泰|boøwy|boowy|吉川晃司|大沢誉志幸|安全地帯|玉置浩二|ハウンド・ドッグ|hound\s*dog|レベッカ|rebecca|nokko|プリンセス・プリンセス|プリンセス\s*プリンセス|princess\s*princess|show-ya|x\s*japan|luna\s*sea|buck-tick|the\s*yellow\s*monkey|スピッツ|spitz|mr\.?\s*children|b'z\b|glay\b|l'arc~en~ciel|ラルク|サザンオールスターズ|桑田佳祐|原由子|チューブ|tube\b|ユニコーン|unicorn|エレファントカシマシ|椎名林檎|東京事変|チャットモンチー|judy\s*and\s*mary|yuki\b|superfly|あいみょん|yui\b|緑黄色社会|official髭男dism|king\s*gnu|mrs\.?\s*green\s*apple|back\s*number|radwimps|bump\s*of\s*chicken|one\s*ok\s*rock|ポルノグラフィティ/i,
    primaryGenre: 'ロック',
    additionalTags: ['J-Pop'],
    reason: 'ロックバンド／ロック・ポップス系アーティストであり、アイドルではないため除外',
  },
  {
    pattern: /宇多田ヒカル|hikaru\s*utada|misia\b|double\b|ai\b|結晶|久保田利伸|鈴木雅之|ゴスペラーズ|chemistry|平井堅|juju\b|青山テルマ|加藤ミリヤ|crystal\s*kay|m-flo|露崎春女/i,
    primaryGenre: 'R&B',
    additionalTags: ['J-Pop'],
    reason: 'R&B／ソウル・シンガーソングライターであり、アイドルではないため除外',
  },
  {
    pattern: /zard\b|坂井泉水|大黒摩季|倉木麻衣|愛内里菜|garnet\s*crow|小松未歩|b'z|wands|t-bolan|deen\b|field\s*of\s*view|相川七瀬|every\s*little\s*thing|持田香織|globe\b|trf\b|華原朋美|hitomi\b|浜崎あゆみ|安室奈美恵|倖田來未|大塚愛|aiko\b|絢香|西野カナ|いきものがかり|miwa\b|家入レオ|一青窈|アンジェラ・アキ|中島美嘉|鬼束ちひろ|元ちとせ|夏川りみ|dreams\s*come\s*true|ドリームズ・カム・トゥルー|吉田美和|chage\s*and\s*aska|chage\s*&\s*aska|チャゲ&飛鳥|飛鳥涼|徳永英明|槇原敬之|小田和正|スキマスイッチ|コブクロ|ゆず|秦基博|星野源|米津玄師|藤井風|vaundy|yoasobi|ado\b|aimer\b|lisa\b/i,
    primaryGenre: 'J-Pop',
    reason: 'J-Popアーティスト／バンド／シンガーソングライターであり、アイドルではないため除外',
  },
  {
    pattern: /イエロー・マジック・オーケストラ|yellow\s*magic\s*orchestra|\bymo\b|坂本龍一|高橋幸宏|細野晴臣|tm\s*network|小室哲哉|access\b|電気グルーヴ|capsule|中田ヤスタカ|p-model|平沢進|プラスチックス|ヒカシュー/i,
    primaryGenre: 'テクノポップ',
    reason: 'テクノポップ／エレクトロニック系アーティストであり、アイドルではないため除外',
  },
  {
    pattern: /美空ひばり|石原裕次郎|北島三郎|五木ひろし|森進一|八代亜紀|石川さゆり|都はるみ|細川たかし|吉幾三|鳥羽一郎|天童よしみ|坂本冬美|藤あや子|伍代夏子|長山洋子|水森かおり|氷川きよし|山内惠介|三山ひろし|テレサ・テン|ちあきなおみ|青江三奈|藤圭子|桂銀淑/i,
    primaryGenre: '演歌',
    additionalTags: ['昭和歌謡'],
    reason: '演歌・歌謡曲の歌手であり、アイドルではないため除外',
  },
  {
    pattern: /高橋真梨子|ペドロ&カプリシャス|大橋純子|布施明|尾崎紀世彦|沢田研二.*Julie|梓みちよ|伊東ゆかり|弘田三枝子|ピンキーとキラーズ|ブルー・コメッツ|ザ・タイガース|ザ・テンプターズ|ザ・スパイダース|ちあきなおみ|黛ジュン|いしだあゆみ|欧陽菲菲|朱里エイコ|しばたはつみ/i,
    primaryGenre: '昭和歌謡',
    reason: '昭和歌謡・実力派ボーカリスト／GSであり、アイドルではないため除外',
  },
];

/**
 * Known Japanese Idol solo artists and idol groups (1970s–2020s)
 * Used as a positive corroboration signal when evaluating 'アイドル'.
 */
const VERIFIED_IDOL_ARTIST_REGEX =
  /山口百恵|松田聖子|中森明菜|小泉今日子|河合奈保子|柏原芳恵|柏原よしえ|堀ちえみ|早見優|松本伊代|石川秀美|菊池桃子|斉藤由貴|南野陽子|浅香唯|中山美穂|工藤静香|森高千里|wink\b|おニャン子クラブ|新田恵利|国生さゆり|渡辺美奈代|渡辺満里奈|高井麻巳子|うしろゆびさされ組|うしろ髪ひかれ隊|キャンディーズ|ピンク・レディー|ピンクレディー|南沙織|天地真理|麻丘めぐみ|アグネス・チャン|桜田淳子|榊原郁恵|石野真子|岩崎良美|岩崎宏美|薬師丸ひろ子|原田知世|岡田有希子|本田美奈子|荻野目洋子|森口博子|西村知美|酒井法子|芳本美代子|佐野量子|西田ひかる|田村英里子|coco\b|ribbon\b|三浦理恵子|瀬能あづさ|宮沢りえ|観月ありさ|牧瀬里穂|内田有紀|広末涼子|辺見えみり|雛形あきこ|高橋由美子|宍戸留美|桜井智|モーニング娘|松浦亜弥|後藤真希|安倍なつみ|藤本美貴|berryz工房|℃-ute|c-ute|アンジュルム|スマイレージ|juice=juice|つばきファクトリー|beyooooonds|ハロー!プロジェクト|太陽とシスコムーン|ミニモニ|プッチモニ|タンポポ|akb48|ske48|nmb48|hkt48|ngt48|stu48|sdn48|乃木坂46|欅坂46|櫻坂46|日向坂46|けやき坂46|吉本坂46|ももいろクローバー|ももクロ|私立恵比寿中学|エビ中|しゃちほこ|TEAM\s*SHACHI|ときめき♡宣伝部|超ときめき|でんぱ組|アイドリング|パスポ|passpo|フェアリーズ|東京女子流|9nine|ベイビーレイズ|biS\b|biSH\b|豆柴の大群|fruits\s*zipper|candy\s*tune|sweet\s*steady|cutie\s*street|イコールラブ|=love|≠me|≒joy|ラストアイドル|虹のコンキスタドール|まねきケチャ|わーすた|さくら学院|babymetal|perfume|niziu|me:i\b|is:sue|郷ひろみ|西城秀樹|野口五郎|フォーリーブス|たのきん|田原俊彦|近藤真彦|野村義男|シブがき隊|少年隊|光genji|男闘呼組|忍者\b|チェッカーズ|smap|tokio|v6\b|kinki\s*kids|嵐\b|arashi|タッキー&翼|news\b|関ジャニ|super\s*eight|kat-tun|hey!\s*say!\s*jump|kis-my-ft2|キスマイ|sexy\s*zone|timelesz|a\.b\.c-z|ジャニーズwest|west\.|king\s*&\s*prince|キンプリ|sixtones|snow\s*man|なにわ男子|travis\s*japan|aぇ!\s*group|jo1\b|ini\b|da\s*pump|w-inds|lead\b|超特急|m!lk\b|ラブライブ|μ's|aqours|虹ヶ咲|liella|蓮ノ空|アイドルマスター|idolmaster|アイマス|シンデレラガールズ|ミリオンライブ|シャイニーカラーズ|アイカツ|プリパラ|うたの☆プリンス|アイドリッシュセブン|すとぷり/i;

/**
 * Patterns in Japanese Romaji artists so we don't mistakenly classify Japanese Romaji artists as Western (洋楽)
 */
const KNOWN_JAPANESE_ROMAJI_ARTIST_REGEX =
  /\b(b'z|zard|glay|l'arc~en~ciel|luna\s*sea|x\s*japan|boøwy|boowy|buck-tick|tm\s*network|trf|globe|every\s*little\s*thing|judy\s*and\s*mary|mr\.?\s*children|dreams\s*come\s*true|chage\s*and\s*aska|chage\s*&\s*aska|spitz|southern\s*all\s*stars|tube|rebecca|princess\s*princess|show-ya|hound\s*dog|unicorn|the\s*yellow\s*monkey|bump\s*of\s*chicken|radwimps|one\s*ok\s*rock|mrs\.?\s*green\s*apple|back\s*number|king\s*gnu|official\s*higedan\s*dism|yoasobi|aimer|lisa|ado|vaundy|milet|misia|ai|double|juju|aiko|yui|superfly|miwa|chay|benny\s*k|chemistry|m-flo|dragon\s*ash|rip\s*slyme|kick\s*the\s*can\s*crew|kreva|zeebra|rhymester|def\s*tech|orangestar|perfume|babymetal|akb48|ske48|nmb48|hkt48|smap|tokio|v6|kinki\s*kids|arashi|news|kat-tun|hey!\s*say!\s*jump|kis-my-ft2|sexy\s*zone|timelesz|a\.b\.c-z|west\.|king\s*&\s*prince|sixtones|snow\s*man|travis\s*japan|jo1|ini|be:first|niziu|xg|w-inds\.?|da\s*pump|exile|jsb|generations|rampage|fantastics|ballistik\s*boyz|aaa|speed|max|folder\s*5|wink|coco|ribbon|biSH|bis|t-square|the\s*square|casiopea|dimension|ymo|yellow\s*magic\s*orchestra|p-model|plastics|hikashu|cornelius|pizzicato\s*five|original\s*love|flipper's\s*guitar|sunny\s*day\s*service|fishmans|number\s*girl|asian\s*kung-fu\s*generation|ellegarden|hi-standard|wanima|10-feet|man\s*with\s*a\s*mission|alexandros|kana-boon|shishamo|scandal|silent\s*siren|band-maid|lovebites|dir\s*en\s*grey|the\s*gazette|pierrot|siam\s*shade|janne\s*da\s*arc|acid\s*black\s*cherry|gackt|hyde|miyavi|t\.m\.revolution|access|iceman|fripSide|granrodeo|angela|kalafina|fictionjunction|ali\s*project|jam\s*project|claris|trySail|sphere|aqours|liella|μ's|garnet\s*crow|deen|wands|t-bolan|field\s*of\s*view|baad|rev|pamela|be-b)\b/i;

// ============================================================================
// 4. HELPER FUNCTIONS FOR MULTI-METADATA INSPECTION
// ============================================================================

function parseReleaseYear(dateStr?: string): number | null {
  if (!dateStr) return null;
  const match = String(dateStr).trim().match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  return isNaN(y) ? null : y;
}

function parseDurationToSeconds(duration?: string): number | null {
  if (!duration) return null;
  const trimmed = String(duration).trim();
  const mmss = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (mmss) {
    if (mmss[3] !== undefined) {
      return parseInt(mmss[1], 10) * 3600 + parseInt(mmss[2], 10) * 60 + parseInt(mmss[3], 10);
    }
    return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  }
  const secMatch = trimmed.match(/^(\d+)\s*s$/i);
  if (secMatch) {
    return parseInt(secMatch[1], 10);
  }
  return null;
}

function containsJapaneseScript(text?: string): boolean {
  if (!text) return false;
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

function isNonJapaneseBarcode(barcode?: string): boolean {
  if (!barcode) return false;
  const digits = String(barcode).replace(/\D/g, '');
  if (digits.length !== 12 && digits.length !== 13) return false;
  // Japan JAN prefixes are 45 and 49
  if (digits.startsWith('45') || digits.startsWith('49')) return false;
  // Korea is 880, Taiwan 471, Hong Kong 489
  if (digits.startsWith('880') || digits.startsWith('471') || digits.startsWith('489')) return false;
  // US/Canada (00-13), France (30-37), Germany (40-44), UK (50), International Europe (5-7)
  return true;
}

function analyzeTrackStructure(tracks?: TrackInfo[]) {
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return {
      trackCount: 0,
      avgDurationSec: 0,
      maxDurationSec: 0,
      hasKaraokeOrInstrumentalTracks: false,
      isLongFormInstrumentalOrClassicalStructure: false,
    };
  }

  const durations: number[] = [];
  let hasKaraoke = false;
  let classicalMovementCount = 0;

  for (const t of tracks) {
    const d = parseDurationToSeconds(t.duration);
    if (d !== null && d > 0) {
      durations.push(d);
    }
    const title = t.title || '';
    if (/カラオケ|karaoke|off\s*vocal|instrumental|インストゥルメンタル|less\s*vocal|backing\s*track/i.test(title)) {
      hasKaraoke = true;
    }
    if (/\b(allegro|adagio|andante|presto|scherzo|largo|moderato|第[1-9一二三四五]楽章|mov\.?\s*\d|op\.\s*\d+|bwv\s*\d+)\b/i.test(title)) {
      classicalMovementCount++;
    }
  }

  const avgDurationSec =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const maxDurationSec = durations.length > 0 ? Math.max(...durations) : 0;

  // Long-form instrumental / classical / jazz structure if average duration >= 350s (5m50s) across 3+ tracks
  // or max track >= 540s (9m) or multiple classical movements
  const isLongFormInstrumentalOrClassicalStructure =
    (durations.length >= 3 && avgDurationSec >= 350) ||
    maxDurationSec >= 540 ||
    classicalMovementCount >= 2;

  return {
    trackCount: tracks.length,
    avgDurationSec,
    maxDurationSec,
    hasKaraokeOrInstrumentalTracks: hasKaraoke,
    isLongFormInstrumentalOrClassicalStructure,
  };
}

// ============================================================================
// 5. PRE-CHECK & RULE SIGNAL EXTRACTOR (メタデータ横断ルール抽出)
// ============================================================================

/**
 * Inspects all metadata fields (catalogNumber, label, releaseDate, vinylRecordReleaseDate,
 * vinylRecordFormat, barcode, country, format, title, notes, tracks duration/structure)
 * to produce deterministic genre constraints before or after AI classification.
 */
export function runGenreRulePrecheck(input: GenreRuleFilterInput): GenreRulePrecheckResult {
  const catNo = (input.catalogNumber || '').trim().toUpperCase();
  const vinylCatNo = (input.vinylRecordCatalogNumber || '').trim().toUpperCase();
  const label = (input.label || '').trim();
  const title = (input.title || '').trim();
  const artist = (input.artist || '').trim();
  const notes = (input.notes || '').trim();
  const format = (input.format || '').trim();
  const vinylFormat = (input.vinylRecordFormat || '').trim();
  const country = (input.country || '').trim().toUpperCase();
  const barcode = (input.barcode || '').trim();
  const existingGenre = (input.genre || '').trim();
  const existingTags = input.existingTags || [];

  const vinylYear = parseReleaseYear(input.vinylRecordReleaseDate);
  const cdYear = parseReleaseYear(input.releaseDate);
  const effectiveYear = vinylYear ?? cdYear;
  const effectiveDateSource: GenreRulePrecheckResult['effectiveDateSource'] =
    vinylYear !== null ? 'LP/EP発売年月日' : cdYear !== null ? 'CD発売年月日' : '未設定';

  const isPreJPopEra = effectiveYear !== null && effectiveYear <= 1987;
  const isEarlyPreJPopEra = effectiveYear !== null && effectiveYear <= 1985;

  const trackDurationStats = analyzeTrackStructure(input.tracks);

  const enforcedTags: GenreRulePrecheckResult['enforcedTags'] = [];
  const blockedTags: GenreRulePrecheckResult['blockedTags'] = [];
  let enforcedPrimaryGenre: string | undefined;

  const addEnforcedTag = (
    tag: string,
    category: 'genre' | 'mood' | 'era' | 'style',
    evidence: string,
    sourceFields: string[]
  ) => {
    if (!enforcedTags.some((e) => e.tag === tag)) {
      enforcedTags.push({ tag, category, evidence, sourceFields });
    }
  };

  const addBlockedTag = (tag: string, reason: string, sourceFields: string[]) => {
    if (!blockedTags.some((b) => b.tag === tag)) {
      blockedTags.push({ tag, reason, sourceFields });
    }
  };

  // --- Rule A: Classical Detection (規格品番・レーベル・タイトル構造・楽章構成) ---
  const isClassicalCat = CLASSICAL_CATALOG_PREFIX_REGEX.test(catNo) || CLASSICAL_CATALOG_PREFIX_REGEX.test(vinylCatNo);
  const isClassicalLabel = CLASSICAL_LABEL_REGEX.test(label);
  const isClassicalTitleOrNotes =
    /交響曲|協奏曲|ソナタ|弦楽四重奏|管弦楽団|フィルハーモニー|交響楽団|室内楽|オペラ|レクイエム|カンタータ|symphony|concerto|sonata|philharmonic|orchestra|\bbwv\s*\d+|\bop\.\s*\d+/i.test(
      `${title} ${notes} ${artist}`
    );

  if (isClassicalCat || isClassicalLabel || isClassicalTitleOrNotes) {
    const sources: string[] = [];
    if (isClassicalCat) sources.push('規格品番');
    if (isClassicalLabel) sources.push('レーベル');
    if (isClassicalTitleOrNotes) sources.push('タイトル・備考');

    enforcedPrimaryGenre = 'クラシック';
    addEnforcedTag(
      'クラシック',
      'genre',
      `ルールベース判定: ${sources.join('・')}（${catNo || label || title}）がクラシック音楽の規格・体系と一致`,
      sources
    );
    addBlockedTag('アイドル', `${sources.join('・')}がクラシック規格のため「アイドル」を除外`, sources);
    addBlockedTag('J-Pop', `${sources.join('・')}がクラシック規格のため「J-Pop」を除外`, sources);
    addBlockedTag('昭和歌謡', `${sources.join('・')}がクラシック規格のため「昭和歌謡」を除外`, sources);
  }

  // --- Rule B: Jazz / Fusion Detection (規格品番・レーベル・編成・演奏時間) ---
  const isJazzCat = JAZZ_CATALOG_PREFIX_REGEX.test(catNo) || JAZZ_CATALOG_PREFIX_REGEX.test(vinylCatNo);
  const isJazzLabel = JAZZ_LABEL_REGEX.test(label);
  const isJazzTitleOrNotes =
    /カルテット|クインテット|セクステット|ジャズ・トリオ|ピアノ・トリオ|ビッグ・バンド|jazz\s*quartet|jazz\s*quintet|jazz\s*trio|live\s*at\s*the\s*village\s*vanguard|モダン・ジャズ/i.test(
      `${title} ${notes} ${artist}`
    );
  const isFusion = FUSION_LABEL_OR_KEYWORD_REGEX.test(`${artist} ${title} ${label} ${notes}`);

  if (!enforcedPrimaryGenre && (isJazzCat || isJazzLabel || isJazzTitleOrNotes || isFusion)) {
    const targetGenre = isFusion && !isJazzLabel ? 'フュージョン' : 'ジャズ';
    const sources: string[] = [];
    if (isJazzCat) sources.push('規格品番');
    if (isJazzLabel) sources.push('レーベル');
    if (isJazzTitleOrNotes || isFusion) sources.push('タイトル・備考・編成');

    enforcedPrimaryGenre = targetGenre;
    addEnforcedTag(
      targetGenre,
      'genre',
      `ルールベース判定: ${sources.join('・')}（${label || catNo || title}）が${targetGenre}の専門レーベル・規格と一致`,
      sources
    );
    addBlockedTag('アイドル', `${sources.join('・')}が${targetGenre}規格のため「アイドル」を除外`, sources);
    addBlockedTag('J-Pop', `${sources.join('・')}が${targetGenre}規格のため「J-Pop」を除外`, sources);
  }

  // --- Rule C: Anime / Game Music Detection (規格品番・レーベル・タイアップ備考) ---
  const isGameCat = GAME_CATALOG_PREFIX_REGEX.test(catNo);
  const isGameTitleOrNotes = /ゲーム音楽|オリジナル・サウンドトラック.*ゲーム|game\s*soundtrack|game\s*music/i.test(
    `${title} ${notes} ${label}`
  );
  const isAnimeCat = ANIME_CATALOG_PREFIX_REGEX.test(catNo);
  const isAnimeLabel = ANIME_GAME_LABEL_REGEX.test(label);
  const isAnimeTitleOrNotes =
    /tvアニメ|テレビアニメ|劇場版アニメ|アニメーション|アニメ主題歌|オープニングテーマ|エンディングテーマ|キャラクターソング|キャラソン|アニメ「|『.*』主題歌/i.test(
      `${title} ${notes}`
    );

  if (isGameCat || isGameTitleOrNotes) {
    const sources: string[] = [];
    if (isGameCat) sources.push('規格品番');
    if (isGameTitleOrNotes) sources.push('タイトル・備考');
    if (!enforcedPrimaryGenre) enforcedPrimaryGenre = 'ゲーム音楽';
    addEnforcedTag(
      'ゲーム音楽',
      'genre',
      `ルールベース判定: ${sources.join('・')}（${catNo || label || title}）からゲーム音楽作品と特定`,
      sources
    );
    addBlockedTag('アイドル', 'ゲーム音楽規格のため根拠のない「アイドル」を除外', sources);
  } else if (isAnimeCat || isAnimeLabel || isAnimeTitleOrNotes) {
    const sources: string[] = [];
    if (isAnimeCat) sources.push('規格品番');
    if (isAnimeLabel) sources.push('レーベル');
    if (isAnimeTitleOrNotes) sources.push('タイトル・備考');
    if (!enforcedPrimaryGenre) enforcedPrimaryGenre = 'アニソン';
    addEnforcedTag(
      'アニソン',
      'genre',
      `ルールベース判定: ${sources.join('・')}（${catNo || label}）がアニメ音楽レーベル・規格またはタイアップ情報と一致`,
      sources
    );
  }

  // --- Rule D: Western Music (洋楽) Origin Detection (JANバーコード国番号・リリース国・洋楽専用型番) ---
  const isWesternCat = WESTERN_CATALOG_PREFIX_REGEX.test(catNo);
  const hasNonJpBarcode = isNonJapaneseBarcode(barcode);
  const hasNonJpCountry = Boolean(country && !['JP', 'JPN', 'JAPAN', '日本'].includes(country));
  const artistHasJapanese = containsJapaneseScript(artist);
  const titleHasJapanese = containsJapaneseScript(title);
  const isKnownJapaneseRomaji = KNOWN_JAPANESE_ROMAJI_ARTIST_REGEX.test(artist);

  const isWesternOrigin =
    !isKnownJapaneseRomaji &&
    !artistHasJapanese &&
    (isWesternCat ||
      hasNonJpBarcode ||
      (hasNonJpCountry && !titleHasJapanese));

  if (isWesternOrigin) {
    const sources: string[] = [];
    if (isWesternCat) sources.push(`洋楽規格品番(${catNo})`);
    if (hasNonJpBarcode) sources.push(`海外EAN/UPCバーコード(${barcode})`);
    if (hasNonJpCountry) sources.push(`リリース国(${country})`);
    sources.push('アーティスト表記');

    addEnforcedTag(
      '洋楽',
      'genre',
      `ルールベース判定: ${sources.join('・')}から海外アーティスト（洋楽）と判定`,
      ['規格品番・レーベル', 'JANバーコード・リリース国']
    );
    addBlockedTag('邦楽', `${sources.join('・')}により洋楽作品と判定されたため「邦楽」を除外`, ['JANバーコード・リリース国', '規格品番']);
    addBlockedTag('J-Pop', `${sources.join('・')}により洋楽作品と判定されたため「J-Pop」を除外`, ['JANバーコード・リリース国', '規格品番']);
    addBlockedTag('アイドル', `${sources.join('・')}により洋楽作品と判定されたため「アイドル」を除外`, ['JANバーコード・リリース国', '規格品番']);
    addBlockedTag('昭和歌謡', `${sources.join('・')}により洋楽作品と判定されたため「昭和歌謡」を除外`, ['JANバーコード・リリース国']);
    addBlockedTag('ニューミュージック', `${sources.join('・')}により洋楽作品と判定されたため「ニューミュージック」を除外`, ['JANバーコード・リリース国']);
  }

  // --- Rule E: Enka Detection (演歌・伝統歌謡) ---
  const isEnkaCat = ENKA_CATALOG_PREFIX_REGEX.test(catNo);
  const isEnkaNotesOrTitle = /演歌|股旅|音頭|民謡|浪曲|全曲集.*演歌/i.test(`${title} ${notes} ${existingGenre}`);
  if (isEnkaNotesOrTitle || (isEnkaCat && /演歌|全曲集/i.test(`${title} ${notes}`))) {
    if (!enforcedPrimaryGenre) enforcedPrimaryGenre = '演歌';
    addEnforcedTag(
      '演歌',
      'genre',
      `ルールベース判定: タイトル・備考・規格品番（${catNo || title}）から演歌作品と判定`,
      ['規格品番', 'タイトル・備考']
    );
    addBlockedTag('アイドル', '演歌作品のため「アイドル」を除外', ['規格品番', 'タイトル・備考']);
    addBlockedTag('J-Pop', '演歌作品のため「J-Pop」を除外', ['規格品番', 'タイトル・備考']);
  }

  // --- Rule F: Album Title, Format & Notes Structural Tags (ベスト盤・ライブ盤・サントラ・CMソング) ---
  if (
    /\bbest\b|ベスト|golden☆best|ゴールデン☆ベスト|single\s*collection|シングル・コレクション|シングルコレクション|\bsingles\b|全曲集|greatest\s*hits|グレイテスト・ヒッツ|complete\s*best|コンプリート・ベスト|スーパー・ベスト|super\s*best|anthology|アンソロジー/i.test(
      `${title} ${format} ${notes}`
    )
  ) {
    addEnforcedTag(
      'ベスト盤',
      'style',
      `ルールベース判定: アルバムタイトル・フォーマット・備考（「${title}」）にベスト盤／シングル集を示す表記を確認`,
      ['タイトル', 'フォーマット・備考']
    );
  }

  if (
    (/\blive\b|ライヴ|ライブ|concert|コンサート|リサイタル|recital|in\s*budokan|日本武道館|武道館ライブ|実況録音/i.test(
      `${title} ${format} ${notes}`
    ) &&
      !/ラブライブ|love\s*live|ミリオンライブ|live\s*for\s*you/i.test(`${title} ${artist}`))
  ) {
    addEnforcedTag(
      'ライブ盤',
      'style',
      `ルールベース判定: アルバムタイトル・フォーマット・備考（「${title}」）にライブ／コンサート収録を示す表記を確認`,
      ['タイトル', 'フォーマット・備考']
    );
  }

  if (
    /original\s*soundtrack|soundtrack|\bost\b|サウンドトラック|サントラ|劇伴|音楽集|BGM集|交響組曲/i.test(
      `${title} ${format} ${notes}`
    )
  ) {
    if (!enforcedPrimaryGenre) enforcedPrimaryGenre = 'サウンドトラック';
    addEnforcedTag(
      'サウンドトラック',
      'genre',
      `ルールベース判定: アルバムタイトル・備考（「${title}」）にサウンドトラック／劇伴を示す表記を確認`,
      ['タイトル', '備考']
    );
    addBlockedTag('アイドル', 'サウンドトラック／劇伴作品のため「アイドル」を除外', ['タイトル', '備考']);
    addBlockedTag('J-Pop', 'サウンドトラック／劇伴作品のため「J-Pop」を除外', ['タイトル', '備考']);
  }

  if (/cmソング|cm曲|cmタイアップ|cfソング|コマーシャルソング|コマーシャル・ソング|cmイメージソング|cm使用曲/i.test(`${title} ${notes}`)) {
    addEnforcedTag(
      'CMソング',
      'style',
      `ルールベース判定: タイトルまたは備考にCMタイアップ・コマーシャル楽曲情報の記載を確認`,
      ['備考', 'タイトル']
    );
  }

  // --- Rule G: Known Non-Idol Artist & Musician Label Dictionary Check ---
  for (const entry of NON_IDOL_ARTIST_PATTERNS) {
    if (entry.pattern.test(artist)) {
      addBlockedTag('アイドル', entry.reason, ['アーティスト名', 'ディスコグラフィ規則']);

      // If pre-1988 and the artist is Folk / New Music / City Pop / Showa Kayo / Enka / Techno Pop,
      // enforce that historical primary genre instead of J-Pop
      if (isPreJPopEra && entry.primaryGenre !== 'J-Pop') {
        if (!enforcedPrimaryGenre) {
          enforcedPrimaryGenre = entry.primaryGenre;
        }
        addEnforcedTag(
          entry.primaryGenre,
          'genre',
          `ルールベース判定: アーティスト「${artist}」およびリリース年代（${effectiveYear}年・${effectiveDateSource}）の時代整合性から「${entry.primaryGenre}」と特定`,
          ['アーティスト名', effectiveDateSource, 'レーベル']
        );
        if (isEarlyPreJPopEra && ['フォーク', 'ニューミュージック', '昭和歌謡', '演歌', 'シティポップ'].includes(entry.primaryGenre)) {
          addBlockedTag(
            'J-Pop',
            `${effectiveYear}年（${effectiveDateSource}）は「J-Pop」呼称定着（1988年）以前であり、「${entry.primaryGenre}」が正確な時代ジャンルのため「J-Pop」を除外`,
            [effectiveDateSource, 'アーティスト名']
          );
        }
      } else if (!enforcedPrimaryGenre) {
        enforcedPrimaryGenre = entry.primaryGenre;
      }
      break;
    }
  }

  // --- Rule H: Non-Idol Musician Label & Track Duration Contradictions against 'アイドル' ---
  const isNonIdolMusicianLabel = NON_IDOL_MUSICIAN_LABEL_REGEX.test(label);
  const isVerifiedIdolArtist = VERIFIED_IDOL_ARTIST_REGEX.test(`${artist} ${title}`);
  const isDedicatedIdolLabel = IDOL_DEDICATED_LABEL_REGEX.test(label);
  const hasExplicitIdolInNotesOrTags =
    /アイドル|idol|ジャニーズ|ハロー!プロジェクト|ハロプロ|坂道シリーズ|おニャン子|スター誕生|握手会|選抜|卒業コンサート/i.test(
      `${notes} ${existingGenre} ${existingTags.join(' ')}`
    );

  if (isNonIdolMusicianLabel && !isVerifiedIdolArtist && !hasExplicitIdolInNotesOrTags) {
    addBlockedTag(
      'アイドル',
      `レーベル「${label}」はフォーク／ニューミュージック／ロック／シティポップ系の専門レーベルであり、アイドル関連メタデータが存在しないため「アイドル」を除外`,
      ['レーベル']
    );
    if (isPreJPopEra && !enforcedPrimaryGenre) {
      const preGenre = effectiveYear && effectiveYear <= 1974 ? 'フォーク' : 'ニューミュージック';
      enforcedPrimaryGenre = preGenre;
      addEnforcedTag(
        preGenre,
        'genre',
        `ルールベース判定: レーベル「${label}」および発売年（${effectiveYear}年・${effectiveDateSource}）から「${preGenre}」と判定`,
        ['レーベル', effectiveDateSource]
      );
    }
  }

  if (
    trackDurationStats.isLongFormInstrumentalOrClassicalStructure &&
    !isVerifiedIdolArtist &&
    !isDedicatedIdolLabel &&
    !hasExplicitIdolInNotesOrTags
  ) {
    addBlockedTag(
      'アイドル',
      `収録曲の平均演奏時間（約${Math.round(trackDurationStats.avgDurationSec / 60)}分）または長尺トラック構成（最大${Math.round(
        trackDurationStats.maxDurationSec / 60
      )}分）がアイドルポップス規格外のため「アイドル」を除外`,
      ['収録曲数・演奏時間']
    );
  }

  if (
    /シンガーソングライター|シンガー・ソングライター|全曲作詞・作曲|自作詞・自作曲|ロック・バンド|ロックバンド|フォーク・グループ|インストゥルメンタル/i.test(
      notes
    ) &&
    !isVerifiedIdolArtist &&
    !hasExplicitIdolInNotesOrTags
  ) {
    addBlockedTag(
      'アイドル',
      `備考メタデータに「シンガーソングライター／バンド／インストゥルメンタル」の記述がありアイドルではないため除外`,
      ['備考']
    );
  }

  // --- Rule I: Pre-1986 Era Chronological Filter for 'J-Pop' ---
  if (isEarlyPreJPopEra && !isWesternOrigin && !enforcedPrimaryGenre) {
    // Check if existing tags or notes suggest Folk / New Music / Showa Kayo / City Pop
    if (/フォーク/i.test(`${notes} ${existingGenre} ${existingTags.join(' ')}`)) {
      enforcedPrimaryGenre = 'フォーク';
    } else if (/シティポップ|city\s*pop/i.test(`${notes} ${existingGenre} ${existingTags.join(' ')}`)) {
      enforcedPrimaryGenre = 'シティポップ';
    } else if (/ニューミュージック|new\s*music/i.test(`${notes} ${existingGenre} ${existingTags.join(' ')}`)) {
      enforcedPrimaryGenre = 'ニューミュージック';
    } else if (/昭和歌謡|歌謡曲/i.test(`${notes} ${existingGenre} ${existingTags.join(' ')}`)) {
      enforcedPrimaryGenre = '昭和歌謡';
    } else if (vinylFormat && /^(EP|7"|7inch)$/i.test(vinylFormat) && effectiveYear && effectiveYear <= 1982) {
      // 1960s-1982 7-inch EP domestic single/album is Showa Kayo or Idol/New Music, not "J-Pop"
      addBlockedTag(
        'J-Pop',
        `同タイトル盤種「${vinylFormat}」および発売年（${effectiveYear}年・${effectiveDateSource}）は1988年以前の昭和期リリースのため、安易な「J-Pop」判定を抑制`,
        [effectiveDateSource, 'LP/EP盤種']
      );
    }
  }

  // --- Rule J: Collect Positive Corroboration Signals for 'アイドル' ---
  const idolSignalReasons: string[] = [];
  if (isVerifiedIdolArtist) {
    idolSignalReasons.push(`アーティスト・作品名（${artist}）が日本のアイドル／アイドルグループと一致`);
  }
  if (isDedicatedIdolLabel) {
    idolSignalReasons.push(`レーベル（${label}）がアイドル専門レーベル・事務所レーベルと一致`);
  }
  if (hasExplicitIdolInNotesOrTags) {
    idolSignalReasons.push('既存タグ・ジャンルまたは備考に「アイドル」関連の明示的な記載あり');
  }
  if (
    effectiveYear &&
    effectiveYear >= 1970 &&
    effectiveYear <= 1989 &&
    /^(EP|7"|LP)$/i.test(vinylFormat) &&
    /キャニオン|canyon|cbs.*sony|ワーナー・パイオニア|warner.*pioneer|バップ|\bvap\b|ビクター|日本コロムビア|トーラス|フォーライフ|ポリドール|徳間ジャパン/i.test(
      label
    ) &&
    !isNonIdolMusicianLabel &&
    !NON_IDOL_ARTIST_PATTERNS.some((p) => p.pattern.test(artist))
  ) {
    // Potential 70s/80s Showa Idol release if corroborated by AI reasoning
    idolSignalReasons.push(
      `${effectiveYear}年リリース（${vinylFormat}盤）・歌謡/アイドル系メジャーレーベル（${label}）の時代・盤種条件に該当`
    );
  }

  const hasPositiveIdolSignal = idolSignalReasons.length > 0;

  return {
    effectiveYear,
    effectiveDateSource,
    isPreJPopEra,
    isEarlyPreJPopEra,
    isWesternOrigin,
    enforcedPrimaryGenre,
    enforcedTags,
    blockedTags,
    hasPositiveIdolSignal,
    idolSignalReasons,
    trackDurationStats,
  };
}

// ============================================================================
// 6. POST-FILTER & GENRE RESOLVER (AI出力・フォールバック結果の多層検証フィルター)
// ============================================================================

const DECADE_TAG_REGEX = /^(19\d0|20\d0|[56789]0)年代$/;

/**
 * Applies multi-metadata rule-based filtering to candidate tags, primary genre, subGenre,
 * and tagEvidence to eliminate false-positive "アイドル" and "J-Pop" classifications.
 */
export function applyGenreRuleFilter(
  input: GenreRuleFilterInput,
  candidateTags: string[],
  candidateGenre?: string,
  candidateSubGenre?: string,
  candidateReasoning?: string,
  candidateEvidence?: AITagEvidenceItem[]
): GenreRuleFilterOutput {
  const precheck = runGenreRulePrecheck(input);
  const ruleAdjustments: string[] = [];

  let workingTags = Array.from(new Set(candidateTags.filter(Boolean)));
  let workingGenre = (candidateGenre || '').trim();
  let workingSubGenre = candidateSubGenre ? candidateSubGenre.trim() : undefined;
  let workingEvidence: AITagEvidenceItem[] = Array.isArray(candidateEvidence) ? [...candidateEvidence] : [];

  const combinedAiText = `${candidateReasoning || ''} ${workingEvidence.map((e) => e.evidence).join(' ')}`;

  // 1. Check if AI reasoning/evidence itself contradicts "アイドル"
  // (e.g. AI says "シンガーソングライターとして..." or "ロックバンド..." or "ニューミュージック..." yet outputs "アイドル")
  const aiMentionsNonIdolRole =
    /シンガーソングライター|シンガー・ソングライター|自作詞|自作曲|全曲作詞|全曲作曲|ロックバンド|ロック・バンド|フォーク・グループ|フォークシンガー|ニューミュージックの旗手|シティポップの代表|ジャズ・ボーカル|演歌歌手|実力派ボーカリスト/i.test(
      combinedAiText
    ) &&
    !/アイドルとしてデビュー|アイドル歌手|アイドルグループ|アイドル歌謡|トップアイドル|女性アイドル|男性アイドル/i.test(
      combinedAiText
    );

  const aiExplicitlyConfirmsIdol =
    /アイドルとしてデビュー|アイドル歌手|アイドルグループ|アイドル歌謡|トップアイドル|女性アイドル|男性アイドル|80年代アイドル|70年代アイドル|90年代アイドル|ジャニーズ|ハロプロ|坂道|おニャン子/i.test(
      combinedAiText
    );

  // 2. Apply explicit Blocked Tags from Precheck
  const blockedTagNames = new Set(precheck.blockedTags.map((b) => b.tag));

  for (const blocked of precheck.blockedTags) {
    if (workingTags.includes(blocked.tag) || workingGenre === blocked.tag || workingSubGenre === blocked.tag) {
      workingTags = workingTags.filter((t) => t !== blocked.tag);
      workingEvidence = workingEvidence.filter((ev) => ev.tag !== blocked.tag);
      ruleAdjustments.push(`【誤判定除外: #${blocked.tag}】${blocked.reason}`);
    }
  }

  // 3. Multi-Metadata Corroboration Filter for "アイドル"
  const hasIdolCandidate =
    workingTags.includes('アイドル') || workingGenre === 'アイドル' || workingSubGenre === 'アイドル';

  if (hasIdolCandidate) {
    const isAnimeWithoutIdolContext =
      (workingTags.includes('アニソン') || workingGenre === 'アニソン' || precheck.enforcedPrimaryGenre === 'アニソン') &&
      !precheck.hasPositiveIdolSignal &&
      !/アイドル|ラブライブ|アイマス|アイドルマスター|アイカツ|プリパラ|うたの☆プリンス|アイドリッシュセブン/i.test(
        `${input.title || ''} ${input.artist || ''} ${input.notes || ''} ${combinedAiText}`
      );

    const hasSSWOrRockTagContradiction =
      (workingTags.includes('シンガーソングライター') ||
        workingSubGenre === 'シンガーソングライター' ||
        workingTags.includes('フォーク') ||
        workingTags.includes('ハードロック') ||
        workingTags.includes('パンク') ||
        workingTags.includes('ジャズ') ||
        workingTags.includes('クラシック') ||
        workingTags.includes('演歌')) &&
      !precheck.hasPositiveIdolSignal;

    const lacksAnyIdolCorroboration =
      !precheck.hasPositiveIdolSignal && (!aiExplicitlyConfirmsIdol || aiMentionsNonIdolRole);

    if (aiMentionsNonIdolRole || isAnimeWithoutIdolContext || hasSSWOrRockTagContradiction || lacksAnyIdolCorroboration) {
      workingTags = workingTags.filter((t) => t !== 'アイドル');
      workingEvidence = workingEvidence.filter((ev) => ev.tag !== 'アイドル');
      if (workingGenre === 'アイドル') workingGenre = '';
      if (workingSubGenre === 'アイドル') workingSubGenre = undefined;
      blockedTagNames.add('アイドル');

      const reasonDetail = aiMentionsNonIdolRole
        ? 'アーティストの活動形態（シンガーソングライター／バンド／ニューミュージック等）と矛盾するため'
        : isAnimeWithoutIdolContext
        ? 'アニソン／声優タイアップ作品でありアイドル作品の裏付けメタデータがないため'
        : hasSSWOrRockTagContradiction
        ? '共存できない専門ジャンル（シンガーソングライター／フォーク／ロック等）が検出されたため'
        : 'レーベル・規格品番・備考・年代盤種にアイドルを示す裏付けメタデータが存在しないため';

      ruleAdjustments.push(`【誤判定除外: #アイドル】${reasonDetail}、「アイドル」タグを除外しました`);
    }
  }

  // 4. Multi-Metadata Filter for "J-Pop" (過剰付与・時代錯誤・専門ジャンル競合の抑制)
  const nonJPopSpecialistGenres = [
    'クラシック',
    'ジャズ',
    'フュージョン',
    '演歌',
    'サウンドトラック',
    'ゲーム音楽',
    'お笑い・バラエティ',
    '洋楽',
  ];

  const hasNonJPopSpecialist = workingTags.some((t) => nonJPopSpecialistGenres.includes(t)) ||
    nonJPopSpecialistGenres.includes(workingGenre) ||
    (precheck.enforcedPrimaryGenre && nonJPopSpecialistGenres.includes(precheck.enforcedPrimaryGenre));

  if (hasNonJPopSpecialist && (workingTags.includes('J-Pop') || workingGenre === 'J-Pop')) {
    workingTags = workingTags.filter((t) => t !== 'J-Pop');
    workingEvidence = workingEvidence.filter((ev) => ev.tag !== 'J-Pop');
    if (workingGenre === 'J-Pop') workingGenre = '';
    blockedTagNames.add('J-Pop');
    ruleAdjustments.push(
      `【誤判定除外: #J-Pop】専門ジャンル（${
        precheck.enforcedPrimaryGenre || workingGenre || '非ポップス系'
      }）のメタデータ（規格品番・レーベル・タイトル構造）と競合するため「J-Pop」を除外しました`
    );
  }

  // Pre-1988 Historical Genre Priority over "J-Pop"
  const pre1988SpecificGenres = [
    '昭和歌謡',
    'ニューミュージック',
    'フォーク',
    'シティポップ',
    'アイドル',
    'テクノポップ',
    'ロック',
    'AOR',
  ];

  if (precheck.isPreJPopEra && (workingTags.includes('J-Pop') || workingGenre === 'J-Pop')) {
    const matchedHistoricalGenre =
      precheck.enforcedPrimaryGenre ||
      workingTags.find((t) => pre1988SpecificGenres.includes(t)) ||
      (pre1988SpecificGenres.includes(workingGenre) ? workingGenre : '');

    if (matchedHistoricalGenre && matchedHistoricalGenre !== 'J-Pop') {
      // Do not allow J-Pop as primary genre for pre-1988 releases when a period-accurate genre exists
      if (workingGenre === 'J-Pop') {
        workingGenre = matchedHistoricalGenre;
      }
      // For <= 1985 (1950s, 1960s, 1970s, early 80s), remove anachronistic J-Pop tag completely
      if (
        precheck.isEarlyPreJPopEra &&
        ['昭和歌謡', 'フォーク', 'ニューミュージック', 'シティポップ', 'アイドル', 'テクノポップ'].includes(
          matchedHistoricalGenre
        )
      ) {
        workingTags = workingTags.filter((t) => t !== 'J-Pop');
        workingEvidence = workingEvidence.filter((ev) => ev.tag !== 'J-Pop');
        if (!workingTags.includes(matchedHistoricalGenre)) {
          workingTags.push(matchedHistoricalGenre);
        }
        ruleAdjustments.push(
          `【時代整合性フィルター: #J-Pop → #${matchedHistoricalGenre}】リリース年（${precheck.effectiveYear}年・${precheck.effectiveDateSource}）は「J-Pop」呼称定着（1988年）以前のため、「${matchedHistoricalGenre}」を優先し「J-Pop」を除外しました`
        );
      }
    } else if (precheck.isEarlyPreJPopEra && !precheck.isWesternOrigin) {
      // If a pre-1986 domestic album ONLY had "J-Pop" and no period-accurate genre, infer the proper historical genre
      const fallbackHistoricalGenre =
        precheck.effectiveYear && precheck.effectiveYear <= 1973
          ? '昭和歌謡'
          : input.vinylRecordFormat && /^(EP|7")$/i.test(input.vinylRecordFormat)
          ? '昭和歌謡'
          : 'ニューミュージック';

      workingTags = workingTags.map((t) => (t === 'J-Pop' ? fallbackHistoricalGenre : t));
      workingEvidence = workingEvidence.filter((ev) => ev.tag !== 'J-Pop');
      if (workingGenre === 'J-Pop' || !workingGenre) {
        workingGenre = fallbackHistoricalGenre;
      }
      workingEvidence.push({
        tag: fallbackHistoricalGenre,
        category: 'genre',
        evidence: `リリース年（${precheck.effectiveYear}年・${precheck.effectiveDateSource}）および盤種・レーベル情報の時代整合性ルールに基づき、1988年以前の邦楽作品として「${fallbackHistoricalGenre}」に分類`,
        sourceFields: [precheck.effectiveDateSource, 'レーベル'],
      });
      ruleAdjustments.push(
        `【時代整合性フィルター: #J-Pop → #${fallbackHistoricalGenre}】${precheck.effectiveYear}年（${precheck.effectiveDateSource}）の時代区分に基づき「${fallbackHistoricalGenre}」へ補正しました`
      );
    }
  }

  // 5. Inject Enforced Tags from Precheck (クラシック, ジャズ, アニソン, 洋楽, ベスト盤, ライブ盤, サウンドトラック, CMソング, etc.)
  for (const enf of precheck.enforcedTags) {
    if (blockedTagNames.has(enf.tag)) continue;
    if (!workingTags.includes(enf.tag)) {
      workingTags.push(enf.tag);
      ruleAdjustments.push(`【メタデータ自動検出: #${enf.tag}】${enf.evidence}`);
    }
    if (!workingEvidence.some((ev) => ev.tag === enf.tag)) {
      workingEvidence.push({
        tag: enf.tag,
        category: enf.category,
        evidence: enf.evidence,
        sourceFields: enf.sourceFields,
      });
    }
  }

  // 6. Resolve Primary Genre without blindly falling back to "J-Pop"
  if (precheck.enforcedPrimaryGenre && !blockedTagNames.has(precheck.enforcedPrimaryGenre)) {
    workingGenre = precheck.enforcedPrimaryGenre;
    if (!workingTags.includes(workingGenre)) {
      workingTags.unshift(workingGenre);
    }
  }

  if (!workingGenre || blockedTagNames.has(workingGenre) || !workingTags.includes(workingGenre)) {
    const primaryGenreCandidate = workingTags.find(
      (t) =>
        !DECADE_TAG_REGEX.test(t) &&
        !['邦楽', '洋楽', 'ベスト盤', 'ライブ盤', 'CMソング'].includes(t)
    );
    if (primaryGenreCandidate) {
      workingGenre = primaryGenreCandidate;
    } else if (precheck.isWesternOrigin) {
      workingGenre = '洋楽';
      if (!workingTags.includes('洋楽')) workingTags.push('洋楽');
    } else if (precheck.isEarlyPreJPopEra) {
      workingGenre = 'ニューミュージック';
      if (!workingTags.includes('ニューミュージック')) workingTags.push('ニューミュージック');
    } else {
      workingGenre = 'J-Pop';
      if (!workingTags.includes('J-Pop')) workingTags.push('J-Pop');
    }
  }

  // Ensure domestic/international tag consistency
  if (precheck.isWesternOrigin) {
    workingTags = workingTags.filter((t) => t !== '邦楽');
    if (!workingTags.includes('洋楽')) workingTags.push('洋楽');
  }

  // Ensure every genre/style tag in workingTags has an evidence entry
  if (!workingEvidence.some((ev) => ev.tag === workingGenre)) {
    const activeSources: string[] = ['アーティスト名'];
    if (input.label) activeSources.push('レーベル');
    if (input.catalogNumber) activeSources.push('規格品番');
    if (input.vinylRecordReleaseDate) activeSources.push('LP/EP発売年月日');
    else if (input.releaseDate) activeSources.push('CD発売年月日');

    workingEvidence.push({
      tag: workingGenre,
      category: 'genre',
      evidence: `アーティスト「${input.artist || '不明'}」・タイトル「${input.title || ''}」${
        input.label ? `・レーベル（${input.label}）` : ''
      }${input.catalogNumber ? `・規格品番（${input.catalogNumber}）` : ''}の複合メタデータ検証により「${workingGenre}」と判定`,
      sourceFields: activeSources,
    });
  }

  // Deduplicate tags while keeping order
  const finalTags = Array.from(new Set(workingTags.filter(Boolean)));
  const finalEvidence = workingEvidence.filter((ev) => finalTags.includes(ev.tag));

  return {
    genre: workingGenre,
    subGenre: workingSubGenre && finalTags.includes(workingSubGenre) ? workingSubGenre : undefined,
    suggestedTags: finalTags,
    tagEvidence: finalEvidence,
    ruleAdjustments,
  };
}
