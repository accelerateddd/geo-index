import React, { useEffect, useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import type { OfficialStreetViewMetadata } from '../types/coverageNotes';

export function formatCompassDirection(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((deg % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return `${Math.round(normalized)}° ${dirs[idx]}`;
}

/**
 * Distortion-Free Natural-FOV Rectilinear Panorama Viewer using Google's Official Panorama Tiles.
 * Uses a narrow, natural 48° vertical/horizontal FOV (no wide-angle fisheye edge stretching)
 * and loads high-resolution zoom=3 tiles so road details appear at their true proportions.
 */
export const StreetViewSphericalViewer: React.FC<{
  panoId: string;
  carHeadingDeg: number;
  panoNorthDeg: number;
  viewHeadingDeg: number;
  viewPitchDeg: number;
  neighborLinks: OfficialStreetViewMetadata['neighborLinks'];
  onChangeViewAngle: (headingDeg: number, pitchDeg: number) => void;
  onNavigateNeighbor: (neighbor: {
    panoId: string;
    headingDeg: number;
    lat?: number;
    lng?: number;
  }) => void;
}> = ({
  panoId,
  panoNorthDeg,
  viewHeadingDeg,
  viewPitchDeg,
  neighborLinks,
  onChangeViewAngle,
  onNavigateNeighbor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Default 46° natural lens FOV to eliminate wide-angle fisheye stretching
  const [fovDeg, setFovDeg] = useState<number>(46);
  const [tilesLoaded, setTilesLoaded] = useState<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    heading: number;
    pitch: number;
  }>({ x: 0, y: 0, heading: 0, pitch: 0 });
  const panoCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load zoom=2 immediately for instant display, then overlay sharp zoom=3 tiles (3328x1664)
  useEffect(() => {
    let cancelled = false;
    setTilesLoaded(0);

    const offscreen = document.createElement('canvas');
    offscreen.width = 3328;
    offscreen.height = 1664;
    const ctx = offscreen.getContext('2d');
    panoCanvasRef.current = offscreen;

    if (!ctx) return;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    let loadedCount = 0;
    // Fast preview pass (zoom=2 scaled up 2x)
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (cancelled) return;
          ctx.drawImage(img, x * 1024, y * 1024, 1024, 1024);
          loadedCount++;
          setTilesLoaded(loadedCount);
        };
        img.src = `https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=maps_sv.tactile&panoid=${encodeURIComponent(
          panoId
        )}&x=${x}&y=${y}&zoom=2&nbt=1&fover=2`;
      }
    }

    // High-resolution pass (zoom=3: 7x4 tiles of 512x512 -> 3328x1664)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 7; x++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (cancelled) return;
          ctx.drawImage(img, x * 512, y * 512, 512, 512);
          loadedCount++;
          setTilesLoaded(loadedCount);
        };
        img.src = `https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=maps_sv.tactile&panoid=${encodeURIComponent(
          panoId
        )}&x=${x}&y=${y}&zoom=3&nbt=1&fover=2`;
      }
    }

    return () => {
      cancelled = true;
    };
  }, [panoId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const srcCanvas = panoCanvasRef.current;
    if (!canvas || !srcCanvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(260, Math.min(720, Math.floor(rect.width)));
    const height = Math.max(220, Math.min(600, Math.floor(rect.height)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    const srcCtx = srcCanvas.getContext('2d');
    if (!ctx || !srcCtx) return;

    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;
    let srcData: ImageData;
    try {
      srcData = srcCtx.getImageData(0, 0, srcW, srcH);
    } catch {
      return;
    }

    const dstData = ctx.createImageData(width, height);
    const srcPixels = new Uint32Array(srcData.data.buffer);
    const dstPixels = new Uint32Array(dstData.data.buffer);

    // Use max(width, height) as reference dimension so wide viewports never stretch edges into a fisheye
    const refDim = Math.max(width, height);
    const fovRad = (fovDeg * Math.PI) / 180;
    const focal = (refDim * 0.5) / Math.tan(fovRad * 0.5);

    const yawDeg = viewHeadingDeg - panoNorthDeg;
    const yawRad = (yawDeg * Math.PI) / 180;
    const pitchRad = (viewPitchDeg * Math.PI) / 180;

    const cosYaw = Math.cos(yawRad);
    const sinYaw = Math.sin(yawRad);
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);

    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const invTwoPi = 1 / (2 * Math.PI);
    const invPi = 1 / Math.PI;

    let dstIdx = 0;
    for (let py = 0; py < height; py++) {
      const cy = halfH - py;
      for (let px = 0; px < width; px++) {
        const cx = px - halfW;
        const cz = focal;

        const invLen = 1 / Math.hypot(cx, cy, cz);
        const rx = cx * invLen;
        const ry = cy * invLen;
        const rz = cz * invLen;

        const y1 = ry * cosPitch + rz * sinPitch;
        const z1 = -ry * sinPitch + rz * cosPitch;
        const x1 = rx;

        const wx = x1 * cosYaw + z1 * sinYaw;
        const wz = -x1 * sinYaw + z1 * cosYaw;
        const wy = y1;

        const lon = Math.atan2(wx, wz);
        const lat = Math.asin(Math.max(-1, Math.min(1, wy)));

        let u = 0.5 + lon * invTwoPi;
        u = u - Math.floor(u);
        const v = Math.max(0, Math.min(0.999, 0.5 - lat * invPi));

        const sx = (u * (srcW - 1)) | 0;
        const sy = (v * (srcH - 1)) | 0;
        dstPixels[dstIdx++] = srcPixels[sy * srcW + sx];
      }
    }

    ctx.putImageData(dstData, 0, 0);
  }, [panoId, panoNorthDeg, viewHeadingDeg, viewPitchDeg, fovDeg, tilesLoaded]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      heading: viewHeadingDeg,
      pitch: viewPitchDeg,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const sensitivity = fovDeg / 360;
    const nextHeading =
      (((dragStartRef.current.heading - dx * sensitivity) % 360) + 360) % 360;
    const nextPitch = Math.max(
      -85,
      Math.min(85, dragStartRef.current.pitch + dy * sensitivity)
    );
    onChangeViewAngle(nextHeading, nextPitch);
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setFovDeg((prev) =>
      Math.max(20, Math.min(68, prev + (e.deltaY > 0 ? 4 : -4)))
    );
  };

  return (
    <div className="relative w-full h-full bg-slate-950 select-none overflow-hidden">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />

      {/* Top Bar: Compass Heading + Natural Lens Zoom Control */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none">
        <div className="px-2.5 py-1 rounded-full bg-slate-950/85 border border-slate-700 text-[11px] font-bold text-amber-300 shadow flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-amber-400" />
          <span>{formatCompassDirection(viewHeadingDeg)}</span>
        </div>

        <div className="px-2 py-0.5 rounded-full bg-slate-950/85 border border-slate-700 text-[10px] text-slate-300 flex items-center gap-1.5 pointer-events-auto">
          <span>FOV {fovDeg}°</span>
          <input
            type="range"
            min={22}
            max={65}
            step={2}
            value={fovDeg}
            onChange={(e) => setFovDeg(Number(e.target.value))}
            title="Adjust Lens Field of View (Lower = Zoomed In / Zero Distortion)"
            className="w-14 accent-amber-400 cursor-pointer"
          />
        </div>
      </div>

      {/* Step Forward / Backward Road Arrows at Bottom of Panorama */}
      {neighborLinks.length > 0 && (
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-slate-950/85 px-2.5 py-1 rounded-full border border-slate-700 shadow-lg">
          {neighborLinks.map((n, idx) => {
            const relAngle =
              (((n.headingDeg - viewHeadingDeg) % 360) + 360) % 360;
            return (
              <button
                key={`${n.panoId}-${idx}`}
                type="button"
                onClick={() => onNavigateNeighbor(n)}
                title={`Step along road (${formatCompassDirection(n.headingDeg)})`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 hover:bg-indigo-600 text-[10px] font-bold text-slate-200 hover:text-white border border-slate-700 cursor-pointer transition"
              >
                <span
                  className="inline-block"
                  style={{ transform: `rotate(${relAngle}deg)` }}
                >
                  ↑
                </span>
                <span>{formatCompassDirection(n.headingDeg)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Interactive Mini Sketch Canvas for Pin Annotations
 */
export const PinSketchCanvas: React.FC<{
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
}> = ({ value, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [brushColor, setBrushColor] = useState('#f8fafc');
  const [brushSize, setBrushSize] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = value;
    }
  }, [value]);

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL('image/png'));
  };

  const clearSketch = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(undefined);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span className="font-bold text-slate-300">SKETCH CANVAS</span>
        <div className="flex items-center gap-1">
          {['#f8fafc', '#ef4444', '#eab308', '#38bdf8', '#22c55e'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setBrushColor(c)}
              className={`w-3.5 h-3.5 rounded-full border cursor-pointer ${
                brushColor === c ? 'border-white scale-110' : 'border-slate-700'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <select
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="ml-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-300"
          >
            <option value={2}>Thin</option>
            <option value={3}>Med</option>
            <option value={5}>Thick</option>
          </select>
          <button
            type="button"
            onClick={clearSketch}
            className="ml-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={220}
        height={130}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="w-full h-[130px] rounded-lg bg-slate-950 border border-slate-800 cursor-crosshair touch-none"
      />
    </div>
  );
};

import type {
  CardinalDirectionFilter,
  DrivingDirectionMode,
  RoadPointOfInterest,
  RoadSideLineAttachment,
} from '../types/coverageNotes';

const CARDINAL_DIRECTION_TARGET_DEG: Record<
  Exclude<CardinalDirectionFilter, 'all'>,
  { deg: number; tolerance: number; label: string }
> = {
  N: { deg: 0, tolerance: 50, label: 'North of Road (N)' },
  NE: { deg: 45, tolerance: 35, label: 'NE of Road' },
  E: { deg: 90, tolerance: 50, label: 'East of Road (E)' },
  SE: { deg: 135, tolerance: 35, label: 'SE of Road' },
  S: { deg: 180, tolerance: 50, label: 'South of Road (S)' },
  SW: { deg: 225, tolerance: 35, label: 'SW of Road' },
  W: { deg: 270, tolerance: 50, label: 'West of Road (W)' },
  NW: { deg: 315, tolerance: 35, label: 'NW of Road' },
};

export function hexToRgbNormalized(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return [0.22, 0.74, 0.97];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 0.22,
    Number.isFinite(g) ? g : 0.74,
    Number.isFinite(b) ? b : 0.97,
  ];
}

export function computeCompassBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const cosLat = Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  const dy = lat2 - lat1;
  const dx = (lng2 - lng1) * cosLat;
  const angleRad = Math.atan2(dx, dy);
  return ((angleRad * 180) / Math.PI + 360) % 360;
}

export function computeSideOutwardCompassBearing(
  pt1: [number, number],
  pt2: [number, number],
  side: 'left' | 'right'
): number {
  const roadBearing = computeCompassBearing(pt1[0], pt1[1], pt2[0], pt2[1]);
  return side === 'left'
    ? (roadBearing - 90 + 360) % 360
    : (roadBearing + 90) % 360;
}

export function isAngleWithinCardinalFilter(
  bearingDeg: number,
  filter: CardinalDirectionFilter
): boolean {
  if (filter === 'all') return true;
  const spec = CARDINAL_DIRECTION_TARGET_DEG[filter];
  const diff = Math.abs((((bearingDeg - spec.deg) % 360) + 540) % 360 - 180);
  return diff <= spec.tolerance;
}

export function interpolatePointOnPolylineByFraction(
  points: Array<[number, number]>,
  frac: number
): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const clamped = Math.max(0, Math.min(1, frac));

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cosLat = Math.cos(
      ((points[i][0] + points[i + 1][0]) * 0.5 * Math.PI) / 180
    );
    const len = Math.hypot(
      points[i + 1][0] - points[i][0],
      (points[i + 1][1] - points[i][1]) * cosLat
    );
    segLengths.push(len);
    totalLen += len;
  }
  if (totalLen <= 1e-9) return points[0];

  const targetDist = clamped * totalLen;
  let accum = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (accum + segLen >= targetDist && segLen > 1e-10) {
      const t = (targetDist - accum) / segLen;
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ];
    }
    accum += segLen;
  }
  return points[points.length - 1];
}

export function resolveSideLineFractions(
  sl: RoadSideLineAttachment,
  roadPois?: RoadPointOfInterest[]
): [number, number] {
  let start = sl.startFrac;
  let end = sl.endFrac;
  if (roadPois && roadPois.length > 0) {
    if (sl.startPoiId) {
      const p = roadPois.find((poi) => poi.id === sl.startPoiId);
      if (p) start = p.frac;
    }
    if (sl.endPoiId) {
      const p = roadPois.find((poi) => poi.id === sl.endPoiId);
      if (p) end = p.frac;
    }
  }
  return [Math.min(start, end), Math.max(start, end)];
}

export function extractSubPolylineByFraction(
  points: Array<[number, number]>,
  startFrac: number,
  endFrac: number
): Array<[number, number]> {
  if (points.length < 2) return points;
  const f0 = Math.max(0, Math.min(1, Math.min(startFrac, endFrac)));
  const f1 = Math.max(0, Math.min(1, Math.max(startFrac, endFrac)));
  if (f1 - f0 < 0.001) return [];

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cosLat = Math.cos(
      ((points[i][0] + points[i + 1][0]) * 0.5 * Math.PI) / 180
    );
    const dLat = points[i + 1][0] - points[i][0];
    const dLng = (points[i + 1][1] - points[i][1]) * cosLat;
    const len = Math.hypot(dLat, dLng);
    segLengths.push(len);
    totalLen += len;
  }

  if (totalLen <= 1e-9) return points;

  const targetStart = f0 * totalLen;
  const targetEnd = f1 * totalLen;
  const out: Array<[number, number]> = [];

  let accum = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    const nextAccum = accum + segLen;
    const pA = points[i];
    const pB = points[i + 1];

    if (nextAccum >= targetStart && accum <= targetEnd && segLen > 1e-10) {
      const tStart = Math.max(0, (targetStart - accum) / segLen);
      const tEnd = Math.min(1, (targetEnd - accum) / segLen);

      const startPt: [number, number] = [
        pA[0] + (pB[0] - pA[0]) * tStart,
        pA[1] + (pB[1] - pA[1]) * tStart,
      ];
      const endPt: [number, number] = [
        pA[0] + (pB[0] - pA[0]) * tEnd,
        pA[1] + (pB[1] - pA[1]) * tEnd,
      ];

      if (out.length === 0) {
        out.push(startPt);
      }
      out.push(endPt);
    }
    accum = nextAccum;
  }

  return out;
}

export function offsetPolylinePerpendicular(
  points: Array<[number, number]>,
  side: 'left' | 'right',
  offsetPixels: number,
  zoom: number
): Array<[number, number]> {
  if (points.length < 2) return points;
  const degPerPixelLng = 360 / (256 * Math.pow(2, zoom));
  const sign = side === 'left' ? -1 : 1;

  return points.map((pt, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const cosLat = Math.max(0.15, Math.cos((pt[0] * Math.PI) / 180));
    const dy = (next[0] - prev[0]) / cosLat;
    const dx = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-10) return pt;

    const nxEast = (dy / len) * sign;
    const nyNorth = (-dx / len) * sign;

    const dLat = nyNorth * offsetPixels * degPerPixelLng * cosLat;
    const dLng = nxEast * offsetPixels * degPerPixelLng;
    return [pt[0] + dLat, pt[1] + dLng];
  });
}

export function buildChevronPolylines(
  points: Array<[number, number]>,
  direction: DrivingDirectionMode,
  zoom: number
): Array<Array<[number, number]>> {
  if (points.length < 2 || direction === 'none') return [];
  const degPerPixel = 360 / (256 * Math.pow(2, zoom));
  const spacingDeg = degPerPixel * 85;
  const wingLenDeg = degPerPixel * 7.5;

  const chevrons: Array<Array<[number, number]>> = [];
  let distSinceLast = spacingDeg * 0.45;

  const addChevronAt = (
    lat: number,
    lng: number,
    dLat: number,
    dLng: number,
    reverse: boolean
  ) => {
    const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
    const ux = (reverse ? -dLng : dLng) * cosLat;
    const uy = reverse ? -dLat : dLat;
    const len = Math.hypot(ux, uy);
    if (len < 1e-10) return;

    const fx = ux / len;
    const fy = uy / len;
    const px = -fy;
    const py = fx;

    const backX = -fx * wingLenDeg;
    const backY = -fy * wingLenDeg;
    const sideX = px * wingLenDeg * 0.68;
    const sideY = py * wingLenDeg * 0.68;

    const tip: [number, number] = [
      lat + fy * wingLenDeg * 0.35 * cosLat,
      lng + (fx * wingLenDeg * 0.35) / cosLat,
    ];
    const leftWing: [number, number] = [
      tip[0] + (backY + sideY) * cosLat,
      tip[1] + (backX + sideX) / cosLat,
    ];
    const rightWing: [number, number] = [
      tip[0] + (backY - sideY) * cosLat,
      tip[1] + (backX - sideX) / cosLat,
    ];
    chevrons.push([leftWing, tip, rightWing]);
  };

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const cosLat = Math.max(
      0.15,
      Math.cos(((p1[0] + p2[0]) * 0.5 * Math.PI) / 180)
    );
    const dLat = p2[0] - p1[0];
    const dLng = p2[1] - p1[1];
    const segLen = Math.hypot(dLat / cosLat, dLng);
    if (segLen < 1e-9) continue;

    let pos = spacingDeg - distSinceLast;
    while (pos <= segLen) {
      const t = pos / segLen;
      const lat = p1[0] + dLat * t;
      const lng = p1[1] + dLng * t;

      if (direction === 'forward' || direction === 'both') {
        addChevronAt(lat, lng, dLat / cosLat, dLng, false);
      }
      if (direction === 'reverse' || direction === 'both') {
        addChevronAt(lat, lng, dLat / cosLat, dLng, true);
      }
      pos += spacingDeg;
    }
    distSinceLast = segLen - (pos - spacingDeg);
  }

  if (chevrons.length === 0 && points.length >= 2) {
    const midIdx = Math.floor((points.length - 1) / 2);
    const p1 = points[midIdx];
    const p2 = points[midIdx + 1];
    const cosLat = Math.max(
      0.15,
      Math.cos(((p1[0] + p2[0]) * 0.5 * Math.PI) / 180)
    );
    const midLat = (p1[0] + p2[0]) * 0.5;
    const midLng = (p1[1] + p2[1]) * 0.5;
    if (direction === 'forward' || direction === 'both') {
      addChevronAt(midLat, midLng, (p2[0] - p1[0]) / cosLat, p2[1] - p1[1], false);
    }
    if (direction === 'reverse' || direction === 'both') {
      addChevronAt(midLat, midLng, (p2[0] - p1[0]) / cosLat, p2[1] - p1[1], true);
    }
  }

  return chevrons;
}

export function projectPointOntoRoadStretch(
  lat: number,
  lng: number,
  points: Array<[number, number]>
): {
  frac: number;
  snappedPos: [number, number];
  side: 'left' | 'right';
  distanceDeg: number;
} {
  if (points.length < 2) {
    return {
      frac: 0,
      snappedPos: points[0] || [lat, lng],
      side: 'left',
      distanceDeg: Infinity,
    };
  }

  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cosLat = Math.cos(
      ((points[i][0] + points[i + 1][0]) * 0.5 * Math.PI) / 180
    );
    const len = Math.hypot(
      points[i + 1][0] - points[i][0],
      (points[i + 1][1] - points[i][1]) * cosLat
    );
    segLengths.push(len);
    totalLen += len;
  }
  if (totalLen <= 1e-9) {
    return {
      frac: 0,
      snappedPos: points[0],
      side: 'left',
      distanceDeg: Infinity,
    };
  }

  let bestDist = Infinity;
  let bestFrac = 0;
  let bestSnapped: [number, number] = points[0];
  let bestSide: 'left' | 'right' = 'left';
  let accum = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];
    const cosLat = Math.cos(((A[0] + B[0]) * 0.5 * Math.PI) / 180);
    const vx = (B[1] - A[1]) * cosLat;
    const vy = B[0] - A[0];
    const wx = (lng - A[1]) * cosLat;
    const wy = lat - A[0];

    const segLenSq = vx * vx + vy * vy;
    const t =
      segLenSq > 1e-12
        ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / segLenSq))
        : 0;

    const projX = vx * t;
    const projY = vy * t;
    const dist = Math.hypot(wx - projX, wy - projY);

    if (dist < bestDist) {
      bestDist = dist;
      bestFrac = (accum + segLengths[i] * t) / totalLen;
      bestSnapped = [
        A[0] + (B[0] - A[0]) * t,
        A[1] + (B[1] - A[1]) * t,
      ];
      const cross = vx * wy - vy * wx;
      bestSide = cross >= 0 ? 'left' : 'right';
    }
    accum += segLengths[i];
  }

  return {
    frac: bestFrac,
    snappedPos: bestSnapped,
    side: bestSide,
    distanceDeg: bestDist,
  };
}
