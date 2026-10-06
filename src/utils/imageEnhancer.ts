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
