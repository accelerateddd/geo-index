import type { FlagFilterId } from '../types/quiz';

export interface FlagFilterMeta {
  id: FlagFilterId;
  label: string;
  shortDesc: string;
  excludes: FlagFilterId[];
}

export const FLAG_FILTER_DEFINITIONS: FlagFilterMeta[] = [
  {
    id: 'pixelate',
    label: 'Pixelate',
    shortDesc: 'Breaks the flag into a coarse mosaic of blocks.',
    excludes: [],
  },
  {
    id: 'swirl',
    label: 'Swirl',
    shortDesc: 'Twists the flag into a radial vortex.',
    excludes: [],
  },
  {
    id: 'grayscale',
    label: 'Black & white',
    shortDesc: 'Converts the flag to grayscale.',
    excludes: [
      'colorblind-deuteranopia',
      'colorblind-tritanopia',
      'hue-shift',
      'edge-detect',
    ],
  },
  {
    id: 'colorblind-deuteranopia',
    label: 'Red-green colour blind',
    shortDesc: 'Preview how the flag looks with red-green colour blindness.',
    excludes: ['grayscale', 'colorblind-tritanopia', 'edge-detect'],
  },
  {
    id: 'colorblind-tritanopia',
    label: 'Blue-yellow colour blind',
    shortDesc: 'Preview how the flag looks with blue-yellow colour blindness.',
    excludes: ['grayscale', 'colorblind-deuteranopia', 'edge-detect'],
  },
  {
    id: 'invert',
    label: 'Invert colours',
    shortDesc: 'Inverts every colour.',
    excludes: ['edge-detect'],
  },
  {
    id: 'hue-shift',
    label: 'Hue shift',
    shortDesc: 'Rotates every hue by 180°.',
    excludes: ['grayscale', 'edge-detect'],
  },
  {
    id: 'wave',
    label: 'Wave',
    shortDesc: 'Ripples the flag with horizontal and vertical waves.',
    excludes: [],
  },
  {
    id: 'kaleidoscope',
    label: 'Kaleidoscope',
    shortDesc: 'Mirrors a quadrant into a kaleidoscope.',
    excludes: [],
  },
  {
    id: 'slice-shuffle',
    label: 'Slice shuffle',
    shortDesc: 'Scrambles the flag into shuffled tiles.',
    excludes: [],
  },
  {
    id: 'edge-detect',
    label: 'Edge outline',
    shortDesc: 'Keeps only the glowing edges between shapes.',
    excludes: [
      'grayscale',
      'colorblind-deuteranopia',
      'colorblind-tritanopia',
      'invert',
      'hue-shift',
    ],
  },
];

export function getConflictingFilter(
  candidateId: FlagFilterId,
  activeFilters: FlagFilterId[]
): FlagFilterId | null {
  const candidateMeta = FLAG_FILTER_DEFINITIONS.find((f) => f.id === candidateId);
  if (!candidateMeta) return null;

  for (const activeId of activeFilters) {
    if (activeId === candidateId) continue;
    if (candidateMeta.excludes.includes(activeId)) return activeId;
    const activeMeta = FLAG_FILTER_DEFINITIONS.find((f) => f.id === activeId);
    if (activeMeta?.excludes.includes(candidateId)) return activeId;
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function applyFlagFiltersToCanvas(
  img: HTMLImageElement,
  canvas: HTMLCanvasElement,
  activeFilters: FlagFilterId[],
  width: number = 420,
  height: number = 280
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, width, height);

  const filterSet = new Set<FlagFilterId>(activeFilters);
  if (filterSet.size === 0) return;

  // 1. Colour channel transforms
  if (
    filterSet.has('grayscale') ||
    filterSet.has('colorblind-deuteranopia') ||
    filterSet.has('colorblind-tritanopia') ||
    filterSet.has('invert') ||
    filterSet.has('hue-shift')
  ) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];

      if (filterSet.has('colorblind-deuteranopia')) {
        const nr = 0.625 * r + 0.375 * g;
        const ng = 0.7 * r + 0.3 * g;
        const nb = 0.3 * g + 0.7 * b;
        r = Math.min(255, Math.max(0, nr));
        g = Math.min(255, Math.max(0, ng));
        b = Math.min(255, Math.max(0, nb));
      } else if (filterSet.has('colorblind-tritanopia')) {
        const nr = 0.95 * r + 0.05 * g;
        const ng = 0.433 * g + 0.567 * b;
        const nb = 0.475 * g + 0.525 * b;
        r = Math.min(255, Math.max(0, nr));
        g = Math.min(255, Math.max(0, ng));
        b = Math.min(255, Math.max(0, nb));
      }

      if (filterSet.has('hue-shift')) {
        const [h, s, l] = rgbToHsl(r, g, b);
        [r, g, b] = hslToRgb((h + 0.5) % 1, s, l);
      }

      if (filterSet.has('grayscale')) {
        const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        r = g = b = lum;
      }

      if (filterSet.has('invert')) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // 2. Kaleidoscope (4-way mirror reflection)
  if (filterSet.has('kaleidoscope')) {
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const sd = src.data;
    const dd = dst.data;
    const halfW = Math.floor(width / 2);
    const halfH = Math.floor(height / 2);

    for (let y = 0; y < height; y++) {
      const sy = y < halfH ? y : height - 1 - y;
      for (let x = 0; x < width; x++) {
        const sx = x < halfW ? x : width - 1 - x;
        const sIdx = (sy * width + sx) * 4;
        const dIdx = (y * width + x) * 4;
        dd[dIdx] = sd[sIdx];
        dd[dIdx + 1] = sd[sIdx + 1];
        dd[dIdx + 2] = sd[sIdx + 2];
        dd[dIdx + 3] = sd[sIdx + 3];
      }
    }
    ctx.putImageData(dst, 0, 0);
  }

  // 3. Slice Shuffle (Deterministic 4x3 tile permutation)
  if (filterSet.has('slice-shuffle')) {
    const cols = 4;
    const rows = 3;
    const tileW = Math.floor(width / cols);
    const tileH = Math.floor(height / rows);
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const octx = offscreen.getContext('2d');
    if (octx) {
      octx.drawImage(canvas, 0, 0);
      const perm = [7, 2, 11, 0, 9, 4, 1, 10, 5, 8, 3, 6];
      ctx.clearRect(0, 0, width, height);
      for (let idx = 0; idx < cols * rows; idx++) {
        const srcIdx = perm[idx];
        const sx = (srcIdx % cols) * tileW;
        const sy = Math.floor(srcIdx / cols) * tileH;
        const dx = (idx % cols) * tileW;
        const dy = Math.floor(idx / cols) * tileH;
        ctx.drawImage(offscreen, sx, sy, tileW, tileH, dx, dy, tileW, tileH);
      }
    }
  }

  // 4. Swirl / Vortex Distortion
  if (filterSet.has('swirl')) {
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const sd = src.data;
    const dd = dst.data;
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(cx, cy) * 0.95;
    const twistAngle = 3.8;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        let sx = x;
        let sy = y;
        if (r < maxR) {
          const factor = 1 - r / maxR;
          const theta = factor * factor * twistAngle;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);
          sx = Math.round(cx + dx * cosT - dy * sinT);
          sy = Math.round(cy + dx * sinT + dy * cosT);
        }
        sx = Math.min(width - 1, Math.max(0, sx));
        sy = Math.min(height - 1, Math.max(0, sy));
        const sIdx = (sy * width + sx) * 4;
        const dIdx = (y * width + x) * 4;
        dd[dIdx] = sd[sIdx];
        dd[dIdx + 1] = sd[sIdx + 1];
        dd[dIdx + 2] = sd[sIdx + 2];
        dd[dIdx + 3] = sd[sIdx + 3];
      }
    }
    ctx.putImageData(dst, 0, 0);
  }

  // 5. Wave / Ripple Distortion
  if (filterSet.has('wave')) {
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const sd = src.data;
    const dd = dst.data;
    const ampX = width * 0.085;
    const ampY = height * 0.085;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = Math.min(
          width - 1,
          Math.max(0, Math.round(x + Math.sin((y / height) * Math.PI * 5) * ampX))
        );
        const sy = Math.min(
          height - 1,
          Math.max(0, Math.round(y + Math.cos((x / width) * Math.PI * 5) * ampY))
        );
        const sIdx = (sy * width + sx) * 4;
        const dIdx = (y * width + x) * 4;
        dd[dIdx] = sd[sIdx];
        dd[dIdx + 1] = sd[sIdx + 1];
        dd[dIdx + 2] = sd[sIdx + 2];
        dd[dIdx + 3] = sd[sIdx + 3];
      }
    }
    ctx.putImageData(dst, 0, 0);
  }

  // 6. Edge Outline Detection (Sobel Gradient)
  if (filterSet.has('edge-detect')) {
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const sd = src.data;
    const dd = dst.data;

    const getLum = (x: number, y: number) => {
      const cx = Math.min(width - 1, Math.max(0, x));
      const cy = Math.min(height - 1, Math.max(0, y));
      const i = (cy * width + cx) * 4;
      return 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gx =
          -getLum(x - 1, y - 1) +
          getLum(x + 1, y - 1) -
          2 * getLum(x - 1, y) +
          2 * getLum(x + 1, y) -
          getLum(x - 1, y + 1) +
          getLum(x + 1, y + 1);
        const gy =
          -getLum(x - 1, y - 1) -
          2 * getLum(x, y - 1) -
          getLum(x + 1, y - 1) +
          getLum(x - 1, y + 1) +
          2 * getLum(x, y + 1) +
          getLum(x + 1, y + 1);
        const mag = Math.min(255, Math.hypot(gx, gy));
        const val = mag > 28 ? Math.min(255, Math.round(mag * 1.4)) : 12;
        const dIdx = (y * width + x) * 4;
        dd[dIdx] = val;
        dd[dIdx + 1] = val;
        dd[dIdx + 2] = Math.min(255, val + 15);
        dd[dIdx + 3] = 255;
      }
    }
    ctx.putImageData(dst, 0, 0);
  }

  // 7. Pixelate (Low-Res Mosaic Block Grid)
  if (filterSet.has('pixelate')) {
    const cols = 12;
    const rows = 8;
    const tiny = document.createElement('canvas');
    tiny.width = cols;
    tiny.height = rows;
    const tctx = tiny.getContext('2d');
    if (tctx) {
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(canvas, 0, 0, cols, rows);
      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tiny, 0, 0, cols, rows, 0, 0, width, height);
    }
  }
}

export interface ColorPieSlice {
  hex: string;
  r: number;
  g: number;
  b: number;
  percent: number;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Analyzes a flag's colour distribution while eliminating anti-aliased edge transition pixels
 * (such as pink pixels along the boundary between red and white on Georgia's flag).
 */
export function computeFlagColorPieSlices(img: HTMLImageElement): ColorPieSlice[] {
  const sampleW = 240;
  const sampleH = 160;
  const canvas = document.createElement('canvas');
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, sampleW, sampleH);
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data;

  // Step 1: Collect uniform interior pixels (skipping 1px anti-aliased transition boundaries)
  const bins = new Map<
    string,
    { count: number; r: number; g: number; b: number }
  >();

  let validPixels = 0;

  const isEdgePixel = (x: number, y: number, idx: number): boolean => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const neighbors = [
      ((y - 1) * sampleW + x) * 4,
      ((y + 1) * sampleW + x) * 4,
      (y * sampleW + (x - 1)) * 4,
      (y * sampleW + (x + 1)) * 4,
    ];
    for (const nIdx of neighbors) {
      const dr = Math.abs(r - data[nIdx]);
      const dg = Math.abs(g - data[nIdx + 1]);
      const db = Math.abs(b - data[nIdx + 2]);
      if (dr + dg + db > 36) return true;
    }
    return false;
  };

  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const idx = (y * sampleW + x) * 4;
      if (data[idx + 3] < 128) continue;
      if (isEdgePixel(x, y, idx)) continue;

      validPixels++;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const qr = Math.round(r / 8) * 8;
      const qg = Math.round(g / 8) * 8;
      const qb = Math.round(b / 8) * 8;
      const key = `${qr},${qg},${qb}`;
      const existing = bins.get(key);
      if (existing) {
        existing.count++;
      } else {
        bins.set(key, { count: 1, r, g, b });
      }
    }
  }

  if (validPixels === 0) return [];

  const sortedBins = Array.from(bins.values()).sort((a, b) => b.count - a.count);

  // Step 2: Cluster colours anchored to each cluster's dominant mode colour (no mean drift toward pink!)
  const clusters: Array<{
    count: number;
    r: number;
    g: number;
    b: number;
  }> = [];

  for (const bin of sortedBins) {
    let merged = false;
    for (const cl of clusters) {
      const dr = bin.r - cl.r;
      const dg = bin.g - cl.g;
      const db = bin.b - cl.b;
      const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
      if (dist < 75) {
        cl.count += bin.count;
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({
        count: bin.count,
        r: bin.r,
        g: bin.g,
        b: bin.b,
      });
    }
  }

  // Step 3: Collinear anti-alias blend elimination
  // Any minor cluster (< 12% of pixels) that is a linear blend t*C1 + (1-t)*C2 of two major clusters
  // (such as pink between red and white) has its pixel count returned to C1 and C2.
  clusters.sort((a, b) => b.count - a.count);
  const keepFlags = new Array(clusters.length).fill(true);

  for (let k = clusters.length - 1; k >= 2; k--) {
    const ck = clusters[k];
    if (ck.count / validPixels > 0.12) continue;

    let absorbed = false;
    for (let i = 0; i < k && !absorbed; i++) {
      if (!keepFlags[i]) continue;
      for (let j = i + 1; j < k && !absorbed; j++) {
        if (!keepFlags[j]) continue;
        const ci = clusters[i];
        const cj = clusters[j];
        const vx = cj.r - ci.r;
        const vy = cj.g - ci.g;
        const vz = cj.b - ci.b;
        const lenSq = vx * vx + vy * vy + vz * vz;
        if (lenSq < 900) continue;

        const wx = ck.r - ci.r;
        const wy = ck.g - ci.g;
        const wz = ck.b - ci.b;
        const t = (wx * vx + wy * vy + wz * vz) / lenSq;
        if (t > 0.05 && t < 0.95) {
          const px = ci.r + t * vx;
          const py = ci.g + t * vy;
          const pz = ci.b + t * vz;
          const orthoDist = Math.hypot(ck.r - px, ck.g - py, ck.b - pz);
          if (orthoDist < 32) {
            ci.count += Math.round(ck.count * (1 - t));
            cj.count += Math.round(ck.count * t);
            keepFlags[k] = false;
            absorbed = true;
          }
        }
      }
    }
  }

  const cleanedClusters = clusters.filter((_, idx) => keepFlags[idx]);

  let significant = cleanedClusters
    .filter((c) => c.count / validPixels >= 0.01)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  if (significant.length === 0 && cleanedClusters.length > 0) {
    significant = [cleanedClusters[0]];
  }

  const sigTotal = significant.reduce((acc, c) => acc + c.count, 0);

  return significant.map((c) => {
    const percent = Number(((c.count / sigTotal) * 100).toFixed(1));
    return {
      hex: rgbToHex(c.r, c.g, c.b),
      r: c.r,
      g: c.g,
      b: c.b,
      percent,
    };
  });
}
