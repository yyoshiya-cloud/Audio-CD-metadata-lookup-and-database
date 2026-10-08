import dns from 'dns';
import net from 'net';
import type { Request, Response, NextFunction } from 'express';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  '[::1]',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
]);

/**
 * Checks whether an IPv4 or IPv6 address belongs to a loopback, private, link-local,
 * unique-local, or unspecified address range (SSRF protection).
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  const normalized = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.slice('::ffff:'.length);
    if (net.isIPv4(ipv4Part)) {
      return isPrivateOrReservedIP(ipv4Part);
    }
  }

  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b, c] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (a === 10) return true;
    // 100.64.0.0/10 (Shared Address Space / CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud Metadata service 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private network)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 & 192.0.2.0/24
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    // 192.168.0.0/16 (Private network)
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 (Benchmark testing)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast)
    if (a >= 224) return true;

    return false;
  }

  if (net.isIPv6(normalized)) {
    // Unspecified (::) or Loopback (::1)
    if (normalized === '::' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || normalized === '0:0:0:0:0:0:0:0') {
      return true;
    }
    // Link-local (fe80::/10)
    if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;
    // Unique local addresses (fc00::/7 -> fc00:: to fdff::)
    if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;
    // Multicast (ff00::/8)
    if (/^ff[0-9a-f]{2}:/i.test(normalized)) return true;

    return false;
  }

  // If not a valid IP format, treat as unsafe
  return true;
}

/**
 * Validates that a URL is a safe public HTTP/HTTPS URL and does not resolve to
 * any internal/private/loopback/metadata IP addresses (SSRF protection).
 */
export async function validateSafeExternalUrl(rawUrl: string): Promise<URL> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('有効なURLを指定してください。');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('URLの形式が正しくありません。');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('http:// または https:// のURLのみ許可されています。');
  }

  if (parsed.username || parsed.password) {
    throw new Error('認証情報を含むURLは許可されていません。');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error('内部ネットワークまたは禁止されたホストへのアクセスは拒否されました。');
  }

  // Direct IP literal check
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      throw new Error('プライベートIPまたは予約済みIPアドレスへのアクセスは拒否されました。');
    }
    return parsed;
  }

  // Resolve DNS records and verify all resolved IPs are public
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('ホスト名の名前解決に失敗しました。');
  }

  if (!addresses || addresses.length === 0) {
    throw new Error('ホスト名のIPアドレスを解決できませんでした。');
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIP(addr.address)) {
      throw new Error('内部ネットワークIPへ解決されるホストへのアクセスは拒否されました。');
    }
  }

  return parsed;
}

const ALLOWED_SAFE_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

/**
 * Safely fetches an external raster image with SSRF protection, redirect validation,
 * SVG exclusion (to prevent Stored XSS), and strict byte-size limits.
 */
export async function fetchSafeExternalImage(
  rawUrl: string,
  options?: { maxBytes?: number; timeoutMs?: number }
): Promise<{ buffer: Buffer; mimeType: string }> {
  const maxBytes = options?.maxBytes ?? 10 * 1024 * 1024; // Default 10MB max
  const timeoutMs = options?.timeoutMs ?? 12000;
  const maxRedirects = 4;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validatedUrl = await validateSafeExternalUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: globalThis.Response;
    try {
      response = await fetch(validatedUrl.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/png,image/jpeg,image/*;q=0.8',
          Referer: validatedUrl.origin,
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    // Handle HTTP redirects manually so every redirect target is SSRF-validated
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`リダイレクト先URLが不明です (HTTP ${response.status})`);
      }
      if (hop === maxRedirects) {
        throw new Error('リダイレクト回数が上限を超えました。');
      }
      currentUrl = new URL(location, validatedUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`画像取得エラー: HTTP ${response.status}`);
    }

    // Check Content-Type and explicitly block SVG / HTML / script types
    const rawContentType = (response.headers.get('content-type') || '').toLowerCase();
    const mimeType = rawContentType.split(';')[0].trim() || 'image/jpeg';

    if (mimeType.includes('svg') || mimeType.includes('html') || mimeType.includes('xml') || mimeType.includes('script')) {
      throw new Error('セキュリティ保護のため、SVGおよびスクリプトを含む可能性のある画像形式は許可されていません。');
    }

    if (!ALLOWED_SAFE_IMAGE_MIMES.has(mimeType) && !mimeType.startsWith('image/')) {
      throw new Error(`許可されていないコンテンツ形式です (${mimeType})`);
    }

    // Check Content-Length header if present
    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const declaredBytes = parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(declaredBytes) && declaredBytes > maxBytes) {
        throw new Error(`画像サイズが上限（${Math.round(maxBytes / 1024 / 1024)}MB）を超えています。`);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`画像サイズが上限（${Math.round(maxBytes / 1024 / 1024)}MB）を超えています。`);
    }

    const buffer = Buffer.from(arrayBuffer);

    // Extra magic-byte / payload check to ensure body is not disguised SVG/HTML
    const headSample = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    if (headSample.startsWith('<svg') || headSample.startsWith('<!doctype html') || headSample.startsWith('<html') || headSample.includes('<script')) {
      throw new Error('セキュリティ保護のため、SVGまたはHTMLコンテンツを含むデータは拒否されました。');
    }

    return { buffer, mimeType };
  }

  throw new Error('画像の取得に失敗しました。');
}

/**
 * Lightweight in-memory sliding-window rate limiter per client IP.
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
}) {
  const { windowMs, maxRequests, message } = options;
  const hits = new Map<string, number[]>();

  // Periodic cleanup every 2 minutes to prevent memory growth
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of hits.entries()) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        hits.delete(ip);
      } else {
        hits.set(ip, valid);
      }
    }
  }, 120_000);
  if (cleanupInterval.unref) cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) ||
      req.socket.remoteAddress ||
      'unknown';

    const now = Date.now();
    const recent = (hits.get(rawIp) || []).filter((t) => now - t < windowMs);

    if (recent.length >= maxRequests) {
      const retryAfterSec = Math.ceil(windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error:
          message ||
          `リクエスト回数の上限（${Math.round(windowMs / 1000)}秒あたり最大${maxRequests}回）に達しました。しばらく待ってから再試行してください。`,
      });
    }

    recent.push(now);
    hits.set(rawIp, recent);
    next();
  };
}

/**
 * Express middleware that sets defensive HTTP security headers while preserving
 * compatibility with AI Studio iframe preview and camera OCR functionality.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(), microphone=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
}
