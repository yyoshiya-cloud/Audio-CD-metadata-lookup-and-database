/**
 * Utility functions for formatting timestamps in Japan Standard Time (JST, UTC+9)
 * and normalizing dates and catalog numbers across the application.
 */

/**
 * Returns current timestamp formatted in JST ISO string e.g. "2026-10-01T22:27:41+09:00"
 */
export function getJSTISOString(): string {
  const now = new Date();
  const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = jstFormatter.formatToParts(now);
  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });

  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+09:00`;
}

/**
 * Formats a date or date string into JST format e.g. "YYYY-MM-DD HH:MM:SS" (2026-10-01 22:27:41)
 */
export function formatJSTDateTime(dateInput?: string | Date | number): string {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return String(dateInput);

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });

  const hour = map.hour === '24' ? '00' : (map.hour || '00');
  const minute = map.minute || '00';
  const second = map.second || '00';
  const year = map.year || '2026';
  const month = map.month || '01';
  const day = map.day || '01';

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * Formats a date string into short JST format e.g. "10/01 23:54"
 */
export function formatJSTShort(dateInput?: string | Date | number): string {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return formatter.format(date);
}

/**
 * Convert full-width alphanumeric and symbols to half-width,
 * and normalize catalog number to UPPERCASE (e.g. "vicl-123" -> "VICL-123", "ｖｉｃｌ－１２３" -> "VICL-123")
 */
export function normalizeCatalogNumber(raw?: string | null): string {
  if (!raw) return '';
  
  let str = String(raw).trim();
  
  // Convert full-width alphanumerics (！-～) to half-width
  str = str.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  
  // Convert full-width space to half-width
  str = str.replace(/　/g, ' ');
  
  // Convert various dashes/hyphens to standard half-width hyphen
  str = str.replace(/[‐‑‒–—―ー−ｰ]/g, '-');
  
  // Convert all letters to UPPERCASE
  str = str.toUpperCase();
  
  return str.trim();
}

/**
 * Normalizes any release date format (Excel/Google Sheets serial date numbers,
 * 8-digit YYYYMMDD numbers, Wareki Japanese era strings, slash/dot-separated dates)
 * into a standard clean date string e.g. "1998-05-21" or "1998-05" or "1998".
 */
export function normalizeReleaseDate(raw?: string | number | null): string {
  if (raw === undefined || raw === null) return '';
  
  let str = String(raw).trim();
  if (!str) return '';

  // 1. Check if it's a numeric Excel / Google Sheets serial date (e.g. 31256, 44927, 28000.5)
  // Google Sheets serial day 1 = 1899-12-30.
  // Values between 10000 (year 1927) and 70000 (year 2091) are typical serial dates.
  if (/^\d{4,5}(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    if (num >= 10000 && num <= 60000) {
      // Excel epoch: 1899-12-30 UTC
      const epochMs = new Date(Date.UTC(1899, 11, 30)).getTime();
      const dateMs = epochMs + Math.floor(num) * 86400 * 1000;
      const d = new Date(dateMs);
      if (!isNaN(d.getTime())) {
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        if (year >= 1920 && year <= 2040) {
          return `${year}-${month}-${day}`;
        }
      }
    }
  }

  // 2. Check 8-digit numbers or strings with 8 digits (e.g. "19980521" or "1994-1130" or "19930721")
  const digitsOnly = str.replace(/\D/g, '');
  if (digitsOnly.length === 8) {
    const y = digitsOnly.slice(0, 4);
    const m = digitsOnly.slice(4, 6);
    const d = digitsOnly.slice(6, 8);
    const mNum = parseInt(m, 10);
    const dNum = parseInt(d, 10);
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return `${y}-${m}-${d}`;
    }
  }

  // 3. Check 6-digit number e.g. "199805"
  if (digitsOnly.length === 6) {
    const y = digitsOnly.slice(0, 4);
    const m = digitsOnly.slice(4, 6);
    const mNum = parseInt(m, 10);
    if (mNum >= 1 && mNum <= 12) {
      return `${y}-${m}`;
    }
  }

  // 4. Convert Japanese Wareki era formats
  // 昭和N年 (1925 + N), 平成N年 (1988 + N), 令和N年 (2018 + N), 大正N年 (1911 + N)
  const warekiMatch = str.match(/^(昭和|平成|令和|大正|S|H|R|T)(\d{1,2}|元)[年\.\/-](\d{1,2})?[月\.\/-]?(\d{1,2})?日?$/i);
  if (warekiMatch) {
    const eraName = warekiMatch[1].toUpperCase();
    const eraYearStr = warekiMatch[2];
    const eraYear = eraYearStr === '元' ? 1 : parseInt(eraYearStr, 10);
    let adYear = 0;
    if (eraName === '昭和' || eraName === 'S') adYear = 1925 + eraYear;
    else if (eraName === '平成' || eraName === 'H') adYear = 1988 + eraYear;
    else if (eraName === '令和' || eraName === 'R') adYear = 2018 + eraYear;
    else if (eraName === '大正' || eraName === 'T') adYear = 1911 + eraYear;

    if (adYear > 0) {
      const m = warekiMatch[3] ? String(parseInt(warekiMatch[3], 10)).padStart(2, '0') : '';
      const d = warekiMatch[4] ? String(parseInt(warekiMatch[4], 10)).padStart(2, '0') : '';
      if (m && d) return `${adYear}-${m}-${d}`;
      if (m) return `${adYear}-${m}`;
      return `${adYear}`;
    }
  }

  // 5. Replace Japanese date delimiters like "1998年5月21日" or "1998/5/21" or "1998.5.21"
  let cleaned = str.replace(/[年月日]/g, (match) => (match === '日' ? '' : '-'));
  cleaned = cleaned.replace(/[\/\.]/g, '-').replace(/\s+/g, '');

  // Match YYYY-MM-DD or YYYY-M-D
  const ymdMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = String(parseInt(ymdMatch[2], 10)).padStart(2, '0');
    const d = String(parseInt(ymdMatch[3], 10)).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Match YYYY-MM or YYYY-M
  const ymMatch = cleaned.match(/^(\d{4})-(\d{1,2})$/);
  if (ymMatch) {
    const y = ymMatch[1];
    const m = String(parseInt(ymMatch[2], 10)).padStart(2, '0');
    return `${y}-${m}`;
  }

  // Match 4-digit Year only
  if (/^\d{4}$/.test(cleaned)) {
    return cleaned;
  }

  return str;
}
