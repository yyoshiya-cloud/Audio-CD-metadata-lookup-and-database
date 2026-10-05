/**
 * Format & conversion utilities for CD Metadata fields
 */

/**
 * Convert full-width alphanumeric & symbols to half-width
 */
export const zenkakuToHankaku = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[ー—―－−–]/g, '-')
    .replace(/／/g, '/')
    .replace(/：/g, ':')
    .replace(/　/g, ' ')
    .trim();
};

/**
 * Filter string strictly to half-width ASCII characters (A-Z, a-z, 0-9, -, /, :, .)
 */
export const toHankakuCode = (str: string): string => {
  const converted = zenkakuToHankaku(str);
  // Strip non-ASCII characters
  return converted.replace(/[^\x20-\x7E]/g, '');
};

/**
 * Auto-convert various date representations into YYYY-MM-DD format
 * Examples:
 *   20241005 -> 2024-10-05
 *   2024/10/5 -> 2024-10-05
 *   2024年10月5日 -> 2024-10-05
 *   2024.1.5 -> 2024-01-05
 */
export const formatToYYYYMMDD = (str: string): string => {
  if (!str) return '';
  let cleaned = zenkakuToHankaku(str);

  // Replace Japanese date delimiters
  cleaned = cleaned.replace(/年|月/g, '-').replace(/日/g, '');
  cleaned = cleaned.replace(/[\/\.]/g, '-');
  cleaned = cleaned.replace(/[^0-9-]/g, '');

  // 8 digits: YYYYMMDD
  if (/^\d{8}$/.test(cleaned)) {
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    const d = cleaned.slice(6, 8);
    return `${y}-${m}-${d}`;
  }

  // 6 digits: YYYYMM
  if (/^\d{6}$/.test(cleaned)) {
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    return `${y}-${m}`;
  }

  // Separated parts
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length === 3) {
    const y = parts[0].padStart(4, '0');
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  } else if (parts.length === 2) {
    const y = parts[0].padStart(4, '0');
    const m = parts[1].padStart(2, '0');
    return `${y}-${m}`;
  }

  return cleaned;
};

/**
 * Format track duration string to half-width (MM:SS)
 */
export const formatToHankakuDuration = (str: string): string => {
  if (!str) return '';
  const converted = zenkakuToHankaku(str);
  // Keep only half-width numbers, colons, and 's'
  return converted.replace(/[^0-9:sS]/g, '');
};
