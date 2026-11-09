import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search,
  Download,
  Copy,
  Check,
  LayoutGrid,
  List,
  FolderArchive,
  Sliders,
  Clock,
  Globe,
  CheckSquare,
  Square,
  ArrowUpDown,
  FileJson,
  FileSpreadsheet,
  ExternalLink,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import {
  AssetCategory,
  ExtractedAsset,
  ExtractionResult,
  SizeFilter,
  SortOption,
  ViewMode,
  ActiveWorkspaceTab,
} from './types';
import { SAMPLE_EXTRACTION_PRESETS, QUICK_LIVE_URLS } from './data/samplePresets';
import {
  formatBytes,
  triggerSingleDownload,
  exportAssetsAsZip,
  convertImageAsset,
  ConvertedImageResult,
} from './utils/mediaTools';
import { AssetPreviewThumb } from './components/AssetPreviewThumb';
import { AssetInspectorDrawer } from './components/AssetInspectorDrawer';

const HISTORY_STORAGE_KEY = 'loomextract_history_v1';

export default function App() {
  // Navigation & Primary State
  const [activeTab, setActiveTab] = useState<ActiveWorkspaceTab>('workspace');
  const [urlInput, setUrlInput] = useState<string>(SAMPLE_EXTRACTION_PRESETS[0].url);
  const [deepScan, setDeepScan] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Current Extraction Data
  const [currentResult, setCurrentResult] = useState<ExtractionResult>(SAMPLE_EXTRACTION_PRESETS[0]);
  const [history, setHistory] = useState<ExtractionResult[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage error
    }
    return [
      {
        ...SAMPLE_EXTRACTION_PRESETS[0],
        extractedAt: new Date().toISOString(),
      },
    ];
  });

  // Filter, Sort & View Controls
  const [categoryFilter, setCategoryFilter] = useState<'all' | AssetCategory>('all');
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>('all');
  const [formatFilter, setFormatFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortOption>('resolution-desc');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Selection & Inspector State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(SAMPLE_EXTRACTION_PRESETS[0].assets.slice(0, 4).map((a) => a.id))
  );
  const [inspectedAssetId, setInspectedAssetId] = useState<string | null>(
    SAMPLE_EXTRACTION_PRESETS[0].assets[0]?.id || null
  );

  // Action Feedback & ZIP Export Progress
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number } | null>(null);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  // Converter Tab State
  const [converterAssetId, setConverterAssetId] = useState<string>(
    SAMPLE_EXTRACTION_PRESETS[0].assets[0]?.id || ''
  );
  const [converterMime, setConverterMime] = useState<'image/webp' | 'image/png' | 'image/jpeg'>('image/webp');
  const [converterQuality, setConverterQuality] = useState<number>(0.9);
  const [converterScale, setConverterScale] = useState<number>(1);
  const [converterOutput, setConverterOutput] = useState<ConvertedImageResult | null>(null);
  const [isTranscodingTab, setIsTranscodingTab] = useState<boolean>(false);

  const showTransientNotice = useCallback((msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 15)));
    } catch {
      // ignore quota error
    }
  }, [history]);

  // Update natural dimensions when browser finishes loading an image/video
  const handleDimensionsResolved = useCallback((id: string, width: number, height: number) => {
    setCurrentResult((prev) => {
      const target = prev.assets.find((a) => a.id === id);
      if (!target || (target.width === width && target.height === height)) {
        return prev;
      }
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const d = gcd(width, height);
      const rw = Math.round(width / d);
      const rh = Math.round(height / d);
      const aspectRatio = rw > 40 || rh > 40 ? `${(width / height).toFixed(2)}:1` : `${rw}:${rh}`;

      return {
        ...prev,
        assets: prev.assets.map((a) =>
          a.id === id ? { ...a, width, height, aspectRatio } : a
        ),
      };
    });
  }, []);

  // Perform live extraction or load preset
  const handleExtractUrl = async (targetUrlToGrab?: string) => {
    const raw = (targetUrlToGrab ?? urlInput).trim();
    if (!raw) {
      setErrorMessage('Please enter a webpage or direct media URL to grab.');
      return;
    }

    setUrlInput(raw);
    setErrorMessage(null);

    // Check if matches built-in sample preset URL
    const matchedPreset = SAMPLE_EXTRACTION_PRESETS.find(
      (p) => p.url.toLowerCase() === raw.toLowerCase()
    );
    if (matchedPreset) {
      setCurrentResult(matchedPreset);
      setSelectedIds(new Set(matchedPreset.assets.slice(0, 4).map((a) => a.id)));
      setInspectedAssetId(matchedPreset.assets[0]?.id || null);
      setConverterAssetId(matchedPreset.assets[0]?.id || '');
      setCategoryFilter('all');
      setFormatFilter('ALL');
      setActiveTab('workspace');
      showTransientNotice(`Loaded ${matchedPreset.assets.length} media assets from ${matchedPreset.domain}`);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: raw, deepScan }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status} extraction failure`);
      }

      const enrichedResult: ExtractionResult = {
        ...data,
        extractedAt: new Date().toISOString(),
      };

      setCurrentResult(enrichedResult);
      const initialSelected = new Set(enrichedResult.assets.slice(0, 6).map((a) => a.id));
      setSelectedIds(initialSelected);
      setInspectedAssetId(enrichedResult.assets[0]?.id || null);
      setConverterAssetId(enrichedResult.assets[0]?.id || '');
      setCategoryFilter('all');
      setFormatFilter('ALL');
      setSizeFilter('all');
      setActiveTab('workspace');

      setHistory((prev) => [
        enrichedResult,
        ...prev.filter((item) => item.url !== enrichedResult.url),
      ].slice(0, 12));

      showTransientNotice(
        `Extracted ${enrichedResult.assets.length} assets from ${enrichedResult.domain} in ${enrichedResult.scanDurationMs}ms`
      );
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not extract media from that URL.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Available formats in current extraction
  const availableFormats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of currentResult.assets) {
      counts.set(a.format, (counts.get(a.format) || 0) + 1);
    }
    return ['ALL', ...Array.from(counts.keys()).sort()];
  }, [currentResult.assets]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<'all' | AssetCategory, number> = {
      all: currentResult.assets.length,
      image: 0,
      vector: 0,
      video: 0,
      audio: 0,
      meta: 0,
      background: 0,
    };
    for (const a of currentResult.assets) {
      counts[a.category] = (counts[a.category] || 0) + 1;
    }
    return counts;
  }, [currentResult.assets]);

  // Filtered and Sorted Assets
  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = currentResult.assets.filter((asset) => {
      if (categoryFilter !== 'all' && asset.category !== categoryFilter) return false;
      if (formatFilter !== 'ALL' && asset.format !== formatFilter) return false;

      if (sizeFilter !== 'all') {
        const maxDim = Math.max(asset.width || 0, asset.height || 0);
        if (sizeFilter === 'hd' && maxDim < 1000) return false;
        if (sizeFilter === 'medium' && (maxDim < 300 || maxDim >= 1000)) return false;
        if (sizeFilter === 'small' && maxDim >= 300) return false;
      }

      if (q) {
        const haystack = `${asset.filename} ${asset.alt || ''} ${asset.url} ${asset.domContext} ${asset.format}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === 'resolution-desc') {
        const areaA = (a.width || 0) * (a.height || 0);
        const areaB = (b.width || 0) * (b.height || 0);
        return areaB - areaA;
      }
      if (sortBy === 'size-desc') {
        return (b.byteSize || 0) - (a.byteSize || 0);
      }
      if (sortBy === 'format') {
        return a.format.localeCompare(b.format);
      }
      return 0; // dom-order
    });
  }, [currentResult.assets, categoryFilter, formatFilter, sizeFilter, searchQuery, sortBy]);

  const selectedAssets = useMemo(
    () => currentResult.assets.filter((a) => selectedIds.has(a.id)),
    [currentResult.assets, selectedIds]
  );

  const inspectedAsset = useMemo(
    () => currentResult.assets.find((a) => a.id === inspectedAssetId) || null,
    [currentResult.assets, inspectedAssetId]
  );

  const toggleSelectId = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredAssets.forEach((a) => next.add(a.id));
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleExportZip = async () => {
    const targets = selectedAssets.length > 0 ? selectedAssets : filteredAssets;
    if (targets.length === 0) {
      showTransientNotice('Select at least one media asset to export.');
      return;
    }
    setZipProgress({ current: 0, total: targets.length });
    try {
      const { successCount, zipSizeBytes } = await exportAssetsAsZip(
        targets,
        currentResult.domain,
        (completed, total) => setZipProgress({ current: completed, total })
      );
      showTransientNotice(
        `Exported ${successCount} assets (${formatBytes(zipSizeBytes)}) as ZIP archive`
      );
    } catch {
      showTransientNotice('Failed to build ZIP archive.');
    } finally {
      setZipProgress(null);
    }
  };

  const handleExportManifest = (type: 'json' | 'csv') => {
    const targets = selectedAssets.length > 0 ? selectedAssets : filteredAssets;
    if (targets.length === 0) return;

    let content = '';
    let mime = 'application/json';
    let ext = 'json';

    if (type === 'json') {
      content = JSON.stringify(
        {
          sourceUrl: currentResult.url,
          domain: currentResult.domain,
          extractedAt: new Date().toISOString(),
          count: targets.length,
          assets: targets,
        },
        null,
        2
      );
    } else {
      mime = 'text/csv';
      ext = 'csv';
      const header = ['Filename', 'Format', 'Category', 'Width', 'Height', 'Bytes', 'SourceTag', 'URL'];
      const rows = targets.map((a) => [
        `"${a.filename.replace(/"/g, '""')}"`,
        a.format,
        a.category,
        a.width || '',
        a.height || '',
        a.byteSize || '',
        `"${a.sourceTag}"`,
        `"${a.url}"`,
      ]);
      content = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loomextract-${currentResult.domain}-manifest.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showTransientNotice(`Downloaded ${targets.length} asset records as .${ext.toUpperCase()}`);
  };

  const handleCopySelectedUrls = () => {
    const targets = selectedAssets.length > 0 ? selectedAssets : filteredAssets;
    const text = targets.map((a) => a.url).join('\n');
    navigator.clipboard.writeText(text);
    showTransientNotice(`Copied ${targets.length} media URLs to clipboard`);
  };

  const runDedicatedConverter = async () => {
    const targetAsset =
      currentResult.assets.find((a) => a.id === converterAssetId) ||
      currentResult.assets.find((a) => a.category === 'image' || a.category === 'vector');
    if (!targetAsset) return;
    setIsTranscodingTab(true);
    try {
      const res = await convertImageAsset(targetAsset, converterMime, converterQuality, converterScale);
      setConverterOutput(res);
    } catch {
      showTransientNotice('Could not transcode selected asset');
    } finally {
      setIsTranscodingTab(false);
    }
  };

  const totalSelectedBytes = useMemo(
    () => selectedAssets.reduce((acc, a) => acc + (a.byteSize || 0), 0),
    [selectedAssets]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar Contract: Strictly 1 row, 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800/90 bg-slate-950/95 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('workspace');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 font-display whitespace-nowrap shrink-0"
        >
          LoomExtract
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveTab('workspace')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'workspace'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent'
            }`}
          >
            Inspector Workspace
          </button>
          <button
            onClick={() => setActiveTab('queue')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 tabular-nums ${
              activeTab === 'queue'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent'
            }`}
          >
            Batch Queue ({selectedIds.size})
          </button>
          <button
            onClick={() => setActiveTab('converter')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeTab === 'converter'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent'
            }`}
          >
            Format Transcoder
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 tabular-nums ${
              activeTab === 'history'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent'
            }`}
          >
            History ({history.length})
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleExportZip}
            disabled={Boolean(zipProgress)}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 tabular-nums"
          >
            {zipProgress
              ? `Packing ZIP (${zipProgress.current}/${zipProgress.total})...`
              : selectedIds.size > 0
              ? `Export ${selectedIds.size} Selected (.ZIP)`
              : `Export All (${filteredAssets.length})`}
          </button>
        </div>
      </header>

      {/* URL Command & Extraction Bar */}
      <section className="border-b border-slate-800/90 bg-slate-900/50 px-6 py-4">
        <div className="max-w-[1600px] mx-auto space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleExtractUrl();
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <div className="relative flex-1 flex items-center">
              <Globe className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste any webpage URL or direct image/video link (e.g. https://en.wikipedia.org/wiki/Architecture)"
                aria-label="Target webpage or media URL"
                className="w-full pl-10 pr-24 py-2.5 bg-slate-950 border border-slate-800 focus:border-sky-400 focus:outline-none rounded-lg text-sm font-mono text-slate-100 placeholder:text-slate-500 transition-colors"
              />
              {urlInput && (
                <button
                  type="button"
                  onClick={() => setUrlInput('')}
                  className="absolute right-3 text-xs text-slate-500 hover:text-slate-300 font-mono whitespace-nowrap shrink-0"
                >
                  Clear
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setDeepScan((prev) => !prev)}
              className={`px-3.5 py-2.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                deepScan
                  ? 'bg-slate-800/90 border-sky-500/50 text-sky-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Fetch and parse linked external CSS stylesheets for background-image url() assets"
            >
              Deep CSS Scan: {deepScan ? 'On' : 'Off'}
            </button>

            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Inspecting DOM...
                </>
              ) : (
                'Grab Media Assets'
              )}
            </button>
          </form>

          {/* Quick Live & Preset Target Selector + Transient Status */}
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-400">
              <span className="text-slate-500">Quick targets:</span>
              <button
                type="button"
                onClick={() => handleExtractUrl(SAMPLE_EXTRACTION_PRESETS[0].url)}
                className={`hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 ${
                  currentResult.url === SAMPLE_EXTRACTION_PRESETS[0].url
                    ? 'text-sky-400 font-medium underline underline-offset-4'
                    : 'text-slate-300'
                }`}
              >
                Kurokawa Architecture Monograph
              </button>
              {QUICK_LIVE_URLS.map((item) => (
                <React.Fragment key={item.url}>
                  <span aria-hidden="true" className="text-slate-700">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => handleExtractUrl(item.url)}
                    className={`hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 ${
                      currentResult.url === item.url
                        ? 'text-sky-400 font-medium underline underline-offset-4'
                        : 'text-slate-300'
                    }`}
                    title={item.note}
                  >
                    {item.label}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {statusNotice && (
              <div className="text-xs font-mono text-emerald-400 tabular-nums">
                {statusNotice}
              </div>
            )}
          </div>

          {errorMessage && (
            <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-200 flex items-center justify-between gap-4">
              <span>{errorMessage}</span>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-300 hover:text-white font-medium whitespace-nowrap shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Main Workspace Container */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 max-w-[1600px] w-full mx-auto">
        {/* Left Navigation & Taxonomy Sidebar (264px width on desktop) */}
        <aside className="w-full lg:w-[264px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800/90 p-5 space-y-6 bg-slate-950">
          {/* Source Page Overview */}
          <div className="space-y-1.5">
            <div className="text-xs text-slate-500 font-mono truncate" title={currentResult.domain}>
              {currentResult.domain}
            </div>
            <h1 className="text-sm font-semibold text-slate-100 line-clamp-2 leading-snug">
              {currentResult.title}
            </h1>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono tabular-nums pt-0.5">
              <span>{currentResult.assets.length} total assets</span>
              <span aria-hidden="true">·</span>
              <span>{currentResult.scanDurationMs}ms scan</span>
            </div>
          </div>

          {/* Asset Category Filters */}
          <div className="space-y-1.5">
            <h2 className="text-xs font-semibold text-slate-400 px-2">Media Taxonomy</h2>
            <div className="space-y-0.5">
              {(
                [
                  { id: 'all', label: 'All Extracted Media', count: categoryCounts.all },
                  { id: 'image', label: 'Raster Images', count: categoryCounts.image },
                  { id: 'vector', label: 'Vectors & Inline SVG', count: categoryCounts.vector },
                  { id: 'meta', label: 'OpenGraph & Meta', count: categoryCounts.meta },
                  { id: 'background', label: 'CSS Backgrounds', count: categoryCounts.background },
                  {
                    id: 'video',
                    label: 'Video Streams',
                    count: categoryCounts.video,
                  },
                  {
                    id: 'audio',
                    label: 'Audio Tracks',
                    count: categoryCounts.audio,
                  },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setCategoryFilter(cat.id);
                    setActiveTab('workspace');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    categoryFilter === cat.id && activeTab === 'workspace'
                      ? 'bg-slate-800/90 text-sky-400'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span className="font-mono tabular-nums text-slate-500">{cat.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution Tier Filter */}
          <div className="space-y-2">
            <h2 className="text-xs font-semibold text-slate-400 px-2">Resolution Scale</h2>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800/80">
              {(
                [
                  { id: 'all', label: 'All Sizes' },
                  { id: 'hd', label: 'HD ≥1000px' },
                  { id: 'medium', label: '300–999px' },
                  { id: 'small', label: 'Icons <300px' },
                ] as const
              ).map((tier) => (
                <button
                  key={tier.id}
                  onClick={() => setSizeFilter(tier.id)}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    sizeFilter === tier.id
                      ? 'bg-slate-800 text-slate-100 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </div>

          {/* File Format Filter */}
          <div className="space-y-2">
            <h2 className="text-xs font-semibold text-slate-400 px-2">File Format</h2>
            <div className="flex flex-wrap gap-1 px-1">
              {availableFormats.map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setFormatFilter(fmt)}
                  className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    formatFilter === fmt
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          {/* Extracted Page Color Palette Swatches */}
          {currentResult.colors && currentResult.colors.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold text-slate-400">Page Palette</h2>
                <span className="text-[11px] font-mono text-slate-500">
                  {copiedColor ? `Copied ${copiedColor}` : 'Click hex'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {currentResult.colors.slice(0, 6).map((hex) => (
                  <button
                    key={hex}
                    onClick={() => {
                      navigator.clipboard.writeText(hex);
                      setCopiedColor(hex);
                      setTimeout(() => setCopiedColor(null), 1500);
                    }}
                    className="flex items-center gap-1.5 p-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors text-left"
                    title={`Copy ${hex}`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-xs shrink-0 border border-white/15"
                      style={{ backgroundColor: hex }}
                    />
                    <span className="text-[11px] font-mono text-slate-300 truncate">{hex}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Central Content Area */}
        <main className="flex-1 min-w-0 flex flex-col bg-slate-950">
          {activeTab === 'workspace' && (
            <>
              {/* Filter, Search, Sort & Batch Toolbar */}
              <div className="p-4 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3 bg-slate-950">
                <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter by filename, alt text, or tag..."
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 focus:border-sky-400 focus:outline-none rounded-lg text-xs text-slate-200 placeholder:text-slate-500"
                    />
                  </div>

                  {/* Sort Selector */}
                  <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5">
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortOption)}
                      aria-label="Sort assets"
                      className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
                    >
                      <option value="resolution-desc" className="bg-slate-900">
                        Resolution: High → Low
                      </option>
                      <option value="size-desc" className="bg-slate-900">
                        File Size: Large → Small
                      </option>
                      <option value="dom-order" className="bg-slate-900">
                        DOM Appearance Order
                      </option>
                      <option value="format" className="bg-slate-900">
                        Format (A → Z)
                      </option>
                    </select>
                  </div>
                </div>

                {/* Right Controls: Batch Selection & View Mode Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAllFiltered}
                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 tabular-nums"
                  >
                    Select Visible ({filteredAssets.length})
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={handleClearSelection}
                      className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      Clear
                    </button>
                  )}

                  <button
                    onClick={handleCopySelectedUrls}
                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy URLs
                  </button>

                  {/* View Switcher */}
                  <div className="flex items-center p-0.5 bg-slate-900 border border-slate-800 rounded-lg">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-1.5 rounded-md transition-colors ${
                        viewMode === 'grid'
                          ? 'bg-slate-800 text-sky-400'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      aria-label="Gallery Grid View"
                      title="Gallery Grid View"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setViewMode('table')}
                      className={`p-1.5 rounded-md transition-colors ${
                        viewMode === 'table'
                          ? 'bg-slate-800 text-sky-400'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      aria-label="Compact Inspector Table View"
                      title="Compact Inspector Table View"
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Loading Skeleton State */}
              {isLoading ? (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40 animate-pulse"
                    >
                      <div className="h-44 bg-slate-800/60" />
                      <div className="p-4 space-y-2">
                        <div className="h-4 bg-slate-800 rounded w-3/4" />
                        <div className="h-3 bg-slate-800/80 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredAssets.length === 0 ? (
                /* Empty State */
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                  <p className="text-sm font-semibold text-slate-200 mb-1">
                    No media assets match the active filter criteria
                  </p>
                  <p className="text-xs text-slate-400 max-w-md mb-4">
                    Try resetting the resolution or format filters, or enter a new webpage URL above to inspect its DOM media tree.
                  </p>
                  <button
                    onClick={() => {
                      setCategoryFilter('all');
                      setSizeFilter('all');
                      setFormatFilter('ALL');
                      setSearchQuery('');
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Reset All Filters
                  </button>
                </div>
              ) : viewMode === 'grid' ? (
                /* Gallery Grid View */
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 overflow-y-auto">
                  {filteredAssets.map((asset) => {
                    const isSelected = selectedIds.has(asset.id);
                    const isInspected = inspectedAssetId === asset.id;

                    return (
                      <div
                        key={asset.id}
                        onClick={() => setInspectedAssetId(asset.id)}
                        className={`group border rounded-xl overflow-hidden transition-colors cursor-pointer flex flex-col bg-slate-900/40 ${
                          isInspected
                            ? 'border-sky-400 bg-slate-900/90'
                            : isSelected
                            ? 'border-sky-500/50 hover:border-sky-400'
                            : 'border-slate-800/90 hover:border-slate-700'
                        }`}
                      >
                        {/* Thumbnail Canvas */}
                        <div className="relative h-44 bg-checkerboard border-b border-slate-800/80 flex items-center justify-center p-3 overflow-hidden">
                          <AssetPreviewThumb
                            asset={asset}
                            onDimensionsResolved={handleDimensionsResolved}
                            className="max-h-full max-w-full object-contain transition-transform duration-150 group-hover:scale-[1.02]"
                          />

                          {/* Selection Checkbox Button */}
                          <button
                            type="button"
                            onClick={(e) => toggleSelectId(asset.id, e)}
                            aria-label={`Select ${asset.filename}`}
                            className="absolute top-2.5 left-2.5 p-1.5 rounded-md bg-slate-950/85 hover:bg-slate-900 text-slate-200 border border-slate-700/80 transition-colors"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-sky-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </button>

                          {/* Direct Single-Click Download */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerSingleDownload(asset);
                            }}
                            aria-label={`Download ${asset.filename}`}
                            title="Download original file"
                            className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-slate-950/85 hover:bg-sky-500 hover:text-slate-950 text-slate-200 border border-slate-700/80 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Unboxed Clean Card Footer (Zero-Pill Compliance) */}
                        <div className="p-3.5 flex-1 flex flex-col justify-between space-y-1.5">
                          <div className="text-xs font-semibold text-slate-100 truncate" title={asset.filename}>
                            {asset.filename}
                          </div>

                          <div className="flex items-center flex-wrap gap-1.5 text-xs font-mono text-slate-400 tabular-nums">
                            <span className="text-sky-400 font-medium">{asset.format}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {asset.width && asset.height
                                ? `${asset.width}×${asset.height}`
                                : 'Probing'}
                            </span>
                            {asset.byteSize ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{formatBytes(asset.byteSize)}</span>
                              </>
                            ) : null}
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-500 truncate">{asset.sourceTag}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* High-Density Inspector Table View */
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 bg-slate-900/60">
                        <th className="py-2.5 px-4 w-10">Select</th>
                        <th className="py-2.5 px-3 w-14">Preview</th>
                        <th className="py-2.5 px-3">Filename & Alt Context</th>
                        <th className="py-2.5 px-3">Source Tag</th>
                        <th className="py-2.5 px-3">Format</th>
                        <th className="py-2.5 px-3 text-right">Dimensions</th>
                        <th className="py-2.5 px-3 text-right">Size</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-xs">
                      {filteredAssets.map((asset) => {
                        const isSelected = selectedIds.has(asset.id);
                        const isInspected = inspectedAssetId === asset.id;

                        return (
                          <tr
                            key={asset.id}
                            onClick={() => setInspectedAssetId(asset.id)}
                            className={`h-11 cursor-pointer transition-colors ${
                              isInspected
                                ? 'bg-sky-950/30'
                                : 'hover:bg-slate-900/70'
                            }`}
                          >
                            <td
                              className="py-2 px-4"
                              onClick={(e) => toggleSelectId(asset.id, e)}
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-sky-400" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-500" />
                              )}
                            </td>
                            <td className="py-1.5 px-3">
                              <div className="w-9 h-7 rounded bg-checkerboard border border-slate-800 overflow-hidden flex items-center justify-center">
                                <AssetPreviewThumb
                                  asset={asset}
                                  onDimensionsResolved={handleDimensionsResolved}
                                  className="max-h-full max-w-full object-contain"
                                />
                              </div>
                            </td>
                            <td className="py-2 px-3 max-w-[260px]">
                              <div className="font-medium text-slate-100 truncate">
                                {asset.filename}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {asset.alt || asset.domContext}
                              </div>
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">
                              {asset.sourceTag}
                            </td>
                            <td className="py-2 px-3 font-mono text-sky-400 font-medium whitespace-nowrap">
                              {asset.format}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-300 text-right tabular-nums whitespace-nowrap">
                              {asset.width && asset.height
                                ? `${asset.width} × ${asset.height}`
                                : '—'}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-300 text-right tabular-nums whitespace-nowrap">
                              {formatBytes(asset.byteSize)}
                            </td>
                            <td
                              className="py-2 px-4 text-right whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => triggerSingleDownload(asset)}
                                className="text-sky-400 hover:text-sky-300 font-medium"
                              >
                                Download
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Batch Queue View */}
          {activeTab === 'queue' && (
            <div className="p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Batch Export & Manifest Queue
                  </h2>
                  <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    {selectedAssets.length} assets queued · Est. uncompressed payload {formatBytes(totalSelectedBytes)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => handleExportManifest('json')}
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <FileJson className="w-3.5 h-3.5 text-sky-400" />
                    Export JSON Manifest
                  </button>
                  <button
                    onClick={() => handleExportManifest('csv')}
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
                    Export CSV Spreadsheet
                  </button>
                  <button
                    onClick={handleExportZip}
                    disabled={selectedAssets.length === 0 || Boolean(zipProgress)}
                    className="px-4 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 tabular-nums"
                  >
                    <FolderArchive className="w-4 h-4" />
                    Download Queue (.ZIP)
                  </button>
                </div>
              </div>

              {selectedAssets.length === 0 ? (
                <div className="py-12 text-center space-y-3 border border-slate-800/80 rounded-xl bg-slate-900/30">
                  <p className="text-sm font-medium text-slate-200">
                    Your batch download queue is currently empty
                  </p>
                  <p className="text-xs text-slate-400">
                    Select individual media items in the Inspector Workspace or queue all discovered assets at once.
                  </p>
                  <button
                    onClick={() => {
                      handleSelectAllFiltered();
                    }}
                    className="px-4 py-2 bg-sky-500 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Queue All {filteredAssets.length} Discovered Assets
                  </button>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80">
                  {selectedAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-900/40 hover:bg-slate-900/80 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-9 rounded bg-checkerboard border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                          <AssetPreviewThumb asset={asset} className="max-h-full max-w-full object-contain" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-100 truncate">
                            {asset.filename}
                          </div>
                          <div className="text-xs font-mono text-slate-400 tabular-nums">
                            {asset.format} · {asset.width && asset.height ? `${asset.width}×${asset.height}px` : 'Stream'} · {formatBytes(asset.byteSize)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => triggerSingleDownload(asset)}
                          className="text-xs text-sky-400 hover:text-sky-300 font-medium whitespace-nowrap"
                        >
                          Download File
                        </button>
                        <button
                          onClick={() => toggleSelectId(asset.id)}
                          className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                          title="Remove from queue"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Dedicated Format Transcoder Tab */}
          {activeTab === 'converter' && (
            <div className="p-6 space-y-6 max-w-3xl">
              <div className="border-b border-slate-800 pb-4">
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  Client-Side Image & Vector Format Transcoder
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Convert any grabbed raster image or inline SVG into WebP, PNG, or JPEG with custom resolution scaling and compression.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Select Extracted Asset
                  </label>
                  <select
                    value={converterAssetId}
                    onChange={(e) => {
                      setConverterAssetId(e.target.value);
                      setConverterOutput(null);
                    }}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-400"
                  >
                    {currentResult.assets
                      .filter((a) => a.category !== 'audio' && a.category !== 'video')
                      .map((a) => (
                        <option key={a.id} value={a.id} className="bg-slate-900">
                          {a.filename} ({a.format} · {a.width || '?'}×{a.height || '?'})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Target Output Format
                  </label>
                  <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg">
                    {(
                      [
                        { label: 'WebP', mime: 'image/webp' },
                        { label: 'PNG', mime: 'image/png' },
                        { label: 'JPEG', mime: 'image/jpeg' },
                      ] as const
                    ).map((fmt) => (
                      <button
                        key={fmt.mime}
                        onClick={() => setConverterMime(fmt.mime)}
                        className={`flex-1 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          converterMime === fmt.mime
                            ? 'bg-sky-500 text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Output Scale Multiplier
                  </label>
                  <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg">
                    {[1, 0.75, 0.5, 0.25].map((s) => (
                      <button
                        key={s}
                        onClick={() => setConverterScale(s)}
                        className={`flex-1 py-1.5 text-xs font-mono tabular-nums rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          converterScale === s
                            ? 'bg-slate-800 text-sky-400 font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {Math.round(s * 100)}%
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-medium text-slate-300">Encoder Quality</span>
                    <span className="font-mono text-sky-400 tabular-nums">
                      {Math.round(converterQuality * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={converterQuality}
                    onChange={(e) => setConverterQuality(parseFloat(e.target.value))}
                    className="w-full accent-sky-400 cursor-pointer mt-2"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={runDedicatedConverter}
                  disabled={isTranscodingTab}
                  className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {isTranscodingTab ? 'Rendering Canvas...' : 'Transcode Selected Asset'}
                </button>

                {converterOutput && (
                  <button
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = converterOutput.dataUrl;
                      a.download = `transcoded-${converterOutput.width}x${converterOutput.height}.${converterOutput.extension}`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 tabular-nums"
                  >
                    <Download className="w-4 h-4" />
                    Download .{converterOutput.extension.toUpperCase()} ({converterOutput.width}×{converterOutput.height} · {formatBytes(converterOutput.byteSize)})
                  </button>
                )}
              </div>

              {converterOutput && (
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-checkerboard p-4 flex flex-col items-center">
                  <img
                    src={converterOutput.dataUrl}
                    alt="Transcoded output preview"
                    className="max-h-80 object-contain rounded"
                  />
                </div>
              )}
            </div>
          )}

          {/* Extraction History Tab */}
          {activeTab === 'history' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-400" />
                    Recent URL Extractions
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Reload any previously inspected webpage snapshot or re-scrape live.
                  </p>
                </div>
                {history.length > 1 && (
                  <button
                    onClick={() => setHistory([SAMPLE_EXTRACTION_PRESETS[0]])}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-400 hover:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Clear History
                  </button>
                )}
              </div>

              <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                {history.map((item, idx) => (
                  <div
                    key={`${item.url}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-900/40 hover:bg-slate-900/80 transition-colors"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-semibold text-slate-100 truncate">
                        {item.title}
                      </div>
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-400 tabular-nums">
                        <span className="text-sky-400 truncate max-w-md">{item.url}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.assets.length} assets</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.scanDurationMs}ms</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        onClick={() => {
                          setCurrentResult(item);
                          setUrlInput(item.url);
                          setSelectedIds(new Set(item.assets.slice(0, 4).map((a) => a.id)));
                          setInspectedAssetId(item.assets[0]?.id || null);
                          setActiveTab('workspace');
                        }}
                        className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        Open Snapshot
                      </button>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800 rounded-lg"
                        title="Open source URL in new tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Right Precision Asset Inspector Drawer */}
        {activeTab === 'workspace' && inspectedAsset && (
          <AssetInspectorDrawer
            asset={inspectedAsset}
            onClose={() => setInspectedAssetId(null)}
            onDimensionsResolved={handleDimensionsResolved}
          />
        )}
      </div>
    </div>
  );
}
