/**
 * 画像プロキシ用のメモリキャッシュ（LRU）。
 * - 成功した画像を一定時間保持し、同じジャケットを開くたびに外部へ取りに行かない
 * - 失敗(404/403等)も短時間だけ記憶し、壊れたURLへの再リクエストを防ぐ
 * - 同じURLへの同時リクエストは1回の取得にまとめる
 */
export interface CachedImage {
  buffer: Buffer;
  mimeType: string;
}

type Entry =
  | { kind: 'ok'; value: CachedImage; expiresAt: number; bytes: number }
  | { kind: 'error'; message: string; expiresAt: number; bytes: number };

export class ImageCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<CachedImage>>();
  private totalBytes = 0;

  constructor(
    private readonly maxTotalBytes = 64 * 1024 * 1024,
    private readonly maxItemBytes = 4 * 1024 * 1024,
    private readonly okTtlMs = 60 * 60 * 1000,
    private readonly errorTtlMs = 5 * 60 * 1000,
    private readonly now: () => number = () => Date.now()
  ) {}

  private remove(key: string) {
    const e = this.entries.get(key);
    if (e) {
      this.totalBytes -= e.bytes;
      this.entries.delete(key);
    }
  }

  private put(key: string, entry: Entry) {
    this.remove(key);
    this.entries.set(key, entry);
    this.totalBytes += entry.bytes;
    // 容量超過分を古い順に削除
    while (this.totalBytes > this.maxTotalBytes && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value as string;
      this.remove(oldest);
    }
  }

  /** 有効なキャッシュを返す。無ければ undefined。参照したものは最新扱いにする。 */
  peek(key: string): Entry | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.remove(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, e);
    return e;
  }

  /**
   * キャッシュ → 進行中の取得 → fetcher の順に解決する。
   * 失敗は短時間キャッシュして同じエラーを返す。
   */
  async getOrFetch(key: string, fetcher: () => Promise<CachedImage>): Promise<CachedImage> {
    const hit = this.peek(key);
    if (hit?.kind === 'ok') return hit.value;
    if (hit?.kind === 'error') throw new Error(hit.message);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = (async () => {
      try {
        const value = await fetcher();
        if (value.buffer.byteLength <= this.maxItemBytes) {
          this.put(key, { kind: 'ok', value, expiresAt: this.now() + this.okTtlMs, bytes: value.buffer.byteLength });
        }
        return value;
      } catch (err: any) {
        const message = err?.message || '画像の取得に失敗しました。';
        this.put(key, { kind: 'error', message, expiresAt: this.now() + this.errorTtlMs, bytes: message.length });
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  get size() {
    return this.entries.size;
  }
}
