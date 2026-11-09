import JSZip from 'jszip';
import { ExtractedAsset } from '../types';

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0) {
    return '—';
  }
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function getRenderableUrl(asset: ExtractedAsset): string {
  if (!asset.isExternal || asset.url.startsWith('data:') || asset.url.startsWith('/')) {
    return asset.url;
  }
  return `/api/proxy?url=${encodeURIComponent(asset.url)}&filename=${encodeURIComponent(asset.filename)}`;
}

export async function fetchAssetBlob(asset: ExtractedAsset): Promise<Blob> {
  const fetchUrl = getRenderableUrl(asset);
  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${asset.filename} (HTTP ${response.status})`);
  }
  return await response.blob();
}

export async function triggerSingleDownload(asset: ExtractedAsset): Promise<void> {
  if (asset.isExternal && !asset.url.startsWith('data:') && !asset.url.startsWith('/')) {
    const downloadUrl = `/api/proxy?url=${encodeURIComponent(asset.url)}&filename=${encodeURIComponent(asset.filename)}&download=1`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = asset.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  const blob = await fetchAssetBlob(asset);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = asset.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
}

export async function exportAssetsAsZip(
  assets: ExtractedAsset[],
  domainName: string,
  onProgress?: (completed: number, total: number) => void
): Promise<{ successCount: number; zipSizeBytes: number }> {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  let successCount = 0;

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    try {
      const blob = await fetchAssetBlob(asset);
      let safeName = asset.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || `asset-${i + 1}.bin`;
      if (usedNames.has(safeName)) {
        const dotIdx = safeName.lastIndexOf('.');
        if (dotIdx > 0) {
          safeName = `${safeName.slice(0, dotIdx)}-${i + 1}${safeName.slice(dotIdx)}`;
        } else {
          safeName = `${safeName}-${i + 1}`;
        }
      }
      usedNames.add(safeName);
      zip.file(safeName, blob);
      successCount += 1;
    } catch {
      // If an individual external asset fails, log it in a manifest inside the zip
    }
    if (onProgress) {
      onProgress(i + 1, assets.length);
    }
  }

  // Also include an extraction manifest JSON file in the archive
  const manifest = {
    sourceDomain: domainName,
    exportedAt: new Date().toISOString(),
    totalExported: successCount,
    assets: assets.map((a) => ({
      filename: a.filename,
      originalUrl: a.url,
      category: a.category,
      format: a.format,
      dimensions: a.width && a.height ? `${a.width}x${a.height}` : undefined,
      sourceTag: a.sourceTag,
      domContext: a.domContext,
    })),
  };
  zip.file('extraction-manifest.json', JSON.stringify(manifest, null, 2));

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipUrl = URL.createObjectURL(zipBlob);
  const cleanDomain = domainName.replace(/[^a-zA-Z0-9.-]/g, '_') || 'media';
  const a = document.createElement('a');
  a.href = zipUrl;
  a.download = `loomextract-${cleanDomain}-${assets.length}-assets.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(zipUrl), 4000);

  return { successCount, zipSizeBytes: zipBlob.size };
}

export interface ConvertedImageResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  byteSize: number;
  extension: 'png' | 'jpg' | 'webp';
}

export async function convertImageAsset(
  asset: ExtractedAsset,
  targetFormat: 'image/png' | 'image/jpeg' | 'image/webp',
  quality = 0.92,
  scaleFactor = 1
): Promise<ConvertedImageResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const naturalW = img.naturalWidth || asset.width || 800;
      const naturalH = img.naturalHeight || asset.height || 600;
      const outW = Math.max(1, Math.round(naturalW * scaleFactor));
      const outH = Math.max(1, Math.round(naturalH * scaleFactor));

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }

      // Fill dark/light neutral background if exporting to non-transparent JPEG
      if (targetFormat === 'image/jpeg') {
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, outW, outH);
      }

      ctx.drawImage(img, 0, 0, outW, outH);
      const dataUrl = canvas.toDataURL(targetFormat, quality);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Image conversion failed'));
            return;
          }
          const extension =
            targetFormat === 'image/png'
              ? 'png'
              : targetFormat === 'image/webp'
              ? 'webp'
              : 'jpg';
          resolve({
            blob,
            dataUrl,
            width: outW,
            height: outH,
            byteSize: blob.size,
            extension,
          });
        },
        targetFormat,
        quality
      );
    };
    img.onerror = () => {
      reject(new Error('Could not load image into canvas for format conversion'));
    };
    img.src = getRenderableUrl(asset);
  });
}
