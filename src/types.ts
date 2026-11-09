export type AssetCategory = 'image' | 'vector' | 'video' | 'audio' | 'meta' | 'background';

export interface ExtractedVariant {
  url: string;
  descriptor: string;
  width?: number;
}

export interface ExtractedAsset {
  id: string;
  url: string;
  filename: string;
  category: AssetCategory;
  format: string;
  mimeType?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  byteSize?: number;
  alt?: string;
  sourceTag: string;
  domContext: string;
  variants?: ExtractedVariant[];
  svgCode?: string;
  posterUrl?: string;
  isExternal: boolean;
}

export interface ExtractionResult {
  url: string;
  domain: string;
  title: string;
  description: string;
  favicon: string;
  colors: string[];
  scanDurationMs: number;
  assets: ExtractedAsset[];
  extractedAt?: string;
  isPreset?: boolean;
}

export type SizeFilter = 'all' | 'hd' | 'medium' | 'small';
export type SortOption = 'resolution-desc' | 'size-desc' | 'dom-order' | 'format';
export type ViewMode = 'grid' | 'table';
export type ActiveWorkspaceTab = 'workspace' | 'queue' | 'converter' | 'history';
