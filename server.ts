import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ExtractedVariant {
  url: string;
  descriptor: string;
  width?: number;
}

export interface ExtractedAsset {
  id: string;
  url: string;
  filename: string;
  category: 'image' | 'vector' | 'video' | 'audio' | 'meta' | 'background';
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

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function inferFormatFromUrlOrMime(urlStr: string, mime?: string): string {
  if (mime) {
    const m = mime.toLowerCase();
    if (m.includes('svg')) return 'SVG';
    if (m.includes('webp')) return 'WEBP';
    if (m.includes('avif')) return 'AVIF';
    if (m.includes('png')) return 'PNG';
    if (m.includes('jpeg') || m.includes('jpg')) return 'JPG';
    if (m.includes('gif')) return 'GIF';
    if (m.includes('icon') || m.includes('ico')) return 'ICO';
    if (m.includes('mp4')) return 'MP4';
    if (m.includes('webm')) return 'WEBM';
    if (m.includes('mpegurl') || m.includes('m3u8')) return 'HLS';
    if (m.includes('mpeg') || m.includes('mp3')) return 'MP3';
    if (m.includes('wav')) return 'WAV';
    if (m.includes('ogg')) return 'OGG';
  }
  if (urlStr.startsWith('data:image/svg')) return 'SVG';
  if (urlStr.startsWith('data:image/png')) return 'PNG';
  if (urlStr.startsWith('data:image/jpeg')) return 'JPG';
  if (urlStr.startsWith('data:image/webp')) return 'WEBP';

  try {
    const parsed = new URL(urlStr, 'https://example.com');
    const extMatch = parsed.pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (extMatch) {
      const ext = extMatch[1].toUpperCase();
      if (ext === 'JPEG') return 'JPG';
      return ext;
    }
    const formatParam =
      parsed.searchParams.get('fm') ||
      parsed.searchParams.get('format') ||
      parsed.searchParams.get('ext');
    if (formatParam) {
      const clean = formatParam.toUpperCase();
      return clean === 'JPEG' ? 'JPG' : clean;
    }
  } catch {
    // ignore URL parse error
  }
  return 'IMG';
}

function extractFilename(urlStr: string, fallbackPrefix = 'asset', index = 1, format = 'jpg'): string {
  if (urlStr.startsWith('data:')) {
    return `${fallbackPrefix}-${index}.${format.toLowerCase()}`;
  }
  try {
    const parsed = new URL(urlStr);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && last.length > 1 && last.length < 96) {
      const decoded = decodeURIComponent(last).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (decoded.includes('.')) return decoded;
      return `${decoded}.${format.toLowerCase()}`;
    }
  } catch {
    // ignore
  }
  return `${fallbackPrefix}-${index}.${format.toLowerCase()}`;
}

function parseSrcset(srcsetRaw: string, baseUrl: string): ExtractedVariant[] {
  const variants: ExtractedVariant[] = [];
  const parts = srcsetRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const rawUrl = tokens[0];
    const descriptor = tokens[1] || '1x';
    if (!rawUrl || rawUrl.startsWith('data:')) continue;
    try {
      const resolved = new URL(rawUrl, baseUrl).href;
      let width: number | undefined;
      if (descriptor.endsWith('w')) {
        const w = parseInt(descriptor.slice(0, -1), 10);
        if (!isNaN(w)) width = w;
      } else if (descriptor.endsWith('x')) {
        const x = parseFloat(descriptor.slice(0, -1));
        if (!isNaN(x)) width = Math.round(x * 800);
      }
      variants.push({ url: resolved, descriptor, width });
    } catch {
      // skip invalid URL
    }
  }

  return variants.sort((a, b) => (b.width || 0) - (a.width || 0));
}

function extractCssUrls(cssText: string, baseUrl: string): string[] {
  const results: string[] = [];
  const regex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cssText)) !== null) {
    const candidate = match[2]?.trim();
    if (!candidate || candidate.startsWith('data:font') || candidate.startsWith('#')) continue;
    // Skip font files
    if (/\.(woff2?|ttf|eot|otf)(\?|$)/i.test(candidate)) continue;
    try {
      const resolved = new URL(candidate, baseUrl).href;
      results.push(resolved);
    } catch {
      // ignore
    }
  }
  return results;
}

function extractHexColors(text: string): string[] {
  const matches = text.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) || [];
  const normalized = new Set<string>();
  for (const raw of matches) {
    let hex = raw.toUpperCase();
    if (hex.length === 4) {
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    if (!['#FFFFFF', '#000000', '#FFF', '#000'].includes(hex)) {
      normalized.add(hex);
    }
    if (normalized.size >= 10) break;
  }
  return Array.from(normalized);
}

function computeAspectRatio(w?: number, h?: number): string | undefined {
  if (!w || !h || w <= 0 || h <= 0) return undefined;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(Math.round(w), Math.round(h));
  const rw = Math.round(w / divisor);
  const rh = Math.round(h / divisor);
  if (rw > 40 || rh > 40) {
    return `${(w / h).toFixed(2)}:1`;
  }
  return `${rw}:${rh}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '4mb' }));

  // Media Proxy endpoint for CORS-free inspection, Canvas format conversion, and binary ZIP download
  app.get('/api/proxy', async (req, res) => {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const filename = typeof req.query.filename === 'string' ? req.query.filename : 'asset';
    const isDownload = req.query.download === '1';

    if (!targetUrl) {
      res.status(400).json({ error: 'Missing url parameter' });
      return;
    }

    try {
      const parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported' });
        return;
      }

      let upstream = await fetch(parsed.href, {
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,audio/*,*/*;q=0.8',
          Referer: `${parsed.protocol}//${parsed.host}/`,
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'cross-site',
        },
        signal: AbortSignal.timeout(12000),
      });

      // Fallback to global image cache proxy if origin blocks hotlinking/datacenter IPs with 403/429
      if (!upstream.ok && [401, 403, 429, 503].includes(upstream.status)) {
        const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(parsed.href)}`;
        const fallbackResp = await fetch(weservUrl, {
          headers: { 'User-Agent': BROWSER_USER_AGENT },
          signal: AbortSignal.timeout(12000),
        });
        if (fallbackResp.ok) {
          upstream = fallbackResp;
        }
      }

      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Upstream responded with ${upstream.status}` });
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await upstream.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length.toString());
      res.setHeader('Cache-Control', 'public, max-age=3600');

      if (isDownload) {
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      }

      res.send(buffer);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Proxy request failed';
      res.status(502).json({ error: message });
    }
  });

  // Main URL Media & Image Extractor Endpoint
  app.post('/api/extract', async (req, res) => {
    const startTime = Date.now();
    let rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const deepScan = Boolean(req.body?.deepScan);

    if (!rawUrl) {
      res.status(400).json({ error: 'Please enter a valid webpage or media URL.' });
      return;
    }

    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(rawUrl);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      res.status(400).json({ error: 'Malformed URL. Example: https://en.wikipedia.org/wiki/Architecture' });
      return;
    }

    try {
      let finalUrl = targetUrl.href;
      let contentType = '';
      let contentLengthHeader: string | null = null;
      let html = '';

      // Stage 1: Direct Fetch with full modern browser navigation headers
      let directOk = false;
      let lastStatus = 0;
      let lastStatusText = '';

      try {
        const response = await fetch(targetUrl.href, {
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"macOS"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        });

        lastStatus = response.status;
        lastStatusText = response.statusText || 'Error';

        if (response.ok) {
          finalUrl = response.url || targetUrl.href;
          contentType = (response.headers.get('content-type') || '').toLowerCase();
          contentLengthHeader = response.headers.get('content-length');

          if (
            contentType.startsWith('image/') ||
            contentType.startsWith('video/') ||
            contentType.startsWith('audio/')
          ) {
            directOk = true;
          } else {
            const bodyText = await response.text();
            const isCloudflareChallenge =
              bodyText.includes('cf-browser-verification') ||
              bodyText.includes('<title>Just a moment...</title>');
            if (!isCloudflareChallenge && bodyText.length > 100) {
              html = bodyText;
              directOk = true;
            }
          }
        }
      } catch {
        // Proceed to Stage 2 headless reader fallback
      }

      // Stage 2: Anti-403 / WAF Headless Reader Fallback (r.jina.ai HTML DOM render)
      if (!directOk) {
        try {
          const jinaResp = await fetch(`https://r.jina.ai/${targetUrl.href}`, {
            headers: {
              'X-Return-Format': 'html',
              'User-Agent': BROWSER_USER_AGENT,
              Accept: 'text/html,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(14000),
          });
          if (jinaResp.ok) {
            const renderedHtml = await jinaResp.text();
            if (renderedHtml && renderedHtml.length > 100) {
              html = renderedHtml;
              contentType = 'text/html; charset=utf-8';
              directOk = true;
            }
          }
        } catch {
          // Proceed to Stage 3 fallback
        }
      }

      // Stage 3: AllOrigins Raw Proxy Fallback
      if (!directOk) {
        try {
          const aoResp = await fetch(
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl.href)}`,
            {
              headers: { 'User-Agent': BROWSER_USER_AGENT },
              signal: AbortSignal.timeout(10000),
            }
          );
          if (aoResp.ok) {
            const aoHtml = await aoResp.text();
            if (aoHtml && aoHtml.length > 100) {
              html = aoHtml;
              contentType = 'text/html; charset=utf-8';
              directOk = true;
            }
          }
        } catch {
          // All stages exhausted
        }
      }

      if (!directOk) {
        res.status(422).json({
          error: `Target URL returned HTTP ${lastStatus || 403} (${
            lastStatusText || 'Forbidden'
          }) and blocked automated proxy inspection.`,
        });
        return;
      }

      const finalParsed = new URL(finalUrl);

      // Handle direct link to an image, video, or audio file
      if (
        contentType.startsWith('image/') ||
        contentType.startsWith('video/') ||
        contentType.startsWith('audio/')
      ) {
        const format = inferFormatFromUrlOrMime(finalUrl, contentType);
        const category: ExtractedAsset['category'] = contentType.startsWith('video/')
          ? 'video'
          : contentType.startsWith('audio/')
          ? 'audio'
          : format === 'SVG'
          ? 'vector'
          : 'image';

        const singleAsset: ExtractedAsset = {
          id: 'direct-1',
          url: finalUrl,
          filename: extractFilename(finalUrl, 'direct-media', 1, format),
          category,
          format,
          mimeType: contentType.split(';')[0],
          byteSize: contentLengthHeader ? parseInt(contentLengthHeader, 10) : undefined,
          alt: 'Direct media link',
          sourceTag: 'Direct URL',
          domContext: 'HTTP Stream',
          isExternal: true,
        };

        res.json({
          url: finalUrl,
          domain: finalParsed.hostname,
          title: singleAsset.filename,
          description: `Direct ${format} media resource hosted on ${finalParsed.hostname}`,
          favicon: `${finalParsed.origin}/favicon.ico`,
          colors: ['#0EA5E9', '#38BDF8', '#0284C7'],
          scanDurationMs: Date.now() - startTime,
          assets: [singleAsset],
        });
        return;
      }

      const $ = cheerio.load(html);

      const pageTitle =
        $('meta[property="og:title"]').attr('content')?.trim() ||
        $('title').first().text().trim() ||
        finalParsed.hostname;

      const pageDescription =
        $('meta[property="og:description"]').attr('content')?.trim() ||
        $('meta[name="description"]').attr('content')?.trim() ||
        `Extracted media and visual assets from ${finalParsed.hostname}`;

      const rawFavicon =
        $('link[rel="icon"]').attr('href') ||
        $('link[rel="shortcut icon"]').attr('href') ||
        $('link[rel="apple-touch-icon"]').attr('href') ||
        '/favicon.ico';

      let favicon = `${finalParsed.origin}/favicon.ico`;
      try {
        favicon = new URL(rawFavicon, finalUrl).href;
      } catch {
        // fallback
      }

      const assetMap = new Map<string, ExtractedAsset>();
      let counter = 0;

      const registerAsset = (
        rawAssetUrl: string,
        opts: {
          category: ExtractedAsset['category'];
          sourceTag: string;
          domContext: string;
          alt?: string;
          width?: number;
          height?: number;
          variants?: ExtractedVariant[];
          svgCode?: string;
          posterUrl?: string;
          mimeType?: string;
          byteSize?: number;
        }
      ) => {
        if (!rawAssetUrl) return;
        const trimmed = rawAssetUrl.trim();
        if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('about:')) return;

        let resolvedUrl = trimmed;
        if (!trimmed.startsWith('data:')) {
          try {
            resolvedUrl = new URL(trimmed, finalUrl).href;
          } catch {
            return;
          }
        }

        const existing = assetMap.get(resolvedUrl);
        if (existing) {
          if (!existing.alt && opts.alt) existing.alt = opts.alt;
          if (!existing.width && opts.width) existing.width = opts.width;
          if (!existing.height && opts.height) existing.height = opts.height;
          if (opts.variants && opts.variants.length > (existing.variants?.length || 0)) {
            existing.variants = opts.variants;
          }
          if (!existing.domContext.includes(opts.domContext)) {
            existing.domContext = `${existing.domContext} · ${opts.domContext}`;
          }
          return;
        }

        counter += 1;
        const format = inferFormatFromUrlOrMime(resolvedUrl, opts.mimeType);
        const category = format === 'SVG' && opts.category === 'image' ? 'vector' : opts.category;
        const filename = extractFilename(resolvedUrl, category, counter, format);

        assetMap.set(resolvedUrl, {
          id: `ext-${counter}`,
          url: resolvedUrl,
          filename,
          category,
          format,
          mimeType: opts.mimeType,
          width: opts.width,
          height: opts.height,
          aspectRatio: computeAspectRatio(opts.width, opts.height),
          byteSize: opts.byteSize,
          alt: opts.alt,
          sourceTag: opts.sourceTag,
          domContext: opts.domContext,
          variants: opts.variants,
          svgCode: opts.svgCode,
          posterUrl: opts.posterUrl,
          isExternal: !resolvedUrl.startsWith('data:'),
        });
      };

      // 1. OpenGraph, Twitter Card, Apple Touch Icon & Link Rel Meta Assets
      const metaSelectors: Array<{ sel: string; attr: string; label: string; cat: ExtractedAsset['category'] }> = [
        { sel: 'meta[property="og:image"]', attr: 'content', label: 'og:image', cat: 'meta' },
        { sel: 'meta[property="og:image:secure_url"]', attr: 'content', label: 'og:image:secure', cat: 'meta' },
        { sel: 'meta[name="twitter:image"]', attr: 'content', label: 'twitter:image', cat: 'meta' },
        { sel: 'meta[property="twitter:image"]', attr: 'content', label: 'twitter:image', cat: 'meta' },
        { sel: 'meta[property="og:video"]', attr: 'content', label: 'og:video', cat: 'video' },
        { sel: 'meta[property="og:audio"]', attr: 'content', label: 'og:audio', cat: 'audio' },
        { sel: 'link[rel="apple-touch-icon"]', attr: 'href', label: 'apple-touch-icon', cat: 'meta' },
        { sel: 'link[rel="icon"]', attr: 'href', label: 'link[rel=icon]', cat: 'meta' },
        { sel: 'link[rel="image_src"]', attr: 'href', label: 'link[rel=image_src]', cat: 'meta' },
      ];

      for (const item of metaSelectors) {
        $(item.sel).each((_, el) => {
          const val = $(el).attr(item.attr);
          if (val) {
            const ogWidth = parseInt($('meta[property="og:image:width"]').attr('content') || '', 10);
            const ogHeight = parseInt($('meta[property="og:image:height"]').attr('content') || '', 10);
            const tagName = ($(el).prop('tagName') || 'meta').toString().toLowerCase();
            registerAsset(val, {
              category: item.cat,
              sourceTag: `<${tagName}>`,
              domContext: item.label,
              alt: `${pageTitle} (${item.label})`,
              width: item.label.startsWith('og:image') && !isNaN(ogWidth) ? ogWidth : undefined,
              height: item.label.startsWith('og:image') && !isNaN(ogHeight) ? ogHeight : undefined,
            });
          }
        });
      }

      // 2. Picture & Img Elements (with full srcset, lazy-loading & high-res thumbnail unwrapping)
      $('img').each((idx, el) => {
        const $el = $(el);
        const rawSrc =
          $el.attr('src') ||
          $el.attr('data-src') ||
          $el.attr('data-lazy-src') ||
          $el.attr('data-original') ||
          '';
        const rawSrcset = $el.attr('srcset') || $el.attr('data-srcset') || '';

        const variants: ExtractedVariant[] = [];
        if (rawSrcset) {
          variants.push(...parseSrcset(rawSrcset, finalUrl));
        }

        // Also check parent <picture> <source> tags
        const $picture = $el.closest('picture');
        if ($picture.length > 0) {
          $picture.find('source').each((_, sourceEl) => {
            const sSet = $(sourceEl).attr('srcset') || $(sourceEl).attr('data-srcset');
            if (sSet) {
              variants.push(...parseSrcset(sSet, finalUrl));
            }
          });
        }

        let primaryUrl = variants.length > 0 ? variants[0].url : rawSrc;
        if (!primaryUrl) return;

        // Resolve relative URLs before checking high-res thumbnail patterns
        if (!primaryUrl.startsWith('data:')) {
          try {
            primaryUrl = new URL(primaryUrl, finalUrl).href;
          } catch {
            return;
          }
        }

        // Unwrap common gallery thumbnail suffixes (e.g. _300px.jpg -> .jpg full-res original)
        const thumbSuffixMatch = primaryUrl.match(/^(.*)_(\d+)px(\.(?:jpe?g|png|webp))(\?.*)?$/i);
        if (thumbSuffixMatch) {
          const fullResUrl = `${thumbSuffixMatch[1]}${thumbSuffixMatch[3]}${thumbSuffixMatch[4] || ''}`;
          const thumbWidth = parseInt(thumbSuffixMatch[2], 10) || 300;
          variants.unshift(
            { url: fullResUrl, descriptor: 'Full-Res Original', width: 1200 },
            { url: primaryUrl, descriptor: `${thumbWidth}px Thumbnail`, width: thumbWidth }
          );
          primaryUrl = fullResUrl;
        }

        const wAttr = parseInt($el.attr('width') || '', 10);
        const hAttr = parseInt($el.attr('height') || '', 10);
        const bestVariantWidth = variants[0]?.width;

        const width = !isNaN(wAttr) && wAttr > 0 ? wAttr : bestVariantWidth;
        const height = !isNaN(hAttr) && hAttr > 0 ? hAttr : undefined;
        const alt = $el.attr('alt')?.trim() || $el.attr('title')?.trim() || `Image #${idx + 1}`;

        const parentTag =
          $picture.length > 0
            ? '<picture>'
            : `<${($el.parent().prop('tagName') || 'div').toString().toLowerCase()}>`;

        registerAsset(primaryUrl, {
          category: 'image',
          sourceTag: '<img>',
          domContext: variants.length > 0 ? `${parentTag} · ${variants.length} variants` : parentTag,
          alt,
          width,
          height,
          variants: variants.length > 1 ? variants : undefined,
        });
      });

      // Standalone <source> inside <picture> if not already captured
      $('picture source').each((_, el) => {
        const sSet = $(el).attr('srcset');
        const mime = $(el).attr('type');
        if (sSet) {
          const parsed = parseSrcset(sSet, finalUrl);
          if (parsed.length > 0) {
            registerAsset(parsed[0].url, {
              category: 'image',
              sourceTag: '<source>',
              domContext: '<picture> source',
              width: parsed[0].width,
              mimeType: mime,
              variants: parsed.length > 1 ? parsed : undefined,
            });
          }
        }
      });

      // 3. Inline <svg> Vector Elements
      $('svg').each((idx, el) => {
        if (idx >= 40) return; // Cap inline SVGs to avoid hundreds of tiny icons
        const $svg = $(el);
        const clone = $svg.clone();
        if (!clone.attr('xmlns')) {
          clone.attr('xmlns', 'http://www.w3.org/2000/svg');
        }
        const outerHtml = $.html(clone).trim();
        if (outerHtml.length < 45 || outerHtml.length > 150000) return;

        let width = parseInt($svg.attr('width') || '', 10);
        let height = parseInt($svg.attr('height') || '', 10);
        const viewBox = $svg.attr('viewBox');
        if ((isNaN(width) || isNaN(height)) && viewBox) {
          const parts = viewBox.trim().split(/[\s,]+/).map(Number);
          if (parts.length === 4 && !isNaN(parts[2]) && !isNaN(parts[3])) {
            width = Math.round(parts[2]);
            height = Math.round(parts[3]);
          }
        }

        // Skip tiny 1x1 tracking or empty decorative chevrons under 100 bytes unless they have an aria-label/title
        const label =
          $svg.attr('aria-label') ||
          $svg.find('title').first().text().trim() ||
          $svg.attr('id') ||
          `Inline Vector #${idx + 1}`;

        const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(outerHtml)}`;
        registerAsset(dataUri, {
          category: 'vector',
          sourceTag: '<svg>',
          domContext: viewBox ? `Inline SVG · viewBox ${viewBox}` : 'Inline SVG',
          alt: label,
          width: !isNaN(width) && width > 0 ? width : 24,
          height: !isNaN(height) && height > 0 ? height : 24,
          svgCode: outerHtml,
          mimeType: 'image/svg+xml',
          byteSize: Buffer.byteLength(outerHtml, 'utf8'),
        });
      });

      // 4. Video & Audio Streams (<video>, <audio>, <source>, and YouTube/Vimeo embeds)
      $('video').each((idx, el) => {
        const $v = $(el);
        const poster = $v.attr('poster');
        let resolvedPoster: string | undefined;
        if (poster) {
          try {
            resolvedPoster = new URL(poster, finalUrl).href;
            registerAsset(resolvedPoster, {
              category: 'image',
              sourceTag: '<video poster>',
              domContext: 'Video Poster Frame',
              alt: `Video Poster #${idx + 1}`,
            });
          } catch {
            // ignore
          }
        }

        const vSrc = $v.attr('src');
        if (vSrc) {
          registerAsset(vSrc, {
            category: 'video',
            sourceTag: '<video>',
            domContext: 'HTML5 Video Stream',
            alt: $v.attr('title') || `Video Stream #${idx + 1}`,
            posterUrl: resolvedPoster,
          });
        }

        $v.find('source').each((_, sEl) => {
          const sSrc = $(sEl).attr('src');
          const sType = $(sEl).attr('type');
          if (sSrc) {
            registerAsset(sSrc, {
              category: 'video',
              sourceTag: '<video><source>',
              domContext: sType || 'Video Source',
              alt: `Video Stream #${idx + 1}`,
              mimeType: sType,
              posterUrl: resolvedPoster,
            });
          }
        });
      });

      $('audio').each((idx, el) => {
        const $a = $(el);
        const aSrc = $a.attr('src');
        if (aSrc) {
          registerAsset(aSrc, {
            category: 'audio',
            sourceTag: '<audio>',
            domContext: 'HTML5 Audio Stream',
            alt: $a.attr('title') || `Audio Track #${idx + 1}`,
          });
        }
        $a.find('source').each((_, sEl) => {
          const sSrc = $(sEl).attr('src');
          const sType = $(sEl).attr('type');
          if (sSrc) {
            registerAsset(sSrc, {
              category: 'audio',
              sourceTag: '<audio><source>',
              domContext: sType || 'Audio Source',
              alt: `Audio Track #${idx + 1}`,
              mimeType: sType,
            });
          }
        });
      });

      // Inspect iframes for YouTube / Vimeo embeds and grab their high-res poster thumbnails
      $('iframe').each((idx, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        const ytMatch = src.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) {
          const videoId = ytMatch[1];
          const maxResThumb = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
          registerAsset(maxResThumb, {
            category: 'meta',
            sourceTag: '<iframe>',
            domContext: `YouTube Embed (${videoId})`,
            alt: $(el).attr('title') || `YouTube Thumbnail (${videoId})`,
            width: 1280,
            height: 720,
          });
        }
      });

      // Direct media links in <a href="...">
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (/\.(mp4|webm|m3u8|mov)(\?|$)/i.test(href)) {
          registerAsset(href, {
            category: 'video',
            sourceTag: '<a href>',
            domContext: 'Direct Video Link',
            alt: $(el).text().trim() || 'Linked Video File',
          });
        } else if (/\.(mp3|wav|ogg|flac|m4a)(\?|$)/i.test(href)) {
          registerAsset(href, {
            category: 'audio',
            sourceTag: '<a href>',
            domContext: 'Direct Audio Link',
            alt: $(el).text().trim() || 'Linked Audio File',
          });
        } else if (/\.(jpg|jpeg|png|webp|avif|gif|svg)(\?|$)/i.test(href)) {
          registerAsset(href, {
            category: 'image',
            sourceTag: '<a href>',
            domContext: 'Linked High-Res Image',
            alt: $(el).text().trim() || 'Linked Image File',
          });
        }
      });

      // 5. Inline Style & <style> Tag CSS Background Images
      const allStyleTexts: string[] = [];
      $('[style*="url("]').each((_, el) => {
        const st = $(el).attr('style') || '';
        allStyleTexts.push(st);
        const urls = extractCssUrls(st, finalUrl);
        const tagName = ($(el).prop('tagName') || 'div').toString().toLowerCase();
        for (const u of urls) {
          registerAsset(u, {
            category: 'background',
            sourceTag: 'style=""',
            domContext: `Inline CSS <${tagName}>`,
            alt: 'CSS Background Image',
          });
        }
      });

      $('style').each((_, el) => {
        const cssText = $(el).html() || '';
        allStyleTexts.push(cssText);
        const urls = extractCssUrls(cssText, finalUrl);
        for (const u of urls) {
          registerAsset(u, {
            category: 'background',
            sourceTag: '<style>',
            domContext: 'Embedded Stylesheet',
            alt: 'Stylesheet Background Asset',
          });
        }
      });

      // Optional Deep Scan: Fetch up to 3 external CSS stylesheets to extract background images
      if (deepScan) {
        const stylesheetLinks: string[] = [];
        $('link[rel="stylesheet"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href && stylesheetLinks.length < 3) {
            try {
              stylesheetLinks.push(new URL(href, finalUrl).href);
            } catch {
              // ignore
            }
          }
        });

        await Promise.allSettled(
          stylesheetLinks.map(async (cssUrl) => {
            const cssResp = await fetch(cssUrl, {
              headers: { 'User-Agent': BROWSER_USER_AGENT },
              signal: AbortSignal.timeout(4000),
            });
            if (cssResp.ok) {
              const cssContent = await cssResp.text();
              allStyleTexts.push(cssContent.slice(0, 20000));
              const urls = extractCssUrls(cssContent, cssUrl);
              for (const u of urls.slice(0, 25)) {
                registerAsset(u, {
                  category: 'background',
                  sourceTag: 'link[rel=stylesheet]',
                  domContext: 'External CSS url()',
                  alt: 'External Stylesheet Asset',
                });
              }
            }
          })
        );
      }

      // 6. JSON-LD Structured Data Images
      $('script[type="application/ld+json"]').each((_, el) => {
        const rawJson = $(el).html();
        if (!rawJson) return;
        try {
          const parsed = JSON.parse(rawJson);
          const walk = (node: unknown) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
              node.forEach(walk);
              return;
            }
            const rec = node as Record<string, unknown>;
            for (const key of ['image', 'thumbnailUrl', 'contentUrl', 'logo']) {
              const val = rec[key];
              if (typeof val === 'string' && /^https?:\/\//i.test(val)) {
                registerAsset(val, {
                  category: 'meta',
                  sourceTag: 'JSON-LD',
                  domContext: `Schema.org ${key}`,
                  alt: `Structured Data (${key})`,
                });
              } else if (Array.isArray(val)) {
                for (const item of val) {
                  if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
                    registerAsset(item, {
                      category: 'meta',
                      sourceTag: 'JSON-LD',
                      domContext: `Schema.org ${key}`,
                      alt: `Structured Data (${key})`,
                    });
                  }
                }
              }
            }
            Object.values(rec).forEach(walk);
          };
          walk(parsed);
        } catch {
          // ignore malformed JSON-LD
        }
      });

      const assets = Array.from(assetMap.values());

      // Probe top 20 external assets with a fast HEAD request to enrich byteSize & MIME type
      const probeTargets = assets.filter((a) => a.isExternal && !a.byteSize).slice(0, 20);
      await Promise.allSettled(
        probeTargets.map(async (asset) => {
          const headResp = await fetch(asset.url, {
            method: 'HEAD',
            headers: {
              'User-Agent': BROWSER_USER_AGENT,
              Referer: `${finalParsed.protocol}//${finalParsed.host}/`,
            },
            signal: AbortSignal.timeout(2500),
          });
          if (headResp.ok) {
            const len = headResp.headers.get('content-length');
            const cType = headResp.headers.get('content-type');
            if (len && !isNaN(parseInt(len, 10))) {
              asset.byteSize = parseInt(len, 10);
            }
            if (cType) {
              asset.mimeType = cType.split(';')[0].trim();
              const refinedFormat = inferFormatFromUrlOrMime(asset.url, asset.mimeType);
              if (refinedFormat !== 'IMG') {
                asset.format = refinedFormat;
              }
            }
          }
        })
      );

      const themeColor = $('meta[name="theme-color"]').attr('content')?.trim();
      const extractedColors = extractHexColors(
        `${themeColor || ''} ${allStyleTexts.join(' ').slice(0, 40000)}`
      );
      if (extractedColors.length === 0) {
        extractedColors.push('#0EA5E9', '#1E293B', '#334155', '#64748B');
      }

      res.json({
        url: finalUrl,
        domain: finalParsed.hostname,
        title: pageTitle,
        description: pageDescription,
        favicon,
        colors: extractedColors,
        scanDurationMs: Date.now() - startTime,
        assets,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to reach or parse the requested URL.';
      res.status(500).json({
        error: `Extraction failed: ${message}`,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LoomExtract server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
