import { ExtractionResult } from '../types';

const COMPASS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240" fill="none">
  <rect width="240" height="240" rx="24" fill="#0F172A"/>
  <circle cx="120" cy="120" r="88" stroke="#38BDF8" stroke-width="1.5" stroke-dasharray="4 4"/>
  <circle cx="120" cy="120" r="64" stroke="#94A3B8" stroke-width="1.2"/>
  <path d="M120 20V220M20 120H220" stroke="#334155" stroke-width="1"/>
  <polygon points="120,44 134,120 120,106 106,120" fill="#38BDF8"/>
  <polygon points="120,196 134,120 120,134 106,120" fill="#475569"/>
  <circle cx="120" cy="120" r="6" fill="#F8FAFC"/>
</svg>`;

const WAVEFORM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" width="320" height="160" fill="none">
  <rect width="320" height="160" rx="16" fill="#090D16"/>
  <path d="M16 80 H304" stroke="#1E293B" stroke-width="1"/>
  <path d="M24 80 Q 44 20, 64 80 T 104 80 T 144 80 T 184 80 T 224 80 T 264 80 T 304 80" stroke="#38BDF8" stroke-width="2.5" fill="none"/>
  <path d="M24 80 Q 44 45, 64 80 T 104 80 T 144 80 T 184 80 T 224 80 T 264 80 T 304 80" stroke="#818CF8" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/>
  <circle cx="64" cy="80" r="4" fill="#38BDF8"/>
  <circle cx="144" cy="80" r="4" fill="#38BDF8"/>
  <circle cx="224" cy="80" r="4" fill="#38BDF8"/>
</svg>`;

const ESCAPEMENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240" fill="none">
  <rect width="240" height="240" rx="24" fill="#111827"/>
  <circle cx="120" cy="120" r="76" stroke="#E2E8F0" stroke-width="2"/>
  <circle cx="120" cy="120" r="52" stroke="#64748B" stroke-width="1.5" stroke-dasharray="6 4"/>
  <circle cx="120" cy="120" r="18" stroke="#38BDF8" stroke-width="2"/>
  <line x1="120" y1="44" x2="120" y2="120" stroke="#38BDF8" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="120" y1="120" x2="168" y2="148" stroke="#F8FAFC" stroke-width="2" stroke-linecap="round"/>
  <circle cx="120" cy="120" r="4" fill="#0EA5E9"/>
</svg>`;

// Generate a valid minimal WAV audio Data URI (warm A440 + E660 harmonic chime) so the sample audio asset plays and downloads cleanly
function createSampleWavDataUri(): string {
  const sampleRate = 8000;
  const durationSeconds = 2.0;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 1.8) * Math.min(1, t * 25);
    const wave =
      0.55 * Math.sin(2 * Math.PI * 440 * t) +
      0.3 * Math.sin(2 * Math.PI * 659.25 * t) +
      0.15 * Math.sin(2 * Math.PI * 880 * t);
    const sample = Math.max(-1, Math.min(1, wave * envelope * 0.6));
    view.setInt16(44 + i * 2, sample * 32767, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const SAMPLE_AUDIO_URI = createSampleWavDataUri();

export const SAMPLE_EXTRACTION_PRESETS: ExtractionResult[] = [
  {
    url: 'https://kurokawa-architects.jp/monograph/twilight-pavilion',
    domain: 'kurokawa-architects.jp',
    title: 'Kurokawa Studio — Brutalist Concrete & Glass Pavilion Monograph',
    description:
      'Architectural study and high-resolution photographic archive of the Karuizawa Reflective Water Pavilion and Botanical Conservatory.',
    favicon: `data:image/svg+xml;utf8,${encodeURIComponent(COMPASS_SVG)}`,
    colors: ['#0F172A', '#1E293B', '#38BDF8', '#D97706', '#64748B', '#94A3B8'],
    scanDurationMs: 312,
    isPreset: true,
    assets: [
      {
        id: 'preset-arch-1',
        url: '/src/assets/images/sample_arch_pavilion_1794211816715.jpg',
        filename: 'karuizawa-pavilion-twilight-hero.jpg',
        category: 'image',
        format: 'JPG',
        mimeType: 'image/jpeg',
        width: 1408,
        height: 768,
        aspectRatio: '11:6',
        byteSize: 384290,
        alt: 'Minimalist brutalist concrete and glass pavilion beside a reflective pool at twilight',
        sourceTag: '<picture>',
        domContext: '<picture> · srcset (3x)',
        variants: [
          {
            url: '/src/assets/images/sample_arch_pavilion_1794211816715.jpg',
            descriptor: '2400w (2x Retina)',
            width: 2400,
          },
          {
            url: '/src/assets/images/sample_arch_pavilion_1794211816715.jpg',
            descriptor: '1408w (1x Desktop)',
            width: 1408,
          },
          {
            url: '/src/assets/images/sample_arch_pavilion_1794211816715.jpg',
            descriptor: '768w (Mobile)',
            width: 768,
          },
        ],
        isExternal: false,
      },
      {
        id: 'preset-arch-2',
        url: '/src/assets/images/sample_botanical_glass_1794211819701.jpg',
        filename: 'fluted-glass-conservatory-study.jpg',
        category: 'image',
        format: 'JPG',
        mimeType: 'image/jpeg',
        width: 1024,
        height: 1024,
        aspectRatio: '1:1',
        byteSize: 298410,
        alt: 'Modern steel and fluted glass botanical conservatory with morning sunlight beams',
        sourceTag: '<img>',
        domContext: '<figure> · Editorial Gallery',
        isExternal: false,
      },
      {
        id: 'preset-hardware-3',
        url: '/src/assets/images/sample_hardware_synth_1794211818111.jpg',
        filename: 'monolith-modular-synthesizer-console.jpg',
        category: 'background',
        format: 'JPG',
        mimeType: 'image/jpeg',
        width: 1280,
        height: 960,
        aspectRatio: '4:3',
        byteSize: 341120,
        alt: 'Precision-machined matte black anodized aluminum modular synthesizer acoustic installation',
        sourceTag: 'style=""',
        domContext: 'CSS background-image · Acoustic Room Section',
        isExternal: false,
      },
      {
        id: 'preset-watch-4',
        url: '/src/assets/images/sample_editorial_watch_1794211818681.jpg',
        filename: 'chronomaster-titanium-calibre-macro.jpg',
        category: 'meta',
        format: 'JPG',
        mimeType: 'image/jpeg',
        width: 1280,
        height: 960,
        aspectRatio: '4:3',
        byteSize: 312800,
        alt: 'OpenGraph Social Share Card — Precision Titanium Chronograph',
        sourceTag: '<meta>',
        domContext: 'og:image · twitter:image',
        isExternal: false,
      },
      {
        id: 'preset-svg-5',
        url: `data:image/svg+xml;utf8,${encodeURIComponent(COMPASS_SVG)}`,
        filename: 'solar-azimuth-elevation-compass.svg',
        category: 'vector',
        format: 'SVG',
        mimeType: 'image/svg+xml',
        width: 240,
        height: 240,
        aspectRatio: '1:1',
        byteSize: COMPASS_SVG.length,
        alt: 'Solar Azimuth & Architectural Orientation Vector Diagram',
        sourceTag: '<svg>',
        domContext: 'Inline SVG · viewBox 0 0 240 240',
        svgCode: COMPASS_SVG,
        isExternal: false,
      },
      {
        id: 'preset-svg-6',
        url: `data:image/svg+xml;utf8,${encodeURIComponent(WAVEFORM_SVG)}`,
        filename: 'acoustic-impulse-response-curve.svg',
        category: 'vector',
        format: 'SVG',
        mimeType: 'image/svg+xml',
        width: 320,
        height: 160,
        aspectRatio: '2:1',
        byteSize: WAVEFORM_SVG.length,
        alt: 'Pavilion Reverberation & Harmonic Decay Curve',
        sourceTag: '<svg>',
        domContext: 'Inline SVG · viewBox 0 0 320 160',
        svgCode: WAVEFORM_SVG,
        isExternal: false,
      },
      {
        id: 'preset-svg-7',
        url: `data:image/svg+xml;utf8,${encodeURIComponent(ESCAPEMENT_SVG)}`,
        filename: 'horology-coaxial-calibration-wheel.svg',
        category: 'vector',
        format: 'SVG',
        mimeType: 'image/svg+xml',
        width: 240,
        height: 240,
        aspectRatio: '1:1',
        byteSize: ESCAPEMENT_SVG.length,
        alt: 'Co-Axial Escapement Calibration Schematic',
        sourceTag: '<svg>',
        domContext: 'Inline SVG · viewBox 0 0 240 240',
        svgCode: ESCAPEMENT_SVG,
        isExternal: false,
      },
      {
        id: 'preset-audio-8',
        url: SAMPLE_AUDIO_URI,
        filename: 'synth-harmonic-room-impulse-440hz.wav',
        category: 'audio',
        format: 'WAV',
        mimeType: 'audio/wav',
        byteSize: 32044,
        alt: 'Synthesizer Acoustic Room Impulse Recording (440Hz + 659Hz)',
        sourceTag: '<audio><source>',
        domContext: 'HTML5 Audio Stream · audio/wav',
        isExternal: false,
      },
    ],
  },
];

export const QUICK_LIVE_URLS: Array<{ label: string; url: string; note: string }> = [
  {
    label: 'Wikipedia: Brutalist Architecture',
    url: 'https://en.wikipedia.org/wiki/Brutalist_architecture',
    note: 'Live scrape: ~25 high-res photos + srcset variants',
  },
  {
    label: 'Wikipedia: Mechanical Watch',
    url: 'https://en.wikipedia.org/wiki/Mechanical_watch',
    note: 'Live scrape: Macro horology photos + diagrams',
  },
  {
    label: 'W3C SVG Vector Specification',
    url: 'https://www.w3.org/Graphics/SVG/',
    note: 'Live scrape: Vector graphics & W3C icons',
  },
];
