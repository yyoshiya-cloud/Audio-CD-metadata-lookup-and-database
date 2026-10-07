/**
 * Client-side Canvas High-Resolution Sharpening & Upscaling
 * Scales the jacket image to a crisp high-res 1000x1000 canvas with high-quality smoothing,
 * subtle contrast enhancement, and safe 0-255 RGB clamping.
 */
export function enhanceImageWithCanvas(imageUrl: string, targetSize = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!imageUrl) {
      reject(new Error('画像URLが空です'));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    const processImageOnCanvas = (sourceImg: HTMLImageElement) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(imageUrl);
          return;
        }

        // High quality bicubic interpolation scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw image fitted to square targetSize
        ctx.drawImage(sourceImg, 0, 0, targetSize, targetSize);

        // Apply a subtle contrast (+8%) and clarity boost safely clamped between 0 and 255
        const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
        const data = imageData.data;
        const c = 8; // +8% subtle contrast adjustment
        const factor = (259 * (c + 255)) / (255 * (259 - c)); // = 1.0642

        for (let i = 0; i < data.length; i += 4) {
          const r = factor * (data[i] - 128) + 128;
          const g = factor * (data[i + 1] - 128) + 128;
          const b = factor * (data[i + 2] - 128) + 128;

          data[i] = Math.min(255, Math.max(0, Math.round(r)));
          data[i + 1] = Math.min(255, Math.max(0, Math.round(g)));
          data[i + 2] = Math.min(255, Math.max(0, Math.round(b)));
        }

        ctx.putImageData(imageData, 0, 0);

        // Convert to high quality JPEG data URL (92% quality)
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (err) {
        console.warn('Canvas filter error:', err);
        resolve(imageUrl);
      }
    };

    img.onload = () => processImageOnCanvas(img);

    img.onerror = () => {
      // Try via image proxy if CORS error
      if (!imageUrl.includes('/api/image-proxy') && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        const proxyImg = new Image();
        proxyImg.crossOrigin = 'anonymous';
        proxyImg.onload = () => processImageOnCanvas(proxyImg);
        proxyImg.onerror = () => resolve(imageUrl);
        proxyImg.src = `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
      } else {
        resolve(imageUrl);
      }
    };

    img.src = imageUrl;
  });
}

/**
 * Convert an external image URL (http/https) into a compressed Base64 Data URL (`data:image/jpeg;base64,...`)
 * so that jacket artwork is permanently stored inside local IndexedDB (Dexie.js) and works 100% offline
 * without link rot or external CDN dependencies.
 */
export async function convertImageUrlToBase64(
  imageUrl: string,
  maxSide = 600,
  quality = 0.85
): Promise<string> {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return '';
  }
  const trimmed = imageUrl.trim();
  if (!trimmed) return '';

  // Already a Base64 data URL
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }

  const compressDataUrlOrImage = (src: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          let width = img.width || maxSide;
          let height = img.height || maxSide;
          if (width > maxSide || height > maxSide) {
            if (width > height) {
              height = Math.round((height * maxSide) / width);
              width = maxSide;
            } else {
              width = Math.round((width * maxSide) / height);
              height = maxSide;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context unavailable'));
            return;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = src;
    });
  };

  // 1. Try server-side /api/image-base64 first (avoids CORS issues and compresses via canvas)
  try {
    const res = await fetch('/api/image-base64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmed }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.dataUrl && typeof data.dataUrl === 'string' && data.dataUrl.startsWith('data:image/')) {
        try {
          return await compressDataUrlOrImage(data.dataUrl);
        } catch {
          return data.dataUrl;
        }
      }
    }
  } catch {}

  // 2. Fallback: Try loading via /api/image-proxy onto canvas
  try {
    return await compressDataUrlOrImage(`/api/image-proxy?url=${encodeURIComponent(trimmed)}`);
  } catch {}

  // 3. Fallback: Try direct CORS load onto canvas
  try {
    return await compressDataUrlOrImage(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * Ensure a CDMetadata record has its coverUrl converted to Base64 if it is an external http/https link.
 */
export async function ensureCDCoverBase64<T extends { coverUrl?: string }>(cd: T): Promise<T> {
  if (!cd.coverUrl || !cd.coverUrl.trim()) return cd;
  const trimmed = cd.coverUrl.trim();
  if (trimmed.startsWith('data:image/')) return cd;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const base64 = await convertImageUrlToBase64(trimmed);
    if (base64 && base64.startsWith('data:image/')) {
      return { ...cd, coverUrl: base64 };
    }
  }
  return cd;
}

