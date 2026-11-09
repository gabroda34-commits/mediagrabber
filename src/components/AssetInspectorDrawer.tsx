import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Sliders,
  ExternalLink,
  Code2,
  Layers,
} from 'lucide-react';
import { ExtractedAsset } from '../types';
import {
  formatBytes,
  getRenderableUrl,
  triggerSingleDownload,
  convertImageAsset,
  ConvertedImageResult,
} from '../utils/mediaTools';
import { AssetPreviewThumb } from './AssetPreviewThumb';

interface AssetInspectorDrawerProps {
  asset: ExtractedAsset | null;
  onClose: () => void;
  onDimensionsResolved: (id: string, width: number, height: number) => void;
}

export const AssetInspectorDrawer: React.FC<AssetInspectorDrawerProps> = ({
  asset,
  onClose,
  onDimensionsResolved,
}) => {
  const [zoomOneToOne, setZoomOneToOne] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Format conversion state
  const [targetFormat, setTargetFormat] = useState<'image/webp' | 'image/png' | 'image/jpeg'>('image/webp');
  const [quality, setQuality] = useState<number>(0.9);
  const [scaleFactor, setScaleFactor] = useState<number>(1);
  const [convertedResult, setConvertedResult] = useState<ConvertedImageResult | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  useEffect(() => {
    setZoomOneToOne(false);
    setConvertedResult(null);
    setConvertError(null);
  }, [asset?.id]);

  if (!asset) return null;

  const isConvertibleImage =
    asset.category === 'image' ||
    asset.category === 'vector' ||
    asset.category === 'meta' ||
    asset.category === 'background';

  const copyText = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleRunConversion = async () => {
    if (!isConvertibleImage) return;
    setIsConverting(true);
    setConvertError(null);
    try {
      const res = await convertImageAsset(asset, targetFormat, quality, scaleFactor);
      setConvertedResult(res);
    } catch (err: unknown) {
      setConvertError(err instanceof Error ? err.message : 'Format conversion failed');
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownloadConverted = () => {
    if (!convertedResult) return;
    const baseName = asset.filename.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = convertedResult.dataUrl;
    a.download = `${baseName}-${convertedResult.width}x${convertedResult.height}.${convertedResult.extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const htmlSnippet =
    asset.category === 'video'
      ? `<video src="${asset.url}" controls preload="metadata"></video>`
      : asset.category === 'audio'
      ? `<audio src="${asset.url}" controls></audio>`
      : `<img src="${asset.url}" alt="${(asset.alt || asset.filename).replace(/"/g, '&quot;')}"${
          asset.width ? ` width="${asset.width}"` : ''
        }${asset.height ? ` height="${asset.height}"` : ''} loading="lazy" />`;

  const markdownSnippet = `![${asset.alt || asset.filename}](${asset.url})`;
  const cssSnippet = `background-image: url('${asset.url}');`;

  return (
    <aside className="w-full lg:w-[420px] xl:w-[460px] shrink-0 border-l border-slate-800 bg-slate-900/95 flex flex-col h-full overflow-y-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-800">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100 truncate" title={asset.filename}>
            {asset.filename}
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono tabular-nums mt-0.5">
            <span>{asset.format}</span>
            <span aria-hidden="true">·</span>
            <span>
              {asset.width && asset.height ? `${asset.width} × ${asset.height} px` : 'Dimensions probing'}
            </span>
            {asset.byteSize ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatBytes(asset.byteSize)}</span>
              </>
            ) : null}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors shrink-0"
          aria-label="Close inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Preview Stage */}
      <div className="relative bg-checkerboard border-b border-slate-800 h-64 flex items-center justify-center overflow-auto p-4">
        {asset.category === 'audio' ? (
          <div className="w-full flex flex-col items-center gap-3 px-4">
            <audio src={getRenderableUrl(asset)} controls className="w-full" />
            <span className="text-xs text-slate-400 font-mono">{asset.mimeType || 'audio/wav'}</span>
          </div>
        ) : asset.category === 'video' ? (
          <video
            src={getRenderableUrl(asset)}
            controls
            className="max-h-full max-w-full rounded"
          />
        ) : (
          <AssetPreviewThumb
            asset={asset}
            onDimensionsResolved={onDimensionsResolved}
            className={
              zoomOneToOne
                ? 'max-w-none max-h-none cursor-zoom-out'
                : 'max-h-full max-w-full object-contain cursor-zoom-in'
            }
          />
        )}

        {isConvertibleImage && (
          <button
            onClick={() => setZoomOneToOne((prev) => !prev)}
            className="absolute bottom-3 right-3 px-2.5 py-1.5 bg-slate-950/85 hover:bg-slate-900 text-slate-200 border border-slate-700/80 rounded-md text-xs font-mono flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            {zoomOneToOne ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" /> Fit Frame
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" /> 1:1 Pixel
              </>
            )}
          </button>
        )}
      </div>

      {/* Primary Actions */}
      <div className="p-5 border-b border-slate-800 flex items-center gap-2.5">
        <button
          onClick={() => triggerSingleDownload(asset)}
          className="flex-1 py-2 px-4 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          Download Original ({asset.format})
        </button>
        {asset.isExternal && (
          <a
            href={asset.url}
            target="_blank"
            rel="noopener noreferrer"
            className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Source
          </a>
        )}
      </div>

      {/* Technical Specifications */}
      <div className="p-5 border-b border-slate-800 space-y-3">
        <h3 className="text-xs font-semibold text-slate-300">Technical Telemetry</h3>
        <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
          <div>
            <span className="text-slate-500 block">DOM Provenance</span>
            <span className="text-slate-200 font-mono">{asset.sourceTag} · {asset.domContext}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Aspect Ratio</span>
            <span className="text-slate-200 font-mono tabular-nums">
              {asset.aspectRatio || (asset.width && asset.height ? `${(asset.width / asset.height).toFixed(2)}:1` : '—')}
            </span>
          </div>
          <div className="col-span-2">
            <span className="text-slate-500 block">Alt / Label Description</span>
            <span className="text-slate-200 break-words">{asset.alt || 'No alt attribute specified'}</span>
          </div>
        </div>
      </div>

      {/* Responsive srcset Variants if discovered */}
      {asset.variants && asset.variants.length > 0 && (
        <div className="p-5 border-b border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              Discovered srcset Candidates
            </h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {asset.variants.length} resolutions
            </span>
          </div>
          <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg overflow-hidden">
            {asset.variants.map((v, i) => (
              <div
                key={`${v.url}-${i}`}
                className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-950/40 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-mono text-slate-200 tabular-nums">{v.descriptor}</span>
                  {v.width ? (
                    <span className="text-slate-500 font-mono tabular-nums ml-2">
                      · {v.width}px wide
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() =>
                    triggerSingleDownload({
                      ...asset,
                      url: v.url,
                      filename: `${v.descriptor.replace(/\s+/g, '_')}-${asset.filename}`,
                    })
                  }
                  className="text-sky-400 hover:text-sky-300 font-medium whitespace-nowrap shrink-0"
                >
                  Grab {v.descriptor.split(' ')[0]}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Client-Side Format Converter & Resizer */}
      {isConvertibleImage && (
        <div className="p-5 border-b border-slate-800 space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              On-the-Fly Format & Scale Transcoder
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Output Format</label>
              <div className="flex items-center p-0.5 bg-slate-950 border border-slate-800 rounded-lg">
                {(
                  [
                    { label: 'WEBP', mime: 'image/webp' },
                    { label: 'PNG', mime: 'image/png' },
                    { label: 'JPG', mime: 'image/jpeg' },
                  ] as const
                ).map((fmt) => (
                  <button
                    key={fmt.mime}
                    onClick={() => setTargetFormat(fmt.mime)}
                    className={`flex-1 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      targetFormat === fmt.mime
                        ? 'bg-slate-800 text-sky-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Resolution Scale</label>
              <div className="flex items-center p-0.5 bg-slate-950 border border-slate-800 rounded-lg">
                {[1, 0.75, 0.5, 0.25].map((scale) => (
                  <button
                    key={scale}
                    onClick={() => setScaleFactor(scale)}
                    className={`flex-1 py-1 text-xs font-mono tabular-nums rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      scaleFactor === scale
                        ? 'bg-slate-800 text-sky-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {Math.round(scale * 100)}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {targetFormat !== 'image/png' && (
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400">Compression Quality</span>
                <span className="font-mono text-slate-200 tabular-nums">{Math.round(quality * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
                className="w-full accent-sky-400 cursor-pointer"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunConversion}
              disabled={isConverting}
              className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {isConverting ? 'Transcoding...' : `Convert to ${targetFormat.split('/')[1].toUpperCase()}`}
            </button>
            {convertedResult && (
              <button
                onClick={handleDownloadConverted}
                className="py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 tabular-nums"
              >
                <Download className="w-3.5 h-3.5" />
                Save ({formatBytes(convertedResult.byteSize)})
              </button>
            )}
          </div>

          {convertError && <p className="text-xs text-red-400">{convertError}</p>}
        </div>
      )}

      {/* Raw SVG Markup Inspector */}
      {asset.svgCode && (
        <div className="p-5 border-b border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-sky-400" />
              Inline SVG Vector Markup
            </h3>
            <button
              onClick={() => copyText('svg', asset.svgCode || '')}
              className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              {copiedKey === 'svg' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'svg' ? 'Copied SVG' : 'Copy Raw SVG'}
            </button>
          </div>
          <pre className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto max-h-36">
            {asset.svgCode}
          </pre>
        </div>
      )}

      {/* Embed & Copy Snippets */}
      <div className="p-5 space-y-2.5">
        <h3 className="text-xs font-semibold text-slate-300">Copy Asset Snippets</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'url', label: 'Copy Direct URL', value: asset.url },
            { id: 'html', label: 'Copy HTML Tag', value: htmlSnippet },
            { id: 'md', label: 'Copy Markdown', value: markdownSnippet },
            { id: 'css', label: 'Copy CSS url()', value: cssSnippet },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => copyText(item.id, item.value)}
              className="py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs text-slate-300 flex items-center justify-between gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <span>{copiedKey === item.id ? 'Copied!' : item.label}</span>
              {copiedKey === item.id ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};
