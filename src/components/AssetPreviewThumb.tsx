import React, { useState } from 'react';
import { Image as ImageIcon, Film, Volume2, Code2, Sparkles, Layers } from 'lucide-react';
import { ExtractedAsset } from '../types';
import { getRenderableUrl } from '../utils/mediaTools';

interface AssetPreviewThumbProps {
  asset: ExtractedAsset;
  className?: string;
  onDimensionsResolved?: (id: string, width: number, height: number) => void;
}

export const AssetPreviewThumb: React.FC<AssetPreviewThumbProps> = ({
  asset,
  className = 'w-full h-full object-contain',
  onDimensionsResolved,
}) => {
  const [hasError, setHasError] = useState(false);
  const renderUrl = getRenderableUrl(asset);

  if (asset.category === 'audio') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-slate-900/90 text-slate-300 select-none">
        <Volume2 className="w-8 h-8 text-sky-400 mb-2 shrink-0" />
        <span className="text-xs font-mono text-slate-400 truncate max-w-full px-2">
          {asset.format} Audio Stream
        </span>
      </div>
    );
  }

  if (asset.category === 'video' && !hasError) {
    return (
      <video
        src={renderUrl}
        poster={asset.posterUrl ? getRenderableUrl({ ...asset, url: asset.posterUrl }) : undefined}
        className={className}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight && onDimensionsResolved) {
            onDimensionsResolved(asset.id, v.videoWidth, v.videoHeight);
          }
        }}
        onError={() => setHasError(true)}
      />
    );
  }

  if (hasError) {
    const FallbackIcon =
      asset.category === 'vector'
        ? Code2
        : asset.category === 'video'
        ? Film
        : asset.category === 'meta'
        ? Sparkles
        : asset.category === 'background'
        ? Layers
        : ImageIcon;

    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800/80 text-slate-400 select-none">
        <FallbackIcon className="w-7 h-7 text-slate-500 mb-2 shrink-0" />
        <span className="text-xs font-medium text-slate-300 text-center line-clamp-1 max-w-full px-2">
          {asset.filename}
        </span>
        <span className="text-[11px] font-mono text-slate-500 mt-0.5">
          {asset.format} · {asset.sourceTag}
        </span>
      </div>
    );
  }

  return (
    <img
      src={renderUrl}
      alt={asset.alt || asset.filename}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={className}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth && img.naturalHeight && onDimensionsResolved) {
          onDimensionsResolved(asset.id, img.naturalWidth, img.naturalHeight);
        }
      }}
      onError={() => setHasError(true)}
    />
  );
};
